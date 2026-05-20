import { describe, expect, it } from "vitest";
import { filterRecordsByObjetKeyword, cleanBuyerName, extractFirstSignificantWord, objetContainsKeyword, normalizeForMatch } from "./boamp-poller";

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

describe("boamp-poller: filterRecordsByObjetKeyword (Jour 14 Sujet 8)", () => {
  it("garde uniquement les records dont l'objet contient un keyword", () => {
    const records = [
      { objet: "Marché de signature électronique pour la commune" },
      { objet: "Fourniture de denrées alimentaires pour la cantine" },
      { objet: "Acquisition d'une plateforme de signature en ligne" },
    ];
    const { kept, dropped } = filterRecordsByObjetKeyword(records, [
      "signature électronique",
      "signature en ligne",
    ]);
    expect(kept).toHaveLength(2);
    expect(dropped).toBe(1);
    expect(kept[0]?.objet).toContain("signature électronique");
    expect(kept[1]?.objet).toContain("signature en ligne");
  });

  it("ne garde rien si aucun objet ne contient de keyword (cas réel 22/25 Digidemat 19/05)", () => {
    const records = [
      { objet: "Prestations de déménagement physique" },
      { objet: "Marché d'exploitation génie climatique" },
      { objet: "Conseil stratégique achat espaces publicitaires" },
    ];
    const { kept, dropped } = filterRecordsByObjetKeyword(records, [
      "signature électronique",
      "parapheur électronique",
    ]);
    expect(kept).toHaveLength(0);
    expect(dropped).toBe(3);
  });

  it("matching case-insensitive", () => {
    const records = [
      { objet: "Achat d'une plateforme de SIGNATURE Électronique" },
    ];
    const { kept } = filterRecordsByObjetKeyword(records, ["signature électronique"]);
    expect(kept).toHaveLength(1);
  });

  it("garde tout si keywords vide (no-op safe)", () => {
    const records = [
      { objet: "Marché A" },
      { objet: "Marché B" },
    ];
    const { kept, dropped } = filterRecordsByObjetKeyword(records, []);
    expect(kept).toHaveLength(2);
    expect(dropped).toBe(0);
  });

  it("skip les records sans objet", () => {
    const records = [
      { objet: "Signature électronique" },
      { /* pas d'objet */ },
      { objet: "" },
    ];
    const { kept, dropped } = filterRecordsByObjetKeyword(records, ["signature électronique"]);
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(2);
  });
});

describe("boamp-poller: extractFirstSignificantWord (Jour 14 Sujet 12)", () => {
  it("extrait BRL depuis 'BRL DJRSE'", () => {
    expect(extractFirstSignificantWord("BRL DJRSE")).toBe("BRL");
  });

  it("extrait PFC depuis 'PFC SO'", () => {
    expect(extractFirstSignificantWord("PFC SO")).toBe("PFC");
  });

  it("extrait SID depuis 'SID ATLANTIQUE'", () => {
    expect(extractFirstSignificantWord("SID ATLANTIQUE")).toBe("SID");
  });

  it("ignore les mots de liaison (de/des/du/la/le/les/et)", () => {
    expect(extractFirstSignificantWord("Direction de la Défense Atlantique")).toBe("Direction");
    expect(extractFirstSignificantWord("le DGFiP")).toBe("DGFiP");
    expect(extractFirstSignificantWord("Les Services du Premier Ministre")).toBe("Services");
  });

  it("ignore mots <3 chars", () => {
    expect(extractFirstSignificantWord("SO DI Préfecture")).toBe("Préfecture");
  });

  it("nettoie d'abord parenthèses/suffixes (réutilise cleanBuyerName)", () => {
    expect(extractFirstSignificantWord("Syndicat Départemental de la Voirie (17)")).toBe("Syndicat");
    expect(extractFirstSignificantWord("VILLE DE PARIS - DCPA - SELT")).toBe("VILLE");
  });

  it("retourne null si aucun mot significatif", () => {
    expect(extractFirstSignificantWord("de la et")).toBeNull();
    expect(extractFirstSignificantWord("")).toBeNull();
    expect(extractFirstSignificantWord("a")).toBeNull();
  });
});

describe("boamp-poller: objetContainsKeyword stemming (Jour 14 Sujet 13)", () => {
  it("matche le keyword exact case-insensitive", () => {
    expect(objetContainsKeyword("Acquisition d'un parapheur", "parapheur")).toBe(true);
    expect(objetContainsKeyword("ACQUISITION D'UN PARAPHEUR", "parapheur")).toBe(true);
  });

  it("matche malgré perte d'accents (cas réel BOAMP en majuscules sans diacritiques)", () => {
    expect(objetContainsKeyword("CACHETS ELECTRONIQUES", "cachet électronique")).toBe(true);
    expect(objetContainsKeyword("SIGNATURE ELECTRONIQUE", "signature électronique")).toBe(true);
    expect(objetContainsKeyword("DEMATERIALISATION DES DOCUMENTS", "dématérialisation")).toBe(true);
  });

  it("matche le pluriel 's' final (cas UCANSS 13/05)", () => {
    const ucanss = "FOURNITURE DE CERTIFICATS DE SIGNATURES ET DE CACHETS ELECTRONIQUES POUR LES ORGANISMES DE SECURITE SOCIALE";
    expect(objetContainsKeyword(ucanss, "certificat électronique")).toBe(true);
    expect(objetContainsKeyword(ucanss, "cachet électronique")).toBe(true);
    expect(objetContainsKeyword(ucanss, "signature électronique")).toBe(true);
  });

  it("matche les pluriels sur expressions à 2 mots", () => {
    expect(objetContainsKeyword("acquisition de parapheurs électroniques", "parapheur électronique")).toBe(true);
    expect(objetContainsKeyword("certificats numériques", "certificat numérique")).toBe(true);
  });

  it("ne matche PAS si le keyword n'est nulle part dans l'objet", () => {
    expect(objetContainsKeyword("Marché de déménagement physique", "signature électronique")).toBe(false);
    expect(objetContainsKeyword("Fourniture de produits alimentaires", "parapheur")).toBe(false);
  });

  it("acronyme GED reste matchable strict", () => {
    expect(objetContainsKeyword("solution de GED", "GED")).toBe(true);
    expect(objetContainsKeyword("GESTION ELECTRONIQUE DES DOCUMENTS", "gestion électronique des documents")).toBe(true);
  });

  it("normalizeForMatch : lowercase + strip diacritiques", () => {
    expect(normalizeForMatch("Électronique Été")).toBe("electronique ete");
    expect(normalizeForMatch("DÉMATÉRIALISATION")).toBe("dematerialisation");
  });
});

describe("boamp-poller: filterRecordsByObjetKeyword post-Sujet 13", () => {
  it("garde UCANSS (vrai cas live 13/05)", () => {
    const records = [
      { objet: "FOURNITURE DE CERTIFICATS DE SIGNATURES ET DE CACHETS ELECTRONIQUES POUR LES ORGANISMES DE SECURITE SOCIALE" },
      { objet: "Acquisition d'un logiciel GED transverse CNFPT" },
      { objet: "Marché de déménagement physique" },
    ];
    const { kept, dropped } = filterRecordsByObjetKeyword(records as any, ["certificat électronique", "GED"]);
    expect(kept).toHaveLength(2);
    expect(dropped).toBe(1);
  });
});
