// Sprint catalogue (16/05/2026) — Détecteur P4 "AI tool adoption".
//
// Signal d'achat le plus prédictif (+46% corrélation conversion, LeadGenius).
// L'entreprise adopte un outil AI (LLM, vector DB, AI framework) détecté via
// le texte d'une offre d'emploi, d'une page LinkedIn, ou d'un site web.
//
// Coût marginal 0 : scanne les textes déjà fetched par d'autres signaux
// (apify job descriptions, harvestapi headlines, website summaries).
//
// Logique pure (testable trivialement, aucune I/O).

/**
 * Pattern de détection AI avec catégorie et poids.
 *   - Le poids permet de filtrer le bruit : 1 match weight=1 ≠ 1 match weight=5.
 *   - Catégorie pour debug/reporting.
 */
interface AiPattern {
  regex: RegExp;
  label: string;
  category: "model" | "framework" | "vector-db" | "infra" | "concept" | "title" | "product";
  weight: number; // 1-5 (5 = très spécifique, 1 = potentiellement générique)
}

/**
 * Patterns de détection AI par défaut (defaults catalogue).
 * Le client peut ajouter ses propres keywords via customKeywords.
 *
 * Choix : éviter les regex trop larges ("AI", "ML" seuls) qui matchent
 * "AI Marketing", "Email AI", etc. générique. Préférer les noms de produits
 * et frameworks spécifiques.
 */
const AI_PATTERNS: AiPattern[] = [
  // ── Models / LLM providers ──
  { regex: /\b(GPT-?[345]|GPT-?4o|ChatGPT)\b/i, label: "GPT", category: "model", weight: 5 },
  { regex: /\bOpenAI\b/i, label: "OpenAI", category: "model", weight: 5 },
  { regex: /\bAnthropic\b/i, label: "Anthropic", category: "model", weight: 5 },
  { regex: /\bClaude(\s*(Opus|Sonnet|Haiku|3|4))?\b/i, label: "Claude", category: "model", weight: 5 },
  { regex: /\bGemini(\s*(Pro|Ultra|Flash))?\b/i, label: "Gemini", category: "model", weight: 5 },
  { regex: /\bLlama\s*[234]\b/i, label: "Llama 2/3/4", category: "model", weight: 5 },
  { regex: /\bMistral(\s*AI)?\b/i, label: "Mistral", category: "model", weight: 5 },

  // ── Frameworks ──
  { regex: /\bLangChain\b/i, label: "LangChain", category: "framework", weight: 5 },
  { regex: /\bLlamaIndex\b/i, label: "LlamaIndex", category: "framework", weight: 5 },
  { regex: /\bLangGraph\b/i, label: "LangGraph", category: "framework", weight: 5 },
  { regex: /\bHaystack\b/i, label: "Haystack", category: "framework", weight: 4 }, // peut être autre "haystack"
  { regex: /\bHugging\s*Face\b/i, label: "Hugging Face", category: "framework", weight: 5 },

  // ── Vector DBs ──
  { regex: /\bPinecone\b/i, label: "Pinecone", category: "vector-db", weight: 5 },
  { regex: /\bWeaviate\b/i, label: "Weaviate", category: "vector-db", weight: 5 },
  { regex: /\bQdrant\b/i, label: "Qdrant", category: "vector-db", weight: 5 },
  { regex: /\bChroma(DB)?\b/i, label: "Chroma", category: "vector-db", weight: 4 },
  { regex: /\bMilvus\b/i, label: "Milvus", category: "vector-db", weight: 5 },
  { regex: /\bpgvector\b/i, label: "pgvector", category: "vector-db", weight: 5 },

  // ── Concepts AI métiers ──
  { regex: /\bRAG\b/, label: "RAG", category: "concept", weight: 5 }, // case-sensitive, sigle distinctif
  { regex: /\bretrieval[\s-]augmented\s+generation\b/i, label: "RAG full", category: "concept", weight: 5 },
  { regex: /\bvector\s+(database|search|store|embeddings?)\b/i, label: "vector search", category: "concept", weight: 4 },
  { regex: /\b(fine-?tuning|finetuning)\b/i, label: "fine-tuning", category: "concept", weight: 4 },
  { regex: /\bprompt\s+engineering\b/i, label: "prompt engineering", category: "concept", weight: 5 },
  { regex: /\bGenAI\b|\bGenerative\s+AI\b/i, label: "GenAI", category: "concept", weight: 4 },
  { regex: /\bLLM(s|Ops)?\b/, label: "LLM/LLMOps", category: "concept", weight: 4 },

  // ── Titres de poste AI ──
  { regex: /\b(ML|Machine\s*Learning)\s+Engineer\b/i, label: "ML Engineer", category: "title", weight: 4 },
  { regex: /\bAI\s+Engineer\b/i, label: "AI Engineer", category: "title", weight: 4 },
  { regex: /\b(MLOps|ML\s*Ops)\s+Engineer\b/i, label: "MLOps", category: "title", weight: 4 },
  { regex: /\bPrompt\s+Engineer\b/i, label: "Prompt Engineer", category: "title", weight: 5 },
  { regex: /\b(Applied|Senior|Lead)\s+AI\s+(Researcher|Scientist|Engineer)\b/i, label: "AI Researcher/Scientist", category: "title", weight: 5 },

  // ── Produits AI grand public ──
  { regex: /\b(GitHub\s+)?Copilot\b/i, label: "Copilot", category: "product", weight: 3 },
  { regex: /\bCursor(\s+AI)?\b/i, label: "Cursor", category: "product", weight: 3 },
  { regex: /\bPerplexity(\.ai)?\b/i, label: "Perplexity", category: "product", weight: 4 },
];

export interface AiDetectionResult {
  /** True si au moins 1 match avec weight cumulé >= minTotalWeight. */
  matched: boolean;
  /** Labels uniques des keywords trouvés (dans l'ordre d'apparition). */
  labels: string[];
  /** Détails par match : label + category + weight. */
  matches: Array<{ label: string; category: string; weight: number }>;
  /** Somme des weights des matches. Plus c'est élevé, plus le signal est fort. */
  totalWeight: number;
}

/**
 * Scanne un texte pour détecter des keywords AI (outils, frameworks,
 * concepts, titres de poste).
 *
 * @param text texte à analyser (job description, headline, etc.)
 * @param customKeywords keywords additionnels du client (case-insensitive,
 *        ajoutés comme patterns "\bKEYWORD\b" weight 3)
 * @param options.minTotalWeight seuil de weight pour matched=true (default 4)
 */
export function detectAiKeywords(
  text: string | null | undefined,
  customKeywords?: string[] | null,
  options: { minTotalWeight?: number } = {},
): AiDetectionResult {
  const empty: AiDetectionResult = {
    matched: false,
    labels: [],
    matches: [],
    totalWeight: 0,
  };

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return empty;
  }

  const minTotalWeight = options.minTotalWeight ?? 4;
  const seenLabels = new Set<string>();
  const matches: AiDetectionResult["matches"] = [];

  // Patterns built-in
  for (const p of AI_PATTERNS) {
    if (p.regex.test(text) && !seenLabels.has(p.label)) {
      seenLabels.add(p.label);
      matches.push({ label: p.label, category: p.category, weight: p.weight });
    }
  }

  // Custom keywords (weight 3 par défaut)
  if (Array.isArray(customKeywords)) {
    for (const kw of customKeywords) {
      if (!kw || typeof kw !== "string" || kw.trim().length < 2) continue;
      const trimmed = kw.trim();
      // Échapper les regex specials pour safety
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "i");
      if (regex.test(text) && !seenLabels.has(trimmed)) {
        seenLabels.add(trimmed);
        matches.push({ label: trimmed, category: "product", weight: 3 });
      }
    }
  }

  const totalWeight = matches.reduce((sum, m) => sum + m.weight, 0);
  const labels = matches.map((m) => m.label);

  return {
    matched: totalWeight >= minTotalWeight,
    labels,
    matches,
    totalWeight,
  };
}
