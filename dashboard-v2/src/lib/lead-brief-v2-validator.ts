import type { LeadBriefV2 } from "@/lib/lead-brief-v2";

/**
 * Sprint D.3 (07/05/2026) — Validator strict LeadBriefV2.
 *
 * Le schéma Zod (Sprint D.1) garantit la STRUCTURE du brief (verdict valide,
 * confidence 0-100, thesis ≥20c, risks ≥2, sources ≥1, etc.). Mais il ne
 * garantit pas la QUALITÉ du contenu :
 *   - Opener peut être 800 mots (≤2000 chars autorisé Zod, mais cible commerciale ≤250 mots)
 *   - Thesis peut ne contenir aucune citation [src:#X] alors qu'on lui en a demandé
 *   - Risks high/medium peuvent ne citer aucune source (donc pas de traçabilité)
 *   - Sources peuvent contenir des ids cités mais inexistants (citations cassées)
 *   - ENRICH peut être verdict mais enrichmentNeeded vide
 *
 * Le validator strict applique ces règles métier additionnelles. Sortie :
 * `{ ok, errors[], warnings[] }`. Les errors bloquent (validator KO),
 * warnings signalent des incohérences mineures sans bloquer.
 *
 * Le wrapper `qualifyTriggerV2WithValidation` (qualify-trigger.ts) compose
 * Zod parse + validator strict pour décider si un brief V2 est "shippable"
 * en prod ou s'il faut fallback sur le judge v1 (mode déploiement à
 * trancher Sprint D.5).
 *
 * Pure function : pas d'I/O, pas de DB, pas de side-effect. Testable trivialement.
 */

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Métriques utiles à logger pour observabilité (D.5 shadow mode) */
  metrics: {
    openerWordCount: number;
    citationsInThesis: number;
    citationsInOpener: number;
    citationsInRisks: number;
    sourcesCited: number;
    sourcesOrphan: number;
    risksWithoutCitation: number;
  };
}

const OPENER_WORD_MAX = 250;

/**
 * Extrait les ids cités via le pattern [src:#NN] depuis un texte donné.
 * Ne dédoublonne pas — si le judge cite plusieurs fois le même id, on le compte
 * plusieurs fois (utile pour métriques).
 */
function collectCitations(text: string): number[] {
  const ids: number[] = [];
  const re = /\[src:#(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = parseInt(m[1] ?? "0", 10);
    if (id > 0) ids.push(id);
  }
  return ids;
}

/**
 * Validator strict du brief V2. Applique les règles métier additionnelles
 * que Zod ne couvre pas. Retourne `ok: true` uniquement si zéro errors.
 */
export function validateLeadBriefV2Strict(brief: LeadBriefV2): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Métriques (utilisées même en cas d'erreur pour télémétrie shadow mode)
  const openerWordCount = brief.opener.trim().split(/\s+/).filter(Boolean).length;
  const thesisCitations = collectCitations(brief.thesis);
  const openerCitations = collectCitations(brief.opener);
  const riskCitations = brief.risks.flatMap((r) => collectCitations(r.description));
  const allCitedIds = new Set<number>([
    ...thesisCitations,
    ...openerCitations,
    ...riskCitations,
  ]);
  const sourceIds = new Set(brief.sources.map((s) => s.id));
  const sourcesCited = brief.sources.filter((s) => allCitedIds.has(s.id)).length;
  const sourcesOrphan = brief.sources.length - sourcesCited;
  const risksWithoutCitation = brief.risks.filter(
    (r) => collectCitations(r.description).length === 0,
  ).length;

  // ── Règle 1 : opener ≤ 250 mots (cible commerciale, pas Zod max chars) ──
  if (openerWordCount > OPENER_WORD_MAX) {
    errors.push({
      field: "opener",
      message: `${openerWordCount} mots > ${OPENER_WORD_MAX} (cible commerciale)`,
    });
  }

  // ── Règle 2 : thesis doit citer au moins 1 [src:#X] ──
  // Sauf cas dégénéré : si verdict=NON et opener court "(Hors ICP — pas d'opener)"
  // on tolère thesis sans citation seulement si elle est elle-même très courte
  // (verdict NON parfois explicite "Boîte hollandaise hors France"). Mais par
  // défaut on exige une citation pour traçabilité.
  if (thesisCitations.length === 0) {
    errors.push({
      field: "thesis",
      message: "Aucune citation [src:#X] dans la thèse — traçabilité cassée",
    });
  }

  // ── Règle 3 : risks high/medium doivent citer ≥1 source ──
  // Les risks low peuvent rester sans citation (signal mineur de transparence,
  // ex "timing serré" qui n'est lié à aucun signal spécifique).
  for (let i = 0; i < brief.risks.length; i++) {
    const r = brief.risks[i];
    if (!r) continue;
    if (r.severity === "low") continue;
    const citations = collectCitations(r.description);
    if (citations.length === 0) {
      errors.push({
        field: `risks[${i}]`,
        message: `Risk severity=${r.severity} sans citation [src:#X] — non traçable`,
      });
    }
  }

  // ── Règle 4 : tous les ids cités doivent exister dans sources[] ──
  const missingIds = [...allCitedIds].filter((id) => !sourceIds.has(id));
  if (missingIds.length > 0) {
    errors.push({
      field: "citations",
      message: `Citations vers ids inexistants dans sources[] : ${missingIds.sort((a, b) => a - b).join(",")}`,
    });
  }

  // ── Règle 5 : sources orphelines = warning (pollution mais pas erreur) ──
  if (sourcesOrphan > 0) {
    const orphanIds = brief.sources
      .filter((s) => !allCitedIds.has(s.id))
      .map((s) => s.id)
      .sort((a, b) => a - b);
    warnings.push({
      field: "sources",
      message: `${sourcesOrphan} source(s) jamais citée(s) — pollution prompt : ids ${orphanIds.join(",")}`,
    });
  }

  // ── Règle 6 : verdict=ENRICH doit avoir enrichmentNeeded ≥1 ──
  if (brief.verdict === "ENRICH") {
    if (!brief.enrichmentNeeded || brief.enrichmentNeeded.length === 0) {
      errors.push({
        field: "enrichmentNeeded",
        message: "Verdict ENRICH sans enrichmentNeeded — incohérent",
      });
    }
  }

  // ── Règle 7 : verdict=OUI/NON ne doit PAS avoir enrichmentNeeded ──
  // Si présent, c'est probablement une erreur de format de la part d'Opus
  // (verdict tranché mais quand même demande d'enrichir). Warning, pas erreur.
  if (
    brief.verdict !== "ENRICH" &&
    brief.enrichmentNeeded &&
    brief.enrichmentNeeded.length > 0
  ) {
    warnings.push({
      field: "enrichmentNeeded",
      message: `Verdict ${brief.verdict} avec enrichmentNeeded non-vide (${brief.enrichmentNeeded.length} items) — incohérent`,
    });
  }

  // ── Règle 8 : confidence très basse sur OUI/NON = signe de doute caché ──
  // Si le judge tranche OUI ou NON avec confidence <50, c'est suspect : il
  // aurait probablement dû émettre ENRICH. Warning pour télémétrie.
  if (brief.verdict !== "ENRICH" && brief.confidence < 50) {
    warnings.push({
      field: "confidence",
      message: `Verdict ${brief.verdict} avec confidence=${brief.confidence}<50 — devrait probablement être ENRICH`,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      openerWordCount,
      citationsInThesis: thesisCitations.length,
      citationsInOpener: openerCitations.length,
      citationsInRisks: riskCitations.length,
      sourcesCited,
      sourcesOrphan,
      risksWithoutCitation,
    },
  };
}

/**
 * Helper de présentation : construit un résumé court en 1 ligne pour
 * logger le résultat validator dans les usages (qualify-trigger v2 wrapper,
 * UI debug, scripts d'audit).
 */
export function formatValidationSummary(result: ValidationResult): string {
  if (result.ok) {
    return `✅ strict OK (warnings=${result.warnings.length}, openerWords=${result.metrics.openerWordCount})`;
  }
  const top = result.errors
    .slice(0, 3)
    .map((e) => `${e.field}:${e.message.slice(0, 50)}`)
    .join(" | ");
  return `❌ strict KO (${result.errors.length} errs, ${result.warnings.length} warns) ${top}`;
}
