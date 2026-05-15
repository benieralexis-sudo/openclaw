/**
 * Tech-hire guard — pure functions (testable sans dépendance `server-only`).
 *
 * Extrait de ensure-lead-for-trigger.ts (14/05/2026) pour permettre les tests
 * vitest. Logique inchangée à part le fix WeWard (priorité STRONG_NON_TECH
 * sur Founder/Co-founder).
 *
 * Mission : décider si un poster Apify / decision-maker TheirStack peut être
 * utilisé comme contact initial sur un trigger HIRING_KEY tech, ou s'il faut
 * laisser HarvestAPI chercher un vrai décideur tech (CTO, Head Eng…).
 */

// Bug Training Orchestra (11/05/2026) — Définit si un titre de poste est
// "tech leader" (= décideur légitime sur un recrutement tech). On accepte
// CTO, Head of Engineering/QA/Tech, Tech Lead, VP Eng, Engineering Manager,
// Co-founder/Founder seul (en PME ils décident souvent du recrutement tech).
// On REFUSE : CEO/Président/DG/Gérant (même combiné avec Co-founder, cas
// WeWard 14/05), Communication/Marketing/Sales/RH, Commercial, Finance,
// COO (sauf si combo "CTO & COO" qui matche déjà CTO en priorité 2).
export const TECH_PERSONA_RE =
  /\b(cto|chief tech|head of (engineering|tech|qa|test|product|development)|vp (engineering|tech|product)|engineering manager|tech lead|tech manager|software development manager|dev manager|directeur technique|responsable technique|architecte|dsi|cio|chief information officer|directeur (des )?systèmes? d|head of qa|qa manager|qa director|qa lead|test manager|directeur (de la |des )?qualité|founder|fondateur|co.?founder|cofondateur)\b/i;

// Fix WeWard (14/05/2026) — Leadership non-tech qui prime sur Founder/Co-founder.
// Cas concret : Yves Benchimol "CEO & Co-founder" sur trigger HIRING_KEY tech
// (NAF 62.02A). Avant fix : regex TECH_PERSONA matchait co-founder → poster
// accepté → Lead = mauvaise persona (CEO ≠ décideur QA en PME 11-50).
// Maintenant : STRONG_NON_TECH checké AVANT TECH → reject même si combo.
// Founder/Co-founder SEUL (sans CEO/Pr/DG) continue d'être accepté.
export const STRONG_NON_TECH_RE =
  /\b(ceo|chief executive|directeur général|pdg|président|pr[eé]sident|gérant|managing director|md\b)\b/i;

export const NON_TECH_PERSONA_RE =
  /\b(communication|marketing|sales|commercial|business development|business developer|hr|rh|ressources humaines|talent|recruitment|recruiter|finance|cfo|chief financial|legal|juridique|operations|coo(?! &|\s*&)|chief operating)\b/i;

export function isTechPersonaTitle(title: string | undefined | null): boolean {
  if (!title) return false;
  // PRIORITÉ 1 : leadership non-tech (CEO/Pr/DG/MD/Gérant) → reject même
  // si combo avec Founder/Co-founder. En PME 11-50, le CEO+Co-founder
  // délègue le recrutement tech à un VP Eng/CTO → HarvestAPI prendra le relais.
  if (STRONG_NON_TECH_RE.test(title)) return false;
  // PRIORITÉ 2 : titres tech légitimes (CTO/Head Eng/Founder seul, etc.)
  if (TECH_PERSONA_RE.test(title)) return true;
  // PRIORITÉ 3 : autres non-tech (Communication/Sales/HR/Marketing/...)
  if (NON_TECH_PERSONA_RE.test(title)) return false;
  // Par défaut : titre exotique inconnu → accepte (évite faux négatifs sur
  // "Lead Architecte", "Staff Engineer" déjà couverts en priorité 2)
  return true;
}

// Bug Training Orchestra (11/05/2026) — Détermine si un trigger HIRING_KEY
// porte sur un recrutement tech (NAF tech OU mots-clés du titre offrent un
// indice). Si oui, on doit exiger un contact tech (CTO/Head Eng/Tech Lead,
// pas CEO/Communication/RH/Sales).
export const TECH_NAF_RE = /^(62\.|58\.29|63\.)/;
export const TECH_TITLE_KEYWORDS_RE =
  /\b(dev|développe|engineer|ingénieur|qa|test|backend|frontend|fullstack|devops|sre|data|cto|tech|lead|architect|ml|ai|software|cloud|sécurité|security)/i;

export function isTechHiringTrigger(
  type: string | null | undefined,
  companyNaf: string | null | undefined,
  title: string | null | undefined,
): boolean {
  if (type !== "HIRING_KEY") return false;
  const nafTech = companyNaf ? TECH_NAF_RE.test(companyNaf) : false;
  const titleTech = title ? TECH_TITLE_KEYWORDS_RE.test(title) : false;
  return nafTech || titleTech;
}

// ═══════════════════════════════════════════════════════════════════
// Fix B11 (15/05/2026) — Multi-tenant config-driven persona domain
// ═══════════════════════════════════════════════════════════════════
//
// Avant : `isTechPersonaTitle` + `isTechHiringTrigger` étaient hardcodés
// pour DTL (cible CTO/Head Eng pour QA outsourcing). Conséquence pour iFIND
// (ICP Sales : SDR/BDR/CRO/Head of Sales) : poster Apify "Head of Sales"
// rejeté à tort sur HIRING_KEY Sales → 5/7 OUI iFIND avec mauvaise persona.
//
// Maintenant : `inferPersonaDomain(icp)` lit `client.icp.personas` pour
// déterminer "tech" ou "sales". Les helpers `isAcceptedPersonaTitle(title,
// domain)` et `isHiringTriggerForDomain(type, naf, title, domain)` routent
// vers les regex appropriées.
//
// Domain "tech" = DTL (CTO/Head Eng/QA Manager...)
// Domain "sales" = iFIND (Head of Sales/CRO/VP Sales/Head of Growth...)

export type PersonaDomain = "tech" | "sales";

/** Personae considérées comme décideurs Sales/Growth/Marketing acceptables.
 *  Le Founder/CEO/Président est aussi accepté car en PME 11-50 ils décident
 *  souvent du recrutement Sales eux-mêmes (différent du cas tech où on
 *  préfère le CTO opérationnel au CEO statutaire). */
export const SALES_PERSONA_RE =
  /\b(head of sales|sales director|directeur (des )?ventes|cro|chief revenue|vp sales|vp revenue|revenue lead|head of growth|growth lead|growth director|growth manager|sdr lead|bdr lead|cmo|chief marketing|marketing director|head of marketing|gtm|go.to.market|founder|fondateur|co.?founder|cofondateur|ceo|chief executive|directeur général|président|pr[eé]sident|gérant|managing director)\b/i;

/** Non-Sales hardcore : Tech/HR/Finance/Operations qui ne décident PAS du
 *  recrutement Sales/Growth. À rejeter sur signal Sales. */
export const NON_SALES_PERSONA_RE =
  /\b(cto|chief tech|directeur technique|head of (engineering|tech|qa|test|product|development)|engineering manager|tech lead|hr|rh|ressources humaines|talent|recruitment|recruiter|finance|cfo|chief financial|legal|juridique|coo|chief operating)\b/i;

export function isSalesPersonaTitle(title: string | undefined | null): boolean {
  if (!title) return false;
  // Priorité 1 : non-Sales hardcore (Tech/HR/Finance) → reject
  if (NON_SALES_PERSONA_RE.test(title)) return false;
  // Priorité 2 : titres Sales légitimes
  if (SALES_PERSONA_RE.test(title)) return true;
  // Par défaut : titre exotique → accepte (évite faux négatifs)
  return true;
}

/** Mots-clés titre de poste indicatifs d'un recrutement Sales/Growth/GTM. */
export const SALES_TITLE_KEYWORDS_RE =
  /\b(sales|sdr|bdr|account exec|account executive|cro|revenue|growth|marketing|cmo|gtm|go.to.market|business developer|business development|biz dev|commercial)/i;

export function isSalesHiringTrigger(
  type: string | null | undefined,
  _companyNaf: string | null | undefined,
  title: string | null | undefined,
): boolean {
  if (type !== "HIRING_KEY") return false;
  // Pour Sales : NAF moins pertinent (un recrutement Sales chez une boîte
  // NAF tech peut être sales-hire valide). On regarde le titre seul.
  return title ? SALES_TITLE_KEYWORDS_RE.test(title) : false;
}

/**
 * Détermine le domain persona du client depuis son ICP.
 *
 * Heuristique : si `client.icp.personas` contient ≥1 titre Sales-ish et
 * AUCUN titre Tech-ish, on signale "sales". Sinon on retombe sur "tech"
 * (default DTL).
 *
 * Cas concrets :
 *   - DTL personas = ["CTO", "Head of Engineering", ...] → "tech"
 *   - iFIND personas = ["Founder", "CEO", "Head of Sales", "VP Sales", "CRO", "Head of Growth"]
 *     → "sales" (Founder/CEO ne disqualifient pas Sales puisqu'ils sont
 *     listés à côté de Head of Sales/CRO/Growth).
 */
export function inferPersonaDomain(
  icp: unknown | null | undefined,
): PersonaDomain {
  if (!icp || typeof icp !== "object") return "tech";
  const personas = (icp as { personas?: Array<{ title?: string }> }).personas;
  if (!Array.isArray(personas) || personas.length === 0) return "tech";
  const titles = personas
    .map((p) => (p?.title ?? "").toLowerCase())
    .filter(Boolean);
  const hasSales =
    titles.some((t) => /\b(sales|cro|growth|sdr|bdr|revenue|cmo|marketing)\b/i.test(t));
  const hasTechSpecific =
    titles.some((t) => /\b(cto|chief tech|head of (engineering|qa|tech|test|product)|vp engineering|engineering manager|tech lead|dsi|directeur technique)\b/i.test(t));
  // Si Sales explicite ET pas de Tech spécifique → "sales".
  if (hasSales && !hasTechSpecific) return "sales";
  return "tech";
}

/** Wrapper config-driven pour `isTechPersonaTitle` / `isSalesPersonaTitle`. */
export function isAcceptedPersonaTitle(
  title: string | undefined | null,
  domain: PersonaDomain,
): boolean {
  return domain === "sales" ? isSalesPersonaTitle(title) : isTechPersonaTitle(title);
}

/** Wrapper config-driven pour `isTechHiringTrigger` / `isSalesHiringTrigger`. */
export function isHiringTriggerForDomain(
  type: string | null | undefined,
  companyNaf: string | null | undefined,
  title: string | null | undefined,
  domain: PersonaDomain,
): boolean {
  return domain === "sales"
    ? isSalesHiringTrigger(type, companyNaf, title)
    : isTechHiringTrigger(type, companyNaf, title);
}
