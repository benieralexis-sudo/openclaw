// Format human-readable du detail brut d'un trigger.
// Avant 29/04 : on affichait le detail brut (job description complète)
// → "incompréhensible" pour les commerciaux (300+ chars marketing RH).
//
// Après : on tronque + on labellise la source ("Annonce LinkedIn") +
// on garde un sourceUrl cliquable pour aller voir l'original.

const SOURCE_LABELS: Record<string, string> = {
  "apify.linkedin-jobs": "Annonce LinkedIn",
  "apify.indeed-jobs": "Annonce Indeed",
  "apify.wttj-jobs": "Annonce Welcome to the Jungle",
  "apify.linkedin-company-posts": "Post LinkedIn (douleur déclarée)",
  "theirstack.job-offer": "Annonce d'emploi (TheirStack)",
  "theirstack.buying-intent": "Signal intent (TheirStack)",
  "rodz.fundraising": "Levée de fonds détectée",
  "rodz.tech_hiring": "Recrutement tech détecté",
  "rodz.job_offers": "Offre d'emploi (Rodz)",
  "rodz.fundraising_signals": "Signal levée (Rodz)",
  "rodz.cto_change": "Changement C-level",
  "rodz.ma": "M&A détecté",
  "rodz.recruitment_burst": "Vague de recrutement",
  "rodz.creation": "Création de société",
  "trigger-engine.tech-hiring": "Recrutement tech (bot)",
  "bodacc.fundraising": "Annonce BODACC (levée)",
  "bodacc.creation": "Création de société (BODACC)",
  "joafe.publication": "Publication JOAFE",
  "inpi.marque": "Dépôt de marque INPI",
  "francetravail.job": "Offre France Travail",
  "rss.fundraising": "Article presse (levée)",
};

export function formatSourceLabel(sourceCode: string | null | undefined): string | null {
  if (!sourceCode) return null;
  return SOURCE_LABELS[sourceCode] ?? sourceCode;
}

const MAX_DETAIL_CHARS = 220;

export function truncateDetail(
  detail: string | null | undefined,
  maxChars: number = MAX_DETAIL_CHARS,
): { text: string; truncated: boolean } | null {
  if (!detail) return null;
  const cleaned = detail.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) {
    return { text: cleaned, truncated: false };
  }
  // Coupe au dernier mot complet avant maxChars pour éviter "rec…"
  const slice = cleaned.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxChars - 30 ? slice.slice(0, lastSpace) : slice;
  return { text: cut + "…", truncated: true };
}
