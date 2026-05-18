import { describe, expect, it } from "vitest";
import {
  normalizeForEmail,
  extractDomainFromPayload,
  buildEmailPattern,
} from "./enrich-via-email-pattern";

describe("enrich-via-email-pattern — normalizeForEmail", () => {
  it("retire les accents et passe en lowercase", () => {
    expect(normalizeForEmail("Élise")).toBe("elise");
    expect(normalizeForEmail("Frédéric")).toBe("frederic");
    expect(normalizeForEmail("François")).toBe("francois");
    expect(normalizeForEmail("Jérôme")).toBe("jerome");
  });

  it("garde les tirets pour prénoms composés", () => {
    expect(normalizeForEmail("Marie-Anne")).toBe("marie-anne");
    expect(normalizeForEmail("Jean-Pierre")).toBe("jean-pierre");
  });

  it("convertit espace en tiret", () => {
    expect(normalizeForEmail("Jean Pierre")).toBe("jean-pierre");
  });

  it("supprime apostrophes", () => {
    expect(normalizeForEmail("D'Aragon")).toBe("daragon");
    expect(normalizeForEmail("O'Brien")).toBe("obrien");
  });

  it("filtre les caractères spéciaux", () => {
    expect(normalizeForEmail("Smith Jr.")).toBe("smith-jr");
    expect(normalizeForEmail("Dr. Martin")).toBe("dr-martin");
  });

  it("retourne vide si que des caractères invalides", () => {
    expect(normalizeForEmail("...")).toBe("");
    expect(normalizeForEmail("@@@")).toBe("");
  });
});

describe("enrich-via-email-pattern — extractDomainFromPayload", () => {
  it("extrait depuis companyWebsite", () => {
    const d = extractDomainFromPayload({ companyWebsite: "https://skello.io" });
    expect(d).toBe("skello.io");
  });

  it("ajoute https:// si manquant", () => {
    const d = extractDomainFromPayload({ companyWebsite: "skello.io" });
    expect(d).toBe("skello.io");
  });

  it("retire le préfixe www.", () => {
    const d = extractDomainFromPayload({ companyWebsite: "https://www.skello.io" });
    expect(d).toBe("skello.io");
  });

  it("skip les domaines plateforme blacklistés", () => {
    expect(
      extractDomainFromPayload({ companyWebsite: "https://linkedin.com/company/foo" }),
    ).toBeNull();
    expect(
      extractDomainFromPayload({ websiteUrl: "https://www.welcometothejungle.com/foo" }),
    ).toBeNull();
    expect(
      extractDomainFromPayload({ companyUrl: "https://francetravail.fr/jobs/x" }),
    ).toBeNull();
  });

  it("retourne null si pas de champ url", () => {
    expect(extractDomainFromPayload({ name: "Foo" })).toBeNull();
    expect(extractDomainFromPayload({})).toBeNull();
    expect(extractDomainFromPayload(null)).toBeNull();
  });

  it("retourne null pour URL invalide", () => {
    expect(extractDomainFromPayload({ companyWebsite: "not-a-url" })).toBeNull();
    expect(extractDomainFromPayload({ companyWebsite: "" })).toBeNull();
  });

  it("trouve dans objets imbriqués (level 1)", () => {
    const d = extractDomainFromPayload({
      contact: { companyWebsite: "https://acme.fr" },
    });
    expect(d).toBe("acme.fr");
  });

  it("essaie tous les champs candidats", () => {
    expect(extractDomainFromPayload({ websiteUrl: "https://a.fr" })).toBe("a.fr");
    expect(extractDomainFromPayload({ companyUrl: "https://b.fr" })).toBe("b.fr");
    expect(extractDomainFromPayload({ website: "https://c.fr" })).toBe("c.fr");
    expect(extractDomainFromPayload({ companyDomain: "d.fr" })).toBe("d.fr");
  });
});

describe("enrich-via-email-pattern — buildEmailPattern", () => {
  it("génère prenom.nom@domain", () => {
    expect(buildEmailPattern("Jean", "Dupont", "skello.io")).toBe("jean.dupont@skello.io");
  });

  it("normalise accents", () => {
    expect(buildEmailPattern("Élise", "Frédéric", "acme.fr")).toBe(
      "elise.frederic@acme.fr",
    );
  });

  it("gère les prénoms composés avec tirets", () => {
    expect(buildEmailPattern("Marie-Anne", "Martin", "acme.fr")).toBe(
      "marie-anne.martin@acme.fr",
    );
  });

  it("retourne vide si firstName/lastName vide après normalisation", () => {
    expect(buildEmailPattern("...", "Dupont", "acme.fr")).toBe("");
    expect(buildEmailPattern("Jean", "@@@", "acme.fr")).toBe("");
  });

  it("retourne vide si domain manquant", () => {
    expect(buildEmailPattern("Jean", "Dupont", "")).toBe("");
  });
});
