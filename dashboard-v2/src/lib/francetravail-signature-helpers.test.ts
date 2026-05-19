import { describe, expect, it } from "vitest";
import {
  countSignatureMatchesInOffer,
  isBombloraBlacklisted,
  isVendorCompany,
} from "./francetravail-signature-helpers";

const KEYWORDS = [
  "signature électronique",
  "DocuSign",
  "Yousign",
  "Docaposte",
  "parapheur électronique",
  "eIDAS",
];

describe("countSignatureMatchesInOffer", () => {
  it("0 sur texte vide", () => {
    expect(countSignatureMatchesInOffer(undefined, KEYWORDS)).toEqual({
      count: 0,
      labels: [],
    });
  });

  it("case-insensitive", () => {
    const r = countSignatureMatchesInOffer(
      "Profil chargé d'admin utilisant YOUSIGN au quotidien",
      KEYWORDS,
    );
    expect(r.count).toBe(1);
    expect(r.labels).toEqual(["Yousign"]);
  });

  it("multi-keywords distincts comptés une fois chacun", () => {
    const txt =
      "Vous gérerez les contrats via DocuSign et le parapheur électronique en conformité eIDAS";
    const r = countSignatureMatchesInOffer(txt, KEYWORDS);
    expect(r.count).toBe(3);
    expect(r.labels).toEqual(
      expect.arrayContaining(["DocuSign", "parapheur électronique", "eIDAS"]),
    );
  });
});

describe("isBombloraBlacklisted — blacklist allégée Bombora FR", () => {
  it("flag les agences intérim", () => {
    expect(isBombloraBlacklisted("Adecco")).toBe(true);
    expect(isBombloraBlacklisted("MANPOWER FRANCE")).toBe(true);
    expect(isBombloraBlacklisted("Randstad Lyon")).toBe(true);
  });

  it("flag restaurants/cafés/boulangeries", () => {
    expect(isBombloraBlacklisted("Restaurant Le Bistrot")).toBe(true);
    expect(isBombloraBlacklisted("Boulangerie du Coin")).toBe(true);
  });

  it("NE FLAG PAS les collectivités (cibles Bombora signature)", () => {
    // Différence clé vs francetravail.ts isFTBlacklisted (qui les flag toutes).
    expect(isBombloraBlacklisted("Mairie de Lyon")).toBe(false);
    expect(isBombloraBlacklisted("Conseil départemental de la Loire")).toBe(false);
    expect(isBombloraBlacklisted("Métropole de Lille")).toBe(false);
    expect(isBombloraBlacklisted("Communauté de communes du Bocage")).toBe(false);
  });

  it("NE FLAG PAS les écoles/musées/CCAS (cibles publiques)", () => {
    expect(isBombloraBlacklisted("Bibliothèque municipale")).toBe(false);
    expect(isBombloraBlacklisted("Musée des Beaux-Arts")).toBe(false);
    expect(isBombloraBlacklisted("CCAS de Toulouse")).toBe(false);
  });

  it("NE FLAG PAS les boîtes B2B normales", () => {
    expect(isBombloraBlacklisted("Crédit Agricole")).toBe(false);
    expect(isBombloraBlacklisted("MAIF Assurances")).toBe(false);
    expect(isBombloraBlacklisted("Decathlon")).toBe(false);
  });

  it("retourne true sur nom vide ou undefined (sécurité)", () => {
    expect(isBombloraBlacklisted(undefined)).toBe(true);
    expect(isBombloraBlacklisted("")).toBe(true);
  });
});

describe("isVendorCompany", () => {
  it("flag Yousign + DOCAPOSTE", () => {
    expect(isVendorCompany("Yousign", KEYWORDS)).toBe(true);
    expect(isVendorCompany("DOCAPOSTE", KEYWORDS)).toBe(true);
    expect(isVendorCompany("docusign france", KEYWORDS)).toBe(true);
  });

  it("ne flag PAS Mairie de Lyon (collectivité cible)", () => {
    expect(isVendorCompany("Mairie de Lyon", KEYWORDS)).toBe(false);
  });

  it("ne flag pas keyword <4 chars", () => {
    expect(isVendorCompany("BIC", ["BIC", "DocuSign"])).toBe(false);
  });
});
