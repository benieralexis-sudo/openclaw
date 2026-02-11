// AutoMailer - Moteur de campagnes (sequences, scheduling, execution)
const storage = require('./storage');

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
    if (!campaign || campaign.status !== 'active') return { sent: 0, errors: 0 };

    const step = campaign.steps.find(s => s.stepNumber === stepNumber);
    if (!step || step.status === 'completed') return { sent: 0, errors: 0 };

    const list = storage.getContactList(campaign.contactListId);
    if (!list) return { sent: 0, errors: 0 };

    step.status = 'sending';
    storage.updateCampaign(campaignId, { steps: campaign.steps });

    let sent = 0;
    let errors = 0;

    for (const contact of list.contacts) {
      // Verifier si l'email a deja ete envoye pour ce contact/step
      const existing = storage.getEmailsByCampaign(campaignId)
        .find(e => e.to === contact.email && e.stepNumber === stepNumber && e.status !== 'failed');
      if (existing) continue;

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

      const result = await this.resend.sendEmail(contact.email, subject, body, {
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
        status: result.success ? 'sent' : 'failed'
      };
      storage.addEmail(emailRecord);

      if (result.success) {
        sent++;
      } else {
        errors++;
        console.error('[campaign-engine] Erreur envoi a ' + contact.email + ':', result.error);
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

    return { sent, errors };
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
    console.log('[campaign-engine] Scheduler demarre (intervalle: 60s)');
    this.schedulerInterval = setInterval(() => this._processScheduled(), 60 * 1000);
    // Premier check immediat
    this._processScheduled();
  }

  stop() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      console.log('[campaign-engine] Scheduler arrete');
    }
  }

  async _processScheduled() {
    const now = new Date();
    const campaigns = storage.getAllCampaigns().filter(c => c.status === 'active');

    for (const campaign of campaigns) {
      for (const step of campaign.steps) {
        if (step.status !== 'pending') continue;

        const scheduledAt = new Date(step.scheduledAt);
        if (scheduledAt <= now) {
          console.log('[campaign-engine] Execution campagne ' + campaign.name + ' step ' + step.stepNumber);
          try {
            const result = await this.executeCampaignStep(campaign.id, step.stepNumber);
            console.log('[campaign-engine] Step ' + step.stepNumber + ' termine: ' + result.sent + ' envoyes, ' + result.errors + ' erreurs');
          } catch (e) {
            console.error('[campaign-engine] Erreur execution step:', e.message);
          }
          break; // Un step a la fois par campagne
        }
      }
    }
  }

  // --- Polling statut Resend ---

  async checkEmailStatuses() {
    const recentEmails = storage.getAllEmails()
      .filter(e => e.resendId && (e.status === 'sent' || e.status === 'queued'))
      .slice(-100); // Verifier les 100 derniers

    for (const email of recentEmails) {
      const result = await this.resend.getEmail(email.resendId);
      if (result.success && result.data.last_event) {
        const newStatus = result.data.last_event;
        if (newStatus !== email.status) {
          storage.updateEmailStatus(email.id, newStatus);
        }
      }
      await new Promise(r => setTimeout(r, 100)); // Rate limit
    }
  }
}

module.exports = CampaignEngine;
