// Autonomous Pilot - Brain Engine (cerveau autonome)
const { Cron } = require('croner');
const storage = require('./storage.js');
const ActionExecutor = require('./action-executor.js');
const diagnostic = require('./diagnostic.js');

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

function getMoltbotConfig() {
  return _require('../../gateway/moltbot-config.js', '/app/gateway/moltbot-config.js');
}

class BrainEngine {
  constructor(options) {
    this.sendTelegram = options.sendTelegram;
    this.sendTelegramButtons = options.sendTelegramButtons;
    this.callClaude = options.callClaude;
    this.callClaudeOpus = options.callClaudeOpus;

    this.executor = new ActionExecutor({
      apolloKey: options.apolloKey,
      hubspotKey: options.hubspotKey,
      openaiKey: options.openaiKey,
      claudeKey: options.claudeKey,
      resendKey: options.resendKey,
      senderEmail: options.senderEmail
    });

    this.crons = [];
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tz = 'Europe/Paris';

    // Brain cycle : 8h, 12h, 16h, 20h
    this.crons.push(new Cron('0 8,12,16,20 * * *', { timezone: tz }, async () => {
      try { await this._brainCycle(); }
      catch (e) { console.error('[brain] Erreur cycle:', e.message); }
    }));

    // Daily briefing : 7h30
    this.crons.push(new Cron('30 7 * * *', { timezone: tz }, async () => {
      try { await this._dailyBriefing(); }
      catch (e) { console.error('[brain] Erreur briefing:', e.message); }
    }));

    // Weekly reset + learning : lundi 0h
    this.crons.push(new Cron('0 0 * * 1', { timezone: tz }, async () => {
      try { await this._weeklyReset(); }
      catch (e) { console.error('[brain] Erreur reset hebdo:', e.message); }
    }));

    console.log('[brain] Cerveau autonome demarre (3 crons)');
  }

  stop() {
    this.running = false;
    for (const cron of this.crons) {
      try { cron.stop(); } catch (e) {}
    }
    this.crons = [];
    console.log('[brain] Cerveau autonome arrete');
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

    // Web Intelligence
    try {
      const wi = getWebIntelStorage();
      if (wi) {
        const stats = wi.getStats ? wi.getStats() : {};
        state.skills.webIntel = {
          totalArticles: stats.totalArticlesFetched || 0,
          activeWatches: Object.keys(wi.getWatches ? wi.getWatches() : {}).length
        };
      }
    } catch (e) {}

    // Budget
    try {
      const config = getMoltbotConfig();
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

    console.log('[brain] Cycle brain demarre...');
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
      const response = await this.callClaudeOpus(systemPrompt, userMessage, 4000);
      plan = this._parseJsonResponse(response);
    } catch (e) {
      console.error('[brain] Erreur Claude:', e.message);
      plan = this._fallbackPlan(state);
    }

    if (!plan || !plan.actions) {
      console.log('[brain] Pas de plan valide, skip');
      return;
    }

    console.log('[brain] Plan: ' + plan.actions.length + ' actions, assessment: ' + (plan.weeklyAssessment || '?'));

    // 4. Executer les actions
    for (const action of plan.actions) {
      if (action.autoExecute) {
        try {
          const result = await this.executor.executeAction(action);
          storage.recordAction({
            type: action.type,
            params: action.params,
            preview: action.preview || result.summary || '',
            result: result
          });

          if (result.success && result.summary) {
            console.log('[brain] Action auto: ' + result.summary);
          }
        } catch (e) {
          console.error('[brain] Erreur action auto ' + action.type + ':', e.message);
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
        console.log('[brain] Nouvelle experience: ' + (exp.description || exp.type));
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

    // 7. Envoyer resume
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
        console.error('[brain] Erreur envoi resume:', e.message);
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
      console.error('[brain] Erreur envoi confirmation:', e.message);
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
        return 'Action introuvable ou deja traitee.';
      }

      try {
        const result = await this.executor.executeAction(action);
        storage.completeAction(actionId, result);

        if (result.success) {
          return '✅ ' + (result.summary || 'Action executee avec succes');
        } else {
          return '❌ Erreur: ' + (result.error || 'Echec de l\'action');
        }
      } catch (e) {
        return '❌ Erreur execution: ' + e.message;
      }
    }

    if (data.startsWith('ap_reject_')) {
      const actionId = data.replace('ap_reject_', '');
      const rejected = storage.rejectAction(actionId);
      if (rejected) {
        return '🚫 Action rejetee.';
      }
      return 'Action introuvable ou deja traitee.';
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
      console.error('[brain] Erreur envoi briefing:', e.message);
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
      console.error('[brain] Erreur envoi bilan hebdo:', e.message);
    }
  }

  // --- Analyse hebdomadaire des learnings ---
  async _analyzeWeeklyLearnings(weekProgress) {
    try {
      const state = this._collectState();
      const learnings = storage.getLearnings();
      const history = storage.getRecentActions(50);

      const analysisPrompt = `Tu es l'analyste IA de MoltBot. Analyse les performances de la semaine et propose des ajustements.

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
          console.log('[brain] Criteres auto-ajustes:', JSON.stringify(updates).substring(0, 200));
        }
      }

      // Lancer les nouvelles experiences
      if (analysis.newExperiments) {
        for (const exp of analysis.newExperiments) {
          storage.addExperiment(exp);
        }
      }

      console.log('[brain] Analyse hebdo terminee: ' + (analysis.weekSummary || '?'));
    } catch (e) {
      console.error('[brain] Erreur analyse hebdo:', e.message);
    }
  }

  // --- Prompt du brain ---
  _buildBrainPrompt(state) {
    const p = state.progress;
    const g = state.goals.weekly;
    const sc = state.goals.searchCriteria;
    const config = state.config;

    let prompt = 'Tu es le cerveau autonome de MoltBot, un agent de prospection commerciale B2B.';
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

    prompt += '\nNIVEAU D\'AUTONOMIE: ' + config.autonomyLevel + '\n';
    if (config.autonomyLevel === 'full') {
      prompt += '→ Tu es LIBRE de modifier les criteres de recherche, tester differents secteurs/postes/villes, ajuster le scoring et les templates email SANS demander confirmation.\n';
      prompt += '→ SEULE exception: l\'envoi d\'emails a de vrais prospects necessite TOUJOURS confirmation (autoExecute=false).\n';
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

    prompt += '\nACTIONS DISPONIBLES:\n';
    prompt += '1. search_leads — Rechercher des leads via Apollo (params.criteria)\n';
    prompt += '2. enrich_leads — Enrichir des leads (params.emails: [])\n';
    prompt += '3. push_to_crm — Pousser vers HubSpot (params.contacts: [])\n';
    prompt += '4. generate_email — Generer un email sans l\'envoyer (params.contact: {email,name,company,title}, params.context)\n';
    prompt += '5. send_email — Envoyer un email (params: to, subject, body, contactName, company, score) — TOUJOURS autoExecute=false\n';
    prompt += '6. update_search_criteria — Modifier les criteres de recherche (params: {titles?, locations?, industries?, seniorities?, companySize?, keywords?, limit?})\n';
    prompt += '7. update_goals — Modifier les objectifs (params: {leadsToFind?, emailsToSend?, responsesTarget?, rdvTarget?, minLeadScore?})\n';
    prompt += '8. record_learning — Enregistrer un apprentissage (params: {category: "bestSearchCriteria|bestEmailStyles|bestSendTimes", summary: "...", data: {}})\n';

    prompt += '\nREGLES:\n';
    prompt += '1. autoExecute=true pour: search_leads, enrich_leads, push_to_crm, generate_email, update_search_criteria, update_goals, record_learning\n';
    prompt += '2. autoExecute=false TOUJOURS pour: send_email\n';
    prompt += '3. Sois strategique avec les credits Apollo (100/mois). Prefere des recherches ciblees.\n';
    prompt += '4. Pour generate_email, RESPECTE les regles email du client (longueur, mots interdits, style d\'accroche).\n';
    prompt += '5. Pour send_email, inclus TOUT le contenu (subject + body complet) pour que le client puisse valider.\n';
    prompt += '6. ITERE: Si un secteur ou profil donne de meilleurs resultats, ajuste les criteres pour en faire plus.\n';
    prompt += '7. TESTE: Lance des experiences A/B (differents objets d\'email, differents secteurs, differentes accroches).\n';
    prompt += '8. APPRENDS: Apres chaque lot d\'emails, note ce qui a marche (open rate, reponses) via record_learning.\n';
    prompt += '9. NE REPETE PAS les memes erreurs. Si une action echoue, essaie une approche differente.\n';
    prompt += '10. Si les objectifs sont inatteignables, ajuste-les via update_goals plutot que de forcer.\n';

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

  // --- Parse JSON response from Claude ---
  _parseJsonResponse(text) {
    if (!text) return null;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log('[brain] Erreur parse JSON:', e.message);
    }
    return null;
  }

  // --- Fallback plan si Claude echoue ---
  _fallbackPlan(state) {
    const actions = [];
    const p = state.progress;
    const g = state.goals.weekly;

    if (p.leadsFoundThisWeek < g.leadsToFind) {
      actions.push({
        type: 'search_leads',
        params: { criteria: state.goals.searchCriteria },
        autoExecute: true,
        preview: 'Recherche de leads (fallback)'
      });
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
