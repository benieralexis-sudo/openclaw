// MoltBot - Utilitaires partages (atomic write, retry, validation)
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
        const delay = baseDelay * Math.pow(2, attempt);
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

module.exports = { atomicWriteSync, retryAsync, truncateInput };
