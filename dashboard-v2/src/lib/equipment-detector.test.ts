import { describe, it, expect } from "vitest";
import {
  buildCompetitorPatterns,
  findCompetitorMentions,
  decideEquipmentStatus,
  inferDomainFromPayload,
  isBlacklistedDomain,
  buildUrlsToCheck,
  getConfidenceForSource,
} from "./equipment-detector";

describe("buildCompetitorPatterns", () => {
  it("génère variantes pour un single token", () => {
    const pats = buildCompetitorPatterns("Yousign");
    // Doit matcher : yousign, yousign.com, yousign.fr, etc.
    expect(pats.some((p) => p.test("yousign"))).toBe(true);
    expect(pats.some((p) => p.test("yousign.com"))).toBe(true);
    expect(pats.some((p) => p.test("YouSign"))).toBe(true);
  });

  it("génère variantes pour multi-tokens", () => {
    const pats = buildCompetitorPatterns("Lex Persona");
    expect(pats.some((p) => p.test("lex persona"))).toBe(true);
    expect(pats.some((p) => p.test("lexpersona"))).toBe(true);
    expect(pats.some((p) => p.test("lex-persona"))).toBe(true);
  });

  it("skip tokens trop courts (≤2 chars)", () => {
    expect(buildCompetitorPatterns("ai")).toEqual([]);
    expect(buildCompetitorPatterns("X")).toEqual([]);
  });

  it("ne match pas un sous-mot accidentel (yousign dans yousigner)", () => {
    const pats = buildCompetitorPatterns("Yousign");
    // Aucun pattern ne doit matcher "yousigner" (faux positif évité)
    const matchAny = pats.some((p) => {
      p.lastIndex = 0;
      return p.test("yousigner");
    });
    expect(matchAny).toBe(false);
  });

  it("match avec ponctuation/espaces autour", () => {
    const pats = buildCompetitorPatterns("Yousign");
    expect(pats.some((p) => { p.lastIndex = 0; return p.test("Signé via Yousign."); })).toBe(true);
    expect(pats.some((p) => { p.lastIndex = 0; return p.test("(Yousign)"); })).toBe(true);
  });
});

describe("findCompetitorMentions", () => {
  const competitors = ["Yousign", "DocuSign", "Lex Persona"];

  it("trouve Yousign dans un texte de footer", () => {
    const text =
      "© 2026 Acme — Signature électronique propulsée par Yousign. Tous droits réservés.";
    const ev = findCompetitorMentions(text, competitors, {
      source: "homepage-footer",
      url: "https://acme.com/",
      baseConfidence: 0.95,
    });
    expect(ev).toHaveLength(1);
    expect(ev[0]?.competitor).toBe("Yousign");
    expect(ev[0]?.confidence).toBe(0.95);
    expect(ev[0]?.matchedText).toContain("Yousign");
  });

  it("trouve plusieurs concurrents", () => {
    const text = "Notre solution intègre Yousign et DocuSign pour la signature.";
    const ev = findCompetitorMentions(text, competitors, {
      source: "homepage-body",
      url: "https://acme.com/",
      baseConfidence: 0.6,
    });
    expect(ev).toHaveLength(2);
    expect(ev.map((e) => e.competitor).sort()).toEqual(["DocuSign", "Yousign"]);
  });

  it("retourne [] si aucun concurrent mentionné", () => {
    const text = "Bienvenue sur notre site. Nous vendons des chaussures.";
    const ev = findCompetitorMentions(text, competitors, {
      source: "homepage-body",
      url: "https://acme.com/",
    });
    expect(ev).toEqual([]);
  });

  it("ne match qu'une fois le même competitor même s'il apparaît plusieurs fois", () => {
    const text = "Yousign yousign Yousign Yousign";
    const ev = findCompetitorMentions(text, ["Yousign"], {
      source: "homepage-body",
      url: "https://acme.com/",
    });
    expect(ev).toHaveLength(1);
  });

  it("trouve via URL CDN (cdn.yousign.com)", () => {
    const text = '<script src="https://cdn.yousign.com/sdk.js"></script>';
    const ev = findCompetitorMentions(text, ["Yousign"], {
      source: "homepage-script",
      url: "https://acme.com/",
      baseConfidence: 0.95,
    });
    expect(ev).toHaveLength(1);
    expect(ev[0]?.confidence).toBe(0.95);
  });
});

describe("decideEquipmentStatus", () => {
  it("0 evidence + fetch OK = NONE", () => {
    const r = decideEquipmentStatus([], { fetchedAtLeastOneSource: true });
    expect(r.status).toBe("NONE");
    expect(r.competitor).toBeNull();
  });

  it("0 evidence + aucun fetch = UNKNOWN", () => {
    const r = decideEquipmentStatus([], { fetchedAtLeastOneSource: false });
    expect(r.status).toBe("UNKNOWN");
    expect(r.reason).toContain("inaccessible");
  });

  it("1 evidence confidence haute = EQUIPPED", () => {
    const r = decideEquipmentStatus(
      [
        {
          competitor: "Yousign",
          source: "homepage-footer",
          url: "https://acme.com/",
          matchedText: "via Yousign",
          confidence: 0.95,
        },
      ],
      { fetchedAtLeastOneSource: true },
    );
    expect(r.status).toBe("EQUIPPED");
    expect(r.competitor).toBe("Yousign");
  });

  it("1 evidence confidence moyenne = EQUIPPED (probable)", () => {
    const r = decideEquipmentStatus(
      [
        {
          competitor: "DocuSign",
          source: "homepage-body",
          url: "https://acme.com/",
          matchedText: "blog: DocuSign vs Yousign",
          confidence: 0.7,
        },
      ],
      { fetchedAtLeastOneSource: true },
    );
    expect(r.status).toBe("EQUIPPED");
  });

  it("1 evidence confidence faible = UNKNOWN", () => {
    const r = decideEquipmentStatus(
      [
        {
          competitor: "DocuSign",
          source: "customers-page",
          url: "https://acme.com/clients",
          matchedText: "...DocuSign...",
          confidence: 0.5,
        },
      ],
      { fetchedAtLeastOneSource: true },
    );
    expect(r.status).toBe("UNKNOWN");
    expect(r.reason).toContain("manuellement");
  });

  it("évidences multiples : prend la plus haute confidence comme competitor principal", () => {
    const r = decideEquipmentStatus(
      [
        {
          competitor: "DocuSign",
          source: "homepage-body",
          url: "https://acme.com/",
          matchedText: "...",
          confidence: 0.6,
        },
        {
          competitor: "Yousign",
          source: "homepage-footer",
          url: "https://acme.com/",
          matchedText: "...",
          confidence: 0.95,
        },
      ],
      { fetchedAtLeastOneSource: true },
    );
    expect(r.status).toBe("EQUIPPED");
    expect(r.competitor).toBe("Yousign"); // highest confidence
    expect(r.evidence).toHaveLength(2);
    expect(r.evidence[0]?.competitor).toBe("Yousign"); // sorted desc
  });
});

describe("inferDomainFromPayload", () => {
  it("extrait depuis companyWebsite", () => {
    const p = { companyWebsite: "https://acme.com/about" };
    expect(inferDomainFromPayload(p)).toBe("acme.com");
  });

  it("normalise sans https://", () => {
    expect(inferDomainFromPayload({ website: "example.fr" })).toBe("example.fr");
  });

  it("strip www.", () => {
    expect(inferDomainFromPayload({ url: "https://www.example.fr/" })).toBe(
      "example.fr",
    );
  });

  it("skip plateformes blacklistées (linkedin, indeed, etc.)", () => {
    expect(
      inferDomainFromPayload({ url: "https://linkedin.com/company/x" }),
    ).toBeNull();
    expect(
      inferDomainFromPayload({
        url: "https://welcometothejungle.com/jobs/x",
      }),
    ).toBeNull();
  });

  it("récursion dans sous-objets (rodz.contact.companyWebsite)", () => {
    const p = {
      rodz: { contact: { companyWebsite: "https://example.fr" } },
    };
    expect(inferDomainFromPayload(p)).toBe("example.fr");
  });

  it("retourne null si rien trouvé", () => {
    expect(inferDomainFromPayload({})).toBeNull();
    expect(inferDomainFromPayload(null)).toBeNull();
    expect(inferDomainFromPayload({ foo: "bar" })).toBeNull();
  });
});

describe("isBlacklistedDomain", () => {
  it("identifie linkedin, indeed, github, etc.", () => {
    expect(isBlacklistedDomain("linkedin.com")).toBe(true);
    expect(isBlacklistedDomain("fr.linkedin.com")).toBe(true);
    expect(isBlacklistedDomain("github.com")).toBe(true);
    expect(isBlacklistedDomain("francetravail.fr")).toBe(true);
  });

  it("ne blacklist pas les vrais sites d'entreprise", () => {
    expect(isBlacklistedDomain("acme.com")).toBe(false);
    expect(isBlacklistedDomain("ucanss.fr")).toBe(false);
    expect(isBlacklistedDomain("digidemat.com")).toBe(false);
  });
});

describe("buildUrlsToCheck", () => {
  it("génère homepage + legal + customers pour un domain", () => {
    const urls = buildUrlsToCheck("acme.com");
    expect(urls.length).toBeGreaterThanOrEqual(15);
    expect(urls.some((u) => u.url === "https://acme.com/" && u.type === "homepage")).toBe(true);
    expect(urls.some((u) => u.url.includes("/mentions-legales") && u.type === "legal")).toBe(true);
    expect(urls.some((u) => u.url.includes("/clients") && u.type === "customers")).toBe(true);
  });
});

describe("getConfidenceForSource", () => {
  it("footer + script sont les plus confiance", () => {
    expect(getConfidenceForSource("homepage-footer")).toBeGreaterThanOrEqual(0.9);
    expect(getConfidenceForSource("homepage-script")).toBeGreaterThanOrEqual(0.9);
  });

  it("customers-page est ambigu (témoignage possible)", () => {
    expect(getConfidenceForSource("customers-page")).toBeLessThan(0.7);
  });
});
