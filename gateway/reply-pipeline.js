// iFIND - Reply Pipeline : traitement des reponses prospect (HITL, auto-reply, CRM sync)
// Extrait de telegram-router.js (~690 lignes)
'use strict';

const log = require('./logger.js');
const { getBreaker } = require('./circuit-breaker.js');
const { withTimeout, atomicWriteSync } = require('./utils.js');
const {
  classifyReply, subClassifyObjection,
  generateObjectionReply, generateQuestionReplyViaClaude,
  generateInterestedReplyViaClaude, parseOOOReturnDate, checkGrounding,
  extractAvailability, _getToneInstruction, _buildConversationContext
} = require('../skills/inbox-manager/reply-classifier.js');

/**
 * Cree le handler onReplyDetected pour InboxListener.
 * @param {Object} deps - Dependencies injectees depuis telegram-router
 * @returns {Function} async (replyData) => void
 */
function createReplyPipeline(deps) {
  const {
    openaiKey, callClaude, escTg,
    automailerStorage,
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

    // === 1b. Construire l'historique de conversation (THREADING) ===
    let conversationHistory = [];
    try {
      let existingEmails = [];
      for (const ep of emailsToProcess) {
        existingEmails = existingEmails.concat(automailerStorage.getEmailEventsForRecipient(ep));
      }
      // Ajouter les emails envoyes
      for (const em of existingEmails.filter(e => e.status !== 'bounced')) {
        conversationHistory.push({
          role: 'sent',
          subject: em.subject || '',
          body: (em.body || '').substring(0, 1000),
          date: em.sentAt || em.createdAt || ''
        });
      }
      // Ajouter les reponses recues precedentes
      try {
        const inboxStorageThread = require('../skills/inbox-manager/storage.js');
        const previousReplies = (inboxStorageThread.getMatchedReplies ? inboxStorageThread.getMatchedReplies() : [])
          .filter(r => emailsToProcess.includes((r.from || '').toLowerCase()));
        for (const r of previousReplies) {
          conversationHistory.push({
            role: 'received',
            subject: r.subject || '',
            body: (r.text || r.snippet || '').substring(0, 1000),
            date: r.date || r.receivedAt || ''
          });
        }
      } catch (e) { /* inbox storage non dispo */ }
      // Ajouter la reponse actuelle
      conversationHistory.push({
        role: 'received',
        subject: replyData.subject || '',
        body: (replyData.snippet || '').substring(0, 1000),
        date: replyData.date || new Date().toISOString()
      });
      // Trier par date
      conversationHistory.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
      log.info('inbox-manager', 'Conversation history: ' + conversationHistory.length + ' messages pour ' + replyData.from);
    } catch (e) {
      log.warn('inbox-manager', 'Construction historique echouee:', e.message);
    }

    // === 2. Classification IA du sentiment + tone ===
    let classification = { sentiment: 'question', score: 0.5, reason: 'Non classifie', key_phrases: [], tone: 'neutral' };
    // Circuit breaker check AVANT appel API classification
    const openaiBreaker = getBreaker('openai', { failureThreshold: 5, cooldownMs: 30000 });
    if (openaiBreaker.isBroken()) {
      log.warn('inbox-manager', 'Circuit breaker OpenAI ouvert — skip classification pour ' + replyData.from);
    } else {
      try {
        classification = await withTimeout(classifyReply(openaiKey, {
          from: replyData.from,
          fromName: replyData.fromName,
          subject: replyData.subject,
          snippet: replyData.snippet || ''
        }), 30000, 'OpenAI classifyReply');
      } catch (e) {
        log.error('inbox-manager', 'Classification echouee pour ' + replyData.from + ':', e.message);
      }
    }
    const sentiment = classification.sentiment;
    const score = classification.score;
    const tone = classification.tone || 'neutral';
    log.info('inbox-manager', 'Sentiment: ' + sentiment + ' (score=' + score + ', tone=' + tone + ') pour ' + replyData.from);

    // v2.0-cleanup : sync CRM HubSpot supprimé. Folk CRM lundi via webhook tenant.

    // === 3a-bis. FEEDBACK LOOP ===
    _trackFeedbackLoop(replyData, sentiment);

    // === 3a-ter. REAL-TIME LEARNING ===
    if (sentiment === 'interested' || sentiment === 'not_interested') {
      try {
        let origEmail = null;
        for (const ep of emailsToProcess) {
          const events = automailerStorage.getEmailEventsForRecipient(ep);
          const lastSent = events.filter(e => e.status === 'sent' || e.status === 'delivered' || e.status === 'opened').pop();
          if (lastSent) { origEmail = lastSent; break; }
        }
        _recordRealtimeOutcome(replyData, classification, origEmail, null, 'reply_' + sentiment);
      } catch (e) { /* non bloquant */ }
    }

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

        // IMPORTANT: check limite AVANT toute generation de draft (evite de gaspiller des tokens API)
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

          // Options partagees (threading + tone)
          const pipelineOptions = { conversationHistory, tone };

          // --- Cas 1: Objection douce (not_interested) → HITL ---
          if (sentiment === 'not_interested' && score >= 0.15) {
            const result = await _handleNotInterested(replyData, classification, originalEmail, originalMessageId, clientContext, emailsToProcess, autoReplyConfidence, _pendingDrafts, pipelineOptions);
            hitlDraftCreated = result.hitlDraftCreated;
          }
          // --- Cas 2: Question → NOTIFICATION (v3.2 : question = prospect chaud, humain prend le relai) ---
          else if (sentiment === 'question' && score >= 0.4) {
            await _notifyPositiveReply(replyData, classification, score, originalEmail, clientContext, null);
            _recordRealtimeOutcome(replyData, classification, originalEmail, 'A', 'human_handoff');
            log.info('reply-pipeline', 'QUESTION detectee — notification envoyee, humain prend le relai pour ' + replyData.from);
          }
          // --- Cas 3: Interested → NOTIFICATION (v3.2 : PLUS d'auto-reply, humain close) ---
          else if (sentiment === 'interested') {
            const result = await _handleInterested(replyData, classification, score, originalEmail, originalMessageId, clientContext, emailsToProcess, autoReplyConfidence, firstName, _pendingDrafts, pipelineOptions);
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

    // v2.0-cleanup : Niche tracking via autonomous-pilot supprimé. Le Trigger Engine
    // tracke les replies par tenant via client_leads.status (sent → replied_positive/negative/booked).

    // === 5. Update storage ===
    _updateStorages(emailsToProcess, sentiment, score, classification, actionTaken);

    // === 6. Notification Telegram enrichie ===
    await _sendTelegramNotification(replyData, classification, sentiment, score, emailsToProcess, actionTaken, autoReplyHandled, hitlDraftCreated);

    // v2.0-cleanup : sendPrecallBrief legacy supprimé. Briefs RDV générés désormais
    // via le pipeline Claude Brain "brief" (Opus 4.7, 1M context, 2000 mots niveau
    // consultant senior). Voir skills/trigger-engine/claude-brain/pipelines.js.
  };

  // ========== Internal helpers ==========

  function _checkDraftQuality(autoReply) {
    // v2.0-cleanup : forbiddenWords (autonomous-pilot) + emailPassesQualityGate
    // (campaign-engine) supprimés. On garde le check word count basique (8-80 mots).
    const wc = (autoReply.body || '').split(/\s+/).filter(w => w.length > 0).length;
    if (wc > 80 || wc < 8) return 'word count: ' + wc + ' (8-80 attendu)';
    return null;
  }

  async function _handleNotInterested(replyData, classification, originalEmail, originalMessageId, clientContext, emailsToProcess, autoReplyConfidence, _pendingDrafts, pipelineOptions) {
    const subClass = await subClassifyObjection(openaiKey, replyData, classification);
    log.info('inbox-manager', 'Sub-classification: ' + subClass.type + ' / ' + subClass.objectionType + ' (conf=' + subClass.confidence + ')');

    // Re-engagement 90j : scheduler un re-contact pour les objections "timing" et "budget"
    // Ces prospects ont exprime un interet potentiel mais pas au bon moment
    if (subClass.type === 'soft_objection' && ['timing', 'budget', 'competitor'].includes(subClass.objectionType)) {
      try {
        const inboxStorage = require('../skills/inbox-manager/storage.js');
        const delayDays = subClass.objectionType === 'timing' ? 90 : subClass.objectionType === 'budget' ? 120 : 180;
        const entry = inboxStorage.addReEngagement({
          email: replyData.from,
          company: replyData.fromName || '',
          firstName: '',
          objectionType: subClass.objectionType,
          delayDays: delayDays
        });
        if (entry) {
          const reEngageDate = new Date(entry.reEngageAfter).toLocaleDateString('fr-FR');
          log.info('inbox-manager', 'Re-engagement programme: ' + replyData.from + ' → ' + reEngageDate + ' (' + subClass.objectionType + ', ' + delayDays + 'j)');
        }
      } catch (e) { log.warn('inbox-manager', 'Re-engagement scheduling echoue: ' + e.message); }
    }

    if (subClass.type === 'soft_objection' && subClass.confidence >= autoReplyConfidence) {
      // Circuit breaker check AVANT generation Claude
      const claudeBreaker = getBreaker('claude-sonnet', { failureThreshold: 5, cooldownMs: 30000 });
      if (claudeBreaker.isBroken()) {
        log.warn('hitl', 'Circuit breaker Claude ouvert — skip generation objection pour ' + replyData.from);
        return { hitlDraftCreated: false };
      }
      const autoReply = await withTimeout(generateObjectionReply(callClaude, replyData, classification, subClass, originalEmail, clientContext, pipelineOptions || {}), 30000, 'Claude generateObjectionReply');

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

  async function _handleQuestion(replyData, classification, originalEmail, originalMessageId, clientContext, emailsToProcess, autoReplyConfidence, _pendingDrafts, pipelineOptions) {
    const snippetLen = (replyData.snippet || '').length;
    if (snippetLen < 1500) {
      // Circuit breaker check AVANT generation Claude
      const claudeBreakerQ = getBreaker('claude-sonnet', { failureThreshold: 5, cooldownMs: 30000 });
      if (claudeBreakerQ.isBroken()) {
        log.warn('hitl', 'Circuit breaker Claude ouvert — skip generation question pour ' + replyData.from);
        return { hitlDraftCreated: false };
      }
      const autoReply = await withTimeout(generateQuestionReplyViaClaude(callClaude, replyData, classification, originalEmail, clientContext, pipelineOptions || {}), 30000, 'Claude generateQuestionReply');

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

  async function _handleInterested(replyData, classification, score, originalEmail, originalMessageId, clientContext, emailsToProcess, autoReplyConfidence, firstName, _pendingDrafts, pipelineOptions) {
    // Check blacklist avant tout envoi
    const _isBlacklisted = automailerStorage.isBlacklisted && automailerStorage.isBlacklisted(replyData.from);
    if (_isBlacklisted) {
      log.info('hitl', 'Skip auto-reply: ' + replyData.from + ' est blackliste');
      return { hitlDraftCreated: false, autoReplyHandled: false };
    }

    const opts = pipelineOptions || {};

    // === QUALIFICATION CHECK ===
    let needsQualification = false;
    let qualificationQuestion = '';
    try {
      const inboxStorageQual = require('../skills/inbox-manager/storage.js');
      const previousAutoReplies = (inboxStorageQual.getAutoReplies ? inboxStorageQual.getAutoReplies(50) : [])
        .filter(ar => ar.prospectEmail === replyData.from && ar.sentiment === 'interested');
      const alreadyQualified = previousAutoReplies.length > 0; // Deja eu un echange interested

      if (!alreadyQualified) {
        // Charger les questions de qualification depuis la KB
        const kb = require('../skills/inbox-manager/knowledge-base.json');
        const qualConfig = kb.qualification;
        if (qualConfig && qualConfig.questions && qualConfig.questions.length > 0) {
          needsQualification = true;
          // Choisir une question aleatoire
          qualificationQuestion = qualConfig.questions[Math.floor(Math.random() * qualConfig.questions.length)];
          log.info('inbox-manager', 'Qualification requise pour ' + replyData.from + ' — question: ' + qualificationQuestion);
        }
      } else {
        log.info('inbox-manager', 'Prospect ' + replyData.from + ' deja qualifie (' + previousAutoReplies.length + ' interactions) — skip qualification');
      }
    } catch (e) { log.warn('inbox-manager', 'Qualification check: ' + e.message); }

    // === BOOKING AUTO : detecter disponibilite ===
    let meetingCreated = null;
    const availability = extractAvailability(replyData.snippet);
    if (availability.hasAvailability && !needsQualification) {
      try {
        const GoogleCalendarClient = require('../skills/meeting-scheduler/google-calendar-client.js');
        const resolvedDate = GoogleCalendarClient.resolveAvailability(availability.dayText, availability.timeText);
        if (resolvedDate && meetingHandler && meetingHandler.gcal && meetingHandler.gcal.isApiConfigured()) {
          meetingCreated = await meetingHandler.gcal.createMeeting(
            replyData.from, replyData.fromName || firstName, resolvedDate, 15
          );
          if (meetingCreated && meetingCreated.success) {
            log.info('inbox-manager', 'BOOKING AUTO: meeting cree pour ' + replyData.from + ' le ' + resolvedDate.toISOString());
          }
        }
      } catch (e) { log.warn('inbox-manager', 'Booking auto echoue:', e.message); }
    }

    // === GENERER LA REPONSE avec options enrichies ===
    // Circuit breaker check AVANT generation Claude
    const claudeBreakerI = getBreaker('claude-sonnet', { failureThreshold: 5, cooldownMs: 30000 });
    if (claudeBreakerI.isBroken()) {
      log.warn('hitl', 'Circuit breaker Claude ouvert — skip generation interested pour ' + replyData.from);
      return { hitlDraftCreated: false, autoReplyHandled: false };
    }
    const replyOpts = {
      ...opts,
      needsQualification,
      qualificationQuestion,
      meetingConfirmed: !!(meetingCreated && meetingCreated.success)
    };
    const autoReply = await withTimeout(generateInterestedReplyViaClaude(callClaude, replyData, classification, originalEmail, clientContext, replyOpts), 30000, 'Claude generateInterestedReply');

    if (!autoReply.body) return { hitlDraftCreated: false, autoReplyHandled: false };

    // v2.0-cleanup : A/B testing variants legacy supprimé. Smartlead gère les variants
    // côté séquenceur pour Full Service. Les replies Trigger Engine ne sont pas A/B testées.
    const abVariant = 'A';

    const qualityWarning = _checkDraftQuality(autoReply);
    if (qualityWarning) log.warn('hitl', 'Draft quality warning: ' + qualityWarning + ' pour ' + replyData.from);

    // === v3.2 : PLUS JAMAIS d'auto-reply sur les reponses positives ===
    // Le bot DETECTE, l'humain CLOSE. Un prospect interesse = notification immediate
    // au commercial/client qui prend le relai manuellement.
    // Auto-reply desactive le 16 avril 2026 — seules les reponses negatives restent auto.

    // Envoyer notification email au commercial/client
    await _notifyPositiveReply(replyData, classification, score, originalEmail, clientContext, meetingCreated);

    // Real-time learning : enregistrer l'outcome
    _recordRealtimeOutcome(replyData, classification, originalEmail, abVariant, 'human_handoff');

    log.info('reply-pipeline', 'REPONSE POSITIVE detectee — notification envoyee, humain prend le relai pour ' + replyData.from + ' (score=' + score + ')');

    // PAS de draft HITL, PAS d'auto-reply. Le bot arrete toute automation pour ce prospect.
    // Le commercial/client repond manuellement depuis sa boite email.

    // LOW CONFIDENCE ou quality warning → HITL avec grounding check (legacy, garde pour les cas edge)
    const grounding = checkGrounding(autoReply.body);
    const isGrounded = grounding.grounded && !qualityWarning;

    const draftId = hitlId();
    _pendingDrafts.set(draftId, {
      replyData, classification, subClass: { type: 'interested', objectionType: '' },
      autoReply, originalEmail, originalMessageId, clientContext,
      sentiment: 'interested', emailsToProcess, qualityWarning, createdAt: Date.now(),
      _grounded: isGrounded, abVariant, meetingCreated, needsQualification
    });
    saveHitlDrafts();
    const autoMin = isGrounded ? (parseFloat(process.env.HITL_AUTO_SEND_MINUTES) || 5) : 'HITL 24h';
    log.info('hitl', 'Draft cree: ' + draftId + ' pour ' + replyData.from + ' (interested, grounded=' + isGrounded + ', auto-send=' + autoMin + (isGrounded ? 'min' : '') + ', variant=' + abVariant + ')');
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

      // v2.0-cleanup : follow-up proactif legacy supprimé. Le re-engagement OOO se fait
      // désormais via inbox-manager addOOOReschedule() seulement (déjà fait au-dessus).

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

    // v2.0-cleanup : annulation reactive follow-ups (proactive-agent) + multi-threading
    // flowfast supprimés. Le Trigger Engine gère la logique de re-prospection via
    // client_leads.status (replied → discarded ou booked) qui empêche automatiquement
    // les re-qualifications futures sur ce SIREN.
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
    // v2.0-cleanup : annulation follow-ups proactifs HITL supprimée (skill legacy).
  }

  // === REAL-TIME LEARNING : enregistrer chaque outcome pour patterns ===
  function _recordRealtimeOutcome(replyData, classification, originalEmail, abVariant, action) {
    try {
      const rtlPath = '/data/inbox-manager/realtime-learner.json';
      const fs = require('fs');
      let data = { outcomes: [], patterns: {}, lastAnalysis: null };
      try {
        if (fs.existsSync(rtlPath)) {
          data = JSON.parse(fs.readFileSync(rtlPath, 'utf8'));
        }
      } catch (e) { /* fichier vide ou corrompu */ }

      // Extraire features de l'email original
      const origBody = (originalEmail && originalEmail.body) || '';
      const wordCount = origBody.split(/\s+/).filter(w => w.length > 0).length;
      const hasQuestion = /\?/.test(origBody);
      const subjectLength = ((originalEmail && originalEmail.subject) || '').length;

      // Detecter l'heure d'envoi de l'email original
      let sendHour = null;
      try {
        const emailEvents = automailerStorage.getEmailEventsForRecipient(replyData.from);
        const lastSent = emailEvents.filter(e => e.sentAt).pop();
        if (lastSent) sendHour = new Date(lastSent.sentAt).getHours();
      } catch (e) { log.warn('reply-pipeline', 'Send hour detection failed: ' + e.message); }

      const outcome = {
        timestamp: Date.now(),
        prospectEmail: replyData.from,
        sentiment: classification.sentiment,
        tone: classification.tone || 'neutral',
        score: classification.score,
        abVariant: abVariant || 'A',
        action,
        features: { wordCount, hasQuestion, subjectLength, sendHour }
      };

      data.outcomes.push(outcome);
      // Garder max 200 outcomes
      if (data.outcomes.length > 200) data.outcomes = data.outcomes.slice(-200);

      // Analyse patterns en temps reel (si >= 10 outcomes)
      if (data.outcomes.length >= 10) {
        const interested = data.outcomes.filter(o => o.sentiment === 'interested');
        const notInterested = data.outcomes.filter(o => o.sentiment === 'not_interested');
        const total = data.outcomes.length;

        // Pattern heure d'envoi
        if (interested.length >= 5) {
          const hourCounts = {};
          for (const o of interested) {
            const h = o.features.sendHour;
            if (h !== null) hourCounts[h] = (hourCounts[h] || 0) + 1;
          }
          const bestHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
          if (bestHour) {
            data.patterns.bestSendHour = { hour: parseInt(bestHour[0]), count: bestHour[1], total: interested.length };
          }
        }

        // Pattern longueur email
        if (interested.length >= 5 && notInterested.length >= 3) {
          const avgWordCountInterested = interested.reduce((s, o) => s + (o.features.wordCount || 0), 0) / interested.length;
          const avgWordCountNot = notInterested.reduce((s, o) => s + (o.features.wordCount || 0), 0) / notInterested.length;
          data.patterns.wordCount = {
            interestedAvg: Math.round(avgWordCountInterested),
            notInterestedAvg: Math.round(avgWordCountNot),
            recommendation: avgWordCountInterested < avgWordCountNot ? 'shorter_better' : 'longer_ok'
          };
        }

        // Pattern A/B variants
        const variantA = data.outcomes.filter(o => o.abVariant === 'A');
        const variantB = data.outcomes.filter(o => o.abVariant === 'B');
        if (variantA.length >= 5 && variantB.length >= 5) {
          const replyRateA = variantA.filter(o => o.sentiment === 'interested').length / variantA.length;
          const replyRateB = variantB.filter(o => o.sentiment === 'interested').length / variantB.length;
          data.patterns.abReply = {
            variantA: { total: variantA.length, replyRate: Math.round(replyRateA * 100) },
            variantB: { total: variantB.length, replyRate: Math.round(replyRateB * 100) },
            winner: replyRateA >= replyRateB ? 'A' : 'B'
          };
        }

        data.lastAnalysis = Date.now();
        log.info('realtime-learner', 'Patterns mis a jour: ' + JSON.stringify(data.patterns));
      }

      atomicWriteSync(rtlPath, data);
    } catch (e) {
      log.warn('realtime-learner', 'Record outcome echoue: ' + e.message);
    }
  }

  // v2.0-cleanup : _syncCrmSentiment HubSpot supprimé. Folk CRM lundi via
  // skills/trigger-engine/folk-client.js (webhook par tenant).

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

  // === NOTIFICATION EMAIL : prospect positif → commercial/client prend le relai ===
  // v3.2 : le bot ne repond PLUS aux prospects interesses. Il notifie par email.
  async function _notifyPositiveReply(replyData, classification, score, originalEmail, clientContext, meetingCreated) {
    try {
      const ResendClient = require('../skills/automailer/resend-client.js');
      const resendClient = new ResendClient(resendKey, senderEmail);

      // Destinataires : email(s) de notification configures dans l'env
      // NOTIFY_POSITIVE_EMAILS = "alexis@getifind.fr,commercial1@email.com,commercial2@email.com"
      // Pour les clients futurs : chaque client aura son propre NOTIFY_POSITIVE_EMAILS dans son .env
      const notifyEmails = (process.env.NOTIFY_POSITIVE_EMAILS || process.env.IMAP_USER || senderEmail || '').split(',').map(e => e.trim()).filter(Boolean);

      if (notifyEmails.length === 0) {
        log.warn('reply-pipeline', 'Pas d\'email de notification configure (NOTIFY_POSITIVE_EMAILS) — notification Telegram uniquement');
        return;
      }

      const prospectName = replyData.fromName || replyData.from;
      const prospectEmail = replyData.from;
      const prospectMessage = replyData.snippet || '(pas de contenu)';
      const company = (originalEmail && originalEmail.company) || '';
      const sentimentLabel = classification.sentiment === 'interested' ? 'INTERESSE' : classification.sentiment === 'question' ? 'QUESTION' : classification.sentiment;
      const meetingInfo = meetingCreated ? '\n\nMeeting auto-cree : ' + new Date(meetingCreated.startTime).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';

      const subject = '🔥 Reponse positive — ' + prospectName + (company ? ' (' + company + ')' : '');

      const body = 'Un prospect a repondu positivement. C\'est a toi de jouer !\n\n'
        + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
        + 'PROSPECT\n'
        + 'Nom : ' + prospectName + '\n'
        + 'Email : ' + prospectEmail + '\n'
        + (company ? 'Entreprise : ' + company + '\n' : '')
        + 'Score : ' + score + '/1.0 — ' + sentimentLabel + '\n'
        + 'Ton : ' + (classification.tone || 'neutral') + '\n'
        + '\n'
        + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
        + 'SON MESSAGE\n'
        + prospectMessage.substring(0, 1000) + '\n'
        + '\n'
        + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
        + 'CE QUE TU DOIS FAIRE\n'
        + '1. Reponds-lui depuis ta boite email dans l\'heure\n'
        + '2. Propose un call de 15 min (lien : ' + (clientContext.bookingUrl || 'https://cal.eu/alexis-benier-sarxqi') + ')\n'
        + '3. Si c\'est un client d\'iFIND, transmets le lead au commercial\n'
        + meetingInfo + '\n'
        + '\n'
        + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
        + 'CONTEXTE (ton email original)\n'
        + 'Sujet : ' + ((originalEmail && originalEmail.subject) || '?') + '\n'
        + ((originalEmail && originalEmail.body) ? originalEmail.body.substring(0, 500) : '') + '\n'
        + '\n'
        + '— iFIND Bot (notification automatique)';

      for (const email of notifyEmails) {
        try {
          await resendClient.sendEmail(email, subject, body, { fromName: 'iFIND Bot' });
          log.info('reply-pipeline', 'Notification reponse positive envoyee a ' + email + ' pour prospect ' + prospectEmail);
        } catch (e) {
          log.error('reply-pipeline', 'Echec notification email a ' + email + ': ' + e.message);
        }
      }
    } catch (e) {
      log.error('reply-pipeline', 'Erreur notification positive reply: ' + e.message);
    }
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
      auto_reply_interested: '🔥📧 NOTIFICATION ENVOYEE — le commercial prend le relai !',
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
      '📊 Score : ' + score + '/1.0',
      '🎭 Ton : ' + (classification.tone || 'neutral')
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
    } catch (ctxErr) { log.warn('reply-pipeline', 'Reply context enrichment failed: ' + ctxErr.message); }

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
          notifLines.push('_' + escTg(recentAR[0].replyBody.substring(0, 1000)) + '_');
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
