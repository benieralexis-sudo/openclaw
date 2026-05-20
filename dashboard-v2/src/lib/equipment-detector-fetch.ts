// Pas de `server-only` ici : module pur fetch + cheerio, testable depuis
// scripts CLI (`scripts/test-equipment-detector-live.ts`) et vitest. Aucune
// clé API/secret n'est requis pour fonctionner (User-Agent identifié seulement).
import * as cheerio from "cheerio";
import {
  buildUrlsToCheck,
  decideEquipmentStatus,
  EquipmentEvidence,
  EquipmentResult,
  findCompetitorMentions,
  getConfidenceForSource,
} from "@/lib/equipment-detector";
import {
  getAllCustomerPageUrls,
} from "@/lib/equipment-detector-competitors-map";
import {
  buildCompanyNameVariants,
  findCompanyMentionInText,
} from "@/lib/equipment-detector-company-variants";

/**
 * Pilier 3 (20/05/2026) — orchestration I/O du anti-filter équipé.
 *
 * Ce fichier contient les fonctions qui fetchent réellement (HTTP) les
 * pages d'un site et qui orchestrent la décision finale via la fonction
 * pure `decideEquipmentStatus` du module sibling.
 *
 * Architecture :
 *   detectEquipmentForCompany(domain, competitors)
 *     ├─ buildUrlsToCheck(domain) → 17 URLs candidates
 *     ├─ pour chaque URL : fetchHtmlSafe + scanHtmlForCompetitors
 *     ├─ early-exit dès qu'on a 1 evidence haute confidence (≥0.95)
 *     └─ decideEquipmentStatus(evidence[]) → status final
 *
 * Garde-fous :
 *   - Timeout 6s/URL
 *   - Cap 8 URLs max fetchées en pratique (early-exit + skip 404)
 *   - Concurrency 3 max (politesse + speed)
 *   - User-Agent identifié iFINDBot
 */

const FETCH_TIMEOUT_MS = 6000;
const MAX_URLS_FETCHED = 8;
const FETCH_CONCURRENCY = 3;

const USER_AGENT =
  "Mozilla/5.0 (compatible; iFINDBot/1.0; +https://ifind.fr/bot)";

interface FetchResult {
  url: string;
  type: "homepage" | "legal" | "customers";
  html: string | null;
  status: number;
}

/**
 * Fetch HTTP safe — timeout, content-type check, taille max 1MB.
 * Retourne null si non-200 ou content non-HTML.
 */
async function fetchHtmlSafe(url: string): Promise<FetchResult> {
  const type = url.includes("/mentions-legales") ||
    url.includes("/legal") ||
    url.includes("/cgv") ||
    url.includes("/cgu") ||
    url.includes("/conditions-generales") ||
    url.includes("/privacy") ||
    url.includes("/politique-de-confidentialite")
    ? "legal"
    : url.includes("/clients") ||
        url.includes("/references") ||
        url.includes("/temoignages") ||
        url.includes("/case-studies") ||
        url.includes("/customers")
      ? "customers"
      : "homepage";

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });

    if (!res.ok) return { url, type, html: null, status: res.status };

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) {
      return { url, type, html: null, status: res.status };
    }

    // Limite à ~1MB pour éviter de manger la RAM sur des sites obèses.
    const html = await res.text();
    if (html.length > 1024 * 1024) {
      return { url, type, html: html.slice(0, 1024 * 1024), status: res.status };
    }
    if (html.length < 200) return { url, type, html: null, status: res.status };
    return { url, type, html, status: res.status };
  } catch {
    return { url, type, html: null, status: 0 };
  }
}

/**
 * Parse un HTML avec cheerio et extrait 3 zones distinctes :
 *   - body : texte général (tout sauf script/style)
 *   - footer : contenu de <footer> + dernier <div class="footer">
 *   - scripts : URLs src des <script>, <link>, <img> (pour détecter CDN concurrents)
 *
 * Cherche ensuite les concurrents dans chaque zone et retourne evidence[].
 */
export function scanHtmlForCompetitors(
  html: string,
  competitors: string[],
  url: string,
  pageType: "homepage" | "legal" | "customers",
): EquipmentEvidence[] {
  const evidence: EquipmentEvidence[] = [];
  const $ = cheerio.load(html);

  // Strip script/style/comments du body pour le scan texte
  $("script, style, noscript").remove();

  // 1) Footer : très haute confiance
  let footerHtml = $("footer").html() ?? "";
  if (!footerHtml) {
    // Fallback : div avec class/id contenant "footer"
    const $footerLike = $('[class*="footer" i], [id*="footer" i]').last();
    footerHtml = $footerLike.html() ?? "";
  }
  if (footerHtml) {
    const footerText = cheerio.load(footerHtml).text().replace(/\s+/g, " ").trim();
    if (footerText.length > 10) {
      evidence.push(
        ...findCompetitorMentions(footerText, competitors, {
          source: "homepage-footer",
          url,
          baseConfidence: getConfidenceForSource("homepage-footer"),
        }),
      );
    }
  }

  // 2) Body text : confiance moyenne (sauf si page est légale → confiance haute)
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const bodySource =
    pageType === "legal"
      ? "legal-page"
      : pageType === "customers"
        ? "customers-page"
        : "homepage-body";
  if (bodyText.length > 50) {
    // Évite doubles comptages : on scan le body MINUS le footer (déjà scanné).
    // Pour rester simple, on accepte le double scan : `findCompetitorMentions`
    // ne retourne qu'1 evidence par competitor par source, donc on aura
    // {footer: Yousign} + {body: Yousign} si présent partout. C'est OK :
    // l'evidence body sera secondaire (confidence plus basse).
    evidence.push(
      ...findCompetitorMentions(bodyText, competitors, {
        source: bodySource,
        url,
        baseConfidence: getConfidenceForSource(bodySource),
      }),
    );
  }

  // 3) Scripts/links src : détection CDN concurrents (cdn.yousign.com,
  //    docusign-sdk, etc.). On re-parse le HTML brut (avant remove script)
  //    juste pour les URLs.
  const $orig = cheerio.load(html);
  const externalUrls: string[] = [];
  $orig("script[src], link[href], iframe[src]").each((_, el) => {
    const src = $orig(el).attr("src") || $orig(el).attr("href");
    if (src && src.length > 5) externalUrls.push(src);
  });
  if (externalUrls.length > 0) {
    const urlsBlob = externalUrls.join("\n");
    evidence.push(
      ...findCompetitorMentions(urlsBlob, competitors, {
        source: "homepage-script",
        url,
        baseConfidence: getConfidenceForSource("homepage-script"),
      }),
    );
  }

  return dedupEvidenceBySourceAndCompetitor(evidence);
}

/**
 * Garde 1 evidence par (competitor, source) en gardant la plus haute confidence.
 * Évite la pollution si findCompetitorMentions matche le même competitor sur
 * plusieurs variantes regex (rare mais possible).
 */
function dedupEvidenceBySourceAndCompetitor(
  evidence: EquipmentEvidence[],
): EquipmentEvidence[] {
  const byKey = new Map<string, EquipmentEvidence>();
  for (const ev of evidence) {
    const key = `${ev.competitor}|${ev.source}`;
    const existing = byKey.get(key);
    if (!existing || ev.confidence > existing.confidence) {
      byKey.set(key, ev);
    }
  }
  return [...byKey.values()];
}

/**
 * Méthode A : scraping homepage / footer / mentions légales / pages clients
 * de l'entreprise CIBLE. Capte ~20% des cas équipés (ceux qui ont une
 * intégration visible ou widget signature embedded).
 */
export async function detectFromProspectWebsite(
  domain: string,
  competitors: string[],
): Promise<{
  evidence: EquipmentEvidence[];
  fetchedAtLeastOne: boolean;
}> {
  const allEvidence: EquipmentEvidence[] = [];
  let fetchedAtLeastOne = false;
  let fetchedCount = 0;

  const urls = buildUrlsToCheck(domain);

  const processUrl = async (url: string, type: "homepage" | "legal" | "customers") => {
    if (fetchedCount >= MAX_URLS_FETCHED) return;
    const result = await fetchHtmlSafe(url);
    if (result.html === null) return;
    fetchedCount++;
    fetchedAtLeastOne = true;
    const ev = scanHtmlForCompetitors(result.html, competitors, result.url, type);
    allEvidence.push(...ev);
  };

  let i = 0;
  while (i < urls.length && fetchedCount < MAX_URLS_FETCHED) {
    const batch = urls.slice(i, i + FETCH_CONCURRENCY);
    await Promise.all(batch.map((u) => processUrl(u.url, u.type)));
    i += FETCH_CONCURRENCY;
    if (allEvidence.some((e) => e.confidence >= 0.95)) break;
  }

  return { evidence: allEvidence, fetchedAtLeastOne };
}

/**
 * Méthode B : scraping INVERSE — on fetch les pages clients/case-studies
 * des CONCURRENTS et on cherche le nom de notre prospect dans leur HTML.
 *
 * Capte ~50-60% des cas équipés (boîtes qui figurent comme références sur
 * les sites des concurrents).
 *
 * Note perf : N concurrents × M URLs par concurrent = ~30-50 fetch
 * par check. Avec cache TTL 30j côté runner (l'inventaire clients du
 * concurrent ne change pas tous les jours), c'est en réalité ~30 fetch
 * la 1re fois puis 0 ensuite (cache hit).
 */
export async function detectFromCompetitorCustomerPages(
  companyName: string,
  competitors: string[],
): Promise<{
  evidence: EquipmentEvidence[];
  fetchedAtLeastOne: boolean;
}> {
  const allEvidence: EquipmentEvidence[] = [];
  let fetchedAtLeastOne = false;
  let fetchedCount = 0;

  const companyVariants = buildCompanyNameVariants(companyName);
  if (companyVariants.length === 0) {
    return { evidence: [], fetchedAtLeastOne: false };
  }

  const urls = getAllCustomerPageUrls(competitors);
  if (urls.length === 0) {
    return { evidence: [], fetchedAtLeastOne: false };
  }

  // Process par batch avec concurrency
  let i = 0;
  while (i < urls.length && fetchedCount < 30) {
    const batch = urls.slice(i, i + FETCH_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ competitor, url }) => {
        if (fetchedCount >= 30) return;
        const result = await fetchHtmlSafe(url);
        if (result.html === null) return;
        fetchedCount++;
        fetchedAtLeastOne = true;

        // Charge HTML, strip scripts/styles
        const $ = cheerio.load(result.html);
        $("script, style, noscript").remove();

        // Priorité 1 : logos clients via alt/title/src des images. Très fort
        // signal (confidence 0.9) : si le nom de la boîte est dans un
        // <img alt="Logo Qonto"> ou <img src="/img/bpi-france.svg"> sur une
        // page customers de Yousign, c'est une référence client quasi-certaine.
        // On inclut le `src` car certains sites laissent les logos sans alt
        // (Yousign Nuxt par ex.) mais le nom est dans l'URL du fichier.
        const altTitleBlob: string[] = [];
        $("img[alt], img[title], img[src], a[title], a[aria-label], a[href]").each((_, el) => {
          const alt = $(el).attr("alt");
          const title = $(el).attr("title");
          const aria = $(el).attr("aria-label");
          const src = $(el).attr("src");
          const href = $(el).attr("href");
          if (alt) altTitleBlob.push(alt);
          if (title) altTitleBlob.push(title);
          if (aria) altTitleBlob.push(aria);
          // Pour src/href : extraire la partie filename uniquement pour éviter
          // les faux positifs sur des URL externes (https://example.com/x)
          if (src) {
            const filename = src.split("/").pop()?.replace(/\.(svg|png|jpg|jpeg|webp|gif)$/i, "") ?? "";
            if (filename.length >= 3) altTitleBlob.push(filename.replace(/[-_]/g, " "));
          }
          if (href && !href.startsWith("http")) {
            // Href interne : peut être /case-studies/qonto-deployment, on extrait le slug
            const last = href.split("/").pop()?.replace(/[?#].*$/, "") ?? "";
            if (last.length >= 3) altTitleBlob.push(last.replace(/[-_]/g, " "));
          }
        });
        let hasStrongMatch = false;
        if (altTitleBlob.length > 0) {
          const matchAlt = findCompanyMentionInText(
            altTitleBlob.join(" | "),
            companyVariants,
          );
          if (matchAlt) {
            allEvidence.push({
              competitor,
              source: "competitor-customers-list",
              url,
              matchedText: `Logo/alt "${matchAlt.matchedVariant}" sur la page clients de ${competitor}`,
              confidence: 0.9, // signal fort = vrai logo client
            });
            hasStrongMatch = true;
          }
        }

        // Priorité 2 : titre/headlines (<h1>..<h6>, <strong>) — souvent des
        // case studies "Comment Qonto a déployé Yousign". Signal moyen.
        //
        // Note anti-faux-positifs : pour les noms AMBIGUS (commencent par
        // stop word français comme "Le Monde", "La Poste"), on baisse la
        // confidence à 0.5 → UNKNOWN. Le nom est trop commun pour valider
        // EQUIPPED sur la seule présence en titre.
        if (!hasStrongMatch) {
          const headlinesBlob: string[] = [];
          $("h1, h2, h3, h4, h5, h6, strong, b").each((_, el) => {
            const t = $(el).text().trim();
            if (t && t.length >= 3 && t.length <= 200) headlinesBlob.push(t);
          });
          if (headlinesBlob.length > 0) {
            const matchH = findCompanyMentionInText(
              headlinesBlob.join(" | "),
              companyVariants,
            );
            if (matchH) {
              const isAmbiguousName = /^(le|la|les|l['' ])/i.test(companyName.trim());
              const confidence = isAmbiguousName ? 0.5 : 0.75;
              allEvidence.push({
                competitor,
                source: "competitor-customers-list",
                url,
                matchedText: `Titre/headline "${matchH.matchedVariant}" sur la page clients de ${competitor}: "${matchH.snippet.slice(0, 120)}"`,
                confidence,
              });
              if (!isAmbiguousName) hasStrongMatch = true;
            }
          }
        }

        // Priorité 3 : body text. SIGNAL FAIBLE (confidence 0.4) car les
        // mots communs comme "Le Monde", "EDF", "RATP" peuvent apparaître
        // dans le texte éditorial sans être client. Cette evidence seule
        // ne suffit pas à EQUIPPED (sera marquée UNKNOWN par decideEquipmentStatus).
        if (!hasStrongMatch) {
          const fullText = $("body").text();
          const match = findCompanyMentionInText(fullText, companyVariants);
          if (match) {
            allEvidence.push({
              competitor,
              source: "competitor-customers-list",
              url,
              matchedText: `Body text "${match.matchedVariant}" sur ${competitor}: "${match.snippet.slice(0, 150)}"`,
              confidence: 0.4, // signal faible : peut être éditorial
            });
          }
        }
      }),
    );
    i += FETCH_CONCURRENCY;
  }

  return { evidence: allEvidence, fetchedAtLeastOne };
}

/**
 * Détecte si une entreprise est équipée d'un concurrent. Combine les
 * méthodes A et B et fusionne les evidences.
 *
 * @param companyName ex: "Qonto" (utilisé pour méthode B)
 * @param domain ex: "qonto.com" (utilisé pour méthode A)
 * @param competitors liste des concurrents à chercher (icp.antiPersonas)
 * @returns EquipmentResult avec status + evidence
 */
export async function detectEquipmentForCompany(
  companyName: string,
  domain: string | null,
  competitors: string[],
): Promise<EquipmentResult> {
  if (competitors.length === 0) {
    return decideEquipmentStatus([], { fetchedAtLeastOneSource: false });
  }

  const allEvidence: EquipmentEvidence[] = [];
  let fetchedAtLeastOne = false;

  // Méthode A : scrape le site du prospect (si domain dispo)
  if (domain) {
    const a = await detectFromProspectWebsite(domain, competitors);
    allEvidence.push(...a.evidence);
    fetchedAtLeastOne = fetchedAtLeastOne || a.fetchedAtLeastOne;

    // Early-exit méthode A si trouvé un signal très fort
    if (allEvidence.some((e) => e.confidence >= 0.95)) {
      return decideEquipmentStatus(allEvidence, { fetchedAtLeastOneSource: true });
    }
  }

  // Méthode B : scrape les pages clients des concurrents (scraping inverse)
  if (companyName && companyName.trim().length >= 2) {
    const b = await detectFromCompetitorCustomerPages(companyName, competitors);
    allEvidence.push(...b.evidence);
    fetchedAtLeastOne = fetchedAtLeastOne || b.fetchedAtLeastOne;
  }

  return decideEquipmentStatus(allEvidence, {
    fetchedAtLeastOneSource: fetchedAtLeastOne,
  });
}
