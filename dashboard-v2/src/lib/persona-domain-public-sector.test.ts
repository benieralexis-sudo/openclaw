import { describe, it, expect } from "vitest";
import {
  inferPersonaDomain,
  isPublicSectorPersonaTitle,
  isPublicSectorHiringTrigger,
  isAcceptedPersonaTitle,
  isHiringTriggerForDomain,
} from "./tech-persona-guard";
import { inferSignalType } from "./harvestapi-signal-rules";

describe("Phase B — public-sector persona domain (Digidemat)", () => {
  describe("inferPersonaDomain", () => {
    it("retourne 'public-sector' si l'ICP contient un titre 100% public (Acheteur Public)", () => {
      const icp = { personas: [{ title: "DSI" }, { title: "Acheteur Public" }] };
      expect(inferPersonaDomain(icp)).toBe("public-sector");
    });

    it("retourne 'public-sector' si l'ICP contient 'Directeur des Marchés Publics'", () => {
      const icp = { personas: [{ title: "Directeur des Marchés Publics" }] };
      expect(inferPersonaDomain(icp)).toBe("public-sector");
    });

    it("retourne 'public-sector' si l'ICP a ≥3 NAF secteur public (84/85/86)", () => {
      const icp = {
        personas: [{ title: "Responsable Informatique" }],
        naf_codes: ["84.11Z", "85.59A", "86.10Z", "62.02A"],
      };
      expect(inferPersonaDomain(icp)).toBe("public-sector");
    });

    it("ICP réelle Digidemat (DSI + DPO + Acheteur Public + 29 NAF 84-94)", () => {
      const icp = {
        personas: [
          { title: "DSI" },
          { title: "Directeur des Systèmes d'Information" },
          { title: "DPO" },
          { title: "Acheteur Public" },
          { title: "Directeur Général des Services" },
        ],
        naf_codes: ["84.11Z", "84.30A", "85.59A", "86.10Z"],
      };
      expect(inferPersonaDomain(icp)).toBe("public-sector");
    });

    it("ICP DTL (tech privé) reste 'tech'", () => {
      const icp = {
        personas: [
          { title: "CTO" },
          { title: "Head of Engineering" },
          { title: "QA Manager" },
        ],
      };
      expect(inferPersonaDomain(icp)).toBe("tech");
    });

    it("ICP iFIND (sales) reste 'sales'", () => {
      const icp = {
        personas: [
          { title: "Founder" },
          { title: "Head of Sales" },
          { title: "CRO" },
        ],
      };
      expect(inferPersonaDomain(icp)).toBe("sales");
    });

    it("ICP avec juste 'DSI' sans titre 100% public → 'tech' (pas Digidemat)", () => {
      // DSI seul ne suffit pas — c'est aussi un titre tech privé. Il faut un
      // marqueur 100% public (Acheteur Public, Marchés Publics, DGS, etc.)
      // ou ≥3 NAF publics.
      const icp = { personas: [{ title: "DSI" }, { title: "CTO" }] };
      expect(inferPersonaDomain(icp)).toBe("tech");
    });
  });

  describe("isPublicSectorPersonaTitle", () => {
    it.each([
      ["DSI", true],
      ["Directeur des Systèmes d'Information", true],
      ["Directeur du Numérique", true],
      ["DPO", true],
      ["Délégué à la Protection des Données", true],
      ["RSSI", true],
      ["Directeur des Marchés Publics", true],
      ["Responsable des Marchés Publics", true],
      ["Acheteur Public", true],
      ["DGS", true],
      ["Directeur Général des Services", true],
      ["Secrétaire Général", true],
      ["DAF", true],
      ["MEHADDI Belkacem", true], // titre exotique fonction publique → accepté par défaut
      ["Stagiaire", false],
      ["Agent de sécurité", false],
      ["Gardien", false],
    ])("isPublicSectorPersonaTitle(%s) === %s", (title, expected) => {
      expect(isPublicSectorPersonaTitle(title)).toBe(expected);
    });
  });

  describe("isPublicSectorHiringTrigger", () => {
    it("vrai pour NAF 84 (admin publique)", () => {
      expect(isPublicSectorHiringTrigger("OTHER", "84.11Z", "Appel d'offres GED")).toBe(true);
    });

    it("vrai pour NAF 85 (éducation)", () => {
      expect(isPublicSectorHiringTrigger("OTHER", "85.59A", "Marché formation")).toBe(true);
    });

    it("vrai pour NAF 86 (santé)", () => {
      expect(isPublicSectorHiringTrigger("OTHER", "86.10Z", "Dématérialisation hôpital")).toBe(true);
    });

    it("vrai si titre BOAMP même sans NAF public", () => {
      expect(isPublicSectorHiringTrigger("OTHER", "62.02A", "appel d'offres signature électronique")).toBe(true);
    });

    it("faux pour NAF tech privé sans mot-clé tender", () => {
      expect(isPublicSectorHiringTrigger("HIRING_KEY", "62.02A", "QA Engineer")).toBe(false);
    });
  });

  describe("inferSignalType — public-tender", () => {
    it("BOAMP tender → public-tender", () => {
      expect(inferSignalType("boamp.tender", "Logiciel GED", "public-sector")).toBe("public-tender");
    });

    it("TED-Europa tender → public-tender", () => {
      expect(inferSignalType("ted-europa.tender", "Marché signature électronique", "public-sector")).toBe("public-tender");
    });

    it("BOAMP tender → public-tender même si personaDomain=tech (forcé par sourceCode)", () => {
      expect(inferSignalType("boamp.tender", "Logiciel GED", "tech")).toBe("public-tender");
    });

    it("personaDomain=public-sector force public-tender même sur source autre", () => {
      expect(inferSignalType("rss-medias.signature", "Étude RGPD", "public-sector")).toBe("public-tender");
    });

    it("apify.linkedin-jobs sans persona-public → reste qa-hire/tech-hire", () => {
      expect(inferSignalType("apify.linkedin-jobs", "QA Manager", "tech")).toBe("qa-hire");
    });
  });

  describe("isAcceptedPersonaTitle — wrapper public-sector", () => {
    it("DSI accepté en public-sector", () => {
      expect(isAcceptedPersonaTitle("DSI", "public-sector")).toBe(true);
    });
    it("CTO accepté en tech, accepté en public-sector aussi (titre exotique pour public, accepté par défaut)", () => {
      expect(isAcceptedPersonaTitle("CTO", "tech")).toBe(true);
      // Note: CTO en public-sector retourne true par défaut (titre exotique non-blacklisté)
      expect(isAcceptedPersonaTitle("CTO", "public-sector")).toBe(true);
    });
    it("Stagiaire rejeté en public-sector", () => {
      expect(isAcceptedPersonaTitle("Stagiaire", "public-sector")).toBe(false);
    });
  });

  describe("isHiringTriggerForDomain — wrapper public-sector", () => {
    it("BOAMP secteur public → vrai", () => {
      expect(isHiringTriggerForDomain("OTHER", "84.30A", "Appel d'offres signature", "public-sector")).toBe(true);
    });
    it("HIRING_KEY tech privé NAF 62 → faux en public-sector", () => {
      expect(isHiringTriggerForDomain("HIRING_KEY", "62.02A", "QA Engineer", "public-sector")).toBe(false);
    });
  });
});
