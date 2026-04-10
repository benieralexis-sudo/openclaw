// iFIND - Reply Pipeline : traitement des reponses prospect (HITL, auto-reply, CRM sync)
// Extrait de telegram-router.js (~690 lignes)
'use strict';

const log = require('./logger.js');
const { getBreaker } = require('./circuit-breaker.js');
const { withTimeout } = require('./utils.js');
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

    // === 3. Update CRM HubSpot avec sentiment ===
    _syncCrmSentiment(replyData, classification, emailsToProcess, getHubSpotClient);

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
          // --- Cas 2: Question → HITL ---
          else if (sentiment === 'question' && score >= 0.4) {
            const result = await _handleQuestion(replyData, classification, originalEmail, originalMessageId, clientContext, emailsToProcess, autoReplyConfidence, _pendingDrafts, pipelineOptions);
            hitlDraftCreated = result.hitlDraftCreated;
          }
          // --- Cas 3: Interested → AUTO-REPLY ou HITL ---
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

    // FIX NICHE TRACKING: tracker la reply par niche
    if (sentiment === 'interested' || sentiment === 'question') {
      try {
        const apStorageNiche = require('../skills/autonomous-pilot/storage.js');
        if (apStorageNiche && apStorageNiche.trackNicheEvent) {
          const automailerSt = require('../skills/automailer/storage.js');
          const allEmails = automailerSt.getAllEmails ? automailerSt.getAllEmails() : [];
          const matchedEmail = allEmails.find(function(em) { return (em.to || '').toLowerCase() === (replyData.from || '').toLowerCase(); });
          const niche = matchedEmail ? (matchedEmail.industry || matchedEmail.niche) : null;
          if (niche) {
            apStorageNiche.trackNicheEvent(niche, 'replied');
            log.info('inbox-manager', 'Niche tracking: replied [' + niche + '] pour ' + replyData.from);
          }
        }
      } catch (ntErr) { log.warn('inbox-manager', 'Niche tracking reply echoue: ' + ntErr.message); }
    }

    // === 5. Update storage ===
    _updateStorages(emailsToProcess, sentiment, score, classification, actionTaken);

    // === 6. Notification Telegram enrichie ===
    await _sendTelegramNotification(replyData, classification, sentiment, score, emailsToProcess, actionTaken, autoReplyHandled, hitlDraftCreated);

    // === 7. Brief pre-call si reply interessee (score >= 0.85) ou booking ===
    if (sentiment === 'interested' && score >= 0.85) {
      try {
        const { sendPrecallBrief } = require('../skills/precall-brief/index.js');
        await sendPrecallBrief(
          { callClaude, automailerStorage, sendMessage, adminChatId },
          replyData, classification
        );
      } catch (briefErr) {
        log.warn('precall-brief', 'Brief generation echouee: ' + briefErr.message);
      }
    }
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

    // === A/B TEST sur les reponses ===
    let abVariant = 'A';
    let autoReplyB = null;
    try {
      const ABTesting = require('../skills/automailer/ab-testing.js');
      const abTester = new ABTesting(automailerStorage);
      abVariant = abTester.assignVariant(replyData.from, 'reply_interested', 2);

      if (abVariant === 'B') {
        // Generer variante B avec un angle different
        const variantOpts = { ...replyOpts };
        const variantPromptSuffix = '\n\nGENERE UNE VARIANTE DIFFERENTE: angle plus direct, ou plus chaleureux, ou plus axe data. Pas la meme approche que d\'habitude.';
        autoReplyB = await withTimeout(generateInterestedReplyViaClaude(callClaude, {
          ...replyData,
          snippet: (replyData.snippet || '') + variantPromptSuffix
        }, classification, originalEmail, clientContext, variantOpts), 30000, 'Claude generateInterestedReply-B');

        if (autoReplyB && autoReplyB.body) {
          log.info('ab-testing', 'Variante B generee pour ' + replyData.from);
          // Utiliser variante B
          autoReply.body = autoReplyB.body;
          autoReply.subject = autoReplyB.subject || autoReply.subject;
        }
      }
    } catch (e) { log.warn('ab-testing', 'A/B test reply: ' + e.message); }

    const qualityWarning = _checkDraftQuality(autoReply);
    if (qualityWarning) log.warn('hitl', 'Draft quality warning: ' + qualityWarning + ' pour ' + replyData.from);

    const autoSendThreshold = parseFloat(process.env.AUTO_REPLY_INTERESTED_THRESHOLD) || 0.85;

    // HIGH CONFIDENCE + pas de warning → FULL AUTO
    // Double-check limite AVANT envoi auto (defense-in-depth contre race conditions)
    const inboxStorageCheck = require('../skills/inbox-manager/storage.js');
    const currentDayCount = inboxStorageCheck.getTodayAutoReplyCount();
    const maxPerDay = parseInt(process.env.AUTO_REPLY_MAX_PER_DAY) || 10;
    if (currentDayCount >= maxPerDay) {
      log.warn('hitl', 'Auto-reply limite atteinte au moment de l\'envoi (' + currentDayCount + '/' + maxPerDay + ') — skip auto-send pour ' + replyData.from);
      return { hitlDraftCreated: false, autoReplyHandled: false };
    }
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
              sentiment: 'interested', subClassification: needsQualification ? 'qualification' : 'auto_instant',
              objectionType: '', abVariant,
              replyBody: autoReply.body, replySubject: autoReply.subject,
              originalEmailId: originalEmail && originalEmail.subject,
              confidence: autoReply.confidence, sendResult,
              meetingCreated: meetingCreated ? { eventId: meetingCreated.eventId, startTime: meetingCreated.startTime } : null,
              tone: opts.tone || 'neutral'
            });
          } catch (e) { log.warn('auto-reply', 'Record stats: ' + e.message); }

          if (sendResult.messageId) {
            automailerStorage.addEmail({
              to: replyData.from, subject: autoReply.subject, body: autoReply.body,
              source: needsQualification ? 'auto_reply_qualification' : 'auto_reply_interested',
              status: 'sent', abVariant,
              messageId: sendResult.messageId, chatId: adminChatId
            });
          }

          // Proposer auto-meeting seulement si pas deja cree et pas en qualification
          if (!meetingCreated && !needsQualification) {
            try {
              if (meetingHandler) {
                const company = (originalEmail && originalEmail.company) || '';
                await meetingHandler.proposeAutoMeeting(replyData.from, replyData.fromName || firstName, company);
              }
            } catch (mtgErr) { log.warn('auto-reply', 'Auto-meeting proposal: ' + mtgErr.message); }
          }

          // Real-time learning : enregistrer l'outcome
          _recordRealtimeOutcome(replyData, classification, originalEmail, abVariant, 'auto_sent');

          const meetingInfo = meetingCreated ? ' + MEETING CREE le ' + new Date(meetingCreated.startTime).toLocaleDateString('fr-FR') : '';
          const qualInfo = needsQualification ? ' (QUALIFICATION)' : '';
          log.info('auto-reply', 'REPONSE AUTO INSTANTANEE envoyee a ' + replyData.from + ' (score=' + score + ', conf=' + autoReply.confidence + ', tone=' + (opts.tone || 'neutral') + ', variant=' + abVariant + qualInfo + meetingInfo + ')');
          return { hitlDraftCreated: false, autoReplyHandled: true };
        } else {
          log.error('auto-reply', 'Echec envoi auto pour ' + replyData.from + ': ' + (sendResult && sendResult.error));
          const draftId = hitlId();
          _pendingDrafts.set(draftId, {
            replyData, classification, subClass: { type: 'interested', objectionType: '' },
            autoReply, originalEmail, originalMessageId, clientContext,
            sentiment: 'interested', emailsToProcess, qualityWarning, createdAt: Date.now(),
            abVariant, meetingCreated, needsQualification
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
          sentiment: 'interested', emailsToProcess, qualityWarning, createdAt: Date.now(),
          abVariant, meetingCreated, needsQualification
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

      fs.writeFileSync(rtlPath, JSON.stringify(data, null, 2));
    } catch (e) {
      log.warn('realtime-learner', 'Record outcome echoue: ' + e.message);
    }
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
