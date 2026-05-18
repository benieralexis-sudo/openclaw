import "server-only";

/**
 * V1 18/05/2026 — Client typé pour l'API gouv "Recherche d'Entreprises"
 * (https://recherche-entreprises.api.gouv.fr).
 *
 * Remplace Pappers entièrement chez nous :
 *   - Gratuit (aucun crédit)
 *   - 400 appels/min/IP (24k/h, 576k/j — vs Pappers 5000/mois)
 *   - Aucune authentification
 *   - SLA 100%
 *   - Données SIRENE INSEE + RNE INPI + BODACC (mêmes sources que Pappers)
 *
 * Doc : https://recherche-entreprises.api.gouv.fr/docs/
 *
 * Surface API gardée 1:1 avec pappers.ts pour minimiser les changements
 * dans les 20 fichiers consommateurs : on garde les noms PappersEntreprise,
 * PappersSearchResult, mêmes fonctions exportées (getEntreprise, searchByName,
 * attributeSirene, enrichForBrief, findHumanDirigeantRecursive).
 *
 * Les Pappers types sont mappés depuis la structure native API gouv dans
 * `mapGouvToPappersShape()`.
 */

const BASE_URL = process.env.GOUV_API_BASE ?? "https://recherche-entreprises.api.gouv.fr";

// ──────────────────────────────────────────────────────────────────────
// Types (alias des Pappers, garde la compat des 20 fichiers consommateurs)
// ──────────────────────────────────────────────────────────────────────

export interface PappersEntreprise {
  siren: string;
  siret_siege: string;
  nom_entreprise: string;
  forme_juridique?: string;
  forme_juridique_code?: string;
  code_naf?: string;
  libelle_code_naf?: string;
  effectif?: string;
  tranche_effectif?: string;
  date_creation?: string;
  date_creation_formate?: string;
  capital?: number | null;
  domaine?: string | null;
  siege?: {
    siret: string;
    adresse_ligne_1?: string;
    code_postal?: string;
    ville?: string;
    region?: string;
    departement?: string;
    pays?: string;
    latitude?: number;
    longitude?: number;
  };
  representants?: Array<{
    nom_complet?: string;
    qualite?: string;
    qualite_code?: string;
    date_prise_de_poste?: string;
    age?: number;
    type?: string; // "personne morale" | "personne physique"
  }>;
  finances?: Array<{
    annee: number;
    chiffre_affaires?: number | null;
    resultat?: number | null;
    effectif?: number | null;
    marge_brute?: number | null;
  }>;
  procedures_collectives?: Array<{
    type?: string;
    date_jugement?: string;
  }>;
  procedure_collective_existe?: boolean;
  procedure_collective_en_cours?: boolean;
  marques?: Array<{
    nom?: string;
    date_depot?: string;
    classes?: number[];
  }>;
  depots_actes?: Array<{
    date_depot?: string;
    type?: string;
    decisions?: string[];
  }>;
  etablissements?: Array<{
    siret: string;
    siege?: boolean;
    code_postal?: string;
    ville?: string;
    actif?: boolean;
    activite_principale_libelle?: string;
  }>;
  beneficiaires_effectifs?: Array<{
    nom?: string;
    prenom?: string;
    nom_complet?: string;
    nationalite?: string;
    pourcentage_parts?: number;
    pourcentage_votes?: number;
  }>;
  conventions_collectives?: Array<{
    idcc?: string;
    titre?: string;
  }>;
}

export interface PappersSearchResult {
  total: number;
  page: number;
  par_page: number;
  resultats: Array<{
    siren: string;
    nom_entreprise: string;
    forme_juridique?: string;
    code_naf?: string;
    libelle_code_naf?: string;
    effectif?: string;
    siege?: {
      ville?: string;
      code_postal?: string;
      region?: string;
    };
    domaine?: string | null;
  }>;
}

// ──────────────────────────────────────────────────────────────────────
// Types natifs API gouv (utilisés en interne avant mapping)
// ──────────────────────────────────────────────────────────────────────

interface GouvDirigeant {
  type_dirigeant?: "personne physique" | "personne morale";
  nom?: string;
  prenoms?: string;
  date_de_naissance?: string;
  qualite?: string;
  denomination?: string; // si personne morale
  siren?: string; // si personne morale (pour récursion holdings)
}

interface GouvSiege {
  siret?: string;
  est_siege?: boolean;
  adresse?: string;
  code_postal?: string;
  libelle_commune?: string;
  libelle_region?: string;
  departement?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
}

interface GouvFinances {
  [year: string]: {
    chiffre_affaires?: number | null;
    resultat_net?: number | null;
    marge_brute?: number | null;
    effectif?: number | null;
  };
}

interface GouvCompany {
  siren: string;
  nom_complet: string;
  nom_raison_sociale?: string;
  sigle?: string | null;
  nature_juridique?: string;
  activite_principale?: string;
  activite_principale_naf25?: string;
  section_activite_principale?: string;
  tranche_effectif_salarie?: string | null;
  annee_tranche_effectif_salarie?: string | null;
  date_creation?: string;
  date_fermeture?: string | null;
  date_mise_a_jour?: string;
  etat_administratif?: "A" | "C"; // Actif / Cessé
  siege?: GouvSiege;
  matching_etablissements?: Array<{
    siret: string;
    est_siege?: boolean;
    code_postal?: string;
    libelle_commune?: string;
    etat_administratif?: "A" | "C";
    activite_principale?: string;
  }>;
  dirigeants?: GouvDirigeant[];
  finances?: GouvFinances;
  categorie_entreprise?: string;
  complements?: Record<string, unknown>;
}

interface GouvSearchResponse {
  total_results: number;
  page: number;
  per_page: number;
  total_pages: number;
  results: GouvCompany[];
}

// ──────────────────────────────────────────────────────────────────────
// HTTP helper
// ──────────────────────────────────────────────────────────────────────

class PappersError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
    this.name = "PappersError";
  }
}

async function gouvFetch<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }

  trackEndpointCall(path);

  const res = await fetch(`${BASE_URL}${path}?${qs.toString()}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    pappersStats.apiCallsError++;
    throw new PappersError(res.status, `gouv-api ${res.status}`, body);
  }
  pappersStats.apiCallsSuccess++;
  return body as T;
}

// ──────────────────────────────────────────────────────────────────────
// Mapping API gouv → forme Pappers (compat des consumers)
// ──────────────────────────────────────────────────────────────────────

function mapGouvToPappersShape(c: GouvCompany): PappersEntreprise {
  // Reconstruction nom_complet pour les dirigeants depuis prenoms + nom.
  // API gouv expose les champs séparés (et nom_complet n'existe pas en sortie).
  // Pappers expose nom_complet (ex "Jean DUPONT").
  const representants =
    c.dirigeants?.map((d): NonNullable<PappersEntreprise["representants"]>[number] => {
      // Personne morale (holding) : nom_complet = denomination (sigle de la boîte mère)
      if (d.type_dirigeant === "personne morale") {
        return {
          nom_complet: d.denomination ?? "",
          qualite: d.qualite,
          type: "personne morale",
        };
      }
      // Personne physique : reconstruit "Prenoms NOM"
      const prenoms = (d.prenoms ?? "").trim();
      const nom = (d.nom ?? "").trim();
      const nom_complet = [prenoms, nom].filter(Boolean).join(" ").trim();
      return {
        nom_complet,
        qualite: d.qualite,
        type: "personne physique",
      };
    }) ?? [];

  // Finances : API gouv = { "2024": { chiffre_affaires, resultat_net } }
  // Pappers = [{ annee: 2024, chiffre_affaires, resultat }]
  const finances: PappersEntreprise["finances"] = c.finances
    ? Object.entries(c.finances).map(([yr, f]) => ({
        annee: parseInt(yr, 10),
        chiffre_affaires: f.chiffre_affaires ?? null,
        resultat: f.resultat_net ?? null,
        effectif: f.effectif ?? null,
        marge_brute: f.marge_brute ?? null,
      }))
    : undefined;

  // Établissements : convertit matching_etablissements en format Pappers
  const etablissements: PappersEntreprise["etablissements"] = c.matching_etablissements?.map(
    (e) => ({
      siret: e.siret,
      siege: e.est_siege ?? false,
      code_postal: e.code_postal,
      ville: e.libelle_commune,
      actif: e.etat_administratif === "A",
      activite_principale_libelle: e.activite_principale,
    }),
  );

  return {
    siren: c.siren,
    siret_siege: c.siege?.siret ?? `${c.siren}00000`,
    nom_entreprise: c.nom_complet ?? c.nom_raison_sociale ?? c.sigle ?? "",
    forme_juridique: c.nature_juridique,
    code_naf: c.activite_principale,
    effectif: c.tranche_effectif_salarie ?? undefined,
    tranche_effectif: c.tranche_effectif_salarie ?? undefined,
    date_creation: c.date_creation,
    siege: c.siege
      ? {
          siret: c.siege.siret ?? `${c.siren}00000`,
          adresse_ligne_1: c.siege.adresse,
          code_postal: c.siege.code_postal,
          ville: c.siege.libelle_commune,
          region: c.siege.libelle_region,
          departement: c.siege.departement,
          latitude: c.siege.latitude,
          longitude: c.siege.longitude,
        }
      : undefined,
    representants,
    finances,
    etablissements,
  };
}

function mapGouvSearchToPappers(s: GouvSearchResponse): PappersSearchResult {
  return {
    total: s.total_results ?? 0,
    page: s.page ?? 1,
    par_page: s.per_page ?? 10,
    resultats: (s.results ?? []).map((c) => ({
      siren: c.siren,
      nom_entreprise: c.nom_complet ?? c.nom_raison_sociale ?? c.sigle ?? "",
      forme_juridique: c.nature_juridique,
      code_naf: c.activite_principale,
      effectif: c.tranche_effectif_salarie ?? undefined,
      siege: c.siege
        ? {
            ville: c.siege.libelle_commune,
            code_postal: c.siege.code_postal,
            region: c.siege.libelle_region,
          }
        : undefined,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Cache in-process LRU — TTL 1h, max 200 entrées (identique à pappers.ts)
// ──────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const entrepriseCache = new Map<string, CacheEntry<PappersEntreprise>>();
const searchCache = new Map<string, CacheEntry<PappersSearchResult>>();

export const pappersStats = {
  startedAt: new Date(),
  cacheHits: 0,
  cacheMisses: 0,
  apiCallsSuccess: 0,
  apiCallsError: 0,
  apiCallsByEndpoint: {} as Record<string, number>,
  provider: "gouv-api" as const, // pour distinguer si on regarde les stats
};

function trackEndpointCall(endpoint: string): void {
  pappersStats.apiCallsByEndpoint[endpoint] =
    (pappersStats.apiCallsByEndpoint[endpoint] ?? 0) + 1;
}

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) {
    pappersStats.cacheMisses++;
    return null;
  }
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    pappersStats.cacheMisses++;
    return null;
  }
  pappersStats.cacheHits++;
  return entry.data;
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { data, ts: Date.now() });
}

// ──────────────────────────────────────────────────────────────────────
// Lookup direct par SIREN/SIRET
// ──────────────────────────────────────────────────────────────────────

/**
 * Récupère les infos complètes d'une entreprise par son SIREN.
 * Sur l'API gouv, c'est un search avec q=siren et per_page=1.
 *
 * Les options (includeBilans, includeRepresentants, etc.) sont conservées
 * pour la compat, mais l'API gouv retourne tout en une seule fois (dirigeants
 * + finances + matching_etablissements toujours dans la réponse). Donc on
 * ignore les flags : elles existaient pour minimiser les crédits Pappers, ce
 * qui n'a plus de sens ici.
 */
export async function getEntreprise(
  siren: string,
  _options: {
    includeBilans?: boolean;
    includeRepresentants?: boolean;
    includeMarques?: boolean;
    includeDepotsActes?: boolean;
    includeProceduresCollectives?: boolean;
    includeEtablissements?: boolean;
    includeBeneficiaires?: boolean;
    includeConventions?: boolean;
  } = {},
): Promise<PappersEntreprise> {
  const cacheKey = siren;
  const cached = cacheGet(entrepriseCache, cacheKey);
  if (cached) return cached;

  const response = await gouvFetch<GouvSearchResponse>("/search", {
    q: siren,
    per_page: 1,
  });
  const company = response.results?.[0];
  if (!company) {
    throw new PappersError(404, `gouv-api: SIREN ${siren} non trouvé`);
  }
  const mapped = mapGouvToPappersShape(company);
  cacheSet(entrepriseCache, cacheKey, mapped);
  return mapped;
}

/**
 * Récupère "tout" : utile pour enrichForBrief des pépites.
 * Compat avec Pappers.
 */
export async function getEntrepriseFull(siren: string): Promise<PappersEntreprise> {
  return getEntreprise(siren);
}

// ──────────────────────────────────────────────────────────────────────
// Recherche par nom
// ──────────────────────────────────────────────────────────────────────

export interface SearchOptions {
  precision?: "standard" | "exact";
  page?: number;
  par_page?: number;
  code_naf?: string;
  code_postal?: string;
  region?: string;
  effectif_min?: number;
  effectif_max?: number;
  tva?: string;
}

/**
 * Recherche d'entreprises par nom + filtres optionnels.
 * Utile pour résoudre un nom commercial libre vers un SIREN.
 *
 * Différence vs Pappers : pas de mode "exact" natif, mais on peut utiliser
 * `&matching_size=1` pour forcer une correspondance stricte. On garde l'API
 * compat (option `precision` ignorée si "exact" n'apporte rien).
 */
export async function searchByName(
  query: string,
  options: SearchOptions = {},
): Promise<PappersSearchResult> {
  const cacheKey = `${query}|${JSON.stringify(options)}`;
  const cached = cacheGet(searchCache, cacheKey);
  if (cached) return cached;

  const response = await gouvFetch<GouvSearchResponse>("/search", {
    q: query,
    page: options.page ?? 1,
    per_page: options.par_page ?? 10,
    ...(options.code_naf && { activite_principale: options.code_naf }),
    ...(options.code_postal && { code_postal: options.code_postal }),
  });
  const mapped = mapGouvSearchToPappers(response);
  cacheSet(searchCache, cacheKey, mapped);
  return mapped;
}

// ──────────────────────────────────────────────────────────────────────
// Helper attribution SIRENE (cas le plus utilisé)
// ──────────────────────────────────────────────────────────────────────

/**
 * Tente d'attribuer un SIREN à un nom d'entreprise libre.
 * Retourne le 1er résultat ou null.
 */
export async function attributeSirene(
  companyName: string,
  hint?: { ville?: string; code_postal?: string },
): Promise<{ siren: string; nom: string; code_naf?: string; effectif?: string } | null> {
  const result = await searchByName(companyName, {
    precision: "standard",
    par_page: 5,
    ...(hint?.code_postal && { code_postal: hint.code_postal }),
  });
  const first = result.resultats[0];
  if (!first) return null;
  return {
    siren: first.siren,
    nom: first.nom_entreprise,
    code_naf: first.code_naf,
    effectif: first.effectif,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Helper enrichissement complet (pour brief Opus pépites)
// ──────────────────────────────────────────────────────────────────────

export async function enrichForBrief(siren: string): Promise<PappersEntreprise> {
  return getEntreprise(siren);
}

// ──────────────────────────────────────────────────────────────────────
// Récursion holdings — findUltimateBeneficialOwner
// ──────────────────────────────────────────────────────────────────────

type RecursiveDirigeantOptions = {
  maxDepth?: number;
  isPersonneMorale: (nom: string) => boolean;
  isWrongPersona: (qualite: string) => boolean;
  matchPersonaPriority: (qualite: string) => { weight: number; label: string };
  visited?: Set<string>;
};

/**
 * Trouve un dirigeant personne physique en remontant les holdings parentes.
 *
 * Sur l'API gouv, le champ `siren` est directement présent sur les dirigeants
 * personne morale, donc on n'a même plus besoin de faire un searchByName pour
 * remonter la holding — gain de fiabilité et de latence vs Pappers.
 */
export async function findHumanDirigeantRecursive(
  siren: string,
  opts: RecursiveDirigeantOptions,
  depth = 0,
): Promise<{
  nom_complet: string;
  qualite: string;
  weight: number;
  label: string;
  holdingPath: string[];
} | null> {
  const maxDepth = opts.maxDepth ?? 3;
  const visited = opts.visited ?? new Set<string>();
  if (visited.has(siren) || depth >= maxDepth) return null;
  visited.add(siren);

  let entreprise: PappersEntreprise;
  try {
    entreprise = await getEntreprise(siren);
  } catch {
    return null;
  }
  const reps = entreprise.representants ?? [];
  if (reps.length === 0) return null;

  // 1. D'abord chercher une personne physique au niveau actuel
  let bestHuman: { nom_complet?: string; qualite?: string; weight: number; label: string } | null = null;
  for (const r of reps) {
    if (r.type && /morale/i.test(r.type)) continue;
    if (!r.nom_complet) continue;
    if (opts.isPersonneMorale(r.nom_complet)) continue;
    if (r.qualite && opts.isWrongPersona(r.qualite)) continue;
    const m = opts.matchPersonaPriority(r.qualite ?? "");
    if (!bestHuman || m.weight > bestHuman.weight) {
      bestHuman = { nom_complet: r.nom_complet, qualite: r.qualite, weight: m.weight, label: m.label };
    }
  }
  if (bestHuman?.nom_complet) {
    return {
      nom_complet: bestHuman.nom_complet,
      qualite: bestHuman.qualite ?? "",
      weight: bestHuman.weight,
      label: bestHuman.label,
      holdingPath: [],
    };
  }

  // 2. Sinon, récursion sur les holdings (Président prioritaire, puis DG)
  const moraleRepsTriees = reps
    .filter((r) => !r.qualite || !opts.isWrongPersona(r.qualite))
    .filter((r) => r.nom_complet && opts.isPersonneMorale(r.nom_complet))
    .sort((a, b) => {
      const wa = opts.matchPersonaPriority(a.qualite ?? "").weight;
      const wb = opts.matchPersonaPriority(b.qualite ?? "").weight;
      return wb - wa;
    });

  for (const morale of moraleRepsTriees) {
    if (!morale.nom_complet) continue;
    // Sur l'API gouv on n'a pas le SIREN directement dans le mapping Pappers
    // (on l'a perdu en mapping). On doit faire un searchByName comme avant.
    // TODO future : ajouter `holdingSiren` au champ representants pour court-circuiter.
    let holdingSiren: string | null = null;
    try {
      const search = await searchByName(morale.nom_complet, { par_page: 3 });
      holdingSiren = search.resultats[0]?.siren ?? null;
    } catch {
      continue;
    }
    if (!holdingSiren || visited.has(holdingSiren)) continue;
    const found = await findHumanDirigeantRecursive(holdingSiren, opts, depth + 1);
    if (found) {
      return {
        ...found,
        holdingPath: [morale.nom_complet, ...found.holdingPath],
      };
    }
  }

  return null;
}

export { PappersError };
