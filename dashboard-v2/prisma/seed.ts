/**
 * Seed initial — clients de démo + triggers réalistes
 * Lancer : npm run db:seed
 *
 * Note Phase 1.6 : ce seed est temporaire, il sera remplacé par
 * la vraie migration depuis /opt/moltbot/data/dashboard/clients.json
 */
import {
  PrismaClient,
  ClientStatus,
  ClientPlan,
  TriggerType,
  TriggerStatus,
  UserRole,
} from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // === Clients ===
  const ifind = await db.client.upsert({
    where: { slug: "ifind" },
    update: {},
    create: {
      slug: "ifind",
      name: "iFIND (interne)",
      legalName: "Alexis Bénier — iFIND",
      industry: "SaaS B2B",
      region: "Auvergne-Rhône-Alpes",
      size: "TPE",
      status: ClientStatus.ACTIVE,
      plan: ClientPlan.FULL_SERVICE,
      contactEmail: "contact@ifind.fr",
      activatedAt: new Date(),
    },
  });

  const digitestlab = await db.client.upsert({
    where: { slug: "digitestlab" },
    update: {},
    create: {
      slug: "digitestlab",
      name: "DigitestLab",
      legalName: "Digidemat SAS",
      industry: "Conseil digital",
      region: "Île-de-France",
      size: "PME",
      status: ClientStatus.ACTIVE,
      plan: ClientPlan.FULL_SERVICE,
      contactEmail: "frederic@digitestlab.fr",
      activatedAt: new Date("2026-04-25"),
    },
  });

  console.log(`  ✓ ${[ifind, digitestlab].length} clients`);

  // === Admin user (Alexis) ===
  await db.user.upsert({
    where: { email: "benieralexis@gmail.com" },
    update: { role: UserRole.ADMIN },
    create: {
      email: "benieralexis@gmail.com",
      name: "Alexis Bénier",
      role: UserRole.ADMIN,
      emailVerified: true,
      onboardingDone: true,
    },
  });
  console.log("  ✓ Admin user (benieralexis@gmail.com)");

  // === Triggers réalistes ===
  await db.trigger.deleteMany({}); // reset for idempotence

  const triggerSeeds = [
    {
      clientId: digitestlab.id,
      sourceCode: "bodacc.levee_serie_a",
      companyName: "Société Aéro Industriel",
      companySiret: "44512345600015",
      industry: "Industrie aéronautique",
      region: "Île-de-France",
      size: "PME",
      type: TriggerType.FUNDRAISING,
      title: "Levée de fonds Série A — 4,5 M€",
      detail: "Annonce officielle BODACC. Lead investor : Crédit Mutuel Equity. Préparation embauches sales attendue.",
      score: 10,
      isHot: true,
      isCombo: true,
      status: TriggerStatus.NEW,
      capturedAt: new Date(Date.now() - 2 * 60_000),
    },
    {
      clientId: digitestlab.id,
      sourceCode: "francetravail.head_of_sales",
      companyName: "ScaleUp Tech",
      companySiret: "84812345600022",
      industry: "SaaS B2B",
      region: "Lyon",
      size: "PME",
      type: TriggerType.HIRING_KEY,
      title: "Recrutement Head of Sales",
      detail: "1er commercial. Runway 18 mois post-Série A. Stack outbound non-existante.",
      score: 9,
      isHot: true,
      isCombo: false,
      status: TriggerStatus.NEW,
      capturedAt: new Date(Date.now() - 8 * 60_000),
    },
    {
      clientId: digitestlab.id,
      sourceCode: "inpi.marque_produit",
      companyName: "Maison Verte ETI",
      companySiret: "39912345600018",
      industry: "Agroalimentaire",
      region: "Pays de la Loire",
      size: "ETI",
      type: TriggerType.TRADEMARK,
      title: "Dépôt INPI nouvelle marque",
      detail: "Lancement gamme produit Q3 2026 prévu.",
      score: 8,
      isHot: false,
      isCombo: false,
      status: TriggerStatus.CONTACTED,
      capturedAt: new Date(Date.now() - 17 * 60_000),
    },
    {
      clientId: digitestlab.id,
      sourceCode: "bodacc.changement_dirigeant",
      companyName: "TechFlow SAS",
      companySiret: "82312345600041",
      industry: "Logiciels",
      region: "Bordeaux",
      size: "PME",
      type: TriggerType.LEADERSHIP_CHANGE,
      title: "Changement dirigeant — nouveau CEO ex-Salesforce",
      detail: "Pattern combiné détecté : Recrutement CFO 2 mois avant + nouveau CEO. Préparation levée probable.",
      score: 8,
      isHot: false,
      isCombo: true,
      status: TriggerStatus.NEW,
      capturedAt: new Date(Date.now() - 45 * 60_000),
    },
    {
      clientId: digitestlab.id,
      sourceCode: "meta.ad_campaign",
      companyName: "DataFlow Analytics",
      companySiret: "89412345600007",
      industry: "Data / IA",
      region: "Paris",
      size: "PME",
      type: TriggerType.AD_CAMPAIGN,
      title: "Doublement budget pub Q2",
      detail: "Campagnes Meta Ads détectées : 2x budget vs Q1. Signal de croissance commerciale active.",
      score: 7,
      isHot: false,
      isCombo: false,
      status: TriggerStatus.REPLIED,
      capturedAt: new Date(Date.now() - 240 * 60_000),
    },
    {
      clientId: digitestlab.id,
      sourceCode: "francetravail.cfo",
      companyName: "GreenLogix",
      companySiret: "75512345600089",
      industry: "Logistique verte",
      region: "Marseille",
      size: "PME",
      type: TriggerType.HIRING_KEY,
      title: "Recrutement CFO",
      detail: "Préparation levée probable dans les 6 mois selon pattern historique sur ce profil.",
      score: 8,
      isHot: false,
      isCombo: false,
      status: TriggerStatus.CONTACTED,
      capturedAt: new Date(Date.now() - 360 * 60_000),
    },
  ];

  await db.trigger.createMany({ data: triggerSeeds });
  console.log(`  ✓ ${triggerSeeds.length} triggers`);

  console.log("✅ Seed terminé.");
}

main()
  .catch((e) => {
    console.error("❌ Seed échoué :", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
