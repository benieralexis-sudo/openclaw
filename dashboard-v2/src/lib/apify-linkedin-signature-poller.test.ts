import { describe, expect, it } from "vitest";
import {
  countSignatureMatchesInDescription,
  isVendorCompany,
} from "./apify-linkedin-signature-poller";

describe("countSignatureMatchesInDescription", () => {
  const keywords = [
    "signature électronique",
    "DocuSign",
    "Yousign",
    "parapheur électronique",
    "eIDAS",
  ];

  it("retourne 0 match si description vide ou undefined", () => {
    expect(countSignatureMatchesInDescription(undefined, keywords)).toEqual({
      count: 0,
      labels: [],
    });
    expect(countSignatureMatchesInDescription("", keywords)).toEqual({
      count: 0,
      labels: [],
    });
  });

  it("retourne 0 si la description ne mentionne aucun mot-clé", () => {
    const desc = "Nous recherchons un développeur Java pour notre équipe.";
    expect(countSignatureMatchesInDescription(desc, keywords)).toEqual({
      count: 0,
      labels: [],
    });
  });

  it("match insensible à la casse", () => {
    const desc = "Notre équipe utilise YOUSIGN et docusign pour les contrats.";
    const result = countSignatureMatchesInDescription(desc, keywords);
    expect(result.count).toBe(2);
    expect(result.labels).toContain("DocuSign");
    expect(result.labels).toContain("Yousign");
  });

  it("compte plusieurs mots-clés présents", () => {
    const desc =
      "Le poste consiste à gérer les contrats en signature électronique " +
      "via DocuSign et le parapheur électronique de la collectivité.";
    const result = countSignatureMatchesInDescription(desc, keywords);
    expect(result.count).toBe(3);
    expect(result.labels).toEqual(
      expect.arrayContaining(["signature électronique", "DocuSign", "parapheur électronique"]),
    );
  });

  it("match les noms de produits exotiques (eIDAS)", () => {
    const desc =
      "Mise en conformité de notre process avec le règlement eIDAS 2.";
    const result = countSignatureMatchesInDescription(desc, keywords);
    expect(result.count).toBe(1);
    expect(result.labels).toEqual(["eIDAS"]);
  });

  it("ignore les mots-clés vides ou whitespace-only", () => {
    const keywordsWithBlank = ["DocuSign", "", "  ", "Yousign"];
    const desc = "Contrats via DocuSign uniquement.";
    const result = countSignatureMatchesInDescription(desc, keywordsWithBlank);
    expect(result.count).toBe(1);
    expect(result.labels).toEqual(["DocuSign"]);
  });

  it("comptage des doublons : 1 keyword n'est compté qu'une fois même si présent 3×", () => {
    const desc =
      "DocuSign permet la signature. DocuSign est utilisé. DocuSign final.";
    const result = countSignatureMatchesInDescription(desc, ["DocuSign"]);
    expect(result.count).toBe(1);
    expect(result.labels).toEqual(["DocuSign"]);
  });

  it("conserve l'ordre des keywords du tableau d'entrée", () => {
    const desc = "Yousign et DocuSign sont des plateformes de signature.";
    const result = countSignatureMatchesInDescription(desc, [
      "DocuSign",
      "Yousign",
    ]);
    expect(result.labels).toEqual(["DocuSign", "Yousign"]);
  });
});

describe("isVendorCompany (anti-faux-positif concurrent)", () => {
  const keywords = [
    "DocuSign",
    "Yousign",
    "Docaposte",
    "signature électronique",
    "eIDAS",
  ];

  it("détecte DOCAPOSTE comme vendeur (case-insensitive)", () => {
    expect(isVendorCompany("DOCAPOSTE", keywords)).toBe(true);
  });

  it("détecte Yousign même en variation case", () => {
    expect(isVendorCompany("yousign sas", keywords)).toBe(true);
  });

  it("ne flag PAS Softeam qui mentionne juste Docaposte en description", () => {
    expect(isVendorCompany("SOFTEAM", keywords)).toBe(false);
  });

  it("ne flag PAS un keyword trop court (<4 chars)", () => {
    expect(isVendorCompany("BIC", ["BIC", "DocuSign"])).toBe(false);
  });

  it("ne flag PAS une boîte qui contient juste un sous-mot du keyword multi-mots", () => {
    // "signature électronique" est multi-mots → on ne match que l'expression
    // complète. Une boîte "Signature SA" ne doit pas être taguée.
    expect(isVendorCompany("Signature SA", keywords)).toBe(false);
  });

  it("flag boîte multi-mots si elle contient l'expression complète", () => {
    expect(
      isVendorCompany("Bureau Signature Électronique France", keywords),
    ).toBe(true);
  });

  it("flag avec accents normalisés (signature électronique avec é)", () => {
    expect(isVendorCompany("Signature Électronique Pro", keywords)).toBe(true);
  });
});
