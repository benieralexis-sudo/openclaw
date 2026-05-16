// Sprint catalogue (16/05/2026) — Détecteur de leadership-change (B2 catalogue).
//
// Signal d'achat : nouveau VP/C-Level <90j veut faire ses preuves en 100 jours,
// donc ouvert à essayer de nouveaux outils. Corrélation conversion +27%
// (mesurée sur 1M+ B2B purchases, source LeadGenius).
//
// Source : Pappers `representants[].date_prise_de_poste` (déjà fetched par
// enrich-lead-dirigeants.ts). Pas d'appel Pappers supplémentaire = coût marginal 0.
//
// Logique pure (testable trivialement, aucune I/O).

/**
 * Représentant Pappers minimal pour le détecteur.
 * (Sous-ensemble de PappersEntreprise.representants[])
 */
export interface PappersRepresentant {
  nom_complet?: string;
  qualite?: string;
  date_prise_de_poste?: string; // "2026-04-15" ou "15-04-2026"
  type?: string; // si "morale" → exclus
}

/**
 * Match détecté : un dirigeant cible avec prise de poste récente.
 */
export interface RecentLeadership {
  nom_complet: string;
  qualite: string;
  daysAgo: number;
  weight: number; // priorité du titre (10=CTO, 8=CEO, etc.)
  label: string; // label normalisé (CTO, CEO, VP Engineering, etc.)
  date_prise_de_poste: string; // ISO date originale
}

// Catalogue des titres cibles pour LEADERSHIP_CHANGE.
// Mêmes patterns que matchPersonaPriority de enrich-lead-dirigeants.ts pour
// cohérence (en plus de Sales/CRO/CMO/CFO qui sont aussi pertinents pour B2).
const LEADERSHIP_PATTERNS: Array<{ regex: RegExp; label: string; weight: number }> = [
  { regex: /\bCTO\b|chief\s+technology|directeur\s+technique/i, label: "CTO", weight: 10 },
  { regex: /vp\s+engineering|head\s+of\s+engineering|engineering\s+manager/i, label: "VP / Head of Engineering", weight: 9 },
  { regex: /\bCEO\b|chief\s+executive|président\s+du\s+directoire/i, label: "CEO", weight: 9 },
  { regex: /\bCRO\b|chief\s+revenue/i, label: "CRO", weight: 9 },
  { regex: /vp\s+sales|head\s+of\s+sales|directeur\s+(des?\s+)?ventes?\b|directeur\s+commercial/i, label: "VP / Head of Sales", weight: 9 },
  { regex: /\bCMO\b|chief\s+marketing|directeur\s+marketing|vp\s+marketing|head\s+of\s+marketing/i, label: "CMO / Head of Marketing", weight: 8 },
  { regex: /\bCFO\b|chief\s+financial|directeur\s+financier|vp\s+finance/i, label: "CFO", weight: 8 },
  { regex: /\bCOO\b|chief\s+operating|directeur\s+des?\s+opérations?/i, label: "COO", weight: 8 },
  { regex: /\bCPO\b|chief\s+product|head\s+of\s+product|vp\s+product/i, label: "CPO / Head of Product", weight: 8 },
  { regex: /président|fondateur|founder/i, label: "Président / Fondateur", weight: 7 },
  { regex: /\bDG\b|directeur\s+général|gérant/i, label: "Directeur Général / Gérant", weight: 6 },
];

/**
 * Match un titre Pappers contre les patterns LEADERSHIP. Retourne null si pas
 * un titre cible (ex: "Représentant permanent", "Administrateur").
 */
function matchLeadershipTitle(qualite: string | undefined): { label: string; weight: number } | null {
  if (!qualite) return null;
  for (const p of LEADERSHIP_PATTERNS) {
    if (p.regex.test(qualite)) return { label: p.label, weight: p.weight };
  }
  return null;
}

/**
 * Filtre les titres non-décisionnaires (commissaires, suppléants, conseil).
 * Repris à l'identique de enrich-lead-dirigeants.ts pour cohérence.
 */
function isWrongPersona(qualite: string | undefined): boolean {
  if (!qualite) return false;
  return /commissaire\s+aux\s+comptes|expert[\s-]comptable|administrateur\s+judiciaire|liquidateur|censeur|représentant\s+permanent|membre\s+du\s+conseil|conseil\s+de\s+surveillance|administrateur(\s|$)|suppléant/i.test(qualite);
}

/**
 * Parse une date Pappers (format souvent "2026-04-15" mais parfois "15-04-2026").
 * Retourne null si parsing échoue.
 */
function parsePappersDate(s: string | undefined): Date | null {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  if (trimmed.length === 0) return null;
  // Format ISO YYYY-MM-DD (préféré Pappers)
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }
  // Format français DD-MM-YYYY ou DD/MM/YYYY
  const fr = trimmed.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (fr) {
    const d = new Date(`${fr[3]}-${fr[2]}-${fr[1]}`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Calcule le nombre de jours entre une date Pappers et maintenant (now).
 * Retourne null si la date est invalide ou future.
 */
function daysSince(dateStr: string | undefined, now: Date = new Date()): number | null {
  const d = parsePappersDate(dateStr);
  if (!d) return null;
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return null; // date future = invalide
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Détecte les dirigeants ICP fraîchement nommés (<windowDays jours).
 *
 * Filtres :
 *   - Pas une personne morale (type ne contient pas "morale")
 *   - Pas un titre non-décisionnaire (commissaire, suppléant, etc.)
 *   - Titre matche un pattern LEADERSHIP (CEO/CTO/VP/Head/Director/Chief)
 *   - date_prise_de_poste < windowDays
 *
 * Tri : par weight desc (le plus senior d'abord), puis par daysAgo asc
 * (le plus récent d'abord).
 *
 * @param representants liste Pappers.representants
 * @param options.windowDays seuil de fraîcheur (default 90)
 * @param options.now horloge injectable pour les tests
 */
export function detectRecentLeadership(
  representants: PappersRepresentant[] | undefined | null,
  options: { windowDays?: number; now?: Date } = {},
): RecentLeadership[] {
  if (!Array.isArray(representants) || representants.length === 0) return [];

  const windowDays = options.windowDays ?? 90;
  const now = options.now ?? new Date();
  const results: RecentLeadership[] = [];

  for (const r of representants) {
    if (!r || typeof r !== "object") continue;
    if (r.type && /morale/i.test(r.type)) continue;
    if (!r.nom_complet || typeof r.nom_complet !== "string") continue;
    if (isWrongPersona(r.qualite)) continue;

    const match = matchLeadershipTitle(r.qualite);
    if (!match) continue;

    const days = daysSince(r.date_prise_de_poste, now);
    if (days === null) continue; // pas de date OU date future = on ignore
    if (days > windowDays) continue;

    results.push({
      nom_complet: r.nom_complet,
      qualite: r.qualite ?? "",
      daysAgo: days,
      weight: match.weight,
      label: match.label,
      date_prise_de_poste: r.date_prise_de_poste ?? "",
    });
  }

  // Tri : weight desc, puis daysAgo asc
  results.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.daysAgo - b.daysAgo;
  });

  return results;
}
