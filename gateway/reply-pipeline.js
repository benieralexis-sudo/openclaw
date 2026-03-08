// iFIND - Reply Pipeline : traitement des reponses prospect (HITL, auto-reply, CRM sync)
// Extrait de telegram-router.js (~690 lignes)
'use strict';

const log = require('./logger.js');
const {
  classifyReply, subClassifyObjection,
  generateObjectionReply, generateQuestionReplyViaClaude,
  generateInterestedReplyViaClaude, parseOOOReturnDate, checkGrounding
} = require('../skills/inbox-manager/reply-classifier.js');

/**
 * Cree le handler onReplyDetected pour InboxListener.
 * @param {Object} deps - Dependencies injectees depuis telegram-router
 * @returns {Function} async (replyData) => void
 */
function createReplyPipeline(deps) {
  const {
    openaiKey, callClaude, escTg,
    automailerStorage, getHubSpotClient,
    sendMessage, sendMessageWithButtons, adminChatId,
    meetingHandler,
    getPendingDrafts, hitlId, saveHitlDrafts,
    resendKey, senderEmail
  } = deps;

  return async function onReplyDetected(replyData) {
    const firstName = (replyData.fromName || '').trim().split(' ')[0] || '';
    const replySubject = (replyData.subject || '').startsWith('Re:')
      ? replyData.subject : 'Re: ' + (replyData.subject || 'notre echange');

    // Determiner l'email original (celui auquel on a envoye)
    const originalEmail_addr = (replyData.matchedLead && replyData.matchedLead.email)
      ? replyData.matchedLead.email.toLowerCase()
      : replyData.from.toLowerCase();
    const replyFrom = replyData.from.toLowerCase();
    const emailsToProcess = [originalEmail_addr];
    if (replyFrom !== originalEmail_addr) {
      emailsToProcess.push(replyFrom);
      log.info('inbox-manager', 'Fuzzy match detecte: reply de ' + replyFrom + ' → email original ' + originalEmail_addr);
    }

    // === 1. Marquer comme replied dans automailer ===
    try {
      const emails = (automailerStorage.data.emails || [])
        .filter(e => e.to && emailsToProcess.includes(e.to.toLowerCase()) && e.status !== 'replied');
      for (const em of emails) {
        automailerStorage.markAsReplied(em.id);
        log.info('inbox-manager', 'Email ' + em.id + ' marque replied (reponse de ' + replyData.from + ')');
      }
    } catch (e) {
      log.warn('inbox-manager', 'markAsReplied echoue:', e.message);
    }

    // === 2. Classification IA du sentiment ===
    let classification = { sentiment: 'question', score: 0.5, reason: 'Non classifie', key_phrases: [] };
    try {
      classification = await classifyReply(openaiKey, {
        from: replyData.from,
        fromName: replyData.fromName,
        subject: replyData.subject,
        snippet: replyData.snippet || ''
      });
    } catch (e) {
      log.error('inbox-manager', 'Classification echouee pour ' + replyData.from + ':', e.message);
    }
    const sentiment = classification.sentiment;
    const score = classification.score;
    log.info('inbox-manager', 'Sentiment: ' + sentiment + ' (score=' + score + ') pour ' + replyData.from);

    // === 3. Update CRM HubSpot avec sentiment ===
    _syncCrmSentiment(replyData, classification, emailsToProcess, getHubSpotClient);

    // === 3a-bis. FEEDBACK LOOP ===
    _trackFeedbackLoop(replyData, sentiment);

    // === 3b. HITL AUTO-REPLY : generer draft, soumettre pour validation humaine ===
    let autoReplyHandled = false;
    let hitlDraftCreated = false;
    const autoReplyEnabled = process.env.AUTO_REPLY_ENABLED !== 'false';
    const autoReplyConfidence = parseFloat(process.env.AUTO_REPLY_CONFIDENCE) || 0.8;
    const autoReplyMaxPerDay = parseInt(process.env.AUTO_REPLY_MAX_PER_DAY) || 10;

    if (autoReplyEnabled && sentiment !== 'bounce') {
      try {
        const inboxStorage = require('../skills/inbox-manager/storage.js');
        const todayCount = inboxStorage.getTodayAutoReplyCount();

        if (todayCount < autoReplyMaxPerDay) {
          // Recuperer l'email original envoye a ce prospect
          let originalEmail = null;
          let originalMessageId = null;
          try {
            let existingEmails = [];
            for (const ep of emailsToProcess) {
              existingEmails = existingEmails.concat(automailerStorage.getEmailEventsForRecipient(ep));
            }
            const lastSent = existingEmails.filter(e => e.status === 'sent' || e.status === 'delivered' || e.status === 'opened').pop();
            if (lastSent) {
              originalEmail = { subject: lastSent.subject, body: lastSent.body, company: lastSent.company };
              originalMessageId = lastSent.messageId || automailerStorage.getMessageIdForRecipient(lastSent.to);
            }
          } catch (e) { log.warn('inbox-manager', 'Recuperation email original echouee:', e.message); }

          // Contexte client pour la generation
          const clientContext = {
            senderName: process.env.SENDER_NAME || 'Alexis',
            senderTitle: process.env.SENDER_TITLE || '',
            clientDomain: process.env.CLIENT_DOMAIN || 'ifind.fr',
            bookingUrl: ''
          };
          try {
            if (meetingHandler && meetingHandler.gcal && meetingHandler.gcal.isConfigured()) {
              clientContext.bookingUrl = await meetingHandler.gcal.getBookingLink(null, replyData.from, replyData.fromName);
            }
          } catch (e) { log.warn('inbox-manager', 'Booking URL echouee:', e.message); }

          const _pendingDrafts = getPendingDrafts();

          // --- Cas 1: Objection douce (not_interested) → HITL ---
          if (sentiment === 'not_interested' && score >= 0.15) {
            const result = await _handleNotInterested(replyData, classification, originalEmail, originalMessageId, clientContext, emailsToProcess, autoReplyConfidence, _pendingDrafts);
            hitlDraftCreated = result.hitlDraftCreated;
          }
          // --- Cas 2: Question → HITL ---
          else if (sentiment === 'question' && score >= 0.4) {
            const result = await _handleQuestion(replyData, classification, originalEmail, originalMessageId, clientContext, emailsToProcess, autoReplyConfidence, _pendingDrafts);
            hitlDraftCreated = result.hitlDraftCreated;
          }
          // --- Cas 3: Interested → AUTO-REPLY ou HITL ---
          else if (sentiment === 'interested') {
            const result = await _handleInterested(replyData, classification, score, originalEmail, originalMessageId, clientContext, emailsToProcess, autoReplyConfidence, firstName, _pendingDrafts);
            hitlDraftCreated = result.hitlDraftCreated;
            autoReplyHandled = result.autoReplyHandled;
          }
          // --- Cas 4: OOO ---
          else if (sentiment === 'out_of_office') {
            autoReplyHandled = await _handleOOO(replyData, firstName, originalEmail, emailsToProcess);
          }
        } else {
          log.info('inbox-manager', 'Auto-reply limite atteinte (' + todayCount + '/' + autoReplyMaxPerDay + ') — fallback human takeover');
        }
      } catch (autoReplyErr) {
        log.warn('inbox-manager', 'Auto-reply pipeline echoue:', autoReplyErr.message);
      }
    }

    // === 4. HUMAN TAKEOVER / HITL PENDING ===
    let actionTaken = _determineAction(sentiment, autoReplyHandled, hitlDraftCreated, emailsToProcess, replyData);

    // HITL pending : stopper les relances auto
    if (hitlDraftCreated) {
      _stopRelancesForHitl(emailsToProcess);
    }

    // === 5. Update storage ===
    _updateStorages(emailsToProcess, sentiment, score, classification, actionTaken);

    // === 6. Notification Telegram enrichie ===
    await _sendTelegramNotification(replyData, classification, sentiment, score, emailsToProcess, actionTaken, autoReplyHandled, hitlDraftCreated);
  };

  // ========== Internal helpers ==========

  function _checkDraftQuality(autoReply) {
    let warning = null;
    try {
      const apStorageQG = require('../skills/autonomous-pilot/storage.js');
      const apConfigQG = apStorageQG.getConfig ? apStorageQG.getConfig() : {};
      const epQG = apConfigQG.emailPreferences || {};
      if (epQG.forbiddenWords && epQG.forbiddenWords.length > 0) {
        const arText = (autoReply.subject + ' ' + autoReply.body).toLowerCase();
        const found = epQG.forbiddenWords.filter(w => {
          const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp('\\b' + escaped + '\\b', 'i').test(arText);
        });
        if (found.length > 0) warning = 'mots interdits: ' + found.join(', ');
      }
    } catch (e) { log.warn('hitl', 'Forbidden words check: ' + e.message); }
    if (!warning) {
      try {
        const CE = require('../skills/automailer/campaign-engine.js');
        if (CE.emailPassesQualityGate) {
          const qg = CE.emailPassesQualityGate(autoReply.subject, autoReply.body);
          if (!qg.pass) warning = 'quality gate: ' + qg.reason;
        }
      } catch (e) { log.warn('hitl', 'Quality gate check: ' + e.message); }
    }
    if (!warning) {
      const wc = (autoReply.body || '').split(/\s+/).filter(w => w.length > 0).length;
      if (wc > 80 || wc < 8) warning = 'word count: ' + wc + ' (8-80 attendu)';
    }
    return warning;
  }

  async function _handleNotInterested(replyData, classification, originalEmail, originalMessageId, clientContext, emailsToProcess, autoReplyConfidence, _pendingDrafts) {
    const subClass = await subClassifyObjection(openaiKey, replyData, classification);
    log.info('inbox-manager', 'Sub-classification: ' + subClass.type + ' / ' + subClass.objectionType + ' (conf=' + subClass.confidence + ')');

    if (subClass.type === 'soft_objection' && subClass.confidence >= autoReplyConfidence) {
      const autoReply = await generateObjectionReply(callClaude, replyData, classification, subClass, originalEmail, clientContext);

      if (autoReply.body && autoReply.confidence >= autoReplyConfidence) {
        const qualityWarning = _checkDraftQuality(autoReply);
        if (qualityWarning) log.warn('hitl', 'Draft quality warning: ' + qualityWarning + ' pour ' + replyData.from);

        const draftId = hitlId();
        _pendingDrafts.set(draftId, {
          replyData, classification, subClass, autoReply, originalEmail,
          originalMessageId, clientContext, sentiment: 'not_interested', emailsToProcess,
          qualityWarning, createdAt: Date.now()
        });
        saveHitlDrafts();
        log.info('hitl', 'Draft HITL cree: ' + draftId + ' pour ' + replyData.from + ' (not_interested/' + subClass.objectionType + ')');
        return { hitlDraftCreated: true };
      }
    }
    return { hitlDraftCreated: false };
  }

  async function _handleQuestion(replyData, classification, originalEmail, originalMessageId, clientContext, emailsToProcess, autoReplyConfidence, _pendingDrafts) {
    const snippetLen = (replyData.snippet || '').length;
    if (snippetLen < 1500) {
      const autoReply = await generateQuestionReplyViaClaude(callClaude, replyData, classification, originalEmail, clientContext);

      if (autoReply.body && autoReply.confidence >= autoReplyConfidence) {
        const qualityWarning = _checkDraftQuality(autoReply);
        if (qualityWarning) log.warn('hitl', 'Draft quality warning: ' + qualityWarning + ' pour ' + replyData.from);

        const grounding = checkGrounding(autoReply.body);
        const isGrounded = grounding.grounded && !qualityWarning;

        const draftId = hitlId();
        _pendingDrafts.set(draftId, {
          replyData, classification, subClass: { type: 'simple_question', objectionType: '' },
          autoReply, originalEmail, originalMessageId, clientContext,
          sentiment: 'question', emailsToProcess, qualityWarning, createdAt: Date.now(),
          _grounded: isGrounded
        });
        saveHitlDrafts();
        const autoMin = isGrounded ? (parseFloat(process.env.HITL_AUTO_SEND_MINUTES) || 5) : 'HITL 24h';
        log.info('hitl', 'Draft cree: ' + draftId + ' pour ' + replyData.from + ' (question, grounded=' + isGrounded + ', auto-send=' + autoMin + (isGrounded ? 'min' : '') + ')');
        return { hitlDraftCreated: true };
      }
    }
    return { hitlDraftCreated: false };
  }

  async function _handleInterested(replyData, classification, score, originalEmail, originalMessageId, clientContext, emailsToProcess, autoReplyConfidence, firstName, _pendingDrafts) {
    // Check blacklist avant tout envoi
    const _isBlacklisted = automailerStorage.isBlacklisted && automailerStorage.isBlacklisted(replyData.from);
    if (_isBlacklisted) {
      log.info('hitl', 'Skip auto-reply: ' + replyData.from + ' est blackliste');
      return { hitlDraftCreated: false, autoReplyHandled: false };
    }
    const autoReply = await generateInterestedReplyViaClaude(callClaude, replyData, classification, originalEmail, clientContext);

    if (!autoReply.body) return { hitlDraftCreated: false, autoReplyHandled: false };

    const qualityWarning = _checkDraftQuality(autoReply);
    if (qualityWarning) log.warn('hitl', 'Draft quality warning: ' + qualityWarning + ' pour ' + replyData.from);

    const autoSendThreshold = parseFloat(process.env.AUTO_REPLY_INTERESTED_THRESHOLD) || 0.85;

    // HIGH CONFIDENCE + pas de warning → FULL AUTO
    if (score >= autoSendThreshold && !qualityWarning && autoReply.confidence >= 0.85) {
      try {
        const ResendClient = require('../skills/automailer/resend-client.js');
        const resendClient = new ResendClient(resendKey, senderEmail);
        const sendResult = await resendClient.sendEmail(
          replyData.from, autoReply.subject, autoReply.body,
          { inReplyTo: originalMessageId, references: originalMessageId, fromName: clientContext.senderName }
        );

        if (sendResult && sendResult.success) {
          if (automailerStorage.setFirstSendDate) automailerStorage.setFirstSendDate();
          automailerStorage.incrementTodaySendCount();

          try {
            const inboxStorage = require('../skills/inbox-manager/storage.js');
            inboxStorage.addAutoReply({
              prospectEmail: replyData.from, prospectName: replyData.fromName,
              sentiment: 'interested', subClassification: 'auto_instant', objectionType: '',
              replyBody: autoReply.body, replySubject: autoReply.subject,
              originalEmailId: originalEmail && originalEmail.subject,
              confidence: autoReply.confidence, sendResult
            });
          } catch (e) { log.warn('auto-reply', 'Record stats: ' + e.message); }

          if (sendResult.messageId) {
            automailerStorage.addEmail({
              to: replyData.from, subject: autoReply.subject, body: autoReply.body,
              source: 'auto_reply_interested', status: 'sent',
              messageId: sendResult.messageId, chatId: adminChatId
            });
          }

          try {
            if (meetingHandler) {
              const company = (originalEmail && originalEmail.company) || '';
              await meetingHandler.proposeAutoMeeting(replyData.from, replyData.fromName || firstName, company);
            }
          } catch (mtgErr) { log.warn('auto-reply', 'Auto-meeting proposal: ' + mtgErr.message); }

          log.info('auto-reply', 'REPONSE AUTO INSTANTANEE envoyee a ' + replyData.from + ' (score=' + score + ', conf=' + autoReply.confidence + ')');
          return { hitlDraftCreated: false, autoReplyHandled: true };
        } else {
          log.error('auto-reply', 'Echec envoi auto pour ' + replyData.from + ': ' + (sendResult && sendResult.error));
          // Fallback HITL
          const draftId = hitlId();
          _pendingDrafts.set(draftId, {
            replyData, classification, subClass: { type: 'interested', objectionType: '' },
            autoReply, originalEmail, originalMessageId, clientContext,
            sentiment: 'interested', emailsToProcess, qualityWarning, createdAt: Date.now()
          });
          saveHitlDrafts();
          return { hitlDraftCreated: true, autoReplyHandled: false };
        }
      } catch (sendErr) {
        log.error('auto-reply', 'Erreur envoi auto:', sendErr.message);
        const draftId = hitlId();
        _pendingDrafts.set(draftId, {
          replyData, classification, subClass: { type: 'interested', objectionType: '' },
          autoReply, originalEmail, originalMessageId, clientContext,
          sentiment: 'interested', emailsToProcess, qualityWarning, createdAt: Date.now()
        });
        saveHitlDrafts();
        return { hitlDraftCreated: true, autoReplyHandled: false };
      }
    }

    // LOW CONFIDENCE ou quality warning → HITL avec grounding check
    const grounding = checkGrounding(autoReply.body);
    const isGrounded = grounding.grounded && !qualityWarning;

    const draftId = hitlId();
    _pendingDrafts.set(draftId, {
      replyData, classification, subClass: { type: 'interested', objectionType: '' },
      autoReply, originalEmail, originalMessageId, clientContext,
      sentiment: 'interested', emailsToProcess, qualityWarning, createdAt: Date.now(),
      _grounded: isGrounded
    });
    saveHitlDrafts();
    const autoMin = isGrounded ? (parseFloat(process.env.HITL_AUTO_SEND_MINUTES) || 5) : 'HITL 24h';
    log.info('hitl', 'Draft cree: ' + draftId + ' pour ' + replyData.from + ' (interested, grounded=' + isGrounded + ', auto-send=' + autoMin + (isGrounded ? 'min' : '') + ')');
    return { hitlDraftCreated: true, autoReplyHandled: false };
  }

  async function _handleOOO(replyData, firstName, originalEmail, emailsToProcess) {
    try {
      const inboxStorage = require('../skills/inbox-manager/storage.js');
      const returnDate = parseOOOReturnDate(replyData.snippet);
      let scheduledDate;
      if (returnDate) {
        const returnTs = new Date(returnDate).getTime();
        scheduledDate = new Date(returnTs + 7 * 24 * 60 * 60 * 1000).toISOString();
      } else {
        scheduledDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      }

      inboxStorage.addOOOReschedule({
        prospectEmail: replyData.from,
        prospectName: replyData.fromName || firstName,
        returnDate: returnDate,
        scheduledFollowUpAt: scheduledDate
      });

      try {
        const proactiveStorage = require('../skills/proactive-agent/storage.js');
        proactiveStorage.addPendingFollowUp({
          prospectEmail: replyData.from,
          prospectName: replyData.fromName || firstName,
          prospectCompany: (originalEmail && originalEmail.company) || '',
          originalSubject: (originalEmail && originalEmail.subject) || '',
          originalBody: (originalEmail && originalEmail.body || '').substring(0, 300),
          prospectIntel: 'OOO detecte. Retour prevu: ' + (returnDate || 'inconnu') + '. Reschedule automatique.',
          scheduledAfter: scheduledDate,
          isOOO: true
        });
      } catch (e) { log.warn('inbox-manager', 'Follow-up proactif OOO echoue:', e.message); }

      log.info('inbox-manager', 'OOO reschedule pour ' + replyData.from + ' → follow-up prevu le ' + scheduledDate.substring(0, 10));
      return true;
    } catch (e) {
      log.warn('inbox-manager', 'OOO reschedule echoue:', e.message);
      return false;
    }
  }

  function _determineAction(sentiment, autoReplyHandled, hitlDraftCreated, emailsToProcess, replyData) {
    let actionTaken;
    if (autoReplyHandled) actionTaken = 'auto_reply_' + sentiment;
    else if (hitlDraftCreated) actionTaken = 'hitl_pending_' + sentiment;
    else actionTaken = 'human_takeover';

    // Blacklister les bounces
    if (sentiment === 'bounce') {
      actionTaken = 'bounce_blacklist';
      try {
        for (const ep of emailsToProcess) {
          automailerStorage.addToBlacklist(ep, 'bounce_detected');
        }
      } catch (e) { log.warn('inbox', 'Bounce blacklist: ' + e.message); }
      log.info('inbox-manager', emailsToProcess.join(' + ') + ' blackliste (bounce)');
    }
    // not_interested avec HITL draft : NE PAS blacklister
    else if (sentiment === 'not_interested' && hitlDraftCreated) {
      log.info('hitl', 'Draft HITL en attente pour ' + replyData.from + ' (not_interested) — pas de blacklist');
    }
    // not_interested SANS draft : blacklister
    else if (sentiment === 'not_interested' && !hitlDraftCreated) {
      actionTaken = 'polite_decline_blacklist';
      try {
        for (const ep of emailsToProcess) {
          automailerStorage.addToBlacklist(ep, 'prospect_declined');
        }
        log.info('inbox-manager', emailsToProcess.join(' + ') + ' blackliste (decline) — human takeover');
      } catch (e) { log.warn('inbox', 'Decline blacklist: ' + e.message); }
    }
    // OOO
    else if (sentiment === 'out_of_office') {
      actionTaken = autoReplyHandled ? 'deferred_ooo_rescheduled' : 'deferred_ooo';
      log.info('inbox-manager', replyData.from + ' absent (OOO) — ' + (autoReplyHandled ? 'reschedule auto programme' : 'pas de relais humain'));
    }
    // HITL draft cree
    else if (hitlDraftCreated) {
      log.info('hitl', 'Draft HITL en attente pour ' + replyData.from + ' (sentiment=' + sentiment + ')');
    }
    // Auto-reply envoye
    else if (autoReplyHandled) {
      actionTaken = 'auto_reply_' + sentiment;
      log.info('inbox-manager', 'Auto-reply ' + sentiment + ' envoye a ' + replyData.from + ' — le bot a gere');
    }
    else {
      actionTaken = 'human_takeover';
      log.info('inbox-manager', '🤝 HUMAN TAKEOVER: ' + replyData.from + ' (sentiment=' + sentiment + ') — le bot arrete, l\'humain prend le relais');

      // Marquer hasReplied sur TOUS les emails + annuler reactive FU + multi-thread
      _handleHumanTakeover(emailsToProcess, replyData);
    }
    return actionTaken;
  }

  function _handleHumanTakeover(emailsToProcess, replyData) {
    try {
      let totalMarked = 0;
      for (const ep of emailsToProcess) {
        const allEmails = automailerStorage.getEmailEventsForRecipient(ep);
        for (const em of allEmails) {
          if (em.id && !em.hasReplied) {
            automailerStorage.updateEmailStatus(em.id, em.status || 'replied', { hasReplied: true, repliedAt: new Date().toISOString() });
            totalMarked++;
          }
        }
      }
      log.info('inbox-manager', 'hasReplied=true marque sur ' + totalMarked + ' emails pour ' + emailsToProcess.join(' + '));
    } catch (e) {
      log.warn('inbox-manager', 'Marquage hasReplied echoue:', e.message);
    }

    // Annuler les reactive follow-ups
    try {
      const proactiveStorage = require('../skills/proactive-agent/storage.js');
      const pendingFUs = proactiveStorage.getPendingFollowUps();
      for (const fu of pendingFUs) {
        if (fu.prospectEmail && emailsToProcess.includes(fu.prospectEmail.toLowerCase())) {
          proactiveStorage.markFollowUpFailed(fu.id, 'human_takeover: prospect replied');
          log.info('inbox-manager', 'Reactive FU annule pour ' + fu.prospectEmail + ' (human takeover)');
        }
      }
    } catch (e) {
      log.warn('inbox-manager', 'Annulation reactive FU echouee:', e.message);
    }

    // Multi-Threading : marquer l'entreprise comme "replied"
    try {
      const ffStorage = require('../skills/flowfast/storage.js');
      if (ffStorage && ffStorage.markCompanyReplied) {
        for (const ep of emailsToProcess) {
          const updatedGroup = ffStorage.markCompanyReplied(ep);
          if (updatedGroup) {
            const cancelled = updatedGroup.contacts.filter(c => c.status === 'cancelled').length;
            if (cancelled > 0) {
              log.info('inbox-manager', 'Multi-thread: entreprise ' + updatedGroup.companyName + ' replied → ' + cancelled + ' contact(s) secondaire(s) annule(s)');
            }
          }
        }
      }
    } catch (e) {
      log.warn('inbox-manager', 'Multi-thread markCompanyReplied echoue:', e.message);
    }
  }

  function _stopRelancesForHitl(emailsToProcess) {
    try {
      let totalMarked = 0;
      for (const ep of emailsToProcess) {
        const allEmails = automailerStorage.getEmailEventsForRecipient(ep);
        for (const em of allEmails) {
          if (em.id && !em.hasReplied) {
            automailerStorage.updateEmailStatus(em.id, em.status || 'replied', { hasReplied: true, repliedAt: new Date().toISOString() });
            totalMarked++;
          }
        }
      }
      if (totalMarked > 0) log.info('hitl', 'hasReplied=true marque sur ' + totalMarked + ' emails (HITL pending) pour ' + emailsToProcess.join(' + '));
    } catch (e) { log.warn('hitl', 'Mark hasReplied: ' + e.message); }
    // Annuler les reactive follow-ups
    try {
      const proactiveStorage = require('../skills/proactive-agent/storage.js');
      const pendingFUs = proactiveStorage.getPendingFollowUps();
      for (const fu of pendingFUs) {
        if (fu.prospectEmail && emailsToProcess.includes(fu.prospectEmail.toLowerCase())) {
          proactiveStorage.markFollowUpFailed(fu.id, 'hitl_pending: draft en attente validation');
        }
      }
    } catch (e) { log.warn('hitl', 'Cancel follow-ups: ' + e.message); }
  }

  function _syncCrmSentiment(replyData, classification, emailsToProcess, getHubSpotClient) {
    (async () => {
      try {
        const hubspot = getHubSpotClient();
        if (!hubspot) return;
        let contact = null;
        for (const ep of emailsToProcess) {
          contact = await hubspot.findContactByEmail(ep);
          if (contact && contact.id) break;
        }
        if (contact && contact.id) {
          const LABELS = { interested: 'POSITIF', question: 'QUESTION', not_interested: 'NEGATIF', out_of_office: 'OOO', bounce: 'BOUNCE' };
          const noteBody = 'Reponse email recue de ' + replyData.from + '\n' +
            'Sujet : ' + (replyData.subject || '(sans sujet)') + '\n' +
            'Sentiment : ' + (LABELS[classification.sentiment] || classification.sentiment) + ' (score: ' + classification.score + ')\n' +
            'Analyse : ' + (classification.reason || '') + '\n' +
            '[Inbox Manager — classification IA]';
          const note = await hubspot.createNote(noteBody);
          if (note && note.id) await hubspot.associateNoteToContact(note.id, contact.id);
          if (classification.sentiment === 'interested') {
            await hubspot.advanceDealStage(contact.id, 'presentationscheduled', 'reply_interested').catch(() => {});
          }
        }
      } catch (e) {
        log.warn('inbox-manager', 'CRM update echoue:', e.message);
      }
    })();
  }

  function _trackFeedbackLoop(replyData, sentiment) {
    try {
      const inboxStorageFB = require('../skills/inbox-manager/storage.js');
      const effectiveness = (sentiment === 'interested') ? 'effective' : (sentiment === 'not_interested' ? 'ineffective' : null);
      if (effectiveness) {
        const updated = inboxStorageFB.markAutoReplyEffectiveness(replyData.from, effectiveness);
        if (updated) {
          log.info('inbox-manager', 'Feedback loop: auto-reply ' + updated.id + ' marque ' + effectiveness + ' (re-reponse ' + sentiment + ' de ' + replyData.from + ')');
        }
      }
    } catch (fbErr) { /* feedback loop non bloquante */ }
  }

  function _updateStorages(emailsToProcess, sentiment, score, classification, actionTaken) {
    try {
      const inboxStorage = require('../skills/inbox-manager/storage.js');
      for (const ep of emailsToProcess) {
        inboxStorage.updateSentimentByEmail(ep, {
          sentiment, score, reason: classification.reason, actionTaken
        });
      }
    } catch (e) { log.warn('inbox-manager', 'Storage sentiment update echoue:', e.message); }

    // Propager sentiment vers automailer
    try {
      if (automailerStorage.setSentiment) {
        for (const ep of emailsToProcess) {
          automailerStorage.setSentiment(ep, sentiment, score);
        }
        log.info('inbox-manager', 'Sentiment propage vers automailer: ' + emailsToProcess.join(' + ') + ' → ' + sentiment);
      }
    } catch (e) { log.warn('inbox-manager', 'Propagation sentiment automailer echouee:', e.message); }
  }

  async function _sendTelegramNotification(replyData, classification, sentiment, score, emailsToProcess, actionTaken, autoReplyHandled, hitlDraftCreated) {
    const EMOJIS = { interested: '🟢🔥', question: '🟡❓', not_interested: '🔴👋', out_of_office: '🏖️', bounce: '💀' };
    const SLABELS = { interested: 'INTERESSE', question: 'QUESTION', not_interested: 'PAS INTERESSE', out_of_office: 'ABSENT', bounce: 'BOUNCE' };
    const ALABELS = {
      human_takeover: '🤝 HUMAN TAKEOVER — reponds-lui !',
      polite_decline_blacklist: '👋 Blackliste (decline)',
      deferred_ooo: '🏖️ Reporte (OOO)',
      deferred_ooo_rescheduled: '🏖️📅 OOO — relance auto programmee',
      bounce_blacklist: '💀 Blackliste (bounce)',
      auto_reply_interested: '🚀⚡ REPONSE AUTO INSTANTANEE — booking propose !',
      auto_reply_not_interested: '🤖💬 Bot a contre-argumente',
      auto_reply_question: '🤖💬 Bot a repondu a la question',
      auto_reply_out_of_office: '🤖📅 OOO — relance auto programmee',
      hitl_pending_interested: '📝 Brouillon pret — valide sur Telegram !',
      hitl_pending_question: '📝 Brouillon pret — valide sur Telegram !',
      hitl_pending_not_interested: '📝 Brouillon pret — valide sur Telegram !',
      none: '—'
    };
    const notifLines = [
      (EMOJIS[sentiment] || '❓') + ' *Reponse prospect — ' + (SLABELS[sentiment] || sentiment) + '*',
      '',
      '👤 *' + escTg(replyData.fromName || replyData.from) + '*',
      '📧 ' + escTg(replyData.from),
      '📋 ' + escTg(replyData.subject || '(sans sujet)'),
      '📊 Score : ' + score + '/1.0'
    ];
    if (replyData.snippet) {
      notifLines.push('');
      notifLines.push('💬 *Sa reponse :*');
      notifLines.push('_' + escTg(replyData.snippet.substring(0, 300)) + (replyData.snippet.length > 300 ? '...' : '') + '_');
    }
    notifLines.push('');
    notifLines.push('💡 ' + escTg(classification.reason || ''));

    // Contexte : email original
    try {
      let existingEmails = [];
      for (const ep of emailsToProcess) {
        existingEmails = existingEmails.concat(automailerStorage.getEmailEventsForRecipient(ep));
      }
      const lastSent = existingEmails.filter(e => e.status === 'sent' || e.status === 'delivered' || e.status === 'opened').pop();
      if (lastSent) {
        notifLines.push('');
        notifLines.push('📤 *Ton email original :*');
        notifLines.push('Sujet : ' + escTg(lastSent.subject || ''));
        if (lastSent.body) {
          notifLines.push('_' + escTg(lastSent.body.substring(0, 250)) + (lastSent.body.length > 250 ? '...' : '') + '_');
        }
        if (lastSent.company) {
          notifLines.push('🏢 ' + escTg(lastSent.company));
        }
      }
    } catch (ctxErr) {}

    // HITL : notification enrichie avec brouillon + boutons
    if (hitlDraftCreated) {
      const _pendingDrafts = getPendingDrafts();
      let hitlDraftId = null;
      let hitlDraft = null;
      for (const [id, d] of _pendingDrafts) {
        if (d.replyData.from === replyData.from && Date.now() - d.createdAt < 60000) {
          hitlDraftId = id;
          hitlDraft = d;
        }
      }

      if (hitlDraft && hitlDraftId) {
        const isGrounded = hitlDraft._grounded !== false;
        const autoSendMin = isGrounded ? (parseFloat(process.env.HITL_AUTO_SEND_MINUTES) || 5) : null;

        notifLines.push('');
        notifLines.push('━━━━━━━━━━━━━━━━━━');
        if (isGrounded && autoSendMin) {
          notifLines.push('⚡ *ENVOI AUTO DANS ' + autoSendMin + ' MIN* — Annule ou modifie ci\\-dessous');
        } else {
          notifLines.push('📝 *Brouillon — validation requise*');
        }
        notifLines.push('_Objet : ' + escTg(hitlDraft.autoReply.subject) + '_');
        notifLines.push('');
        notifLines.push(escTg(hitlDraft.autoReply.body));
        notifLines.push('');
        notifLines.push('📊 Confiance : ' + (hitlDraft.autoReply.confidence || 0).toFixed(2) + (isGrounded ? ' \\| 🟢 Grounded KB' : ' \\| 🔴 Non\\-grounded'));
        if (hitlDraft.subClass && hitlDraft.subClass.objectionType) {
          notifLines.push('📋 Type : ' + escTg(hitlDraft.subClass.objectionType));
        }
        if (hitlDraft.qualityWarning) {
          notifLines.push('');
          notifLines.push('⚠️ *Quality gate :* ' + escTg(hitlDraft.qualityWarning));
        }
        notifLines.push('');
        if (isGrounded && autoSendMin) {
          notifLines.push('⏳ _Envoi auto dans ' + autoSendMin + ' min si pas d\'action\\._');
        } else {
          notifLines.push('🔒 _Reponse hors KB — validation humaine obligatoire\\. Expire dans 24h\\._');
        }

        const buttons = isGrounded ? [
          [
            { text: '🛑 Annuler', callback_data: 'hitl_skip_' + hitlDraftId },
            { text: '✏️ Modifier', callback_data: 'hitl_modify_' + hitlDraftId },
          ],
          [
            { text: '⚡ Envoyer maintenant', callback_data: 'hitl_accept_' + hitlDraftId },
            { text: '🚫 Blacklister', callback_data: 'hitl_ignore_' + hitlDraftId }
          ]
        ] : [
          [
            { text: '✅ Accepter', callback_data: 'hitl_accept_' + hitlDraftId },
            { text: '✏️ Modifier', callback_data: 'hitl_modify_' + hitlDraftId },
          ],
          [
            { text: '⏭️ Passer', callback_data: 'hitl_skip_' + hitlDraftId },
            { text: '🚫 Blacklister', callback_data: 'hitl_ignore_' + hitlDraftId }
          ]
        ];

        await sendMessageWithButtons(adminChatId, notifLines.join('\n'), buttons);
      } else {
        notifLines.push('');
        notifLines.push('⚠️ _Erreur creation draft — reponds manuellement._');
        notifLines.push('');
        notifLines.push('⚡ *Action :* ' + (ALABELS[actionTaken] || actionTaken));
        await sendMessage(adminChatId, notifLines.join('\n'), 'Markdown');
      }
    }
    // Auto-reply envoye
    else if (autoReplyHandled && actionTaken.startsWith('auto_reply_')) {
      try {
        const inboxStorage = require('../skills/inbox-manager/storage.js');
        const recentAR = inboxStorage.getAutoReplies(1);
        if (recentAR.length > 0 && recentAR[0].replyBody) {
          notifLines.push('');
          notifLines.push('🤖 *Reponse du bot :*');
          notifLines.push('_' + escTg(recentAR[0].replyBody.substring(0, 400)) + '_');
          if (recentAR[0].objectionType) {
            notifLines.push('📋 Type: ' + escTg(recentAR[0].objectionType));
          }
          notifLines.push('📊 Confiance: ' + (recentAR[0].confidence || 0).toFixed(2));
        }
      } catch (e) { log.warn('hitl', 'Notif auto-reply context: ' + e.message); }
      notifLines.push('');
      notifLines.push('⚡ *Action :* ' + (ALABELS[actionTaken] || actionTaken));
      await sendMessage(adminChatId, notifLines.join('\n'), 'Markdown');
    }
    // Notification classique
    else {
      notifLines.push('');
      notifLines.push('⚡ *Action :* ' + (ALABELS[actionTaken] || actionTaken));
      if (actionTaken === 'human_takeover') {
        notifLines.push('');
        notifLines.push('🚨 _Le bot a ARRETE toute automation pour ce prospect\\. Reponds\\-lui manuellement\\!_');
        try {
          if (meetingHandler.gcal && meetingHandler.gcal.isConfigured()) {
            const bookingUrl = await meetingHandler.gcal.getBookingLink(null, replyData.from, replyData.fromName);
            if (bookingUrl) {
              notifLines.push('');
              notifLines.push('📅 *Lien RDV rapide :*');
              notifLines.push(bookingUrl);
            }
          }
        } catch (e) { /* silent — best effort */ }
      }
      await sendMessage(adminChatId, notifLines.join('\n'), 'Markdown');
    }
  }
}

module.exports = { createReplyPipeline };
