import { describe, it, expect } from "vitest";
import { computeTierFromHeadline } from "./compute-tier-from-headline";

describe("computeTierFromHeadline", () => {
  // ────────────────────────────────────────────────────────────────────
  // Tier 1 — CTO / Head of Tech / Tech Lead
  // ────────────────────────────────────────────────────────────────────

  it("Paul Vidal — 'Co-founder & CTO @Collective' → Tier 1 (CTO match avant Founder)", () => {
    const r = computeTierFromHeadline(
      "Co-founder & CTO @Collective, the AI recruiting platfom | ex-Datadog | Angel investor",
    );
    expect(r.tier).toBe(1);
    expect(r.category).toBe("cto-or-tech-lead");
    expect(r.matchedText?.toLowerCase()).toBe("cto");
  });

  it("Alexis Focheux — 'CTO @ Audion' → Tier 1", () => {
    const r = computeTierFromHeadline("CTO @ Audion");
    expect(r.tier).toBe(1);
    expect(r.category).toBe("cto-or-tech-lead");
  });

  it("Head of Engineering → Tier 1", () => {
    const r = computeTierFromHeadline("Head of Engineering at Acme");
    expect(r.tier).toBe(1);
    expect(r.category).toBe("cto-or-tech-lead");
  });

  it("Tech Lead Senior → Tier 1", () => {
    const r = computeTierFromHeadline("Tech Lead Senior @Foo");
    expect(r.tier).toBe(1);
    expect(r.category).toBe("cto-or-tech-lead");
  });

  // ────────────────────────────────────────────────────────────────────
  // Tier 2 — Founder priorité sur CEO
  // ────────────────────────────────────────────────────────────────────

  it("Maeva Courtois — 'CEO & founder of Helios' → Tier 2 founder (Founder match avant CEO)", () => {
    const r = computeTierFromHeadline(
      "CEO & founder of Helios: the leading ecobank alternative.",
    );
    expect(r.tier).toBe(2);
    expect(r.category).toBe("founder");
    expect(r.matchedText?.toLowerCase()).toBe("founder");
  });

  it("Mickaël Grente — 'Co-founder | Head of Revenue' → Tier 2 founder (Co-founder avant Head of Revenue qui n'est pas Tech)", () => {
    // Note: "Head of Revenue" n'est PAS Tier 1 (pas tech), donc Co-founder gagne Tier 2
    const r = computeTierFromHeadline("Co-founder | Head of Revenue & GTM");
    expect(r.tier).toBe(2);
    expect(r.category).toBe("founder");
  });

  // ────────────────────────────────────────────────────────────────────
  // Tier 2 — Exec other (CEO / DG / Président / Gérant)
  // ────────────────────────────────────────────────────────────────────

  it("Renaud Montagne — 'CEO at Amaris Consulting' → Tier 2 exec-other", () => {
    const r = computeTierFromHeadline("CEO at Amaris Consulting");
    expect(r.tier).toBe(2);
    expect(r.category).toBe("exec-other");
  });

  it("Hugo Dutertre — 'Directeur Général - CTS Consulting' → Tier 2 exec-other", () => {
    const r = computeTierFromHeadline(
      "Directeur Général - CTS Consulting & Technical Support / COGISYS",
    );
    expect(r.tier).toBe(2);
    expect(r.category).toBe("exec-other");
    expect(r.matchedText?.toLowerCase()).toContain("directeur g");
  });

  it("Jean-loup Wirotius — 'Directeur Général Adjoint Mistertemp' → Tier 2 exec-other", () => {
    const r = computeTierFromHeadline(
      "Directeur Général Adjoint Mistertemp' group / Lynx RH.",
    );
    expect(r.tier).toBe(2);
    expect(r.category).toBe("exec-other");
  });

  // ────────────────────────────────────────────────────────────────────
  // Faux positifs à éviter (regression tests)
  // ────────────────────────────────────────────────────────────────────

  it("Jeremy Steinmeyer — 'Directeur commercial chez Alithya' → null (commercial pas exec strict)", () => {
    const r = computeTierFromHeadline("Directeur commercial chez Alithya");
    expect(r.tier).toBe(null);
    expect(r.category).toBe(null);
  });

  it("'Sales Manager at Acme' → null (pas exec/tech)", () => {
    const r = computeTierFromHeadline("Sales Manager at Acme");
    expect(r.tier).toBe(null);
  });

  it("'QA Engineer junior' → null (pas décideur)", () => {
    const r = computeTierFromHeadline("QA Engineer junior at Foo");
    expect(r.tier).toBe(null);
  });

  // ────────────────────────────────────────────────────────────────────
  // Edge cases
  // ────────────────────────────────────────────────────────────────────

  it("headline null → null", () => {
    expect(computeTierFromHeadline(null).tier).toBe(null);
  });

  it("headline undefined → null", () => {
    expect(computeTierFromHeadline(undefined).tier).toBe(null);
  });

  it("headline vide → null", () => {
    expect(computeTierFromHeadline("").tier).toBe(null);
    expect(computeTierFromHeadline("   ").tier).toBe(null);
  });
});
