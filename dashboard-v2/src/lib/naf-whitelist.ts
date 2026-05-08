/**
 * Filtre NAF amont — sprint Vague 3 P16 (08/05/2026).
 *
 * Évite que des leads hors-ICP entrent dans le pipeline. Les pollers (Apify,
 * TheirStack, France Travail) capturent souvent des entreprises qui matchent
 * un keyword "QA" / "test" mais dont l'activité réelle est immobilier,
 * holding patrimonial, recrutement, etc. → leads "fantômes" sans potentiel
 * commercial qui polluent le dashboard et consomment des crédits Pappers/Kaspr.
 *
 * Stratégie :
 *  - WHITELIST : NAF tech (édition logiciels, SaaS, conseil systèmes...). Si match,
 *    on garde même si autres signaux faibles.
 *  - BLACKLIST : NAF "structurels rédhibitoires" (immo, holding, recrutement...). Si
 *    match, on soft-delete IMMÉDIATEMENT à la résolution SIRENE, sans laisser
 *    consommer des crédits enrichers en aval.
 *  - Si NAF inconnu (null) : on laisse passer (moins de faux positifs).
 *
 * Audit 04-08/05 : ~78% des triggers fantômes (capturés mais soft-deleted sans
 * jamais être actionnés) avaient un NAF blacklist. Filtre ce subset = -250
 * triggers/semaine évités sur DTL.
 */

/**
 * NAF tech FR — éditeurs SaaS, conseil systèmes, programmation.
 * Source : nomenclature INSEE 2008.
 *
 * 58.21Z — Édition de jeux électroniques
 * 58.29A — Édition de logiciels système et de réseau
 * 58.29B — Édition de logiciels outils de développement
 * 58.29C — Édition de logiciels applicatifs
 * 62.01Z — Programmation informatique
 * 62.02A — Conseil en systèmes et logiciels informatiques
 * 62.02B — Tierce maintenance de systèmes
 * 62.03Z — Gestion d'installations informatiques
 * 63.11Z — Traitement de données / hébergement / activités connexes
 * 63.12Z — Portails Internet
 * 63.99Z — Autres services d'information
 * 70.22Z — Conseil pour les affaires (limite — couvre conseils tech mais aussi management)
 */
export const TECH_NAF_PREFIXES = [
  "58.21",
  "58.29",
  "62.01",
  "62.02",
  "62.03",
  "63.11",
  "63.12",
  "63.99",
  "70.22",
];

/**
 * NAF blacklist rédhibitoire — secteurs structurellement hors-ICP DTL.
 *
 * 46.46 — Commerce de gros (pas tech)
 * 64.20Z — Activités des sociétés holding (entité juridique sans activité opé)
 * 66.30Z — Gestion de fonds (asset management)
 * 68.20A/B — Location de biens immobiliers (non-tech, secteur immo)
 * 70.10Z — Activités des sièges sociaux (idem holding)
 * 77.03 — Location et location-bail
 * 78.10Z — Activités des agences de placement de main-d'œuvre (concurrents directs)
 * 78.20Z — Travail temporaire (intérim)
 * 84.13Z — Administration publique économique
 * 93.19Z — Autres activités liées au sport
 */
export const NAF_BLACKLIST_NEVER = [
  "46.46",
  "64.20",
  "66.30",
  "68.20",
  "70.10",
  "77.03",
  "78.10",
  "78.20",
  "84.13",
  "93.19",
];

/**
 * Vrai si le NAF code matche un préfixe tech-friendly.
 * Tolérant : null/undefined → false (on n'identifie pas → on ne whitelist pas).
 */
export function isTechNaf(naf: string | null | undefined): boolean {
  if (!naf) return false;
  return TECH_NAF_PREFIXES.some((p) => naf.startsWith(p));
}

/**
 * Vrai si le NAF code matche un préfixe BLACKLIST rédhibitoire.
 * Tolérant : null/undefined → false (on n'identifie pas → on ne blackliste pas).
 *
 * Cas d'usage : appelé après attribution SIRENE Pappers pour décider si on
 * soft-delete immédiatement le trigger sans l'enrichir davantage.
 */
export function isBlacklistNaf(naf: string | null | undefined): boolean {
  if (!naf) return false;
  return NAF_BLACKLIST_NEVER.some((p) => naf.startsWith(p));
}

/**
 * Verdict 3 niveaux pour audit/log :
 *  - "tech"      : whitelist tech
 *  - "blacklist" : interdit
 *  - "neutral"   : ni tech ni blacklist (ex: 47.91Z e-commerce, 62.09Z autres
 *    activités info — peut être borderline, on laisse passer)
 *  - "unknown"   : NAF non disponible
 */
export type NafVerdict = "tech" | "blacklist" | "neutral" | "unknown";

export function classifyNaf(naf: string | null | undefined): NafVerdict {
  if (!naf) return "unknown";
  if (isBlacklistNaf(naf)) return "blacklist";
  if (isTechNaf(naf)) return "tech";
  return "neutral";
}
