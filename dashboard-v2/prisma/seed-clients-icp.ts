/**
 * Seed Phase 2.3 — ICP des clients démo + activatedAt
 *
 * Pousse un ICP riche (JSON) + active DigitestLab (signature 25/04).
 * iFIND interne ACTIVE depuis longtemps.
 *
 * Idempotent : update only.
 *
 * Lancer : npx tsx prisma/seed-clients-icp.ts
 */
import { PrismaClient, ClientStatus, ClientPlan } from "@prisma/client";

const db = new PrismaClient();

const ICP_DIGITESTLAB = {
  industries: ["BTP / Distribution", "Industrie / Métallurgie", "SaaS B2B", "Logistique"],
  sizes: ["PME", "ETI", "GE"],
  regions: ["Île-de-France", "Auvergne-Rhône-Alpes", "Hauts-de-France", "Pays de la Loire"],
  minScore: 7,
  preferredSignals: ["FUNDRAISING", "HIRING_KEY", "LEADERSHIP_CHANGE", "EXPANSION"],
  antiPersonas: [
    "TPE < 10 personnes",
    "Auto-entrepreneurs",
    "Secteur public hors marchés ouverts",
  ],
  notes:
    "Cible PME en croissance avec besoins en outils digitaux structurants. Préférer signaux durs (levée, recrutement clé) à signaux faibles (RP/SEO).",
};

const ICP_IFIND = {
  industries: ["SaaS B2B", "Marketing/Sales tooling", "Agences B2B", "Cabinets conseil"],
  sizes: ["TPE", "PME"],
  regions: ["France entière"],
  minScore: 8,
  preferredSignals: ["FUNDRAISING", "HIRING_KEY", "DECLARATIVE_PAIN"],
  antiPersonas: ["Concurrents directs", "Agences > 100 personnes"],
  notes: "Focus dogfooding — détection des fondateurs SaaS qui parlent publiquement de leur pipeline outbound.",
};

async function main() {
  console.log("🌱 Seeding Clients ICP + activations (Phase 2.3)...");

  const ifind = await db.client.update({
    where: { slug: "ifind" },
    data: {
      icp: ICP_IFIND,
      contactEmail: "contact@ifind.fr",
      contactPhone: "+33 7 81 72 38 99",
      primaryColor: "#2D4EF5",
      status: ClientStatus.ACTIVE,
      plan: ClientPlan.FULL_SERVICE,
      activatedAt: new Date("2025-09-15T09:00:00Z"),
    },
  });

  const digitestlab = await db.client.update({
    where: { slug: "digitestlab" },
    data: {
      icp: ICP_DIGITESTLAB,
      legalName: "Digidemat SAS",
      contactEmail: "frederic@digidemat.fr",
      contactPhone: "+33 6 12 34 56 78",
      primaryColor: "#0EA5E9",
      industry: "SaaS B2B",
      region: "Île-de-France",
      size: "TPE",
      status: ClientStatus.ACTIVE,
      plan: ClientPlan.FULL_SERVICE,
      activatedAt: new Date("2026-04-25T18:00:00Z"),
    },
  });

  console.log(`✅ ICP seedés : ${ifind.slug}, ${digitestlab.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
