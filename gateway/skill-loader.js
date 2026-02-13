// MoltBot - Chargeur de modules cross-skill centralise
// Remplace le pattern fragile try { require(relative) } catch { require(absolute) }
'use strict';

const path = require('path');

// Chemins des storages par skill
const SKILL_STORAGES = {
  'flowfast': 'flowfast/storage.js',
  'automailer': 'automailer/storage.js',
  'crm-pilot': 'crm-pilot/storage.js',
  'lead-enrich': 'lead-enrich/storage.js',
  'content-gen': 'content-gen/storage.js',
  'invoice-bot': 'invoice-bot/storage.js',
  'proactive-agent': 'proactive-agent/storage.js',
  'self-improve': 'self-improve/storage.js',
  'web-intelligence': 'web-intelligence/storage.js',
  'system-advisor': 'system-advisor/storage.js',
  'autonomous-pilot': 'autonomous-pilot/storage.js'
};

// Chemins des modules specifiques
const SKILL_MODULES = {
  'hubspot-client': 'crm-pilot/hubspot-client.js',
  'resend-client': 'automailer/resend-client.js',
  'apollo-enricher': 'lead-enrich/apollo-enricher.js',
  'ai-classifier': 'lead-enrich/ai-classifier.js'
};

const SKILLS_ROOT = path.resolve(__dirname, '..', 'skills');

/**
 * Charge le storage d'un skill par son nom.
 * @param {string} skillName - Nom du skill (ex: 'automailer', 'crm-pilot')
 * @returns {Object|null} Le module storage ou null si introuvable
 */
function getStorage(skillName) {
  const relPath = SKILL_STORAGES[skillName];
  if (!relPath) return null;
  try {
    return require(path.join(SKILLS_ROOT, relPath));
  } catch (e) {
    console.log('[skill-loader] Impossible de charger storage ' + skillName + ':', e.message);
    return null;
  }
}

/**
 * Charge un module specifique d'un skill.
 * @param {string} moduleName - Nom du module (ex: 'hubspot-client', 'resend-client')
 * @returns {Object|null} Le module ou null si introuvable
 */
function getModule(moduleName) {
  const relPath = SKILL_MODULES[moduleName];
  if (!relPath) return null;
  try {
    return require(path.join(SKILLS_ROOT, relPath));
  } catch (e) {
    console.log('[skill-loader] Impossible de charger module ' + moduleName + ':', e.message);
    return null;
  }
}

module.exports = { getStorage, getModule };
