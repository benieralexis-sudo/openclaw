/**
 * Lead Verdict — chantier D9 (01/05/2026)
 * ────────────────────────────────────────
 * Calcule un VERDICT humain + ACTION recommandée pour chaque lead, en
 * combinant tous les signaux dispos (score, priority, fit, contact,
 * taille société, ICP, opportunité, RGPD, bounces).
 *
 * Objectif : un commercial qui n'a JAMAIS utilisé iFIND comprend en 3 sec
 * ce qu'il doit faire avec ce lead (pas besoin de décoder le jargon).
 *
 * Module 100% PUR : zéro dépendance React/DB. Testable unitairement.
 */

export type VerdictKind =
  | "ATTACK_NOW"          // Pépite chaude prête : appeler maintenant
  | "WARM_OUTREACH"       // Bon prospect : envoyer warm mail / DM
  | "ENRICH_MANUALLY"     // Persona introuvable, action commerciale manuelle requise
  | "HOLD_LOW_PRIORITY"   // Score faible, surveiller passivement
  | "OFF_TARGET"          // Hors ICP / RGPD / bounce / insolvency
  | "BOOKED";             // RDV pris ou plus avancé dans le pipeline

export type VerdictColor = "success" | "info" | "warning" | "default" | "danger";

export interface VerdictInputs {
  score: number;                    // 1-10 Opus
  priorityScore: number | null;     // 0-130 (chantier #1)
  fitScore: number | null;          // 0-100 (chantier #2b)
  isHot: boolean;
  hasContact: boolean;              // email OU phone
  hasMobile: boolean;
  hasLinkedin: boolean;
  hasFirstName: boolean;            // persona identifiée
  bouncedAt: string | null;
  doNotContact: boolean;
  companyHasInsolvency: boolean;
  companyEtabsCount: number | null; // proxy taille (Pappers)
  companySizeText: string | null;   // ex "1000+", "11-50" (Apify/LI)
  icpSizeMin: number | undefined;
  icpSizeMax: number | undefined;
  opportunityStage: string | null;  // null OU "MEETING_SET"|"PROPOSAL"|"WON"|"LOST"|...
  contactFullName: string | null;
  contactPhone: string | null;
  contactJobTitle?: string | null;
  capturedAt: string;
  triggerSourceCode: string | null; // ex "apify.linkedin-jobs"
}

export interface VerdictResult {
  kind: VerdictKind;
  color: VerdictColor;
  label: string;            // 1 phrase humaine prête à afficher
  reason: string;           // Justification courte (pourquoi ce verdict)
  action: string;           // Action concrète à faire MAINTENANT
  flags: string[];          // Drapeaux warnings ("societe_trop_grosse", etc.)
}

// ──────────────────────────────────────────────────────────────────────
// Helpers internes
// ──────────────────────────────────────────────────────────────────────

function parseSizeText(text: string | null): number | null {
  if (!text) return null;
  // "1000+" → 1000
  const plus = text.match(/(\d+)\s*\+/);
  if (plus) return parseInt(plus[1]!, 10);
  // "11-50" → 50 (max)
  const range = text.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return parseInt(range[2]!, 10);
  // "200" → 200
  const num = text.match(/^\s*(\d+)\s*$/);
  if (num) return parseInt(num[1]!, 10);
  return null;
}

function getEffectiveSize(inputs: VerdictInputs): number | null {
  if (inputs.companyEtabsCount !== null) return inputs.companyEtabsCount;
  return parseSizeText(inputs.companySizeText);
}

// ──────────────────────────────────────────────────────────────────────
// Verdict principal
// ──────────────────────────────────────────────────────────────────────

const BOOKED_STAGES = new Set(["MEETING_SET", "PROPOSAL", "WON"]);

export function computeLeadVerdict(inputs: VerdictInputs): VerdictResult {
  const flags: string[] = [];

  // ── BOOKED prioritaire (si on a déjà un RDV, le verdict est figé)
  if (inputs.opportunityStage && BOOKED_STAGES.has(inputs.opportunityStage)) {
    return {
      kind: "BOOKED",
      color: "success",
      label: "RDV booké — prépare ton appel",
      reason: `Opportunité au stade ${inputs.opportunityStage}`,
      action: "Ouvrir le brief commercial (tab Brief stratégique) avant l'appel",
      flags,
    };
  }

  // ── OFF_TARGET : raisons disqualifiantes (ordre de priorité)
  if (inputs.doNotContact) {
    return {
      kind: "OFF_TARGET",
      color: "danger",
      label: "Hors cible — opt-out RGPD",
      reason: "Le contact a demandé à ne plus être contacté",
      action: "Aucune action — ne pas contacter (RGPD)",
      flags: ["rgpd_opt_out"],
    };
  }

  if (inputs.bouncedAt) {
    return {
      kind: "OFF_TARGET",
      color: "danger",
      label: "Hors cible — email bounced",
      reason: "L'email enrichi est invalide / la boîte a rebondi",
      action: "Ignorer ou trouver un autre contact via LinkedIn",
      flags: ["email_bounced"],
    };
  }

  if (inputs.companyHasInsolvency) {
    return {
      kind: "OFF_TARGET",
      color: "danger",
      label: "Hors cible — procédure collective en cours",
      reason: "L'entreprise est en redressement / liquidation judiciaire",
      action: "Exclure du pipeline — société en difficulté financière",
      flags: ["insolvency"],
    };
  }

  // Taille hors ICP : > sizeMax × 3 = clairement trop gros (ETI/grand groupe)
  // ex ICP 11-200 → seuil 600+ = société qui n'a pas le profil cible
  const effectiveSize = getEffectiveSize(inputs);
  if (
    effectiveSize !== null &&
    inputs.icpSizeMax !== undefined &&
    effectiveSize > inputs.icpSizeMax * 3
  ) {
    return {
      kind: "OFF_TARGET",
      color: "danger",
      label: `Hors cible — société trop grosse (~${effectiveSize}p, cible ${inputs.icpSizeMin ?? "?"}-${inputs.icpSizeMax}p)`,
      reason: "Taille très supérieure à l'ICP — décideur juridique n'est pas le bon contact opérationnel",
      action: "Ignorer ou chercher manuellement le hiring manager du poste précis sur LinkedIn",
      flags: ["societe_trop_grosse", "hors_icp_taille"],
    };
  }

  // ── Flags warnings (sans disqualifier)
  if (
    effectiveSize !== null &&
    inputs.icpSizeMax !== undefined &&
    effectiveSize > inputs.icpSizeMax * 2
  ) {
    flags.push("societe_trop_grosse");
  }
  if (
    inputs.contactJobTitle &&
    /(directeur\s*g[eé]n[eé]ral|gérant|président|ceo|chief\s*executive)/i.test(inputs.contactJobTitle) &&
    effectiveSize !== null &&
    effectiveSize > 200
  ) {
    flags.push("decideur_juridique_pas_hiring");
  }

  // ── ENRICH_MANUALLY : qualifié mais persona introuvable
  if (inputs.score >= 6 && (!inputs.hasFirstName || !inputs.hasContact)) {
    const isApifyJob = (inputs.triggerSourceCode ?? "").startsWith("apify.");
    const action = isApifyJob
      ? "Trouve le hiring manager sur LinkedIn de l'annonce, ou cherche le CTO de la société"
      : "Cherche manuellement le bon contact sur LinkedIn de la société";
    return {
      kind: "ENRICH_MANUALLY",
      color: "warning",
      label: "Persona à identifier manuellement",
      reason: !inputs.hasFirstName
        ? "Aucun décideur identifié automatiquement (Pappers + HarvestAPI ont échoué)"
        : "Décideur trouvé mais sans contact (email/phone enrichis manquants)",
      action,
      flags,
    };
  }

  // ── HOLD_LOW_PRIORITY : score < 5
  if (inputs.score < 5) {
    return {
      kind: "HOLD_LOW_PRIORITY",
      color: "default",
      label: "Signal faible — surveille, pas d'action urgente",
      reason: `Score Opus ${inputs.score}/10 — peu de signal commercial`,
      action: "Attendre confirmation par un autre signal (combo cross-source)",
      flags,
    };
  }

  // ── ATTACK_NOW : Pépite ≥8 + isHot + contact
  if (inputs.score >= 8 && inputs.isHot && inputs.hasContact) {
    if (inputs.hasMobile && inputs.contactPhone) {
      return {
        kind: "ATTACK_NOW",
        color: "success",
        label: "À appeler maintenant — Pépite chaude",
        reason: "Score Opus haut + signal récent + mobile direct disponible",
        action: `Appeler ${inputs.contactFullName ?? "le contact"} au ${inputs.contactPhone} cette semaine`,
        flags,
      };
    }
    return {
      kind: "ATTACK_NOW",
      color: "success",
      label: "À attaquer cette semaine — Pépite chaude",
      reason: "Score Opus haut + signal récent",
      action: inputs.hasLinkedin
        ? "Envoyer DM LinkedIn (tab LinkedIn) puis warm mail dans la journée"
        : "Envoyer cold mail (tab Email) — pas de LinkedIn dispo",
      flags,
    };
  }

  // ── WARM_OUTREACH : qualifié 6-7 OU pépite sans isHot
  return {
    kind: "WARM_OUTREACH",
    color: "info",
    label: "Bon prospect — outreach commercial",
    reason: `Score ${inputs.score}/10 + persona identifiée${inputs.hasContact ? " + contact OK" : ""}`,
    action: inputs.hasLinkedin
      ? "Envoyer DM LinkedIn (tab LinkedIn), puis warm mail post-engagement"
      : "Envoyer cold mail (tab Email)",
    flags,
  };
}
