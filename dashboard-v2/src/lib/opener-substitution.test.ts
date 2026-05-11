import { describe, expect, it } from "vitest";
import {
  deriveFirstName,
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
