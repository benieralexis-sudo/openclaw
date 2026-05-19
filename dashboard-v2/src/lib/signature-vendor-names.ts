/**
 * Module partagé Jour 14 Sujet 10 (19/05/2026) — Liste centralisée des
 * noms de vendors concurrents sur le marché signature électronique FR/UE
 * + helper pour distinguer signal générique vs vendor-only match.
 *
 * Pourquoi un module séparé : la même heuristique est appliquée sur 5
 * pollers (apify-linkedin-signature, github, rss-medias-signature,
 * francetravail-signature, ted-europa-signature). Centraliser évite la
 * dérive entre listes et facilite l'ajout de nouveaux vendors.
 *
 * Sémantique : la mention d'un vendor dans une description / commit /
 * article est AMBIGUË :
 *   - filiale du vendor (cas SOFTEAM filiale Docaposte/La Poste, vérifié)
 *   - prestation/mission pour le vendor (ESN bossant pour DocuSign)
 *   - committer @vendor.fr signé sur un projet open-source
 *   - éditeur concurrent qui mentionne ses propres providers
 *   - adoption interne (vrai signal upgrade — minoritaire)
 *
 * Décision : skip les triggers dont TOUS les matches sont des vendor
 * names. Si la description contient aussi un terme générique
 * ("signature électronique", "parapheur", "eIDAS"...), on garde — le
 * terme générique fait foi.
 *
 * Pas applicable sur BOAMP/TED-Europa Tender → là le contexte est
 * différent (un AO mentionnant un vendor concurrent = candidat
 * migration). Ces 2 pollers gardent leur liste boampKeywords complète.
 */

export const SIGNATURE_VENDOR_NAMES = new Set([
  "docusign",
  "yousign",
  "docaposte",
  "docage",
  "universign",
  "signaturit",
  "adobe sign",
  "hellosign",
  "dropbox sign",
  "oodrive",
  "netheos",
  "pandadoc",
  "contractbook",
  "chambersign",
  "lex persona",
  "cryptolog",
  "certilia",
  "idakto",
  "incert",
  "trustsign",
  "onespan",
  "backsign",
]);

/**
 * Détermine si la liste de labels matchés contient au moins un signal
 * générique (= non vendor name). False si tous les matches sont des
 * vendors ou si la liste est vide.
 */
export function hasGenericSignatureSignal(labels: string[]): boolean {
  return labels.some((l) => !SIGNATURE_VENDOR_NAMES.has(l.toLowerCase().trim()));
}
