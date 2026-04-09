// Proactive Agent - Moteur de crons autonome
// Gere les taches planifiees : rapports, alertes, monitoring

const { Cron } = require('croner');
const ReportGenerator = require('./report-generator.js');
const storage = require('./storage.js');
const log = require('../../gateway/logger.js');
const { getWarmupDailyLimit, withCronGuard, applySpintax } = require('../../gateway/utils.js');

// Cross-skill imports via skill-loader centralise
const { getStorage, getModule } = require('../../gateway/skill-loader.js');

function getResendClient() { return getModule('resend-client'); }
function getAutomailerStorage() { return getStorage('automailer'); }
function getFlowfastStorage() { return getStorage('flowfast'); }
function getLeadEnrichStorage() { return getStorage('lead-enrich'); }
function getClaudeEmailWriter() { return getModule('claude-email-writer'); }
function getAPStorage() { return getStorage('autonomous-pilot'); }
function getCampaignEngine() { return getModule('campaign-engine'); }
function getWebIntelStorage() { return getStorage('web-intelligence'); }

class ProactiveEngine {
  constructor(options) {
    this.options = options;
    this.sendTelegram = options.sendTelegram;
    this.sendTelegramButtons = options.sendTelegramButtons || null;
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
      this.crons.push(new Cron(m + ' ' + h + ' * * *', { timezone: tz }, withCronGuard('pa-nightly', () => this._nightlyAnalysis())));
      log.info('proactive-engine', 'Cron: analyse nocturne a ' + h + 'h' + (m > 0 ? String(m).padStart(2, '0') : ''));
    }

    // Rapport matinal — 8h
    if (alerts.morningReport.enabled) {
      const h = alerts.morningReport.hour || 8;
      const m = alerts.morningReport.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' * * *', { timezone: tz }, withCronGuard('pa-morning', () => this._morningReport())));
      log.info('proactive-engine', 'Cron: rapport matinal a ' + h + 'h' + (m > 0 ? String(m).padStart(2, '0') : ''));
    }

    // Alertes pipeline — 9h30 (decale pour eviter embouteillage matinal)
    if (alerts.pipelineAlerts.enabled) {
      const h = alerts.pipelineAlerts.hour || 9;
      const m = alerts.pipelineAlerts.minute || 30;
      this.crons.push(new Cron(m + ' ' + h + ' * * *', { timezone: tz }, withCronGuard('pa-pipeline', () => this._pipelineAlerts())));
      log.info('proactive-engine', 'Cron: alertes pipeline a ' + h + 'h' + (m > 0 ? String(m).padStart(2, '0') : ''));
    }

    // Rapport hebdomadaire — lundi 11h (decale pour eviter surcharge matinale)
    if (alerts.weeklyReport.enabled) {
      const dow = alerts.weeklyReport.dayOfWeek || 1;
      const h = alerts.weeklyReport.hour || 11;
      const m = alerts.weeklyReport.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' * * ' + dow, { timezone: tz }, withCronGuard('pa-weekly', () => this._weeklyReport())));
      log.info('proactive-engine', 'Cron: rapport hebdo (jour ' + dow + ' a ' + h + 'h)');
    }

    // Rapport mensuel — 1er du mois 9h
    if (alerts.monthlyReport.enabled) {
      const dom = alerts.monthlyReport.dayOfMonth || 1;
      const h = alerts.monthlyReport.hour || 9;
      const m = alerts.monthlyReport.minute || 0;
      this.crons.push(new Cron(m + ' ' + h + ' ' + dom + ' * *', { timezone: tz }, withCronGuard('pa-monthly', () => this._monthlyReport())));
      log.info('proactive-engine', 'Cron: rapport mensuel (jour ' + dom + ' a ' + h + 'h)');
    }

    // Check emails — toutes les 30 min
    if (alerts.emailStatusCheck.enabled) {
      const interval = alerts.emailStatusCheck.intervalMinutes || 30;
      this.crons.push(new Cron('*/' + interval + ' * * * *', { timezone: tz }, withCronGuard('pa-email-status', () => this._emailStatusCheck())));
      log.info('proactive-engine', 'Cron: check emails toutes les ' + interval + ' min');
    }

    // Smart alerts — toutes les heures
    this.crons.push(new Cron('0 * * * *', { timezone: tz }, withCronGuard('pa-smart-alerts', () => this._checkSmartAlerts())));
    log.info('proactive-engine', 'Cron: smart alerts toutes les heures');

    // Reactive follow-ups — toutes les 10 min
    this.crons.push(new Cron('*/10 * * * *', { timezone: tz }, withCronGuard('pa-reactive-fu', () => this._processReactiveFollowUps())));
    log.info('proactive-engine', 'Cron: reactive follow-ups toutes les 10 min');

    // Lead Revival — mardi + vendredi 10h
    if (process.env.LEAD_REVIVAL_ENABLED !== 'false') {
      this.crons.push(new Cron('0 10 * * 2,5', { timezone: tz }, withCronGuard('pa-lead-revival', () => this._leadRevival())));
      log.info('proactive-engine', 'Cron: lead revival mardi+vendredi 10h');
    }

    // Job Change Detection — dimanche 22h
    if (process.env.JOB_CHANGE_ENABLED !== 'false') {
      this.crons.push(new Cron('0 22 * * 0', { timezone: tz }, withCronGuard('pa-job-change', () => this._jobChangeDetection())));
      log.info('proactive-engine', 'Cron: job change detection dimanche 22h');
    }

    // Multi-Threading : envoi des contacts secondaires (toutes les heures, heures bureau)
    if (process.env.MULTI_THREAD_ENABLED !== 'false') {
      this.crons.push(new Cron('30 9-17 * * 1-5', { timezone: tz }, withCronGuard('pa-multi-thread', () => this._processSecondaryEmails())));
      log.info('proactive-engine', 'Cron: multi-thread secondaires lun-ven 9h30-17h30');
    }

    // Website Visitor Digest — dimanche 20h
    if (process.env.VISITOR_TRACKING_ENABLED !== 'false') {
      this.crons.push(new Cron('0 20 * * 0', { timezone: tz }, withCronGuard('pa-visitor-digest', () => this._weeklyVisitorDigest())));
      log.info('proactive-engine', 'Cron: visitor digest dimanche 20h');
    }

    // Niche Health Monitor — tous les jours a 6h30
    this.crons.push(new Cron('30 6 * * *', { timezone: tz }, withCronGuard('pa-niche-health', () => this._nicheHealthScan())));
    log.info('proactive-engine', 'Cron: niche health scan quotidien a 6h30');

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

    log.info('proactive-engine', 'Generation rapport matinal unifie (PA + AP)...');
    try {
      const data = await this.reportGenerator.collectDailyData();
      const nightlyBriefing = storage.getNightlyBriefing();
      const report = await this.reportGenerator.generateMorningReport(data, nightlyBriefing);

      // --- Section Autonomous Pilot simplifiee (format business) ---
      let apSection = '';
      try {
        const apStorage = this._getAPStorage();
        if (apStorage) {
          const progress = apStorage.getProgress ? apStorage.getProgress() : {};
          const goals = apStorage.getGoals ? apStorage.getGoals() : {};
          const g = goals.weekly || {};
          const pctEmails = (g.emailsToSend || 0) > 0 ? Math.round(((progress.emailsSentThisWeek || 0) / g.emailsToSend) * 100) : 100;

          apSection += '\n\n🎯 *Cette semaine :*\n';
          apSection += '• Prospection a ' + Math.min(pctEmails, 100) + '%\n';
          if ((progress.responsesThisWeek || 0) > 0) {
            apSection += '• ' + progress.responsesThisWeek + ' reponse(s) recue(s)\n';
          }
          if ((progress.rdvBookedThisWeek || 0) > 0) {
            apSection += '• ' + progress.rdvBookedThisWeek + ' RDV pris\n';
          }
        }
      } catch (e) {
        log.info('proactive-engine', 'Enrichissement AP echoue (non bloquant):', e.message);
      }

      // --- Section Niche Health ---
      let nicheSection = '';
      try {
        const apStorage2 = this._getAPStorage();
        if (apStorage2 && apStorage2.getNicheHealth) {
          const nicheHealth = apStorage2.getNicheHealth();
          const warnings = [];
          for (const [slug, h] of Object.entries(nicheHealth)) {
            if (slug.startsWith('_')) continue;
            if (h.status === 'critical' || h.status === 'exhausted' || h.status === 'warning') {
              const emoji = h.status === 'exhausted' ? '🔴' : h.status === 'critical' ? '🟠' : '🟡';
              warnings.push(emoji + ' ' + slug + ' : ' + (h.exhaustionPct || 0) + '% (' + (h.contacted || 0) + '/' + (h.totalAvailable || '?') + ')');
            }
          }
          if (warnings.length > 0) {
            nicheSection = '\n\n⚠️ *Niches a surveiller :*\n' + warnings.join('\n');
          }
        }
      } catch (e) {}

      await this.sendTelegram(config.adminChatId, report + apSection + nicheSection);
      storage.logAlert('morning_report', report + apSection + nicheSection, { date: data.date });
      storage.updateStat('lastMorningReport', new Date().toISOString());

      log.info('proactive-engine', 'Rapport matinal unifie envoye');
    } catch (e) {
      log.error('proactive-engine', 'Erreur rapport matinal:', e.message);
    }
  }

  // --- Helper pour acceder au storage AP ---
  _getAPStorage() { return getAPStorage(); }

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

      const allEmails = automailerStorage.data.emails || [];
      let newOpens = 0;

      // Methode 1 : Verifier via Resend API (pour emails avec resendId)
      const ResendClient = getResendClient();
      if (ResendClient && this.resendKey) {
        const resend = new ResendClient(this.resendKey, this.senderEmail);
        const resendEmails = allEmails
          .filter(e => e.resendId && (e.status === 'sent' || e.status === 'delivered' || e.status === 'queued'))
          .slice(-50);

        for (const email of resendEmails) {
          try {
            const status = await resend.getEmail(email.resendId);
            if (!status) continue;

            const newStatus = status.last_event || status.status;
            if (newStatus && newStatus !== email.status) {
              email.status = newStatus;

              if (newStatus === 'opened') {
                newOpens++;
                const tracked = storage.trackEmailOpen(email.to, email.resendId);
                if (tracked.opens >= config.thresholds.hotLeadOpens && !storage.isHotLeadNotified(email.to)) {
                  await this._notifyHotLead(email.to, tracked.opens);
                }
              }
            }
            await new Promise(r => setTimeout(r, 100));
          } catch (e) {}
        }

        if (newOpens > 0) {
          try { automailerStorage.save(); } catch (e) { log.warn('proactive-engine', 'save echoue: ' + e.message); }
        }
      }

      // Methode 2 : Detecter les opens via tracking pixel (emails Gmail sans resendId)
      // Le tracking pixel met a jour status='opened' dans automailer — on synchronise avec hotLeads
      const openedEmails = allEmails.filter(e => e.status === 'opened' && e.to);
      for (const email of openedEmails) {
        const hotLeads = storage.data.hotLeads || {};
        if (!hotLeads[email.to]) {
          newOpens++;
          const tracked = storage.trackEmailOpen(email.to, email.trackingId || email.resendId || null);
          if (tracked.opens >= config.thresholds.hotLeadOpens && !storage.isHotLeadNotified(email.to)) {
            await this._notifyHotLead(email.to, tracked.opens);
          }
        }
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
        const enriched = leStorage.data.enrichedLeads || leStorage.data.leads || {};
        const lead = enriched[email] || enriched[(email || '').toLowerCase()];
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

    // Auto-creer un reactive follow-up accelere pour les hot leads (delai 15-30 min au lieu de 2-4h)
    if (opens >= 3 && !storage.hasReactiveFollowUp(email)) {
      try {
        const amStorage = getAutomailerStorage();
        if (amStorage) {
          const events = amStorage.getEmailEventsForRecipient ? amStorage.getEmailEventsForRecipient(email) : [];
          const lastSent = events.filter(e => e.status === 'sent' || e.status === 'delivered' || e.status === 'opened').pop();
          if (lastSent) {
            const delayMs = (15 + Math.random() * 15) * 60 * 1000; // 15-30 min
            const added = storage.addPendingFollowUp({
              prospectEmail: email,
              prospectName: (lastSent.contactName || '').substring(0, 100),
              prospectCompany: (lastSent.company || '').substring(0, 100),
              originalEmailId: lastSent.id || null,
              originalSubject: (lastSent.subject || '').substring(0, 200),
              originalBody: (lastSent.body || '').substring(0, 500),
              prospectIntel: leadInfo,
              scheduledAfter: new Date(Date.now() + delayMs).toISOString()
            });
            if (added) {
              log.info('proactive-engine', 'Reactive FU accelere programme pour hot lead ' + email + ' (delai ~20min)');
            }
          }
        }
      } catch (fuErr) {
        log.info('proactive-engine', 'Auto reactive FU skip pour hot lead: ' + fuErr.message);
      }
    }
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

    // --- 6. Web Intelligence : articles urgents avec match CRM ---
    try {
      const wiStorage = getWebIntelStorage();
      if (wiStorage && wiStorage.getRecentArticles) {
        const recentArticles = wiStorage.getRecentArticles(50);
        const urgentWithCRM = recentArticles.filter(a =>
          a.isUrgent === true && (a.relevanceScore || 0) >= 8 && a.crmMatch
        );

        for (const article of urgentWithCRM.slice(0, 3)) {
          const alertKey = 'wi_urgent:' + (article.id || article.title.substring(0, 30));
          if (!this._isAlertAlreadySent('wi_urgent', alertKey)) {
            const company = article.crmMatch ? (article.crmMatch.company || '') : '';
            const msg = '*VEILLE URGENTE* : ' + (article.title || '').substring(0, 100) + '\n' +
              'Source: ' + (article.source || '?') + ' | Score: ' + article.relevanceScore + '/10\n' +
              (company ? 'Match CRM: ' + company + '\n' : '') +
              '_Action recommandee : contacter ce prospect avec cette actu comme accroche_';
            await this.sendTelegram(config.adminChatId, msg);
            this._markAlertSent('wi_urgent', alertKey);
            storage.logAlert('smart_wi_urgent', msg, { title: article.title, score: article.relevanceScore, company });
            alertsSent++;
          }
        }
      }
    } catch (e) {
      log.info('proactive-engine', 'Smart alert WI urgent skip:', e.message);
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
    try { storage._save(); } catch (e) { log.warn('proactive-engine', 'storage save echoue: ' + e.message); }
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

  // --- Tache : Lead Revival (mardi + vendredi 10h) ---

  async _leadRevival() {
    log.info('proactive-engine', 'Lead Revival: scan des leads inactifs...');

    try {
      const amStorage = this._getAutomailerStorage();
      if (!amStorage || !amStorage.getRevivalCandidates) {
        log.warn('proactive-engine', 'Lead Revival: automailer storage non disponible');
        return;
      }

      const revivalConfig = storage.getRevivalConfig();
      if (!revivalConfig.enabled) {
        log.info('proactive-engine', 'Lead Revival: desactive');
        return;
      }

      const candidates = amStorage.getRevivalCandidates({
        minDaysOpened: revivalConfig.minDaysSinceLastContact || 30,
        minDaysNotNow: revivalConfig.minDaysSinceNotNow || 45,
        minDaysHotStale: 21
      });

      if (candidates.length === 0) {
        log.info('proactive-engine', 'Lead Revival: aucun candidat trouve');
        return;
      }

      log.info('proactive-engine', 'Lead Revival: ' + candidates.length + ' candidats trouves');

      const maxPerCycle = revivalConfig.maxPerCycle || 5;
      let sent = 0;
      const revived = [];

      for (const candidate of candidates) {
        if (sent >= maxPerCycle) break;

        // Verifier pas deja revived dans les 90 derniers jours
        if (storage.isAlreadyRevived(candidate.email)) {
          log.info('proactive-engine', 'Lead Revival: ' + candidate.email + ' deja revived recemment — skip');
          continue;
        }

        // Verifier pas hard-blackliste
        if (amStorage.isHardBlacklisted && amStorage.isHardBlacklisted(candidate.email)) {
          log.info('proactive-engine', 'Lead Revival: ' + candidate.email + ' hard-blackliste — skip');
          continue;
        }

        // Pour les "not_now", retirer temporairement de la blacklist
        let wasBlacklisted = false;
        if (candidate.reason === 'not_now_expired' && amStorage.isBlacklisted(candidate.email)) {
          wasBlacklisted = true;
          amStorage.removeFromBlacklist(candidate.email);
          log.info('proactive-engine', 'Lead Revival: ' + candidate.email + ' temporairement retire de la blacklist');
        }

        try {
          // Generer et envoyer un email revival via le pipeline action-executor
          const ActionExecutor = this._getActionExecutor();
          if (!ActionExecutor) {
            log.warn('proactive-engine', 'Lead Revival: ActionExecutor non disponible');
            break;
          }

          const executor = new ActionExecutor({
            claudeKey: this.options.claudeKey || process.env.CLAUDE_API_KEY,
            resendKey: this.options.resendKey || process.env.RESEND_API_KEY,
            senderEmail: this.options.senderEmail || process.env.SENDER_EMAIL
          });

          const daysAgo = Math.floor((Date.now() - new Date(candidate.lastContactAt).getTime()) / (24 * 60 * 60 * 1000));
          const REASON_LABELS = {
            opened_no_reply: 'a ouvert ton email ' + candidate.openCount + ' fois mais jamais repondu (il y a ' + daysAgo + 'j)',
            not_now_expired: 'avait dit "pas le bon moment" il y a ' + daysAgo + 'j',
            hot_lead_stale: 'prospect chaud (' + candidate.openCount + ' ouvertures) devenu inactif depuis ' + daysAgo + 'j'
          };

          const result = await executor.executeAction({
            type: 'send_email',
            params: {
              to: candidate.email,
              contactName: candidate.name,
              company: candidate.company,
              source: 'revival',
              _generateFirst: true,
              _prospectIntel: 'CONTEXTE REVIVAL: Ce prospect ' + (REASON_LABELS[candidate.reason] || 'est inactif depuis ' + daysAgo + 'j') +
                '. Genere un email COMPLETEMENT DIFFERENT du premier. Nouvel angle, nouvelle accroche. ' +
                'Mentionne que du temps a passe. Sois bref (3-5 lignes). Ne repete RIEN du premier email.'
            }
          });

          if (result && result.success) {
            sent++;
            revived.push(candidate);
            storage.addRevivalSent({
              email: candidate.email,
              name: candidate.name,
              company: candidate.company,
              reason: candidate.reason,
              originalLastContact: candidate.lastContactAt,
              emailId: result.emailId || null,
              result: 'success'
            });
            log.info('proactive-engine', 'Lead Revival: email envoye a ' + candidate.email + ' (' + candidate.reason + ')');
          } else {
            log.warn('proactive-engine', 'Lead Revival: echec envoi a ' + candidate.email + ': ' + (result && result.error || 'unknown'));
            // Re-blacklister si on avait retire la blacklist
            if (wasBlacklisted) {
              amStorage.addToBlacklist(candidate.email, 'prospect_declined');
            }
          }
        } catch (e) {
          log.warn('proactive-engine', 'Lead Revival: erreur pour ' + candidate.email + ':', e.message);
          if (wasBlacklisted) {
            amStorage.addToBlacklist(candidate.email, 'prospect_declined');
          }
        }
      }

      // Notification Telegram avec boutons blacklist par prospect
      if (sent > 0) {
        const lines = ['📬 *Lead Revival — ' + sent + ' lead(s) reactive(s)*', ''];
        const buttons = [];
        for (const r of revived) {
          const RICONS = { opened_no_reply: '👁️', not_now_expired: '🔄', hot_lead_stale: '🔥' };
          lines.push((RICONS[r.reason] || '📧') + ' ' + (r.name || r.email) + (r.company ? ' (' + r.company + ')' : '') + ' — _' + r.reason.replace(/_/g, ' ') + '_');
          buttons.push([{ text: '🚫 Stop ' + (r.name || r.email).substring(0, 25), callback_data: 'bl_prospect_' + r.email }]);
        }
        lines.push('');
        lines.push('_' + candidates.length + ' candidats scannes, ' + sent + ' emails envoyes_');
        try {
          if (this.sendTelegramButtons && buttons.length > 0) {
            await this.sendTelegramButtons(this.options.adminChatId, lines.join('\n'), buttons);
          } else {
            await this.options.sendTelegram(this.options.adminChatId, lines.join('\n'));
          }
        } catch (e) {}
      }

      log.info('proactive-engine', 'Lead Revival termine: ' + sent + '/' + candidates.length + ' envoyes');
    } catch (e) {
      log.error('proactive-engine', 'Lead Revival erreur globale:', e.message);
    }
  }

  _getAutomailerStorage() {
    try { return require('../automailer/storage.js'); } catch (e) { return null; }
  }

  _getActionExecutor() {
    try { return require('../autonomous-pilot/action-executor.js'); } catch (e) { return null; }
  }

  _getFlowfastStorage() {
    try { return require('../flowfast/storage.js'); } catch (e) { return null; }
  }

  _getApolloConnector() {
    try {
      const ApolloConnector = require('../flowfast/apollo-connector.js');
      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) return null;
      return new ApolloConnector(apiKey);
    } catch (e) { return null; }
  }

  _getHubspotClient() {
    try { return require('../crm-hubspot/hubspot-client.js'); } catch (e) { return null; }
  }

  // --- Tache : Weekly Visitor Digest (dimanche 20h) ---

  async _weeklyVisitorDigest() {
    log.info('proactive-engine', 'Visitor Digest: generation du resume hebdo...');

    try {
      // Lire le visitor DB directement depuis le volume partage
      const fs = require('fs');
      const visitorDbPath = (process.env.VISITOR_DATA_DIR || '/data/visitors') + '/visitor-db.json';

      if (!fs.existsSync(visitorDbPath)) {
        log.info('proactive-engine', 'Visitor Digest: pas de donnees visiteurs');
        return;
      }

      const raw = fs.readFileSync(visitorDbPath, 'utf8');
      const visitorData = JSON.parse(raw);

      // Calculer le digest de la semaine
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentVisits = (visitorData.visits || []).filter(v => v.timestamp >= weekAgo);

      if (recentVisits.length === 0) {
        log.info('proactive-engine', 'Visitor Digest: aucune visite cette semaine');
        return;
      }

      // Agreger par entreprise
      const companyVisits = {};
      for (const v of recentVisits) {
        if (!v.company) continue;
        if (!companyVisits[v.company]) {
          companyVisits[v.company] = { name: v.company, count: 0, pages: new Set(), cities: new Set() };
        }
        companyVisits[v.company].count++;
        if (v.url) companyVisits[v.company].pages.add(v.url);
        if (v.city) companyVisits[v.company].cities.add(v.city);
      }

      const sorted = Object.values(companyVisits)
        .map(c => ({ name: c.name, count: c.count, pages: [...c.pages], cities: [...c.cities] }))
        .sort((a, b) => b.count - a.count);

      // Cross-reference avec FlowFast/pipeline
      const ffStorage = this._getFlowfastStorage();
      const knownCompanies = [];
      const unknownCompanies = [];

      // Charger les leads UNE SEULE fois (performance)
      const allLeads = (ffStorage && ffStorage.getAllLeads) ? ffStorage.getAllLeads() : [];
      const allCompanyNames = allLeads.map(l => (l.entreprise || '').toLowerCase()).filter(Boolean);

      for (const comp of sorted.slice(0, 20)) {
        const compLower = comp.name.toLowerCase();
        const isKnown = allCompanyNames.some(ent =>
          ent.includes(compLower) || compLower.includes(ent)
        );
        if (isKnown) knownCompanies.push(comp);
        else unknownCompanies.push(comp);
      }

      // Construire le message Telegram
      const lines = ['📊 *Visitor Digest Hebdo*', ''];
      lines.push('📈 ' + recentVisits.length + ' visites, ' + new Set(recentVisits.map(v => v.ip)).size + ' IPs uniques, ' + sorted.length + ' entreprises');
      lines.push('');

      if (knownCompanies.length > 0) {
        lines.push('🎯 *Entreprises DANS ton pipeline:*');
        for (const c of knownCompanies.slice(0, 10)) {
          lines.push('  🔥 ' + c.name + ' — ' + c.count + ' visite(s), ' + c.pages.length + ' page(s)');
        }
        lines.push('');
      }

      if (unknownCompanies.length > 0) {
        lines.push('🏢 *Autres entreprises:*');
        for (const c of unknownCompanies.slice(0, 10)) {
          lines.push('  👁️ ' + c.name + ' — ' + c.count + ' visite(s)' + (c.cities.length > 0 ? ' (' + c.cities[0] + ')' : ''));
        }
      }

      try { await this.options.sendTelegram(this.options.adminChatId, lines.join('\n')); } catch (e) { log.warn('proactive-engine', 'sendTelegram echoue: ' + e.message); }

      storage.logAlert('visitor_digest', 'Digest: ' + recentVisits.length + ' visites, ' + sorted.length + ' entreprises, ' + knownCompanies.length + ' dans pipeline', {
        visits: recentVisits.length,
        companies: sorted.length,
        knownInPipeline: knownCompanies.length
      });

      log.info('proactive-engine', 'Visitor Digest envoye: ' + recentVisits.length + ' visites, ' + sorted.length + ' entreprises');
    } catch (e) {
      log.error('proactive-engine', 'Visitor Digest erreur:', e.message);
    }
  }

  // --- Tache : Multi-Threading - envoi des secondaires (lun-ven heures bureau) ---

  async _processSecondaryEmails() {
    try {
      const ffStorage = this._getFlowfastStorage();
      if (!ffStorage || !ffStorage.getSecondariesDueForSend) {
        return;
      }

      const dueContacts = ffStorage.getSecondariesDueForSend();
      if (dueContacts.length === 0) return;

      log.info('proactive-engine', 'Multi-thread: ' + dueContacts.length + ' contact(s) secondaire(s) a envoyer');

      const amStorage = this._getAutomailerStorage();
      const ActionExecutor = this._getActionExecutor();
      if (!ActionExecutor) {
        log.warn('proactive-engine', 'Multi-thread: ActionExecutor non disponible');
        return;
      }

      let sent = 0;
      const maxPerCycle = 3; // Max 3 secondaires par cycle horaire

      for (const contact of dueContacts) {
        if (sent >= maxPerCycle) break;

        // Verifier pas blackliste
        if (amStorage && amStorage.isBlacklisted(contact.email)) {
          log.info('proactive-engine', 'Multi-thread: ' + contact.email + ' blackliste — skip');
          // Marquer comme cancelled dans le group
          if (ffStorage.markCompanyReplied) {
            // Pas ideal mais on annule ce contact
            const group = ffStorage.getCompanyGroup(contact.companyName);
            if (group) {
              const c = group.contacts.find(c => c.email.toLowerCase() === contact.email.toLowerCase());
              if (c) { c.status = 'cancelled'; c.cancelReason = 'blacklisted'; }
              ffStorage._save && ffStorage._save();
            }
          }
          continue;
        }

        try {
          const ANGLE_INTELS = {
            technical: 'ANGLE TECHNIQUE: Aborde le sujet d\'un point de vue technique. Parle de l\'infrastructure, des defis d\'integration, de la stack tech. Sois precis et concret.',
            roi: 'ANGLE ROI/BUSINESS: Aborde le sujet d\'un point de vue retour sur investissement. Chiffres, economies, gains de productivite. Sois factuel et impactant.',
            testimonial: 'ANGLE TEMOIGNAGE: Mentionne un cas client similaire ou une success story. Sois authentique et donne un resultat concret.',
            main_pitch: ''
          };

          const executor = new ActionExecutor({
            claudeKey: this.options.claudeKey || process.env.CLAUDE_API_KEY,
            resendKey: this.options.resendKey || process.env.RESEND_API_KEY,
            senderEmail: this.options.senderEmail || process.env.SENDER_EMAIL
          });

          const angleIntel = ANGLE_INTELS[contact.emailAngle] || '';
          const result = await executor.executeAction({
            type: 'send_email',
            params: {
              to: contact.email,
              contactName: contact.name,
              company: contact.companyName,
              source: 'multi_thread_secondary',
              _generateFirst: true,
              _prospectIntel: 'MULTI-THREADING SECONDAIRE: Un collegue de cette entreprise a deja ete contacte. ' +
                'Genere un email avec un angle COMPLETEMENT DIFFERENT du pitch principal. ' +
                (angleIntel ? angleIntel + ' ' : '') +
                'Ne mentionne PAS que quelqu\'un d\'autre a ete contacte. Sois bref (3-5 lignes).'
            }
          });

          if (result && result.success) {
            sent++;
            ffStorage.markCompanyContactSent(contact.email);
            log.info('proactive-engine', 'Multi-thread: secondaire envoye a ' + contact.email + ' (' + contact.companyName + ', angle: ' + contact.emailAngle + ')');
          } else {
            log.warn('proactive-engine', 'Multi-thread: echec envoi a ' + contact.email + ': ' + (result && result.error || 'unknown'));
          }
        } catch (e) {
          log.warn('proactive-engine', 'Multi-thread: erreur pour ' + contact.email + ':', e.message);
        }
      }

      if (sent > 0) {
        // Silencieux — les emails secondaires sont inclus dans le compteur global du morning report
        log.info('proactive-engine', 'Multi-thread: ' + sent + ' emails secondaires envoyes (silencieux)');
      }

      log.info('proactive-engine', 'Multi-thread termine: ' + sent + '/' + dueContacts.length + ' secondaires envoyes');
    } catch (e) {
      log.error('proactive-engine', 'Multi-thread erreur:', e.message);
    }
  }

  // --- Tache : Job Change Detection (dimanche 22h) ---

  async _jobChangeDetection() {
    log.info('proactive-engine', 'Job Change Detection: scan hebdomadaire...');

    try {
      const jcConfig = storage.getJobChangeConfig();
      if (!jcConfig.enabled) {
        log.info('proactive-engine', 'Job Change Detection: desactive');
        return;
      }

      const ffStorage = this._getFlowfastStorage();
      if (!ffStorage || !ffStorage.getLeadsWithApolloId) {
        log.warn('proactive-engine', 'Job Change Detection: FlowFast storage non disponible');
        return;
      }

      const apollo = this._getApolloConnector();
      if (!apollo) {
        log.warn('proactive-engine', 'Job Change Detection: Apollo connector non disponible (pas d\'API key ?)');
        return;
      }

      // Recuperer les leads avec un apolloId (contactes dans les 90 derniers jours)
      const leads = ffStorage.getLeadsWithApolloId({
        maxResults: jcConfig.maxCreditsPerCycle || 50,
        onlyActive: jcConfig.onlyActiveProspects !== false,
        maxDaysSinceContact: jcConfig.maxDaysSinceContact || 90
      });

      if (leads.length === 0) {
        log.info('proactive-engine', 'Job Change Detection: aucun lead avec apolloId');
        return;
      }

      log.info('proactive-engine', 'Job Change Detection: ' + leads.length + ' leads a verifier');

      const amStorage = this._getAutomailerStorage();
      let checked = 0;
      let creditsUsed = 0;
      const changes = [];

      for (const lead of leads) {
        if (creditsUsed >= (jcConfig.maxCreditsPerCycle || 50)) {
          log.info('proactive-engine', 'Job Change Detection: budget credits atteint (' + creditsUsed + ')');
          break;
        }

        // Skip blacklistes hard
        if (amStorage && amStorage.isHardBlacklisted && amStorage.isHardBlacklisted(lead.email)) {
          continue;
        }

        try {
          const result = await apollo.reCheckPerson({
            email: lead.email,
            firstName: lead.firstName,
            lastName: lead.lastName,
            apolloId: lead.apolloId
          });
          creditsUsed++;
          checked++;

          if (result.success && result.person) {
            const current = result.person;
            const titleChanged = current.title && lead.currentTitle &&
              current.title.toLowerCase() !== lead.currentTitle.toLowerCase();
            const companyChanged = current.organizationName && lead.currentCompany &&
              current.organizationName.toLowerCase() !== lead.currentCompany.toLowerCase();

            if (titleChanged || companyChanged) {
              log.info('proactive-engine', 'Job Change detecte: ' + lead.email +
                ' — ' + lead.currentTitle + ' @ ' + lead.currentCompany +
                ' → ' + current.title + ' @ ' + current.organizationName);

              // Enregistrer dans proactive storage
              const changeEntry = storage.addJobChange({
                email: lead.email,
                name: (lead.firstName + ' ' + lead.lastName).trim(),
                oldTitle: lead.currentTitle,
                oldCompany: lead.currentCompany,
                newTitle: current.title,
                newCompany: current.organizationName
              });

              // Mettre a jour dans FlowFast storage
              ffStorage.updateLeadApolloSnapshot(lead.email,
                { title: lead.currentTitle, company: lead.currentCompany },
                { title: current.title, company: current.organizationName, linkedinUrl: current.linkedinUrl }
              );

              // Mettre a jour HubSpot si disponible
              try {
                const hubspot = this._getHubspotClient();
                if (hubspot && hubspot.addNote) {
                  const noteTxt = 'Job change detecte par Apollo:\n' +
                    'Ancien: ' + lead.currentTitle + ' @ ' + lead.currentCompany + '\n' +
                    'Nouveau: ' + current.title + ' @ ' + current.organizationName + '\n' +
                    'Detecte le: ' + new Date().toISOString().split('T')[0];
                  await hubspot.addNote(lead.email, noteTxt);
                }
              } catch (e) {
                log.warn('proactive-engine', 'Job Change HubSpot note failed: ' + e.message);
              }

              changes.push({
                email: lead.email,
                name: (lead.firstName + ' ' + lead.lastName).trim(),
                oldTitle: lead.currentTitle,
                oldCompany: lead.currentCompany,
                newTitle: current.title,
                newCompany: current.organizationName,
                id: changeEntry ? changeEntry.id : null
              });
            }
          }

          // Rate limit: 1 appel/seconde (respecter Apollo rate limits)
          await new Promise(r => setTimeout(r, 1100));

        } catch (e) {
          log.warn('proactive-engine', 'Job Change check failed for ' + lead.email + ': ' + e.message);
        }
      }

      // Mettre a jour les stats
      storage.updateJobChangeStats({
        totalChecked: (storage.getJobChangeStats().totalChecked || 0) + checked,
        totalCreditsUsed: (storage.getJobChangeStats().totalCreditsUsed || 0) + creditsUsed,
        lastScanAt: new Date().toISOString()
      });

      // Notification Telegram
      if (changes.length > 0) {
        const lines = ['🔄 *Job Change Detection — ' + changes.length + ' changement(s) detecte(s)*', ''];
        for (const c of changes) {
          lines.push('👤 *' + (c.name || c.email) + '*');
          lines.push('   ❌ ' + c.oldTitle + ' @ ' + c.oldCompany);
          lines.push('   ✅ ' + c.newTitle + ' @ ' + c.newCompany);
          lines.push('');
        }
        lines.push('_' + checked + ' leads verifies, ' + creditsUsed + ' credits Apollo utilises_');
        try { await this.options.sendTelegram(this.options.adminChatId, lines.join('\n')); } catch (e) { log.warn('proactive-engine', 'sendTelegram echoue: ' + e.message); }
      } else {
        log.info('proactive-engine', 'Job Change Detection: aucun changement detecte (' + checked + ' verifies, ' + creditsUsed + ' credits)');
      }

      // Log dans alert history
      storage.logAlert('job_change_scan', 'Scan: ' + checked + ' verifies, ' + changes.length + ' changements, ' + creditsUsed + ' credits', {
        checked: checked,
        changes: changes.length,
        creditsUsed: creditsUsed
      });

      log.info('proactive-engine', 'Job Change Detection termine: ' + changes.length + ' changements sur ' + checked + ' verifies');

    } catch (e) {
      log.error('proactive-engine', 'Job Change Detection erreur globale:', e.message);
    }
  }

  // --- Tache : Reactive Follow-Ups (toutes les 10 min) ---

  async _processReactiveFollowUps() {
    const rfConfig = storage.getReactiveFollowUpConfig();
    if (!rfConfig || !rfConfig.enabled) return;

    // Verifier heures bureau (Paris, lun-ven 9h-18h)
    const now = new Date();
    const parisHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(now));
    const parisDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const parisDay = parisDate.getDay();
    if (parisDay === 0 || parisDay === 6 || parisHour < 9 || parisHour >= 18) {
      return; // Hors heures bureau
    }

    const pending = storage.getPendingFollowUps();
    if (pending.length === 0) return;

    const config = storage.getConfig();
    log.info('proactive-engine', 'Reactive follow-ups: ' + pending.length + ' en attente');

    for (const followUp of pending) {
      // TTL 72h : expirer les follow-ups trop anciens
      const expiresAt = followUp.expiresAt ? new Date(followUp.expiresAt).getTime() : (new Date(followUp.createdAt).getTime() + 72 * 60 * 60 * 1000);
      if (Date.now() > expiresAt) {
        log.info('proactive-engine', 'Reactive FU EXPIRED (TTL 72h): ' + followUp.prospectEmail + ' — cree le ' + followUp.createdAt + ', retries: ' + (followUp.retryCount || 0));
        storage.markFollowUpExpired(followUp.id, 'ttl_72h_expired (retries: ' + (followUp.retryCount || 0) + ', last: ' + (followUp.lastBlockedReason || 'none') + ')');
        continue;
      }

      // Max retries : OOO follow-ups ont un TTL long (semaines), donc limite haute
      const maxRetries = followUp.isOOO ? 500 : 20;
      if ((followUp.retryCount || 0) >= maxRetries) {
        log.warn('proactive-engine', 'Reactive FU MAX RETRIES (' + maxRetries + '): ' + followUp.prospectEmail + ' — derniere raison: ' + (followUp.lastBlockedReason || '?'));
        storage.markFollowUpExpired(followUp.id, 'max_retries_' + maxRetries + ' (last: ' + (followUp.lastBlockedReason || 'none') + ')');
        continue;
      }

      // Verifier le delai
      const scheduledTime = new Date(followUp.scheduledAfter).getTime();
      if (Date.now() < scheduledTime) continue;

      log.info('proactive-engine', 'Traitement reactive follow-up pour ' + followUp.prospectEmail + ' (retry #' + (followUp.retryCount || 0) + ')');

      try {
        // 1. Verifications de securite
        const amStorage = getAutomailerStorage();
        if (!amStorage) {
          log.warn('proactive-engine', 'Reactive FU: automailer storage non disponible');
          continue;
        }

        // Verifier blacklist
        if (amStorage.isBlacklisted(followUp.prospectEmail)) {
          log.info('proactive-engine', 'Reactive FU: ' + followUp.prospectEmail + ' blackliste — annule');
          storage.markFollowUpFailed(followUp.id, 'blacklisted');
          continue;
        }

        // Verifier exclusions AP (businessContext contient "ne pas relancer")
        try {
          const apStorage = getAPStorage();
          if (apStorage) {
            const apConfig = apStorage.getConfig ? apStorage.getConfig() : {};
            const bc = (apConfig.businessContext || '').toLowerCase();
            if (bc.includes(followUp.prospectEmail.toLowerCase()) && (bc.includes('ne pas relancer') || bc.includes('annulee') || bc.includes('exclu'))) {
              log.info('proactive-engine', 'Reactive FU: ' + followUp.prospectEmail + ' exclu par AP businessContext — annule');
              storage.markFollowUpFailed(followUp.id, 'excluded_by_ap');
              continue;
            }
          }
        } catch (apErr) {
          log.warn('proactive-engine', 'Check AP exclusions echoue:', apErr.message);
        }

        // Verifier si le prospect a repondu ou bounce
        // EXCEPTION : les follow-ups OOO sont autorises malgre le flag "replied" (le reply EST l'OOO)
        const emailEvents = amStorage.getEmailEventsForRecipient(followUp.prospectEmail);
        if (!followUp.isOOO && emailEvents.some(e => e.status === 'replied' || e.hasReplied)) {
          log.info('proactive-engine', 'Reactive FU: ' + followUp.prospectEmail + ' a repondu — annule');
          storage.markFollowUpFailed(followUp.id, 'already_replied');
          continue;
        }
        if (emailEvents.some(e => e.status === 'bounced')) {
          log.info('proactive-engine', 'Reactive FU: ' + followUp.prospectEmail + ' bounce — annule');
          storage.markFollowUpFailed(followUp.id, 'bounced');
          continue;
        }

        // Guard sentiment : pas de relance si not_interested confirme
        const sentimentData = amStorage.getSentiment ? amStorage.getSentiment(followUp.prospectEmail) : null;
        if (sentimentData && sentimentData.sentiment === 'not_interested' && sentimentData.score >= 0.3) {
          log.info('proactive-engine', 'Reactive FU: ' + followUp.prospectEmail + ' sentiment not_interested (score ' + sentimentData.score + ') — annule');
          storage.markFollowUpFailed(followUp.id, 'sentiment_not_interested');
          continue;
        }

        // Rate limiting inter-campagne : max 2 emails/72h par contact
        const cutoff72h = Date.now() - 72 * 60 * 60 * 1000;
        const recentSent = emailEvents.filter(e => {
          if (e.status === 'failed' || e.status === 'queued') return false;
          const sentTime = e.sentAt ? new Date(e.sentAt).getTime() : 0;
          return sentTime > 0 && sentTime > cutoff72h;
        });
        if (recentSent.length >= 2) {
          log.info('proactive-engine', 'Reactive FU: ' + followUp.prospectEmail + ' rate limit (' + recentSent.length + ' emails en 72h) — reporte (retry #' + (followUp.retryCount || 0) + ')');
          storage.incrementFollowUpRetry(followUp.id, 'rate_limit_72h');
          continue;
        }

        // Verifier warmup quotidien via domain-manager (source de verite)
        let hasHeadroom = false;
        try {
          const domainManager = require('../../skills/automailer/domain-manager.js');
          const dmStats = domainManager.getStats ? domainManager.getStats() : [];
          const totalRemaining = dmStats.reduce((sum, d) => sum + Math.max(0, (d.warmupLimit || 0) - (d.todaySends || 0)), 0);
          hasHeadroom = totalRemaining > 0;
          if (!hasHeadroom) {
            log.info('proactive-engine', 'Reactive FU: warmup limit (0 headroom sur tous les domaines) — reporte (retry #' + (followUp.retryCount || 0) + ')');
            storage.incrementFollowUpRetry(followUp.id, 'warmup_daily_limit');
            continue;
          }
        } catch (dmErr) {
          // Fallback ancien systeme si domain-manager indisponible
          const todaySent = amStorage.getTodaySendCount ? amStorage.getTodaySendCount() : 0;
          const firstSendDate = amStorage.getFirstSendDate ? amStorage.getFirstSendDate() : null;
          const dailyLimit = getWarmupDailyLimit(firstSendDate);
          if (todaySent >= dailyLimit) {
            log.info('proactive-engine', 'Reactive FU: warmup limit (' + todaySent + '/' + dailyLimit + ') — reporte');
            storage.incrementFollowUpRetry(followUp.id, 'warmup_daily_limit');
            continue;
          }
        }

        // 2. Generer le follow-up via Claude
        const ClaudeEmailWriter = getClaudeEmailWriter();
        if (!ClaudeEmailWriter) {
          log.warn('proactive-engine', 'Reactive FU: ClaudeEmailWriter non disponible');
          continue;
        }

        const claudeKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '';
        if (!claudeKey) {
          log.warn('proactive-engine', 'Reactive FU: cle Claude manquante');
          continue;
        }

        const writer = new ClaudeEmailWriter(claudeKey);
        // FIX 6 : Recuperer le titre depuis followUp, prospectIntel, FlowFast ou Lead Enrich
        let prospectTitle = followUp.prospectTitle || '';
        try {
          // Essayer d'extraire le titre depuis le brief (format "TITRE: ...")
          const intelText = followUp.prospectIntel || '';
          const titleMatch = intelText.match(/(?:TITRE|POSTE|ROLE)\s*:\s*(.+)/i);
          if (titleMatch) prospectTitle = titleMatch[1].trim();
          // Fallback : chercher dans FlowFast
          if (!prospectTitle) {
            const ffStor = getFlowfastStorage();
            if (ffStor && ffStor.data) {
              const ffLeads = ffStor.data.leads || {};
              for (const lid of Object.keys(ffLeads)) {
                if (ffLeads[lid].email === followUp.prospectEmail) {
                  prospectTitle = ffLeads[lid].title || ffLeads[lid].titre || '';
                  break;
                }
              }
            }
          }
          // Fallback : Lead Enrich
          if (!prospectTitle) {
            const leStor = getLeadEnrichStorage();
            if (leStor && leStor.data) {
              const enrichedObj = leStor.data.enrichedLeads || leStor.data.enrichedContacts || {};
              const enrichedArr = Array.isArray(enrichedObj) ? enrichedObj : Object.values(enrichedObj);
              const found = enrichedArr.find(c => (c.email || '') === followUp.prospectEmail);
              if (found) prospectTitle = found.title || found.titre || '';
            }
          }
        } catch (titleErr) {}
        const contact = {
          name: followUp.prospectName,
          firstName: (followUp.prospectName || '').split(' ')[0],
          title: prospectTitle,
          company: followUp.prospectCompany,
          email: followUp.prospectEmail
        };

        // 2b. Cross-dedup : verifier qu'une sequence campaign n'envoie pas deja un email aujourd'hui
        try {
          const campaigns = amStorage.getAllCampaigns ? amStorage.getAllCampaigns() : [];
          const activeCampaigns = campaigns.filter(c => c.status === 'active');
          let campaignConflict = false;
          for (const camp of activeCampaigns) {
            const list = amStorage.getContactList ? amStorage.getContactList(camp.contactListId) : null;
            if (list && list.contacts) {
              const inCampaign = list.contacts.some(c => c.email === followUp.prospectEmail);
              if (inCampaign) {
                // Verifier si un step est prevu dans les prochaines 24h
                for (const step of (camp.steps || [])) {
                  if (step.status === 'pending' && step.scheduledAt) {
                    const diff = new Date(step.scheduledAt).getTime() - Date.now();
                    if (diff >= 0 && diff < 24 * 60 * 60 * 1000) {
                      campaignConflict = true;
                      break;
                    }
                  }
                }
              }
            }
            if (campaignConflict) break;
          }
          if (campaignConflict) {
            log.info('proactive-engine', 'Reactive FU: ' + followUp.prospectEmail + ' a une sequence campaign prevue sous 24h — reporte (retry #' + (followUp.retryCount || 0) + ')');
            storage.incrementFollowUpRetry(followUp.id, 'campaign_conflict_24h');
            continue;
          }
        } catch (crossErr) {
          log.info('proactive-engine', 'Reactive FU: cross-dedup check skip: ' + crossErr.message);
        }

        // 2c. Recuperer l'angle du premier email pour eviter repetition
        let originalAngle = '';
        try {
          const firstLine = (followUp.originalBody || '').split(/[\n.!?]/)[0].trim();
          if (firstLine.length > 10) originalAngle = firstLine;
        } catch (e) {}

        // Enrichir le prospectIntel avec l'angle deja utilise
        let enrichedIntel = followUp.prospectIntel || '';
        if (originalAngle) {
          enrichedIntel += '\n\n=== ANGLES DEJA UTILISES (NE PAS REPETER) ===\n- "' + originalAngle + '"\n=== FIN ANGLES UTILISES ===';
        }

        // Hot lead detection : 3+ ouvertures → ton plus direct + CTA booking
        const openCount = emailEvents.filter(e => e.status === 'opened' || e.openedAt).length;
        let isHotLead = openCount >= 3;
        let bookingUrl = '';
        if (isHotLead) {
          log.info('proactive-engine', 'HOT LEAD detecte: ' + followUp.prospectEmail + ' (' + openCount + ' opens)');
          enrichedIntel += '\n\n=== CONSIGNE SPECIALE ===\n' +
            'Ce prospect est un HOT LEAD (' + openCount + ' ouvertures). ' +
            'Adopte un ton plus direct et confiant. ' +
            'Propose CLAIREMENT un echange rapide de 15 min. ' +
            'Sois concis (4-6 lignes max). Ne tourne pas autour du pot.\n=== FIN CONSIGNE ===';
          // Generer le lien booking
          try {
            const GoogleCalendarClient = require('../meeting-scheduler/google-calendar-client.js');
            const gcal = new GoogleCalendarClient();
            bookingUrl = await gcal.getBookingLink(null, followUp.prospectEmail, contact.firstName || '') || '';
          } catch (calErr) {
            log.info('proactive-engine', 'Booking link skip pour hot lead: ' + calErr.message);
          }
        }

        // Generation avec retry (max 2 tentatives sur erreur Claude API)
        let generated = null;
        let genRetries = 0;
        const MAX_GEN_RETRIES = 2;
        while (genRetries <= MAX_GEN_RETRIES) {
          try {
            generated = await writer.generateReactiveFollowUp(
              contact,
              { subject: followUp.originalSubject, body: followUp.originalBody },
              enrichedIntel
            );
            break; // succes
          } catch (genErr) {
            genRetries++;
            if (genRetries > MAX_GEN_RETRIES) {
              log.error('proactive-engine', 'Reactive FU: Claude API FAIL apres ' + MAX_GEN_RETRIES + ' retries pour ' + followUp.prospectEmail + ': ' + genErr.message);
              storage.incrementFollowUpRetry(followUp.id, 'claude_api_error: ' + genErr.message);
              break;
            }
            log.warn('proactive-engine', 'Reactive FU: Claude API erreur (retry ' + genRetries + '/' + MAX_GEN_RETRIES + '): ' + genErr.message);
            await new Promise(r => setTimeout(r, genRetries * 2000)); // backoff 2s, 4s
          }
        }

        if (!generated || generated.skip) {
          if (generated && generated.skip) {
            log.info('proactive-engine', 'Reactive FU: generation skippee pour ' + followUp.prospectEmail);
            storage.markFollowUpFailed(followUp.id, 'generation_skipped');
          }
          continue;
        }

        let subject = generated.subject;
        let body = generated.body;

        // Hot lead : ajouter lien booking au body
        if (isHotLead && bookingUrl) {
          body += '\n\nVoici mon lien si tu veux caler un creneau : ' + bookingUrl;
        }

        // 2d. Mini quality gate : verifier que la relance contient au moins 1 fait du brief
        if (enrichedIntel && enrichedIntel.length > 100) {
          const emailText = (subject + ' ' + body).toLowerCase();
          const intelText = enrichedIntel.toLowerCase();
          // Extraire les mots significatifs du brief (> 5 chars, pas communs)
          const commonWords = new Set(['notre','votre','cette','leurs','comme','aussi','autres','encore','toujours','depuis','entre','pendant','avant','apres','dessus','dessous','quelque','plusieurs','chaque','meme','tout','tous','toute','toutes','plus','moins','tres','bien','fait','faire','peut','sont','dans','avec','pour','sans','chez','vers']);
          const intelWords = intelText.match(/[a-zàâäéèêëïîôùûüÿç]{6,}/g) || [];
          const uniqueWords = [...new Set(intelWords)].filter(w => !commonWords.has(w));
          const matchedWords = uniqueWords.filter(w => emailText.includes(w));
          if (matchedWords.length < 1) {
            log.warn('proactive-engine', 'Reactive FU: quality gate FAIL pour ' + followUp.prospectEmail + ' — aucun mot du brief dans l\'email');
            storage.markFollowUpFailed(followUp.id, 'quality_gate_generic');
            continue;
          }
          log.info('proactive-engine', 'Reactive FU: quality gate OK (' + matchedWords.length + ' mots: ' + matchedWords.slice(0, 3).join(', ') + ')');
        }

        // 2e. Quality gate complete (patterns generiques) — meme check que campaign-engine
        try {
          const CE = getCampaignEngine();
          if (CE && CE.emailPassesQualityGate) {
            const qg = CE.emailPassesQualityGate(subject, body);
            if (!qg.pass) {
              log.warn('proactive-engine', 'Reactive FU: quality gate patterns FAIL pour ' + followUp.prospectEmail + ': ' + qg.reason);
              storage.markFollowUpFailed(followUp.id, 'quality_gate_pattern: ' + qg.reason);
              continue;
            }
          }
        } catch (qgErr) {
          log.info('proactive-engine', 'Reactive FU: quality gate patterns check skip: ' + qgErr.message);
        }

        // 2f. Subject gate : patterns interdits dans l'objet
        try {
          const CE = getCampaignEngine();
          if (CE && CE.subjectPassesGate) {
            const sg = CE.subjectPassesGate(subject);
            if (!sg.pass) {
              log.warn('proactive-engine', 'Reactive FU: subject gate FAIL pour ' + followUp.prospectEmail + ': ' + sg.reason);
              storage.markFollowUpFailed(followUp.id, 'subject_gate: ' + sg.reason);
              continue;
            }
          }
        } catch (sgErr) {}

        // 2g. Word count gate : 10-60 mots (meme que campaign-engine)
        const bodyWords = (body || '').split(/\s+/).filter(w => w.length > 0).length;
        if (bodyWords > 60) {
          log.warn('proactive-engine', 'Reactive FU: word count FAIL pour ' + followUp.prospectEmail + ': ' + bodyWords + ' mots (max 60)');
          storage.markFollowUpFailed(followUp.id, 'word_count:' + bodyWords);
          continue;
        }
        if (bodyWords < 10) {
          log.warn('proactive-engine', 'Reactive FU: word count FAIL pour ' + followUp.prospectEmail + ': ' + bodyWords + ' mots (min 10)');
          storage.markFollowUpFailed(followUp.id, 'word_count_low:' + bodyWords);
          continue;
        }

        // 3. Validation mots interdits
        try {
          const apStorage = getAPStorage();
          if (apStorage) {
            const apConfig = apStorage.getConfig ? apStorage.getConfig() : {};
            const ep = apConfig.emailPreferences || {};
            if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
              const emailText = (subject + ' ' + body).toLowerCase();
              const foundWords = ep.forbiddenWords.filter(w => {
                const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return new RegExp('\\b' + escaped + '\\b', 'i').test(emailText);
              });
              if (foundWords.length > 0) {
                log.warn('proactive-engine', 'Reactive FU: mots interdits: ' + foundWords.join(', ') + ' — annule');
                storage.markFollowUpFailed(followUp.id, 'forbidden_words: ' + foundWords.join(', '));
                continue;
              }
            }
          }
        } catch (fwErr) {
          log.warn('proactive-engine', 'Reactive FU: check mots interdits echoue: ' + fwErr.message);
        }

        // 4. Envoyer l'email via Resend
        const ResendClient = getResendClient();
        if (!ResendClient) {
          log.warn('proactive-engine', 'Reactive FU: ResendClient non disponible');
          continue;
        }

        const resendKey = this.resendKey || process.env.RESEND_API_KEY || '';
        const senderEmail = this.senderEmail || process.env.SENDER_EMAIL || process.env.REPLY_TO_EMAIL;
        const resend = new ResendClient(resendKey, senderEmail);
        const crypto = require('crypto');
        const trackingId = crypto.randomBytes(16).toString('hex');

        // Threading : recuperer messageId precedent pour ce prospect
        const fuSendOpts = { replyTo: process.env.REPLY_TO_EMAIL || process.env.SENDER_EMAIL, fromName: process.env.SENDER_NAME || 'Alexis', trackingId: trackingId };
        const prevFuMsgId = amStorage.getMessageIdForRecipient ? amStorage.getMessageIdForRecipient(followUp.prospectEmail) : null;
        if (prevFuMsgId) {
          fuSendOpts.inReplyTo = prevFuMsgId;
          fuSendOpts.references = prevFuMsgId;
        }
        // Filet de securite spintax avant envoi
        subject = applySpintax(subject);
        body = applySpintax(body);

        const sendResult = await resend.sendEmail(
          followUp.prospectEmail,
          subject,
          body,
          fuSendOpts
        );

        if (sendResult.success) {
          // Enregistrer dans automailer
          amStorage.addEmail({
            chatId: config.adminChatId || process.env.ADMIN_CHAT_ID || '1409505520',
            to: followUp.prospectEmail,
            subject: subject,
            body: body,
            resendId: sendResult.id || null,
            messageId: sendResult.messageId || null,
            trackingId: trackingId,
            status: 'sent',
            source: 'reactive-followup',
            contactName: followUp.prospectName,
            company: followUp.prospectCompany
          });

          if (amStorage.setFirstSendDate) amStorage.setFirstSendDate();
          if (amStorage.incrementTodaySendCount) amStorage.incrementTodaySendCount();

          storage.markFollowUpSent(followUp.id, { resendId: sendResult.id, subject: subject });

          // Notification Telegram compacte avec bouton blacklist
          const tgMsg = '📧 *Relance envoyee a ' + (followUp.prospectName || followUp.prospectEmail) + '*' +
            (followUp.prospectCompany ? ' (' + followUp.prospectCompany + ')' : '');
          if (this.sendTelegramButtons) {
            await this.sendTelegramButtons(config.adminChatId, tgMsg, [[{ text: '🚫 Blacklister ce prospect', callback_data: 'bl_prospect_' + followUp.prospectEmail }]]);
          } else {
            await this.sendTelegram(config.adminChatId, tgMsg);
          }

          log.info('proactive-engine', 'Reactive FU envoye a ' + followUp.prospectEmail + ': "' + subject + '"');

          // Rate limiting : 2 min entre envois
          await new Promise(r => setTimeout(r, 120000));
        } else {
          log.error('proactive-engine', 'Reactive FU erreur envoi: ' + (sendResult.error || '?'));
          storage.markFollowUpFailed(followUp.id, 'send_error: ' + (sendResult.error || '?'));
        }
      } catch (e) {
        log.error('proactive-engine', 'Reactive FU erreur pour ' + followUp.prospectEmail + ':', e.message);
        storage.markFollowUpFailed(followUp.id, 'exception: ' + e.message);
      }
    }
  }

  async triggerReactiveFollowUps() {
    return this._processReactiveFollowUps();
  }

  // --- Niche Health Monitor ---

  async _nicheHealthScan() {
    const config = storage.getConfig();
    if (!config.enabled) return;

    log.info('proactive-engine', 'Niche health scan demarre...');

    const apStorage = getAPStorage();
    if (!apStorage || !apStorage.getNicheList) return;

    const nicheList = apStorage.getNicheList();
    if (nicheList.length === 0) return;

    // Criteres ICP de base
    const goals = apStorage.getGoals ? apStorage.getGoals() : {};
    const baseCriteria = goals.searchCriteria || {};

    // Leads contactes depuis nichePerformance (plus fiable que flowfast)
    const nichePerf = apStorage.getNichePerformance ? apStorage.getNichePerformance() : {};

    // Apollo connector
    const ApolloConnector = require('../flowfast/apollo-connector.js');
    const apolloKey = process.env.APOLLO_API_KEY;
    if (!apolloKey) {
      log.warn('proactive-engine', 'Niche health: APOLLO_API_KEY manquante');
      return;
    }
    const apollo = new ApolloConnector(apolloKey);

    let scanned = 0;
    let alertsSent = 0;

    for (const niche of nicheList) {
      try {
        const result = await apollo.countAvailable({
          ...baseCriteria,
          keywords: niche.keywords
        });

        if (!result.success) {
          log.info('proactive-engine', 'Niche scan echoue pour ' + niche.slug + ': ' + (result.error || '?'));
          continue;
        }

        const totalAvailable = result.totalAvailable;
        const perf = nichePerf[niche.slug] || {};
        const contacted = perf.sent || 0;
        const exhaustionPct = totalAvailable > 0 ? Math.round((contacted / totalAvailable) * 1000) / 10 : 0;

        const healthData = apStorage.updateNicheHealth(niche.slug, {
          totalAvailable,
          contacted,
          exhaustionPct,
          lastScanAt: new Date().toISOString()
        });

        scanned++;

        // Alerte si >= 80% et pas deja alerte dans les 7 derniers jours
        if (healthData.status === 'critical' || healthData.status === 'exhausted') {
          const lastAlert = healthData.alertSentAt ? new Date(healthData.alertSentAt).getTime() : 0;
          const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

          if (lastAlert < sevenDaysAgo) {
            const emoji = healthData.status === 'exhausted' ? '🔴' : '🟠';
            const nicheHealth = apStorage.getNicheHealth();
            const msg = emoji + ' *Niche epuisee* : *' + niche.slug + '*\n\n' +
              '📊 ' + contacted + ' / ' + totalAvailable + ' prospects contactes (' + exhaustionPct + '%)\n' +
              'Statut : ' + healthData.status + '\n\n' +
              this._suggestAdjacentNiches(niche.slug, nicheList, nicheHealth) +
              '\n_Consulte le dashboard pour la vue complete._';

            await this.sendTelegram(config.adminChatId, msg);
            apStorage.markNicheAlertSent(niche.slug);
            alertsSent++;
          }
        }

        // Rate limit entre les appels Apollo
        await new Promise(r => setTimeout(r, 500));

      } catch (e) {
        log.info('proactive-engine', 'Niche scan erreur ' + niche.slug + ': ' + e.message);
      }
    }

    log.info('proactive-engine', 'Niche health scan termine: ' + scanned + '/' + nicheList.length + ' niches, ' + alertsSent + ' alertes');
  }

  _suggestAdjacentNiches(exhaustedSlug, nicheList, nicheHealth) {
    const adjacencyMap = {
      'agences-marketing': ['relations-publiques', 'ecommerce', 'saas-b2b'],
      'esn-ssii': ['saas-b2b', 'startup-tech', 'cabinet-conseil'],
      'saas-b2b': ['startup-tech', 'esn-ssii', 'ecommerce'],
      'startup-tech': ['saas-b2b', 'esn-ssii', 'energie-environnement'],
      'ecommerce': ['agences-marketing', 'franchise-reseau', 'transport-logistique'],
      'cabinet-conseil': ['cabinet-comptable', 'cabinet-recrutement', 'formation-pro'],
      'cabinet-comptable': ['cabinet-conseil', 'gestion-patrimoine', 'cabinet-avocat'],
      'cabinet-avocat': ['cabinet-comptable', 'cabinet-conseil', 'immobilier-pro'],
      'cabinet-recrutement': ['cabinet-conseil', 'formation-pro', 'esn-ssii'],
      'courtier-assurance': ['gestion-patrimoine', 'immobilier-pro', 'cabinet-comptable'],
      'gestion-patrimoine': ['courtier-assurance', 'cabinet-comptable', 'immobilier-pro'],
      'formation-pro': ['cabinet-recrutement', 'cabinet-conseil', 'sante-medtech'],
      'immobilier-pro': ['btp-construction', 'gestion-patrimoine', 'courtier-assurance'],
      'btp-construction': ['immobilier-pro', 'industrie-pme', 'energie-environnement'],
      'industrie-pme': ['btp-construction', 'transport-logistique', 'energie-environnement'],
      'sante-medtech': ['formation-pro', 'startup-tech', 'cabinet-conseil'],
      'transport-logistique': ['industrie-pme', 'franchise-reseau', 'ecommerce'],
      'franchise-reseau': ['ecommerce', 'nettoyage-proprete', 'transport-logistique'],
      'relations-publiques': ['agences-marketing', 'formation-pro', 'cabinet-conseil'],
      'nettoyage-proprete': ['securite-privee', 'franchise-reseau', 'btp-construction'],
      'securite-privee': ['nettoyage-proprete', 'immobilier-pro', 'industrie-pme'],
      'energie-environnement': ['btp-construction', 'industrie-pme', 'startup-tech']
    };

    const adjacent = adjacencyMap[exhaustedSlug] || [];
    const healthy = adjacent.filter(slug => {
      const h = nicheHealth[slug];
      return !h || h.status === 'healthy' || h.status === 'unknown';
    });

    if (healthy.length === 0) return '💡 _Aucune niche adjacente saine trouvee._\n';

    return '💡 *Niches adjacentes suggerees :*\n' +
      healthy.map(slug => {
        const niche = nicheList.find(n => n.slug === slug);
        const h = nicheHealth[slug];
        const pct = h && h.exhaustionPct ? h.exhaustionPct + '%' : 'non scannee';
        return '  • *' + slug + '* (' + pct + ')';
      }).join('\n') + '\n';
  }
}

module.exports = ProactiveEngine;
