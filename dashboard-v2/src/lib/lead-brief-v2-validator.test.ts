import { describe, it, expect } from "vitest";
import { validateLeadBriefV2Strict, formatValidationSummary } from "./lead-brief-v2-validator";
import type { LeadBriefV2 } from "./lead-brief-v2";

function makeBrief(overrides: Partial<LeadBriefV2> = {}): LeadBriefV2 {
  return {
    verdict: "OUI",
    confidence: 80,
    thesis: "Hire QA Manager confirmé chez éditeur SaaS 50p [src:#1].",
    triggers: [{ source: "wttj", date: "2026-04-15", relevance: "QA Manager" }],
    risks: [
      { severity: "medium", description: "ESN possible vu le ratio devs/QA [src:#1]" },
      { severity: "low", description: "Timing commercial serré" },
    ],
    opener:
      "Bonjour, j'ai vu votre annonce QA Manager. On aide les SaaS sans QA structuré [src:#1].",
    sources: [{ id: 1, type: "wttj", ref: "https://wttj.com/job/12345" }],
    ...overrides,
  };
}

describe("validateLeadBriefV2Strict — règle 1 : opener ≤ 250 mots", () => {
  it("error si opener > 250 mots", () => {
    const longOpener = ("mot ".repeat(260) + "[src:#1]").trim();
    const r = validateLeadBriefV2Strict(makeBrief({ opener: longOpener }));
    expect(r.ok).toBe(false);
    expect(r.errors.find((e) => e.field === "opener")).toBeDefined();
    expect(r.metrics.openerWordCount).toBeGreaterThan(250);
  });

  it("OK si opener ≤ 250 mots", () => {
    const r = validateLeadBriefV2Strict(makeBrief());
    expect(r.errors.find((e) => e.field === "opener")).toBeUndefined();
  });
});

describe("validateLeadBriefV2Strict — règle 2 : thesis doit citer [src:#X]", () => {
  it("error si thesis sans citation", () => {
    const r = validateLeadBriefV2Strict(
      makeBrief({ thesis: "Belle boîte sans aucune référence chiffrée." }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.find((e) => e.field === "thesis")).toBeDefined();
  });
});

describe("validateLeadBriefV2Strict — règle 3 : risks medium/high doivent citer", () => {
  it("error si risk severity=medium sans citation", () => {
    const r = validateLeadBriefV2Strict(
      makeBrief({
        risks: [
          { severity: "medium", description: "ESN possible mais aucune source citée" },
          { severity: "low", description: "Timing serré" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.find((e) => e.field.startsWith("risks["))).toBeDefined();
  });

  it("OK si risk severity=low sans citation (toléré)", () => {
    const r = validateLeadBriefV2Strict(
      makeBrief({
        risks: [
          { severity: "high", description: "Insolvency 2024 [src:#1]" },
          { severity: "low", description: "Timing serré (sans citation)" },
        ],
      }),
    );
    expect(r.errors.find((e) => e.field.startsWith("risks["))).toBeUndefined();
  });

  it("error si risk severity=high sans citation", () => {
    const r = validateLeadBriefV2Strict(
      makeBrief({
        risks: [
          { severity: "high", description: "Big risk sans citation" },
          { severity: "low", description: "Timing serré" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("validateLeadBriefV2Strict — règle 4 : citations doivent exister dans sources", () => {
  it("error si citation pointe vers id absent de sources[]", () => {
    const r = validateLeadBriefV2Strict(
      makeBrief({
        thesis: "Hire QA confirmé [src:#42] (id inexistant)",
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.find((e) => e.field === "citations")).toBeDefined();
  });
});

describe("validateLeadBriefV2Strict — règle 6 : ENRICH doit avoir enrichmentNeeded", () => {
  it("error si verdict=ENRICH sans enrichmentNeeded", () => {
    const r = validateLeadBriefV2Strict(
      makeBrief({ verdict: "ENRICH", enrichmentNeeded: undefined }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.find((e) => e.field === "enrichmentNeeded")).toBeDefined();
  });

  it("OK si verdict=ENRICH avec enrichmentNeeded ≥1", () => {
    const r = validateLeadBriefV2Strict(
      makeBrief({ verdict: "ENRICH", enrichmentNeeded: ["LinkedIn URL CTO"] }),
    );
    expect(r.errors.find((e) => e.field === "enrichmentNeeded")).toBeUndefined();
  });
});

describe("validateLeadBriefV2Strict — règle 7 : OUI/NON ne doit PAS avoir enrichmentNeeded (warning)", () => {
  it("warning si verdict=OUI avec enrichmentNeeded non-vide", () => {
    const r = validateLeadBriefV2Strict(
      makeBrief({ verdict: "OUI", enrichmentNeeded: ["incohérent"] }),
    );
    // Pas une erreur, juste un warning
    expect(r.warnings.find((w) => w.field === "enrichmentNeeded")).toBeDefined();
  });
});

describe("validateLeadBriefV2Strict — règle 8 : OUI/NON avec confidence<50 (warning)", () => {
  it("warning si verdict=OUI confidence=30", () => {
    const r = validateLeadBriefV2Strict(makeBrief({ confidence: 30 }));
    expect(r.warnings.find((w) => w.field === "confidence")).toBeDefined();
  });
});

describe("formatValidationSummary", () => {
  it("affiche ✅ + métriques si ok", () => {
    const r = validateLeadBriefV2Strict(makeBrief());
    expect(formatValidationSummary(r)).toContain("✅");
    expect(formatValidationSummary(r)).toContain("openerWords");
  });

  it("affiche ❌ + top 3 errors si KO", () => {
    const r = validateLeadBriefV2Strict(
      makeBrief({ thesis: "Pas de citation", opener: "court" }),
    );
    expect(formatValidationSummary(r)).toContain("❌");
  });
});

describe("validateLeadBriefV2Strict — métriques", () => {
  it("compte correctement openerWordCount, citations, sources", () => {
    const r = validateLeadBriefV2Strict(makeBrief());
    expect(r.metrics.openerWordCount).toBeGreaterThan(0);
    expect(r.metrics.citationsInThesis).toBeGreaterThanOrEqual(1);
    expect(r.metrics.sourcesCited).toBe(1);
    expect(r.metrics.sourcesOrphan).toBe(0);
  });
});
