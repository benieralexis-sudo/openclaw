'use strict';

/**
 * STUB v2.0-cleanup — skill-loader legacy neutralisé.
 *
 * Le skill-loader chargeait dynamiquement les modules d'AutoMailer (storage,
 * resend-client, campaign-engine, ab-testing, etc.) pour le NLP routing.
 * En v2.0 on n'a plus de NLP routing dynamique. Les require directs suffisent.
 *
 * Ce stub maintient la compat avec inbox-manager/reply-classifier.js qui
 * référence encore skill-loader pour récupérer le storage automailer + app-config.
 */

const path = require('node:path');

const SKILLS_ALIASES = {
  'automailer': 'automailer/storage.js',
  'storage': 'automailer/storage.js',
  'resend-client': 'automailer/resend-client.js',
  'domain-manager': 'automailer/domain-manager.js'
};

const GATEWAY_ALIASES = {
  'app-config': './app-config.js',
  'logger': './logger.js',
  'utils': './utils.js'
};

function loadSkill(name) {
  const aliased = SKILLS_ALIASES[name] || name;
  try {
    return require(path.join('..', 'skills', aliased));
  } catch (e) {
    return null;
  }
}

function getGateway(name) {
  const aliased = GATEWAY_ALIASES[name];
  if (!aliased) return null;
  try {
    return require(aliased);
  } catch (e) {
    return null;
  }
}

module.exports = { loadSkill, getGateway, SKILLS_ALIASES, GATEWAY_ALIASES };
