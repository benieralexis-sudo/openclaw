import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    trigger: {
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/signal-config", () => ({
  getActivePillars: vi.fn(),
}));

import { db } from "@/lib/db";
import { getActivePillars } from "@/lib/signal-config";
import { getPillarHealth, PILLAR_HEALTH_THRESHOLDS } from "./cold-signal-monitor";

const findFirstMock = db.trigger.findFirst as ReturnType<typeof vi.fn>;
const countMock = db.trigger.count as ReturnType<typeof vi.fn>;
const clientFindUniqueMock = db.client.findUnique as ReturnType<typeof vi.fn>;
const getActivePillarsMock = getActivePillars as unknown as ReturnType<typeof vi.fn>;

function setupClientAge(ageDays: number) {
  clientFindUniqueMock.mockResolvedValueOnce({
    activatedAt: new Date(Date.now() - ageDays * 86_400_000),
    createdAt: new Date(Date.now() - ageDays * 86_400_000),
  });
}

describe("cold-signal-monitor — getPillarHealth", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    countMock.mockReset();
    clientFindUniqueMock.mockReset();
    getActivePillarsMock.mockReset();
  });

  it("statut OK si dernier lead < 3j", async () => {
    getActivePillarsMock.mockResolvedValueOnce(["P1"]);
    setupClientAge(60);
    findFirstMock.mockResolvedValueOnce({
      capturedAt: new Date(Date.now() - 1 * 86_400_000), // 1 jour
    });
    countMock.mockResolvedValueOnce(12);

    const r = await getPillarHealth("c1");
    expect(r.pillars[0]).toMatchObject({
      code: "P1",
      status: "ok",
      daysSinceLastTrigger: 1,
      leadCountWindow: 12,
    });
    expect(r.hasIssue).toBe(false);
  });

  it("statut TEPID si 3-6j sans lead", async () => {
    getActivePillarsMock.mockResolvedValueOnce(["P1"]);
    setupClientAge(60);
    findFirstMock.mockResolvedValueOnce({
      capturedAt: new Date(Date.now() - 5 * 86_400_000),
    });
    countMock.mockResolvedValueOnce(3);

    const r = await getPillarHealth("c1");
    expect(r.pillars[0]?.status).toBe("tepid");
    expect(r.hasIssue).toBe(true);
  });

  it("statut COLD si 7j+ sans lead", async () => {
    getActivePillarsMock.mockResolvedValueOnce(["B1"]);
    setupClientAge(60);
    findFirstMock.mockResolvedValueOnce({
      capturedAt: new Date(Date.now() - 10 * 86_400_000),
    });
    countMock.mockResolvedValueOnce(0);

    const r = await getPillarHealth("c1");
    expect(r.pillars[0]?.status).toBe("cold");
    expect(r.hasIssue).toBe(true);
  });

  it("statut WARMING-UP pour P5 si client jeune (< 30j)", async () => {
    getActivePillarsMock.mockResolvedValueOnce(["P5"]);
    setupClientAge(5); // client actif depuis 5j
    findFirstMock.mockResolvedValueOnce(null); // jamais aucun trigger P5
    countMock.mockResolvedValueOnce(0);

    const r = await getPillarHealth("c1");
    expect(r.pillars[0]?.status).toBe("warming-up");
    expect(r.pillars[0]?.warmingUpReason).toContain("Signal lent");
    // Warming-up ne déclenche pas hasIssue (pas une alerte)
    expect(r.hasIssue).toBe(false);
  });

  it("statut COLD pour P5 si client ancien (> 30j)", async () => {
    getActivePillarsMock.mockResolvedValueOnce(["P5"]);
    setupClientAge(60); // client mature
    findFirstMock.mockResolvedValueOnce(null);
    countMock.mockResolvedValueOnce(0);

    const r = await getPillarHealth("c1");
    expect(r.pillars[0]?.status).toBe("cold");
    expect(r.hasIssue).toBe(true);
  });

  it("warming-up ne s'applique qu'à P5 (pas aux autres signaux)", async () => {
    getActivePillarsMock.mockResolvedValueOnce(["P1"]);
    setupClientAge(5);
    findFirstMock.mockResolvedValueOnce(null);
    countMock.mockResolvedValueOnce(0);

    const r = await getPillarHealth("c1");
    // P1 n'est pas dans NATURALLY_SLOW_SIGNALS → reste COLD même client jeune
    expect(r.pillars[0]?.status).toBe("cold");
  });

  it("seuils respectent les constantes (3j tepid, 7j cold)", () => {
    expect(PILLAR_HEALTH_THRESHOLDS.tepidDays).toBe(3);
    expect(PILLAR_HEALTH_THRESHOLDS.coldDays).toBe(7);
  });

  it("retourne plusieurs piliers correctement", async () => {
    getActivePillarsMock.mockResolvedValueOnce(["P1", "P5", "B1"]);
    setupClientAge(60);
    // P1 ok, P5 cold (mature), B1 ok
    findFirstMock
      .mockResolvedValueOnce({ capturedAt: new Date(Date.now() - 1 * 86_400_000) })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ capturedAt: new Date(Date.now() - 2 * 86_400_000) });
    countMock.mockResolvedValue(5);

    const r = await getPillarHealth("c1");
    expect(r.pillars).toHaveLength(3);
    expect(r.pillars.map((p) => p.code)).toEqual(["P1", "P5", "B1"]);
    expect(r.pillars[0]?.status).toBe("ok");
    expect(r.pillars[1]?.status).toBe("cold");
    expect(r.pillars[2]?.status).toBe("ok");
  });
});
