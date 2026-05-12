import { describe, it, expect } from "vitest";
import { getRotatedKeywords } from "./keyword-rotation";

const DTL_24 = [
  "QA Engineer",
  "Software Tester",
  "Test Engineer",
  "Quality Assurance Engineer",
  "Testeur logiciel",
  "Testeur QA",
  "Ingénieur Test",
  "Ingénieur QA",
  "Automaticien de test",
  "QA Manager",
  "QA Lead",
  "Lead QA",
  "Test Manager",
  "Test Lead",
  "SDET",
  "Software Development Engineer in Test",
  "Test Automation Engineer",
  "Automation Engineer QA",
  "QA Analyst",
  "Quality Analyst",
  "Performance Engineer",
  "Load Test Engineer",
  "Validation Engineer",
  "Tester",
];

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

describe("getRotatedKeywords", () => {
  it("retourne [] sur liste vide", () => {
    expect(getRotatedKeywords([])).toEqual([]);
  });

  it("retourne tout si keywords.length <= batchSize", () => {
    expect(getRotatedKeywords(["a", "b", "c"], { batchSize: 8 })).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(getRotatedKeywords(["a", "b", "c", "d", "e", "f", "g", "h"])).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
    ]);
  });

  it("24 keywords / 8 par bucket → 3 buckets distincts cycliques", () => {
    // halfDay=0 → bucket 0 (indices 0..7)
    const b0 = getRotatedKeywords(DTL_24, { batchSize: 8, nowMs: 0 });
    expect(b0).toEqual(DTL_24.slice(0, 8));

    // halfDay=1 → bucket 1 (indices 8..15)
    const b1 = getRotatedKeywords(DTL_24, {
      batchSize: 8,
      nowMs: HALF_DAY_MS,
    });
    expect(b1).toEqual(DTL_24.slice(8, 16));

    // halfDay=2 → bucket 2 (indices 16..23)
    const b2 = getRotatedKeywords(DTL_24, {
      batchSize: 8,
      nowMs: 2 * HALF_DAY_MS,
    });
    expect(b2).toEqual(DTL_24.slice(16, 24));

    // halfDay=3 → cycle retourne bucket 0
    const b3 = getRotatedKeywords(DTL_24, {
      batchSize: 8,
      nowMs: 3 * HALF_DAY_MS,
    });
    expect(b3).toEqual(DTL_24.slice(0, 8));
  });

  it("couverture totale des 24 keywords sur 3 buckets consécutifs", () => {
    const allCovered = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const batch = getRotatedKeywords(DTL_24, {
        batchSize: 8,
        nowMs: i * HALF_DAY_MS,
      });
      batch.forEach((k) => allCovered.add(k));
    }
    expect(allCovered.size).toBe(24);
    DTL_24.forEach((k) => expect(allCovered.has(k)).toBe(true));
  });

  it("batchSize non-divisible (24/10 = 3 buckets dont le dernier court)", () => {
    const b2 = getRotatedKeywords(DTL_24, {
      batchSize: 10,
      nowMs: 2 * HALF_DAY_MS,
    });
    expect(b2).toEqual(DTL_24.slice(20)); // 4 derniers seulement
    expect(b2.length).toBe(4);
  });

  it("nowMs négatif (clock skew) → bucket valide non-négatif", () => {
    // Modulo négatif TypeScript → on a garanti la normalisation positive
    const batch = getRotatedKeywords(DTL_24, {
      batchSize: 8,
      nowMs: -HALF_DAY_MS,
    });
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.length).toBeLessThanOrEqual(8);
  });

  it("liste 9 elements + batchSize 8 → 2 buckets (8 puis 1)", () => {
    const kw9 = DTL_24.slice(0, 9);
    const b0 = getRotatedKeywords(kw9, { batchSize: 8, nowMs: 0 });
    expect(b0).toEqual(kw9.slice(0, 8));
    const b1 = getRotatedKeywords(kw9, { batchSize: 8, nowMs: HALF_DAY_MS });
    expect(b1).toEqual([kw9[8]]);
  });
});
