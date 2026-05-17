import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildPrompt, parseHaikuResponse } from "./persona-ai-fallback";

describe("buildPrompt", () => {
  it("inclut companyName + signalType + ICP summary", () => {
    const prompt = buildPrompt({
      companyName: "Acme SAS",
      signalType: "qa-hire",
      icpSummary: "iFIND vend des leads B2B",
      companyContext: {
        sizeHint: "30p",
        industry: "SaaS B2B",
        triggerSummary: "Hire QA Automation Engineer J+4",
      },
    });
    expect(prompt).toContain("Acme SAS");
    expect(prompt).toContain("qa-hire");
    expect(prompt).toContain("iFIND vend des leads B2B");
    expect(prompt).toContain("30p");
    expect(prompt).toContain("SaaS B2B");
    expect(prompt).toContain("Hire QA Automation Engineer");
  });

  it("fonctionne sans context optionnel", () => {
    const prompt = buildPrompt({
      companyName: "Acme",
      signalType: "sales-hire",
    });
    expect(prompt).toContain("Acme");
    expect(prompt).toContain("sales-hire");
    expect(prompt).not.toContain("Taille équipe");
    expect(prompt).not.toContain("Profil client");
  });
});

describe("parseHaikuResponse", () => {
  it("parse JSON propre", () => {
    const text = `{"targetTitle":"Head of QA","searchTermsLinkedIn":["Head of QA","QA Manager","Test Lead"],"reasoning":"Boîte 30p SaaS","confidence":85}`;
    const r = parseHaikuResponse(text);
    expect(r).toEqual({
      targetTitle: "Head of QA",
      searchTermsLinkedIn: ["Head of QA", "QA Manager", "Test Lead"],
      reasoning: "Boîte 30p SaaS",
      confidence: 85,
    });
  });

  it("strip ```json blocks", () => {
    const text =
      "```json\n{\"targetTitle\":\"CTO\",\"searchTermsLinkedIn\":[\"CTO\"],\"reasoning\":\"X\",\"confidence\":80}\n```";
    const r = parseHaikuResponse(text);
    expect(r?.targetTitle).toBe("CTO");
  });

  it("extrait JSON même si prose autour", () => {
    const text = `Voici ma réponse:\n{"targetTitle":"CRO","searchTermsLinkedIn":["CRO","Head of Sales"],"reasoning":"X","confidence":75}\nVoilà.`;
    const r = parseHaikuResponse(text);
    expect(r?.targetTitle).toBe("CRO");
    expect(r?.searchTermsLinkedIn).toHaveLength(2);
  });

  it("filtre searchTermsLinkedIn non-string", () => {
    const text = `{"targetTitle":"X","searchTermsLinkedIn":["A",null,42,"B",""],"reasoning":"X","confidence":50}`;
    const r = parseHaikuResponse(text);
    expect(r?.searchTermsLinkedIn).toEqual(["A", "B"]);
  });

  it("clamp confidence à 0-100", () => {
    const t1 = `{"targetTitle":"X","searchTermsLinkedIn":["X"],"reasoning":"X","confidence":150}`;
    const t2 = `{"targetTitle":"X","searchTermsLinkedIn":["X"],"reasoning":"X","confidence":-20}`;
    expect(parseHaikuResponse(t1)?.confidence).toBe(100);
    expect(parseHaikuResponse(t2)?.confidence).toBe(0);
  });

  it("retourne null si JSON invalide", () => {
    expect(parseHaikuResponse("pas du JSON")).toBeNull();
    expect(parseHaikuResponse("{invalid")).toBeNull();
  });

  it("retourne null si champs obligatoires manquants", () => {
    const t1 = `{"targetTitle":"X"}`;
    const t2 = `{"searchTermsLinkedIn":["X"]}`;
    const t3 = `{"targetTitle":"X","searchTermsLinkedIn":["X"],"reasoning":"X"}`;
    expect(parseHaikuResponse(t1)).toBeNull();
    expect(parseHaikuResponse(t2)).toBeNull();
    expect(parseHaikuResponse(t3)).toBeNull(); // pas de confidence
  });

  it("cap searchTermsLinkedIn à 10 max", () => {
    const terms = Array.from({ length: 15 }, (_, i) => `Term${i}`);
    const text = JSON.stringify({
      targetTitle: "X",
      searchTermsLinkedIn: terms,
      reasoning: "X",
      confidence: 50,
    });
    const r = parseHaikuResponse(text);
    expect(r?.searchTermsLinkedIn).toHaveLength(10);
  });
});
