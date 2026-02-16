// iFIND - Utilitaires partages (atomic write, retry, validation)
const fs = require('fs');
const path = require('path');

/**
 * Ecriture atomique : ecrit dans un fichier temporaire puis renomme.
 * Previent la corruption si le process crash pendant l'ecriture.
 */
function atomicWriteSync(filePath, data) {
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpFile, filePath);
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

module.exports = { atomicWriteSync, retryAsync, truncateInput, isValidEmail, sanitize };
