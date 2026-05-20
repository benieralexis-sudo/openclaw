// @ts-nocheck — Test équipement sur clients connus Yousign (validation production-grade)
// Source : https://yousign.com/fr-fr (section "Plus de 30 000 entreprises")
import { detectEquipmentForCompany } from "@/lib/equipment-detector-fetch";

const COMPETITORS = [
  "yousign",
  "universign",
  "docusign",
  "lex persona",
  "signaturit",
  "oodrive",
  "kofax",
  "namirial",
  "adobesign",
  "adobe sign",
];

// 8 clients Yousign confirmés (page d'accueil yousign.com 20/05/2026)
// + 4 boîtes secteurs aléatoires comme témoins négatifs
const CASES = [
  { name: "Agicap (client Yousign confirmé)", domain: "agicap.com", expected: "EQUIPPED" },
  { name: "Qonto (client Yousign confirmé)", domain: "qonto.com", expected: "EQUIPPED" },
  { name: "Payfit (client Yousign confirmé)", domain: "payfit.com", expected: "EQUIPPED" },
  { name: "Matera (client Yousign confirmé)", domain: "matera.eu", expected: "EQUIPPED" },
  { name: "Leocare (client Yousign confirmé)", domain: "leocare.eu", expected: "EQUIPPED" },
  { name: "BPI France (client Yousign confirmé)", domain: "bpifrance.fr", expected: "EQUIPPED" },
  { name: "EDF (client Yousign confirmé)", domain: "edf.fr", expected: "EQUIPPED" },

  // Témoins négatifs : boîtes random qui n'ont vraisemblablement pas de signature électronique publique
  { name: "Le Monde (média)", domain: "lemonde.fr", expected: "NONE" },
  { name: "Wikipédia FR", domain: "fr.wikipedia.org", expected: "NONE" },
];

async function main() {
  let correct = 0;
  let total = 0;
  const results = [];

  for (const tc of CASES) {
    total++;
    const start = Date.now();
    const companyName = tc.name.replace(/ \(.*\)$/, "");
    const r = await detectEquipmentForCompany(companyName, tc.domain, COMPETITORS);
    const elapsed = Date.now() - start;
    const ok = r.status === tc.expected;
    if (ok) correct++;
    results.push({ name: tc.name, expected: tc.expected, actual: r.status, ok, competitor: r.competitor, elapsed, evidenceCount: r.evidence.length });
    console.log(
      `${ok ? "✅" : "❌"} ${tc.name}: expected=${tc.expected} actual=${r.status} competitor=${r.competitor ?? "—"} ev=${r.evidence.length} (${elapsed}ms)`,
    );
    if (r.evidence.length > 0) {
      for (const ev of r.evidence.slice(0, 2)) {
        console.log(`    ↳ ${ev.source} conf=${ev.confidence.toFixed(2)} "${ev.matchedText.slice(0, 80)}"`);
      }
    }
  }

  console.log(`\n=== Score: ${correct}/${total} (${((correct / total) * 100).toFixed(0)}%) ===`);
  process.exit(0);
}

main();
