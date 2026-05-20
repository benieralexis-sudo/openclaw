import { describe, it, expect } from "vitest";
import {
  computeIntentStrength,
  shouldDeliverByIntentStrength,
  boostStrengthByMultiSource,
  describeIntentStrength,
  INTENT_STRENGTH_MIN_THRESHOLD,
} from "./intent-strength";

const TODAY = new Date();
function daysAgo(n: number): Date {
  return new Date(TODAY.getTime() - n * 86_400_000);
}

describe("computeIntentStrength", () => {
  describe("Niveau 5 (très fort)", () => {
    it("boamp.tender récent (≤30j) = 5", () => {
      expect(computeIntentStrength("boamp.tender", daysAgo(10))).toBe(5);
      expect(computeIntentStrength("boamp.tender", daysAgo(28))).toBe(5);
    });
    it("boamp.tender ancien (>30j) = 4", () => {
      expect(computeIntentStrength("boamp.tender", daysAgo(45))).toBe(4);
    });
    it("ted-europa.tender récent = 5", () => {
      expect(computeIntentStrength("ted-europa.tender", daysAgo(5))).toBe(5);
    });
    it("rodz.fundraising récent = 5", () => {
      expect(computeIntentStrength("rodz.fundraising", daysAgo(7))).toBe(5);
    });
    it("rss-levees récent = 5", () => {
      expect(computeIntentStrength("rss-levees", daysAgo(15))).toBe(5);
      expect(computeIntentStrength("rss-levees.recent", daysAgo(15))).toBe(5);
    });
  });

  describe("Niveau 4 (fort)", () => {
    it("apify.linkedin-jobs-signature récent = 4", () => {
      expect(computeIntentStrength("apify.linkedin-jobs-signature", daysAgo(30))).toBe(4);
    });
    it("francetravail.signature récent = 4", () => {
      expect(computeIntentStrength("francetravail.signature", daysAgo(40))).toBe(4);
    });
    it("trigger-engine.tech-hiring = 4 récent", () => {
      expect(computeIntentStrength("trigger-engine.tech-hiring", daysAgo(20))).toBe(4);
    });
  });

  describe("Niveau 3 (moyen)", () => {
    it("apify.linkedin-jobs récent = 3", () => {
      expect(computeIntentStrength("apify.linkedin-jobs", daysAgo(30))).toBe(3);
    });
    it("apify.linkedin-jobs ancien (>60j) = 2", () => {
      expect(computeIntentStrength("apify.linkedin-jobs", daysAgo(90))).toBe(2);
    });
    it("bodacc.capital_increase récent = 3", () => {
      expect(computeIntentStrength("bodacc.capital_increase", daysAgo(30))).toBe(3);
    });
    it("theirstack.* récent = 3", () => {
      expect(computeIntentStrength("theirstack.job-listing", daysAgo(20))).toBe(3);
    });
  });

  describe("Niveau 2 (faible)", () => {
    it("rss-medias signature = 2 récent", () => {
      expect(computeIntentStrength("rss-medias.signature", daysAgo(10))).toBe(2);
    });
    it("francetravail générique = 2 récent", () => {
      expect(computeIntentStrength("francetravail.head_of_sales", daysAgo(30))).toBe(2);
    });
    it("bodacc générique (non capital_increase) = 2 récent", () => {
      expect(computeIntentStrength("bodacc.dissolution", daysAgo(30))).toBe(2);
    });
  });

  describe("Niveau 1 (très faible)", () => {
    it("github.commit = 1", () => {
      expect(computeIntentStrength("github.commit", daysAgo(5))).toBe(1);
    });
    it("inpi.marque = 1", () => {
      expect(computeIntentStrength("inpi.marque", daysAgo(5))).toBe(1);
    });
    it("joafe.* = 1", () => {
      expect(computeIntentStrength("joafe.association", daysAgo(5))).toBe(1);
    });
  });

  describe("Age effect", () => {
    it("publishedAt null = age 999j → strength minimale par catégorie", () => {
      // BOAMP avec publishedAt null fallback à 4 (ancien)
      expect(computeIntentStrength("boamp.tender", null)).toBe(4);
      // GitHub reste 1 (déjà au plancher)
      expect(computeIntentStrength("github.commit", null)).toBe(1);
    });
    it("apify.linkedin-jobs >60j drop à 2", () => {
      expect(computeIntentStrength("apify.linkedin-jobs", daysAgo(70))).toBe(2);
    });
  });

  describe("Fallback (signal inconnu)", () => {
    it("sourceCode inconnu = 2 (prudent)", () => {
      expect(computeIntentStrength("unknown.source", daysAgo(10))).toBe(2);
      expect(computeIntentStrength("foo.bar", null)).toBe(2);
    });
  });
});

describe("shouldDeliverByIntentStrength", () => {
  it("strength ≥ 3 livrable", () => {
    expect(shouldDeliverByIntentStrength(3)).toBe(true);
    expect(shouldDeliverByIntentStrength(4)).toBe(true);
    expect(shouldDeliverByIntentStrength(5)).toBe(true);
  });
  it("strength < 3 NON livrable", () => {
    expect(shouldDeliverByIntentStrength(1)).toBe(false);
    expect(shouldDeliverByIntentStrength(2)).toBe(false);
  });
  it("seuil constante = 3", () => {
    expect(INTENT_STRENGTH_MIN_THRESHOLD).toBe(3);
  });
});

describe("boostStrengthByMultiSource", () => {
  it("0 signal additionnel → strength inchangée", () => {
    expect(boostStrengthByMultiSource(3, 0)).toBe(3);
  });
  it("1 signal additionnel → +1", () => {
    expect(boostStrengthByMultiSource(3, 1)).toBe(4);
    expect(boostStrengthByMultiSource(2, 1)).toBe(3);
  });
  it("2+ signaux → +2", () => {
    expect(boostStrengthByMultiSource(2, 2)).toBe(4);
    expect(boostStrengthByMultiSource(3, 5)).toBe(5);
  });
  it("cap à 5", () => {
    expect(boostStrengthByMultiSource(4, 5)).toBe(5);
    expect(boostStrengthByMultiSource(5, 10)).toBe(5);
  });
});

describe("describeIntentStrength", () => {
  it("retourne un label pour chaque niveau", () => {
    expect(describeIntentStrength(5)).toContain("très fort");
    expect(describeIntentStrength(4)).toContain("fort");
    expect(describeIntentStrength(3)).toContain("moyen");
    expect(describeIntentStrength(2)).toContain("faible");
    expect(describeIntentStrength(1)).toContain("très faible");
  });
});
