/**
 * Brief builder — extracteur des helpers buildPrompt/extractJson hors
 * Route Handler (Next.js 15 interdit les exports custom dans les routes).
 *
 * Sprint 1 setup (05/05/2026) — Initialement exportés depuis brief/route.ts
 * pour réutilisation par auto-generate-briefs.ts. Build Next.js production
 * cassait avec error "buildPrompt is not a valid Route export field" donc
 * extraction nécessaire.
 *
 * Pas de side-effect : pure functions safe à utiliser depuis n'importe où.
 */

export interface BriefPayload {
  summary: {
    whyNow: string;
    icpMatch: string;
    angle: string;
    objections: Array<{ obj: string; reply: string }>;
    closeLine: string;
  };
  email: {
    subject: string;
    body: string;
  };
  linkedin: {
    connection: string;
    followup: string;
  };
  callScript: {
    intro: string;
    hook: string;
    questions: string[];
    objectionHandling: Array<{ obj: string; response: string }>;
    close: string;
  };
}

export const CACHE_TTL_DAYS = 7;

export function isCacheFresh(generatedAt: Date | null): boolean {
  if (!generatedAt) return false;
  const ageMs = Date.now() - generatedAt.getTime();
  return ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export function buildPrompt(args: {
  trigger: {
    title: string;
    detail: string | null;
    score: number;
    isHot: boolean;
    isCombo: boolean;
    type: string;
    industry: string | null;
    region: string | null;
    size: string | null;
    companyName: string;
    // Refactor V2-only Session 2 — verdict V2 affiché dans le brief
    briefV2Json?: { verdict?: "OUI" | "ENRICH" | "NON"; confidence?: number } | null;
  };
  lead: {
    fullName: string | null;
    jobTitle: string | null;
    companyName: string;
  };
  client: {
    name: string;
    industry: string | null;
    icp: Record<string, unknown> | null;
  };
}): string {
  const { trigger, lead, client } = args;
  const icp = client.icp ?? {};
  // Fix B2 sender (12/05/2026) — Opus laissait `[Prénom] de Digi Test Lab`
  // dans les call scripts car le prompt ne fournissait pas le prénom du
  // commercial. Injection directe via icp.senderFirstName.
  const senderFirstName =
    (icp as { senderFirstName?: string }).senderFirstName?.trim() || null;
  return `Tu es l'assistant commercial d'iFIND. Tu produis un BRIEF COMMERCIAL ULTRA-OPÉRATIONNEL pour aider un commercial humain à transformer ce signal d'achat en RDV.

# CONTEXTE CLIENT iFIND (qui paie)
- Société : ${client.name}
- Secteur : ${client.industry ?? "—"}${senderFirstName ? `\n- Commercial qui contactera : ${senderFirstName} (utilise ce prénom directement dans le call script et l'email signature — JAMAIS de placeholder [Prénom])` : ""}
- ICP cible : ${JSON.stringify(icp)}

# TRIGGER DÉTECTÉ (signal d'achat public)
- Entreprise cible : ${trigger.companyName}
- Type de signal : ${trigger.type}
- Verdict : ${trigger.briefV2Json?.verdict ? `${trigger.briefV2Json.verdict} ${trigger.briefV2Json.confidence ?? "?"}%` : `score ${trigger.score}/10`} ${trigger.isHot ? "🔥 HOT" : ""} ${trigger.isCombo ? "✨ COMBO" : ""}
- Titre : ${trigger.title}
- Détail : ${trigger.detail ?? "—"}
- Industrie : ${trigger.industry ?? "—"} · Région : ${trigger.region ?? "—"} · Taille : ${trigger.size ?? "—"}

# CONTACT IDENTIFIÉ
- Nom : ${lead.fullName ?? "Décideur à identifier"}
- Poste : ${lead.jobTitle ?? "—"}
- Entreprise : ${lead.companyName}

# TA TÂCHE
Produis un brief en français, ton professionnel direct, sans jargon marketing creux. Chaque phrase doit être actionnable. Le commercial doit pouvoir copier-coller en 3 minutes max.

# RÈGLES STRICTES
- Email : sujet ≤ 60 caractères, corps ≤ 800 caractères, mention explicite du trigger comme hook, finir par une question fermée (créneau A ou B)
- LinkedIn connection : ≤ 280 caractères, pas de "salut/bonjour", entrée directe sur le trigger
- LinkedIn follow-up : à envoyer J+3 si pas de réponse, ≤ 400 caractères
- Script call : intro 30s max, 3 questions ouvertes seulement, traitement de 3 objections types, close avec proposition d'appel discovery 15 min (le commercial gère son propre agenda, ne PAS mentionner Cal.com/Calendly)
- 3 objections probables MAX dans le summary, chacune avec une réponse en 1 phrase
- Phrase de close : 1 question, créneau précis (ex. "Mardi 14h ou jeudi 10h ?")

# FORMAT DE RÉPONSE
Réponds UNIQUEMENT avec un JSON valide qui matche exactement cette structure (pas de markdown, pas de texte avant/après) :

{
  "summary": {
    "whyNow": "string — pourquoi ce trigger justifie un contact MAINTENANT",
    "icpMatch": "string — pourquoi ce compte match l'ICP du client iFIND",
    "angle": "string — angle d'attaque recommandé en 1 phrase",
    "objections": [
      { "obj": "string — objection probable", "reply": "string — réponse en 1 phrase" }
    ],
    "closeLine": "string — phrase de close finale avec créneau"
  },
  "email": {
    "subject": "string — sujet email ≤ 60 chars",
    "body": "string — corps email avec retours à la ligne \\n"
  },
  "linkedin": {
    "connection": "string — message connexion ≤ 280 chars",
    "followup": "string — message J+3 si pas de réponse"
  },
  "callScript": {
    "intro": "string — intro téléphonique 30s",
    "hook": "string — phrase d'accroche basée sur le trigger",
    "questions": ["q1", "q2", "q3"],
    "objectionHandling": [
      { "obj": "string", "response": "string" }
    ],
    "close": "string — proposition discovery 15 min (PAS de Cal.com/Calendly, le commercial gère)"
  }
}`;
}

export function extractJson(text: string): BriefPayload {
  // L'API peut entourer la réponse de markdown ```json ... ``` malgré la consigne
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  // Trouve le premier { et le dernier } pour être robuste
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned) as BriefPayload;
}
