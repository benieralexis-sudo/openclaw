import { describe, expect, it } from "vitest";
import { detectAiKeywords } from "./ai-tool-detector";

describe("detectAiKeywords", () => {
  describe("input invalide", () => {
    it("retourne matched=false pour null/undefined/vide", () => {
      expect(detectAiKeywords(null).matched).toBe(false);
      expect(detectAiKeywords(undefined).matched).toBe(false);
      expect(detectAiKeywords("").matched).toBe(false);
      expect(detectAiKeywords("   ").matched).toBe(false);
    });
  });

  describe("modèles LLM", () => {
    it.each([
      "We use GPT-4 to generate content",
      "Integration avec OpenAI API",
      "Built on Anthropic Claude",
      "Use Claude Sonnet for reasoning",
      "Powered by Gemini Pro",
      "Llama 3 fine-tuning experience",
      "Stack inclut Mistral AI",
    ])("détecte modèle dans: %s", (text) => {
      const out = detectAiKeywords(text);
      expect(out.matched).toBe(true);
      expect(out.totalWeight).toBeGreaterThanOrEqual(4);
    });
  });

  describe("frameworks AI", () => {
    it("détecte LangChain", () => {
      const out = detectAiKeywords("Looking for LangChain experience");
      expect(out.matched).toBe(true);
      expect(out.labels).toContain("LangChain");
    });

    it("détecte LlamaIndex", () => {
      const out = detectAiKeywords("Built with LlamaIndex for RAG pipelines");
      expect(out.matched).toBe(true);
      expect(out.labels).toContain("LlamaIndex");
      expect(out.labels).toContain("RAG");
    });

    it("détecte Hugging Face avec espace", () => {
      const out = detectAiKeywords("Models hosted on Hugging Face");
      expect(out.matched).toBe(true);
      expect(out.labels).toContain("Hugging Face");
    });
  });

  describe("vector DBs", () => {
    it.each([["Pinecone"], ["Weaviate"], ["Qdrant"], ["Chroma"], ["Milvus"], ["pgvector"]])(
      "détecte %s",
      (db) => {
        const out = detectAiKeywords(`Using ${db} for vector storage`);
        expect(out.matched).toBe(true);
        expect(out.labels).toContain(db === "Chroma" ? "Chroma" : db);
      },
    );
  });

  describe("concepts AI", () => {
    it("détecte RAG isolé", () => {
      const out = detectAiKeywords("Build a RAG system");
      expect(out.labels).toContain("RAG");
    });

    it("détecte 'Retrieval Augmented Generation'", () => {
      const out = detectAiKeywords("Implement Retrieval Augmented Generation pipelines");
      expect(out.labels).toContain("RAG full");
    });

    it("détecte vector search/database/embeddings", () => {
      expect(detectAiKeywords("vector database").matched).toBe(true);
      expect(detectAiKeywords("vector search experience").matched).toBe(true);
      expect(detectAiKeywords("Create vector embeddings").matched).toBe(true);
    });

    it("détecte fine-tuning et finetuning", () => {
      expect(detectAiKeywords("Model fine-tuning").labels).toContain("fine-tuning");
      expect(detectAiKeywords("Model finetuning").labels).toContain("fine-tuning");
    });

    it("détecte LLM et LLMOps", () => {
      expect(detectAiKeywords("Experience with LLMs").labels).toContain("LLM/LLMOps");
      expect(detectAiKeywords("LLMOps platform").labels).toContain("LLM/LLMOps");
    });
  });

  describe("titres de poste AI", () => {
    it.each([
      ["Senior ML Engineer", "ML Engineer"],
      ["Machine Learning Engineer", "ML Engineer"],
      ["AI Engineer", "AI Engineer"],
      ["Prompt Engineer", "Prompt Engineer"],
      ["MLOps Engineer", "MLOps"],
      ["Lead AI Researcher", "AI Researcher/Scientist"],
    ])("détecte titre %s", (text, expectedLabel) => {
      const out = detectAiKeywords(text);
      expect(out.matched).toBe(true);
      expect(out.labels).toContain(expectedLabel);
    });
  });

  describe("faux positifs évités", () => {
    it("ne match pas 'AI' tout seul (trop large)", () => {
      const out = detectAiKeywords("AI Marketing", undefined, { minTotalWeight: 4 });
      expect(out.matched).toBe(false);
    });

    it("ne match pas 'ML' tout seul (trop large)", () => {
      const out = detectAiKeywords("ML algorithms", undefined, { minTotalWeight: 4 });
      // "ML" tout seul n'est pas dans les patterns, et "Machine Learning" sans
      // "Engineer" non plus → pas de match
      expect(out.matched).toBe(false);
    });

    it("ne match pas un texte sans aucun keyword AI", () => {
      const out = detectAiKeywords(
        "Looking for a senior QA engineer with Selenium and Cypress experience",
      );
      expect(out.matched).toBe(false);
      expect(out.labels).toEqual([]);
    });
  });

  describe("customKeywords", () => {
    it("matche un keyword custom (cumul avec built-in)", () => {
      const out = detectAiKeywords("We use Cohere and Pinecone for vector search", ["Cohere"]);
      expect(out.labels).toContain("Cohere");
      expect(out.labels).toContain("Pinecone");
      // weight Cohere custom (3) + Pinecone (5) + vector search (4) = 12 >= 4
      expect(out.matched).toBe(true);
    });

    it("custom seul avec weight 3 ne match pas le threshold default 4", () => {
      const out = detectAiKeywords("We use Cohere here", ["Cohere"]);
      expect(out.labels).toEqual(["Cohere"]);
      expect(out.totalWeight).toBe(3);
      expect(out.matched).toBe(false);
    });

    it("ignore les keywords custom vides/trop courts", () => {
      const out = detectAiKeywords("Using OpenAI", ["", " ", "a", null as any]);
      // Seul OpenAI matche depuis les built-in
      expect(out.labels).toEqual(["OpenAI"]);
    });

    it("escape les regex specials dans custom", () => {
      const out = detectAiKeywords("Using product.x.special tool", ["product.x.special"]);
      // Should match literally, not as regex with . wildcards
      expect(out.labels).toContain("product.x.special");
    });
  });

  describe("seuil minTotalWeight", () => {
    it("matched=false si weight cumulé < seuil par défaut (4)", () => {
      // GitHub Copilot weight 3 seul → 3 < 4
      const out = detectAiKeywords("Use GitHub Copilot daily");
      expect(out.totalWeight).toBe(3);
      expect(out.matched).toBe(false);
    });

    it("matched=true si custom minTotalWeight plus bas", () => {
      const out = detectAiKeywords("Use GitHub Copilot daily", undefined, {
        minTotalWeight: 3,
      });
      expect(out.matched).toBe(true);
    });

    it("matched=true par cumul même si chaque match individuel est faible", () => {
      // Cursor (3) + Copilot (3) = 6 >= 4
      const out = detectAiKeywords("We use Cursor and GitHub Copilot");
      expect(out.matched).toBe(true);
      expect(out.totalWeight).toBe(6);
    });
  });

  describe("scénario réel — job descriptions LinkedIn", () => {
    it("détecte une vraie offre AI Engineer", () => {
      const text = `Senior AI Engineer
        Build production LLM pipelines using LangChain and Pinecone.
        Experience with OpenAI GPT-4, prompt engineering, RAG architecture.
        Bonus : fine-tuning open-source models on Hugging Face.`;
      const out = detectAiKeywords(text);
      expect(out.matched).toBe(true);
      expect(out.labels).toEqual(
        expect.arrayContaining([
          "AI Engineer",
          "LLM/LLMOps",
          "LangChain",
          "Pinecone",
          "OpenAI",
          "GPT",
          "prompt engineering",
          "RAG",
          "fine-tuning",
          "Hugging Face",
        ]),
      );
      expect(out.totalWeight).toBeGreaterThan(30);
    });

    it("ne match pas une offre QA classique sans AI", () => {
      const text = `Lead QA Automation Engineer
        Selenium, Cypress, Playwright, TestRail.
        Experience BDD/TDD, CI/CD GitLab.`;
      const out = detectAiKeywords(text);
      expect(out.matched).toBe(false);
      expect(out.labels).toEqual([]);
    });

    it("match avec faible signal une mention isolée de Copilot", () => {
      const text = `Senior Backend Engineer
        Node.js, TypeScript, GitHub Copilot used for code completion.`;
      const out = detectAiKeywords(text);
      // Copilot weight 3 < 4 → pas matched
      expect(out.matched).toBe(false);
      expect(out.labels).toContain("Copilot");
    });
  });

  describe("retour structuré", () => {
    it("retourne labels uniques (pas de doublon)", () => {
      const text = "GPT-4 and GPT-4o with OpenAI"; // GPT match 2 fois → label unique
      const out = detectAiKeywords(text);
      const gptCount = out.labels.filter((l) => l === "GPT").length;
      expect(gptCount).toBe(1);
    });

    it("retourne matches avec category", () => {
      const out = detectAiKeywords("LangChain and Pinecone");
      const categories = out.matches.map((m) => m.category).sort();
      expect(categories).toEqual(["framework", "vector-db"]);
    });
  });
});
