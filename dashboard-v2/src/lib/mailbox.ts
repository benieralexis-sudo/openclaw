// ──────────────────────────────────────────────────────────────────────
// Mailbox client — SMTP send + IMAP fetch via Gmail App Passwords
// ──────────────────────────────────────────────────────────────────────
// Lit MAILBOX_*_USER / MAILBOX_*_APP_PASSWORD / MAILBOX_*_LABEL depuis .env.
// IMAP : imap.gmail.com:993 SSL  |  SMTP : smtp.gmail.com:587 STARTTLS.
//
// SÉCURITÉ : ne JAMAIS exposer les app passwords côté client (server-only).
// L'API /api/mailboxes ne renvoie QUE { id, user, label }.
// ──────────────────────────────────────────────────────────────────────

import "server-only";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export interface MailboxConfig {
  id: string; // "mailbox-1", "mailbox-2", ...
  user: string;
  appPassword: string;
  label: string;
}

export interface MailboxPublic {
  id: string;
  user: string;
  label: string;
}

export interface SendEmailParams {
  fromMailboxId: string;
  to: string;
  subject: string;
  body: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  replyToName?: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface InboxMessage {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string;
  fromName: string;
  to: string;
  subject: string;
  date: string;
  bodyText: string;
  bodyHtml: string | null;
}

// ──────────────────────────────────────────────────────────────────────
// Config loader
// ──────────────────────────────────────────────────────────────────────

let cachedMailboxes: MailboxConfig[] | null = null;

export function listMailboxes(): MailboxPublic[] {
  return loadMailboxes().map(({ id, user, label }) => ({ id, user, label }));
}

export function getMailbox(id: string): MailboxConfig | null {
  return loadMailboxes().find((m) => m.id === id) ?? null;
}

function loadMailboxes(): MailboxConfig[] {
  if (cachedMailboxes) return cachedMailboxes;
  const out: MailboxConfig[] = [];
  for (let i = 1; i <= 10; i++) {
    const user = process.env[`MAILBOX_${i}_USER`];
    const pass = process.env[`MAILBOX_${i}_APP_PASSWORD`];
    if (!user || !pass) continue;
    out.push({
      id: `mailbox-${i}`,
      user: user.trim(),
      appPassword: pass.trim(),
      label: process.env[`MAILBOX_${i}_LABEL`]?.trim() || user.trim(),
    });
  }
  cachedMailboxes = out;
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// SMTP send
// ──────────────────────────────────────────────────────────────────────

const transporters = new Map<string, Transporter>();

function getTransporter(mb: MailboxConfig): Transporter {
  const t = transporters.get(mb.id);
  if (t) return t;
  const fresh = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // STARTTLS
    auth: { user: mb.user, pass: mb.appPassword },
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
  transporters.set(mb.id, fresh);
  return fresh;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const mb = getMailbox(params.fromMailboxId);
  if (!mb) return { ok: false, error: `Mailbox introuvable : ${params.fromMailboxId}` };

  if (!params.to || !params.subject || !params.body) {
    return { ok: false, error: "Champs manquants (to/subject/body)" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.to)) {
    return { ok: false, error: "Email destinataire invalide" };
  }

  try {
    const transporter = getTransporter(mb);
    const fromHeader = params.replyToName
      ? `"${params.replyToName.replace(/"/g, "")}" <${mb.user}>`
      : mb.user;

    const info = await transporter.sendMail({
      from: fromHeader,
      to: params.to,
      subject: params.subject,
      text: params.body,
      html: params.html,
      replyTo: mb.user,
      inReplyTo: params.inReplyTo,
      references: params.references,
      headers: {
        "X-Mailer": "iFIND Trigger Engine v2.0",
      },
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// ──────────────────────────────────────────────────────────────────────
// IMAP fetch (utilisé seulement côté bot poller — TS wrapper minimal)
// ──────────────────────────────────────────────────────────────────────
// Le poller IMAP tourne côté bot (skills/trigger-engine/lib/imap-replies-poller.js).
// Le dashboard n'a pas besoin de pull IMAP — il lit EmailActivity de la DB.
// On expose ici juste une fonction utilitaire pour debug/test manuel.

export async function fetchInbox(opts: {
  mailboxId: string;
  sinceMs?: number;
  limit?: number;
}): Promise<{ ok: true; messages: InboxMessage[] } | { ok: false; error: string }> {
  const mb = getMailbox(opts.mailboxId);
  if (!mb) return { ok: false, error: `Mailbox introuvable : ${opts.mailboxId}` };

  // Import dynamique pour éviter de charger imapflow/mailparser au cold start
  // côté Next.js si non utilisé.
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  const sinceMs = opts.sinceMs ?? Date.now() - 24 * 3600 * 1000;
  const limit = opts.limit ?? 50;
  const since = new Date(sinceMs);

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: mb.user, pass: mb.appPassword },
    logger: false,
    emitLogs: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    const messages: InboxMessage[] = [];
    try {
      let count = 0;
      for await (const msg of client.fetch(
        { since },
        { envelope: true, source: { maxLength: 32768 }, headers: ["message-id", "in-reply-to", "references"] },
      )) {
        if (count >= limit) break;
        count += 1;
        const env = msg.envelope;
        if (!env) continue;
        const from = env.from?.[0]?.address ?? "";
        const fromName = env.from?.[0]?.name ?? "";
        const to = env.to?.[0]?.address ?? "";
        const subject = env.subject ?? "";
        const date = env.date ? env.date.toISOString() : new Date().toISOString();
        const messageId = env.messageId ?? null;
        const inReplyTo = env.inReplyTo ?? null;

        let bodyText = "";
        let bodyHtml: string | null = null;
        let references: string[] = [];
        if (msg.source) {
          try {
            const parsed = await simpleParser(msg.source);
            bodyText = (parsed.text || "").trim();
            bodyHtml = parsed.html || null;
            const refsHdr = parsed.references;
            if (Array.isArray(refsHdr)) references = refsHdr;
            else if (typeof refsHdr === "string") references = refsHdr.split(/\s+/).filter(Boolean);
          } catch {
            // fallback: empty body
          }
        }
        messages.push({
          uid: typeof msg.uid === "number" ? msg.uid : parseInt(String(msg.uid), 10),
          messageId,
          inReplyTo,
          references,
          from,
          fromName,
          to,
          subject,
          date,
          bodyText,
          bodyHtml,
        });
      }
    } finally {
      lock.release();
    }
    await client.logout().catch(() => {});
    return { ok: true, messages };
  } catch (e) {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
