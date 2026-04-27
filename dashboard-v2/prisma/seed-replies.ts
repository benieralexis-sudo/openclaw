/**
 * Seed Phase 2.2 — Unibox Replies (FAKE DATA — DEV ONLY)
 *
 * ⚠️  PROD GUARD ajouté 27/04. Activer ALLOW_SEEDS=true uniquement en dev.
 *
 * Lancer : ALLOW_SEEDS=true npx tsx prisma/seed-replies.ts
 */
if (process.env.ALLOW_SEEDS !== "true") {
  console.error("⛔ Seed bloqué (prod guard). ALLOW_SEEDS=true npx tsx prisma/seed-replies.ts");
  process.exit(1);
}

import {
  PrismaClient,
  ReplyIntent,
  ReplyStatus,
} from "@prisma/client";

const db = new PrismaClient();

interface ReplySpec {
  // Lookup lead par email (déjà seedés)
  leadEmail: string;
  subject: string;
  body: string;
  intent: ReplyIntent;
  intentConfidence?: number;
  status: ReplyStatus;
  hoursAgo: number;
}

const SPECS: ReplySpec[] = [
  // === Pépites POSITIVE_INTEREST ===
  {
    leadEmail: "p.marchetti@aero-industriel.fr",
    subject: "Re: Vos besoins post levée Série B",
    body: "Bonjour Alexis,\n\nMerci pour votre prise de contact pertinente. Effectivement, on cherche à structurer notre stack data-driven dans les prochaines semaines.\n\nDispo jeudi 14h pour un échange ? Vous pouvez prendre 30 min sur https://cal.com/aero-industriel.\n\nCordialement,\nPauline Marchetti\nDirectrice Achats — Société Aéro Industriel",
    intent: ReplyIntent.POSITIVE_INTEREST,
    intentConfidence: 0.96,
    status: ReplyStatus.UNREAD,
    hoursAgo: 2,
  },
  {
    leadEmail: "jc@cimem-france.fr",
    subject: "Re: Extension site Lyon — opportunité",
    body: "Bonjour,\n\nVotre angle est juste — on est effectivement en train de monter en charge le site Lyon. Présentez-moi votre offre, je suis curieux.\n\nRDV pris pour mercredi prochain.\n\nJérémie Costa\nDG CIMEM France",
    intent: ReplyIntent.POSITIVE_INTEREST,
    intentConfidence: 0.94,
    status: ReplyStatus.UNREAD,
    hoursAgo: 5,
  },
  {
    leadEmail: "a.vasseur@asturienne-group.fr",
    subject: "Re: Levée Série B — équipe commerciale",
    body: "Hello,\n\nOk pour un call. Notre VP Sales sera intéressé. Calendly ?\n\nAntoine",
    intent: ReplyIntent.POSITIVE_INTEREST,
    intentConfidence: 0.92,
    status: ReplyStatus.RESPONDING,
    hoursAgo: 8,
  },
  {
    leadEmail: "hugo@scaleup-tech.com",
    subject: "Re: Recrutement engineering",
    body: "Bonjour Alexis,\n\nVotre approche est bien ciblée, ça change. Oui je veux comprendre comment vous détectez ces signaux. Disponible en fin de semaine.\n\nHugo",
    intent: ReplyIntent.POSITIVE_INTEREST,
    intentConfidence: 0.91,
    status: ReplyStatus.READ,
    hoursAgo: 18,
  },
  {
    leadEmail: "yann@finova-tech.fr",
    subject: "Re: Expansion DACH",
    body: "Salut,\n\nBien vu pour le DACH. On structure justement la prospection allemande. Envoyez-moi 2-3 créneaux.\n\nYann Le Goff\nCEO FINOVA",
    intent: ReplyIntent.POSITIVE_INTEREST,
    intentConfidence: 0.93,
    status: ReplyStatus.UNREAD,
    hoursAgo: 1,
  },

  // === REQUEST_INFO ===
  {
    leadEmail: "c.dubois@techflow.fr",
    subject: "Re: Trigger Engine FR",
    body: "Bonjour,\n\nIntéressant. Pouvez-vous m'envoyer une plaquette ou un cas client B2B SaaS ? Je veux comprendre le ROI avant un RDV.\n\nCamille",
    intent: ReplyIntent.REQUEST_INFO,
    intentConfidence: 0.88,
    status: ReplyStatus.READ,
    hoursAgo: 26,
  },
  {
    leadEmail: "c.thibault@pointp.fr",
    subject: "Re: Modernisation supply chain",
    body: "Bonjour,\n\nMerci pour votre approche. Je transmets en interne. Pouvez-vous m'envoyer vos références BTP/distribution + un mini-deck de 5 slides ?\n\nCordialement,\nCaroline Thibault",
    intent: ReplyIntent.REQUEST_INFO,
    intentConfidence: 0.85,
    status: ReplyStatus.ANSWERED,
    hoursAgo: 72,
  },
  {
    leadEmail: "n.berthier@quanto-saas.com",
    subject: "Re: Levée Series A",
    body: "Bonjour,\n\nQuels sont vos tarifs pour une scale-up à 30 personnes ? On regarde plusieurs solutions, on shortliste.\n\nNadia",
    intent: ReplyIntent.REQUEST_INFO,
    intentConfidence: 0.86,
    status: ReplyStatus.UNREAD,
    hoursAgo: 12,
  },

  // === ASK_TIMING ===
  {
    leadEmail: "lea@maisonverte.fr",
    subject: "Re: Trigger Engine",
    body: "Hello,\n\nIntéressant mais on est en plein bouclage Q2. On peut se reparler en juin ? Je note dans mon agenda et reviens vers vous.\n\nLéa",
    intent: ReplyIntent.ASK_TIMING,
    intentConfidence: 0.89,
    status: ReplyStatus.READ,
    hoursAgo: 36,
  },
  {
    leadEmail: "marc@greenlogix.io",
    subject: "Re: Outbound automatisé",
    body: "Salut,\n\nGood timing — mais pas avant 4-6 semaines, on lance un produit. Reprenez contact mi-juin svp.\n\nMarc",
    intent: ReplyIntent.ASK_TIMING,
    intentConfidence: 0.87,
    status: ReplyStatus.READ,
    hoursAgo: 48,
  },

  // === OBJECTION ===
  {
    leadEmail: "sarah@dataflow-analytics.fr",
    subject: "Re: Détection signaux",
    body: "Bonjour,\n\nOn a déjà testé Clay/Apollo, sans résultat. Pourquoi vous seriez différent ? Si vous avez une explication concrète je suis preneuse.\n\nSarah",
    intent: ReplyIntent.OBJECTION,
    intentConfidence: 0.83,
    status: ReplyStatus.UNREAD,
    hoursAgo: 4,
  },
  {
    leadEmail: "sophie.m@cyberion.fr",
    subject: "Re: Pipeline outbound",
    body: "Bonjour,\n\nNotre RGPD interne interdit l'enrichissement automatique de données B2B externes. Comment vous gérez ?\n\nSophie",
    intent: ReplyIntent.OBJECTION,
    intentConfidence: 0.81,
    status: ReplyStatus.RESPONDING,
    hoursAgo: 14,
  },

  // === REFUSED ===
  {
    leadEmail: "j.aubertin@logimax.fr",
    subject: "Re: Outbound",
    body: "Bonjour,\n\nPas pour nous, on a déjà 3 fournisseurs en place. Bonne continuation.\n\nJulien",
    intent: ReplyIntent.REFUSED,
    intentConfidence: 0.95,
    status: ReplyStatus.ARCHIVED,
    hoursAgo: 96,
  },
  // === OUT_OF_OFFICE ===
  {
    leadEmail: "emilie.h@a2micile-europe.com",
    subject: "Auto: Out of Office until 02/05",
    body: "Bonjour,\n\nJe suis actuellement absente jusqu'au 2 mai 2026 inclus. Je traiterai vos messages à mon retour.\n\nPour toute urgence, contactez : assistant@a2micile-europe.com\n\nÉmilie Henri",
    intent: ReplyIntent.OUT_OF_OFFICE,
    intentConfidence: 0.99,
    status: ReplyStatus.READ,
    hoursAgo: 6,
  },
  {
    leadEmail: "o.pasquier@bistrobio.fr",
    subject: "Re: Permis construire usine",
    body: "Bonjour,\n\nAbsence : je serai de retour le 28 avril. Réponse à mon retour.\n\nOlivier Pasquier",
    intent: ReplyIntent.OUT_OF_OFFICE,
    intentConfidence: 0.98,
    status: ReplyStatus.READ,
    hoursAgo: 30,
  },

  // === WRONG_PERSON ===
  {
    leadEmail: "frederic@digitestlab.fr",
    subject: "Re: Bot Trigger",
    body: "Hello Alexis,\n\nJe suis CEO Digidemat, pas DigitestLab à proprement parler — peux-tu m'envoyer ça en direct sur frederic.flandrin@digidemat.fr ? Merci !\n\nFred",
    intent: ReplyIntent.WRONG_PERSON,
    intentConfidence: 0.78,
    status: ReplyStatus.UNREAD,
    hoursAgo: 3,
  },

  // === Quelques replies de plus pour densité ===
  {
    leadEmail: "p.marchetti@aero-industriel.fr",
    subject: "Re: Confirmation RDV jeudi",
    body: "C'est confirmé pour jeudi 14h. Je vous envoie une invitation.\n\nPauline",
    intent: ReplyIntent.POSITIVE_INTEREST,
    intentConfidence: 0.96,
    status: ReplyStatus.ANSWERED,
    hoursAgo: 1,
  },
  {
    leadEmail: "hugo@scaleup-tech.com",
    subject: "Re: Recrutement engineering",
    body: "Bonjour,\n\nMerci pour votre suivi. On peut faire jeudi 16h ? J'ai bloqué le créneau.\n\nHugo Lambert",
    intent: ReplyIntent.POSITIVE_INTEREST,
    intentConfidence: 0.95,
    status: ReplyStatus.READ,
    hoursAgo: 10,
  },
  {
    leadEmail: "c.thibault@pointp.fr",
    subject: "Re: Référence BTP demandée",
    body: "Parfait, j'ai bien reçu le deck. Je discute avec mon directeur cette semaine et je reviens vers vous lundi.\n\nCaroline",
    intent: ReplyIntent.POSITIVE_INTEREST,
    intentConfidence: 0.9,
    status: ReplyStatus.READ,
    hoursAgo: 50,
  },
  {
    leadEmail: "yann@finova-tech.fr",
    subject: "Re: Créneaux DACH",
    body: "Mardi 10h ou Jeudi 15h, dites-moi.\n\nYann",
    intent: ReplyIntent.POSITIVE_INTEREST,
    intentConfidence: 0.94,
    status: ReplyStatus.UNREAD,
    hoursAgo: 0.5,
  },
  {
    leadEmail: "n.berthier@quanto-saas.com",
    subject: "Re: Tarifs scale-up",
    body: "Vos prix sont compétitifs vs Clay. On veut tester sur un mois. Comment on procède ?\n\nNadia",
    intent: ReplyIntent.POSITIVE_INTEREST,
    intentConfidence: 0.89,
    status: ReplyStatus.UNREAD,
    hoursAgo: 7,
  },
];

async function main() {
  console.log("🌱 Seeding Replies (Phase 2.2)...");

  const clients = await db.client.findMany({
    where: { slug: { in: ["ifind", "digitestlab"] } },
    select: { id: true },
  });
  const clientIds = clients.map((c) => c.id);

  await db.reply.deleteMany({ where: { clientId: { in: clientIds } } });
  console.log("   ↳ Cleaned existing replies");

  const leads = await db.lead.findMany({
    where: { clientId: { in: clientIds } },
    select: { id: true, clientId: true, email: true, fullName: true, companyName: true },
  });
  const byEmail = new Map(leads.filter((l) => l.email).map((l) => [l.email!, l]));

  let created = 0;
  let skipped = 0;
  for (const spec of SPECS) {
    const lead = byEmail.get(spec.leadEmail);
    if (!lead) {
      console.warn(`   ! lead introuvable : ${spec.leadEmail}`);
      skipped += 1;
      continue;
    }

    const receivedAt = hoursAgo(spec.hoursAgo);
    await db.reply.create({
      data: {
        clientId: lead.clientId,
        leadId: lead.id,
        fromEmail: spec.leadEmail,
        fromName: lead.fullName,
        subject: spec.subject,
        body: spec.body,
        receivedAt,
        intent: spec.intent,
        intentConfidence: spec.intentConfidence ?? null,
        status: spec.status,
        respondedAt:
          spec.status === ReplyStatus.ANSWERED
            ? hoursAgo(Math.max(0, spec.hoursAgo - 1))
            : null,
        createdAt: receivedAt,
      },
    });
    created += 1;
  }

  console.log(`✅ Seed Replies OK — ${created} replies créées (${skipped} skipped)`);
}

function hoursAgo(n: number): Date {
  const d = new Date();
  d.setTime(d.getTime() - n * 60 * 60 * 1000);
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
