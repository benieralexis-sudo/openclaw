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
