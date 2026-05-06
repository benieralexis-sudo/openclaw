// @ts-nocheck — script CLI one-shot
/**
 * Sprint B.3 — Enrichit Client.icp pour DigitestLab avec les réponses Fred
 * aux 9 questions onboarding (06/05/2026).
 *
 * Champs ajoutés (préserve l'existant via spread merge) :
 *   - dreamArchetype, signalPrimary, signalSecondary
 *   - fewShotPositives.confirmedClients / .dreamProspects
 *   - redFlagsHard, redFlagsSoft, nonRedFlags
 *   - pitchVerbatim, pitchKeywords
 *   - freshnessByTrigger (timing windows pif intelligent, à itérer via outcomes)
 *   - successMetric (cible interne V1)
 *   - antiPersonas étendu (SII, Niji, Klanik, Davidson, Inetum)
 *
 * Idempotent : ré-exécution écrase juste avec les mêmes valeurs.
 *
 * Usage : npx tsx scripts/update-icp-fred-06mai.ts
 */
import Module from "node:module";
const originalResolve = (Module as { _resolveFilename: (req: string, ...rest: unknown[]) => unknown })._resolveFilename;
(Module as { _resolveFilename: (req: string, ...rest: unknown[]) => unknown })._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const FRED_PATCH = {
  dreamArchetype: "Doctolib mode PME ~50p, éditeur SaaS taille humaine (Q1 Fred)",
  signalPrimary: "ABSENCE de QA / équipe 100% devs sur éditeur SaaS — les devs testent eux-mêmes = douleur cachée. Détection : LinkedIn équipe → si 0 match QA|Quality|Testeur|Test Engineer|SDET ET ≥3 devs → signal #1 (Q6 Fred 06/05).",
  signalSecondary: "Hire QA récent : ambigu (ça dépend, Fred 06/05). Si ICP fit fort, considérer +1 point ; sinon poids neutre.",
  fewShotPositives: {
    confirmedClients: [
      { name: "Cloudiway", note: "Ancien client signé DTL — preuve fit absolue (Fred 06/05)" },
      { name: "Mapping Control", note: "Ancien client signé DTL — preuve fit absolue (Fred 06/05)" },
    ],
    dreamProspects: [
      { name: "Efalia", note: "Prospect rêvé — fit confirmé jugement Fred (06/05)" },
      { name: "Neovacom", note: "Prospect rêvé — fit confirmé jugement Fred (06/05)" },
      { name: "Optimum", note: "Prospect rêvé — fit confirmé jugement Fred (06/05)" },
    ],
  },
  redFlagsHard: [
    "ESN (toute structure de prestation/staffing IT)",
    "concurrent QA qui cherche à recruter",
  ],
  redFlagsSoft: [
    "effectif > 250 personnes (downgrade, pas exclusion — Fred 06/05 : 'pas poubelle mais plus compliqué')",
  ],
  nonRedFlags: [
    "RH ou Achats comme persona contact — peut fonctionner (Fred 06/05). NE PAS exclure auto.",
    "effectif > 250p — downgrade only, NE PAS exclure (Fred 06/05).",
  ],
  pitchVerbatim: "Le test de logiciel est un métier à part entière. Avec nous, vous pouvez vous concentrer pleinement sur votre valeur ajoutée : la création et le développement. Nous nous assurons que votre solution est prête pour vos clients, fiable, performante et conforme à leurs attentes. De la définition de la stratégie de test à l'exécution et au suivi des anomalies, nous intervenons à chaque étape pour garantir la qualité de vos livraisons, réduire les risques et accélérer votre mise sur le marché.",
  pitchKeywords: [
    "test = métier à part entière",
    "valeur ajoutée = création/développement",
    "fiable, performant, conforme",
    "stratégie de test → exécution → anomalies",
    "réduire les risques",
    "accélérer mise sur marché",
  ],
  freshnessByTrigger: {
    note: "Pif intelligent posé 06/05 (Fred 'je sais pas') — à itérer via boucle outcomes Sprint E.",
    levee: { minDays: 15, maxDays: 120, staleAfterDays: 180 },
    hireQA: { minDays: 0, maxDays: 90 },
    changementCLevel: { minDays: 30, maxDays: 180 },
  },
  successMetric: {
    fredVerbatim: "20 leads/sem c'est très bien (Q9 Fred 06/05 — répond volume, pas qualité)",
    interneCibleV1: "0 lead grossièrement à côté + raison écrite par lead + ≥90% accord Fred sur 50 leads validés Sprint C",
  },
};

// Concurrents QA + ESN à ajouter à antiPersonas (top FR manquants après Fred 06/05)
const ANTIPERSONAS_TO_ADD = [
  "SII",
  "Niji",
  "Klanik",
  "Davidson",
  "Inetum",
  "Capgemini Engineering",
  "CGI France",
  "Akka Technologies",
];

async function main() {
  const { db } = await import("../src/lib/db");

  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true, name: true, icp: true },
  });

  if (!client) {
    console.error("❌ Client digitestlab introuvable");
    process.exit(1);
  }

  const oldIcp = (client.icp ?? {}) as Record<string, unknown>;
  const oldAntiPersonas = Array.isArray(oldIcp.antiPersonas) ? (oldIcp.antiPersonas as string[]) : [];
  const mergedAntiPersonas = Array.from(new Set([...oldAntiPersonas, ...ANTIPERSONAS_TO_ADD]));

  const newIcp = {
    ...oldIcp,
    ...FRED_PATCH,
    antiPersonas: mergedAntiPersonas,
  };

  console.log(`📋 Client : ${client.name} (${client.id})`);
  console.log(`   antiPersonas : ${oldAntiPersonas.length} → ${mergedAntiPersonas.length}`);
  console.log(`   nouveaux champs Fred ajoutés : ${Object.keys(FRED_PATCH).join(", ")}`);
  console.log(`   total ICP keys : ${Object.keys(oldIcp).length} → ${Object.keys(newIcp).length}`);
  console.log(`   ICP size : ${JSON.stringify(oldIcp).length} → ${JSON.stringify(newIcp).length} chars`);

  await db.client.update({
    where: { id: client.id },
    data: { icp: newIcp },
  });

  console.log("\n✅ Client.icp DigitestLab enrichi avec réponses Fred 06/05.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
