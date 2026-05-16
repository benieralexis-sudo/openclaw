// @ts-nocheck — script CLI, types stricts non requis
/**
 * Seed du catalogue universel paramétrable iFIND (16/05/2026).
 *
 * Implémente la décision stratégique LOCKED 16/05 — voir mémoire
 * strategie-catalogue-signaux-universels-16mai.
 *
 * 16 signaux universels :
 *   - 5 PILLAR (P1-P5)     : signaux d'achat forts, le client en choisit 3 max
 *   - 7 BOOSTER (B1-B7)    : tournent en background pour tous les clients
 *   - 4 CONTEXTUAL (C1-C4) : enrichissent chaque Pépite
 *
 * Idempotent (upsert sur code). Sourcing :
 *   - sourceCodes : Trigger.sourceCode utilisés pour produire ce signal
 *   - parameters  : template Zod-like pour le wizard onboarding
 *   - predictivityPct : corrélation conversion B2B (LeadGenius, Salesmotion)
 *   - implemented : true si poller code existe et capture en DB en prod
 *
 * Lancer : npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/seed-signal-catalog.ts [--dry-run]
 */
import { config } from "dotenv";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") {
    return require.resolve("./_server-only-stub.js");
  }
  return originalResolve.call(this, request, ...args);
};

interface SignalDef {
  code: string;
  category: "PILLAR" | "BOOSTER" | "CONTEXTUAL";
  name: string;
  description: string;
  sourceCodes: string[];
  parameters: Record<string, unknown>;
  predictivityPct?: number;
  implemented: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// PILIERS (P1-P5) — le client en choisit 3 max
// ──────────────────────────────────────────────────────────────────────
const PILLARS: SignalDef[] = [
  {
    code: "P1",
    category: "PILLAR",
    name: "Hire role X",
    description:
      "Annonce de recrutement d'un poste clé matchant l'ICP du client. " +
      "Signal d'achat le plus universel : la boîte cherche activement à recruter, " +
      "donc reconnaît un besoin métier non comblé.",
    sourceCodes: ["apify.linkedin-jobs", "apify.wttj-jobs", "francetravail.tech"],
    parameters: {
      keywords: {
        type: "stringArray",
        label: "Mots-clés métiers (ex: QA, SDR, Sales)",
        default: [],
        required: true,
      },
      jobLevels: {
        type: "stringArray",
        label: "Niveaux ciblés (Junior/Senior/Head/CXO)",
        default: ["Senior", "Head", "CXO"],
      },
      regions: {
        type: "stringArray",
        label: "Régions FR (ex: Île-de-France)",
        default: ["Île-de-France"],
      },
    },
    predictivityPct: 7, // hire seul faible, fort en combo
    implemented: true,
  },
  {
    code: "P2",
    category: "PILLAR",
    name: "Team sans rôle X (douleur cachée)",
    description:
      "Une boîte qui a >10 employés mais 0 personne avec un titre matchant " +
      "la cible (ex: 50 devs mais 0 QA Engineer) = douleur cachée. " +
      "Souvent meilleur que P1 car la boîte n'a même pas commencé à recruter.",
    sourceCodes: [], // À implémenter S2-3 du plan
    parameters: {
      missingRoles: {
        type: "stringArray",
        label: "Rôles absents qui révèlent une douleur (ex: QA Engineer, SDR)",
        default: [],
        required: true,
      },
      minTeamSize: {
        type: "number",
        label: "Taille équipe minimum (>X = douleur significative)",
        default: 10,
      },
    },
    predictivityPct: 30, // estimation (proxy hire seul + intent)
    implemented: false,
  },
  {
    code: "P3",
    category: "PILLAR",
    name: "Stack tech contient outil X",
    description:
      "La boîte utilise un outil dans sa stack technique (détecté via TheirStack, " +
      "BuiltWith, etc.). Pertinent pour cibler les boîtes équipées d'un concurrent " +
      "ou complémentaire au produit du client.",
    sourceCodes: ["theirstack.buying-intent"],
    parameters: {
      techSlugs: {
        type: "stringArray",
        label: "Slugs technologies (ex: apollo-io, lemlist, hubspot)",
        default: [],
        required: true,
      },
    },
    predictivityPct: 38, // recent purchases corrélé
    implemented: true, // mais à optimiser (12 triggers/30j, 100% IGNORED actuellement)
  },
  {
    code: "P4",
    category: "PILLAR",
    name: "AI tool adoption détectée",
    description:
      "Signal le plus prédictif mesuré (+46% corrélation conversion). " +
      "La boîte adopte un outil AI (LangChain, OpenAI API, Anthropic, etc.) " +
      "détecté via leur stack ou job postings.",
    sourceCodes: [], // À implémenter S2-3
    parameters: {
      aiKeywords: {
        type: "stringArray",
        label: "Mots-clés AI à détecter (ex: LangChain, GPT, Claude)",
        default: ["LangChain", "OpenAI", "Anthropic", "GPT", "Claude", "LLM"],
      },
    },
    predictivityPct: 46,
    implemented: false,
  },
  {
    code: "P5",
    category: "PILLAR",
    name: "Effectif +X% en 90 jours",
    description:
      "Croissance d'effectif rapide (+10% sur 90j) = expansion, " +
      "structuration en cours, besoin d'outils. 2e signal le plus prédictif (+38%).",
    sourceCodes: [], // À implémenter S2-3 via Proxycurl / HarvestAPI
    parameters: {
      growthThresholdPct: {
        type: "number",
        label: "Seuil croissance en %",
        default: 10,
      },
      windowDays: {
        type: "number",
        label: "Fenêtre d'observation en jours",
        default: 90,
      },
    },
    predictivityPct: 38,
    implemented: false,
  },
];

// ──────────────────────────────────────────────────────────────────────
// BOOSTERS (B1-B7) — tournent en background pour tous
// ──────────────────────────────────────────────────────────────────────
const BOOSTERS: SignalDef[] = [
  {
    code: "B1",
    category: "BOOSTER",
    name: "Levée de fonds Series A/B/C",
    description:
      "Levée récente (<3 mois) = boîte avec budget frais à dépenser. " +
      "Sweet spot 2-4 semaines après l'annonce (CFO a libéré le budget).",
    sourceCodes: ["rodz.fundraising", "rss-levees", "bodacc.capital_increase"],
    parameters: {
      minAmountEur: {
        type: "number",
        label: "Montant minimum (€) pour filtrer le bruit",
        default: 500000,
      },
      windowDays: {
        type: "number",
        label: "Fenêtre fraîcheur (jours)",
        default: 90,
      },
    },
    predictivityPct: 22,
    implemented: true, // ⭐ meilleur signal en prod (rodz.fundraising avg 8.0)
  },
  {
    code: "B2",
    category: "BOOSTER",
    name: "Nouveau VP / C-Level <90j",
    description:
      "Un nouveau dirigeant veut faire ses preuves en 100 jours = ouvert " +
      "à essayer de nouveaux outils. 25-30% corrélation conversion.",
    sourceCodes: [], // À implémenter S2 (Pappers dirigeants + Rodz job-changes)
    parameters: {
      targetRoles: {
        type: "stringArray",
        label: "Rôles ciblés (VP Sales, CRO, CTO, COO)",
        default: ["VP", "CRO", "CTO", "COO", "Head of"],
      },
      windowDays: {
        type: "number",
        label: "Fenêtre de prise de poste (jours)",
        default: 90,
      },
    },
    predictivityPct: 27,
    implemented: false,
  },
  {
    code: "B3",
    category: "BOOSTER",
    name: "M&A annoncé",
    description:
      "Fusion/acquisition récente = besoin d'intégration, de tooling unifié, " +
      "souvent de nouveaux process commerciaux.",
    sourceCodes: ["bodacc.company_merger", "rodz.mergers-acquisitions"],
    parameters: {},
    predictivityPct: 17,
    implemented: true,
  },
  {
    code: "B4",
    category: "BOOSTER",
    name: "Création société tech récente",
    description:
      "Immatriculation BODACC <6 mois pour une boîte tech = besoin de tous " +
      "les outils dès le départ. Cycle de vente court car pas d'inertie.",
    sourceCodes: ["rodz.company-registration"],
    parameters: {
      nafCodes: {
        type: "stringArray",
        label: "Codes NAF tech ciblés",
        default: ["58.29Z", "62.01Z", "62.02A", "63.11Z", "63.12Z"],
      },
    },
    predictivityPct: 15,
    implemented: true,
  },
  {
    code: "B5",
    category: "BOOSTER",
    name: "Dépôt INPI marque",
    description:
      "Nouvelle marque déposée = projet ou produit en cours de lancement. " +
      "Souvent annonce produit dans les 2-3 mois suivants.",
    sourceCodes: ["inpi.marque"],
    parameters: {},
    predictivityPct: 12,
    implemented: false, // ⚠️ code existe mais 0 trigger capturé → à debug
  },
  {
    code: "B6",
    category: "BOOSTER",
    name: "Augmentation capital BODACC",
    description:
      "Modification capital BODACC = souvent levée pré-officielle (1-2 sem " +
      "avant l'annonce presse). Signal très bruyant : filtrer NAF strict.",
    sourceCodes: ["bodacc.capital_increase"],
    parameters: {
      requirePappersNaf: {
        type: "boolean",
        label: "Exiger code NAF Pappers (filtre 90% bruit holdings/SCI)",
        default: true,
      },
    },
    predictivityPct: 18,
    implemented: true, // patch 16/05 — filtre NAF appliqué
  },
  {
    code: "B7",
    category: "BOOSTER",
    name: "Expansion géographique",
    description:
      "Ouverture nouveau site, nouvelle filiale, expansion internationale. " +
      "Détecté via BODACC + Rodz expansion-tracker.",
    sourceCodes: ["bodacc.expansion", "rodz.expansion"],
    parameters: {},
    predictivityPct: 14,
    implemented: true,
  },
];

// ──────────────────────────────────────────────────────────────────────
// CONTEXTUELS (C1-C4) — enrichissent chaque Pépite
// ──────────────────────────────────────────────────────────────────────
const CONTEXTUALS: SignalDef[] = [
  {
    code: "C1",
    category: "CONTEXTUAL",
    name: "Santé financière Pappers",
    description:
      "CA, résultat net, insolvency, multi-établissements. Score positif/négatif " +
      "intégré au priorityScore via getNegativeSignalsForCompany.",
    sourceCodes: ["pappers"],
    parameters: {},
    implemented: true,
  },
  {
    code: "C2",
    category: "CONTEXTUAL",
    name: "Profil LinkedIn complet décideur",
    description:
      "HarvestAPI Profile Full — experiences, headline, summary, tenure poste " +
      "actuel. Consommé par fitScore (chantier #2b).",
    sourceCodes: ["harvestapi.linkedin-profile"],
    parameters: {},
    implemented: true,
  },
  {
    code: "C3",
    category: "CONTEXTUAL",
    name: "Site web summary IA",
    description:
      "Sonnet 4.6 résume la home page de la boîte (150 chars). Permet de filtrer " +
      "anti-ICP (régie, client final, offshore) avant qualify Opus.",
    sourceCodes: ["claude-sonnet.website-summary"],
    parameters: {},
    implemented: true,
  },
  {
    code: "C4",
    category: "CONTEXTUAL",
    name: "News presse Google CSE 30j",
    description:
      "Recherche presse spécialisée sur la boîte (30j) = layoffs, awards, " +
      "partnerships. Enrichit le contexte du judge Opus.",
    sourceCodes: ["google-cse.news"],
    parameters: {},
    implemented: true,
  },
];

const CATALOG: SignalDef[] = [...PILLARS, ...BOOSTERS, ...CONTEXTUALS];

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const { db } = await import("../src/lib/db");

  console.log(`🌱 Seed catalogue universel — ${CATALOG.length} signaux`);
  console.log(`   ${dryRun ? "DRY RUN" : "WRITE"}\n`);

  let created = 0;
  let updated = 0;

  for (const sig of CATALOG) {
    const flag = sig.implemented ? "✓ impl" : "✗ todo";
    const pred = sig.predictivityPct ? `+${sig.predictivityPct}%` : "?";
    console.log(
      `  ${sig.code.padEnd(3)} [${sig.category.padEnd(10)}] ${flag} ${pred.padStart(5)} — ${sig.name}`,
    );
    if (dryRun) continue;

    const existing = await db.signalCatalog.findUnique({ where: { code: sig.code } });
    if (existing) {
      await db.signalCatalog.update({
        where: { code: sig.code },
        data: {
          category: sig.category,
          name: sig.name,
          description: sig.description,
          sourceCodes: sig.sourceCodes,
          parameters: sig.parameters,
          predictivityPct: sig.predictivityPct,
          implemented: sig.implemented,
        },
      });
      updated += 1;
    } else {
      await db.signalCatalog.create({
        data: {
          code: sig.code,
          category: sig.category,
          name: sig.name,
          description: sig.description,
          sourceCodes: sig.sourceCodes,
          parameters: sig.parameters,
          predictivityPct: sig.predictivityPct,
          implemented: sig.implemented,
        },
      });
      created += 1;
    }
  }

  console.log(
    `\n✅ ${dryRun ? "DRY RUN" : "DONE"} — ${created} créés, ${updated} mis à jour`,
  );

  // Stats finales
  if (!dryRun) {
    const total = await db.signalCatalog.count();
    const byCat = await db.signalCatalog.groupBy({
      by: ["category"],
      _count: true,
    });
    const implemented = await db.signalCatalog.count({ where: { implemented: true } });
    console.log(`\n📊 État catalogue :`);
    console.log(`   Total : ${total}`);
    for (const c of byCat) console.log(`   ${c.category} : ${c._count}`);
    console.log(`   Implémentés : ${implemented}/${total}`);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
