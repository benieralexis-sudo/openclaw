// @ts-nocheck — script audit Phase 0 v3.0
/**
 * A.0.2 — Tagging des leads DTL 6 derniers mois
 *
 * Règles de tagging (DTL = QA SaaS pour PME tech FR 11-200p, signal #1
 * = absence de QA + boîte qui en a besoin) :
 *
 * 🟢 Pépite : ICP match (NAF tech + 11-200p) + V2=OUI conf>=75 + contact OK
 *              + persona décideur tech (CTO/VP Eng/Co-founder/Director)
 *              + boîte tech avec équipe dev visible (qui aurait besoin QA)
 *
 * 🟡 OK : ICP match partiel ou contact incomplet ou V2 ENRICH
 *          → exploitable mais pas excellent
 *
 * 🔴 Hors cible : ESN pure / NAF blacklist / hors France / concurrent QA /
 *                  V2=NON conf>=85
 *
 * ⚫ Inutilisable : pas de contact + pas de SIREN + persona absente
 */
import Module from "node:module";
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("./_server-only-stub.js");
  return originalResolve.call(this, request, ...args);
};

import { config } from "dotenv";
import { writeFileSync } from "node:fs";
config({ path: "/opt/moltbot/dashboard-v2/.env" });

type TagColor = "GREEN" | "YELLOW" | "RED" | "BLACK";
type Confidence = "HIGH" | "MEDIUM" | "LOW";

interface TaggedLead {
  leadId: string;
  companyName: string;
  fullName: string | null;
  jobTitle: string | null;
  personaTier: number | null;
  email: string | null;
  emailStatus: string;
  phone: string | null;
  hasLinkedIn: boolean;
  companyNaf: string | null;
  industry: string | null;
  size: string | null;
  triggerSource: string | null;
  triggerScore: number | null;
  v2Verdict: string | null;
  v2Confidence: number | null;
  v2Thesis: string | null;
  scoreReason: string | null;
  leadStatus: string;
  createdAt: Date;
  // Tagging
  tag: TagColor;
  confidence: Confidence;
  reason: string;
}

// NAF whitelist (éditeurs SaaS + tech informatique)
const NAF_WHITELIST = new Set([
  "62.01Z", "6201Z",
  "62.02A", "6202A",
  "62.02B", "6202B",
  "62.03Z", "6203Z",
  "62.09Z", "6209Z",
  "58.29A", "5829A",
  "58.29B", "5829B",
  "58.29C", "5829C",
  "58.29D", "5829D",
  "63.11Z", "6311Z",
  "63.12Z", "6312Z",
  "70.22Z", "7022Z", // conseil management — borderline, parfois OK pour SaaS
]);

// NAF blacklist (immo, finance, recrutement, holding)
const NAF_BLACKLIST_PATTERNS = [
  /^64\./, // banque/finance
  /^65\./, // assurance
  /^66\./, // activités financières
  /^68\./, // immobilier
  /^70\.10/, // sièges sociaux / holdings
  /^78\./, // recrutement intérim
  /^71\.12/, // ingénierie (pour CTS Consulting style — ESN ingénierie pure)
  /^73\./, // publicité
  /^74\.[12]/, // études techniques
];

function classifyNaf(naf: string | null): "whitelist" | "blacklist" | "unknown" {
  if (!naf) return "unknown";
  if (NAF_WHITELIST.has(naf)) return "whitelist";
  for (const re of NAF_BLACKLIST_PATTERNS) {
    if (re.test(naf)) return "blacklist";
  }
  return "unknown";
}

function classifySize(sizeStr: string | null): "in-range" | "too-small" | "too-large" | "unknown" {
  if (!sizeStr) return "unknown";
  // Patterns: "Entre 50 et 99 salariés", "11-11p", "42", "0 salarié", "NN"
  const m = sizeStr.match(/(\d+)\s*(?:salarié|et|-|à|p)/i) ?? sizeStr.match(/^(\d+)/);
  const n = m ? parseInt(m[1]) : null;
  if (n === null || isNaN(n)) {
    // Cas spéciaux
    if (/^entre 1 et 2/i.test(sizeStr)) return "too-small";
    if (/^entre [3-9]\s*et/i.test(sizeStr)) return "too-small";
    if (/^entre 1?0 et/i.test(sizeStr)) return "too-small";
    if (/^entre [2-9]00 et/i.test(sizeStr)) return "too-large";
    return "unknown";
  }
  if (n < 11) return "too-small";
  if (n > 200) return "too-large";
  return "in-range";
}

function hasContact(l: TaggedLead): "full" | "partial" | "none" {
  const hasEmail = !!l.email && l.emailStatus === "VALID";
  const hasLI = l.hasLinkedIn;
  const hasPhone = !!l.phone;
  if (hasEmail && hasLI && hasPhone) return "full";
  if (hasEmail || hasLI) return "partial";
  return "none";
}

function tagLead(l: Omit<TaggedLead, "tag" | "confidence" | "reason">): {
  tag: TagColor;
  confidence: Confidence;
  reason: string;
} {
  const nafClass = classifyNaf(l.companyNaf);
  const sizeClass = classifySize(l.size);
  const contact = hasContact({ ...l, tag: "BLACK", confidence: "HIGH", reason: "" });

  // ⚫ INUTILISABLE : pas de contact + pas de persona
  if (contact === "none" && (!l.fullName || !l.personaTier)) {
    return {
      tag: "BLACK",
      confidence: "HIGH",
      reason: "no_contact_no_persona",
    };
  }

  // 🔴 HORS CIBLE : V2 dit NON avec haute confiance
  if (l.v2Verdict === "NON" && (l.v2Confidence ?? 0) >= 85) {
    const thesis = (l.v2Thesis ?? "").toLowerCase();
    if (thesis.includes("esn pure") || thesis.includes("régie") || thesis.includes("staffing")) {
      return { tag: "RED", confidence: "HIGH", reason: "esn_pure_confirmed_v2" };
    }
    if (thesis.includes("concurrent") || thesis.includes("offre qa")) {
      return { tag: "RED", confidence: "HIGH", reason: "concurrent_qa" };
    }
    return { tag: "RED", confidence: "HIGH", reason: `v2_NON_conf${l.v2Confidence}` };
  }

  // 🔴 HORS CIBLE : NAF blacklist
  if (nafClass === "blacklist") {
    return { tag: "RED", confidence: "HIGH", reason: `naf_blacklist_${l.companyNaf}` };
  }

  // 🔴 HORS CIBLE : taille trop large (>200) — exception 200-249 si V2 OUI
  if (sizeClass === "too-large") {
    if (l.v2Verdict === "OUI" && (l.v2Confidence ?? 0) >= 80 && (l.size ?? "").includes("200 et 249")) {
      // Frontière haute acceptable si V2 confirme
    } else {
      return { tag: "RED", confidence: "MEDIUM", reason: `size_too_large:${l.size}` };
    }
  }

  // 🔴 HORS CIBLE : taille trop petite (<11)
  if (sizeClass === "too-small") {
    return { tag: "RED", confidence: "MEDIUM", reason: `size_too_small:${l.size}` };
  }

  // 🟢 PÉPITE : tous les signaux alignés
  // - NAF whitelist OU V2 OUI conf>=80 avec NAF unknown
  // - effectif in-range OU unknown
  // - V2 verdict = OUI conf >= 75
  // - contact full
  // - persona tier 1 ou 2
  const v2Strong = l.v2Verdict === "OUI" && (l.v2Confidence ?? 0) >= 75;
  const nafOk = nafClass === "whitelist" || (nafClass === "unknown" && v2Strong);
  const sizeOk = sizeClass === "in-range" || sizeClass === "unknown";
  const personaOk = l.personaTier !== null && l.personaTier <= 2;

  if (v2Strong && nafOk && sizeOk && personaOk && contact === "full") {
    return { tag: "GREEN", confidence: "HIGH", reason: "all_signals_aligned" };
  }
  if (v2Strong && nafOk && sizeOk && personaOk && contact === "partial") {
    return { tag: "GREEN", confidence: "MEDIUM", reason: "v2_oui_strong_contact_partial" };
  }

  // 🟡 OK : ICP partiel ou V2 ENRICH ou contact partiel
  if (l.v2Verdict === "ENRICH") {
    return {
      tag: "YELLOW",
      confidence: "MEDIUM",
      reason: `v2_enrich_conf${l.v2Confidence}`,
    };
  }
  if (v2Strong && contact === "partial") {
    return {
      tag: "YELLOW",
      confidence: "MEDIUM",
      reason: "v2_oui_contact_partial",
    };
  }
  if (v2Strong && !personaOk) {
    return {
      tag: "YELLOW",
      confidence: "MEDIUM",
      reason: "v2_oui_persona_tier3+",
    };
  }
  if (nafOk && sizeOk && contact !== "none") {
    return {
      tag: "YELLOW",
      confidence: "LOW",
      reason: "icp_partial_match",
    };
  }

  // Fallback : ROUGE bas-confiance
  return {
    tag: "RED",
    confidence: "LOW",
    reason: "no_clear_match",
  };
}

async function main() {
  const { db } = await import("../src/lib/db");
  const client = await db.client.findUnique({
    where: { slug: "digitestlab" },
    select: { id: true },
  });
  if (!client) process.exit(1);

  const since = new Date();
  since.setMonth(since.getMonth() - 6);

  const leads = await db.lead.findMany({
    where: {
      clientId: client.id,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      companyName: true,
      companySiret: true,
      fullName: true,
      jobTitle: true,
      personaTier: true,
      personaSource: true,
      email: true,
      emailStatus: true,
      phone: true,
      linkedinUrl: true,
      status: true,
      createdAt: true,
      trigger: {
        select: {
          sourceCode: true,
          score: true,
          isHot: true,
          title: true,
          briefV2Json: true,
          scoreReason: true,
          companyNaf: true,
          industry: true,
          size: true,
        },
      },
    },
  });

  const tagged: TaggedLead[] = leads.map((l) => {
    const t = l.trigger;
    const v2 = (t?.briefV2Json as any) ?? null;
    const partial: Omit<TaggedLead, "tag" | "confidence" | "reason"> = {
      leadId: l.id,
      companyName: l.companyName,
      fullName: l.fullName,
      jobTitle: l.jobTitle,
      personaTier: l.personaTier,
      email: l.email,
      emailStatus: l.emailStatus,
      phone: l.phone,
      hasLinkedIn: !!l.linkedinUrl,
      companyNaf: t?.companyNaf ?? null,
      industry: t?.industry ?? null,
      size: t?.size ?? null,
      triggerSource: t?.sourceCode ?? null,
      triggerScore: t?.score ?? null,
      v2Verdict: v2?.verdict ?? null,
      v2Confidence: v2?.confidence ?? null,
      v2Thesis: v2?.thesis ?? null,
      scoreReason: t?.scoreReason ?? null,
      leadStatus: l.status,
      createdAt: l.createdAt,
    };
    const { tag, confidence, reason } = tagLead(partial);
    return { ...partial, tag, confidence, reason };
  });

  // Statistiques
  const stats: Record<string, number> = {
    total: tagged.length,
    GREEN: 0,
    YELLOW: 0,
    RED: 0,
    BLACK: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    borderline: 0,
  };
  for (const t of tagged) {
    stats[t.tag]++;
    stats[t.confidence]++;
    if (t.confidence !== "HIGH") stats.borderline++;
  }

  console.log(`\n📊 AUDIT A.0.2 — Tagging Leads DTL 6 mois\n`);
  console.log(`   Total leads taggés : ${stats.total}\n`);
  console.log(`Distribution couleurs :`);
  console.log(`   🟢 PÉPITE  : ${stats.GREEN} (${((stats.GREEN / stats.total) * 100).toFixed(1)}%)`);
  console.log(`   🟡 OK      : ${stats.YELLOW} (${((stats.YELLOW / stats.total) * 100).toFixed(1)}%)`);
  console.log(`   🔴 HORS    : ${stats.RED} (${((stats.RED / stats.total) * 100).toFixed(1)}%)`);
  console.log(`   ⚫ JUNK    : ${stats.BLACK} (${((stats.BLACK / stats.total) * 100).toFixed(1)}%)`);
  console.log(`\nDistribution confiance :`);
  console.log(`   HIGH   : ${stats.HIGH}`);
  console.log(`   MEDIUM : ${stats.MEDIUM}`);
  console.log(`   LOW    : ${stats.LOW}`);
  console.log(`\n⚠️ Cas borderline (medium/low) à vérifier : ${stats.borderline}`);

  // Export CSV
  const csvLines = [
    "leadId,companyName,fullName,jobTitle,personaTier,emailValid,LI,phone,naf,size,source,score,v2_verdict,v2_conf,leadStatus,tag,confidence,reason",
  ];
  for (const t of tagged) {
    csvLines.push(
      [
        t.leadId,
        `"${t.companyName.replace(/"/g, "'")}"`,
        `"${(t.fullName ?? "").replace(/"/g, "'")}"`,
        `"${(t.jobTitle ?? "").replace(/"/g, "'")}"`,
        t.personaTier ?? "",
        t.emailStatus === "VALID" ? "1" : "0",
        t.hasLinkedIn ? "1" : "0",
        t.phone ? "1" : "0",
        t.companyNaf ?? "",
        `"${(t.size ?? "").replace(/"/g, "'")}"`,
        t.triggerSource ?? "",
        t.triggerScore ?? "",
        t.v2Verdict ?? "",
        t.v2Confidence ?? "",
        t.leadStatus,
        t.tag,
        t.confidence,
        `"${t.reason}"`,
      ].join(","),
    );
  }
  writeFileSync("/opt/moltbot/audit/v3-phase-0/data/leads-tagged-6mois.csv", csvLines.join("\n"));
  console.log(`\n💾 CSV sauvé : audit/v3-phase-0/data/leads-tagged-6mois.csv`);

  // Distribution par source (ROI source !)
  const bySource: Record<string, { total: number; green: number; yellow: number; red: number; black: number }> = {};
  for (const t of tagged) {
    const s = t.triggerSource ?? "(no_trigger)";
    if (!bySource[s]) bySource[s] = { total: 0, green: 0, yellow: 0, red: 0, black: 0 };
    bySource[s].total++;
    bySource[s][t.tag.toLowerCase() as "green" | "yellow" | "red" | "black"]++;
  }
  console.log(`\n📊 ROI par source (% Pépite + OK) :`);
  console.log(`   Source                              | Total | 🟢 |🟡 |🔴 |⚫ | % Utile`);
  for (const [s, v] of Object.entries(bySource).sort((a, b) => b[1].total - a[1].total)) {
    const utile = (((v.green + v.yellow) / v.total) * 100).toFixed(0);
    console.log(
      `   ${s.padEnd(35)} | ${String(v.total).padStart(5)} | ${String(v.green).padStart(2)} | ${String(v.yellow).padStart(2)} | ${String(v.red).padStart(2)} | ${String(v.black).padStart(2)} | ${utile.padStart(3)}%`,
    );
  }

  // Liste des borderline (medium/low) → à vérifier humain
  const borderline = tagged.filter((t) => t.confidence !== "HIGH").slice(0, 30);
  console.log(`\n⚠️ 30 premiers cas BORDERLINE (à vérifier toi-même) :\n`);
  for (const t of borderline) {
    console.log(
      `   ${t.tag} (${t.confidence}) | ${t.companyName.slice(0, 25).padEnd(25)} | ${t.fullName?.slice(0, 25).padEnd(25) ?? "?".padEnd(25)} | ${(t.jobTitle ?? "?").slice(0, 20).padEnd(20)} | naf=${t.companyNaf ?? "?"} size=${t.size?.slice(0, 15) ?? "?"} | v2=${t.v2Verdict ?? "?"} conf=${t.v2Confidence ?? "?"} | reason=${t.reason}`,
    );
  }

  // Backtest convergence triple
  console.log(`\n\n🎯 BACKTEST RÈGLE "≥3 SIGNAUX CONVERGENTS"`);
  console.log(`(simulation : un lead a convergence si trigger source != solo, regroupement par SIRET sur même boîte 90j)`);
  // On cherche les boîtes avec >=3 triggers distincts dans la fenêtre 90j
  const greenSirens = new Set(
    tagged.filter((t) => t.tag === "GREEN").map((t) => t.leadId.slice(0, 10)),
  );
  const yellowSirens = new Set(
    tagged.filter((t) => t.tag === "YELLOW").map((t) => t.leadId.slice(0, 10)),
  );
  console.log(`   Pépites + OK identifiés : ${stats.GREEN + stats.YELLOW}`);
  console.log(`   Note : backtest convergence vrai nécessite analyse Trigger SIRET groupby, à faire en post-process`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
