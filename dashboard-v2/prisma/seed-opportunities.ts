/**
 * Seed Phase 2.1 — Pipeline Kanban (FAKE DATA — DEV ONLY)
 *
 * ⚠️  PROD GUARD ajouté 27/04. Active ALLOW_SEEDS=true uniquement en dev.
 *
 * Lancer : ALLOW_SEEDS=true npx tsx prisma/seed-opportunities.ts
 */
if (process.env.ALLOW_SEEDS !== "true") {
  console.error("⛔ Seed bloqué (prod guard). ALLOW_SEEDS=true npx tsx prisma/seed-opportunities.ts");
  process.exit(1);
}

import {
  PrismaClient,
  EmailStatus,
  LeadStatus,
  OpportunityStage,
  TriggerType,
  TriggerStatus,
} from "@prisma/client";

const db = new PrismaClient();

interface OppSpec {
  clientSlug: "ifind" | "digitestlab";
  triggerCompany?: string; // si on attache à un trigger existant
  // Données lead
  firstName: string;
  lastName: string;
  jobTitle: string;
  email: string;
  companyName: string;
  companySiret?: string;
  industry?: string;
  region?: string;
  size?: string;
  triggerTitle?: string;
  triggerDetail?: string;
  triggerScore?: number;
  triggerType?: TriggerType;
  // Pipeline
  stage: OpportunityStage;
  dealValueEur?: number;
  daysAgo: number;
  meetingInDays?: number;
}

const SPECS: OppSpec[] = [
  // === Triggers existants (DigitestLab) ===
  {
    clientSlug: "digitestlab",
    triggerCompany: "Société Aéro Industriel",
    firstName: "Pauline",
    lastName: "Marchetti",
    jobTitle: "Directrice Achats",
    email: "p.marchetti@aero-industriel.fr",
    companyName: "Société Aéro Industriel",
    stage: OpportunityStage.MEETING_SET,
    dealValueEur: 48000,
    daysAgo: 5,
    meetingInDays: 2,
  },
  {
    clientSlug: "digitestlab",
    triggerCompany: "ScaleUp Tech",
    firstName: "Hugo",
    lastName: "Lambert",
    jobTitle: "VP Engineering",
    email: "hugo@scaleup-tech.com",
    companyName: "ScaleUp Tech",
    stage: OpportunityStage.ENGAGED,
    dealValueEur: 32000,
    daysAgo: 3,
  },
  {
    clientSlug: "digitestlab",
    triggerCompany: "TechFlow SAS",
    firstName: "Camille",
    lastName: "Dubois",
    jobTitle: "Head of Operations",
    email: "c.dubois@techflow.fr",
    companyName: "TechFlow SAS",
    stage: OpportunityStage.PROPOSAL,
    dealValueEur: 65000,
    daysAgo: 12,
  },
  {
    clientSlug: "digitestlab",
    triggerCompany: "Maison Verte ETI",
    firstName: "Léa",
    lastName: "Roussel",
    jobTitle: "RSE Manager",
    email: "lea@maisonverte.fr",
    companyName: "Maison Verte ETI",
    stage: OpportunityStage.CONTACTED,
    dealValueEur: 28000,
    daysAgo: 1,
  },
  {
    clientSlug: "digitestlab",
    triggerCompany: "GreenLogix",
    firstName: "Marc",
    lastName: "Pétrov",
    jobTitle: "Co-fondateur",
    email: "marc@greenlogix.io",
    companyName: "GreenLogix",
    stage: OpportunityStage.IDENTIFIED,
    dealValueEur: 22000,
    daysAgo: 0,
  },
  {
    clientSlug: "digitestlab",
    triggerCompany: "DataFlow Analytics",
    firstName: "Sarah",
    lastName: "Cohen",
    jobTitle: "Chief Data Officer",
    email: "sarah@dataflow-analytics.fr",
    companyName: "DataFlow Analytics",
    stage: OpportunityStage.WON,
    dealValueEur: 84000,
    daysAgo: 18,
  },
  // === Compléments DigitestLab (créés avec triggers ad hoc) ===
  {
    clientSlug: "digitestlab",
    firstName: "Antoine",
    lastName: "Vasseur",
    jobTitle: "Directeur Commercial",
    email: "a.vasseur@asturienne-group.fr",
    companyName: "ASTURIENNE Distribution",
    industry: "BTP / Distribution",
    region: "Île-de-France",
    size: "ETI",
    triggerTitle: "Levée Série B annoncée — 12M€",
    triggerDetail: "Annonce officielle 22/04, expansion équipe commerciale prévue Q3",
    triggerScore: 10,
    triggerType: TriggerType.FUNDRAISING,
    stage: OpportunityStage.ENGAGED,
    dealValueEur: 95000,
    daysAgo: 2,
  },
  {
    clientSlug: "digitestlab",
    firstName: "Émilie",
    lastName: "Henri",
    jobTitle: "Chief People Officer",
    email: "emilie.h@a2micile-europe.com",
    companyName: "A2MICILE EUROPE",
    industry: "Services à la personne",
    region: "Hauts-de-France",
    size: "ETI",
    triggerTitle: "10 postes ouverts en 7 jours — pôle Tech",
    triggerDetail: "Recrutement massif déclenché après nomination nouveau CTO",
    triggerScore: 10,
    triggerType: TriggerType.HIRING_KEY,
    stage: OpportunityStage.PROPOSAL,
    dealValueEur: 72000,
    daysAgo: 9,
  },
  {
    clientSlug: "digitestlab",
    firstName: "Jérémie",
    lastName: "Costa",
    jobTitle: "Directeur Général",
    email: "jc@cimem-france.fr",
    companyName: "CIMEM France",
    industry: "Industrie / Métallurgie",
    region: "Auvergne-Rhône-Alpes",
    size: "PME",
    triggerTitle: "Nouveau dirigeant nommé + extension site Lyon",
    triggerDetail: "Combo : nomination 18/04 + permis construire entrepôt 4500m²",
    triggerScore: 10,
    triggerType: TriggerType.LEADERSHIP_CHANGE,
    stage: OpportunityStage.MEETING_SET,
    dealValueEur: 110000,
    daysAgo: 6,
    meetingInDays: 3,
  },
  {
    clientSlug: "digitestlab",
    firstName: "Caroline",
    lastName: "Thibault",
    jobTitle: "Responsable Achats Groupe",
    email: "c.thibault@pointp.fr",
    companyName: "POINT P Matériaux",
    industry: "BTP / Distribution",
    region: "Île-de-France",
    size: "GE",
    triggerTitle: "RFP active — modernisation supply chain",
    triggerDetail: "Annonce LinkedIn officielle + 3 cabinets sondés",
    triggerScore: 10,
    triggerType: TriggerType.OTHER,
    stage: OpportunityStage.WON,
    dealValueEur: 145000,
    daysAgo: 21,
  },
  {
    clientSlug: "digitestlab",
    firstName: "Yann",
    lastName: "Le Goff",
    jobTitle: "CEO",
    email: "yann@finova-tech.fr",
    companyName: "FINOVA Tech",
    industry: "Fintech",
    region: "Bretagne",
    size: "Startup",
    triggerTitle: "Annonce expansion DACH",
    triggerDetail: "Plan de bataille publié — recrutement 8 commerciaux",
    triggerScore: 8,
    triggerType: TriggerType.EXPANSION,
    stage: OpportunityStage.CONTACTED,
    dealValueEur: 38000,
    daysAgo: 2,
  },
  {
    clientSlug: "digitestlab",
    firstName: "Sophie",
    lastName: "Mercier",
    jobTitle: "VP Sales",
    email: "sophie.m@cyberion.fr",
    companyName: "CYBERION",
    industry: "Cybersécurité",
    region: "Île-de-France",
    size: "PME",
    triggerTitle: "Pain déclaré — 'pipeline sec'",
    triggerDetail: "Post LinkedIn CEO 19/04 mentionne explicitement le besoin d'outbound",
    triggerScore: 9,
    triggerType: TriggerType.OTHER,
    stage: OpportunityStage.IDENTIFIED,
    dealValueEur: 42000,
    daysAgo: 0,
  },
  {
    clientSlug: "digitestlab",
    firstName: "Julien",
    lastName: "Aubertin",
    jobTitle: "Directeur Commercial",
    email: "j.aubertin@logimax.fr",
    companyName: "LOGIMAX",
    industry: "Logistique",
    region: "Pays de la Loire",
    size: "PME",
    triggerTitle: "Nouvelle marque déposée + recrutement Sales",
    triggerScore: 7,
    triggerType: TriggerType.TRADEMARK,
    stage: OpportunityStage.LOST,
    dealValueEur: 30000,
    daysAgo: 26,
  },
  {
    clientSlug: "digitestlab",
    firstName: "Nadia",
    lastName: "Berthier",
    jobTitle: "Head of Growth",
    email: "n.berthier@quanto-saas.com",
    companyName: "Quanto SaaS",
    industry: "SaaS B2B",
    region: "Île-de-France",
    size: "Scale-up",
    triggerTitle: "Levée Series A — 6M€",
    triggerScore: 9,
    triggerType: TriggerType.FUNDRAISING,
    stage: OpportunityStage.ENGAGED,
    dealValueEur: 54000,
    daysAgo: 4,
  },
  {
    clientSlug: "digitestlab",
    firstName: "Olivier",
    lastName: "Pasquier",
    jobTitle: "COO",
    email: "o.pasquier@bistrobio.fr",
    companyName: "BistroBio",
    industry: "Agroalimentaire",
    region: "Nouvelle-Aquitaine",
    size: "PME",
    triggerTitle: "Permis construire usine bio",
    triggerScore: 7,
    triggerType: TriggerType.EXPANSION,
    stage: OpportunityStage.IDENTIFIED,
    daysAgo: 0,
  },

  // === iFIND interne (test) ===
  {
    clientSlug: "ifind",
    firstName: "Frédéric",
    lastName: "Flandrin",
    jobTitle: "CEO Digidemat",
    email: "frederic@digitestlab.fr",
    companyName: "DigitestLab",
    industry: "SaaS B2B",
    region: "Île-de-France",
    size: "TPE",
    triggerTitle: "Tally signature contrat 25/04",
    triggerScore: 10,
    triggerType: TriggerType.OTHER,
    stage: OpportunityStage.WON,
    dealValueEur: 199 * 12,
    daysAgo: 1,
  },
];

async function main() {
  console.log("🌱 Seeding Pipeline (Phase 2.1)...");

  // Charger les clients démo
  const clients = await db.client.findMany({
    where: { slug: { in: ["ifind", "digitestlab"] } },
    select: { id: true, slug: true },
  });
  const slugToId = new Map(clients.map((c) => [c.slug, c.id]));

  // Reset (idempotent)
  await db.opportunity.deleteMany({ where: { clientId: { in: [...slugToId.values()] } } });
  await db.lead.deleteMany({ where: { clientId: { in: [...slugToId.values()] } } });
  console.log("   ↳ Cleaned existing opportunities + leads");

  const triggersByCompany = new Map(
    (await db.trigger.findMany({ select: { id: true, companyName: true, clientId: true } })).map((t) => [
      `${t.clientId}:${t.companyName}`,
      t.id,
    ]),
  );

  let createdCount = 0;
  for (const spec of SPECS) {
    const clientId = slugToId.get(spec.clientSlug);
    if (!clientId) {
      console.warn(`   ! client slug introuvable : ${spec.clientSlug}`);
      continue;
    }

    // Trigger : existant ou créé ad hoc
    let triggerId: string | null = null;
    if (spec.triggerCompany) {
      triggerId = triggersByCompany.get(`${clientId}:${spec.triggerCompany}`) ?? null;
    } else if (spec.triggerTitle && spec.triggerType !== undefined && spec.triggerScore !== undefined) {
      const t = await db.trigger.create({
        data: {
          clientId,
          sourceCode: "PAPPERS_BODACC",
          companyName: spec.companyName,
          industry: spec.industry,
          region: spec.region,
          size: spec.size,
          type: spec.triggerType,
          title: spec.triggerTitle,
          detail: spec.triggerDetail,
          score: spec.triggerScore,
          isHot: spec.triggerScore >= 9,
          isCombo: spec.triggerScore === 10,
          status: TriggerStatus.NEW,
          capturedAt: daysAgo(spec.daysAgo + 1),
        },
      });
      triggerId = t.id;
    }

    // Lead
    const lead = await db.lead.create({
      data: {
        clientId,
        triggerId,
        firstName: spec.firstName,
        lastName: spec.lastName,
        fullName: `${spec.firstName} ${spec.lastName}`.trim(),
        jobTitle: spec.jobTitle,
        email: spec.email,
        emailStatus: EmailStatus.VALID,
        companyName: spec.companyName,
        status:
          spec.stage === OpportunityStage.IDENTIFIED
            ? LeadStatus.NEW
            : spec.stage === OpportunityStage.CONTACTED
              ? LeadStatus.CONTACTED
              : LeadStatus.ENRICHED,
        enrichedAt: daysAgo(spec.daysAgo),
      },
    });

    // Opportunity
    await db.opportunity.create({
      data: {
        clientId,
        leadId: lead.id,
        triggerId,
        stage: spec.stage,
        meetingDate:
          spec.meetingInDays !== undefined ? daysFromNow(spec.meetingInDays) : null,
        meetingNotes:
          spec.stage === OpportunityStage.MEETING_SET
            ? `RDV de qualification — pitch Trigger Engine FR + démo`
            : null,
        dealValueEur: spec.dealValueEur ?? null,
        wonAt: spec.stage === OpportunityStage.WON ? daysAgo(spec.daysAgo) : null,
        lostAt: spec.stage === OpportunityStage.LOST ? daysAgo(spec.daysAgo) : null,
        lostReason:
          spec.stage === OpportunityStage.LOST
            ? "Budget non débloqué — relance prévue Q3"
            : null,
        closedAt:
          spec.stage === OpportunityStage.WON || spec.stage === OpportunityStage.LOST
            ? daysAgo(spec.daysAgo)
            : null,
        createdAt: daysAgo(spec.daysAgo + 1),
      },
    });
    createdCount += 1;
  }

  console.log(`✅ Seed Pipeline OK — ${createdCount} opportunités créées`);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(10, 30, 0, 0);
  return d;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
