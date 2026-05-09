import { describe, it, expect } from "vitest";
import { buildWeeklyDigest, type DigestLead } from "./lead-digest-builder";
import type { BrandConfig } from "./delivery-config";

const BRAND: BrandConfig = {
  senderName: "iFIND",
  senderEmail: null,
  primaryColor: "#5B7CFA",
  logoUrl: null,
};

function fakeLead(overrides: Partial<DigestLead> = {}): DigestLead {
  return {
    triggerId: "t1",
    companyName: "Acme",
    companyNaf: "62.01Z",
    size: "11-50",
    region: "Île-de-France",
    sourceCode: "rss-levees",
    score: 7,
    scoreReason: "Levée Série A 5M€",
    capturedAt: new Date("2026-05-08"),
    briefV2: null,
    lead: null,
    ...overrides,
  };
}

describe("buildWeeklyDigest", () => {
  it("genere subject avec '0 lead' si liste vide", () => {
    const r = buildWeeklyDigest({
      clientName: "DTL",
      leads: [],
      periodStart: new Date("2026-05-03"),
      periodEnd: new Date("2026-05-10"),
      brand: BRAND,
    });
    expect(r.subject).toContain("aucun lead");
    expect(r.stats.total).toBe(0);
    expect(r.stats.pepites).toBe(0);
  });

  it("genere subject avec count si leads présents", () => {
    const r = buildWeeklyDigest({
      clientName: "DTL",
      leads: [fakeLead({ score: 8 }), fakeLead({ triggerId: "t2", score: 7 })],
      periodStart: new Date("2026-05-03"),
      periodEnd: new Date("2026-05-10"),
      brand: BRAND,
    });
    expect(r.subject).toContain("2 leads");
    expect(r.stats.total).toBe(2);
  });

  it("compte les pepites (score ≥ 9)", () => {
    const r = buildWeeklyDigest({
      clientName: "DTL",
      leads: [
        fakeLead({ score: 9 }),
        fakeLead({ triggerId: "t2", score: 10 }),
        fakeLead({ triggerId: "t3", score: 7 }),
      ],
      periodStart: new Date(),
      periodEnd: new Date(),
      brand: BRAND,
    });
    expect(r.stats.pepites).toBe(2);
    expect(r.subject).toContain("2 pepite");
  });

  it("inclut HTML + text + subject dans output", () => {
    const r = buildWeeklyDigest({
      clientName: "DTL",
      leads: [fakeLead()],
      periodStart: new Date(),
      periodEnd: new Date(),
      brand: BRAND,
    });
    expect(r.subject.length).toBeGreaterThan(10);
    expect(r.html).toContain("<html");
    expect(r.html).toContain("Acme");
    expect(r.text).toContain("Acme");
  });

  it("inclut le brief V2 si disponible", () => {
    const r = buildWeeklyDigest({
      clientName: "DTL",
      leads: [
        fakeLead({
          briefV2: {
            verdict: "OUI",
            confidence: 92,
            thesis: "ICP fit parfait, levée Série A 5M€",
            opener: "Bonjour Marc, félicitations pour la levée...",
          },
        }),
      ],
      periodStart: new Date(),
      periodEnd: new Date(),
      brand: BRAND,
    });
    expect(r.html).toContain("OUI");
    expect(r.html).toContain("92");
    expect(r.html).toContain("félicitations");
  });

  it("calcule score moyen correctement", () => {
    const r = buildWeeklyDigest({
      clientName: "DTL",
      leads: [
        fakeLead({ score: 7 }),
        fakeLead({ triggerId: "t2", score: 9 }),
      ],
      periodStart: new Date(),
      periodEnd: new Date(),
      brand: BRAND,
    });
    expect(r.stats.avg_score).toBe(8);
  });

  it("escape HTML dans companyName (XSS protection)", () => {
    const r = buildWeeklyDigest({
      clientName: "DTL",
      leads: [fakeLead({ companyName: "<script>alert(1)</script>" })],
      periodStart: new Date(),
      periodEnd: new Date(),
      brand: BRAND,
    });
    expect(r.html).not.toContain("<script>alert");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("inclut contact email/phone/linkedin dans HTML si présents", () => {
    const r = buildWeeklyDigest({
      clientName: "DTL",
      leads: [
        fakeLead({
          lead: {
            fullName: "Marc Dupont",
            email: "marc@acme.fr",
            phone: "+33612345678",
            linkedinUrl: "https://linkedin.com/in/marc",
          },
        }),
      ],
      periodStart: new Date(),
      periodEnd: new Date(),
      brand: BRAND,
    });
    expect(r.html).toContain("Marc Dupont");
    expect(r.html).toContain("marc@acme.fr");
    expect(r.html).toContain("+33612345678");
  });
});
