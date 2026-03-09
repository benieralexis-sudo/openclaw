// Intent Monitor — Detection temps reel de signaux d'intent
// Tourne toutes les 30 min via cron, bypass le brain cycle pour action immediate
// Sources : Apollo intent topics, Apollo job changes, Google Alerts RSS, visiteurs web
// Cout : 0$ extra (Apollo deja paye, le reste est gratuit)

'use strict';

const log = require('../../gateway/logger.js');
const storage = require('./storage.js');
const { getStorage, getModule } = require('../../gateway/skill-loader.js');

function getFlowFastStorage() { return getStorage('flowfast'); }
function getAutomailerStorage() { return getStorage('automailer'); }
function getLeadEnrichStorage() { return getStorage('lead-enrich'); }
function getWebIntelStorage() { return getStorage('web-intelligence'); }

// Intent topics Apollo mappes aux niches iFIND
// Ces IDs sont resolus dynamiquement au premier run via listIntentTopics()
const INTENT_TOPIC_QUERIES = [
  'sales automation',
  'lead generation',
  'cold email',
  'outbound sales',
  'B2B prospecting',
  'CRM software',
  'sales engagement',
  'marketing automation',
  'appointment setting',
  'business development'
];

// Seuil minimum pour declencher le pipeline immediat
const INTENT_PIPELINE_THRESHOLD = 5; // score intent >= 5 → action immediate
const MAX_IMMEDIATE_ACTIONS = 3;     // max 3 leads par scan (pas de spam)
const COOLDOWN_HOURS = 24;           // ne pas re-scanner le meme lead avant 24h

class IntentMonitor {
  constructor(options) {
    this.apolloKey = options.apolloKey;
    this.claudeKey = options.claudeKey;
    this.openaiKey = options.openaiKey;
    this.resendKey = options.resendKey;
    this.senderEmail = options.senderEmail;
    this.sendTelegram = options.sendTelegram;
    this.campaignEngine = options.campaignEngine || null;

    this._resolvedTopicIds = null; // cache des topic IDs Apollo
    this._lastScan = {};           // cooldown par email
    this._scanHistory = [];        // historique des scans
  }

  // --- Point d'entree principal : scan toutes les 30 min ---
  async scan() {
    log.info('intent-monitor', 'Scan demarre...');
    const startTime = Date.now();
    const config = storage.getConfig();
    const chatId = config.adminChatId;

    // Verifier heures business (8h-19h Paris, lun-ven)
    const now = new Date();
    const parisHour = parseInt(now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }));
    const parisDay = parseInt(now.toLocaleString('en-US', { timeZone: 'Europe/Paris', weekday: 'numeric' }));
    if (parisHour < 8 || parisHour >= 19 || parisDay === 0 || parisDay === 6) {
      log.info('intent-monitor', 'Hors heures business — skip');
      return { skipped: true, reason: 'hors heures business' };
    }

    // Verifier warmup headroom
    const amStorage = getAutomailerStorage();
    let sentToday = 0;
    let dailyLimit = 5;
    try {
      if (amStorage && amStorage.getSendCountToday) {
        sentToday = amStorage.getSendCountToday();
      }
      const { getWarmupDailyLimit } = require('../../gateway/utils.js');
      dailyLimit = getWarmupDailyLimit();
    } catch (e) {}

    const headroom = dailyLimit - sentToday;
    if (headroom <= 0) {
      log.info('intent-monitor', 'Limite warmup atteinte (' + sentToday + '/' + dailyLimit + ') — skip');
      return { skipped: true, reason: 'warmup limit' };
    }

    // Collecter les emails deja contactes (dedup)
    const alreadyContacted = new Set();
    try {
      if (amStorage && amStorage.data && amStorage.data.emails) {
        for (const em of amStorage.data.emails) {
          if (em.to) alreadyContacted.add(em.to.toLowerCase());
        }
      }
    } catch (e) {}

    // Lancer les 3 sources de signaux en parallele
    const results = await Promise.allSettled([
      this._scanApolloIntent(config),
      this._scanApolloJobChanges(config),
      this._scanGoogleAlerts()
    ]);

    // Agreger tous les leads detectes
    const detectedLeads = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.length > 0) {
        detectedLeads.push(...r.value);
      }
    }

    // Filtrer : pas deja contacte, pas en cooldown, email valide
    const actionableLeads = detectedLeads.filter(lead => {
      if (!lead.email) return false;
      const emailLower = lead.email.toLowerCase();
      if (alreadyContacted.has(emailLower)) return false;
      if (this._isInCooldown(emailLower)) return false;
      return true;
    });

    // Deduplication par email
    const seen = new Set();
    const uniqueLeads = actionableLeads.filter(l => {
      const e = l.email.toLowerCase();
      if (seen.has(e)) return false;
      seen.add(e);
      return true;
    });

    // Trier par score intent decroissant + fraicheur
    uniqueLeads.sort((a, b) => {
      const scoreA = (a.intentScore || 0) + (a.freshness || 0);
      const scoreB = (b.intentScore || 0) + (b.freshness || 0);
      return scoreB - scoreA;
    });

    // Prendre les top N (limites par headroom warmup)
    const maxActions = Math.min(MAX_IMMEDIATE_ACTIONS, headroom, uniqueLeads.length);
    const toProcess = uniqueLeads.slice(0, maxActions);

    if (toProcess.length === 0) {
      log.info('intent-monitor', 'Scan termine — aucun lead actionable (' + detectedLeads.length + ' detectes, ' + actionableLeads.length + ' filtrables)');
      return { scanned: detectedLeads.length, actionable: 0, processed: 0 };
    }

    // Pipeline immediat : research → email → envoi
    let processed = 0;
    const ActionExecutor = require('./action-executor.js');
    const executor = new ActionExecutor({
      apolloKey: this.apolloKey,
      openaiKey: this.openaiKey,
      claudeKey: this.claudeKey,
      resendKey: this.resendKey,
      senderEmail: this.senderEmail,
      campaignEngine: this.campaignEngine
    });

    for (const lead of toProcess) {
      try {
        log.info('intent-monitor', 'Pipeline immediat pour ' + lead.email + ' (intent: ' + lead.intentScore + ', signal: ' + lead.signalType + ')');

        // Sauvegarder le lead dans FlowFast si pas deja la
        const ffStorage = getFlowFastStorage();
        if (ffStorage && ffStorage.addLead) {
          ffStorage.addLead({
            email: lead.email,
            nom: lead.nom || '',
            titre: lead.titre || '',
            entreprise: lead.entreprise || '',
            score: Math.max(7, lead.intentScore || 7),
            source: 'intent-monitor',
            intentSignal: lead.signalType,
            intentDetail: lead.signalDetail,
            apolloId: lead.apolloId || null,
            linkedin_url: lead.linkedin_url || '',
            organization: lead.organization || null
          });
        }

        // Executer send_email (inclut research + generation + envoi)
        const result = await executor.executeAction({
          type: 'send_email',
          params: {
            to: lead.email,
            nom: lead.nom,
            titre: lead.titre,
            entreprise: lead.entreprise,
            organization: lead.organization,
            _intentTriggered: true,
            _intentSignal: lead.signalType,
            _intentDetail: lead.signalDetail
          },
          autoExecute: true,
          preview: 'Intent pipeline: ' + lead.signalType + ' → ' + lead.email
        });

        // Enregistrer action
        storage.recordAction({
          type: 'intent_pipeline',
          params: { email: lead.email, signal: lead.signalType },
          preview: 'Intent: ' + lead.signalType + ' → ' + (result.success ? 'envoye' : 'echec'),
          result: result
        });

        if (result.success) {
          processed++;
          this._setCooldown(lead.email.toLowerCase());
        }

        // Delai humain entre les envois
        if (toProcess.indexOf(lead) < toProcess.length - 1) {
          await new Promise(r => setTimeout(r, 45000 + Math.random() * 30000));
        }

      } catch (e) {
        log.error('intent-monitor', 'Erreur pipeline pour ' + lead.email + ': ' + e.message);
      }
    }

    // Notification Telegram si des actions ont ete prises
    if (processed > 0 && this.sendTelegram && chatId) {
      const signalTypes = toProcess.filter((_, i) => i < processed).map(l => l.signalType).join(', ');
      try {
        await this.sendTelegram(chatId,
          '⚡ *Intent Monitor* — ' + processed + ' email' + (processed > 1 ? 's' : '') + ' envoye' + (processed > 1 ? 's' : '') +
          ' en pipeline immediat\n' +
          'Signaux: ' + signalTypes + '\n' +
          'Delai signal→envoi: ' + Math.round((Date.now() - startTime) / 1000) + 's',
          'Markdown'
        );
      } catch (e) {}
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    log.info('intent-monitor', 'Scan termine en ' + duration + 's — ' + detectedLeads.length + ' detectes, ' + processed + '/' + toProcess.length + ' envoyes');

    this._scanHistory.push({
      timestamp: new Date().toISOString(),
      detected: detectedLeads.length,
      actionable: actionableLeads.length,
      processed: processed,
      duration: duration
    });
    // Garder 100 derniers scans
    if (this._scanHistory.length > 100) this._scanHistory = this._scanHistory.slice(-100);

    return { scanned: detectedLeads.length, actionable: uniqueLeads.length, processed: processed, duration: duration };
  }

  // --- Source 1 : Apollo Intent Topics ---
  async _scanApolloIntent(config) {
    const leads = [];
    try {
      const ApolloConnector = require('../flowfast/apollo-connector.js');
      const apollo = new ApolloConnector(this.apolloKey);

      // Resoudre les topic IDs si pas encore fait
      if (!this._resolvedTopicIds) {
        await this._resolveIntentTopics(apollo);
      }

      if (!this._resolvedTopicIds || this._resolvedTopicIds.length === 0) {
        log.warn('intent-monitor', 'Aucun intent topic resolu — skip Apollo intent scan');
        return leads;
      }

      // Charger les criteres ICP
      const goals = storage.getGoals();
      const criteria = {
        ...goals.searchCriteria,
        intentTopics: this._resolvedTopicIds,
        intentStrength: 'high',
        limit: 10,
        verifiedEmails: true
      };

      const result = await apollo.searchLeadsWithIntent(criteria);
      if (result.success && result.leads) {
        for (const p of result.leads) {
          if (!p.email) continue;
          leads.push({
            email: p.email,
            nom: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
            titre: p.title || '',
            entreprise: (p.organization && p.organization.name) || '',
            apolloId: p.id,
            linkedin_url: p.linkedin_url || '',
            organization: p.organization || null,
            intentScore: 7, // high intent = score 7 minimum
            signalType: 'apollo_intent_topic',
            signalDetail: 'Recherche active: ' + (this._resolvedTopicNames || []).slice(0, 3).join(', '),
            freshness: 2,  // boost fraicheur (signal temps reel)
            detectedAt: new Date().toISOString()
          });
        }
      }
      log.info('intent-monitor', 'Apollo intent: ' + leads.length + ' leads high-intent');
    } catch (e) {
      log.error('intent-monitor', 'Apollo intent scan echoue: ' + e.message);
    }
    return leads;
  }

  // --- Source 2 : Apollo Job Changes (nouveaux postes = budget frais) ---
  async _scanApolloJobChanges(config) {
    const leads = [];
    try {
      const ApolloConnector = require('../flowfast/apollo-connector.js');
      const apollo = new ApolloConnector(this.apolloKey);

      const goals = storage.getGoals();
      const criteria = {
        ...goals.searchCriteria,
        jobChangeDays: 30, // changement de poste dans les 30 derniers jours
        limit: 10,
        verifiedEmails: true
      };

      const result = await apollo.searchJobChanges(criteria);
      if (result.success && result.leads) {
        for (const p of result.leads) {
          if (!p.email) continue;
          leads.push({
            email: p.email,
            nom: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
            titre: p.title || '',
            entreprise: (p.organization && p.organization.name) || '',
            apolloId: p.id,
            linkedin_url: p.linkedin_url || '',
            organization: p.organization || null,
            intentScore: 6, // job change = bon signal
            signalType: 'job_change',
            signalDetail: 'Nouveau poste: ' + (p.title || '?') + ' @ ' + ((p.organization && p.organization.name) || '?'),
            freshness: 1.5,
            detectedAt: new Date().toISOString()
          });
        }
      }
      log.info('intent-monitor', 'Apollo job changes: ' + leads.length + ' leads');
    } catch (e) {
      log.error('intent-monitor', 'Apollo job changes scan echoue: ' + e.message);
    }
    return leads;
  }

  // --- Source 3 : Google Alerts RSS (trigger events) ---
  async _scanGoogleAlerts() {
    const leads = [];
    try {
      const wiStorage = getWebIntelStorage();
      if (!wiStorage || !wiStorage.getRecentMarketSignals) return leads;

      // Recuperer les signaux marche recents (< 24h)
      const allSignals = wiStorage.getRecentMarketSignals(50);
      const recentSignals = allSignals.filter(s => {
        if (!s.detectedAt) return false;
        const age = Date.now() - new Date(s.detectedAt).getTime();
        return age < 24 * 60 * 60 * 1000; // < 24h
      });

      if (recentSignals.length === 0) return leads;

      // Pour chaque signal, chercher les leads correspondants dans FlowFast
      const ffStorage = getFlowFastStorage();
      if (!ffStorage) return leads;

      const allLeads = ffStorage.getAllLeads ? ffStorage.getAllLeads() : {};

      for (const signal of recentSignals) {
        if (!signal.company) continue;
        const companyLower = signal.company.toLowerCase();

        // Matcher leads existants par nom d'entreprise
        for (const [key, lead] of Object.entries(allLeads)) {
          if (!lead.email || !lead.entreprise) continue;
          if (lead.entreprise.toLowerCase().includes(companyLower) || companyLower.includes(lead.entreprise.toLowerCase())) {
            // Signal type → intent score
            const signalScores = { funding: 8, acquisition: 7, expansion: 6, hiring: 6, product_launch: 5, leadership_change: 5 };
            const intentScore = signalScores[signal.type] || 5;

            leads.push({
              email: lead.email,
              nom: lead.nom || '',
              titre: lead.titre || '',
              entreprise: lead.entreprise,
              apolloId: lead.apolloId || null,
              linkedin_url: lead.linkedin_url || '',
              organization: lead.organization || null,
              intentScore: intentScore,
              signalType: 'market_' + signal.type,
              signalDetail: (signal.article && signal.article.title || signal.title || '').substring(0, 100),
              freshness: 2.5, // signal frais = boost max
              detectedAt: signal.detectedAt
            });
          }
        }
      }
      log.info('intent-monitor', 'Market signals: ' + leads.length + ' leads avec trigger events recents');
    } catch (e) {
      log.error('intent-monitor', 'Google Alerts scan echoue: ' + e.message);
    }
    return leads;
  }

  // --- Resolution des intent topic IDs Apollo (cache) ---
  async _resolveIntentTopics(apollo) {
    try {
      const allTopicIds = [];
      const allTopicNames = [];

      // Chercher chaque query et collecter les IDs
      for (const query of INTENT_TOPIC_QUERIES) {
        const result = await apollo.listIntentTopics(query);
        if (result.success && result.topics.length > 0) {
          // Prendre le premier match (le plus pertinent)
          allTopicIds.push(result.topics[0].id);
          allTopicNames.push(result.topics[0].name);
        }
        // Rate limit
        await new Promise(r => setTimeout(r, 300));
      }

      this._resolvedTopicIds = [...new Set(allTopicIds)]; // dedup
      this._resolvedTopicNames = [...new Set(allTopicNames)];
      log.info('intent-monitor', 'Intent topics resolus: ' + this._resolvedTopicIds.length + ' topics (' + this._resolvedTopicNames.slice(0, 5).join(', ') + ')');
    } catch (e) {
      log.error('intent-monitor', 'Resolution intent topics echouee: ' + e.message);
      this._resolvedTopicIds = [];
      this._resolvedTopicNames = [];
    }
  }

  // --- Cooldown management ---
  _isInCooldown(emailLower) {
    const lastScan = this._lastScan[emailLower];
    if (!lastScan) return false;
    return (Date.now() - lastScan) < COOLDOWN_HOURS * 60 * 60 * 1000;
  }

  _setCooldown(emailLower) {
    this._lastScan[emailLower] = Date.now();
    // Cleanup old entries (> 7 jours)
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [email, ts] of Object.entries(this._lastScan)) {
      if (ts < cutoff) delete this._lastScan[email];
    }
  }

  // --- Stats pour le dashboard ---
  getStats() {
    return {
      lastScans: this._scanHistory.slice(-10),
      resolvedTopics: (this._resolvedTopicNames || []).length,
      cooldownActive: Object.keys(this._lastScan).length,
      topicNames: this._resolvedTopicNames || []
    };
  }
}

module.exports = IntentMonitor;
