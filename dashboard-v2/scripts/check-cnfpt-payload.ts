// @ts-nocheck — Voir le rawPayload du trigger CNFPT pour récupérer dates+URL réelles
import Module from "node:module";
const o = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return o.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

async function main() {
  const { db } = await import("../src/lib/db");
  const c = await db.client.findUnique({ where: { slug: "digidemat" }, select: { id: true } });
  if (!c) process.exit(1);

  const sirets = ["784621435", "180014045", "517974432", "266209329", "259400117"];
  for (const siret of sirets) {
    const t = await db.trigger.findFirst({
      where: { clientId: c.id, companySiret: siret, sourceCode: "boamp.tender", status: "NEW" },
      select: { id: true, companyName: true, title: true, sourceUrl: true, rawPayload: true, publishedAt: true, capturedAt: true },
    });
    if (!t) {
      console.log(`SIRET ${siret} : pas trouvé`);
      continue;
    }
    console.log(`\n━━━ ${t.companyName} ━━━`);
    console.log(`  title: ${t.title}`);
    console.log(`  sourceUrl: ${t.sourceUrl}`);
    console.log(`  publishedAt: ${t.publishedAt?.toISOString()}`);
    const raw = t.rawPayload as any;
    if (raw) {
      console.log(`  raw.idweb: ${raw.idweb ?? "—"}`);
      console.log(`  raw.dateLimite: ${raw.dateLimite ?? raw.dateLimiteReponse ?? raw.dateLimitReponse ?? "—"}`);
      console.log(`  raw.url_avis: ${raw.url_avis ?? raw.urlAvis ?? raw.url ?? "—"}`);
      // Cherche tout champ contenant "date" ou "limit"
      for (const k of Object.keys(raw)) {
        if (/date|limit|deadline|reponse|cloture/i.test(k)) {
          console.log(`  raw.${k}: ${JSON.stringify(raw[k]).slice(0, 200)}`);
        }
      }
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
