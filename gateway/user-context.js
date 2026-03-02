// iFIND - User Context (rate limiting + conversation memory)
// Extrait de telegram-router.js — isRateLimited, addToHistory, getHistoryContext

const log = require('./logger.js');

/**
 * Cree un gestionnaire de contexte utilisateur.
 * @param {object} [state] - etat externe optionnel { conversationHistory, messageRates, bans }
 *   Si omis, utilise des objets internes.
 * @returns {{ isRateLimited, addToHistory, getHistoryContext, conversationHistory, messageRates, bans }}
 */
function createUserContext(state) {
  const conversationHistory = (state && state.conversationHistory) || {};
  const messageRates = (state && state.messageRates) || {};
  const _bans = (state && state.bans) || {};

  /**
   * Verifie si un utilisateur est rate-limited (10 msg/30s).
   * Ban progressif : 5min, 15min, 1h.
   * @param {string|number} chatId
   * @returns {boolean}
   */
  function isRateLimited(chatId) {
    const id = String(chatId);
    const now = Date.now();

    // Check ban actif
    if (_bans[id] && now < _bans[id].until) return true;

    if (!messageRates[id]) messageRates[id] = [];
    messageRates[id] = messageRates[id].filter(t => now - t < 30000);
    if (messageRates[id].length >= 10) {
      // Ban progressif : 5min, 15min, 1h
      const violations = (_bans[id] ? _bans[id].violations : 0) + 1;
      const banDurations = [5 * 60000, 15 * 60000, 60 * 60000]; // 5min, 15min, 1h
      const banMs = banDurations[Math.min(violations - 1, banDurations.length - 1)];
      _bans[id] = { until: now + banMs, violations: violations };
      log.warn('router', 'Ban user ' + id + ' pour ' + (banMs / 60000) + 'min (violation #' + violations + ')');
      return true;
    }
    messageRates[id].push(now);
    return false;
  }

  /**
   * Ajoute un message dans l'historique conversationnel (15 derniers par user).
   * @param {string|number} chatId
   * @param {string} role - 'user' ou 'bot'
   * @param {string} text
   * @param {string|null} skill
   */
  function addToHistory(chatId, role, text, skill) {
    const id = String(chatId);
    if (!conversationHistory[id]) conversationHistory[id] = [];
    conversationHistory[id].push({
      role: role,
      text: text.substring(0, 200),
      skill: skill || null,
      ts: Date.now()
    });
    // Garder les 15 derniers
    if (conversationHistory[id].length > 15) {
      conversationHistory[id] = conversationHistory[id].slice(-15);
    }
  }

  /**
   * Construit le contexte conversationnel pour la classification NLP.
   * @param {string|number} chatId
   * @returns {string}
   */
  function getHistoryContext(chatId) {
    const id = String(chatId);
    const history = conversationHistory[id] || [];
    if (history.length === 0) return '';

    return history.map(h => {
      const prefix = h.role === 'user' ? 'Utilisateur' : 'Bot';
      const skillTag = h.skill ? ' [' + h.skill + ']' : '';
      return prefix + skillTag + ': ' + h.text;
    }).join('\n');
  }

  return {
    isRateLimited,
    addToHistory,
    getHistoryContext,
    // Expose les objets internes pour que le routeur puisse les persister/nettoyer
    conversationHistory,
    messageRates,
    bans: _bans
  };
}

module.exports = { createUserContext };
