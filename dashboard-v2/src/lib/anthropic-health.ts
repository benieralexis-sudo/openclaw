// Sprint reprise (17/05/2026) — Circuit breaker Anthropic.
//
// Problème résolu : 17/05 matin, panne Anthropic ("credit balance too low")
// a entraîné le marquage IGNORED de 233 triggers en quelques heures via
// qualify-trigger.ts:645 (`scoreReason='[v2-failed]...'`), invisibles par
// qualifyPendingTriggers → backlog mort sans intervention manuelle.
//
// Solution : un flag in-memory + fichier qui :
//   - se lève quand qualify-trigger détecte une erreur Anthropic transient
//     (credit balance, 429, 503, network) au lieu de marquer IGNORED
//   - bloque qualifyPendingTriggers + qualifyTrigger entrée à chaque cycle
//     suivant tant qu'il est levé
//   - se baisse automatiquement quand un re-ping Anthropic réussit
//   - alerte Telegram à la transition (pause + reprise)
//
// Effet net : si Anthropic tombe, le pipeline se met en pause silencieuse,
// les triggers restent status=NEW, et tout reprend automatiquement au
// premier cycle suivant la guérison. Zéro lead perdu.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const FLAG_PATH = "/tmp/ifind-anthropic-down-flag.json";
const HEALTH_CHECK_TTL_MS = 5 * 60 * 1000; // re-ping toutes les 5 min max

interface DownFlag {
  since: string;
  reason: string;
  lastCheck: string;
  attempts: number;
}

const TRANSIENT_PATTERNS: RegExp[] = [
  /credit balance/i,
  /\b429\b/,
  /rate.?limit/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ENOTFOUND/i,
  /\b503\b/,
  /\b502\b/,
  /overloaded/i,
  /service.unavailable/i,
  /anthropic.*down/i,
];

/**
 * Détecte si une erreur (string ou Error) ressemble à une panne Anthropic
 * transient (réseau, quota, rate-limit). Retourne false pour les erreurs
 * de logique (Zod, dossier null, etc.) qui doivent rester IGNORED.
 */
export function isTransientAnthropicError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return TRANSIENT_PATTERNS.some((re) => re.test(msg));
}

function readFlag(): DownFlag | null {
  if (!existsSync(FLAG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(FLAG_PATH, "utf-8")) as DownFlag;
  } catch {
    return null;
  }
}

function writeFlag(flag: DownFlag): void {
  writeFileSync(FLAG_PATH, JSON.stringify(flag, null, 2));
}

/**
 * Lève le drapeau "Anthropic down" et déclenche une alerte Telegram à la
 * première transition. Idempotent : multiples appels n'envoient pas de spam.
 */
export function markAnthropicDown(reason: string): void {
  const existing = readFlag();
  const flag: DownFlag = {
    since: existing?.since ?? new Date().toISOString(),
    reason: reason.slice(0, 200),
    lastCheck: new Date().toISOString(),
    attempts: (existing?.attempts ?? 0) + 1,
  };
  writeFlag(flag);
  if (!existing) {
    void sendTelegramAlert(
      `🚨 *Anthropic DOWN détecté* — ${reason.slice(0, 120)}\n\nPipeline en pause auto. Aucun lead ne sera marqué IGNORED tant que ça ne pingue pas.`,
    );
  }
}

/**
 * Baisse le drapeau et notifie Telegram. Appelé quand un re-ping Anthropic
 * réussit (auto-recovery) ou manuellement.
 */
export function clearAnthropicDown(): void {
  if (existsSync(FLAG_PATH)) {
    const flag = readFlag();
    try {
      unlinkSync(FLAG_PATH);
    } catch {
      /* swallow */
    }
    const downSince = flag?.since
      ? new Date(flag.since).toISOString()
      : "?";
    void sendTelegramAlert(
      `✅ *Anthropic UP* — Pipeline reprend (pause depuis ${downSince}, ${flag?.attempts ?? 0} re-tries).`,
    );
  }
}

// Cache mémoire pour éviter de pinger Anthropic à chaque qualify call
let cachedCheck: { isDown: boolean; checkedAt: number } | null = null;

/**
 * Vérifie si Anthropic est down. Si flag présent, re-ping (cap 5 min)
 * avec Haiku 1 token pour tester la recovery. Si ping OK → flag baissé
 * et retourne false. Sinon flag maintenu et retourne true.
 *
 * Cache 5 min pour ne pas re-pinger à chaque call.
 */
export async function isAnthropicDown(): Promise<boolean> {
  const now = Date.now();
  if (cachedCheck && now - cachedCheck.checkedAt < HEALTH_CHECK_TTL_MS) {
    return cachedCheck.isDown;
  }
  const flag = readFlag();
  if (!flag) {
    cachedCheck = { isDown: false, checkedAt: now };
    return false;
  }
  // Flag présent → re-ping Anthropic
  try {
    const { getAnthropic } = await import("./anthropic");
    const anthropic = getAnthropic();
    await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 5,
      messages: [{ role: "user", content: "ok" }],
    });
    clearAnthropicDown();
    cachedCheck = { isDown: false, checkedAt: now };
    return false;
  } catch (e) {
    // Toujours down — renouvelle compteur attempts
    const updated: DownFlag = {
      ...flag,
      lastCheck: new Date().toISOString(),
      attempts: flag.attempts + 1,
    };
    writeFlag(updated);
    cachedCheck = { isDown: true, checkedAt: now };
    return true;
  }
}

/** Force une re-vérification au prochain isAnthropicDown (utile en tests). */
export function invalidateAnthropicHealthCache(): void {
  cachedCheck = null;
}

async function sendTelegramAlert(msg: string): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;
    if (!token || !chatId) return;
    await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: msg,
          parse_mode: "Markdown",
        }),
      },
    );
  } catch {
    /* best-effort */
  }
}
