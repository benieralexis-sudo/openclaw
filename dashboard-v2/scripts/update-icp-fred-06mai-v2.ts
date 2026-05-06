// @ts-nocheck — script CLI patch v2
/**
 * Sprint B.7 — Patch Client.icp DTL pour corriger les effets de bord backfill
 * 06/05 (Sprint B initial trop strict, voir session-06mai-sprint-b.md).
 *
 * Corrections :
 *   1. signalPrimary reformulé : "BOOST FORT" explicite, sans laisser Opus
 *      inférer "présence QA = anti-signal".
 *   2. signalSecondary reformulé : présence QA = NEUTRE (Fred 'ça dépend'),
 *      explicitement PAS anti-signal.
 *   3. redFlagsHard "ESN" nuancé : "ESN pure" (exclure hybrides ESN+éditeur).
 *
 * Idempotent.
 */
import Module from "node:module";
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const PATCH_V2 = {
  signalPrimary: "BOOST FORT (+2 points sur le scoring final, plancher 8 si autres axes OK) UNIQUEMENT si la boîte évaluée est un éditeur SaaS où l'équipe est 100% devs SANS aucun QA/testeur identifié (les devs testent eux-mêmes = douleur cachée — Q6 Fred 06/05). Détection : LinkedIn équipe → 0 match \"QA|Quality|Testeur|Test Engineer|SDET\" parmi ≥3 devs visibles. ATTENTION : ce signal est un BONUS (+), JAMAIS un MALUS (-). Son absence ne pénalise pas.",
  signalSecondary: "PRÉSENCE de QA dans l'équipe (poste actuel OU hire QA récent) = NEUTRE pour le scoring (Fred 'ça dépend', Q6 06/05). NE PAS rejeter / downgrader une boîte sous prétexte qu'elle a déjà un QA ou qu'elle en recrute un — beaucoup de SaaS internalisent ET externalisent (DTL = équipe d'appoint structurée à 3-5K€/mois/consultant). Continue d'évaluer ICP fit + persona + freshness normalement. Ne dis JAMAIS dans la reason 'présence QA = signal #1 invalidé' ou équivalent.",
  redFlagsHard: [
    "ESN PURE (structure 100% prestation/staffing IT, type Capgemini/Sopra/Atos/Alten/Akkodis — JAMAIS d'édition logicielle propriétaire). NE PAS exclure les boîtes hybrides 'ESN + éditeur SaaS' qui développent leur propre produit.",
    "concurrent QA qui cherche à recruter (autre prestataire de testing/QA externalisé)",
  ],
};

async function main() {
  const { db } = await import("../src/lib/db");

  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true, name: true, icp: true },
  });
  if (!client) throw new Error("DTL introuvable");

  const oldIcp = (client.icp ?? {}) as Record<string, unknown>;
  const newIcp = { ...oldIcp, ...PATCH_V2 };

  console.log(`📋 Client : ${client.name}`);
  console.log(`   signalPrimary : reformulé (\"BOOST FORT\" explicite, plus de risque d'inversion)`);
  console.log(`   signalSecondary : reformulé (présence QA = NEUTRE, pas anti-signal)`);
  console.log(`   redFlagsHard : ESN → \"ESN PURE\" (exclure hybrides ESN+éditeur)`);
  console.log(`   ICP size : ${JSON.stringify(oldIcp).length} → ${JSON.stringify(newIcp).length} chars`);

  await db.client.update({ where: { id: client.id }, data: { icp: newIcp } });
  console.log("\n✅ Patch v2 appliqué.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
