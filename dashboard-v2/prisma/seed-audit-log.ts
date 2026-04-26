/**
 * Seed Phase 2.6 — Audit Log réaliste
 *
 * ~30 entrées sur les 7 derniers jours, actions variées.
 * Idempotent : nettoie d'abord les entrées de démo.
 *
 * Lancer : npx tsx prisma/seed-audit-log.ts
 */
import { Prisma, PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const ACTIONS = [
  // Auth
  { action: "user.login", entityType: "User", weight: 8 },
  { action: "user.invited", entityType: "User", weight: 1 },
  // Triggers
  { action: "trigger.captured", entityType: "Trigger", weight: 12 },
  { action: "trigger.scored", entityType: "Trigger", weight: 10 },
  { action: "trigger.hot_detected", entityType: "Trigger", weight: 3 },
  { action: "trigger.combo_detected", entityType: "Trigger", weight: 2 },
  // Leads / opps
  { action: "lead.enriched", entityType: "Lead", weight: 6 },
  { action: "opportunity.stage_changed", entityType: "Opportunity", weight: 4 },
  { action: "opportunity.won", entityType: "Opportunity", weight: 1 },
  // Replies
  { action: "reply.classified", entityType: "Reply", weight: 8 },
  { action: "reply.archived", entityType: "Reply", weight: 2 },
  // Client / system
  { action: "client.activated", entityType: "Client", weight: 1 },
  { action: "client.icp_updated", entityType: "Client", weight: 2 },
  { action: "system.digest_sent", entityType: null, weight: 2 },
];

const SOURCES = [
  "bodacc.levee_serie_a",
  "bodacc.levee_serie_b",
  "bodacc.changement_dirigeant",
  "inpi.marque_produit",
  "francetravail.cfo",
  "francetravail.head_of_sales",
  "meta.ad_campaign",
  "PAPPERS_BODACC",
];

function pickWeighted<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1]!;
}

function randomMinutesAgo(maxMinutes: number): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() - Math.floor(Math.random() * maxMinutes));
  return d;
}

async function main() {
  console.log("🌱 Seeding AuditLog (Phase 2.6)...");

  // Nettoyage des entrées de démo (action LIKE 'system.%' OU créées par seed)
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { metadata: { path: ["seeded"], equals: true } },
        { action: { in: ACTIONS.map((a) => a.action) } },
      ],
    },
  });

  const clients = await db.client.findMany({
    where: { deletedAt: null },
    select: { id: true, slug: true },
  });
  const users = await db.user.findMany({
    where: { deletedAt: null },
    select: { id: true, email: true, role: true, clientId: true },
  });

  if (clients.length === 0 || users.length === 0) {
    console.warn("⚠️ Aucun client/user — seed skip");
    return;
  }

  const adminUsers = users.filter((u) => u.role === "ADMIN");

  let created = 0;
  for (let i = 0; i < 32; i++) {
    const meta = pickWeighted(ACTIONS);
    const client = clients[Math.floor(Math.random() * clients.length)]!;
    const user =
      meta.action === "user.login"
        ? users[Math.floor(Math.random() * users.length)]!
        : adminUsers[Math.floor(Math.random() * adminUsers.length)] ?? users[0]!;

    const metadata: Record<string, unknown> = { seeded: true };
    if (meta.entityType === "Trigger") {
      metadata.sourceCode = SOURCES[Math.floor(Math.random() * SOURCES.length)];
      metadata.score = 5 + Math.floor(Math.random() * 6);
    } else if (meta.action === "opportunity.stage_changed") {
      metadata.from = "CONTACTED";
      metadata.to = "ENGAGED";
    } else if (meta.action === "user.login") {
      metadata.email = user.email;
    } else if (meta.action === "system.digest_sent") {
      metadata.recipients = 3;
    }

    await db.auditLog.create({
      data: {
        userId: user.id,
        clientId: meta.entityType === null ? null : client.id,
        action: meta.action,
        entityType: meta.entityType,
        entityId: meta.entityType ? `cmofakeid${i}` : null,
        metadata: metadata as Prisma.InputJsonValue,
        ipAddress: "82.65." + Math.floor(Math.random() * 255) + "." + Math.floor(Math.random() * 255),
        userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36",
        createdAt: randomMinutesAgo(60 * 24 * 7), // 7 jours
      },
    });
    created += 1;
  }

  console.log(`✅ Audit log : ${created} entrées créées`);
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
