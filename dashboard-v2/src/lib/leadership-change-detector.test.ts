import { describe, expect, it } from "vitest";
import { detectRecentLeadership, type PappersRepresentant } from "./leadership-change-detector";

const NOW = new Date("2026-05-16T00:00:00Z");

function makeRep(overrides: Partial<PappersRepresentant>): PappersRepresentant {
  return {
    nom_complet: "Jean Dupont",
    qualite: "Président",
    date_prise_de_poste: "2026-04-15", // 31j avant NOW
    ...overrides,
  };
}

describe("detectRecentLeadership", () => {
  describe("input vide ou invalide", () => {
    it("retourne [] pour null/undefined", () => {
      expect(detectRecentLeadership(null)).toEqual([]);
      expect(detectRecentLeadership(undefined)).toEqual([]);
    });

    it("retourne [] pour tableau vide", () => {
      expect(detectRecentLeadership([])).toEqual([]);
    });

    it("ignore les entrées malformées", () => {
      const out = detectRecentLeadership(
        [null as any, undefined as any, {} as PappersRepresentant],
        { now: NOW },
      );
      expect(out).toEqual([]);
    });
  });

  describe("filtres personnes morales et titres non-décisionnaires", () => {
    it("ignore les personnes morales (type=morale)", () => {
      const out = detectRecentLeadership(
        [makeRep({ type: "Personne morale", qualite: "Président" })],
        { now: NOW },
      );
      expect(out).toEqual([]);
    });

    it("ignore les commissaires aux comptes", () => {
      const out = detectRecentLeadership(
        [makeRep({ qualite: "Commissaire aux comptes titulaire" })],
        { now: NOW },
      );
      expect(out).toEqual([]);
    });

    it("ignore les administrateurs et suppléants", () => {
      const out = detectRecentLeadership(
        [
          makeRep({ qualite: "Administrateur" }),
          makeRep({ qualite: "Suppléant" }),
          makeRep({ qualite: "Membre du conseil de surveillance" }),
        ],
        { now: NOW },
      );
      expect(out).toEqual([]);
    });

    it("ignore les titres non-listés (ex: Salarié, Représentant)", () => {
      const out = detectRecentLeadership(
        [makeRep({ qualite: "Salarié" }), makeRep({ qualite: "Représentant" })],
        { now: NOW },
      );
      expect(out).toEqual([]);
    });
  });

  describe("filtres date_prise_de_poste", () => {
    it("ignore sans date_prise_de_poste", () => {
      const out = detectRecentLeadership(
        [makeRep({ date_prise_de_poste: undefined })],
        { now: NOW },
      );
      expect(out).toEqual([]);
    });

    it("ignore les dates futures", () => {
      const out = detectRecentLeadership(
        [makeRep({ date_prise_de_poste: "2027-01-01" })],
        { now: NOW },
      );
      expect(out).toEqual([]);
    });

    it("accepte les dates dans la fenêtre 90j par défaut", () => {
      const out = detectRecentLeadership(
        [makeRep({ date_prise_de_poste: "2026-04-15" })], // 31j
        { now: NOW },
      );
      expect(out).toHaveLength(1);
      expect(out[0]!.daysAgo).toBe(31);
    });

    it("rejette les dates au-delà de windowDays", () => {
      const out = detectRecentLeadership(
        [makeRep({ date_prise_de_poste: "2026-01-15" })], // 121j
        { now: NOW, windowDays: 90 },
      );
      expect(out).toEqual([]);
    });

    it("respecte un windowDays custom", () => {
      const out = detectRecentLeadership(
        [makeRep({ date_prise_de_poste: "2026-04-15" })], // 31j
        { now: NOW, windowDays: 30 },
      );
      expect(out).toEqual([]); // 31j > 30j
    });

    it("parse aussi format DD-MM-YYYY", () => {
      const out = detectRecentLeadership(
        [makeRep({ date_prise_de_poste: "15-04-2026" })], // 31j
        { now: NOW },
      );
      expect(out).toHaveLength(1);
      expect(out[0]!.daysAgo).toBe(31);
    });
  });

  describe("titres cibles détectés", () => {
    it.each([
      ["CTO", "CTO", 10],
      ["Chief Technology Officer", "CTO", 10],
      ["Directeur technique", "CTO", 10],
      ["VP Engineering", "VP / Head of Engineering", 9],
      ["Head of Engineering", "VP / Head of Engineering", 9],
      ["CEO", "CEO", 9],
      ["Chief Executive Officer", "CEO", 9],
      ["CRO", "CRO", 9],
      ["Chief Revenue Officer", "CRO", 9],
      ["VP Sales", "VP / Head of Sales", 9],
      ["Head of Sales", "VP / Head of Sales", 9],
      ["Directeur commercial", "VP / Head of Sales", 9],
      ["CMO", "CMO / Head of Marketing", 8],
      ["Head of Marketing", "CMO / Head of Marketing", 8],
      ["CFO", "CFO", 8],
      ["Directeur financier", "CFO", 8],
      ["COO", "COO", 8],
      ["Directeur des opérations", "COO", 8],
      ["CPO", "CPO / Head of Product", 8],
      ["Head of Product", "CPO / Head of Product", 8],
      ["Président", "Président / Fondateur", 7],
      ["Fondateur", "Président / Fondateur", 7],
      ["Founder", "Président / Fondateur", 7],
      ["DG", "Directeur Général / Gérant", 6],
      ["Directeur général", "Directeur Général / Gérant", 6],
      ["Gérant", "Directeur Général / Gérant", 6],
    ])("titre %s → label %s weight %s", (qualite, expectedLabel, expectedWeight) => {
      const out = detectRecentLeadership(
        [makeRep({ qualite, date_prise_de_poste: "2026-04-15" })],
        { now: NOW },
      );
      expect(out).toHaveLength(1);
      expect(out[0]!.label).toBe(expectedLabel);
      expect(out[0]!.weight).toBe(expectedWeight);
    });
  });

  describe("tri résultats", () => {
    it("trie par weight desc puis daysAgo asc", () => {
      const out = detectRecentLeadership(
        [
          makeRep({ nom_complet: "DG", qualite: "Directeur général", date_prise_de_poste: "2026-04-01" }), // weight 6, 45j
          makeRep({ nom_complet: "CTO", qualite: "CTO", date_prise_de_poste: "2026-03-01" }), // weight 10, 76j
          makeRep({ nom_complet: "CEO", qualite: "CEO", date_prise_de_poste: "2026-05-01" }), // weight 9, 15j
        ],
        { now: NOW },
      );
      expect(out.map((r) => r.nom_complet)).toEqual(["CTO", "CEO", "DG"]);
    });

    it("tri secondaire daysAgo asc pour même weight", () => {
      const out = detectRecentLeadership(
        [
          makeRep({ nom_complet: "Old CEO", qualite: "CEO", date_prise_de_poste: "2026-02-01" }), // weight 9, 104j → REJETÉ
          makeRep({ nom_complet: "Recent CEO", qualite: "CEO", date_prise_de_poste: "2026-05-01" }), // weight 9, 15j
          makeRep({ nom_complet: "Mid CEO", qualite: "Chief Executive Officer", date_prise_de_poste: "2026-04-15" }), // weight 9, 31j
        ],
        { now: NOW },
      );
      expect(out.map((r) => r.nom_complet)).toEqual(["Recent CEO", "Mid CEO"]);
    });
  });

  describe("scénario réel", () => {
    it("filtre + tri correctement un mix de représentants Pappers", () => {
      const reps: PappersRepresentant[] = [
        // bruit
        { nom_complet: "PWC Audit", qualite: "Commissaire aux comptes", type: "morale", date_prise_de_poste: "2026-05-01" },
        { nom_complet: "Marc Old", qualite: "Président", date_prise_de_poste: "2024-01-15" }, // trop vieux
        { nom_complet: "Alice Stagiaire", qualite: "Salariée", date_prise_de_poste: "2026-05-01" }, // non-leadership
        // matches
        { nom_complet: "Bob Tech", qualite: "CTO", date_prise_de_poste: "2026-04-01" }, // weight 10, 45j
        { nom_complet: "Carol Sales", qualite: "VP Sales", date_prise_de_poste: "2026-05-01" }, // weight 9, 15j
        { nom_complet: "Dan CEO", qualite: "Chief Executive Officer", date_prise_de_poste: "2026-04-15" }, // weight 9, 31j
      ];
      const out = detectRecentLeadership(reps, { now: NOW });
      expect(out).toHaveLength(3);
      expect(out.map((r) => r.nom_complet)).toEqual(["Bob Tech", "Carol Sales", "Dan CEO"]);
    });
  });
});
