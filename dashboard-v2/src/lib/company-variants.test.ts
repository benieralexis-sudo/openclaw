import { describe, expect, it } from "vitest";
import { generateCompanyVariants } from "./company-variants";

describe("generateCompanyVariants", () => {
  it("retourne au moins le nom verbatim", () => {
    expect(generateCompanyVariants("DiXiO")).toEqual(["DiXiO"]);
  });

  it("retourne tableau vide si nom vide ou whitespace", () => {
    expect(generateCompanyVariants("")).toEqual([]);
    expect(generateCompanyVariants("   ")).toEqual([]);
  });

  it("strip préfixes juridiques (SAS, SARL, Société, Groupe)", () => {
    const v = generateCompanyVariants("SOCIETE GESER BEST");
    expect(v[0]).toBe("SOCIETE GESER BEST");
    expect(v).toContain("GESER BEST");
  });

  it("strip suffixes métier (Développement, Technologies)", () => {
    const v = generateCompanyVariants("Salvia Développement");
    expect(v[0]).toBe("Salvia Développement");
    expect(v).toContain("Salvia");
  });

  it("Groupe Yoni → variante Yoni", () => {
    const v = generateCompanyVariants("Groupe Yoni");
    expect(v[0]).toBe("Groupe Yoni");
    expect(v).toContain("Yoni");
  });

  it("dédupe les variantes identiques", () => {
    const v = generateCompanyVariants("Klanik");
    // verbatim seul, pas de doublon
    expect(v).toEqual(["Klanik"]);
  });

  it("dédupe insensible à la casse", () => {
    const v = generateCompanyVariants("SALVIA");
    expect(v.length).toBe(1);
  });

  it("strip combo préfixe + suffixe", () => {
    const v = generateCompanyVariants("Groupe Salvia Développement");
    expect(v[0]).toBe("Groupe Salvia Développement");
    expect(v).toContain("Salvia");
  });

  it("variante 1er mot ignorée si < 3 caractères", () => {
    // "GO Tech" — strip "Tech" → "GO" via variante stripped (pas via 1er mot,
    // qui exigerait length >= 3). "GO" passe quand même via stripped.
    // Pour tester le garde-fou 1er mot pur, on prend un nom 2-mots dont le
    // 1er mot est court et qui ne déclenche pas de stripping.
    const v = generateCompanyVariants("X Software");
    // "Software" n'est pas dans COMPANY_VARIANT_SUFFIXES → stripped == verbatim
    // donc on ne tente que la variante 1er mot "X" → length < 3 → REJET
    expect(v).not.toContain("X");
  });

  it("Capgemini Consulting — strip Consulting via normalisation", () => {
    const v = generateCompanyVariants("Capgemini Consulting");
    expect(v[0]).toBe("Capgemini Consulting");
    expect(v).toContain("Capgemini");
  });

  it("Training Orchestra reste verbatim (Orchestra n'est pas un suffixe métier)", () => {
    const v = generateCompanyVariants("Training Orchestra");
    expect(v[0]).toBe("Training Orchestra");
    // "Training" devient 1er mot seul
    expect(v).toContain("Training");
  });

  it("variante normalisée == verbatim → pas de doublon dans la liste", () => {
    const v = generateCompanyVariants("DiXiO");
    expect(new Set(v).size).toBe(v.length);
  });
});
