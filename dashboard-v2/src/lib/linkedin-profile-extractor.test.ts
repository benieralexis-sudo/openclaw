import { describe, it, expect } from "vitest";
import {
  extractLinkedInProfile,
  parseMonthTextToNumber,
  parseDateInput,
  monthsBetween,
  isCurrentExperience,
  detectBackgrounds,
} from "./linkedin-profile-extractor";

describe("parseMonthTextToNumber", () => {
  it("convertit Jan/Feb/Mar/etc. en numéro", () => {
    expect(parseMonthTextToNumber("Jan")).toBe(1);
    expect(parseMonthTextToNumber("Feb")).toBe(2);
    expect(parseMonthTextToNumber("Mar")).toBe(3);
    expect(parseMonthTextToNumber("Dec")).toBe(12);
  });

  it("supporte le français (janv, févr, mars, avril...)", () => {
    expect(parseMonthTextToNumber("janv")).toBe(1);
    expect(parseMonthTextToNumber("février")).toBe(2);
    expect(parseMonthTextToNumber("mars")).toBe(3);
    expect(parseMonthTextToNumber("avril")).toBe(4);
    expect(parseMonthTextToNumber("décembre")).toBe(12);
  });

  it("case insensitive et tolère le point final", () => {
    expect(parseMonthTextToNumber("JAN")).toBe(1);
    expect(parseMonthTextToNumber("Sep.")).toBe(9);
  });

  it("renvoie le numéro tel quel si déjà un nombre", () => {
    expect(parseMonthTextToNumber(5)).toBe(5);
    expect(parseMonthTextToNumber(12)).toBe(12);
  });

  it("renvoie null pour input inconnu / vide", () => {
    expect(parseMonthTextToNumber(null)).toBe(null);
    expect(parseMonthTextToNumber(undefined)).toBe(null);
    expect(parseMonthTextToNumber("xyz")).toBe(null);
    expect(parseMonthTextToNumber(13)).toBe(null);
  });
});

describe("parseDateInput", () => {
  it("parse le shape HarvestAPI {year, month: 'Jan'}", () => {
    expect(parseDateInput({ year: 2022, month: "Jan" })).toEqual({ year: 2022, month: 1 });
  });

  it("parse le shape {year} sans month → mois 1", () => {
    expect(parseDateInput({ year: 2020 })).toEqual({ year: 2020, month: 1 });
  });

  it("parse format string YYYY-MM (legacy)", () => {
    expect(parseDateInput("2023-04")).toEqual({ year: 2023, month: 4 });
  });

  it("parse format string YYYY-MM-DD", () => {
    expect(parseDateInput("2022-09-15")).toEqual({ year: 2022, month: 9 });
  });

  it("parse format YYYY seul", () => {
    expect(parseDateInput("2020")).toEqual({ year: 2020, month: 1 });
  });

  it("retourne null pour {text: 'Present'} (pas une date résolvable)", () => {
    expect(parseDateInput({ text: "Present" })).toBe(null);
  });

  it("retourne null pour input vide / null", () => {
    expect(parseDateInput(null)).toBe(null);
    expect(parseDateInput(undefined)).toBe(null);
    expect(parseDateInput("")).toBe(null);
  });
});

describe("monthsBetween", () => {
  it("calcule 12 mois entre 2023-01 et 2024-01", () => {
    expect(monthsBetween({ year: 2023, month: 1 }, { year: 2024, month: 1 })).toBe(12);
  });
  it("calcule 6 mois entre 2024-01 et 2024-07", () => {
    expect(monthsBetween({ year: 2024, month: 1 }, { year: 2024, month: 7 })).toBe(6);
  });
  it("retourne 0 si dates identiques", () => {
    expect(monthsBetween({ year: 2024, month: 5 }, { year: 2024, month: 5 })).toBe(0);
  });
  it("calcule sur plusieurs années", () => {
    expect(monthsBetween({ year: 2020, month: 3 }, { year: 2024, month: 3 })).toBe(48);
  });
  it("ignore l'ordre (toujours positif)", () => {
    expect(monthsBetween({ year: 2024, month: 1 }, { year: 2023, month: 1 })).toBe(12);
  });
});

describe("isCurrentExperience", () => {
  it("true si endDate.text contient 'Present'", () => {
    expect(isCurrentExperience({ text: "Present" })).toBe(true);
  });
  it("true si endDate string contient 'present' (case insensitive)", () => {
    expect(isCurrentExperience("Present")).toBe(true);
  });
  it("true si endDate null/undefined (pas de fin renseignée = encore en poste)", () => {
    expect(isCurrentExperience(null)).toBe(true);
    expect(isCurrentExperience(undefined)).toBe(true);
  });
  it("true si current=true explicite (legacy)", () => {
    expect(isCurrentExperience({ year: 2020 }, true)).toBe(true);
  });
  it("false si endDate a un year précis", () => {
    expect(isCurrentExperience({ year: 2020, month: "Dec" })).toBe(false);
  });
});

describe("detectBackgrounds", () => {
  it("détecte ESN", () => {
    const r = detectBackgrounds(["Capgemini", "Sopra Steria"]);
    expect(r.hasESNBackground).toBe(true);
  });
  it("détecte SaaS", () => {
    const r = detectBackgrounds(["Hubspot SaaS"]);
    expect(r.hasSaaSBackground).toBe(true);
  });
  it("détecte Asys Groupe comme SaaS+ESN", () => {
    const r = detectBackgrounds(["Asys Groupe"]);
    expect(r.hasSaaSBackground).toBe(true);
    expect(r.hasESNBackground).toBe(true);
  });
  it("liste vide → tout false", () => {
    const r = detectBackgrounds([]);
    expect(r.hasESNBackground).toBe(false);
    expect(r.hasSaaSBackground).toBe(false);
    expect(r.hasStartupBackground).toBe(false);
  });
});

describe("extractLinkedInProfile — schéma HarvestAPI réel", () => {
  it("extrait headline + about depuis le profil HarvestAPI", () => {
    const r = extractLinkedInProfile({
      headline: "CTO at Asys Groupe",
      about: "Open Source Developer & Robotic Developer Enthusiast",
    });
    expect(r.headline).toBe("CTO at Asys Groupe");
    expect(r.summary).toContain("Open Source");
  });

  it("extrait currentPosition (singleton array) du vrai schéma HarvestAPI", () => {
    const r = extractLinkedInProfile({
      currentPosition: [
        {
          position: "Chief Technology Officer",
          companyName: "Asys Groupe",
          startDate: { year: 2022, month: "Jan" },
          endDate: { text: "Present" },
          duration: "4 yrs 5 mos",
          description: "Managing 50 people",
        },
      ],
    });
    expect(r.experiences).toHaveLength(1);
    expect(r.experiences[0]?.title).toBe("Chief Technology Officer");
    expect(r.experiences[0]?.companyName).toBe("Asys Groupe");
    expect(r.experiences[0]?.isCurrent).toBe(true);
    expect(r.experiences[0]?.startYear).toBe(2022);
    expect(r.experiences[0]?.startMonth).toBe(1);
    expect(r.experiences[0]?.durationMonths).toBeGreaterThan(40);
  });

  it("dédupe currentPosition + experience qui contiennent la même ligne", () => {
    const sharedExp = {
      position: "CTO",
      companyName: "Asys",
      startDate: { year: 2022, month: "Jan" },
      endDate: { text: "Present" },
    };
    const r = extractLinkedInProfile({
      currentPosition: [sharedExp],
      experience: [sharedExp, { position: "Lead Dev", companyName: "Capgemini", startDate: { year: 2015, month: "Jun" }, endDate: { year: 2022, month: "Jan" } }],
    });
    expect(r.experiences).toHaveLength(2); // dédupé pour CTO Asys
  });

  it("calcule currentTenureMonths depuis l'expérience marquée current", () => {
    const r = extractLinkedInProfile({
      experience: [
        {
          position: "CTO",
          companyName: "Asys",
          startDate: { year: 2024, month: "Jan" },
          endDate: { text: "Present" },
        },
      ],
    });
    expect(r.currentTenureMonths).toBeGreaterThanOrEqual(12);
  });

  it("totalExperienceYears agrège", () => {
    const r = extractLinkedInProfile({
      experience: [
        { position: "CTO", companyName: "Asys", startDate: { year: 2020, month: "Jan" }, endDate: { text: "Present" } },
        { position: "Lead", companyName: "Capgemini", startDate: { year: 2010, month: "Jan" }, endDate: { year: 2020, month: "Jan" } },
      ],
    });
    expect(r.totalExperienceYears).toBeGreaterThanOrEqual(14);
  });

  it("détecte hasESNBackground si Capgemini dans le parcours", () => {
    const r = extractLinkedInProfile({
      experience: [
        { position: "CTO", companyName: "Asys" },
        { position: "Lead", companyName: "Capgemini" },
      ],
    });
    expect(r.hasESNBackground).toBe(true);
  });

  it("détecte hasSaaSBackground si Asys Groupe", () => {
    const r = extractLinkedInProfile({
      experience: [{ position: "CTO", companyName: "Asys Groupe" }],
    });
    expect(r.hasSaaSBackground).toBe(true);
  });

  it("ignore les experiences sans position ou companyName", () => {
    const r = extractLinkedInProfile({
      experience: [
        { position: "CTO", companyName: "Asys" },
        { position: null, companyName: null },
        { position: "Lead", companyName: "" },
      ],
    });
    expect(r.experiences).toHaveLength(1);
  });

  it("tolère le format legacy {title, startDate string}", () => {
    const r = extractLinkedInProfile({
      experiences: [
        { title: "CTO", companyName: "Asys", startDate: "2023-01", endDate: null, current: true },
      ],
    });
    expect(r.experiences).toHaveLength(1);
    expect(r.experiences[0]?.title).toBe("CTO");
    expect(r.experiences[0]?.isCurrent).toBe(true);
  });

  it("retourne profil vide si payload null", () => {
    const r = extractLinkedInProfile(null);
    expect(r.experiences).toEqual([]);
    expect(r.headline).toBe(null);
    expect(r.currentTenureMonths).toBe(null);
  });

  it("supporte le shape complet d'un profil HarvestAPI réel (Stéphane Vanacker)", () => {
    const r = extractLinkedInProfile({
      headline: "CTO at Asys Groupe",
      about: "Open Source Developer & Robotic Developer Enthusiast",
      currentPosition: [
        {
          position: "Chief Technology Officer",
          companyName: "Asys Groupe",
          startDate: { year: 2022, month: "Jan", text: "Jan 2022" },
          endDate: { text: "Present" },
          duration: "4 yrs 5 mos",
          description: "Managing a team of 50 people, COMEX member",
        },
      ],
      experience: [
        {
          position: "Chief Technology Officer",
          companyName: "Asys Groupe",
          startDate: { year: 2022, month: "Jan" },
          endDate: { text: "Present" },
        },
        {
          position: "Senior Java Developer",
          companyName: "Capgemini",
          startDate: { year: 2015, month: "Jun" },
          endDate: { year: 2022, month: "Jan" },
        },
      ],
    });
    expect(r.headline).toContain("CTO");
    expect(r.summary).toContain("Open Source");
    expect(r.experiences).toHaveLength(2);
    expect(r.currentTenureMonths).toBeGreaterThan(40);
    expect(r.hasESNBackground).toBe(true);
    expect(r.hasSaaSBackground).toBe(true);
    expect(r.totalExperienceYears).toBeGreaterThanOrEqual(10);
  });
});
