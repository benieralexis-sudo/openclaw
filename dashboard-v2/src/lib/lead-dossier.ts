import "server-only";
import { db } from "@/lib/db";
import {
  formatLinkedinProfileForJudge,
  getNegativeSignalsForCompany,
  getPriorSignalsForCompany,
  getCrossTenantSignal,
  formatEuros,
  extractFullDescription,
  type NegativeSignalResult,
} from "@/lib/qualify-trigger";
import { searchCompanyNews, formatCompanyNewsBlock } from "@/lib/layoffs-news-search";
import { fetchCompanyWebsiteSummary, formatCompanyWebsiteBlock } from "@/lib/company-website-fetcher";

/**
 * Sprint C.5 (07/05/2026) — LeadDossier unifié.
 *
 * Centralise l'assemblage du contexte présenté au judge en un objet
 * structuré + un renderer. Permet :
 *   - À Sprint D (verdict OUI/NON/ENRICH avec citations [src:#X]) de
 *     réutiliser cette structure plutôt que ré-assembler ad-hoc.
 *   - Au backfill / test / debug d'inspecter le contexte exact qu'a vu
 *     Opus pour un trigger donné.
 *   - Aux futurs clients (multi-tenant) d'avoir une API stable.
 *
 * Stratégie refactor INCRÉMENTALE :
 * - qualify-trigger.ts continue d'assembler son userPrompt comme aujourd'hui
 *   (zéro risque de casse pour cette session)
 * - lead-dossier.ts expose une API parallèle : buildLeadDossierForJudge()
 *   + formatDossierForOpus() qui produit le MÊME userPrompt
 * - Tests : un script vérifie la cohérence entre les 2 chemins
 * - Sprint D : qualify-trigger sera switché pour utiliser lead-dossier
 *
 * Helpers réutilisés depuis qualify-trigger.ts (exportés Sprint C.5) :
 *   formatLinkedinProfileForJudge, getNegativeSignalsForCompany,
 *   getPriorSignalsForCompany, getCrossTenantSignal, formatEuros,
 *   extractFullDescription.
 */

// ──────────────────────────────────────────────────────────────────────
// Interface LeadDossier
// ──────────────────────────────────────────────────────────────────────

export interface LeadDossierClient {
  // Sprint 8 (10/05/2026) — id ajoute pour quota-checker
  id: string;
  name: string;
  icp: Record<string, unknown>;
}

export interface LeadDossierTrigger {
  id: string;
  type: string;
  sourceCode: string;
  title: string | null;
  detail: string | null;
  capturedAt: Date;
  publishedAt: Date | null;
  companyName: string | null;
  companySiret: string | null;
  companyNaf: string | null;
  industry: string | null;
  region: string | null;
  size: string | null;
  rawPayload: unknown;
  fullDescription: string | null;
  // Audit 16/05 — Signaux internes propriétaires (priorityScore engine + multi-source).
  // Le multiSourceBoost (combo cross-sources) est le moat iFIND, doit être visible
  // par Opus pour qu'il en tienne compte explicitement dans thesis/confidence.
  multiSourceBoost: number;
  freshnessScore: number | null;
  priorityScore: number | null;
}

export interface LeadDossierLead {
  fitScore: number | null;
  personaTier: number | null;
  fullName: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
  linkedinProfileJson: unknown;
  companyHasInsolvency: boolean;
  companyRecentDepots: unknown;
  companyEtabsCount: number | null;
  companyRevenue: number | null;
  companyResultNet: number | null;
  // Audit 16/05 — Contexte décisionnel pour Opus.
  // holdingPath (Fix B4 du 11/05) : chemin de holding si enrichissement Pappers
  // a remonté via holding pour trouver le dirigeant.
  // jobMoveDetected + previousCompany/Job : signal d'achat C-level <6m.
  // emailConfidence/SourceCount + dataQuality : calibre la confidence Opus.
  // emailStatus : pour info (VALID/RISKY/INVALID/BOUNCED).
  // status : pour Opus voie si Lead est encore actionnable.
  holdingPath: string | null;
  jobMoveDetected: boolean;
  previousCompany: string | null;
  previousJob: string | null;
  emailConfidence: number;
  emailSourceCount: number;
  dataQuality: number;
  emailStatus: string | null;
  status: string | null;
  // Audit 16/05 — Guards RGPD (utilisés par checkLeadCanGenerate dans qualifyTriggerV2).
  doNotContact: boolean;
  bouncedAt: Date | null;
}

export interface LeadDossierBlocks {
  /** Bloc PERSONA QUAL + COMPANY HEALTH (Sprint 1 Q1 + Sprint 2 B.1/B.2/B.3) */
  persona: string;
  /** Bloc Cross-tenant (Sprint 5) — null si pas d'autre client iFIND sur ce SIRET */
  crossTenant: string;
  /** Bloc PRIOR SIGNALS + COMBO PATTERNS (Sprint 6 + Sprint C.3) */
  priorSignals: string;
  /** Bloc NEGATIVE SIGNALS (Sprint 9) — structuré pour permettre hard-cap downstream */
  negativeSignals: NegativeSignalResult | null;
  /** Bloc COMPANY WEBSITE summary (Sprint C.1) */
  companyWebsite: string;
  /** Bloc COMPANY NEWS positives + négatives (Sprint C.2) */
  companyNews: string;
  /** Bloc CLIENT ENRICHED (Sprint B.3 — réponses Fred 9 questions) */
  fredEnriched: string;
}

export interface LeadDossier {
  triggerId: string;
  client: LeadDossierClient;
  trigger: LeadDossierTrigger;
  /** null si Lead pas encore créé (qualify peut être appelé avant auto-create) */
  lead: LeadDossierLead | null;
  blocks: LeadDossierBlocks;
}

// ──────────────────────────────────────────────────────────────────────
// Factory : buildLeadDossierForJudge
// ──────────────────────────────────────────────────────────────────────

/**
 * Construit un LeadDossier complet pour le triggerId donné. Effectue tous
 * les fetches DB + appels externes (Pappers via Lead, Google CSE news,
 * homepage scraper, cross-tenant query, etc.).
 *
 * Returns null si :
 *   - le trigger n'existe pas
 *   - le client a pas d'ICP configuré
 */
export async function buildLeadDossierForJudge(
  triggerId: string,
): Promise<LeadDossier | null> {
  const trigger = await db.trigger.findUnique({
    where: { id: triggerId },
    include: {
      client: { select: { id: true, name: true, icp: true } },
      lead: {
        select: {
          fitScore: true,
          personaTier: true,
          fullName: true,
          jobTitle: true,
          linkedinUrl: true,
          linkedinProfileJson: true,
          companyHasInsolvency: true,
          companyRecentDepots: true,
          companyEtabsCount: true,
          companyRevenue: true,
          companyResultNet: true,
          // Audit 16/05 — nouveaux champs Lead transmis au dossier Opus
          holdingPath: true,
          jobMoveDetected: true,
          previousCompany: true,
          previousJob: true,
          emailConfidence: true,
          emailSourceCount: true,
          dataQuality: true,
          emailStatus: true,
          status: true,
          doNotContact: true,
          bouncedAt: true,
        },
      },
    },
  });
  if (!trigger) return null;
  if (!trigger.client?.icp) return null;

  const icp = trigger.client.icp as Record<string, unknown>;
  const fullDescription = extractFullDescription(trigger.rawPayload);

  // ── Bloc PERSONA + COMPANY HEALTH ──
  let personaBlock = "";
  if (trigger.lead) {
    const lead = trigger.lead;
    const linkedinSummary = formatLinkedinProfileForJudge(lead.linkedinProfileJson);
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

    // Audit 16/05 — bloc holding/job-move/qualité data
    const contextLines: string[] = [];
    if (lead.holdingPath) {
      contextLines.push(`Chemin holding : ${lead.holdingPath} (décideur trouvé via cascade Pappers)`);
    }
    if (lead.jobMoveDetected && lead.previousCompany) {
      contextLines.push(
        `Job move récent : ${lead.fullName ?? "le décideur"} arrive de ${lead.previousCompany}${lead.previousJob ? ` (ex ${lead.previousJob})` : ""} — signal d'achat C-level <6m`,
      );
    }
    const dataQualityLine: string[] = [];
    if (lead.dataQuality > 0) dataQualityLine.push(`dataQuality ${lead.dataQuality}/100`);
    if (lead.emailConfidence > 0 || lead.emailSourceCount > 0) {
      dataQualityLine.push(`emailConfidence ${lead.emailConfidence}/100 (${lead.emailSourceCount} sources)`);
    }
    if (lead.emailStatus && lead.emailStatus !== "UNVERIFIED") {
      dataQualityLine.push(`emailStatus=${lead.emailStatus}`);
    }
    if (dataQualityLine.length > 0) {
      contextLines.push(`Qualité données : ${dataQualityLine.join(" — ")}`);
    }
    if (lead.status && lead.status !== "NEW") {
      contextLines.push(`statut Lead : ${lead.status}`);
    }
    const contextBlock = contextLines.length > 0
      ? `\nCONTEXTE DATA :\n- ${contextLines.join("\n- ")}`
      : "";

    personaBlock = `\nPERSONA QUAL (calcul interne) :
- fitScore : ${lead.fitScore ?? "non calculé"} / 100
- personaTier : ${lead.personaTier ?? "non calculé"} / 4 (1=parfait, 4=fallback)
- Décideur identifié : ${lead.fullName ?? "non résolu"} (${lead.jobTitle ?? "?"})
- LinkedIn : ${lead.linkedinUrl ?? "non résolu"}${linkedinSummary ? `\n${linkedinSummary}` : ""}${healthBlock}${contextBlock}`;
  } else {
    personaBlock = `\nPERSONA QUAL : non encore calculée (Lead pas créé)`;
  }

  // ── Bloc Cross-tenant (Sprint 5) ──
  const crossTenantSignal = await getCrossTenantSignal(
    trigger.clientId,
    trigger.companySiret,
  );
  const crossTenant = crossTenantSignal ? `\n${crossTenantSignal}` : "";

  // ── Bloc PRIOR SIGNALS + COMBO (Sprint 6 + C.3) ──
  const priorSignals = await getPriorSignalsForCompany(
    trigger.clientId,
    trigger.companySiret,
    triggerId,
    {
      type: trigger.type,
      capturedAt: trigger.capturedAt,
      sourceCode: trigger.sourceCode,
      title: trigger.title,
    },
  );
  const priorSignalsBlock = priorSignals ? `\n${priorSignals}` : "";

  // ── Bloc NEGATIVE SIGNALS (Sprint 9) ──
  const negativeSignals = trigger.lead
    ? getNegativeSignalsForCompany(trigger.lead.companyRecentDepots)
    : null;

  // ── Bloc COMPANY WEBSITE (Sprint C.1) ──
  let companyWebsiteBlock = "";
  if (trigger.companyName) {
    try {
      const summary = await fetchCompanyWebsiteSummary(
        trigger.companyName,
        trigger.companySiret,
        trigger.rawPayload,
      );
      const formatted = formatCompanyWebsiteBlock(summary);
      if (formatted) companyWebsiteBlock = `\n${formatted}`;
    } catch {
      // silent fail
    }
  }

  // ── Bloc COMPANY NEWS (Sprint C.2) ──
  let companyNewsBlock = "";
  if (trigger.companyName) {
    try {
      const news = await searchCompanyNews(trigger.companyName, { dateRestrict: "m1" });
      const formatted = formatCompanyNewsBlock(news);
      if (formatted) companyNewsBlock = `\n${formatted}`;
    } catch {
      // silent fail
    }
  }

  // ── Bloc CLIENT ENRICHED (Sprint B.3 — Fred 9 questions) ──
  const fredEnriched = buildFredEnrichedBlock(icp);

  return {
    triggerId,
    client: { id: trigger.client.id, name: trigger.client.name, icp },
    trigger: {
      id: trigger.id,
      type: trigger.type,
      sourceCode: trigger.sourceCode,
      title: trigger.title,
      detail: trigger.detail,
      capturedAt: trigger.capturedAt,
      publishedAt: trigger.publishedAt,
      companyName: trigger.companyName,
      companySiret: trigger.companySiret,
      companyNaf: trigger.companyNaf,
      industry: trigger.industry,
      region: trigger.region,
      size: trigger.size,
      rawPayload: trigger.rawPayload,
      fullDescription,
      // Audit 16/05 — signaux internes
      multiSourceBoost: trigger.multiSourceBoost ?? 0,
      freshnessScore: trigger.freshnessScore,
      priorityScore: trigger.priorityScore,
    },
    lead: trigger.lead,
    blocks: {
      persona: personaBlock,
      crossTenant,
      priorSignals: priorSignalsBlock,
      negativeSignals,
      companyWebsite: companyWebsiteBlock,
      companyNews: companyNewsBlock,
      fredEnriched,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Bloc CLIENT ENRICHED (Sprint B.3) — réponses Fred 9 questions
// ──────────────────────────────────────────────────────────────────────

function buildFredEnrichedBlock(icp: Record<string, unknown>): string {
  const dreamArchetype = typeof icp.dreamArchetype === "string" ? icp.dreamArchetype : null;
  const signalPrimary = typeof icp.signalPrimary === "string" ? icp.signalPrimary : null;
  const signalSecondary = typeof icp.signalSecondary === "string" ? icp.signalSecondary : null;
  const redFlagsHard = Array.isArray(icp.redFlagsHard) ? (icp.redFlagsHard as string[]) : null;
  const redFlagsSoft = Array.isArray(icp.redFlagsSoft) ? (icp.redFlagsSoft as string[]) : null;
  const nonRedFlags = Array.isArray(icp.nonRedFlags) ? (icp.nonRedFlags as string[]) : null;
  const fewShotPositives = (icp.fewShotPositives && typeof icp.fewShotPositives === "object")
    ? (icp.fewShotPositives as Record<string, unknown>)
    : null;
  const pitchVerbatim = typeof icp.pitchVerbatim === "string" ? icp.pitchVerbatim : null;
  const freshnessByTrigger = (icp.freshnessByTrigger && typeof icp.freshnessByTrigger === "object")
    ? (icp.freshnessByTrigger as Record<string, unknown>)
    : null;

  const lines: string[] = [];
  if (dreamArchetype) {
    lines.push(`dreamArchetype : "${dreamArchetype}"`);
  }
  if (signalPrimary) {
    lines.push(`signalPrimary (signal #1 du client, à évaluer en priorité) : ${signalPrimary}`);
  }
  if (signalSecondary) {
    lines.push(`signalSecondary (signal mou, pondère plus faiblement) : ${signalSecondary}`);
  }
  if (redFlagsHard && redFlagsHard.length > 0) {
    lines.push(`redFlagsHard (match → score ≤ 2 systématique) :\n  - ${redFlagsHard.join("\n  - ")}`);
  }
  if (redFlagsSoft && redFlagsSoft.length > 0) {
    lines.push(`redFlagsSoft (match → -2 points plancher 4, pas exclusion) :\n  - ${redFlagsSoft.join("\n  - ")}`);
  }
  if (nonRedFlags && nonRedFlags.length > 0) {
    lines.push(`nonRedFlags (NE PAS pénaliser ces critères, le client a tranché) :\n  - ${nonRedFlags.join("\n  - ")}`);
  }
  if (fewShotPositives) {
    const sublines: string[] = [];
    if (Array.isArray(fewShotPositives.confirmedClients)) {
      const names = (fewShotPositives.confirmedClients as Array<Record<string, unknown>>)
        .map((c) => String(c.name ?? "?"))
        .filter(Boolean);
      if (names.length > 0) {
        sublines.push(`confirmedClients (déjà signés — match → score ≥ 8) : ${names.join(", ")}`);
      }
    }
    if (Array.isArray(fewShotPositives.dreamProspects)) {
      const names = (fewShotPositives.dreamProspects as Array<Record<string, unknown>>)
        .map((c) => String(c.name ?? "?"))
        .filter(Boolean);
      if (names.length > 0) {
        sublines.push(`dreamProspects (cibles validées par jugement — match → score ≥ 7) : ${names.join(", ")}`);
      }
    }
    if (sublines.length > 0) {
      lines.push(`fewShotPositives :\n  - ${sublines.join("\n  - ")}`);
    }
  }
  if (freshnessByTrigger) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(freshnessByTrigger)) {
      if (v && typeof v === "object" && "minDays" in (v as object)) {
        const w = v as { minDays?: number; maxDays?: number; staleAfterDays?: number };
        parts.push(`${k}: J+${w.minDays ?? "?"} → J+${w.maxDays ?? "?"}${w.staleAfterDays ? ` (stale après J+${w.staleAfterDays})` : ""}`);
      }
    }
    if (parts.length > 0) {
      lines.push(`freshnessByTrigger : ${parts.join(", ")}`);
    }
  }
  if (pitchVerbatim) {
    lines.push(`pitchVerbatim (style/ton du client pour cohérence brief) : "${pitchVerbatim.slice(0, 600)}"`);
  }

  return lines.length > 0
    ? `\n\nCLIENT ENRICHED (réponses fondateur, autorité maximale) :\n${lines.map((s) => `- ${s}`).join("\n")}`
    : "";
}

// ──────────────────────────────────────────────────────────────────────
// Renderer : formatDossierForOpus
// ──────────────────────────────────────────────────────────────────────

/**
 * Sérialise un LeadDossier en userPrompt string pour l'envoi à Opus.
 * Reproduit EXACTEMENT le format actuel de qualify-trigger.ts pour permettre
 * un switch sans regression.
 */
export function formatDossierForOpus(dossier: LeadDossier): string {
  const { client, trigger, blocks } = dossier;
  const icp = client.icp;
  const detailToSend = trigger.fullDescription ?? trigger.detail ?? "(vide)";

  return `CLIENT : ${client.name}
ICP : ${JSON.stringify({
    industries: icp.industries,
    sizes: icp.sizes,
    naf_codes: icp.naf_codes,
    personaTitles: icp.personaTitles,
    keywordsHiring: icp.keywordsHiring,
    antiPersonas: icp.antiPersonas,
    preferredSignals: icp.preferredSignals,
    minScore: icp.minScore,
  })}${blocks.fredEnriched}

LEAD :
- Entreprise : ${trigger.companyName}
- SIRET/SIREN : ${trigger.companySiret ?? "non résolu"}
- NAF : ${trigger.companyNaf ?? "?"}
- Industrie : ${trigger.industry ?? "?"}
- Région : ${trigger.region ?? "?"}
- Taille : ${trigger.size ?? "?"}
${blocks.persona}${blocks.crossTenant}${blocks.priorSignals}${blocks.negativeSignals ? `\n${blocks.negativeSignals.block}` : ""}${blocks.companyWebsite}${blocks.companyNews}

SIGNAL :
- Type : ${trigger.type}
- Source : ${trigger.sourceCode}
- Titre : ${trigger.title}
- Détail : ${detailToSend}
- Capté : ${trigger.capturedAt.toISOString()}
- Publié : ${trigger.publishedAt?.toISOString() ?? "?"}${trigger.multiSourceBoost > 0 ? `\n- ⚡ Multi-source boost : ${trigger.multiSourceBoost}/30 (combo cross-sources sur 7j — moat iFIND, augmente fortement la conviction)` : ""}${trigger.freshnessScore != null ? `\n- Freshness : ${trigger.freshnessScore}/100 (décroissance exponentielle demi-vie 14j)` : ""}${trigger.priorityScore != null ? `\n- PriorityScore composite : ${trigger.priorityScore}` : ""}

Évalue ce lead pour ${client.name}.`;
}

/**
 * Helper debug : pretty-print du dossier en JSON (sans le rawPayload qui
 * est volumineux). Utile pour les scripts d'audit/inspection.
 */
export function formatDossierAsJsonForDebug(dossier: LeadDossier): string {
  const cleaned = {
    triggerId: dossier.triggerId,
    client: { name: dossier.client.name, icpKeys: Object.keys(dossier.client.icp) },
    trigger: {
      ...dossier.trigger,
      rawPayload: dossier.trigger.rawPayload ? "[redacted]" : null,
      fullDescription: dossier.trigger.fullDescription
        ? `${dossier.trigger.fullDescription.slice(0, 200)}...`
        : null,
    },
    lead: dossier.lead
      ? {
          ...dossier.lead,
          linkedinProfileJson: dossier.lead.linkedinProfileJson ? "[present]" : null,
          companyRecentDepots: Array.isArray(dossier.lead.companyRecentDepots)
            ? `[${dossier.lead.companyRecentDepots.length} items]`
            : null,
        }
      : null,
    blocksLengths: {
      persona: dossier.blocks.persona.length,
      crossTenant: dossier.blocks.crossTenant.length,
      priorSignals: dossier.blocks.priorSignals.length,
      negativeSignals: dossier.blocks.negativeSignals?.block.length ?? 0,
      companyWebsite: dossier.blocks.companyWebsite.length,
      companyNews: dossier.blocks.companyNews.length,
      fredEnriched: dossier.blocks.fredEnriched.length,
    },
  };
  return JSON.stringify(cleaned, null, 2);
}
