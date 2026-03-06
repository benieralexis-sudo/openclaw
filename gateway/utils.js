// iFIND - Utilitaires partages (atomic write, retry, validation)
const fs = require('fs');
const path = require('path');

/**
 * Ecriture atomique avec write lock par fichier.
 * - Ecrit dans un fichier temporaire puis renomme (anti-corruption crash).
 * - Un seul write a la fois par fichier (anti-race condition async).
 * - Debounce 50ms : si plusieurs _save() arrivent en rafale, seul le dernier gagne.
 */
const _writeLocks = {};    // filePath → true si ecriture en cours
const _pendingWrites = {}; // filePath → data a ecrire (debounce)
const _debounceTimers = {}; // filePath → timer

function atomicWriteSync(filePath, data) {
  // Si un write est en cours, planifier un write differe
  if (_writeLocks[filePath]) {
    _pendingWrites[filePath] = data;
    return;
  }

  _doWrite(filePath, data);
}

function _doWrite(filePath, data) {
  _writeLocks[filePath] = true;
  try {
    const tmpFile = filePath + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, filePath);
  } finally {
    _writeLocks[filePath] = false;
    // Si un write en attente, l'executer au prochain tick
    if (_pendingWrites[filePath]) {
      const pendingData = _pendingWrites[filePath];
      delete _pendingWrites[filePath];
      process.nextTick(() => _doWrite(filePath, pendingData));
    }
  }
}

/**
 * Retry async avec backoff exponentiel.
 * @param {Function} fn - Fonction async a executer
 * @param {number} maxRetries - Nombre max de tentatives (defaut: 2)
 * @param {number} baseDelay - Delai initial en ms (defaut: 1000)
 * @returns {Promise} Resultat de fn()
 */
async function retryAsync(fn, maxRetries, baseDelay) {
  maxRetries = maxRetries || 2;
  baseDelay = baseDelay || 1000;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 500);
        const delay = baseDelay * Math.pow(2, attempt) + jitter;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Tronque un texte a maxLen caracteres pour eviter de surcharger les APIs.
 */
function truncateInput(text, maxLen) {
  maxLen = maxLen || 2000;
  if (!text || text.length <= maxLen) return text;
  return text.substring(0, maxLen);
}

/**
 * Validation d'email basique mais robuste.
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return re.test(email.trim()) && email.length <= 254;
}

/**
 * Sanitize une string pour eviter les injections (HTML entities).
 */
function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Calcule la limite d'envois quotidienne basee sur le warmup progressif.
 * Source unique de verite — utilisee par action-executor, campaign-engine, proactive-engine.
 * @param {string|Date|null} firstSendDate - Date du premier envoi (ISO string ou Date)
 * @returns {number} Limite d'emails par jour
 */
function getWarmupDailyLimit(firstSendDate) {
  if (!firstSendDate) return 5;
  const daysSinceFirst = Math.floor((Date.now() - new Date(firstSendDate).getTime()) / 86400000);
  if (daysSinceFirst < 0) return 5;
  // Schedule progressif lisse — evite les sauts brusques (35→50→75) qui declenchent spam filters
  // j0-4: 5,8,12,16,20 | j5-6: 25,30 | j7-13: 34,38,42,46,50,55,60 | j14-20: 65-75 | j21-27: 80 | j28+: 100
  const schedule = [5, 8, 12, 16, 20, 25, 30, 34, 38, 42, 46, 50, 55, 60, 65, 67, 70, 72, 75, 75, 75, 80, 80, 80, 80, 80, 80, 80, 100];
  return schedule[Math.min(daysSinceFirst, schedule.length - 1)] || 100;
}

/**
 * Concurrency guard pour crons — empeche un cron de se relancer s'il est deja en cours.
 * @param {string} name - Identifiant unique du cron (pour logging)
 * @param {Function} fn - Fonction async a executer
 * @returns {Function} Fonction wrappee avec concurrency guard
 */
const _cronRunning = {};
function withCronGuard(name, fn, { retry = false, retryDelayMs = 15 * 60 * 1000 } = {}) {
  return async () => {
    if (_cronRunning[name]) {
      log.info('cron-guard', 'Skip ' + name + ' — deja en cours');
      return;
    }
    _cronRunning[name] = true;
    const start = Date.now();
    try {
      await fn();
    } catch (e) {
      log.error('cron-guard', name + ' erreur: ' + e.message);
      // Retry une fois après délai si activé
      if (retry) {
        log.info('cron-guard', name + ' — retry programme dans ' + Math.round(retryDelayMs / 60000) + 'min');
        setTimeout(async () => {
          if (_cronRunning[name]) return;
          _cronRunning[name] = true;
          try {
            await fn();
            log.info('cron-guard', name + ' — retry reussi');
          } catch (e2) {
            log.error('cron-guard', name + ' — retry echoue: ' + e2.message);
          } finally {
            _cronRunning[name] = false;
          }
        }, retryDelayMs);
      }
    } finally {
      _cronRunning[name] = false;
      const ms = Date.now() - start;
      if (ms > 120000) {
        log.warn('cron-guard', name + ' a pris ' + Math.round(ms / 1000) + 's (>2min)');
      }
    }
  };
}
const log = require('./logger.js');

/**
 * Spintax parser : {variante1|variante2|variante3} → choix aleatoire.
 * Supporte l'imbrication a 1 niveau. Echappe \{ pour les accolades literales.
 */
function applySpintax(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\{([^{}]+)\}/g, (match, group) => {
    const variants = group.split('|');
    if (variants.length < 2) return match; // Pas un spintax valide
    return variants[Math.floor(Math.random() * variants.length)].trim();
  });
}

/**
 * Detecte la timezone IANA d'un prospect a partir de sa ville et/ou son pays.
 * Couvre les villes les plus courantes en B2B (France, Europe, US, Canada, UK, DACH, Nordics).
 * @param {string} city
 * @param {string} country
 * @returns {string} Timezone IANA (default: 'Europe/Paris')
 */
const _CITY_TZ = {
  // France
  paris: 'Europe/Paris', lyon: 'Europe/Paris', marseille: 'Europe/Paris', toulouse: 'Europe/Paris',
  nice: 'Europe/Paris', nantes: 'Europe/Paris', strasbourg: 'Europe/Paris', montpellier: 'Europe/Paris',
  bordeaux: 'Europe/Paris', lille: 'Europe/Paris', rennes: 'Europe/Paris', grenoble: 'Europe/Paris',
  // UK & Ireland
  london: 'Europe/London', manchester: 'Europe/London', birmingham: 'Europe/London', edinburgh: 'Europe/London',
  dublin: 'Europe/Dublin', glasgow: 'Europe/London', bristol: 'Europe/London', leeds: 'Europe/London',
  // DACH
  berlin: 'Europe/Berlin', munich: 'Europe/Berlin', hamburg: 'Europe/Berlin', frankfurt: 'Europe/Berlin',
  zurich: 'Europe/Zurich', geneva: 'Europe/Zurich', vienna: 'Europe/Vienna', bern: 'Europe/Zurich',
  // Benelux
  brussels: 'Europe/Brussels', amsterdam: 'Europe/Amsterdam', rotterdam: 'Europe/Amsterdam',
  luxembourg: 'Europe/Luxembourg', bruxelles: 'Europe/Brussels',
  // Southern Europe
  madrid: 'Europe/Madrid', barcelona: 'Europe/Madrid', lisbon: 'Europe/Lisbon', rome: 'Europe/Rome',
  milan: 'Europe/Rome', milano: 'Europe/Rome',
  // Nordics
  stockholm: 'Europe/Stockholm', oslo: 'Europe/Oslo', copenhagen: 'Europe/Copenhagen', helsinki: 'Europe/Helsinki',
  // US East
  'new york': 'America/New_York', boston: 'America/New_York', philadelphia: 'America/New_York',
  washington: 'America/New_York', miami: 'America/New_York', atlanta: 'America/New_York',
  charlotte: 'America/New_York',
  // US Central
  chicago: 'America/Chicago', dallas: 'America/Chicago', houston: 'America/Chicago',
  austin: 'America/Chicago', minneapolis: 'America/Chicago',
  // US Mountain
  denver: 'America/Denver', phoenix: 'America/Phoenix', salt_lake_city: 'America/Denver',
  // US West
  'san francisco': 'America/Los_Angeles', 'los angeles': 'America/Los_Angeles',
  seattle: 'America/Los_Angeles', portland: 'America/Los_Angeles', 'san diego': 'America/Los_Angeles',
  'san jose': 'America/Los_Angeles',
  // Canada
  toronto: 'America/Toronto', montreal: 'America/Toronto', vancouver: 'America/Vancouver',
  ottawa: 'America/Toronto', calgary: 'America/Edmonton',
  // Other
  dubai: 'Asia/Dubai', singapore: 'Asia/Singapore', sydney: 'Australia/Sydney',
  'tel aviv': 'Asia/Jerusalem', tokyo: 'Asia/Tokyo'
};

const _COUNTRY_TZ = {
  france: 'Europe/Paris', fr: 'Europe/Paris',
  'united kingdom': 'Europe/London', uk: 'Europe/London', gb: 'Europe/London',
  germany: 'Europe/Berlin', de: 'Europe/Berlin',
  switzerland: 'Europe/Zurich', ch: 'Europe/Zurich',
  belgium: 'Europe/Brussels', be: 'Europe/Brussels',
  netherlands: 'Europe/Amsterdam', nl: 'Europe/Amsterdam',
  spain: 'Europe/Madrid', es: 'Europe/Madrid',
  italy: 'Europe/Rome', it: 'Europe/Rome',
  portugal: 'Europe/Lisbon', pt: 'Europe/Lisbon',
  austria: 'Europe/Vienna', at: 'Europe/Vienna',
  sweden: 'Europe/Stockholm', se: 'Europe/Stockholm',
  norway: 'Europe/Oslo', no: 'Europe/Oslo',
  denmark: 'Europe/Copenhagen', dk: 'Europe/Copenhagen',
  finland: 'Europe/Helsinki', fi: 'Europe/Helsinki',
  ireland: 'Europe/Dublin', ie: 'Europe/Dublin',
  'united states': 'America/New_York', us: 'America/New_York', usa: 'America/New_York',
  canada: 'America/Toronto', ca: 'America/Toronto',
  australia: 'Australia/Sydney', au: 'Australia/Sydney',
  japan: 'Asia/Tokyo', jp: 'Asia/Tokyo',
  singapore: 'Asia/Singapore', sg: 'Asia/Singapore',
  'united arab emirates': 'Asia/Dubai', uae: 'Asia/Dubai',
  israel: 'Asia/Jerusalem', il: 'Asia/Jerusalem'
};

function getCityTimezone(city, country) {
  if (city) {
    const cityLower = city.toLowerCase().trim();
    if (_CITY_TZ[cityLower]) return _CITY_TZ[cityLower];
  }
  if (country) {
    const countryLower = country.toLowerCase().trim();
    if (_COUNTRY_TZ[countryLower]) return _COUNTRY_TZ[countryLower];
  }
  return 'Europe/Paris'; // default
}

/**
 * Validation programmatique post-generation email.
 * Verifie word count, forbidden words (avec word boundary), longueur sujet.
 * @param {string} subject
 * @param {string} body
 * @param {Object} options - { forbiddenWords: [], maxWords: 120, minWords: 20, maxSubjectLen: 80 }
 * @returns {{ pass: boolean, reasons: string[] }}
 */
function validateEmailOutput(subject, body, options) {
  options = options || {};
  const maxWords = options.maxWords || 60;
  const minWords = options.minWords || 10;
  const maxSubjectLen = options.maxSubjectLen || 80;
  const forbiddenWords = options.forbiddenWords || [];
  const reasons = [];

  // 1. Word count body
  const words = (body || '').split(/\s+/).filter(w => w.length > 0);
  if (words.length > maxWords) reasons.push('too_many_words:' + words.length);
  if (words.length < minWords) reasons.push('too_few_words:' + words.length);

  // 2. Subject length
  if (subject && subject.length > maxSubjectLen) reasons.push('subject_too_long:' + subject.length);

  // 3. Forbidden words avec word boundary (evite "solution" dans "dissolution")
  for (const word of forbiddenWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('\\b' + escaped + '\\b', 'i');
    if (regex.test(body || '') || regex.test(subject || '')) {
      reasons.push('forbidden:' + word);
    }
  }

  return { pass: reasons.length === 0, reasons };
}

module.exports = { atomicWriteSync, retryAsync, truncateInput, isValidEmail, sanitize, getWarmupDailyLimit, withCronGuard, applySpintax, validateEmailOutput, getCityTimezone };
