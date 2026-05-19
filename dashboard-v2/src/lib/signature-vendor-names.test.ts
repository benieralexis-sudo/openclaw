import { describe, expect, it } from "vitest";
import {
  SIGNATURE_VENDOR_NAMES,
  hasGenericSignatureSignal,
} from "./signature-vendor-names";

describe("signature-vendor-names (Jour 14 Sujet 10)", () => {
  describe("SIGNATURE_VENDOR_NAMES", () => {
    it("contient les vendors majeurs FR/UE en lowercase", () => {
      for (const v of [
        "docusign",
        "yousign",
        "docaposte",
        "universign",
        "signaturit",
        "adobe sign",
        "hellosign",
        "oodrive",
      ]) {
        expect(SIGNATURE_VENDOR_NAMES.has(v)).toBe(true);
      }
    });

    it("ne contient PAS de termes génériques", () => {
      for (const generic of [
        "signature électronique",
        "parapheur",
        "eidas",
        "dématérialisation",
        "facturation électronique",
      ]) {
        expect(SIGNATURE_VENDOR_NAMES.has(generic)).toBe(false);
      }
    });
  });

  describe("hasGenericSignatureSignal", () => {
    it("true si au moins un label est générique", () => {
      expect(hasGenericSignatureSignal(["signature électronique"])).toBe(true);
      expect(hasGenericSignatureSignal(["parapheur"])).toBe(true);
      expect(hasGenericSignatureSignal(["eIDAS"])).toBe(true);
    });

    it("true si mix générique + vendor (le générique fait foi)", () => {
      expect(hasGenericSignatureSignal(["DocuSign", "signature électronique"])).toBe(true);
      expect(hasGenericSignatureSignal(["Yousign", "parapheur"])).toBe(true);
    });

    it("false si TOUS les labels sont des vendors", () => {
      expect(hasGenericSignatureSignal(["Docaposte"])).toBe(false);
      expect(hasGenericSignatureSignal(["DocuSign", "Yousign"])).toBe(false);
      expect(hasGenericSignatureSignal(["Adobe Sign", "Universign"])).toBe(false);
    });

    it("false pour liste vide", () => {
      expect(hasGenericSignatureSignal([])).toBe(false);
    });

    it("case-insensitive sur vendor names", () => {
      expect(hasGenericSignatureSignal(["DOCAPOSTE"])).toBe(false);
      expect(hasGenericSignatureSignal(["docaposte"])).toBe(false);
      expect(hasGenericSignatureSignal(["DoCuSiGn"])).toBe(false);
    });

    it("ignore whitespace autour des vendor names", () => {
      expect(hasGenericSignatureSignal(["  Docaposte  "])).toBe(false);
      expect(hasGenericSignatureSignal(["\nYousign\t"])).toBe(false);
    });
  });
});
