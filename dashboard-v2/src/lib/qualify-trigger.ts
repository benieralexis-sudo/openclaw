import "server-only";
import { Prisma } from "@prisma/client";
import { getAnthropic, QUALIFY_MODEL } from "@/lib/anthropic";
import { buildCachedSystem } from "@/lib/anthropic-prompt";
import { db } from "@/lib/db";
import { extractLinkedInProfile } from "@/lib/linkedin-profile-extractor";
import { archiveLeadOnTriggerIgnored, unarchiveLeadOnTriggerRevived } from "@/lib/lead-status-sync";
import { readDynamicFewShotsFromIcp } from "@/lib/dynamic-few-shots";
// Refactor V2-only Session 3 — searchLayoffsNews supprimé (V2 voit
// companyNews via dossier, plus besoin du Bonus C cap externe).
import { buildLeadDossierForJudge, formatDossierForOpus } from "@/lib/lead-dossier";
// Sprint 8 (10/05/2026) — Quota par client + cout reel Anthropic
import { checkQuota, recordSpend } from "@/lib/quota-checker";
import { checkLeadCanGenerate } from "@/lib/lead-generation-guard";
import { computeAnthropicCost } from "@/lib/anthropic-cost";
// Sprint Saint Graal (10/05/2026) — Mecanique credits + garantie Pepite
import { debitCreditForQualifiedLead } from "@/lib/credits";
import {
  parseLeadBriefV2WithError,
  type LeadBriefV2,
} from "@/lib/lead-brief-v2";
import {
  validateLeadBriefV2Strict,
  type ValidationResult,
} from "@/lib/lead-brief-v2-validator";
import { getMinFreshnessDays } from "@/lib/freshness-min-gate";
import { detectOpenerPersonaDesync } from "@/lib/opener-substitution";
// Sprint reprise (17/05/2026) — Circuit breaker Anthropic. Évite de marquer
// IGNORED 200+ triggers à chaque panne Anthropic (cas 15-17/05).
import {
  isAnthropicDown,
  isTransientAnthropicError,
  markAnthropicDown,
} from "@/lib/anthropic-health";

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

// Refactor V2-only Session 3 (10/05) — Fix L hedging supprimé.
// Le V2 a son propre validator strict (Zod + qualité business) qui détecte
// les briefs incohérents et force IGNORED. Plus besoin de patterns regex
// pour rattraper les hedgings de V1 (qui n'existe plus).


/**
 * Refactor V2-only — Session 1 (10/05/2026).
 *
 * AVANT : V1 Opus (score 1-10) en source de vérité + V2 fire-and-forget shadow.
 * MAINTENANT : V2 décide tout (verdict OUI/ENRICH/NON + confidence + thesis).
 *
 * Le score 0-10 est CONSERVÉ pour compat UX (mappé depuis verdict+conf) :
 *   - OUI conf >= 90 → 10  (Pépite top)
 *   - OUI 80-89      →  9  (Pépite)
 *   - OUI 70-79      →  8  (Très chaud)
 *   - OUI 60-69      →  7  (Qualifié)
 *   - OUI <60        →  6  (faible mais OUI)
 *   - ENRICH >= 70   →  7  (Qualifié à enrichir)
 *   - ENRICH 50-69   →  6
 *   - ENRICH <50     →  5
 *   - NON            →  2
 *
 * Status : V2 OUI ou ENRICH shippable → NEW. V2 NON ou !shippable → IGNORED.
 *
 * Logique simplifiée : V2 voit déjà via le dossier les blocs negativeSignals,
 * companyNews (layoffs), redFlags ICP, etc. donc plus besoin de couches
 * legacy V1 (Fix L hedging, Sprint 9 hard cap, Bonus C layoffs, plancher
 * trusted-source, C3 below_min_score). Si V2 plante (validation strict KO,
 * Opus error), fail-safe IGNORED.
 *
 * Économie : V2-only ~$0.16/call vs V1+V2 ~$0.24/call = -33% Anthropic.
 */
export async function qualifyTrigger(
  triggerId: string,
  opts: { force?: boolean } = {},
): Promise<QualifyResult | null> {
  // Sprint reprise (17/05) — Circuit breaker : si Anthropic en pause,
  // skip silencieusement. Trigger reste status=NEW, sera repris au cycle
  // suivant la guérison.
  if (await isAnthropicDown()) {
    console.warn(`[qualify-trigger] ${triggerId}: skip — Anthropic circuit breaker open`);
    return null;
  }

  // 1. Fetch trigger lite (idempotence + données pre-Opus reject)
  const triggerLite = await db.trigger.findUnique({
    where: { id: triggerId },
    select: {
      clientId: true,
      score: true,
      scoreReason: true,
      isHot: true,
      status: true,
      title: true,
      detail: true,
      companyName: true,
      publishedAt: true,
      type: true,
      rawPayload: true,
      // Fix B6 (11/05/2026) — Nécessaire pour distinguer "déjà scoré V1
      // par le poller" (rss-levees) de "déjà qualifié V2 par le judge".
      briefV2Json: true,
      // Fix F-antiPersonas + F-freshness-gate (12/05/2026) — Charge l'ICP
      // client pour appliquer le hard gate antiPersonas avant pre-Opus reject
      // et le gate min freshness après verdict.
      client: { select: { icp: true } },
      // Audit 16/05 — Charge Lead pour le guard pré-V2 (Fix #1 audit 16/05).
      lead: { select: { status: true, doNotContact: true, bouncedAt: true } },
    },
  });
  if (!triggerLite) return null;
  // Fix B6 — Idempotence : early-return seulement si DÉJÀ scoré V1 ET DÉJÀ
  // qualifié V2. Sans la condition briefV2Json, les triggers rss-levees
  // (pré-scorés V1 par le poller à l'ingestion) ne traversaient jamais
  // le judge V2, laissant briefV2Json à NULL indéfiniment.
  if (triggerLite.scoreReason && triggerLite.briefV2Json && !opts.force) {
    return { opusScore: triggerLite.score, reason: triggerLite.scoreReason, isHot: triggerLite.isHot };
  }

  // Audit 16/05 — Fix #1 — Guard Lead AVANT V2 + traitement différencié.
  //
  // Sans ce guard distinguant les cas, ma protection ajoutée dans
  // qualifyTriggerV2 (return null si Lead INCOMPLETE/doNotContact/bouncedAt)
  // cascadait dans le bloc "v2-failed" ligne ~590 qui force status=IGNORED.
  // Problème pour INCOMPLETE : c'est censé être un état TRANSITOIRE en attente
  // d'enrichissement (cf. memo cycle INCOMPLETE 12/05). Le Lead doit revenir
  // en NEW quand l'enrichissement résout la persona — IGNORED définitif tuait
  // ce cycle.
  //
  // Sémantique correcte :
  //   - INCOMPLETE      → return null sans toucher Trigger (re-qualify
  //                       au prochain cron quand Lead sera passé en NEW)
  //   - doNotContact    → IGNORED définitif (Lead opted-out RGPD, ne reviendra
  //                       jamais en contactable)
  //   - bouncedAt <30j  → IGNORED définitif (email déjà rebondi)
  //   - ARCHIVED        → IGNORED définitif (Lead déjà jugé inutilisable)
  if (triggerLite.lead) {
    const guard = checkLeadCanGenerate({
      doNotContact: triggerLite.lead.doNotContact,
      bouncedAt: triggerLite.lead.bouncedAt,
      status: triggerLite.lead.status,
    });
    if (!guard.ok) {
      if (guard.reason === "incomplete") {
        // Skip réversible — Lead reviendra en NEW post-enrichissement
        console.log(
          `[qualify-trigger.skip-incomplete] ${triggerId}: Lead INCOMPLETE — qualify reporté (re-tentative au prochain cron post-enrich)`,
        );
        return null;
      }
      // Skip définitif — doNotContact / bouncedAt / ARCHIVED
      const rejectReason = `[guard:${guard.reason}] ${guard.message}`;
      console.log(
        `[qualify-trigger.guard-blocked] ${triggerId}: IGNORED auto (${guard.reason})`,
      );
      await db.trigger.update({
        where: { id: triggerId },
        data: {
          score: 2,
          scoreReason: rejectReason.slice(0, 500),
          isHot: false,
          status: "IGNORED",
          ignoredAt: new Date(),
          ignoredReason: rejectReason.slice(0, 500),
        },
      });
      await archiveLeadOnTriggerIgnored(triggerId);
      return { opusScore: 2, reason: rejectReason, isHot: false };
    }
  }

  // 2-pre. ANTI-PERSONA HARD GATE (12/05/2026, audit Asys 28/04).
  //
  // Bug Asys : trigger apify.linkedin-jobs créé 28/04 → score 10 NEW → pool HOT
  // fitScore 100 alors que "Asys" est dans icp.antiPersonas DTL. Cause :
  // l'antiPersona "Asys" a été AJOUTÉ à l'ICP au Sprint B (06/05) — APRÈS
  // ingestion. Le brain V2 28/04 a justifié OUI ("éditeur SaaS RH"). Risque :
  // Fred contacte un concurrent direct.
  //
  // Fix défensif : check HARD sur companyName vs icp.antiPersonas. Si match
  // (substring case-insensitive sur anti ≥3 chars), force IGNORED sans appeler
  // Opus. Économie tokens + protection contre tout futur leak (mise à jour ICP,
  // nouveau filter, bug brain V2). Cohérent avec doctrine "redFlagsHard du
  // client = autorité absolue" (qualify-trigger SYSTEM ligne 916).
  const icp = triggerLite.client?.icp as { antiPersonas?: string[] } | null;
  const antiPersonas = (icp?.antiPersonas ?? [])
    .map((a) => (typeof a === "string" ? a.toLowerCase().trim() : ""))
    .filter((a) => a.length >= 3);
  if (antiPersonas.length > 0 && triggerLite.companyName) {
    const nameLower = triggerLite.companyName.toLowerCase();
    const matched = antiPersonas.find((a) => nameLower.includes(a));
    if (matched) {
      const rejectReason = `[antiPersona-hard:${matched}] companyName="${triggerLite.companyName}" match icp.antiPersonas — verdict NON forcé (skip brain V2)`;
      console.log(`[qualify-trigger.antiPersona-hard] ${triggerId}: IGNORED auto (matched=${matched})`);
      await db.trigger.update({
        where: { id: triggerId },
        data: {
          score: 2,
          scoreReason: rejectReason,
          isHot: false,
          status: "IGNORED",
          ignoredAt: new Date(),
          ignoredReason: rejectReason.slice(0, 500),
        },
      });
      await archiveLeadOnTriggerIgnored(triggerId);
      return { opusScore: 2, reason: rejectReason, isHot: false };
    }
  }

  // 2. C4-C5 pre-Opus reject (économie tokens — 0 cost si rejet ici).
  // Patterns rédhibitoires détectés avant V2 : régie ESN, freelance, alternance,
  // présentiel obligatoire, oversize >250p. Évite ~$0.16 V2 inutile.
  const fullDesc = extractFullDescription(triggerLite.rawPayload);
  const preReject = preOpusRejectScan(triggerLite.title ?? "", fullDesc ?? triggerLite.detail ?? "");
  if (preReject.reject) {
    const rejectReason = `[C4-C5 pre-V2-reject:${preReject.label}] Pattern rédhibitoire détecté avant V2`;
    console.log(`[qualify-trigger.C4C5] ${triggerId}: IGNORED auto (${preReject.label})`);
    await db.trigger.update({
      where: { id: triggerId },
      data: {
        score: 2,
        scoreReason: rejectReason,
        isHot: false,
        status: "IGNORED",
        // Fix F7 cohérent — pre-Opus reject doit aussi remplir ignoredReason/At.
        ignoredAt: new Date(),
        ignoredReason: rejectReason.slice(0, 500),
      },
    });
    await archiveLeadOnTriggerIgnored(triggerId);
    return { opusScore: 2, reason: rejectReason, isHot: false };
  }

  // 3. APPEL V2 SYNCHRONE (refactor 10/05 — plus de fire-and-forget).
  // qualifyTriggerV2WithValidation fait déjà : quota check, dossier build,
  // Opus call, Zod validation, validator strict. Renvoie shippable=true/false.
  const v2Result = await qualifyTriggerV2WithValidation(triggerId);

  if (!v2Result.brief) {
    // V2 totalement échoué (Opus error, Zod KO, dossier null, quota exceeded).
    const failReason = v2Result.reason ?? "V2 returned null";

    // Sprint reprise (17/05) — Distinction erreur transient (Anthropic down,
    // 429, network) vs logique (Zod, dossier null). Si transient, lève le
    // circuit breaker et laisse le trigger en status=NEW au lieu de IGNORED.
    if (isTransientAnthropicError(failReason)) {
      markAnthropicDown(failReason);
      console.warn(`[qualify-trigger.transient] ${triggerId}: NOT marked IGNORED, Anthropic seems down (${failReason.slice(0, 80)})`);
      return null;
    }

    // Erreur de logique : comportement historique (IGNORED + scoreReason).
    const reason = `[v2-failed] ${failReason}`.slice(0, 500);
    console.warn(`[qualify-trigger.v2-failed] ${triggerId}: ${reason}`);
    await db.trigger.update({
      where: { id: triggerId },
      data: { score: 2, scoreReason: reason, isHot: false, status: "IGNORED" },
    });
    await archiveLeadOnTriggerIgnored(triggerId);
    return null;
  }

  let v2Brief = v2Result.brief;
  let verdict = v2Brief.verdict;
  let conf = v2Brief.confidence;

  // Bug B12 fix (Session 3, 10/05/2026) + Fix B2 (11/05/2026 soir) — Si V2
  // dit OUI mais le NAF du trigger n'est PAS dans la whitelist ICP du
  // client, on downgrade en ENRICH par sécurité (filet anti faux-positif
  // Pappers obsolète).
  //
  // EXCEPTION B2 : si Opus a explicitement adressé le NAF obsolète dans
  // un risk (preuve qu'il a vu et statué OUI en connaissance de cause —
  // typique pour AdTech/SaaS qui n'ont pas re-déclaré leur activité),
  // on trust Opus et on skip le downgrade. Sinon Opus + B12 se neutralisent
  // mutuellement et le verdict final n'a plus de sens (cas Audion 11/05 :
  // briefV2Json OUI 78% mais score=6 stocké après downgrade B12).
  if (verdict === "OUI") {
    const trig = await db.trigger.findUnique({
      where: { id: triggerId },
      select: {
        companyNaf: true,
        client: { select: { icp: true } },
      },
    });
    const icpNafCodes = (trig?.client.icp as { naf_codes?: string[] } | null)
      ?.naf_codes;
    const triggerNaf = (trig?.companyNaf ?? "").replace(/\./g, "");
    if (
      icpNafCodes &&
      Array.isArray(icpNafCodes) &&
      icpNafCodes.length > 0 &&
      triggerNaf &&
      !icpNafCodes.some((c) => triggerNaf.startsWith(c.replace(/\./g, "")))
    ) {
      // Fix B2 — Vérifier si Opus a déjà adressé le NAF obsolète dans un risk.
      // Pattern de détection : description du risk mentionne le code NAF lui-même
      // OU les mots-clés "NAF" + ("obsolète"|"obsolete"|"manifestement"|"Pappers
      // obsolète"|"pivot non re-déclaré"|"hors whitelist"|"incohérent").
      const briefAddressedNaf = v2Brief.risks?.some((r) => {
        const desc = (r.description ?? "").toLowerCase();
        const mentionsNaf = desc.includes(triggerNaf.toLowerCase()) ||
          desc.includes((trig?.companyNaf ?? "").toLowerCase()) ||
          /\bnaf\b/.test(desc);
        const acknowledgesObsolete =
          /obsol[èe]te|incoh[ée]rent|pivot|non re-d[ée]clar|hors\s+whitelist|manifestement|pappers/.test(
            desc,
          );
        return mentionsNaf && acknowledgesObsolete;
      });

      if (briefAddressedNaf) {
        // Opus a vu et statué OUI en connaissance de cause → trust.
        console.log(
          `[qualify-trigger.B12-skip] ${triggerId}: NAF ${trig?.companyNaf} hors whitelist mais Opus a explicitement adressé l'obsolescence dans un risk — OUI maintenu ${conf}%.`,
        );
      } else {
        console.log(
          `[qualify-trigger.B12] ${triggerId}: NAF ${trig?.companyNaf} hors whitelist ICP — V2 OUI ${conf}% downgrade ENRICH (Opus n'a pas adressé l'obsolescence du NAF)`,
        );
        verdict = "ENRICH";
        conf = Math.min(conf, 60); // bornage : signal incertain
      }
    }
  }

  // 3-bis. FRESHNESS MIN GATE (12/05/2026, audit ICP DTL freshnessByTrigger).
  //
  // L'ICP du client peut définir une fenêtre min/max par type de signal :
  //   levee : minDays=15, maxDays=120 (Fred ne veut PAS approcher J0-J14)
  //   hireQA : minDays=0, maxDays=90
  //   changementCLevel : minDays=30, maxDays=180
  //
  // Le brain V2 SYSTEM prompt (ligne 944-948) gère bien le MAX (>90j → ENRICH/NON)
  // mais aucun gate MIN. Conséquence : RSS-levées capte J0-J14 qui passe en NEW
  // alors que Fred veut J+15+. Fix : si verdict OUI et trigger trop frais selon
  // minDays applicable au type, downgrade ENRICH + cap conf à 50 + log explicite.
  // Le lead reste visible (NEW) avec scoreReason "trop frais, ré-évaluer à J+X".
  if (verdict === "OUI" && triggerLite.publishedAt) {
    const minDays = getMinFreshnessDays(
      triggerLite.type,
      triggerLite.title ?? "",
      (triggerLite.client?.icp as { freshnessByTrigger?: Record<string, { minDays?: number }> } | null)
        ?.freshnessByTrigger ?? null,
    );
    if (minDays != null && minDays > 0) {
      const ageDays = (Date.now() - triggerLite.publishedAt.getTime()) / 86_400_000;
      if (ageDays < minDays) {
        const remainingDays = Math.max(1, Math.ceil(minDays - ageDays));
        console.log(
          `[qualify-trigger.freshness-min] ${triggerId}: type=${triggerLite.type} age=${ageDays.toFixed(1)}j < icp.minDays=${minDays} → downgrade OUI→ENRICH (attendre J+${remainingDays})`,
        );
        verdict = "ENRICH";
        conf = Math.min(conf, 50);
      }
    }
  }

  // 4. Mapping verdict + confidence → score 0-10 (compat UX existante).
  // Le score 0-10 reste utilisé par : tri dashboard, gates enrichissement
  // Kaspr/FullEnrich/HarvestAPI, isHot, alerts, credits, brief builder.
  let opusScore: number;
  if (verdict === "OUI") {
    if (conf >= 90) opusScore = 10;
    else if (conf >= 80) opusScore = 9;
    else if (conf >= 70) opusScore = 8;
    else if (conf >= 60) opusScore = 7;
    else opusScore = 6;
  } else if (verdict === "ENRICH") {
    if (conf >= 70) opusScore = 7;
    else if (conf >= 50) opusScore = 6;
    else opusScore = 5;
  } else {
    // NON
    opusScore = 2;
  }
  const isHot = opusScore >= 9;

  // 5. Status determination.
  // V2 NON ou !shippable → IGNORED safe (validator strict bloque).
  // V2 OUI ou ENRICH shippable → NEW (le commercial décide après enrichissement).
  let status: "NEW" | "IGNORED";
  if (verdict === "NON" || !v2Result.shippable) {
    status = "IGNORED";
  } else {
    status = "NEW";
  }

  // 6. Build scoreReason (cohérent avec la nouvelle UX V2).
  const reason = `[V2 ${verdict} conf=${conf}] ${v2Brief.thesis.slice(0, 200)}${
    !v2Result.shippable ? " (non-shippable→IGNORED)" : ""
  }`.slice(0, 500);

  // 7. B7 promotion : si re-qualify d'un IGNORED remonte le verdict → NEW.
  const promoteToNew = status === "NEW" && triggerLite.status === "IGNORED";

  // Fix B5 (12/05/2026) — Garde anti-hallucination opener.
  // Opus peut halluciner un prénom (ex. Kestra "Bonjour Ludovic," alors que
  // Lead.fullName = Denis Marc Auguste Andre Lafont — Ludovic = co-fondateur
  // connu de son training Anthropic). Avant de persister briefV2Json, on
  // vérifie que l'opener ne cite pas un prénom incompatible avec le Lead
  // actuel. Si desync → remplace l'opener par un fallback safe (Fred ne peut
  // pas copier-coller du contenu cassé), garde le reste du brief (verdict +
  // thesis + risks + sources restent valides).
  if (status === "NEW" && v2Brief.opener && v2Brief.opener.length >= 20) {
    const leadForCheck = await db.lead.findFirst({
      where: { triggerId, deletedAt: null },
      select: { firstName: true, lastName: true, fullName: true },
    });
    if (leadForCheck) {
      const desync = detectOpenerPersonaDesync(v2Brief.opener, leadForCheck);
      if (desync.isDesync) {
        // Fix Salvia/Yoni (14/05) — Distingue les 2 cas :
        // (a) Lead a persona MAIS différente du prénom Opus → désync vraie
        // (b) Lead sans aucune persona + Opus a cité un prénom → hallucination
        const hasAnyLeadPersona = !!(leadForCheck.firstName || leadForCheck.lastName || leadForCheck.fullName);
        const safeFallback = hasAnyLeadPersona
          ? `(Brief opener désynchronisé — Opus a cité "${desync.briefName}" mais le contact actuel est "${leadForCheck.fullName ?? "inconnu"}". Régénérer manuellement avant outreach.)`
          : `(Brief opener halluciné — Opus a cité "${desync.briefName}" mais aucune persona n'est encore posée sur ce Lead. Attendre HarvestAPI/Pappers avant outreach.)`;
        console.warn(
          `[qualify-trigger.V2-desync-guard] ${triggerId}: opener cite "${desync.briefName}" ${hasAnyLeadPersona ? `≠ Lead "${leadForCheck.fullName}"` : "alors que Lead sans persona (hallucination)"}. Opener remplacé par fallback.`,
        );
        v2Brief = { ...v2Brief, opener: safeFallback };
      }
    }
  }

  // 8. Update Trigger : score mappé + briefV2Json + status + isHot.
  // Fix F7 (12/05/2026) — Bug ignoredReason=null : audit A.0.1 a montré 231/245
  // IGNORED avec ignoredReason=null (raison réelle uniquement dans scoreReason).
  // On copie scoreReason → ignoredReason + ignoredAt quand status passe à IGNORED
  // pour que les audits futurs et le dashboard puissent lire la raison directement.
  await db.trigger.update({
    where: { id: triggerId },
    data: {
      score: opusScore,
      scoreReason: reason,
      isHot,
      status,
      briefV2Json: v2Brief as unknown as object,
      ...(status === "IGNORED"
        ? { ignoredAt: new Date(), ignoredReason: reason.slice(0, 500) }
        : {}),
    },
  });

  // 9. Sync Lead status (cohérence dashboard).
  if (status === "IGNORED") {
    await archiveLeadOnTriggerIgnored(triggerId);
  } else if (promoteToNew) {
    await unarchiveLeadOnTriggerRevived(triggerId);
  }

  // 10. Logs structurés.
  if (status === "IGNORED") {
    console.log(
      `[qualify-trigger.V2] ${triggerId}: IGNORED (verdict=${verdict} conf=${conf} shippable=${v2Result.shippable})`,
    );
  } else if (promoteToNew) {
    console.log(
      `[qualify-trigger.V2-promote] ${triggerId}: IGNORED→NEW (verdict=${verdict} conf=${conf})`,
    );
  } else {
    console.log(
      `[qualify-trigger.V2] ${triggerId}: NEW (verdict=${verdict} conf=${conf} score=${opusScore})`,
    );
  }

  // 11. Debit credit (idempotent, score >= 6 = NEW visible dashboard).
  if (status === "NEW" && opusScore >= 6) {
    try {
      const debit = await debitCreditForQualifiedLead({
        clientId: triggerLite.clientId,
        triggerId,
        score: opusScore,
      });
      if (debit.debited) {
        console.log(
          `[qualify-trigger.credit] ${triggerId} debit ${debit.isPepite ? "PEPITE" : "qualif"} score=${opusScore} balance=${debit.balanceAfter}`,
        );
      }
    } catch (e) {
      console.warn(
        `[qualify-trigger.credit] ${triggerId} debit failed:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // 12. UX5 fix 10/05 — Auto-enrichissement immédiat après qualifyTrigger NEW.
  // Avant : leads attendaient le cron 8h+18h UTC pour être enrichis Kaspr/
  // FullEnrich/HarvestAPI → jusqu'à 12h de latence. Maintenant : on déclenche
  // fire-and-forget les 3 enrichers avec limit=1 immédiatement. Le nouveau
  // lead est en tête de queue (NULLS FIRST sur attemptedAt) donc il sera
  // pris en priorité. Coût marginal ~$0.15-0.20 par new lead.
  //
  // Idempotent : les enrichers ont leurs propres TTL (Kaspr 30j, FullEnrich
  // 30j) donc re-qualify d'un lead déjà enrichi ne re-call pas.
  if (status === "NEW" && opusScore >= 6) {
    void triggerImmediateEnrichment(triggerLite.clientId).catch((e) => {
      console.warn(
        `[qualify-trigger.auto-enrich] ${triggerId} err :`,
        e instanceof Error ? e.message : e,
      );
    });
  }

  return { opusScore, reason, isHot };
}

/**
 * UX5 fix 10/05 — Auto-enrichissement fire-and-forget après qualifyTrigger NEW.
 *
 * Déclenche Kaspr + FullEnrich + HarvestAPI search-by-company avec limit=1
 * chacun. Le nouveau lead est prioritaire grâce au tri NULLS FIRST sur
 * attemptedAt dans chaque enricher. Coût marginal ~$0.15-0.20 par new lead.
 */
async function triggerImmediateEnrichment(clientId: string): Promise<void> {
  // Import dynamique pour éviter circular deps + lazy load
  const [{ enrichLeadsViaKasprDirect }, { enrichLeadsViaFullEnrich }, { enrichDecisionMakersForClient }] = await Promise.all([
    import("@/lib/enrich-via-kaspr-direct"),
    import("@/lib/enrich-via-fullenrich"),
    import("@/lib/harvestapi-decision-makers"),
  ]);
  // Parallèle pour latence min — chaque enricher gère son propre rate-limit
  await Promise.allSettled([
    enrichLeadsViaKasprDirect(clientId, { limit: 1 }),
    enrichLeadsViaFullEnrich(clientId, { limit: 1 }),
    enrichDecisionMakersForClient(clientId, { limit: 1 }),
  ]);
}

// Refactor V2-only Session 3 (10/05) — qualifyTriggerV2Shadow supprimé.
// La fonction faisait le V2 fire-and-forget shadow + override. Maintenant V2
// est synchrone dans qualifyTrigger() (Session 1), ce shadow est mort.

/**
 * Qualifie tous les Triggers d'un client qui n'ont pas encore été évalués
 * par Opus (scoreReason = null). Limite par batch pour budget tokens.
 */
export async function qualifyPendingTriggers(
  clientId: string,
  opts: { limit?: number } = {},
): Promise<{ qualified: number; errors: number; skipped?: string }> {
  // Sprint reprise (17/05) — Circuit breaker : skip tout le cycle si
  // Anthropic indisponible. Évite de boucler 30× sur un service down.
  if (await isAnthropicDown()) {
    console.warn(`[qualify-pending] client=${clientId}: skip cycle — Anthropic circuit breaker open`);
    return { qualified: 0, errors: 0, skipped: "anthropic-down" };
  }
  const limit = opts.limit ?? 30;
  // Fix B6 (11/05/2026) — Élargir le filtre pour piocher aussi les triggers
  // déjà scorés V1 par leur poller (rss-levees attribue scoreReason inline)
  // mais qui n'ont pas encore de briefV2Json. Sans ça, ces triggers restaient
  // bloqués en NEW indéfiniment (cas MACHINA + OpsMill du 11/05).
  const pending = await db.trigger.findMany({
    where: {
      clientId,
      deletedAt: null,
      OR: [
        // V1 path : pas encore scoré du tout
        { scoreReason: null },
        // V2 path : pas encore qualifié V2 (mais peut être déjà pré-scoré V1
        // par le poller). On restreint aux status NEW pour ne pas rejouer
        // sur les IGNORED/ARCHIVED.
        {
          AND: [
            { briefV2Json: { equals: Prisma.DbNull } },
            { status: "NEW" },
          ],
        },
      ],
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

export const QUALIFY_V2_SPECIFIC = `

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
- **Si le bloc POSTS RÉCENTS LINKEDIN existe** et contient un post pertinent au signal (ex: décideur a posté "on adopte Cypress" et signal = QA-hire), **personnalise l'opener** en citant ce post : ouvre par "J'ai vu votre post du JJ/MM sur X..." → signal d'attention authentique, taux de réponse multiplié par 3-5×. Ne fabrique PAS un post qui n'existe pas (hallucination = killer).
- Ton iFIND : direct, pro, francophone soutenu mais pas guindé. PAS d'emoji.
- AUCUNE promesse "doubler le CA / x10 ROI" sans data
- AUCUN CTA Cal.com / lien réservation : le client gère son propre lien d'agenda. Termine par une question ouverte ou "30 min pour échanger ?"
- Pas de signature : le commercial mettra la sienne.
- Cible D.3 stricte : ≤250 mots.
- Si verdict=NON ou verdict=ENRICH : opener court "(Hors ICP — pas d'opener)" ou "(Verdict ENRICH — opener à finaliser après enrichissement)" — minimum 20 chars, maximum quelques phrases pour expliquer pourquoi.

**INTERDICTION ABSOLUE des placeholders dans l'opener** (bug B3 récurrent) :
- N'écris JAMAIS \`[Prénom]\`, \`[Nom]\`, \`[Société]\`, \`[Décideur]\` ou tout autre placeholder entre crochets dans l'opener. Le commercial copie-colle l'opener TEL QUEL dans son email — un placeholder non substitué = email embarrassant.
- Si tu connais le prénom du décideur (champ \`Décideur identifié : <Prénom Nom>\` dans le dossier), utilise-le : \`Bonjour Eric,\`
- Si le prénom est \`non résolu\` ou \`non encore calculée\`, écris simplement \`Bonjour,\` (sans prénom). Le commercial pourra ajouter le prénom manuellement après recherche LinkedIn.
- Idem pour la société : utilise toujours le vrai nom de la société cible (issu de \`Entreprise : <Nom>\` ou \`companyName\`), jamais \`[Société]\`.

### Cas spécial — NAF Pappers potentiellement obsolète (fix B2, 11/05/2026)

Certains codes NAF sont fréquemment **obsolètes** pour des boîtes tech qui ont pivoté sans re-déclarer leur activité auprès du registre. Cas observé en prod : Audion (74.2A "photographie") = AdTech SaaS B2B IA audio publicitaire avec levée 15M USD. Le NAF n'a pas suivi le pivot business.

**Liste des NAF potentiellement obsolètes pour boîtes tech** :
- \`74.2A\` (activités photographiques)
- \`70.22Z\` (conseil pour les affaires)
- \`46.90Z\` (commerce de gros non spécialisé)
- \`78.30Z\` (autre mise à disposition de personnel)
- \`82.99Z\` (autres activités de soutien aux entreprises)
- \`70.10Z\` (activités des sièges sociaux)
- \`64.20Z\` (activités des sociétés holding)
- \`68.20A/B\` (location immobilier — souvent SCI ancien)

**Règle** : quand le NAF Pappers fait partie de cette liste OU n'est PAS dans la whitelist ICP du client :
- **Si tu as ≥2 signaux forts indiquant que la boîte est tech/SaaS** :
  * Source = \`rodz.fundraising\`, \`rss-levees\`, ou \`*-funding\`
  * CTO/Head of Eng/VP Engineering identifié dans Décideur ou LinkedIn
  * Mots-clés "SaaS", "platform", "AI", "software", "AdTech", "FinTech", "MarTech", "DeepTech" dans le titre/description/site web
  * Nom de société contenant "tech", "soft", "platform", "ai", "data"
  → **Maintenir verdict OUI** avec un \`risk\` de sévérité \`medium\` mentionnant explicitement : "NAF Pappers <code> potentiellement obsolète (boîte tech qui n'a pas re-déclaré). À confirmer côté Fred avant outreach via site web ou pitch deck."
- **Si signaux faibles ou contradictoires** : verdict ENRICH avec \`enrichmentNeeded\` ["Vérifier activité réelle via site web", "Confirmer NAF actualisé via INPI/Bodacc récent"].

Le bias par défaut = NE PAS bloquer un signal d'achat fort à cause d'un NAF possiblement obsolète. Mieux vaut un risk explicite que faire passer un OUI en ENRICH par sur-prudence.

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

export const QUALIFY_V2_USER_SUFFIX = `

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

  // Audit 16/05 — Skip Opus si Lead bloqué (RGPD / bounce / INCOMPLETE / ARCHIVED).
  // Évite de cramer ~$0.16/call Opus pour un Lead qui ne sera jamais contacté.
  if (dossier.lead) {
    const guard = checkLeadCanGenerate({
      doNotContact: dossier.lead.doNotContact,
      bouncedAt: dossier.lead.bouncedAt,
      status: dossier.lead.status,
    });
    if (!guard.ok) {
      console.log(
        `[qualify-trigger-v2.skip] ${triggerId} reason=${guard.reason} — ${guard.message}`,
      );
      return null;
    }
  }

  const userPrompt = formatDossierForOpus(dossier) + QUALIFY_V2_USER_SUFFIX;
  const icp = dossier.client.icp;

  try {
    // Sprint 8 — Quota check AVANT V2 brief (~$0.04 estimation max_tokens 2000 + cache)
    const quotaCheck = await checkQuota(dossier.client.id, "anthropic", 0.04);
    if (!quotaCheck.ok) {
      console.warn(
        `[qualify-trigger-v2.quota-blocked] ${triggerId} client=${dossier.client.id} reason=${quotaCheck.reason}`,
      );
      return null;
    }

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
    // Sprint 8 — record cost reel V2
    const actualCostUsd = computeAnthropicCost(QUALIFY_MODEL, u);
    await recordSpend(dossier.client.id, "anthropic", actualCostUsd).catch((e) =>
      console.warn(`[qualify-trigger-v2.recordSpend] ${triggerId} failed: ${e instanceof Error ? e.message : e}`),
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
