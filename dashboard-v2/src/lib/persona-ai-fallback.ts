import "server-only";
// Sprint Persona Excellence (17/05/2026) — Phase 4
//
// Fallback IA Claude Haiku quand HarvestAPI ne trouve aucun candidat
// satisfaisant pour une persona donnée. Remplace l'ancien fallback
// Google CSE (qui n'a résolu 0 lead en 30 jours — code mort).
//
// Trigger : appelé par le caller (Session 3 wirera) quand :
//   - HarvestAPI search retourne 0 candidat
//   - OU top-1 candidate score (Phase 3) < 50
//
// Logique :
//   1. Construire un prompt court avec entreprise + ICP + signal
//   2. Haiku 4.5 retourne { targetTitle, firstNamesHints, searchTermsLinkedIn }
//   3. Le caller relance HarvestAPI avec ces termes (out of scope Phase 4)
//
// Coût : ~0.005-0.01€ par appel. Cache 7j (in-memory) pour ne pas répéter
// pour la même entreprise+signal.

import { getAnthropic } from "@/lib/anthropic";
import { isAnthropicDown, isTransientAnthropicError, markAnthropicDown } from "@/lib/anthropic-health";

const MODEL_HAIKU = "claude-haiku-4-5-20251001";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 200;

export interface PersonaAiSuggestion {
  /** Titre cible canonique à chercher (ex: "Head of QA", "CRO", "Engineering Manager") */
  targetTitle: string;
  /** Variantes du titre à essayer dans la recherche LinkedIn (ex: ["Head of QA", "QA Manager", "QA Lead"]) */
  searchTermsLinkedIn: string[];
  /** Réflexion courte du modèle pour traçabilité */
  reasoning: string;
  /** Confidence 0-100 selon le modèle (estime sa propre certitude) */
  confidence: number;
}

interface CacheEntry {
  suggestion: PersonaAiSuggestion | null;
  ts: number;
}
const cache = new Map<string, CacheEntry>();

function cacheKey(companyName: string, signalType: string, icpSig: string): string {
  return `${companyName.trim().toLowerCase()}|${signalType}|${icpSig}`;
}

function cacheGet(key: string): PersonaAiSuggestion | null | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return e.suggestion;
}

function cacheSet(key: string, suggestion: PersonaAiSuggestion | null): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, { suggestion, ts: Date.now() });
}

export interface PersonaAiFallbackArgs {
  companyName: string;
  companyContext?: {
    /** Taille effectif (ex: "11-50", "100p", "200+") pour calibrer le titre cible */
    sizeHint?: string;
    /** NAF / secteur pour contextualiser */
    industry?: string;
    /** Description trigger (ex: "hire QA Automation Engineer J+4") */
    triggerSummary?: string;
  };
  /** Type signal (ex: "qa-hire", "sales-hire", "fundraising") */
  signalType: string;
  /** Pitch verbatim du client (qu'est-ce qu'il vend, à qui) */
  icpSummary?: string;
}

/**
 * Demande à Haiku quel profil cible chercher pour cette boîte + ce signal +
 * cet ICP. Retourne suggestions exploitables par une seconde recherche
 * HarvestAPI ciblée. Cache 7j.
 *
 * Retourne null si Anthropic down (circuit breaker), si parse fail, ou si
 * Haiku n'a pas de suggestion confiance.
 */
export async function suggestPersonaTarget(
  args: PersonaAiFallbackArgs,
): Promise<PersonaAiSuggestion | null> {
  if (await isAnthropicDown()) {
    return null;
  }

  const icpSig = (args.icpSummary ?? "").slice(0, 50);
  const key = cacheKey(args.companyName, args.signalType, icpSig);
  const cached = cacheGet(key);
  if (cached !== undefined) {
    return cached;
  }

  const prompt = buildPrompt(args);

  try {
    const anthropic = getAnthropic();
    const resp = await anthropic.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (resp.content[0] as { type: string; text: string })?.text ?? "";
    const parsed = parseHaikuResponse(text);
    cacheSet(key, parsed);
    return parsed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isTransientAnthropicError(msg)) {
      markAnthropicDown(msg);
    }
    return null;
  }
}

/**
 * Pure function — Construit le prompt Haiku. Exportée pour tests.
 */
export function buildPrompt(args: PersonaAiFallbackArgs): string {
  const ctx = args.companyContext;
  const sizeLine = ctx?.sizeHint ? `\nTaille équipe : ${ctx.sizeHint}` : "";
  const industryLine = ctx?.industry ? `\nSecteur : ${ctx.industry}` : "";
  const triggerLine = ctx?.triggerSummary ? `\nSignal détecté : ${ctx.triggerSummary}` : "";
  const icpLine = args.icpSummary ? `\nProfil client iFIND : ${args.icpSummary}` : "";

  return `Tu aides une PME française à identifier le bon décideur à contacter dans une entreprise cible.

Entreprise cible : ${args.companyName}${sizeLine}${industryLine}
Type de signal d'achat : ${args.signalType}${triggerLine}${icpLine}

Question : quel titre de poste je dois chercher dans LinkedIn pour trouver LA personne qui décide sur ce sujet précis dans cette entreprise précise ?

Règles :
- Tiens compte de la taille de l'équipe (PME 10-50p : souvent CEO/Founder décide ; ETI 100-200p : Head of/VP ; grande boîte : Director/Manager opérationnel)
- Le signal "qa-hire" pour une boîte SaaS 30p = chercher CTO ou Head of Engineering (rarement un Head of QA qui n'existe pas encore)
- Le signal "sales-hire" pour une boîte 50p = chercher Head of Sales ou Founder
- Ne propose pas un poste qui n'existerait probablement pas dans cette taille de boîte

Réponds en JSON strict (rien d'autre, pas de prose) :
{
  "targetTitle": "le titre canonique principal (ex: 'Head of Sales')",
  "searchTermsLinkedIn": ["variante1", "variante2", "variante3"] (3-5 variantes à chercher dans LinkedIn),
  "reasoning": "1 phrase courte expliquant le choix",
  "confidence": 0-100 (estime ta certitude)
}`;
}

/**
 * Pure function — Parse réponse JSON Haiku. Tolère ```json blocks et prose
 * autour. Retourne null si invalide.
 */
export function parseHaikuResponse(text: string): PersonaAiSuggestion | null {
  // Strip ```json blocks
  let cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  // Extraire le 1er objet JSON s'il y a de la prose autour
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];
  try {
    const obj = JSON.parse(cleaned);
    if (
      typeof obj !== "object" ||
      obj === null ||
      typeof obj.targetTitle !== "string" ||
      !Array.isArray(obj.searchTermsLinkedIn) ||
      typeof obj.reasoning !== "string" ||
      typeof obj.confidence !== "number"
    ) {
      return null;
    }
    return {
      targetTitle: obj.targetTitle.trim(),
      searchTermsLinkedIn: obj.searchTermsLinkedIn
        .filter((s: unknown): s is string => typeof s === "string")
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0)
        .slice(0, 10),
      reasoning: obj.reasoning.trim(),
      confidence: Math.max(0, Math.min(100, Math.round(obj.confidence))),
    };
  } catch {
    return null;
  }
}

/** Pour tests — clear cache */
export function clearPersonaAiCache(): void {
  cache.clear();
}
