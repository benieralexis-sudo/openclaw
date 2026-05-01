import "server-only";

/**
 * Sync IMAP → DB — détecte les replies sur les mailboxes Primeforge et
 * les insère dans la table Reply (avec lien vers EmailActivity SENT et Lead).
 *
 * Lancé via cron `*\/5 * * * *` → endpoint /api/internal/sync-inbox.
 * Fenêtre IMAP : 1h glissante (overshoot vs cron 5 min pour absorber lag).
 * Dédup : Reply.messageId UNIQUE (catch P2002 silencieux).
 *
 * Avant cette lib (01/05/2026) : aucune reply email n'était captée par
 * iFIND. L'envoi SMTP marchait mais la boucle reply était cassée — risque
 * blacklist Primeforge si quelqu'un répondait "STOP" et qu'on continuait.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchInbox, listMailboxes } from "@/lib/mailbox";

export interface SyncInboxResult {
  scanned: number;
  matched: number;
  created: number;
  skippedDuplicate: number;
  skippedNoReply: number;
  skippedNoMatch: number;
  errors: Array<{ mailboxId: string; error: string }>;
  byMailbox: Array<{
    mailboxId: string;
    user: string;
    fetched: number;
    created: number;
  }>;
}

/**
 * Normalise un Message-ID IMAP : retire les chevrons et trim.
 * "<abc@domain>" → "abc@domain"
 */
function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^<|>$/g, "");
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Le poller IMAP — pour chaque mailbox :
 *  1. Fetch les messages reçus depuis `windowMs` (défaut 1h)
 *  2. Pour chaque message qui a un inReplyTo (= reply à un de nos sends) :
 *     - Cherche EmailActivity SENT avec messageId = inReplyTo
 *     - Si trouvé : crée Reply liée au lead
 *     - Si déjà existe : skip silencieux (UNIQUE messageId)
 *
 * Note : on tolère les replies sans inReplyTo en cherchant sur les références
 * (certains clients mail cassent le inReplyTo, mais maintiennent references).
 */
export async function syncInboxAllMailboxes(opts: {
  windowMs?: number;
  limit?: number;
} = {}): Promise<SyncInboxResult> {
  const windowMs = opts.windowMs ?? 60 * 60 * 1000; // 1h
  const limit = opts.limit ?? 50;
  const sinceMs = Date.now() - windowMs;

  const result: SyncInboxResult = {
    scanned: 0,
    matched: 0,
    created: 0,
    skippedDuplicate: 0,
    skippedNoReply: 0,
    skippedNoMatch: 0,
    errors: [],
    byMailbox: [],
  };

  const mailboxes = listMailboxes();
  for (const mb of mailboxes) {
    let fetched = 0;
    let created = 0;
    const fetchResult = await fetchInbox({
      mailboxId: mb.id,
      sinceMs,
      limit,
    });
    if (!fetchResult.ok) {
      result.errors.push({ mailboxId: mb.id, error: fetchResult.error });
      result.byMailbox.push({ mailboxId: mb.id, user: mb.user, fetched: 0, created: 0 });
      continue;
    }

    fetched = fetchResult.messages.length;
    result.scanned += fetched;

    for (const msg of fetchResult.messages) {
      const inReplyTo = normalizeMessageId(msg.inReplyTo);
      const refs = (msg.references ?? []).map(normalizeMessageId).filter((r): r is string => r !== null);
      const candidateIds = inReplyTo ? [inReplyTo, ...refs] : refs;

      if (candidateIds.length === 0) {
        result.skippedNoReply += 1;
        continue;
      }

      // Cherche une EmailActivity SENT correspondant à au moins un des messageId
      // candidats (inReplyTo prioritaire, puis references pour compat clients
      // mail qui cassent le inReplyTo).
      const sent = await db.emailActivity.findFirst({
        where: {
          direction: "SENT",
          messageId: { in: candidateIds },
        },
        select: { id: true, leadId: true, lead: { select: { clientId: true } } },
      });

      if (!sent || !sent.lead) {
        result.skippedNoMatch += 1;
        continue;
      }

      result.matched += 1;

      const replyMessageId = normalizeMessageId(msg.messageId);
      try {
        await db.reply.create({
          data: {
            clientId: sent.lead.clientId,
            leadId: sent.leadId,
            fromEmail: msg.from,
            fromName: msg.fromName || null,
            subject: msg.subject || null,
            body: msg.bodyText || "",
            bodyHtml: msg.bodyHtml,
            receivedAt: new Date(msg.date),
            messageId: replyMessageId,
          },
        });
        created += 1;
        result.created += 1;
      } catch (e) {
        // P2002 = unique constraint sur messageId → reply déjà ingérée, OK
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          result.skippedDuplicate += 1;
          continue;
        }
        result.errors.push({
          mailboxId: mb.id,
          error: `db_create: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }

    result.byMailbox.push({ mailboxId: mb.id, user: mb.user, fetched, created });
  }

  return result;
}
