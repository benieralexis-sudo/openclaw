import { describe, it, expect } from "vitest";
import {
  buildTitleFilterForClient,
  DEFAULT_TITLE_INCLUDE_REGEX,
  DEFAULT_TITLE_EXCLUDE_REGEX,
} from "./icp-title-filter";

describe("buildTitleFilterForClient", () => {
  describe("default fallback (DTL legacy QA)", () => {
    const filter = buildTitleFilterForClient({});

    it("accepte les titres QA", () => {
      expect(filter("QA Engineer")).toBe(true);
      expect(filter("Test Manager")).toBe(true);
      expect(filter("Ingénieur Test Automatisation")).toBe(true);
      expect(filter("SDET Senior")).toBe(true);
      expect(filter("Testeur QA")).toBe(true);
      expect(filter("Quality Assurance Lead")).toBe(true);
    });

    it("rejette les non-QA tech polluants", () => {
      expect(filter("Ingénieur Mécanique")).toBe(false);
      expect(filter("Ingénieur CVC")).toBe(false);
      expect(filter("Aéronautique Engineer")).toBe(false);
      expect(filter("Process Engineer Chemistry")).toBe(false);
    });

    it("rejette les titres vides/null", () => {
      expect(filter(null)).toBe(false);
      expect(filter(undefined)).toBe(false);
      expect(filter("")).toBe(false);
    });

    it("rejette les Software Engineer génériques", () => {
      // pas explicitement dans include → falsy
      expect(filter("Software Engineer")).toBe(false);
      expect(filter("Sales Manager")).toBe(false);
      expect(filter("CTO")).toBe(false);
    });
  });

  describe("custom array iFIND (SDR/Sales)", () => {
    const filter = buildTitleFilterForClient({
      titleFilterInclude: [
        "SDR",
        "BDR",
        "Sales Development",
        "Business Development",
        "Account Executive",
        "Head of Sales",
        "Sales Manager",
        "Head of Growth",
        "CMO",
      ],
      titleFilterExclude: ["junior", "intern", "stagiaire"],
    });

    it("accepte les titres Sales/Growth", () => {
      expect(filter("Sales Development Representative")).toBe(true);
      expect(filter("Head of Sales")).toBe(true);
      expect(filter("Account Executive Senior")).toBe(true);
      expect(filter("Business Development Manager")).toBe(true);
      expect(filter("Head of Growth Operations")).toBe(true);
    });

    it("rejette les titres QA pour iFIND", () => {
      expect(filter("QA Engineer")).toBe(false);
      expect(filter("Test Manager")).toBe(false);
      expect(filter("Ingénieur Test")).toBe(false);
    });

    it("rejette les junior/intern", () => {
      expect(filter("Sales Junior Representative")).toBe(false);
      expect(filter("Stagiaire BDR")).toBe(false);
    });
  });

  describe("custom regex string", () => {
    const filter = buildTitleFilterForClient({
      titleFilterInclude: "\\b(ciso|rssi|security\\s+engineer)\\b",
    });

    it("accepte les patterns définis", () => {
      expect(filter("CISO Senior")).toBe(true);
      expect(filter("RSSI Adjoint")).toBe(true);
      expect(filter("Security Engineer Cloud")).toBe(true);
    });

    it("rejette les autres titres", () => {
      expect(filter("QA Engineer")).toBe(false);
      expect(filter("SDR Senior")).toBe(false);
    });
  });

  describe("default regexes (export check)", () => {
    it("DEFAULT_TITLE_INCLUDE_REGEX match QA legacy", () => {
      expect(DEFAULT_TITLE_INCLUDE_REGEX.test("QA Engineer")).toBe(true);
      expect(DEFAULT_TITLE_INCLUDE_REGEX.test("Test Manager")).toBe(true);
    });

    it("DEFAULT_TITLE_EXCLUDE_REGEX match non-QA polluants", () => {
      expect(DEFAULT_TITLE_EXCLUDE_REGEX.test("Mécanique")).toBe(true);
      expect(DEFAULT_TITLE_EXCLUDE_REGEX.test("Chimie")).toBe(true);
    });
  });
});
