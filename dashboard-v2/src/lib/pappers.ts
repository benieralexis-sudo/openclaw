import "server-only";

/**
 * Client typé pour l'API Pappers v2 (https://api.pappers.fr).
 *
 * Auth : api_token dans la query string (PAPPERS_API_TOKEN).
 * Doc : https://www.pappers.fr/api/documentation
 *
 * Phase 3.C — branché au dashboard pour enrichissement on-demand depuis
 * les pages détail trigger/lead. Le bot Trigger Engine utilise déjà
 * Pappers depuis avril.
 */

const BASE_URL = process.env.PAPPERS_API_BASE ?? "https://api.pappers.fr";

// ──────────────────────────────────────────────────────────────────────
// Types
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
    type?: string;
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
  marques?: Array<{
    nom?: string;
    date_depot?: string;
    classes?: number[];
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
// HTTP helper
// ──────────────────────────────────────────────────────────────────────

class PappersError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
    this.name = "PappersError";
  }
}

async function pappersFetch<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const token = process.env.PAPPERS_API_TOKEN;
  if (!token) throw new Error("PAPPERS_API_TOKEN non configuré dans .env");

  const qs = new URLSearchParams({ api_token: token });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }

  const res = await fetch(`${BASE_URL}${path}?${qs.toString()}`);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new PappersError(
      res.status,
      `Pappers ${res.status}`,
      body,
    );
  }
  return body as T;
}

// ──────────────────────────────────────────────────────────────────────
// Lookup direct par SIREN/SIRET
// ──────────────────────────────────────────────────────────────────────

/**
 * Récupère les infos complètes d'une entreprise par son SIREN/SIRET.
 * Coût indicatif : 1 crédit Pappers.
 */
export async function getEntreprise(
  siren: string,
  options: { includeBilans?: boolean; includeRepresentants?: boolean; includeMarques?: boolean } = {},
): Promise<PappersEntreprise> {
  return pappersFetch<PappersEntreprise>("/v2/entreprise", {
    siren,
    format_publications_bodacc: "json",
    ...(options.includeBilans && { bilans: "true", finances: "true" }),
    ...(options.includeRepresentants && { representants: "true" }),
    ...(options.includeMarques && { marques: "true" }),
  });
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
 */
export async function searchByName(
  query: string,
  options: SearchOptions = {},
): Promise<PappersSearchResult> {
  return pappersFetch<PappersSearchResult>("/v2/recherche", {
    q: query,
    precision: options.precision ?? "standard",
    page: options.page ?? 1,
    par_page: options.par_page ?? 10,
    ...(options.code_naf && { code_naf: options.code_naf }),
    ...(options.code_postal && { code_postal: options.code_postal }),
    ...(options.region && { region: options.region }),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Helper attribution SIRENE (cas le plus utilisé)
// ──────────────────────────────────────────────────────────────────────

/**
 * Tente d'attribuer un SIREN à un nom d'entreprise libre.
 * Retourne le 1er résultat ou null. À utiliser avec un cache 30 jours
 * côté Trigger Engine pour éviter les requêtes répétées.
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

/**
 * Récupère les infos enrichies d'une boîte (bilans + dirigeants + marques)
 * pour un score ≥7. Coût indicatif : 2-3 crédits.
 */
export async function enrichForBrief(siren: string): Promise<PappersEntreprise> {
  return getEntreprise(siren, {
    includeBilans: true,
    includeRepresentants: true,
    includeMarques: false, // optionnel
  });
}

export { PappersError };
