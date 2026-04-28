// ═══════════════════════════════════════════════════════════════════
// Mailbox IMAP Poller — détection des replies sur les Primeforge mailboxes
// ═══════════════════════════════════════════════════════════════════
// Lit MAILBOX_*_USER + MAILBOX_*_APP_PASSWORD depuis process.env.
// Pour chaque message reçu, fait :
//   1. dédup via messageId vs EmailActivity.messageId (Postgres dashboard-v2)
//   2. match sender vs Lead.email → si match, INSERT EmailActivity{direction:RECEIVED}
//   3. notify Telegram admin
//
// Pas de send auto, pas d'auto-reply. Lecture only.
// Tourne dans la VM gateway/telegram-router (Node 22, mêmes deps que inbox-manager).
// ═══════════════════════════════════════════════════════════════════

'use strict';

let ImapFlow = null;
let simpleParser = null;
try { ImapFlow = require('imapflow').ImapFlow; } catch (_e) { /* deps missing */ }
try { simpleParser = require('mailparser').simpleParser; } catch (_e) { /* deps missing */ }

const https = require('node:https');
const { Client } = require('pg');

/**
 * Classification IA d'un reply via Claude Haiku 4.5 (ultra-cheap : ~0.0005€/call).
 * Retourne 'positive' | 'neutral' | 'negative' | 'ooo' | 'unsubscribe' | null si fail.
 *
 * Heuristique de fallback rapide (sans appel API) si patterns évidents :
 *   - "out of office", "vacation", "absent" → 'ooo'
 *   - "unsubscribe", "ne plus recevoir", "désabonner" → 'unsubscribe'
 *   - Sinon → Haiku.
 */
async function classifyReply(subject, bodyText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const text = `${subject || ''}\n\n${bodyText || ''}`.toLowerCase();
  // Heuristiques rapides (gratuit)
  if (/(out of office|vacation|absent|i'm away|je suis absent|congés|vacances)/.test(text)) {
    return 'ooo';
  }
  if (/(unsubscribe|ne plus recevoir|me désabonner|stop email|retirer.{1,20}liste|opt[\s-]?out)/.test(text)) {
    return 'unsubscribe';
  }

  // Sinon Haiku (très cheap mais évitons d'appeler à chaque fois si on a déjà un signal clair)
  const userPrompt = `Reply email reçu. Classe-le en 1 mot strict parmi : positive, neutral, negative, ooo, unsubscribe.

Sujet : ${(subject || '').slice(0, 100)}
Corps : ${(bodyText || '').slice(0, 500)}

Réponds UNIQUEMENT le mot, rien d'autre.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = (data.content?.[0]?.text || '').trim().toLowerCase();
    if (['positive', 'neutral', 'negative', 'ooo', 'unsubscribe'].includes(out)) {
      return out;
    }
    return null;
  } catch {
    return null;
  }
}

const log = (() => {
  try { return require('../../../gateway/logger.js'); }
  catch { return console; }
})();

function listMailboxes() {
  const out = [];
  for (let i = 1; i <= 10; i++) {
    const user = process.env[`MAILBOX_${i}_USER`];
    const pass = process.env[`MAILBOX_${i}_APP_PASSWORD`];
    if (!user || !pass) continue;
    out.push({
      id: `mailbox-${i}`,
      user: user.trim(),
      appPassword: pass.trim(),
      label: (process.env[`MAILBOX_${i}_LABEL`] || user).trim(),
    });
  }
  return out;
}

function getDashboardDbUrl() {
  // Le dashboard-v2 utilise DATABASE_URL pointant sur 127.0.0.1:5433 (Postgres iFIND).
  return process.env.DASHBOARD_DATABASE_URL
      || process.env.IFIND_DATABASE_URL
      || process.env.DATABASE_URL_V2
      || 'postgresql://ifind:b7718738d59bc43b64810242d0f5d961fd3569229f1d94ff@127.0.0.1:5433/ifind';
}

function sendTelegram(text, chatId) {
  return new Promise((resolve) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const target = chatId || process.env.ADMIN_CHAT_ID || '1409505520';
    if (!token || !target) return resolve({ ok: false });
    const body = JSON.stringify({ chat_id: target, text, parse_mode: 'Markdown', disable_web_page_preview: true });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ ok: false }); }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false }); });
    req.write(body);
    req.end();
  });
}

function escapeMarkdown(t) {
  return (t || '').replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&').substring(0, 500);
}

function genCuid() {
  // CUID-like — Prisma `@default(cuid())` accepte n'importe quel id texte.
  return 'cma_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function fetchOneMailbox(mb, sinceMs) {
  if (!ImapFlow) {
    return { ok: false, error: 'imapflow non installé', messages: [] };
  }
  const since = new Date(sinceMs || (Date.now() - 24 * 3600 * 1000));
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: mb.user, pass: mb.appPassword },
    logger: false,
    emitLogs: false,
  });

  let connected = false;
  try {
    await client.connect();
    connected = true;
  } catch (e) {
    return { ok: false, error: 'connect: ' + (e.message || e), messages: [] };
  }

  const messages = [];
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      for await (const msg of client.fetch(
        { since },
        { envelope: true, source: { maxLength: 32768 }, flags: true }
      )) {
        const env = msg.envelope;
        if (!env) continue;
        const from = env.from && env.from[0] ? (env.from[0].address || '') : '';
        const fromName = env.from && env.from[0] ? (env.from[0].name || '') : '';
        const to = env.to && env.to[0] ? (env.to[0].address || '') : '';
        const subject = env.subject || '';
        const date = env.date ? env.date.toISOString() : new Date().toISOString();
        const messageId = env.messageId || null;
        const inReplyTo = env.inReplyTo || null;

        let bodyText = '';
        let bodyHtml = null;
        if (msg.source && simpleParser) {
          try {
            const parsed = await simpleParser(msg.source);
            bodyText = (parsed.text || '').trim();
            bodyHtml = parsed.html || null;
          } catch {
            bodyText = '';
          }
        }
        messages.push({ from, fromName, to, subject, date, messageId, inReplyTo, bodyText, bodyHtml });
      }
    } finally {
      lock.release();
    }
  } catch (e) {
    return { ok: false, error: 'fetch: ' + (e.message || e), messages };
  } finally {
    if (connected) {
      try { await client.logout(); } catch { /* noop */ }
    }
  }
  return { ok: true, messages };
}

function isSystemEmail(email) {
  const local = (email || '').split('@')[0].toLowerCase();
  const sys = [
    'noreply', 'no-reply', 'mailer-daemon', 'postmaster',
    'bounce', 'bounces', 'donotreply', 'do-not-reply', 'auto-reply',
    'notifications', 'newsletter', 'newsletters', 'admin', 'webmaster',
  ];
  if (sys.includes(local)) return true;
  if (sys.some((p) => local.startsWith(p + '+') || local.startsWith(p + '-'))) return true;
  return false;
}

/**
 * Run one polling cycle across all configured mailboxes.
 * Inserts EmailActivity rows for new replies matching known leads.
 * Returns aggregated stats.
 */
async function runPollCycle({ sinceMs } = {}) {
  const mailboxes = listMailboxes();
  if (mailboxes.length === 0) {
    return { ok: false, reason: 'no-mailboxes', mailboxesPolled: 0, repliesDetected: 0 };
  }

  const dbUrl = getDashboardDbUrl();
  const pg = new Client({ connectionString: dbUrl });
  let stats = { mailboxesPolled: 0, mailboxFailures: 0, totalFetched: 0, repliesDetected: 0, alreadySeen: 0 };

  try {
    await pg.connect();
  } catch (e) {
    log.error?.('[mailbox-poller] PG connect error: ' + (e.message || e));
    return { ok: false, error: 'pg-connect', ...stats };
  }

  try {
    for (const mb of mailboxes) {
      const r = await fetchOneMailbox(mb, sinceMs);
      stats.mailboxesPolled += 1;
      if (!r.ok) {
        stats.mailboxFailures += 1;
        log.warn?.(`[mailbox-poller] ${mb.user}: ${r.error}`);
        continue;
      }
      stats.totalFetched += r.messages.length;

      for (const msg of r.messages) {
        if (!msg.from || isSystemEmail(msg.from)) continue;
        if (msg.from.toLowerCase() === mb.user.toLowerCase()) continue; // self

        // Dédup via messageId
        if (msg.messageId) {
          const exists = await pg.query(
            'SELECT id FROM "EmailActivity" WHERE "messageId" = $1 LIMIT 1',
            [msg.messageId]
          );
          if (exists.rowCount > 0) {
            stats.alreadySeen += 1;
            continue;
          }
        }

        // Match lead via email (insensitive)
        const leadRes = await pg.query(
          'SELECT id, "clientId", "fullName", "companyName" FROM "Lead" WHERE LOWER(email) = LOWER($1) AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1',
          [msg.from]
        );
        if (leadRes.rowCount === 0) {
          // Pas un lead connu — on ignore (pourrait être un commercial ami, etc.)
          continue;
        }
        const lead = leadRes.rows[0];

        // Classification IA (Haiku ~0.0005€/call avec heuristique préalable)
        const classification = await classifyReply(msg.subject, msg.bodyText);

        // INSERT EmailActivity
        const id = genCuid();
        try {
          await pg.query(
            `INSERT INTO "EmailActivity" (
                id, "leadId", direction, "fromMailbox", "toEmail", subject,
                "bodyText", "bodyHtml", "messageId", "inReplyTo", "sentAt",
                "replyClassification", "replyClassifiedAt", "createdAt"
              ) VALUES ($1, $2, 'RECEIVED', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
            [
              id, lead.id, msg.from, mb.user,
              msg.subject || '(sans sujet)',
              msg.bodyText || null,
              msg.bodyHtml,
              msg.messageId,
              msg.inReplyTo,
              new Date(msg.date),
              classification,
              classification ? new Date() : null,
            ]
          );
          stats.repliesDetected += 1;
          if (classification) stats[`classified_${classification}`] = (stats[`classified_${classification}`] || 0) + 1;

          // Bump lead status selon classification
          let newStatus = 'CONTACTED';
          if (classification === 'unsubscribe') newStatus = 'NOT_INTERESTED';
          // 'positive' garde 'CONTACTED' mais on aurait pu créer un statut 'WARM'
          await pg.query(
            `UPDATE "Lead" SET status = $2, "updatedAt" = NOW()
             WHERE id = $1 AND status NOT IN ('NOT_INTERESTED','ARCHIVED')`,
            [lead.id, newStatus]
          );

          // Notif Telegram admin (sauf OOO et unsubscribe = système, on ne dérange pas)
          if (classification !== 'ooo' && classification !== 'unsubscribe') {
            const emoji = classification === 'positive' ? '🔥' : classification === 'negative' ? '❌' : '📬';
            const classLabel = classification ? ` — *${classification.toUpperCase()}*` : '';
            const text = [
              `${emoji} *Reply email détecté*${classLabel}`,
              '',
              `👤 *De :* ${escapeMarkdown(msg.fromName || msg.from)}`,
              `📧 ${escapeMarkdown(msg.from)}`,
              `📋 *Sujet :* ${escapeMarkdown(msg.subject)}`,
              `🏢 *Lead :* ${escapeMarkdown(lead.fullName || '—')} — ${escapeMarkdown(lead.companyName || '—')}`,
              `📥 *Mailbox :* ${escapeMarkdown(mb.label)}`,
              '',
              msg.bodyText ? '_' + escapeMarkdown(msg.bodyText.substring(0, 200)) + '_' : '',
            ].filter(Boolean).join('\n');
            await sendTelegram(text);
          }
        } catch (e) {
          // Double-check unique violation messageId race condition
          if (!/duplicate key|unique constraint/i.test(e.message || '')) {
            log.error?.(`[mailbox-poller] insert error: ${e.message}`);
          }
        }
      }
    }
  } finally {
    try { await pg.end(); } catch { /* noop */ }
  }

  if (stats.repliesDetected > 0 || stats.mailboxFailures > 0) {
    log.info?.(`[mailbox-poller] polled=${stats.mailboxesPolled} fetched=${stats.totalFetched} replies=${stats.repliesDetected} dup=${stats.alreadySeen} fail=${stats.mailboxFailures}`);
  }
  return { ok: true, ...stats };
}

module.exports = { runPollCycle, listMailboxes, fetchOneMailbox };
