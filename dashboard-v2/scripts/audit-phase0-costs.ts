// @ts-nocheck — script audit Phase 0 v3.0
/**
 * A.0.4 — Audit coûts infrastructure
 * - Anthropic spend par client (via Client.quotaConfig + AuditLog)
 * - Apify / TheirStack spend par client
 * - Cross-check avec /api/internal/cost-report si existe
 */
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

async function main() {
  const { db } = await import("../src/lib/db");

  // 1. Tous les clients avec leur quotaConfig
  const clients = await db.client.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      plan: true,
      status: true,
      quotaConfig: true,
      createdAt: true,
    },
  });

  console.log(`\n📊 AUDIT A.0.4 — Coûts infrastructure (mois courant)`);
  console.log(`   Clients actifs (non supprimés) : ${clients.length}\n`);

  let totalAnthropic = 0;
  let totalApify = 0;
  let totalTheirstack = 0;

  for (const c of clients) {
    const cfg = (c.quotaConfig as any) ?? {};
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📌 ${c.name} (${c.slug}) | plan=${c.plan} | status=${c.status}`);

    for (const provider of ["anthropic", "apify", "theirstack"]) {
      const p = cfg[provider] ?? {};
      const spend = p.currentSpendUsd ?? 0;
      const budget = p.monthlyBudgetUsd ?? 0;
      const cap = p.hardCapUsd ?? 0;
      const pct = cap > 0 ? Math.round((spend / cap) * 100) : 0;
      const bar = "█".repeat(Math.min(Math.round(pct / 5), 20));
      console.log(
        `   ${provider.padEnd(11)} | spend=$${spend.toFixed(2).padStart(7)} | budget=$${budget.toString().padStart(3)} | cap=$${cap.toString().padStart(3)} | ${pct.toString().padStart(3)}% ${bar}`,
      );
      if (provider === "anthropic") totalAnthropic += spend;
      if (provider === "apify") totalApify += spend;
      if (provider === "theirstack") totalTheirstack += spend;
    }
    console.log(`   lastResetAt: ${(cfg.nextResetAt) ?? "(prochain reset 1er du mois)"}`);
  }

  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 TOTAUX MOIS COURANT (mai 2026, jusqu'à aujourd'hui)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`   Anthropic   : $${totalAnthropic.toFixed(2)}`);
  console.log(`   Apify       : $${totalApify.toFixed(2)}`);
  console.log(`   TheirStack  : $${totalTheirstack.toFixed(2)}`);
  console.log(`   TOTAL pollers (variable) : $${(totalAnthropic + totalApify + totalTheirstack).toFixed(2)}`);

  // 2. Hard-coded costs récurrents (depuis mémoire)
  const fixedCosts: Record<string, { monthly: number; note: string }> = {
    "Kaspr": { monthly: 50, note: "50€ ≈ $55 — backbone emails" },
    "FullEnrich (Yearly Start)": { monthly: 20, note: "Reste 417/1000 cr" },
    "Pappers (5K cr)": { monthly: 50, note: "$30-75 estimé selon usage" },
    "VPS Hetzner/OVH": { monthly: 60, note: "1 VPS dédié partagé moltbot+dashboard-v2" },
    "Resend": { monthly: 15, note: "Transactionnels dashboard" },
    "Domaines + CDN": { monthly: 10, note: "Cloudflare + ifind.fr + getdigitestlab.com" },
  };

  console.log(`\n📌 Coûts FIXES mensuels (hors variables pollers) :`);
  let totalFixed = 0;
  for (const [name, info] of Object.entries(fixedCosts)) {
    console.log(`   ${name.padEnd(30)} : $${info.monthly.toString().padStart(3)}/mo | ${info.note}`);
    totalFixed += info.monthly;
  }
  console.log(`   ${"TOTAL fixes".padEnd(30)} : $${totalFixed}/mo`);

  // 3. Estimation mensuelle totale projection v3.0
  const today = new Date();
  const daysIntoMonth = today.getUTCDate();
  const projectedAnthropic = (totalAnthropic / daysIntoMonth) * 30;
  const projectedApify = (totalApify / daysIntoMonth) * 30;
  const projectedTheirstack = (totalTheirstack / daysIntoMonth) * 30;

  console.log(`\n📈 Projection fin de mois (extrapolation linéaire jour ${daysIntoMonth}/30) :`);
  console.log(`   Anthropic projeté : $${projectedAnthropic.toFixed(2)}`);
  console.log(`   Apify projeté     : $${projectedApify.toFixed(2)}`);
  console.log(`   TheirStack projeté: $${projectedTheirstack.toFixed(2)}`);

  const totalProjected =
    projectedAnthropic + projectedApify + projectedTheirstack + totalFixed;
  console.log(`\n💰 TOTAL COÛT MENSUEL PROJETÉ : $${totalProjected.toFixed(2)}/mo`);
  console.log(`   = $${(totalProjected * 12).toFixed(0)}/an`);

  // 4. Marge brute par tier offre publique
  console.log(`\n💎 Marge brute par tier offre Growth (390€ = $429) :`);
  const growthRevenue = 429;
  const grossMargin = ((growthRevenue - totalProjected) / growthRevenue) * 100;
  console.log(`   Revenue : $${growthRevenue}/mo`);
  console.log(`   COGS    : $${totalProjected.toFixed(2)}/mo`);
  console.log(`   Marge brute : ${grossMargin.toFixed(1)}%`);

  console.log(`\n💎 Marge brute par tier v3.0 Hunter cible 690€ ($759) :`);
  const hunterRevenue = 759;
  // Pour Hunter, +50% coût ops (capteurs additionnels) = $totalProjected * 1.5
  const hunterCogs = totalProjected * 1.5;
  const hunterMargin = ((hunterRevenue - hunterCogs) / hunterRevenue) * 100;
  console.log(`   Revenue : $${hunterRevenue}/mo`);
  console.log(`   COGS estimé Hunter (×1.5 coût ops capteurs) : $${hunterCogs.toFixed(2)}/mo`);
  console.log(`   Marge brute : ${hunterMargin.toFixed(1)}%`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
