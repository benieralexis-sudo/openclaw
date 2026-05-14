import { describe, it, expect } from "vitest";
// Import depuis le module pure functions extrait (sans server-only) pour tests
import { isTechPersonaTitle, isTechHiringTrigger } from "./tech-persona-guard";

describe("isTechPersonaTitle — tech-hire-guard regex", () => {
  describe("tech titles acceptés (priorité 2)", () => {
    it.each([
      "CTO",
      "Chief Technology Officer",
      "Head of Engineering",
      "Head of QA",
      "Head of Tech",
      "VP Engineering",
      "VP Product",
      "Engineering Manager",
      "Tech Lead",
      "Tech Manager",
      "Software Development Manager",
      "Directeur Technique",
      "DSI",
      "CIO",
      "Architecte",
      "Architecte logiciel",
      "QA Manager",
      "QA Director",
      "QA Lead",
      "Test Manager",
      "Directeur de la qualité",
      // Founder/Co-founder SEUL (sans CEO/Pr/DG) = accepté
      "Founder",
      "Co-founder",
      "Cofondateur",
      "Fondateur",
      "Founder & CTO",
      "Co-founder & Head of Engineering",
    ])("accepte '%s'", (title) => {
      expect(isTechPersonaTitle(title)).toBe(true);
    });
  });

  describe("non-tech leadership rejetés (priorité 1, prime sur Founder)", () => {
    it.each([
      "CEO",
      "Chief Executive Officer",
      "Directeur Général",
      "Président",
      "President",
      "Gérant",
      "Managing Director",
      // Fix WeWard 14/05 : CEO+Co-founder = reject même si combo (PME 11-50,
      // CEO délègue recrutement tech à VP Eng/CTO)
      "CEO & Co-founder",
      "CEO & Founder",
      "Co-founder & CEO",
      "Founder & CEO",
      "Président & Cofondateur",
      "PDG & Founder",
      "Managing Director & Co-founder",
    ])("rejette '%s' (leadership non-tech prime sur Founder)", (title) => {
      expect(isTechPersonaTitle(title)).toBe(false);
    });
  });

  describe("non-tech autres (priorité 3)", () => {
    it.each([
      "VP Sales",
      "Head of Marketing",
      "Communication Manager",
      "Talent Acquisition",
      "Recruiter",
      "HR Director",
      "Ressources Humaines",
      "CFO",
      "Chief Financial Officer",
      "Legal Counsel",
      "COO",
    ])("rejette '%s'", (title) => {
      expect(isTechPersonaTitle(title)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("renvoie false sur null/undefined/empty", () => {
      expect(isTechPersonaTitle(null)).toBe(false);
      expect(isTechPersonaTitle(undefined)).toBe(false);
      expect(isTechPersonaTitle("")).toBe(false);
    });

    it("accepte titre exotique inconnu (évite faux négatifs)", () => {
      expect(isTechPersonaTitle("Staff Engineer")).toBe(true);
      expect(isTechPersonaTitle("Lead Architect")).toBe(true);
      expect(isTechPersonaTitle("Principal Developer")).toBe(true);
    });

    it("CTO+COO = OK (priorité 2 prime sur priorité 3 COO)", () => {
      // COO non-tech matché en priorité 3, mais CTO matché en priorité 2 d'abord
      expect(isTechPersonaTitle("CTO & COO")).toBe(true);
    });
  });
});

describe("isTechHiringTrigger", () => {
  it("HIRING_KEY + NAF tech (62.02A) → true", () => {
    expect(isTechHiringTrigger("HIRING_KEY", "62.02A", "QA Engineer")).toBe(true);
  });

  it("HIRING_KEY + NAF non-tech + titre tech (QA Engineer) → true", () => {
    expect(isTechHiringTrigger("HIRING_KEY", "70.10Z", "QA Engineer h/f")).toBe(true);
  });

  it("HIRING_KEY + NAF non-tech + titre non-tech → false", () => {
    expect(isTechHiringTrigger("HIRING_KEY", "70.10Z", "Commercial B2B")).toBe(false);
  });

  it("FUNDING type → false (pas HIRING)", () => {
    expect(isTechHiringTrigger("FUNDING", "62.02A", "QA Engineer")).toBe(false);
  });
});
