import { describe, expect, it } from "vitest";
import {
  getSignalCodeFromSourceCode,
  getSourceCodesForSignal,
  CATALOG_SIGNAL_CODES,
  SIGNAL_NAMES,
} from "./signal-mapping";

describe("signal-mapping — getSignalCodeFromSourceCode", () => {
  it("mappe les pollers Apify jobs vers P1 (Recrutement)", () => {
    expect(getSignalCodeFromSourceCode("apify.linkedin-jobs")).toBe("P1");
    expect(getSignalCodeFromSourceCode("apify.wttj-jobs")).toBe("P1");
    expect(getSignalCodeFromSourceCode("apify.indeed-jobs")).toBe("P1");
    expect(getSignalCodeFromSourceCode("apify.france-jobs")).toBe("P1");
    expect(getSignalCodeFromSourceCode("francetravail.tech")).toBe("P1");
  });

  it("mappe Rodz job-offers vers P1", () => {
    expect(getSignalCodeFromSourceCode("rodz.job-offers")).toBe("P1");
    expect(getSignalCodeFromSourceCode("rodz.recruitment-campaign")).toBe("P1");
  });

  it("mappe apify.ai-adoption vers P4 (Adoption IA)", () => {
    expect(getSignalCodeFromSourceCode("apify.ai-adoption")).toBe("P4");
  });

  it("mappe pappers.headcount-growth vers P5 (Croissance effectif)", () => {
    expect(getSignalCodeFromSourceCode("pappers.headcount-growth")).toBe("P5");
  });

  it("mappe les sources de levée vers B1 (fusion de B6 capital_increase)", () => {
    expect(getSignalCodeFromSourceCode("rodz.fundraising")).toBe("B1");
    expect(getSignalCodeFromSourceCode("rss-levees")).toBe("B1");
    expect(getSignalCodeFromSourceCode("bodacc.capital_increase")).toBe("B1");
  });

  it("mappe pappers.leadership-change vers B2 (Nouveau C-Level)", () => {
    expect(getSignalCodeFromSourceCode("pappers.leadership-change")).toBe("B2");
    expect(getSignalCodeFromSourceCode("rodz.job-changes")).toBe("B2");
  });

  it("mappe bodacc.company_merger vers B3 (Fusion/Acquisition)", () => {
    expect(getSignalCodeFromSourceCode("bodacc.company_merger")).toBe("B3");
    expect(getSignalCodeFromSourceCode("rodz.mergers-acquisitions")).toBe("B3");
  });

  it("mappe inpi.marque vers B5 (Dépôt INPI)", () => {
    expect(getSignalCodeFromSourceCode("inpi.marque")).toBe("B5");
  });

  it("retourne null pour un sourceCode inconnu (legacy)", () => {
    expect(getSignalCodeFromSourceCode("unknown.source")).toBeNull();
    expect(getSignalCodeFromSourceCode("legacy-old-poller")).toBeNull();
  });

  it("retourne null pour null/undefined/empty", () => {
    expect(getSignalCodeFromSourceCode(null)).toBeNull();
    expect(getSignalCodeFromSourceCode(undefined)).toBeNull();
    expect(getSignalCodeFromSourceCode("")).toBeNull();
  });
});

describe("signal-mapping — getSourceCodesForSignal", () => {
  it("retourne toutes les sources qui mappent à P1", () => {
    const sources = getSourceCodesForSignal("P1");
    expect(sources).toContain("apify.linkedin-jobs");
    expect(sources).toContain("apify.wttj-jobs");
    expect(sources).toContain("francetravail.tech");
    expect(sources).toContain("rodz.job-offers");
    expect(sources.length).toBeGreaterThanOrEqual(5);
  });

  it("retourne toutes les sources qui mappent à B1 (Levée, incluant ex-B6)", () => {
    const sources = getSourceCodesForSignal("B1");
    expect(sources).toContain("rodz.fundraising");
    expect(sources).toContain("rss-levees");
    expect(sources).toContain("bodacc.capital_increase");
  });

  it("retourne tableau vide pour signal sans mapping", () => {
    expect(getSourceCodesForSignal("ZZ_INEXISTANT")).toEqual([]);
  });
});

describe("signal-mapping — catalogue constants", () => {
  it("CATALOG_SIGNAL_CODES contient 11 signaux ACTIVE", () => {
    expect(CATALOG_SIGNAL_CODES.length).toBe(11);
    expect(CATALOG_SIGNAL_CODES).toContain("P1");
    expect(CATALOG_SIGNAL_CODES).toContain("P5");
    expect(CATALOG_SIGNAL_CODES).toContain("B1");
    expect(CATALOG_SIGNAL_CODES).toContain("B7");
    // B6 fusionné dans B1, donc absent
    expect(CATALOG_SIGNAL_CODES).not.toContain("B6");
  });

  it("SIGNAL_NAMES couvre tous les codes du catalogue", () => {
    for (const code of CATALOG_SIGNAL_CODES) {
      expect(SIGNAL_NAMES[code]).toBeDefined();
      expect(SIGNAL_NAMES[code]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
