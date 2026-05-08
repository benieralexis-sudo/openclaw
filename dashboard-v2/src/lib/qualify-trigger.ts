import "server-only";
import { getAnthropic, QUALIFY_MODEL } from "@/lib/anthropic";
import { buildCachedSystem } from "@/lib/anthropic-prompt";
import { db } from "@/lib/db";
import { extractLinkedInProfile } from "@/lib/linkedin-profile-extractor";
import { readDynamicFewShotsFromIcp } from "@/lib/dynamic-few-shots";
import { searchLayoffsNews } from "@/lib/layoffs-news-search";
import { buildLeadDossierForJudge, formatDossierForOpus } from "@/lib/lead-dossier";
import {
  parseLeadBriefV2WithError,
  type LeadBriefV2,
} from "@/lib/lead-brief-v2";
import {
  validateLeadBriefV2Strict,
  type ValidationResult,
} from "@/lib/lead-brief-v2-validator";

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

export interface NegativeSignalResult {
  block: string;
  hasHardSignal: boolean;
}

export function getNegativeSignalsForCompany(
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
 * Sprint 6 + Sprint C.3 (06/05/2026) — Donne au judge le contexte des AUTRES
 * Triggers du même client sur le même SIRET dans les 90 derniers jours +
 * détecte les patterns combo d'urgence (scale-up sprint, post-funding scaling).
 *
 * Sprint C.3 enhancements :
 *   - take 5 → 20 (taille format compact, budget tokens absorbé)
 *   - détection patterns combo : 3+ hires QA/Test <7j = sprint hiring,
 *     levée + hire <14j = post-funding scaling, M&A + LEADERSHIP_CHANGE
 *     <30j = consolidation post-deal
 *   - groupage par type pour montrer convergence
 *
 * Cost : 1 query DB par qualify call (indexée companySiret + clientId).
 */
interface ComboPattern {
  label: string;
  reason: string;
  triggerCount: number;
}

function detectComboPatterns(
  current: { type: string; capturedAt: Date; sourceCode: string; title?: string | null },
  priors: Array<{ type: string; capturedAt: Date; sourceCode: string; title: string | null }>,
): ComboPattern[] {
  const patterns: ComboPattern[] = [];
  const allEvents = [current, ...priors];
  const now = Date.now();

  // Pattern 1 — Sprint hiring : 3+ HIRING_KEY events <7j
  const hiringRecent = allEvents.filter(
    (e) => e.type === "HIRING_KEY" && (now - e.capturedAt.getTime()) / 86400_000 <= 7,
  );
  if (hiringRecent.length >= 3) {
    patterns.push({
      label: "sprint-hiring",
      reason: `${hiringRecent.length} hires détectés <7j sur ce SIRET = scale-up sprint, urgence externalisation testing forte`,
      triggerCount: hiringRecent.length,
    });
  }

  // Pattern 2 — Post-funding scaling : FUNDRAISING + HIRING_KEY <14j
  const funding = allEvents.find((e) => e.type === "FUNDRAISING");
  if (funding) {
    const fundingAge = (now - funding.capturedAt.getTime()) / 86400_000;
    const recentHires = allEvents.filter(
      (e) =>
        e.type === "HIRING_KEY" &&
        Math.abs((funding.capturedAt.getTime() - e.capturedAt.getTime()) / 86400_000) <= 14,
    );
    if (recentHires.length >= 1 && fundingAge <= 90) {
      patterns.push({
        label: "post-funding-scaling",
        reason: `Levée détectée il y a ${Math.round(fundingAge)}j + ${recentHires.length} hire(s) dans la fenêtre ±14j = scaling post-deal classique, signal d'achat très fort`,
        triggerCount: recentHires.length + 1,
      });
    }
  }

  // Pattern 3 — Consolidation post-deal : M&A + LEADERSHIP_CHANGE <30j (M&A est dans type FUNDRAISING ou OTHER selon source)
  const leadership = allEvents.find((e) => e.type === "LEADERSHIP_CHANGE");
  const ma = allEvents.find(
    (e) => e.sourceCode.includes("mergers-acquisitions") || e.sourceCode.includes("m-a"),
  );
  if (leadership && ma) {
    const gap = Math.abs(
      (leadership.capturedAt.getTime() - ma.capturedAt.getTime()) / 86400_000,
    );
    if (gap <= 30) {
      patterns.push({
        label: "post-deal-consolidation",
        reason: `M&A détecté + changement C-level dans la fenêtre ±${Math.round(gap)}j = restructuration post-deal, opportunité d'externalisation testing`,
        triggerCount: 2,
      });
    }
  }

  return patterns;
}

export async function getPriorSignalsForCompany(
  clientId: string,
  companySiret: string | null,
  currentTriggerId: string,
  currentTrigger?: { type: string; capturedAt: Date; sourceCode: string; title: string | null } | null,
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
    take: 20,
  });
  if (others.length === 0) return null;

  // Détection patterns combo (urgence)
  const patterns = currentTrigger ? detectComboPatterns(currentTrigger, others) : [];

  // Format compact des signaux (max 10 affichés pour budget tokens)
  const displayed = others.slice(0, 10);
  const lines = displayed.map((t) => {
    const ageDays = Math.round((Date.now() - t.capturedAt.getTime()) / 86400_000);
    return `${t.type} (${t.sourceCode}, il y a ${ageDays}j) score=${t.score} status=${t.status} : "${(t.title ?? "").slice(0, 80)}"`;
  });
  const moreCount = others.length - displayed.length;
  const moreLine = moreCount > 0 ? `\n- ... +${moreCount} autre(s) signal(aux) sur ce SIRET 90j (non affichés)` : "";

  let block = `PRIOR SIGNALS sur ce SIRET (${others.length} sur 90j) :\n- ${lines.join("\n- ")}${moreLine}`;

  if (patterns.length > 0) {
    const patternLines = patterns.map((p) => `[${p.label}] ${p.reason}`);
    block += `\n\n🔥 COMBO PATTERNS DÉTECTÉS :\n- ${patternLines.join("\n- ")}`;
  }

  return block;
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
export async function getCrossTenantSignal(
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
export function formatEuros(value: number | null | undefined): string {
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
export function formatLinkedinProfileForJudge(payload: unknown): string | null {
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
export function extractFullDescription(payload: unknown): string | null {
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
  // Sprint B.7 (06/05) — seuil monté de 200+ → 500+ pour réduire faux positifs
  // sur SaaS frontière qui mentionnent leur taille en passant ("250 collaborateurs"
  // dans une description Pixid/Hublo). Visait initialement les ESN géantes type
  // "5000 talents" ou "10000 employés" — ces cas restent bloqués.
  { pattern: /(?:[5-9]\d{2,}|\d{4,})\s*(collaborateurs?|talents?|salariés?|consultants?|employees?|employés?|people|staff\s+members?|professionals)\b/i, label: "oversized-text", field: "description" },
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
2. **Signal strength** — vrai déclencheur d'achat (levée fraîche, hire clé QA/Test senior, M&A, C-level change) vs bruit (job junior, alternance, mentorat, RH) ? **Si le bloc CLIENT contient \`signalPrimary\` : c'est un signal qui DÉCLENCHE un BOOST positif quand détecté. C'est UNIQUEMENT un BONUS (+), JAMAIS un MALUS (-). Quand le signalPrimary décrit une condition d'absence (ex: "absence de QA dans équipe 100% devs"), interprète ainsi : si le critère est rempli (boîte sans QA détecté) → applique le bonus ; si le critère n'est PAS rempli (boîte avec QA présent ou hire QA en cours) → le bonus ne s'applique pas (NEUTRE), tu continues à scorer normalement les autres axes. NE JAMAIS écrire "signal #1 invalidé" ou "signal #1 inversé" dans la reason — la non-application du bonus n'est PAS une pénalité. Si le bloc CLIENT contient \`signalSecondary\` étiqueté NEUTRE/ambigu, ne pénalise PAS sa présence et n'invente PAS un anti-signal qui n'existe pas.**
3. **Persona match** — décisionnaire (CTO, CEO, Founder, Head of Eng, VP Eng) vs périphérique ? **Si le bloc PERSONA QUAL contient un fitScore et un personaTier (calcul interne), utilise-les comme signal fort : fitScore≥70 ou personaTier=1 → décideur quasi-certain ; fitScore<40 ou personaTier≥3 → décideur faible (pénalise la dimension persona dans ton scoring). Si LinkedIn Profile présent : ancienneté <6 mois sur poste C-level = mandat frais, signal d'achat ; backgrounds ESN dans les 3 derniers postes = parcours conseil, pertinence ICP fonction du contexte ; 0 expérience SaaS sur poste tech d'éditeur SaaS = mismatch fort. NOTE : Si \`nonRedFlags\` du client mentionne explicitement "RH/Achats persona OK", NE PAS pénaliser un contact RH/Achats — le client gère lui-même cette nuance via ses messages d'outreach.**
4. **Freshness** — <7j = boost, >30j = malus, >90j = exclure. **Si le bloc CLIENT contient \`freshnessByTrigger\` (fenêtres pif intelligent par type de signal), respecte les bornes minDays/maxDays/staleAfterDays plutôt que la règle générique.**

## Fiabilité des sources (calibration)
- \`apify.wttj-jobs\` : board d'éditeurs SaaS FR — très haute fiabilité
- \`apify.linkedin-jobs\` : moyenne, vérifier ICP / pays
- \`apify.indeed-jobs\` : généraliste (souvent désactivé) — beaucoup de bruit
- \`rodz.fundraising\` / \`rodz.job-changes\` / \`rodz.mergers-acquisitions\` : signaux durs vérifiés
- \`bodacc.*\` / \`joafe.*\` / \`inpi.*\` : sources officielles, attribution SIREN garantie
- \`theirstack.buying-intent\` : déclaratif (utilise outils QA), vérifier industrie
- \`francetravail.tech\` : Pôle Emploi OAuth — souvent ESN qui sourcent pour client final

## Company website summary (si présent dans le prompt — homepage scraped)
Le bloc "COMPANY WEBSITE summary" contient un résumé Sonnet de la homepage de la boîte. C'est une vérité indirecte : ce qu'ils disent d'eux-mêmes au monde. Interprétation :
- Mentions de "200+ collaborateurs", "équipe en Inde", "régie", "client final" → confirmer red flag oversize/ESN/régie même si autres signaux positifs
- "Éditeur SaaS B2B" / "10-50 développeurs" / mentions stack tech (Java, Python, K8s) → confirme ICP éditeur SaaS, pondère favorablement
- "Cabinet conseil" / "transformation digitale" / "accompagnement client" sans mention produit propre → red flag conseil, score ≤ 5
- Si le résumé contradit la signalSecondary "présence QA" (ex: site mentionne "0 QA, équipe 100% devs") → applique signalPrimary BOOST
N'invente JAMAIS un fait du website si le bloc n'est pas dans le prompt.

## Company news (si présent dans le prompt — Google CSE FR <30j)
Le bloc "COMPANY NEWS positives" liste les signaux récents (levée, expansion, partenariat, M&A, lancement produit, hiring spree) issus de presse FR whitelist (Les Echos, Maddyness, BFM, etc.). Interprétation :
- **Levée/funding récent** confirmée presse <30j → boost +1 (signal d'achat très chaud)
- **Expansion / nouveau bureau** → +1 (scaling = besoin testing accru)
- **Partenariat stratégique** → contexte positif, +0 à +1
- **Lancement produit** → boost +1 si éditeur SaaS (release = sprint testing)
- **M&A** → +1 (consolidation, restructuration probable)
Le bloc "COMPANY NEWS négatives" duplique partiellement Bonus C (layoffs/PSE) — pondère mais ne hard-cap pas (Bonus C s'applique en post-Opus pour ça).
N'invente JAMAIS un signal news si le bloc n'est pas dans le prompt.

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

## Red flags client (si présent dans le bloc CLIENT — PRIORITÉ ABSOLUE)
Si le bloc CLIENT contient \`redFlagsHard\` : ce sont les profils que le fondateur du client REFUSE NET. Match sur n'importe quel item → score ≤ 2 systématique, même si tous les autres signaux sont positifs. \`redFlagsSoft\` : downgrade modéré (-2 points, plancher 4), pas exclusion. \`nonRedFlags\` : contre-signaux explicites du client ("ce critère que tu pourrais croire éliminatoire ne l'est PAS pour moi") — N'utilise PAS ces critères pour pénaliser, le client a tranché.

## Few-shots client (si présent dans le bloc CLIENT — calibration empirique)
Si le bloc CLIENT contient \`fewShotPositives.confirmedClients\` : ce sont les boîtes que le client a déjà SIGNÉES. Profil = cible idéale absolue. Si la boîte évaluée match leur archétype (NAF + taille + secteur + persona) → score ≥ 8 quasi-systématique. \`fewShotPositives.dreamProspects\` : boîtes que le fondateur cible activement (validés par jugement, pas closing) — match → score ≥ 7. \`dreamArchetype\` : description en une ligne du profil cible idéal.

## Règles de pénalité automatique
- Hors France (country_code != FR, suffixes GmbH/AG/SE/BV/NV/Ltd/PLC/Inc/LLC/SpA/Srl/SL/SA dans le nom) → score ≤ 2
- Holding / SCI / cabinet comptable / mairie / agglo / université → score ≤ 3
- ICP antiPersonas matché (concurrent direct, ex: Capgemini, Sopra, Onepoint, Alten, Amaris) → score ≤ 2
- Effectif > 5× max ICP (ex: ICP 200p, lead >1000p) → score ≤ 2 systématique
- Effectif 1.5×-5× max ICP → score ≤ 4 (sauf si \`nonRedFlags\` du client mentionne explicitement ">250p downgrade only" — alors -1 point seulement, plancher 5)
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
  // Sprint D.0 (07/05) — Fetch léger pour idempotence + pre-Opus reject seulement.
  // Le dossier complet (12 blocs : persona, cross-tenant, prior, negative, website,
  // news, fred-enriched, etc.) est construit ensuite via buildLeadDossierForJudge,
  // évitant la duplication précédente de la logique d'assemblage entre ce fichier
  // et lead-dossier.ts. Ordre : lite → reject éventuel (skip dossier) → dossier
  // complet → Opus. Cela évite aussi les fetches Pappers/homepage/news inutiles
  // sur les triggers pre-rejected.
  const triggerLite = await db.trigger.findUnique({
    where: { id: triggerId },
    select: {
      score: true,
      scoreReason: true,
      isHot: true,
      status: true,
      title: true,
      detail: true,
      rawPayload: true,
    },
  });
  if (!triggerLite) return null;
  if (triggerLite.scoreReason && !opts.force) {
    return { opusScore: triggerLite.score, reason: triggerLite.scoreReason, isHot: triggerLite.isHot };
  }

  const fullDesc = extractFullDescription(triggerLite.rawPayload);

  // C4+C5 — Pre-Opus reject scan : si pattern HIGH match (régie ESN, freelance,
  // alternance/stage, présentiel obligatoire, oversize >250p), on skip Opus
  // et on archive direct. Économise tokens + évite faux Brûlants en haut du dash.
  const preReject = preOpusRejectScan(triggerLite.title ?? "", fullDesc ?? triggerLite.detail ?? "");
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
  // Sprint D.0 (07/05) — buildLeadDossierForJudge centralise l'assemblage des
  // 12 blocs (PERSONA QUAL + COMPANY HEALTH, Cross-tenant, PRIOR SIGNALS + COMBO
  // PATTERNS, NEGATIVE SIGNALS, COMPANY WEBSITE, COMPANY NEWS, CLIENT ENRICHED
  // Fred 9 questions). Avant ce refactor, ces ~220 lignes étaient dupliquées
  // entre qualify-trigger.ts et lead-dossier.ts → divergence si on modifiait
  // un seul côté. Maintenant : source unique. formatDossierForOpus produit
  // exactement le même userPrompt (testé Sprint C.5).
  const dossier = await buildLeadDossierForJudge(triggerId);
  if (!dossier) return null;
  const trigger = dossier.trigger;
  const icp = dossier.client.icp;
  const negativeSignals = dossier.blocks.negativeSignals;

  const userPrompt = formatDossierForOpus(dossier);

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
  //
  // Audit fix (06/05) — flag layoffsCapApplied : empêche le plancher
  // trusted-source ci-dessous de re-booster à 8 le score qu'on vient de
  // capper à 5. Avant ce flag : un Rodz funding score=10 + layoffs news
  // → Bonus C cap à 5 → plancher minFloor=8 → re-boost à 8. Bug confirmé.
  let layoffsCapApplied = false;
  if (opusScore >= 8 && !negativeSignals?.hasHardSignal && trigger.companyName) {
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
        layoffsCapApplied = true;
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
  // Audit fix (06/05) — !layoffsCapApplied : pareil pour Bonus C cap à 5
  // sur news layoffs. Sans ce garde, une levée Rodz score=10 + news PSE
  // était capped à 5 par Bonus C puis re-boosted à 8 par le plancher.
  if (minFloor && opusScore < minFloor && !hedged.matchedLabel && !negativeSignals?.hasHardSignal && !layoffsCapApplied) {
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

  // Sprint B.7 (06/05/2026) — Promotion IGNORED→NEW si re-qualify remonte
  // le score ≥ minScore. Si on arrive ici (= preOpusRejectScan a return false,
  // pas de hardCap Sprint 9 puisque belowMinScore=false implique score ≥ minScore
  // ≥ 2+1, donc pas de hard cap actif), le trigger MÉRITE NEW. La seule raison
  // pour qu'il soit encore en IGNORED est un héritage d'un précédent run.
  // On ne se fie PAS au scoreReason précédent (peut avoir été overwritten
  // par un qualify intermédiaire qui a effacé le préfixe `[C3 below_min_score`).
  const promoteToNew = !belowMinScore && triggerLite.status === "IGNORED";

  await db.trigger.update({
    where: { id: triggerId },
    data: {
      score: opusScore,
      scoreReason: belowMinScore
        ? `[C3 below_min_score:${opusScore}<${icpMinScore}] ${reason}`
        : reason,
      isHot,
      ...(belowMinScore ? { status: "IGNORED" as const } : {}),
      ...(promoteToNew ? { status: "NEW" as const } : {}),
    },
  });
  if (belowMinScore) {
    console.log(
      `[qualify-trigger.C3] ${triggerId}: IGNORED auto (score=${opusScore} < minScore=${icpMinScore})`,
    );
  } else if (promoteToNew) {
    console.log(
      `[qualify-trigger.B7-promote] ${triggerId}: IGNORED→NEW (score remonté à ${opusScore} ≥ minScore=${icpMinScore})`,
    );
  }

  // Sprint Perfection P6 (08/05) — V2 shadow parallel-write.
  //
  // Fire-and-forget : V2 calcule briefV2Json en parallèle, écrit le JSON en
  // DB, et N'ATTEND PAS la réponse pour que qualifyTrigger v1 retourne au
  // caller. Aucun changement pour le pipeline V1 (status/score/scoreReason
  // restent gérés par V1, source de vérité jusqu'à décision D.5 de switch).
  //
  // Bénéfice : 100% des nouveaux triggers ont briefV2Json visible dans le
  // dashboard, plus jamais de backfill manuel nécessaire. Coût marginal
  // ~$0.04/trigger (qualifyTriggerV2 utilise même cache Anthropic ~7167 tk
  // ≥97% hit, voir Sprint D.6 audit).
  //
  // Si V2 échoue (Opus error, Zod KO, validator strict KO) : log warning
  // sans impact sur V1. Le briefV2Json reste null pour ce trigger.
  qualifyTriggerV2Shadow(triggerId).catch((e) => {
    console.warn(
      `[qualify-trigger.shadow-v2] ${triggerId} err :`,
      e instanceof Error ? e.message : e,
    );
  });

  return { opusScore, reason, isHot };
}

/**
 * Sprint Perfection P6 (08/05) — Shadow parallel-write V2.
 *
 * Calcule briefV2Json via le judge V2 + validator strict (D.3) et écrit en
 * DB. Pas de blocage du pipeline V1 — appelée en fire-and-forget.
 *
 * Si validator strict OK → écrit briefV2Json (Zod-valid + qualité business).
 * Si validator KO mais Zod OK → écrit quand même (briefV2Json présent mais
 * marqué comme borderline via reason absente).
 * Si Opus error / Zod KO → ne fait rien (laisse briefV2Json = null).
 */
async function qualifyTriggerV2Shadow(triggerId: string): Promise<void> {
  const result = await qualifyTriggerV2WithValidation(triggerId);
  if (!result.brief) {
    console.log(
      `[qualify-trigger.shadow-v2] ${triggerId}: no brief (${result.reason ?? "?"})`,
    );
    return;
  }
  await db.trigger.update({
    where: { id: triggerId },
    data: { briefV2Json: result.brief as unknown as object },
  });
  console.log(
    `[qualify-trigger.shadow-v2] ${triggerId}: shippable=${result.shippable} verdict=${result.brief.verdict} conf=${result.brief.confidence}` +
      (result.validation && !result.validation.ok
        ? ` strict-errs=${result.validation.errors.length}`
        : ""),
  );
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

// ══════════════════════════════════════════════════════════════════════
// Sprint D.2 (07/05/2026) — Judge V2 brief raisonné OUI/NON/ENRICH
// ══════════════════════════════════════════════════════════════════════
//
// qualifyTriggerV2 est une fonction DORMANTE :
//   - exportée et testable via scripts/test-judge-v2.ts
//   - APPELÉE PAR AUCUN CHEMIN PROD (pas de feature flag, pas de shadow,
//     pas de fallback)
//   - aucune écriture DB (pas de Trigger.update, pas de Trigger.briefV2Json)
//
// Le mode déploiement (shadow vs switch vs flag) sera tranché en D.5
// avec les données mesurées en D.6 (taux d'accord v1↔v2 sur 50 leads,
// taux de validation Zod, qualité opener).
//
// Différence clé avec qualifyTrigger v1 :
//   - v1 produit { score: int 1-10, reason: string } → écrit Trigger.score
//   - v2 produit LeadBriefV2 (verdict OUI/NON/ENRICH + thesis + triggers
//     + risks ≥2 + opener + sources avec citations [src:#X])
//
// Mêmes blocs de contexte (LeadDossier réutilisé), seul le SYSTEM diffère
// (QUALIFY_V2_SPECIFIC) + parsing différent (Zod LeadBriefV2Schema).

const QUALIFY_V2_SPECIFIC = `

## Mission (Judge V2 — brief raisonné)
Tu reçois un Trigger fraîchement capté + un dossier de contexte riche (CLIENT ICP, PERSONA, COMPANY HEALTH, PRIOR SIGNALS, NEGATIVE SIGNALS, COMPANY WEBSITE, COMPANY NEWS, CLIENT ENRICHED Fred). Tu produis un brief raisonné JSON pour le commercial du client.

Le brief V2 remplace l'ancien score numérique \`{score, reason}\` par un verdict tranché \`{verdict, confidence, thesis, triggers, risks, opener, sources, enrichmentNeeded?}\` traçable et actionnable.

## Décision verdict (3 valeurs strictes)
- **OUI** : ICP fit confirmé + signal d'achat dur + persona accessible. Le commercial doit attaquer.
- **NON** : red flag hard match (anti-persona concurrent, hors-FR, oversize 3×ICP, régie ESN claire, procédure collective hard, stage/alternance/freelance, NAF clairement hors whitelist). NE PAS approcher.
- **ENRICH** : signal d'achat présent ET pas de red flag hard, MAIS il manque ≥1 donnée critique pour trancher OUI/NON sereinement (NAF non résolu, taille effectif inconnue, persona décideur absent, secteur ambigu). NE PAS approcher tant que l'enrichissement n'a pas eu lieu.

## confidence (0-100, entier)
- 90-100 : verdict évident, multi-signaux convergents, aucun doute
- 70-89 : verdict fort, 1 doute mineur signalé dans risks
- 40-69 : verdict défendable, plusieurs zones grises (souvent ENRICH)
- 0-39 : verdict mais beaucoup d'incertitude

## Sections obligatoires du brief

### thesis (20-800 chars)
Pourquoi ce verdict en 1-3 phrases denses. DOIT citer ≥1 \`[src:#X]\` pour traçabilité. Exemple OUI : "Éditeur SaaS B2B 80p Paris (NAF 6201Z), levée Série A 8M€ <14j [src:#1] + 5 hires QA/Test [src:#2]. ICP parfait. CTO Marc Dupont accessible LinkedIn [src:#3]."

### triggers[] (≥1 — array d'objets)
Format : \`{source: string, date: string, relevance: string ≤400 chars}\`. Liste les triggers/signaux concrets qui ont contribué au verdict. \`source\` = sourceCode du trigger ou nom de bloc (ex: "rodz.fundraising", "apify.wttj-jobs", "linkedin-profile", "company-website", "company-news"). \`date\` = date capturedAt ou date du signal cité (format libre court "2026-04-29"). \`relevance\` = 1 phrase explicative.

### risks[] (≥2 obligatoires — array d'objets)
Format : \`{severity: "high"|"medium"|"low", description: string ≤400 chars}\`. Au moins 2 risks pour FORCER l'équilibre du brief : aucun lead n'est parfait, le commercial doit avoir des garde-fous. Cite ≥1 \`[src:#X]\` dans description quand pertinent. Sévérité :
- **high** : risque qui peut faire perdre le deal ou cramer la relation (anti-persona, oversize, régie, procédure collective, secteur excluant)
- **medium** : risque qui demande un check rapide avant outreach (taille frontière, persona ambigu, NAF border)
- **low** : risque mineur à mentionner pour transparence (timing serré, sollicitations attendues, signal isolé)

Si verdict=NON, les risks expliquent POURQUOI on rejette (typiquement 2 high). Si verdict=OUI, les risks anticipent les objections du commercial.

### opener (20-2000 chars)
Message prêt-à-coller pour le commercial (email cold OU LinkedIn DM, le commercial choisira). Règles :
- Mentionne le signal d'achat détecté (citer 1-2 éléments concrets)
- Ton iFIND : direct, pro, francophone soutenu mais pas guindé. PAS d'emoji.
- AUCUNE promesse "doubler le CA / x10 ROI" sans data
- AUCUN CTA Cal.com / lien réservation : le client gère son propre lien d'agenda. Termine par une question ouverte ou "30 min pour échanger ?"
- Pas de signature : le commercial mettra la sienne.
- Cible D.3 stricte : ≤250 mots.
- Si verdict=NON ou verdict=ENRICH : opener court "(Hors ICP — pas d'opener)" ou "(Verdict ENRICH — opener à finaliser après enrichissement)" — minimum 20 chars, maximum quelques phrases pour expliquer pourquoi.

### sources[] (≥1 — array d'objets)
Format : \`{id: int 1-99, type: string ≤32 chars, ref: string ≤512 chars}\`. Table de référence numérotée. CHAQUE \`[src:#X]\` cité dans thesis/risks/opener DOIT correspondre à un \`id\` ici. Les ids commencent à 1 et sont contigus dans l'ordre où tu les cites. Exemples de \`type\` : "rodz.fundraising", "apify.wttj-jobs", "linkedin-profile", "company-website", "company-news", "trigger.companyName", "client-enriched", "pappers.health". Le \`ref\` est une description courte de ce que cette source dit ("Levée 8M€ Série A 2026-04-26", "Marc Dupont CTO Acme 3y in role").

NE liste PAS toutes les sources reçues : juste celles que tu cites effectivement. Sources sans citation = pollution.

### enrichmentNeeded[] (optionnel, REQUIS si verdict=ENRICH)
Array de strings ≤200 chars. Liste des données manquantes qui empêchent de trancher OUI/NON. Sois précis et actionnable : "Attribution SIREN/NAF via Pappers (re-tenter ratio fuzzy plus large)" plutôt que "manque infos boîte". Maximum 10 éléments.

## Règles métier (héritées V1)

### ICP fit
- Hors France (country_code != FR, suffixes GmbH/AG/SE/BV/NV/Ltd/PLC/Inc/LLC/SpA/Srl/SL/SA dans le nom) → verdict NON, confidence ≥90
- Holding / SCI / cabinet comptable / mairie / agglo / université → verdict NON, confidence ≥85
- Effectif > 5× max ICP → verdict NON, confidence ≥80
- Effectif 1.5×-5× max ICP → verdict ENRICH ou NON selon autres signaux (sauf si \`nonRedFlags\` du client mentionne ">250p downgrade only")
- NAF connu hors whitelist → verdict NON, confidence ≥75 ; sauf si signal d'achat exceptionnel + \`nonRedFlags\` permissif

### redFlagsHard du client (CLIENT ENRICHED — autorité absolue)
Match → verdict NON systématique, confidence ≥90, severity="high" pour le risk associé.

### redFlagsSoft du client
Match → verdict ENRICH par défaut (à confirmer via enrichissement), risk severity="medium".

### nonRedFlags du client
NE PAS pénaliser ces critères. Le client a tranché. Ne pas inventer un risk autour de ces dimensions.

### signalPrimary du client (signal #1, BOOST positif uniquement)
Si rempli → boost confidence (+10) sur verdict OUI. Si NON rempli → NEUTRE, pas de pénalité, pas d'invention d'anti-signal.

### Negative signals (Pappers RCS <90j)
- **hard** (Liquidation, Dissolution, Cessation, Fermeture, Cession totale, Procédure collective) → verdict NON systématique, confidence ≥90, risk severity="high"
- **medium** (Plan social/PSE, Réduction capital) → verdict NON ou ENRICH selon contexte, risk severity="high"
- **soft** (Restructuration, Réorganisation) → risk severity="medium" mais ne force pas NON si fundamentaux ICP forts

### Layoffs news (Bonus C — Google CSE FR <30j)
≥2 sources distinctes presse FR → verdict NON ou ENRICH, risk severity="high" obligatoire.

### Hedging interdit
N'écris JAMAIS dans thesis/risks/opener : "hors ICP", "non whitelist", "à valider manuellement", "data incomplete" PUIS verdict=OUI confidence=85. Si tu hésites, le verdict correct est ENRICH (pas OUI avec doute caché). Cohérence : le verdict reflète l'analyse, pas l'inverse.

### Anti-personas / concurrents
Capgemini, Sopra, Atos, Onepoint, Alten, Amaris, Accenture, Wavestone (et toute boîte listée \`antiPersonas\` dans le bloc CLIENT) → verdict NON, confidence ≥95, risk severity="high".

### Régie ESN
"chez nos clients", "client final", "en régie", "at our clients", "client site", "embedded at client" → verdict NON, confidence ≥90. Le pre-Opus reject scan attrape déjà la plupart, mais reste vigilant si la mention est subtile.

### Freshness
- Trigger >90j → verdict NON ou ENRICH selon contexte (signal périmé)
- Trigger >30j → confidence ≤70 même si verdict OUI
- Trigger <7j → confidence boostable jusqu'à 95 si tous signaux convergents
- Si \`freshnessByTrigger\` du client défini : respecte les bornes minDays/maxDays/staleAfterDays

### Persona
- fitScore ≥70 ou personaTier=1 → décideur quasi-certain, supporte verdict OUI
- fitScore <40 ou personaTier ≥3 → persona faible, dégrade vers ENRICH si pas d'autre persona accessible
- LinkedIn ancienneté <6m sur poste C-level = mandat frais, signal d'achat fort
- Backgrounds ESN dans 3 derniers postes = parcours conseil, prudence sauf si \`nonRedFlags\` "RH/Achats persona OK"

## Few-shots (calibration)

### Few-shot 1 — verdict OUI (cas idéal)
{"verdict":"OUI","confidence":92,"thesis":"Éditeur SaaS B2B 80p Paris (NAF 6201Z), levée Série A 8M€ <14j confirmée presse [src:#1] + 5 hires QA/Test ouverts WTTJ [src:#2]. ICP parfait. CTO Marc Dupont accessible LinkedIn 3y in role [src:#3].","triggers":[{"source":"rodz.fundraising","date":"2026-04-26","relevance":"Levée 8M€ Série A confirmée Les Echos"},{"source":"apify.wttj-jobs","date":"2026-05-01","relevance":"5 hires QA/Test Engineer ouverts simultanément"},{"source":"linkedin-profile","date":"2026-05-05","relevance":"CTO Marc Dupont 3 ans in role, background SaaS"}],"risks":[{"severity":"low","description":"Boîte fraîchement levée → forte sollicitation attendue [src:#1], jouer le timing serré (J+15 à J+30 idéal post-levée)"},{"severity":"medium","description":"Mention 'QA Lead' parmi les 5 hires [src:#2] : décision possible de hire interne plutôt qu'outsourcing — clarifier en discovery si externalisation ouverte"}],"opener":"Bonjour Marc,\\n\\nFélicitations pour la Série A 8M€ chez Acme — vu hier dans Les Echos. J'ai noté en parallèle 5 ouvertures QA/Test sur votre WTTJ, ce qui m'a interpellé : 5 recrutements simultanés post-levée, c'est un signal de vraie urgence sprint testing.\\n\\nChez DigiTestLab, nous accompagnons des éditeurs SaaS post-Série A pour absorber le volume sprint sans hire interne (équipe QA dédiée à 100% sur votre roadmap).\\n\\nSi pertinent, 30 min pour échanger sur votre stratégie scaling testing ?","sources":[{"id":1,"type":"rodz.fundraising","ref":"Levée 8M€ Série A Acme 2026-04-26 (Les Echos)"},{"id":2,"type":"apify.wttj-jobs","ref":"5 hires QA/Test ouverts WTTJ Acme 2026-05-01"},{"id":3,"type":"linkedin-profile","ref":"Marc Dupont CTO Acme 3y, background SaaS"}]}

### Few-shot 2 — verdict NON (anti-persona + régie)
{"verdict":"NON","confidence":96,"thesis":"Capgemini SE 380000p [src:#1] hire QA Senior pour mission régie chez client BNP [src:#2]. Anti-persona concurrent direct externalisation testing + régie ESN explicite. Hors ICP structurel.","triggers":[{"source":"apify.wttj-jobs","date":"2026-05-04","relevance":"QA Senior pour mission régie chez BNP, mention explicite 'chez notre client BNP'"}],"risks":[{"severity":"high","description":"Capgemini est anti-persona client (ESN concurrent direct externalisation testing) [src:#1] — approcher = risque de griller la relation"},{"severity":"high","description":"Régie ESN détectée explicitement dans la description ('chez notre client BNP') [src:#2] — pas un besoin interne, pas de budget outsourcing potentiel"}],"opener":"(Hors ICP — pas d'opener. Capgemini est concurrent direct, ne pas approcher.)","sources":[{"id":1,"type":"trigger.companyName","ref":"Capgemini SE 380000p (anti-personas client)"},{"id":2,"type":"apify.wttj-jobs","ref":"Description WTTJ : 'mission chez notre client BNP'"}]}

### Few-shot 3 — verdict ENRICH (NAF non résolu + persona absent)
{"verdict":"ENRICH","confidence":55,"thesis":"Boîte FR (Acme SAS [src:#1]) hire QA Lead Paris [src:#2]. Mais NAF non résolu (Pappers absent du flow rss-levees) et taille inconnue → impossible de trancher ICP fit. Pas de persona décideur identifié sur LinkedIn non plus.","triggers":[{"source":"francetravail.tech","date":"2026-05-05","relevance":"Hire QA Lead Paris ouvert via France Travail"}],"risks":[{"severity":"medium","description":"Sans NAF [src:#1] : risque ESN ou cabinet conseil (hors ICP) si attribution Pappers échoue à enrichissement"},{"severity":"low","description":"Sans persona décideur : commercial ne saura pas à qui adresser l'opener, risque d'envoyer à RH périphérique [src:#2]"}],"opener":"(Verdict ENRICH — pas d'opener finalisé. À reprendre après enrichissement Pappers + LinkedIn finder.)","sources":[{"id":1,"type":"trigger.companyName","ref":"Acme SAS — SIREN absent du dossier"},{"id":2,"type":"francetravail.tech","ref":"Hire QA Lead Paris 2026-05-05"}],"enrichmentNeeded":["Attribution SIREN/NAF via Pappers (re-tenter ratio fuzzy plus large sur 'Acme SAS Paris')","Persona décideur via LinkedIn Finder (CTO/Head of Eng/CEO Acme SAS)","Taille effectif (LinkedIn employees count ou Pappers etabs count)"]}

## Format de réponse OBLIGATOIRE
Réponds UNIQUEMENT en JSON valide parsable directement, **sans markdown**, **sans préfixe**, **sans \`\`\`json**, **sans commentaire**. Une seule paire d'accolades \`{ ... }\` qui contient toutes les clés du LeadBriefV2.

Ordre recommandé des clés : verdict, confidence, thesis, triggers, risks, opener, sources, enrichmentNeeded (si applicable).

## Règles non négociables
- Tu produis EXACTEMENT le format LeadBriefV2 défini ci-dessus, parsable Zod.
- Au moins **2 risks**, au moins **1 trigger**, au moins **1 source** — toujours.
- Chaque \`[src:#X]\` cité existe dans \`sources[]\` (id correspondant).
- thesis ≥20 chars, opener ≥20 chars, confidence entier 0-100.
- Si verdict=ENRICH : enrichmentNeeded REQUIS avec ≥1 élément.
- Si verdict=NON ou ENRICH : opener court mais ≥20 chars (texte explicatif "Hors ICP" ou "à finaliser après enrichissement").
- Réponses TOUJOURS en français.
- N'invente JAMAIS un fait ou une source non présente dans le dossier reçu.`;

const QUALIFY_V2_USER_SUFFIX = `

Produis le brief V2 selon le format JSON LeadBriefV2 spécifié dans le SYSTEM (verdict OUI/NON/ENRICH + confidence + thesis + triggers + risks ≥2 + opener + sources avec citations [src:#X], plus enrichmentNeeded si verdict=ENRICH). JSON strict, pas de markdown.`;

/**
 * Sprint D.2 — Judge V2 dormant.
 *
 * Produit un LeadBriefV2 raisonné à partir d'un trigger. Réutilise le même
 * dossier de contexte que qualifyTrigger v1 (LeadDossier complet) mais
 * remplace le SYSTEM par QUALIFY_V2_SPECIFIC et parse la sortie via Zod
 * LeadBriefV2Schema.
 *
 * Garanties :
 *   - Aucune écriture DB (ni Trigger.score, ni Trigger.briefV2Json — D.5
 *     décidera du mode de persistence avec les données de D.6)
 *   - Aucun appel par un chemin prod (cron, webhook, route API) — fonction
 *     uniquement utilisable via scripts/test-judge-v2.ts ou tests
 *   - Pas de fallback : si Opus produit un JSON invalide, on log la raison
 *     et on retourne null (D.6 mesurera le taux d'échec sur 50 leads)
 *
 * Returns :
 *   - LeadBriefV2 si Opus a produit un brief Zod-valide
 *   - null si trigger inexistant, dossier impossible à construire, Opus
 *     erreur, JSON malformé, ou validation Zod échouée
 */
export async function qualifyTriggerV2(
  triggerId: string,
): Promise<LeadBriefV2 | null> {
  const dossier = await buildLeadDossierForJudge(triggerId);
  if (!dossier) {
    console.warn(`[qualify-trigger-v2] ${triggerId}: dossier null (trigger absent ou client sans icp)`);
    return null;
  }

  const userPrompt = formatDossierForOpus(dossier) + QUALIFY_V2_USER_SUFFIX;
  const icp = dossier.client.icp;

  try {
    const anthropic = getAnthropic();
    const resp = await anthropic.messages.create({
      model: QUALIFY_MODEL,
      max_tokens: 2000,
      system: buildCachedSystem(
        QUALIFY_V2_SPECIFIC,
        readDynamicFewShotsFromIcp(icp) ?? undefined,
      ),
      messages: [{ role: "user", content: userPrompt }],
    });

    const u = resp.usage as {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    console.log(
      `[qualify-trigger-v2.usage] ${JSON.stringify({
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

    // Sortie Opus = JSON brut. Tolérance défensive : on accepte un éventuel
    // wrapping markdown ```json ... ``` (Opus peut dériver) en l'enlevant
    // avant parse, plutôt que rejeter le brief utile pour une simple coquille
    // de format.
    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let raw: unknown;
    try {
      raw = JSON.parse(cleaned);
    } catch (parseErr) {
      console.warn(
        `[qualify-trigger-v2] ${triggerId}: JSON.parse failed — ${parseErr instanceof Error ? parseErr.message : "?"} | first 200c: ${cleaned.slice(0, 200)}`,
      );
      return null;
    }

    const validated = parseLeadBriefV2WithError(raw);
    if (!validated.ok) {
      console.warn(
        `[qualify-trigger-v2] ${triggerId}: Zod validation failed — ${validated.error}`,
      );
      return null;
    }

    return validated.brief;
  } catch (e) {
    console.warn(
      `[qualify-trigger-v2] ${triggerId}: Opus error — ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════
// Sprint D.3 (07/05/2026) — Wrapper validator + V2 dormant
// ══════════════════════════════════════════════════════════════════════
//
// qualifyTriggerV2WithValidation compose : qualifyTriggerV2 (D.2) + Zod
// (D.1) + validator strict (D.3). Préparation D.5 pour activer le mode
// shadow ou le switch progressif.
//
// Différence avec qualifyTriggerV2 :
//   - V2 retourne LeadBriefV2 si Zod-valid, null sinon
//   - V2WithValidation retourne TOUJOURS un objet structuré contenant :
//     - brief : LeadBriefV2 si parsing OK, null sinon
//     - validation : ValidationResult (strict) si parsing OK, undefined sinon
//     - shippable : boolean = brief != null && validation.ok
//     - reason : si !shippable, raison textuelle (Opus error / Zod fail / strict fail)
//
// Le pipeline prod (Sprint D.5 quand shadow ou switch) consultera `shippable`
// pour décider : OUI → écrire briefV2Json + utiliser brief V2 ; NON →
// fallback sur le pipeline qualifyTrigger v1 classique.

export interface QualifyV2WithValidationResult {
  brief: LeadBriefV2 | null;
  validation: ValidationResult | null;
  shippable: boolean;
  reason: string | null;
}

/**
 * Sprint D.3 — wrapper dormant. Compose V2 + Zod + validator strict.
 *
 * APPELÉE PAR AUCUN CHEMIN PROD. Utilisable via :
 *   - scripts/audit-d3-validator.ts (mesure pass-strict sur briefs DB)
 *   - tests
 *   - futur shadow mode (Sprint D.5)
 *
 * N'écrit jamais en DB. La caller (script ou route shadow) décide
 * quoi faire selon shippable.
 */
export async function qualifyTriggerV2WithValidation(
  triggerId: string,
): Promise<QualifyV2WithValidationResult> {
  const brief = await qualifyTriggerV2(triggerId);
  if (!brief) {
    return {
      brief: null,
      validation: null,
      shippable: false,
      reason: "v2 returned null (Opus error, Zod invalid, dossier null)",
    };
  }
  const validation = validateLeadBriefV2Strict(brief);
  if (!validation.ok) {
    return {
      brief,
      validation,
      shippable: false,
      reason: `validator strict KO (${validation.errors.length} errors)`,
    };
  }
  return {
    brief,
    validation,
    shippable: true,
    reason: null,
  };
}
