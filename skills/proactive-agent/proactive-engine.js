// Proactive Agent - Moteur de crons autonome
// Gere les taches planifiees : rapports, alertes, monitoring

const { Cron } = require('croner');
const ReportGenerator = require('./report-generator.js');
const storage = require('./storage.js');
const log = require('../../gateway/logger.js');

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
      log.info('proactive-engine', 'Mode proactif desactive');
      return;
    }

    this.stop(); // Nettoyer les anciens crons
    this._loadSmartAlertTracker(); // Charger les alertes persistees

    const tz = 'Europe/Paris';
    const alerts = config.alerts;

    // Analyse nocturne — 2h
    if (alerts.nightlyAnalysis.enabled) {
      const h = alerts.nightlyAnalysis.hour || 2;
      const m = alerts.nightlyAnalysis.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' * * *', { timezone: tz }, () => this._nightlyAnalysis()));
      log.info('proactive-engine', 'Cron: analyse nocturne a ' + h + 'h' + (m > 0 ? String(m).padStart(2, '0') : ''));
    }

    // Rapport matinal — 8h
    if (alerts.morningReport.enabled) {
      const h = alerts.morningReport.hour || 8;
      const m = alerts.morningReport.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' * * *', { timezone: tz }, () => this._morningReport()));
      log.info('proactive-engine', 'Cron: rapport matinal a ' + h + 'h' + (m > 0 ? String(m).padStart(2, '0') : ''));
    }

    // Alertes pipeline — 9h
    if (alerts.pipelineAlerts.enabled) {
      const h = alerts.pipelineAlerts.hour || 9;
      const m = alerts.pipelineAlerts.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' * * *', { timezone: tz }, () => this._pipelineAlerts()));
      log.info('proactive-engine', 'Cron: alertes pipeline a ' + h + 'h' + (m > 0 ? String(m).padStart(2, '0') : ''));
    }

    // Rapport hebdomadaire — lundi 9h
    if (alerts.weeklyReport.enabled) {
      const dow = alerts.weeklyReport.dayOfWeek || 1;
      const h = alerts.weeklyReport.hour || 9;
      const m = alerts.weeklyReport.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' * * ' + dow, { timezone: tz }, () => this._weeklyReport()));
      log.info('proactive-engine', 'Cron: rapport hebdo (jour ' + dow + ' a ' + h + 'h)');
    }

    // Rapport mensuel — 1er du mois 9h
    if (alerts.monthlyReport.enabled) {
      const dom = alerts.monthlyReport.dayOfMonth || 1;
      const h = alerts.monthlyReport.hour || 9;
      const m = alerts.monthlyReport.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' ' + dom + ' * *', { timezone: tz }, () => this._monthlyReport()));
      log.info('proactive-engine', 'Cron: rapport mensuel (jour ' + dom + ' a ' + h + 'h)');
    }

    // Check emails — toutes les 30 min
    if (alerts.emailStatusCheck.enabled) {
      const interval = alerts.emailStatusCheck.intervalMinutes || 30;
      this.crons.push(new Cron('*/' + interval + ' * * * *', { timezone: tz }, () => this._emailStatusCheck()));
      log.info('proactive-engine', 'Cron: check emails toutes les ' + interval + ' min');
    }

    // Smart alerts — toutes les heures
    this.crons.push(new Cron('0 * * * *', { timezone: tz }, () => this._checkSmartAlerts()));
    log.info('proactive-engine', 'Cron: smart alerts toutes les heures');

    this.running = true;
    log.info('proactive-engine', 'Demarre avec ' + this.crons.length + ' crons');

    // Catch-up reports manques au restart
    const stats = storage.getStats();
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Rapport matinal manque ?
    if (alerts.morningReport.enabled) {
      if (!stats.lastMorningReport || !stats.lastMorningReport.startsWith(today)) {
        const parisHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(now));
        if (parisHour >= 8) {
          log.info('proactive-engine', 'Catch-up: rapport matinal manque, lancement...');
          setTimeout(() => this._morningReport().catch(e => log.error('proactive-engine', 'Catch-up morning error:', e.message)), 30000);
        }
      }
    }

    // Rapport hebdo manque ? (si on est le bon jour et pas de rapport cette semaine)
    if (alerts.weeklyReport.enabled) {
      const parisDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now); // YYYY-MM-DD
      const parisDayOfWeek = new Date(parisDate + 'T12:00:00').getDay(); // 0=dim, 1=lun
      if (parisDayOfWeek === (alerts.weeklyReport.dayOfWeek || 1)) {
        if (!stats.lastWeeklyReport || !stats.lastWeeklyReport.startsWith(parisDate)) {
          const parisHourW = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(now));
          if (parisHourW >= (alerts.weeklyReport.hour || 9)) {
            log.info('proactive-engine', 'Catch-up: rapport hebdo manque, lancement...');
            setTimeout(() => this._weeklyReport().catch(e => log.error('proactive-engine', 'Catch-up weekly error:', e.message)), 60000);
          }
        }
      }
    }
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

    log.info('proactive-engine', 'Analyse nocturne en cours...');
    try {
      const data = await this.reportGenerator.collectDailyData();
      const briefing = await this.reportGenerator.generateNightlyBriefing(data);

      if (briefing) {
        storage.saveNightlyBriefing(briefing);
        log.info('proactive-engine', 'Briefing nocturne sauvegarde');
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
      log.error('proactive-engine', 'Erreur analyse nocturne:', e.message);
    }
  }

  // --- Tache 2 : Rapport matinal (8h) ---

  async _morningReport() {
    const config = storage.getConfig();
    if (!config.enabled || !config.alerts.morningReport.enabled) return;

    log.info('proactive-engine', 'Generation rapport matinal...');
    try {
      const data = await this.reportGenerator.collectDailyData();
      const nightlyBriefing = storage.getNightlyBriefing();
      const report = await this.reportGenerator.generateMorningReport(data, nightlyBriefing);

      await this.sendTelegram(config.adminChatId, report);
      storage.logAlert('morning_report', report, { date: data.date });
      storage.updateStat('lastMorningReport', new Date().toISOString());

      log.info('proactive-engine', 'Rapport matinal envoye');
    } catch (e) {
      log.error('proactive-engine', 'Erreur rapport matinal:', e.message);
    }
  }

  // --- Tache 3 : Alertes pipeline (9h) ---

  async _pipelineAlerts() {
    const config = storage.getConfig();
    if (!config.enabled || !config.alerts.pipelineAlerts.enabled) return;

    log.info('proactive-engine', 'Verification pipeline...');
    try {
      const data = await this.reportGenerator.collectDailyData();
      const stagnant = data.hubspot.stagnantDeals;
      const urgent = data.hubspot.urgentDeals;

      if (stagnant.length === 0 && urgent.length === 0) {
        log.info('proactive-engine', 'Pipeline OK, pas d\'alerte');
        return;
      }

      const alert = await this.reportGenerator.generatePipelineAlerts(stagnant, urgent);
      if (alert) {
        await this.sendTelegram(config.adminChatId, alert);
        storage.logAlert('pipeline_alert', alert, { stagnant: stagnant.length, urgent: urgent.length });
        log.info('proactive-engine', 'Alerte pipeline envoyee (' + stagnant.length + ' stagnants, ' + urgent.length + ' urgents)');
      }
    } catch (e) {
      log.error('proactive-engine', 'Erreur alertes pipeline:', e.message);
    }
  }

  // --- Tache 4 : Rapport hebdomadaire (lundi 9h) ---

  async _weeklyReport() {
    const config = storage.getConfig();
    if (!config.enabled || !config.alerts.weeklyReport.enabled) return;

    log.info('proactive-engine', 'Generation rapport hebdomadaire...');
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

      log.info('proactive-engine', 'Rapport hebdomadaire envoye');
    } catch (e) {
      log.error('proactive-engine', 'Erreur rapport hebdomadaire:', e.message);
    }
  }

  // --- Tache 5 : Rapport mensuel (1er du mois) ---

  async _monthlyReport() {
    const config = storage.getConfig();
    if (!config.enabled || !config.alerts.monthlyReport.enabled) return;

    log.info('proactive-engine', 'Generation rapport mensuel...');
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

      log.info('proactive-engine', 'Rapport mensuel envoye');
    } catch (e) {
      log.error('proactive-engine', 'Erreur rapport mensuel:', e.message);
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
        try { automailerStorage.save(); } catch (e) {}
      }

      storage.updateStat('lastEmailCheck', new Date().toISOString());
      if (newOpens > 0) {
        log.info('proactive-engine', 'Email check: ' + newOpens + ' nouvelles ouvertures detectees');
      }
    } catch (e) {
      log.error('proactive-engine', 'Erreur email status check:', e.message);
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

    log.info('proactive-engine', 'Hot lead notifie: ' + email + ' (' + opens + ' opens)');
  }

  // --- Tache 7 : Smart Alerts (toutes les heures) ---

  async _checkSmartAlerts() {
    const config = storage.getConfig();
    if (!config.enabled) return;

    log.info('proactive-engine', 'Verification smart alerts...');
    let alertsSent = 0;

    // --- 1. Hot Lead Alert : 3+ ouvertures dans les dernieres 24h ---
    try {
      const automailerStorage = getAutomailerStorage();
      if (automailerStorage && automailerStorage.data) {
        const allEmails = automailerStorage.data.emails || [];
        const now = Date.now();
        const last24h = now - 24 * 60 * 60 * 1000;

        // Compter les ouvertures par destinataire dans les dernieres 24h
        const recentOpens = {};
        for (const email of allEmails) {
          if (email.openedAt && new Date(email.openedAt).getTime() > last24h) {
            const to = (email.to || '').toLowerCase();
            if (!to) continue;
            recentOpens[to] = (recentOpens[to] || 0) + 1;
          }
        }

        for (const [email, opens] of Object.entries(recentOpens)) {
          if (opens >= (config.thresholds.hotLeadOpens || 3)) {
            if (!this._isAlertAlreadySent('hot_lead_24h', email)) {
              // Chercher info sur le lead
              let leadInfo = '';
              try {
                const leStorage = getLeadEnrichStorage();
                if (leStorage && leStorage.data) {
                  const lead = (leStorage.data.enrichedLeads || {})[email];
                  if (lead) {
                    const p = (lead.enrichData && lead.enrichData.person) || (lead.apolloData && lead.apolloData.person) || {};
                    const o = (lead.enrichData && lead.enrichData.organization) || (lead.apolloData && lead.apolloData.organization) || {};
                    leadInfo = (p.fullName || '') + ' — ' + (p.title || '') + ' chez ' + (o.name || '') + ' (score: ' + ((lead.aiClassification || {}).score || '?') + '/10)';
                  }
                }
              } catch (e) {}

              const alert = await this.reportGenerator.generateHotLeadAlert(email, opens, leadInfo);
              await this.sendTelegram(config.adminChatId, alert);
              this._markAlertSent('hot_lead_24h', email);
              storage.logAlert('smart_hot_lead', alert, { email, opens });
              alertsSent++;
              log.info('proactive-engine', 'Smart alert: hot lead ' + email + ' (' + opens + ' opens/24h)');
            }
          }
        }
      }
    } catch (e) {
      log.info('proactive-engine', 'Smart alert hot lead skip:', e.message);
    }

    // --- 2. Deal Stale Alert : deal inactif > 14 jours ---
    try {
      const { getModule: getM } = require('../../gateway/skill-loader.js');
      const HubSpotClient = getM('hubspot-client');
      if (HubSpotClient && this.hubspotKey) {
        const hubspot = new HubSpotClient(this.hubspotKey);
        const dealsResult = await hubspot.listDeals(100);
        const deals = dealsResult.deals || [];
        const now = Date.now();
        const staleDays = 14;

        for (const deal of deals) {
          if (deal.stage === 'closedwon' || deal.stage === 'closedlost') continue;
          const updatedAt = deal.updatedAt ? new Date(deal.updatedAt).getTime() : 0;
          const daysSinceUpdate = (now - updatedAt) / (1000 * 60 * 60 * 24);
          if (daysSinceUpdate > staleDays) {
            const alertKey = deal.id || deal.name;
            if (!this._isAlertAlreadySent('deal_stale', alertKey)) {
              const amount = parseFloat(deal.amount) || 0;
              const msg = '⚠️ *Deal stagnant* : *' + (deal.name || 'Sans nom') + '* (' + amount + ' EUR)\n' +
                'Pas de mouvement depuis ' + Math.round(daysSinceUpdate) + ' jours.\n' +
                'Etape : ' + (deal.stage || '?') + '\n\n' +
                '_Suggestion : relance le prospect ou mets a jour le statut du deal._';
              await this.sendTelegram(config.adminChatId, msg);
              this._markAlertSent('deal_stale', alertKey);
              storage.logAlert('smart_deal_stale', msg, { deal: deal.name, days: Math.round(daysSinceUpdate) });
              alertsSent++;
            }
          }
        }
      }
    } catch (e) {
      log.info('proactive-engine', 'Smart alert deal stale skip:', e.message);
    }

    // --- 3. Budget Warning : depense API > 80% du budget journalier ---
    try {
      const appConfig = require('../../gateway/app-config.js');
      const budgetStatus = appConfig.getBudgetStatus();
      const spent = budgetStatus.todaySpent || 0;
      const limit = budgetStatus.dailyLimit || 5;
      const ratio = limit > 0 ? spent / limit : 0;

      if (ratio >= 0.8) {
        const todayKey = new Date().toISOString().split('T')[0];
        if (!this._isAlertAlreadySent('budget_warning', todayKey)) {
          const msg = '💰 *Alerte budget API* : ' + spent.toFixed(2) + '$ / ' + limit.toFixed(2) + '$ (' + Math.round(ratio * 100) + '% utilise)\n\n' +
            '_Le budget journalier est presque epuise. Les appels API seront bloques a 100%._';
          await this.sendTelegram(config.adminChatId, msg);
          this._markAlertSent('budget_warning', todayKey);
          storage.logAlert('smart_budget_warning', msg, { spent: spent.toFixed(2), limit: limit.toFixed(2), ratio: Math.round(ratio * 100) });
          alertsSent++;
        }
      }
    } catch (e) {
      log.info('proactive-engine', 'Smart alert budget skip:', e.message);
    }

    // --- 4. Campaign End Alert : campagne vient de terminer ---
    try {
      const automailerStorage = getAutomailerStorage();
      if (automailerStorage && automailerStorage.data) {
        const campaigns = Object.values(automailerStorage.data.campaigns || {});
        const now = Date.now();
        const last2h = now - 2 * 60 * 60 * 1000;

        for (const camp of campaigns) {
          if (camp.status === 'completed' && camp.completedAt) {
            const completedTime = new Date(camp.completedAt).getTime();
            if (completedTime > last2h) {
              const alertKey = camp.id;
              if (!this._isAlertAlreadySent('campaign_end', alertKey)) {
                // Recuperer les stats de la campagne
                const campEmails = (automailerStorage.data.emails || []).filter(e => e.campaignId === camp.id);
                const sent = campEmails.length;
                const opened = campEmails.filter(e => e.status === 'opened' || e.openedAt).length;
                const bounced = campEmails.filter(e => e.status === 'bounced').length;
                const openRate = sent > 0 ? Math.round(opened / sent * 100) : 0;

                const msg = '📧 *Campagne terminee* : *' + (camp.name || 'Sans nom') + '*\n\n' +
                  'Emails envoyes : ' + sent + '\n' +
                  'Ouverts : ' + opened + ' (' + openRate + '%)\n' +
                  'Bounced : ' + bounced + '\n\n' +
                  '_Consulte le dashboard pour les details._';
                await this.sendTelegram(config.adminChatId, msg);
                this._markAlertSent('campaign_end', alertKey);
                storage.logAlert('smart_campaign_end', msg, { campaign: camp.name, sent, opened, openRate });
                alertsSent++;
              }
            }
          }
        }
      }
    } catch (e) {
      log.info('proactive-engine', 'Smart alert campaign end skip:', e.message);
    }

    // --- 5. Anomaly Detection : taux de bounce > 10% sur les dernieres 24h ---
    try {
      const automailerStorage = getAutomailerStorage();
      if (automailerStorage && automailerStorage.data) {
        const allEmails = automailerStorage.data.emails || [];
        const now = Date.now();
        const last24h = now - 24 * 60 * 60 * 1000;

        const recentEmails = allEmails.filter(e => e.sentAt && new Date(e.sentAt).getTime() > last24h);
        if (recentEmails.length >= 5) { // Seuil minimum pour eviter les faux positifs
          const bouncedCount = recentEmails.filter(e => e.status === 'bounced').length;
          const bounceRate = Math.round(bouncedCount / recentEmails.length * 100);

          if (bounceRate > 10) {
            const todayKey = new Date().toISOString().split('T')[0];
            if (!this._isAlertAlreadySent('bounce_anomaly', todayKey)) {
              const msg = '🔴 *Anomalie detectee* : taux de bounce a ' + bounceRate + '% (' + bouncedCount + '/' + recentEmails.length + ' emails)\n\n' +
                '_Possible probleme de domaine ou de liste de contacts. Verifie la configuration du domaine Resend et la qualite des adresses._';
              await this.sendTelegram(config.adminChatId, msg);
              this._markAlertSent('bounce_anomaly', todayKey);
              storage.logAlert('smart_bounce_anomaly', msg, { bounceRate, bouncedCount, total: recentEmails.length });
              alertsSent++;
            }
          }
        }
      }
    } catch (e) {
      log.info('proactive-engine', 'Smart alert bounce anomaly skip:', e.message);
    }

    if (alertsSent > 0) {
      log.info('proactive-engine', 'Smart alerts: ' + alertsSent + ' alerte(s) envoyee(s)');
    }
  }

  // --- Helpers pour deduplication des alertes ---

  _isAlertAlreadySent(type, key) {
    if (!this._smartAlertTracker) this._smartAlertTracker = {};
    const fullKey = type + ':' + key;
    const sentAt = this._smartAlertTracker[fullKey];
    if (!sentAt) return false;

    // Expiration : 24h pour la plupart, 7j pour deal_stale
    const expiryMs = type === 'deal_stale' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    if (Date.now() - sentAt > expiryMs) {
      delete this._smartAlertTracker[fullKey];
      return false;
    }
    return true;
  }

  _markAlertSent(type, key) {
    if (!this._smartAlertTracker) this._smartAlertTracker = {};
    this._smartAlertTracker[type + ':' + key] = Date.now();

    // Aussi persister dans storage pour survie au restart
    if (!storage.data.lastAlertSent) storage.data.lastAlertSent = {};
    storage.data.lastAlertSent[type + ':' + key] = new Date().toISOString();
    // Nettoyer les vieilles entrees (garder max 200)
    const keys = Object.keys(storage.data.lastAlertSent);
    if (keys.length > 200) {
      const toRemove = keys.slice(0, keys.length - 200);
      for (const k of toRemove) delete storage.data.lastAlertSent[k];
    }
    try { storage._save(); } catch (e) {}
  }

  _loadSmartAlertTracker() {
    // Charger les alertes persistees depuis le storage
    if (!this._smartAlertTracker) this._smartAlertTracker = {};
    const persisted = storage.data.lastAlertSent || {};
    for (const [key, isoDate] of Object.entries(persisted)) {
      this._smartAlertTracker[key] = new Date(isoDate).getTime();
    }
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

  async triggerSmartAlerts() {
    return this._checkSmartAlerts();
  }
}

module.exports = ProactiveEngine;
