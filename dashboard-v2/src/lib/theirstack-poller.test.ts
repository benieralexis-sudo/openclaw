import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocks AVANT l'import du module testé.
vi.mock("@/lib/db", () => ({
  db: {
    client: {
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/lib/quota-checker", () => ({
  checkQuota: vi.fn().mockResolvedValue({ ok: true, pctUsed: 0 }),
  recordSpend: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/signal-config", () => ({
  getP1Keywords: vi.fn().mockResolvedValue([]),
  getP3Industries: vi.fn().mockResolvedValue([]),
  getP3Sizes: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/theirstack", () => ({
  searchJobs: vi.fn(),
  searchCompanies: vi.fn(),
}));

import { db } from "@/lib/db";
import { searchCompanies } from "@/lib/theirstack";
import { pollTheirstackBuyingIntentForClient } from "./theirstack-poller";

const findUniqueMock = db.client.findUnique as ReturnType<typeof vi.fn>;
const searchCompaniesMock = searchCompanies as ReturnType<typeof vi.fn>;

describe("pollTheirstackBuyingIntentForClient — multi-tenant safety (Jour 14 Sujet 7)", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    searchCompaniesMock.mockReset();
  });

  it("skip avec error config si icp.buyingIntentTechSlugs absent (anti-pollution Kicklox/Digidemat)", async () => {
    findUniqueMock.mockResolvedValue({
      id: "test-client",
      name: "Digidemat",
      icp: {
        industries: ["Administrations"],
        sizes: ["11-50"],
        // PAS de buyingIntentTechSlugs
      },
    });

    const result = await pollTheirstackBuyingIntentForClient("test-client");

    expect(result.companiesFound).toBe(0);
    expect(result.triggersCreated).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.kind).toBe("config");
    expect(result.errors[0]?.error).toContain("buyingIntentTechSlugs");
    // Le search TheirStack ne doit JAMAIS être déclenché si pas de techSlugs.
    expect(searchCompaniesMock).not.toHaveBeenCalled();
  });

  it("skip aussi si icp.buyingIntentTechSlugs présent mais vide []", async () => {
    findUniqueMock.mockResolvedValue({
      id: "test-client",
      name: "Test Client",
      icp: { buyingIntentTechSlugs: [] },
    });

    const result = await pollTheirstackBuyingIntentForClient("test-client");

    expect(result.errors[0]?.kind).toBe("config");
    expect(searchCompaniesMock).not.toHaveBeenCalled();
  });

  it("options.techSlugs override l'ICP (rétro-compat tests/debug)", async () => {
    findUniqueMock.mockResolvedValue({
      id: "test-client",
      name: "Test Client",
      icp: {}, // pas de buyingIntentTechSlugs
    });
    searchCompaniesMock.mockResolvedValue({ data: [] });

    const result = await pollTheirstackBuyingIntentForClient("test-client", {
      techSlugs: ["selenium", "cypress"],
    });

    // Pas d'error config car techSlugs fourni en option.
    expect(result.errors.find((e) => e.kind === "config")).toBeUndefined();
    expect(searchCompaniesMock).toHaveBeenCalledOnce();
  });
});

describe("isTechIcp regex — Bug racine 20/05/2026 Digidemat", () => {
  // Garde anti-régression du bug racine Bombora FR 20/05/2026 :
  // /saas|logiciel|tech|esn|ssii|software|it/i (sans \b) matchait
  // "Collectivités territoriales" sur la substring "it" → ICP Digidemat
  // marquée à tort tech → 4 Pépites BOAMP collectivités publiques étaient
  // soft-deleted à chaque run all (CNFPT, CD Calvados, CH Lens, SICIO).
  // Fix : word boundaries \b autour de chaque alternative.
  const regex = /\b(saas|logiciel|tech|esn|ssii|software|it)s?\b/i;

  it("ICP Digidemat (collectivités publiques) → ne matche pas", () => {
    const industries = [
      "Cabinets d'avocats",
      "Cabinets comptables",
      "Notaires",
      "PME tertiaires",
      "Administrations",
      "Collectivités territoriales",
      "Établissements publics",
      "Santé",
      "Enseignement supérieur",
    ];
    expect(industries.some((i) => regex.test(i))).toBe(false);
  });

  it("ICP tech/SaaS → matche bien", () => {
    expect(regex.test("SaaS B2B")).toBe(true);
    expect(regex.test("Editeurs de logiciels")).toBe(true);
    expect(regex.test("ESN / SSII")).toBe(true);
    expect(regex.test("Tech / Software")).toBe(true);
    expect(regex.test("Services IT")).toBe(true);
  });

  it("substring traps (ne doivent JAMAIS matcher)", () => {
    expect(regex.test("Collectivités territoriales")).toBe(false);
    expect(regex.test("Architecture")).toBe(false);
    expect(regex.test("Designer")).toBe(false);
  });
});
