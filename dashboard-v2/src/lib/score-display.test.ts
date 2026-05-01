import { describe, it, expect } from "vitest";
import {
  getPriorityVariant,
  getFitVariant,
  formatPriorityBreakdown,
  formatFitBreakdown,
  type FitBreakdown,
} from "./score-display";

describe("getPriorityVariant", () => {
  it("null/undefined → 'default' (gris)", () => {
    expect(getPriorityVariant(null)).toBe("default");
    expect(getPriorityVariant(undefined)).toBe("default");
  });
  it("0-6 → 'default' (très basse)", () => {
    expect(getPriorityVariant(0)).toBe("default");
    expect(getPriorityVariant(6)).toBe("default");
  });
  it("7-14 → 'info' (basse)", () => {
    expect(getPriorityVariant(7)).toBe("info");
    expect(getPriorityVariant(14)).toBe("info");
  });
  it("15-29 → 'brand' (moyenne)", () => {
    expect(getPriorityVariant(15)).toBe("brand");
    expect(getPriorityVariant(29)).toBe("brand");
  });
  it("≥ 30 → 'fire' (haute, top priorité)", () => {
    expect(getPriorityVariant(30)).toBe("fire");
    expect(getPriorityVariant(50)).toBe("fire");
    expect(getPriorityVariant(130)).toBe("fire");
  });
});

describe("getFitVariant", () => {
  it("null → 'default'", () => {
    expect(getFitVariant(null)).toBe("default");
  });
  it("0-49 → 'default' (faible)", () => {
    expect(getFitVariant(0)).toBe("default");
    expect(getFitVariant(49)).toBe("default");
  });
  it("50-69 → 'warning' (passable)", () => {
    expect(getFitVariant(50)).toBe("warning");
    expect(getFitVariant(69)).toBe("warning");
  });
  it("70-84 → 'info' (bon fit)", () => {
    expect(getFitVariant(70)).toBe("info");
    expect(getFitVariant(84)).toBe("info");
  });
  it("≥ 85 → 'success' (top fit)", () => {
    expect(getFitVariant(85)).toBe("success");
    expect(getFitVariant(100)).toBe("success");
  });
});

describe("formatPriorityBreakdown", () => {
  it("renvoie les composantes formatées si tous champs présents", () => {
    const r = formatPriorityBreakdown({
      score: 10,
      freshnessScore: 84,
      multiSourceBoost: 30,
    });
    expect(r).toContain("score 10");
    expect(r).toContain("84%");
    expect(r).toContain("+30");
  });
  it("omet le boost si null/0", () => {
    const r = formatPriorityBreakdown({
      score: 8,
      freshnessScore: 90,
      multiSourceBoost: 0,
    });
    expect(r).toContain("score 8");
    expect(r).toContain("90%");
    expect(r).not.toContain("+0");
    expect(r).not.toContain("multi");
  });
  it("retourne null si freshnessScore manquant (recompute pas encore fait)", () => {
    expect(
      formatPriorityBreakdown({ score: 10, freshnessScore: null, multiSourceBoost: 0 }),
    ).toBe(null);
  });
});

describe("formatFitBreakdown", () => {
  it("formatte les 4 composantes en chaîne lisible", () => {
    const breakdown: FitBreakdown = { base: 60, tenureBoost: 15, backgroundFit: 25, sizeFit: 15 };
    const r = formatFitBreakdown(breakdown);
    expect(r).toContain("base 60");
    expect(r).toContain("tenure +15");
    expect(r).toContain("background +25");
    expect(r).toContain("size +15");
  });
  it("omet les composantes à 0", () => {
    const r = formatFitBreakdown({ base: 35, tenureBoost: 0, backgroundFit: 0, sizeFit: 0 });
    expect(r).toContain("base 35");
    expect(r).not.toContain("tenure");
    expect(r).not.toContain("background");
    expect(r).not.toContain("size");
  });
  it("retourne null si breakdown null", () => {
    expect(formatFitBreakdown(null)).toBe(null);
    expect(formatFitBreakdown(undefined)).toBe(null);
  });
});
