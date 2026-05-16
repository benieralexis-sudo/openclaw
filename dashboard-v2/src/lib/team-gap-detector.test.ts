import { describe, expect, it } from "vitest";
import { analyzeTeamGap, type EmployeeProfile } from "./team-gap-detector";

function emp(title: string, name = "X"): EmployeeProfile {
  return { title, name };
}

describe("analyzeTeamGap", () => {
  describe("config invalide", () => {
    it("no-missing-roles si roles vide ou absent", () => {
      expect(analyzeTeamGap([emp("CTO")], []).reason).toBe("no-missing-roles-configured");
      expect(analyzeTeamGap([emp("CTO")], null).reason).toBe("no-missing-roles-configured");
      expect(analyzeTeamGap([emp("CTO")], undefined).reason).toBe("no-missing-roles-configured");
    });

    it("filtre les roles trop courts", () => {
      expect(analyzeTeamGap([emp("CTO")], ["a", "b"]).reason).toBe("no-missing-roles-configured");
    });

    it("no-employees-array si employees null/undefined", () => {
      expect(analyzeTeamGap(null, ["QA"]).reason).toBe("no-employees-array");
      expect(analyzeTeamGap(undefined, ["QA"]).reason).toBe("no-employees-array");
    });
  });

  describe("seuil minTeamSize", () => {
    it("team-too-small si < 10 par défaut", () => {
      const out = analyzeTeamGap(
        [emp("CTO"), emp("Dev"), emp("PM")],
        ["QA Engineer"],
      );
      expect(out.hasGap).toBe(false);
      expect(out.reason).toContain("team-too-small");
      expect(out.totalEmployees).toBe(3);
    });

    it("respecte minTeamSize custom", () => {
      const employees = Array.from({ length: 5 }, (_, i) => emp(`Dev ${i}`));
      const out = analyzeTeamGap(employees, ["QA Engineer"], { minTeamSize: 3 });
      expect(out.hasGap).toBe(true); // 5 >= 3 et 0 QA
      expect(out.totalEmployees).toBe(5);
    });

    it("exactement 10 employés passe le seuil default", () => {
      const employees = Array.from({ length: 10 }, (_, i) => emp(`Dev ${i}`));
      const out = analyzeTeamGap(employees, ["QA Engineer"]);
      expect(out.hasGap).toBe(true);
    });
  });

  describe("détection du gap", () => {
    it("hasGap=true si 0 personne avec le titre cible", () => {
      const employees = [
        ...Array.from({ length: 15 }, (_, i) => emp(`Dev ${i}`)),
        emp("CTO"),
        emp("PM"),
      ];
      const out = analyzeTeamGap(employees, ["QA Engineer", "Test Engineer"]);
      expect(out.hasGap).toBe(true);
      expect(out.matchingCount).toBe(0);
      expect(out.matchedExamples).toEqual([]);
    });

    it("hasGap=false si rôle présent (au moins 1)", () => {
      const employees = [
        ...Array.from({ length: 14 }, (_, i) => emp(`Dev ${i}`)),
        emp("QA Engineer", "Marie Dupont"),
      ];
      const out = analyzeTeamGap(employees, ["QA Engineer"]);
      expect(out.hasGap).toBe(false);
      expect(out.matchingCount).toBe(1);
      expect(out.matchedExamples).toEqual(["Marie Dupont (QA Engineer)"]);
      expect(out.reason).toBe("role-present");
    });

    it("compte plusieurs matches", () => {
      const employees = [
        ...Array.from({ length: 12 }, (_, i) => emp(`Dev ${i}`)),
        emp("QA Engineer", "Alice"),
        emp("Senior QA Engineer", "Bob"),
        emp("Test Engineer", "Carol"),
      ];
      const out = analyzeTeamGap(employees, ["QA Engineer", "Test Engineer"]);
      expect(out.hasGap).toBe(false);
      expect(out.matchingCount).toBe(3);
      expect(out.matchedExamples).toHaveLength(3);
    });

    it("matchedExamples cap à 5", () => {
      const employees = [
        ...Array.from({ length: 12 }, (_, i) => emp(`Dev ${i}`)),
        ...Array.from({ length: 8 }, (_, i) => emp("QA Engineer", `QA-${i}`)),
      ];
      const out = analyzeTeamGap(employees, ["QA Engineer"]);
      expect(out.matchingCount).toBe(8);
      expect(out.matchedExamples).toHaveLength(5);
    });
  });

  describe("matching case-insensitive et word boundary", () => {
    it("match case-insensitive", () => {
      const employees = [
        ...Array.from({ length: 12 }, (_, i) => emp(`Dev ${i}`)),
        emp("qa engineer", "Marie"),
      ];
      const out = analyzeTeamGap(employees, ["QA Engineer"]);
      expect(out.matchingCount).toBe(1);
    });

    it("ne match pas en sous-chaîne (word boundary)", () => {
      // "Quality Assurance" ne contient pas "QA" comme mot entier
      const employees = [
        ...Array.from({ length: 12 }, (_, i) => emp(`Dev ${i}`)),
        emp("Quality Assurance Manager", "X"),
      ];
      const out = analyzeTeamGap(employees, ["QA"]);
      expect(out.matchingCount).toBe(0);
      expect(out.hasGap).toBe(true);
    });

    it("match dans un titre composé", () => {
      const employees = [
        ...Array.from({ length: 12 }, (_, i) => emp(`Dev ${i}`)),
        emp("Lead Software Development Engineer in Test", "Y"),
      ];
      const out = analyzeTeamGap(employees, ["SDET"]);
      // "SDET" n'est pas dans le titre verbatim → pas de match
      expect(out.matchingCount).toBe(0);
    });
  });

  describe("escape regex specials", () => {
    it("ne plante pas avec roles contenant des caractères regex", () => {
      const employees = [emp("C++ Engineer"), ...Array.from({ length: 10 }, () => emp("Dev"))];
      const out = analyzeTeamGap(employees, ["C++ Engineer"]);
      expect(out.matchingCount).toBe(1);
    });
  });

  describe("ignore titles null/undefined", () => {
    it("skip les employees sans title", () => {
      const employees = [
        ...Array.from({ length: 12 }, (_, i) => emp(`Dev ${i}`)),
        { title: null, name: "Sans titre" },
        { title: undefined, name: "Aussi" },
        emp("QA Engineer", "Alice"),
      ];
      const out = analyzeTeamGap(employees, ["QA Engineer"]);
      // totalEmployees compte TOUS les profils (y compris sans title) — c'est la
      // taille de la boite, pas le nb de titles parseables
      expect(out.totalEmployees).toBe(15);
      expect(out.matchingCount).toBe(1);
    });
  });

  describe("scénario réel DTL", () => {
    it("détecte gap QA pour boite tech 25p sans QA", () => {
      const employees = [
        emp("CEO", "Fred Martin"),
        emp("CTO", "Paul Durand"),
        emp("Senior Backend Engineer", "Alice"),
        emp("Senior Frontend Engineer", "Bob"),
        emp("Full-stack Developer", "Carol"),
        emp("Junior Developer", "Dave"),
        emp("DevOps Engineer", "Eve"),
        emp("Product Manager", "Frank"),
        emp("UX Designer", "Grace"),
        emp("Sales Manager", "Henri"),
        emp("Account Executive", "Ivy"),
        emp("Customer Success", "Jack"),
        emp("Marketing Manager", "Kim"),
        emp("Office Manager", "Léa"),
        emp("Talent Acquisition", "Marc"),
        ...Array.from({ length: 10 }, (_, i) => emp(`Engineer ${i}`)),
      ];
      const out = analyzeTeamGap(employees, [
        "QA Engineer",
        "Test Engineer",
        "Quality Engineer",
        "SDET",
      ]);
      expect(out.hasGap).toBe(true);
      expect(out.totalEmployees).toBe(25);
      expect(out.matchingCount).toBe(0);
    });
  });
});
