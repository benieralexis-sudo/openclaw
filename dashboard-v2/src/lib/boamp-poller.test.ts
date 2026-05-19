import { describe, expect, it } from "vitest";
import { filterRecordsByObjetKeyword, cleanBuyerName } from "./boamp-poller";

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
