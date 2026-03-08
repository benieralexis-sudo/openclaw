// Autonomous Pilot - Brain Engine (cerveau autonome)
const { Cron } = require('croner');
const storage = require('./storage.js');
const ActionExecutor = require('./action-executor.js');
const diagnostic = require('./diagnostic.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const { withCronGuard, getWarmupDailyLimit } = require('../../gateway/utils.js');
const log = require('../../gateway/logger.js');
const { escTg, parseJsonResponse } = require('./utils.js');

// --- Cross-skill imports via skill-loader centralise ---
const { getStorage, getModule } = require('../../gateway/skill-loader.js');

function getFlowFastStorage() { return getStorage('flowfast'); }
function getAutomailerStorage() { return getStorage('automailer'); }
function getLeadEnrichStorage() { return getStorage('lead-enrich'); }
function getProactiveStorage() { return getStorage('proactive-agent'); }
function getSelfImproveStorage() { return getStorage('self-improve'); }
function getWebIntelStorage() { return getStorage('web-intelligence'); }

// Lock pour eviter l'execution simultanee de la meme action
const _actionsInFlight = new Set();

function getAppConfig() {
  try { return require('../../gateway/app-config.js'); }
  catch (e) { return null; }
}

function getHubSpotClient() {
  const apiKey = process.env.HUBSPOT_API_KEY;
  if (!apiKey) return null;
  const HubSpotClient = getModule('hubspot-client');
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

    // Brain cycle : 9h, 14h et 18h, lun-ven uniquement (pas de prospection le weekend)
    this.crons.push(new Cron('0 9,14,18 * * 1-5', { timezone: tz }, withCronGuard('ap-brain-cycle', async () => {
      try { await this._brainCycle(); }
      catch (e) { log.error('brain', 'Erreur cycle:', e.message); }
    })));

    // Daily briefing supprime — fusionne avec Proactive Morning Report a 8h (voir proactive-engine.js)

    // Mini-cycle leger : 10h, 12h, 15h, 17h, lun-ven uniquement
    this.crons.push(new Cron('0 10,12,15,17 * * 1-5', { timezone: tz }, withCronGuard('ap-mini-cycle', async () => {
      try { await this._lightCycle(); }
      catch (e) { log.error('brain', 'Erreur mini-cycle:', e.message); }
    })));

    // Weekly reset + learning : lundi 0h
    this.crons.push(new Cron('0 0 * * 1', { timezone: tz }, withCronGuard('ap-weekly-reset', async () => {
      try { await this._weeklyReset(); }
      catch (e) { log.error('brain', 'Erreur reset hebdo:', e.message); }
    })));

    // B5 FIX : backfill industry sur les leads FlowFast existants
    this._backfillLeadIndustry();

    log.info('brain', 'Cerveau autonome demarre (7 crons — 3 brain + 4 mini)');
  }

  stop() {
    this.running = false;
    for (const cron of this.crons) {
      try { cron.stop(); } catch (e) {}
    }
    this.crons = [];
    log.info('brain', 'Cerveau autonome arrete');
  }

  // B5 FIX : backfill industry sur les leads FlowFast existants via matchLeadToNiche
  _backfillLeadIndustry() {
    try {
      const ffStorage = getFlowFastStorage();
      if (!ffStorage || !ffStorage.data || !ffStorage.data.leads) return;

      const icpLoader = require('../../gateway/icp-loader.js');
      if (!icpLoader || !icpLoader.matchLeadToNiche) return;

      let backfilled = 0;
      const leads = ffStorage.data.leads;
      for (const key in leads) {
        const lead = leads[key];
        if (lead.industry && lead.industry !== 'unknown') continue;

        const nicheMatch = icpLoader.matchLeadToNiche(lead);
        if (nicheMatch) {
          lead.industry = nicheMatch.name || nicheMatch.slug || '';
          lead._nicheSlug = nicheMatch.slug || '';
          backfilled++;
        }
      }

      if (backfilled > 0) {
        ffStorage._save();
        log.info('brain', 'B5 backfill: ' + backfilled + ' leads enrichis avec industry via ICP matcher');
      }
    } catch (e) {
      log.warn('brain', 'B5 backfill erreur: ' + e.message);
    }
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
        // Warmup : compteurs par domaine pour informer le brain
        let sentToday = 0, dailyLimit = 0;
        try {
          const domainManager = require('../automailer/domain-manager.js');
          const dmStats = domainManager.getStats ? domainManager.getStats() : [];
          const activeStats = dmStats.filter(s => s.active);
          sentToday = activeStats.reduce((sum, s) => sum + (s.todaySends || 0), 0);
          dailyLimit = activeStats.reduce((sum, s) => sum + (s.warmupLimit || 5), 0);
        } catch (e) {
          sentToday = am.getTodaySendCount ? am.getTodaySendCount() : 0;
          dailyLimit = 5;
        }
        state.skills.automailer = {
          totalEmails: stats.totalEmailsSent || 0,
          totalOpened: stats.totalEmailsOpened || 0,
          openRate: (stats.totalEmailsSent || 0) > 0
            ? Math.round(((stats.totalEmailsOpened || 0) / stats.totalEmailsSent) * 100) : 0,
          activeCampaigns: stats.activeCampaigns || 0,
          sentToday: sentToday,
          dailyLimit: dailyLimit,
          remainingToday: Math.max(0, dailyLimit - sentToday)
        };

        // FIX: Syncer TOUS les compteurs depuis automailer (source de verite)
        if (state.progress.weekStart) {
          // Emails envoyes
          if (am.getSendCountSince) {
            const realSent = am.getSendCountSince(state.progress.weekStart);
            if (realSent > state.progress.emailsSentThisWeek) {
              log.info('brain', 'emailsSentThisWeek corrige: ' + state.progress.emailsSentThisWeek + ' -> ' + realSent);
              state.progress.emailsSentThisWeek = realSent;
            }
          }
          // Emails ouverts
          if (am.getOpenedCountSince) {
            const realOpened = am.getOpenedCountSince(state.progress.weekStart);
            if (realOpened > (state.progress.emailsOpenedThisWeek || 0)) {
              log.info('brain', 'emailsOpenedThisWeek corrige: ' + (state.progress.emailsOpenedThisWeek || 0) + ' -> ' + realOpened);
              state.progress.emailsOpenedThisWeek = realOpened;
            }
          }
          // Reponses
          if (am.getRepliedCountSince) {
            const realReplied = am.getRepliedCountSince(state.progress.weekStart);
            if (realReplied > (state.progress.responsesThisWeek || 0)) {
              log.info('brain', 'responsesThisWeek corrige: ' + (state.progress.responsesThisWeek || 0) + ' -> ' + realReplied);
              state.progress.responsesThisWeek = realReplied;
            }
          }
        }
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
        const pendingFUs = pa.getPendingFollowUps ? pa.getPendingFollowUps() : [];
        state.skills.proactive = {
          hotLeads: Object.entries(hotLeads).filter(([, d]) => (d.opens || 0) >= 3).map(([email, d]) => ({
            email, opens: d.opens
          })),
          pendingFollowUps: pendingFUs.length,
          pendingFollowUpEmails: pendingFUs.filter(f => f && f.prospectEmail).map(f => f.prospectEmail)
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

    // Niche Health
    state.nicheHealth = storage.getNicheHealth();

    return state;
  }

  // --- Brain Cycle : le coeur du systeme ---
  async _brainCycle() {
    const config = storage.getConfig();
    const chatId = config.adminChatId;

    log.info('brain', 'Cycle brain demarre...');
    storage.incrementStat('totalBrainCycles');
    storage.updateStat('lastBrainCycleAt', new Date().toISOString());

    // 0. Nettoyage queue (TTL 48h) + experiments > 7 jours
    storage.cleanupQueue();
    try {
      const oldExps = storage.getActiveExperiments();
      let closedCount = 0;
      for (const exp of oldExps) {
        const age = (Date.now() - new Date(exp.startedAt).getTime()) / (24 * 60 * 60 * 1000);
        if (age >= 7) {
          storage.completeExperiment(exp.id, { summary: 'Auto-cloture apres ' + Math.round(age) + ' jours', duration: Math.round(age) + ' jours' });
          closedCount++;
        }
      }
      if (closedCount > 0) log.info('brain', 'Nettoyage: ' + closedCount + ' experience(s) > 7j cloturee(s)');
    } catch (e) {}

    // 1. Collecter l'etat
    const state = this._collectState();

    // 2. Run diagnostic
    const diagItems = diagnostic.runFullDiagnostic();

    // 3. Construire le prompt pour Claude
    const systemPrompt = this._buildBrainPrompt(state);
    const userMessage = 'Analyse la situation et propose des actions. Reponds en JSON strict.';

    let plan;
    try {
      // Sonnet pour les cycles reguliers (5x moins cher qu'Opus) — Opus reserve a l'analyse hebdo
      // 65536 tokens pour eviter troncature (etait 32768, tronque a ~14k chars)
      const response = await this.callClaude(systemPrompt, userMessage, 65536);
      // Detection troncature : si la reponse ne se termine pas par } ou ], c'est probablement tronque
      const trimmed = (response || '').trim();
      const lastChar = trimmed.charAt(trimmed.length - 1);
      const isTruncated = trimmed.length > 100 && lastChar !== '}' && lastChar !== ']';
      if (isTruncated) {
        log.warn('brain', 'ALERTE: Reponse probablement tronquee (' + trimmed.length + ' chars, finit par "' + trimmed.slice(-20) + '")');
      }
      plan = this._parseJsonResponse(response);
      // Retry avec encore plus de tokens si tronque et parse echoue
      if (!plan && isTruncated) {
        log.info('brain', 'Retry brain cycle avec max_tokens=131072...');
        const response2 = await this.callClaude(systemPrompt, userMessage, 131072);
        plan = this._parseJsonResponse(response2);
      }
      if (!plan) log.warn('brain', 'Parse JSON echoue, reponse brute (200 premiers chars):', (response || '(vide)').substring(0, 200));
    } catch (e) {
      log.error('brain', 'Erreur Claude Sonnet (brain plan):', e.message);
      plan = this._fallbackPlan(state);
    }

    if (!plan || !plan.actions) {
      log.warn('brain', 'Pas de plan valide, utilisation du fallback');
      plan = this._fallbackPlan(state);
      if (!plan || !plan.actions || plan.actions.length === 0) {
        log.warn('brain', 'Fallback aussi vide, skip');
        return;
      }
      log.info('brain', 'Fallback plan: ' + plan.actions.length + ' actions');
    }

    // Limiter a 25 actions par cycle (securite anti-emballement)
    const MAX_BRAIN_ACTIONS = 25;
    if (plan.actions.length > MAX_BRAIN_ACTIONS) {
      log.warn('brain', 'Actions tronquees: ' + plan.actions.length + ' -> ' + MAX_BRAIN_ACTIONS + ' (limite de securite)');
      plan.actions = plan.actions.slice(0, MAX_BRAIN_ACTIONS);
    }

    log.info('brain', 'Plan: ' + plan.actions.length + ' actions, assessment: ' + (plan.weeklyAssessment || '?'));

    // 3b. VALIDATION POST-PLAN : nettoyer les send_email invalides (anti-placeholder + anti-dedup)
    const eligibleEmails = new Set();
    try {
      const ffVal = getFlowFastStorage();
      const amVal = getAutomailerStorage();
      if (ffVal) {
        const allLeadsVal = ffVal.getAllLeads ? ffVal.getAllLeads() : {};
        const alreadySentVal = new Set();
        if (amVal && amVal.data && amVal.data.emails) {
          for (const em of amVal.data.emails) {
            if (em.to && (em.status === 'sent' || em.status === 'delivered' || em.status === 'opened' || em.status === 'replied')) {
              alreadySentVal.add(em.to.toLowerCase());
            }
          }
        }
        // Exclure les leads recemment echoues (cooldown 3 jours)
        const recentlyFailedVal = storage.getRecentlyFailedEmails(3);
        for (const email of recentlyFailedVal) {
          alreadySentVal.add(email);
        }
        const gVal = storage.getGoals().weekly;
        const configMinScore = gVal.minLeadScore || 5;
        // Soft constraint: si assez de leads score >= 7, relever le seuil pour eviter les leads faibles (5-6)
        const allLeadsList = Object.values(allLeadsVal).filter(l => l.email && !alreadySentVal.has(l.email.toLowerCase()));
        const highScoreCount = allLeadsList.filter(l => (l.score || 0) >= 7).length;
        const effectiveMinScore = highScoreCount >= 10 ? Math.max(configMinScore, 7) : configMinScore;
        if (effectiveMinScore > configMinScore) {
          log.info('brain', 'Soft constraint: ' + highScoreCount + ' leads score>=7 dispo → seuil releve de ' + configMinScore + ' a ' + effectiveMinScore);
        }
        allLeadsList
          .filter(l => (l.score || 0) >= effectiveMinScore)
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .forEach(l => eligibleEmails.add(l.email.toLowerCase()));
      }
    } catch (e) {}

    if (eligibleEmails.size > 0) {
      const eligibleArray = [...eligibleEmails];
      let eligibleIdx = 0;
      const usedInPlan = new Set();
      let replaced = 0;
      let dropped = 0;

      plan.actions = plan.actions.map(action => {
        if (action.type !== 'send_email') return action;
        const to = (action.params && action.params.to || '').toLowerCase().trim();

        // Cas 1 : email valide et eligible
        if (to && eligibleEmails.has(to) && !usedInPlan.has(to)) {
          usedInPlan.add(to);
          return action;
        }

        // Cas 2 : email invalide/placeholder/deja contacte → remplacer par le prochain eligible
        while (eligibleIdx < eligibleArray.length && usedInPlan.has(eligibleArray[eligibleIdx])) {
          eligibleIdx++;
        }
        if (eligibleIdx < eligibleArray.length) {
          const replacement = eligibleArray[eligibleIdx];
          log.info('brain', 'Validation post-plan: remplacement ' + (to || '(vide)') + ' → ' + replacement);
          usedInPlan.add(replacement);
          eligibleIdx++;
          action.params.to = replacement;
          replaced++;
          return action;
        }

        // Cas 3 : plus de leads eligibles → supprimer l'action
        log.info('brain', 'Validation post-plan: suppression send_email (plus de leads eligibles)');
        dropped++;
        return null;
      }).filter(Boolean);

      if (replaced > 0 || dropped > 0) {
        log.info('brain', 'Validation post-plan: ' + replaced + ' remplaces, ' + dropped + ' supprimes, ' + plan.actions.filter(a => a.type === 'send_email').length + ' send_email valides');
      }
    } else {
      // FIX PLACEHOLDERS: 0 leads eligibles → supprimer TOUS les send_email (le brain ne peut qu'inventer)
      const sendEmailCount = plan.actions.filter(a => a.type === 'send_email').length;
      if (sendEmailCount > 0) {
        plan.actions = plan.actions.filter(a => a.type !== 'send_email');
        log.warn('brain', 'Validation post-plan: 0 leads eligibles → ' + sendEmailCount + ' send_email supprimes (anti-placeholder)');
      }
    }

    // Guard pre-execution : rejeter tout send_email avec email invalide/placeholder
    plan.actions = plan.actions.filter(action => {
      if (action.type !== 'send_email') return true;
      const to = (action.params && action.params.to || '').trim();
      if (!to || !to.includes('@') || to.includes('{{') || to.includes('}}') || /^[a-z_-]+(lead|ceo|cto|founder|manager)[\d_]*$/i.test(to)) {
        log.warn('brain', 'Placeholder/email invalide rejete pre-execution: "' + to + '"');
        storage.recordAction({ type: 'send_email', params: action.params, result: { success: false, error: 'Email invalide/placeholder rejete: ' + to } });
        return false;
      }
      return true;
    });

    // 4. Executer les actions (avec retry sur actions critiques)
    const RETRYABLE_ACTIONS = ['send_email', 'push_to_crm'];
    const MAX_RETRIES = 2;
    const _actionResults = []; // Track results pour le resume business
    let _consecutiveEmailSkips = 0; // Circuit breaker: stop apres N skips consecutifs

    for (const action of plan.actions) {
      if (action._skippedByBreaker) continue; // Skip par circuit breaker
      action._executed = true;
      if (action.autoExecute) {
        // Lock par action key pour eviter doublons si deux brain cycles s'executent
        const actionKey = action.type + '_' + (action.email || action.target || action.id || '');
        if (_actionsInFlight.has(actionKey)) {
          log.info('brain', 'Skip action ' + actionKey + ' (deja en cours)');
          continue;
        }
        _actionsInFlight.add(actionKey);
        let result = null;
        let attempts = 0;
        const maxAttempts = RETRYABLE_ACTIONS.includes(action.type) ? MAX_RETRIES + 1 : 1;

        while (attempts < maxAttempts) {
          attempts++;
          try {
            result = await this.executor.executeAction(action);
            if (result.success || result.deduplicated) break; // Succes ou dedup = pas de retry
            // Erreurs permanentes : pas de retry (blacklist, MX fail, etc.)
            const err = (result.error || '').toLowerCase();
            if (err.includes('blacklist') || err.includes('mx') || err.includes('invalid email') || err.includes('deja contacte') || err.includes('donnees insuffisantes')) {
              log.info('brain', 'Action ' + action.type + ' echouee (non-retryable): ' + result.error);
              break;
            }
            // Echec temporaire : retry si retryable
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

        _actionsInFlight.delete(actionKey);

        // Enregistrer le resultat (succes ou echec final)
        storage.recordAction({
          type: action.type,
          params: action.params,
          preview: action.preview || (result && result.summary) || '',
          result: result || { success: false, error: 'no result' },
          attempts: attempts
        });

        _actionResults.push({ type: action.type, success: !!(result && result.success), result: result });
        if (result && result.success && result.summary) {
          log.info('brain', 'Action auto: ' + result.summary);
          if (action.type === 'send_email') _consecutiveEmailSkips = 0; // Reset sur succes
        } else if (result && !result.success && attempts > 1) {
          log.error('brain', 'Action ' + action.type + ' echouee apres ' + attempts + ' tentatives: ' + (result.error || '?'));
        }

        // Circuit breaker: si 5+ send_email consecutifs echouent (erreurs reseau/SMTP),
        // arreter les send_email restants — mais PAS sur gateBlocked (quality gate = email regenerable)
        if (action.type === 'send_email' && result && !result.success && !result.gateBlocked) {
          _consecutiveEmailSkips++;
          if (_consecutiveEmailSkips >= 5) {
            const remaining = plan.actions.filter(a => a.type === 'send_email' && a !== action).length;
            if (remaining > 0) {
              log.warn('brain', 'Circuit breaker: ' + _consecutiveEmailSkips + ' send_email consecutifs echoues — skip des ' + remaining + ' restants (pool epuise)');
              // Marquer les send_email restants comme skipped
              plan.actions = plan.actions.map(a => {
                if (a.type === 'send_email' && !a._executed) {
                  a._skippedByBreaker = true;
                }
                return a;
              });
              break;
            }
          }
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

    // 7.5. Sync watches Web Intel — DESACTIVE
    // L'auto-creation de watches polluait avec des watches generiques (Revolut, life-obseques...).
    // Les watches sont maintenant gerees manuellement (4 watches ciblees par niche).
    // try { this._syncWatchesWithCriteria(); }
    // try { await this._syncWatchesWithCRMDeals(); }

    // 8. Envoyer resume (format business — comprehensible par le client)
    const confirmActions = plan.actions.filter(a => !a.autoExecute);
    const emailsSent = _actionResults.filter(r => r.type === 'send_email' && r.success).length;
    const leadsFound = _actionResults.filter(r => r.type === 'search_leads' && r.success).length;
    const followupsCreated = _actionResults.filter(r => r.type === 'create_followup_sequence' && r.success).length;
    const crmActions = _actionResults.filter(r => r.type === 'push_to_crm' && r.success).length;
    const hasResults = emailsSent > 0 || leadsFound > 0 || followupsCreated > 0 || crmActions > 0 || confirmActions.length > 0;

    if (hasResults) {
      let summary = '📬 *Prospection auto*\n\n';
      if (emailsSent > 0) summary += '📧 ' + emailsSent + ' email(s) envoye(s)\n';
      if (leadsFound > 0) summary += '🔍 Nouveaux prospects trouves\n';
      if (followupsCreated > 0) summary += '🔄 ' + followupsCreated + ' relance(s) programmee(s)\n';
      if (crmActions > 0) summary += '📋 ' + crmActions + ' fiche(s) CRM mises a jour\n';
      if (confirmActions.length > 0) {
        summary += '\n⏳ ' + confirmActions.length + ' action(s) en attente de ta validation\n';
      }
      try {
        await this.sendTelegram(chatId, summary, 'Markdown');
      } catch (e) {
        log.error('brain', 'Erreur envoi resume:', e.message);
      }
    } else {
      log.info('brain', 'Cycle silencieux — 0 action reussie');
    }
  }

  // --- Envoi de confirmation Telegram avec boutons ---
  async _sendConfirmation(chatId, queuedAction, action) {
    let text = '';

    if (action.type === 'send_email') {
      text = '📧 *Email pret pour ' + escTg(action.params.contactName || action.params.to || '?') + '*\n\n';
      if (action.params.score) text += 'Score: ' + action.params.score + '/10\n';
      if (action.params.company) text += 'Entreprise: ' + escTg(action.params.company) + '\n';
      if (action.params.subject) text += 'Objet: _' + escTg(action.params.subject) + '_\n';
      if (action.params.body) text += '\n' + escTg(action.params.body.substring(0, 300)) + '\n';
    } else {
      text = '⚡ *Action a confirmer*\n\n';
      text += 'Type: ' + escTg(action.type) + '\n';
      if (action.preview) text += escTg(action.preview) + '\n';
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
        msg += '• ' + escTg(hl.email) + ' \\(' + hl.opens + ' ouvertures\\)\n';
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

    // FIX: Corriger TOUS les compteurs avant reset pour le bilan
    try {
      const amReset = getAutomailerStorage();
      const progressBeforeReset = storage.getProgress();
      if (amReset && progressBeforeReset.weekStart) {
        // Emails envoyes
        if (amReset.getSendCountSince) {
          const realSent = amReset.getSendCountSince(progressBeforeReset.weekStart);
          if (realSent > progressBeforeReset.emailsSentThisWeek) {
            storage.incrementProgress('emailsSentThisWeek', realSent - progressBeforeReset.emailsSentThisWeek);
          }
        }
        // Emails ouverts
        if (amReset.getOpenedCountSince) {
          const realOpened = amReset.getOpenedCountSince(progressBeforeReset.weekStart);
          if (realOpened > (progressBeforeReset.emailsOpenedThisWeek || 0)) {
            storage.incrementProgress('emailsOpenedThisWeek', realOpened - (progressBeforeReset.emailsOpenedThisWeek || 0));
          }
        }
        // Reponses
        if (amReset.getRepliedCountSince) {
          const realReplied = amReset.getRepliedCountSince(progressBeforeReset.weekStart);
          if (realReplied > (progressBeforeReset.responsesThisWeek || 0)) {
            storage.incrementProgress('responsesThisWeek', realReplied - (progressBeforeReset.responsesThisWeek || 0));
          }
        }
      }
    } catch (e) {}

    // Score decay : reduire le score des leads silencieux (pas d'ouverture/reply depuis 7+ jours)
    try {
      const ffDecay = getFlowFastStorage();
      const amDecay = getAutomailerStorage();
      if (ffDecay && amDecay) {
        const allLeadsDecay = ffDecay.getAllLeads ? ffDecay.getAllLeads() : {};
        let decayed = 0;
        const cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
        for (const [key, lead] of Object.entries(allLeadsDecay)) {
          if (!lead.email || (lead.score || 0) <= 3) continue;
          const events = amDecay.getEmailEventsForRecipient(lead.email);
          const hasSent = events.some(e => e.status === 'sent' || e.status === 'delivered');
          const hasEngagement = events.some(e => (e.status === 'opened' || e.status === 'replied') && e.sentAt && new Date(e.sentAt).getTime() > cutoff7d);
          if (hasSent && !hasEngagement) {
            const newScore = Math.max(3, (lead.score || 5) - 0.5);
            if (newScore < lead.score) {
              ffDecay.updateLeadScore(key, newScore, 'weekly_decay_no_engagement');
              decayed++;
            }
          }
        }
        if (decayed > 0) log.info('brain', 'Score decay: ' + decayed + ' leads reduits de 0.5 (pas d\'engagement 7j)');
      }
    } catch (decayErr) {
      log.warn('brain', 'Score decay echoue: ' + decayErr.message);
    }

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

    let msg = '📅 *Bilan de la semaine*\n\n';
    msg += '📧 ' + oldProgress.emailsSentThisWeek + ' email(s) envoye(s)\n';
    msg += '🔍 ' + oldProgress.leadsFoundThisWeek + ' prospect(s) trouve(s)\n';
    msg += '💬 ' + (oldProgress.responsesThisWeek || 0) + ' reponse(s) recue(s)\n';
    msg += '📅 ' + (oldProgress.rdvBookedThisWeek || 0) + ' RDV pris\n';

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
    const SIGNAL_BOOSTS = { funding: 2, expansion: 1.5, acquisition: 2, product_launch: 1, hiring: 1.5, leadership_change: 1 };

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
          let anyNewBoost = false;
          for (const [key, lead] of matchingLeads) {
            const signalId = (signal.detectedAt || '') + '_' + signal.type + '_' + signal.company;
            if (!lead._processedSignals) lead._processedSignals = [];
            if (!lead._processedSignals.includes(signalId)) {
              // Temporal decay : signal recent = boost amplifie
              const baseBoost = SIGNAL_BOOSTS[signal.type] || 0.5;
              const signalAge = signal.detectedAt ? (Date.now() - new Date(signal.detectedAt).getTime()) : Infinity;
              let boost;
              if (signalAge < 48 * 60 * 60 * 1000) boost = baseBoost * 1.5;       // < 48h
              else if (signalAge < 7 * 24 * 60 * 60 * 1000) boost = baseBoost * 1.2; // < 7j
              else boost = baseBoost;
              boost = Math.round(boost * 10) / 10; // arrondir a 1 decimale
              const newScore = Math.min(10, (lead.score || 0) + boost);
              const reason = 'Signal ' + signal.type + ': ' + (signal.title || '').substring(0, 80);
              // updateLeadScore persiste le score ET _processedSignals via _save()
              lead._processedSignals.push(signalId);
              if (lead._processedSignals.length > 50) lead._processedSignals = lead._processedSignals.slice(-50);
              ffStorage.updateLeadScore(key, newScore, reason);
              anyNewBoost = true;
            }
          }

          // Mini-cycle silencieux — les opportunites sont integrees dans le morning report
          if (matchingLeads.length > 0 && anyNewBoost) {
            const [, firstLead] = matchingLeads[0];
            log.info('brain', 'Mini-cycle: opportunite ' + signal.type + ' pour ' + firstLead.entreprise + ' — score booste (silencieux)');
          }
        }
      }
    }

    // 1b. Email engagement → score boost (miroir du pattern Web Signals)
    const EMAIL_BOOSTS = { opened: 1, clicked: 2, replied: 3 };
    const amStorage = getAutomailerStorage();
    const ffStorageEng = getFlowFastStorage();
    if (amStorage && ffStorageEng) {
      try {
        const recentEmails = amStorage.getRecentEmails ? amStorage.getRecentEmails(50) : amStorage.getAllEmails().slice(-50);
        const engagedEmails = recentEmails.filter(e => e.opened || e.clicked || e.replied || e.hasReplied);
        const allLeadsEng = ffStorageEng.data && ffStorageEng.data.leads ? ffStorageEng.data.leads : {};

        for (const email of engagedEmails) {
          const to = (email.to || '').toLowerCase();
          if (!to) continue;

          // Trouver le lead dans FlowFast par email
          const leadEntry = Object.entries(allLeadsEng).find(([k, l]) => (l.email || '').toLowerCase() === to);
          if (!leadEntry) continue;

          const [leadKey, lead] = leadEntry;
          if (!lead._processedEmails) lead._processedEmails = [];

          // Determiner le type d'engagement le plus fort
          let engagementType = 'opened';
          if (email.replied || email.hasReplied) engagementType = 'replied';
          else if (email.clicked) engagementType = 'clicked';

          const emailSignalId = (email.id || email.sentAt || '') + '_' + engagementType;
          if (lead._processedEmails.includes(emailSignalId)) continue;

          const boost = EMAIL_BOOSTS[engagementType] || 1;
          const newScore = Math.min(10, (lead.score || 0) + boost);
          const reason = 'Email ' + engagementType + ': ' + (email.subject || '').substring(0, 60);

          lead._processedEmails.push(emailSignalId);
          if (lead._processedEmails.length > 50) lead._processedEmails = lead._processedEmails.slice(-50);
          ffStorageEng.updateLeadScore(leadKey, newScore, reason);
          log.info('brain', 'Email engagement +' + boost + ' pour ' + to + ' (' + engagementType + ') → score ' + newScore);
        }
      } catch (engErr) {
        log.info('brain', 'Email engagement cycle erreur (non bloquant): ' + engErr.message);
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
        // Selection de niche via ICP (weighted) au lieu de rotation aleatoire sur 22 niches
        let miniIcpLoader = null;
        try { miniIcpLoader = require('../../gateway/icp-loader.js'); } catch (e) {
          try { miniIcpLoader = require('/app/gateway/icp-loader.js'); } catch (e2) {}
        }
        const miniNiche = miniIcpLoader ? miniIcpLoader.getNicheForCycle() : null;
        if (!miniNiche) {
          // Fallback ancien systeme
          const allNichesMini = storage.getNicheList ? storage.getNicheList() : storage.B2B_NICHE_LIST || [];
          const nicheIdx = (new Date().getHours() + new Date().getDate()) % allNichesMini.length;
          const fallbackNiche = allNichesMini[nicheIdx];
          const miniCriteria = { ...state.goals.searchCriteria };
          if (fallbackNiche) miniCriteria.keywords = fallbackNiche.keywords;
          actions.push({
            type: 'search_leads',
            params: { criteria: miniCriteria, niche: fallbackNiche ? fallbackNiche.slug : null },
            autoExecute: true,
            preview: 'Recherche urgente (mini-cycle fallback' + (fallbackNiche ? ' — niche: ' + fallbackNiche.slug : '') + ')'
          });
        } else {
          const miniCriteria = { ...state.goals.searchCriteria, keywords: miniNiche.keywords };
          actions.push({
            type: 'search_leads',
            params: { criteria: miniCriteria, niche: miniNiche.slug, _nicheSlug: miniNiche.slug },
            autoExecute: true,
            preview: 'Recherche ICP (mini-cycle — niche: ' + miniNiche.slug + ', poids: ' + (miniNiche.weight || 10) + '%)'
          });
        }
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
      const result = await getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 }).call(() => hubspot.listDeals(50));
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

    // Objectif email dynamique base sur le warmup (domain-manager = source de verite)
    const amState = state.skills.automailer || {};
    const dailyLimitGoals = amState.dailyLimit || 5;
    const sentTodayGoals = amState.sentToday || 0;
    const remainingTodayGoals = amState.remainingToday || 0;
    const weeklyEmailTarget = Math.max(g.emailsToSend, dailyLimitGoals * 5);

    prompt += 'ETAT ACTUEL:\n';
    prompt += '- Leads trouves cette semaine: ' + p.leadsFoundThisWeek + '/' + g.leadsToFind + '\n';
    prompt += '- Emails envoyes AUJOURD\'HUI: ' + sentTodayGoals + '/' + dailyLimitGoals + ' (reste ' + remainingTodayGoals + ' disponibles)\n';
    prompt += '- Emails envoyes cette semaine: ' + p.emailsSentThisWeek + '/' + weeklyEmailTarget + '\n';
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
      prompt += '\nHOT LEADS (PRIORITE ABSOLUE — ces prospects ont ouvert tes emails PLUSIEURS fois):\n';
      for (const h of state.skills.proactive.hotLeads) {
        prompt += '- ' + h.email + ' (' + h.opens + ' ouvertures)';
        prompt += ' → Un reactive follow-up accelere est programme automatiquement par le systeme.';
        prompt += ' NE PAS creer de send_email pour ces contacts (le Proactive Agent gere).\n';
      }
      prompt += 'Si aucun follow-up ne part dans les 2h, cree un create_followup_sequence accelere (stepDays: [1, 3]) pour ces contacts.\n';
    }

    if (state.skills.proactive?.pendingFollowUps > 0) {
      prompt += '- Reactive follow-ups en attente: ' + state.skills.proactive.pendingFollowUps;
      prompt += ' (' + state.skills.proactive.pendingFollowUpEmails.slice(0, 5).join(', ') + ')';
      prompt += ' → ces contacts sont DEJA pris en charge, ne pas les recontacter.\n';
    }

    // --- LEADS ELIGIBLES POUR ENVOI (vrais emails) ---
    try {
      const ffEligible = getFlowFastStorage();
      const amEligible = getAutomailerStorage();
      if (ffEligible) {
        const allLeadsEligible = ffEligible.getAllLeads ? ffEligible.getAllLeads() : {};
        // Collecter les emails deja envoyes pour filtrer
        const alreadySent = new Set();
        if (amEligible && amEligible.data && amEligible.data.emails) {
          for (const em of amEligible.data.emails) {
            if (em.to && (em.status === 'sent' || em.status === 'delivered' || em.status === 'opened' || em.status === 'replied')) {
              alreadySent.add(em.to.toLowerCase());
            }
          }
        }
        // Exclure aussi les leads ayant echoue recemment (skip, blacklist, gate block)
        // Cooldown 3 jours pour eviter de reproposer en boucle
        const recentlyFailed = storage.getRecentlyFailedEmails(3);
        for (const email of recentlyFailed) {
          alreadySent.add(email);
        }
        const eligible = Object.values(allLeadsEligible)
          .filter(l => l.email && (l.score || 0) >= (g.minLeadScore || 5) && !alreadySent.has(l.email.toLowerCase()))
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 20);
        // Info sur le taux de skip recent pour guider le brain
        const recentSendActions = storage.getRecentActions(30).filter(a => a.type === 'send_email');
        const recentSkips = recentSendActions.filter(a => a.result && !a.result.success && (a.result.skipped || a.result.gateBlocked));
        const skipRate = recentSendActions.length > 0 ? Math.round(recentSkips.length / recentSendActions.length * 100) : 0;

        // Enrichir les leads eligibles avec intent data depuis Lead Enrich
        let intentMap = {};
        try {
          const leIntentStorage = getLeadEnrichStorage();
          if (leIntentStorage) {
            for (const l of eligible) {
              const enriched = leIntentStorage.getEnrichedLead ? leIntentStorage.getEnrichedLead(l.email) : null;
              if (enriched && enriched.intentData && enriched.intentData.score > 0) {
                intentMap[l.email.toLowerCase()] = enriched.intentData;
              }
            }
          }
        } catch (e) {}

        if (eligible.length > 0) {
          prompt += '\nLEADS DISPONIBLES POUR ENVOI (emails REELS — utilise-les dans tes actions send_email):\n';
          // Trier par intent score d'abord (a score egal, intent prime)
          eligible.sort((a, b) => {
            const intentA = intentMap[a.email.toLowerCase()]?.score || 0;
            const intentB = intentMap[b.email.toLowerCase()]?.score || 0;
            const scoreA = (a.score || 0) + intentA * 0.3;
            const scoreB = (b.score || 0) + intentB * 0.3;
            return scoreB - scoreA;
          });
          for (const l of eligible) {
            const intent = intentMap[l.email.toLowerCase()];
            let line = '- ' + l.email + ' | ' + (l.nom || '?') + ' | ' + (l.titre || '?') + ' @ ' + (l.entreprise || '?') + ' | score: ' + (l.score || '?');
            if (intent && intent.score >= 3) {
              line += ' | INTENT: ' + intent.score + '/10 (' + intent.summary + ')';
            }
            prompt += line + '\n';
          }
          prompt += '→ IMPORTANT: Utilise UNIQUEMENT les adresses email ci-dessus dans tes actions send_email. NE JAMAIS inventer de placeholders ou de variables {{...}}.\n';
          prompt += '→ REGLE INTENT: A score egal, TOUJOURS prioriser les leads avec INTENT >= 4. Un lead score 6 + intent 7 vaut MIEUX qu\'un lead score 8 + intent 0. Les signaux d\'intent (recrutement, levee, croissance) indiquent un BESOIN ACTIF.\n';
          if (skipRate > 40) {
            prompt += '⚠️ ATTENTION: ' + skipRate + '% des send_email recents ont ete SKIPPED (donnees insuffisantes). Le pool de leads actuel manque de donnees exploitables. PRIORITE: fais 1-2 search_leads dans de NOUVELLES niches avant d\'envoyer plus d\'emails.\n';
          } else {
            prompt += '→ Si tu as besoin de NOUVEAUX leads, fais d\'abord search_leads, puis utilise les resultats du prochain cycle.\n';
          }
        } else {
          prompt += '\n⚠️ AUCUN lead eligible pour envoi (tous deja contactes, score trop bas, ou recemment echoues). PRIORITE ABSOLUE: fais 2-3 search_leads dans des niches DIFFERENTES pour reconstituer le pool.\n';
        }
        // Data-poor leads prets pour re-recherche (Action 3)
        try {
          const dataPoorReady = storage.getDataPoorLeadsReady();
          if (dataPoorReady.length > 0) {
            prompt += '\nLEADS DATA-POOR PRETS POUR RE-ESSAI (cooldown expire, nouvelles donnees potentielles):\n';
            for (const dp of dataPoorReady.slice(0, 5)) {
              const c = dp.contact || {};
              prompt += '- ' + dp.email + ' | ' + (c.nom || '?') + ' @ ' + (c.entreprise || '?') + ' | echecs: ' + dp.failCount + ' | raison: ' + (dp.reason || '?') + '\n';
            }
            prompt += '→ Ces leads ont echoue par manque de donnees mais le cooldown est expire. Re-tente send_email — la recherche sera relancee avec cache expire.\n';
          }
          const dpStats = storage.getDataPoorStats();
          if (dpStats.total > 0) {
            prompt += '📊 Data-poor queue: ' + dpStats.total + ' leads (' + dpStats.ready + ' prets, ' + dpStats.exhausted + ' abandonnes)\n';
          }
        } catch (e) {}

        // Leads deja contactes sans reponse (pour follow-up)
        const contacted = Object.values(allLeadsEligible)
          .filter(l => l.email && alreadySent.has(l.email.toLowerCase()))
          .slice(0, 10);
        if (contacted.length > 0) {
          prompt += '\nLEADS DEJA CONTACTES (pour follow-up via create_followup_sequence — PAS send_email):\n';
          for (const l of contacted) {
            prompt += '- ' + l.email + ' | ' + (l.nom || '?') + ' @ ' + (l.entreprise || '?') + '\n';
          }
          prompt += '→ Pour relancer ces contacts, utilise create_followup_sequence (PAS send_email qui sera bloque par deduplication).\n';
        }
      }
    } catch (eligibleErr) {
      // Non-bloquant
    }

    prompt += '\nOBJECTIFS HEBDO:\n';
    prompt += '- ' + g.leadsToFind + ' leads qualifies (score >= ' + g.minLeadScore + ')\n';
    prompt += '- ' + weeklyEmailTarget + ' emails envoyes (limite warmup: ' + dailyLimitGoals + '/jour)\n';
    prompt += '- ' + g.responsesTarget + ' reponses positives\n';
    prompt += '- ' + g.rdvTarget + ' RDV decroches\n';
    prompt += '- Open rate >= ' + g.minOpenRate + '%\n';
    prompt += '- Push CRM si score >= ' + g.pushToCrmAboveScore + '\n';

    // --- ICP : NICHES CIBLES (remplace la rotation aleatoire sur 22 niches) ---
    let icpLoader = null;
    try { icpLoader = require('../../gateway/icp-loader.js'); } catch (e) {
      try { icpLoader = require('/app/gateway/icp-loader.js'); } catch (e2) {}
    }
    const icpNiches = icpLoader ? icpLoader.getAllNiches() : [];

    if (icpNiches.length > 0) {
      prompt += '\n=== NICHES ICP (SEULES niches autorisees pour search_leads) ===\n';
      prompt += 'REGLE ABSOLUE : tu ne cherches QUE dans ces ' + icpNiches.length + ' niches. PAS d\'autres secteurs.\n';
      for (const n of icpNiches) {
        prompt += '- "' + n.slug + '" (poids: ' + (n.weight || 10) + '%) → keywords: "' + n.keywords + '"\n';
        if (n.painPoint) prompt += '  Pain point: ' + n.painPoint.substring(0, 100) + '\n';
      }
      prompt += '→ Pour chaque search_leads, ajoute params.niche ET params.criteria.keywords correspondant.\n';
      prompt += '→ Repartis les recherches selon les poids (ex: 30% agences, 25% ESN, 20% SaaS...)\n';
    }

    // --- PERFORMANCE PAR NICHE (Auto-Pivot) ---
    const nichePerf = storage.getNichePerformance();
    const nicheKeys = Object.keys(nichePerf);
    if (nicheKeys.length > 0) {
      const activeNiches = nicheKeys.filter(nk => (nichePerf[nk].sent || 0) > 0);
      const inactiveCount = nicheKeys.length - activeNiches.length;
      prompt += '\nPERFORMANCE PAR NICHE:\n';
      for (const nk of activeNiches) {
        const np = nichePerf[nk];
        const openRate = np.sent > 0 ? Math.round((np.opened / np.sent) * 100) : 0;
        const replyRate = np.sent > 0 ? Math.round((np.replied / np.sent) * 100) : 0;
        prompt += '- ' + nk + ': ' + np.leads + ' leads, ' + np.sent + ' envoyes, ' + np.opened + ' ouverts (' + openRate + '%), ' + np.replied + ' reponses (' + replyRate + '%)\n';
      }
      if (inactiveCount > 0) prompt += '(' + inactiveCount + ' niches avec 0 envoi omises)\n';
      prompt += '→ REGLE AUTO-PIVOT: Apres 15+ emails par niche, concentre 70% des envois sur la meilleure niche (reply rate).\n';
      prompt += '→ Si une niche a 0% reply rate apres 20+ emails, REDUIS son poids et concentre sur les autres.\n';
    }

    // Fallback : si pas d'ICP, utiliser l'ancienne liste (backward compat)
    if (icpNiches.length === 0) {
      const allNichesInit = storage.getNicheList ? storage.getNicheList() : [];
      if (allNichesInit.length > 0) {
        prompt += '\nNICHES B2B DISPONIBLES (pas d\'ICP configure — teste 2-3 niches):\n';
        for (const n of allNichesInit.slice(0, 8)) {
          prompt += '- "' + n.slug + '" → keywords: "' + n.keywords + '"\n';
        }
        prompt += '→ RECOMMANDATION: configure un fichier icp.json pour cibler les bonnes niches.\n';
      }
    }

    prompt += '\nCRITERES DE RECHERCHE (VERROUILLES — NE PAS MODIFIER):\n';
    prompt += JSON.stringify(sc, null, 2) + '\n';
    prompt += '→ IMPORTANT: Ces criteres (titles, locations, companySize) sont VERROUILLES par la config.\n';
    prompt += '→ Pour search_leads, tu peux UNIQUEMENT changer "keywords" selon les niches ICP ci-dessus.\n';
    prompt += '→ REGLE CRITIQUE KEYWORDS: Maximum 2 mots par keyword. Apollo fait un AND implicite, donc 3+ mots = 0 resultats.\n';
    prompt += '→ CORRECT: keywords="agence marketing" ou keywords="ESN" ou keywords="SaaS B2B" (1-2 mots)\n';
    prompt += '→ INCORRECT: keywords="SaaS B2B editeur logiciel" (4 mots = 0 resultats!)\n';
    prompt += '→ Pour varier, utilise OR: keywords="agence marketing OR agence digitale" (recherches separees)\n';
    prompt += '→ Les autres champs (titles, locations, companySize) seront FORCES par le systeme.\n';

    prompt += '\nNIVEAU D\'AUTONOMIE: ' + config.autonomyLevel + ' (MODE MACHINE DE GUERRE)\n';
    if (config.autonomyLevel === 'full') {
      prompt += '→ Tu es en FULL AUTO. Tu peux rechercher, envoyer des emails, creer des sequences de relance SANS demander confirmation.\n';
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

    // Experiences en cours (limiter a 5 les plus recentes pour eviter prompt bloat)
    if (state.experiments.length > 0) {
      const recentExps = state.experiments.slice(-5);
      prompt += '\nEXPERIENCES EN COURS (' + state.experiments.length + ' total, 5 plus recentes):\n';
      for (const exp of recentExps) {
        prompt += '- ' + (exp.description || exp.type).substring(0, 120) + ' (depuis ' + (exp.startedAt || '?') + ')\n';
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
        if (sia.emailPrefs) {
          const ep = sia.emailPrefs;
          if (ep.maxLength) prompt += '  SELF-IMPROVE - LONGUEUR EMAIL OPTIMALE: ' + ep.maxLength + '\n';
          if (ep.preferredSendHour) prompt += '  SELF-IMPROVE - HEURE OPTIMALE: ' + ep.preferredSendHour + 'h\n';
        }
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

    // --- PROFILS GAGNANTS (leads qui ont ouvert/repondu — feedback loop) ---
    try {
      const amPrompt = getAutomailerStorage();
      const ffPrompt = getFlowFastStorage();
      if (amPrompt && ffPrompt) {
        const hotEmails = amPrompt.getAllEmails().filter(e => e.opened || e.replied || e.hasReplied);
        if (hotEmails.length >= 2) {
          const allLeadsPrompt = ffPrompt.data && ffPrompt.data.leads ? ffPrompt.data.leads : {};
          const profiles = [];
          for (const em of hotEmails.slice(-15)) {
            const to = (em.to || '').toLowerCase();
            const leadMatch = Object.values(allLeadsPrompt).find(l => (l.email || '').toLowerCase() === to);
            if (leadMatch) {
              profiles.push(
                (leadMatch.titre || '?') + ' @ ' + (leadMatch.entreprise || '?') +
                ' (' + (leadMatch.taille || '?') + ' emp, ' + (leadMatch.ville || '?') + ')' +
                (em.replied || em.hasReplied ? ' [REPONDU]' : ' [OUVERT]')
              );
            }
          }
          if (profiles.length >= 2) {
            prompt += '\nPROFILS GAGNANTS (leads ayant ouvert ou repondu — CIBLE CES PROFILS EN PRIORITE):\n';
            for (const p of profiles) {
              prompt += '  - ' + p + '\n';
            }
            prompt += '  → CHERCHE DES PROFILS SIMILAIRES (meme titre, meme taille, meme secteur) dans tes prochaines recherches.\n';
          }
        }
      }
    } catch (wpErr) {
      // Non-bloquant
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
          prompt += '- [' + (n.id || '?') + '] ' + n.company + ': "' + n.headline + '" (relevance: ' + (n.relevance || '?') + ')\n';
        }
        prompt += '→ Privilegie ces entreprises pour les prochains emails (actualite = meilleure accroche).\n';
        prompt += '→ Passe _wiNewsId dans params.send_email si tu utilises une news.\n';
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
    prompt += '2. push_to_crm — Pousser vers HubSpot (params.contacts: [])\n';
    prompt += '3. generate_email — Generer un email sans l\'envoyer (params.contact: {email,name,company,title}, params.context)\n';
    prompt += '4. send_email — Envoyer un email (params: to, contactName, company, score, contact: {email,nom,entreprise,titre}, _generateFirst: true) — autoExecute=true\n';
    prompt += '5. update_search_criteria — Modifier les criteres de recherche (params: {titles?, locations?, industries?, seniorities?, companySize?, keywords?, limit?})\n';
    prompt += '6. update_goals — Modifier les objectifs (params: {leadsToFind?, emailsToSend?, responsesTarget?, rdvTarget?, minLeadScore?})\n';
    prompt += '7. record_learning — Enregistrer un apprentissage (params: {category: "bestSearchCriteria|bestEmailStyles|bestSendTimes", summary: "...", data: {}})\n';
    prompt += '8. create_followup_sequence — Creer une sequence de 3 relances automatiques pour des leads deja contactes sans reponse (params: {contacts: [{email, nom, entreprise, titre}], totalSteps: 3, intervalDays: 4})\n';

    prompt += '\nMULTI-THREADING (contacts multiples par entreprise):\n';
    prompt += '- Tu peux contacter 2-3 decision-makers PAR entreprise avec des angles DIFFERENTS.\n';
    prompt += '- Primaire : pitch principal (envoye immediatement). Secondaires : angle technique, ROI ou temoignage (envoyes en decale J+2, J+3).\n';
    prompt += '- Le systeme gere automatiquement le groupement et le stagger temporel.\n';
    prompt += '- Si tu envoies un send_email avec un contact d\'une entreprise deja dans le pipeline, le systeme cree automatiquement le multi-thread.\n';
    prompt += '- Tu peux ajouter contactRole ("primary"/"secondary") et emailAngle ("main_pitch"/"technical"/"roi"/"testimonial") dans params de send_email.\n';
    prompt += '- IMPORTANT : si un des contacts repond, le systeme ARRETE automatiquement tous les autres contacts de la meme entreprise.\n';
    prompt += '- Quand tu cherches des leads (search_leads), le systeme groupe automatiquement les resultats par entreprise si plusieurs contacts qualifies.\n';

    prompt += '\nREGLES (MODE MACHINE DE GUERRE):\n';
    prompt += '1. autoExecute=true pour TOUTES les actions, y compris send_email. Tu es en FULL AUTO.\n';
    prompt += '2. Pour send_email, mets TOUJOURS _generateFirst:true — la recherche prospect est OBLIGATOIRE avant chaque email.\n';
    prompt += '3. NE FOURNIS PAS subject/body dans send_email — le ProspectResearcher + ClaudeEmailWriter les generent automatiquement avec des infos fraiches.\n';
    const emailsPerCycle = Math.min(Math.ceil(remainingTodayGoals / 2), 15);
    prompt += '4. Envoie MAX ' + emailsPerCycle + ' emails CE CYCLE (reste ' + remainingTodayGoals + '/jour, repartis sur 2 brain cycles). Priorise les leads score >= 8.\n';
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
    prompt += '15. REGLE CRITIQUE EMAILS: Dans send_email, le champ "to" DOIT etre une VRAIE adresse email (ex: jean@example.com). JAMAIS de placeholder, variable, ou nom generique (ex: {{lead_email}}, cabinet_conseil_lead_1). Si tu n\'as pas l\'email reel, fais d\'abord search_leads.\n';
    prompt += '16. REGLE RELANCES: Pour relancer un lead DEJA contacte (dans "LEADS DEJA CONTACTES"), utilise create_followup_sequence. send_email sera BLOQUE par la deduplication.\n';

    prompt += '\nReponds UNIQUEMENT en JSON COMPACT (sans indentation, sans commentaires, reasoning en 2-3 phrases max) avec cette structure:\n';
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

  // --- Parse JSON response from Claude (delegue a utils.js) ---
  _parseJsonResponse(text) {
    return parseJsonResponse(text);
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
              emailPrefs: siStorage.getEmailPreferences ? siStorage.getEmailPreferences() : null,
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

    // 1. Chercher des leads si objectif non atteint — avec rotation de niches
    if (p.leadsFoundThisWeek < g.leadsToFind) {
      // Choisir une niche differente a chaque fallback (rotation basee sur le cycle courant)
      // Utiliser ICP loader (weighted) si disponible, sinon fallback ancien systeme
      let niche = null;
      try {
        const icpLoaderFb = require('../../gateway/icp-loader.js');
        niche = icpLoaderFb.getNicheForCycle();
      } catch (e) {
        try {
          const icpLoaderFb = require('/app/gateway/icp-loader.js');
          niche = icpLoaderFb.getNicheForCycle();
        } catch (e2) {}
      }
      if (!niche) {
        const allNichesFb = storage.getNicheList ? storage.getNicheList() : storage.B2B_NICHE_LIST || [];
        const dayIdx = new Date().getDate() % (allNichesFb.length || 1);
        niche = allNichesFb[dayIdx];
      }
      const fallbackCriteria = { ...state.goals.searchCriteria };
      if (niche) {
        fallbackCriteria.keywords = niche.keywords;
      }
      actions.push({
        type: 'search_leads',
        params: { criteria: fallbackCriteria, niche: niche ? niche.slug : null },
        autoExecute: true,
        preview: 'Recherche de leads (fallback' + (niche ? ' — niche: ' + niche.slug : '') + ')'
      });
    }

    // 2. Generer + envoyer des emails aux leads qualifies avec email
    if (p.emailsSentThisWeek < g.emailsToSend) {
      const ffStorage = getFlowFastStorage();
      if (ffStorage) {
        const allLeads = ffStorage.getAllLeads ? ffStorage.getAllLeads() : {};
        const leadsWithEmail = Object.values(allLeads)
          .filter(l => l.email && (l.score || 0) >= (g.minLeadScore || 7) && !l._emailSent)
          .slice(0, 15); // Max 15 emails par cycle (warmup gere par action-executor)

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
                entreprise: lead.entreprise,
                linkedin_url: lead.linkedin || lead.linkedinUrl || ''
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
      const paStorage = getProactiveStorage();
      const needsFollowUp = sentEmails.filter(e => {
        if (!e.sentAt) return false;
        const sentTime = new Date(e.sentAt).getTime();
        if (sentTime > threeDaysAgo) return false; // Trop recent
        // Skip si un follow-up reactif a deja ete envoye
        if (paStorage && paStorage.hasReactiveFollowUp && paStorage.hasReactiveFollowUp(e.to)) {
          return false;
        }
        // Verifier qu'il n'y a pas deja une campagne pour ce contact
        const allCampaigns = amStorage.getAllCampaigns();
        const hasSequence = allCampaigns.some(c => {
          if (!c.name || !c.name.startsWith('Relance auto') || c.status === 'completed') return false;
          // Verifier dans la contact list (pas seulement les emails envoyes — sentCount peut etre 0)
          const list = amStorage.getContactList(c.contactListId);
          if (list && list.contacts) {
            return list.contacts.some(contact => contact.email === e.to);
          }
          // Fallback: verifier dans les emails envoyes
          return amStorage.getEmailsByCampaign(c.id).some(ce => ce.to === e.to);
        });
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
