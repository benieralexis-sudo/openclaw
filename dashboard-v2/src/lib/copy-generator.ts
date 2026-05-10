/**
 * Copy Engine — chantier #3 (01/05/2026)
 * ──────────────────────────────────────
 * Génère 4 contextes de contenu commercial en 1 seul appel Opus :
 *   - coldMail   : email cold-outreach (jamais contacté)
 *   - warmMail   : email post-LinkedIn (référence à un échange préalable)
 *   - linkedinDm : message LinkedIn court
 *   - callBrief  : brief commercial pour appel téléphonique
 *
 * Adaptation tonalité par Persona Tier (A=direct technique, B=modéré,
 * C=formel + intro request).
 *
 * Module 100% PUR : zéro dépendance DB/IO. Testable unitairement.
 */

export type CopyContext = "coldMail" | "warmMail" | "linkedinDm" | "callBrief";

export interface CoreColdMail {
  subject: string;
  body: string;
  followup: string;
}

export interface CoreWarmMail {
  subject: string;
  body: string;
}

export interface CoreLinkedInDm {
  message: string;
}

export interface CoreCallBrief {
  openingLine: string;
  keyPoints: string[];
  objections: Array<{ objection: string; response: string }>;
}

export interface CopyPayload {
  coldMail: CoreColdMail;
  warmMail: CoreWarmMail;
  linkedinDm: CoreLinkedInDm;
  callBrief: CoreCallBrief;
}

// ──────────────────────────────────────────────────────────────────────
// Tone policy par Persona Tier
// ──────────────────────────────────────────────────────────────────────

export type PersonaTier = "A" | "B" | "C";

export interface TonePolicy {
  tier: PersonaTier;
  toneLabel: string;
  prompt_directive: string;
  askForIntro: boolean;
  rdvWindow: string;
}

const TONE_POLICIES: Record<PersonaTier, TonePolicy> = {
  A: {
    tier: "A",
    toneLabel: "direct, technique, pair-to-pair",
    prompt_directive:
      "Le décideur est un expert technique (CTO/Founder/Head of Eng). Va droit au but, vocabulaire technique assumé, propose un RDV CETTE SEMAINE (mardi/jeudi). Pas de jargon marketing, pas de longueurs. Démonstration de compétence implicite.",
    askForIntro: false,
    rdvWindow: "cette semaine (mardi 14h ou jeudi 10h)",
  },
  B: {
    tier: "B",
    toneLabel: "modéré, business + tech, RDV semaine prochaine",
    prompt_directive:
      "Le décideur a un rôle hybride business/tech (Eng Manager/DSI/VP). Mélange contexte business (ROI, time-to-market) + tech (qualité, dette). Propose un RDV SEMAINE PROCHAINE pour laisser de la marge. Ton professionnel, ni trop direct ni trop formel.",
    askForIntro: false,
    rdvWindow: "semaine prochaine (lundi 10h ou mercredi 14h)",
  },
  C: {
    tier: "C",
    toneLabel: "formel, demande intro vers décideur tech",
    prompt_directive:
      "Le décideur est un C-level non-tech (CEO/Directeur/Président) — souvent un fallback Pappers car Tier 1-2 introuvables. Ton respectueux, formel. NE PROPOSE PAS de RDV direct. À la place, demande explicitement : 'Pourriez-vous m'orienter vers votre CTO ou responsable QA/test ?' L'objectif est l'intro, pas la vente directe.",
    askForIntro: true,
    rdvWindow: "à confirmer avec le bon interlocuteur",
  },
};

export function resolveTonePolicy(tier: string | null | undefined): TonePolicy {
  if (tier === "A" || tier === "B" || tier === "C") {
    return TONE_POLICIES[tier];
  }
  // Fallback Tier 2 (intermediate, safe par défaut)
  return TONE_POLICIES.B;
}

// ──────────────────────────────────────────────────────────────────────
// Prompt builder
// ──────────────────────────────────────────────────────────────────────

export interface CopyPromptArgs {
  trigger: {
    title: string;
    detail: string | null;
    type: string;
    score: number;
    isHot: boolean;
    industry: string | null;
    region: string | null;
    size: string | null;
    sourceCode: string | null;
    capturedAt: Date;
    // Refactor V2-only Session 2 — verdict V2 affiché dans copy generator
    briefV2Json?: { verdict?: "OUI" | "ENRICH" | "NON"; confidence?: number } | null;
  };
  lead: {
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    companyName: string;
    personaTier: string | null;
  };
  client: {
    name: string;
    industry: string | null;
    icp: Record<string, unknown> | null;
  };
}

export function buildCopyPrompt(args: CopyPromptArgs): string {
  const { trigger, lead, client } = args;
  const tone = resolveTonePolicy(lead.personaTier);

  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "[Décideur à identifier]";

  return `Tu es l'assistant commercial d'iFIND. Tu produis 4 contenus de cold outreach en 1 seul appel pour transformer ce signal d'achat en RDV.

# CONTEXTE CLIENT iFIND (qui paie)
- Société : ${client.name}
- Secteur : ${client.industry ?? "—"}
- ICP : ${JSON.stringify(client.icp ?? {})}

# TRIGGER (signal d'achat public)
- Entreprise cible : ${lead.companyName}
- Type : ${trigger.type}
- Verdict : ${trigger.briefV2Json?.verdict ? `${trigger.briefV2Json.verdict} ${trigger.briefV2Json.confidence ?? "?"}%` : `score ${trigger.score}/10`} ${trigger.isHot ? "🔥 HOT" : ""}
- Titre : ${trigger.title}
- Détail : ${trigger.detail ?? "—"}
- Industrie : ${trigger.industry ?? "—"} · Région : ${trigger.region ?? "—"} · Taille : ${trigger.size ?? "—"}
- Source : ${trigger.sourceCode ?? "—"} · Capté : ${trigger.capturedAt.toISOString().slice(0, 10)}

# CONTACT IDENTIFIÉ
- Nom : ${fullName}
- Poste : ${lead.jobTitle ?? "—"}
- Entreprise : ${lead.companyName}
- Persona Tier : ${tone.tier} (${tone.toneLabel})

# DIRECTIVE TONALITÉ (par Persona Tier)
${tone.prompt_directive}

# 4 CONTEXTES À GÉNÉRER (1 seul appel, format JSON strict)

## 1. coldMail — email cold (jamais contacté)
- Subject ≤ 60 chars, accroche directe sur le trigger
- Body ≤ 800 chars : hook trigger + value prop + question fermée (créneau A ou B)
- Followup J+3 ≤ 400 chars : ton léger, angle complémentaire
- RDV : ${tone.rdvWindow}

## 2. warmMail — email post-LinkedIn (LE prospect a engagé sur LinkedIn : like/visite/réponse)
- Subject ≤ 60 chars, référence implicite à l'échange LinkedIn
- Body ≤ 500 chars : OBLIGATOIRE référence à l'échange LinkedIn ("suite à notre conversation/échange/votre intérêt LinkedIn")
- PAS de followup (l'engagement LinkedIn = warm assez)
- Plus court, plus direct que coldMail

## 3. linkedinDm — message LinkedIn court
- Message ≤ 300 chars (limite LinkedIn)
- Hook trigger + value prop courte + question légère
- PAS de CTA Cal.com (LinkedIn pénalise les liens externes)

## 4. callBrief — brief commercial pour appel téléphonique
- openingLine : phrase d'accroche pour démarrer l'appel
- keyPoints : 3 à 5 points clés à aborder (pas plus, pas moins)
- objections : 2-3 objections probables avec réponses préparées

# FORMAT DE RÉPONSE — JSON STRICT (aucun texte autour)
{
  "coldMail": { "subject": "...", "body": "...", "followup": "..." },
  "warmMail": { "subject": "...", "body": "..." },
  "linkedinDm": { "message": "..." },
  "callBrief": {
    "openingLine": "...",
    "keyPoints": ["...", "..."],
    "objections": [{ "objection": "...", "response": "..." }]
  }
}`;
}

// ──────────────────────────────────────────────────────────────────────
// Parser (tolérant aux fences markdown et au texte parasite)
// ──────────────────────────────────────────────────────────────────────

export function parseCopyResponse(text: string): CopyPayload {
  let cleaned = text.trim();
  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  // Strip parasite text avant/après le JSON
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  const parsed = JSON.parse(cleaned) as CopyPayload;
  return parsed;
}

// ──────────────────────────────────────────────────────────────────────
// Validator (longueurs + présence des 4 contextes)
// ──────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  errors?: string[];
}

const LIMITS = {
  coldMailSubject: 80, // tolérance vs 60 cible (Opus déborde parfois)
  coldMailBody: 800,
  coldMailFollowup: 500,
  warmMailSubject: 80,
  warmMailBody: 500,
  linkedinDmMessage: 300,
  callBriefKeyPointsMin: 3,
  callBriefKeyPointsMax: 5,
};

export function validateCopyPayload(payload: unknown): ValidationResult {
  const errors: string[] = [];
  const p = payload as Partial<CopyPayload> | null | undefined;

  if (!p) {
    return { ok: false, errors: ["payload null"] };
  }

  // Présence des 4 contextes
  if (!p.coldMail) errors.push("coldMail manquant");
  if (!p.warmMail) errors.push("warmMail manquant");
  if (!p.linkedinDm) errors.push("linkedinDm manquant");
  if (!p.callBrief) errors.push("callBrief manquant");

  // Longueurs coldMail
  if (p.coldMail) {
    if ((p.coldMail.subject ?? "").length > LIMITS.coldMailSubject) {
      errors.push(`coldMail.subject > ${LIMITS.coldMailSubject}`);
    }
    if ((p.coldMail.body ?? "").length > LIMITS.coldMailBody) {
      errors.push(`coldMail.body > ${LIMITS.coldMailBody}`);
    }
    if ((p.coldMail.followup ?? "").length > LIMITS.coldMailFollowup) {
      errors.push(`coldMail.followup > ${LIMITS.coldMailFollowup}`);
    }
  }

  // Longueurs warmMail
  if (p.warmMail) {
    if ((p.warmMail.subject ?? "").length > LIMITS.warmMailSubject) {
      errors.push(`warmMail.subject > ${LIMITS.warmMailSubject}`);
    }
    if ((p.warmMail.body ?? "").length > LIMITS.warmMailBody) {
      errors.push(`warmMail.body > ${LIMITS.warmMailBody}`);
    }
  }

  // linkedinDm
  if (p.linkedinDm) {
    if ((p.linkedinDm.message ?? "").length > LIMITS.linkedinDmMessage) {
      errors.push(`linkedinDm.message > ${LIMITS.linkedinDmMessage}`);
    }
  }

  // callBrief.keyPoints 3-5
  if (p.callBrief) {
    const n = Array.isArray(p.callBrief.keyPoints) ? p.callBrief.keyPoints.length : 0;
    if (n < LIMITS.callBriefKeyPointsMin || n > LIMITS.callBriefKeyPointsMax) {
      errors.push(`callBrief.keyPoints doit avoir ${LIMITS.callBriefKeyPointsMin}-${LIMITS.callBriefKeyPointsMax} items (actuel: ${n})`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
