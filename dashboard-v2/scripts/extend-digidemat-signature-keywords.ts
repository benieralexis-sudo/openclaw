// Bombora FR — Jour 12 (19/05/2026) — Étend les mots-clés signature Digidemat.
//
// Passe de ~30 mots-clés à ~67 pour couvrir :
//   - Verbes / concepts juridiques (signature qualifiée/avancée, eIDAS 2,
//     Règlement eIDAS, preuve électronique, scellement, vault de preuve)
//   - Plateformes secteur public FR (PLACE, Maximilien, Klekoon, AWS-Achat,
//     Chorus Pro, Portail Public de Facturation, factur-X, DUME)
//   - Produits manquants (Lex Persona, Cryptolog, Certilia, Idakto, InCert,
//     TrustSign, OneSpan, Signaturit, BackSign)
//   - Workflow process (workflow de signature, circuit de signature, signature
//     en mobilité, lettre recommandée électronique)
//
// Merge non destructif : on conserve les keywords existants et on ajoute
// uniquement ceux qui manquent.
//
// Usage : npx tsx scripts/extend-digidemat-signature-keywords.ts
import Module from "node:module";
const orig = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return orig.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

const ADDITIONS = [
  // Verbes / concepts juridiques (couvrent FR + anglo)
  "signature qualifiée",
  "signature avancée",
  "signature électronique avancée",
  "signature en mobilité",
  "workflow de signature",
  "circuit de signature",
  "service de confiance qualifié",
  "Règlement eIDAS",
  "eIDAS 2",
  "preuve électronique",
  "scellement électronique",
  "coffre-fort numérique",
  "coffre-fort électronique",
  "lettre recommandée électronique",
  "lettre recommandée numérique",
  "ANSSI signature",

  // Plateformes AO + facturation secteur public FR
  "marchés publics dématérialisés",
  "dématérialisation marchés publics",
  "PLACE marchés",
  "AWS-Achat",
  "Maximilien marchés",
  "Klekoon",
  "Achat Public",
  "AchatPublic",
  "DUME",
  "Chorus Pro",
  "Chorus Portail Pro",
  "Portail Public de Facturation",
  "facturation électronique",
  "facture électronique",
  "factur-X",

  // Produits vendeurs additionnels (anti-vendeur gère les faux positifs)
  "Lex Persona",
  "Cryptolog",
  "Certilia",
  "Idakto",
  "InCert",
  "TrustSign",
  "OneSpan",
  "BackSign",
];

(async () => {
  const { db } = await import("../src/lib/db");
  const client = await db.client.findFirst({
    where: { name: "Digidemat", deletedAt: null },
    select: { id: true, name: true },
  });
  if (!client) {
    console.error("Digidemat introuvable");
    process.exit(1);
  }

  const cfg = await db.clientSignalConfig.findFirst({
    where: { clientId: client.id, signal: { code: "P3" } },
  });
  if (!cfg) {
    console.error("Config P3 Digidemat introuvable");
    process.exit(1);
  }

  const params = (cfg.parameters as Record<string, unknown>) ?? {};
  const existing = Array.isArray(params.boampKeywords)
    ? (params.boampKeywords as unknown[]).filter(
        (k): k is string => typeof k === "string",
      )
    : [];

  const existingLower = new Set(existing.map((k) => k.toLowerCase().trim()));
  const newOnes = ADDITIONS.filter(
    (k) => !existingLower.has(k.toLowerCase().trim()),
  );

  const merged = [...existing, ...newOnes];

  console.log(`Avant : ${existing.length} keywords`);
  console.log(`Ajouts effectifs : ${newOnes.length}`);
  console.log(`Total après merge : ${merged.length}`);
  if (newOnes.length > 0) {
    console.log("Nouveaux :", newOnes.join(", "));
  }

  await db.clientSignalConfig.update({
    where: { id: cfg.id },
    data: {
      parameters: { ...params, boampKeywords: merged } as any,
    },
  });

  console.log("\n✓ Digidemat signal P3 keywords mis à jour.");
  process.exit(0);
})();
