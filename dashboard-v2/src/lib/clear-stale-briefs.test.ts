import { describe, it, expect } from "vitest";
import { isPersonaChanged } from "@/lib/persona-changed";

describe("isPersonaChanged (Fix B1 racine)", () => {
  it("returns false if newName is null/empty", () => {
    expect(isPersonaChanged("Thomas Bourgeois", null)).toBe(false);
    expect(isPersonaChanged("Thomas Bourgeois", "")).toBe(false);
    expect(isPersonaChanged("Thomas Bourgeois", "   ")).toBe(false);
  });

  it("returns false if oldName is null/empty (first-time set, not a change)", () => {
    expect(isPersonaChanged(null, "Thomas Bourgeois")).toBe(false);
    expect(isPersonaChanged("", "Thomas Bourgeois")).toBe(false);
    expect(isPersonaChanged(undefined, "Thomas Bourgeois")).toBe(false);
  });

  it("returns false for identical names", () => {
    expect(isPersonaChanged("Thomas Bourgeois", "Thomas Bourgeois")).toBe(false);
  });

  it("returns false for case-only changes", () => {
    expect(isPersonaChanged("thomas bourgeois", "Thomas Bourgeois")).toBe(false);
    expect(isPersonaChanged("THOMAS BOURGEOIS", "Thomas Bourgeois")).toBe(false);
  });

  it("returns false for accent-only changes (Hélène vs Helene)", () => {
    expect(isPersonaChanged("Hélène Martin", "Helene Martin")).toBe(false);
    expect(isPersonaChanged("François Dupont", "Francois Dupont")).toBe(false);
  });

  it("returns false for whitespace/dash differences (Jean-Luc vs Jean Luc)", () => {
    expect(isPersonaChanged("Jean-Luc Picard", "Jean Luc Picard")).toBe(false);
    expect(isPersonaChanged("Marie-Claire", "Marie Claire")).toBe(false);
  });

  it("returns true for genuinely different names (B1 desync cases)", () => {
    // DimoMaint cas réel : brief disait Jean-Luc, vrai contact = Thomas
    expect(isPersonaChanged("Jean-Luc Garrigos", "Thomas Bourgeois")).toBe(true);
    // Training Orchestra : Laetitia → Valérie
    expect(isPersonaChanged("Laetitia Dupont", "Humery Valerie")).toBe(true);
    // DiXiO : Thierry → Adrien
    expect(isPersonaChanged("Thierry Miskaoui", "Adrien SICOLI")).toBe(true);
    // Kestra : Ludovic → Denis
    expect(isPersonaChanged("Ludovic Charrier", "Denis Lafont")).toBe(true);
  });

  it("returns true if firstName changes but lastName same", () => {
    expect(isPersonaChanged("Marc Dupont", "Pierre Dupont")).toBe(true);
  });

  it("returns true if lastName changes but firstName same", () => {
    expect(isPersonaChanged("Marc Dupont", "Marc Martin")).toBe(true);
  });
});
