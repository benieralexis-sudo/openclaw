// @ts-nocheck — Audit AVANT / APRÈS du fix gate Lead.ARCHIVED + Trigger.IGNORED
// Mesure combien de leads gaspillés actuellement.
import { db } from "@/lib/db";

async function main() {
  const HARVESTAPI_TTL_DAYS = 30;
  const ttlAgo = new Date(Date.now() - HARVESTAPI_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Tous les Leads actuellement éligibles HarvestAPI (sans le fix)
  const allEligible = await db.lead.findMany({
    where: {
      deletedAt: null,
      companyName: { not: "" },
      OR: [
        { firstName: null }, { firstName: "" },
        { lastName: null }, { lastName: "" },
      ],
      trigger: { score: { gte: 5 } },
    },
    select: {
      id: true,
      clientId: true,
      companyName: true,
      status: true,
      harvestapiAttemptedAt: true,
      trigger: { select: { status: true, briefV2Json: true } },
    },
  });

  // Découpage par status Lead × Trigger + verdict Opus
  const buckets = {
    "Trigger=IGNORED (verdict NON Opus)": [] as typeof allEligible,
    "Lead=ARCHIVED, Trigger=NEW (cycle INCOMPLETE J+7)": [] as typeof allEligible,
    "Lead!=ARCHIVED, Trigger!=IGNORED (cas légitime)": [] as typeof allEligible,
  };
  for (const l of allEligible) {
    if (l.trigger?.status === "IGNORED") {
      buckets["Trigger=IGNORED (verdict NON Opus)"].push(l);
    } else if (l.status === "ARCHIVED") {
      buckets["Lead=ARCHIVED, Trigger=NEW (cycle INCOMPLETE J+7)"].push(l);
    } else {
      buckets["Lead!=ARCHIVED, Trigger!=IGNORED (cas légitime)"].push(l);
    }
  }

  console.log("━".repeat(80));
  console.log("AUDIT GATE HarvestAPI — Leads actuellement éligibles");
  console.log("━".repeat(80));
  console.log(`Total Leads éligibles: ${allEligible.length}`);
  console.log("");
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`${k}: ${v.length}`);
  }

  // Le fix ne bloque QUE Trigger=IGNORED (verdict NON Opus certifié)
  const toBlock = buckets["Trigger=IGNORED (verdict NON Opus)"];
  const dueNow = toBlock.filter(l => !l.harvestapiAttemptedAt || l.harvestapiAttemptedAt < ttlAgo);
  const neverAttempted = toBlock.filter(l => !l.harvestapiAttemptedAt);

  console.log("");
  console.log("━".repeat(80));
  console.log("IMPACT DU FIX RAFFINÉ (Trigger.IGNORED uniquement)");
  console.log("━".repeat(80));
  console.log(`Leads qui seront filtrés au total: ${toBlock.length}`);
  console.log(`  dont DUE retry MAINTENANT (TTL expiré): ${dueNow.length}`);
  console.log(`  dont jamais tentés (recyclage évité): ${neverAttempted.length}`);
  console.log("");
  // Coût moyen ~$0.16 par lookup HarvestAPI (cité dans le code ligne 580)
  console.log(`Économie immédiate ce cron : ${(dueNow.length * 0.16).toFixed(2)} $`);
  console.log(`Économie par cycle 30j : ${(toBlock.length * 0.16).toFixed(2)} $`);

  // Vérifier qu'on ne bloque PAS des verdicts OUI (sanity)
  let ouiBloqués = 0;
  for (const l of toBlock) {
    const v = (l.trigger?.briefV2Json as any)?.verdict;
    if (v === "OUI") ouiBloqués++;
  }
  console.log("");
  console.log("━".repeat(80));
  console.log("SANITY CHECK — Combien de OUI seraient bloqués par le fix ?");
  console.log("━".repeat(80));
  console.log(`Verdict=OUI parmi les bloqués: ${ouiBloqués} (devrait être 0 ou très faible)`);
  if (ouiBloqués > 0) {
    console.log("⚠️  Inspecter ces cas:");
    for (const l of toBlock) {
      const v = (l.trigger?.briefV2Json as any)?.verdict;
      if (v === "OUI") {
        console.log(`  - ${l.companyName} (clientId=${l.clientId}, status=${l.status}, triggerStatus=${l.trigger?.status})`);
      }
    }
  }

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
