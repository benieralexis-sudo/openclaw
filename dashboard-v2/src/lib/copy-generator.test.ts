import { describe, it, expect } from "vitest";
import {
  buildCopyPrompt,
  parseCopyResponse,
  resolveTonePolicy,
  validateCopyPayload,
  type CopyContext,
} from "./copy-generator";

describe("resolveTonePolicy", () => {
  it("Tier 1 → ton direct technique", () => {
    const p = resolveTonePolicy("A");
    expect(p.tier).toBe("A");
    expect(p.toneLabel).toMatch(/direct/i);
  });

  it("Tier 2 → ton modéré", () => {
    const p = resolveTonePolicy("B");
    expect(p.tier).toBe("B");
    expect(p.toneLabel).toMatch(/mod[eé]r/i);
  });

  it("Tier 3 → ton formel + intro request", () => {
    const p = resolveTonePolicy("C");
    expect(p.tier).toBe("C");
    expect(p.toneLabel).toMatch(/formel/i);
    expect(p.askForIntro).toBe(true);
  });

  it("Tier null → fallback Tier 2 (intermediate safe)", () => {
    const p = resolveTonePolicy(null);
    expect(p.tier).toBe("B");
  });

  it("Tier inconnu (D ou autre) → fallback Tier 2", () => {
    const p = resolveTonePolicy("Z" as never);
    expect(p.tier).toBe("B");
  });
});

describe("buildCopyPrompt", () => {
  const baseArgs = {
    trigger: {
      title: "Recrutement QA Engineer",
      detail: "Mission longue durée",
      type: "HIRING_KEY",
      score: 9,
      isHot: true,
      industry: "SaaS",
      region: "Paris",
      size: "50-200",
      sourceCode: "rodz.job_offers",
      capturedAt: new Date("2026-04-30T10:00:00Z"),
    },
    lead: {
      firstName: "Stéphane",
      lastName: "Vanacker",
      jobTitle: "CTO",
      companyName: "Asys",
      personaTier: "A",
    },
    client: {
      name: "Digi Test Lab",
      industry: "QA Externalisé",
      icp: { proof_points: ["Novrh — pas d'équipe QA → structuré"] },
      calcomSlug: "alexis-benier/digitestlab-15min",
    },
  } satisfies Parameters<typeof buildCopyPrompt>[0];

  it("inclut le nom du lead dans le prompt", () => {
    const p = buildCopyPrompt(baseArgs);
    expect(p).toContain("Stéphane Vanacker");
  });

  it("inclut la société du lead", () => {
    const p = buildCopyPrompt(baseArgs);
    expect(p).toContain("Asys");
  });

  it("inclut le titre du trigger", () => {
    const p = buildCopyPrompt(baseArgs);
    expect(p).toContain("Recrutement QA Engineer");
  });

  it("inclut le CTA Cal.com si fourni", () => {
    const p = buildCopyPrompt(baseArgs);
    expect(p).toContain("alexis-benier/digitestlab-15min");
  });

  it("précise les 4 contextes attendus dans la sortie JSON", () => {
    const p = buildCopyPrompt(baseArgs);
    expect(p).toContain("coldMail");
    expect(p).toContain("warmMail");
    expect(p).toContain("linkedinDm");
    expect(p).toContain("callBrief");
  });

  it("Tier 1 → mentionne ton direct dans la directive ton", () => {
    const p = buildCopyPrompt(baseArgs);
    expect(p).toMatch(/direct/i);
  });

  it("Tier 3 → mentionne demande intro vers décideur tech", () => {
    const tier3 = { ...baseArgs, lead: { ...baseArgs.lead, personaTier: "C" } };
    const p = buildCopyPrompt(tier3);
    expect(p).toMatch(/intro/i);
  });

  it("warmMail mentionne explicitement échange LinkedIn préalable", () => {
    const p = buildCopyPrompt(baseArgs);
    expect(p).toMatch(/linkedin/i);
    expect(p).toMatch(/échange|conversation|engagement/i);
  });
});

describe("parseCopyResponse", () => {
  const validJson = JSON.stringify({
    coldMail: { subject: "Test", body: "Bonjour", followup: "Relance" },
    warmMail: { subject: "Test", body: "Suite à notre échange LinkedIn" },
    linkedinDm: { message: "Bonjour Stéphane" },
    callBrief: { openingLine: "Bonjour", keyPoints: ["a", "b", "c"], objections: [] },
  });

  it("parse un JSON valide direct", () => {
    const r = parseCopyResponse(validJson);
    expect(r.coldMail.subject).toBe("Test");
    expect(r.warmMail.body).toContain("LinkedIn");
    expect(r.linkedinDm.message).toBe("Bonjour Stéphane");
    expect(r.callBrief.keyPoints).toHaveLength(3);
  });

  it("strip les fences markdown ```json...```", () => {
    const wrapped = "```json\n" + validJson + "\n```";
    const r = parseCopyResponse(wrapped);
    expect(r.coldMail.subject).toBe("Test");
  });

  it("strip le texte parasite avant/après le JSON", () => {
    const noisy = "Voici ma réponse :\n" + validJson + "\nFin.";
    const r = parseCopyResponse(noisy);
    expect(r.coldMail.subject).toBe("Test");
  });

  it("throw si JSON invalide", () => {
    expect(() => parseCopyResponse("pas du json")).toThrow();
  });
});

describe("validateCopyPayload", () => {
  const goodPayload = {
    coldMail: { subject: "Sujet", body: "Body de 50 chars".padEnd(50, "x"), followup: "Followup" },
    warmMail: { subject: "Sujet warm", body: "Suite à notre LinkedIn" },
    linkedinDm: { message: "Hello" },
    callBrief: { openingLine: "Bonjour", keyPoints: ["a", "b", "c"], objections: [] },
  };

  it("retourne ok=true pour un payload valide", () => {
    const r = validateCopyPayload(goodPayload);
    expect(r.ok).toBe(true);
  });

  it("rejette si un context manque", () => {
    const bad = { ...goodPayload, warmMail: undefined as never };
    const r = validateCopyPayload(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("warmMail manquant");
  });

  it("rejette si coldMail.body dépasse 800 chars", () => {
    const tooLong = {
      ...goodPayload,
      coldMail: { ...goodPayload.coldMail, body: "x".repeat(801) },
    };
    const r = validateCopyPayload(tooLong);
    expect(r.ok).toBe(false);
  });

  it("rejette si linkedinDm.message dépasse 300 chars", () => {
    const tooLong = {
      ...goodPayload,
      linkedinDm: { message: "x".repeat(301) },
    };
    const r = validateCopyPayload(tooLong);
    expect(r.ok).toBe(false);
  });

  it("rejette si callBrief.keyPoints n'a pas 3-5 items", () => {
    const empty = {
      ...goodPayload,
      callBrief: { ...goodPayload.callBrief, keyPoints: [] },
    };
    const r = validateCopyPayload(empty);
    expect(r.ok).toBe(false);
  });
});
