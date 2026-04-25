// iFIND - Handler HTTP tracking email (pixel + click + CRM sync) — extrait de telegram-router.js
'use strict';

const log = require('./logger.js');

// 1x1 transparent GIF (43 bytes)
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Cree les handlers HTTP pour le tracking email.
 * @param {Object} deps - Dependencies injectees depuis telegram-router
 * @returns {{ handlePixel: Function, handleClick: Function }}
 */
function createEmailTracking(deps) {
  const {
    getAutomailerStorage, getProactiveAgentStorage, getFlowFastStorage, getLeadEnrichStorage,
    getProspectResearcher, claudeKey
  } = deps;

  /**
   * GET /t/:trackingId.gif — pixel ouverture email
   */
  function handlePixel(req, res) {
    if (req.method !== 'GET' || !req.url || !req.url.startsWith('/t/')) return false;

    const match = req.url.match(/^\/t\/([a-f0-9]{32})\.gif/);
    // Toujours servir le pixel
    res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': PIXEL.length, 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
    res.end(PIXEL);
    if (!match) return true;

    const trackingId = match[1];
    const automailerStorage = getAutomailerStorage();
    const proactiveAgentStorage = getProactiveAgentStorage();

    try {
      const email = automailerStorage.findEmailByTrackingId(trackingId);
      if (!email) return true;

      const wasAlreadyOpened = !!email.openedAt;
      if (!wasAlreadyOpened) {
        automailerStorage.updateEmailStatus(email.id, 'opened');
        log.info('tracking', 'Email ouvert (pixel) : ' + email.to + ' — ' + (email.subject || '').substring(0, 40));
        // 1ere ouverture : research + cache intel
        _handleFirstOpen(email, deps);
      } else {
        // 2eme+ ouverture → signal interet fort → reactive FU
        _handleReopen(email, automailerStorage, proactiveAgentStorage);
      }

      // FIX NICHE TRACKING: tracker l'open par niche (etait manquant — le brain etait aveugle)
      _trackNicheEvent(email, 'opened');

      // Tracker dans Proactive Agent (hot lead detection — toujours)
      _trackHotLead(email, trackingId, proactiveAgentStorage);

      // v2.0-cleanup : CRM sync HubSpot supprimé. Folk lundi.
    } catch (trackErr) {
      log.warn('tracking', 'Erreur tracking pixel: ' + trackErr.message);
    }
    return true;
  }

  /**
   * GET /c/:trackingId?url=X — click tracking redirect
   */
  function handleClick(req, res) {
    if (req.method !== 'GET' || !req.url || !req.url.startsWith('/c/')) return false;

    const clickMatch = req.url.match(/^\/c\/([a-f0-9]{32})/);
    const clickUrlObj = new URL(req.url, 'http://localhost');
    const redirectUrl = clickUrlObj.searchParams.get('url');
    if (!clickMatch || !redirectUrl || !/^https?:\/\//i.test(redirectUrl)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad request');
      return true;
    }

    const clickTrackingId = clickMatch[1];
    // Redirect immediately
    res.writeHead(302, { 'Location': redirectUrl, 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' });
    res.end();

    // Record click async
    const automailerStorage = getAutomailerStorage();
    try {
      const email = automailerStorage.findEmailByTrackingId(clickTrackingId);
      if (email) {
        automailerStorage.updateEmailStatus(email.id, 'clicked', { lastClickedUrl: redirectUrl });
        log.info('tracking', 'Click tracked: ' + email.to + ' -> ' + redirectUrl.substring(0, 80));
        _trackNicheEvent(email, 'clicked');
        // v2.0-cleanup : CRM sync HubSpot supprimé. Folk lundi.
      }
    } catch (e) {
      log.warn('tracking', 'Click tracking error: ' + e.message);
    }
    return true;
  }

  // --- Internal helpers ---

  function _handleFirstOpen(email, deps) {
    const ProspectResearcher = deps.getProspectResearcher();
    if (!ProspectResearcher) {
      log.info('tracking', 'Email ouvert (1ere fois) par ' + email.to + ' — ProspectResearcher non charge');
      return;
    }
    try {
      const researcher = new ProspectResearcher({ claudeKey: deps.claudeKey });
      let prospectTitle = '';
      try {
        const flowFastStorage = deps.getFlowFastStorage();
        if (flowFastStorage && flowFastStorage.data) {
          const ffLeads = flowFastStorage.data.leads || {};
          for (const lid of Object.keys(ffLeads)) {
            if (ffLeads[lid].email === email.to) {
              prospectTitle = ffLeads[lid].title || ffLeads[lid].titre || '';
              break;
            }
          }
        }
        if (!prospectTitle) {
          const leadEnrichStorage = deps.getLeadEnrichStorage();
          if (leadEnrichStorage) {
            const leData = leadEnrichStorage.data || {};
            const enriched = leData.enrichedContacts || [];
            const found = enriched.find(c => c.email === email.to);
            if (found) prospectTitle = found.title || found.titre || '';
          }
        }
      } catch (titleErr) { log.warn('tracking', 'Title lookup: ' + titleErr.message); }

      const contact = deps.enrichContactWithOrg(email.to, email.contactName || '', email.company || '', prospectTitle);
      Promise.race([
        researcher.researchProspect(contact),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout 30s')), 30000))
      ]).then(intel => {
        log.info('tracking', 'Email ouvert (1ere fois) par ' + email.to + ' — intel cache, notification silencieuse');
        if (intel && intel.brief) {
          try {
            const proactiveAgentStorage = deps.getProactiveAgentStorage();
            proactiveAgentStorage.data._cachedIntel = proactiveAgentStorage.data._cachedIntel || {};
            proactiveAgentStorage.data._cachedIntel[email.to] = { brief: intel.brief.substring(0, 3500), cachedAt: new Date().toISOString() };
            const cKeys = Object.keys(proactiveAgentStorage.data._cachedIntel);
            if (cKeys.length > 100) { for (let ck = 0; ck < cKeys.length - 100; ck++) delete proactiveAgentStorage.data._cachedIntel[cKeys[ck]]; }
            proactiveAgentStorage._save();
          } catch (cacheErr) { log.warn('tracking', 'Cache intel save: ' + cacheErr.message); }
        }
      }).catch(() => {
        log.info('tracking', 'Email ouvert (1ere fois) par ' + email.to + ' — research timeout, pas de cache');
      });
    } catch (e) {
      log.info('tracking', 'Email ouvert (1ere fois) par ' + email.to + ' — researcher non dispo');
    }
  }

  function _handleReopen(email, automailerStorage, proactiveAgentStorage) {
    log.info('tracking', 'Rouverture pixel detectee pour ' + email.to + ' — programmation reactive FU');
    let pixelCachedIntel = '';
    try {
      const pCache = (proactiveAgentStorage.data._cachedIntel || {})[email.to];
      if (pCache && pCache.brief) pixelCachedIntel = pCache.brief;
    } catch (pce) { log.warn('tracking', 'Cache intel read: ' + pce.message); }
    try {
      const rfConfig = proactiveAgentStorage.getReactiveFollowUpConfig();
      if (rfConfig.enabled) {
        if (automailerStorage.isBlacklisted(email.to)) {
          log.info('tracking', 'Skip reactive FU (reouvre pixel) pour ' + email.to + ' — blackliste');
        } else if (automailerStorage.getEmailEventsForRecipient(email.to).some(e => e.status === 'replied' || e.hasReplied)) {
          log.info('tracking', 'Skip reactive FU (reouvre pixel) pour ' + email.to + ' — deja repondu (human takeover)');
        } else {
          const delayMs = (rfConfig.minDelayMinutes + Math.random() * (rfConfig.maxDelayMinutes - rfConfig.minDelayMinutes)) * 60 * 1000;
          const scheduledAfter = new Date(Date.now() + delayMs).toISOString();
          const added = proactiveAgentStorage.addPendingFollowUp({
            prospectEmail: email.to,
            prospectName: email.contactName || '',
            prospectCompany: email.company || '',
            originalEmailId: email.id,
            originalSubject: email.subject || '',
            originalBody: (email.body || '').substring(0, 500),
            prospectIntel: pixelCachedIntel,
            scheduledAfter: scheduledAfter
          });
          if (added) {
            log.info('tracking', 'Reactive FU programme (reouvre pixel) pour ' + email.to + ' — id: ' + added.id);
          } else {
            log.info('tracking', 'Reactive FU deja programme pour ' + email.to + ' (dedup)');
          }
        }
      }
    } catch (rfErr) { log.warn('tracking', 'Reactive FU reopen: ' + rfErr.message); }
  }

  function _trackHotLead(email, trackingId, proactiveAgentStorage) {
    try {
      const tracked = proactiveAgentStorage.trackEmailOpen(email.to, email.trackingId || trackingId);
      const paConfig = proactiveAgentStorage.getConfig();
      if (tracked.opens >= (paConfig.thresholds || {}).hotLeadOpens && !proactiveAgentStorage.isHotLeadNotified(email.to)) {
        log.info('tracking', 'Hot lead detecte via pixel: ' + email.to + ' (' + tracked.opens + ' opens) — notification via smart alerts');
        proactiveAgentStorage.markHotLeadNotified(email.to);
      }
    } catch (paErr) { log.warn('tracking', 'Proactive tracking: ' + paErr.message); }
  }

  function _trackNicheEvent(email, eventType) {
    try {
      const apStorage = require('../skills/autonomous-pilot/storage.js');
      const leadNiche = email.industry || email.niche || null;
      if (!leadNiche) {
        const automailerSt = require('../skills/automailer/storage.js');
        const allEmails = automailerSt.getEmails ? automailerSt.getEmails() : [];
        const matched = allEmails.find(em => (em.to || '').toLowerCase() === (email.to || '').toLowerCase());
        if (matched) {
          const niche = matched.niche || matched.industry || null;
          if (niche) { apStorage.trackNicheEvent(niche, eventType); return; }
        }
        return;
      }
      apStorage.trackNicheEvent(leadNiche, eventType);
      log.info('tracking', 'Niche tracking: ' + eventType + ' [' + leadNiche + '] pour ' + email.to);
    } catch (ntErr) { log.warn('tracking', 'Niche tracking: ' + ntErr.message); }
  }

  // v2.0-cleanup : sync CRM HubSpot supprimé. Folk CRM remplacera lundi
  // (skills/trigger-engine/folk-client.js à coder avec FOLK_API_KEY).

  return { handlePixel, handleClick };
}

module.exports = { createEmailTracking };
