import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    trigger: { count: vi.fn() },
    lead: { count: vi.fn() },
    client: { findMany: vi.fn() },
    serviceCostDaily: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import {
  aggregateDailyCostsForClient,
  aggregateDailyCostsForAllClients,
  getMonthlyCostsForClient,
} from "./service-cost-tracker";

const triggerCount = db.trigger.count as ReturnType<typeof vi.fn>;
const leadCount = db.lead.count as ReturnType<typeof vi.fn>;
const clientFindMany = db.client.findMany as ReturnType<typeof vi.fn>;
const cdFindUnique = db.serviceCostDaily.findUnique as ReturnType<typeof vi.fn>;
const cdCreate = db.serviceCostDaily.create as ReturnType<typeof vi.fn>;
const cdUpdate = db.serviceCostDaily.update as ReturnType<typeof vi.fn>;
const cdFindMany = db.serviceCostDaily.findMany as ReturnType<typeof vi.fn>;

describe("service-cost-tracker — aggregateDailyCostsForClient", () => {
  beforeEach(() => {
    triggerCount.mockReset();
    leadCount.mockReset();
    cdFindUnique.mockReset();
    cdCreate.mockReset();
    cdUpdate.mockReset();
  });

  it("calcule les coûts pour un jour donné (insert tous services)", async () => {
    // Mock counts : 10 Opus, 20 Apify, 5 FE emails, 0 FE phones, 30 Kaspr, 10 Harvest, 15 Rodz, 25 gouv
    triggerCount.mockResolvedValueOnce(10); // anthropic
    triggerCount.mockResolvedValueOnce(20); // apify
    leadCount.mockResolvedValueOnce(5); // fullenrich emails
    leadCount.mockResolvedValueOnce(0); // fullenrich phones
    leadCount.mockResolvedValueOnce(30); // kaspr
    leadCount.mockResolvedValueOnce(10); // harvest profile
    leadCount.mockResolvedValueOnce(15); // rodz
    triggerCount.mockResolvedValueOnce(25); // gouv
    cdFindUnique.mockResolvedValue(null); // toujours insert
    cdCreate.mockResolvedValue({});

    const r = await aggregateDailyCostsForClient("c1");

    // Total attendu : Opus 10*0.05 + Apify 20*0.30 + FE email 5*0.10 + FE phone 0 + others gratuits = 0.5 + 6.0 + 0.5 = 7.0
    expect(r.totalUsd).toBeCloseTo(7.0, 1);
    expect(r.inserted).toBe(8); // 8 services
    expect(r.updated).toBe(0);
  });

  it("upsert : update si une ligne existe déjà pour (clientId, date, service)", async () => {
    triggerCount.mockResolvedValue(0);
    leadCount.mockResolvedValue(0);
    cdFindUnique.mockResolvedValue({ id: "existing-id" }); // existe déjà
    cdUpdate.mockResolvedValue({});

    const r = await aggregateDailyCostsForClient("c1");

    expect(r.updated).toBe(8);
    expect(r.inserted).toBe(0);
  });

  it("ne retourne dans details que les services avec volume > 0", async () => {
    triggerCount.mockResolvedValueOnce(5); // anthropic
    triggerCount.mockResolvedValueOnce(0); // apify
    leadCount.mockResolvedValue(0);
    triggerCount.mockResolvedValueOnce(0); // gouv
    cdFindUnique.mockResolvedValue(null);
    cdCreate.mockResolvedValue({});

    const r = await aggregateDailyCostsForClient("c1");
    expect(r.details.length).toBe(1);
    expect(r.details[0]?.service).toBe("anthropic");
    expect(r.details[0]?.volume).toBe(5);
  });

  it("calcul USD = volume × tarif unitaire", async () => {
    // 10 Opus calls → 10 × 0.05 = $0.50
    triggerCount.mockResolvedValueOnce(10);
    triggerCount.mockResolvedValueOnce(0);
    leadCount.mockResolvedValue(0);
    triggerCount.mockResolvedValueOnce(0);
    cdFindUnique.mockResolvedValue(null);
    cdCreate.mockResolvedValue({});

    const r = await aggregateDailyCostsForClient("c1");
    expect(r.totalUsd).toBeCloseTo(0.5, 2);
  });
});

describe("service-cost-tracker — aggregateDailyCostsForAllClients", () => {
  beforeEach(() => {
    clientFindMany.mockReset();
    triggerCount.mockReset();
    leadCount.mockReset();
    cdFindUnique.mockReset();
    cdCreate.mockReset();
  });

  it("itère sur tous les clients ACTIVE", async () => {
    clientFindMany.mockResolvedValue([
      { id: "c1", name: "Alpha" },
      { id: "c2", name: "Beta" },
    ]);
    triggerCount.mockResolvedValue(0);
    leadCount.mockResolvedValue(0);
    cdFindUnique.mockResolvedValue(null);
    cdCreate.mockResolvedValue({});

    const r = await aggregateDailyCostsForAllClients();

    expect(r.clientsProcessed).toBe(2);
    expect(r.perClient).toHaveLength(2);
    expect(r.perClient.map((c) => c.clientName).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("agrège le total USD cross-client", async () => {
    clientFindMany.mockResolvedValue([
      { id: "c1", name: "Alpha" },
      { id: "c2", name: "Beta" },
    ]);
    // Alpha = 10 Opus = $0.50, Beta = 20 Opus = $1.00
    triggerCount
      .mockResolvedValueOnce(10) // Alpha Opus
      .mockResolvedValueOnce(0) // Alpha Apify
      .mockResolvedValueOnce(0) // Alpha gouv
      .mockResolvedValueOnce(20) // Beta Opus
      .mockResolvedValueOnce(0) // Beta Apify
      .mockResolvedValueOnce(0); // Beta gouv
    leadCount.mockResolvedValue(0);
    cdFindUnique.mockResolvedValue(null);
    cdCreate.mockResolvedValue({});

    const r = await aggregateDailyCostsForAllClients();
    expect(r.totalUsd).toBeCloseTo(1.5, 2);
  });
});

describe("service-cost-tracker — getMonthlyCostsForClient", () => {
  beforeEach(() => {
    cdFindMany.mockReset();
  });

  it("agrège par service sur 30j", async () => {
    cdFindMany.mockResolvedValue([
      { service: "anthropic", volume: 10, estimatedUsd: 0.5 },
      { service: "anthropic", volume: 15, estimatedUsd: 0.75 },
      { service: "apify", volume: 100, estimatedUsd: 30 },
    ]);

    const r = await getMonthlyCostsForClient("c1");

    expect(r.totalUsd).toBeCloseTo(31.25, 2);
    expect(r.byService).toHaveLength(2);
    // Tri par USD descendant
    expect(r.byService[0]?.service).toBe("apify");
    expect(r.byService[0]?.volume).toBe(100);
    expect(r.byService[1]?.service).toBe("anthropic");
    expect(r.byService[1]?.volume).toBe(25);
  });

  it("retourne 0 si pas de données pour le client", async () => {
    cdFindMany.mockResolvedValue([]);
    const r = await getMonthlyCostsForClient("c1");
    expect(r.totalUsd).toBe(0);
    expect(r.byService).toEqual([]);
  });
});
