import "server-only";
import { db } from "@/lib/db";

// ═══════════════════════════════════════════════════════════════════
// Audit & Heal — pipeline idempotent qui rattrape les leads incomplets.
// Tourne dans run-pollers cron + déclenchable à la demande.
//
// Heals appliqués (par ordre, idempotent — peut tourner 100x sans dégât) :
//   1. Lead.linkedinUrl : ajout https:// manquant
//   2. Lead.companySiret : sync depuis Trigger.companySiret si Lead vide
//   3. Lead.firstName/lastName/jobTitle/linkedinUrl : backfill depuis
//      Trigger.rawPayload.contact (Rodz, Apify HarvestAPI) — couvre les
//      mappings ratés ou ajoutés a posteriori.
//   4. Trigger.companyName : trim espaces parasites
// ═══════════════════════════════════════════════════════════════════

export interface AuditResult {
  scanned: { leads: number; triggers: number };
  healed: {
    linkedinUrlNormalized: number;
    siretSyncedFromTrigger: number;
    rodzPayloadBackfilled: number;
    triggerCompanyTrimmed: number;
  };
  remaining: {
    leadsWithoutLinkedin: number;
    leadsWithoutEmail: number;
    leadsWithoutMobile: number;
    leadsWithoutSiret: number;
    leadsWithoutDirigeant: number;
  };
}

export async function auditAndHeal(opts: { clientId?: string } = {}): Promise<AuditResult> {
  const cId = opts.clientId ?? null; // null = tous clients

  const [leadsCount, triggersCount] = await Promise.all([
    db.lead.count({
      where: { deletedAt: null, ...(cId ? { clientId: cId } : {}) },
    }),
    db.trigger.count({
      where: { deletedAt: null, ...(cId ? { clientId: cId } : {}) },
    }),
  ]);

  const result: AuditResult = {
    scanned: { leads: leadsCount, triggers: triggersCount },
    healed: {
      linkedinUrlNormalized: 0,
      siretSyncedFromTrigger: 0,
      rodzPayloadBackfilled: 0,
      triggerCompanyTrimmed: 0,
    },
    remaining: {
      leadsWithoutLinkedin: 0,
      leadsWithoutEmail: 0,
      leadsWithoutMobile: 0,
      leadsWithoutSiret: 0,
      leadsWithoutDirigeant: 0,
    },
  };

  // ─────────────────────────────────────────────
  // HEAL 1 — Normalize linkedinUrl (ajout https:// manquant)
  // ─────────────────────────────────────────────
  result.healed.linkedinUrlNormalized = await db.$executeRaw`
    UPDATE "Lead"
    SET "linkedinUrl" = 'https://' || regexp_replace("linkedinUrl", '^/+', ''),
        "updatedAt" = NOW()
    WHERE "linkedinUrl" IS NOT NULL
      AND "linkedinUrl" !~ '^https?://'
      AND "linkedinUrl" != ''
      AND "deletedAt" IS NULL
      AND (${cId}::text IS NULL OR "clientId" = ${cId}::text)
  `;

  // ─────────────────────────────────────────────
  // HEAL 2 — Sync Lead.companySiret depuis Trigger.companySiret
  // ─────────────────────────────────────────────
  result.healed.siretSyncedFromTrigger = await db.$executeRaw`
    UPDATE "Lead" l
    SET "companySiret" = t."companySiret",
        "updatedAt" = NOW()
    FROM "Trigger" t
    WHERE l."triggerId" = t.id
      AND (l."companySiret" IS NULL OR l."companySiret" = '')
      AND t."companySiret" IS NOT NULL
      AND t."companySiret" != ''
      AND l."deletedAt" IS NULL
      AND (${cId}::text IS NULL OR l."clientId" = ${cId}::text)
  `;

  // ─────────────────────────────────────────────
  // HEAL 3 — Backfill Lead depuis Trigger.rawPayload.contact (Rodz/HarvestAPI)
  // ─────────────────────────────────────────────
  result.healed.rodzPayloadBackfilled = await db.$executeRaw`
    UPDATE "Lead" l
    SET
      "firstName" = COALESCE(NULLIF(l."firstName", ''), t."rawPayload"->'contact'->>'first_name'),
      "lastName" = COALESCE(NULLIF(l."lastName", ''), t."rawPayload"->'contact'->>'last_name'),
      "fullName" = COALESCE(NULLIF(l."fullName", ''), t."rawPayload"->'contact'->>'full_name'),
      "jobTitle" = COALESCE(
        NULLIF(l."jobTitle", ''),
        t."rawPayload"->'contact'->>'title',
        t."rawPayload"->'contact'->>'job_title'
      ),
      "linkedinUrl" = COALESCE(
        NULLIF(l."linkedinUrl", ''),
        t."rawPayload"->'contact'->>'linkedin_profile_url',
        t."rawPayload"->'contact'->>'linkedin_url'
      ),
      "email" = COALESCE(NULLIF(l."email", ''), t."rawPayload"->'contact'->>'email'),
      "phone" = COALESCE(NULLIF(l."phone", ''), t."rawPayload"->'contact'->>'phone'),
      "updatedAt" = NOW()
    FROM "Trigger" t
    WHERE l."triggerId" = t.id
      AND t."rawPayload"->'contact' IS NOT NULL
      AND l."deletedAt" IS NULL
      AND (
        (l."firstName" IS NULL OR l."firstName" = '') OR
        (l."lastName" IS NULL OR l."lastName" = '') OR
        (l."jobTitle" IS NULL OR l."jobTitle" = '') OR
        (l."linkedinUrl" IS NULL OR l."linkedinUrl" = '') OR
        (l."email" IS NULL OR l."email" = '')
      )
      AND (${cId}::text IS NULL OR l."clientId" = ${cId}::text)
  `;

  // ─────────────────────────────────────────────
  // HEAL 4 — Trim Trigger.companyName
  // ─────────────────────────────────────────────
  result.healed.triggerCompanyTrimmed = await db.$executeRaw`
    UPDATE "Trigger"
    SET "companyName" = TRIM("companyName"),
        "updatedAt" = NOW()
    WHERE "companyName" != TRIM("companyName")
      AND "deletedAt" IS NULL
      AND (${cId}::text IS NULL OR "clientId" = ${cId}::text)
  `;

  // ─────────────────────────────────────────────
  // STATS RESTANTES
  // ─────────────────────────────────────────────
  const remaining = await db.$queryRaw<Array<{ metric: string; v: bigint }>>`
    SELECT 'no_linkedin' as metric, COUNT(*)::bigint as v
    FROM "Lead" WHERE "deletedAt" IS NULL
      AND ("linkedinUrl" IS NULL OR "linkedinUrl" = '')
      AND (${cId}::text IS NULL OR "clientId" = ${cId}::text)
    UNION ALL
    SELECT 'no_email', COUNT(*)::bigint
    FROM "Lead" WHERE "deletedAt" IS NULL
      AND ("email" IS NULL OR "email" = '')
      AND (${cId}::text IS NULL OR "clientId" = ${cId}::text)
    UNION ALL
    SELECT 'no_mobile', COUNT(*)::bigint
    FROM "Lead" WHERE "deletedAt" IS NULL
      AND ("kasprPhone" IS NULL OR NOT (
        "kasprPhone" LIKE '06%' OR "kasprPhone" LIKE '07%'
        OR "kasprPhone" LIKE '+336%' OR "kasprPhone" LIKE '+337%'
        OR "kasprPhone" LIKE '336%' OR "kasprPhone" LIKE '337%'
        OR "kasprPhone" LIKE '+33 6%' OR "kasprPhone" LIKE '+33 7%'
      ))
      AND ("phone" IS NULL OR NOT (
        "phone" LIKE '06%' OR "phone" LIKE '07%'
        OR "phone" LIKE '+336%' OR "phone" LIKE '+337%'
        OR "phone" LIKE '336%' OR "phone" LIKE '337%'
        OR "phone" LIKE '+33 6%' OR "phone" LIKE '+33 7%'
      ))
      AND (${cId}::text IS NULL OR "clientId" = ${cId}::text)
    UNION ALL
    SELECT 'no_siret', COUNT(*)::bigint
    FROM "Lead" WHERE "deletedAt" IS NULL
      AND ("companySiret" IS NULL OR "companySiret" = '')
      AND (${cId}::text IS NULL OR "clientId" = ${cId}::text)
    UNION ALL
    SELECT 'no_dirigeant', COUNT(*)::bigint
    FROM "Lead" WHERE "deletedAt" IS NULL
      AND ("firstName" IS NULL OR "firstName" = '')
      AND (${cId}::text IS NULL OR "clientId" = ${cId}::text)
  `;
  for (const row of remaining) {
    const v = Number(row.v);
    if (row.metric === "no_linkedin") result.remaining.leadsWithoutLinkedin = v;
    else if (row.metric === "no_email") result.remaining.leadsWithoutEmail = v;
    else if (row.metric === "no_mobile") result.remaining.leadsWithoutMobile = v;
    else if (row.metric === "no_siret") result.remaining.leadsWithoutSiret = v;
    else if (row.metric === "no_dirigeant") result.remaining.leadsWithoutDirigeant = v;
  }

  return result;
}
