import { describe, expect, it } from "vitest";
import {
  detectHeadcountGrowth,
  parseTrancheEffectif,
  type HeadcountSnapshot,
} from "./headcount-growth-detector";

const NOW = new Date("2026-05-16T00:00:00Z");

function makeSnap(daysAgo: number, effectifMin: number, effectifMax: number | null = null): HeadcountSnapshot {
  return {
    effectifMin,
    effectifMax,
    snapshotAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    source: "pappers",
  };
}

describe("parseTrancheEffectif", () => {
  it("retourne null pour tranche null/undefined", () => {
    expect(parseTrancheEffectif(null)).toBeNull();
    expect(parseTrancheEffectif(undefined)).toBeNull();
    expect(parseTrancheEffectif("")).toBeNull();
  });

  it("retourne null pour tranche inconnue", () => {
    expect(parseTrancheEffectif("99")).toBeNull();
    expect(parseTrancheEffectif("abc")).toBeNull();
  });

  it("parse les tranches INSEE valides", () => {
    expect(parseTrancheEffectif("11")).toEqual({ min: 10, max: 19 });
    expect(parseTrancheEffectif("21")).toEqual({ min: 50, max: 99 });
    expect(parseTrancheEffectif("22")).toEqual({ min: 100, max: 199 });
  });

  it("tranche 53 (10000+) a max=null", () => {
    expect(parseTrancheEffectif("53")).toEqual({ min: 10000, max: null });
  });

  it("trim les espaces", () => {
    expect(parseTrancheEffectif(" 21 ")).toEqual({ min: 50, max: 99 });
  });
});

describe("detectHeadcountGrowth", () => {
  describe("input invalide", () => {
    it("retourne hasGrowth=false pour null/undefined", () => {
      expect(detectHeadcountGrowth(null, { now: NOW }).hasGrowth).toBe(false);
      expect(detectHeadcountGrowth(undefined, { now: NOW }).hasGrowth).toBe(false);
    });

    it("less-than-2-snapshots pour 0 ou 1 snapshot", () => {
      const out1 = detectHeadcountGrowth([], { now: NOW });
      expect(out1.hasGrowth).toBe(false);
      expect(out1.reason).toBe("less-than-2-snapshots");

      const out2 = detectHeadcountGrowth([makeSnap(30, 50)], { now: NOW });
      expect(out2.hasGrowth).toBe(false);
      expect(out2.reason).toBe("less-than-2-snapshots");
    });
  });

  describe("fenêtre 90j par défaut", () => {
    it("less-than-2-in-window si snapshots tous hors fenêtre", () => {
      const out = detectHeadcountGrowth(
        [makeSnap(120, 50), makeSnap(150, 100)],
        { now: NOW },
      );
      expect(out.hasGrowth).toBe(false);
      expect(out.reason).toBe("less-than-2-in-window");
    });

    it("less-than-2-in-window si 1 seul snapshot dans la fenêtre", () => {
      const out = detectHeadcountGrowth(
        [makeSnap(30, 50), makeSnap(120, 100)], // seul le 30j est in window
        { now: NOW },
      );
      expect(out.reason).toBe("less-than-2-in-window");
    });
  });

  describe("calcul croissance", () => {
    it("hasGrowth=true si +10% (threshold default)", () => {
      const out = detectHeadcountGrowth(
        [makeSnap(80, 50), makeSnap(5, 55)], // +10%
        { now: NOW },
      );
      expect(out.hasGrowth).toBe(true);
      expect(out.growthPct).toBe(10);
      expect(out.fromEffectifMin).toBe(50);
      expect(out.toEffectifMin).toBe(55);
      expect(out.daysBetween).toBe(75);
    });

    it("hasGrowth=true si croissance massive", () => {
      const out = detectHeadcountGrowth(
        [makeSnap(60, 50), makeSnap(5, 200)], // +300%
        { now: NOW },
      );
      expect(out.hasGrowth).toBe(true);
      expect(out.growthPct).toBe(300);
    });

    it("hasGrowth=false si croissance < threshold", () => {
      const out = detectHeadcountGrowth(
        [makeSnap(60, 50), makeSnap(5, 54)], // +8%
        { now: NOW, thresholdPct: 10 },
      );
      expect(out.hasGrowth).toBe(false);
      expect(out.reason).toBe("below-threshold");
      expect(out.growthPct).toBe(8);
    });

    it("respecte un thresholdPct custom plus élevé", () => {
      const out = detectHeadcountGrowth(
        [makeSnap(60, 50), makeSnap(5, 100)], // +100%
        { now: NOW, thresholdPct: 150 },
      );
      expect(out.hasGrowth).toBe(false);
      expect(out.growthPct).toBe(100);
    });

    it("respecte un thresholdPct custom plus bas", () => {
      const out = detectHeadcountGrowth(
        [makeSnap(60, 50), makeSnap(5, 52)], // +4%
        { now: NOW, thresholdPct: 3 },
      );
      expect(out.hasGrowth).toBe(true);
      expect(out.growthPct).toBe(4);
    });

    it("hasGrowth=false si stagnation", () => {
      const out = detectHeadcountGrowth(
        [makeSnap(60, 50), makeSnap(5, 50)],
        { now: NOW },
      );
      expect(out.hasGrowth).toBe(false);
      expect(out.reason).toBe("no-increase");
    });

    it("hasGrowth=false si décroissance", () => {
      const out = detectHeadcountGrowth(
        [makeSnap(60, 100), makeSnap(5, 80)],
        { now: NOW },
      );
      expect(out.hasGrowth).toBe(false);
      expect(out.reason).toBe("no-increase");
    });

    it("baseline-zero : pas de growth si on partait de 0", () => {
      const out = detectHeadcountGrowth(
        [makeSnap(60, 0), makeSnap(5, 100)],
        { now: NOW },
      );
      expect(out.hasGrowth).toBe(false);
      expect(out.reason).toBe("baseline-zero");
    });
  });

  describe("ordre des snapshots", () => {
    it("traite correctement même si snapshots dans le désordre", () => {
      const out = detectHeadcountGrowth(
        [
          makeSnap(5, 100), // récent
          makeSnap(60, 50), // ancien
          makeSnap(30, 75), // intermédiaire
        ],
        { now: NOW },
      );
      // baseline = le plus ancien dans la fenêtre = 60j (50)
      // latest = le plus récent = 5j (100)
      // growth = +100%
      expect(out.hasGrowth).toBe(true);
      expect(out.fromEffectifMin).toBe(50);
      expect(out.toEffectifMin).toBe(100);
      expect(out.growthPct).toBe(100);
    });
  });

  describe("scénario réel — passage de tranche INSEE", () => {
    it("détecte passage tranche 21 (50-99) → 22 (100-199) comme growth +100%", () => {
      const old = parseTrancheEffectif("21")!;
      const recent = parseTrancheEffectif("22")!;
      const out = detectHeadcountGrowth(
        [
          { effectifMin: old.min, effectifMax: old.max, snapshotAt: new Date(NOW.getTime() - 75 * 86_400_000), source: "pappers" },
          { effectifMin: recent.min, effectifMax: recent.max, snapshotAt: new Date(NOW.getTime() - 5 * 86_400_000), source: "pappers" },
        ],
        { now: NOW },
      );
      expect(out.hasGrowth).toBe(true);
      expect(out.fromEffectifMin).toBe(50);
      expect(out.toEffectifMin).toBe(100);
      expect(out.growthPct).toBe(100);
    });
  });
});
