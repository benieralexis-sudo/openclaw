/**
 * Backfill BOAMP contacts — Phase A (20/05/2026).
 *
 * Pour chaque Trigger boamp.tender existant, ré-extraire le cac:Contact du
 * payload TED-eForms et :
 *   1. Pose le `_extractedContact` dans rawPayload (idempotent).
 *   2. Si un Lead existe pour ce Trigger, hydrate firstName/lastName/jobTitle
 *      /email/phone (sans écraser une valeur existante non-null).
 *   3. Si le Lead était INCOMPLETE et la persona est résolue → bascule en NEW.
 *
 * Usage : node scripts/backfill-boamp-contacts.mjs [--client=ClientName] [--dry]
 */
import { PrismaClient } from '@prisma/client';
import { extractBoampContact } from '../src/lib/boamp-contact-extractor.ts';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const dry = !!args.dry;
const clientName = args.client;

const prisma = new PrismaClient();

const where = { sourceCode: 'boamp.tender', deletedAt: null };
if (clientName) {
  const c = await prisma.client.findFirst({ where: { name: clientName } });
  if (!c) { console.error(`Client "${clientName}" not found`); process.exit(1); }
  where.clientId = c.id;
  console.log(`Filter clientId=${c.id} (${c.name})`);
}

const triggers = await prisma.trigger.findMany({
  where,
  include: { lead: true, client: { select: { name: true } } },
  orderBy: { createdAt: 'desc' },
});

console.log(`Scanning ${triggers.length} BOAMP Triggers${dry ? ' (DRY-RUN)' : ''}\n`);

const stats = { scanned: 0, extracted: 0, leadUpdated: 0, leadPromoted: 0, noContact: 0 };

for (const t of triggers) {
  stats.scanned++;
  const raw = t.rawPayload;
  if (!raw?.donnees) { stats.noContact++; continue; }
  const c = extractBoampContact(raw.donnees, t.companyName);
  if (c.matchKind === 'none') { stats.noContact++; continue; }
  stats.extracted++;
  console.log(`📌 [${t.client.name}] ${t.companyName} → ${c.fullName || c.email} (${c.matchKind}) leadId=${t.lead?.id?.slice(0,8) || 'none'}`);

  if (dry) continue;

  // 1. Pose _extractedContact dans rawPayload (idempotent)
  const updatedRaw = { ...raw, _extractedContact: c };
  await prisma.trigger.update({ where: { id: t.id }, data: { rawPayload: updatedRaw } });

  // 2. Hydrate Lead s'il existe
  if (!t.lead) continue;
  const updates = {};
  if (!t.lead.firstName && c.firstName) updates.firstName = c.firstName;
  if (!t.lead.lastName && c.lastName) updates.lastName = c.lastName;
  if (!t.lead.fullName && c.fullName) updates.fullName = c.fullName;
  if (!t.lead.jobTitle && c.jobTitle) updates.jobTitle = c.jobTitle;
  if (!t.lead.email && c.email) updates.email = c.email;
  if (!t.lead.phone && c.phone) updates.phone = c.phone;

  // Promote to NEW si on a persona résolue + SIRET + NAF + status était INCOMPLETE
  const willHavePersona = (t.lead.fullName || c.fullName) || (t.lead.email || c.email);
  if (
    t.lead.status === 'INCOMPLETE' &&
    willHavePersona &&
    t.companySiret &&
    t.companyNaf
  ) {
    updates.status = 'NEW';
    stats.leadPromoted++;
  }

  if (Object.keys(updates).length > 0) {
    await prisma.lead.update({ where: { id: t.lead.id }, data: updates });
    stats.leadUpdated++;
    console.log(`   ➜ Lead ${t.lead.id.slice(0,8)} mis à jour : ${Object.keys(updates).join(', ')}`);
  }
}

console.log(`\n=== Stats ===`);
console.log(`scanned=${stats.scanned}  extracted=${stats.extracted}  noContact=${stats.noContact}  leadUpdated=${stats.leadUpdated}  leadPromoted=${stats.leadPromoted}`);
await prisma.$disconnect();
