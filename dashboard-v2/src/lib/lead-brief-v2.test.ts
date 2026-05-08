import { describe, it, expect } from "vitest";
import {
  parseLeadBriefV2,
  parseLeadBriefV2WithError,
  isLeadBriefV2,
  LeadBriefV2Schema,
  type LeadBriefV2,
} from "./lead-brief-v2";

const validBrief: LeadBriefV2 = {
  verdict: "OUI",
  confidence: 80,
  thesis:
    "Boîte 50p qui hire QA depuis 6 mois, signal d'achat fort sur testing externalisé [src:#1].",
  triggers: [
    { source: "wttj", date: "2026-04-15", relevance: "Hire QA Manager" },
  ],
  risks: [
    { severity: "medium", description: "ESN possible vu le ratio devs/QA [src:#1]" },
    { severity: "low", description: "Timing serré côté commercial" },
  ],
  opener:
    "Bonjour, j'ai vu que vous recrutiez un QA Manager. On aide les éditeurs SaaS sans équipe QA structurée à externaliser leur testing.",
  sources: [
    { id: 1, type: "wttj", ref: "https://welcometothejungle.com/jobs/12345" },
  ],
};

describe("LeadBriefV2Schema (Zod)", () => {
  it("parse OK sur sample valide", () => {
    expect(parseLeadBriefV2(validBrief)).not.toBeNull();
  });

  it("reject thesis < 20 caractères (min Zod)", () => {
    const bad = { ...validBrief, thesis: "trop court" };
    expect(parseLeadBriefV2(bad)).toBeNull();
  });

  it("reject risks avec moins de 2 entries (min Zod)", () => {
    const bad = { ...validBrief, risks: [validBrief.risks[0]!] };
    expect(parseLeadBriefV2(bad)).toBeNull();
  });

  it("reject confidence hors plage 0-100", () => {
    expect(parseLeadBriefV2({ ...validBrief, confidence: 150 })).toBeNull();
    expect(parseLeadBriefV2({ ...validBrief, confidence: -5 })).toBeNull();
  });

  it("reject verdict en dehors de [OUI, NON, ENRICH]", () => {
    expect(parseLeadBriefV2({ ...validBrief, verdict: "MAYBE" })).toBeNull();
  });
});

describe("parseLeadBriefV2WithError", () => {
  it("retourne ok=true sur sample valide", () => {
    const r = parseLeadBriefV2WithError(validBrief);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.brief.verdict).toBe("OUI");
  });

  it("retourne ok=false avec message d'erreur lisible si invalide", () => {
    const r = parseLeadBriefV2WithError({ ...validBrief, thesis: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("thesis");
  });
});

describe("isLeadBriefV2 (type guard)", () => {
  it("retourne true pour un brief valide", () => {
    expect(isLeadBriefV2(validBrief)).toBe(true);
  });

  it("retourne false pour un input arbitraire", () => {
    expect(isLeadBriefV2(null)).toBe(false);
    expect(isLeadBriefV2({})).toBe(false);
    expect(isLeadBriefV2("string")).toBe(false);
  });
});

describe("LeadBriefV2Schema (export direct)", () => {
  it("respecte la contrainte sources ≥1", () => {
    const bad = { ...validBrief, sources: [] };
    expect(LeadBriefV2Schema.safeParse(bad).success).toBe(false);
  });
});
