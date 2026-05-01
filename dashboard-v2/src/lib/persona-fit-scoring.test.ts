import { describe, it, expect } from "vitest";
import {
  computeBaseScore,
  computeTenureBoost,
  computeBackgroundFit,
  computeSizeFit,
  computeFitScore,
  type FitInputs,
} from "./persona-fit-scoring";

// ────────────────────────────────────────────────────────────────────
// Sub-scorer 1: base score by personaTier
// ────────────────────────────────────────────────────────────────────

describe("computeBaseScore", () => {
  it("Tier 1 (CTO/Founder) → 60", () => {
    expect(computeBaseScore(1)).toBe(60);
  });
  it("Tier 2 (Eng Manager/DSI) → 50", () => {
    expect(computeBaseScore(2)).toBe(50);
  });
  it("Tier 3 (CEO/Directeur fallback) → 35", () => {
    expect(computeBaseScore(3)).toBe(35);
  });
  it("Tier null → 30 (lowest, données incomplètes)", () => {
    expect(computeBaseScore(null)).toBe(30);
    expect(computeBaseScore(undefined)).toBe(30);
  });
  it("Tier inconnu (4, 0) → 30 fallback", () => {
    expect(computeBaseScore(4)).toBe(30);
    expect(computeBaseScore(0)).toBe(30);
  });
});

// ────────────────────────────────────────────────────────────────────
// Sub-scorer 2: tenure boost (sweet spot 6-36 mois)
// ────────────────────────────────────────────────────────────────────

describe("computeTenureBoost", () => {
  it("null → 0 (pas de donnée)", () => {
    expect(computeTenureBoost(null)).toBe(0);
  });
  it("< 6 mois → +5 (en construction, peu fiable)", () => {
    expect(computeTenureBoost(1)).toBe(5);
    expect(computeTenureBoost(5)).toBe(5);
  });
  it("6-36 mois → +15 (sweet spot)", () => {
    expect(computeTenureBoost(6)).toBe(15);
    expect(computeTenureBoost(18)).toBe(15);
    expect(computeTenureBoost(36)).toBe(15);
  });
  it("36-60 mois → +10 (installé)", () => {
    expect(computeTenureBoost(37)).toBe(10);
    expect(computeTenureBoost(48)).toBe(10);
    expect(computeTenureBoost(60)).toBe(10);
  });
  it("> 60 mois → +5 (très ancré, parfois moins ouvert)", () => {
    expect(computeTenureBoost(61)).toBe(5);
    expect(computeTenureBoost(120)).toBe(5);
  });
  it("0 → 5 (vient juste de prendre le poste)", () => {
    expect(computeTenureBoost(0)).toBe(5);
  });
});

// ────────────────────────────────────────────────────────────────────
// Sub-scorer 3: background fit (selon ICP du client)
// ────────────────────────────────────────────────────────────────────

describe("computeBackgroundFit", () => {
  it("ICP DTL (Tech/SaaS+ESN) + hasESN → +20", () => {
    const r = computeBackgroundFit(
      { hasESNBackground: true, hasSaaSBackground: false, hasStartupBackground: false },
      { wantsESN: true, wantsSaaS: true },
    );
    expect(r).toBe(20);
  });
  it("ICP wants SaaS + hasSaaS → +15", () => {
    const r = computeBackgroundFit(
      { hasESNBackground: false, hasSaaSBackground: true, hasStartupBackground: false },
      { wantsESN: false, wantsSaaS: true },
    );
    expect(r).toBe(15);
  });
  it("Combo SaaS+ESN matchés → cap à 25", () => {
    const r = computeBackgroundFit(
      { hasESNBackground: true, hasSaaSBackground: true, hasStartupBackground: false },
      { wantsESN: true, wantsSaaS: true },
    );
    expect(r).toBe(25);
  });
  it("Background hors ICP → 0", () => {
    const r = computeBackgroundFit(
      { hasESNBackground: false, hasSaaSBackground: false, hasStartupBackground: false },
      { wantsESN: true, wantsSaaS: true },
    );
    expect(r).toBe(0);
  });
  it("hasStartup + ICP wantsStartup → +10", () => {
    const r = computeBackgroundFit(
      { hasESNBackground: false, hasSaaSBackground: false, hasStartupBackground: true },
      { wantsESN: false, wantsSaaS: false, wantsStartup: true },
    );
    expect(r).toBe(10);
  });
});

// ────────────────────────────────────────────────────────────────────
// Sub-scorer 4: size fit (entreprise dans la tranche ICP)
// ────────────────────────────────────────────────────────────────────

describe("computeSizeFit", () => {
  it("Boîte 50p, ICP 11-200 → +15", () => {
    expect(computeSizeFit(50, { sizeMin: 11, sizeMax: 200 })).toBe(15);
  });
  it("Boîte 5p, ICP 11-200 → 0 (trop petit)", () => {
    expect(computeSizeFit(5, { sizeMin: 11, sizeMax: 200 })).toBe(0);
  });
  it("Boîte 500p, ICP 11-200 → 0 (trop grand)", () => {
    expect(computeSizeFit(500, { sizeMin: 11, sizeMax: 200 })).toBe(0);
  });
  it("Boîte exactement à la limite basse → +15", () => {
    expect(computeSizeFit(11, { sizeMin: 11, sizeMax: 200 })).toBe(15);
  });
  it("Boîte exactement à la limite haute → +15", () => {
    expect(computeSizeFit(200, { sizeMin: 11, sizeMax: 200 })).toBe(15);
  });
  it("Pas de companyEtabsCount (null) → 0", () => {
    expect(computeSizeFit(null, { sizeMin: 11, sizeMax: 200 })).toBe(0);
  });
  it("Pas d'ICP size renseigné → 0", () => {
    expect(computeSizeFit(50, {})).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// Score composite final
// ────────────────────────────────────────────────────────────────────

describe("computeFitScore", () => {
  it("CTO Tier 1 + 2 ans poste + ESN background + boîte 50p (parfait DTL)", () => {
    const inputs: FitInputs = {
      personaTier: 1,
      currentTenureMonths: 24,
      backgrounds: { hasESNBackground: true, hasSaaSBackground: true, hasStartupBackground: false },
      companyEtabsCount: 12,
      icp: { wantsESN: true, wantsSaaS: true, sizeMin: 11, sizeMax: 200 },
    };
    const r = computeFitScore(inputs);
    // 60 + 15 + 25 + 15 = 115 → cap 100
    expect(r.score).toBe(100);
    expect(r.breakdown.base).toBe(60);
    expect(r.breakdown.tenureBoost).toBe(15);
    expect(r.breakdown.backgroundFit).toBe(25);
    expect(r.breakdown.sizeFit).toBe(15);
  });

  it("Tier 3 fallback CEO + pas de profil LinkedIn (Pappers RCS)", () => {
    const inputs: FitInputs = {
      personaTier: 3,
      currentTenureMonths: null,
      backgrounds: null,
      companyEtabsCount: null,
      icp: { wantsESN: true, wantsSaaS: true, sizeMin: 11, sizeMax: 200 },
    };
    const r = computeFitScore(inputs);
    expect(r.score).toBe(35); // base 35 + 0 + 0 + 0
    expect(r.breakdown.base).toBe(35);
  });

  it("Lead sans personaTier ni profil → score minimum 30", () => {
    const r = computeFitScore({
      personaTier: null,
      currentTenureMonths: null,
      backgrounds: null,
      companyEtabsCount: null,
      icp: {},
    });
    expect(r.score).toBe(30);
  });

  it("Tier 2 + tenure 8 mois (sweet spot) + SaaS background", () => {
    const r = computeFitScore({
      personaTier: 2,
      currentTenureMonths: 8,
      backgrounds: { hasESNBackground: false, hasSaaSBackground: true, hasStartupBackground: false },
      companyEtabsCount: null,
      icp: { wantsSaaS: true },
    });
    // 50 + 15 + 15 + 0 = 80
    expect(r.score).toBe(80);
  });

  it("Pépite Tier 1 mais en poste depuis 10 ans (très ancré) → tenure -10", () => {
    const inputs: FitInputs = {
      personaTier: 1,
      currentTenureMonths: 120,
      backgrounds: { hasESNBackground: true, hasSaaSBackground: true, hasStartupBackground: false },
      companyEtabsCount: 50,
      icp: { wantsESN: true, wantsSaaS: true, sizeMin: 11, sizeMax: 200 },
    };
    const r = computeFitScore(inputs);
    // 60 + 5 (>60m) + 25 + 15 = 105 → cap 100
    expect(r.score).toBe(100);
    expect(r.breakdown.tenureBoost).toBe(5);
  });

  it("breakdown contient toutes les composantes pour traçabilité dashboard", () => {
    const r = computeFitScore({
      personaTier: 1,
      currentTenureMonths: 24,
      backgrounds: { hasESNBackground: true, hasSaaSBackground: false, hasStartupBackground: false },
      companyEtabsCount: 12,
      icp: { wantsESN: true, sizeMin: 11, sizeMax: 200 },
    });
    expect(r.breakdown).toHaveProperty("base");
    expect(r.breakdown).toHaveProperty("tenureBoost");
    expect(r.breakdown).toHaveProperty("backgroundFit");
    expect(r.breakdown).toHaveProperty("sizeFit");
  });

  it("score est borné 0-100", () => {
    const r = computeFitScore({
      personaTier: null,
      currentTenureMonths: null,
      backgrounds: null,
      companyEtabsCount: null,
      icp: {},
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
