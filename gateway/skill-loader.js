// iFIND - Chargeur de modules cross-skill centralise
// Remplace le pattern fragile try { require(relative) } catch { require(absolute) }
'use strict';

const path = require('path');
const log = require('./logger.js');

// Chemins des storages par skill
const SKILL_STORAGES = {
  'automailer': 'automailer/storage.js',
  'crm-pilot': 'crm-pilot/storage.js',
  'lead-enrich': 'lead-enrich/storage.js',
  'invoice-bot': 'invoice-bot/storage.js',
  'proactive-agent': 'proactive-agent/storage.js',
  'self-improve': 'self-improve/storage.js',
  'web-intelligence': 'web-intelligence/storage.js',
  'system-advisor': 'system-advisor/storage.js',
  'autonomous-pilot': 'autonomous-pilot/storage.js',
  'inbox-manager': 'inbox-manager/storage.js',
  'meeting-scheduler': 'meeting-scheduler/storage.js',
  'flowfast': 'flowfast/storage.js'
};

// Chemins des modules specifiques
const SKILL_MODULES = {
  'hubspot-client': 'crm-pilot/hubspot-client.js',
  'resend-client': 'automailer/resend-client.js',
  'claude-email-writer': 'automailer/claude-email-writer.js',
  'campaign-engine': 'automailer/campaign-engine.js',
  // 'apollo-connector': 'flowfast/apollo-connector.js', // Apollo resilie mars 2026
  'ai-classifier': 'lead-enrich/ai-classifier.js',
  'web-fetcher': 'web-intelligence/web-fetcher.js',
  'prospect-researcher': 'autonomous-pilot/prospect-researcher.js',
  'action-executor': 'autonomous-pilot/action-executor.js',
  'calendar-client': 'meeting-scheduler/google-calendar-client.js',
  'reply-classifier': 'inbox-manager/reply-classifier.js',
  'intent-scorer': 'lead-enrich/intent-scorer.js',
  'ab-testing': 'automailer/ab-testing.js',
  'diagnostic': 'autonomous-pilot/diagnostic.js'
};

// Chemins des modules gateway (resolus depuis gateway/)
const GATEWAY_ROOT = __dirname;
const GATEWAY_MODULES = {
  'icp-loader': 'icp-loader.js',
  'shared-nlp': 'shared-nlp.js',
  'app-config': 'app-config.js',
  'constants': 'constants.js',
  'circuit-breaker': 'circuit-breaker.js'
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
    log.warn('skill-loader', 'Impossible de charger storage ' + skillName + ':', e.message);
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
    log.warn('skill-loader', 'Impossible de charger module ' + moduleName + ':', e.message);
    return null;
  }
}

/**
 * Charge un module gateway par son nom.
 * @param {string} moduleName - Nom du module (ex: 'icp-loader', 'shared-nlp')
 * @returns {Object|null} Le module ou null si introuvable
 */
function getGateway(moduleName) {
  const relPath = GATEWAY_MODULES[moduleName];
  if (!relPath) return null;
  try {
    return require(path.join(GATEWAY_ROOT, relPath));
  } catch (e) {
    log.warn('skill-loader', 'Impossible de charger gateway ' + moduleName + ':', e.message);
    return null;
  }
}

module.exports = { getStorage, getModule, getGateway };
