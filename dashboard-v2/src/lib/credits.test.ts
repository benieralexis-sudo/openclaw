import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock du module db AVANT l'import du module testé.
// On simule à la fois client.findUnique/findMany/updateMany et leadCredit.findFirst/create,
// + la fonction $transaction qui exécute simplement le callback contre les mêmes mocks
// (suffit pour tester la logique de cap, pas la transactionalité PostgreSQL).
vi.mock("@/lib/db", () => {
  const tx = {
    client: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    leadCredit: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };
  return {
    db: {
      ...tx,
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  };
});

import { db } from "@/lib/db";
import {
  debitCreditForQualifiedLead,
  resetClientsDueForAnniversary,
} from "./credits";

type MockedDb = typeof db & {
  client: {
    updateMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
  };
  leadCredit: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

const mdb = db as MockedDb;

describe("V1 18/05 — Cap dur sur debitCreditForQualifiedLead", () => {
  beforeEach(() => {
    mdb.client.updateMany.mockReset();
    mdb.client.findUnique.mockReset();
    mdb.leadCredit.findFirst.mockReset();
    mdb.leadCredit.create.mockReset();
  });

  it("refuse débit si score < 6 (pas qualifié)", async () => {
    const r = await debitCreditForQualifiedLead({
      clientId: "c1",
      triggerId: "t1",
      score: 5,
    });
    expect(r.debited).toBe(false);
    if (!r.debited) expect(r.reason).toBe("score_too_low");
    expect(mdb.client.updateMany).not.toHaveBeenCalled();
  });

  it("refuse débit pour plan ≠ GROWTH (grandfathered DTL LEADS_DATA)", async () => {
    mdb.client.findUnique.mockResolvedValueOnce({
      plan: "LEADS_DATA",
      creditsBalance: 999999,
    });
    const r = await debitCreditForQualifiedLead({
      clientId: "dtl",
      triggerId: "t1",
      score: 8,
    });
    expect(r.debited).toBe(false);
    if (!r.debited) expect(r.reason).toBe("plan_not_growth");
    expect(mdb.client.updateMany).not.toHaveBeenCalled();
  });

  it("idempotent : retourne already_debited si trigger déjà débité", async () => {
    mdb.client.findUnique.mockResolvedValueOnce({
      plan: "GROWTH",
      creditsBalance: 50,
    });
    mdb.leadCredit.findFirst.mockResolvedValueOnce({
      id: "existing",
      balanceAfter: 49,
      isPepite: false,
    });
    const r = await debitCreditForQualifiedLead({
      clientId: "c1",
      triggerId: "t1",
      score: 7,
    });
    expect(r.debited).toBe(false);
    if (!r.debited) expect(r.reason).toBe("already_debited");
    expect(r.balanceAfter).toBe(49);
  });

  it("CAP DUR : refuse débit si balance = 0 (updateMany retourne count=0)", async () => {
    mdb.client.findUnique
      .mockResolvedValueOnce({ plan: "GROWTH", creditsBalance: 0 }) // 1er check init
      .mockResolvedValueOnce({ creditsBalance: 0 }); // findUnique dans la branche cap_reached
    mdb.leadCredit.findFirst.mockResolvedValueOnce(null);
    mdb.client.updateMany.mockResolvedValueOnce({ count: 0 });
    mdb.leadCredit.create.mockResolvedValueOnce({});

    const r = await debitCreditForQualifiedLead({
      clientId: "c1",
      triggerId: "t1",
      score: 9, // Pépite, mais cap atteint
    });

    expect(r.debited).toBe(false);
    if (!r.debited) expect(r.reason).toBe("cap_reached");
    expect(r.balanceAfter).toBe(0);
    // Audit row "cap_reached_blocked" créé
    expect(mdb.leadCredit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: "cap_reached_blocked", amount: 0 }),
      }),
    );
  });

  it("CAP DUR : autorise débit si balance = 1 (updateMany count=1)", async () => {
    mdb.client.findUnique
      .mockResolvedValueOnce({ plan: "GROWTH", creditsBalance: 1 })
      .mockResolvedValueOnce({ creditsBalance: 0 });
    mdb.leadCredit.findFirst.mockResolvedValueOnce(null);
    mdb.client.updateMany.mockResolvedValueOnce({ count: 1 });
    mdb.leadCredit.create.mockResolvedValueOnce({});

    const r = await debitCreditForQualifiedLead({
      clientId: "c1",
      triggerId: "t-last",
      score: 7,
    });

    expect(r.debited).toBe(true);
    expect(r.balanceAfter).toBe(0);
    // Filtre `creditsBalance > 0` doit être appliqué pour éviter race condition
    expect(mdb.client.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ creditsBalance: { gt: 0 } }),
      }),
    );
  });

  it("marque isPepite=true et incrémente pepitesThisMonth si score >= 8", async () => {
    mdb.client.findUnique
      .mockResolvedValueOnce({ plan: "GROWTH", creditsBalance: 10 })
      .mockResolvedValueOnce({ creditsBalance: 9 });
    mdb.leadCredit.findFirst.mockResolvedValueOnce(null);
    mdb.client.updateMany.mockResolvedValueOnce({ count: 1 });
    mdb.leadCredit.create.mockResolvedValueOnce({});

    const r = await debitCreditForQualifiedLead({
      clientId: "c1",
      triggerId: "t-pepite",
      score: 9,
    });

    expect(r.debited).toBe(true);
    expect(r.isPepite).toBe(true);
    // Le data passé à updateMany doit inclure pepitesThisMonth: { increment: 1 }
    expect(mdb.client.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creditsBalance: { decrement: 1 },
          pepitesThisMonth: { increment: 1 },
        }),
      }),
    );
  });
});

describe("V1 18/05 — Reset 30j anniversaire", () => {
  beforeEach(() => {
    // Patch findMany pour le test reset
    (mdb.client as { findMany?: ReturnType<typeof vi.fn> }).findMany = vi.fn();
    mdb.client.findUnique.mockReset();
    mdb.client.update = vi.fn();
    mdb.leadCredit.create.mockReset();
  });

  it("ne reset pas un client si < 30j depuis dernière dose", async () => {
    const recent = new Date(Date.now() - 5 * 86_400_000); // J-5
    (mdb.client.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "c1",
        name: "Test",
        activatedAt: new Date(Date.now() - 60 * 86_400_000),
        creditsLastResetAt: recent,
      },
    ]);

    const r = await resetClientsDueForAnniversary();

    expect(r.scanned).toBe(1);
    expect(r.resetCount).toBe(0);
    expect(r.details[0]?.triggered).toBe(false);
    expect(r.details[0]?.daysSinceLastReset).toBe(5);
  });

  it("reset un client si >= 30j depuis dernière dose", async () => {
    const old = new Date(Date.now() - 31 * 86_400_000); // J-31
    (mdb.client.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "c1",
        name: "Test",
        activatedAt: new Date(Date.now() - 60 * 86_400_000),
        creditsLastResetAt: old,
      },
    ]);
    // Mock pour resetMonthlyCreditsForClient (appel interne)
    mdb.client.findUnique.mockResolvedValueOnce({
      creditsBalance: 0,
      creditsMonthlyQuota: 50,
      pepitesThisMonth: 3,
      pepitesGuaranteed: 5,
    });
    (mdb.client.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      creditsBalance: 50,
    });
    mdb.leadCredit.create.mockResolvedValue({});

    const r = await resetClientsDueForAnniversary();

    expect(r.resetCount).toBe(1);
    expect(r.details[0]?.triggered).toBe(true);
    expect(r.details[0]?.daysSinceLastReset).toBeGreaterThanOrEqual(31);
  });

  it("skip un client sans creditsLastResetAt ni activatedAt", async () => {
    (mdb.client.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "c-broken",
        name: "Broken",
        activatedAt: null,
        creditsLastResetAt: null,
      },
    ]);

    const r = await resetClientsDueForAnniversary();

    expect(r.scanned).toBe(1);
    expect(r.resetCount).toBe(0);
    expect(r.details[0]?.daysSinceLastReset).toBe(-1);
  });
});
