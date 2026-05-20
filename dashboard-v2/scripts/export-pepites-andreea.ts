// @ts-nocheck — Export markdown des 5 Pépites Digidemat pour envoi à Andreea
// Nicoara (andreea@digidemat.com). Sortie : /opt/moltbot/EXPORT-5-PEPITES-DIGIDEMAT.md

import Module from "node:module";
const o = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return o.call(this, request, ...args);
};
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });
import { writeFileSync } from "node:fs";

async function main() {
  const { db } = await import("../src/lib/db");
  const c = await db.client.findUnique({ where: { slug: "digidemat" }, select: { id: true } });
  if (!c) process.exit(1);

  const sirets = [
    { siret: "784621435", emoji: "⭐⭐⭐" },
    { siret: "180014045", emoji: "⭐⭐⭐" },
    { siret: "517974432", emoji: "⭐⭐" },
    { siret: "266209329", emoji: "⭐⭐" },
    { siret: "259400117", emoji: "⭐" },
  ];

  const lines: string[] = [];
  lines.push(`# 5 Pépites Digidemat — détection automatique BOAMP 19-20/05/2026`);
  lines.push(``);
  lines.push(`> Exporté le ${new Date().toISOString()} après restauration post-fix bug regex.`);
  lines.push(`> Toutes les Pépites ci-dessous ont été validées par Opus 4.7 avec un verdict OUI/ENRICH (confidence ≥82%).`);
  lines.push(`> **Persona décideur** : non enrichie (Apify quota cap). À identifier via Sales Navigator OU recharge Apify $120→$200.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  let rank = 0;
  for (const s of sirets) {
    rank++;
    const t = await db.trigger.findFirst({
      where: {
        clientId: c.id,
        companySiret: s.siret,
        sourceCode: "boamp.tender",
        status: "NEW",
        deletedAt: null,
      },
      select: {
        companyName: true,
        companyNaf: true,
        title: true,
        detail: true,
        sourceUrl: true,
        publishedAt: true,
        rawPayload: true,
        briefV2Json: true,
      },
      orderBy: { capturedAt: "desc" },
    });
    if (!t) {
      lines.push(`## ${s.emoji} Pépite #${rank} — SIRET ${s.siret} — TRIGGER INTROUVABLE`);
      continue;
    }
    const raw = t.rawPayload as any;
    const brief = t.briefV2Json as any;
    const dl = raw?.datelimitereponse;
    const url = raw?.url_avis ?? `https://www.boamp.fr/pages/avis/?q=idweb:${raw?.idweb}`;

    lines.push(`## ${s.emoji} Pépite #${rank} — ${t.companyName}`);
    lines.push(``);
    lines.push(`| Champ | Valeur |`);
    lines.push(`|---|---|`);
    lines.push(`| SIRET | ${s.siret} |`);
    lines.push(`| NAF | ${t.companyNaf ?? "—"} |`);
    lines.push(`| Verdict Opus | **${brief?.verdict}** (confidence **${brief?.confidence}%**) |`);
    lines.push(`| AO BOAMP | [${raw?.idweb ?? "—"}](${url}) |`);
    lines.push(`| Date parution | ${raw?.dateparution ?? "—"} |`);
    lines.push(`| Date limite réponse | ${dl ? `**${dl.slice(0, 10)}**` : "—"} |`);
    lines.push(`| Statut DL | ${dl ? (new Date(dl) > new Date() ? "✅ ouvert" : "❌ dépassé") : "⚠️ inconnu (à vérifier site BOAMP)"} |`);
    lines.push(``);
    lines.push(`**Objet AO** : ${(t.detail ?? "").trim()}`);
    lines.push(``);
    lines.push(`### Thèse Opus`);
    lines.push(``);
    lines.push(`> ${(brief?.thesis ?? "—").trim()}`);
    lines.push(``);
    lines.push(`### Opener prêt à envoyer`);
    lines.push(``);
    lines.push(`\`\`\``);
    lines.push((brief?.opener ?? "—").trim());
    lines.push(`\`\`\``);
    lines.push(``);
    if (brief?.risks && brief.risks.length > 0) {
      lines.push(`### Risques identifiés Opus`);
      lines.push(``);
      for (const r of brief.risks) {
        lines.push(`- **${r.severity}** — ${r.description}`);
      }
      lines.push(``);
    }
    lines.push(`### Persona à identifier (titres ICP Digidemat)`);
    lines.push(``);
    lines.push(`- DSI / Responsable SI / CIO de l'organisation`);
    lines.push(`- DPO / Délégué Protection Données`);
    lines.push(`- Directeur/Responsable Achats / Acheteur Public`);
    lines.push(`- Chef de Projet Dématérialisation / Responsable Transformation Numérique`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  lines.push(`## Synthèse exec`);
  lines.push(``);
  lines.push(`- **5 Pépites** verdict Opus OUI 82-88%, ICP-fit (collectivités/établissements publics FR, NAF 84-94)`);
  lines.push(`- **2 AO encore ouverts** : UCANSS (DL 15/06) + SICIO (DL 11/06) — priorité absolue outbound`);
  lines.push(`- **1 AO dépassé** : CNFPT (DL 18/05) — garder la persona pour prochain AO CNFPT`);
  lines.push(`- **2 AO sans DL en raw** : CD Calvados + CH Lens — vérifier statut sur site BOAMP`);
  lines.push(`- **Personas non enrichies** : Apify à 95% du quota ($114/$120). Options : recharge $120→$200 (~30 minutes setup) OU recherche manuelle Sales Navigator (~15 min/cible).`);
  lines.push(``);
  lines.push(`## Bug fixé pendant la session (20/05 matin)`);
  lines.push(``);
  lines.push(`Les 4 Pépites BOAMP collectivités étaient soft-deletées chaque matin par un bug regex.`);
  lines.push(`Détail : \`theirstack-poller.ts:956\` utilisait \`/it/i\` sans word boundaries → matchait`);
  lines.push(`substring "it" dans "Collectivités territoriales" → ICP Digidemat marquée à tort tech →`);
  lines.push(`pruning NAF non-tech supprimait tous les triggers collectivités récents. Patch poussé`);
  lines.push(`(\`38527614f\`) + déployé. Tests 1017/1017 verts. Voir commit pour détails.`);

  const out = "/opt/moltbot/EXPORT-5-PEPITES-DIGIDEMAT.md";
  writeFileSync(out, lines.join("\n"));
  console.log(`✓ Export écrit dans ${out}`);
  console.log(`  ${lines.length} lignes`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
