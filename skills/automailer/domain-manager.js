// AutoMailer - Gestionnaire multi-domaine + rotation intelligente
// Gere : registre domaines, warmup par domaine, health monitoring, rotation, coherence threading
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { atomicWriteSync, getWarmupDailyLimit } = require('../../gateway/utils.js');
const log = require('../../gateway/logger.js');

// ESP Matching cache — evite de refaire des lookups MX a chaque envoi
const _mxCache = new Map(); // domain → { esp: 'google'|'microsoft'|'other', ts: timestamp }
const MX_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

const DATA_DIR = process.env.AUTOMAILER_DATA_DIR || '/data/automailer';
const DOMAIN_DB = path.join(DATA_DIR, 'domain-manager.json');
const BOUNCE_THRESHOLD = 0.03; // 3% bounce rate → auto-pause
const BOUNCE_WINDOW = 100; // Calcule sur les 100 derniers envois
const YOUNG_DOMAIN_DAYS = 45; // Domaine < 45 jours = jeune (pas de pixel, signature mini, pas de lien step 1)

class DomainManager {
  constructor() {
    this.domains = [];
    this.data = { domains: {}, prospectDomains: {} };
    this._load();
    this._initDomains();
  }

  _load() {
    try {
      if (fs.existsSync(DOMAIN_DB)) {
        const raw = fs.readFileSync(DOMAIN_DB, 'utf8');
        this.data = JSON.parse(raw);
      }
    } catch (e) {
      log.warn('domain-manager', 'Erreur chargement: ' + e.message);
      this.data = { domains: {}, prospectDomains: {} };
    }
  }

  _save() {
    try {
      atomicWriteSync(DOMAIN_DB, this.data);
    } catch (e) {
      log.error('domain-manager', 'Erreur sauvegarde: ' + e.message);
    }
  }

  _initDomains() {
    // Format SENDER_DOMAINS : domain1:type:smtpUser:smtpPass,domain2:type:smtpUser:smtpPass
    // type = gmail ou resend
    // Exemple : getifind.fr:gmail:alexis@getifind.fr:apppass123,ifind-agency.fr:resend::
    const raw = (process.env.SENDER_DOMAINS || '').trim();
    if (raw) {
      this.domains = [];
      for (const entry of raw.split(',')) {
        // Split limite a 4 : domain:type:user:password (password peut contenir ':')
        const trimmed = entry.trim();
        const firstColon = trimmed.indexOf(':');
        const secondColon = firstColon >= 0 ? trimmed.indexOf(':', firstColon + 1) : -1;
        const thirdColon = secondColon >= 0 ? trimmed.indexOf(':', secondColon + 1) : -1;
        if (firstColon >= 0) {
          this.domains.push({
            domain: trimmed.substring(0, firstColon).trim(),
            type: (secondColon >= 0 ? trimmed.substring(firstColon + 1, secondColon) : trimmed.substring(firstColon + 1)).trim() || 'gmail',
            smtpUser: secondColon >= 0 ? (thirdColon >= 0 ? trimmed.substring(secondColon + 1, thirdColon) : trimmed.substring(secondColon + 1)).trim() : '',
            smtpPass: thirdColon >= 0 ? trimmed.substring(thirdColon + 1).trim() : '',
            active: true
          });
        }
      }
    }

    // Fallback : domaine unique depuis GMAIL_SMTP_USER
    if (this.domains.length === 0) {
      const smtpUser = process.env.GMAIL_SMTP_USER || process.env.SENDER_EMAIL || '';
      const smtpPass = (process.env.GMAIL_SMTP_PASS || '').replace(/\s/g, '');
      const domain = smtpUser.split('@')[1] || process.env.CLIENT_DOMAIN || 'ifind.fr';
      this.domains = [{
        domain: domain,
        type: 'gmail',
        smtpUser: smtpUser,
        smtpPass: smtpPass,
        active: true
      }];
    }

    // Initialiser les stats pour chaque domaine
    for (const d of this.domains) {
      if (!this.data.domains[d.domain]) {
        this.data.domains[d.domain] = {
          firstSendDate: null,
          dailySends: {},
          recentResults: [], // [{success: bool, timestamp}] — 100 derniers
          paused: false,
          pausedAt: null,
          pauseReason: null,
          totalSent: 0,
          totalBounced: 0
        };
      }
    }

    log.info('domain-manager', this.domains.length + ' domaine(s) configure(s): ' + this.domains.map(d => d.domain).join(', '));
  }

  // Detecter l'ESP du destinataire via MX records (cache 24h)
  async detectRecipientESP(recipientEmail) {
    const domain = (recipientEmail || '').split('@')[1];
    if (!domain) return 'other';

    // Check cache
    const cached = _mxCache.get(domain);
    if (cached && (Date.now() - cached.ts) < MX_CACHE_TTL) return cached.esp;

    try {
      const mxRecords = await new Promise((resolve, reject) => {
        dns.resolveMx(domain, (err, addresses) => {
          if (err) reject(err);
          else resolve(addresses || []);
        });
      });
      const mxStr = mxRecords.map(r => (r.exchange || '').toLowerCase()).join(' ');
      let esp = 'other';
      if (/google|gmail|googlemail|aspmx/.test(mxStr)) esp = 'google';
      else if (/outlook|microsoft|hotmail|office365|protection\.outlook/.test(mxStr)) esp = 'microsoft';
      _mxCache.set(domain, { esp, ts: Date.now() });
      return esp;
    } catch (e) {
      log.warn('domain-manager', 'MX lookup echoue pour ' + domain + ': ' + e.message);
      _mxCache.set(domain, { esp: 'other', ts: Date.now() });
      return 'other';
    }
  }

  // Selectionner le domaine optimal pour un envoi (avec ESP matching)
  async selectDomain(recipientEmail) {
    const emailLower = (recipientEmail || '').toLowerCase();

    // 1. Coherence threading : meme prospect = meme domaine
    if (emailLower && this.data.prospectDomains[emailLower]) {
      const existing = this.data.prospectDomains[emailLower];
      const domainObj = this.domains.find(d => d.domain === existing && d.active);
      if (domainObj && !this._isDomainPaused(existing)) {
        return domainObj;
      }
    }

    // 2. Filtrer les domaines actifs et non pauses
    const active = this.domains.filter(d => d.active && !this._isDomainPaused(d.domain));
    if (active.length === 0) {
      log.warn('domain-manager', 'Aucun domaine actif disponible !');
      return this.domains[0] || null;
    }

    // 3. ESP Matching : preferer les domaines du meme type que le destinataire
    // Gmail→Gmail = +10-16% inbox placement (Smartlead data 2026)
    let espPreference = null;
    try {
      const recipientESP = await this.detectRecipientESP(emailLower);
      if (recipientESP !== 'other') {
        espPreference = recipientESP;
      }
    } catch (e) { /* ignore, fallback sur rotation normale */ }

    // 4. Rotation intelligente avec priorite warmup
    const today = new Date().toISOString().slice(0, 10);
    const candidates = active.map(d => {
      const stats = this.data.domains[d.domain] || {};
      const todaySends = (stats.dailySends || {})[today] || 0;
      const warmupLimit = this._getWarmupLimit(d.domain);
      return { ...d, todaySends, warmupLimit, headroom: warmupLimit - todaySends, firstSendDate: stats.firstSendDate || null, totalSent: stats.totalSent || 0 };
    }).filter(c => c.headroom > 0);

    if (candidates.length === 0) {
      log.info('domain-manager', 'Tous les domaines ont atteint leur limite warmup');
      return null;
    }

    // Priorite : domaines jamais utilises (demarrer leur warmup)
    const neverSent = candidates.filter(c => !c.firstSendDate);
    if (neverSent.length > 0) {
      const pick = neverSent[Math.floor(Math.random() * neverSent.length)];
      log.info('domain-manager', 'Warmup kickstart: ' + pick.domain + ' (jamais envoye)');
      return pick;
    }

    // ESP matching : filtrer les candidats par type Gmail/Microsoft si possible
    let espCandidates = candidates;
    if (espPreference) {
      const matched = candidates.filter(c => c.type === (espPreference === 'google' ? 'gmail' : 'outlook'));
      if (matched.length > 0) {
        espCandidates = matched;
        log.info('domain-manager', 'ESP matching: ' + espPreference + ' → ' + matched.length + ' domaine(s) compatibles');
      }
    }

    // Weighted random : poids = fillRate inverse
    const totalWeight = espCandidates.reduce((sum, c) => {
      const fillRate = c.warmupLimit > 0 ? c.todaySends / c.warmupLimit : 1;
      return sum + Math.pow(1 - fillRate, 2);
    }, 0);
    let random = Math.random() * totalWeight;
    for (const c of espCandidates) {
      const fillRate = c.warmupLimit > 0 ? c.todaySends / c.warmupLimit : 1;
      random -= Math.pow(1 - fillRate, 2);
      if (random <= 0) return c;
    }
    return espCandidates[0];
  }

  // Selecteur synchrone (fallback pour le code qui ne peut pas await)
  selectDomainSync(recipientEmail) {
    const emailLower = (recipientEmail || '').toLowerCase();
    if (emailLower && this.data.prospectDomains[emailLower]) {
      const existing = this.data.prospectDomains[emailLower];
      const domainObj = this.domains.find(d => d.domain === existing && d.active);
      if (domainObj && !this._isDomainPaused(existing)) return domainObj;
    }
    const active = this.domains.filter(d => d.active && !this._isDomainPaused(d.domain));
    if (active.length === 0) return this.domains[0] || null;
    const today = new Date().toISOString().slice(0, 10);
    const candidates = active.map(d => {
      const stats = this.data.domains[d.domain] || {};
      const todaySends = (stats.dailySends || {})[today] || 0;
      const warmupLimit = this._getWarmupLimit(d.domain);
      return { ...d, todaySends, warmupLimit, headroom: warmupLimit - todaySends };
    }).filter(c => c.headroom > 0);
    if (candidates.length === 0) return null;
    const totalWeight = candidates.reduce((sum, c) => {
      const fillRate = c.warmupLimit > 0 ? c.todaySends / c.warmupLimit : 1;
      return sum + Math.pow(1 - fillRate, 2);
    }, 0);
    let random = Math.random() * totalWeight;
    for (const c of candidates) {
      const fillRate = c.warmupLimit > 0 ? c.todaySends / c.warmupLimit : 1;
      random -= Math.pow(1 - fillRate, 2);
      if (random <= 0) return c;
    }
    return candidates[0];
  }

  // Retourner la mailbox pour un domaine (pour ResendClient)
  getMailboxForDomain(domain) {
    const d = this.domains.find(dd => dd.domain === domain);
    if (!d || !d.smtpUser || !d.smtpPass) return null;
    return { user: d.smtpUser, pass: d.smtpPass };
  }

  // Enregistrer un envoi sur un domaine
  recordSend(domain, recipientEmail, success) {
    if (!this.data.domains[domain]) {
      this.data.domains[domain] = { firstSendDate: null, dailySends: {}, recentResults: [], paused: false, totalSent: 0, totalBounced: 0 };
    }
    const stats = this.data.domains[domain];

    // Premier envoi
    if (!stats.firstSendDate) stats.firstSendDate = new Date().toISOString();

    // Compteur quotidien
    const today = new Date().toISOString().slice(0, 10);
    if (!stats.dailySends) stats.dailySends = {};
    stats.dailySends[today] = (stats.dailySends[today] || 0) + 1;

    // Nettoyer vieux jours (garder 30)
    const keys = Object.keys(stats.dailySends).sort();
    while (keys.length > 30) { delete stats.dailySends[keys.shift()]; }

    stats.totalSent = (stats.totalSent || 0) + 1;

    // Resultat recent (pour calcul bounce rate)
    if (!stats.recentResults) stats.recentResults = [];
    stats.recentResults.push({ success, ts: Date.now() });
    while (stats.recentResults.length > BOUNCE_WINDOW) stats.recentResults.shift();

    // Associer ce prospect a ce domaine (coherence threading)
    if (recipientEmail) {
      if (!this.data.prospectDomains) this.data.prospectDomains = {};
      this.data.prospectDomains[(recipientEmail || '').toLowerCase()] = domain;
      // Cleanup : garder max 2000 prospects (LRU-like : supprimer les plus anciens)
      const pdKeys = Object.keys(this.data.prospectDomains);
      if (pdKeys.length > 2000) {
        const toDelete = pdKeys.slice(0, pdKeys.length - 2000);
        for (const k of toDelete) delete this.data.prospectDomains[k];
      }
    }

    this._save();
  }

  // Enregistrer un bounce sur un domaine
  recordBounce(domain) {
    if (!this.data.domains[domain]) return;
    const stats = this.data.domains[domain];
    stats.totalBounced = (stats.totalBounced || 0) + 1;

    // Remplacer le dernier success par un bounce (evite double-comptage send+bounce)
    if (!stats.recentResults) stats.recentResults = [];
    const lastSuccess = stats.recentResults.findLastIndex(r => r.success === true);
    if (lastSuccess >= 0) {
      stats.recentResults[lastSuccess] = { success: false, ts: Date.now(), bounce: true };
    } else {
      stats.recentResults.push({ success: false, ts: Date.now(), bounce: true });
    }
    while (stats.recentResults.length > BOUNCE_WINDOW) stats.recentResults.shift();

    // Auto-pause si bounce rate > seuil
    const bounces = stats.recentResults.filter(r => r.bounce).length;
    const total = stats.recentResults.length;
    if (total >= 20 && (bounces / total) > BOUNCE_THRESHOLD) {
      stats.paused = true;
      stats.pausedAt = new Date().toISOString();
      stats.pauseReason = 'bounce_rate_' + Math.round((bounces / total) * 100) + 'pct';
      log.warn('domain-manager', 'DOMAINE PAUSE: ' + domain + ' (bounce rate ' + Math.round((bounces / total) * 100) + '% sur ' + total + ' envois)');
    }

    this._save();
  }

  // Warmup par domaine independant
  _getWarmupLimit(domain) {
    const stats = this.data.domains[domain] || {};
    return getWarmupDailyLimit(stats.firstSendDate || null);
  }

  _isDomainPaused(domain) {
    const stats = this.data.domains[domain];
    if (!stats || !stats.paused) return false;
    // Auto-resume apres 48h : reset les recentResults et reprendre avec quota reduit
    if (stats.pausedAt) {
      const pausedMs = Date.now() - new Date(stats.pausedAt).getTime();
      if (pausedMs > 48 * 60 * 60 * 1000) {
        // Clear les bounces des recentResults pour donner une seconde chance
        stats.recentResults = (stats.recentResults || []).filter(r => !r.bounce).slice(-20);
        stats.paused = false;
        stats.pauseReason = null;
        this._save();
        log.info('domain-manager', 'Auto-resume: ' + domain + ' apres 48h (recentResults reset, reprise progressive)');
        return false;
      }
    }
    return true;
  }

  /**
   * Retourne l'age du domaine en jours depuis le premier envoi.
   * @param {string} domain
   * @returns {number} Jours depuis le premier envoi, 0 si jamais envoye
   */
  getDomainAgeDays(domain) {
    const stats = this.data.domains[domain];
    if (!stats || !stats.firstSendDate) return 0;
    return Math.floor((Date.now() - new Date(stats.firstSendDate).getTime()) / 86400000);
  }

  /**
   * Determine si un domaine est "jeune" (< 45 jours d'envoi).
   * Les domaines jeunes doivent : pas de pixel tracking, signature minimale, pas de lien step 1.
   * @param {string} domain
   * @returns {boolean}
   */
  isDomainYoung(domain) {
    return this.getDomainAgeDays(domain) < YOUNG_DOMAIN_DAYS;
  }

  /**
   * Retourne le tracking domain pour un domaine d'envoi.
   * Chaque domaine utilise son propre sous-domaine de tracking (track.domaine.com)
   * au lieu d'un tracking domain global partage.
   * @param {string} domain - Le domaine d'envoi (ex: getifind.fr)
   * @returns {string} Le tracking domain (ex: track.getifind.fr ou le domaine lui-meme)
   */
  getTrackingDomain(domain) {
    // Si un TRACKING_DOMAIN_MAP est configure : domaine1:track1,domaine2:track2
    const mapEnv = (process.env.TRACKING_DOMAIN_MAP || '').trim();
    if (mapEnv) {
      for (const entry of mapEnv.split(',')) {
        const [d, td] = entry.trim().split(':');
        if (d && td && d.trim() === domain) return td.trim();
      }
    }
    // Fallback : utiliser le domaine d'envoi comme tracking domain
    // (le serveur ecoute deja sur ce domaine via nginx)
    return domain;
  }

  // Stats pour le dashboard / monitoring
  getStats() {
    const today = new Date().toISOString().slice(0, 10);
    return this.domains.map(d => {
      const stats = this.data.domains[d.domain] || {};
      const todaySends = (stats.dailySends || {})[today] || 0;
      const warmupLimit = this._getWarmupLimit(d.domain);
      const bounces = (stats.recentResults || []).filter(r => r.bounce).length;
      const total = (stats.recentResults || []).length;
      const ageDays = this.getDomainAgeDays(d.domain);
      return {
        domain: d.domain,
        type: d.type,
        active: d.active && !stats.paused,
        paused: stats.paused || false,
        pauseReason: stats.pauseReason || null,
        todaySends,
        warmupLimit,
        headroom: warmupLimit - todaySends,
        totalSent: stats.totalSent || 0,
        totalBounced: stats.totalBounced || 0,
        bounceRate: total > 0 ? Math.round((bounces / total) * 100) : 0,
        firstSendDate: stats.firstSendDate,
        ageDays,
        isYoung: ageDays < YOUNG_DOMAIN_DAYS,
        trackingDomain: this.getTrackingDomain(d.domain),
        deliverabilityMode: ageDays < YOUNG_DOMAIN_DAYS ? 'stealth (no pixel, no click track, min signature)' : 'full tracking'
      };
    });
  }

  // Reactiver un domaine manuellement
  unpauseDomain(domain) {
    if (this.data.domains[domain]) {
      this.data.domains[domain].paused = false;
      this.data.domains[domain].pauseReason = null;
      this.data.domains[domain].recentResults = [];
      this._save();
      log.info('domain-manager', 'Domaine reactive: ' + domain);
    }
  }
}

module.exports = new DomainManager();
