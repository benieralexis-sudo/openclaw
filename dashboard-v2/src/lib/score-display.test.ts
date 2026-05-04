import { describe, it, expect } from "vitest";
import {
  getPriorityVariant,
  getFitVariant,
  formatPriorityBreakdown,
  formatFitBreakdown,
  getCombinedScore,
  getCombinedTier,
  getCombinedLabel,
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

// ──────────────────────────────────────────────────────────────────────
// Score combiné HYBRIDE (refonte 04/05/2026 — investigation 9 trous)
// ──────────────────────────────────────────────────────────────────────

describe("getCombinedScore (formule hybride)", () => {
  it("Paul Vidal cas réel — priority 37 (sat 100), fit 80 → 100 (Brûlant + bonus synergie)", () => {
    // priority 37 → pNorm 100, fit 80 ≥ 60 → bonus +15 → 100+15 cap 100
    expect(getCombinedScore({ priorityScore: 37, fitScore: 80 })).toBe(100);
  });

  it("Asys cas réel — priority 22 (pNorm 63), fit 100 → 100 (synergie pNorm≥60 ET fit≥60)", () => {
    // pNorm 62.86, fit 100, max=100, bonus +15, cap 100
    expect(getCombinedScore({ priorityScore: 22, fitScore: 100 })).toBe(100);
  });

  it("Renaud Montagne cas réel — priority 6 (pNorm 17), fit 85 → 85 (un seul axe haut, pas de bonus)", () => {
    // pNorm 17, fit 85, max=85, pas bonus (pNorm<60), pas penalty
    expect(getCombinedScore({ priorityScore: 6, fitScore: 85 })).toBe(85);
  });

  it("B-HIVE cas réel — priority 4 (pNorm 11), fit 90 → 90 (fit dominant)", () => {
    expect(getCombinedScore({ priorityScore: 4, fitScore: 90 })).toBe(90);
  });

  it("SOLUTEC cas réel — priority 22 (pNorm 63), fit 80 → 95 (synergie +15)", () => {
    // pNorm 62.86, fit 80, max=80, bonus +15 → 95
    expect(getCombinedScore({ priorityScore: 22, fitScore: 80 })).toBe(95);
  });

  it("Lead pourri — priority 5 (pNorm 14), fit 25 → 14 (penalty -10 mais clip 0+)", () => {
    // pNorm 14, fit 25, max=25, pas bonus, penalty -10 → 15
    expect(getCombinedScore({ priorityScore: 5, fitScore: 25 })).toBe(15);
  });

  it("Lead très pourri — priority 1 (pNorm 3), fit 28 → 18 (max 28, penalty -10 = 18)", () => {
    expect(getCombinedScore({ priorityScore: 1, fitScore: 28 })).toBe(18);
  });

  it("priority null + fit 70 → 70 (prend fit seul)", () => {
    expect(getCombinedScore({ priorityScore: null, fitScore: 70 })).toBe(70);
  });

  it("fit null + priority 22 → 63 (prend pNorm seul)", () => {
    expect(getCombinedScore({ priorityScore: 22, fitScore: null })).toBe(63);
  });

  it("les deux null → null", () => {
    expect(getCombinedScore({ priorityScore: null, fitScore: null })).toBe(null);
    expect(getCombinedScore({ priorityScore: undefined, fitScore: undefined })).toBe(null);
  });

  it("score est borné 0-100 (clamping safety)", () => {
    expect(getCombinedScore({ priorityScore: 50, fitScore: 100 })).toBeLessThanOrEqual(100);
    expect(getCombinedScore({ priorityScore: 0, fitScore: 0 })).toBeGreaterThanOrEqual(0);
  });
});

describe("getCombinedTier", () => {
  it("75+ → fire", () => expect(getCombinedTier(80)).toBe("fire"));
  it("65 → hot", () => expect(getCombinedTier(65)).toBe("hot"));
  it("55 → warm", () => expect(getCombinedTier(55)).toBe("warm"));
  it("35 → tepid", () => expect(getCombinedTier(35)).toBe("tepid"));
  it("0 → cold", () => expect(getCombinedTier(0)).toBe("cold"));
  it("null → null", () => expect(getCombinedTier(null)).toBe(null));
});

describe("getCombinedLabel", () => {
  it("fire → Brûlant", () => expect(getCombinedLabel("fire")).toBe("Brûlant"));
  it("hot → Très chaud", () => expect(getCombinedLabel("hot")).toBe("Très chaud"));
  it("warm → Chaud", () => expect(getCombinedLabel("warm")).toBe("Chaud"));
  it("tepid → Tiède", () => expect(getCombinedLabel("tepid")).toBe("Tiède"));
  it("cold → Faible", () => expect(getCombinedLabel("cold")).toBe("Faible"));
  it("null → —", () => expect(getCombinedLabel(null)).toBe("—"));
});
