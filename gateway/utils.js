// iFIND - Utilitaires partages (atomic write, retry, validation)
const fs = require('fs');
const path = require('path');

/**
 * Ecriture atomique avec write lock par fichier + queue.
 * - Ecrit dans un fichier temporaire puis renomme (anti-corruption crash).
 * - Un seul write a la fois par fichier (anti-race condition async).
 * - Queue FIFO : si plusieurs writes arrivent pendant un lock, tous sont executes dans l'ordre.
 *   (ancien code = debounce, seul le dernier gagnait → perte de writes intermediaires)
 */
const _writeLocks = {};    // filePath → true si ecriture en cours
const _writeQueue = {};    // filePath → [data, data, ...] queue FIFO

function atomicWriteSync(filePath, data) {
  // Si un write est en cours, ajouter a la queue au lieu d'ecraser
  if (_writeLocks[filePath]) {
    if (!_writeQueue[filePath]) _writeQueue[filePath] = [];
    // Limite queue a 100 writes max — au-dela, on garde seulement le dernier (latest-wins)
    if (_writeQueue[filePath].length >= 100) {
      log.warn('utils', 'atomicWriteSync queue overflow pour ' + filePath + ' — drop ancien, garde dernier');
      _writeQueue[filePath] = [data]; // Reset avec seulement le dernier write
    } else {
      _writeQueue[filePath].push(data);
    }
    return;
  }

  _writeLocks[filePath] = true;
  _doWrite(filePath, data);
  // Traiter la queue (writes arrives pendant l'ecriture)
  while (_writeQueue[filePath] && _writeQueue[filePath].length > 0) {
    const nextData = _writeQueue[filePath].shift();
    _doWrite(filePath, nextData);
  }
  _writeLocks[filePath] = false;
}

function _doWrite(filePath, data) {
  try {
    const tmpFile = filePath + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, filePath);
  } catch (writeErr) {
    const errMsg = writeErr.message || '';
    const log = require('./logger.js');
    log.error('storage', 'atomicWriteSync FAILED: ' + filePath + ' — ' + errMsg);
    if (errMsg.includes('ENOSPC') && !_doWrite._diskAlertSent) {
      _doWrite._diskAlertSent = true;
      log.error('storage', 'DISQUE PLEIN — ecriture impossible: ' + filePath);
      // Tenter notification Telegram d'urgence
      try {
        // Phase B6 — admin chat ID via dedicated resolver
        const { getAdminChatId } = require('./admin-resolver.js');
        const chatId = getAdminChatId();
        const https = require('https');
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
          const msg = encodeURIComponent('🔴 DISQUE PLEIN — le bot ne peut plus ecrire. Fichier: ' + filePath);
          https.get('https://api.telegram.org/bot' + token + '/sendMessage?chat_id=' + chatId + '&text=' + msg);
        }
      } catch (e) { /* best-effort */ }
    }
    throw writeErr;
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
  // Eastern Europe
  chisinau: 'Europe/Chisinau', 'chișinău': 'Europe/Chisinau', 'chişinău': 'Europe/Chisinau',
  bucharest: 'Europe/Bucharest', bucuresti: 'Europe/Bucharest', 'bucurești': 'Europe/Bucharest',
  warsaw: 'Europe/Warsaw', budapest: 'Europe/Budapest', prague: 'Europe/Prague',
  sofia: 'Europe/Sofia', kyiv: 'Europe/Kyiv', belgrade: 'Europe/Belgrade',
  zagreb: 'Europe/Zagreb', athens: 'Europe/Athens', istanbul: 'Europe/Istanbul',
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
  israel: 'Asia/Jerusalem', il: 'Asia/Jerusalem',
  moldova: 'Europe/Chisinau', md: 'Europe/Chisinau',
  romania: 'Europe/Bucharest', ro: 'Europe/Bucharest',
  poland: 'Europe/Warsaw', pl: 'Europe/Warsaw',
  hungary: 'Europe/Budapest', hu: 'Europe/Budapest',
  'czech republic': 'Europe/Prague', cz: 'Europe/Prague', czechia: 'Europe/Prague',
  bulgaria: 'Europe/Sofia', bg: 'Europe/Sofia',
  ukraine: 'Europe/Kyiv', ua: 'Europe/Kyiv',
  serbia: 'Europe/Belgrade', rs: 'Europe/Belgrade',
  croatia: 'Europe/Zagreb', hr: 'Europe/Zagreb',
  greece: 'Europe/Athens', gr: 'Europe/Athens',
  turkey: 'Europe/Istanbul', tr: 'Europe/Istanbul'
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
  const maxWords = options.maxWords || 100;
  const minWords = options.minWords || 30;
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

/**
 * Timeout wrapper pour promises API.
 * Race entre la promise originale et un timer — evite les appels qui restent bloques indefiniment.
 * @param {Promise} promise - La promise a wrapper
 * @param {number} ms - Timeout en millisecondes
 * @param {string} label - Label pour le message d'erreur
 * @returns {Promise} Resultat de la promise ou rejet timeout
 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timeout (' + ms + 'ms)')), ms))
  ]);
}

/**
 * Compteur d'envois quotidien partage entre tous les processus.
 * Fichier atomique /data/automailer/daily-send-count.json
 * Tous les chemins d'envoi (campaign-engine, proactive, brain) DOIVENT l'utiliser.
 */
function getDailySendCount() {
  try {
    const file = (process.env.AUTOMAILER_DATA_DIR || '/data/automailer') + '/daily-send-count.json';
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    if (data.date === today) return data.count || 0;
    return 0; // New day, reset
  } catch (e) { return 0; }
}

function incrementDailySendCount() {
  const file = (process.env.AUTOMAILER_DATA_DIR || '/data/automailer') + '/daily-send-count.json';
  const today = new Date().toISOString().slice(0, 10);
  let data = { date: today, count: 0 };
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.date !== today) data = { date: today, count: 0 };
  } catch (e) { /* new file */ }
  data.count++;
  atomicWriteSync(file, data);
  return data.count;
}

module.exports = { atomicWriteSync, retryAsync, truncateInput, isValidEmail, sanitize, getWarmupDailyLimit, withCronGuard, applySpintax, validateEmailOutput, getCityTimezone, withTimeout, getDailySendCount, incrementDailySendCount };
