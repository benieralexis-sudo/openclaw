import "server-only";
// Sprint Persona Excellence (17/05/2026) — Phase 5
//
// Récupère les 10 derniers posts LinkedIn du décideur identifié (90j max)
// via HarvestAPI actor `harvestapi/linkedin-profile-posts`. Cache 7j.
//
// Pourquoi : enrichit le dossier passé à Opus pour qu'il puisse personaliser
// l'opener avec un signal d'achat ultra-frais ("vu que tu as publié sur X
// la semaine dernière..."). Les posts récents révèlent les préoccupations
// immédiates du décideur, bien plus prédictif que le profil statique.
//
// Coût : ~$0.005/profil scrappé (Apify pricing harvestapi). Cache 7j absorbe
// les ré-appels pendant un cycle de qualif.

import { runAndGetItems } from "@/lib/apify";

const ACTOR_ID = "harvestapi/linkedin-profile-posts";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const MAX_POSTS_PER_PROFILE = 10;
const MAX_AGE_DAYS = 90;

export interface RecentPost {
  /** Date de publication ISO (best-effort, peut être absente) */
  postedAt: string | null;
  /** Texte du post (peut être tronqué pour les très longs) */
  text: string;
  /** Nb réactions (likes total) */
  reactions: number;
  /** Nb commentaires */
  comments: number;
  /** URL du post LinkedIn */
  postUrl?: string;
}

interface CacheEntry {
  posts: RecentPost[];
  ts: number;
}
const cache = new Map<string, CacheEntry>();

function cacheKey(profileUrl: string): string {
  return profileUrl.trim().toLowerCase();
}

function cacheGet(key: string): RecentPost[] | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return e.posts;
}

function cacheSet(key: string, posts: RecentPost[]): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, { posts, ts: Date.now() });
}

// Format brut HarvestAPI peut varier — on accepte plusieurs schémas
interface HarvestPostRaw {
  postedAt?: string;
  publishedAt?: string;
  date?: string;
  text?: string;
  content?: string;
  body?: string;
  reactions?: number;
  totalReactions?: number;
  likesCount?: number;
  numLikes?: number;
  comments?: number;
  totalComments?: number;
  commentsCount?: number;
  postUrl?: string;
  url?: string;
}

/**
 * Normalize 1 post brut HarvestAPI vers RecentPost. Tolérant aux variations
 * de schéma (les actors évoluent).
 */
export function normalizePost(raw: HarvestPostRaw): RecentPost | null {
  const text = (raw.text ?? raw.content ?? raw.body ?? "").trim();
  if (!text) return null;
  const postedAt = raw.postedAt ?? raw.publishedAt ?? raw.date ?? null;
  return {
    postedAt,
    text: text.slice(0, 800),
    reactions: raw.reactions ?? raw.totalReactions ?? raw.likesCount ?? raw.numLikes ?? 0,
    comments: raw.comments ?? raw.totalComments ?? raw.commentsCount ?? 0,
    postUrl: raw.postUrl ?? raw.url,
  };
}

/**
 * Pure function — Filtre posts dans les N derniers jours.
 */
export function filterRecentPosts(posts: RecentPost[], maxAgeDays = MAX_AGE_DAYS): RecentPost[] {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return posts.filter((p) => {
    if (!p.postedAt) return true; // garde si date inconnue (peut être un post récent mal parsé)
    const t = Date.parse(p.postedAt);
    if (Number.isNaN(t)) return true;
    return t >= cutoff;
  });
}

/**
 * Pure function — Compte combien de posts matchent les keywords du signal.
 * Sert au scorer Phase 3 (signalContext score).
 */
export function countSignalMatchingPosts(
  posts: RecentPost[],
  signalKeywords: string[],
): number {
  if (signalKeywords.length === 0) return 0;
  const lcKeywords = signalKeywords.map((k) => k.toLowerCase());
  return posts.filter((p) => {
    const lcText = p.text.toLowerCase();
    return lcKeywords.some((k) => lcText.includes(k));
  }).length;
}

/**
 * Récupère les 10 derniers posts LinkedIn 90j du décideur. Cache 7j.
 *
 * @param profileUrl URL LinkedIn (ex: "https://linkedin.com/in/williamhgates")
 * @returns Array trié récent → ancien (max 10), ou tableau vide si erreur.
 */
export async function fetchRecentPostsForProfile(
  profileUrl: string,
): Promise<RecentPost[]> {
  if (!profileUrl) return [];

  const key = cacheKey(profileUrl);
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  try {
    const result = await runAndGetItems<HarvestPostRaw>(
      ACTOR_ID,
      {
        profileUrls: [profileUrl],
        maxPosts: MAX_POSTS_PER_PROFILE,
      },
      { timeout: 90, memory: 512, itemsLimit: MAX_POSTS_PER_PROFILE },
    );
    const normalized = result.items
      .map(normalizePost)
      .filter((p): p is RecentPost => p !== null);
    const recent = filterRecentPosts(normalized);
    cacheSet(key, recent);
    return recent;
  } catch (e) {
    console.warn(
      `[harvestapi-recent-posts] err pour ${profileUrl}:`,
      e instanceof Error ? e.message : String(e),
    );
    cacheSet(key, []); // cache empty result pour éviter retry 7j
    return [];
  }
}

/**
 * Pure function — Formate les posts pour le bloc dossier Opus.
 * Garde compact (max 600 chars total) pour ne pas exploser le contexte.
 */
export function formatPostsForDossier(posts: RecentPost[]): string {
  if (posts.length === 0) return "";
  const lines = posts.slice(0, 10).map((p) => {
    const date = p.postedAt ? p.postedAt.slice(0, 10) : "?";
    const engagement = p.reactions > 0 || p.comments > 0
      ? ` (${p.reactions}❤ ${p.comments}💬)`
      : "";
    const text = p.text.replace(/\n+/g, " ").slice(0, 150);
    return `- ${date}${engagement} : "${text}"`;
  });
  return `\nPOSTS RÉCENTS LINKEDIN DU DÉCIDEUR (${posts.length} max 10, 90j) :\n${lines.join("\n")}`;
}

/** Pour tests — clear cache */
export function clearRecentPostsCache(): void {
  cache.clear();
}
