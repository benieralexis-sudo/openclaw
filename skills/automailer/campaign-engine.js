// AutoMailer - Moteur de campagnes (sequences, scheduling, execution)
const storage = require('./storage');
const dns = require('dns');
const log = require('../../gateway/logger.js');

// --- Cache MX par domaine (1h TTL) ---
const _mxCache = new Map();
const MX_CACHE_TTL = 60 * 60 * 1000; // 1 heure

function _checkMX(email) {
  return new Promise((resolve) => {
    const domain = (email || '').split('@')[1];
    if (!domain) return resolve(false);

    // Check cache
    const cached = _mxCache.get(domain);
    if (cached && Date.now() - cached.ts < MX_CACHE_TTL) {
      return resolve(cached.valid);
    }

    dns.resolveMx(domain, (err, addresses) => {
      const valid = !err && Array.isArray(addresses) && addresses.length > 0;
      _mxCache.set(domain, { valid, ts: Date.now() });
      // Limiter le cache a 500 domaines
      if (_mxCache.size > 500) {
        const firstKey = _mxCache.keys().next().value;
        _mxCache.delete(firstKey);
      }
      resolve(valid);
    });
  });
}

// --- FIX 15 : Cross-skill HubSpot sync ---
function _getHubSpotClient() {
  const apiKey = process.env.HUBSPOT_API_KEY;
  if (!apiKey) return null;
  try {
    const HubSpotClient = require('../crm-pilot/hubspot-client.js');
    return new HubSpotClient(apiKey);
  } catch (e) {
    try {
      const HubSpotClient = require('/app/skills/crm-pilot/hubspot-client.js');
      return new HubSpotClient(apiKey);
    } catch (e2) {
      return null;
    }
  }
}

// Statuts email importants a synchroniser vers HubSpot
const CRM_SYNC_STATUSES = ['opened', 'bounced', 'clicked', 'replied'];

// Labels lisibles pour les statuts email
const STATUS_LABELS = {
  opened: 'Ouvert',
  bounced: 'Bounce',
  clicked: 'Clique',
  delivered: 'Delivre',
  replied: 'Repondu',
  complained: 'Spam'
};

// --- FIX 4 : Heures bureau (Europe/Paris, lun-ven 9h-18h) ---
function isBusinessHours() {
  const now = new Date();
  const parisHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(now));
  // Convertir en heure Paris pour obtenir le jour de la semaine
  const parisDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const parisDay = parisDate.getDay(); // 0=dimanche, 6=samedi
  if (parisDay === 0 || parisDay === 6) return false; // weekend
  if (parisHour < 9 || parisHour >= 18) return false; // hors heures
  return true;
}

// --- FIX 3 : Warmup progressif ---
function getDailyLimit() {
  const firstSendDate = storage.getFirstSendDate();
  if (!firstSendDate) return 5; // Premier jour = 5 emails max
  const daysSinceFirst = Math.floor((Date.now() - new Date(firstSendDate).getTime()) / 86400000);
  const schedule = [5, 10, 20, 35, 50, 75, 100];
  const limit = schedule[Math.min(daysSinceFirst, schedule.length - 1)] || 100;
  return Math.min(limit, 100); // Resend free tier = 100/jour max
}

class CampaignEngine {
  constructor(resendClient, claudeWriter) {
    this.resend = resendClient;
    this.claude = claudeWriter;
    this.schedulerInterval = null;
  }

  // --- Cycle de vie des campagnes ---

  async createCampaign(chatId, config) {
    // config = { name, contactListId, steps: number, intervalDays, context }
    const list = storage.getContactList(config.contactListId);
    if (!list) throw new Error('Liste de contacts introuvable');

    const campaign = storage.createCampaign(chatId, {
      name: config.name,
      contactListId: config.contactListId,
      totalContacts: list.contacts.length,
      steps: [] // Seront remplis par generateCampaignEmails
    });

    return campaign;
  }

  async generateCampaignEmails(campaignId, context, totalSteps, intervalDays) {
    const campaign = storage.getCampaign(campaignId);
    if (!campaign) throw new Error('Campagne introuvable');

    const list = storage.getContactList(campaign.contactListId);
    if (!list || list.contacts.length === 0) throw new Error('Liste de contacts vide');

    // Generer les emails pour le premier contact (les memes seront personalises pour chaque contact a l'envoi)
    const sampleContact = list.contacts[0];
    const emailTemplates = await this.claude.generateSequenceEmails(
      sampleContact, context, totalSteps
    );

    // Construire les steps de la campagne
    const steps = [];
    const now = new Date();
    for (let i = 0; i < emailTemplates.length; i++) {
      const scheduledDate = new Date(now.getTime() + (i * intervalDays * 24 * 60 * 60 * 1000));
      steps.push({
        stepNumber: i + 1,
        subjectTemplate: emailTemplates[i].subject,
        bodyTemplate: emailTemplates[i].body,
        delayDays: i === 0 ? 0 : intervalDays,
        status: 'pending',
        scheduledAt: scheduledDate.toISOString(),
        sentAt: null,
        sentCount: 0,
        errorCount: 0
      });
    }

    storage.updateCampaign(campaignId, { steps: steps });
    return steps;
  }

  async startCampaign(campaignId) {
    const campaign = storage.getCampaign(campaignId);
    if (!campaign) throw new Error('Campagne introuvable');
    if (campaign.steps.length === 0) throw new Error('Aucun email genere pour cette campagne');

    storage.updateCampaign(campaignId, {
      status: 'active',
      currentStep: 1,
      startedAt: new Date().toISOString()
    });

    // Executer la premiere etape immediatement
    return await this.executeCampaignStep(campaignId, 1);
  }

  async executeCampaignStep(campaignId, stepNumber) {
    const campaign = storage.getCampaign(campaignId);
    if (!campaign || campaign.status !== 'active') return { sent: 0, errors: 0, skipped: 0 };

    const step = campaign.steps.find(s => s.stepNumber === stepNumber);
    if (!step || step.status === 'completed') return { sent: 0, errors: 0, skipped: 0 };

    // FIX 4 : Verifier heures bureau avant d'envoyer
    if (!isBusinessHours()) {
      log.info('campaign-engine', 'Hors heures bureau — envoi reporte au prochain cycle');
      return { sent: 0, errors: 0, skipped: 0, postponed: true };
    }

    const list = storage.getContactList(campaign.contactListId);
    if (!list) return { sent: 0, errors: 0, skipped: 0 };

    step.status = 'sending';
    storage.updateCampaign(campaignId, { steps: campaign.steps });

    let sent = 0;
    let errors = 0;
    let skipped = 0;

    for (const contact of list.contacts) {
      // FIX 3 : Verifier quota warmup journalier
      const dailyLimit = getDailyLimit();
      const todaySent = storage.getTodaySendCount();
      if (todaySent >= dailyLimit) {
        log.info('campaign-engine', 'Quota warmup atteint (' + todaySent + '/' + dailyLimit + ') — envoi stoppe');
        break;
      }

      // FIX 4 : Re-verifier heures bureau (la boucle peut durer longtemps)
      if (!isBusinessHours()) {
        log.info('campaign-engine', 'Sortie heures bureau en cours d\'envoi — stop');
        break;
      }

      // FIX 2 : Verifier blacklist
      if (storage.isBlacklisted(contact.email)) {
        log.info('campaign-engine', 'Skip ' + contact.email + ' (blackliste)');
        skipped++;
        continue;
      }

      // FIX 16 : Verification MX du domaine avant envoi
      try {
        const hasMX = await _checkMX(contact.email);
        if (!hasMX) {
          const domain = (contact.email || '').split('@')[1];
          log.info('campaign-engine', 'Skip ' + contact.email + ' (pas de MX pour ' + domain + ') — ajoute au blacklist');
          storage.addToBlacklist(contact.email, 'no_mx_record');
          skipped++;
          continue;
        }
      } catch (mxErr) {
        // En cas d'erreur DNS, on laisse passer (pas de blocage)
        log.info('campaign-engine', 'MX check echoue pour ' + contact.email + ' (non bloquant): ' + mxErr.message);
      }

      // Verifier si l'email a deja ete envoye pour ce contact/step
      const existing = storage.getEmailsByCampaign(campaignId)
        .find(e => e.to === contact.email && e.stepNumber === stepNumber && e.status !== 'failed');
      if (existing) continue;

      // FIX 5 : Follow-up intelligent — skip si bounce ou reponse sur un email precedent
      if (stepNumber > 1) {
        const previousEmails = storage.getEmailsByCampaign(campaignId)
          .filter(e => e.to === contact.email && e.stepNumber < stepNumber);
        const lastEmail = previousEmails.length > 0 ? previousEmails[previousEmails.length - 1] : null;
        if (lastEmail) {
          if (lastEmail.status === 'bounced') {
            log.info('campaign-engine', 'Skip follow-up ' + contact.email + ' (bounce precedent)');
            // Ajouter au blacklist si bounce
            storage.addToBlacklist(contact.email, 'hard_bounce');
            skipped++;
            continue;
          }
          if (lastEmail.status === 'replied' || lastEmail.hasReplied) {
            log.info('campaign-engine', 'Skip follow-up ' + contact.email + ' (a deja repondu)');
            skipped++;
            continue;
          }
          if (lastEmail.skipFollowUp) {
            log.info('campaign-engine', 'Skip follow-up ' + contact.email + ' (skipFollowUp=true)');
            skipped++;
            continue;
          }
        }
      }

      // Personnaliser l'email pour ce contact
      let subject = step.subjectTemplate;
      let body = step.bodyTemplate;
      const firstName = contact.firstName || (contact.name || '').split(' ')[0] || '';
      const vars = {
        firstName: firstName,
        lastName: contact.lastName || '',
        name: contact.name || firstName,
        company: contact.company || '',
        title: contact.title || ''
      };
      for (const key of Object.keys(vars)) {
        const regex = new RegExp('\\{\\{' + key + '\\}\\}', 'g');
        subject = subject.replace(regex, vars[key]);
        body = body.replace(regex, vars[key]);
      }
      // Remplacer aussi les references au prenom dans le texte brut
      if (firstName && !body.includes(firstName)) {
        body = body.replace(/Bonjour\s*,/i, 'Bonjour ' + firstName + ',');
      }

      // FIX 12 : Personnalisation IA par Claude si le contact a des données enrichies
      if (contact.company || contact.title || contact.industry) {
        try {
          const personalized = await this.claude.personalizeEmail(subject, body, contact);
          if (personalized && personalized.subject && personalized.body) {
            subject = personalized.subject;
            body = personalized.body;
          }
        } catch (personalizeErr) {
          // Fallback : envoyer le template original si la personnalisation echoue
          log.info('campaign-engine', 'Personnalisation IA echouee pour ' + contact.email + ', envoi du template original: ' + personalizeErr.message);
        }
      }

      // FIX 13 : A/B testing — appliquer la variante du sujet si step 1
      if (stepNumber === 1 && !contact._abVariant) {
        contact._abVariant = Math.random() < 0.5 ? 'A' : 'B';
      }
      let abVariant = contact._abVariant || 'A';
      if (stepNumber === 1 && abVariant === 'B') {
        try {
          const variantSubject = await this.claude.generateSubjectVariant(subject);
          if (variantSubject && variantSubject.length > 3) {
            subject = variantSubject;
          }
        } catch (abErr) {
          log.info('campaign-engine', 'A/B variant generation echouee, sujet original conserve: ' + abErr.message);
          abVariant = 'A'; // Fallback sur variante A
        }
      }

      // Generer un tracking ID unique pour le pixel d'ouverture
      const trackingId = require('crypto').randomBytes(16).toString('hex');

      const result = await this.resend.sendEmail(contact.email, subject, body, {
        replyTo: 'hello@ifind.fr',
        fromName: 'Alexis',
        trackingId: trackingId,
        tags: [
          { name: 'campaign_id', value: campaignId },
          { name: 'step', value: String(stepNumber) }
        ]
      });

      const emailRecord = {
        chatId: campaign.chatId,
        campaignId: campaignId,
        stepNumber: stepNumber,
        to: contact.email,
        subject: subject,
        body: body,
        resendId: result.success ? result.id : null,
        trackingId: trackingId,
        status: result.success ? 'sent' : 'failed',
        abVariant: stepNumber === 1 ? abVariant : undefined
      };
      storage.addEmail(emailRecord);

      if (result.success) {
        sent++;
        // FIX 3 : Tracker envoi warmup + date du premier envoi
        storage.setFirstSendDate();
        storage.incrementTodaySendCount();
      } else {
        errors++;
        log.error('campaign-engine', 'Erreur envoi a ' + contact.email + ':', result.error);
      }

      // Rate limiting : 200ms entre chaque envoi
      await new Promise(r => setTimeout(r, 200));
    }

    // Mettre a jour le step
    step.status = 'completed';
    step.sentAt = new Date().toISOString();
    step.sentCount = sent;
    step.errorCount = errors;

    // Avancer le currentStep
    const nextStep = stepNumber + 1;
    const updates = { steps: campaign.steps, currentStep: nextStep };

    // Si c'etait le dernier step, marquer comme complete
    if (nextStep > campaign.steps.length) {
      updates.status = 'completed';
      updates.completedAt = new Date().toISOString();
    }

    storage.updateCampaign(campaignId, updates);

    return { sent, errors, skipped };
  }

  pauseCampaign(campaignId) {
    const campaign = storage.getCampaign(campaignId);
    if (!campaign || campaign.status !== 'active') return false;
    storage.updateCampaign(campaignId, { status: 'paused' });
    return true;
  }

  resumeCampaign(campaignId) {
    const campaign = storage.getCampaign(campaignId);
    if (!campaign || campaign.status !== 'paused') return false;
    storage.updateCampaign(campaignId, { status: 'active' });
    return true;
  }

  getCampaignStats(campaignId) {
    const campaign = storage.getCampaign(campaignId);
    if (!campaign) return null;

    const emails = storage.getEmailsByCampaign(campaignId);
    const sent = emails.filter(e => e.status === 'sent' || e.status === 'delivered').length;
    const delivered = emails.filter(e => e.status === 'delivered').length;
    const opened = emails.filter(e => e.status === 'opened').length;
    const bounced = emails.filter(e => e.status === 'bounced').length;
    const failed = emails.filter(e => e.status === 'failed').length;

    // FIX 13 : A/B testing stats
    const abResults = storage.getABTestResults(campaignId);

    return {
      campaign: campaign,
      emailStats: {
        total: emails.length,
        sent: sent,
        delivered: delivered,
        opened: opened,
        bounced: bounced,
        failed: failed,
        openRate: delivered > 0 ? Math.round((opened / delivered) * 100) : 0
      },
      abTestResults: abResults,
      stepStats: campaign.steps.map(s => ({
        stepNumber: s.stepNumber,
        status: s.status,
        sentCount: s.sentCount || 0,
        errorCount: s.errorCount || 0,
        scheduledAt: s.scheduledAt,
        sentAt: s.sentAt
      }))
    };
  }

  // --- Scheduler : verifie les campagnes toutes les 60s ---

  start() {
    log.info('campaign-engine', 'Scheduler demarre (intervalle: 60s)');
    this.schedulerInterval = setInterval(() => this._processScheduled(), 60 * 1000);
    // Premier check immediat
    this._processScheduled();
  }

  stop() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      log.info('campaign-engine', 'Scheduler arrete');
    }
  }

  async _processScheduled() {
    // FIX 4 : Ne pas traiter les campagnes hors heures bureau
    if (!isBusinessHours()) return;

    const now = new Date();
    const campaigns = storage.getAllCampaigns().filter(c => c.status === 'active');

    for (const campaign of campaigns) {
      for (const step of campaign.steps) {
        if (step.status !== 'pending') continue;

        const scheduledAt = new Date(step.scheduledAt);
        if (scheduledAt <= now) {
          log.info('campaign-engine', 'Execution campagne ' + campaign.name + ' step ' + step.stepNumber);
          try {
            const result = await this.executeCampaignStep(campaign.id, step.stepNumber);
            log.info('campaign-engine', 'Step ' + step.stepNumber + ' termine: ' + result.sent + ' envoyes, ' + result.errors + ' erreurs, ' + (result.skipped || 0) + ' skips');
          } catch (e) {
            log.error('campaign-engine', 'Erreur execution step:', e.message);
          }
          break; // Un step a la fois par campagne
        }
      }
    }
  }

  // --- Polling statut Resend ---

  async checkEmailStatuses() {
    const recentEmails = storage.getAllEmails()
      .filter(e => e.resendId && (e.status === 'sent' || e.status === 'queued' || e.status === 'delivered' || e.status === 'opened'))
      .slice(-100); // Verifier les 100 derniers

    let bounceCount = 0;
    let replyCount = 0;
    let complainCount = 0;
    let crmSyncCount = 0;

    for (const email of recentEmails) {
      const result = await this.resend.getEmail(email.resendId);
      if (result.success && result.data.last_event) {
        const newStatus = result.data.last_event;
        if (newStatus !== email.status) {
          storage.updateEmailStatus(email.id, newStatus);

          // Tracking des ouvertures multiples (incrementer openCount)
          if (newStatus === 'opened') {
            const openCount = (email.openCount || 0) + 1;
            storage.updateEmailStatus(email.id, newStatus, { openCount: openCount, openedAt: email.openedAt || new Date().toISOString() });
          }

          // Tracking des clics
          if (newStatus === 'clicked') {
            storage.updateEmailStatus(email.id, newStatus, { clickedAt: new Date().toISOString() });
          }

          // FIX 14 : Bounce handling automatique
          if (newStatus === 'bounced') {
            storage.addToBlacklist(email.to, 'hard_bounce');
            bounceCount++;
            log.info('campaign-engine', 'Bounce detecte: ' + email.to + ' — ajoute au blacklist');
          }

          // UPGRADE 2 : Detection de reponses email
          if (newStatus === 'replied') {
            storage.markAsReplied(email.id);
            replyCount++;
            log.info('campaign-engine', 'Reponse detectee: ' + email.to + ' — follow-ups arretes');

            // Mettre a jour le deal HubSpot si le contact y est associe
            try {
              await this._updateDealOnReply(email);
            } catch (dealErr) {
              log.warn('campaign-engine', 'Mise a jour deal HubSpot echouee pour ' + email.to + ': ' + dealErr.message);
            }
          }

          // Complaint (spam) handling
          if (newStatus === 'complained') {
            storage.addToBlacklist(email.to, 'spam_complaint');
            complainCount++;
            log.info('campaign-engine', 'Complaint detecte: ' + email.to + ' — ajoute au blacklist');
          }

          // FIX 15 : Sync evenement email vers HubSpot CRM
          if (CRM_SYNC_STATUSES.includes(newStatus) && !email.crmSynced) {
            try {
              await this._syncEmailEventToCRM(email, newStatus);
              // Marquer comme synced pour ne pas re-envoyer
              storage.updateEmailStatus(email.id, newStatus, { crmSynced: true });
              crmSyncCount++;
            } catch (crmErr) {
              // Ne jamais crasher si HubSpot echoue
              log.warn('campaign-engine', 'CRM sync echoue pour ' + email.to + ': ' + crmErr.message);
            }
          }
        }
      }
      await new Promise(r => setTimeout(r, 100)); // Rate limit
    }

    if (bounceCount > 0) {
      log.info('campaign-engine', 'checkEmailStatuses: ' + bounceCount + ' bounce(s) traite(s)');
    }
    if (replyCount > 0) {
      log.info('campaign-engine', 'checkEmailStatuses: ' + replyCount + ' reponse(s) detectee(s)');
    }
    if (complainCount > 0) {
      log.info('campaign-engine', 'checkEmailStatuses: ' + complainCount + ' complaint(s) traite(s)');
    }
    if (crmSyncCount > 0) {
      log.info('campaign-engine', 'checkEmailStatuses: ' + crmSyncCount + ' evenement(s) synchronise(s) vers HubSpot');
    }
  }

  // --- UPGRADE 2 : Mettre a jour le deal HubSpot quand un lead repond ---

  async _updateDealOnReply(emailRecord) {
    const hubspot = _getHubSpotClient();
    if (!hubspot) return;

    // Chercher le contact dans HubSpot
    const contact = await hubspot.findContactByEmail(emailRecord.to);
    if (!contact || !contact.id) return;

    // Chercher les deals associes a ce contact
    try {
      const dealsResult = await hubspot.makeRequest(
        '/crm/v3/objects/contacts/' + contact.id + '/associations/deals',
        'GET'
      );
      const associatedDeals = (dealsResult.results || []);

      for (const assoc of associatedDeals) {
        const dealId = assoc.id || (assoc.toObjectId);
        if (!dealId) continue;

        try {
          const deal = await hubspot.getDeal(dealId);
          if (!deal) continue;

          // Avancer le deal a presentationscheduled sur reponse (une reponse = vrai engagement)
          const prospectingStages = ['appointmentscheduled', 'qualifiedtobuy', 'presentationscheduled'];
          if (prospectingStages.includes(deal.stage) && deal.stage !== 'presentationscheduled') {
            await hubspot.updateDeal(dealId, { dealstage: 'presentationscheduled' });
            log.info('campaign-engine', 'Deal ' + deal.name + ' avance a presentationscheduled suite a reponse de ' + emailRecord.to);
          }

          // Creer une note sur le deal
          const note = await hubspot.createNote(
            'Reponse email detectee de ' + emailRecord.to + '\n' +
            'Sujet : ' + (emailRecord.subject || '(sans sujet)') + '\n' +
            'Date : ' + new Date().toLocaleDateString('fr-FR') + '\n' +
            '[Detection automatique MoltBot]'
          );
          if (note && note.id) {
            await hubspot.associateNoteToDeal(note.id, dealId);
          }
        } catch (e) {
          log.warn('campaign-engine', 'Erreur mise a jour deal ' + dealId + ': ' + e.message);
        }
      }
    } catch (e) {
      log.warn('campaign-engine', 'Erreur recherche deals pour contact ' + contact.id + ': ' + e.message);
    }
  }

  // --- FIX 15 : Synchroniser un evenement email vers HubSpot ---

  async _syncEmailEventToCRM(emailRecord, newStatus) {
    const hubspot = _getHubSpotClient();
    if (!hubspot) return; // Pas de cle API HubSpot configuree

    // Chercher le contact dans HubSpot par email
    const contact = await hubspot.findContactByEmail(emailRecord.to);
    if (!contact || !contact.id) {
      // Contact pas dans HubSpot, rien a faire
      return;
    }

    // Formater la note
    const statusLabel = STATUS_LABELS[newStatus] || newStatus;
    const subject = emailRecord.subject || '(sans sujet)';
    const dateStr = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const noteBody = 'Email "' + subject + '" — ' + statusLabel + '\n' +
      'Destinataire : ' + emailRecord.to + '\n' +
      'Date : ' + dateStr + '\n' +
      (emailRecord.campaignId ? 'Campagne : ' + emailRecord.campaignId : '') +
      '\n[Sync automatique MoltBot]';

    // Creer la note et l'associer au contact
    const note = await hubspot.createNote(noteBody);
    if (note && note.id) {
      await hubspot.associateNoteToContact(note.id, contact.id);
      log.info('campaign-engine', 'Note CRM creee pour ' + emailRecord.to + ' — ' + statusLabel);
    }
  }
}

CampaignEngine.checkMX = _checkMX;
module.exports = CampaignEngine;
