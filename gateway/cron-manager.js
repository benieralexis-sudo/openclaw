// iFIND - Cron Manager (demarrage/arret centralise des crons)
// Extrait de telegram-router.js — startAllCrons, stopAllCrons

const log = require('./logger.js');

/**
 * Cree un gestionnaire de crons.
 * @param {object} deps - dependances injectees
 * @param {object} deps.engines - { proactiveEngine, autoPilotEngine }
 * @param {object} deps.handlers - { selfImproveHandler, webIntelHandler, systemAdvisorHandler, automailerHandler, meetingHandler }
 * @param {object} deps.storages - { proactiveAgentStorage, selfImproveStorage, webIntelStorage, systemAdvisorStorage, autonomousPilotStorage }
 * @param {Function} deps.sendMessage - sendMessage(chatId, text, parseMode)
 * @param {Function} deps._getHubSpotClient - retourne un client HubSpot ou null
 * @param {string} deps.ADMIN_CHAT_ID
 * @returns {{ startAllCrons, stopAllCrons }}
 */
function createCronManager(deps) {
  const {
    engines,
    handlers,
    storages,
    sendMessage,
    _getHubSpotClient,
    ADMIN_CHAT_ID
  } = deps;

  let _emailPollingInterval = null;
  let _bookingSyncInterval = null;
  let _retryQueueInterval = null;
  let _archiveInterval = null;

  function startAllCrons() {
    // Activer les configs internes (chaque start() verifie config.enabled)
    try { storages.proactiveAgentStorage.updateConfig({ enabled: true }); } catch (e) { log.error('router', 'Erreur toggle cron proactive:', e.message); }
    try { storages.selfImproveStorage.updateConfig({ enabled: true }); } catch (e) { log.error('router', 'Erreur toggle cron self-improve:', e.message); }
    try { storages.webIntelStorage.updateConfig({ enabled: true }); } catch (e) { log.error('router', 'Erreur toggle cron web-intel:', e.message); }
    try { storages.systemAdvisorStorage.updateConfig({ enabled: true }); } catch (e) { log.error('router', 'Erreur toggle cron system-advisor:', e.message); }
    try { storages.autonomousPilotStorage.updateConfig({ enabled: true }); } catch (e) { log.error('router', 'Erreur toggle cron autonomous-pilot:', e.message); }

    engines.proactiveEngine.start();
    if (handlers.selfImproveHandler) handlers.selfImproveHandler.start();
    handlers.webIntelHandler.start();
    handlers.systemAdvisorHandler.start();
    engines.autoPilotEngine.start();

    // Polling statuts email Resend toutes les 30 min (backup du webhook)
    if (handlers.automailerHandler.campaignEngine) {
      // Demarrer le scheduler de campagne (verifie les steps toutes les 60s pendant heures bureau)
      handlers.automailerHandler.campaignEngine.start();
      _emailPollingInterval = setInterval(async () => {
        try {
          await handlers.automailerHandler.campaignEngine.checkEmailStatuses();
        } catch (e) { log.error('router', 'Erreur check email statuses:', e.message); }
      }, 30 * 60 * 1000);
      log.info('router', 'Polling statuts email toutes les 30 min');

      // Retry queue : retenter les emails failed toutes les 5 min
      _retryQueueInterval = setInterval(async () => {
        try {
          await handlers.automailerHandler.campaignEngine.processRetryQueue();
        } catch (e) { log.error('router', 'Erreur retry queue:', e.message); }
      }, 5 * 60 * 1000);
      log.info('router', 'Retry queue emails toutes les 5 min');

      // Archivage auto : deplacer emails > 90j toutes les 6h
      _archiveInterval = setInterval(() => {
        try {
          handlers.automailerHandler.campaignEngine.runArchive();
        } catch (e) { log.error('router', 'Erreur archivage auto:', e.message); }
      }, 6 * 60 * 60 * 1000);
      // Archivage initial au demarrage (apres 30s)
      setTimeout(() => {
        try { handlers.automailerHandler.campaignEngine.runArchive(); } catch (e) { log.warn('router', 'Archivage initial: ' + e.message); }
      }, 30000);
    }

    // Sync bookings Google Calendar toutes les 5 min
    if (handlers.meetingHandler.gcal && handlers.meetingHandler.gcal.isApiConfigured()) {
      _bookingSyncInterval = setInterval(async () => {
        try {
          await handlers.meetingHandler.syncBookings(sendMessage, _getHubSpotClient(), ADMIN_CHAT_ID);
        } catch (e) { log.error('router', 'Booking sync echoue:', e.message); }
      }, 5 * 60 * 1000);
      log.info('router', 'Sync bookings Google Calendar toutes les 5 min');
    }

    log.info('router', '21 crons demarres (production)');
  }

  function stopAllCrons() {
    engines.proactiveEngine.stop();
    if (handlers.selfImproveHandler) handlers.selfImproveHandler.stop();
    handlers.webIntelHandler.stop();
    handlers.systemAdvisorHandler.stop();
    engines.autoPilotEngine.stop();
    if (_emailPollingInterval) { clearInterval(_emailPollingInterval); _emailPollingInterval = null; }
    if (_bookingSyncInterval) { clearInterval(_bookingSyncInterval); _bookingSyncInterval = null; }
    if (_retryQueueInterval) { clearInterval(_retryQueueInterval); _retryQueueInterval = null; }
    if (_archiveInterval) { clearInterval(_archiveInterval); _archiveInterval = null; }

    // Desactiver les configs internes (double securite)
    try { storages.proactiveAgentStorage.updateConfig({ enabled: false }); } catch (e) { log.error('router', 'Erreur toggle cron proactive:', e.message); }
    try { storages.selfImproveStorage.updateConfig({ enabled: false }); } catch (e) { log.error('router', 'Erreur toggle cron self-improve:', e.message); }
    try { storages.webIntelStorage.updateConfig({ enabled: false }); } catch (e) { log.error('router', 'Erreur toggle cron web-intel:', e.message); }
    try { storages.systemAdvisorStorage.updateConfig({ enabled: false }); } catch (e) { log.error('router', 'Erreur toggle cron system-advisor:', e.message); }
    try { storages.autonomousPilotStorage.updateConfig({ enabled: false }); } catch (e) { log.error('router', 'Erreur toggle cron autonomous-pilot:', e.message); }
    log.info('router', 'Tous les crons stoppes (standby)');
  }

  // Exposer les intervals pour le graceful shutdown
  function getIntervals() {
    return { _emailPollingInterval, _bookingSyncInterval, _retryQueueInterval, _archiveInterval };
  }

  function clearAllIntervals() {
    if (_emailPollingInterval) { clearInterval(_emailPollingInterval); _emailPollingInterval = null; }
    if (_bookingSyncInterval) { clearInterval(_bookingSyncInterval); _bookingSyncInterval = null; }
    if (_retryQueueInterval) { clearInterval(_retryQueueInterval); _retryQueueInterval = null; }
    if (_archiveInterval) { clearInterval(_archiveInterval); _archiveInterval = null; }
  }

  return { startAllCrons, stopAllCrons, getIntervals, clearAllIntervals };
}

module.exports = { createCronManager };
