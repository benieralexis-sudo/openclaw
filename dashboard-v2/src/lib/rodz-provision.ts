import "server-only";

/**
 * Provisionning des signaux Rodz par client.
 *
 * Phase 3.B — pour un client donné, lit son ICP en DB et crée les
 * signaux Rodz appropriés via API. Mode "draft" par défaut → on
 * peut activer manuellement ensuite.
 *
 * webhookUrl = https://app.ifind.fr/api/webhooks/rodz (le client est
 * routé via le rodzSignalId qu'on stocke en DB).
 */

import { db } from "@/lib/db";
import {
  createSignal,
  type RodzSignalType,
  type RodzCreateSignalInput,
  type RodzStatus,
} from "@/lib/rodz";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface ProvisionResult {
  clientId: string;
  signalsCreated: Array<{
    rodzSignalId: string;
    signalType: RodzSignalType;
    name: string;
    status: RodzStatus;
  }>;
  signalsSkipped: Array<{ signalType: RodzSignalType; reason: string }>;
  errors: Array<{ signalType: RodzSignalType; error: string }>;
}

interface ClientIcpExtended {
  industries?: string[];
  sizes?: string[];
  regions?: string[];
  minScore?: number;
  preferredSignals?: string[];
  antiPersonas?: string[];
  personaTitles?: string[];
  keywordsHiring?: string[];
  monthlyRdvTarget?: number;
  notes?: string;
}

// ──────────────────────────────────────────────────────────────────────
// Mapping ICP → params Rodz par type de signal
// ──────────────────────────────────────────────────────────────────────

const WEBHOOK_URL =
  process.env.RODZ_WEBHOOK_URL ?? "https://app.ifind.fr/api/webhooks/rodz";

/** Mappe les sizes ICP vers les valeurs Rodz exactes. */
function mapSizes(icpSizes: string[] | undefined): string[] {
  if (!icpSizes) return [];
  // Rodz attend : "Self-employed", "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"
  const valid = new Set([
    "Self-employed",
    "1-10",
    "11-50",
    "51-200",
    "201-500",
    "501-1000",
    "1001-5000",
    "5001-10000",
    "10001+",
  ]);
  const mapped = new Set<string>();
  for (const s of icpSizes) {
    // "11-50" → "11-50" direct
    if (valid.has(s)) {
      mapped.add(s);
      continue;
    }
    // "TPE" → 1-10
    if (s === "TPE") mapped.add("1-10");
    // "PME" → 11-50 + 51-200
    if (s === "PME") {
      mapped.add("11-50");
      mapped.add("51-200");
    }
    // "ETI" → 201-500 + 501-1000 + 1001-5000
    if (s === "ETI") {
      mapped.add("201-500");
      mapped.add("501-1000");
      mapped.add("1001-5000");
    }
    // "GE" → 5001-10000 + 10001+
    if (s === "GE") {
      mapped.add("5001-10000");
      mapped.add("10001+");
    }
  }
  return Array.from(mapped);
}

/** Mappe les regions ICP vers locations Rodz (noms anglais préférés). */
function mapLocations(icpRegions: string[] | undefined): string[] {
  if (!icpRegions) return [];
  const out = new Set<string>();
  for (const r of icpRegions) {
    const lower = r.toLowerCase();
    if (r === "France entière" || lower === "france") out.add("France");
    if (r === "Paris" || lower.includes("île-de-france") || lower.includes("ile-de-france")) out.add("Paris");
    if (r === "Lyon" || lower.includes("auvergne-rhône-alpes") || lower.includes("auvergne-rhone-alpes")) out.add("Lyon");
    if (r === "Bordeaux" || lower.includes("nouvelle-aquitaine") || lower.includes("aquitaine")) out.add("Bordeaux");
    if (r === "Marseille" || r === "PACA" || lower.includes("provence-alpes") || lower.includes("côte d'azur") || lower.includes("cote d'azur")) out.add("Marseille");
    if (r === "Toulouse" || lower.includes("occitanie") || lower.includes("midi-pyrénées") || lower.includes("midi-pyrenees")) out.add("Toulouse");
    if (r === "Nantes" || lower.includes("pays de la loire") || lower.includes("loire-atlantique")) out.add("Nantes");
    if (r === "Lille" || lower.includes("hauts-de-france") || lower.includes("nord-pas-de-calais")) out.add("Lille");
  }
  // Fallback : si rien matché, on ajoute "France"
  if (out.size === 0) out.add("France");
  return Array.from(out);
}

/** Mappe les personaTitles ICP → targetPersonas Rodz. */
function mapPersonas(icpPersonas: string[] | undefined): string[] {
  if (!icpPersonas) return ["CEO"];
  const out = new Set<string>();
  for (const p of icpPersonas) {
    const lower = p.toLowerCase();
    if (lower.includes("cto")) out.add("CTO");
    if (lower.includes("ceo") || lower.includes("directeur général") || lower.includes("dg ")) out.add("CEO");
    if (lower.includes("cfo") || lower.includes("daf")) out.add("CFO");
    if (lower.includes("cio")) out.add("CIO");
    if (lower.includes("cmo")) out.add("CMO");
    if (lower.includes("coo") || lower.includes("operations")) out.add("COO");
    if (lower.includes("cpo")) out.add("CPO");
    if (lower.includes("vp sales") || lower.includes("head of sales")) out.add("Head of Sales");
    if (lower.includes("vp engineering")) out.add("VP Engineering");
    if (lower.includes("fondateur") || lower.includes("founder")) out.add("Founder");
  }
  if (out.size === 0) out.add("CEO");
  return Array.from(out);
}

// ──────────────────────────────────────────────────────────────────────
// Construction des params par type de signal
// ──────────────────────────────────────────────────────────────────────

export interface SignalSpec {
  type: RodzSignalType;
  name: string;
  config: Record<string, unknown>;
  dailyLeadLimit?: number;
}

export function buildSignals(client: { name: string; icp: ClientIcpExtended }): SignalSpec[] {
  const sizes = mapSizes(client.icp.sizes);
  const locations = mapLocations(client.icp.regions);
  const personas = mapPersonas(client.icp.personaTitles);
  const customHiringTitles = client.icp.keywordsHiring ?? [];
  const excludedCompanies = client.icp.antiPersonas ?? [];

  const baseEnrichment = {
    enablePersonaTargeting: true,
    targetPersonas: personas,
    personaExportMode: "top_ranked",
    personaLocations: locations,
    getEmails: true,
    getPhones: false, // payant +5 cr/lead, on active plus tard si besoin mobile
    getSireneData: true, // 1 cr/lead extra mais utile pour matcher avec Pappers
    detectTechnologies: true,
    getHomepageContent: false,
    excludedTitles: ["Intern", "Stagiaire", "Junior"],
  };

  const signals: SignalSpec[] = [];

  // ────────────────────────────────────────────────────────────────────
  // 1. JOB OFFERS — recrutement de testeur/QA (signal #1 DigitestLab)
  // ────────────────────────────────────────────────────────────────────
  if (customHiringTitles.length > 0) {
    signals.push({
      type: "job-offers",
      name: `${client.name} — Recrutement QA/Testeur (HOT)`,
      dailyLeadLimit: 5,
      config: {
        ...baseEnrichment,
        jobTitleInclude: customHiringTitles,
        jobTitleIncludeAll: false, // OR logic — match si l'un des keywords y est
        locations,
        companySize: sizes,
        publishedDate: "30d",
        companyIndustryExcluded: excludedCompanies,
      },
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // 2. RECRUITMENT CAMPAIGN — campagne massive de recrutement Test/QA
  // ────────────────────────────────────────────────────────────────────
  if (customHiringTitles.length > 0) {
    signals.push({
      type: "recruitment-campaign",
      name: `${client.name} — Campagne recrutement Test`,
      dailyLeadLimit: 3,
      config: {
        ...baseEnrichment,
        jobTitleInclude: customHiringTitles,
        jobDescriptionInclude: ["test", "QA", "quality assurance"],
        locations,
        companySize: sizes,
        publishedDate: "30d",
      },
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // 3. JOB CHANGES — nouveau CTO / Founder / DG dans la cible
  // ────────────────────────────────────────────────────────────────────
  signals.push({
    type: "job-changes",
    name: `${client.name} — Nouveau dirigeant (CTO/CEO/Founder)`,
    dailyLeadLimit: 3,
    config: {
      ...baseEnrichment,
      jobTitles: personas, // CTO, CEO, Founder
      locations,
      companySizeFilters: sizes,
      industryFilters: client.icp.industries ?? [],
      maxJobAgeDays: 60,
      publishedDate: "30 days",
    },
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. FUNDRAISING — boîtes SaaS qui scalent
  // ────────────────────────────────────────────────────────────────────
  signals.push({
    type: "fundraising",
    name: `${client.name} — Levées SaaS`,
    dailyLeadLimit: 3,
    config: {
      ...baseEnrichment,
      investmentTypes: ["seed", "series_a", "series_b"],
      announcedPeriod: "30d",
      hqLocations: locations,
      industryFilters: ["SaaS", "Enterprise Software", "Information Technology"],
      companySizeFilters: sizes,
      amountMin: 500000, // au moins 500k€ pour filtrer le bruit
    },
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. M&A — acquisitions dans le secteur
  // ────────────────────────────────────────────────────────────────────
  signals.push({
    type: "mergers-acquisitions",
    name: `${client.name} — Acquisitions secteur`,
    dailyLeadLimit: 2,
    config: {
      ...baseEnrichment,
      dealTypes: ["acquisition", "merger"],
      announcedPeriod: "60d",
      hqLocations: locations,
      industryFilters: ["SaaS", "Enterprise Software", "Information Technology"],
      companySizeFilters: sizes,
    },
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. COMPANY REGISTRATION — nouvelles boîtes tech FR (Création société)
  // ────────────────────────────────────────────────────────────────────
  signals.push({
    type: "company-registration",
    name: `${client.name} — Création société Tech FR`,
    dailyLeadLimit: 2,
    config: {
      ...baseEnrichment,
      registrationPeriod: "30d",
      hqLocations: locations,
      industryFilters: ["SaaS", "Enterprise Software", "Information Technology", "Software Development", "IT Services and IT Consulting"],
      companySizeFilters: sizes,
    },
  });

  return signals;
}

// ──────────────────────────────────────────────────────────────────────
// Provisionning principal
// ──────────────────────────────────────────────────────────────────────

export async function provisionRodzForClient(
  clientId: string,
  options: { dryRun?: boolean; status?: RodzStatus } = {},
): Promise<ProvisionResult> {
  const status = options.status ?? "draft";

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, slug: true, icp: true },
  });
  if (!client) throw new Error(`Client ${clientId} introuvable`);
  if (!client.icp || typeof client.icp !== "object") {
    throw new Error(`Client ${client.name} n'a pas d'ICP configuré`);
  }

  const icp = client.icp as ClientIcpExtended;
  const signals = buildSignals({ name: client.name, icp });

  const result: ProvisionResult = {
    clientId,
    signalsCreated: [],
    signalsSkipped: [],
    errors: [],
  };

  // Évite de doublonner : skip les types déjà présents en DB pour ce client
  const existing = await db.rodzSignal.findMany({
    where: { clientId, deletedAt: null },
    select: { signalType: true, rodzSignalId: true },
  });
  const existingTypes = new Set(existing.map((s) => s.signalType));

  for (const spec of signals) {
    if (existingTypes.has(spec.type)) {
      result.signalsSkipped.push({
        signalType: spec.type,
        reason: "déjà provisionné",
      });
      continue;
    }

    if (options.dryRun) {
      // En dry-run on simule sans appeler Rodz
      result.signalsCreated.push({
        rodzSignalId: `dryrun_${spec.type}_${Date.now()}`,
        signalType: spec.type,
        name: spec.name,
        status,
      });
      continue;
    }

    try {
      const input: RodzCreateSignalInput = {
        name: spec.name,
        webhookUrl: WEBHOOK_URL,
        config: spec.config,
        status,
        ...(spec.dailyLeadLimit && { dailyLeadLimit: spec.dailyLeadLimit }),
      };
      const created = await createSignal(spec.type, input);

      // Stocker en DB pour multi-tenant routing
      await db.rodzSignal.create({
        data: {
          clientId,
          rodzSignalId: created.id,
          signalType: spec.type,
          name: spec.name,
          webhookUrl: WEBHOOK_URL,
          config: spec.config as never,
          dailyLeadLimit: spec.dailyLeadLimit ?? null,
          status,
          active: status === "active",
        },
      });

      result.signalsCreated.push({
        rodzSignalId: created.id,
        signalType: spec.type,
        name: spec.name,
        status,
      });
    } catch (e) {
      result.errors.push({
        signalType: spec.type,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

/**
 * Helper : preview ce qui SERAIT créé (sans toucher Rodz ni la DB).
 * Pratique pour valider la config avant d'appuyer sur le gros bouton.
 */
export async function previewRodzProvisioning(clientId: string): Promise<{
  client: { id: string; name: string };
  signals: SignalSpec[];
}> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, icp: true },
  });
  if (!client) throw new Error(`Client ${clientId} introuvable`);
  if (!client.icp) throw new Error(`Client ${client.name} sans ICP`);

  const icp = client.icp as ClientIcpExtended;
  const signals = buildSignals({ name: client.name, icp });
  return {
    client: { id: client.id, name: client.name },
    signals,
  };
}
