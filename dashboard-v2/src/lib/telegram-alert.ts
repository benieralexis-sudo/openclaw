import "server-only";

/**
 * Sprint 10 (05/05/2026) — Helper centralisé pour alertes Telegram admin.
 *
 * Existait déjà localement dans send-email/route.ts:36 (notifyTelegram).
 * Extraction ici pour usage transverse : monitoring run-pollers, alerts
 * sur dérive coût/latence/qualité, daily health digest, etc.
 *
 * Best-effort : silent fail si TELEGRAM_BOT_TOKEN absent ou erreur réseau.
 * L'alerting ne doit JAMAIS casser un pipeline.
 *
 * Anti-spam : dédup en mémoire des messages identiques sur 60 minutes
 * (évite le flood Telegram si une alerte se déclenche à chaque cron horaire).
 */

const ADMIN_CHAT_ID_DEFAULT = "1409505520"; // Alexis (cf. MEMORY.md)
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 60 min
const dedupCache = new Map<string, number>();

function md(s: string): string {
  return (s || "").replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

export type AlertUrgency = "info" | "warn" | "error" | "ok";

const URGENCY_PREFIX: Record<AlertUrgency, string> = {
  info: "ℹ️ ",
  ok: "✅ ",
  warn: "⚠️ ",
  error: "🚨 ",
};

export interface NotifyAdminOptions {
  urgency?: AlertUrgency;
  /** Si true (défaut), dédup le message identique sur 60 min. */
  dedupKey?: string;
  /** Préfixe le titre du message en gras. */
  title?: string;
}

/**
 * Envoie un message Telegram à l'admin (chatId par défaut Alexis).
 * Idempotent best-effort. Retourne true si envoyé, false si throttled
 * ou erreur silencieuse.
 *
 * Usage typique :
 *   await notifyAdmin("Pappers quota 90%", { urgency: "warn", dedupKey: "pappers-quota-90" });
 */
export async function notifyAdmin(
  message: string,
  opts: NotifyAdminOptions = {},
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;

  const urgency = opts.urgency ?? "info";
  const dedupKey = opts.dedupKey ?? `${urgency}|${message.slice(0, 80)}`;

  // Anti-spam : skip si même clé envoyée <60 min
  const lastSent = dedupCache.get(dedupKey);
  const now = Date.now();
  if (lastSent && now - lastSent < DEDUP_WINDOW_MS) {
    return false;
  }
  dedupCache.set(dedupKey, now);
  // GC simple : flush old entries si la map dépasse 200
  if (dedupCache.size > 200) {
    for (const [k, t] of dedupCache.entries()) {
      if (now - t > DEDUP_WINDOW_MS) dedupCache.delete(k);
    }
  }

  const chatId = process.env.ADMIN_CHAT_ID || ADMIN_CHAT_ID_DEFAULT;
  const titlePart = opts.title ? `*${md(opts.title)}*\n` : "";
  const text = `${URGENCY_PREFIX[urgency]}${titlePart}${md(message).slice(0, 3500)}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Reset interne du cache de dédup (utile pour tests Vitest).
 */
export function _resetTelegramDedupCache(): void {
  dedupCache.clear();
}
