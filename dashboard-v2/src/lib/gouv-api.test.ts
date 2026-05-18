import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";

// On mock global fetch pour ne pas taper l'API gouv pendant les tests.
// Le module garde son cache interne, donc on appelle une nouvelle invocation
// par test pour éviter le hit cache (siren différent).
const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

import {
  attributeSirene,
  getEntreprise,
  searchByName,
  findHumanDirigeantRecursive,
} from "./gouv-api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Réponse type-conforme avec un seul résultat. Le siren change à chaque test
// pour éviter de hit le cache LRU du module.
function makeGouvSearch(siren: string, overrides: Record<string, unknown> = {}) {
  return {
    total_results: 1,
    page: 1,
    per_page: 10,
    total_pages: 1,
    results: [
      {
        siren,
        nom_complet: "TEST CORP",
        nom_raison_sociale: "TEST CORP",
        nature_juridique: "5710",
        activite_principale: "58.29C",
        tranche_effectif_salarie: "31",
        annee_tranche_effectif_salarie: "2023",
        date_creation: "2020-01-01",
        etat_administratif: "A",
        siege: {
          siret: `${siren}00000`,
          adresse: "1 rue de Paris",
          code_postal: "75001",
          libelle_commune: "Paris",
          libelle_region: "Ile-de-France",
        },
        dirigeants: [],
        finances: {},
        ...overrides,
      },
    ],
  };
}

describe("gouv-api — attributeSirene", () => {
  it("retourne le 1er résultat mappé", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(makeGouvSearch("100000001")));
    const r = await attributeSirene("Test Corp Unique 1");
    expect(r).toEqual({
      siren: "100000001",
      nom: "TEST CORP",
      code_naf: "58.29C",
      effectif: "31",
    });
  });

  it("retourne null si aucun résultat", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total_results: 0, page: 1, per_page: 10, total_pages: 0, results: [] }),
    );
    const r = await attributeSirene("Nonexistent Corp 999999");
    expect(r).toBeNull();
  });

  it("passe code_postal dans la query si fourni", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(makeGouvSearch("100000002")));
    await attributeSirene("Test Corp Unique 2", { code_postal: "69001" });
    const callUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(callUrl).toContain("code_postal=69001");
  });
});

describe("gouv-api — getEntreprise + mapping", () => {
  it("mappe dirigeants personne physique en nom_complet 'Prenoms NOM'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        makeGouvSearch("200000001", {
          dirigeants: [
            {
              type_dirigeant: "personne physique",
              prenoms: "Jean Pierre",
              nom: "DUPONT",
              qualite: "Président",
            },
          ],
        }),
      ),
    );
    const e = await getEntreprise("200000001");
    expect(e.representants).toHaveLength(1);
    expect(e.representants?.[0]).toEqual({
      nom_complet: "Jean Pierre DUPONT",
      qualite: "Président",
      type: "personne physique",
    });
  });

  it("mappe dirigeants personne morale en nom_complet=denomination", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        makeGouvSearch("200000002", {
          dirigeants: [
            {
              type_dirigeant: "personne morale",
              denomination: "HOLDING SA",
              siren: "999888777",
              qualite: "Gérant",
            },
          ],
        }),
      ),
    );
    const e = await getEntreprise("200000002");
    expect(e.representants).toEqual([
      {
        nom_complet: "HOLDING SA",
        qualite: "Gérant",
        type: "personne morale",
      },
    ]);
  });

  it("convertit finances obj→array Pappers (resultat_net → resultat)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        makeGouvSearch("200000003", {
          finances: {
            "2024": { chiffre_affaires: 1200000, resultat_net: 80000 },
            "2023": { chiffre_affaires: 900000, resultat_net: -50000 },
          },
        }),
      ),
    );
    const e = await getEntreprise("200000003");
    expect(e.finances).toHaveLength(2);
    expect(e.finances?.find((f) => f.annee === 2024)).toEqual({
      annee: 2024,
      chiffre_affaires: 1200000,
      resultat: 80000,
      effectif: null,
      marge_brute: null,
    });
    expect(e.finances?.find((f) => f.annee === 2023)?.resultat).toBe(-50000);
  });

  it("throw PappersError 404 si SIREN inconnu", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total_results: 0, page: 1, per_page: 1, total_pages: 0, results: [] }),
    );
    await expect(getEntreprise("999999998")).rejects.toThrow(/gouv-api: SIREN 999999998 non trouvé/);
  });
});

describe("gouv-api — searchByName", () => {
  it("mappe total_results → total et results → resultats", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        total_results: 42,
        page: 1,
        per_page: 5,
        total_pages: 9,
        results: [
          {
            siren: "300000001",
            nom_complet: "RESULT 1",
            nature_juridique: "5710",
            activite_principale: "62.01Z",
            siege: { libelle_commune: "Lyon", code_postal: "69001" },
          },
        ],
      }),
    );
    const r = await searchByName("Skello Unique");
    expect(r.total).toBe(42);
    expect(r.par_page).toBe(5);
    expect(r.resultats).toHaveLength(1);
    expect(r.resultats[0]).toMatchObject({
      siren: "300000001",
      nom_entreprise: "RESULT 1",
      code_naf: "62.01Z",
      siege: { ville: "Lyon", code_postal: "69001" },
    });
  });
});

describe("gouv-api — findHumanDirigeantRecursive", () => {
  const isPersonneMorale = (nom: string) => /SAS|SARL|HOLDING|SA$/i.test(nom);
  const isWrongPersona = () => false;
  const matchPersonaPriority = (q: string) => {
    if (/président/i.test(q)) return { weight: 100, label: "Président" };
    if (/gérant/i.test(q)) return { weight: 80, label: "Gérant" };
    return { weight: 10, label: q };
  };

  it("retourne le 1er humain trouvé au niveau 0 (pas de récursion)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        makeGouvSearch("400000001", {
          dirigeants: [
            { type_dirigeant: "personne physique", prenoms: "Marie", nom: "MARTIN", qualite: "Présidente" },
          ],
        }),
      ),
    );
    const r = await findHumanDirigeantRecursive("400000001", {
      isPersonneMorale,
      isWrongPersona,
      matchPersonaPriority,
    });
    expect(r).toMatchObject({
      nom_complet: "Marie MARTIN",
      qualite: "Présidente",
      label: "Président",
      holdingPath: [],
    });
  });

  it("retourne null si dépasse maxDepth", async () => {
    // Simule un niveau 3 d'imbrication infini (max depth = 3 par défaut)
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeGouvSearch("400000002", {
          dirigeants: [
            { type_dirigeant: "personne morale", denomination: "BLABLA HOLDING", siren: "400000002", qualite: "Gérant" },
          ],
        }),
      ),
    );
    const r = await findHumanDirigeantRecursive("400000002", {
      isPersonneMorale,
      isWrongPersona,
      matchPersonaPriority,
      maxDepth: 2,
    });
    expect(r).toBeNull();
  });
});
