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

  const res = await fetch(`${BASE_URL}${path}?${qs.toString()}`, { signal: AbortSignal.timeout(20_000) });
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

// ──────────────────────────────────────────────────────────────────────
// Récursion holdings — findUltimateBeneficialOwner
// ──────────────────────────────────────────────────────────────────────

/**
 * Trouve un dirigeant personne physique en remontant les holdings parentes.
 *
 * Cas d'usage : entreprises FR détenues par des holdings (très courant pour
 * les PME 11-200p) où Pappers ne renvoie que des personnes morales en
 * représentants directs. La récursion remonte jusqu'à 3 niveaux pour
 * trouver le vrai humain (typiquement le fondateur).
 *
 * Coût : forfait Pappers fixe → 0€ supplémentaire par appel.
 *
 * Retourne :
 * - { nom_complet, qualite, holdingPath } si humain trouvé
 * - null si aucun humain trouvé en max 3 niveaux ou loop détectée
 */
type RecursiveDirigeantOptions = {
  maxDepth?: number;
  isPersonneMorale: (nom: string) => boolean;
  isWrongPersona: (qualite: string) => boolean;
  matchPersonaPriority: (qualite: string) => { weight: number; label: string };
  visited?: Set<string>;
};

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
    entreprise = await getEntreprise(siren, { includeRepresentants: true });
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
    // Cherche le SIREN de la holding via /recherche
    let holdingSiren: string | null = null;
    try {
      const search = await searchByName(morale.nom_complet, { precision: "exact", par_page: 3 });
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
