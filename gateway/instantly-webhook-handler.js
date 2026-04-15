// iFIND Bot — Handler webhook Instantly
// Recoit les events : email_sent, email_bounced, reply_received, lead_unsubscribed, account_error
'use strict';

const log = require('./logger.js');

/**
 * Mappe les events Instantly vers le format interne du bot
 * pour compatibilite avec le tracking/analytics existant
 */
const EVENT_MAP = {
  'email_sent': 'sent',
  'email_bounced': 'bounced',
  'reply_received': 'replied',
  'lead_unsubscribed': 'unsubscribed',
  'account_error': 'error',
  'email_opened': 'opened',
  'email_link_clicked': 'clicked',
  'lead_interested': 'interested',
  'lead_not_interested': 'not_interested',
  'campaign_completed': 'completed'
};

function createInstantlyWebhookHandler(options) {
  const { sendTelegram, storage, metrics } = options;

  /**
   * Traiter un event webhook Instantly
   * @param {Object} payload - Payload brut du webhook Instantly
   */
  async function handleEvent(payload) {
    const eventType = payload.event_type || payload.event || 'unknown';
    const internalEvent = EVENT_MAP[eventType] || eventType;

    const leadEmail = payload.email || (payload.lead && payload.lead.email) || 'unknown';
    const campaignId = payload.campaign_id || (payload.campaign && payload.campaign.id) || '';
    const campaignName = (payload.campaign && payload.campaign.name) || '';

    log.info('instantly-webhook', 'Event: ' + eventType + ' | Lead: ' + leadEmail + ' | Campaign: ' + campaignName);

    // Mettre a jour les metriques globales
    if (metrics && metrics.emailMetrics) {
      if (internalEvent === 'sent') metrics.emailMetrics.sent++;
      else if (internalEvent === 'bounced') metrics.emailMetrics.bounced++;
    }

    // Traiter selon le type d'event
    switch (internalEvent) {
      case 'sent':
        await _handleSent(payload, leadEmail, campaignId);
        break;

      case 'bounced':
        await _handleBounced(payload, leadEmail, campaignId);
        break;

      case 'replied':
        await _handleReplied(payload, leadEmail, campaignId);
        break;

      case 'unsubscribed':
        await _handleUnsubscribed(payload, leadEmail, campaignId);
        break;

      case 'error':
        await _handleAccountError(payload);
        break;

      default:
        log.info('instantly-webhook', 'Event non gere: ' + eventType);
    }
  }

  async function _handleSent(payload, email, campaignId) {
    // Mettre a jour le statut dans le storage automailer
    if (storage) {
      try {
        const campaigns = storage.data.campaigns || {};
        for (const cId of Object.keys(campaigns)) {
          const campaign = campaigns[cId];
          if (!campaign || !campaign.contacts) continue;
          const contact = campaign.contacts.find(c => c.email === email);
          if (contact) {
            if (!contact.instantlyStatus) contact.instantlyStatus = {};
            contact.instantlyStatus.lastSent = new Date().toISOString();
            contact.instantlyStatus.status = 'sent';
            storage.save();
            break;
          }
        }
      } catch (e) {
        log.warn('instantly-webhook', 'Erreur update storage sent: ' + e.message);
      }
    }
  }

  async function _handleBounced(payload, email, campaignId) {
    log.warn('instantly-webhook', 'BOUNCE: ' + email);

    // Blacklister l'email bounced
    if (storage && storage.addToBlacklist) {
      storage.addToBlacklist(email, 'instantly_bounce');
    }

    // Notifier sur Telegram
    if (sendTelegram) {
      const adminChat = process.env.ADMIN_CHAT_ID || '1409505520';
      await sendTelegram(adminChat, '⚠️ *Bounce Instantly*\n' +
        'Email: `' + email + '`\n' +
        'Raison: ' + (payload.bounce_type || payload.reason || 'inconnu') + '\n' +
        'Blackliste automatiquement.');
    }
  }

  async function _handleReplied(payload, email, campaignId) {
    log.info('instantly-webhook', 'REPLY recu de: ' + email);

    // Notifier sur Telegram — c'est un event important
    if (sendTelegram) {
      const adminChat = process.env.ADMIN_CHAT_ID || '1409505520';
      const replyBody = payload.reply_body || payload.body || payload.text || '';
      const preview = replyBody.substring(0, 200).replace(/[<>]/g, '');

      await sendTelegram(adminChat, '📩 *Reply Instantly !*\n' +
        'De: `' + email + '`\n' +
        (payload.lead && payload.lead.first_name ? 'Prenom: ' + payload.lead.first_name + '\n' : '') +
        (payload.lead && payload.lead.company_name ? 'Entreprise: ' + payload.lead.company_name + '\n' : '') +
        '---\n' +
        preview + (replyBody.length > 200 ? '...' : ''));
    }

    // Mettre a jour le storage
    if (storage) {
      try {
        const campaigns = storage.data.campaigns || {};
        for (const cId of Object.keys(campaigns)) {
          const campaign = campaigns[cId];
          if (!campaign || !campaign.contacts) continue;
          const contact = campaign.contacts.find(c => c.email === email);
          if (contact) {
            if (!contact.instantlyStatus) contact.instantlyStatus = {};
            contact.instantlyStatus.replied = true;
            contact.instantlyStatus.repliedAt = new Date().toISOString();
            contact.instantlyStatus.status = 'replied';
            storage.save();
            break;
          }
        }
      } catch (e) {
        log.warn('instantly-webhook', 'Erreur update storage replied: ' + e.message);
      }
    }
  }

  async function _handleUnsubscribed(payload, email, campaignId) {
    log.info('instantly-webhook', 'UNSUB: ' + email);

    if (storage && storage.addToBlacklist) {
      storage.addToBlacklist(email, 'instantly_unsub');
    }
  }

  async function _handleAccountError(payload) {
    const account = payload.email_account || payload.account || 'unknown';
    const errorMsg = payload.error || payload.message || 'erreur inconnue';

    log.error('instantly-webhook', 'ACCOUNT ERROR: ' + account + ' — ' + errorMsg);

    if (sendTelegram) {
      const adminChat = process.env.ADMIN_CHAT_ID || '1409505520';
      await sendTelegram(adminChat, '🔴 *Erreur compte Instantly*\n' +
        'Compte: `' + account + '`\n' +
        'Erreur: ' + errorMsg + '\n' +
        'Verifier dans Instantly dashboard.');
    }
  }

  return { handleEvent, EVENT_MAP };
}

module.exports = { createInstantlyWebhookHandler };
