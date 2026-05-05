import "server-only";
import { getAnthropic, QUALIFY_MODEL } from "@/lib/anthropic";
import { buildCachedSystem } from "@/lib/anthropic-prompt";
import { db } from "@/lib/db";
import { extractLinkedInProfile } from "@/lib/linkedin-profile-extractor";
import { readDynamicFewShotsFromIcp } from "@/lib/dynamic-few-shots";
import { searchLayoffsNews } from "@/lib/layoffs-news-search";

/**
 * Qualifie un Trigger via Claude Opus 4.7 et écrit le score composite
 * dans Trigger.score (1-10) + Trigger.scoreReason.
 *
 * Utilisé en post-création par theirstack-poller et webhook Rodz pour
 * que le score Trigger reflète l'ICP fit réel (NAF + persona + freshness)
 * et pas juste la force du signal brut.
 *
 * Idempotent : skip si Trigger.scoreReason déjà rempli.
 */

interface QualifyResult {
  opusScore: number; // 1-10
  reason: string;
  isHot: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 9 helper (05/05/2026) — Negative signals (boîte en contraction)
// ──────────────────────────────────────────────────────────────────────

/**
 * Sprint 9 — Détecte les signaux négatifs depuis companyRecentDepots
 * (Pappers déjà en BD via enrich-lead-dirigeants). Patterns recherchés
 * dans depot.type + depot.decisions :
 *   - Dissolution, Liquidation, Cessation → boîte ferme (score=1)
 *   - Procédure collective, RJ/LJ, sauvegarde → en difficulté (score≤2)
 *   - Plan social, PSE, licenciement collectif → contraction (score≤3)
 *   - Réduction de capital → contraction modérée (score≤4)
 *   - Restructuration → flou, signal négatif modéré (score≤5)
 *   - Cession totale → fonds vendu, signal négatif fort
 *
 * Pourquoi c'est un moat : Apollo/Pharow ne détectent que des signaux
 * POSITIFS (levée, hire, expansion). iFIND avec sources FR-natives
 * (BODACC, Pappers RCS dépôts) voit aussi les signaux négatifs et les
 * intègre dans le scoring. Une boîte qui licencie en pleine levée
 * (apparente) ne sera plus scorée HOT par iFIND.
 *
 * Coût marginal : 0 (lecture in-memory de companyRecentDepots déjà chargé
 * via Lead.include côté qualify-trigger).
 */
const NEGATIVE_DEPOT_PATTERNS: Array<{ regex: RegExp; label: string; severity: "hard" | "medium" | "soft" }> = [
  { regex: /\bliquidation(?!\s+amiable)/i, label: "Liquidation", severity: "hard" },
  { regex: /redressement\s+judiciaire|sauvegarde\s+judiciaire/i, label: "Procédure collective (RJ/sauvegarde)", severity: "hard" },
  { regex: /\bdissolution(?!\s+sans\s+liquidation)/i, label: "Dissolution", severity: "hard" },
  { regex: /cessation\s+(d['']activit|totale|partielle\s+d['']activit)/i, label: "Cessation d'activité", severity: "hard" },
  { regex: /fermeture\s+(d['']établissement|de\s+l['']établissement|de\s+l['']entreprise|de\s+la\s+société)/i, label: "Fermeture", severity: "hard" },
  { regex: /cession\s+(totale\s+d['']activit|du\s+fonds\s+de\s+commerce|de\s+l['']entreprise)/i, label: "Cession totale", severity: "hard" },
  { regex: /plan\s+social|\bPSE\b|licenciement\s+(collectif|économique|pour\s+motif\s+économique)/i, label: "Plan social / PSE", severity: "medium" },
  { regex: /réduction\s+(de\s+)?capital|capital\s+réduit|diminution\s+(du\s+)?capital/i, label: "Réduction de capital", severity: "medium" },
  { regex: /restructuration|réorganisation/i, label: "Restructuration", severity: "soft" },
];

interface NegativeSignalResult {
  block: string;
  hasHardSignal: boolean;
}

function getNegativeSignalsForCompany(
  companyRecentDepots: unknown,
): NegativeSignalResult | null {
  if (!Array.isArray(companyRecentDepots) || companyRecentDepots.length === 0) {
    return null;
  }
  const detected: Array<{ label: string; severity: "hard" | "medium" | "soft"; date: string }> = [];
  for (const d of companyRecentDepots) {
    if (!d || typeof d !== "object") continue;
    const depot = d as { date?: unknown; type?: unknown; decisions?: unknown };
    const dateStr = depot.date ? String(depot.date) : "?";
    const text = [
      String(depot.type ?? ""),
      Array.isArray(depot.decisions)
        ? depot.decisions.map(String).join(" ")
        : String(depot.decisions ?? ""),
    ].join(" ");
    for (const pattern of NEGATIVE_DEPOT_PATTERNS) {
      if (pattern.regex.test(text)) {
        detected.push({ label: pattern.label, severity: pattern.severity, date: dateStr });
      }
    }
  }
  if (detected.length === 0) return null;
  // Dédup par (label) avec date la plus récente
  const dedupMap = new Map<string, (typeof detected)[number]>();
  for (const sig of detected) {
    const existing = dedupMap.get(sig.label);
    if (!existing || sig.date > existing.date) dedupMap.set(sig.label, sig);
  }
  const unique = Array.from(dedupMap.values()).slice(0, 5);
  const hasHardSignal = unique.some((s) => s.severity === "hard");
  const lines = unique.map(
    (s) => `${s.label} (${s.severity}, RCS ${s.date})`,
  );
  return {
    block: `NEGATIVE SIGNALS détectés (Pappers RCS <90j) :\n- ${lines.join("\n- ")}`,
    hasHardSignal,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 6 helper (05/05/2026) — Prior signals (same client, same SIRET)
// ──────────────────────────────────────────────────────────────────────

/**
 * Sprint 6 — Donne au judge le contexte des AUTRES Triggers du même client
 * sur le même SIRET dans les 90 derniers jours. Critique pour qualifier un
 * combo correctement : "ce hire QA arrive 12j après une levée 5M€" doit
 * scorer plus haut que "ce hire QA solo".
 *
 * Travaille avec le combo-detector v2 : quand un combo est détecté, les
 * Triggers précédents sont invalidés → re-pickup → ce helper leur donne le
 * contexte des nouveaux signaux convergents → score affiné.
 *
 * Cost : 1 query DB par qualify call (indexée companySiret + clientId).
 * Limite 5 prior signals max pour borner la taille du prompt.
 */
async function getPriorSignalsForCompany(
  clientId: string,
  companySiret: string | null,
  currentTriggerId: string,
): Promise<string | null> {
  if (!companySiret) return null;
  if (!/^\d{9,14}$/.test(companySiret)) return null;
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const others = await db.trigger.findMany({
    where: {
      clientId,
      companySiret,
      id: { not: currentTriggerId },
      deletedAt: null,
      capturedAt: { gte: since },
    },
    select: {
      type: true,
      sourceCode: true,
      capturedAt: true,
      status: true,
      score: true,
      title: true,
    },
    orderBy: { capturedAt: "desc" },
    take: 5,
  });
  if (others.length === 0) return null;
  const lines = others.map((t) => {
    const ageDays = Math.round((Date.now() - t.capturedAt.getTime()) / 86400_000);
    return `${t.type} (${t.sourceCode}, il y a ${ageDays}j) score=${t.score} status=${t.status} : "${(t.title ?? "").slice(0, 80)}"`;
  });
  return `PRIOR SIGNALS sur ce SIRET (90j) :\n- ${lines.join("\n- ")}`;
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 5 helper (05/05/2026) — Cross-tenant signal
// ──────────────────────────────────────────────────────────────────────

/**
 * Sprint 5 — Signal cross-tenant : ce SIRET apparaît-il chez d'autres
 * clients iFIND ? Donne au judge un signal de "traction marché" (si plusieurs
 * clients pipelinent la même boîte = cible chaude transversale) ou de
 * "rejection consensus" (si tous les autres clients l'ont IGNORED = signal
 * négatif fort).
 *
 * Asset défensif : Apollo/Pharow/Cognism ne peuvent PAS faire ça car (a) pas
 * d'attribution SIRENE commune, (b) ICP rigides non comparables, (c)
 * structure DB non multi-tenant pivotable. Pour iFIND c'est natif (clientId
 * sur Lead + Trigger, query trivial).
 *
 * Cost : 1 query par qualify call (~30/run × 24/jour = 720 q/jour). Indexé
 * sur companySiret. Négligeable.
 *
 * Retourne null si SIRET absent/invalide ou si aucun autre client n'a vu
 * cette boîte (ne pollue pas le prompt avec "0 autre(s) client" inutile).
 */
async function getCrossTenantSignal(
  currentClientId: string,
  companySiret: string | null,
): Promise<string | null> {
  if (!companySiret) return null;
  // Pseudo-SIRET (FT* hash de rss-levees) ne sert pas pour cross-tenant.
  if (!/^\d{9,14}$/.test(companySiret)) return null;
  const others = await db.lead.findMany({
    where: {
      clientId: { not: currentClientId },
      companySiret,
      deletedAt: null,
    },
    select: { status: true, clientId: true },
  });
  if (others.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const l of others) {
    counts[l.status] = (counts[l.status] ?? 0) + 1;
  }
  const distinctClients = new Set(others.map((l) => l.clientId)).size;
  const breakdown = Object.entries(counts)
    .map(([s, n]) => `${s}=${n}`)
    .join(", ");
  return `Cross-tenant : vu chez ${distinctClients} autre(s) client(s) iFIND (${breakdown})`;
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 2 helpers (05/05/2026)
// ──────────────────────────────────────────────────────────────────────

/** Format compact € pour le bloc COMPANY HEALTH (B.3). Cible : 5-10 chars. */
function formatEuros(value: number | null | undefined): string {
  if (value == null) return "?";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M€`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K€`;
  return `${sign}${abs}€`;
}

/**
 * B.2 — Format LinkedIn profile pour le judge.
 *
 * Réutilise extractLinkedInProfile (linkedin-profile-extractor.ts) pour
 * parser le JSON HarvestAPI Profile Full puis le condense en bloc texte
 * ~250 chars maximum. Le judge a besoin de :
 *   - Headline (vrai poste tel qu'il s'autodéfinit)
 *   - Ancienneté (un CTO 6 mois ≠ un CTO 8 ans, signal très différent)
 *   - 3 derniers postes (vérifier cohérence persona, détecter ESN parcours)
 *   - Backgrounds (ESN/SaaS/Startup = signal de fit ICP fort)
 *
 * Retourne null si payload absent ou inutilisable (le bloc est alors omis,
 * pas pollué avec "non disponible" à chaque fois — économise tokens).
 */
function formatLinkedinProfileForJudge(payload: unknown): string | null {
  if (!payload) return null;
  const profile = extractLinkedInProfile(payload);
  if (!profile.headline && profile.experiences.length === 0) return null;

  const lines: string[] = [];
  if (profile.headline) {
    lines.push(`Headline : "${profile.headline.slice(0, 120)}"`);
  }
  if (profile.currentTenureMonths != null) {
    const years = (profile.currentTenureMonths / 12).toFixed(1);
    lines.push(`Ancienneté poste actuel : ${profile.currentTenureMonths}m (~${years}y)`);
  }
  if (profile.totalExperienceYears != null) {
    lines.push(`Expérience totale : ${profile.totalExperienceYears}y`);
  }
  const bg: string[] = [];
  if (profile.hasESNBackground) bg.push("ESN");
  if (profile.hasSaaSBackground) bg.push("SaaS");
  if (profile.hasStartupBackground) bg.push("Startup");
  if (bg.length > 0) lines.push(`Backgrounds : ${bg.join("/")}`);
  // 3 derniers postes pour vérifier cohérence + detection ESN parcours.
  const recent = profile.experiences.slice(0, 3).map((e) => {
    const dur = e.durationMonths != null ? `${Math.round(e.durationMonths / 12)}y` : "?";
    return `${e.title} @ ${e.companyName} (${dur})`;
  });
  if (recent.length > 0) {
    lines.push(`3 derniers postes : ${recent.join(" | ")}`);
  }
  return `LinkedIn Profile :\n- ${lines.join("\n- ")}`;
}

// Extrait la description complète depuis rawPayload (Apify/TheirStack/Rodz).
// Trigger.detail est tronqué à 600 chars en amont (apify-poller.ts:211/393/433),
// ce qui prive Opus des signaux durs : "200 collaborateurs", "3 jours en présentiel",
// "chez nos clients grands comptes", "7600 talents". On fallback sur detail si rien.
//
// Sprint 2 B.4 (05/05) : passé de 4000 → 8000 chars. TheirStack rawPayload
// peut atteindre 50 KB sur job-offer descriptions complètes. Opus 4.7 a 200K
// de contexte, on peut largement absorber +4K tokens si la description est
// dense (ex : "infrastructure 200p répartis Paris+Lyon+Bordeaux + 12 ESN
// partenaires actuels + équipe QA externalisée chez Capgemini en régie").
const FULL_DESC_MAX_CHARS = 8000;
const FULL_DESC_FIELDS = [
  "description",
  "descriptionText",
  "jobDescription",
  "summary",
  "fullDescription",
] as const;
function extractFullDescription(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  for (const f of FULL_DESC_FIELDS) {
    const v = p[f];
    if (typeof v === "string" && v.length > 100) {
      return v.slice(0, FULL_DESC_MAX_CHARS);
    }
  }
  return null;
}

// C4+C5 — Patterns rédhibitoires détectés dans le titre OU la description
// complète AVANT même le scoring Opus. Évite de cramer des tokens Opus sur
// des leads qu'on est sûr à 100% de rejeter (régie ESN, freelance/stage/
// alternance, présentiel obligatoire, mention oversize >250 collaborateurs).
//
// Si HIGH match → force score=2 + status=IGNORED, raison tracée. Skip Opus.
//
// Patterns issus de l'audit forensique 04/05 sur les 7 rejets Fred + 17
// patterns HIGH sur 39 leads (agent #3 audit total C). Ces 5 patterns
// auraient évité Byron, WeFiiT, Onepoint, INFORMATIS, ChapsVision, Vif,
// Deodis, Bizzdesign, L'Atelier, Hubvisory, Digistrat, Linkup Partner.
const PRE_OPUS_REJECT_PATTERNS: Array<{ pattern: RegExp; label: string; field: "title" | "description" | "both" }> = [
  // C4 — Régie ESN FR + EN : "chez nos clients", "at our client", etc.
  { pattern: /chez\s+(un\s+de\s+)?nos?\s+clients?|client\s+final|\ben\s+régie\b|sur\s+(le\s+)?site\s+du\s+client|consultant\s+en\s+régie|équipe.*chez\s+notre\s+client|mission\s+chez\s+(un\s+de\s+)?nos?\s+clients?|en\s+immersion\s+chez\s+nos?\s+(clients?|partenaires?)|dans\s+le\s+cadre\s+d['']un\s+projet\s+(chez|d['']envergure\s+chez|client)/i, label: "regie-esn", field: "description" },
  // M9 (04/05) — versions EN du pattern régie ESN
  { pattern: /\bat\s+(our|one\s+of\s+our)\s+clients?\b|\bclient\s+site\b|\bon\s+behalf\s+of\s+(our|the)\s+client\b|\bembed(ded)?\s+(at|with)\s+(our|the)\s+client\b|\bdelegate(d)?\s+to\s+client\b|\bbody\s+shopping\b/i, label: "regie-esn-en", field: "description" },
  // C5a — Freelance / portage / mission courte dans le titre (FR + EN)
  { pattern: /\b(freelance|indépendant|en\s+portage|portage\s+salarial|mission\s+courte|consultant\s+indépendant|contractor|independant\s+contractor|self[- ]employed)\b/i, label: "freelance-indep", field: "title" },
  // C5b — Alternance / Stage / Apprenti dans le titre (FR + EN)
  { pattern: /\b(alternance|alternant|alternant\(e\)|apprenti|apprentissage|stage|stagiaire|stagiair\(e\)|intern|internship|trainee|apprentice)\b/i, label: "junior-contract", field: "title" },
  // C5c — Présentiel obligatoire (FR + EN)
  { pattern: /présentiel\s+obligatoire|5\s*jours?\s+(sur\s+site|de\s+présentiel|au\s+bureau|en\s+présentiel)|100\s*%\s+(présentiel|sur\s+site|on.?site)|aucun\s+télétravail|pas\s+de\s+(full\s+)?remote|obligatoire\s+au\s+bureau|sur\s+place\s+chez\s+(un\s+de\s+)?nos?\s+clients?/i, label: "onsite-only", field: "description" },
  // M9 (04/05) — versions EN du pattern présentiel
  { pattern: /\b5\s*days?\s+(on[- ]?site|in\s+(the\s+)?office|at\s+(the\s+)?office|per\s+week\s+on[- ]?site)\b|\bon[- ]?site\s+(only|mandatory|required|obligatory|5\s*days)\b|\bno\s+(remote|telework|work[- ]?from[- ]?home|wfh)\b|\bfull[- ]?time\s+on[- ]?site\b|\bin[- ]?office\s+(only|mandatory|required)\b/i, label: "onsite-only-en", field: "description" },
  // C5d — Mention oversize FR + EN
  { pattern: /(?:[2-9]\d{2,}|\d{4,})\s*(collaborateurs?|talents?|salariés?|consultants?|employees?|employés?|people|staff\s+members?|professionals)\b/i, label: "oversized-text", field: "description" },
];

function preOpusRejectScan(
  title: string,
  description: string,
): { reject: boolean; label: string | null } {
  for (const { pattern, label, field } of PRE_OPUS_REJECT_PATTERNS) {
    if (field === "title" || field === "both") {
      if (pattern.test(title)) return { reject: true, label };
    }
    if (field === "description" || field === "both") {
      if (pattern.test(description)) return { reject: true, label };
    }
  }
  return { reject: false, label: null };
}

// Fix L — Détection des "aveux d'hedging" dans la reason d'Opus.
// Quand Opus donne un score >=7 mais avoue dans sa reason un mismatch ICP
// ("hors ICP", "non whitelist", "grand groupe", "atypique"…), on downgrade.
// Override le plancher trusted-sources : une levée Rodz scorée 8 sur
// "Audion AdTech hors ICP édition logiciels" doit retomber à 4.
//
// Sévérité variable selon présence d'un marqueur ICP positif fort :
// - Hedging seul → hard downgrade vers 4 (Audion, cobl, HrFlow)
// - Hedging + marqueur positif ("ICP fit", "parfait match", "signal QA fort")
//   → soft downgrade -2 min 5 (Kestra "ICP-fit software Paris mais NAF atypique"
//   reste à 6, ne tombe pas en rejet — Kestra est notre seul WON 30j).
const HEDGING_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /hors\s+ICP/i, label: "hors-icp" },
  { pattern: /non\s+whitelist/i, label: "non-whitelist" },
  { pattern: /NAF\s+(?:non\s+)?(?:whitelist|atypique)/i, label: "naf-atypique" },
  { pattern: /\bdata\s+(?:incomplete|incomplet|manquante)/i, label: "data-incomplete" },
  { pattern: /\bà\s+(?:valider|confirmer)\s+manuellement/i, label: "a-valider-manuel" },
  { pattern: /\bgrand\s+groupe\b/i, label: "grand-groupe" },
  { pattern: />\s?(?:200|250|300|500|1000|2000|5000|10000)\s?p\b/i, label: "oversized" },
  { pattern: /(?:[2-9]|[1-9]\d)\s?\d{3}\s+(?:collaborateurs|talents|salariés|consultants|employees|employés)/i, label: "oversized-text" },
  { pattern: /signal\s+faible/i, label: "signal-faible" },
  { pattern: /hire\s+(?:généraliste|junior)\s+non\s+QA/i, label: "hire-non-qa" },
  { pattern: /industrie\s+non\s+résolu/i, label: "industrie-non-resolue" },
];
const POSITIVE_ICP_MARKERS: RegExp[] = [
  /\bICP[-\s]+(?:fit|parfait|match)/i,
  /parfait\s+match\s+ICP/i,
  /match\s+(?:parfait\s+)?ICP/i,
  /signal\s+QA\s+fort/i,
  /ICP\s+fit\s+software/i,
];
const HEDGING_HARD_FLOOR = 4;
const HEDGING_SOFT_DELTA = 2;
const HEDGING_SOFT_MIN = 5;
function detectOpusHedging(
  score: number,
  reason: string,
): { score: number; reason: string; matchedLabel: string | null; softened: boolean } {
  if (score < 7) return { score, reason, matchedLabel: null, softened: false };
  const hasPositiveMarker = POSITIVE_ICP_MARKERS.some((p) => p.test(reason));
  for (const { pattern, label } of HEDGING_PATTERNS) {
    if (pattern.test(reason)) {
      const newScore = hasPositiveMarker
        ? Math.max(score - HEDGING_SOFT_DELTA, HEDGING_SOFT_MIN)
        : Math.min(score, HEDGING_HARD_FLOOR);
      return {
        score: newScore,
        reason: `[Fix L hedging:${label}${hasPositiveMarker ? "/soft" : ""}] ${reason}`,
        matchedLabel: label,
        softened: hasPositiveMarker,
      };
    }
  }
  return { score, reason, matchedLabel: null, softened: false };
}

// Fix H1 (04/05) — Refonte SYSTEM prompt utilisant buildCachedSystem.
// Avant : SYSTEM local ~950 tokens dupliquait STABLE_PREAMBLE (Contexte/Moat/
// Boosters) → en dessous du seuil 1024 tk Anthropic → cache_control: ephemeral
// silencieusement IGNORÉ → ~$13/mois gaspillé sur ~30 calls/jour.
// Maintenant : QUALIFY_SPECIFIC contient UNIQUEMENT la spec qualify (mission,
// rubrique, pénalités, échelle, FEW-SHOTS, format). buildCachedSystem() ajoute
// le STABLE_PREAMBLE (~510 tk) → total ~1100 tk → cache OK.
//
// Few-shots ajoutés résolvent aussi la variance constatée Onepoint=4 vs
// ALTEN=2 (même profil ESN géante hors ICP, scorés différemment) en
// fournissant à Opus des ancres concrètes.
const QUALIFY_SPECIFIC = `

## Mission de qualification
Tu reçois un Trigger fraîchement capté + l'ICP du client. Retourne un score 1-10 strict + une raison courte (max 200 chars, citer 1 élément concret).

## Rubrique scoring (4 axes, poids égaux)
1. **ICP fit** — industrie / NAF whitelist / taille / région matchent ? **Si COMPANY HEALTH contient une procédure collective EN COURS → score ≤ 2 systématique (boîte non-prospectable). CA + résultat net présents : pondère selon viabilité financière. Multi-établissements ou dépôts RCS récents = signal d'expansion / mouvement à exploiter.**
2. **Signal strength** — vrai déclencheur d'achat (levée fraîche, hire clé QA/Test senior, M&A, C-level change) vs bruit (job junior, alternance, mentorat, RH) ?
3. **Persona match** — décisionnaire (CTO, CEO, Founder, Head of Eng, VP Eng) vs périphérique (RH, junior, stagiaire) ? **Si le bloc PERSONA QUAL contient un fitScore et un personaTier (calcul interne), utilise-les comme signal fort : fitScore≥70 ou personaTier=1 → décideur quasi-certain ; fitScore<40 ou personaTier≥3 → décideur faible (pénalise la dimension persona dans ton scoring). Si LinkedIn Profile présent : ancienneté <6 mois sur poste C-level = mandat frais, signal d'achat ; backgrounds ESN dans les 3 derniers postes = parcours conseil, pertinence ICP fonction du contexte ; 0 expérience SaaS sur poste tech d'éditeur SaaS = mismatch fort.**
4. **Freshness** — <7j = boost, >30j = malus, >90j = exclure.

## Fiabilité des sources (calibration)
- \`apify.wttj-jobs\` : board d'éditeurs SaaS FR — très haute fiabilité
- \`apify.linkedin-jobs\` : moyenne, vérifier ICP / pays
- \`apify.indeed-jobs\` : généraliste (souvent désactivé) — beaucoup de bruit
- \`rodz.fundraising\` / \`rodz.job-changes\` / \`rodz.mergers-acquisitions\` : signaux durs vérifiés
- \`bodacc.*\` / \`joafe.*\` / \`inpi.*\` : sources officielles, attribution SIREN garantie
- \`theirstack.buying-intent\` : déclaratif (utilise outils QA), vérifier industrie
- \`francetravail.tech\` : Pôle Emploi OAuth — souvent ESN qui sourcent pour client final

## Negative signals (si présent dans le prompt — PRIORITÉ ABSOLUE)
Le bloc "NEGATIVE SIGNALS détectés (Pappers RCS <90j)" liste les dépôts d'actes négatifs récents qui indiquent une boîte en contraction ou en difficulté. **Ces signaux ÉCRASENT TOUS les autres axes positifs** (même un combo SCALE-UP-TECH à 10 doit retomber si la boîte est en liquidation). Échelle de pénalité :
- Sévérité **hard** (Liquidation, Dissolution, Cessation, Fermeture, Cession totale, Procédure collective) → score ≤ 2 (souvent = 1, boîte non-prospectable)
- Sévérité **medium** (Plan social / PSE, Réduction de capital, licenciement collectif) → score ≤ 3 (boîte coupe les coûts, pas de budget outsourcing testing)
- Sévérité **soft** (Restructuration, Réorganisation) → score ≤ 5, signaler dans la reason mais permettre si fundamentaux ICP très forts par ailleurs
La reason DOIT mentionner explicitement le signal négatif détecté pour traçabilité commerciale.

## Prior signals sur cette boîte (si présent dans le prompt)
Le bloc "PRIOR SIGNALS sur ce SIRET" liste les autres Triggers du MÊME client sur la même boîte dans les 90 derniers jours. Interprétation :
- **Combo convergent** (FUNDRAISING + HIRING_KEY <14j, ou LEADERSHIP_CHANGE + HIRING_KEY <30j) = signal d'achat très fort, +1 à +2 points
- **Combo lent** (M&A + EXPANSION 30-60j) = consolidation post-deal, +1 point
- **Signaux contradictoires** (FUNDRAISING + layoffs implicites dans titre) = à signaler dans la reason
- **Plusieurs prior IGNORED** = la boîte a déjà été disqualifiée → confirmer la disqualification (ne PAS inventer un nouveau signal positif sans preuve)
N'invente JAMAIS un prior signal si le bloc n'est pas dans le prompt.

## Signal cross-tenant (si présent dans le prompt)
Le bloc "Cross-tenant : vu chez X autre(s) client(s) iFIND" indique que cette boîte est aussi pipelinée par d'autres clients du moteur iFIND. Interprétation :
- **Plusieurs clients NEW/CONTACTED/REPLIED** → signal de traction marché (cible chaude transversale, +1 point au scoring final possible)
- **Tous les autres clients ont status=IGNORED** → signal de rejection consensus (cette boîte a échoué partout, -1 à -2 points possible)
- **Mix** → information neutre, ne modifie pas le score
N'invente JAMAIS un signal cross-tenant si le bloc n'est pas dans le prompt.

## Règles de pénalité automatique
- Hors France (country_code != FR, suffixes GmbH/AG/SE/BV/NV/Ltd/PLC/Inc/LLC/SpA/Srl/SL/SA dans le nom) → score ≤ 2
- Holding / SCI / cabinet comptable / mairie / agglo / université → score ≤ 3
- ICP antiPersonas matché (concurrent direct, ex: Capgemini, Sopra, Onepoint, Alten, Amaris) → score ≤ 2
- Effectif > 5× max ICP (ex: ICP 200p, lead >1000p) → score ≤ 2 systématique
- Effectif 1.5×-5× max ICP → score ≤ 4
- Régie ESN détectée ("chez nos clients", "client final", "en régie") → score ≤ 3
- Freelance / alternance / stage dans le titre → score ≤ 3
- NAF connu mais hors whitelist client → score ≤ 5
- Données critiques manquantes (NAF + taille tous deux non résolus) → score ≤ 5

## Échelle finale
- 9-10 : signal HOT, à attaquer dans les 24h (levée fraîche / hire QA Senior frais + ICP parfait + persona accessible)
- 7-8 : qualifié, queue commerciale (ICP fit fort, 1 doute mineur OK)
- 5-6 : à valider manuellement, doute sur ICP fit
- 3-4 : marginal, hors-ICP léger / signal faible / taille trop grande
- 1-2 : exclure (hors France, hors taille majeur, anti-persona)

## Few-shots (calibration)
- Éditeur SaaS FR 50p NAF 5829C, hire QA Engineer <7j, CTO accessible → 9
- ESN FR 80p NAF 6202A, hire QA Lead Paris <14j, taille à confirmer → 8
- Cabinet conseil 70.22Z FR 80p, hire QA Manager <30j → 6 (NAF border)
- Boîte FR taille inconnue NAF non résolu, hire QA générique → 4
- ESN 3000p hire QA pour client final assurance (régie) → 3
- Capgemini/Sopra/Atos/Onepoint/Alten/Amaris hire QA → 1 (anti-persona concurrent)
- Boîte allemande GmbH hire QA Berlin → 1 (hors-FR)
- Holding SCI / mairie / SAS de capitaux → 2 (hors ICP structurel)
- ALTEN 39000p toutes filiales — score 1, pas 4 (oversize 195× ICP)

## Format de réponse OBLIGATOIRE
Réponds UNIQUEMENT en JSON valide, sans markdown, sans préfixe :
{"score": <int 1-10>, "reason": "<1-2 phrases ≤200 chars citant 1 élément concret du trigger>"}

## Règles non négociables
- Ne JAMAIS recommander d'action LinkedIn auto (engagement = manuel humain).
- Réponses TOUJOURS en français sauf indication contraire.
- Si le signal manque d'informations critiques (NAF non résolu, taille inconnue), score ≤ 5 par prudence avec mention "data incomplete" dans reason.`;

export async function qualifyTrigger(
  triggerId: string,
  opts: { force?: boolean } = {},
): Promise<QualifyResult | null> {
  const trigger = await db.trigger.findUnique({
    where: { id: triggerId },
    include: {
      client: { select: { name: true, icp: true } },
      // Sprint 1 Q1 (05/05/2026) — Lead persona qual transmise au judge.
      // Avant : le judge devait deviner la qualité du décideur depuis le seul
      // titre du signal (ex: "Recrute QA Lead" → CTO ? RH ? Directeur ?).
      // Maintenant : on lui passe fitScore (0-100, calculé par persona-fit-runner :
      // base tier + tenureBoost + backgroundFit + sizeFit) + personaTier (1-4,
      // 1=parfait CTO/Head of QA, 4=fallback). Audit Phase 1 du 05/05 a montré
      // que ces 2 champs sont remplis pour 81-84% des leads DTL mais jamais lus
      // par le judge → ~+15% précision attendu sur la dimension "Persona match".
      lead: {
        select: {
          // Sprint 1 Q1
          fitScore: true,
          personaTier: true,
          fullName: true,
          jobTitle: true,
          // Sprint 2 B.1 (05/05) — linkedinUrl ajouté pour confirmer le persona
          // (un CTO sans linkedin = soit erreur de matching, soit profil discret).
          linkedinUrl: true,
          // Sprint 2 B.2 (05/05) — linkedinProfileJson HarvestAPI Profile Full :
          // headline, summary, expériences, ancienneté, posts. 25/146 leads DTL
          // l'ont rempli mais le judge ne l'a jamais lu. Parsé via
          // linkedin-profile-extractor.ts existant (réutilisé persona-fit-runner).
          linkedinProfileJson: true,
          // Sprint 2 B.3 (05/05) — Pappers riche : santé entreprise.
          // companyHasInsolvency redondant avec gate Q2 mais utile en defense
          // (Lead pré-existant peut avoir flag set sans avoir été archivé).
          companyHasInsolvency: true,
          companyRecentDepots: true,
          companyEtabsCount: true,
          companyRevenue: true,
          companyResultNet: true,
        },
      },
    },
  });
  if (!trigger) return null;
  if (trigger.scoreReason && !opts.force) {
    return { opusScore: trigger.score, reason: trigger.scoreReason, isHot: trigger.isHot };
  }
  if (!trigger.client?.icp) return null;

  const icp = trigger.client.icp as Record<string, unknown>;
  const fullDesc = extractFullDescription(trigger.rawPayload);
  const detailToSend = fullDesc ?? trigger.detail ?? "(vide)";

  // C4+C5 — Pre-Opus reject scan : si pattern HIGH match (régie ESN, freelance,
  // alternance/stage, présentiel obligatoire, oversize >250p), on skip Opus
  // et on archive direct. Économise tokens + évite faux Brûlants en haut du dash.
  const preReject = preOpusRejectScan(trigger.title ?? "", fullDesc ?? trigger.detail ?? "");
  if (preReject.reject) {
    const rejectReason = `[C4-C5 pre-opus-reject:${preReject.label}] Pattern rédhibitoire détecté avant scoring Opus`;
    console.log(`[qualify-trigger.C4C5] ${triggerId}: IGNORED auto (${preReject.label})`);
    await db.trigger.update({
      where: { id: triggerId },
      data: {
        score: 2,
        scoreReason: rejectReason,
        isHot: false,
        status: "IGNORED",
      },
    });
    return { opusScore: 2, reason: rejectReason, isHot: false };
  }
  // Sprint 1 Q1 + Sprint 2 B.1/B.2/B.3 (05/05/2026) — Bloc PERSONA + COMPANY HEALTH.
  // Transmis seulement si le Lead existe en DB (qualify peut être appelé avant
  // auto-create-lead.ts pour certains pollers). Quand absent, on signale
  // "non résolue" pour éviter qu'Opus suppose.
  let personaBlock: string;
  if (trigger.lead) {
    const lead = trigger.lead;
    // B.2 — Extrait headline + 3 derniers postes + ancienneté du
    // linkedinProfileJson HarvestAPI. Fallback silencieux si non rempli.
    const linkedinSummary = formatLinkedinProfileForJudge(lead.linkedinProfileJson);
    // B.3 — Pappers riche bloc COMPANY HEALTH. Affiché seulement si au moins
    // un signal financier ou de santé est présent (sinon on sature le prompt
    // pour rien).
    const healthSignals: string[] = [];
    if (lead.companyHasInsolvency === true) {
      healthSignals.push("⚠️ procédure collective EN COURS (RJ/LJ)");
    }
    if (lead.companyRevenue != null) {
      healthSignals.push(`CA dernier exercice : ${formatEuros(lead.companyRevenue)}`);
    }
    if (lead.companyResultNet != null) {
      healthSignals.push(`Résultat net : ${formatEuros(lead.companyResultNet)}`);
    }
    if (lead.companyEtabsCount != null && lead.companyEtabsCount > 1) {
      healthSignals.push(`${lead.companyEtabsCount} établissements (multi-sites)`);
    }
    if (Array.isArray(lead.companyRecentDepots) && lead.companyRecentDepots.length > 0) {
      healthSignals.push(`${lead.companyRecentDepots.length} dépôts RCS <90j (signal mouvement)`);
    }
    const healthBlock = healthSignals.length > 0
      ? `\nCOMPANY HEALTH (Pappers) :\n- ${healthSignals.join("\n- ")}`
      : "";

    personaBlock = `\nPERSONA QUAL (calcul interne) :
- fitScore : ${lead.fitScore ?? "non calculé"} / 100
- personaTier : ${lead.personaTier ?? "non calculé"} / 4 (1=parfait, 4=fallback)
- Décideur identifié : ${lead.fullName ?? "non résolu"} (${lead.jobTitle ?? "?"})
- LinkedIn : ${lead.linkedinUrl ?? "non résolu"}${linkedinSummary ? `\n${linkedinSummary}` : ""}${healthBlock}`;
  } else {
    personaBlock = `\nPERSONA QUAL : non encore calculée (Lead pas créé)`;
  }

  // Sprint 5 (05/05) — Cross-tenant signal (si dispo). Bloc omis si SIRET
  // absent/pseudo OU si aucun autre client iFIND n'a cette boîte. Évite
  // de polluer le prompt avec "0 autre client" inutile.
  const crossTenantSignal = await getCrossTenantSignal(
    trigger.clientId,
    trigger.companySiret,
  );
  const crossTenantBlock = crossTenantSignal ? `\n${crossTenantSignal}` : "";

  // Sprint 6 (05/05) — Prior signals (mêmes clientId+SIRET, 90j, autres triggers).
  // Permet au judge de voir le combo : "hire QA arrive 12j après levée 5M€"
  // = score plus élevé que "hire QA solo".
  const priorSignals = await getPriorSignalsForCompany(
    trigger.clientId,
    trigger.companySiret,
    triggerId,
  );
  const priorSignalsBlock = priorSignals ? `\n${priorSignals}` : "";

  // Sprint 9 (05/05) — Negative signals (Pappers RCS dépôts <90j).
  // Détecte dissolution/liquidation/cessation/PSE/réduction capital depuis
  // companyRecentDepots déjà chargé via Lead.include. Si présent, le judge
  // doit scorer ≤ 3-5 selon sévérité (override les positifs comme un combo
  // SCALE-UP-TECH). Le moat : Apollo/Pharow ne détectent QUE le positif.
  const negativeSignals = trigger.lead
    ? getNegativeSignalsForCompany(trigger.lead.companyRecentDepots)
    : null;
  const negativeSignalsBlock = negativeSignals ? `\n${negativeSignals.block}` : "";

  const userPrompt = `CLIENT : ${trigger.client.name}
ICP : ${JSON.stringify({
    industries: icp.industries,
    sizes: icp.sizes,
    naf_codes: icp.naf_codes, // C13 — NAF whitelist envoyée à Opus
    personaTitles: icp.personaTitles,
    keywordsHiring: icp.keywordsHiring,
    antiPersonas: icp.antiPersonas,
    preferredSignals: icp.preferredSignals, // C13 — pondération signaux DTL
    minScore: icp.minScore, // C13 — seuil de qualification
  })}

LEAD :
- Entreprise : ${trigger.companyName}
- SIRET/SIREN : ${trigger.companySiret ?? "non résolu"}
- NAF : ${trigger.companyNaf ?? "?"}
- Industrie : ${trigger.industry ?? "?"}
- Région : ${trigger.region ?? "?"}
- Taille : ${trigger.size ?? "?"}
${personaBlock}${crossTenantBlock}${priorSignalsBlock}${negativeSignalsBlock}

SIGNAL :
- Type : ${trigger.type}
- Source : ${trigger.sourceCode}
- Titre : ${trigger.title}
- Détail : ${detailToSend}
- Capté : ${trigger.capturedAt.toISOString()}
- Publié : ${trigger.publishedAt?.toISOString() ?? "?"}

Évalue ce lead pour ${trigger.client.name}.`;

  let opusScore = 5;
  let reason = "Évaluation par défaut (Opus indisponible)";

  try {
    const anthropic = getAnthropic();
    const resp = await anthropic.messages.create({
      model: QUALIFY_MODEL,
      max_tokens: 200,
      // Bonus D (05/05) — Multi-bloc cache : bloc stable cached + bloc
      // dynamic fresh (si few-shots dynamiques disponibles dans Client.icp).
      // Kill switch via icp.dynamicFewShotsEnabled = false → fallback static.
      system: buildCachedSystem(
        QUALIFY_SPECIFIC,
        readDynamicFewShotsFromIcp(icp) ?? undefined,
      ),
      messages: [{ role: "user", content: userPrompt }],
    });
    // Instrumentation cache (audit 03/05) : log structuré JSON pour mesurer
    // hit rate effectif sur 24-48h et calibrer estimation coût qualify.
    // Format compact pour parsing journalctl ultérieur.
    const u = resp.usage as {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    console.log(
      `[qualify-trigger.usage] ${JSON.stringify({
        triggerId,
        model: QUALIFY_MODEL,
        in: u.input_tokens ?? 0,
        out: u.output_tokens ?? 0,
        cache_create: u.cache_creation_input_tokens ?? 0,
        cache_read: u.cache_read_input_tokens ?? 0,
      })}`,
    );
    const text = resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("");
    const match = text.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as { score?: number; reason?: string };
      if (typeof parsed.score === "number") {
        opusScore = Math.round(Math.min(10, Math.max(1, parsed.score)));
      }
      if (typeof parsed.reason === "string") reason = parsed.reason.slice(0, 200);
    }
  } catch (e) {
    console.warn(`[qualify-trigger] Opus error for ${triggerId}:`, e instanceof Error ? e.message : e);
    return null;
  }

  // Fix M2 (04/05) — Ordre Fix L AVANT plancher trusted-source.
  // Avant : Opus → plancher (avec C2 condition secteur) → Fix L hedging.
  // Le plancher pouvait écraser un score Opus 4 vers 8 (NAF match), puis
  // Fix L redescendait à 4 si reason contenait "hors ICP". Si Opus n'écrivait
  // pas "hors ICP" mais juste "data incomplete" sans justification ICP, le
  // score restait à 8 indûment. Redondance fragile.
  // Maintenant : Fix L PUIS plancher. Si Opus a hedgé → on garde son verdict
  // (le plancher ne s'applique pas à un trigger downgradé). Plus propre.

  // Fix L — Détection hedging Opus (override final si "hors ICP" / "atypique" etc.)
  const hedged = detectOpusHedging(opusScore, reason);
  if (hedged.matchedLabel) {
    console.log(
      `[qualify-trigger.fix-L] ${triggerId}: ${opusScore} → ${hedged.score} (hedging:${hedged.matchedLabel}${hedged.softened ? "/soft" : ""})`,
    );
    opusScore = hedged.score;
    reason = hedged.reason;
  }

  // Sprint 9 hard cap — Si signal négatif "hard" (liquidation/dissolution/
  // cessation/RJ/LJ/cession totale) détecté, on cap à 2 même si Opus a
  // relevé. Filet de sécurité absolu : un client iFIND ne doit JAMAIS
  // recevoir en NEW une boîte qui est en train de fermer. Override
  // s'applique aussi sur le plancher trusted-source (un Rodz funding sur
  // une boîte en LJ doit retomber à 2, pas rester à 8).
  if (negativeSignals?.hasHardSignal && opusScore > 2) {
    console.log(
      `[qualify-trigger.sprint9-hard-cap] ${triggerId}: ${opusScore} → 2 (hard negative signal détecté)`,
    );
    opusScore = 2;
    reason = `[Sprint9 hard-negative-cap] ${reason}`.slice(0, 500);
  }

  // Bonus C (05/05) — Google CSE layoffs/PSE news soft cap (post-Opus).
  // Gate score>=8 ET pas déjà hard-capped Sprint 9 (sinon redondant).
  // Détecte les annonces presse de PSE/restructuration/layoffs <3 mois sur
  // 9 sources FR whitelist (lesechos, maddyness, bfm, légifrance, etc).
  // Soft cap à 5 si ≥2 sources distinctes hits → la boîte est probablement
  // en contraction (presse plus rapide que BODACC RCS dépôts).
  if (opusScore >= 8 && !negativeSignals?.hasHardSignal) {
    try {
      const layoffsCheck = await searchLayoffsNews(trigger.companyName);
      if (layoffsCheck.found) {
        const topSources = layoffsCheck.topHits
          .map((h) => h.source)
          .slice(0, 2)
          .join("/");
        console.log(
          `[qualify-trigger.bonus-C] ${triggerId}: ${opusScore} → 5 (layoffs news ${layoffsCheck.distinctSources} sources)`,
        );
        reason = `[Bonus C layoffs-news-cap ${topSources}] ${reason}`.slice(0, 500);
        opusScore = 5;
      }
    } catch (e) {
      console.warn(
        `[qualify-trigger.bonus-C] ${triggerId} err:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // Plancher de score pour sources fiables (signal d'achat fort garanti).
  // CONDITION 04/05 (C2) : s'applique UNIQUEMENT si secteur ICP-fit.
  // M2 (04/05) : appliqué APRÈS Fix L pour ne pas écraser un downgrade hedging.
  const TRUSTED_SOURCES_MIN_SCORE: Record<string, number> = {
    "rodz.fundraising": 8,                    // levée = jackpot
    "rodz.mergers-acquisitions": 8,           // M&A = restructuring
    "rodz.job-changes": 8,                    // C-level change = budget freed
    "bodacc.capital-increase": 8,             // augmentation capital = pré-levée
    "trigger-engine.funding-recent": 8,       // levée détectée RSS presse spé
  };
  const minFloor = TRUSTED_SOURCES_MIN_SCORE[trigger.sourceCode];
  // M2 : si Fix L a déjà downgrade (hedged.matchedLabel) → ne PAS appliquer le
  // plancher. Le hedging est une preuve qu'Opus a vu un mismatch ICP, on respecte.
  // Sprint 9 (05/05) — Le plancher trusted-source ne doit PAS s'appliquer
  // si on a un signal négatif hard (liquidation/dissolution etc.). Une
  // levée Rodz sur une boîte en cessation = peut-être levée fictive ou
  // contexte de liquidation, à NE PAS booster.
  if (minFloor && opusScore < minFloor && !hedged.matchedLabel && !negativeSignals?.hasHardSignal) {
    const icpNafCodes = (icp.naf_codes as string[] | undefined) ?? [];
    const naf = (trigger.companyNaf ?? "").replace(/\./g, "");
    const nafMatchIcp = icpNafCodes.some((c) => naf.startsWith(c.replace(/\./g, "")));
    const icpIndustries = (icp.industries as string[] | undefined) ?? [];
    const industryStr = (trigger.industry ?? "").toLowerCase();
    const industryMatchIcp = icpIndustries.some((i) =>
      industryStr.includes(i.toLowerCase().split(/\s/)[0] ?? ""),
    );
    if (nafMatchIcp || industryMatchIcp) {
      reason = `[Score plancher ${minFloor}/10 source fiable + secteur ICP] ${reason}`;
      opusScore = minFloor;
    } else {
      console.log(
        `[qualify-trigger.C2] ${triggerId}: plancher ${minFloor} NON appliqué (secteur hors ICP) sourceCode=${trigger.sourceCode} naf=${trigger.companyNaf} industry=${trigger.industry}`,
      );
    }
  }

  const isHot = opusScore >= 9;

  // C3 — Filtre minScore client : si score final < icp.minScore, le trigger
  // ne sera jamais actionnable. Au lieu de le laisser pollute le pool dashboard
  // (audit 04/05 : 49 triggers score<5 visibles malgré minScore=7), on le
  // passe en IGNORED auto avec raison traceable. Le seuil minScore vient de
  // Client.icp.minScore (7 pour DTL). Sans minScore défini → pas de filtre.
  const icpMinScore = typeof icp.minScore === "number" ? icp.minScore : null;
  const belowMinScore = icpMinScore !== null && opusScore < icpMinScore;
  await db.trigger.update({
    where: { id: triggerId },
    data: {
      score: opusScore,
      scoreReason: belowMinScore
        ? `[C3 below_min_score:${opusScore}<${icpMinScore}] ${reason}`
        : reason,
      isHot,
      ...(belowMinScore ? { status: "IGNORED" as const } : {}),
    },
  });
  if (belowMinScore) {
    console.log(
      `[qualify-trigger.C3] ${triggerId}: IGNORED auto (score=${opusScore} < minScore=${icpMinScore})`,
    );
  }

  return { opusScore, reason, isHot };
}

/**
 * Qualifie tous les Triggers d'un client qui n'ont pas encore été évalués
 * par Opus (scoreReason = null). Limite par batch pour budget tokens.
 */
export async function qualifyPendingTriggers(
  clientId: string,
  opts: { limit?: number } = {},
): Promise<{ qualified: number; errors: number }> {
  const limit = opts.limit ?? 30;
  const pending = await db.trigger.findMany({
    where: {
      clientId,
      scoreReason: null,
      deletedAt: null,
    },
    select: { id: true },
    take: limit,
    orderBy: { capturedAt: "desc" },
  });
  let qualified = 0;
  let errors = 0;
  for (const t of pending) {
    try {
      const r = await qualifyTrigger(t.id);
      if (r) qualified += 1;
    } catch {
      errors += 1;
    }
  }
  return { qualified, errors };
}
