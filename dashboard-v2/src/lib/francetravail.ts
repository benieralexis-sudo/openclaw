import "server-only";

/**
 * Client API France Travail (ex-Pôle Emploi).
 * Doc : https://francetravail.io/data/api/offres-emploi
 * Auth : OAuth2 client_credentials, free tier 3000 req/jour.
 *
 * Logique reprise (et simplifiée) de skills/trigger-engine/sources/francetravail.js
 * (architecture v1) pour usage natif dashboard-v2.
 */

const FT_API = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
const OAUTH_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire";

// Cache token OAuth (typiquement 24h, on garde 60s buffer)
const tokenCache: { token: string | null; expiresAt: number } = {
  token: null,
  expiresAt: 0,
};

export async function getFranceTravailToken(): Promise<string> {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const clientId = process.env.FRANCETRAVAIL_CLIENT_ID;
  const clientSecret = process.env.FRANCETRAVAIL_CLIENT_SECRET;
  const scope = process.env.FRANCETRAVAIL_SCOPE ?? "api_offresdemploiv2 o2dsoffre";
  if (!clientId || !clientSecret) {
    throw new Error("FRANCETRAVAIL_CLIENT_ID + FRANCETRAVAIL_CLIENT_SECRET required");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`France Travail OAuth ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache.token = data.access_token;
  tokenCache.expiresAt = Date.now() + (data.expires_in ?? 1500) * 1000 - 60000;
  return data.access_token;
}

export interface FranceTravailOffer {
  id: string;
  intitule: string;
  description?: string;
  dateCreation?: string;
  entreprise?: { nom?: string; siret?: string; description?: string };
  lieuTravail?: { libelle?: string; codePostal?: string };
  typeContrat?: string;
  appellationlibelle?: string;
  romeLibelle?: string;
  romeCode?: string;
  origineOffre?: { urlOrigine?: string };
}

export interface SearchOffersOptions {
  /** ISO date (sans Z) `2026-05-01T12:00:00` */
  minCreationDate: string;
  maxCreationDate: string;
  /** Filtre code(s) ROME séparés par virgule, ex "M1805,M1810" pour info+systèmes */
  codeROME?: string;
  /** Mot-clé de recherche full-text (sur titre+desc) */
  motsCles?: string;
  /** Range pagination "0-149" max */
  range?: string;
  /** Code département(s) FR séparés par virgule, ex "75,92,69" */
  departement?: string;
}

export async function searchFranceTravailOffers(
  opts: SearchOffersOptions,
): Promise<FranceTravailOffer[]> {
  const token = await getFranceTravailToken();
  const params = new URLSearchParams({
    minCreationDate: opts.minCreationDate,
    maxCreationDate: opts.maxCreationDate,
    range: opts.range ?? "0-149",
  });
  if (opts.codeROME) params.set("codeROME", opts.codeROME);
  if (opts.motsCles) params.set("motsCles", opts.motsCles);
  if (opts.departement) params.set("departement", opts.departement);

  const res = await fetch(`${FT_API}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.status === 204) return []; // No content = aucun résultat
  if (!res.ok) {
    throw new Error(`France Travail API ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { resultats?: FranceTravailOffer[] };
  return data.resultats ?? [];
}

// ────────────────────────────────────────────────────────────────────
// Filtres anti-bruit (agences intérim + collectivités/écoles/restaurants)
// Liste reprise de skills/trigger-engine/sources/francetravail.js
// ────────────────────────────────────────────────────────────────────

const STAFFING_AGENCIES = [
  "adecco", "manpower", "randstad", "crit", "synergie", "proman",
  "expectra", "kelly services", "gi group", "start people", "leader intérim",
  "supplay", "rh intérim", "actual", "domino rh", "partnaire",
  "temporis", "adia", "aquila rh", "pole emploi",
  "menway", "team emploi", "ras", "omega interim", "rinesa", "axeo",
];

const DISQUALIFYING_KEYWORDS = [
  "interim", "intérim", "emploi",
  "mairie", "commune de ", "conseil departemental", "conseil régional",
  "ccas", "centre communal", "communaute de communes",
  "formation", " cfa", "académie",
  "restaurant", "brasserie", " cafe", " café",
  "paroisse", "diocese", "diocèse",
  "boulangerie", "patisserie", "boucherie", "poissonnerie",
  "metropole", "métropole",
  "carrefour ", "auchan ", "leclerc ", "intermarche",
  "fnac", "darty", "boulanger", "conforama", "ikea france",
  "mcdonald", "burger king", "subway", "starbucks",
  "decathlon", "castorama", "leroy merlin", "bricorama",
  "bibliotheque", "bibliothèque", "musée", "musee",
];

function normalizeName(nom: string): string {
  return nom
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['']/g, " ")
    .replace(/\s+/g, " ");
}

export function isFTBlacklisted(nom: string | undefined): boolean {
  if (!nom) return true;
  const n = normalizeName(nom);
  if (STAFFING_AGENCIES.some((bad) => n === bad || n.startsWith(bad + " ") || n.startsWith(bad + "-"))) return true;
  const padded = " " + n + " ";
  return DISQUALIFYING_KEYWORDS.some((kw) => padded.includes(kw));
}

/**
 * Détecte si une offre est tech (dev, QA, devops, data, etc.) — utilisée
 * pour filtrer côté DTL (uniquement les offres tech sont d'intérêt).
 */
export function isFTTechOffer(intitule: string): boolean {
  const text = intitule
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return /\b(developp(eur|er|euse)|developer|programmeur|coder|software engineer|software developer)\b/.test(text)
    || /\b(ingenieur (logiciel|informatique|d['e]tudes|systeme|reseau|cloud|data|devops|qa|test|electronique|embarque))\b/.test(text)
    || /\b(data (engineer|scientist|analyst|architect)|machine learning|ia\b|intelligence artificielle)\b/.test(text)
    || /\b(devops|sre|site reliability|platform engineer|cloud engineer|architect(e|ure) (logiciel|technique|cloud|data|solution))\b/.test(text)
    || /\b(qa\b|quality assurance|testeur (logiciel|informatique|qa)|automaticien test|technicien test|ingenieur test|ingenieur validation)\b/.test(text)
    || /\b(frontend|front[- ]end|backend|back[- ]end|fullstack|full[- ]stack)\b/.test(text)
    || /\b(scrum master|product owner|po\b|lead dev|tech lead|staff engineer|engineering manager|cto)\b/.test(text);
}

/**
 * Détecte si l'offre matche QA/Test (= signal #1 DTL, score plancher 8).
 */
export function isFTQaOffer(intitule: string): boolean {
  const text = intitule
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return /\b(qa\b|quality assurance|assurance qualit[eé])\b/.test(text)
    || /\btesteur (logiciel|informatique|qa|automatis|fonctionnel)\b/.test(text)
    || /\bingenieur (test|qa|validation|automatisation test)\b/.test(text)
    || /\b(test lead|qa lead|sdet|software engineer in test|test automation)\b/.test(text);
}
