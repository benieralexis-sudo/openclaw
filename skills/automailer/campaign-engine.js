// AutoMailer - Moteur de campagnes (sequences, scheduling, execution)
const storage = require('./storage');
const dns = require('dns');
const net = require('net');
const log = require('../../gateway/logger.js');
const { getWarmupDailyLimit } = require('../../gateway/utils.js');

// --- Quality gate post-generation email ---
const GENERIC_PATTERNS = [
  /j[a'']ai (?:vu|lu|decouvert|trouve|remarque)/i,
  /suis tomb[eé]/i,
  /en parcourant (?:ton|votre) (?:profil|linkedin|site)/i,
  /je me permets de/i,
  /me present(?:e|er)/i,
  /n'h[eé]site[zs]? pas [aà] me contacter/i,
  /saviez.vous que/i,
  /et si (?:on|vous|tu)/i,
  /cordonnier/i,
  /nerf de la guerre/i,
  /beau move/i,
  /dans un monde o[uù]/i,
  /comment (?:tu prospectes|vous prospectez)/i,
  /g[eé]n[eé]ration de leads/i,
  /notre (?:solution|outil|plateforme)/i,
  /je serais ravi/i
];

function _emailPassesQualityGate(subject, body) {
  // 1. Patterns generiques
  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.test(body) || pattern.test(subject)) {
      return { pass: false, reason: 'generic_pattern: ' + pattern.source };
    }
  }
  // 2. Longueur body (3-12 lignes non vides)
  const lines = body.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return { pass: false, reason: 'too_short (' + lines.length + ' lignes)' };
  if (lines.length > 15) return { pass: false, reason: 'too_long (' + lines.length + ' lignes)' };
  // 3. Mots interdits depuis config AP (si dispo)
  try {
    const apStorage = require('../autonomous-pilot/storage.js');
    const apConfig = apStorage.getConfig();
    const ep = apConfig.emailPreferences || {};
    if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
      for (const word of ep.forbiddenWords) {
        if (new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(body)) {
          return { pass: false, reason: 'forbidden_word: ' + word };
        }
      }
    }
  } catch (e) { /* AP storage non dispo, skip */ }
  return { pass: true };
}

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

// --- Cache SMTP par email (24h TTL) ---
const _smtpCache = new Map();
const SMTP_CACHE_TTL = 24 * 60 * 60 * 1000;
// Cache catch-all par domaine (24h)
const _catchAllCache = new Map();

function _smtpVerify(email) {
  return new Promise((resolve) => {
    const key = (email || '').toLowerCase().trim();
    if (!key) return resolve({ valid: false, reason: 'empty_email' });

    // Check cache
    const cached = _smtpCache.get(key);
    if (cached && Date.now() - cached.ts < SMTP_CACHE_TTL) {
      return resolve(cached.result);
    }

    const domain = key.split('@')[1];
    if (!domain) return resolve({ valid: false, reason: 'no_domain' });

    // Check catch-all cache — si domaine catch-all, skip verification
    const catchAllCached = _catchAllCache.get(domain);
    if (catchAllCached && Date.now() - catchAllCached.ts < SMTP_CACHE_TTL) {
      if (catchAllCached.isCatchAll) return resolve({ valid: null, reason: 'catch_all' });
    }

    dns.resolveMx(domain, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        return resolve({ valid: false, reason: 'no_mx' });
      }

      // Trier par priorite (plus bas = plus prioritaire)
      addresses.sort((a, b) => a.priority - b.priority);
      const mxHost = addresses[0].exchange;

      const timeout = 10000;
      let done = false;
      let response = '';
      let step = 'connect';

      const finish = (result) => {
        if (done) return;
        done = true;
        // Cache le resultat
        _smtpCache.set(key, { result, ts: Date.now() });
        if (_smtpCache.size > 1000) {
          const firstKey = _smtpCache.keys().next().value;
          _smtpCache.delete(firstKey);
        }
        try { socket.destroy(); } catch (e) {}
        resolve(result);
      };

      const socket = net.createConnection(25, mxHost);
      socket.setTimeout(timeout, () => finish({ valid: null, reason: 'timeout' }));
      socket.on('error', () => finish({ valid: null, reason: 'connect_error' }));

      const sendCommand = (cmd) => {
        response = '';
        socket.write(cmd + '\r\n');
      };

      socket.on('data', (data) => {
        response += data.toString();
        if (!/\r\n/.test(response)) return;

        const code = parseInt(response.substring(0, 3), 10);

        if (step === 'connect') {
          if (code !== 220) return finish({ valid: null, reason: 'bad_greeting' });
          step = 'ehlo';
          sendCommand('EHLO ' + (process.env.CLIENT_DOMAIN || 'ifind.fr'));
        } else if (step === 'ehlo') {
          if (code !== 250) return finish({ valid: null, reason: 'ehlo_rejected' });
          step = 'mail_from';
          sendCommand('MAIL FROM:<verify@' + (process.env.CLIENT_DOMAIN || 'ifind.fr') + '>');
        } else if (step === 'mail_from') {
          if (code !== 250) return finish({ valid: null, reason: 'mail_from_rejected' });
          // Catch-all detection : tester adresse random d'abord
          const catchAllCachedNow = _catchAllCache.get(domain);
          if (!catchAllCachedNow || Date.now() - catchAllCachedNow.ts >= SMTP_CACHE_TTL) {
            step = 'catch_all_test';
            sendCommand('RCPT TO:<xyztest_fake_' + Date.now() + '@' + domain + '>');
          } else {
            step = 'rcpt_to';
            sendCommand('RCPT TO:<' + key + '>');
          }
        } else if (step === 'catch_all_test') {
          if (code === 250 || code === 251) {
            // Domaine catch-all — accepte tout
            _catchAllCache.set(domain, { isCatchAll: true, ts: Date.now() });
            step = 'quit';
            sendCommand('QUIT');
            return finish({ valid: null, reason: 'catch_all' });
          }
          _catchAllCache.set(domain, { isCatchAll: false, ts: Date.now() });
          // Reset pour tester la vraie adresse
          step = 'rcpt_to';
          sendCommand('RCPT TO:<' + key + '>');
        } else if (step === 'rcpt_to') {
          step = 'quit';
          sendCommand('QUIT');
          if (code === 250 || code === 251) {
            return finish({ valid: true });
          } else if (code === 550 || code === 551 || code === 552 || code === 553) {
            return finish({ valid: false, reason: 'user_unknown' });
          } else {
            return finish({ valid: null, reason: 'smtp_code_' + code });
          }
        } else if (step === 'quit') {
          finish({ valid: null, reason: 'done' });
        }
      });
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
  if (parisHour < 9 || parisHour >= 15) return false; // envois 9h-14h59 (14h = best open rate)
  return true;
}

// --- Envoi preferentiel (Paris) ---
// Defaults : Mar-Jeu 13h30-14h30. Self-Improve peut overrider heure et jour.
// Mapping jour string → numero (0=dim)
const _DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };

function _getSelfImproveTimingPrefs() {
  try {
    const si = require('../self-improve/storage.js');
    return si.getEmailPreferences() || {};
  } catch (e) {
    try {
      const si = require('/app/skills/self-improve/storage.js');
      return si.getEmailPreferences() || {};
    } catch (e2) { return {}; }
  }
}

function _snapToPreferredSlot(date) {
  const siPrefs = _getSelfImproveTimingPrefs();

  // Heure preferentielle (default 13 = 13h30-14h29 avec jitter)
  const targetHour = (siPrefs.preferredSendHour >= 7 && siPrefs.preferredSendHour <= 20)
    ? siPrefs.preferredSendHour : 13;

  // Jours preferentiels : par defaut Mar/Mer/Jeu. Si self-improve specifie un jour, l'accepter aussi.
  const preferredDays = new Set([2, 3, 4]); // Mar, Mer, Jeu
  if (siPrefs.preferredSendDay) {
    const siDay = _DAY_MAP[(siPrefs.preferredSendDay || '').toLowerCase()];
    if (siDay >= 1 && siDay <= 5) preferredDays.add(siDay); // Ajouter le jour recommande (jours ouvrables only)
  }

  const parisStr = date.toLocaleString('en-US', { timeZone: 'Europe/Paris' });
  const parisDate = new Date(parisStr);
  const day = parisDate.getDay();

  // Si le jour actuel n'est pas un jour prefere → glisser au prochain jour prefere
  let daysToAdd = 0;
  if (!preferredDays.has(day)) {
    for (let d = 1; d <= 7; d++) {
      if (preferredDays.has((day + d) % 7)) { daysToAdd = d; break; }
    }
  }

  if (daysToAdd > 0) {
    date = new Date(date.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  }

  // Fixer l'heure avec jitter (+/- 30min autour de targetHour)
  const offset = _getParisOffsetMs(date);
  const jitterMinutes = Math.floor(Math.random() * 60); // 0-59 min apres targetHour
  const parisTarget = new Date(date);
  parisTarget.setUTCHours(0, 0, 0, 0);
  parisTarget.setTime(parisTarget.getTime() + (targetHour * 60 + jitterMinutes) * 60 * 1000 - offset);

  return parisTarget;
}

// Offset Paris en ms (gère heure d'été/hiver)
function _getParisOffsetMs(date) {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const parisStr = date.toLocaleString('en-US', { timeZone: 'Europe/Paris' });
  return new Date(parisStr).getTime() - new Date(utcStr).getTime();
}

// --- Warmup progressif (source unique : gateway/utils.js) ---
function getDailyLimit() {
  const firstSendDate = storage.getFirstSendDate ? storage.getFirstSendDate() : null;
  return Math.min(getWarmupDailyLimit(firstSendDate), 100); // Resend free tier = 100/jour max
}

class CampaignEngine {
  constructor(resendClient, claudeWriter) {
    this.resend = resendClient;
    this.claude = claudeWriter;
    this.schedulerInterval = null;
  }

  // --- Recuperation intel prospect (cascade 3 sources) ---

  /**
   * Recupere le brief prospect depuis les sources disponibles.
   * 1. AP storage cache (brief complet 5500 chars, TTL 7j)
   * 2. Proactive Agent cache (brief sauvegarde lors des opens)
   * 3. Lead Enrich storage (donnees basiques)
   * Retourne le brief string ou null.
   */
  _getProspectIntel(email) {
    // Source 1 : AP storage (prospect research cache, le plus riche)
    try {
      let apStorage = null;
      try { apStorage = require('../autonomous-pilot/storage.js'); }
      catch (e) { try { apStorage = require('/app/skills/autonomous-pilot/storage.js'); } catch (e2) {} }
      if (apStorage && apStorage.getProspectResearch) {
        const cached = apStorage.getProspectResearch(email);
        if (cached && cached.brief) {
          const cacheAge = Date.now() - new Date(cached.cachedAt || cached.researchedAt || 0).getTime();
          if (cacheAge < 7 * 24 * 60 * 60 * 1000) {
            log.info('campaign-engine', 'ProspectIntel cache hit (AP) pour ' + email);
            return cached.brief;
          }
        }
      }
    } catch (e) {}

    // Source 2 : Proactive Agent cached intel (sauvegarde lors des opens/clicks)
    try {
      let paStorage = null;
      try { paStorage = require('../proactive-agent/storage.js'); }
      catch (e) { try { paStorage = require('/app/skills/proactive-agent/storage.js'); } catch (e2) {} }
      if (paStorage && paStorage.data && paStorage.data._cachedIntel) {
        const cached = paStorage.data._cachedIntel[email];
        if (cached && cached.brief) {
          log.info('campaign-engine', 'ProspectIntel cache hit (PA) pour ' + email);
          return cached.brief;
        }
      }
    } catch (e) {}

    // Source 3 : Lead Enrich storage (donnees basiques enrichies)
    try {
      let leStorage = null;
      try { leStorage = require('../lead-enrich/storage.js'); }
      catch (e) { try { leStorage = require('/app/skills/lead-enrich/storage.js'); } catch (e2) {} }
      if (leStorage && leStorage.getEnrichedLead) {
        const enriched = leStorage.getEnrichedLead(email);
        if (enriched) {
          // Verifier si prospectIntel a ete sauvegarde lors du premier envoi
          if (enriched.prospectIntel) {
            log.info('campaign-engine', 'ProspectIntel cache hit (LE.prospectIntel) pour ' + email);
            return enriched.prospectIntel;
          }
          // Sinon construire un brief minimal depuis les donnees enrichies
          const parts = [];
          if (enriched.aiClassification) {
            if (enriched.aiClassification.industry) parts.push('INDUSTRIE: ' + enriched.aiClassification.industry);
            if (enriched.aiClassification.persona) parts.push('PERSONA: ' + enriched.aiClassification.persona);
          }
          if (enriched.apolloData && enriched.apolloData.organization) {
            const org = enriched.apolloData.organization;
            if (org.short_description) parts.push('ACTIVITE: ' + org.short_description);
            if (org.technologies && org.technologies.length > 0) parts.push('STACK TECHNIQUE: ' + org.technologies.slice(0, 8).join(', '));
            if (org.keywords && org.keywords.length > 0) parts.push('MOTS-CLES: ' + org.keywords.slice(0, 8).join(', '));
            if (org.estimated_num_employees) parts.push('TAILLE: ' + org.estimated_num_employees + ' employes');
            if (org.city) parts.push('VILLE: ' + org.city);
          }
          if (parts.length > 0) {
            log.info('campaign-engine', 'ProspectIntel partiel (LE) pour ' + email);
            return parts.join('\n');
          }
        }
      }
    } catch (e) {}

    return null;
  }

  /**
   * Recupere l'historique des emails envoyes a ce prospect dans cette campagne.
   * Retourne un array d'objets {stepNumber, subject, body} pour anti-repetition.
   */
  _getPreviousEmails(campaignId, email, currentStep) {
    const allEmails = storage.getEmailsByCampaign(campaignId)
      .filter(e => e.to === email && e.stepNumber < currentStep && e.status !== 'failed');
    return allEmails.map(e => ({
      stepNumber: e.stepNumber,
      subject: e.subject || '',
      body: (e.body || '').substring(0, 400)
    }));
  }

  /**
   * Applique les variables template ({{firstName}}, {{company}}, etc.) sur un texte.
   */
  _applyTemplateVars(text, contact, firstName) {
    const vars = {
      firstName: firstName || contact.firstName || (contact.name || '').split(' ')[0] || '',
      lastName: contact.lastName || '',
      name: contact.name || firstName || '',
      company: contact.company || '',
      title: contact.title || ''
    };
    for (const key of Object.keys(vars)) {
      const regex = new RegExp('\\{\\{' + key + '\\}\\}', 'g');
      text = text.replace(regex, vars[key]);
    }
    if (vars.firstName && !text.includes(vars.firstName)) {
      text = text.replace(/Bonjour\s*,/i, 'Bonjour ' + vars.firstName + ',');
    }
    return text;
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

  async generateCampaignEmails(campaignId, context, totalSteps, intervalDaysOrStepDays, options) {
    const campaign = storage.getCampaign(campaignId);
    if (!campaign) throw new Error('Campagne introuvable');

    const list = storage.getContactList(campaign.contactListId);
    if (!list || list.contacts.length === 0) throw new Error('Liste de contacts vide');

    // Fallback Self-Improve : si pas de steps/cadence explicite, utiliser les recos
    const siPrefs = _getSelfImproveTimingPrefs();
    if (!totalSteps && siPrefs.recommendedMaxSteps) {
      totalSteps = siPrefs.recommendedMaxSteps;
    }
    if (!intervalDaysOrStepDays && siPrefs.recommendedStepDays) {
      intervalDaysOrStepDays = siPrefs.recommendedStepDays;
    }

    // Generer les emails pour le premier contact (les memes seront personalises pour chaque contact a l'envoi)
    const sampleContact = list.contacts[0];
    const emailTemplates = await this.claude.generateSequenceEmails(
      sampleContact, context, totalSteps, options
    );

    // Support stepDays array [3, 7, 14, 21] ou intervalDays fixe (legacy)
    const stepDays = Array.isArray(intervalDaysOrStepDays) ? intervalDaysOrStepDays : null;
    const intervalDays = stepDays ? null : (intervalDaysOrStepDays || 4);

    // Construire les steps de la campagne
    const steps = [];
    const now = new Date();
    for (let i = 0; i < emailTemplates.length; i++) {
      const dayOffset = stepDays ? (stepDays[i] || stepDays[stepDays.length - 1]) : (i * intervalDays);
      let scheduledDate = new Date(now.getTime() + (dayOffset * 24 * 60 * 60 * 1000));
      // Ajuster au prochain créneau préférentiel Mar-Jeu 9h-11h (Paris)
      scheduledDate = _snapToPreferredSlot(scheduledDate);
      steps.push({
        stepNumber: i + 1,
        subjectTemplate: emailTemplates[i].subject,
        bodyTemplate: emailTemplates[i].body,
        delayDays: dayOffset,
        status: 'pending',
        scheduledAt: scheduledDate.toISOString(),
        sentAt: null,
        sentCount: 0,
        errorCount: 0
      });
    }

    storage.updateCampaign(campaignId, { steps: steps, context: context });
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
    let skippedInactive = 0;
    let skippedSentiment = 0;

    // Cache des emails de cette campagne (evite 3 appels/contact)
    const campaignEmails = storage.getEmailsByCampaign(campaignId);

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

      // Rate limiting inter-campagne : max 2 emails/72h par contact (cross-campagne)
      try {
        const allEmailsToContact = storage.getEmailEventsForRecipient(contact.email);
        const cutoff72h = Date.now() - 72 * 60 * 60 * 1000;
        const recentSent = allEmailsToContact.filter(e => {
          if (e.status === 'failed' || e.status === 'queued') return false;
          const sentTime = e.sentAt ? new Date(e.sentAt).getTime() : 0;
          return sentTime > 0 && sentTime > cutoff72h;
        });
        if (recentSent.length >= 2) {
          log.info('campaign-engine', 'Skip ' + contact.email + ' (rate limit: ' + recentSent.length + ' emails en 72h)');
          skipped++;
          continue;
        }
      } catch (rlErr) {
        log.info('campaign-engine', 'Rate limit check skip pour ' + contact.email + ': ' + rlErr.message);
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

      // Verification SMTP : l'adresse existe-t-elle reellement ?
      try {
        const smtpResult = await _smtpVerify(contact.email);
        if (smtpResult && smtpResult.valid === false) {
          log.info('campaign-engine', 'Skip ' + contact.email + ' (SMTP: ' + smtpResult.reason + ') — blacklist');
          storage.addToBlacklist(contact.email, 'smtp_invalid');
          skipped++;
          continue;
        }
        if (smtpResult && smtpResult.valid === true) {
          log.info('campaign-engine', 'SMTP OK: ' + contact.email);
        } else if (smtpResult) {
          log.info('campaign-engine', 'SMTP incertain pour ' + contact.email + ' (' + smtpResult.reason + ') — on laisse passer');
        }
      } catch (smtpErr) {
        log.info('campaign-engine', 'SMTP verify echoue pour ' + contact.email + ' (non bloquant): ' + smtpErr.message);
      }

      // Verifier si l'email a deja ete envoye pour ce contact/step
      const contactEmails = campaignEmails.filter(e => e.to === contact.email);
      const existing = contactEmails.find(e => e.stepNumber === stepNumber && e.status !== 'failed');
      if (existing) continue;

      // FIX 5 : Follow-up intelligent — skip si bounce ou reponse sur un email precedent
      if (stepNumber > 1) {
        const previousEmails = contactEmails.filter(e => e.stepNumber < stepNumber);
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

        // Stop sur inactivite : skip si zero ouverture apres 2 steps (sauf breakup)
        if (stepNumber > 2 && stepNumber < campaign.steps.length) {
          const prevEmails = contactEmails.filter(e => e.stepNumber < stepNumber && e.status !== 'failed');
          if (prevEmails.length > 0 && !prevEmails.some(e => e.openedAt || e.status === 'opened')) {
            log.info('campaign-engine', 'Skip ' + contact.email + ' (inactif: zero ouverture sur ' + prevEmails.length + ' emails — step ' + stepNumber + ')');
            skippedInactive++;
            skipped++;
            continue;
          }
        }

        // Stop si sentiment "not_interested" detecte par inbox-manager
        const sentimentData = storage.getSentiment ? storage.getSentiment(contact.email) : null;
        if (sentimentData && sentimentData.sentiment === 'not_interested') {
          log.info('campaign-engine', 'Skip ' + contact.email + ' (sentiment: not_interested — score ' + sentimentData.score + ')');
          skippedSentiment++;
          skipped++;
          continue;
        }
      }

      // Personnaliser l'email pour ce contact
      let subject = step.subjectTemplate;
      let body = step.bodyTemplate;
      const firstName = contact.firstName || (contact.name || '').split(' ')[0] || '';

      if (stepNumber > 1) {
        // === RELANCES : generation individuelle avec brief complet ===
        const prospectIntel = this._getProspectIntel(contact.email);

        if (prospectIntel) {
          try {
            const previousEmails = this._getPreviousEmails(campaignId, contact.email, stepNumber);
            const campaignContext = campaign.context || campaign.name || 'prospection B2B';

            const personalized = await this.claude.generatePersonalizedFollowUp(
              contact,
              stepNumber,
              campaign.steps.length,
              prospectIntel,
              previousEmails,
              campaignContext
            );

            if (personalized && personalized.subject && personalized.body && !personalized.skip) {
              subject = personalized.subject;
              body = personalized.body;
              log.info('campaign-engine', 'Relance individualisee generee pour ' + contact.email + ' (step ' + stepNumber + ')');
            } else {
              // Fallback template si skip ou donnees insuffisantes
              log.info('campaign-engine', 'Fallback template pour ' + contact.email + ' (step ' + stepNumber + '): ' + (personalized && personalized.reason || 'generation incomplete'));
              subject = this._applyTemplateVars(subject, contact, firstName);
              body = this._applyTemplateVars(body, contact, firstName);
            }
          } catch (genErr) {
            // Fallback complet sur le template en cas d'erreur
            log.warn('campaign-engine', 'Erreur generation individualisee pour ' + contact.email + ', fallback template: ' + genErr.message);
            subject = this._applyTemplateVars(subject, contact, firstName);
            body = this._applyTemplateVars(body, contact, firstName);
          }
        } else {
          // Pas de brief : fallback template + personalizeEmail basique
          log.info('campaign-engine', 'Pas de prospectIntel pour ' + contact.email + ' — fallback template (step ' + stepNumber + ')');
          subject = this._applyTemplateVars(subject, contact, firstName);
          body = this._applyTemplateVars(body, contact, firstName);
          if (contact.company || contact.title || contact.industry) {
            try {
              const pResult = await this.claude.personalizeEmail(subject, body, contact);
              if (pResult && pResult.subject && pResult.body) {
                subject = pResult.subject;
                body = pResult.body;
              }
            } catch (personalizeErr) {
              log.info('campaign-engine', 'personalizeEmail fallback echoue: ' + personalizeErr.message);
            }
          }
        }
      } else {
        // === STEP 1 : brief prospect si dispo, sinon template + personalizeEmail ===
        const step1Intel = this._getProspectIntel(contact.email);
        if (step1Intel && this.claude.generateSingleEmail) {
          try {
            const campaignCtx = campaign.context || campaign.name || 'prospection B2B';
            const enrichedContext = step1Intel + '\n\nCONTEXTE CAMPAGNE: ' + campaignCtx;
            const generated = await this.claude.generateSingleEmail(contact, enrichedContext);
            if (generated && generated.subject && generated.body) {
              subject = generated.subject;
              body = generated.body;
              log.info('campaign-engine', 'Step 1 personnalise avec brief pour ' + contact.email);
            } else {
              // Fallback template
              subject = this._applyTemplateVars(subject, contact, firstName);
              body = this._applyTemplateVars(body, contact, firstName);
            }
          } catch (genErr) {
            log.info('campaign-engine', 'Step 1 brief echoue pour ' + contact.email + ', fallback template: ' + genErr.message);
            subject = this._applyTemplateVars(subject, contact, firstName);
            body = this._applyTemplateVars(body, contact, firstName);
          }
        } else {
          // Pas de brief : template + personalizeEmail classique
          subject = this._applyTemplateVars(subject, contact, firstName);
          body = this._applyTemplateVars(body, contact, firstName);
        }
        if (contact.company || contact.title || contact.industry) {
          try {
            const personalized = await this.claude.personalizeEmail(subject, body, contact);
            if (personalized && personalized.subject && personalized.body) {
              subject = personalized.subject;
              body = personalized.body;
            }
          } catch (personalizeErr) {
            log.info('campaign-engine', 'Personnalisation IA echouee pour ' + contact.email + ': ' + personalizeErr.message);
          }
        }
      }

      // A/B testing — variante deterministe par email (stable entre restarts)
      const _abHash = contact.email.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
      let abVariant = _abHash % 2 === 0 ? 'A' : 'B';
      if (abVariant === 'B') {
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

      // Quality gate post-generation — verifier avant envoi
      const qg = _emailPassesQualityGate(subject, body);
      if (!qg.pass) {
        log.warn('campaign-engine', 'Quality gate FAIL pour ' + contact.email + ': ' + qg.reason + ' — skip envoi');
        skipped++;
        continue;
      }

      // Ajouter lien booking Cal.eu dans les relances (step 2+)
      if (stepNumber >= 2) {
        try {
          const CalComClient = require('../meeting-scheduler/calendar-client.js');
          const calClient = new CalComClient(process.env.CALCOM_API_KEY || '');
          const bookingUrl = await calClient.getBookingLink('appel-telephonique', contact.email, firstName);
          if (bookingUrl) {
            body += '\n\nSi ca te dit, voici mon lien pour caler un echange rapide : ' + bookingUrl;
          }
        } catch (calErr) {
          // Cal.eu non dispo — pas bloquant, on envoie sans lien
          log.info('campaign-engine', 'Booking link skip pour ' + contact.email + ': ' + calErr.message);
        }
      }

      // Dernier guard avant envoi : re-verifier replied (anti race condition)
      const freshEvents = storage.getEmailEventsForRecipient(contact.email);
      if (freshEvents.some(e => e.status === 'replied' || e.hasReplied)) {
        log.info('campaign-engine', 'Guard pre-envoi: ' + contact.email + ' a repondu entre-temps — skip');
        skipped++;
        continue;
      }

      // Generer un tracking ID unique pour le pixel d'ouverture
      const trackingId = require('crypto').randomBytes(16).toString('hex');

      // Threading : recuperer le messageId du dernier email envoye a ce prospect
      const sendOpts = {
        replyTo: process.env.REPLY_TO_EMAIL || 'hello@ifind.fr',
        fromName: process.env.SENDER_NAME || 'Alexis',
        trackingId: trackingId,
        tags: [
          { name: 'campaign_id', value: campaignId },
          { name: 'step', value: String(stepNumber) }
        ]
      };
      if (stepNumber > 0) {
        const prevMessageId = storage.getMessageIdForRecipient(contact.email);
        if (prevMessageId) {
          sendOpts.inReplyTo = prevMessageId;
          sendOpts.references = prevMessageId;
        }
      }

      const result = await this.resend.sendEmail(contact.email, subject, body, sendOpts);

      const emailRecord = {
        chatId: campaign.chatId,
        campaignId: campaignId,
        stepNumber: stepNumber,
        to: contact.email,
        subject: subject,
        body: body,
        resendId: result.success ? result.id : null,
        messageId: result.success ? (result.messageId || null) : null,
        trackingId: trackingId,
        status: result.success ? 'sent' : 'failed',
        abVariant: abVariant
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

    return { sent, errors, skipped, skippedInactive, skippedSentiment };
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

    // A/B testing stats (global + par step)
    const abResults = storage.getABTestResults(campaignId);
    const abResultsByStep = {};
    for (const step of campaign.steps) {
      abResultsByStep[step.stepNumber] = storage.getABTestResults(campaignId, step.stepNumber);
    }

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
      abResultsByStep: abResultsByStep,
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

        // --- Delais adaptatifs : avancer les steps si bon engagement ---
        if (step.stepNumber > 1 && !step._adaptiveChecked) {
          const prevStep = campaign.steps.find(s => s.stepNumber === step.stepNumber - 1);
          if (prevStep && prevStep.status === 'completed') {
            const prevEmails = storage.getEmailsByCampaign(campaign.id)
              .filter(e => e.stepNumber === prevStep.stepNumber && e.status !== 'failed');
            const opened = prevEmails.filter(e => e.openedAt || e.status === 'opened').length;
            const openRate = prevEmails.length > 0 ? opened / prevEmails.length : 0;
            if (openRate > 0.4) {
              const scheduledDate = new Date(step.scheduledAt);
              const advancedDate = new Date(scheduledDate.getTime() - 24 * 60 * 60 * 1000);
              // Minimum 1 jour apres le step precedent
              const prevSentAt = prevStep.sentAt ? new Date(prevStep.sentAt) : now;
              const minDate = new Date(prevSentAt.getTime() + 24 * 60 * 60 * 1000);
              if (advancedDate > minDate) {
                step.scheduledAt = advancedDate.toISOString();
                log.info('campaign-engine', 'Delai adaptatif: step ' + step.stepNumber + ' avance de 1j (open rate ' + Math.round(openRate * 100) + '% au step ' + prevStep.stepNumber + ')');
              }
            }
            step._adaptiveChecked = true;
            storage.updateCampaign(campaign.id, { steps: campaign.steps });
          }
        }

        const scheduledAt = new Date(step.scheduledAt);
        if (scheduledAt <= now) {
          log.info('campaign-engine', 'Execution campagne ' + campaign.name + ' step ' + step.stepNumber);
          try {
            const result = await this.executeCampaignStep(campaign.id, step.stepNumber);
            log.info('campaign-engine', 'Step ' + step.stepNumber + ' termine: ' + result.sent + ' envoyes, ' + result.errors + ' erreurs, ' + (result.skipped || 0) + ' skips' +
              (result.skippedInactive ? ' (' + result.skippedInactive + ' inactifs)' : '') +
              (result.skippedSentiment ? ' (' + result.skippedSentiment + ' not_interested)' : ''));
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

  // --- Retry queue : retente les emails failed toutes les 5 min ---

  async processRetryQueue() {
    const MAX_RETRIES = 3;
    const failedEmails = storage.getFailedEmailsForRetry(MAX_RETRIES);
    if (failedEmails.length === 0) return { retried: 0, success: 0, gaveUp: 0 };

    let retried = 0;
    let success = 0;
    let gaveUp = 0;

    log.info('campaign-engine', 'Retry queue: ' + failedEmails.length + ' email(s) a retenter');

    for (const email of failedEmails) {
      // Verifier blacklist (a pu etre ajoute entre-temps)
      if (storage.isBlacklisted(email.to)) {
        log.info('campaign-engine', 'Retry skip ' + email.to + ' (blackliste)');
        storage.markRetryAttempt(email.id, false, null);
        continue;
      }

      retried++;
      try {
        // Threading : recuperer messageId precedent pour ce prospect
        const retryOpts = {
          replyTo: process.env.REPLY_TO_EMAIL || 'hello@ifind.fr',
          fromName: process.env.SENDER_NAME || 'Alexis',
          trackingId: email.trackingId,
          tags: [
            { name: 'campaign_id', value: email.campaignId || 'retry' },
            { name: 'retry', value: String((email.retryCount || 0) + 1) }
          ]
        };
        const prevMsgId = storage.getMessageIdForRecipient(email.to);
        if (prevMsgId) {
          retryOpts.inReplyTo = prevMsgId;
          retryOpts.references = prevMsgId;
        }
        const result = await this.resend.sendEmail(email.to, email.subject, email.body, retryOpts);

        if (result.success) {
          storage.markRetryAttempt(email.id, true, result.id);
          storage.setFirstSendDate();
          storage.incrementTodaySendCount();
          success++;
          log.info('campaign-engine', 'Retry OK pour ' + email.to + ' (tentative ' + ((email.retryCount || 0) + 1) + ')');
        } else {
          storage.markRetryAttempt(email.id, false, null);
          const newCount = (email.retryCount || 0) + 1;
          if (newCount >= MAX_RETRIES) {
            gaveUp++;
            log.warn('campaign-engine', 'Retry ABANDON pour ' + email.to + ' apres ' + newCount + ' tentatives: ' + result.error);
          } else {
            log.info('campaign-engine', 'Retry FAIL pour ' + email.to + ' (tentative ' + newCount + '/' + MAX_RETRIES + '): ' + result.error);
          }
        }
      } catch (err) {
        storage.markRetryAttempt(email.id, false, null);
        log.error('campaign-engine', 'Retry exception pour ' + email.to + ': ' + err.message);
      }

      // Rate limit entre retries
      await new Promise(r => setTimeout(r, 500));
    }

    if (retried > 0) {
      log.info('campaign-engine', 'Retry queue termine: ' + success + '/' + retried + ' reussis, ' + gaveUp + ' abandonnes');
    }
    return { retried, success, gaveUp };
  }

  // --- Archivage auto (appele periodiquement) ---

  runArchive() {
    try {
      return storage.archiveOldEmails();
    } catch (e) {
      log.error('campaign-engine', 'Erreur archivage:', e.message);
      return 0;
    }
  }
}

CampaignEngine.checkMX = _checkMX;
CampaignEngine.emailPassesQualityGate = _emailPassesQualityGate;
module.exports = CampaignEngine;
