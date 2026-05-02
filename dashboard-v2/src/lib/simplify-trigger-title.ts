/**
 * Simplifie un titre de Trigger pour l'affichage commercial.
 *
 * Cas réels observés en DB :
 *  - Rodz recruitment : "Digi Test Lab — Campagne recrutement Test — Collective.work"
 *  - Rodz job_offers  : "Digi Test Lab — Recrutement QA/Testeur (HOT) — Collective.work"
 *  - Apify LinkedIn   : "Ingénieur QA H/F (QA match)"
 *  - Apify Indeed     : "Ingénieur banc de tests H/F - 042026/PST/ERZ"
 *
 * Nettoyages :
 *  1. Strip suffixe " — [companyName]" (déjà affiché en haut de la fiche)
 *  2. Strip préfixe "[texte] — " si le 1er segment ressemble à un nom de
 *     client iFIND (Digi Test Lab, etc.) — heuristique : le 1er segment
 *     est court (<25 chars) ET pas le mot principal du signal
 *  3. Strip parenthèses parasites : (HOT), (QA match), (combo)
 *  4. Strip IDs internes type " - 042026/PST/ERZ"
 *
 * Module 100% PUR : zéro dépendance React/DB. Testable unitairement.
 */

const PARASITE_PARENS_RE = /\s*\((?:hot|qa\s*match|combo|combo\s*\d+)\)\s*/gi;
const INTERNAL_ID_RE = /\s+-\s+\d{4,}[\/_][\w/]+\s*$/;

export function simplifyTriggerTitle(title: string | null | undefined, companyName: string): string {
  if (!title) return "";
  let result = String(title).trim();

  // 1. Strip préfixe "[client] — " si 3+ segments séparés par " — "
  //    (cas Rodz : "Client iFIND — Type signal — Société cible").
  //    Doit être fait AVANT le strip suffixe car celui-ci réduit le nombre
  //    de segments. Avec seulement 2 segments (ex "Levée — 15MUSD"), on
  //    préserve tout car le 1er segment est probablement le mot-clé.
  const dashSplit = result.split(" — ");
  if (dashSplit.length >= 3 && dashSplit[0]!.length < 25) {
    result = dashSplit.slice(1).join(" — ").trim();
  }

  // 2. Strip suffixe " — [companyName]" (déjà affiché en haut de la fiche)
  if (companyName) {
    const suffix = ` — ${companyName}`;
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length).trim();
    }
  }

  // 3. Strip parenthèses parasites
  result = result.replace(PARASITE_PARENS_RE, " ").trim();

  // 4. Strip IDs internes type " - 042026/PST/ERZ"
  result = result.replace(INTERNAL_ID_RE, "").trim();

  // Trim espaces résiduels (multiples espaces internes)
  result = result.replace(/\s{2,}/g, " ").trim();

  return result;
}
