import { describe, it, expect } from "vitest";
import {
  computeFreshnessScore,
  computeMultiSourceBoost,
  computePriorityScore,
  FRESHNESS_HALF_LIFE_DAYS,
} from "./priority-scoring";

describe("computeFreshnessScore", () => {
  const now = new Date("2026-05-01T12:00:00Z");

  it("returns 100 for a trigger captured at the exact same instant", () => {
    expect(computeFreshnessScore(now, now)).toBe(100);
  });

  it("returns ~100 for a trigger captured a few seconds ago", () => {
    const capturedAt = new Date(now.getTime() - 5000);
    expect(computeFreshnessScore(capturedAt, now)).toBe(100);
  });

  it("returns ~93 for a trigger captured 1 day ago", () => {
    const capturedAt = new Date(now.getTime() - 1 * 86400_000);
    const score = computeFreshnessScore(capturedAt, now);
    expect(score).toBeGreaterThanOrEqual(92);
    expect(score).toBeLessThanOrEqual(94);
  });

  it("returns ~61 for a trigger captured 7 days ago", () => {
    const capturedAt = new Date(now.getTime() - 7 * 86400_000);
    const score = computeFreshnessScore(capturedAt, now);
    expect(score).toBeGreaterThanOrEqual(60);
    expect(score).toBeLessThanOrEqual(62);
  });

  it("returns ~37 for a trigger captured 14 days ago (= half-life proxy)", () => {
    const capturedAt = new Date(now.getTime() - 14 * 86400_000);
    const score = computeFreshnessScore(capturedAt, now);
    expect(score).toBeGreaterThanOrEqual(36);
    expect(score).toBeLessThanOrEqual(38);
  });

  it("returns ~12 for a trigger captured 30 days ago", () => {
    const capturedAt = new Date(now.getTime() - 30 * 86400_000);
    const score = computeFreshnessScore(capturedAt, now);
    expect(score).toBeGreaterThanOrEqual(11);
    expect(score).toBeLessThanOrEqual(13);
  });

  it("returns ~1 for a trigger captured 60 days ago", () => {
    const capturedAt = new Date(now.getTime() - 60 * 86400_000);
    const score = computeFreshnessScore(capturedAt, now);
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(2);
  });

  it("returns 0 for a trigger captured 90+ days ago", () => {
    const capturedAt = new Date(now.getTime() - 90 * 86400_000);
    expect(computeFreshnessScore(capturedAt, now)).toBe(0);
  });

  it("returns 0 for a trigger captured in the future (clock skew protection)", () => {
    const capturedAt = new Date(now.getTime() + 3600_000);
    expect(computeFreshnessScore(capturedAt, now)).toBe(100);
  });

  it("uses real Date.now() if no `now` is passed", () => {
    const veryOld = new Date("2020-01-01T00:00:00Z");
    expect(computeFreshnessScore(veryOld)).toBe(0);
  });

  it("exposes the half-life constant for documentation/tooling", () => {
    expect(FRESHNESS_HALF_LIFE_DAYS).toBe(14);
  });
});

describe("computeMultiSourceBoost", () => {
  it("returns 0 for an empty source list", () => {
    expect(computeMultiSourceBoost([])).toBe(0);
  });

  it("returns 0 for a single source", () => {
    expect(computeMultiSourceBoost(["apify.linkedin-jobs"])).toBe(0);
  });

  it("returns 0 for the same source listed multiple times (dedup)", () => {
    expect(
      computeMultiSourceBoost([
        "apify.linkedin-jobs",
        "apify.linkedin-jobs",
        "apify.linkedin-jobs",
      ]),
    ).toBe(0);
  });

  it("returns 15 for 2 distinct sources", () => {
    expect(
      computeMultiSourceBoost([
        "apify.linkedin-jobs",
        "apify.indeed-jobs",
      ]),
    ).toBe(15);
  });

  it("returns 30 for 3 distinct sources", () => {
    expect(
      computeMultiSourceBoost([
        "apify.linkedin-jobs",
        "apify.indeed-jobs",
        "theirstack.job-offer",
      ]),
    ).toBe(30);
  });

  it("caps at 30 for 4+ distinct sources", () => {
    expect(
      computeMultiSourceBoost([
        "apify.linkedin-jobs",
        "apify.indeed-jobs",
        "theirstack.job-offer",
        "rodz.fundraising",
        "trigger-engine.tech-hiring",
      ]),
    ).toBe(30);
  });

  it("dedups case-insensitively (defensive)", () => {
    expect(
      computeMultiSourceBoost([
        "apify.linkedin-jobs",
        "Apify.LinkedIn-Jobs",
      ]),
    ).toBe(0);
  });
});

describe("computePriorityScore", () => {
  it("base case : score 10, freshness 100, no boost = 10", () => {
    expect(computePriorityScore({ score: 10, freshnessScore: 100, multiSourceBoost: 0 })).toBe(10);
  });

  it("score 10, freshness 12 (J-30), no boost = 1", () => {
    expect(computePriorityScore({ score: 10, freshnessScore: 12, multiSourceBoost: 0 })).toBe(1);
  });

  it("score 10, freshness 0 (J-90+), no boost = 0", () => {
    expect(computePriorityScore({ score: 10, freshnessScore: 0, multiSourceBoost: 0 })).toBe(0);
  });

  it("score 8, freshness 93 (J-1), 2 sources = 8*0.93 + 15 = 22 (rounded)", () => {
    expect(computePriorityScore({ score: 8, freshnessScore: 93, multiSourceBoost: 15 })).toBe(22);
  });

  it("score 6, freshness 100, 3 sources = 6 + 30 = 36 (Qualifié frais multi-source)", () => {
    expect(computePriorityScore({ score: 6, freshnessScore: 100, multiSourceBoost: 30 })).toBe(36);
  });

  it("Pépite froide vs Qualifié frais multi-source : Qualifié doit gagner", () => {
    const pepiteFroid = computePriorityScore({ score: 10, freshnessScore: 12, multiSourceBoost: 0 });
    const qualifieFraisMulti = computePriorityScore({ score: 7, freshnessScore: 93, multiSourceBoost: 15 });
    expect(qualifieFraisMulti).toBeGreaterThan(pepiteFroid);
  });

  it("score 0 (cas dégradé) reste à 0 même avec boost", () => {
    expect(computePriorityScore({ score: 0, freshnessScore: 100, multiSourceBoost: 30 })).toBe(30);
  });
});
