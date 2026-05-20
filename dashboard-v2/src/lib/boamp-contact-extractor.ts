/**
 * BOAMP Contact Extractor — Phase A (20/05/2026)
 *
 * Pourquoi : les avis BOAMP TED-eForms contiennent dans le payload
 * `efac:Organizations.efac:Organization[].efac:Company.cac:Contact` le nom
 * + email + téléphone + jobTitle du responsable du marché public. Cette
 * donnée est captée par notre poller mais jamais extraite vers le Lead.
 *
 * Résultat sur audit 20/05 : 13/15 payloads BOAMP recents (87%) avaient
 * un cac:Contact extractable. Pour les 4 Pépites Digidemat :
 *   - CNFPT : MEHADDI Belkacem, Directeur Général, achat.public@cnfpt.fr
 *   - UCANSS : Département Achat, achat@ucanss.fr, 01 45 38 81 20
 *   - SICIO / CH Lens : payload format legacy (MAPA/FNSimple) → fallback
 *     manuel
 *
 * Pour Digidemat (signature, GED, dématérialisation), le responsable marché
 * public EST le bon décisionnaire pour CE deal (il pilote l'AO). Pour un
 * outreach hors AO le DSI/DPO serait préférable mais l'AO en cours est le
 * meilleur trigger commercial.
 */

export interface BoampContact {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  website?: string;
  /** Nom de l'organisation BOAMP qui a fourni ce contact (pour debug). */
  orgName?: string;
  /** Confiance dans le matching org→nomacheteur : "exact" | "fuzzy" | "fallback". */
  matchKind: "exact" | "fuzzy" | "fallback" | "none";
}

interface RawOrg {
  orgName?: string;
  fullName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  website?: string;
}

function getText(node: unknown): string | undefined {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node && typeof node === "object") {
    const t = (node as Record<string, unknown>)["#text"];
    if (typeof t === "string") return t;
    if (typeof t === "number") return String(t);
  }
  return undefined;
}

/** Aplatit toutes les Organizations trouvées dans un payload TED-eForms. */
function flattenOrganizations(donnees: unknown): RawOrg[] {
  const orgs: RawOrg[] = [];
  if (!donnees || typeof donnees !== "object") return orgs;

  // Drill TED-eForms : EFORMS.ContractNotice OR ContractAwardNotice
  const root = (donnees as Record<string, unknown>).EFORMS as
    | Record<string, unknown>
    | undefined;
  if (!root) return orgs;
  const notice =
    (root.ContractNotice as Record<string, unknown> | undefined) ??
    (root.ContractAwardNotice as Record<string, unknown> | undefined);
  if (!notice) return orgs;

  // Navigate to organizations: ext:UBLExtensions.ext:UBLExtension.ext:ExtensionContent.efext:EformsExtension.efac:Organizations.efac:Organization
  const ublExt = notice["ext:UBLExtensions"] as
    | Record<string, unknown>
    | undefined;
  if (!ublExt) return orgs;
  const ublExtSingle = ublExt["ext:UBLExtension"] as
    | Record<string, unknown>
    | undefined;
  if (!ublExtSingle) return orgs;
  const content = ublExtSingle["ext:ExtensionContent"] as
    | Record<string, unknown>
    | undefined;
  if (!content) return orgs;
  const eforms = content["efext:EformsExtension"] as
    | Record<string, unknown>
    | undefined;
  if (!eforms) return orgs;
  const orgGroup = eforms["efac:Organizations"] as
    | Record<string, unknown>
    | undefined;
  if (!orgGroup) return orgs;
  const orgArr = orgGroup["efac:Organization"];
  if (!orgArr) return orgs;
  const arr = Array.isArray(orgArr) ? orgArr : [orgArr];

  for (const o of arr as Array<Record<string, unknown>>) {
    const company = o["efac:Company"] as Record<string, unknown> | undefined;
    if (!company) continue;
    const partyName = (company["cac:PartyName"] as Record<string, unknown> | undefined)?.[
      "cbc:Name"
    ];
    const orgName = getText(partyName);
    const contact = company["cac:Contact"] as Record<string, unknown> | undefined;
    const website = getText(company["cbc:WebsiteURI"]);
    if (!contact) {
      orgs.push({ orgName, website });
      continue;
    }
    orgs.push({
      orgName,
      fullName: getText(contact["cbc:Name"]),
      jobTitle: getText(contact["cbc:JobTitle"]),
      phone: getText(contact["cbc:Telephone"]),
      email: getText(contact["cbc:ElectronicMail"]),
      website,
    });
  }
  return orgs;
}

const TECH_BACKOFFICE_RE =
  /\b(avenue.web|aws.france|tribunal administratif|greffe|service.public)/i;

/** Normalise un nom d'organisation pour comparaison. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Split "MEHADDI Belkacem" ou "Belkacem MEHADDI" en firstName/lastName.
 *  Heuristique : le mot tout en majuscules = lastName, le reste = firstName. */
function splitFullName(full: string): { firstName?: string; lastName?: string } {
  const trimmed = full.trim();
  if (!trimmed) return {};
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] };
  // Detect MAJUSCULES tokens
  const upper = parts.filter((p) => p === p.toUpperCase() && /[A-Z]/.test(p));
  if (upper.length >= 1 && upper.length < parts.length) {
    const last = upper.join(" ");
    const first = parts.filter((p) => !upper.includes(p)).join(" ");
    return { firstName: first, lastName: last };
  }
  // Default : 1er = firstName, reste = lastName
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Détecte si un nom de contact ressemble à un alias service plutôt qu'à
 *  une vraie personne. Ex "Département Achat Ucanss", "SERVICE COMMANDE PUBLIQUE". */
export function isServiceAlias(fullName: string | undefined): boolean {
  if (!fullName) return false;
  return /\b(service|d[eé]partement|direction|cellule|bureau|secr[eé]tariat|p[oô]le)\b/i.test(
    fullName,
  );
}

/**
 * Extrait le meilleur contact depuis le payload BOAMP.
 *
 * Priorité de matching org → nomacheteur :
 *   1. Match exact normalisé (orgName === nomacheteur)
 *   2. Match partiel (orgName contient nomacheteur ou vice-versa)
 *   3. Fallback : 1ère org ≠ plateforme tech (Avenue-Web/Tribunal Admin) ayant un fullName
 *
 * @param donnees Le contenu `rawPayload.donnees` parsé ou en string.
 * @param nomAcheteur Le nom de l'acheteur public (= companyName du Trigger).
 */
export function extractBoampContact(
  donnees: unknown,
  nomAcheteur: string,
): BoampContact {
  let parsed: unknown = donnees;
  if (typeof donnees === "string") {
    try {
      parsed = JSON.parse(donnees);
    } catch {
      return { matchKind: "none" };
    }
  }
  const orgs = flattenOrganizations(parsed);
  if (orgs.length === 0) return { matchKind: "none" };

  const targetN = normalize(nomAcheteur);

  // 1. Match exact normalisé
  let match: RawOrg | undefined = orgs.find(
    (o) => o.orgName && normalize(o.orgName) === targetN,
  );
  let kind: BoampContact["matchKind"] = "exact";

  // 2. Match partiel : token-overlap ≥80% (gère "Centre National Fonction
  //    Publique Territoriale" vs "Centre National de la Fonction Publique
  //    Territoriale" où il manque "de la").
  if (!match && targetN.length >= 6) {
    const targetTokens = targetN.split(" ").filter((t) => t.length >= 3);
    match = orgs.find((o) => {
      if (!o.orgName) return false;
      const oN = normalize(o.orgName);
      if (oN.length < 6) return false;
      if (oN.includes(targetN) || targetN.includes(oN)) return true;
      const oTokens = new Set(oN.split(" "));
      if (targetTokens.length === 0) return false;
      const overlap = targetTokens.filter((t) => oTokens.has(t)).length;
      return overlap / targetTokens.length >= 0.8;
    });
    if (match) kind = "fuzzy";
  }

  // 3. Fallback : 1ère org non-tech-backoffice avec un fullName
  if (!match) {
    match = orgs.find(
      (o) =>
        o.fullName &&
        o.orgName &&
        !TECH_BACKOFFICE_RE.test(o.orgName),
    );
    if (match) kind = "fallback";
  }

  if (!match || (!match.fullName && !match.email)) {
    return { matchKind: "none" };
  }

  const split = match.fullName ? splitFullName(match.fullName) : {};
  // Si le fullName est un alias service (pas une personne) → ne pas le splitter
  const isAlias = isServiceAlias(match.fullName);
  return {
    fullName: match.fullName,
    firstName: isAlias ? undefined : split.firstName,
    lastName: isAlias ? undefined : split.lastName,
    jobTitle: match.jobTitle,
    email: match.email,
    phone: match.phone ? match.phone.replace(/\s+/g, "") : undefined,
    website: match.website,
    orgName: match.orgName,
    matchKind: kind,
  };
}
