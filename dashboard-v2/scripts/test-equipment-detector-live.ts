// @ts-nocheck — Test live equipment-detector sur des vrais sites
// Usage: pnpm tsx scripts/test-equipment-detector-live.ts
import { detectEquipmentForCompany } from "@/lib/equipment-detector-fetch";

const DIGIDEMAT_COMPETITORS = [
  "yousign",
  "universign",
  "docusign",
  "lex persona",
  "signaturit",
  "oodrive",
  "sap signavio",
  "kofax",
  "namirial",
];

const TEST_CASES = [
  // Cas connu : Yousign indique ses clients sur https://yousign.com/fr-fr/clients
  // Pour valider la détection inverse (le concurrent expose ses clients),
  // on prend une boîte qui n'utilise probablement PAS Yousign (test négatif)
  { name: "Cas négatif (boîte FR random)", domain: "lemonde.fr" },
  // Cas BTP/notaire : probablement DocuSign ou Yousign
  { name: "Cas mixte (cabinet d'avocat)", domain: "dentons.com" },
  // Collectivité Digidemat
  { name: "UCANSS (Digidemat ICP)", domain: "ucanss.fr" },
  { name: "CH Lens (Digidemat ICP)", domain: "ch-lens.fr" },
];

async function main() {
  for (const tc of TEST_CASES) {
    console.log(`\n=== ${tc.name} — ${tc.domain} ===`);
    const start = Date.now();
    const result = await detectEquipmentForCompany(
      tc.name.replace(/ \(.*\)$/, ""),
      tc.domain,
      DIGIDEMAT_COMPETITORS,
    );
    const elapsed = Date.now() - start;
    console.log(`  status:     ${result.status}`);
    console.log(`  competitor: ${result.competitor ?? "—"}`);
    console.log(`  evidence:   ${result.evidence.length} match(es)`);
    console.log(`  reason:     ${result.reason}`);
    console.log(`  elapsed:    ${elapsed}ms`);
    if (result.evidence.length > 0) {
      for (const ev of result.evidence.slice(0, 3)) {
        console.log(
          `    ↳ [${ev.source} conf=${ev.confidence.toFixed(2)}] "${ev.matchedText.slice(0, 100)}..."`,
        );
      }
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
