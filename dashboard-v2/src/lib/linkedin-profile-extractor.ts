/**
 * LinkedIn Profile Extractor — chantier #2a (01/05/2026, schéma vérifié live)
 * ──────────────────────────────────────────────────────
 * Parse le JSON brut renvoyé par HarvestAPI Profile mode "Full" (actor
 * `harvestapi/linkedin-profile-search`) pour en extraire les données
 * structurées nécessaires au scoring fit dynamique (chantier #2b).
 *
 * Schéma réel observé sur Stéphane Vanacker (CTO Asys) le 01/05/2026 :
 *   currentPosition: [{ position, companyName, duration, startDate:{year,month,text}, endDate:{text}, description }]
 *   experience:      [...] (même format pour TOUT le parcours)
 *   about:           summary
 *   headline:        title court
 *
 * Module 100% PUR : zéro dépendance DB/IO. Testable unitairement.
 */

export interface ExtractedExperience {
  title: string;
  companyName: string;
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  durationMonths: number | null;
  description: string | null;
  isCurrent: boolean;
}

export interface ExtractedProfile {
  headline: string | null;
  summary: string | null;
  currentTenureMonths: number | null;
  experiences: ExtractedExperience[];
  totalExperienceYears: number | null;
  industriesWorkedIn: string[];
  hasESNBackground: boolean;
  hasSaaSBackground: boolean;
  hasStartupBackground: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Conversion mois texte → numéro
// ──────────────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1, janv: 1,
  feb: 2, february: 2, fev: 2, févr: 2, février: 2,
  mar: 3, march: 3, mars: 3,
  apr: 4, april: 4, avr: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juin: 6,
  jul: 7, july: 7, juil: 7, juillet: 7,
  aug: 8, august: 8, aoû: 8, août: 8, aout: 8,
  sep: 9, september: 9, sept: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, déc: 12, decembre: 12, décembre: 12,
};

export function parseMonthTextToNumber(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number" && input >= 1 && input <= 12) return Math.floor(input);
  if (typeof input !== "string") return null;
  const key = input.trim().toLowerCase().replace(/\.$/, "");
  return MONTH_MAP[key] ?? null;
}

// ──────────────────────────────────────────────────────────────────────
// Date parsing — supporte le shape HarvestAPI {year, month: "Jan"} ET
// le format string YYYY-MM legacy
// ──────────────────────────────────────────────────────────────────────

export interface YM {
  year: number;
  month: number;
}

export function parseDateInput(input: unknown): YM | null {
  if (!input) return null;

  // Format objet {year, month}
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    const year = typeof o.year === "number" ? o.year : null;
    const month = parseMonthTextToNumber(o.month);
    if (year && year > 1900 && year < 2100) {
      return { year, month: month ?? 1 };
    }
    // {text: "Present"} → null (sera traité par isCurrent ailleurs)
    return null;
  }

  // Format string YYYY-MM ou YYYY-MM-DD ou YYYY
  if (typeof input === "string") {
    const trimmed = input.trim();
    const m1 = trimmed.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
    if (m1) {
      const year = parseInt(m1[1]!, 10);
      const month = parseInt(m1[2]!, 10);
      if (year > 1900 && year < 2100 && month >= 1 && month <= 12) {
        return { year, month };
      }
    }
    const m2 = trimmed.match(/^(\d{4})$/);
    if (m2) {
      const year = parseInt(m2[1]!, 10);
      if (year > 1900 && year < 2100) return { year, month: 1 };
    }
  }

  return null;
}

export function monthsBetween(a: YM, b: YM): number {
  const diff = (b.year - a.year) * 12 + (b.month - a.month);
  return Math.abs(diff);
}

// ──────────────────────────────────────────────────────────────────────
// Détection "current" — endDate text "Present" / absence endDate year
// ──────────────────────────────────────────────────────────────────────

export function isCurrentExperience(rawEnd: unknown, explicitCurrent?: boolean): boolean {
  if (explicitCurrent === true) return true;
  if (!rawEnd) return true; // pas de endDate → considéré comme actuel
  if (typeof rawEnd === "object" && rawEnd !== null) {
    const o = rawEnd as Record<string, unknown>;
    if (typeof o.text === "string" && /present|current|aujourd|en\s+cours/i.test(o.text)) return true;
    if (!o.year) return true;
  }
  if (typeof rawEnd === "string" && /present|current/i.test(rawEnd)) return true;
  return false;
}

// ──────────────────────────────────────────────────────────────────────
// Backgrounds detection (ESN / SaaS / Startup)
// ──────────────────────────────────────────────────────────────────────

const ESN_PATTERNS = [
  /\b(capgemini|sopra|atos|accenture|deloitte|cgi|davidson|wavestone|onepoint|ippon|micropole|niji|kyriba|sii|alten|akka|ausy|altran|devoteam|ekino|inetum|asys|amaris|klanik)\b/i,
];
const SAAS_PATTERNS = [
  /\b(saas|software|app|platform|cloud|tech|digital|web|api|data|hubspot|salesforce|shopify|stripe|notion|figma|airtable|slack|atlassian|asys\s*groupe)\b/i,
];
const STARTUP_PATTERNS = [
  /\b(startup|scaleup|scale[- ]?up|early[- ]?stage|series[- ][abc]|seed)\b/i,
];

export interface BackgroundFlags {
  hasESNBackground: boolean;
  hasSaaSBackground: boolean;
  hasStartupBackground: boolean;
}

export function detectBackgrounds(companyNames: string[]): BackgroundFlags {
  const text = companyNames.filter(Boolean).join(" | ");
  return {
    hasESNBackground: ESN_PATTERNS.some((p) => p.test(text)),
    hasSaaSBackground: SAAS_PATTERNS.some((p) => p.test(text)),
    hasStartupBackground: STARTUP_PATTERNS.some((p) => p.test(text)),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Extracteur principal — tolérant aux 2 schémas (HarvestAPI réel + legacy)
// ──────────────────────────────────────────────────────────────────────

interface RawExperience {
  // Vrai schéma HarvestAPI Profile Full
  position?: string | null;
  companyName?: string | null;
  startDate?: unknown;
  endDate?: unknown;
  description?: string | null;
  duration?: string | null;
  // Schéma legacy / autres
  title?: string | null;
  current?: boolean;
}

interface RawHarvestProfile {
  headline?: string | null;
  about?: string | null;     // vrai schéma HarvestAPI
  summary?: string | null;   // legacy
  experience?: RawExperience[];        // vrai schéma
  experiences?: RawExperience[];       // legacy
  positions?: RawExperience[];         // alt
  currentPosition?: RawExperience[];   // singleton array (vrai schéma)
  currentPositions?: RawExperience[];  // legacy
}

const EMPTY_PROFILE: ExtractedProfile = {
  headline: null,
  summary: null,
  currentTenureMonths: null,
  experiences: [],
  totalExperienceYears: null,
  industriesWorkedIn: [],
  hasESNBackground: false,
  hasSaaSBackground: false,
  hasStartupBackground: false,
};

export function extractLinkedInProfile(payload: unknown): ExtractedProfile {
  if (!payload || typeof payload !== "object") return { ...EMPTY_PROFILE };
  const p = payload as RawHarvestProfile;

  // Aggrège experiences depuis tous les champs (dédup par title+company)
  const rawList: RawExperience[] = [
    ...(p.currentPosition ?? []),
    ...(p.currentPositions ?? []),
    ...(p.experience ?? []),
    ...(p.experiences ?? []),
    ...(p.positions ?? []),
  ];

  const seen = new Set<string>();
  const validExperiences: ExtractedExperience[] = [];
  const now: YM = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };

  for (const r of rawList) {
    const title = (r.position ?? r.title ?? "").trim();
    const companyName = (r.companyName ?? "").trim();
    if (!title || !companyName) continue;

    const key = `${title.toLowerCase()}|${companyName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const start = parseDateInput(r.startDate);
    const isCur = isCurrentExperience(r.endDate, r.current);
    const endYM = isCur ? now : parseDateInput(r.endDate);

    let durationMonths: number | null = null;
    if (start && endYM) {
      durationMonths = monthsBetween(start, endYM);
    }

    validExperiences.push({
      title,
      companyName,
      startYear: start?.year ?? null,
      startMonth: start?.month ?? null,
      endYear: endYM?.year ?? null,
      endMonth: endYM?.month ?? null,
      durationMonths,
      description: (r.description ?? "").trim() || null,
      isCurrent: isCur,
    });
  }

  // currentTenure = première experience marquée current
  const current = validExperiences.find((e) => e.isCurrent);
  const currentTenureMonths = current?.durationMonths ?? null;

  // totalExperience : somme des durations connues
  const totalMonths = validExperiences.reduce((acc, e) => acc + (e.durationMonths ?? 0), 0);
  const totalExperienceYears = totalMonths > 0 ? Math.round(totalMonths / 12) : null;

  // Backgrounds
  const allCompanies = validExperiences.map((e) => e.companyName);
  const backgrounds = detectBackgrounds(allCompanies);

  return {
    headline: (p.headline ?? "").trim() || null,
    summary: (p.about ?? p.summary ?? "").trim() || null,
    currentTenureMonths,
    experiences: validExperiences,
    totalExperienceYears,
    industriesWorkedIn: Array.from(new Set(allCompanies)),
    ...backgrounds,
  };
}
