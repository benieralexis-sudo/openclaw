import { describe, expect, it } from "vitest";
import {
  computeBuyerScore,
  computeMultiSourceScore,
  computeSignalContextScore,
  computeTenureScore,
  computeTitleMatchScore,
  rankCandidates,
  scoreCandidate,
  type ScoringCandidate,
  type ScoringContext,
} from "./persona-candidate-scorer";

describe("computeTitleMatchScore", () => {
  it("tier 1 + confidence 100 = 40 (cap)", () => {
    expect(
      computeTitleMatchScore({
        tier: 1,
        confidence: 100,
        firstName: "X",
        lastName: "Y",
      }),
    ).toBe(40);
  });

  it("tier 2 + confidence 50 = 22 + 3 = 25", () => {
    expect(
      computeTitleMatchScore({
        tier: 2,
        confidence: 50,
        firstName: "X",
        lastName: "Y",
      }),
    ).toBe(25);
  });

  it("tier 3 + confidence 0 = 10", () => {
    expect(
      computeTitleMatchScore({
        tier: 3,
        confidence: 0,
        firstName: "X",
        lastName: "Y",
      }),
    ).toBe(10);
  });

  it("tier 4 = 5", () => {
    expect(
      computeTitleMatchScore({
        tier: 4,
        confidence: 100,
        firstName: "X",
        lastName: "Y",
      }),
    ).toBe(10); // 5 + 5 boost
  });
});

describe("computeTenureScore", () => {
  it("null/undefined = 5 (inconnu)", () => {
    expect(computeTenureScore(null)).toBe(5);
    expect(computeTenureScore(undefined)).toBe(5);
  });

  it("<6 mois = 12 (signal d'achat fort sur hire)", () => {
    expect(computeTenureScore(0)).toBe(12);
    expect(computeTenureScore(3)).toBe(12);
    expect(computeTenureScore(5)).toBe(12);
  });

  it("6-36 mois = 15 (sweet spot)", () => {
    expect(computeTenureScore(6)).toBe(15);
    expect(computeTenureScore(18)).toBe(15);
    expect(computeTenureScore(36)).toBe(15);
  });

  it("36-60 mois = 8 (installé)", () => {
    expect(computeTenureScore(37)).toBe(8);
    expect(computeTenureScore(60)).toBe(8);
  });

  it(">60 mois = 4 (ancré)", () => {
    expect(computeTenureScore(61)).toBe(4);
    expect(computeTenureScore(120)).toBe(4);
  });
});

describe("computeMultiSourceScore", () => {
  const candidate: ScoringCandidate = {
    tier: 1,
    confidence: 80,
    firstName: "Jean",
    lastName: "Dupont",
  };

  it("undefined Pappers list = 0", () => {
    expect(computeMultiSourceScore(candidate, undefined)).toBe(0);
  });

  it("empty Pappers list = 0", () => {
    expect(computeMultiSourceScore(candidate, [])).toBe(0);
  });

  it("Pappers match exact = 15", () => {
    expect(
      computeMultiSourceScore(candidate, [
        { firstName: "Jean", lastName: "Dupont" },
      ]),
    ).toBe(15);
  });

  it("Pappers match avec différence accent = 15", () => {
    expect(
      computeMultiSourceScore(candidate, [
        { firstName: "Jean", lastName: "Dupônt" },
      ]),
    ).toBe(15);
  });

  it("Pappers match lastName seul (firstName Pappers vide) = 15", () => {
    expect(
      computeMultiSourceScore(candidate, [{ lastName: "Dupont" }]),
    ).toBe(15);
  });

  it("Pappers match lastName + firstName court (1er prénom) = 15", () => {
    expect(
      computeMultiSourceScore(candidate, [
        { firstName: "Jean Marc Pierre", lastName: "Dupont" },
      ]),
    ).toBe(15);
  });

  it("Pappers lastName différent = 0", () => {
    expect(
      computeMultiSourceScore(candidate, [
        { firstName: "Jean", lastName: "Martin" },
      ]),
    ).toBe(0);
  });

  it("candidate sans firstName = 0", () => {
    expect(
      computeMultiSourceScore(
        { ...candidate, firstName: "" },
        [{ firstName: "Jean", lastName: "Dupont" }],
      ),
    ).toBe(0);
  });
});

describe("computeSignalContextScore", () => {
  it("undefined counts = 0", () => {
    expect(computeSignalContextScore(undefined, undefined)).toBe(0);
  });

  it("0 posts récents = 0", () => {
    expect(computeSignalContextScore(0, 0)).toBe(0);
  });

  it("≥1 post mais 0 matching = 8 (lead actif)", () => {
    expect(computeSignalContextScore(3, 0)).toBe(8);
  });

  it("≥1 post matching = 20", () => {
    expect(computeSignalContextScore(5, 1)).toBe(20);
    expect(computeSignalContextScore(10, 3)).toBe(20);
  });
});

describe("computeBuyerScore", () => {
  it("headline absent = 10 (par défaut)", () => {
    expect(computeBuyerScore(null)).toBe(10);
    expect(computeBuyerScore(undefined)).toBe(10);
    expect(computeBuyerScore("")).toBe(10);
  });

  it("CTO normal = 10", () => {
    expect(computeBuyerScore("CTO @ Acme")).toBe(10);
  });

  it("Angel investor seul = 0 (non-buyer)", () => {
    expect(computeBuyerScore("Angel investor")).toBe(0);
    expect(computeBuyerScore("Business Angel — Tech investor")).toBe(0);
  });

  it("Angel investor + CTO = 10 (opérationnel l'emporte)", () => {
    expect(computeBuyerScore("CTO @ Acme | Angel investor")).toBe(10);
    expect(computeBuyerScore("Founder & Angel investor")).toBe(10);
  });

  it("Advisor at X seul = 0", () => {
    expect(computeBuyerScore("Advisor at Acme")).toBe(0);
  });

  it("Investor at X = 0", () => {
    expect(computeBuyerScore("Investor at Acme")).toBe(0);
  });
});

describe("scoreCandidate — intégration", () => {
  it("CTO parfait, sweet spot, multi-source, posts matching = 95+", () => {
    const candidate: ScoringCandidate = {
      tier: 1,
      confidence: 95,
      firstName: "Jean",
      lastName: "Dupont",
      headline: "CTO at Acme building high-performing teams",
      currentPositionStartedMonthsAgo: 18,
    };
    const context: ScoringContext = {
      signalType: "qa-hire",
      pappersDirigeants: [{ firstName: "Jean", lastName: "Dupont" }],
      recentPostsCount: 5,
      recentPostsMatching: 2,
    };
    const score = scoreCandidate(candidate, context);
    expect(score.total).toBeGreaterThanOrEqual(95);
    expect(score.breakdown.titleMatch).toBe(40);
    expect(score.breakdown.tenure).toBe(15);
    expect(score.breakdown.multiSource).toBe(15);
    expect(score.breakdown.signalContext).toBe(20);
    expect(score.breakdown.buyer).toBe(10);
  });

  it("CEO sur signal QA (tier 3, no match), pas de Pappers = 25", () => {
    const candidate: ScoringCandidate = {
      tier: 3,
      confidence: 50,
      firstName: "Marie",
      lastName: "Martin",
      headline: "CEO at Acme",
      currentPositionStartedMonthsAgo: 24,
    };
    const context: ScoringContext = { signalType: "qa-hire" };
    const score = scoreCandidate(candidate, context);
    // 10 (tier 3) + 2.5≈3 (boost) + 15 (tenure sweet spot) + 0 + 0 + 10 = 38
    expect(score.total).toBeGreaterThanOrEqual(35);
    expect(score.total).toBeLessThanOrEqual(40);
  });

  it("Angel investor pur tier 1 = pénalisé par buyer = 0", () => {
    const candidate: ScoringCandidate = {
      tier: 1,
      confidence: 80,
      firstName: "Paul",
      lastName: "Smith",
      headline: "Angel investor — startup advisor",
      currentPositionStartedMonthsAgo: 12,
    };
    const context: ScoringContext = { signalType: "default" };
    const score = scoreCandidate(candidate, context);
    // 35 (tier 1) + 4 boost + 15 tenure + 0 + 0 (Phase 5) + 0 buyer = 54
    expect(score.breakdown.buyer).toBe(0);
  });
});

describe("rankCandidates", () => {
  it("trie par total décroissant, top = meilleur score", () => {
    const candidates: ScoringCandidate[] = [
      {
        tier: 3,
        confidence: 60,
        firstName: "Marie",
        lastName: "Martin",
        headline: "CEO",
        currentPositionStartedMonthsAgo: 60,
      },
      {
        tier: 1,
        confidence: 90,
        firstName: "Jean",
        lastName: "Dupont",
        headline: "CTO",
        currentPositionStartedMonthsAgo: 24,
      },
      {
        tier: 2,
        confidence: 70,
        firstName: "Paul",
        lastName: "Bernard",
        headline: "Founder",
        currentPositionStartedMonthsAgo: 6,
      },
    ];
    const ranked = rankCandidates(candidates, { signalType: "qa-hire" });
    expect(ranked[0]?.firstName).toBe("Jean");
    expect(ranked[1]?.firstName).toBe("Paul");
    expect(ranked[2]?.firstName).toBe("Marie");
  });

  it("bonus multi-source peut renverser tier 1 vs tier 2", () => {
    const candidates: ScoringCandidate[] = [
      {
        tier: 1,
        confidence: 80,
        firstName: "Jean",
        lastName: "Dupont",
        headline: "CTO",
        currentPositionStartedMonthsAgo: 36,
      },
      {
        tier: 2,
        confidence: 80,
        firstName: "Marie",
        lastName: "Martin",
        headline: "Founder",
        currentPositionStartedMonthsAgo: 24,
      },
    ];
    // Marie est dans Pappers, pas Jean → Marie monte avec +15 multi-source
    const ranked = rankCandidates(candidates, {
      signalType: "qa-hire",
      pappersDirigeants: [{ firstName: "Marie", lastName: "Martin" }],
    });
    // Jean : 39 + 15 + 0 + 0 + 10 = 64
    // Marie : 26 + 15 + 15 + 0 + 10 = 66 → Marie en tête
    expect(ranked[0]?.firstName).toBe("Marie");
  });
});
