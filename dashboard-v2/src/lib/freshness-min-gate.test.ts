import { describe, it, expect } from "vitest";
import { getMinFreshnessDays } from "./freshness-min-gate";

// ICP DTL réel (12/05/2026 — extrait Client.icp en DB)
const DTL_FRESHNESS = {
  levee: { minDays: 15, maxDays: 120, staleAfterDays: 180 },
  hireQA: { minDays: 0, maxDays: 90 },
  changementCLevel: { minDays: 30, maxDays: 180 },
};

describe("getMinFreshnessDays", () => {
  it("retourne null si icpFreshness absent", () => {
    expect(getMinFreshnessDays("FUNDRAISING", "Levée 8M€", null)).toBe(null);
    expect(getMinFreshnessDays("FUNDRAISING", "Levée 8M€", undefined)).toBe(null);
  });

  it("retourne null si triggerType absent", () => {
    expect(getMinFreshnessDays(null, "QA Engineer", DTL_FRESHNESS)).toBe(null);
    expect(getMinFreshnessDays("", "QA Engineer", DTL_FRESHNESS)).toBe(null);
  });

  it("FUNDRAISING → icp.levee.minDays (DTL = 15)", () => {
    expect(
      getMinFreshnessDays("FUNDRAISING", "Levée 8M€ Série A", DTL_FRESHNESS),
    ).toBe(15);
  });

  it("CAPITAL_INCREASE → icp.levee.minDays (proxy BODACC)", () => {
    expect(
      getMinFreshnessDays("CAPITAL_INCREASE", "Augmentation capital", DTL_FRESHNESS),
    ).toBe(15);
  });

  it("LEADERSHIP_CHANGE → icp.changementCLevel.minDays (DTL = 30)", () => {
    expect(
      getMinFreshnessDays("LEADERSHIP_CHANGE", "Nouveau CTO", DTL_FRESHNESS),
    ).toBe(30);
  });

  it("HIRING_KEY + titre QA → icp.hireQA.minDays (DTL = 0)", () => {
    expect(
      getMinFreshnessDays("HIRING_KEY", "QA Engineer Senior", DTL_FRESHNESS),
    ).toBe(0);
    expect(
      getMinFreshnessDays("HIRING_KEY", "Test Manager", DTL_FRESHNESS),
    ).toBe(0);
    expect(
      getMinFreshnessDays("HIRING_KEY", "Quality Lead H/F", DTL_FRESHNESS),
    ).toBe(0);
    expect(getMinFreshnessDays("HIRING_KEY", "SDET", DTL_FRESHNESS)).toBe(0);
    expect(
      getMinFreshnessDays("HIRING_KEY", "Automaticien de Test", DTL_FRESHNESS),
    ).toBe(0);
  });

  it("HIRING_KEY non-QA → null (pas de gate ICP DTL)", () => {
    expect(
      getMinFreshnessDays("HIRING_KEY", "Sales Manager", DTL_FRESHNESS),
    ).toBe(null);
    expect(
      getMinFreshnessDays("HIRING_KEY", "Product Owner", DTL_FRESHNESS),
    ).toBe(null);
  });

  it("BUYING_INTENT / OTHER → null", () => {
    expect(
      getMinFreshnessDays("BUYING_INTENT", "Boîte utilise Cypress", DTL_FRESHNESS),
    ).toBe(null);
    expect(getMinFreshnessDays("OTHER", "n/a", DTL_FRESHNESS)).toBe(null);
  });

  it("ICP partiel — clé manquante → null", () => {
    const icpPartial = { levee: { minDays: 15 } };
    expect(getMinFreshnessDays("FUNDRAISING", "Levée", icpPartial)).toBe(15);
    // LEADERSHIP_CHANGE absent → null
    expect(getMinFreshnessDays("LEADERSHIP_CHANGE", "CTO", icpPartial)).toBe(null);
  });

  it("ICP sans minDays sur la clé → null", () => {
    const icpNoMinDays = { levee: { maxDays: 120 } };
    expect(getMinFreshnessDays("FUNDRAISING", "Levée", icpNoMinDays)).toBe(null);
  });
});
