/**
 * Harvestapi Signal Rules — pure functions extraites pour tests vitest.
 *
 * Le module `harvestapi-decision-makers.ts` est `server-only` (importe db).
 * On extrait `SignalType` + `inferSignalType` ici pour permettre les tests
 * unitaires directs (Fix B20.1 — couverture tests modules critiques).
 */

export type SignalType =
  | "qa-hire"           // priorité Head of QA > CTO > Eng Manager > VP Eng > Founder
  | "fundraising"       // priorité CEO > Founder > CFO
  | "tech-hire"         // priorité CTO > VP Eng > Eng Manager > Founder
  | "sales-hire"        // Fix B11.2 (15/05) — priorité Head of Sales > CRO > VP Sales > Growth > Founder/CEO (iFIND)
  | "expansion"         // priorité CEO > COO > Founder > VP Sales
  | "public-tender"     // Phase B (20/05/2026) — priorité DSI > DPO > Directeur Achats > DGS (Digidemat secteur public)
  | "default";          // priorité CTO > CEO > Founder > Director

export function inferSignalType(
  sourceCode: string,
  triggerTitle?: string,
  /** Fix B11.2 (15/05) — Si "sales", tout hire ambigu est routé vers sales-hire
   *  (le trigger title peut contenir "QA Engineer" mais on cherche un Sales
   *  decision-maker de la boîte pour pitch iFIND).
   *  Phase B (20/05) — "public-sector" route tout BOAMP/TED vers public-tender. */
  personaDomain: "tech" | "sales" | "public-sector" = "tech",
): SignalType {
  const text = `${sourceCode ?? ""} ${triggerTitle ?? ""}`.toLowerCase();

  // Phase B (20/05/2026) — Public-sector PRIORITAIRE : BOAMP/TED-Europa
  // sont toujours des appels d'offres publics → public-tender, quelle que soit
  // la mention "hire/job" dans le titre.
  if (/\b(boamp\.tender|ted-europa\.tender|boamp|ted-europa|appel d['']?offres|march[eé] public|tender|consultation)\b/i.test(text)) {
    return "public-tender";
  }
  if (personaDomain === "public-sector") {
    return "public-tender"; // tout autre signal Digidemat → on cherche DSI/DPO/Achats
  }

  // Signaux fundraising/expansion : universels (CEO/Founder valent pour tech & sales)
  if (/fundraising|funding|levée|levee|seed|series\s*[abc]/i.test(text)) return "fundraising";
  if (/merger|acquisition|m&a/i.test(text)) return "expansion";
  // Sales-hire explicite (mots-clés Sales/Growth/SDR/...) → toujours sales-hire
  if (/\b(sales|sdr|bdr|account exec|cro|revenue|growth|cmo|gtm|go.to.market|commercial)\b/i.test(text)) return "sales-hire";
  // Routage selon personaDomain
  if (personaDomain === "sales") {
    // iFIND : on cherche un Sales/Growth decision-maker de la boîte. Tout hire
    // (même QA/tech) → sales-hire car la persona pertinente reste Head of Sales.
    if (/hire|hiring|job|emploi|qa|test|engineer|developp|dev|tech/i.test(text)) return "sales-hire";
    return "default";
  }
  // DTL tech : QA-specific puis tech-hire générique
  if (/\b(qa|test\s*engineer|test\s*manager|quality\s*assurance|testeur|recette)\b/i.test(text)) return "qa-hire";
  if (/hire|hiring|job|emploi|tech-hiring/i.test(text)) return "tech-hire";
  return "default";
}
