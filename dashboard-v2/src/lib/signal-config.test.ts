import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock du module db AVANT l'import du module testé
vi.mock("@/lib/db", () => ({
  db: {
    clientSignalConfig: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import {
  isSignalEnabled,
  getSignalConfig,
  getDisabledSignalCodes,
  getActivePillars,
  invalidateSignalConfigCache,
} from "./signal-config";

const findManyMock = db.clientSignalConfig.findMany as ReturnType<typeof vi.fn>;

describe("signal-config", () => {
  beforeEach(() => {
    invalidateSignalConfigCache();
    findManyMock.mockReset();
  });

  describe("isSignalEnabled", () => {
    it("retourne true par défaut quand aucune config explicite (rétro-compat)", async () => {
      findManyMock.mockResolvedValue([]);
      const result = await isSignalEnabled("client-1", "P3");
      expect(result).toBe(true);
    });

    it("retourne false si config explicite enabled=false", async () => {
      findManyMock.mockResolvedValue([
        {
          enabled: false,
          parameters: {},
          isPillar: false,
          signal: { code: "P3" },
        },
      ]);
      const result = await isSignalEnabled("client-1", "P3");
      expect(result).toBe(false);
    });

    it("retourne true si config explicite enabled=true", async () => {
      findManyMock.mockResolvedValue([
        {
          enabled: true,
          parameters: {},
          isPillar: true,
          signal: { code: "P1" },
        },
      ]);
      const result = await isSignalEnabled("client-1", "P1");
      expect(result).toBe(true);
    });
  });

  describe("getSignalConfig", () => {
    it("retourne isDefault=true si pas de config explicite", async () => {
      findManyMock.mockResolvedValue([]);
      const cfg = await getSignalConfig("client-1", "B5");
      expect(cfg).toEqual({
        enabled: true,
        parameters: {},
        isPillar: false,
        isDefault: true,
      });
    });

    it("retourne les parameters custom du client", async () => {
      findManyMock.mockResolvedValue([
        {
          enabled: true,
          parameters: { keywords: ["QA", "Test"] },
          isPillar: true,
          signal: { code: "P1" },
        },
      ]);
      const cfg = await getSignalConfig("client-1", "P1");
      expect(cfg.enabled).toBe(true);
      expect(cfg.parameters).toEqual({ keywords: ["QA", "Test"] });
      expect(cfg.isPillar).toBe(true);
      expect(cfg.isDefault).toBe(false);
    });
  });

  describe("cache 5 min", () => {
    it("ne call findMany qu'une seule fois pour 2 checks consécutifs sur le même client", async () => {
      findManyMock.mockResolvedValue([
        {
          enabled: true,
          parameters: {},
          isPillar: false,
          signal: { code: "P1" },
        },
      ]);
      await isSignalEnabled("client-1", "P1");
      await isSignalEnabled("client-1", "P3");
      expect(findManyMock).toHaveBeenCalledTimes(1);
    });

    it("recall findMany pour un autre client", async () => {
      findManyMock.mockResolvedValue([]);
      await isSignalEnabled("client-1", "P1");
      await isSignalEnabled("client-2", "P1");
      expect(findManyMock).toHaveBeenCalledTimes(2);
    });

    it("invalidateSignalConfigCache(clientId) recall findMany pour ce client", async () => {
      findManyMock.mockResolvedValue([]);
      await isSignalEnabled("client-1", "P1");
      invalidateSignalConfigCache("client-1");
      await isSignalEnabled("client-1", "P1");
      expect(findManyMock).toHaveBeenCalledTimes(2);
    });

    it("invalidateSignalConfigCache() sans arg vide tout", async () => {
      findManyMock.mockResolvedValue([]);
      await isSignalEnabled("client-1", "P1");
      await isSignalEnabled("client-2", "P1");
      invalidateSignalConfigCache();
      await isSignalEnabled("client-1", "P1");
      await isSignalEnabled("client-2", "P1");
      expect(findManyMock).toHaveBeenCalledTimes(4);
    });
  });

  describe("getDisabledSignalCodes", () => {
    it("retourne seulement les signaux explicitement désactivés", async () => {
      findManyMock.mockResolvedValue([
        { enabled: false, parameters: {}, isPillar: false, signal: { code: "P3" } },
        { enabled: false, parameters: {}, isPillar: false, signal: { code: "B5" } },
        { enabled: true, parameters: {}, isPillar: true, signal: { code: "P1" } },
      ]);
      const codes = await getDisabledSignalCodes("client-1");
      expect(codes.sort()).toEqual(["B5", "P3"]);
    });

    it("retourne tableau vide si aucune config explicite", async () => {
      findManyMock.mockResolvedValue([]);
      const codes = await getDisabledSignalCodes("client-1");
      expect(codes).toEqual([]);
    });
  });

  describe("getActivePillars", () => {
    it("retourne seulement les PILLAR avec isPillar=true et enabled=true", async () => {
      findManyMock.mockResolvedValue([
        { enabled: true, parameters: {}, isPillar: true, signal: { code: "P1" } },
        { enabled: true, parameters: {}, isPillar: true, signal: { code: "P3" } },
        { enabled: true, parameters: {}, isPillar: true, signal: { code: "P5" } },
        { enabled: false, parameters: {}, isPillar: true, signal: { code: "P2" } }, // disabled, exclu
        { enabled: true, parameters: {}, isPillar: false, signal: { code: "B1" } }, // pas pillar, exclu
      ]);
      const pillars = await getActivePillars("client-1");
      expect(pillars.sort()).toEqual(["P1", "P3", "P5"]);
    });

    it("retourne tableau vide si aucun pillar configuré", async () => {
      findManyMock.mockResolvedValue([]);
      const pillars = await getActivePillars("client-1");
      expect(pillars).toEqual([]);
    });
  });
});
