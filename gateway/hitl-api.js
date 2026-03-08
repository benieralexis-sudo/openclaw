// iFIND - HITL API REST endpoints (draft approval via dashboard) — extrait de telegram-router.js
'use strict';

const log = require('./logger.js');

/**
 * Cree le handler HTTP pour les endpoints /api/hitl/*.
 * @param {Object} deps - Dependencies injectees
 * @returns {Function} (req, res) => boolean
 */
function createHitlApi(deps) {
  const {
    getPendingDrafts, saveHitlDrafts,
    getAutomailerStorage, getResendClient,
    adminChatId, getHitlAutoSendDelays
  } = deps;

  function _authCheck(req) {
    const token = (req.headers['x-api-token'] || req.headers['authorization'] || '').replace('Bearer ', '');
    return token && (token === process.env.DASHBOARD_PASSWORD || token === process.env.AUTOMAILER_DASHBOARD_PASSWORD);
  }

  return function handleHitlApi(req, res) {
    // GET /api/hitl/drafts — list all pending drafts
    if (req.url === '/api/hitl/drafts' && req.method === 'GET') {
      if (!_authCheck(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return true;
      }
      const _pendingDrafts = getPendingDrafts();
      const { grounded: HITL_AUTOSEND_GROUNDED, ungrounded: HITL_AUTOSEND_UNGROUNDED } = getHitlAutoSendDelays();
      const drafts = [];
      const now = Date.now();
      const TTL = 24 * 60 * 60 * 1000;
      for (const [id, d] of _pendingDrafts) {
        const age = now - (d.createdAt || 0);
        if (age < TTL) {
          drafts.push({
            id,
            prospectEmail: d.replyData?.from || '',
            prospectName: d.replyData?.fromName || '',
            incomingSubject: d.replyData?.subject || '',
            incomingSnippet: d.replyData?.snippet || '',
            subject: d.autoReply?.subject || '',
            body: d.autoReply?.body || '',
            sentiment: d.sentiment || d.classification?.sentiment || '',
            subType: d.subClass?.type || '',
            objectionType: d.subClass?.objectionType || '',
            confidence: d.autoReply?.confidence || 0,
            qualityWarning: d.qualityWarning || null,
            company: d.originalEmail?.company || '',
            grounded: d._grounded !== false,
            autoSendAt: d.createdAt ? new Date(d.createdAt + ((d._grounded !== false) ? HITL_AUTOSEND_GROUNDED : HITL_AUTOSEND_UNGROUNDED)).toISOString() : null,
            createdAt: d.createdAt || 0,
            expiresIn: Math.max(0, TTL - age)
          });
        }
      }
      drafts.sort((a, b) => b.createdAt - a.createdAt);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(drafts));
      return true;
    }

    // POST /api/hitl/drafts/:id/approve
    if (req.url && req.url.match(/^\/api\/hitl\/drafts\/[^/]+\/approve$/) && req.method === 'POST') {
      const draftId = req.url.split('/')[4];
      _handleApproveOrEdit(draftId, null, res);
      return true;
    }

    // POST /api/hitl/drafts/:id/skip
    if (req.url && req.url.match(/^\/api\/hitl\/drafts\/[^/]+\/skip$/) && req.method === 'POST') {
      const draftId = req.url.split('/')[4];
      const _pendingDrafts = getPendingDrafts();
      const draft = _pendingDrafts.get(draftId);
      if (!draft) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Draft introuvable ou expiré' }));
        return true;
      }
      _pendingDrafts.delete(draftId);
      log.info('hitl', 'Draft passe (dashboard, sans blacklist): ' + draftId + ' pour ' + draft.replyData.from);
      saveHitlDrafts();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, prospect: draft.replyData.from, action: 'skipped' }));
      return true;
    }

    // POST /api/hitl/drafts/:id/reject
    if (req.url && req.url.match(/^\/api\/hitl\/drafts\/[^/]+\/reject$/) && req.method === 'POST') {
      const draftId = req.url.split('/')[4];
      const _pendingDrafts = getPendingDrafts();
      const draft = _pendingDrafts.get(draftId);
      if (!draft) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Draft introuvable ou expiré' }));
        return true;
      }
      if (draft._inFlight) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Draft en cours de traitement' }));
        return true;
      }
      draft._inFlight = true;
      _pendingDrafts.delete(draftId);
      const automailerStorage = getAutomailerStorage();
      try {
        for (const ep of (draft.emailsToProcess || [draft.replyData.from])) {
          automailerStorage.addToBlacklist(ep, 'hitl_blacklisted: dashboard');
        }
      } catch (e) { log.error('hitl', 'Blacklist echoue pour ' + draft.replyData.from + ': ' + e.message); }
      log.info('hitl', 'Draft rejete+blackliste (dashboard): ' + draftId + ' pour ' + draft.replyData.from);
      saveHitlDrafts();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, prospect: draft.replyData.from, action: 'blacklisted' }));
      return true;
    }

    // POST /api/hitl/drafts/:id/edit
    if (req.url && req.url.match(/^\/api\/hitl\/drafts\/[^/]+\/edit$/) && req.method === 'POST') {
      const draftId = req.url.split('/')[4];
      let body = '';
      req.on('data', (chunk) => { if (body.length < 10240) body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.body || typeof data.body !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'body requis' }));
            return;
          }
          _handleApproveOrEdit(draftId, data.body.trim(), res);
        } catch (e) {
          log.error('hitl', 'Erreur edit dashboard:', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    return false;
  };

  // Shared approve/edit logic
  async function _handleApproveOrEdit(draftId, editedBody, res) {
    const _pendingDrafts = getPendingDrafts();
    const automailerStorage = getAutomailerStorage();
    try {
      const draft = _pendingDrafts.get(draftId);
      if (!draft) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Draft introuvable ou expiré' }));
        return;
      }
      if (draft._inFlight) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Draft en cours de traitement' }));
        return;
      }
      draft._inFlight = true;

      // Apply edit if provided
      if (editedBody) {
        const qWarnings = [];
        if (editedBody.length < 20) qWarnings.push('Message trop court (<20 caractères)');
        const cDomain = (process.env.CLIENT_DOMAIN || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const safeDomainRe = new RegExp('https?:\\/\\/(?:' + (cDomain || 'x-no-match') + '|calendly\\.com|cal\\.com)', 'i');
        if (/https?:\/\/[^\s]+/i.test(editedBody) && !safeDomainRe.test(editedBody)) qWarnings.push('Lien externe suspect');
        const spamWords = ['gratuit', 'promotion', 'cliquez ici', 'offre exclusive', 'urgent', 'act now', 'free trial'];
        const bodyLow = editedBody.toLowerCase();
        for (const sw of spamWords) { if (bodyLow.includes(sw)) { qWarnings.push('Mot spam: ' + sw); break; } }
        if (qWarnings.length > 0) log.warn('hitl', 'Quality warnings on dashboard edit ' + draftId + ': ' + qWarnings.join(', '));
        draft.autoReply.body = editedBody;
      }

      const resendClient = getResendClient();
      const sendResult = await resendClient.sendEmail(
        draft.replyData.from, draft.autoReply.subject, draft.autoReply.body,
        { inReplyTo: draft.originalMessageId, references: draft.originalMessageId, fromName: draft.clientContext?.senderName }
      );
      if (sendResult && sendResult.success) {
        if (automailerStorage.setFirstSendDate) automailerStorage.setFirstSendDate();
        automailerStorage.incrementTodaySendCount();
        try {
          const inboxStorage = require('../skills/inbox-manager/storage.js');
          inboxStorage.addAutoReply({ prospectEmail: draft.replyData.from, prospectName: draft.replyData.fromName, sentiment: draft.sentiment, subClassification: draft.subClass ? draft.subClass.type : 'hitl', objectionType: draft.subClass ? draft.subClass.objectionType : '', replyBody: draft.autoReply.body, replySubject: draft.autoReply.subject, originalEmailId: draft.originalEmail && draft.originalEmail.subject, confidence: draft.autoReply.confidence, sendResult });
        } catch (e) { log.warn('hitl', 'addAutoReply tracking echoue: ' + e.message); }
        if (sendResult.messageId) {
          const source = editedBody ? 'hitl_reply_edited' : 'hitl_reply';
          automailerStorage.addEmail({ to: draft.replyData.from, subject: draft.autoReply.subject, body: draft.autoReply.body, source, status: 'sent', messageId: sendResult.messageId, chatId: adminChatId });
        }
        const label = editedBody ? 'editee' : '';
        log.info('hitl', 'Reponse HITL ' + label + ' (dashboard) envoyee a ' + draft.replyData.from);
        _pendingDrafts.delete(draftId);
        saveHitlDrafts();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, to: draft.replyData.from }));
      } else {
        draft._inFlight = false;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Échec envoi: ' + (sendResult?.error || 'inconnu') }));
      }
    } catch (e) {
      log.error('hitl', 'Erreur approve/edit dashboard:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  }
}

module.exports = { createHitlApi };
