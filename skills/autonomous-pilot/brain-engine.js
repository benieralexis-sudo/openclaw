// Autonomous Pilot - Brain Engine (cerveau autonome)
const { Cron } = require('croner');
const storage = require('./storage.js');
const ActionExecutor = require('./action-executor.js');
const diagnostic = require('./diagnostic.js');
// retryAsync et getBreaker retires — callClaudeOpus fait deja breaker+retry en interne
const log = require('../../gateway/logger.js');

// --- Cross-skill imports (dual-path) ---

function _require(relativePath, absolutePath) {
  try { return require(relativePath); }
  catch (e) {
    try { return require(absolutePath); }
    catch (e2) { return null; }
  }
}

function getFlowFastStorage() {
  return _require('../flowfast/storage.js', '/app/skills/flowfast/storage.js');
}

function getAutomailerStorage() {
  return _require('../automailer/storage.js', '/app/skills/automailer/storage.js');
}

function getLeadEnrichStorage() {
  return _require('../lead-enrich/storage.js', '/app/skills/lead-enrich/storage.js');
}

function getProactiveStorage() {
  return _require('../proactive-agent/storage.js', '/app/skills/proactive-agent/storage.js');
}

function getSelfImproveStorage() {
  return _require('../self-improve/storage.js', '/app/skills/self-improve/storage.js');
}

function getWebIntelStorage() {
  return _require('../web-intelligence/storage.js', '/app/skills/web-intelligence/storage.js');
}

function getAppConfig() {
  return _require('../../gateway/app-config.js', '/app/gateway/app-config.js');
}

function getHubSpotClient() {
  const apiKey = process.env.HUBSPOT_API_KEY;
  if (!apiKey) return null;
  const HubSpotClient = _require('../crm-pilot/hubspot-client.js', '/app/skills/crm-pilot/hubspot-client.js');
  if (!HubSpotClient) return null;
  try { return new HubSpotClient(apiKey); } catch (e) { return null; }
}

class BrainEngine {
  constructor(options) {
    this.sendTelegram = options.sendTelegram;
    this.sendTelegramButtons = options.sendTelegramButtons;
    this.callClaude = options.callClaude;
    this.callClaudeOpus = options.callClaudeOpus;

    this.executor = new ActionExecutor({
      apolloKey: options.apolloKey,
      fullenrichKey: options.fullenrichKey,
      hubspotKey: options.hubspotKey,
      openaiKey: options.openaiKey,
      claudeKey: options.claudeKey,
      resendKey: options.resendKey,
      senderEmail: options.senderEmail,
      campaignEngine: options.campaignEngine
    });

    this.crons = [];
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tz = 'Europe/Paris';

    // Brain cycle : 9h et 18h (optimise cout — 2 cycles/jour suffisent)
    this.crons.push(new Cron('0 9,18 * * *', { timezone: tz }, async () => {
      try { await this._brainCycle(); }
      catch (e) { log.error('brain', 'Erreur cycle:', e.message); }
    }));

    // Daily briefing supprime — fusionne avec Proactive Morning Report a 8h (voir proactive-engine.js)

    // Mini-cycle leger : 12h et 15h (Intelligence Reelle v5 — 0$ cout, pas d'appel Claude)
    this.crons.push(new Cron('0 12,15 * * *', { timezone: tz }, async () => {
      try { await this._lightCycle(); }
      catch (e) { log.error('brain', 'Erreur mini-cycle:', e.message); }
    }));

    // Weekly reset + learning : lundi 0h
    this.crons.push(new Cron('0 0 * * 1', { timezone: tz }, async () => {
      try { await this._weeklyReset(); }
      catch (e) { log.error('brain', 'Erreur reset hebdo:', e.message); }
    }));

    log.info('brain', 'Cerveau autonome demarre (4 crons — 2 brain + 2 mini)');
  }

  stop() {
    this.running = false;
    for (const cron of this.crons) {
      try { cron.stop(); } catch (e) {}
    }
    this.crons = [];
    log.info('brain', 'Cerveau autonome arrete');
  }

  // --- Collecte de l'etat global ---
  _collectState() {
    const state = {
      progress: storage.getProgress(),
      goals: storage.getGoals(),
      config: storage.getConfig(),
      diagnostic: storage.getOpenDiagnostics(),
      recentActions: storage.getRecentActions(10),
      learnings: storage.getLearnings(),
      experiments: storage.getActiveExperiments(),
      skills: {}
    };

    // FlowFast
    try {
      const ff = getFlowFastStorage();
      if (ff) {
        const leads = ff.getLeads ? ff.getLeads() : {};
        const searches = ff.getSearches ? ff.getSearches() : [];
        state.skills.flowfast = {
          totalLeads: Object.keys(leads).length,
          lastSearch: searches.length > 0 ? searches[searches.length - 1] : null,
          recentLeads: Object.values(leads).slice(-5).map(l => ({
            email: l.email, score: l.score, nom: l.nom, entreprise: l.entreprise, titre: l.titre
          }))
        };
      }
    } catch (e) {}

    // AutoMailer
    try {
      const am = getAutomailerStorage();
      if (am) {
        const stats = am.getStats ? am.getStats() : {};
        state.skills.automailer = {
          totalEmails: stats.totalEmailsSent || 0,
          totalOpened: stats.totalEmailsOpened || 0,
          openRate: (stats.totalEmailsSent || 0) > 0
            ? Math.round(((stats.totalEmailsOpened || 0) / stats.totalEmailsSent) * 100) : 0,
          activeCampaigns: stats.activeCampaigns || 0
        };
      }
    } catch (e) {}

    // Lead Enrich
    try {
      const le = getLeadEnrichStorage();
      if (le) {
        const stats = le.getStats ? le.getStats() : {};
        state.skills.leadEnrich = {
          totalEnriched: stats.totalLeadsEnriched || 0,
          apolloCreditsUsed: stats.apolloCreditsUsed || 0,
          apolloCreditsLimit: stats.apolloCreditsLimit || 100,
          apolloRemaining: (stats.apolloCreditsLimit || 100) - (stats.apolloCreditsUsed || 0)
        };
      }
    } catch (e) {}

    // Proactive Agent
    try {
      const pa = getProactiveStorage();
      if (pa) {
        const hotLeads = pa.data?.hotLeads || {};
        state.skills.proactive = {
          hotLeads: Object.entries(hotLeads).filter(([, d]) => (d.opens || 0) >= 3).map(([email, d]) => ({
            email, opens: d.opens
          }))
        };
      }
    } catch (e) {}

    // Self-Improve
    try {
      const si = getSelfImproveStorage();
      if (si) {
        const lastAnalysis = si.getLastAnalysis ? si.getLastAnalysis() : null;
        state.skills.selfImprove = {
          lastAnalysis: lastAnalysis ? lastAnalysis.analyzedAt : null,
          pendingRecos: si.getPendingRecommendations ? si.getPendingRecommendations().length : 0
        };
      }
    } catch (e) {}

    // Web Intelligence (enrichi — Intelligence Reelle v5)
    try {
      const wi = getWebIntelStorage();
      if (wi) {
        const stats = wi.getStats ? wi.getStats() : {};
        const recentArticles = wi.getRecentArticles ? wi.getRecentArticles(20) : [];
        const latestTrends = wi.getLatestTrends ? wi.getLatestTrends() : null;
        const latestCompDigest = wi.getLatestCompetitiveDigest ? wi.getLatestCompetitiveDigest() : null;
        const watches = wi.getWatches ? wi.getWatches() : {};
        const newsOutreach = wi.getRecentNewsOutreach ? wi.getRecentNewsOutreach(10) : [];
        const marketSignals = wi.getRecentMarketSignals ? wi.getRecentMarketSignals(10) : [];

        state.skills.webIntel = {
          totalArticles: stats.totalArticlesFetched || 0,
          activeWatches: Object.keys(watches).length,

          // Articles recents pertinents (score >= 7)
          highRelevanceArticles: recentArticles
            .filter(a => (a.relevanceScore || 0) >= 7)
            .slice(0, 10)
            .map(a => ({
              title: a.title,
              summary: (a.summary || '').substring(0, 150),
              score: a.relevanceScore,
              isUrgent: a.isUrgent,
              source: a.source,
              company: a.crmMatch ? a.crmMatch.company : null,
              fetchedAt: a.fetchedAt
            })),

          // Tendances montantes
          risingTrends: latestTrends ? (latestTrends.rising || []).slice(0, 5) : [],

          // Insights concurrentiels
          competitiveInsights: latestCompDigest ? {
            opportunities: (latestCompDigest.opportunities || []).slice(0, 3),
            threats: (latestCompDigest.threats || []).slice(0, 3),
            keyMoves: (latestCompDigest.keyMoves || []).slice(0, 3),
            generatedAt: latestCompDigest.generatedAt
          } : null,

          // News utilisables pour l'outreach
          newsForOutreach: newsOutreach.filter(n => !n.usedInEmail).slice(0, 5),

          // Signaux marche detectes
          marketSignals: marketSignals
            .filter(s => s.priority === 'high' || s.priority === 'medium')
            .slice(0, 5)
            .map(s => ({
              type: s.type,
              priority: s.priority,
              company: s.article ? s.article.company : null,
              title: s.article ? s.article.title : '',
              action: s.suggestedAction,
              detectedAt: s.detectedAt
            }))
        };
      }
    } catch (e) {}

    // Budget
    try {
      const config = getAppConfig();
      if (config) {
        const budget = config.getBudgetStatus();
        state.budget = {
          todaySpent: Math.round((budget.todaySpent || 0) * 100) / 100,
          dailyLimit: budget.dailyLimit || 5,
          pctUsed: budget.dailyLimit > 0
            ? Math.round(((budget.todaySpent || 0) / budget.dailyLimit) * 100) : 0
        };
      }
    } catch (e) {}

    return state;
  }

  // --- Brain Cycle : le coeur du systeme ---
  async _brainCycle() {
    const config = storage.getConfig();
    const chatId = config.adminChatId;

    log.info('brain', 'Cycle brain demarre...');
    storage.incrementStat('totalBrainCycles');
    storage.updateStat('lastBrainCycleAt', new Date().toISOString());

    // 1. Collecter l'etat
    const state = this._collectState();

    // 2. Run diagnostic
    const diagItems = diagnostic.runFullDiagnostic();

    // 3. Construire le prompt pour Claude
    const systemPrompt = this._buildBrainPrompt(state);
    const userMessage = 'Analyse la situation et propose des actions. Reponds en JSON strict.';

    let plan;
    try {
      // callClaudeOpus fait deja breaker+retry en interne — pas de double-wrap
      const response = await this.callClaudeOpus(systemPrompt, userMessage, 4000);
      plan = this._parseJsonResponse(response);
    } catch (e) {
      log.error('brain', 'Erreur Claude Opus:', e.message);
      plan = this._fallbackPlan(state);
    }

    if (!plan || !plan.actions) {
      log.warn('brain', 'Pas de plan valide, skip');
      return;
    }

    // Limiter a 10 actions par cycle (securite anti-emballement)
    const MAX_BRAIN_ACTIONS = 10;
    if (plan.actions.length > MAX_BRAIN_ACTIONS) {
      log.warn('brain', 'Actions tronquees: ' + plan.actions.length + ' -> ' + MAX_BRAIN_ACTIONS + ' (limite de securite)');
      plan.actions = plan.actions.slice(0, MAX_BRAIN_ACTIONS);
    }

    log.info('brain', 'Plan: ' + plan.actions.length + ' actions, assessment: ' + (plan.weeklyAssessment || '?'));

    // 4. Executer les actions (avec retry sur actions critiques)
    const RETRYABLE_ACTIONS = ['send_email', 'push_to_crm', 'enrich_leads'];
    const MAX_RETRIES = 2;

    for (const action of plan.actions) {
      if (action.autoExecute) {
        let result = null;
        let attempts = 0;
        const maxAttempts = RETRYABLE_ACTIONS.includes(action.type) ? MAX_RETRIES + 1 : 1;

        while (attempts < maxAttempts) {
          attempts++;
          try {
            result = await this.executor.executeAction(action);
            if (result.success || result.deduplicated) break; // Succes ou dedup = pas de retry
            // Echec non-exception : retry si retryable
            if (attempts < maxAttempts) {
              log.warn('brain', 'Action ' + action.type + ' echouee (tentative ' + attempts + '/' + maxAttempts + '): ' + (result.error || '?') + ' — retry dans 2s');
              await new Promise(function(r) { setTimeout(r, 2000); });
            }
          } catch (e) {
            log.error('brain', 'Erreur action auto ' + action.type + ' (tentative ' + attempts + '/' + maxAttempts + '):', e.message);
            result = { success: false, error: e.message };
            if (attempts < maxAttempts) {
              await new Promise(function(r) { setTimeout(r, 2000); });
            }
          }
        }

        // Enregistrer le resultat (succes ou echec final)
        storage.recordAction({
          type: action.type,
          params: action.params,
          preview: action.preview || (result && result.summary) || '',
          result: result || { success: false, error: 'no result' },
          attempts: attempts
        });

        if (result && result.success && result.summary) {
          log.info('brain', 'Action auto: ' + result.summary);
        } else if (result && !result.success && attempts > 1) {
          log.error('brain', 'Action ' + action.type + ' echouee apres ' + attempts + ' tentatives: ' + (result.error || '?'));
        }
      } else {
        const queued = storage.addToQueue(action);
        await this._sendConfirmation(chatId, queued, action);
      }
    }

    // 5. Traiter les experiments proposes par le brain
    if (plan.experiments && plan.experiments.length > 0) {
      for (const exp of plan.experiments) {
        storage.addExperiment({
          type: exp.type || 'ab_test',
          description: exp.description || '',
          hypothesis: exp.hypothesis || '',
          variants: exp.variants || [],
          metric: exp.metric || 'open_rate'
        });
        log.info('brain', 'Nouvelle experience: ' + (exp.description || exp.type));
      }
    }

    // 6. Traiter les learnings du brain
    if (plan.learnings && plan.learnings.length > 0) {
      for (const learning of plan.learnings) {
        const category = learning.category || 'bestSearchCriteria';
        storage.addLearning(category, {
          summary: learning.summary || '',
          data: learning.data || {},
          source: 'brain_cycle'
        });
      }
    }

    // 7. Analyse des patterns + auto-ajustement (Brain v3)
    try {
      const detectedPatterns = this._analyzePatterns();
      if (detectedPatterns) {
        this._autoAdjustCriteria();
      }
    } catch (e) {
      log.error('brain', 'Erreur pattern/adjust:', e.message);
    }

    // 7.5. Sync watches Web Intel avec les criteres de recherche (Intelligence Reelle v5)
    try { this._syncWatchesWithCriteria(); }
    catch (e) { log.warn('brain', 'Erreur sync watches:', e.message); }

    // 7.6. Sync watches Web Intel avec les deals CRM
    try { await this._syncWatchesWithCRMDeals(); }
    catch (e) { log.warn('brain', 'Erreur sync watches CRM:', e.message); }

    // 8. Envoyer resume
    const autoActions = plan.actions.filter(a => a.autoExecute);
    const confirmActions = plan.actions.filter(a => !a.autoExecute);

    if (autoActions.length > 0 || confirmActions.length > 0) {
      let summary = '🧠 *Cycle Autonomous Pilot*\n\n';

      if (plan.reasoning) {
        summary += '_' + plan.reasoning.substring(0, 300) + '_\n\n';
      }

      if (autoActions.length > 0) {
        summary += '✅ *Actions executees :*\n';
        for (const a of autoActions) {
          summary += '• ' + (a.preview || a.type) + '\n';
        }
        summary += '\n';
      }

      if (confirmActions.length > 0) {
        summary += '⏳ *En attente de confirmation :*\n';
        summary += confirmActions.length + ' action(s) — reponds aux messages ci-dessus\n\n';
      }

      if (plan.experiments && plan.experiments.length > 0) {
        summary += '🧪 *Nouvelles experiences :*\n';
        for (const exp of plan.experiments) {
          summary += '• ' + (exp.description || exp.type) + '\n';
        }
        summary += '\n';
      }

      if (plan.weeklyAssessment) {
        summary += '📊 Bilan: ' + plan.weeklyAssessment + '\n';
      }

      try {
        await this.sendTelegram(chatId, summary, 'Markdown');
      } catch (e) {
        log.error('brain', 'Erreur envoi resume:', e.message);
      }
    }
  }

  // --- Envoi de confirmation Telegram avec boutons ---
  async _sendConfirmation(chatId, queuedAction, action) {
    let text = '';

    if (action.type === 'send_email') {
      text = '📧 *Email pret pour ' + (action.params.contactName || action.params.to || '?') + '*\n\n';
      if (action.params.score) text += 'Score: ' + action.params.score + '/10\n';
      if (action.params.company) text += 'Entreprise: ' + action.params.company + '\n';
      if (action.params.subject) text += 'Objet: _' + action.params.subject + '_\n';
      if (action.params.body) text += '\n' + action.params.body.substring(0, 300) + '\n';
    } else {
      text = '⚡ *Action a confirmer*\n\n';
      text += 'Type: ' + action.type + '\n';
      if (action.preview) text += action.preview + '\n';
    }

    const buttons = [
      [
        { text: '✅ Approuver', callback_data: 'ap_approve_' + queuedAction.id },
        { text: '❌ Rejeter', callback_data: 'ap_reject_' + queuedAction.id }
      ]
    ];

    try {
      await this.sendTelegramButtons(chatId, text, buttons);
    } catch (e) {
      log.error('brain', 'Erreur envoi confirmation:', e.message);
      try {
        await this.sendTelegram(chatId, text + '\n(Reponds "approuve" ou "rejette")', 'Markdown');
      } catch (e2) {}
    }
  }

  // --- Traitement des confirmations (callback Telegram) ---
  async handleConfirmation(data, chatId) {
    if (data.startsWith('ap_approve_')) {
      const actionId = data.replace('ap_approve_', '');
      const action = storage.confirmAction(actionId);
      if (!action) {
        return { content: 'Action introuvable ou deja traitee.' };
      }

      try {
        const result = await this.executor.executeAction(action);
        storage.completeAction(actionId, result);

        if (result.success) {
          return { content: (result.summary || 'Action executee avec succes') };
        } else {
          return { content: 'Erreur: ' + (result.error || 'Echec de l\'action') };
        }
      } catch (e) {
        return { content: 'Erreur execution: ' + e.message };
      }
    }

    if (data.startsWith('ap_reject_')) {
      const actionId = data.replace('ap_reject_', '');
      const rejected = storage.rejectAction(actionId);
      if (rejected) {
        return { content: 'Action rejetee.' };
      }
      return { content: 'Action introuvable ou deja traitee.' };
    }

    return null;
  }

  // --- Daily Briefing ---
  async _dailyBriefing() {
    const config = storage.getConfig();
    const chatId = config.adminChatId;
    const state = this._collectState();
    const diagItems = diagnostic.runFullDiagnostic();
    const queued = storage.getQueuedActions();
    const experiments = storage.getActiveExperiments();

    let msg = '☀️ *Briefing du jour — Autonomous Pilot*\n\n';

    // Progres
    const p = state.progress;
    const g = state.goals.weekly;
    msg += '📊 *Progres semaine :*\n';
    msg += '• Leads: ' + p.leadsFoundThisWeek + '/' + g.leadsToFind;
    msg += p.leadsFoundThisWeek >= g.leadsToFind ? ' ✅\n' : '\n';
    msg += '• Emails: ' + p.emailsSentThisWeek + '/' + g.emailsToSend;
    msg += p.emailsSentThisWeek >= g.emailsToSend ? ' ✅\n' : '\n';
    msg += '• Reponses: ' + (p.responsesThisWeek || 0) + '/' + g.responsesTarget + '\n';
    msg += '• RDV: ' + (p.rdvBookedThisWeek || 0) + '/' + g.rdvTarget + '\n';
    if (state.skills.automailer) {
      msg += '• Open rate: ' + state.skills.automailer.openRate + '%\n';
    }
    msg += '\n';

    // Actions en attente
    if (queued.length > 0) {
      msg += '⏳ *' + queued.length + ' action(s) en attente de confirmation*\n\n';
    }

    // Hot leads
    if (state.skills.proactive?.hotLeads?.length > 0) {
      msg += '🔥 *Hot leads :*\n';
      for (const hl of state.skills.proactive.hotLeads.slice(0, 5)) {
        msg += '• ' + hl.email + ' (' + hl.opens + ' ouvertures)\n';
      }
      msg += '\n';
    }

    // Experiences en cours
    if (experiments.length > 0) {
      msg += '🧪 *' + experiments.length + ' experience(s) en cours*\n';
      for (const exp of experiments.slice(0, 3)) {
        msg += '• ' + (exp.description || exp.type) + '\n';
      }
      msg += '\n';
    }

    // Diagnostic
    if (diagItems.length > 0) {
      msg += '📋 *Checklist (' + diagItems.length + ' item(s)) :*\n';
      const priorityIcons = { critical: '🔴', warning: '🟡', info: '🔵' };
      for (const item of diagItems.slice(0, 5)) {
        msg += (priorityIcons[item.priority] || '⚪') + ' ' + item.message + '\n';
      }
      if (diagItems.length > 5) msg += '... et ' + (diagItems.length - 5) + ' autre(s)\n';
      msg += '\n';
    }

    // Budget
    if (state.budget) {
      msg += '💰 Budget: ' + state.budget.todaySpent + '$/' + state.budget.dailyLimit + '$ (' + state.budget.pctUsed + '%)\n';
    }

    // Plan du jour
    msg += '\n🎯 *Aujourd\'hui :*\n';
    const leadsNeeded = g.leadsToFind - p.leadsFoundThisWeek;
    const emailsNeeded = g.emailsToSend - p.emailsSentThisWeek;
    if (leadsNeeded > 0) msg += '• Rechercher ~' + Math.min(leadsNeeded, 10) + ' leads\n';
    if (emailsNeeded > 0) msg += '• Preparer ~' + Math.min(emailsNeeded, 10) + ' emails\n';
    if (leadsNeeded <= 0 && emailsNeeded <= 0) msg += '• Objectifs atteints ! 🎉\n';

    try {
      await this.sendTelegram(chatId, msg, 'Markdown');
    } catch (e) {
      log.error('brain', 'Erreur envoi briefing:', e.message);
    }
  }

  // --- Weekly Reset + Learning Analysis ---
  async _weeklyReset() {
    const config = storage.getConfig();
    const chatId = config.adminChatId;

    // Sauvegarder les perf avant reset
    const oldProgress = storage.resetWeeklyProgress();

    // Analyser les learnings de la semaine
    await this._analyzeWeeklyLearnings(oldProgress);

    // Completer les experiences qui datent de plus de 7 jours
    const experiments = storage.getActiveExperiments();
    for (const exp of experiments) {
      const age = (Date.now() - new Date(exp.startedAt).getTime()) / (24 * 60 * 60 * 1000);
      if (age >= 7) {
        storage.completeExperiment(exp.id, {
          summary: 'Auto-cloture apres 7 jours',
          duration: Math.round(age) + ' jours'
        });
      }
    }

    const g = storage.getGoals().weekly;

    let msg = '📅 *Bilan hebdomadaire — Autonomous Pilot*\n\n';
    msg += '• Leads trouves: ' + oldProgress.leadsFoundThisWeek + '/' + g.leadsToFind;
    msg += oldProgress.leadsFoundThisWeek >= g.leadsToFind ? ' ✅\n' : ' ❌\n';
    msg += '• Emails envoyes: ' + oldProgress.emailsSentThisWeek + '/' + g.emailsToSend;
    msg += oldProgress.emailsSentThisWeek >= g.emailsToSend ? ' ✅\n' : ' ❌\n';
    msg += '• Reponses: ' + (oldProgress.responsesThisWeek || 0) + '/' + g.responsesTarget + '\n';
    msg += '• RDV: ' + (oldProgress.rdvBookedThisWeek || 0) + '/' + g.rdvTarget + '\n';
    msg += '• Enrichis: ' + oldProgress.leadsEnrichedThisWeek + '\n';
    msg += '• Contacts CRM: ' + oldProgress.contactsPushedThisWeek + '\n';
    msg += '• Deals CRM: ' + oldProgress.dealsPushedThisWeek + '\n';
    msg += '\nCompteurs remis a zero. Nouvelle semaine !\n';

    try {
      await this.sendTelegram(chatId, msg, 'Markdown');
    } catch (e) {
      log.error('brain', 'Erreur envoi bilan hebdo:', e.message);
    }
  }

  // --- Analyse hebdomadaire des learnings ---
  async _analyzeWeeklyLearnings(weekProgress) {
    try {
      const state = this._collectState();
      const learnings = storage.getLearnings();
      const history = storage.getRecentActions(50);

      const analysisPrompt = `Tu es l'analyste IA de iFIND. Analyse les performances de la semaine et propose des ajustements.

PERFORMANCES DE LA SEMAINE:
${JSON.stringify(weekProgress, null, 2)}

CRITERES DE RECHERCHE UTILISES:
${JSON.stringify(state.goals.searchCriteria, null, 2)}

HISTORIQUE DES ACTIONS (50 dernieres):
${JSON.stringify(history.map(a => ({ type: a.type, preview: a.preview, result: a.result?.summary || a.result?.error })).slice(0, 20), null, 2)}

EXPERIENCES TERMINEES:
${JSON.stringify(learnings.experiments.filter(e => e.status === 'completed').slice(0, 5), null, 2)}

HISTORIQUE HEBDO PRECEDENT:
${JSON.stringify(learnings.weeklyPerformance.slice(0, 4), null, 2)}

Analyse et reponds en JSON:
{
  "weekSummary": "Resume en 2 phrases de la semaine",
  "topLearnings": [
    {"category": "bestSearchCriteria|bestEmailStyles|bestSendTimes", "summary": "...", "data": {...}}
  ],
  "suggestedCriteriaChanges": {"titles": [...], "locations": [...], "industries": [...]} ou null si pas de changement,
  "suggestedGoalChanges": {"leadsToFind": N, "emailsToSend": N} ou null,
  "newExperiments": [{"type": "ab_test", "description": "...", "hypothesis": "...", "metric": "..."}]
}`;

      // callClaudeOpus fait deja breaker+retry en interne — pas de double-wrap
      const response = await this.callClaudeOpus(analysisPrompt, 'Analyse et propose des ajustements.', 2000);
      const analysis = this._parseJsonResponse(response);

      if (!analysis) return;

      // Enregistrer les learnings
      if (analysis.topLearnings) {
        for (const l of analysis.topLearnings) {
          storage.addLearning(l.category || 'bestSearchCriteria', {
            summary: l.summary,
            data: l.data || {},
            source: 'weekly_analysis'
          });
        }
      }

      // Appliquer les changements de criteres si autonomie = full
      const config = storage.getConfig();
      if (config.autonomyLevel === 'full' && analysis.suggestedCriteriaChanges) {
        const changes = analysis.suggestedCriteriaChanges;
        const updates = {};
        if (changes.titles && changes.titles.length > 0) updates.titles = changes.titles;
        if (changes.locations && changes.locations.length > 0) updates.locations = changes.locations;
        if (changes.industries && changes.industries.length > 0) updates.industries = changes.industries;
        if (Object.keys(updates).length > 0) {
          storage.updateSearchCriteria(updates);
          log.info('brain', 'Criteres auto-ajustes:', JSON.stringify(updates).substring(0, 200));
        }
      }

      // Lancer les nouvelles experiences
      if (analysis.newExperiments) {
        for (const exp of analysis.newExperiments) {
          storage.addExperiment(exp);
        }
      }

      log.info('brain', 'Analyse hebdo terminee: ' + (analysis.weekSummary || '?'));
    } catch (e) {
      log.error('brain', 'Erreur analyse hebdo:', e.message);
    }
  }

  // --- Mini-cycle leger (Intelligence Reelle v5) ---
  // Pas d'appel a Claude Opus — 0$ cout. Verifie signaux + hot leads + retard objectifs.
  async _lightCycle() {
    log.info('brain', 'Mini-cycle demarre...');
    const config = storage.getConfig();
    const chatId = config.adminChatId;
    const state = this._collectState();
    const actions = [];

    // 1. Verifier les signaux marche high priority × leads existants
    const wiSignals = (state.skills.webIntel && state.skills.webIntel.marketSignals) || [];
    const highSignals = wiSignals.filter(s => s.priority === 'high');

    // Score boost map par type de signal
    const SIGNAL_BOOSTS = { funding: 2, expansion: 1.5, acquisition: 2, product_launch: 1, hiring: 0.5, leadership_change: 1 };

    if (highSignals.length > 0) {
      const ffStorage = getFlowFastStorage();
      if (ffStorage) {
        const allLeads = ffStorage.data && ffStorage.data.leads ? ffStorage.data.leads : {};
        for (const signal of highSignals) {
          if (!signal.company) continue;
          const matchingLeads = Object.entries(allLeads).filter(([key, l]) =>
            l.entreprise && l.entreprise.toLowerCase().includes(signal.company.toLowerCase()) && l.email
          );

          // Appliquer le boost de score sur chaque lead matche
          for (const [key, lead] of matchingLeads) {
            const signalId = (signal.detectedAt || '') + '_' + signal.type + '_' + signal.company;
            if (!lead._processedSignals) lead._processedSignals = [];
            if (!lead._processedSignals.includes(signalId)) {
              const boost = SIGNAL_BOOSTS[signal.type] || 0.5;
              const newScore = Math.min(10, (lead.score || 0) + boost);
              const reason = 'Signal ' + signal.type + ': ' + (signal.title || '').substring(0, 80);
              // updateLeadScore persiste le score ET _processedSignals via _save()
              lead._processedSignals.push(signalId);
              if (lead._processedSignals.length > 50) lead._processedSignals = lead._processedSignals.slice(-50);
              ffStorage.updateLeadScore(key, newScore, reason);
            }
          }

          // Notifier sur Telegram
          if (matchingLeads.length > 0) {
            const [, firstLead] = matchingLeads[0];
            const boost = SIGNAL_BOOSTS[signal.type] || 0.5;
            try {
              await this.sendTelegram(chatId,
                '📡 *Opportunite detectee*\n\n' +
                '*Signal:* ' + signal.type + ' — ' + signal.title + '\n' +
                '*Lead(s):* ' + matchingLeads.length + ' (' + firstLead.nom + ', ' + firstLead.entreprise + ')\n' +
                '*Score boost:* +' + boost + '\n' +
                '→ _' + signal.action + '_\n\n' +
                (firstLead._emailSent ? 'Lead deja contacte — relance recommandee !' : 'Ce lead devrait etre contacte en priorite !'),
                'Markdown'
              );
            } catch (e) {}
          }
        }
      }
    }

    // 2. Verifier si objectifs hebdo sont en retard (mi-semaine)
    const progress = state.progress;
    const goals = state.goals.weekly;
    const weekStart = new Date(progress.weekStart);
    const daysElapsed = (Date.now() - weekStart.getTime()) / (24 * 60 * 60 * 1000);

    if (daysElapsed >= 3 && daysElapsed <= 5) {
      const leadsPct = goals.leadsToFind > 0 ? (progress.leadsFoundThisWeek / goals.leadsToFind) * 100 : 100;
      const emailsPct = goals.emailsToSend > 0 ? (progress.emailsSentThisWeek / goals.emailsToSend) * 100 : 100;

      if (leadsPct < 30 || emailsPct < 30) {
        actions.push({
          type: 'search_leads',
          params: { criteria: state.goals.searchCriteria },
          autoExecute: true,
          preview: 'Recherche urgente (mini-cycle : objectifs en retard)'
        });
      }
    }

    // 3. Executer les actions
    for (const action of actions) {
      try {
        const result = await this.executor.executeAction(action);
        storage.recordAction({
          type: action.type,
          params: action.params,
          preview: action.preview || result.summary || '',
          result: result
        });
        log.info('brain', 'Mini-cycle action: ' + (result.summary || action.type));
      } catch (e) {
        log.error('brain', 'Mini-cycle erreur action:', e.message);
      }
    }

    log.info('brain', 'Mini-cycle termine (' + actions.length + ' actions)');
  }

  // --- Auto-creation de watches Web Intel basee sur les criteres de recherche ---
  _syncWatchesWithCriteria() {
    const wiStorage = getWebIntelStorage();
    if (!wiStorage || !wiStorage.addWatch) return;

    const criteria = storage.getGoals().searchCriteria;
    const existingWatches = wiStorage.getWatches ? wiStorage.getWatches() : {};
    const existingNames = Object.values(existingWatches).map(w => w.name.toLowerCase());

    // Creer une watch sectorielle pour chaque industrie dans les criteres
    for (const industry of (criteria.industries || [])) {
      const watchName = 'Secteur: ' + industry;
      if (!existingNames.includes(watchName.toLowerCase())) {
        wiStorage.addWatch({
          name: watchName,
          type: 'sector',
          keywords: [industry.toLowerCase()],
          googleNewsEnabled: true
        });
        log.info('brain', 'Watch auto-creee: ' + watchName);
      }
    }
  }

  // --- Auto-creation de watches Web Intel pour les deals CRM ---
  async _syncWatchesWithCRMDeals() {
    const wiStorage = getWebIntelStorage();
    if (!wiStorage || !wiStorage.addWatch) return;

    const hubspot = getHubSpotClient();
    if (!hubspot) return;

    try {
      const result = await hubspot.listDeals(50);
      if (!result || !result.deals) return;

      const existingWatches = wiStorage.getWatches ? wiStorage.getWatches() : {};
      const existingNames = Object.values(existingWatches).map(w => w.name.toLowerCase());

      let created = 0;
      for (const deal of result.deals) {
        if (!deal || !deal.name) continue;
        const companyName = deal.name.trim();
        if (companyName.length < 2) continue;

        const watchName = 'Prospect: ' + companyName;
        if (existingNames.includes(watchName.toLowerCase())) continue;

        wiStorage.addWatch({
          name: watchName,
          type: 'prospect',
          keywords: [companyName.toLowerCase()],
          googleNewsEnabled: true
        });
        existingNames.push(watchName.toLowerCase());
        created++;
        log.info('brain', 'Watch CRM auto-creee: ' + watchName);

        if (created >= 10) break;
      }

      if (created > 0) {
        log.info('brain', created + ' watches CRM auto-creees');
      }
    } catch (e) {
      log.warn('brain', 'Erreur sync watches CRM:', e.message);
    }
  }

  // --- Prompt du brain ---
  _buildBrainPrompt(state) {
    const p = state.progress;
    const g = state.goals.weekly;
    const sc = state.goals.searchCriteria;
    const config = state.config;

    let prompt = 'Tu es le cerveau autonome de iFIND, un agent de prospection commerciale B2B.';
    if (config.businessContext) {
      prompt += '\n\nCONTEXTE BUSINESS DU CLIENT:\n' + config.businessContext;
    }
    prompt += '\n\n';

    // Offre commerciale
    if (config.offer && (config.offer.setup || config.offer.monthly)) {
      prompt += 'OFFRE COMMERCIALE:\n';
      if (config.offer.description) prompt += '- Description: ' + config.offer.description + '\n';
      if (config.offer.setup) prompt += '- Setup: ' + config.offer.setup + ' EUR\n';
      if (config.offer.monthly) prompt += '- Mensuel: ' + config.offer.monthly + ' EUR/mois\n';
      if (config.offer.commitment) prompt += '- Engagement: ' + config.offer.commitment + '\n';
      if (config.offer.trial) prompt += '- Essai: ' + config.offer.trial + '\n';
      prompt += '\n';
    }

    // Preferences email
    if (config.emailPreferences) {
      prompt += 'REGLES EMAILS (STRICTES - A RESPECTER ABSOLUMENT):\n';
      const ep = config.emailPreferences;
      if (ep.maxLines) prompt += '- Maximum ' + ep.maxLines + ' lignes par email\n';
      if (ep.language) prompt += '- Langue: ' + (ep.language === 'fr' ? 'francais' : ep.language) + '\n';
      if (ep.tone) prompt += '- Ton: ' + ep.tone + '\n';
      if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
        prompt += '- MOTS INTERDITS (ne jamais utiliser): ' + ep.forbiddenWords.join(', ') + '\n';
      }
      if (ep.hookStyle) prompt += '- Style d\'accroche: ' + ep.hookStyle + '\n';
      prompt += '\n';
    }

    prompt += 'ETAT ACTUEL:\n';
    prompt += '- Leads trouves cette semaine: ' + p.leadsFoundThisWeek + '/' + g.leadsToFind + '\n';
    prompt += '- Leads enrichis: ' + p.leadsEnrichedThisWeek + '\n';
    prompt += '- Emails envoyes: ' + p.emailsSentThisWeek + '/' + g.emailsToSend + '\n';
    prompt += '- Reponses: ' + (p.responsesThisWeek || 0) + '/' + g.responsesTarget + '\n';
    prompt += '- RDV: ' + (p.rdvBookedThisWeek || 0) + '/' + g.rdvTarget + '\n';
    prompt += '- Contacts CRM: ' + p.contactsPushedThisWeek + '\n';

    if (state.skills.automailer) {
      prompt += '- Open rate: ' + state.skills.automailer.openRate + '%\n';
    }
    if (state.skills.leadEnrich) {
      prompt += '- Credits Apollo restants: ' + state.skills.leadEnrich.apolloRemaining + '/100\n';
    }
    if (state.budget) {
      prompt += '- Budget API: ' + state.budget.todaySpent + '$/' + state.budget.dailyLimit + '$ (' + state.budget.pctUsed + '%)\n';
    }

    if (state.skills.proactive?.hotLeads?.length > 0) {
      prompt += '- Hot leads: ' + state.skills.proactive.hotLeads.map(h => h.email + '(' + h.opens + ' opens)').join(', ') + '\n';
    }

    prompt += '\nOBJECTIFS HEBDO:\n';
    prompt += '- ' + g.leadsToFind + ' leads qualifies (score >= ' + g.minLeadScore + ')\n';
    prompt += '- ' + g.emailsToSend + ' emails envoyes\n';
    prompt += '- ' + g.responsesTarget + ' reponses positives\n';
    prompt += '- ' + g.rdvTarget + ' RDV decroches\n';
    prompt += '- Open rate >= ' + g.minOpenRate + '%\n';
    prompt += '- Push CRM si score >= ' + g.pushToCrmAboveScore + '\n';

    prompt += '\nCRITERES DE RECHERCHE:\n';
    prompt += JSON.stringify(sc, null, 2) + '\n';

    prompt += '\nNIVEAU D\'AUTONOMIE: ' + config.autonomyLevel + ' (MODE MACHINE DE GUERRE)\n';
    if (config.autonomyLevel === 'full') {
      prompt += '→ Tu es en FULL AUTO. Tu peux rechercher, enrichir, envoyer des emails, creer des sequences de relance SANS demander confirmation.\n';
      prompt += '→ Les emails sont generes automatiquement par ProspectResearcher + ClaudeEmailWriter. Tu n\'as qu\'a fournir le contact et _generateFirst:true.\n';
      prompt += '→ Le warm-up domaine est gere automatiquement par le systeme (max 5/jour semaine 1-2, puis progressif).\n';
    }

    if (state.recentActions.length > 0) {
      prompt += '\nDERNIERES ACTIONS (10 max):\n';
      for (const a of state.recentActions.slice(0, 10)) {
        prompt += '- ' + a.type + ': ' + (a.preview || JSON.stringify(a.result || {}).substring(0, 100)) + '\n';
      }
    }

    if (state.diagnostic.length > 0) {
      prompt += '\nPROBLEMES DETECTES:\n';
      for (const d of state.diagnostic) {
        prompt += '- [' + d.priority + '] ' + d.message + '\n';
      }
    }

    // Learnings existants
    const learnings = state.learnings;
    if (learnings.bestSearchCriteria.length > 0 || learnings.bestEmailStyles.length > 0) {
      prompt += '\nAPPRENTISSAGES PRECEDENTS:\n';
      for (const l of learnings.bestSearchCriteria.slice(0, 3)) {
        prompt += '- Criteres: ' + (l.summary || JSON.stringify(l).substring(0, 100)) + '\n';
      }
      for (const l of learnings.bestEmailStyles.slice(0, 3)) {
        prompt += '- Email: ' + (l.summary || JSON.stringify(l).substring(0, 100)) + '\n';
      }
    }

    // Experiences en cours
    if (state.experiments.length > 0) {
      prompt += '\nEXPERIENCES EN COURS:\n';
      for (const exp of state.experiments) {
        prompt += '- ' + (exp.description || exp.type) + ' (depuis ' + exp.startedAt + ')\n';
      }
    }

    // --- APPRENTISSAGES RECENTS (Brain v3 - patterns detectes) ---
    const patterns = storage.getPatterns();
    if (patterns && patterns.totalEmailsAnalyzed > 0) {
      prompt += '\nAPPRENTISSAGES RECENTS (base sur ' + patterns.totalEmailsAnalyzed + ' emails, open rate global: ' + patterns.globalOpenRate + '%):\n';

      if (patterns.topTitles && patterns.topTitles.length > 0) {
        prompt += '\n  TOP TITRES DE POSTE (par taux d\'ouverture):\n';
        for (const t of patterns.topTitles.slice(0, 5)) {
          prompt += '  - ' + t.label + ': ' + t.openRate + '% open rate (' + t.sent + ' emails)\n';
        }
      }

      if (patterns.topIndustries && patterns.topIndustries.length > 0) {
        prompt += '\n  TOP INDUSTRIES:\n';
        for (const ind of patterns.topIndustries.slice(0, 5)) {
          prompt += '  - ' + ind.label + ': ' + ind.openRate + '% open rate (' + ind.sent + ' emails)\n';
        }
      }

      if (patterns.topCities && patterns.topCities.length > 0) {
        prompt += '\n  TOP VILLES:\n';
        for (const city of patterns.topCities.slice(0, 5)) {
          prompt += '  - ' + city.label + ': ' + city.openRate + '% open rate (' + city.sent + ' emails)\n';
        }
      }

      if (patterns.bestSubjectStyle) {
        prompt += '\n  MEILLEUR STYLE DE SUJET: ' + patterns.bestSubjectStyle + '\n';
        if (patterns.subjectStyles && patterns.subjectStyles.length > 0) {
          for (const s of patterns.subjectStyles.slice(0, 3)) {
            prompt += '  - ' + s.key + ': ' + s.openRate + '% open rate (' + s.sent + ' emails)\n';
          }
        }
      }

      if (patterns.bestSendHour !== null && patterns.bestSendHour !== undefined) {
        prompt += '\n  MEILLEURE HEURE D\'ENVOI: ' + patterns.bestSendHour + 'h\n';
        if (patterns.hourStats && patterns.hourStats.length > 0) {
          for (const h of patterns.hourStats.slice(0, 3)) {
            prompt += '  - ' + h.key + 'h: ' + h.openRate + '% open rate (' + h.sent + ' emails)\n';
          }
        }
      }

      // Recommandations Self-Improve (evite double analyse IA)
      if (patterns.selfImproveAnalysis) {
        const sia = patterns.selfImproveAnalysis;
        if (sia.bestSendHours) prompt += '\n  SELF-IMPROVE - MEILLEURE HEURE (analyse IA): ' + sia.bestSendHours + '\n';
        if (sia.bestDays) prompt += '  SELF-IMPROVE - MEILLEURS JOURS: ' + sia.bestDays + '\n';
        if (sia.recommendations && sia.recommendations.length > 0) {
          prompt += '\n  RECOMMANDATIONS SELF-IMPROVE:\n';
          for (const r of sia.recommendations.slice(0, 3)) {
            prompt += '  - ' + (r.summary || r.description || r.type || '?') + '\n';
          }
        }
      }
      if (patterns.pendingSelfImproveRecos && patterns.pendingSelfImproveRecos.length > 0) {
        prompt += '\n  RECOS EN ATTENTE D\'APPLICATION:\n';
        for (const r of patterns.pendingSelfImproveRecos) {
          prompt += '  - [' + r.type + '] ' + r.summary + '\n';
        }
      }

      prompt += '\n  → Utilise ces patterns ET les recommandations Self-Improve pour prioriser.\n';
      prompt += '  → Concentre-toi sur les titres/industries/villes qui performent le mieux.\n';
    }

    // --- Historique des ajustements de criteres (Brain v3) ---
    const criteriaHistory = storage.getCriteriaHistory();
    if (criteriaHistory.length > 0) {
      prompt += '\nDERNIERS AJUSTEMENTS DE CRITERES (' + criteriaHistory.length + ' total):\n';
      for (const adj of criteriaHistory.slice(0, 5)) {
        prompt += '- [' + (adj.adjustedAt || '?').substring(0, 10) + '] ' + adj.action + ': ' + adj.value + ' — ' + adj.reason + '\n';
      }
    }

    // --- WEB INTELLIGENCE DATA (Intelligence Reelle v5) ---
    if (state.skills.webIntel) {
      const wi = state.skills.webIntel;

      if (wi.highRelevanceArticles && wi.highRelevanceArticles.length > 0) {
        prompt += '\nARTICLES WEB PERTINENTS (score >= 7/10):\n';
        for (const a of wi.highRelevanceArticles.slice(0, 5)) {
          prompt += '- ' + a.title + ' [' + a.score + '/10]';
          if (a.isUrgent) prompt += ' URGENT';
          if (a.company) prompt += ' (entreprise: ' + a.company + ')';
          prompt += '\n  ' + a.summary + '\n';
        }
      }

      if (wi.risingTrends && wi.risingTrends.length > 0) {
        prompt += '\nTENDANCES MONTANTES (Web Intelligence):\n';
        for (const t of wi.risingTrends.slice(0, 3)) {
          prompt += '- ' + t.keyword + ' (+' + t.change + '%, ' + t.recentMentions + ' mentions)\n';
        }
      }

      if (wi.competitiveInsights) {
        prompt += '\nVEILLE CONCURRENTIELLE:\n';
        if (wi.competitiveInsights.opportunities.length > 0) {
          prompt += 'Opportunites: ' + wi.competitiveInsights.opportunities.join('; ') + '\n';
        }
        if (wi.competitiveInsights.threats.length > 0) {
          prompt += 'Menaces: ' + wi.competitiveInsights.threats.join('; ') + '\n';
        }
      }

      if (wi.newsForOutreach && wi.newsForOutreach.length > 0) {
        prompt += '\nNEWS UTILISABLES POUR EMAILS (entreprises dans l\'actu):\n';
        for (const n of wi.newsForOutreach) {
          prompt += '- ' + n.company + ': "' + n.headline + '"\n';
        }
        prompt += '→ Privilegie ces entreprises pour les prochains emails (actualite = meilleure accroche).\n';
      }

      if (wi.marketSignals && wi.marketSignals.length > 0) {
        prompt += '\nSIGNAUX MARCHE DETECTES:\n';
        for (const s of wi.marketSignals) {
          prompt += '- [' + s.priority.toUpperCase() + '] ' + s.type + ': ' + s.title + '\n';
          prompt += '  → ' + s.action + '\n';
          if (s.company) prompt += '  Entreprise: ' + s.company + '\n';
        }
        prompt += '→ PRIORISE les leads lies a ces signaux.\n';
      }
    }

    prompt += '\nACTIONS DISPONIBLES:\n';
    prompt += '1. search_leads — Rechercher des leads via Apollo (params.criteria)\n';
    prompt += '2. enrich_leads — Enrichir des leads (params.emails: [])\n';
    prompt += '3. push_to_crm — Pousser vers HubSpot (params.contacts: [])\n';
    prompt += '4. generate_email — Generer un email sans l\'envoyer (params.contact: {email,name,company,title}, params.context)\n';
    prompt += '5. send_email — Envoyer un email (params: to, contactName, company, score, contact: {email,nom,entreprise,titre}, _generateFirst: true) — autoExecute=true\n';
    prompt += '6. update_search_criteria — Modifier les criteres de recherche (params: {titles?, locations?, industries?, seniorities?, companySize?, keywords?, limit?})\n';
    prompt += '7. update_goals — Modifier les objectifs (params: {leadsToFind?, emailsToSend?, responsesTarget?, rdvTarget?, minLeadScore?})\n';
    prompt += '8. record_learning — Enregistrer un apprentissage (params: {category: "bestSearchCriteria|bestEmailStyles|bestSendTimes", summary: "...", data: {}})\n';
    prompt += '9. create_followup_sequence — Creer une sequence de 3 relances automatiques pour des leads deja contactes sans reponse (params: {contacts: [{email, nom, entreprise, titre}], totalSteps: 3, intervalDays: 4})\n';

    prompt += '\nREGLES (MODE MACHINE DE GUERRE):\n';
    prompt += '1. autoExecute=true pour TOUTES les actions, y compris send_email. Tu es en FULL AUTO.\n';
    prompt += '2. Pour send_email, mets TOUJOURS _generateFirst:true — la recherche prospect est OBLIGATOIRE avant chaque email.\n';
    prompt += '3. NE FOURNIS PAS subject/body dans send_email — le ProspectResearcher + ClaudeEmailWriter les generent automatiquement avec des infos fraiches.\n';
    prompt += '4. Envoie 3-5 emails PAR CYCLE. Priorise les leads score >= 8. RESPECTE la limite warm-up (le systeme bloque au-dela).\n';
    prompt += '5. JAMAIS de prix, d\'offre, de feature, de "pilote gratuit" dans le premier email. Le but = OUVRIR UNE CONVERSATION.\n';
    prompt += '6. Apres 3 jours sans reponse sur un lead contacte, cree automatiquement une sequence follow-up (create_followup_sequence).\n';
    prompt += '7. Sois strategique avec les credits Apollo (100/mois). Prefere des recherches ciblees.\n';
    prompt += '8. ITERE: Si un secteur ou profil donne de meilleurs resultats, ajuste les criteres pour en faire plus.\n';
    prompt += '9. TESTE: Lance des experiences A/B (differents objets d\'email, differents secteurs, differentes accroches).\n';
    prompt += '10. APPRENDS: Apres chaque lot d\'emails, note ce qui a marche (open rate, reponses) via record_learning.\n';
    prompt += '11. NE REPETE PAS les memes erreurs. Si une action echoue, essaie une approche differente.\n';
    prompt += '12. UTILISE les articles Web Intelligence pour personnaliser les emails. Si une entreprise est dans l\'actualite, mentionne-le.\n';
    prompt += '13. PRIORISE les leads dont l\'entreprise est dans l\'actualite (news recentes, signaux marche). C\'est un signal d\'opportunite fort.\n';
    prompt += '14. Si les objectifs sont inatteignables, ajuste-les via update_goals plutot que de forcer.\n';

    prompt += '\nReponds UNIQUEMENT en JSON avec cette structure:\n';
    prompt += '{\n';
    prompt += '  "reasoning": "Ton raisonnement strategique en 3-5 phrases",\n';
    prompt += '  "actions": [{"type": "...", "params": {...}, "autoExecute": bool, "preview": "description courte"}],\n';
    prompt += '  "experiments": [{"type": "ab_test", "description": "...", "hypothesis": "...", "metric": "open_rate|reply_rate|score"}],\n';
    prompt += '  "learnings": [{"category": "bestSearchCriteria|bestEmailStyles|bestSendTimes", "summary": "...", "data": {}}],\n';
    prompt += '  "diagnosticItems": [{"type": "owner_action|bot_fixable", "priority": "critical|warning|info", "message": "...", "suggestion": "..."}],\n';
    prompt += '  "weeklyAssessment": "On track / Behind schedule / Ahead of schedule + explication"\n';
    prompt += '}\n';

    return prompt;
  }

  // --- Parse JSON response from Claude (robuste) ---
  _parseJsonResponse(text) {
    if (!text) return null;
    try {
      // 1. Strip markdown code blocks
      let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

      // 2. Essai parse direct
      try { return JSON.parse(cleaned); } catch (_) {}

      // 3. Trouver le premier objet JSON balance (accolades equilibrees)
      let depth = 0, start = -1;
      let parsed = null;
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === '{') {
          if (depth === 0) start = i;
          depth++;
        } else if (cleaned[i] === '}') {
          depth--;
          if (depth === 0 && start !== -1) {
            try {
              parsed = JSON.parse(cleaned.substring(start, i + 1));
              break;
            } catch (_) {
              start = -1;
            }
          }
        }
      }

      // Validation du schema : s'assurer que les champs attendus sont des arrays
      if (parsed && typeof parsed === 'object') {
        if (!Array.isArray(parsed.actions)) parsed.actions = [];
        if (!Array.isArray(parsed.experiments)) parsed.experiments = [];
        if (!Array.isArray(parsed.learnings)) parsed.learnings = [];
        if (!Array.isArray(parsed.diagnosticItems)) parsed.diagnosticItems = [];
        if (!parsed.reasoning) parsed.reasoning = '(raison non fournie)';
        return parsed;
      }
    } catch (e) {
      log.warn('brain', 'Erreur parse JSON:', e.message);
    }
    return null;
  }

  // --- 3a. Pattern Detection : analyse les donnees email pour detecter des patterns ---
  _analyzePatterns() {
    try {
      const am = getAutomailerStorage();
      if (!am || !am.data) {
        log.info('brain', 'Pattern detection: automailer non disponible');
        return null;
      }

      const emails = am.data.emails || [];
      const le = getLeadEnrichStorage();
      const enrichedLeads = (le && le.data) ? le.data.enrichedLeads || {} : {};

      // Filtrer les emails envoyes (pas queued)
      const sentEmails = emails.filter(e => e.sentAt && e.to);
      if (sentEmails.length < 3) {
        log.info('brain', 'Pattern detection: pas assez de donnees (' + sentEmails.length + ' emails)');
        return null;
      }

      // --- Collecter les donnees par dimension ---
      const byTitle = {};    // titre de poste → { sent, opened }
      const byIndustry = {}; // industrie → { sent, opened }
      const byCity = {};     // ville → { sent, opened }
      const bySubject = {};  // style de sujet → { sent, opened }
      const byHour = {};     // heure d'envoi → { sent, opened }
      const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

      for (const email of sentEmails) {
        const lead = enrichedLeads[email.to.toLowerCase()] || null;
        const cls = (lead && lead.aiClassification) ? lead.aiClassification : {};
        const person = (lead && lead.apolloData && lead.apolloData.person) ? lead.apolloData.person : {};
        const opened = !!email.openedAt;
        const sentDate = new Date(email.sentAt);

        // Par titre de poste
        const title = person.title || cls.persona || null;
        if (title) {
          const titleKey = title.toLowerCase().trim();
          if (!byTitle[titleKey]) byTitle[titleKey] = { sent: 0, opened: 0, label: title };
          byTitle[titleKey].sent++;
          if (opened) byTitle[titleKey].opened++;
        }

        // Par industrie
        const industry = cls.industry || null;
        if (industry) {
          const indKey = industry.toLowerCase().trim();
          if (!byIndustry[indKey]) byIndustry[indKey] = { sent: 0, opened: 0, label: industry };
          byIndustry[indKey].sent++;
          if (opened) byIndustry[indKey].opened++;
        }

        // Par ville
        const city = person.city || null;
        if (city) {
          const cityKey = city.toLowerCase().trim();
          if (!byCity[cityKey]) byCity[cityKey] = { sent: 0, opened: 0, label: city };
          byCity[cityKey].sent++;
          if (opened) byCity[cityKey].opened++;
        }

        // Par style de sujet d'email
        const subject = (email.subject || '').trim();
        if (subject) {
          let subjectStyle = 'statement';
          if (subject.endsWith('?')) subjectStyle = 'question';
          else if (subject.length < 30) subjectStyle = 'court';
          else if (subject.length > 60) subjectStyle = 'long';
          else if (/^\d/.test(subject) || /\d+/.test(subject)) subjectStyle = 'chiffres';
          else if (subject.toLowerCase().includes('re:') || subject.toLowerCase().includes('fwd:')) subjectStyle = 'reply_style';

          if (!bySubject[subjectStyle]) bySubject[subjectStyle] = { sent: 0, opened: 0 };
          bySubject[subjectStyle].sent++;
          if (opened) bySubject[subjectStyle].opened++;
        }

        // Par heure d'envoi
        const hour = sentDate.getHours();
        const hourKey = String(hour);
        if (!byHour[hourKey]) byHour[hourKey] = { sent: 0, opened: 0 };
        byHour[hourKey].sent++;
        if (opened) byHour[hourKey].opened++;
      }

      // --- Trier et extraire les top performers ---
      const sortByRate = (obj, minSent) => {
        minSent = minSent || 2;
        return Object.entries(obj)
          .filter(([, d]) => d.sent >= minSent)
          .map(([key, d]) => ({
            key: key,
            label: d.label || key,
            sent: d.sent,
            opened: d.opened,
            openRate: Math.round((d.opened / d.sent) * 100)
          }))
          .sort((a, b) => b.openRate - a.openRate || b.sent - a.sent);
      };

      const topTitles = sortByRate(byTitle, 2).slice(0, 10);
      const topIndustries = sortByRate(byIndustry, 2).slice(0, 10);
      const topCities = sortByRate(byCity, 2).slice(0, 10);
      const subjectStyles = sortByRate(bySubject, 2);
      const hourStats = sortByRate(byHour, 2);

      const bestSubjectStyle = subjectStyles.length > 0 ? subjectStyles[0].key : null;
      const bestSendHour = hourStats.length > 0 ? parseInt(hourStats[0].key) : null;

      const patterns = {
        topTitles: topTitles,
        topIndustries: topIndustries,
        topCities: topCities,
        subjectStyles: subjectStyles,
        bestSubjectStyle: bestSubjectStyle,
        hourStats: hourStats,
        bestSendHour: bestSendHour,
        totalEmailsAnalyzed: sentEmails.length,
        totalOpened: sentEmails.filter(e => !!e.openedAt).length,
        globalOpenRate: sentEmails.length > 0
          ? Math.round((sentEmails.filter(e => !!e.openedAt).length / sentEmails.length) * 100) : 0
      };

      // Enrichir avec les recommandations Self-Improve (evite double analyse IA)
      try {
        const siStorage = getSelfImproveStorage();
        if (siStorage) {
          const lastAnalysis = siStorage.getLastAnalysis ? siStorage.getLastAnalysis() : null;
          if (lastAnalysis) {
            patterns.selfImproveAnalysis = {
              analyzedAt: lastAnalysis.analyzedAt || null,
              bestSendHours: lastAnalysis.bestSendHours || null,
              bestDays: lastAnalysis.bestDays || null,
              recommendations: (lastAnalysis.recommendations || []).slice(0, 5)
            };
          }
          const pendingRecos = siStorage.getPendingRecommendations ? siStorage.getPendingRecommendations() : [];
          if (pendingRecos.length > 0) {
            patterns.pendingSelfImproveRecos = pendingRecos.slice(0, 5).map(r => ({
              type: r.type, summary: r.summary || r.description || ''
            }));
          }
        }
      } catch (e) {}

      storage.savePatterns(patterns);
      log.info('brain', 'Patterns detectes: ' + topTitles.length + ' titres, ' +
        topIndustries.length + ' industries, ' + topCities.length + ' villes, ' +
        'best hour=' + bestSendHour + ', best subject=' + bestSubjectStyle);

      return patterns;
    } catch (e) {
      log.error('brain', 'Erreur analyse patterns:', e.message);
      return null;
    }
  }

  // --- 3b. Auto-adjustment des criteres basé sur les patterns ---
  _autoAdjustCriteria() {
    try {
      const patterns = storage.getPatterns();
      if (!patterns || !patterns.totalEmailsAnalyzed) {
        log.info('brain', 'Auto-adjust: pas de patterns disponibles');
        return;
      }

      const config = storage.getConfig();
      if (config.autonomyLevel !== 'full') {
        log.info('brain', 'Auto-adjust: autonomie non-full, skip');
        return;
      }

      const currentCriteria = storage.getGoals().searchCriteria;
      const MIN_DATA_POINTS = 5;
      const POOR_OPEN_RATE = 5;   // % — seuil de mauvaise performance
      const MIN_EMAILS_POOR = 20; // nb minimum d'emails pour juger "mauvaise performance"
      const adjustments = [];

      // --- Ajouter des titres performants non encore dans les criteres ---
      if (patterns.topTitles && patterns.topTitles.length > 0) {
        const currentTitlesLower = (currentCriteria.titles || []).map(t => t.toLowerCase());
        for (const t of patterns.topTitles) {
          if (t.sent >= MIN_DATA_POINTS && t.openRate >= 20) {
            // Verifier si ce titre n'est pas deja dans les criteres
            const isIncluded = currentTitlesLower.some(ct =>
              t.label.toLowerCase().includes(ct) || ct.includes(t.label.toLowerCase())
            );
            if (!isIncluded) {
              adjustments.push({
                action: 'add_title',
                value: t.label,
                reason: 'Titre "' + t.label + '" a ' + t.openRate + '% open rate sur ' + t.sent + ' emails',
                dataPoints: t.sent
              });
            }
          }
        }
      }

      // --- Ajouter des industries performantes ---
      if (patterns.topIndustries && patterns.topIndustries.length > 0) {
        const currentIndustriesLower = (currentCriteria.industries || []).map(i => i.toLowerCase());
        for (const ind of patterns.topIndustries) {
          if (ind.sent >= MIN_DATA_POINTS && ind.openRate >= 20) {
            const isIncluded = currentIndustriesLower.some(ci =>
              ind.label.toLowerCase().includes(ci) || ci.includes(ind.label.toLowerCase())
            );
            if (!isIncluded) {
              adjustments.push({
                action: 'add_industry',
                value: ind.label,
                reason: 'Industrie "' + ind.label + '" a ' + ind.openRate + '% open rate sur ' + ind.sent + ' emails',
                dataPoints: ind.sent
              });
            }
          }
        }
      }

      // --- Ajouter des villes performantes ---
      if (patterns.topCities && patterns.topCities.length > 0) {
        const currentLocationsLower = (currentCriteria.locations || []).map(l => l.toLowerCase());
        for (const city of patterns.topCities) {
          if (city.sent >= MIN_DATA_POINTS && city.openRate >= 20) {
            const isIncluded = currentLocationsLower.some(cl =>
              city.label.toLowerCase().includes(cl) || cl.includes(city.label.toLowerCase())
            );
            if (!isIncluded) {
              adjustments.push({
                action: 'add_location',
                value: city.label,
                reason: 'Ville "' + city.label + '" a ' + city.openRate + '% open rate sur ' + city.sent + ' emails',
                dataPoints: city.sent
              });
            }
          }
        }
      }

      // --- Retirer les titres qui performent mal ---
      if (patterns.topTitles && patterns.topTitles.length > 0) {
        const allTitleStats = {};
        for (const t of patterns.topTitles) {
          allTitleStats[t.label.toLowerCase()] = t;
        }
        for (const currentTitle of (currentCriteria.titles || [])) {
          const matchingPattern = Object.entries(allTitleStats).find(([key]) =>
            key.includes(currentTitle.toLowerCase()) || currentTitle.toLowerCase().includes(key)
          );
          if (matchingPattern) {
            const [, data] = matchingPattern;
            if (data.sent >= MIN_EMAILS_POOR && data.openRate < POOR_OPEN_RATE) {
              adjustments.push({
                action: 'remove_title',
                value: currentTitle,
                reason: 'Titre "' + currentTitle + '" a seulement ' + data.openRate + '% open rate sur ' + data.sent + ' emails (< ' + POOR_OPEN_RATE + '%)',
                dataPoints: data.sent
              });
            }
          }
        }
      }

      // --- Retirer les industries qui performent mal ---
      if (patterns.topIndustries && patterns.topIndustries.length > 0) {
        const allIndStats = {};
        for (const ind of patterns.topIndustries) {
          allIndStats[ind.label.toLowerCase()] = ind;
        }
        for (const currentInd of (currentCriteria.industries || [])) {
          const matchingPattern = Object.entries(allIndStats).find(([key]) =>
            key.includes(currentInd.toLowerCase()) || currentInd.toLowerCase().includes(key)
          );
          if (matchingPattern) {
            const [, data] = matchingPattern;
            if (data.sent >= MIN_EMAILS_POOR && data.openRate < POOR_OPEN_RATE) {
              adjustments.push({
                action: 'remove_industry',
                value: currentInd,
                reason: 'Industrie "' + currentInd + '" a seulement ' + data.openRate + '% open rate sur ' + data.sent + ' emails (< ' + POOR_OPEN_RATE + '%)',
                dataPoints: data.sent
              });
            }
          }
        }
      }

      // --- Appliquer les ajustements ---
      if (adjustments.length === 0) {
        log.info('brain', 'Auto-adjust: aucun ajustement necessaire');
        return;
      }

      const updates = {};
      let titlesToAdd = [];
      let titlesToRemove = [];
      let industriesToAdd = [];
      let industriesToRemove = [];
      let locationsToAdd = [];

      for (const adj of adjustments) {
        if (adj.action === 'add_title') titlesToAdd.push(adj.value);
        if (adj.action === 'remove_title') titlesToRemove.push(adj.value);
        if (adj.action === 'add_industry') industriesToAdd.push(adj.value);
        if (adj.action === 'remove_industry') industriesToRemove.push(adj.value);
        if (adj.action === 'add_location') locationsToAdd.push(adj.value);

        log.info('brain', 'Auto-adjust: ' + adj.action + ' "' + adj.value + '" — ' + adj.reason);
        storage.addCriteriaAdjustment(adj);
      }

      // Appliquer les modifications
      if (titlesToAdd.length > 0 || titlesToRemove.length > 0) {
        let newTitles = [...(currentCriteria.titles || [])];
        for (const t of titlesToAdd) {
          if (!newTitles.some(nt => nt.toLowerCase() === t.toLowerCase())) {
            newTitles.push(t);
          }
        }
        newTitles = newTitles.filter(t => !titlesToRemove.some(r => r.toLowerCase() === t.toLowerCase()));
        if (newTitles.length > 0) updates.titles = newTitles;
      }

      if (industriesToAdd.length > 0 || industriesToRemove.length > 0) {
        let newIndustries = [...(currentCriteria.industries || [])];
        for (const i of industriesToAdd) {
          if (!newIndustries.some(ni => ni.toLowerCase() === i.toLowerCase())) {
            newIndustries.push(i);
          }
        }
        newIndustries = newIndustries.filter(i => !industriesToRemove.some(r => r.toLowerCase() === i.toLowerCase()));
        updates.industries = newIndustries;
      }

      if (locationsToAdd.length > 0) {
        let newLocations = [...(currentCriteria.locations || [])];
        for (const l of locationsToAdd) {
          if (!newLocations.some(nl => nl.toLowerCase() === l.toLowerCase())) {
            newLocations.push(l);
          }
        }
        updates.locations = newLocations;
      }

      if (Object.keys(updates).length > 0) {
        storage.updateSearchCriteria(updates);
        log.info('brain', 'Auto-adjust: criteres mis a jour — ' + JSON.stringify(updates).substring(0, 300));
      }
    } catch (e) {
      log.error('brain', 'Erreur auto-adjust criteres:', e.message);
    }
  }

  // --- Fallback plan si Claude echoue ---
  _fallbackPlan(state) {
    const actions = [];
    const p = state.progress;
    const g = state.goals.weekly;

    // 1. Chercher des leads si objectif non atteint
    if (p.leadsFoundThisWeek < g.leadsToFind) {
      actions.push({
        type: 'search_leads',
        params: { criteria: state.goals.searchCriteria },
        autoExecute: true,
        preview: 'Recherche de leads (fallback)'
      });
    }

    // 2. Generer + envoyer des emails aux leads qualifies avec email
    if (p.emailsSentThisWeek < g.emailsToSend) {
      const ffStorage = getFlowFastStorage();
      if (ffStorage) {
        const allLeads = ffStorage.getAllLeads ? ffStorage.getAllLeads() : {};
        const leadsWithEmail = Object.values(allLeads)
          .filter(l => l.email && (l.score || 0) >= (g.minLeadScore || 7) && !l._emailSent)
          .slice(0, 5); // Max 5 emails par cycle (warmup progressif)

        for (const lead of leadsWithEmail) {
          actions.push({
            type: 'send_email',
            params: {
              to: lead.email,
              contactName: lead.nom || '',
              company: lead.entreprise || '',
              score: lead.score || 0,
              _generateFirst: true,
              contact: {
                email: lead.email,
                nom: lead.nom,
                titre: lead.titre,
                entreprise: lead.entreprise
              }
            },
            autoExecute: true, // FULL AUTO — machine de guerre
            preview: 'Email pour ' + (lead.nom || lead.email) + ' (' + lead.entreprise + ')'
          });
        }
      }
    }

    // 3. Creer une sequence de follow-up pour les leads deja contactes sans reponse
    const amStorage = getAutomailerStorage();
    if (amStorage) {
      const sentEmails = amStorage.data.emails.filter(e =>
        e.source === 'autonomous-pilot' &&
        (e.status === 'sent' || e.status === 'delivered') &&
        !e.campaignId // Pas deja dans une campagne de relance
      );

      // Trouver les leads contactes il y a 3+ jours sans campagne de relance
      const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
      const needsFollowUp = sentEmails.filter(e => {
        if (!e.sentAt) return false;
        const sentTime = new Date(e.sentAt).getTime();
        if (sentTime > threeDaysAgo) return false; // Trop recent
        // Verifier qu'il n'y a pas deja une campagne pour ce contact
        const allCampaigns = amStorage.getAllCampaigns();
        const hasSequence = allCampaigns.some(c =>
          c.name && c.name.startsWith('Relance auto') &&
          c.status !== 'completed' &&
          amStorage.getEmailsByCampaign(c.id).some(ce => ce.to === e.to)
        );
        return !hasSequence;
      });

      if (needsFollowUp.length > 0) {
        const ffStorage = getFlowFastStorage();
        const contacts = needsFollowUp.map(e => {
          const lead = ffStorage ? (ffStorage.getAllLeads ? ffStorage.getAllLeads() : {})[e.to] : null;
          return {
            email: e.to,
            nom: e.contactName || (lead && lead.nom) || '',
            entreprise: e.company || (lead && lead.entreprise) || '',
            titre: (lead && lead.titre) || ''
          };
        }).slice(0, 10); // Max 10 contacts par sequence

        actions.push({
          type: 'create_followup_sequence',
          params: {
            contacts: contacts,
            totalSteps: 3,
            intervalDays: 4
          },
          autoExecute: true,
          preview: 'Sequence relance pour ' + contacts.length + ' lead(s) sans reponse'
        });
      }
    }

    // 4. Pousser les leads qualifies vers HubSpot
    if (p.contactsPushedThisWeek < (p.leadsFoundThisWeek || 0)) {
      const ffStorage2 = getFlowFastStorage();
      if (ffStorage2) {
        const allLeads = ffStorage2.getAllLeads ? ffStorage2.getAllLeads() : {};
        const toPush = Object.values(allLeads)
          .filter(l => l.email && (l.score || 0) >= (g.pushToCrmAboveScore || 8) && !l.pushedToHubspot)
          .slice(0, 10);

        if (toPush.length > 0) {
          actions.push({
            type: 'push_to_crm',
            params: {
              contacts: toPush.map(l => ({
                email: l.email,
                firstName: l.nom?.split(' ')[0] || '',
                lastName: l.nom?.split(' ').slice(1).join(' ') || '',
                title: l.titre,
                company: l.entreprise,
                score: l.score
              }))
            },
            autoExecute: true,
            preview: toPush.length + ' leads vers HubSpot'
          });
        }
      }
    }

    return {
      reasoning: 'Plan fallback (Claude non disponible)',
      actions: actions,
      experiments: [],
      learnings: [],
      diagnosticItems: [],
      weeklyAssessment: p.leadsFoundThisWeek >= g.leadsToFind ? 'On track' : 'Behind schedule'
    };
  }
}

module.exports = BrainEngine;
