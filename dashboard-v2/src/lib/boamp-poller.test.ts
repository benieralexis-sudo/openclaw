import { describe, expect, it } from "vitest";

// Helpers purs ré-implémentés ici pour test (mêmes fonctions que dans
// boamp-poller.ts, gardées privées dans le poller pour ne pas exporter
// trop de surface).

function buildWhereClause(keywords: string[], sinceDate: string): string {
  const orClauses = keywords
    .map((k) => k.replace(/"/g, '\\"'))
    .map((k) => `search(objet, "${k}")`)
    .join(" OR ");
  return `(${orClauses}) AND dateparution >= date'${sinceDate}'`;
}

function extractDonneesContact(record: { donnees?: string }): {
  email?: string;
  ville?: string;
  cp?: string;
} {
  if (!record.donnees) return {};
  try {
    const parsed = JSON.parse(record.donnees);
    const id = (parsed as { IDENTITE?: { MEL?: string; VILLE?: string; CP?: string } })
      ?.IDENTITE;
    return {
      email: id?.MEL,
      ville: id?.VILLE,
      cp: id?.CP,
    };
  } catch {
    return {};
  }
}

describe("boamp-poller: buildWhereClause", () => {
  it("génère une clause OR multi-keywords valide", () => {
    const where = buildWhereClause(
      ["signature électronique", "parapheur"],
      "2026-04-01",
    );
    expect(where).toBe(
      `(search(objet, "signature électronique") OR search(objet, "parapheur")) AND dateparution >= date'2026-04-01'`,
    );
  });

  it("supporte 1 seul keyword", () => {
    const where = buildWhereClause(["logiciel"], "2026-05-01");
    expect(where).toBe(
      `(search(objet, "logiciel")) AND dateparution >= date'2026-05-01'`,
    );
  });

  it("échappe les guillemets dans les keywords", () => {
    const where = buildWhereClause([`logiciel "saas"`], "2026-05-01");
    expect(where).toContain(`search(objet, "logiciel \\"saas\\"")`);
  });

  it("supporte les caractères accentués FR", () => {
    const where = buildWhereClause(["dématérialisation", "été"], "2026-05-01");
    expect(where).toContain(`"dématérialisation"`);
    expect(where).toContain(`"été"`);
  });
});

describe("boamp-poller: extractDonneesContact", () => {
  it("extrait email + ville + cp depuis IDENTITE", () => {
    const donnees = JSON.stringify({
      IDENTITE: {
        DENOMINATION: "Mairie de Paris",
        MEL: "marche@paris.fr",
        VILLE: "Paris",
        CP: "75001",
      },
    });
    expect(extractDonneesContact({ donnees })).toEqual({
      email: "marche@paris.fr",
      ville: "Paris",
      cp: "75001",
    });
  });

  it("retourne objet vide si donnees absent", () => {
    expect(extractDonneesContact({})).toEqual({});
  });

  it("retourne objet vide si donnees est invalide JSON", () => {
    expect(extractDonneesContact({ donnees: "not-json{{" })).toEqual({});
  });

  it("retourne champs vides si IDENTITE manque", () => {
    const donnees = JSON.stringify({ AUTRE: "champ" });
    expect(extractDonneesContact({ donnees })).toEqual({
      email: undefined,
      ville: undefined,
      cp: undefined,
    });
  });
});

import { cleanBuyerName } from "./boamp-poller";

describe("boamp-poller: cleanBuyerName", () => {
  it("strip suffix après tiret (sous-direction ministère)", () => {
    expect(cleanBuyerName("VILLE DE PARIS - DCPA - SELT -SET")).toBe("VILLE DE PARIS");
    expect(cleanBuyerName("MINARM - SGA - DCSID - SID ATL")).toBe("MINARM");
  });

  it("strip parenthèses + leur contenu (code département)", () => {
    expect(cleanBuyerName("Syndicat Départemental de la Voirie (17)")).toBe(
      "Syndicat Départemental de la Voirie",
    );
    expect(cleanBuyerName("CAP Territoires (60)")).toBe("CAP Territoires");
  });

  it("garde le nom tel quel si pas de suffixe ni parenthèse", () => {
    expect(cleanBuyerName("DOCAPOSTE")).toBe("DOCAPOSTE");
    expect(cleanBuyerName("Ville de Paris")).toBe("Ville de Paris");
  });

  it("normalise les espaces multiples post-strip", () => {
    expect(cleanBuyerName("Mairie  de   Paris   (75)")).toBe("Mairie de Paris");
  });

  it("strip combiné parenthèses + suffixe", () => {
    expect(cleanBuyerName("Mairie de Lyon (69) - DSI Direction")).toBe("Mairie de Lyon");
  });
});
