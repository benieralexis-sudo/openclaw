// Autonomous Pilot - Fonctions utilitaires (testables, 0 dependances)
'use strict';

// Escape Markdown Telegram MarkdownV2
function escTg(text) {
  if (!text) return '';
  return String(text).replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&').substring(0, 2000);
}

// Parse JSON response from Claude (robuste)
// Extrait un objet JSON valide meme s'il est entoure de texte ou dans un code block
function parseJsonResponse(text) {
  if (!text) return null;
  try {
    // 1. Strip markdown code blocks
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    // 2. Essai parse direct
    try { return _validatePlan(JSON.parse(cleaned)); } catch (_) {}

    // 3. Trouver le premier objet JSON balance (accolades equilibrees)
    let depth = 0, start = -1;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (cleaned[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            const parsed = JSON.parse(cleaned.substring(start, i + 1));
            return _validatePlan(parsed);
          } catch (_) {
            start = -1;
          }
        }
      }
    }
  } catch (e) {
    // silently fail
  }
  return null;
}

// Valide et normalise un plan brain : arrays, actions valides, params non-null
function _validatePlan(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  if (!Array.isArray(parsed.actions)) parsed.actions = [];
  if (!Array.isArray(parsed.experiments)) parsed.experiments = [];
  if (!Array.isArray(parsed.learnings)) parsed.learnings = [];
  if (!Array.isArray(parsed.diagnosticItems)) parsed.diagnosticItems = [];
  if (!parsed.reasoning) parsed.reasoning = '(raison non fournie)';

  // Valider chaque action : type requis, params doit etre un objet non-null
  parsed.actions = parsed.actions.filter(a => {
    if (!a || typeof a !== 'object') return false;
    if (!a.type || typeof a.type !== 'string') return false;
    if (a.params === null || a.params === undefined) a.params = {};
    if (typeof a.params !== 'object' || Array.isArray(a.params)) a.params = {};
    return true;
  });

  return parsed;
}

module.exports = { escTg, parseJsonResponse };
