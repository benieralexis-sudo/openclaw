import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Helper email history (audit 30/04 soir)
 * ════════════════════════════════════════
 *
 * Quand on écrase Lead.email avec un nouvel email d'une autre source
 * (waterfall Kaspr → FullEnrich → manual), on archive l'ancien dans
 * Lead.emailHistory pour audit/rollback.
 *
 * Format : Lead.emailHistory = [{ email, source, replacedAt }, ...]
 * Limit 5 entrées (FIFO) — au-delà la plus ancienne est droppée.
 *
 * Usage :
 *   const update = appendToEmailHistoryIfReplacing(
 *     existingHistory,
 *     oldEmail,
 *     "kaspr-work-email",
 *   );
 *   await db.lead.update({ where: { id }, data: { email: newEmail, ...update } });
 */

interface EmailHistoryEntry {
  email: string;
  source: string;
  replacedAt: string;
}

const MAX_HISTORY = 5;

export function appendToEmailHistoryIfReplacing(
  existingHistory: Prisma.JsonValue | null | undefined,
  oldEmail: string | null | undefined,
  oldSource: string,
): { emailHistory: Prisma.InputJsonValue } | Record<string, never> {
  // Pas d'ancien email → rien à archiver
  if (!oldEmail || !oldEmail.trim()) return {};

  const existing: EmailHistoryEntry[] = Array.isArray(existingHistory)
    ? (existingHistory as unknown as EmailHistoryEntry[])
    : [];

  // Évite la duplication si l'email est déjà dans l'historique récent
  const alreadyArchived = existing.some(
    (e) => e.email?.toLowerCase() === oldEmail.toLowerCase(),
  );
  if (alreadyArchived) return {};

  const next: EmailHistoryEntry[] = [
    ...existing.slice(-(MAX_HISTORY - 1)),
    {
      email: oldEmail,
      source: oldSource,
      replacedAt: new Date().toISOString(),
    },
  ];

  return { emailHistory: next as unknown as Prisma.InputJsonValue };
}
