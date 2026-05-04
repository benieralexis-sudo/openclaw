import { describe, it, expect } from "vitest";
import { computeTierFromJobTitle } from "./compute-tier-from-jobtitle";

describe("computeTierFromJobTitle", () => {
  // ────────────────────────────────────────────────────────────────────
  // Tier 1 — CTO/Tech Lead
  // ────────────────────────────────────────────────────────────────────

  it("'CTO' → Tier 1", () => {
    const r = computeTierFromJobTitle("CTO");
    expect(r.tier).toBe(1);
    expect(r.category).toBe("cto-or-tech-lead");
  });

  it("'Directeur Technique' → Tier 1", () => {
    expect(computeTierFromJobTitle("Directeur Technique").tier).toBe(1);
  });

  it("'Head of Engineering' → Tier 1", () => {
    expect(computeTierFromJobTitle("Head of Engineering").tier).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────
  // Tier 2 — Founder priorité absolue
  // ────────────────────────────────────────────────────────────────────

  it("Proelan cas réel — 'Président / Fondateur' → Tier 2 founder (Fondateur match avant Président)", () => {
    const r = computeTierFromJobTitle("Président / Fondateur");
    expect(r.tier).toBe(2);
    expect(r.category).toBe("founder");
  });

  it("Decade Energy cas réel — 'Co-Founder (Sales • Product • Marketing)' → Tier 2 founder", () => {
    const r = computeTierFromJobTitle("Co-Founder (Sales • Product • Marketing)");
    expect(r.tier).toBe(2);
    expect(r.category).toBe("founder");
  });

  // ────────────────────────────────────────────────────────────────────
  // Tier 2 — Exec other (CEO/DG/Président/Gérant)
  // ────────────────────────────────────────────────────────────────────

  it("Alithya/SQUAREMIND cas réel — 'CEO' → Tier 2 exec-other", () => {
    const r = computeTierFromJobTitle("CEO");
    expect(r.tier).toBe(2);
    expect(r.category).toBe("exec-other");
  });

  it("Tech Riders cas réel — 'Président' → Tier 2 exec-other", () => {
    const r = computeTierFromJobTitle("Président");
    expect(r.tier).toBe(2);
    expect(r.category).toBe("exec-other");
  });

  it("Kestra cas réel — 'Gérant' → Tier 2 exec-other", () => {
    const r = computeTierFromJobTitle("Gérant");
    expect(r.tier).toBe(2);
    expect(r.category).toBe("exec-other");
  });

  it("'Directeur Général Adjoint' → Tier 2 exec-other", () => {
    expect(computeTierFromJobTitle("Directeur Général Adjoint").tier).toBe(2);
  });

  // ────────────────────────────────────────────────────────────────────
  // Faux positifs à éviter
  // ────────────────────────────────────────────────────────────────────

  it("'Directeur commercial' → null (pas exec strict)", () => {
    expect(computeTierFromJobTitle("Directeur commercial").tier).toBe(null);
  });

  it("'Sales Manager' → null", () => {
    expect(computeTierFromJobTitle("Sales Manager").tier).toBe(null);
  });

  it("'QA Engineer junior' → null (pas décideur)", () => {
    expect(computeTierFromJobTitle("QA Engineer junior").tier).toBe(null);
  });

  // ────────────────────────────────────────────────────────────────────
  // Edge cases
  // ────────────────────────────────────────────────────────────────────

  it("null/undefined/vide/'?' → null", () => {
    expect(computeTierFromJobTitle(null).tier).toBe(null);
    expect(computeTierFromJobTitle(undefined).tier).toBe(null);
    expect(computeTierFromJobTitle("").tier).toBe(null);
    expect(computeTierFromJobTitle("?").tier).toBe(null);
    expect(computeTierFromJobTitle("   ").tier).toBe(null);
  });
});
