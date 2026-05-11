// @ts-nocheck — script jetable test Levier 2 cascade Google CSE
import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

(async () => {
  const { findTechLeaderByCompany } = await import("../src/lib/find-tech-leader-cascade");
  const { generateCompanyVariants } = await import("../src/lib/harvestapi-decision-makers");

  const TESTS: Array<{ company: string; signalType: "qa-hire" | "tech-hire" }> = [
    { company: "Salvia Développement", signalType: "qa-hire" },
    { company: "Groupe Yoni", signalType: "qa-hire" },
    { company: "Training Orchestra", signalType: "qa-hire" },
    { company: "DiXiO", signalType: "qa-hire" },
  ];

  for (const { company, signalType } of TESTS) {
    const variants = generateCompanyVariants(company);
    console.log(`\n━━━ ${company} (signalType=${signalType}) ━━━`);
    console.log("variants=", variants);
    try {
      const res = await findTechLeaderByCompany({
        companyName: company,
        companyVariants: variants,
        signalType,
      });
      if (res) {
        console.log(`✅ HIT: ${res.fullName} | ${res.jobTitle} | tier=${res.tier} | conf=${res.confidence}`);
        console.log(`   ${res.linkedinUrl}`);
      } else {
        console.log("❌ MISS: aucun tech leader trouvé");
      }
    } catch (e) {
      console.error("💥 ERROR:", e instanceof Error ? e.message : e);
    }
  }
})();
