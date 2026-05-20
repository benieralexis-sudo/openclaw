/**
 * Module partagé Jour 14 Sujet 14 (20/05/2026) — Matching keyword
 * stemming-aware utilisé par tous les pollers signature.
 *
 * Pourquoi ce module : 4 pollers (boamp, apify-linkedin-signature,
 * rss-medias-signature, francetravail-signature) faisaient chacun
 * leur `text.toLowerCase().includes(kw.toLowerCase())` ce qui ratait :
 *   - Pluriels (certificats vs certificat)
 *   - Accents perdus (electroniques vs électroniques)
 *   - Mots séparés (certificats DE SIGNATURES ET DE cachets electroniques)
 *
 * Bug racine Sujet 13 (UCANSS 13/05) : "FOURNITURE DE CERTIFICATS DE
 * SIGNATURES ET DE CACHETS ELECTRONIQUES POUR LES ORGANISMES DE
 * SECURITE SOCIALE" — keyword "certificat électronique" ne matchait pas
 * en `includes()` simple. Pourtant l'API OpenDataSoft Elasticsearch matche
 * (stemming + diacritiques OK). Résultat : ~80% des vrais positifs droppés
 * côté Node.
 *
 * Ce module centralise la logique de matching pour ne plus avoir de
 * dérive entre les 4 pollers. Pas server-only — module pur, testable.
 */

/**
 * Normalise pour matching stemming-aware : lowercase + retire diacritiques
 * (accents). Permet de matcher "certificats electroniques" contre keyword
 * "certificat électronique".
 *
 * Stratégie : NFD decomposition + suppression des combining marks
 * (U+0300 → U+036F, qui contient tous les accents combinants).
 */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // strip combining marks
}

/**
 * Vrai si les 2 chaînes partagent un préfixe commun d'au moins `min`
 * caractères normalisés (à partir du début).
 *
 * Utilisé pour matcher les variantes morphologiques (dérivations
 * françaises) :
 *   - "dematerialisation" ↔ "dematerialise" : préfixe "dematerialise" (13) ≥ 6 ✓
 *   - "dematerialisation" ↔ "dematerialisees" : préfixe "dematerialis" (12) ≥ 6 ✓
 *   - "signature" ↔ "signataires" : préfixe "signa" (5) puis "signat" — t vs t → "signat" (6) ≥ 6 ✓
 *   - "parapheur" ↔ "parapente" : préfixe "parap" (5) < 6 → ✗ (évite faux positif)
 */
export function sharePrefix(a: string, b: string, min: number): boolean {
  let i = 0;
  const len = Math.min(a.length, b.length);
  while (i < len && a[i] === b[i]) i++;
  return i >= min;
}

/**
 * Vérifie si `text` contient `keyword`, en tolérant :
 *   1. Case insensitive
 *   2. Diacritiques perdus (titre BOAMP en MAJ sans accents)
 *   3. Pluriels "s" final (parapheur ↔ parapheurs)
 *   4. Mots du keyword séparés par d'autres mots dans le texte
 *      (cas UCANSS "certificats de signatures ET DE cachets electroniques"
 *      matche "certificat électronique")
 *   5. Formes verbales / dérivations : "dématérialisation" ↔ "dématérialisé"
 *      via préfixe commun ≥ 6 chars (Sujet 16 — 20/05/2026)
 *
 * Algo :
 *   1. Substring direct normalisé (rapide pour le cas commun)
 *   2. Acronyme court ≤4 chars (GED) : strict, pas de tolérance
 *   3. Décomposition substring : chaque mot significatif (≥4 chars) du
 *      keyword apparaît en substring dans le texte (gère pluriels)
 *   4. Décomposition préfixe : si étape 3 échoue, chaque mot significatif
 *      du keyword partage un préfixe ≥6 chars avec un mot du texte
 *      (gère formes verbales/dérivations)
 *
 * Limite : peut générer faux positifs si keyword 2 mots dont chacun
 * apparaît mais dans un contexte non-lié. Opus filtre derrière.
 */
export function textContainsKeyword(text: string, keyword: string): boolean {
  const t = normalizeForMatch(text);
  const k = normalizeForMatch(keyword);
  if (!k) return false;

  // 1. Substring direct
  if (t.includes(k)) return true;

  // 2. Acronyme court ≤4 chars (GED, DPO, RGS...) → strict pas de tolérance
  const kWords = k.split(/\s+/).filter((w) => w.length > 0);
  if (kWords.length === 1 && k.length <= 4) return false;

  // 3+4. Pour chaque mot significatif (≥4 chars) du keyword, vérifier qu'il
  //      est trouvé dans le texte via :
  //        - substring (gère pluriels simples : "parapheur" ⊂ "parapheurs")
  //        - OU préfixe commun ≥6 chars (gère dérivations FR :
  //          "dematerialisation" partage "dematerialis" 12 chars avec "dematerialisees")
  //      Si un mot ≥4 chars n'est trouvé d'aucune façon → no match.
  //      Mots <4 chars (de, du, la, et) ignorés (stop words).
  const tWords = t.split(/\s+/);
  return kWords.every((kw) => {
    if (kw.length < 4) return true; // stop word, ignore
    return tWords.some((tw) => {
      if (tw.includes(kw)) return true; // substring (pluriel)
      if (kw.length >= 6 && sharePrefix(kw, tw, 6)) return true; // dérivation
      return false;
    });
  });
}

/**
 * Compte combien de keywords matchent le texte, retourne aussi les labels
 * matchés (avec leur casing/accent original pour affichage / scoreReason).
 *
 * Remplace les 3 implémentations dupliquées :
 *   - countSignatureMatchesInDescription (apify-linkedin-signature)
 *   - countSignatureMatchesInText (rss-medias-signature)
 *   - countSignatureMatchesInOffer (francetravail-signature)
 */
export function countSignatureMatches(
  text: string | undefined | null,
  keywords: string[],
): { count: number; labels: string[] } {
  if (!text) return { count: 0, labels: [] };
  const labels: string[] = [];
  for (const kw of keywords) {
    if (!kw || kw.trim().length === 0) continue;
    if (textContainsKeyword(text, kw)) labels.push(kw);
  }
  return { count: labels.length, labels };
}
