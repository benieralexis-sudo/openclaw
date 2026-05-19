import { describe, expect, it } from "vitest";
import {
  countSignatureMatchesInText,
  isVendorCompany,
  extractClientCompanyFromTitle,
  MEDIAS_FEEDS,
} from "./rss-medias-signature-helpers";

const KEYWORDS = [
  "signature électronique",
  "DocuSign",
  "Yousign",
  "Docaposte",
  "parapheur électronique",
  "eIDAS",
];

describe("countSignatureMatchesInText", () => {
  it("retourne 0 sur texte vide / undefined", () => {
    expect(countSignatureMatchesInText(undefined, KEYWORDS)).toEqual({
      count: 0,
      labels: [],
    });
    expect(countSignatureMatchesInText("", KEYWORDS)).toEqual({
      count: 0,
      labels: [],
    });
  });

  it("match case-insensitive sur le texte", () => {
    const txt = "La MAIF déploie YOUSIGN pour ses contrats";
    const r = countSignatureMatchesInText(txt, KEYWORDS);
    expect(r.count).toBe(1);
    expect(r.labels).toEqual(["Yousign"]);
  });

  it("compte plusieurs keywords distincts", () => {
    const txt =
      "Comment Decathlon a généralisé la signature électronique avec DocuSign et le parapheur électronique";
    const r = countSignatureMatchesInText(txt, KEYWORDS);
    expect(r.count).toBe(3);
    expect(r.labels).toEqual(
      expect.arrayContaining([
        "signature électronique",
        "DocuSign",
        "parapheur électronique",
      ]),
    );
  });

  it("ignore keywords vides ou whitespace", () => {
    const r = countSignatureMatchesInText("DocuSign présent", [
      "DocuSign",
      "",
      "  ",
    ]);
    expect(r.count).toBe(1);
  });

  it("doublon dans texte = 1 seul match par keyword", () => {
    const txt = "DocuSign DocuSign DocuSign";
    expect(countSignatureMatchesInText(txt, ["DocuSign"]).count).toBe(1);
  });
});

describe("isVendorCompany", () => {
  it("flag Yousign comme vendeur", () => {
    expect(isVendorCompany("Yousign SAS", KEYWORDS)).toBe(true);
  });

  it("flag DOCAPOSTE en majuscules", () => {
    expect(isVendorCompany("DOCAPOSTE", KEYWORDS)).toBe(true);
  });

  it("ne flag PAS MAIF (boîte cliente)", () => {
    expect(isVendorCompany("MAIF", KEYWORDS)).toBe(false);
  });

  it("ne flag PAS Decathlon", () => {
    expect(isVendorCompany("Decathlon", KEYWORDS)).toBe(false);
  });

  it("ne flag PAS keyword <4 chars", () => {
    expect(isVendorCompany("BIC", ["BIC", "DocuSign"])).toBe(false);
  });

  it("ne flag pas si keyword multi-mot pas contenu intégralement", () => {
    expect(isVendorCompany("Signature SA", KEYWORDS)).toBe(false);
  });
});

describe("extractClientCompanyFromTitle", () => {
  it("retourne null sur titre vide", () => {
    expect(extractClientCompanyFromTitle("", KEYWORDS)).toBeNull();
  });

  it("extrait MAIF dans 'MAIF déploie Yousign'", () => {
    const r = extractClientCompanyFromTitle(
      "MAIF déploie Yousign pour ses contrats",
      KEYWORDS,
    );
    expect(r).toBe("MAIF");
  });

  it("extrait Decathlon dans 'Decathlon choisit DocuSign'", () => {
    expect(
      extractClientCompanyFromTitle("Decathlon choisit DocuSign", KEYWORDS),
    ).toBe("Decathlon");
  });

  it("extrait La Poste avec pattern 'Comment X a généralisé'", () => {
    const r = extractClientCompanyFromTitle(
      "Comment La Poste a généralisé la signature électronique",
      KEYWORDS,
    );
    expect(r).toMatch(/Poste/i);
  });

  it("strip préfixe bracket avant extraction", () => {
    expect(
      extractClientCompanyFromTitle(
        "[Exclusif] Carrefour adopte le parapheur électronique",
        KEYWORDS,
      ),
    ).toBe("Carrefour");
  });

  it("retourne null si titre = vendeur fait l'actu (anti-faux-positif)", () => {
    // "Yousign lance" : Yousign serait extrait mais c'est le vendeur → null
    expect(
      extractClientCompanyFromTitle(
        "Yousign choisit AWS pour son infra",
        KEYWORDS,
      ),
    ).toBeNull();
    expect(
      extractClientCompanyFromTitle(
        "DocuSign déploie une nouvelle UI",
        KEYWORDS,
      ),
    ).toBeNull();
  });

  it("retourne null sur titre sans verbe d'adoption", () => {
    expect(
      extractClientCompanyFromTitle(
        "Le marché de la signature électronique en 2026",
        KEYWORDS,
      ),
    ).toBeNull();
  });

  it("retourne null si stopword en tête (Le/La/Les)", () => {
    // "Le ministère adopte" — "Le" est stopword, on évite faux nom "Le"
    expect(
      extractClientCompanyFromTitle(
        "Le marché adopte Yousign massivement",
        KEYWORDS,
      ),
    ).toBeNull();
  });

  it("extrait nom composé multi-tokens", () => {
    expect(
      extractClientCompanyFromTitle(
        "Crédit Agricole déploie la signature électronique",
        KEYWORDS,
      ),
    ).toMatch(/Crédit Agricole/i);
  });
});

describe("MEDIAS_FEEDS", () => {
  it("a au moins 3 feeds configurés", () => {
    expect(MEDIAS_FEEDS.length).toBeGreaterThanOrEqual(3);
  });

  it("chaque feed a un nom et une URL https valides", () => {
    for (const f of MEDIAS_FEEDS) {
      expect(f.name).toBeTruthy();
      expect(f.url).toMatch(/^https:\/\//);
    }
  });
});
