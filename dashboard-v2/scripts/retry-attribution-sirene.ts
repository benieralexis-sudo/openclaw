// Script one-shot — retry attribution SIRENE Pappers sur triggers orphelins sans SIRET.
// Usage : npx tsx scripts/retry-attribution-sirene.ts [--score-min=4] [--dry-run]
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const PAPPERS_TOKEN = process.env.PAPPERS_API_TOKEN;
if (!PAPPERS_TOKEN) {
  console.error("PAPPERS_API_TOKEN missing in env");
  process.exit(1);
}

interface PappersSearchResp {
  resultats?: Array<{
    siren: string;
    nom_entreprise: string;
    siege?: { ville?: string; code_postal?: string };
  }>;
}

async function pappersSearch(q: string, hint?: { code_postal?: string }): Promise<PappersSearchResp | null> {
  const params = new URLSearchParams({
    api_token: PAPPERS_TOKEN!,
    q,
    precision: "standard",
    par_page: "5",
  });
  if (hint?.code_postal) params.set("code_postal", hint.code_postal);
  try {
    const res = await fetch(`https://api.pappers.fr/v2/recherche?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.log(`  HTTP ${res.status} for "${q}"`);
      return null;
    }
    return (await res.json()) as PappersSearchResp;
  } catch (e) {
    console.log(`  fetch error for "${q}": ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  const scoreMin = Number(process.argv.find((a) => a.startsWith("--score-min="))?.split("=")[1] ?? 4);
  const dryRun = process.argv.includes("--dry-run");

  const orphans = await db.trigger.findMany({
    where: {
      deletedAt: null,
      score: { gte: scoreMin },
      companySiret: null,
    },
    select: { id: true, companyName: true, score: true, sourceCode: true, rawPayload: true },
    orderBy: { score: "desc" },
  });

  console.log(`Found ${orphans.length} orphans (score >= ${scoreMin}, no SIRET)`);
  console.log("---");

  let resolved = 0;
  let stillUnresolved = 0;

  for (const t of orphans) {
    const name = t.companyName?.trim();
    if (!name) {
      console.log(`SKIP ${t.id} (no companyName)`);
      continue;
    }
    const loc = t.rawPayload as Record<string, unknown> | null;
    const locStr = (loc?.location as string) ?? (loc?.companyLocation as string) ?? "";
    const cpMatch = locStr.match(/\b(\d{5})\b/);
    const hint = cpMatch ? { code_postal: cpMatch[1] } : undefined;

    // Clean trailing " - City..." suffix (e.g. "Proelan - Sophia Antipolis", "Acme Corp - Paris")
    // Take everything before " - " when present, fallback to original.
    const dashIdx = name.indexOf(" - ");
    const cleanName = dashIdx > 0 ? name.slice(0, dashIdx).trim() : name;
    const candidates = cleanName !== name && cleanName.length >= 2 ? [cleanName, name] : [name];

    let found: { siren: string; nom_entreprise: string; ville?: string } | null = null;
    for (const q of candidates) {
      const result = await pappersSearch(q, hint);
      if (result?.resultats && result.resultats.length > 0) {
        const top = result.resultats[0];
        found = { siren: top.siren, nom_entreprise: top.nom_entreprise, ville: top.siege?.ville };
        break;
      }
    }

    if (found) {
      console.log(
        `✅ score=${t.score} "${name}" → SIREN ${found.siren} (${found.nom_entreprise}, ${found.ville ?? "?"})`,
      );
      resolved++;
      if (!dryRun) {
        await db.trigger.update({
          where: { id: t.id },
          data: { companySiret: found.siren },
        });
      }
    } else {
      console.log(`❌ score=${t.score} "${name}" → no match`);
      stillUnresolved++;
    }
  }

  console.log("---");
  console.log(`Résolu: ${resolved}/${orphans.length} (${stillUnresolved} restent sans SIRET)`);
  if (dryRun) console.log("(DRY RUN — aucun update DB)");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
