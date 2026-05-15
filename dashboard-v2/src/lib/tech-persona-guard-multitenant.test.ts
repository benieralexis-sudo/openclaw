import { describe, it, expect } from "vitest";
import {
  inferPersonaDomain,
  isAcceptedPersonaTitle,
  isHiringTriggerForDomain,
  isSalesPersonaTitle,
  isSalesHiringTrigger,
} from "./tech-persona-guard";

describe("inferPersonaDomain — Fix B11.1 (15/05/2026)", () => {
  it("DTL ICP (CTO/Head Eng/QA Manager) → 'tech'", () => {
    const icp = {
      personas: [
        { title: "CTO", weight: 1 },
        { title: "Head of Engineering", weight: 1 },
        { title: "QA Manager", weight: 0.9 },
      ],
    };
    expect(inferPersonaDomain(icp)).toBe("tech");
  });

  it("iFIND ICP (Founder/CEO/Head of Sales/CRO/Head of Growth) → 'sales'", () => {
    const icp = {
      personas: [
        { title: "Founder", weight: 1 },
        { title: "CEO", weight: 1 },
        { title: "Head of Sales", weight: 0.95 },
        { title: "VP Sales", weight: 0.95 },
        { title: "CRO", weight: 0.95 },
        { title: "Head of Growth", weight: 0.9 },
      ],
    };
    expect(inferPersonaDomain(icp)).toBe("sales");
  });

  it("ICP vide ou null → fallback 'tech'", () => {
    expect(inferPersonaDomain(null)).toBe("tech");
    expect(inferPersonaDomain({})).toBe("tech");
    expect(inferPersonaDomain({ personas: [] })).toBe("tech");
  });

  it("ICP mixte tech + sales → 'tech' (DTL-style avec Sales secondaire)", () => {
    const icp = {
      personas: [
        { title: "CTO", weight: 1 },
        { title: "Head of Sales", weight: 0.5 },
      ],
    };
    expect(inferPersonaDomain(icp)).toBe("tech");
  });
});

describe("isSalesPersonaTitle — Fix B11.1 (15/05/2026)", () => {
  it("accepte Head of Sales/CRO/VP Sales/Head of Growth", () => {
    expect(isSalesPersonaTitle("Head of Sales")).toBe(true);
    expect(isSalesPersonaTitle("CRO")).toBe(true);
    expect(isSalesPersonaTitle("VP Sales")).toBe(true);
    expect(isSalesPersonaTitle("Head of Growth")).toBe(true);
    expect(isSalesPersonaTitle("Sales Director")).toBe(true);
    expect(isSalesPersonaTitle("CMO")).toBe(true);
  });

  it("accepte Founder/CEO/Président (décideurs PME)", () => {
    expect(isSalesPersonaTitle("Founder")).toBe(true);
    expect(isSalesPersonaTitle("CEO")).toBe(true);
    expect(isSalesPersonaTitle("Président")).toBe(true);
  });

  it("REJETTE CTO/Head of Engineering/Engineering Manager", () => {
    expect(isSalesPersonaTitle("CTO")).toBe(false);
    expect(isSalesPersonaTitle("Head of Engineering")).toBe(false);
    expect(isSalesPersonaTitle("Engineering Manager")).toBe(false);
    expect(isSalesPersonaTitle("Directeur Technique")).toBe(false);
  });

  it("REJETTE HR/Finance/Operations", () => {
    expect(isSalesPersonaTitle("Talent Acquisition")).toBe(false);
    expect(isSalesPersonaTitle("CFO")).toBe(false);
    expect(isSalesPersonaTitle("COO")).toBe(false);
  });
});

describe("isAcceptedPersonaTitle — Fix B11.1 (15/05/2026)", () => {
  it("domain=tech : route vers isTechPersonaTitle", () => {
    expect(isAcceptedPersonaTitle("CTO", "tech")).toBe(true);
    expect(isAcceptedPersonaTitle("Head of Sales", "tech")).toBe(false);
  });

  it("domain=sales : route vers isSalesPersonaTitle", () => {
    expect(isAcceptedPersonaTitle("Head of Sales", "sales")).toBe(true);
    expect(isAcceptedPersonaTitle("CTO", "sales")).toBe(false);
  });
});

describe("isSalesHiringTrigger / isHiringTriggerForDomain — Fix B11.2 (15/05/2026)", () => {
  it("sales-hire détecté sur titre Sales", () => {
    expect(isSalesHiringTrigger("HIRING_KEY", null, "Sales Manager Senior")).toBe(true);
    expect(isSalesHiringTrigger("HIRING_KEY", null, "Head of Growth")).toBe(true);
    expect(isSalesHiringTrigger("HIRING_KEY", null, "SDR France")).toBe(true);
  });

  it("sales-hire NON détecté sur titre QA/Tech", () => {
    expect(isSalesHiringTrigger("HIRING_KEY", null, "QA Engineer")).toBe(false);
    expect(isSalesHiringTrigger("HIRING_KEY", null, "Backend Developer")).toBe(false);
  });

  it("isHiringTriggerForDomain route correctement selon domain", () => {
    // DTL : tech sur QA → vrai
    expect(isHiringTriggerForDomain("HIRING_KEY", "62.02A", "QA Engineer", "tech")).toBe(true);
    // iFIND : sales sur QA → faux (boîte hire tech mais pas notre signal sales)
    expect(isHiringTriggerForDomain("HIRING_KEY", "62.02A", "QA Engineer", "sales")).toBe(false);
    // iFIND : sales sur SDR → vrai
    expect(isHiringTriggerForDomain("HIRING_KEY", "62.02A", "SDR France", "sales")).toBe(true);
  });
});
