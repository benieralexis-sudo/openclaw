// Sprint 3 (10/05/2026) — Sender multi-canal pour delivery client.
//
// Capacites :
//   - Email via Resend (HTML + text)
//   - Telegram via bot existant (channel client dedicated, optionnel)
//
// Pas d'I/O hors envoi. Tracking de l'envoi gere par le caller (runner)
// dans AuditLog (creation entry action='delivery.sent' apres succes).

const RESEND_KEY = process.env.RESEND_API_KEY ?? "";
const DEFAULT_SENDER_EMAIL = process.env.SENDER_EMAIL ?? "onboarding@resend.dev";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

export interface SendEmailOpts {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optionnel : override sender (defaut SENDER_EMAIL env) */
  fromEmail?: string;
  /** Optionnel : nom expediteur (defaut "iFIND") */
  fromName?: string;
}

export interface SendEmailResult {
  ok: boolean;
  emailId?: string;
  error?: string;
  durationMs: number;
}

export async function sendEmailViaResend(opts: SendEmailOpts): Promise<SendEmailResult> {
  const start = Date.now();
  if (!RESEND_KEY) {
    return { ok: false, error: "RESEND_API_KEY not configured", durationMs: 0 };
  }
  const fromEmail = opts.fromEmail ?? DEFAULT_SENDER_EMAIL;
  const fromName = opts.fromName ?? "iFIND";
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const durationMs = Date.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
        durationMs,
      };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, emailId: data.id, durationMs };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

export interface SendTelegramOpts {
  chatId: string;
  text: string;
  /** parse_mode (defaut Markdown) */
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
}

export interface SendTelegramResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export async function sendTelegramMessage(opts: SendTelegramOpts): Promise<SendTelegramResult> {
  if (!TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: opts.chatId,
          text: opts.text,
          parse_mode: opts.parseMode ?? "Markdown",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { result?: { message_id?: number } };
    return { ok: true, messageId: data.result?.message_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
