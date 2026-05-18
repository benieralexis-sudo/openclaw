import { describe, expect, it } from "vitest";
import {
  normalizeForEmail,
  extractDomainFromPayload,
  buildEmailPattern,
  buildEmailPatternVariants,
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

describe("enrich-via-email-pattern — buildEmailPatternVariants (Hunter-level cascade)", () => {
  it("génère 5 variants par ordre de probabilité décroissante", () => {
    const variants = buildEmailPatternVariants("Jean", "Dupont", "skello.io");
    expect(variants).toHaveLength(5);
    expect(variants[0]).toEqual({ email: "jean.dupont@skello.io", label: "first.last" });
    expect(variants[1]).toEqual({ email: "j.dupont@skello.io", label: "f.last" });
    expect(variants[2]).toEqual({ email: "jean@skello.io", label: "first" });
    expect(variants[3]).toEqual({ email: "dupont.jean@skello.io", label: "last.first" });
    expect(variants[4]).toEqual({ email: "jean-dupont@skello.io", label: "first-last" });
  });

  it("retourne vide pour input invalide", () => {
    expect(buildEmailPatternVariants("", "Dupont", "x.fr")).toEqual([]);
    expect(buildEmailPatternVariants("Jean", "", "x.fr")).toEqual([]);
    expect(buildEmailPatternVariants("Jean", "Dupont", "")).toEqual([]);
  });

  it("normalise les accents dans toutes les variantes", () => {
    const variants = buildEmailPatternVariants("Élise", "Mëtréz", "x.fr");
    expect(variants[0]?.email).toBe("elise.metrez@x.fr");
    expect(variants[1]?.email).toBe("e.metrez@x.fr");
  });

  it("gère les prénoms composés", () => {
    const variants = buildEmailPatternVariants("Marie-Anne", "Martin", "x.fr");
    expect(variants[0]?.email).toBe("marie-anne.martin@x.fr");
    // L'initiale = première lettre normalisée (= "m")
    expect(variants[1]?.email).toBe("m.martin@x.fr");
  });
});
