import { describe, expect, it } from "vitest";

// Helpers purs ré-implémentés ici pour test (mêmes que dans github-poller.ts).

const FR_HINTS = [
  /[éèêëàâîïôöûüç]/i,
  /\b(ajout|correction|maj|mise\sa\sjour|francais|france)\b/i,
  /\bfr\b/i,
  /\b(RGPD|SIRET|SIREN|INPI|INSEE|URSSAF|CNIL|FINESS|RNIPP|TVA)\b/i,
];

const NOT_FR_HINTS = [
  /[ãõ]/i,
  /\b(não|são|ção|também|português|brasil|notário|amnésia|inteligência)\b/i,
  /\b(generador|usuario|según|contratos\s+con|este|este\s+es|fechas|según)\b/i,
  /[ñ]/,
];

function looksFrench(
  commitMessage: string,
  repoFullName: string,
  authorEmail?: string,
): boolean {
  const sample = `${commitMessage} ${repoFullName}`;
  if (NOT_FR_HINTS.some((re) => re.test(sample))) return false;
  if (FR_HINTS.some((re) => re.test(sample))) return true;
  if (authorEmail && /@[A-Za-z0-9.-]+\.fr$/i.test(authorEmail)) return true;
  return false;
}

function chunkKeywords(keywords: string[], size = 5): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < keywords.length; i += size) {
    out.push(keywords.slice(i, i + size));
  }
  return out;
}

function buildGithubQuery(keywords: string[], sinceDate: string): string {
  const orPart = keywords.map((k) => `"${k}"`).join(" OR ");
  return `${orPart} committer-date:>${sinceDate}`;
}

describe("github-poller: looksFrench", () => {
  it("détecte accent français dans message", () => {
    expect(looksFrench("Ajout intégration DocuSign", "user/repo")).toBe(true);
    expect(looksFrench("Hello world", "société-fr/repo")).toBe(true);
  });

  it("détecte mots-clés français explicites", () => {
    expect(looksFrench("Ajout DocuSign config", "us-user/repo")).toBe(true);
    expect(looksFrench("Correction bug Yousign", "us-user/repo")).toBe(true);
    expect(looksFrench("Intégration Yousign", "us-user/repo")).toBe(true); // accent → match
  });

  it("ne match pas 'integration' sans accent (faux ami EN/FR)", () => {
    expect(looksFrench("Add Stripe integration", "us-user/repo")).toBe(false);
    expect(looksFrench("Initial configuration", "us-user/repo")).toBe(false);
  });

  it("rejette portugais malgré les accents partagés", () => {
    expect(looksFrench("Notário valida documento", "user/repo")).toBe(false);
    expect(looksFrench("Inteligência com amnésia constitucional", "BR/repo")).toBe(false);
    expect(looksFrench("Tradução em português", "user/repo")).toBe(false);
    expect(looksFrench("São Paulo também", "user/repo")).toBe(false);
  });

  it("rejette espagnol malgré les accents partagés", () => {
    expect(looksFrench("Generador de contratos con watermark", "user/repo")).toBe(false);
    expect(looksFrench("Mañana es importante", "user/repo")).toBe(false);
    expect(looksFrench("Según las fechas establecidas", "user/repo")).toBe(false);
  });

  it("garde vrai FR avec accents typiques après filtres exclusion", () => {
    expect(looksFrench("Séparer 'Droits num.' en 3 catégories distinctes", "norhaneb17/Legamapex")).toBe(true);
    expect(looksFrench("Refonte CandidateDetailDrawer aligné", "valouchill/GetPatrimo")).toBe(true);
  });

  it("détecte indice via nom de repo (fr)", () => {
    expect(looksFrench("docusign update", "ma-boite-fr/projet")).toBe(true);
  });

  it("rejette commit pur anglais et repo US", () => {
    expect(looksFrench("Add DocuSign integration", "PipedreamHQ/pipedream")).toBe(false);
    expect(looksFrench("Fix bug", "facebook/react")).toBe(false);
  });

  it("détecte via mots réglementaires uniquement-FR (RGPD/CNIL/SIRET)", () => {
    expect(looksFrench("Phase 6g RGPD compliance implementation", "user/repo")).toBe(true);
    expect(looksFrench("Add SIRET validation", "user/repo")).toBe(true);
    expect(looksFrench("CNIL audit report Q1", "user/repo")).toBe(true);
    expect(looksFrench("URSSAF cron sync", "user/repo")).toBe(true);
  });

  it("détecte via email committer @*.fr (fallback)", () => {
    expect(looksFrench("Add DocuSign", "us-user/repo", "alice@company.fr")).toBe(true);
    expect(looksFrench("Fix bug", "user/repo", "user@gouv.fr")).toBe(true);
  });

  it("ignore email non-FR malgré l'extension", () => {
    expect(looksFrench("Add DocuSign", "us-user/repo", "alice@company.com")).toBe(false);
    expect(looksFrench("Add DocuSign", "us-user/repo", "u@example.io")).toBe(false);
    expect(looksFrench("Add DocuSign", "us-user/repo")).toBe(false); // pas d'email
  });
});

describe("github-poller: chunkKeywords", () => {
  it("découpe en batches de 5 par défaut", () => {
    const kw = ["a", "b", "c", "d", "e", "f", "g"];
    expect(chunkKeywords(kw)).toEqual([
      ["a", "b", "c", "d", "e"],
      ["f", "g"],
    ]);
  });

  it("respecte size custom", () => {
    expect(chunkKeywords(["1", "2", "3", "4"], 2)).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("retourne un seul batch si liste plus petite que size", () => {
    expect(chunkKeywords(["a", "b"], 10)).toEqual([["a", "b"]]);
  });

  it("retourne tableau vide si liste vide", () => {
    expect(chunkKeywords([])).toEqual([]);
  });
});

describe("github-poller: buildGithubQuery", () => {
  it("génère query OR avec date filter", () => {
    expect(buildGithubQuery(["DocuSign", "Yousign"], "2026-04-18")).toBe(
      `"DocuSign" OR "Yousign" committer-date:>2026-04-18`,
    );
  });

  it("supporte 1 seul keyword", () => {
    expect(buildGithubQuery(["docusign"], "2026-05-01")).toBe(
      `"docusign" committer-date:>2026-05-01`,
    );
  });

  it("wrap chaque keyword dans des guillemets", () => {
    const q = buildGithubQuery(["adobe sign", "dropbox sign"], "2026-05-01");
    expect(q).toContain(`"adobe sign"`);
    expect(q).toContain(`"dropbox sign"`);
  });
});
