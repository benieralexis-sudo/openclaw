// iFIND - Resend Webhook Handler (traitement evenements email)
// Extrait de telegram-router.js — handleResendWebhook + reactive follow-up logic

const log = require('./logger.js');

const RESEND_EVENT_MAP = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.opened': 'opened',
  'email.clicked': 'clicked'
};

/**
 * Cree un handler pour les webhooks Resend.
 * @param {object} deps - dependances injectees
 * @param {object} deps.automailerStorage - storage automailer
 * @param {object} deps.proactiveAgentStorage - storage proactive-agent
 * @param {Function} deps._getHubSpotClient - retourne un client HubSpot ou null
 * @param {Function} deps._enrichContactWithOrg - enrichit un contact avec l'organisation
 * @param {Function} deps.sendMessage - sendMessage(chatId, text, parseMode)
 * @param {Function} deps.sendMessageWithButtons - sendMessageWithButtons(chatId, text, buttons)
 * @param {Function|null} deps.ProspectResearcher - classe ProspectResearcher ou null
 * @param {object} deps.meetingHandler - meeting handler
 * @param {object} deps.automailerHandler - automailer handler
 * @param {string} deps.CLAUDE_KEY
 * @param {string} deps.REPLY_TO_EMAIL
 * @param {string} deps.ADMIN_CHAT_ID
 * @returns {{ handleResendWebhook }}
 */
function createResendHandler(deps) {
  const {
    automailerStorage,
    proactiveAgentStorage,
    _getHubSpotClient,
    _enrichContactWithOrg,
    sendMessage,
    sendMessageWithButtons,
    ProspectResearcher,
    meetingHandler,
    automailerHandler,
    CLAUDE_KEY,
    REPLY_TO_EMAIL,
    ADMIN_CHAT_ID
  } = deps;

  const STATUS_PRIORITY = { queued: 0, sent: 1, delivered: 2, delivery_delayed: 2, opened: 3, clicked: 4, bounced: 5, complained: 5 };

  // Inferer la niche d'un lead a partir de l'email record (industry, niche, ou domaine)
  function _inferLeadNiche(emailRecord) {
    if (emailRecord.industry) return emailRecord.industry;
    if (emailRecord.niche) return emailRecord.niche;
    // Chercher dans FlowFast (leads stockes)
    try {
      const ffStorage = require('../skills/flowfast/storage.js');
      const leadsObj = ffStorage.data ? ffStorage.data.leads || {} : {};
      for (const lid of Object.keys(leadsObj)) {
        const lead = leadsObj[lid];
        if ((lead.email || '').toLowerCase() === (emailRecord.to || '').toLowerCase()) {
          if (lead.niche) return lead.niche;
          if (lead.industry) return lead.industry;
          if (lead.aiClassification && lead.aiClassification.industry) return lead.aiClassification.industry;
          break;
        }
      }
    } catch (e) { log.warn('resend-handler', 'Niche lookup failed: ' + e.message); }
    return null;
  }

  // Helper : programmer un reactive FU — retourne l'objet ajoute ou null
  function _scheduleReactiveFU(emailRecord, intelBrief) {
    try {
      const rfConfig = proactiveAgentStorage.getReactiveFollowUpConfig();
      if (!rfConfig.enabled) return null;

      // Guard 0 : ANTI-BOUCLE — ne JAMAIS relancer sur un email qui est lui-meme une relance
      const emailSource = (emailRecord.source || '').toLowerCase();
      if (emailSource === 'reactive-followup' || emailSource === 'auto-reply' || emailSource === 'lead-revival' || emailSource === 'multi-threading' || emailSource === 'objection-reply') {
        log.info('webhook', 'Skip reactive FU pour ' + emailRecord.to + ' — anti-boucle (source: ' + emailSource + ')');
        return null;
      }

      // Guard 1 : emails generiques (contact@, info@, etc.)
      const genericPrefixes = ['contact', 'info', 'hello', 'support', 'admin', 'commercial', 'sales', 'marketing', 'direction', 'accueil', 'reception', 'compta', 'facturation', 'rh'];
      const localPart = (emailRecord.to || '').split('@')[0].toLowerCase();
      if (genericPrefixes.includes(localPart)) {
        log.info('webhook', 'Skip reactive FU pour ' + emailRecord.to + ' — email generique');
        return null;
      }

      // Guard 2 : blacklist automailer (human takeover, bounce, decline)
      if (automailerStorage.isBlacklisted(emailRecord.to)) {
        log.info('webhook', 'Skip reactive FU pour ' + emailRecord.to + ' — blackliste');
        return null;
      }
      // Guard 3 : ne PAS programmer de FU si le prospect a deja repondu (human takeover)
      const events = automailerStorage.getEmailEventsForRecipient(emailRecord.to);
      if (events.some(e => e.status === 'replied' || e.hasReplied)) {
        log.info('webhook', 'Skip reactive FU pour ' + emailRecord.to + ' — deja repondu (human takeover)');
        return null;
      }
      // Guard 4 : anti-doublon — ne PAS programmer si un FU est deja pending pour ce prospect
      const pendingFUs = proactiveAgentStorage.getPendingFollowUps();
      if (pendingFUs.some(fu => fu.prospectEmail && fu.prospectEmail.toLowerCase() === emailRecord.to.toLowerCase() && fu.status === 'pending')) {
        log.info('webhook', 'Skip reactive FU pour ' + emailRecord.to + ' — follow-up deja programme');
        return null;
      }
      const delayMs = (rfConfig.minDelayMinutes + Math.random() * (rfConfig.maxDelayMinutes - rfConfig.minDelayMinutes)) * 60 * 1000;
      const scheduledAfter = new Date(Date.now() + delayMs).toISOString();
      const added = proactiveAgentStorage.addPendingFollowUp({
        prospectEmail: emailRecord.to,
        prospectName: emailRecord.contactName || '',
        prospectCompany: emailRecord.company || '',
        originalEmailId: emailRecord.id,
        originalSubject: emailRecord.subject || '',
        originalBody: (emailRecord.body || '').substring(0, 500),
        prospectIntel: (intelBrief || '').substring(0, 3500),
        scheduledAfter: scheduledAfter
      });
      if (added) {
        log.info('webhook', 'Reactive follow-up programme pour ' + emailRecord.to + ' a ' + scheduledAfter);
      }
      return added;
    } catch (rfErr) {
      log.warn('webhook', 'Erreur enregistrement reactive follow-up: ' + rfErr.message);
      return null;
    }
  }

  /**
   * Traite un webhook Resend (sent, delivered, opened, clicked, bounced, complained).
   * @param {object} body - payload du webhook
   * @returns {Promise<object>} { processed, status?, email?, reason? }
   */
  async function handleResendWebhook(body) {
    const eventType = body.type;
    const data = body.data;
    if (!eventType || !data || !data.email_id) {
      return { processed: false, reason: 'payload invalide' };
    }

    const status = RESEND_EVENT_MAP[eventType];
    if (!status) {
      return { processed: false, reason: 'event type inconnu: ' + eventType };
    }

    // Trouver l'email par resendId
    const email = automailerStorage.findEmailByResendId(data.email_id);
    if (!email) {
      return { processed: false, reason: 'email_id inconnu: ' + data.email_id };
    }

    // Ne pas "downgrader" le statut (opened > delivered > sent)
    const currentPriority = STATUS_PRIORITY[email.status] || 0;
    const newPriority = STATUS_PRIORITY[status] || 0;
    if (newPriority <= currentPriority && status !== 'bounced' && status !== 'complained') {
      return { processed: false, reason: 'statut deja plus avance (' + email.status + ')' };
    }

    // Sauvegarder l'etat avant mise a jour (pour detecter premiere ouverture)
    const wasAlreadyOpened = email.openedAt || false;

    // Mettre a jour le statut
    automailerStorage.updateEmailStatus(email.id, status);
    log.info('webhook', eventType + ' pour ' + email.to + ' (resend: ' + data.email_id + ')');

    // Niche performance tracking (opened/replied → alimenter nichePerformance pour self-improve)
    if ((status === 'opened' && !wasAlreadyOpened) || status === 'replied') {
      try {
        const apStorage = require('../skills/autonomous-pilot/storage.js');
        // Chercher la niche du lead dans les leads stockes
        const leadNiche = _inferLeadNiche(email);
        if (leadNiche) {
          apStorage.trackNicheEvent(leadNiche, status === 'opened' ? 'opened' : 'replied');
          log.info('webhook', 'Niche tracking: ' + status + ' [' + leadNiche + '] pour ' + email.to);
        }
      } catch (ntErr) {
        log.warn('webhook', 'Niche tracking echoue: ' + ntErr.message);
      }
    }

    // Bounce → differencier hard/soft bounce
    if (status === 'bounced') {
      // Track bounce dans les metriques globales
      if (global.__ifindMetrics && global.__ifindMetrics.emailMetrics) {
        global.__ifindMetrics.emailMetrics.bounced++;
      }
      const bounceType = (data.bounce && data.bounce.type) || '';
      const isHardBounce = !bounceType || bounceType === 'hard' || /invalid|not found|does not exist|rejected/i.test(data.bounce && data.bounce.message || '');
      if (isHardBounce) {
        automailerStorage.addToBlacklist(email.to, 'hard_bounce_webhook');
        log.info('webhook', 'Hard bounce: ' + email.to + ' ajoute au blacklist');
      } else {
        // Soft bounce (mailbox full, temp DNS, rate limit) → retry dans 24-48h, PAS de blacklist
        log.info('webhook', 'Soft bounce: ' + email.to + ' — retry prevu (pas de blacklist). Type: ' + bounceType + ', message: ' + ((data.bounce && data.bounce.message) || '').substring(0, 100));
        try {
          const proactiveStorage = require('../skills/proactive-agent/storage.js');
          const retryDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          proactiveStorage.addPendingFollowUp({
            prospectEmail: email.to,
            prospectName: email.contactName || '',
            prospectCompany: email.company || '',
            originalSubject: email.subject || '',
            originalBody: (email.body || '').substring(0, 300),
            prospectIntel: 'Soft bounce (' + bounceType + '). Retry automatique apres 24h.',
            scheduledAfter: retryDate,
            isSoftBounceRetry: true
          });
          log.info('webhook', 'Soft bounce retry programme pour ' + email.to + ' a ' + retryDate.substring(0, 10));
        } catch (sbErr) {
          log.warn('webhook', 'Soft bounce retry schedule echoue: ' + sbErr.message);
        }
      }

      // B6 FIX : notifier le domain-manager pour l'auto-pause a 3% bounce rate
      // FIX: utiliser senderDomain (vrai domaine SMTP) au lieu de email.from (qui est souvent REPLY_TO)
      try {
        const domainManager = require('../skills/automailer/domain-manager.js');
        const senderDomain = email.senderDomain || (email.from || '').split('@').pop() || '';
        if (senderDomain && domainManager.recordBounce) {
          domainManager.recordBounce(senderDomain);
          log.info('webhook', 'Domain-manager: bounce enregistre pour ' + senderDomain);
        }
      } catch (dmErr) {
        log.warn('webhook', 'Domain-manager recordBounce echoue: ' + dmErr.message);
      }
    }

    // Complained (spam report) → blacklist automatique
    if (status === 'complained') {
      automailerStorage.addToBlacklist(email.to, 'spam_complaint');
      log.info('webhook', 'Spam complaint: ' + email.to + ' ajoute au blacklist');

      // B7 FIX : notifier le domain-manager (complaint = pire qu'un bounce)
      try {
        const domainManager = require('../skills/automailer/domain-manager.js');
        const senderDomain = email.senderDomain || (email.from || '').split('@').pop() || '';
        if (senderDomain && domainManager.recordBounce) {
          domainManager.recordBounce(senderDomain);
          log.info('webhook', 'Domain-manager: complaint enregistre pour ' + senderDomain);
        }
      } catch (dmErr) {
        log.warn('webhook', 'Domain-manager recordComplaint echoue: ' + dmErr.message);
      }
    }

    // Sync CRM + avancement deal automatique pour les evenements importants
    if (['opened', 'bounced', 'clicked'].includes(status)) {
      try {
        const hubspot = _getHubSpotClient();
        if (hubspot) {
          const contact = await hubspot.findContactByEmail(email.to);
          if (contact && contact.id) {
            const STATUS_LABELS = { opened: 'Ouvert', bounced: 'Bounce', clicked: 'Clique' };
            const noteBody = 'Email "' + (email.subject || '(sans sujet)') + '" — ' + (STATUS_LABELS[status] || status) + '\n' +
              'Destinataire : ' + email.to + '\n' +
              'Date : ' + new Date().toLocaleDateString('fr-FR') + '\n' +
              '[Webhook Resend — sync auto]';
            const note = await hubspot.createNote(noteBody);
            if (note && note.id) {
              await hubspot.associateNoteToContact(note.id, contact.id);
            }
            // Avancement automatique des deals selon l'evenement
            if (status === 'opened') {
              const adv = await hubspot.advanceDealStage(contact.id, 'qualifiedtobuy', 'email_opened');
              if (adv > 0) log.info('webhook', 'Deal avance a qualifiedtobuy pour ' + email.to + ' (email ouvert)');
            } else if (status === 'clicked') {
              const adv = await hubspot.advanceDealStage(contact.id, 'presentationscheduled', 'email_clicked');
              if (adv > 0) log.info('webhook', 'Deal avance a presentationscheduled pour ' + email.to + ' (clic email)');
            }
          }
        }
      } catch (crmErr) {
        log.warn('webhook', 'CRM sync echoue: ' + crmErr.message);
      }
    }

    // Clic email → programmer reactive FU + proposer meeting immediatement
    if (status === 'clicked' && ProspectResearcher) {
      log.info('webhook', 'Clic detecte pour ' + email.to + ' — reactive FU + meeting auto');
      try {
        const researcher = new ProspectResearcher({ claudeKey: CLAUDE_KEY });
        const contact = _enrichContactWithOrg(email.to, email.contactName || '', email.company || '', '');
        Promise.race([
          researcher.researchProspect(contact),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 30s')), 30000))
        ]).then(intel => {
          var addedFUclick = _scheduleReactiveFU(email, intel && intel.brief ? intel.brief : '');
          if (addedFUclick) {
            sendMessageWithButtons(ADMIN_CHAT_ID, '🖱️ *Clic sur email !*\n\n*Qui :* ' + (email.contactName || email.to) + '\n' + (email.company ? '*Entreprise :* ' + email.company + '\n' : '') + '*Objet :* _' + (email.subject || '').substring(0, 60) + '_\n\n➡️ _Relance programmee._', [[{ text: '❌ Annuler relance', callback_data: 'cancel_rfu_' + addedFUclick.id }]]).catch(() => {});
          } else {
            sendMessage(ADMIN_CHAT_ID, '🖱️ *Clic sur email !*\n\n*Qui :* ' + (email.contactName || email.to) + '\n' + (email.company ? '*Entreprise :* ' + email.company + '\n' : '') + '*Objet :* _' + (email.subject || '').substring(0, 60) + '_', 'Markdown').catch(() => {});
          }
        }).catch(() => {
          var addedFUclick2 = _scheduleReactiveFU(email, '');
          if (addedFUclick2) {
            sendMessageWithButtons(ADMIN_CHAT_ID, '🖱️ *Clic sur email* par ' + (email.contactName || email.to) + '\n\n_Relance programmee._', [[{ text: '❌ Annuler relance', callback_data: 'cancel_rfu_' + addedFUclick2.id }]]).catch(() => {});
          } else {
            sendMessage(ADMIN_CHAT_ID, '🖱️ *Clic sur email* par ' + (email.contactName || email.to), 'Markdown').catch(() => {});
          }
        });
      } catch (e) {
        log.warn('webhook', 'Erreur reactive FU sur clic: ' + e.message);
      }
      // Clic = engagement fort → proposer meeting auto immediatement
      try {
        const amStorage = require('../skills/automailer/storage.js');
        const existingEmails = amStorage.getEmailEventsForRecipient(email.to);
        const cutoff48h = Date.now() - 48 * 60 * 60 * 1000;
        const recentAutoMeeting = existingEmails.find(e =>
          e.source === 'auto-meeting' && e.sentAt && new Date(e.sentAt).getTime() > cutoff48h
        );
        if (!recentAutoMeeting) {
          const meeting = await meetingHandler.proposeAutoMeeting(
            email.to,
            email.contactName || '',
            email.company || ''
          );
          if (meeting && meeting.bookingUrl) {
            const resend = automailerHandler.resend;
            if (resend) {
              const leadFirst = (email.contactName || '').trim().split(' ')[0] || '';
              const meetBody = (leadFirst ? (leadFirst + ', ') : '') +
                'je vois que le sujet t\'interesse !\n\n' +
                'Le plus simple : on se fait un call rapide de 15 min ?\n\n' +
                'Choisis le creneau qui t\'arrange : ' + meeting.bookingUrl + '\n\n' +
                'A bientot !';
              const meetSubject = 'On se cale un echange rapide ?';
              const meetResult = await resend.sendEmail(email.to, meetSubject, meetBody, {
                replyTo: REPLY_TO_EMAIL,
                fromName: process.env.SENDER_NAME || 'Alexis',
                tags: [{ name: 'type', value: 'auto-meeting' }]
              });
              if (meetResult && meetResult.success) {
                amStorage.addEmail({
                  chatId: ADMIN_CHAT_ID,
                  to: email.to,
                  subject: meetSubject,
                  body: meetBody,
                  resendId: meetResult.id || null,
                  status: 'sent',
                  source: 'auto-meeting',
                  contactName: email.contactName || '',
                  company: email.company || ''
                });
                log.info('webhook', 'Meeting auto envoye sur clic a ' + email.to);
                sendMessage(ADMIN_CHAT_ID, '📅 *Meeting propose sur clic !*\n👤 ' + (email.contactName || email.to) + '\n🔗 ' + meeting.bookingUrl, 'Markdown').catch(() => {});
              }
            }
          }
        }
      } catch (meetErr) {
        log.info('webhook', 'Auto-meeting sur clic skip: ' + meetErr.message);
      }
    }

    // Premiere ouverture → research + notification seulement (PAS de reactive FU)
    if (status === 'opened' && !wasAlreadyOpened && ProspectResearcher) {
      try {
        const researcher = new ProspectResearcher({ claudeKey: CLAUDE_KEY });
        const contact = _enrichContactWithOrg(email.to, email.contactName || '', email.company || '', '');
        const researchWithTimeout = Promise.race([
          researcher.researchProspect(contact),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 30s')), 30000))
        ]);
        researchWithTimeout.then(intel => {
          if (intel && intel.brief) {
            log.info('webhook', 'Email ouvert (1ere fois) par ' + email.to + ' — intel cache, notification silencieuse');
            // Sauvegarder l'intel pour usage ulterieur (2eme ouverture)
            try {
              proactiveAgentStorage.data._cachedIntel = proactiveAgentStorage.data._cachedIntel || {};
              proactiveAgentStorage.data._cachedIntel[email.to] = { brief: intel.brief.substring(0, 3500), cachedAt: new Date().toISOString() };
              const keys = Object.keys(proactiveAgentStorage.data._cachedIntel);
              if (keys.length > 100) { for (var ci = 0; ci < keys.length - 100; ci++) delete proactiveAgentStorage.data._cachedIntel[keys[ci]]; }
              proactiveAgentStorage._save();
            } catch (cacheErr) { log.warn('resend-handler', 'Intel cache save failed: ' + cacheErr.message); }
          } else {
            log.info('webhook', 'Email ouvert (1ere fois) par ' + email.to + ' — pas d\'intel, notification silencieuse');
          }
        }).catch(err => {
          log.warn('webhook', 'Prospect research echoue pour open event: ' + err.message);
        });
      } catch (e) {
        log.warn('webhook', 'Erreur init prospect research: ' + e.message);
      }
    }

    // 2eme+ ouverture → signal d'interet fort → programmer reactive FU
    if (status === 'opened' && wasAlreadyOpened) {
      log.info('webhook', 'Rouverture detectee pour ' + email.to + ' — programmation reactive FU');
      var cachedIntel = '';
      try {
        var cache = (proactiveAgentStorage.data._cachedIntel || {})[email.to];
        if (cache && cache.brief) cachedIntel = cache.brief;
      } catch (e) { log.warn('webhook', 'Cached intel lookup: ' + e.message); }
      var addedFUwh = _scheduleReactiveFU(email, cachedIntel);
      if (addedFUwh) {
        log.info('webhook', 'Reactive FU programme (reouvre webhook) pour ' + email.to + ' — id: ' + addedFUwh.id + ' — notification a l\'envoi');
      } else {
        log.info('webhook', 'Reactive FU deja programme ou skippee pour ' + email.to + ' (dedup/guards)');
      }
    }

    return { processed: true, status: status, email: email.to };
  }

  return { handleResendWebhook, _scheduleReactiveFU };
}

module.exports = { createResendHandler, RESEND_EVENT_MAP };
