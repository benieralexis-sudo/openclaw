import { describe, expect, it } from "vitest";
import {
  deriveFirstName,
  detectOpenerPersonaDesync,
  substituteOpenerPlaceholders,
} from "./opener-substitution";

describe("substituteOpenerPlaceholders (Fix B3)", () => {
  it("returns input unchanged when no placeholder is present", () => {
    const input = "Bonjour Eric,\n\nFélicitations pour la levée.";
    expect(substituteOpenerPlaceholders(input, "Eric")).toBe(input);
  });

  it("substitues [Prénom] with provided firstName", () => {
    const input = "Bonjour [Prénom],\n\nJe vois que ViaXoft recrute.";
    expect(substituteOpenerPlaceholders(input, "Eric")).toBe(
      "Bonjour Eric,\n\nJe vois que ViaXoft recrute.",
    );
  });

  it("falls back to '(prénom à vérifier)' when firstName is missing", () => {
    const input = "Bonjour [Prénom],\n\nMessage.";
    expect(substituteOpenerPlaceholders(input, null)).toBe(
      "Bonjour (prénom à vérifier),\n\nMessage.",
    );
    expect(substituteOpenerPlaceholders(input, "")).toBe(
      "Bonjour (prénom à vérifier),\n\nMessage.",
    );
    expect(substituteOpenerPlaceholders(input, "  ")).toBe(
      "Bonjour (prénom à vérifier),\n\nMessage.",
    );
  });

  it("falls back when firstName is too short (1 char)", () => {
    // Initiale unique = signal de mauvaise donnée, on préfère le fallback
    expect(substituteOpenerPlaceholders("Bonjour [Prénom],", "E")).toBe(
      "Bonjour (prénom à vérifier),",
    );
  });

  it("substitutes multiple occurrences (Prénom + Nom)", () => {
    expect(
      substituteOpenerPlaceholders("Salut [Prénom] [Nom],", "Eric"),
    ).toBe("Salut Eric Eric,");
  });

  it("handles null/empty opener gracefully", () => {
    expect(substituteOpenerPlaceholders(null, "Eric")).toBe("");
    expect(substituteOpenerPlaceholders(undefined, "Eric")).toBe("");
    expect(substituteOpenerPlaceholders("", "Eric")).toBe("");
  });

  it("trims whitespace around firstName", () => {
    expect(
      substituteOpenerPlaceholders("Bonjour [Prénom],", "  Eric  "),
    ).toBe("Bonjour Eric,");
  });
});

describe("deriveFirstName", () => {
  it("returns firstName when explicitly provided", () => {
    expect(deriveFirstName({ firstName: "Eric", fullName: "Eric Barthélémy" }))
      .toBe("Eric");
  });

  it("derives from fullName first word when firstName is missing", () => {
    expect(deriveFirstName({ firstName: null, fullName: "Eric Barthélémy" }))
      .toBe("Eric");
    expect(deriveFirstName({ fullName: "Marie-Claire Dupont" }))
      .toBe("Marie-Claire");
  });

  it("returns null when both fields are missing or empty", () => {
    expect(deriveFirstName(null)).toBe(null);
    expect(deriveFirstName(undefined)).toBe(null);
    expect(deriveFirstName({})).toBe(null);
    expect(deriveFirstName({ firstName: "", fullName: "" })).toBe(null);
  });

  it("rejects too-short first words (initials)", () => {
    expect(deriveFirstName({ fullName: "E Barthélémy" })).toBe(null);
  });

  it("trims whitespace", () => {
    expect(deriveFirstName({ firstName: "  Eric  " })).toBe("Eric");
  });
});

describe("detectOpenerPersonaDesync (Fix B1)", () => {
  it("detects desync : opener=Thierry vs Lead Adrien SICOLI (cas DiXiO)", () => {
    const r = detectOpenerPersonaDesync(
      "Bonjour Thierry,\n\nVu votre annonce Dev/Lead QA chez DiXiO.",
      { firstName: "Adrien", lastName: "SICOLI", fullName: "Adrien SICOLI" },
    );
    expect(r.isDesync).toBe(true);
    expect(r.briefName).toBe("Thierry");
  });

  it("detects desync : opener=Jean-Luc vs Lead Thomas Lazare (DimoMaint)", () => {
    const r = detectOpenerPersonaDesync(
      "Bonjour Jean-Luc,\n\nVu l'acquisition de Camileia.",
      { firstName: "Thomas Lazare", fullName: "Thomas Lazare Bourgeois" },
    );
    expect(r.isDesync).toBe(true);
    expect(r.briefName).toBe("Jean-Luc");
  });

  it("detects desync : opener=Laetitia vs Lead Humery (Training Orchestra)", () => {
    const r = detectOpenerPersonaDesync(
      "Bonjour Laetitia,\n\nJ'ai noté l'ouverture du poste QA.",
      { firstName: "Humery", lastName: "Valerie", fullName: "Humery Valerie" },
    );
    expect(r.isDesync).toBe(true);
    expect(r.briefName).toBe("Laetitia");
  });

  it("does NOT detect desync : opener prénom matches firstName", () => {
    const r = detectOpenerPersonaDesync(
      "Bonjour Eric,\n\nFélicitations pour la levée.",
      { firstName: "Eric", fullName: "Eric Barthélémy" },
    );
    expect(r.isDesync).toBe(false);
  });

  it("does NOT detect desync : opener prénom matches lastName (cas firstName mal splitté)", () => {
    const r = detectOpenerPersonaDesync(
      "Bonjour Valerie,\n\nMessage.",
      { firstName: "Humery", lastName: "Valerie" },
    );
    expect(r.isDesync).toBe(false);
  });

  it("does NOT detect desync : case-insensitive + accents normalisés", () => {
    expect(
      detectOpenerPersonaDesync("Bonjour françois,", { firstName: "FRANCOIS" }).isDesync,
    ).toBe(false);
    expect(
      detectOpenerPersonaDesync("Bonjour Hélène,", { firstName: "Helene" }).isDesync,
    ).toBe(false);
  });

  it("ignores special openers (NON/ENRICH/Bonjour seul)", () => {
    expect(
      detectOpenerPersonaDesync("(Hors ICP — pas d'opener)", { firstName: "Eric" }).isDesync,
    ).toBe(false);
    expect(
      detectOpenerPersonaDesync("(Verdict ENRICH — opener à finaliser)", { firstName: "Eric" }).isDesync,
    ).toBe(false);
    expect(
      detectOpenerPersonaDesync("Bonjour,\n\nMessage.", { firstName: "Eric" }).isDesync,
    ).toBe(false);
    expect(
      detectOpenerPersonaDesync("Bonjour (prénom à vérifier),", { firstName: "Eric" }).isDesync,
    ).toBe(false);
  });

  it("returns no-desync when opener has no detectable Bonjour <Name> pattern", () => {
    expect(
      detectOpenerPersonaDesync("Hello, this is weird", { firstName: "Eric" }).isDesync,
    ).toBe(false);
  });

  it("handles null/empty opener/lead gracefully", () => {
    expect(detectOpenerPersonaDesync(null, { firstName: "Eric" }).isDesync).toBe(false);
    expect(detectOpenerPersonaDesync("Bonjour Marc,", null).isDesync).toBe(false);
    expect(detectOpenerPersonaDesync("Bonjour Marc,", {}).isDesync).toBe(false);
  });

  it("matches Jean-Luc partial to Lead Jean (compound prénom)", () => {
    expect(
      detectOpenerPersonaDesync("Bonjour Jean-Luc,", { firstName: "Jean" }).isDesync,
    ).toBe(false);
  });
});
