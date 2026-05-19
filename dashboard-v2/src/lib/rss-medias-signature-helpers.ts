// Bombora FR — Jour 10 (19/05/2026) — Helpers RSS médias FR (signature topic).
//
// Logique pure : detection mention signature keyword + extraction boîte CLIENTE
// (pas vendeur). Pas d'I/O.
//
// Différence clé vs rss-levees-helpers :
//   - rss-levees cherche la boîte SUJET d'une LEVÉE (extractCompanyName
//     cherche "X lève", "X boucle"…)
//   - ici on cherche la boîte SUJET d'une ADOPTION/MIGRATION/DEPLOIEMENT
//     de produit signature (ex : "MAIF déploie Yousign", "La Poste adopte
//     Docaposte sign").
//
// Stratégie : ne créer un trigger QUE si on identifie clairement
//   (1) au moins un mot-clé signature dans titre+description ET
//   (2) un pattern d'adoption client (X choisit/adopte/déploie/équipe…)
// Mieux vaut sous-extraire qu'extraire le vendeur par erreur.

/**
 * Verbes d'adoption client. Si on les voit dans le titre devant ou après une
 * boîte capitalisée, c'est probablement le sujet d'une migration / déploiement /
 * achat — donc un PROSPECT (côté client signature), pas le vendeur.
 *
 * Source FR : Maddyness, JDN, Frenchweb, BFM Business, LeMagIT, l'Usine Digitale.
 * Liste calibrée pour minimiser faux positifs (on évite "lance" qui matche
 * "Yousign lance une nouvelle offre" — Yousign est le vendeur).
 */
const ADOPTION_VERBS: string[] = [
  "choisit",
  "choisissent",
  "adopte",
  "adoptent",
  "déploie",
  "deploie",
  "déploient",
  "deploient",
  "équipe",
  "equipe",
  "équipent",
  "equipent",
  "passe à",
  "passe a",
  "passent à",
  "passent a",
  "passe sur",
  "passent sur",
  "bascule",
  "basculent",
  "migre vers",
  "migrent vers",
  "intègre",
  "integre",
  "intègrent",
  "integrent",
  "s'équipe",
  "s'equipe",
  "s'équipent",
  "s'equipent",
  "retient",
  "retiennent",
  "sélectionne",
  "selectionne",
  "sélectionnent",
  "selectionnent",
  "signe avec",
  "signent avec",
  "généralise",
  "generalise",
  "généralisent",
  "generalisent",
];

/**
 * Stopwords pour candidat 1er token. Évite "La Poste"→"La", "Le Monde"→"Le",
 * et les sujets éditoriaux génériques.
 */
const FIRST_TOKEN_STOPWORDS = new Set<string>([
  "le",
  "la",
  "les",
  "l",
  "un",
  "une",
  "des",
  "ce",
  "cette",
  "ces",
  "mon",
  "ton",
  "son",
  "leur",
  "leurs",
  "notre",
  "nos",
  "votre",
  "vos",
  "comment",
  "pourquoi",
  "quand",
  "où",
  "ou",
  "qui",
  "que",
  "quoi",
  "quel",
  "quelle",
  "quels",
  "quelles",
  "france",
  "français",
  "francais",
  "française",
  "francaise",
  "europe",
  "uk",
  "us",
  "usa",
  "états",
  "etats",
  "monde",
  "tribune",
  "édito",
  "edito",
  "exclusif",
  "exclusive",
  "interview",
  "podcast",
  "alerte",
  "alert",
  "scoop",
]);

/**
 * Compte le nombre de mots-clés signature distincts présents dans le texte
 * (titre + description concaténés). Insensible à la casse. Identique à la
 * fonction sœur dans apify-linkedin-signature-poller — la dupliquer ici garde
 * le module 100% pur (zéro import server-only).
 */
export function countSignatureMatchesInText(
  text: string | undefined,
  keywords: string[],
): { count: number; labels: string[] } {
  if (!text) return { count: 0, labels: [] };
  const lower = text.toLowerCase();
  const labels: string[] = [];
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (k.length === 0) continue;
    if (lower.includes(k)) labels.push(kw);
  }
  return { count: labels.length, labels };
}

/**
 * Vrai si la boîte CITÉE est un vendeur de signature (DocuSign, Yousign,
 * Docaposte, etc.) — match containment sur les keywords de longueur ≥4
 * caractères et sans espace (noms propres). Logique identique à la fonction
 * sœur dans apify-linkedin-signature-poller.
 */
export function isVendorCompany(
  companyName: string,
  keywords: string[],
): boolean {
  const name = companyName.toLowerCase();
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (k.length < 4) continue;
    if (!/\s/.test(k)) {
      if (name.includes(k)) return true;
      continue;
    }
    if (name.includes(k)) return true;
  }
  return false;
}

/**
 * Vrai si le nom de boîte candidat ressemble à un vrai nom propre.
 *   - 1er token non-stopword + capitalisé : OK direct
 *   - 1er token stopword (Le/La/Les) MAIS 2e token aussi capitalisé : OK
 *     (cas "La Poste", "Le Monde", "Les Échos" qui sont des noms propres
 *     composés légitimes). Si 2e token minuscule (ex "Le marché"), reject.
 */
function isPlausibleCompanyCandidate(candidate: string): boolean {
  if (!candidate) return false;
  const tokens = candidate.split(/\s+/).filter((t) => t.length > 0);
  const first = tokens[0] ?? "";
  if (!first || first.length < 2) return false;
  if (!/^[A-Z]/.test(first)) return false;
  if (!FIRST_TOKEN_STOPWORDS.has(first.toLowerCase())) return true;
  // Stopword en tête : on accepte SI 2e token aussi commence par majuscule.
  const second = tokens[1] ?? "";
  if (!second) return false;
  return /^[A-ZÀ-Ý]/.test(second);
}

/**
 * Détecte un pattern d'adoption client dans un titre RSS. Renvoie le nom de la
 * boîte (heuristique) si un pattern verbe-adoption est détecté ET que la boîte
 * extraite a au moins une chance d'être un vrai nom propre.
 *
 * Patterns supportés (par ordre de priorité) :
 *   1. "<Company> <ADOPTION_VERB> ..."         (sujet en tête)
 *   2. "<Company> <ADOPTION_VERB> ... <keyword>" (idem mais cible explicite)
 *   3. "<Adoption pattern> <Company> ... <keyword>"
 *      (ex : "Comment <Company> a généralisé <keyword>")
 *
 * Renvoie null si rien d'utilisable.
 */
export function extractClientCompanyFromTitle(
  title: string,
  keywords: string[],
): string | null {
  if (!title) return null;
  let t = title.trim();
  // Strip bracket préfixe (ex "[Exclusif] X choisit ...")
  t = t.replace(/^\s*\[[^\]]{1,30}\]\s*/i, "");

  // Pattern 1+2 : "<Company> <verb> ..."
  // Construction du regex avec OR de tous les verbes (échappage espaces).
  const verbsOr = ADOPTION_VERBS.map((v) =>
    v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|");
  const reSubjectFirst = new RegExp(
    `^([A-ZÀ-Ý][A-Za-zÀ-ÿ0-9\\-&\\.\\' ]{1,40}?)\\s+(?:${verbsOr})\\b`,
    "i",
  );
  const m1 = t.match(reSubjectFirst);
  if (m1) {
    const candidate = (m1[1] ?? "").trim();
    if (isPlausibleCompanyCandidate(candidate)) {
      // Anti-vendeur — si la boîte EST elle-même un keyword (DocuSign annonce),
      // on rejette : c'est un éditorial du vendeur, pas un signal d'achat.
      if (!isVendorCompany(candidate, keywords)) return candidate;
    }
  }

  // Pattern 3 : "Comment <Company> <verb> ..."
  const reAfterIntro = new RegExp(
    `^(?:comment|pourquoi|chez)\\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ0-9\\-&\\.\\' ]{1,40}?)\\s+(?:${verbsOr}|a |ont )`,
    "i",
  );
  const m2 = t.match(reAfterIntro);
  if (m2) {
    const candidate = (m2[1] ?? "").trim();
    if (isPlausibleCompanyCandidate(candidate)) {
      if (!isVendorCompany(candidate, keywords)) return candidate;
    }
  }

  return null;
}

/**
 * Feeds RSS médias FR actifs. Sélection basée sur :
 *   - Couverture FR (pas anglophone)
 *   - Mentions régulières de produits SaaS/signature dans le contenu éditorial
 *   - Format RSS valide stable
 *
 * Maddyness/Frenchweb sont déjà fetchés par rss-levees-poller, mais sous un
 * angle FUNDING. On les re-fetch ici sous l'angle ADOPTION-PRODUIT — l'idempotence
 * tient grâce au sourceCode distinct ("rss-medias.signature" vs "rss-levees").
 */
export const MEDIAS_FEEDS: Array<{ name: string; url: string }> = [
  { name: "maddyness", url: "https://www.maddyness.com/feed/" },
  { name: "frenchweb", url: "https://www.frenchweb.fr/feed" },
  { name: "journaldunet", url: "https://www.journaldunet.com/rss/" },
  // usine-digitale.fr/rss : testé live 19/05/2026 → HTTP 403 (Cloudflare),
  // retiré. À ré-essayer plus tard si on trouve un endpoint qui passe.
];
