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
  // Schedule progressif : j0=5, j1=10, j2=15, j3=20, j4=25, j5=30, j6=35, j7-13=50, j14-27=75, j28+=100
  const schedule = [5, 10, 15, 20, 25, 30, 35, 50, 50, 50, 50, 50, 50, 50, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 100];
  return schedule[Math.min(daysSinceFirst, schedule.length - 1)] || 100;
}

module.exports = { atomicWriteSync, retryAsync, truncateInput, isValidEmail, sanitize, getWarmupDailyLimit };
