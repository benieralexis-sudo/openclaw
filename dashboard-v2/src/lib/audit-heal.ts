import "server-only";
import { db } from "@/lib/db";

// ═══════════════════════════════════════════════════════════════════
// Audit & Heal — pipeline idempotent qui rattrape les leads incomplets.
// Tourne dans run-pollers cron + déclenchable à la demande.
//
// Heals appliqués (par ordre, idempotent — peut tourner 100x sans dégât) :
//   1. Lead.linkedinUrl : ajout https:// manquant
//   2. Lead.companySiret : sync depuis Trigger.companySiret si Lead vide
//   3a. Lead.firstName/lastName/jobTitle/linkedinUrl : backfill depuis
//       Trigger.rawPayload.contact (format Rodz, HarvestAPI)
//   3b. Lead : backfill depuis Trigger.rawPayload.posterFullName/posterLinkedinUrl
//       (format Apify NormalizedJob — LinkedIn jobs, WTTJ recruiter)
//   3c. Lead : backfill depuis Trigger.rawPayload.hiring_team[0] (format
//       TheirStack jobs avec décideurs identifiés)
//   3d. Lead : backfill depuis Trigger.rawPayload.decision_makers[0] (générique)
//   4. Trigger.companyName : trim espaces parasites
// ═══════════════════════════════════════════════════════════════════

export interface AuditResult {
  scanned: { leads: number; triggers: number };
  healed: {
    linkedinUrlNormalized: number;
    siretSyncedFromTrigger: number;
    rodzPayloadBackfilled: number;
    apifyPosterBackfilled: number;
    theirstackHiringTeamBackfilled: number;
    decisionMakersBackfilled: number;
    triggerCompanyTrimmed: number;
    exEmployerEmailsCleaned: number;
    orphanLeadsArchived: number;
    smtpEmailsVerified: number;
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
      apifyPosterBackfilled: 0,
      theirstackHiringTeamBackfilled: 0,
      decisionMakersBackfilled: 0,
      triggerCompanyTrimmed: 0,
      exEmployerEmailsCleaned: 0,
      orphanLeadsArchived: 0,
      smtpEmailsVerified: 0,
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
      -- Fix H6 (04/05) : valide format FR avant backfill (rejette +1 US, +40 RO, +44 UK, etc.)
      -- Patterns FR acceptés : +33xxx, 0033xxx, 0[1-9]xxx (avec espaces/tirets/points OK).
      "phone" = COALESCE(
        NULLIF(l."phone", ''),
        CASE
          WHEN regexp_replace(t."rawPayload"->'contact'->>'phone', '[[:space:].-]', '', 'g') ~ '^(\+33|0033)[1-79][0-9]{8}$' THEN t."rawPayload"->'contact'->>'phone'
          WHEN regexp_replace(t."rawPayload"->'contact'->>'phone', '[[:space:].-]', '', 'g') ~ '^0[1-79][0-9]{8}$' THEN t."rawPayload"->'contact'->>'phone'
          ELSE NULL
        END
      ),
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
  // HEAL 3b — Backfill Lead depuis Trigger.rawPayload poster fields (Apify)
  // Format : NormalizedJob avec posterFullName/posterFirstName/posterLastName
  //          /posterLinkedinUrl/posterTitle au top-level du rawPayload.
  // Source : LinkedIn jobs (curious_coder), WTTJ recruiter.
  // ─────────────────────────────────────────────
  result.healed.apifyPosterBackfilled = await db.$executeRaw`
    UPDATE "Lead" l
    SET
      "firstName" = COALESCE(NULLIF(l."firstName", ''), t."rawPayload"->>'posterFirstName'),
      "lastName" = COALESCE(NULLIF(l."lastName", ''), t."rawPayload"->>'posterLastName'),
      "fullName" = COALESCE(NULLIF(l."fullName", ''), t."rawPayload"->>'posterFullName'),
      "jobTitle" = COALESCE(NULLIF(l."jobTitle", ''), t."rawPayload"->>'posterTitle'),
      "linkedinUrl" = COALESCE(NULLIF(l."linkedinUrl", ''), t."rawPayload"->>'posterLinkedinUrl'),
      "updatedAt" = NOW()
    FROM "Trigger" t
    WHERE l."triggerId" = t.id
      AND (
        t."rawPayload"->>'posterFullName' IS NOT NULL OR
        t."rawPayload"->>'posterLinkedinUrl' IS NOT NULL
      )
      AND l."deletedAt" IS NULL
      AND (
        (l."firstName" IS NULL OR l."firstName" = '') OR
        (l."lastName" IS NULL OR l."lastName" = '') OR
        (l."jobTitle" IS NULL OR l."jobTitle" = '') OR
        (l."linkedinUrl" IS NULL OR l."linkedinUrl" = '')
      )
      AND (${cId}::text IS NULL OR l."clientId" = ${cId}::text)
  `;

  // ─────────────────────────────────────────────
  // HEAL 3c — Backfill Lead depuis Trigger.rawPayload.hiring_team[0] (TheirStack)
  // Format : { name, linkedin_url, title } au sein de hiring_team JSON array.
  // ─────────────────────────────────────────────
  result.healed.theirstackHiringTeamBackfilled = await db.$executeRaw`
    UPDATE "Lead" l
    SET
      "fullName" = COALESCE(NULLIF(l."fullName", ''), t."rawPayload"->'hiring_team'->0->>'name'),
      "jobTitle" = COALESCE(NULLIF(l."jobTitle", ''), t."rawPayload"->'hiring_team'->0->>'title'),
      "linkedinUrl" = COALESCE(NULLIF(l."linkedinUrl", ''), t."rawPayload"->'hiring_team'->0->>'linkedin_url'),
      "updatedAt" = NOW()
    FROM "Trigger" t
    WHERE l."triggerId" = t.id
      AND jsonb_typeof(t."rawPayload"->'hiring_team') = 'array'
      AND jsonb_array_length(t."rawPayload"->'hiring_team') > 0
      AND l."deletedAt" IS NULL
      AND (
        (l."fullName" IS NULL OR l."fullName" = '') OR
        (l."jobTitle" IS NULL OR l."jobTitle" = '') OR
        (l."linkedinUrl" IS NULL OR l."linkedinUrl" = '')
      )
      AND (${cId}::text IS NULL OR l."clientId" = ${cId}::text)
  `;

  // ─────────────────────────────────────────────
  // HEAL 3d — Backfill Lead depuis Trigger.rawPayload.decision_makers[0] (générique)
  // Format : { full_name | name, linkedin_url, title } — mêmes patterns variés.
  // ─────────────────────────────────────────────
  result.healed.decisionMakersBackfilled = await db.$executeRaw`
    UPDATE "Lead" l
    SET
      "fullName" = COALESCE(
        NULLIF(l."fullName", ''),
        t."rawPayload"->'decision_makers'->0->>'full_name',
        t."rawPayload"->'decision_makers'->0->>'name'
      ),
      "firstName" = COALESCE(
        NULLIF(l."firstName", ''),
        t."rawPayload"->'decision_makers'->0->>'first_name'
      ),
      "lastName" = COALESCE(
        NULLIF(l."lastName", ''),
        t."rawPayload"->'decision_makers'->0->>'last_name'
      ),
      "jobTitle" = COALESCE(
        NULLIF(l."jobTitle", ''),
        t."rawPayload"->'decision_makers'->0->>'title',
        t."rawPayload"->'decision_makers'->0->>'job_title'
      ),
      "linkedinUrl" = COALESCE(
        NULLIF(l."linkedinUrl", ''),
        t."rawPayload"->'decision_makers'->0->>'linkedin_url',
        t."rawPayload"->'decision_makers'->0->>'profile_url'
      ),
      "updatedAt" = NOW()
    FROM "Trigger" t
    WHERE l."triggerId" = t.id
      AND jsonb_typeof(t."rawPayload"->'decision_makers') = 'array'
      AND jsonb_array_length(t."rawPayload"->'decision_makers') > 0
      AND l."deletedAt" IS NULL
      AND (
        (l."fullName" IS NULL OR l."fullName" = '') OR
        (l."jobTitle" IS NULL OR l."jobTitle" = '') OR
        (l."linkedinUrl" IS NULL OR l."linkedinUrl" = '')
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
  // HEAL 5 — Fix C1 (04/05) Nettoyer les emails d'ex-employeurs.
  // Audit edge case Cas 5 a flaggé 6 leads avec email d'un domain qui ne
  // matche pas la boîte cible (helios → younited-credit.fr, Novaquark →
  // taragaming.com, eXalt → compass-group.fr, Shape It → teledyne.com,
  // LYNX RH → mistertemp-group.com, Insitoo → ouidesk.com).
  // Si Fred envoie "Bonjour Maeva, je vois que helios..." → arrive chez
  // Younited Credit. Réputation Primeforge cassée + embarras commercial.
  //
  // On scanne tous les leads actifs avec email + companyName, on applique
  // domainMatchesCompany() (helper TS), si mismatch on vide email + flag
  // doNotContact avec raison traçable.
  // ─────────────────────────────────────────────
  const { domainMatchesCompany, verifyPersonaCoherence } =
    await import("@/lib/verify-persona-coherence");
  const candidates = await db.lead.findMany({
    where: {
      deletedAt: null,
      ...(cId ? { clientId: cId } : {}),
      AND: [
        { email: { not: null } },
        { email: { not: "" } },
        { companyName: { not: "" } },
        { doNotContact: false }, // déjà flag = skip
      ],
    },
    select: {
      id: true,
      email: true,
      companyName: true,
      firstName: true,
      lastName: true,
      kasprWorkEmail: true,
      emailFullenrich: true,
    },
  });
  let cleaned = 0;
  for (const c of candidates) {
    // Check 1 : email domain matche-t-il le companyName ? (Fix C1 — ex-employeur)
    const domainCheck = domainMatchesCompany({ email: c.email!, companyName: c.companyName });
    let badReason: string | null = null;
    let badDetails: string | null = null;
    if (!domainCheck.ok && domainCheck.reason === "domain_mismatch") {
      badReason = "email_domain_mismatch_ex_employer";
      badDetails = domainCheck.details ?? "";
    } else {
      // Check 2 (Fix H4 04/05) : email local-part matche-t-il firstName/lastName ?
      // Cas Kestra : firstName=Lafont (Pappers RCS) + email=ldehon@kestra.io
      // (Ludovic Dehon, vrai CTO résolu par Kaspr/Rodz contact). Domain OK
      // (kestra.io match Kestra) MAIS persona mismatch (Lafont != ldehon).
      // verifyPersonaCoherence détecte ce cas : ni "lafont" ni "denis"/"marc"
      // /"auguste"/"andre" n'est dans "ldehon".
      const personaCheck = verifyPersonaCoherence({
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
      });
      if (!personaCheck.ok) {
        badReason = "email_persona_mismatch_wrong_person";
        badDetails = personaCheck.details ?? "";
      }
    }
    if (badReason) {
      console.warn(
        `[heal.${badReason === "email_domain_mismatch_ex_employer" ? "C1" : "H4"}] lead=${c.id} company="${c.companyName}" firstName=${c.firstName} lastName=${c.lastName} email=${c.email} (${badDetails})`,
      );
      await db.lead.update({
        where: { id: c.id },
        data: {
          email: null,
          ...(c.kasprWorkEmail === c.email ? { kasprWorkEmail: null } : {}),
          ...(c.emailFullenrich === c.email ? { emailFullenrich: null } : {}),
          doNotContact: true,
          doNotContactReason: `${badReason}:${badDetails ?? ""}`.slice(0, 200),
          doNotContactAt: new Date(),
        },
      });
      cleaned++;
    }
  }
  result.healed.exEmployerEmailsCleaned = cleaned;

  // ─────────────────────────────────────────────
  // HEAL 6 — Fix H7 (04/05) Archive les Leads orphelins (Trigger soft-deleted).
  // Audit edge case Cas 12 a flaggé 7 leads avec Trigger.deletedAt NOT NULL
  // mais Lead encore actif. Cause : pruning NAF non-cascade dans theirstack-
  // poller.ts:683 → soft-delete Trigger sans toucher au Lead. Fred clique
  // brief → crash ou vide.
  //
  // Fix : à chaque cron, archive les Leads dont le Trigger est soft-deleted.
  // ─────────────────────────────────────────────
  const orphanArchive = await db.$executeRaw`
    UPDATE "Lead" l
    SET status = 'ARCHIVED'::"LeadStatus",
        "updatedAt" = NOW()
    FROM "Trigger" t
    WHERE l."triggerId" = t.id
      AND l."deletedAt" IS NULL
      AND t."deletedAt" IS NOT NULL
      AND l.status NOT IN ('ARCHIVED', 'NOT_INTERESTED')
      AND (${cId}::text IS NULL OR l."clientId" = ${cId}::text)
  `;
  result.healed.orphanLeadsArchived = orphanArchive;
  if (orphanArchive > 0) {
    console.log(`[heal.H7] orphan leads archived: ${orphanArchive}`);
  }

  // ─────────────────────────────────────────────
  // HEAL 7 — Vérification SMTP réelle des emails UNVERIFIED.
  // Audit (04/05/2026) — `emailStatus = VALID` était posé par hardcode Rodz
  // (route.ts:384), pas par vraie vérification. Tous les emails Kaspr/
  // FullEnrich/pattern guess restaient UNVERIFIED. Conséquence : Fred ne
  // savait pas lesquels étaient vraiment valides → bouton désactivé partout
  // ou bulk-send risqué.
  //
  // Fix : on scan les leads avec emailStatus=UNVERIFIED + email présent +
  // doNotContact=false + bouncedAt=null. Pour chacun, on fait un test SMTP
  // réel (DNS MX + RCPT TO). Selon le verdict :
  //  - VALID → emailStatus=VALID, confidence ≥80 (single-source verifié)
  //  - INVALID → emailStatus=INVALID + doNotContact=true (RGPD safe)
  //  - CATCH_ALL → emailStatus reste UNVERIFIED + confidence 60 (à valider
  //    manuellement, le serveur accepte tout)
  //  - UNKNOWN → emailStatus reste UNVERIFIED (timeout/blocked, pas testable)
  //
  // Limite à 30 leads/run pour éviter de bloquer le cron (chaque test ≈ 3-10s).
  // ─────────────────────────────────────────────
  const { verifyEmailSMTP } = await import("@/lib/email-smtp-verifier");
  const SMTP_BATCH_LIMIT = 30;
  const unverifiedLeads = await db.lead.findMany({
    where: {
      deletedAt: null,
      ...(cId ? { clientId: cId } : {}),
      emailStatus: "UNVERIFIED",
      email: { not: null },
      doNotContact: false,
      bouncedAt: null,
    },
    select: { id: true, email: true, companyName: true },
    take: SMTP_BATCH_LIMIT,
    orderBy: { updatedAt: "asc" },
  });
  let smtpVerified = 0;
  for (const l of unverifiedLeads) {
    if (!l.email) continue;
    try {
      const r = await verifyEmailSMTP(l.email);
      if (r.status === "VALID") {
        await db.lead.update({
          where: { id: l.id },
          data: {
            emailStatus: "VALID",
            emailConfidence: 80, // single-source verified SMTP
            updatedAt: new Date(),
          },
        });
        smtpVerified++;
        console.log(`[heal.H7-smtp] ${l.companyName} ${l.email} → VALID`);
      } else if (r.status === "INVALID") {
        await db.lead.update({
          where: { id: l.id },
          data: {
            emailStatus: "INVALID",
            doNotContact: true,
            doNotContactReason: `email_smtp_invalid:${r.detail}`.slice(0, 200),
            doNotContactAt: new Date(),
            updatedAt: new Date(),
          },
        });
        console.log(`[heal.H7-smtp] ${l.companyName} ${l.email} → INVALID (${r.detail})`);
      } else if (r.status === "CATCH_ALL") {
        await db.lead.update({
          where: { id: l.id },
          data: {
            emailConfidence: 60, // catch-all = à valider manuellement
            updatedAt: new Date(),
          },
        });
        console.log(`[heal.H7-smtp] ${l.companyName} ${l.email} → CATCH_ALL`);
      }
      // UNKNOWN : on ne touche pas. Sera retesté au prochain cron.
    } catch (e) {
      console.warn(`[heal.H7-smtp] error ${l.email}: ${e instanceof Error ? e.message : e}`);
    }
  }
  result.healed.smtpEmailsVerified = smtpVerified;

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
