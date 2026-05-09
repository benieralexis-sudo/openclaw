import { describe, it, expect } from "vitest";
import { computeMonthlyResetParams, ROLLOVER_CAP_MULTIPLIER } from "./credits-math";

describe("Credits — computeMonthlyResetParams", () => {
  describe("Garantie Pepite", () => {
    it("declenche garantie si pepitesThisMonth < pepitesGuaranteed (Growth)", () => {
      const r = computeMonthlyResetParams({
        creditsBalance: 0,
        creditsMonthlyQuota: 60,
        pepitesThisMonth: 4, // sous le minimum 6
        pepitesGuaranteed: 6,
      });
      expect(r.guaranteeTriggered).toBe(true);
      expect(r.quotaCredited).toBe(120); // double
    });

    it("ne declenche PAS si pepitesThisMonth >= pepitesGuaranteed", () => {
      const r = computeMonthlyResetParams({
        creditsBalance: 0,
        creditsMonthlyQuota: 60,
        pepitesThisMonth: 6,
        pepitesGuaranteed: 6,
      });
      expect(r.guaranteeTriggered).toBe(false);
      expect(r.quotaCredited).toBe(60);
    });

    it("declenche aussi a 0 Pepites (cas extreme mois calme)", () => {
      const r = computeMonthlyResetParams({
        creditsBalance: 0,
        creditsMonthlyQuota: 60,
        pepitesThisMonth: 0,
        pepitesGuaranteed: 6,
      });
      expect(r.guaranteeTriggered).toBe(true);
      expect(r.quotaCredited).toBe(120);
    });
  });

  describe("Rollover cap", () => {
    it("cap au 4x quota mensuel (Growth = 240)", () => {
      const r = computeMonthlyResetParams({
        creditsBalance: 200, // deja accumule
        creditsMonthlyQuota: 60,
        pepitesThisMonth: 6,
        pepitesGuaranteed: 6,
      });
      // naive = 200 + 60 = 260, cap a 240
      expect(r.cappedBalance).toBe(240);
      expect(r.cappedAmount).toBe(20); // 20 credits coupes
      expect(r.netCreditedAmount).toBe(40); // 60 - 20 capped
    });

    it("pas de cap si balance + quota <= cap", () => {
      const r = computeMonthlyResetParams({
        creditsBalance: 50,
        creditsMonthlyQuota: 60,
        pepitesThisMonth: 6,
        pepitesGuaranteed: 6,
      });
      // naive = 50 + 60 = 110, cap a 240, OK
      expect(r.cappedBalance).toBe(110);
      expect(r.cappedAmount).toBe(0);
      expect(r.netCreditedAmount).toBe(60);
    });

    it("cap aussi avec garantie doublee", () => {
      const r = computeMonthlyResetParams({
        creditsBalance: 200,
        creditsMonthlyQuota: 60,
        pepitesThisMonth: 2, // garantie ratee
        pepitesGuaranteed: 6,
      });
      // naive = 200 + 120 = 320, cap a 240
      expect(r.guaranteeTriggered).toBe(true);
      expect(r.quotaCredited).toBe(120);
      expect(r.cappedBalance).toBe(240);
      expect(r.cappedAmount).toBe(80);
    });

    it("cap multiplier = 4 (constante exposee)", () => {
      expect(ROLLOVER_CAP_MULTIPLIER).toBe(4);
    });
  });

  describe("Cas reels DTL", () => {
    it("DTL Growth normal (18 Pepites livrees, 0 rollover)", () => {
      // DTL fait 18 Pepites/mois en moyenne (cf data 30j)
      const r = computeMonthlyResetParams({
        creditsBalance: 0,
        creditsMonthlyQuota: 60,
        pepitesThisMonth: 18,
        pepitesGuaranteed: 6,
      });
      expect(r.guaranteeTriggered).toBe(false);
      expect(r.quotaCredited).toBe(60);
      expect(r.cappedBalance).toBe(60);
      expect(r.netCreditedAmount).toBe(60);
    });

    it("Mois calme rare : 4 Pepites = garantie ratee, quota double", () => {
      const r = computeMonthlyResetParams({
        creditsBalance: 30, // a peu utilise mois precedent
        creditsMonthlyQuota: 60,
        pepitesThisMonth: 4,
        pepitesGuaranteed: 6,
      });
      expect(r.guaranteeTriggered).toBe(true);
      expect(r.quotaCredited).toBe(120);
      expect(r.cappedBalance).toBe(150); // 30 + 120 = 150 < 240 OK
    });

    it("Discovery 25 credits (futur tier hypothetique)", () => {
      const r = computeMonthlyResetParams({
        creditsBalance: 5,
        creditsMonthlyQuota: 25,
        pepitesThisMonth: 3,
        pepitesGuaranteed: 3,
      });
      expect(r.guaranteeTriggered).toBe(false);
      expect(r.quotaCredited).toBe(25);
      expect(r.cappedBalance).toBe(30); // 5 + 25 = 30, cap 25*4=100 OK
    });

    it("Elite 200 credits (futur tier hypothetique)", () => {
      const r = computeMonthlyResetParams({
        creditsBalance: 100,
        creditsMonthlyQuota: 200,
        pepitesThisMonth: 12, // sous garantie 15
        pepitesGuaranteed: 15,
      });
      expect(r.guaranteeTriggered).toBe(true);
      expect(r.quotaCredited).toBe(400);
      // naive = 100 + 400 = 500, cap a 200*4=800 OK
      expect(r.cappedBalance).toBe(500);
      expect(r.cappedAmount).toBe(0);
    });
  });

  describe("Edge cases", () => {
    it("quota = 0 (client paused / unconfigured)", () => {
      const r = computeMonthlyResetParams({
        creditsBalance: 10,
        creditsMonthlyQuota: 0,
        pepitesThisMonth: 0,
        pepitesGuaranteed: 0,
      });
      expect(r.guaranteeTriggered).toBe(false); // 0 >= 0
      expect(r.quotaCredited).toBe(0);
      expect(r.cappedBalance).toBe(0); // cap = 0*4 = 0
      expect(r.cappedAmount).toBe(10); // 10 credits perdus
    });

    it("balance negative (overage non encore credit)", () => {
      const r = computeMonthlyResetParams({
        creditsBalance: -5, // overage en attente
        creditsMonthlyQuota: 60,
        pepitesThisMonth: 7,
        pepitesGuaranteed: 6,
      });
      expect(r.cappedBalance).toBe(55); // -5 + 60 = 55
      expect(r.netCreditedAmount).toBe(60);
    });
  });
});
