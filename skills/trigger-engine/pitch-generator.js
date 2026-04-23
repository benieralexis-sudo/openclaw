// ═══════════════════════════════════════════════════════════════════
// Pitch Generator — génère un email personnalisé par match
// ═══════════════════════════════════════════════════════════════════
// Prend un match (siren, pattern, score) + les data company enrichies,
// et génère :
//   - un objet d'email
//   - le corps de l'email
//   - des variables pour injection Smartlead
//
// Le pitch_angle du pattern contient des placeholders :
//   {nom}      → raison_sociale
//   {solution} → choix auto basé sur vertical du pattern
//   {dept}     → département INSEE
//   {naf}      → libellé NAF
//
// Les solutions par vertical sont pré-calibrées (business Alexis).
// ═══════════════════════════════════════════════════════════════════

'use strict';

// Solutions par vertical (injectées dans {solution} des pitch_angles)
const SOLUTION_BY_VERTICAL = {
  'rh-saas': 'structurer votre recrutement avec un process reproductible',
  'conseil': 'accélérer votre structuration (organisation, process, pilotage)',
  'outsourcing': 'déléguer les tâches chronophages de votre équipe',
  'recruitment': 'recruter plus vite et moins cher via un sourcing ciblé',
  'tools': 'automatiser vos processus (onboarding, RH, reporting)',
  'saas': 'équiper vos équipes d\'outils qui scalent',
  'finance-ops': 'professionnaliser votre compta et pilotage financier',
  'qa': 'tester votre produit sans freiner vos devs',
  'cyber': 'sécuriser votre stack avant les incidents'
};

const DEFAULT_SOLUTION = 'structurer cette phase de croissance sans perdre en agilité';

/**
 * Choisit une solution adaptée au pattern + fallback générique.
 */
function pickSolution(patternVerticaux) {
  if (!Array.isArray(patternVerticaux) || patternVerticaux.length === 0) {
    return DEFAULT_SOLUTION;
  }
  for (const v of patternVerticaux) {
    if (SOLUTION_BY_VERTICAL[v]) return SOLUTION_BY_VERTICAL[v];
  }
  return DEFAULT_SOLUTION;
}

/**
 * Génère un objet d'email adapté au pattern.
 */
function generateSubject(match) {
  const nom = match.raison_sociale || 'votre équipe';
  switch (match.pattern_id) {
    case 'funding-recent':
      return `Félicitations pour votre levée — ${nom}`;
    case 'tech-hiring':
    case 'hiring-surge':
    case 'multi-role-scaling':
      return `${nom} recrute — quelques minutes ?`;
    case 'sales-team-scaling':
      return `Structuration commerciale — ${nom}`;
    case 'new-exec-hire':
      return `Nouveau membre exec chez ${nom}`;
    case 'scale-up-tech':
      return `Phase de scaling tech chez ${nom}`;
    case 'restructuring-opportunity':
      return `Transition stratégique — ${nom}`;
    case 'new-company-hiring':
      return `Félicitations pour la création de ${nom}`;
    case 'new-brand-launch':
      return `Nouvelle marque déposée — ${nom}`;
    default:
      return `Message rapide pour ${nom}`;
  }
}

/**
 * Remplit le template pitch_angle avec les variables du match.
 */
function fillTemplate(template, match) {
  if (!template) return '';
  const vars = {
    '{nom}': match.raison_sociale || match.nom_complet || match.siren || 'votre équipe',
    '{solution}': pickSolution(match.verticaux),
    '{dept}': match.departement || '',
    '{naf}': match.naf_label || match.naf_code || '',
    '{effectif}': match.effectif_min ? `${match.effectif_min}` : ''
  };
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(k).join(v);
  }
  return out;
}

/**
 * Génère un corps d'email complet (intro + pitch + CTA + signature slot).
 */
function generateBody(match) {
  const nom = match.raison_sociale || 'votre équipe';
  const pitch = fillTemplate(match.pitch_angle, match);

  const intro = (() => {
    switch (match.pattern_id) {
      case 'funding-recent':
        return `Bonjour,\n\nJe viens de voir l'annonce de votre levée sur ${match.funding_feed || 'la presse startup'}.`;
      case 'tech-hiring':
      case 'hiring-surge':
      case 'sales-team-scaling':
      case 'multi-role-scaling':
        return `Bonjour,\n\nJ'ai repéré plusieurs offres actives chez ${nom} récemment.`;
      case 'new-exec-hire':
        return `Bonjour,\n\nVu qu'un nouveau profil exec a été recruté récemment chez ${nom}.`;
      case 'new-brand-launch':
        return `Bonjour,\n\nJ'ai vu que vous aviez déposé récemment une nouvelle marque à l'INPI.`;
      default:
        return `Bonjour,`;
    }
  })();

  const cta = `\n\nSi c'est le bon moment, on peut échanger 15 min cette semaine — jeudi 14h ou vendredi 10h ?`;

  return `${intro}\n\n${pitch}${cta}\n\nAlexis`;
}

/**
 * Point d'entrée principal.
 * @param {object} match - enrichi avec company + pattern
 * @returns {{subject, body, variables}}
 */
function generatePitch(match) {
  return {
    subject: generateSubject(match),
    body: generateBody(match),
    variables: {
      siren: match.siren,
      company: match.raison_sociale || match.nom_complet,
      dept: match.departement,
      naf: match.naf_label || match.naf_code,
      effectif: match.effectif_min,
      pattern: match.pattern_id,
      score: match.score,
      solution: pickSolution(match.verticaux)
    }
  };
}

module.exports = {
  generatePitch,
  generateSubject,
  generateBody,
  pickSolution,
  SOLUTION_BY_VERTICAL
};
