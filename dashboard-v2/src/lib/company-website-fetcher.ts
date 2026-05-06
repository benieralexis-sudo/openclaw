import "server-only";
import { getAnthropic } from "@/lib/anthropic";

/**
 * Sprint C.1 (06/05/2026) — Fetch + résumé homepage entreprise pour le judge.
 *
 * Pourquoi : un éditeur SaaS qui dit "200 collaborateurs, équipe en Inde,
 * 12 ESN partenaires" sur sa homepage révèle un fit potentiellement faible
 * avec DTL même si les autres signaux paraissent positifs. Le judge ne le
 * voit pas aujourd'hui.
 *
 * Architecture :
 * 1. Tente d'extraire une URL depuis trigger.rawPayload (champs typiques
 *    Apify/Rodz/TheirStack : companyWebsite, websiteUrl, companyUrl, website).
 * 2. Si URL trouvée → fetch homepage (timeout 5s, max 8KB texte).
 * 3. Résumé Sonnet 4.6 ~150 chars avec focus signaux DTL : taille équipe,
 *    nombre devs/QA mentionnés, secteur précis, localisation, stack tech.
 * 4. Cache in-memory keyé par SIREN (TTL 7j) pour éviter re-fetch sur
 *    plusieurs Triggers du même SIRET.
 *
 * Best-effort : silent fail si URL invalide / fetch timeout / Sonnet erreur.
 * Coût marginal : ~$0.001/résumé Sonnet × 30 leads/j = $1/mois.
 */

interface CacheEntry {
  summary: string;
  expiresAt: number;
}

// Cache in-memory : reset au restart Next.js. Suffisant pour réduire les
// re-fetch sur les Triggers multiples d'un même SIRET (combo détection).
const websiteCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000; // 7 jours

const URL_FIELD_CANDIDATES = [
  "companyWebsite",
  "websiteUrl",
  "companyUrl",
  "website",
  "companyDomain",
  "domain",
  "url",
  "webUrl",
];

// Sprint C.1 fix (06/05/2026 backfill) — Blacklist plateformes recrutement.
// L'URL trouvée dans le rawPayload est souvent l'URL de l'offre sur la
// plateforme (welcometothejungle.com/companies/pixid/jobs/xxx, linkedin.com,
// indeed.com, etc.). Si on fetch ces URLs, on récupère le HTML de la plateforme
// et le résumé Sonnet décrit la plateforme au lieu de la cible. Ces domaines
// sont SKIP — bloc COMPANY WEBSITE simplement omis (pas de régression vs B.7).
const PLATFORM_DOMAINS_BLACKLIST = [
  "linkedin.com",
  "welcometothejungle.com",
  "indeed.com",
  "indeed.fr",
  "free-work.com",
  "emploi.afjv.com",
  "jobteaser.com",
  "monster.fr",
  "monster.com",
  "regionsjob.com",
  "apec.fr",
  "hellowork.com",
  "michaelpage.fr",
  "talent.io",
  "fr.linkedin.com",
  "uk.linkedin.com",
  "de.linkedin.com",
  "francetravail.fr",
  "pole-emploi.fr",
];

function isBlacklistedDomain(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return PLATFORM_DOMAINS_BLACKLIST.some(
    (d) => h === d || h.endsWith(`.${d}`),
  );
}

function extractUrlFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  for (const field of URL_FIELD_CANDIDATES) {
    const v = p[field];
    if (typeof v === "string" && v.length >= 4 && v.length < 200) {
      const normalized = v.startsWith("http") ? v : `https://${v}`;
      try {
        const u = new URL(normalized);
        if (u.hostname.length >= 4 && !isBlacklistedDomain(u.hostname)) {
          return u.origin;
        }
      } catch {
        // invalid URL, skip
      }
    }
  }
  // Recherche un niveau de profondeur (ex: rodz.contact.companyWebsite)
  for (const v of Object.values(p)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const found = extractUrlFromPayload(v);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Strip HTML, scripts, styles, normalize whitespace. Keep ~8KB max.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

async function fetchHomepageText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; iFINDBot/1.0; +https://ifind.fr/bot)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(6000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    const html = await res.text();
    if (html.length < 200) return null;
    return htmlToText(html);
  } catch {
    return null;
  }
}

async function summarizeWithSonnet(
  companyName: string,
  rawText: string,
): Promise<string | null> {
  const anthropic = getAnthropic();
  const prompt = `Tu es un analyste qui aide à qualifier un lead pour DigitestLab (test logiciel externalisé). Voici le texte extrait de la homepage de "${companyName}" :

---
${rawText.slice(0, 6000)}
---

Résume en 150 caractères MAX les signaux les plus pertinents pour DigitestLab. Focus :
- Taille équipe / effectif (nombre devs / testeurs / total)
- Secteur précis (éditeur SaaS B2B ? ESN ? cabinet conseil ?)
- Localisation (France / international / offshore)
- Stack tech ou domaine fonctionnel mentionné
- Indices anti-ICP : "régie", "client final", "200+ collaborateurs", équipe offshore

Réponds UNIQUEMENT avec le résumé brut, sans markdown, sans préfixe. Maximum 150 chars.`;

  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("")
      .trim();
    if (!text || text.length < 10) return null;
    return text.slice(0, 200);
  } catch {
    return null;
  }
}

export async function fetchCompanyWebsiteSummary(
  companyName: string,
  companySiret: string | null,
  rawPayload: unknown,
): Promise<string | null> {
  if (!companyName || companyName.trim().length < 2) return null;

  // Cache hit ?
  const cacheKey = companySiret ?? companyName.toLowerCase();
  const cached = websiteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.summary;
  }

  const url = extractUrlFromPayload(rawPayload);
  if (!url) return null;

  const text = await fetchHomepageText(url);
  if (!text) return null;

  const summary = await summarizeWithSonnet(companyName, text);
  if (!summary) return null;

  websiteCache.set(cacheKey, {
    summary: `${summary} [src:${url}]`,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  console.log(
    `[company-website] "${companyName}" via ${url} : "${summary.slice(0, 80)}..."`,
  );
  return websiteCache.get(cacheKey)!.summary;
}

export function formatCompanyWebsiteBlock(summary: string | null): string | null {
  if (!summary) return null;
  return `COMPANY WEBSITE summary (homepage scraped + Sonnet) :\n${summary}`;
}
