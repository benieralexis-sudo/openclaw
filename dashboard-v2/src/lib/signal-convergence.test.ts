import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    trigger: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import {
  getCrossPillarConvergence,
  getIntraSignalConfidenceBoost,
} from "./signal-convergence";

const findManyMock = db.trigger.findMany as ReturnType<typeof vi.fn>;

describe("signal-convergence — getCrossPillarConvergence", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it("retourne 0 pilier convergé si aucun trigger", async () => {
    findManyMock.mockResolvedValueOnce([]);
    const r = await getCrossPillarConvergence("c1", {
      activePillars: ["P1", "P5", "B1"],
      siret: "12345678900015",
    });
    expect(r.pillarsConverged).toEqual([]);
    expect(r.isPepite).toBe(false);
    expect(r.isDiamant).toBe(false);
  });

  it("1 pilier détecté → ni Pépite ni Diamant", async () => {
    findManyMock.mockResolvedValueOnce([{ signalCode: "P1" }, { signalCode: "P1" }]);
    const r = await getCrossPillarConvergence("c1", {
      activePillars: ["P1", "P5", "B1"],
      siret: "12345678900015",
    });
    expect(r.pillarsConverged).toEqual(["P1"]);
    expect(r.isPepite).toBe(false);
    expect(r.isDiamant).toBe(false);
  });

  it("2 piliers distincts → Pépite", async () => {
    findManyMock.mockResolvedValueOnce([
      { signalCode: "P1" },
      { signalCode: "B1" },
    ]);
    const r = await getCrossPillarConvergence("c1", {
      activePillars: ["P1", "P5", "B1"],
      siret: "12345678900015",
    });
    expect(r.pillarsConverged.length).toBe(2);
    expect(r.pillarsConverged).toContain("P1");
    expect(r.pillarsConverged).toContain("B1");
    expect(r.isPepite).toBe(true);
    expect(r.isDiamant).toBe(false);
  });

  it("3 piliers distincts → Diamant", async () => {
    findManyMock.mockResolvedValueOnce([
      { signalCode: "P1" },
      { signalCode: "P5" },
      { signalCode: "B1" },
    ]);
    const r = await getCrossPillarConvergence("c1", {
      activePillars: ["P1", "P5", "B1"],
      siret: "12345678900015",
    });
    expect(r.pillarsConverged.length).toBe(3);
    expect(r.isPepite).toBe(true);
    expect(r.isDiamant).toBe(true);
  });

  it("retourne vide si pas de siret ni companyName", async () => {
    const r = await getCrossPillarConvergence("c1", {
      activePillars: ["P1", "P5", "B1"],
    });
    expect(r.pillarsConverged).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("utilise companyName si siret null", async () => {
    findManyMock.mockResolvedValueOnce([{ signalCode: "P1" }, { signalCode: "B1" }]);
    const r = await getCrossPillarConvergence("c1", {
      activePillars: ["P1", "P5", "B1"],
      siret: null,
      companyName: "Skello",
    });
    expect(r.isPepite).toBe(true);
    const callArgs = findManyMock.mock.calls[0]?.[0] as { where?: Record<string, unknown> };
    expect(callArgs.where).toMatchObject({
      companyName: { equals: "Skello", mode: "insensitive" },
    });
  });
});

describe("signal-convergence — getIntraSignalConfidenceBoost", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it("retourne 0 si 1 seule source détectée", async () => {
    findManyMock.mockResolvedValueOnce([
      { sourceCode: "rodz.fundraising" },
    ]);
    const b = await getIntraSignalConfidenceBoost("c1", {
      signalCode: "B1",
      siret: "12345678900015",
    });
    expect(b).toBe(0);
  });

  it("retourne 25 si 2 sources distinctes du même signal", async () => {
    findManyMock.mockResolvedValueOnce([
      { sourceCode: "rodz.fundraising" },
      { sourceCode: "rss-levees" },
    ]);
    const b = await getIntraSignalConfidenceBoost("c1", {
      signalCode: "B1",
      siret: "12345678900015",
    });
    expect(b).toBe(25);
  });

  it("retourne 50 si 3+ sources distinctes (cap)", async () => {
    findManyMock.mockResolvedValueOnce([
      { sourceCode: "rodz.fundraising" },
      { sourceCode: "rss-levees" },
      { sourceCode: "bodacc.capital_increase" },
    ]);
    const b = await getIntraSignalConfidenceBoost("c1", {
      signalCode: "B1",
      siret: "12345678900015",
    });
    expect(b).toBe(50);
  });

  it("retourne 0 si signal inconnu (pas de sources mappées)", async () => {
    const b = await getIntraSignalConfidenceBoost("c1", {
      signalCode: "ZZ_INEXISTANT",
      siret: "12345678900015",
    });
    expect(b).toBe(0);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
