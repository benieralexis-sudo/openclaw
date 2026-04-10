// Intent Monitor v2 — Detection temps reel de signaux d'intent pour marche FR
// Tourne toutes les 30 min via cron, bypass le brain cycle pour action immediate
// Sources : Apollo entreprises recentes, Apollo PME en croissance, Apollo funded tech, Web Intel
// Cout : ~3-5 credits Apollo par scan (reveal emails)

'use strict';

const log = require('../../gateway/logger.js');
const storage = require('./storage.js');
const { getStorage, getModule } = require('../../gateway/skill-loader.js');

function getFlowFastStorage() { return getStorage('flowfast'); }
function getAutomailerStorage() { return getStorage('automailer'); }
function getLeadEnrichStorage() { return getStorage('lead-enrich'); }
function getWebIntelStorage() { return getStorage('web-intelligence'); }

// Funding stages (garde pour startups tech FR)
const FUNDING_STAGES = ['seed', 'angel', 'series_a', 'series_b', 'series_c', 'series_d'];

// Keyword tags adaptes au marche FR — alignes sur nos niches reelles
// Chaque groupe est scanne en rotation (1 groupe par scan)
const KEYWORD_TAG_GROUPS = [
  ['agence digitale', 'agence marketing'],
  ['agence communication', 'agence web'],
  ['cabinet conseil', 'consulting'],
  ['cabinet recrutement', 'ressources humaines'],
  ['ESN', 'societe de services informatiques'],
  ['SaaS', 'software'],
  ['startup', 'tech'],
  ['e-commerce', 'marketplace'],
  ['formation', 'edtech'],
  ['immobilier', 'promotion immobiliere'],
  ['comptabilite', 'expertise comptable'],
  ['architecture', 'design']
];

// Config
const MAX_IMMEDIATE_ACTIONS = 3;     // max 3 leads par scan (pas de spam)
const MAX_REVEALS_PER_SCAN = 5;      // max 5 credits Apollo par scan
const COOLDOWN_HOURS = 72;           // 72h cooldown (evite re-scan trop frequent)

class IntentMonitor {
  constructor(options) {
    this.apolloKey = options.apolloKey;
    this.claudeKey = options.claudeKey;
    this.openaiKey = options.openaiKey;
    this.resendKey = options.resendKey;
    this.senderEmail = options.senderEmail;
    this.sendTelegram = options.sendTelegram;
    this.campaignEngine = options.campaignEngine || null;

    this._keywordGroupIndex = 0;   // rotation des keyword tags
    this._lastScan = this._loadCooldowns(); // cooldown par email (persistant)
    this._scanHistory = [];        // historique des scans
    this._knownLeadEmails = null;  // cache des leads deja en base
  }

  // Charger les cooldowns depuis le storage persistant (survit aux restarts Docker)
  _loadCooldowns() {
    try {
      const config = storage.getConfig();
      return config._intentCooldowns || {};
    } catch (e) {
      log.warn('intent-monitor', 'Chargement cooldowns echoue: ' + e.message);
      return {};
    }
  }

  // Persister les cooldowns sur disque (cleanup entries > 7 jours)
  _persistCooldowns() {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const key of Object.keys(this._lastScan)) {
      if (this._lastScan[key] < cutoff) delete this._lastScan[key];
    }
    try {
      storage.updateConfig({ _intentCooldowns: this._lastScan });
    } catch (e) { log.warn('intent-monitor', 'Cooldown persist echoue: ' + e.message); }
  }

  // --- Point d'entree principal : scan toutes les 30 min ---
  async scan() {
    // v9.2: Skip si Apollo resilie (pas de cle API)
    if (!this.apolloKey || this.apolloKey.trim() === '') {
      if (!this._apolloWarnLogged) {
        log.info('intent-monitor', 'Apollo resilie — intent monitor desactive (pas de cle API)');
        this._apolloWarnLogged = true;
      }
      return { skipped: true, reason: 'apollo_resilie' };
    }

    log.info('intent-monitor', 'Scan demarre...');
    const startTime = Date.now();
    const config = storage.getConfig();
    const chatId = config.adminChatId;

    // Verifier heures business (8h-19h Paris, lun-ven)
    const now = new Date();
    const parisHour = parseInt(now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }));
    const parisDay = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' })).getDay();
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
    } catch (e) { log.warn('intent-monitor', 'Warmup limit check echoue: ' + e.message); }

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
    } catch (e) { log.warn('intent-monitor', 'Already contacted set echoue: ' + e.message); }

    // Charger les leads deja en base (pour ne pas re-proposer)
    this._refreshKnownLeads();

    // Lancer les sources de signaux en parallele
    // Sources Apollo (1-3) DESACTIVEES — Apollo resilie (mars 2026), remplace par Clay
    // Source 4: Market signals Web Intelligence (trigger events < 24h)
    const results = await Promise.allSettled([
      // this._scanRecentCompanies(config),   // Apollo resilie
      // this._scanGrowingPMEs(config),        // Apollo resilie
      // this._scanFundedStartups(config),     // Apollo resilie
      this._scanGoogleAlerts()
    ]);

    // Agreger tous les leads detectes (avec ou sans email — on reveal apres)
    const detectedLeads = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.length > 0) {
        detectedLeads.push(...r.value);
      }
    }

    // Dedup par apolloId (avant reveal pour economiser des credits)
    const seenIds = new Set();
    const dedupedLeads = detectedLeads.filter(function(l) {
      const key = l.apolloId || l.email || '';
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      // Filtrer les leads deja en base ou en cooldown
      if (l.email) {
        const emailLower = l.email.toLowerCase();
        if (alreadyContacted.has(emailLower)) return false;
        if (this._isInCooldown(emailLower)) return false;
      }
      return true;
    }.bind(this));

    // Trier par score intent decroissant + fraicheur
    dedupedLeads.sort(function(a, b) {
      var scoreA = (a.intentScore || 0) + (a.freshness || 0);
      var scoreB = (b.intentScore || 0) + (b.freshness || 0);
      return scoreB - scoreA;
    });

    // Reveal Apollo DESACTIVE — Apollo resilie (mars 2026)
    // Les leads viennent maintenant uniquement de Web Intel (ont deja un email)
    let revealCount = 0;

    // Filtrer : email requis + pas deja contacte + pas en cooldown
    const actionableLeads = dedupedLeads.filter(function(lead) {
      if (!lead.email) return false;
      var emailLower = lead.email.toLowerCase();
      if (alreadyContacted.has(emailLower)) return false;
      if (this._isInCooldown(emailLower)) return false;
      if (this._isKnownLead(lead.email)) return false;
      return true;
    }.bind(this));

    // Prendre les top N (limites par headroom warmup)
    const maxActions = Math.min(MAX_IMMEDIATE_ACTIONS, headroom, actionableLeads.length);
    const toProcess = actionableLeads.slice(0, maxActions);

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
        // FIX: action-executor attend contactName, company, contact:{} (meme format que brain-engine)
        const result = await executor.executeAction({
          type: 'send_email',
          params: {
            to: lead.email,
            contactName: lead.nom || '',
            company: lead.entreprise || '',
            score: Math.max(7, lead.intentScore || 7),
            _generateFirst: true,
            contact: {
              email: lead.email,
              nom: lead.nom || '',
              titre: lead.titre || '',
              entreprise: lead.entreprise || '',
              linkedin_url: lead.linkedin_url || '',
              organization: lead.organization || null
            },
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
      } catch (e) { log.error('intent-monitor', 'Alerte admin Telegram perdue: ' + e.message); }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    log.info('intent-monitor', 'Scan termine en ' + duration + 's — ' + detectedLeads.length + ' detectes, ' + revealCount + ' reveals, ' + actionableLeads.length + ' actionables, ' + processed + '/' + toProcess.length + ' envoyes');

    this._scanHistory.push({
      timestamp: new Date().toISOString(),
      detected: detectedLeads.length,
      revealed: revealCount,
      actionable: actionableLeads.length,
      processed: processed,
      duration: duration
    });
    // Garder 100 derniers scans
    if (this._scanHistory.length > 100) this._scanHistory = this._scanHistory.slice(-100);

    return { scanned: detectedLeads.length, revealed: revealCount, actionable: actionableLeads.length, processed: processed, duration: duration };
  }

  // --- Source 1 : Entreprises recentes FR (founded recent = besoin de clients) ---
  // Signal : une entreprise creee recemment a besoin de trouver des clients → forte receptivite
  // ~17k resultats avec founded>=2023 + tags agence/digital
  async _scanRecentCompanies(config) {
    const leads = [];
    try {
      const ApolloConnector = require('../flowfast/apollo-connector.js');
      const apollo = new ApolloConnector(this.apolloKey);

      const goals = storage.getGoals();
      const baseCriteria = goals.searchCriteria || {};
      const currentYear = new Date().getFullYear();

      // Keyword tags en rotation (1 groupe par scan)
      const tagGroup = KEYWORD_TAG_GROUPS[this._keywordGroupIndex % KEYWORD_TAG_GROUPS.length];
      this._keywordGroupIndex++;

      const searchData = {
        person_titles: baseCriteria.titles || ['CEO', 'Founder', 'Fondateur', 'Gerant', 'Directeur'],
        person_locations: baseCriteria.locations || ['France'],
        person_seniorities: baseCriteria.seniorities || ['founder', 'c_suite', 'owner', 'director'],
        organization_founded_year_min: currentYear - 2, // 2-3 ans max = entreprise recente
        organization_num_employees_ranges: ['1-10', '11-50'],
        q_organization_keyword_tags: tagGroup,
        per_page: 15,
        page: 1 + Math.floor(Math.random() * 5) // rotation pages aleatoire
      };

      const result = await apollo.makeRequest('/v1/mixed_people/api_search', searchData);
      var people = result.people || [];

      for (var j = 0; j < people.length; j++) {
        var p = people[j];
        // PAS de check p.email ici — on le reveal apres dans scan()
        if (this._isKnownLead(p.email)) continue;

        var foundedYear = p.organization ? p.organization.founded_year : null;
        leads.push({
          email: p.email || null, // peut etre null, sera reveal
          nom: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
          titre: p.title || '',
          entreprise: (p.organization && p.organization.name) || '',
          apolloId: p.id,
          linkedin_url: p.linkedin_url || '',
          organization: p.organization || null,
          intentScore: 6, // entreprise recente = bon signal
          signalType: 'recent_company',
          signalDetail: 'Entreprise recente' + (foundedYear ? ' (' + foundedYear + ')' : '') + ' — ' + tagGroup.join(', '),
          freshness: foundedYear >= currentYear ? 2.5 : 1.5,
          detectedAt: new Date().toISOString()
        });
      }

      log.info('intent-monitor', 'Recentes FR: ' + leads.length + ' leads (tags: ' + tagGroup.join(', ') + ', pool: ' + (result.total_entries || 0) + ')');
    } catch (e) {
      log.error('intent-monitor', 'Scan recentes echoue: ' + e.message);
    }
    return leads;
  }

  // --- Source 2 : PME en croissance FR (11-200 emp = entreprise etablie avec budget) ---
  // Signal : PME de taille moyenne dans nos niches = cible ideale pour prospection B2B
  async _scanGrowingPMEs(config) {
    const leads = [];
    try {
      const ApolloConnector = require('../flowfast/apollo-connector.js');
      const apollo = new ApolloConnector(this.apolloKey);

      const goals = storage.getGoals();
      const baseCriteria = goals.searchCriteria || {};

      // Tags decales de 6 par rapport a source 1 (diversification)
      const tagIdx = (this._keywordGroupIndex + 6) % KEYWORD_TAG_GROUPS.length;
      const tagGroup = KEYWORD_TAG_GROUPS[tagIdx];

      const searchData = {
        person_titles: baseCriteria.titles || ['CEO', 'Founder', 'Fondateur', 'Directeur General', 'Gerant'],
        person_locations: baseCriteria.locations || ['France'],
        person_seniorities: baseCriteria.seniorities || ['founder', 'c_suite', 'owner', 'director'],
        organization_num_employees_ranges: ['11-50', '51-200'],
        q_organization_keyword_tags: tagGroup,
        per_page: 15,
        page: 1 + Math.floor(Math.random() * 10) // plus de pages dispo = plus de rotation
      };

      const result = await apollo.makeRequest('/v1/mixed_people/api_search', searchData);
      var people = result.people || [];

      for (var j = 0; j < people.length; j++) {
        var p = people[j];
        if (this._isKnownLead(p.email)) continue;

        var empCount = p.organization ? p.organization.estimated_num_employees : null;
        leads.push({
          email: p.email || null,
          nom: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
          titre: p.title || '',
          entreprise: (p.organization && p.organization.name) || '',
          apolloId: p.id,
          linkedin_url: p.linkedin_url || '',
          organization: p.organization || null,
          intentScore: 5, // PME etablie = signal modere
          signalType: 'growing_pme',
          signalDetail: 'PME ' + (empCount ? empCount + ' emp' : '') + ' — ' + tagGroup.join(', '),
          freshness: 1,
          detectedAt: new Date().toISOString()
        });
      }

      log.info('intent-monitor', 'PME croissance: ' + leads.length + ' leads (tags: ' + tagGroup.join(', ') + ', pool: ' + (result.total_entries || 0) + ')');
    } catch (e) {
      log.error('intent-monitor', 'Scan PME echoue: ' + e.message);
    }
    return leads;
  }

  // --- Source 3 : Startups funded FR (funding = budget frais, garde pour tech) ---
  // Signal : levee de fonds = budget + besoin de scaler rapidement
  async _scanFundedStartups(config) {
    const leads = [];
    try {
      const ApolloConnector = require('../flowfast/apollo-connector.js');
      const apollo = new ApolloConnector(this.apolloKey);

      const goals = storage.getGoals();
      const baseCriteria = goals.searchCriteria || {};

      const searchData = {
        person_titles: ['CEO', 'Founder', 'CTO', 'Co-founder', 'Fondateur', 'Directeur General'],
        person_locations: baseCriteria.locations || ['France'],
        person_seniorities: ['founder', 'c_suite', 'owner'],
        organization_latest_funding_stage_cd: FUNDING_STAGES,
        per_page: 10,
        page: 1 + Math.floor(Math.random() * 5)
      };
      // PAS de keyword tags ici — on ratisse large sur les funded FR

      const result = await apollo.makeRequest('/v1/mixed_people/api_search', searchData);
      var people = result.people || [];

      for (var j = 0; j < people.length; j++) {
        var p = people[j];
        if (this._isKnownLead(p.email)) continue;

        var fundingInfo = p.organization ? (p.organization.latest_funding_stage || 'funded') : 'funded';
        leads.push({
          email: p.email || null,
          nom: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
          titre: p.title || '',
          entreprise: (p.organization && p.organization.name) || '',
          apolloId: p.id,
          linkedin_url: p.linkedin_url || '',
          organization: p.organization || null,
          intentScore: 7, // funded = strong signal
          signalType: 'recent_funding',
          signalDetail: 'Startup funded (' + fundingInfo + ')',
          freshness: 2,
          detectedAt: new Date().toISOString()
        });
      }

      log.info('intent-monitor', 'Funded FR: ' + leads.length + ' leads (pool: ' + (result.total_entries || 0) + ')');
    } catch (e) {
      log.error('intent-monitor', 'Scan funded echoue: ' + e.message);
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

  // --- Known leads cache (evite de re-proposer des leads deja en base) ---
  _refreshKnownLeads() {
    try {
      this._knownLeadEmails = new Set();
      const ffStorage = getFlowFastStorage();
      if (ffStorage) {
        const allLeads = ffStorage.getAllLeads ? ffStorage.getAllLeads() : {};
        for (const [key, lead] of Object.entries(allLeads)) {
          if (lead.email) this._knownLeadEmails.add(lead.email.toLowerCase());
        }
      }
    } catch (e) {
      this._knownLeadEmails = new Set();
    }
  }

  _isKnownLead(email) {
    if (!email || !this._knownLeadEmails) return false;
    return this._knownLeadEmails.has(email.toLowerCase());
  }

  // --- Cooldown management ---
  _isInCooldown(emailLower) {
    const lastScan = this._lastScan[emailLower];
    if (!lastScan) return false;
    return (Date.now() - lastScan) < COOLDOWN_HOURS * 60 * 60 * 1000;
  }

  _setCooldown(emailLower) {
    this._lastScan[emailLower] = Date.now();
    this._persistCooldowns(); // Sauvegarder sur disque (survit restart)
  }

  // --- Stats pour le dashboard ---
  getStats() {
    return {
      lastScans: this._scanHistory.slice(-10),
      keywordGroupIndex: this._keywordGroupIndex,
      cooldownActive: Object.keys(this._lastScan).length,
      knownLeads: this._knownLeadEmails ? this._knownLeadEmails.size : 0
    };
  }
}

module.exports = IntentMonitor;
