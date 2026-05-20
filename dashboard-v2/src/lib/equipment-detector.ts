/**
 * Pilier 3 (20/05/2026) — anti-filter "déjà équipé d'un concurrent".
 *
 * Promesse produit : "On trouve les boîtes FR qui vont acheter ton produit,
 * et qui ne l'ont pas déjà." Ce module garantit le "qui ne l'ont pas déjà".
 *
 * Module PUR : pas de `server-only`, pas d'accès DB. Toutes les fonctions
 * sont testables vitest. L'orchestration I/O (fetch HTTP, accès DB) vit
 * dans `equipment-detector-fetch.ts` et `equipment-detector-runner.ts`.
 *
 * Stratégie 5 méthodes en cascade (early-exit dès qu'un match haute
 * confidence est trouvé) :
 *   1. Homepage : footer + scripts/<head>
 *   2. Mentions légales / CGV (souvent y figure "Signé via Yousign", etc.)
 *   3. Page /clients ou /references : on regarde si la boîte y est listée
 *      → on inverse : on fetch le site des CONCURRENTS et on cherche notre
 *      cible dans leurs pages clients/case-studies
 *   4. Robots/HTML : détection de scripts/SDK concurrents (cdn.yousign.com,
 *      docusign-sdk.js, etc.)
 *   5. Search externe (deferred — pour V2 avec SerpAPI/Brave)
 *
 * Output : EquipmentResult avec status + evidence[] (traçable, auditable).
 */

export type EquipmentStatus = "PENDING" | "NONE" | "EQUIPPED" | "UNKNOWN";

export type EvidenceSource =
  | "homepage-body"
  | "homepage-footer"
  | "homepage-script"
  | "legal-page"
  | "customers-page"
  | "competitor-customers-list"
  | "linkedin-job"
  | "github-repo"
  | "search-result";

export interface EquipmentEvidence {
  competitor: string; // ex: "Yousign", "DocuSign"
  source: EvidenceSource;
  url: string;
  matchedText: string; // extrait de contexte (≤200 chars)
  confidence: number; // 0..1 (1 = certain, 0.5 = mention ambigüe)
}

export interface EquipmentResult {
  status: EquipmentStatus;
  competitor: string | null; // celui avec la plus forte confidence
  evidence: EquipmentEvidence[];
  checkedAt: Date;
  reason: string; // explication courte pour audit
}

// ---------------------------------------------------------------------------
// Pattern matching helpers
// ---------------------------------------------------------------------------

/**
 * Normalise un nom de concurrent en variantes regex. Ex: "Yousign" génère
 * [yousign, you sign, you-sign], "Lex Persona" → [lex persona, lexpersona,
 * lex-persona].
 *
 * Pourquoi : les boîtes écrivent "yousign", "you sign", "Yousign®", logos
 * SVG avec class="logo-yousign", URLs cdn.yousign.com etc. On capte tout.
 */
export function buildCompetitorPatterns(competitor: string): RegExp[] {
  const base = competitor.trim().toLowerCase();
  if (base.length < 3) return []; // skip tokens trop courts (faux positifs)

  const variants = new Set<string>();
  variants.add(base);
  variants.add(base.replace(/\s+/g, "")); // "lex persona" → "lexpersona"
  variants.add(base.replace(/\s+/g, "-")); // "lex persona" → "lex-persona"
  variants.add(base.replace(/\s+/g, "_"));
  // Forme domain commune : "Yousign" → "yousign.com" / "yousign.io"
  if (!base.includes(" ") && base.length >= 4) {
    variants.add(`${base}.com`);
    variants.add(`${base}.io`);
    variants.add(`${base}.fr`);
    variants.add(`${base}.eu`);
  }

  return [...variants]
    .filter((v) => v.length >= 3)
    .map((v) => {
      // Escape regex special chars
      const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Word-boundary safe : on évite que "sap" matche "sapporo" ou
      // "yousign" matche "yousignement" (improbable mais on couvre).
      // \b ne marche pas bien avec les chars étendus (- _ .). On utilise
      // un lookbehind/lookahead permissif sur lettres/chiffres autour.
      return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "gi");
    });
}

/**
 * Cherche les mentions de chaque concurrent dans un blob de texte. Retourne
 * un evidence[] avec contexte. Confidence par défaut 0.7 (à pondérer par
 * la source : footer = 0.95, body = 0.6, script = 0.95).
 */
export function findCompetitorMentions(
  text: string,
  competitors: string[],
  opts: {
    source: EvidenceSource;
    url: string;
    baseConfidence?: number;
  },
): EquipmentEvidence[] {
  const found: EquipmentEvidence[] = [];
  const lower = text.toLowerCase();
  const baseConf = opts.baseConfidence ?? 0.7;

  for (const competitor of competitors) {
    const patterns = buildCompetitorPatterns(competitor);
    for (const pat of patterns) {
      // Reset lastIndex (g flag retient l'état entre exec).
      pat.lastIndex = 0;
      const match = pat.exec(lower);
      if (match) {
        const start = Math.max(0, match.index - 80);
        const end = Math.min(text.length, match.index + match[0].length + 80);
        const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
        found.push({
          competitor,
          source: opts.source,
          url: opts.url,
          matchedText: snippet.slice(0, 200),
          confidence: baseConf,
        });
        break; // 1 evidence/competitor/source suffit
      }
    }
  }
  return found;
}

/**
 * Combine plusieurs evidence sources et décide le status final.
 *
 * Règles :
 *   - 0 evidence : NONE (boîte non équipée, ok à livrer)
 *   - 1+ evidence confidence ≥ 0.85 : EQUIPPED (certain)
 *   - 1+ evidence confidence ≥ 0.65 mais < 0.85 : EQUIPPED (probable)
 *   - 1+ evidence confidence < 0.65 : UNKNOWN (ambigu, déposer en doute)
 *   - Si aucune méthode n'a pu fetch → UNKNOWN
 */
export function decideEquipmentStatus(
  evidence: EquipmentEvidence[],
  opts: { fetchedAtLeastOneSource: boolean },
): EquipmentResult {
  const now = new Date();

  if (evidence.length === 0) {
    if (!opts.fetchedAtLeastOneSource) {
      return {
        status: "UNKNOWN",
        competitor: null,
        evidence: [],
        checkedAt: now,
        reason: "Aucune source n'a pu être fetchée (site inaccessible/timeout).",
      };
    }
    return {
      status: "NONE",
      competitor: null,
      evidence: [],
      checkedAt: now,
      reason: "Aucun concurrent détecté sur les sources fetchées.",
    };
  }

  // Trie par confidence desc, garde le top concurrent
  const sorted = [...evidence].sort((a, b) => b.confidence - a.confidence);
  const top = sorted[0];
  if (!top) {
    // Impossible normalement (evidence.length > 0 checked above), mais TS strict
    return {
      status: "NONE",
      competitor: null,
      evidence: [],
      checkedAt: now,
      reason: "evidence vide",
    };
  }

  if (top.confidence >= 0.65) {
    return {
      status: "EQUIPPED",
      competitor: top.competitor,
      evidence: sorted,
      checkedAt: now,
      reason: `Concurrent "${top.competitor}" détecté via ${top.source} (confidence=${top.confidence.toFixed(2)}).`,
    };
  }

  // Confidence faible : ambigu
  return {
    status: "UNKNOWN",
    competitor: top.competitor,
    evidence: sorted,
    checkedAt: now,
    reason: `Mention "${top.competitor}" trouvée mais confidence faible (${top.confidence.toFixed(2)}). À valider manuellement.`,
  };
}

// ---------------------------------------------------------------------------
// Domain inference
// ---------------------------------------------------------------------------

const PLATFORM_DOMAINS_BLACKLIST = new Set([
  "linkedin.com",
  "welcometothejungle.com",
  "indeed.com",
  "indeed.fr",
  "free-work.com",
  "jobteaser.com",
  "monster.fr",
  "monster.com",
  "regionsjob.com",
  "apec.fr",
  "hellowork.com",
  "talent.io",
  "francetravail.fr",
  "pole-emploi.fr",
  "boamp.fr",
  "boamp-dila.fr",
  "ted.europa.eu",
  "joafe.fr",
  "bodacc.fr",
  "bodacc-numerique.fr",
  "inpi.fr",
  "data.inpi.fr",
  "github.com",
  "twitter.com",
  "x.com",
  "facebook.com",
]);

/**
 * Tente d'extraire un domaine d'entreprise depuis un rawPayload Trigger.
 * Récursif sur objets imbriqués. Skip les plateformes blacklistées.
 *
 * Retourne le domain nu (sans https://, sans path) ou null.
 */
export function inferDomainFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  const URL_FIELDS = [
    "companyWebsite",
    "websiteUrl",
    "companyUrl",
    "website",
    "companyDomain",
    "domain",
    "url",
    "webUrl",
    "siteWeb",
    "site_web",
  ];

  for (const field of URL_FIELDS) {
    const v = p[field];
    if (typeof v === "string" && v.length >= 4 && v.length < 300) {
      const normalized = v.startsWith("http") ? v : `https://${v}`;
      try {
        const u = new URL(normalized);
        const host = u.hostname.toLowerCase().replace(/^www\./, "");
        if (host.length >= 4 && !isBlacklistedDomain(host)) {
          return host;
        }
      } catch {
        // invalid, skip
      }
    }
  }

  // Récursion 1 niveau
  for (const v of Object.values(p)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const found = inferDomainFromPayload(v);
      if (found) return found;
    }
  }

  return null;
}

export function isBlacklistedDomain(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  if (PLATFORM_DOMAINS_BLACKLIST.has(h)) return true;
  for (const blacklisted of PLATFORM_DOMAINS_BLACKLIST) {
    if (h.endsWith(`.${blacklisted}`)) return true;
  }
  return false;
}

/**
 * Construit la liste des URLs à fetcher pour un domain donné. On essaie
 * les variantes FR + EN classiques pour mentions légales et page clients.
 */
export function buildUrlsToCheck(domain: string): {
  url: string;
  type: "homepage" | "legal" | "customers";
}[] {
  const origin = `https://${domain}`;
  return [
    { url: `${origin}/`, type: "homepage" },
    { url: `${origin}/mentions-legales`, type: "legal" },
    { url: `${origin}/mentions-legales/`, type: "legal" },
    { url: `${origin}/legal`, type: "legal" },
    { url: `${origin}/legal/`, type: "legal" },
    { url: `${origin}/cgv`, type: "legal" },
    { url: `${origin}/cgu`, type: "legal" },
    { url: `${origin}/conditions-generales`, type: "legal" },
    { url: `${origin}/privacy`, type: "legal" },
    { url: `${origin}/politique-de-confidentialite`, type: "legal" },
    { url: `${origin}/clients`, type: "customers" },
    { url: `${origin}/nos-clients`, type: "customers" },
    { url: `${origin}/references`, type: "customers" },
    { url: `${origin}/nos-references`, type: "customers" },
    { url: `${origin}/temoignages`, type: "customers" },
    { url: `${origin}/case-studies`, type: "customers" },
    { url: `${origin}/customers`, type: "customers" },
  ];
}

/**
 * Confidence par source. Le footer + scripts sont les plus fiables.
 */
export function getConfidenceForSource(source: EvidenceSource): number {
  switch (source) {
    case "homepage-footer":
      return 0.95; // "Signé via Yousign" en footer = quasi-certain
    case "homepage-script":
      return 0.95; // cdn.yousign.com chargé = SDK actif
    case "legal-page":
      return 0.85; // mentions légales mentionnent souvent le DPO/sous-traitant
    case "competitor-customers-list":
      return 0.9; // la boîte figure sur la page clients du concurrent
    case "customers-page":
      return 0.5; // on est sur le site du prospect — mention possible mais ambigüe (témoignage de leur client à eux)
    case "homepage-body":
      return 0.6; // mention dans le body → peut être un blog post, comparatif, etc.
    case "linkedin-job":
      return 0.8; // job description "vous utiliserez X" = signal fort
    case "github-repo":
      return 0.95; // SDK importé dans repo public
    case "search-result":
      return 0.7;
  }
}
