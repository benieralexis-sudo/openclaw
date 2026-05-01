import { describe, it, expect } from "vitest";
import { computeLeadVerdict, type VerdictInputs, type VerdictKind } from "./lead-verdict";

function inp(over: Partial<VerdictInputs>): VerdictInputs {
  return {
    score: 7,
    priorityScore: 20,
    fitScore: 60,
    isHot: false,
    hasContact: true,
    hasMobile: false,
    hasLinkedin: true,
    hasFirstName: true,
    bouncedAt: null,
    doNotContact: false,
    companyHasInsolvency: false,
    companyEtabsCount: 12,
    companySizeText: null,
    icpSizeMin: 11,
    icpSizeMax: 200,
    opportunityStage: null,
    contactFullName: "Stéphane Vanacker",
    contactPhone: "+33 7 12 34 56 78",
    capturedAt: new Date().toISOString(),
    triggerSourceCode: "rodz.fundraising",
    ...over,
  };
}

describe("computeLeadVerdict — verdicts principaux", () => {
  it("ATTACK_NOW pour Pépite ≥8 + contact + mobile + frais", () => {
    const r = computeLeadVerdict(inp({
      score: 10, priorityScore: 38, fitScore: 100, isHot: true,
      hasMobile: true,
    }));
    expect(r.kind).toBe("ATTACK_NOW");
    expect(r.label).toMatch(/appel/i);
    expect(r.color).toBe("success");
  });

  it("WARM_OUTREACH pour Qualifié 6-7 avec contact OK", () => {
    const r = computeLeadVerdict(inp({ score: 7, priorityScore: 18 }));
    expect(r.kind).toBe("WARM_OUTREACH");
    expect(r.color).toBe("info");
  });

  it("ENRICH_MANUALLY si Qualifié sans firstName (persona introuvable)", () => {
    const r = computeLeadVerdict(inp({ score: 7, hasFirstName: false, hasContact: false }));
    expect(r.kind).toBe("ENRICH_MANUALLY");
    expect(r.label).toMatch(/manuel|trouve/i);
  });

  it("HOLD_LOW_PRIORITY pour score < 5", () => {
    const r = computeLeadVerdict(inp({ score: 3, priorityScore: 2, fitScore: 30 }));
    expect(r.kind).toBe("HOLD_LOW_PRIORITY");
    expect(r.color).toBe("default");
  });

  it("OFF_TARGET si bounced", () => {
    const r = computeLeadVerdict(inp({ bouncedAt: "2026-04-30T10:00:00Z" }));
    expect(r.kind).toBe("OFF_TARGET");
    expect(r.label).toMatch(/bounce/i);
  });

  it("OFF_TARGET si doNotContact (RGPD)", () => {
    const r = computeLeadVerdict(inp({ doNotContact: true }));
    expect(r.kind).toBe("OFF_TARGET");
    expect(r.label).toMatch(/rgpd|opt.out/i);
  });

  it("OFF_TARGET si insolvency", () => {
    const r = computeLeadVerdict(inp({ companyHasInsolvency: true }));
    expect(r.kind).toBe("OFF_TARGET");
    expect(r.label).toMatch(/proc[eé]dure|insolvabilit/i);
  });

  it("OFF_TARGET si companyEtabsCount > sizeMax × 5 (taille hors ICP)", () => {
    // ETI 1400 personnes, ICP 11-200 → 1400 > 200×5=1000
    const r = computeLeadVerdict(inp({ companyEtabsCount: 1400, icpSizeMin: 11, icpSizeMax: 200 }));
    expect(r.kind).toBe("OFF_TARGET");
    expect(r.label).toMatch(/trop\s*grosse|hors\s*cible|grand/i);
  });

  it("OFF_TARGET si companySizeText '1000+' avec ICP 11-200", () => {
    const r = computeLeadVerdict(inp({ companySizeText: "1000+", companyEtabsCount: null }));
    expect(r.kind).toBe("OFF_TARGET");
  });

  it("BOOKED si opportunityStage MEETING_SET", () => {
    const r = computeLeadVerdict(inp({ opportunityStage: "MEETING_SET" }));
    expect(r.kind).toBe("BOOKED");
    expect(r.color).toBe("success");
  });

  it("BOOKED si opportunityStage WON", () => {
    expect(computeLeadVerdict(inp({ opportunityStage: "WON" })).kind).toBe("BOOKED");
  });

  it("BOOKED si opportunityStage PROPOSAL", () => {
    expect(computeLeadVerdict(inp({ opportunityStage: "PROPOSAL" })).kind).toBe("BOOKED");
  });
});

describe("computeLeadVerdict — actions recommandées concrètes", () => {
  it("ATTACK_NOW + mobile → action 'Appeler [nom] au [numéro]'", () => {
    const r = computeLeadVerdict(inp({
      score: 10, priorityScore: 38, isHot: true,
      hasMobile: true, contactPhone: "+33 7 12 34 56 78", contactFullName: "Stéphane Vanacker",
    }));
    expect(r.action).toContain("Appeler");
    expect(r.action).toContain("Stéphane");
    expect(r.action).toContain("+33 7 12 34 56 78");
  });

  it("ATTACK_NOW sans mobile → action 'Envoyer mail + LinkedIn'", () => {
    const r = computeLeadVerdict(inp({
      score: 10, priorityScore: 38, isHot: true,
      hasMobile: false, hasContact: true, hasLinkedin: true,
    }));
    expect(r.action).toMatch(/mail|linkedin/i);
  });

  it("WARM_OUTREACH → action mentionne le warm mail", () => {
    const r = computeLeadVerdict(inp({ score: 7 }));
    expect(r.action).toMatch(/warm|mail|linkedin/i);
  });

  it("ENRICH_MANUALLY → action mentionne LinkedIn de l'annonce", () => {
    const r = computeLeadVerdict(inp({
      score: 7, hasFirstName: false, hasContact: false,
      triggerSourceCode: "apify.linkedin-jobs",
    }));
    expect(r.action).toMatch(/annonce|linkedin|hiring|manager/i);
  });

  it("OFF_TARGET → action est 'Ignorer / soft-delete'", () => {
    const r = computeLeadVerdict(inp({ doNotContact: true }));
    expect(r.action).toMatch(/ignorer|delete|exclure|aucune/i);
  });
});

describe("computeLeadVerdict — flags warnings", () => {
  it("flag 'societe_trop_grosse' si etabsCount > sizeMax × 2 mais < × 5", () => {
    const r = computeLeadVerdict(inp({ companyEtabsCount: 500, icpSizeMin: 11, icpSizeMax: 200 }));
    // Limit < 5x mais > 2x → flag mais pas OFF_TARGET
    expect(r.flags).toContain("societe_trop_grosse");
  });

  it("flag 'decideur_juridique' si jobTitle Directeur Général + grande taille", () => {
    const r = computeLeadVerdict(inp({
      contactJobTitle: "Directeur Général",
      companyEtabsCount: 50,
      icpSizeMax: 200,
    }));
    // Pas trigger flag à 50 (dans cible). À tester avec >250
    const r2 = computeLeadVerdict(inp({
      contactJobTitle: "Directeur Général",
      companyEtabsCount: 500,
      icpSizeMax: 200,
    }));
    expect(r2.flags).toContain("decideur_juridique_pas_hiring");
  });
});
