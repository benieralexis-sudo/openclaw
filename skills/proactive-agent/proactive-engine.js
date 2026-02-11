// Proactive Agent - Moteur de crons autonome
// Gere les taches planifiees : rapports, alertes, monitoring

const { Cron } = require('croner');
const ReportGenerator = require('./report-generator.js');
const storage = require('./storage.js');

// Cross-skill imports
function getResendClient() {
  try { return require('../automailer/resend-client.js'); }
  catch (e) {
    try { return require('/app/skills/automailer/resend-client.js'); }
    catch (e2) { return null; }
  }
}

function getAutomailerStorage() {
  try { return require('../automailer/storage.js'); }
  catch (e) {
    try { return require('/app/skills/automailer/storage.js'); }
    catch (e2) { return null; }
  }
}

function getFlowfastStorage() {
  try { return require('../flowfast/storage.js'); }
  catch (e) {
    try { return require('/app/skills/flowfast/storage.js'); }
    catch (e2) { return null; }
  }
}

function getLeadEnrichStorage() {
  try { return require('../lead-enrich/storage.js'); }
  catch (e) {
    try { return require('/app/skills/lead-enrich/storage.js'); }
    catch (e2) { return null; }
  }
}

class ProactiveEngine {
  constructor(options) {
    this.sendTelegram = options.sendTelegram;
    this.callClaude = options.callClaude;
    this.hubspotKey = options.hubspotKey;
    this.resendKey = options.resendKey;
    this.senderEmail = options.senderEmail;

    this.reportGenerator = new ReportGenerator({
      callClaude: options.callClaude,
      callClaudeOpus: options.callClaudeOpus,
      hubspotKey: options.hubspotKey,
      resendKey: options.resendKey,
      senderEmail: options.senderEmail
    });

    this.crons = [];
    this.running = false;
  }

  start() {
    const config = storage.getConfig();
    if (!config.enabled) {
      console.log('[proactive-engine] Mode proactif desactive');
      return;
    }

    this.stop(); // Nettoyer les anciens crons

    const tz = 'Europe/Paris';
    const alerts = config.alerts;

    // Analyse nocturne — 2h
    if (alerts.nightlyAnalysis.enabled) {
      const h = alerts.nightlyAnalysis.hour || 2;
      const m = alerts.nightlyAnalysis.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' * * *', { timezone: tz }, () => this._nightlyAnalysis()));
      console.log('[proactive-engine] Cron: analyse nocturne a ' + h + 'h' + (m > 0 ? String(m).padStart(2, '0') : ''));
    }

    // Rapport matinal — 8h
    if (alerts.morningReport.enabled) {
      const h = alerts.morningReport.hour || 8;
      const m = alerts.morningReport.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' * * *', { timezone: tz }, () => this._morningReport()));
      console.log('[proactive-engine] Cron: rapport matinal a ' + h + 'h' + (m > 0 ? String(m).padStart(2, '0') : ''));
    }

    // Alertes pipeline — 9h
    if (alerts.pipelineAlerts.enabled) {
      const h = alerts.pipelineAlerts.hour || 9;
      const m = alerts.pipelineAlerts.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' * * *', { timezone: tz }, () => this._pipelineAlerts()));
      console.log('[proactive-engine] Cron: alertes pipeline a ' + h + 'h' + (m > 0 ? String(m).padStart(2, '0') : ''));
    }

    // Rapport hebdomadaire — lundi 9h
    if (alerts.weeklyReport.enabled) {
      const dow = alerts.weeklyReport.dayOfWeek || 1;
      const h = alerts.weeklyReport.hour || 9;
      const m = alerts.weeklyReport.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' * * ' + dow, { timezone: tz }, () => this._weeklyReport()));
      console.log('[proactive-engine] Cron: rapport hebdo (jour ' + dow + ' a ' + h + 'h)');
    }

    // Rapport mensuel — 1er du mois 9h
    if (alerts.monthlyReport.enabled) {
      const dom = alerts.monthlyReport.dayOfMonth || 1;
      const h = alerts.monthlyReport.hour || 9;
      const m = alerts.monthlyReport.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' ' + dom + ' * *', { timezone: tz }, () => this._monthlyReport()));
      console.log('[proactive-engine] Cron: rapport mensuel (jour ' + dom + ' a ' + h + 'h)');
    }

    // Check emails — toutes les 30 min
    if (alerts.emailStatusCheck.enabled) {
      const interval = alerts.emailStatusCheck.intervalMinutes || 30;
      this.crons.push(new Cron('*/' + interval + ' * * * *', { timezone: tz }, () => this._emailStatusCheck()));
      console.log('[proactive-engine] Cron: check emails toutes les ' + interval + ' min');
    }

    this.running = true;
    console.log('[proactive-engine] Demarre avec ' + this.crons.length + ' crons');
  }

  stop() {
    for (const cron of this.crons) {
      try { cron.stop(); } catch (e) {}
    }
    this.crons = [];
    this.running = false;
  }

  restart() {
    this.stop();
    this.start();
  }

  getStatus() {
    const config = storage.getConfig();
    const stats = storage.getStats();
    return {
      enabled: config.enabled,
      running: this.running,
      activeCrons: this.crons.length,
      alerts: config.alerts,
      thresholds: config.thresholds,
      stats: stats,
      nextRuns: this.crons.map(c => {
        const next = c.nextRun();
        return next ? next.toISOString() : 'N/A';
      })
    };
  }

  // --- Tache 1 : Analyse nocturne (2h) ---

  async _nightlyAnalysis() {
    const config = storage.getConfig();
    if (!config.enabled || !config.alerts.nightlyAnalysis.enabled) return;

    console.log('[proactive-engine] Analyse nocturne en cours...');
    try {
      const data = await this.reportGenerator.collectDailyData();
      const briefing = await this.reportGenerator.generateNightlyBriefing(data);

      if (briefing) {
        storage.saveNightlyBriefing(briefing);
        console.log('[proactive-engine] Briefing nocturne sauvegarde');
      }

      // Sauvegarder le snapshot quotidien
      storage.saveDailySnapshot({
        hubspot: { contacts: data.hubspot.contacts, pipeline: data.hubspot.pipeline, deals: data.hubspot.deals.length },
        emails: data.emails,
        leads: data.leads,
        content: data.content,
        invoices: data.invoices
      });
    } catch (e) {
      console.error('[proactive-engine] Erreur analyse nocturne:', e.message);
    }
  }

  // --- Tache 2 : Rapport matinal (8h) ---

  async _morningReport() {
    const config = storage.getConfig();
    if (!config.enabled || !config.alerts.morningReport.enabled) return;

    console.log('[proactive-engine] Generation rapport matinal...');
    try {
      const data = await this.reportGenerator.collectDailyData();
      const nightlyBriefing = storage.getNightlyBriefing();
      const report = await this.reportGenerator.generateMorningReport(data, nightlyBriefing);

      await this.sendTelegram(config.adminChatId, report);
      storage.logAlert('morning_report', report, { date: data.date });
      storage.updateStat('lastMorningReport', new Date().toISOString());

      console.log('[proactive-engine] Rapport matinal envoye');
    } catch (e) {
      console.error('[proactive-engine] Erreur rapport matinal:', e.message);
    }
  }

  // --- Tache 3 : Alertes pipeline (9h) ---

  async _pipelineAlerts() {
    const config = storage.getConfig();
    if (!config.enabled || !config.alerts.pipelineAlerts.enabled) return;

    console.log('[proactive-engine] Verification pipeline...');
    try {
      const data = await this.reportGenerator.collectDailyData();
      const stagnant = data.hubspot.stagnantDeals;
      const urgent = data.hubspot.urgentDeals;

      if (stagnant.length === 0 && urgent.length === 0) {
        console.log('[proactive-engine] Pipeline OK, pas d\'alerte');
        return;
      }

      const alert = await this.reportGenerator.generatePipelineAlerts(stagnant, urgent);
      if (alert) {
        await this.sendTelegram(config.adminChatId, alert);
        storage.logAlert('pipeline_alert', alert, { stagnant: stagnant.length, urgent: urgent.length });
        console.log('[proactive-engine] Alerte pipeline envoyee (' + stagnant.length + ' stagnants, ' + urgent.length + ' urgents)');
      }
    } catch (e) {
      console.error('[proactive-engine] Erreur alertes pipeline:', e.message);
    }
  }

  // --- Tache 4 : Rapport hebdomadaire (lundi 9h) ---

  async _weeklyReport() {
    const config = storage.getConfig();
    if (!config.enabled || !config.alerts.weeklyReport.enabled) return;

    console.log('[proactive-engine] Generation rapport hebdomadaire...');
    try {
      const data = await this.reportGenerator.collectWeeklyData();
      const report = await this.reportGenerator.generateWeeklyReport(data);

      await this.sendTelegram(config.adminChatId, report);
      storage.logAlert('weekly_report', report, { date: data.date });
      storage.saveWeeklySnapshot({
        date: data.date,
        hubspot: { contacts: data.hubspot.contacts, pipeline: data.hubspot.pipeline },
        emails: data.emails,
        leads: data.leads,
        invoices: data.invoices
      });
      storage.updateStat('lastWeeklyReport', new Date().toISOString());

      console.log('[proactive-engine] Rapport hebdomadaire envoye');
    } catch (e) {
      console.error('[proactive-engine] Erreur rapport hebdomadaire:', e.message);
    }
  }

  // --- Tache 5 : Rapport mensuel (1er du mois) ---

  async _monthlyReport() {
    const config = storage.getConfig();
    if (!config.enabled || !config.alerts.monthlyReport.enabled) return;

    console.log('[proactive-engine] Generation rapport mensuel...');
    try {
      const data = await this.reportGenerator.collectMonthlyData();
      const report = await this.reportGenerator.generateMonthlyReport(data);

      await this.sendTelegram(config.adminChatId, report);
      storage.logAlert('monthly_report', report, { date: data.date });
      storage.saveMonthlySnapshot({
        date: data.date,
        hubspot: { contacts: data.hubspot.contacts, pipeline: data.hubspot.pipeline },
        emails: data.emails,
        leads: data.leads,
        invoices: data.invoices
      });
      storage.updateStat('lastMonthlyReport', new Date().toISOString());

      console.log('[proactive-engine] Rapport mensuel envoye');
    } catch (e) {
      console.error('[proactive-engine] Erreur rapport mensuel:', e.message);
    }
  }

  // --- Tache 6 : Check statut emails (toutes les 30 min) ---

  async _emailStatusCheck() {
    const config = storage.getConfig();
    if (!config.enabled || !config.alerts.emailStatusCheck.enabled) return;

    try {
      const automailerStorage = getAutomailerStorage();
      if (!automailerStorage || !automailerStorage.data) return;

      const ResendClient = getResendClient();
      if (!ResendClient || !this.resendKey) return;

      const resend = new ResendClient(this.resendKey, this.senderEmail);
      const allEmails = automailerStorage.data.emails || [];

      // Verifier les emails recents (derniers 50 max)
      const recentEmails = allEmails
        .filter(e => e.resendId && (e.status === 'sent' || e.status === 'delivered' || e.status === 'queued'))
        .slice(-50);

      let newOpens = 0;

      for (const email of recentEmails) {
        try {
          const status = await resend.getEmail(email.resendId);
          if (!status) continue;

          const newStatus = status.last_event || status.status;
          if (newStatus && newStatus !== email.status) {
            email.status = newStatus;

            if (newStatus === 'opened') {
              newOpens++;
              const tracked = storage.trackEmailOpen(email.to, email.resendId);

              // Detecter hot lead
              if (tracked.opens >= config.thresholds.hotLeadOpens && !storage.isHotLeadNotified(email.to)) {
                await this._notifyHotLead(email.to, tracked.opens);
              }
            }
          }

          // Rate limit
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          // Silently skip individual email errors
        }
      }

      // Sauvegarder les mises a jour
      if (newOpens > 0) {
        try { automailerStorage._save(); } catch (e) {}
      }

      storage.updateStat('lastEmailCheck', new Date().toISOString());
      if (newOpens > 0) {
        console.log('[proactive-engine] Email check: ' + newOpens + ' nouvelles ouvertures detectees');
      }
    } catch (e) {
      console.error('[proactive-engine] Erreur email status check:', e.message);
    }
  }

  // --- Notification hot lead ---

  async _notifyHotLead(email, opens) {
    const config = storage.getConfig();

    // Chercher des infos sur le lead dans les storages
    let leadInfo = '';
    try {
      const ffStorage = getFlowfastStorage();
      if (ffStorage) {
        const leads = ffStorage.getAllLeads ? ffStorage.getAllLeads() : {};
        const lead = leads[email];
        if (lead) {
          leadInfo = (lead.nom || '') + ' — ' + (lead.titre || '') + ' chez ' + (lead.entreprise || '') + ' (score: ' + (lead.score || '?') + '/10)';
        }
      }
    } catch (e) {}

    try {
      const leStorage = getLeadEnrichStorage();
      if (leStorage && leStorage.data && !leadInfo) {
        const enriched = leStorage.data.leads || {};
        const lead = enriched[email];
        if (lead && lead.apolloData) {
          const p = lead.apolloData.person || {};
          const o = lead.apolloData.organization || {};
          leadInfo = (p.fullName || '') + ' — ' + (p.title || '') + ' chez ' + (o.name || '') + ' (score: ' + ((lead.aiClassification || {}).score || '?') + '/10)';
        }
      }
    } catch (e) {}

    const alert = await this.reportGenerator.generateHotLeadAlert(email, opens, leadInfo);
    await this.sendTelegram(config.adminChatId, alert);
    storage.markHotLeadNotified(email);
    storage.logAlert('hot_lead', alert, { email: email, opens: opens });

    console.log('[proactive-engine] Hot lead notifie: ' + email + ' (' + opens + ' opens)');
  }

  // --- Methodes publiques pour declenchement manuel ---

  async triggerMorningReport() {
    return this._morningReport();
  }

  async triggerWeeklyReport() {
    return this._weeklyReport();
  }

  async triggerMonthlyReport() {
    return this._monthlyReport();
  }
}

module.exports = ProactiveEngine;
