/**
 * Pilier 3 (20/05/2026) — mapping concurrent → URLs case-studies/clients.
 *
 * Pour chaque concurrent connu, on liste les URLs publiques où ce concurrent
 * publie ses clients : pages "/customers", "/clients", "/case-studies", blogs
 * de témoignages. La détection inverse fetch ces URLs et cherche le nom du
 * prospect dans le HTML rendu.
 *
 * **Pourquoi cette approche est puissante** : les boîtes équipées ne
 * mentionnent jamais leur outil de signature sur leur propre site (interne),
 * mais les concurrents les exposent fièrement comme références. C'est public,
 * stable, indexé.
 *
 * Maintenance : ce mapping doit être enrichi quand un nouveau concurrent
 * apparaît dans `icp.antiPersonas`. Pas critique si manquant : on tombe
 * juste sur "scraping homepage" en méthode unique.
 */

export interface CompetitorMapEntry {
  /** Nom du concurrent (lowercase pour match insensible) */
  name: string;
  /** Variantes du nom (logos, sigles, slug URL) */
  aliases: string[];
  /** URLs publiques où ce concurrent liste/exhibe ses clients */
  customerPageUrls: string[];
}

/**
 * Carte des concurrents de signature électronique (secteur Digidemat).
 * Sources : pages officielles vérifiées le 20/05/2026.
 */
export const SIGNATURE_COMPETITORS: CompetitorMapEntry[] = [
  {
    name: "yousign",
    aliases: ["yousign", "you sign"],
    customerPageUrls: [
      "https://yousign.com/fr-fr",
      "https://yousign.com/fr-fr/clients",
      "https://yousign.com/fr-fr/customers",
      "https://yousign.com/customers",
      "https://yousign.com/fr-fr/case-studies",
      "https://yousign.com/fr-fr/etudes-de-cas",
    ],
  },
  {
    name: "docusign",
    aliases: ["docusign", "doc usign", "docu sign"],
    customerPageUrls: [
      "https://www.docusign.com/customer-stories",
      "https://www.docusign.com/fr-fr/customer-stories",
      "https://www.docusign.fr/clients",
      "https://www.docusign.com/customers",
    ],
  },
  {
    name: "universign",
    aliases: ["universign"],
    customerPageUrls: [
      "https://www.universign.com/fr/clients/",
      "https://www.universign.com/fr/temoignages-clients/",
      "https://www.universign.com/fr/",
    ],
  },
  {
    name: "lex persona",
    aliases: ["lex persona", "lexpersona"],
    customerPageUrls: [
      "https://www.lex-persona.com/clients/",
      "https://www.lex-persona.com/references/",
      "https://www.lex-persona.com/",
    ],
  },
  {
    name: "signaturit",
    aliases: ["signaturit"],
    customerPageUrls: [
      "https://www.signaturit.com/en/customers",
      "https://www.signaturit.com/fr/clients",
    ],
  },
  {
    name: "oodrive",
    aliases: ["oodrive", "oodrive sign"],
    customerPageUrls: [
      "https://www.oodrive.com/fr/references-clients/",
      "https://www.oodrive.com/fr/",
    ],
  },
  {
    name: "namirial",
    aliases: ["namirial"],
    customerPageUrls: [
      "https://www.namirial.com/en/customers/",
      "https://www.namirial.com/fr/",
    ],
  },
  {
    name: "adobe sign",
    aliases: ["adobe sign", "adobesign", "acrobat sign"],
    customerPageUrls: [
      "https://acrobat.adobe.com/fr/fr/sign/customer-stories.html",
      "https://www.adobe.com/fr/sign/customer-success.html",
    ],
  },
];

/**
 * Carte des outils de prospection / sales intelligence (secteur iFIND).
 */
export const SALES_INTEL_COMPETITORS: CompetitorMapEntry[] = [
  {
    name: "pharow",
    aliases: ["pharow"],
    customerPageUrls: [
      "https://www.pharow.com/clients",
      "https://www.pharow.com/customers",
      "https://www.pharow.com/",
    ],
  },
  {
    name: "apollo",
    aliases: ["apollo", "apollo.io"],
    customerPageUrls: [
      "https://www.apollo.io/customers",
      "https://www.apollo.io/customer-stories",
    ],
  },
  {
    name: "cognism",
    aliases: ["cognism"],
    customerPageUrls: [
      "https://www.cognism.com/customers",
      "https://www.cognism.com/case-studies",
    ],
  },
  {
    name: "clay",
    aliases: ["clay", "clay.com"],
    customerPageUrls: [
      "https://www.clay.com/customers",
      "https://www.clay.com/case-studies",
    ],
  },
  {
    name: "lemlist",
    aliases: ["lemlist"],
    customerPageUrls: [
      "https://www.lemlist.com/customers",
      "https://www.lemlist.com/case-studies",
    ],
  },
];

/**
 * Carte des ESN/régies (secteur DTL). Plus difficile : la plupart des ESN
 * ne publient pas leurs clients (NDA). On se limite aux + connues qui ont
 * des pages public-facing.
 */
export const ESN_COMPETITORS: CompetitorMapEntry[] = [
  {
    name: "capgemini",
    aliases: ["capgemini"],
    customerPageUrls: [
      "https://www.capgemini.com/fr-fr/clients/",
      "https://www.capgemini.com/case-studies/",
    ],
  },
  {
    name: "sopra steria",
    aliases: ["sopra steria", "sopra"],
    customerPageUrls: [
      "https://www.soprasteria.com/fr/clients",
    ],
  },
  {
    name: "alten",
    aliases: ["alten"],
    customerPageUrls: ["https://www.alten.fr/clients/"],
  },
  {
    name: "akkodis",
    aliases: ["akkodis"],
    customerPageUrls: ["https://www.akkodis.com/fr-fr/clients"],
  },
  {
    name: "devoteam",
    aliases: ["devoteam"],
    customerPageUrls: ["https://www.devoteam.com/fr/clients/"],
  },
];

const ALL_COMPETITORS: CompetitorMapEntry[] = [
  ...SIGNATURE_COMPETITORS,
  ...SALES_INTEL_COMPETITORS,
  ...ESN_COMPETITORS,
];

/**
 * Cherche un competitor dans la carte par son nom (insensible casse + aliases).
 * Retourne null si inconnu (on tombera juste sur le scraping homepage seul).
 */
export function findCompetitorInMap(competitorName: string): CompetitorMapEntry | null {
  const lower = competitorName.trim().toLowerCase();
  if (lower.length < 3) return null;
  for (const entry of ALL_COMPETITORS) {
    if (entry.name === lower) return entry;
    if (entry.aliases.some((a) => a.toLowerCase() === lower)) return entry;
    // Match partiel : "yousign" trouve "Yousign" dans antiPersonas
    if (entry.name.includes(lower) || lower.includes(entry.name)) return entry;
  }
  return null;
}

/**
 * Pour une liste de concurrents donnée (icp.antiPersonas), retourne toutes
 * les URLs case-studies à scanner. Dédupliquées.
 */
export function getAllCustomerPageUrls(competitors: string[]): {
  competitor: string;
  url: string;
}[] {
  const result: { competitor: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const c of competitors) {
    const entry = findCompetitorInMap(c);
    if (!entry) continue;
    for (const url of entry.customerPageUrls) {
      const key = `${entry.name}|${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ competitor: entry.name, url });
    }
  }
  return result;
}
