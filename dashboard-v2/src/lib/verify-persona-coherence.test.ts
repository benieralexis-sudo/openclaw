import { describe, it, expect } from "vitest";
import { verifyPersonaCoherence } from "./verify-persona-coherence";

describe("verifyPersonaCoherence — Rodz mismatch cases (bug 14-15/05/2026)", () => {
  it("REJECT Collective : Jean Marie François De Rauglaudre vs in/marieouttier", () => {
    const r = verifyPersonaCoherence({
      firstName: "Jean Marie François",
      lastName: "De Rauglaudre",
      linkedinUrl: "https://www.linkedin.com/in/marieouttier",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("linkedin_mismatch");
  });

  it("REJECT Unorthodox Partners : Marc Lao vs in/cyrillefavreau", () => {
    const r = verifyPersonaCoherence({
      firstName: "Marc",
      lastName: "Lao",
      linkedinUrl: "https://www.linkedin.com/in/cyrillefavreau",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("linkedin_mismatch");
  });

  it("REJECT DimoMaint : Thomas Lazare Bourgeois vs in/ndaye-fall", () => {
    const r = verifyPersonaCoherence({
      firstName: "Thomas Lazare",
      lastName: "Bourgeois",
      linkedinUrl: "https://www.linkedin.com/in/ndaye-fall-3472a6408",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("linkedin_mismatch");
  });

  it("ACCEPT Sêmeia : Pierre HORNUS vs in/pierre-hornus", () => {
    const r = verifyPersonaCoherence({
      firstName: "Pierre",
      lastName: "HORNUS",
      linkedinUrl: "https://www.linkedin.com/in/pierre-hornus",
    });
    expect(r.ok).toBe(true);
  });

  it("ACCEPT SoWeSoft : Loïc Lemaignan vs in/lemaignan (lastName-only slug)", () => {
    const r = verifyPersonaCoherence({
      firstName: "Loïc",
      lastName: "Lemaignan",
      linkedinUrl: "https://www.linkedin.com/in/lemaignan",
    });
    expect(r.ok).toBe(true);
  });

  it("ACCEPT particule italienne : Aurélia Di Martino vs in/aurelia-di-martino", () => {
    const r = verifyPersonaCoherence({
      firstName: "Aurélia",
      lastName: "Di Martino",
      linkedinUrl: "https://www.linkedin.com/in/aurelia-di-martino",
    });
    expect(r.ok).toBe(true);
  });
});
