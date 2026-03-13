// AutoMailer - Moteur de campagnes (sequences, scheduling, execution)
const storage = require('./storage');
const dns = require('dns');
const net = require('net');
const log = require('../../gateway/logger.js');
const { getWarmupDailyLimit, applySpintax, validateEmailOutput, getCityTimezone } = require('../../gateway/utils.js');

// --- Quality gate : specificite email (delegue a action-executor pour eviter divergences) ---
let _checkEmailSpecificity = null;
try {
  const ActionExecutor = require('../autonomous-pilot/action-executor.js');
  if (ActionExecutor && ActionExecutor.prototype && ActionExecutor.prototype._checkEmailSpecificity) {
    const _ae = new ActionExecutor({});
    _checkEmailSpecificity = _ae._checkEmailSpecificity.bind(_ae);
  }
} catch (e) {}
if (!_checkEmailSpecificity) {
  // Fallback inline si action-executor non disponible
  _checkEmailSpecificity = function(body, subject, prospectIntel) {
    if (!prospectIntel) return { level: 'no_brief', facts: [], reason: 'Pas de brief' };
    const emailText = ((subject || '') + ' ' + (body || '')).toLowerCase();
    const intelText = (prospectIntel || '').toLowerCase();
    const facts = [];
    const currentYear = new Date().getFullYear();
    const companyMatch = prospectIntel.match(/ENTREPRISE:\s*([^(\n]+)/);
    if (companyMatch) {
      const cn = companyMatch[1].trim().toLowerCase();
      if (cn.length > 3 && emailText.includes(cn)) facts.push('entreprise');
      else { for (const p of cn.split(/[\s-]+/).filter(w => w.length > 3)) { if (emailText.includes(p)) { facts.push('entreprise_partiel:' + p); break; } } }
    }
    const intelNums = intelText.match(/\d{2,}/g) || [];
    const emailNums = emailText.match(/\d{2,}/g) || [];
    const shared = emailNums.filter(n => { const num = parseInt(n); return intelNums.includes(n) && num > 3 && num < 100000 && !(num >= currentYear - 5 && num <= currentYear + 5); });
    if (shared.length > 0) facts.push('chiffre:' + shared[0]);
    const techMatch = intelText.match(/STACK TECHNIQUE:\s*([^\n]+)/);
    if (techMatch) { for (const t of techMatch[1].split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 2)) { if (emailText.includes(t)) { facts.push('tech:' + t); break; } } }
    const evtKws = ['levee', 'leve', 'recrute', 'recrutement', 'lance', 'acquisition', 'fusion', 'partenariat', 'expansion', 'ouvert', 'ouvre'];
    for (const kw of evtKws) { if (emailText.includes(kw) && intelText.includes(kw)) { facts.push('evt:' + kw); break; } }
    const clientMatch = intelText.match(/CLIENTS\/MARQUES DETECTES:\s*([^\n]+)/);
    if (clientMatch) { for (const c of clientMatch[1].split(',').map(c => c.trim().toLowerCase()).filter(c => c.length > 2)) { if (emailText.includes(c)) { facts.push('client:' + c); break; } } }
    return { level: facts.length >= 1 ? 'specific' : 'generic', facts, reason: facts.length === 0 ? 'Aucun fait specifique' : facts.length + ' fait(s)' };
  };
}

// --- Patterns sujets interdits dans les campagnes ---
const SUBJECT_BANS = [
  'prospection', 'acquisition', 'gen de leads', 'generation de leads',
  'rdv qualifi', 'rdv/mois', 'pipeline', 'sans recruter',
  'et si vous', 'et si tu', 'saviez-vous', 'notre solution', 'notre outil'
];

function _subjectPassesGate(subject) {
  const subjectLower = (subject || '').toLowerCase();
  for (const ban of SUBJECT_BANS) {
    if (subjectLower.includes(ban)) return { pass: false, reason: 'banned_subject: ' + ban };
  }
  return { pass: true };
}

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
  /je serais ravi/i,
  /comment .{0,30} g[eé]n[eè]re (?:de )?nouvelles? opportunit/i,
  /ces canaux ont un plafond/i,
  /carnet de contacts (?:est )?satur/i,
  /cercle de prescripteurs (?:est )?satur/i,
  /vit de recommandations et de r[eé]seaux/i,
  /comment (?:tu|vous) (?:trouv|g[eé]n[eè]r|acqui).{0,20}(?:client|lead|opportunit)/i,
  // Anti-meta-prospection elargi
  /comment (?:tu|vous) g[eè]r.{0,10}(?:le flux|la prospection|le pipe|l.acquisition)/i,
  /(?:tu|vous) acqui.{0,10}(?:de )?nouveaux? clients? comment/i,
  /c.est du bouche.[aà]?.oreille ou/i,
  /qui s.occupe de (?:la tienne|la votre|la sienne)/i,
  /(?:ta|votre) propre acquisition/i,
  /comment (?:tu|vous) (?:scale|rempli).{0,15}(?:pipe|prospection|commercial)/i,
  /founder.led (?:sales|selling)/i,
  /le plus (?:dur|ingrat|difficile) c.est/i,
  // Anti-analyse/lecon
  /ce type de .{5,40} (?:souvent|generalement|habituellement)/i,
  /le vrai cap.{0,5} c.est/i,
  /ce qui distingue .{5,30} c.est/i,
  /en tant que (?:CEO|founder|CTO|dirigeant|fondateur)/i,
  // Anti-question-journalistique (questions ouvertes sans rien proposer)
  /c.est quoi (?:la|le|ta|ton|votre) (?:strategie|plan|prochain|vrai|prochaine)/i,
  /(?:conviction|choix|decision) ou (?:differenciation|pragmatisme|strategie)/i,
  /c.est (?:le|un) (?:debut|test|premier) .{0,20} ou /i,
  // Anti-templates generiques des vieux follow-ups
  /passai(?:t|ent) \d+% (?:de (?:leur|son)|du) temps/i,
  /un (?:cabinet|directeur|dirigeant) .{5,40} avait le m[eê]me probl[eè]me/i,
  /ils? (?:a|ont) externalis[eé]/i,
  /r[eé]sultat\s*:/i,
  // Anti-"curieux" en toutes formes
  /curieux (?:de|d')/i
];

// --- Spam trigger patterns (deliverabilite) ---
const SPAM_TRIGGER_PATTERNS = [
  // Mots trigger classiques
  /\b(gratuit|gratis|free|offre speciale|offre exclusive|offre limitee)\b/i,
  /\b(cliquez ici|click here|agissez maintenant|act now|urgent)\b/i,
  /\b(garanti|100%|sans risque|risk free|money back)\b/i,
  /\b(felicitations|congratulations|vous avez gagne|you won)\b/i,
  /\b(achetez|acheter maintenant|buy now|order now|commander)\b/i,
  /\b(promotion|promo|soldes?|reduction|remise|discount)\b/i,
  /\b(pas cher|meilleur prix|lowest price|best price)\b/i,
  /\b(revenu passif|passive income|gagner de l.argent|make money)\b/i,
  /\b(millionnaire|fortune|richesse|wealth)\b/i,
  /\b(credit|pret|loan|mortgage|hypotheque)\b/i,
  /\b(viagra|casino|pharma|lottery|loterie)\b/i,
  /\b(double your|doublez|triple your|triplez)\b/i,
  /\b(limited time|temps limite|derniere chance|last chance)\b/i,
  /\b(no obligation|sans obligation|sans engagement)\b/i,
  /\b(unbelievable|incroyable deal|deal exclusif)\b/i
];

function _spamScoreCheck(subject, body) {
  const fullText = (subject || '') + ' ' + (body || '');
  const issues = [];
  let score = 0;

  // 1. Spam trigger words (2 points chacun)
  for (const pattern of SPAM_TRIGGER_PATTERNS) {
    if (pattern.test(fullText)) {
      score += 2;
      issues.push('spam_word: ' + pattern.source.substring(0, 30));
    }
  }

  // 2. Trop de liens (>2 = suspect)
  const linkCount = (fullText.match(/https?:\/\//g) || []).length;
  if (linkCount > 2) { score += 2; issues.push('too_many_links: ' + linkCount); }

  // 3. Trop de MAJUSCULES (>20% du texte = spam)
  const upperRatio = (fullText.replace(/[^A-Z]/g, '').length) / Math.max(fullText.length, 1);
  if (upperRatio > 0.2) { score += 2; issues.push('excessive_caps: ' + Math.round(upperRatio * 100) + '%'); }

  // 4. Points d'exclamation excessifs (>2 = spam)
  const exclamCount = (fullText.match(/!/g) || []).length;
  if (exclamCount > 2) { score += 1; issues.push('excessive_exclamations: ' + exclamCount); }

  // 5. Subject trop long (>60 chars = penalite delivrabilite)
  if ((subject || '').length > 60) { score += 1; issues.push('subject_too_long: ' + subject.length + ' chars'); }

  // 6. Emojis dans le sujet (penalise par Gmail)
  if (/[\u{1F600}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(subject || '')) {
    score += 1; issues.push('emoji_in_subject');
  }

  return {
    score,
    pass: score < 4, // Block si score >= 4
    issues,
    level: score === 0 ? 'clean' : score < 3 ? 'low_risk' : score < 4 ? 'medium_risk' : 'high_risk'
  };
}

function _emailPassesQualityGate(subject, body) {
  // 0. Spam score check (delivrabilite)
  const spamCheck = _spamScoreCheck(subject, body);
  if (!spamCheck.pass) {
    return { pass: false, reason: 'spam_score_' + spamCheck.score + ': ' + spamCheck.issues.join(', ') };
  }
  // 1. Patterns generiques + meta-prospection
  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.test(body) || pattern.test(subject)) {
      return { pass: false, reason: 'generic_pattern: ' + pattern.source };
    }
  }
  // 2. Longueur body (2-8 lignes non vides, plus strict)
  const lines = body.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return { pass: false, reason: 'too_short (' + lines.length + ' lignes)' };
  if (lines.length > 12) return { pass: false, reason: 'too_long (' + lines.length + ' lignes)' };
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
  return { pass: true, spamScore: spamCheck };
}

// --- Cache MX par domaine (1h TTL) ---
const _mxCache = new Map();
const MX_CACHE_TTL = 60 * 60 * 1000; // 1 heure

function _checkMX(email) {
  return new Promise((resolve) => {
    const domain = (email || '').split('@')[1];
    if (!domain) return resolve(false);

    // Check cache (LRU: delete+re-set pour maintenir l'ordre d'acces)
    const cached = _mxCache.get(domain);
    if (cached && Date.now() - cached.ts < MX_CACHE_TTL) {
      _mxCache.delete(domain); _mxCache.set(domain, cached);
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

// --- Gate MX Google Workspace (optionnel, active via REQUIRE_GOOGLE_WORKSPACE=true) ---
const _googleMxCache = new Map();
const GOOGLE_MX_PATTERNS = ['aspmx.l.google.com', 'googlemail.com', 'google.com'];

function _checkGoogleWorkspace(email) {
  return new Promise((resolve) => {
    if (process.env.REQUIRE_GOOGLE_WORKSPACE !== 'true') return resolve(true);
    const domain = (email || '').split('@')[1];
    if (!domain) return resolve(false);

    const cached = _googleMxCache.get(domain);
    if (cached && Date.now() - cached.ts < MX_CACHE_TTL) {
      _googleMxCache.delete(domain); _googleMxCache.set(domain, cached);
      return resolve(cached.isGoogle);
    }

    dns.resolveMx(domain, (err, addresses) => {
      if (err || !Array.isArray(addresses) || addresses.length === 0) {
        _googleMxCache.set(domain, { isGoogle: false, ts: Date.now() });
        return resolve(false);
      }
      const isGoogle = addresses.some(mx => {
        const exchange = (mx.exchange || '').toLowerCase();
        return GOOGLE_MX_PATTERNS.some(p => exchange.includes(p));
      });
      _googleMxCache.set(domain, { isGoogle, ts: Date.now() });
      if (_googleMxCache.size > 500) {
        _googleMxCache.delete(_googleMxCache.keys().next().value);
      }
      resolve(isGoogle);
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

    // Check cache (LRU: delete+re-set)
    const cached = _smtpCache.get(key);
    if (cached && Date.now() - cached.ts < SMTP_CACHE_TTL) {
      _smtpCache.delete(key); _smtpCache.set(key, cached);
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

      const finish = (result) => {
        if (done) return;
        done = true;
        // Cache le resultat
        _smtpCache.set(key, { result, ts: Date.now() });
        if (_smtpCache.size > 5000) {
          const firstKey = _smtpCache.keys().next().value;
          _smtpCache.delete(firstKey);
        }
        try { socket.destroy(); } catch (e) {}
        resolve(result);
      };

      const socket = net.createConnection(25, mxHost);
      socket.setTimeout(timeout, () => finish({ valid: null, reason: 'timeout' }));
      socket.on('error', () => finish({ valid: null, reason: 'connect_error' }));

      let dataHandler = null;
      const sendCommand = (cmd) => { socket.write(cmd + '\r\n'); };
      const waitForResponse = () => {
        return new Promise((res) => {
          let buf = '';
          if (dataHandler) socket.removeListener('data', dataHandler);
          dataHandler = (d) => {
            buf += d.toString();
            if (/^\d{3}[ ]/m.test(buf) && buf.endsWith('\r\n')) { res(buf.trim()); }
          };
          socket.on('data', dataHandler);
        });
      };

      // Async IIFE pour pouvoir utiliser await dans le callback dns
      (async () => {
        try {
          const greeting = await waitForResponse();
          if (!greeting.startsWith('220')) return finish({ valid: null, reason: 'bad_greeting' });

          sendCommand('EHLO ' + (process.env.CLIENT_DOMAIN || 'ifind.fr'));
          const ehloResp = await waitForResponse();
          if (!ehloResp.startsWith('250')) return finish({ valid: null, reason: 'ehlo_rejected' });

          sendCommand('MAIL FROM:<verify@' + (process.env.CLIENT_DOMAIN || 'ifind.fr') + '>');
          const mailFromResp = await waitForResponse();
          if (!mailFromResp.startsWith('250')) return finish({ valid: null, reason: 'mail_from_rejected' });

          const catchAllCachedNow = _catchAllCache.get(domain);
          if (!catchAllCachedNow || Date.now() - catchAllCachedNow.ts >= SMTP_CACHE_TTL) {
            sendCommand('RCPT TO:<xyztest_fake_' + Date.now() + '@' + domain + '>');
            const catchResp = await waitForResponse();
            const catchCode = parseInt(catchResp.substring(0, 3), 10);
            if (catchCode === 250 || catchCode === 251) {
              _catchAllCache.set(domain, { isCatchAll: true, ts: Date.now() });
              sendCommand('QUIT');
              return finish({ valid: null, reason: 'catch_all' });
            }
            _catchAllCache.set(domain, { isCatchAll: false, ts: Date.now() });
          }

          sendCommand('RCPT TO:<' + key + '>');
          const rcptResp = await waitForResponse();
          const code = parseInt(rcptResp.substring(0, 3), 10);

          sendCommand('QUIT');
          if (code === 250 || code === 251) return finish({ valid: true });
          else if (code >= 550 && code <= 553) return finish({ valid: false, reason: 'user_unknown' });
          else return finish({ valid: null, reason: 'smtp_code_' + code });
        } catch (smtpErr) {
          finish({ valid: null, reason: 'smtp_error: ' + smtpErr.message });
        }
      })();
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

function _getFlowFastStorage() {
  try { return require('../flowfast/storage.js'); }
  catch (e) {
    try { return require('/app/skills/flowfast/storage.js'); }
    catch (e2) { return null; }
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
function isBusinessHours(timezone) {
  timezone = timezone || 'Europe/Paris';
  const now = new Date();
  const localHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(now));
  const localDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const localDay = localDate.getDay(); // 0=dimanche, 6=samedi
  if (localDay === 0 || localDay === 6) return false; // weekend
  if (localHour < 9 || localHour >= 18) return false; // envois 9h-17h59 dans la timezone du prospect
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

function _snapToPreferredSlot(date, timezone) {
  timezone = timezone || 'Europe/Paris';
  const siPrefs = _getSelfImproveTimingPrefs();

  // 2 vagues optimales B2B : matin (8h-9h30) et apres-midi (14h30-16h)
  // Spread temporel pour maximiser inbox placement + eviter pattern anti-spam

  // Jours preferentiels : tous les jours ouvrables Lun-Ven (1-5)
  const preferredDays = new Set([1, 2, 3, 4, 5]);

  const localStr = date.toLocaleString('en-US', { timeZone: timezone });
  const localDate = new Date(localStr);
  const day = localDate.getDay();

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

  // Assignation ponderee matin/apres-midi basee sur les open rates reels
  // Donnee marche B2B FR : 8h-9h30 = meilleur open rate (inbox fraiche), 14h30-16h = 2eme fenetre
  // On pondere 60/40 matin par defaut, ajustable si les donnees montrent autre chose
  let morningWeight = 0.6;
  try {
    const amStorage = require('./storage.js');
    if (amStorage && amStorage.data && amStorage.data.emails) {
      const recentEmails = amStorage.data.emails.filter(e => e.sendHourParis && e.openedAt);
      if (recentEmails.length >= 20) {
        const morning = recentEmails.filter(e => e.sendHourParis >= 8 && e.sendHourParis < 12);
        const afternoon = recentEmails.filter(e => e.sendHourParis >= 12 && e.sendHourParis < 18);
        const morningOpenRate = morning.length > 0 ? morning.filter(e => e.openedAt).length / morning.length : 0.5;
        const afternoonOpenRate = afternoon.length > 0 ? afternoon.filter(e => e.openedAt).length / afternoon.length : 0.5;
        const total = morningOpenRate + afternoonOpenRate;
        if (total > 0) morningWeight = Math.max(0.3, Math.min(0.8, morningOpenRate / total));
      }
    }
  } catch (e) { /* fallback 60/40 */ }
  const isMorningWave = Math.random() < morningWeight;
  let targetHour, jitterMinutes;
  if (isMorningWave) {
    targetHour = 8;
    jitterMinutes = Math.floor(Math.random() * 90); // 8h00 - 9h30
  } else {
    targetHour = 14;
    jitterMinutes = 30 + Math.floor(Math.random() * 90); // 14h30 - 16h00
  }

  const offset = _getTimezoneOffsetMs(date, timezone);
  const localTarget = new Date(date);
  localTarget.setUTCHours(0, 0, 0, 0);
  localTarget.setTime(localTarget.getTime() + (targetHour * 60 + jitterMinutes) * 60 * 1000 - offset);

  return localTarget;
}

// Offset timezone en ms (gere heure d'ete/hiver, n'importe quelle timezone IANA)
function _getTimezoneOffsetMs(date, timezone) {
  timezone = timezone || 'Europe/Paris';
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const localStr = date.toLocaleString('en-US', { timeZone: timezone });
  return new Date(localStr).getTime() - new Date(utcStr).getTime();
}

// --- Warmup progressif (source unique : domain-manager.js) ---
function getDailyLimit() {
  try {
    const domainManager = require('./domain-manager.js');
    const stats = domainManager.getStats();
    if (stats && stats.length > 0) {
      // Plafond global = somme des headroom de tous les domaines actifs
      const totalHeadroom = stats
        .filter(s => s.active)
        .reduce((sum, s) => sum + Math.max(0, s.headroom), 0);
      // Limite min par domaine (le plus restrictif pour le warmup global)
      const minWarmupLimit = Math.min(...stats.filter(s => s.active).map(s => s.warmupLimit));
      const totalTodaySent = stats.reduce((sum, s) => sum + s.todaySends, 0);
      log.info('campaign-engine', 'Warmup check: ' + totalTodaySent + ' envoyes, limit=' + minWarmupLimit + ', headroom=' + totalHeadroom);
      return totalHeadroom;
    }
  } catch (e) {
    log.warn('campaign-engine', 'Domain-manager indisponible, fallback storage: ' + e.message);
  }
  // Fallback : ancienne methode si domain-manager absent
  const firstSendDate = storage.getFirstSendDate ? storage.getFirstSendDate() : null;
  return Math.min(getWarmupDailyLimit(firstSendDate), 100);
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
    } catch (e) { log.warn('campaign-engine', 'Intel AP cache echoue: ' + e.message); }

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
    } catch (e) { log.warn('campaign-engine', 'Intel PA cache echoue: ' + e.message); }

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
    } catch (e) { log.warn('campaign-engine', 'Intel LE echoue: ' + e.message); }

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
    // Appliquer spintax : {variante1|variante2|variante3} → choix aleatoire
    text = applySpintax(text);
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

    // Stocker le sampleContact pour detection de contamination a l'envoi
    const sampleInfo = {
      email: sampleContact.email || '',
      firstName: (sampleContact.firstName || (sampleContact.name || '').split(' ')[0] || '').trim(),
      company: (sampleContact.company || '').trim()
    };
    storage.updateCampaign(campaignId, { steps: steps, context: context, _sampleContact: sampleInfo });
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

    let batchSentCount = 0; // Compteur local pour refleter les envois du batch en cours
    for (const contact of list.contacts) {
      // FIX 3 : Verifier quota warmup journalier via domain-manager
      const remainingHeadroom = getDailyLimit() - batchSentCount;
      if (remainingHeadroom <= 0) {
        log.info('campaign-engine', 'Quota warmup atteint (headroom=0) — envoi stoppe');
        break;
      }

      // Detecter timezone prospect (Apollo city/country ou fallback Paris)
      const hasCityData = !!(contact.city || contact.state || contact.country);
      const prospectTz = getCityTimezone(contact.city || contact.state || '', contact.country || '');
      if (!hasCityData && prospectTz === 'Europe/Paris') {
        log.info('campaign-engine', 'Timezone fallback Paris pour ' + contact.email + ' (pas de city/country)');
      }

      // FIX 4 : Re-verifier heures bureau dans la timezone du prospect
      if (!isBusinessHours(prospectTz)) {
        log.info('campaign-engine', 'Hors heures bureau pour ' + contact.email + ' (tz: ' + prospectTz + ') — skip');
        skipped++;
        continue; // Skip ce contact, pas break (d'autres contacts peuvent etre dans une autre TZ)
      }

      // FIX 2 : Verifier blacklist
      if (storage.isBlacklisted(contact.email)) {
        log.info('campaign-engine', 'Skip ' + contact.email + ' (blackliste)');
        skipped++;
        continue;
      }

      // GATE : Re-verifier Lead Enrich pour les follow-ups (evite d'envoyer des relances a des leads hors-cible)
      // MAIS : bypass si le lead a deja ouvert un email (engagement reel > score theorique)
      if (stepNumber >= 2) {
        try {
          const leStorage = require('../lead-enrich/storage.js');
          if (leStorage && leStorage.getEnrichedLead) {
            const enrichedGate = leStorage.getEnrichedLead(contact.email);
            if (enrichedGate && enrichedGate.aiClassification) {
              const aiClass = enrichedGate.aiClassification;
              const aiScore = aiClass.score != null ? aiClass.score : 10;
              const aiIndustry = (aiClass.industry || '').toLowerCase();
              if (aiScore <= 3 && aiIndustry === 'autre') {
                // Verifier engagement reel avant de bloquer
                const contactEmails = (storage.data.emails || []).filter(e => e.to === contact.email);
                const hasOpened = contactEmails.some(e => e.openCount > 0 || e.status === 'opened' || e.status === 'clicked');
                if (hasOpened) {
                  log.info('campaign-engine', 'GATE Lead Enrich BYPASS — ' + contact.email +
                    ' hors-cible (score ' + aiScore + ') mais A OUVERT — engagement > score');
                } else {
                  log.warn('campaign-engine', 'GATE Lead Enrich BLOCK — ' + contact.email +
                    ' hors-cible (score ' + aiScore + ', industrie ' + aiClass.industry + ') — skip follow-up');
                  skipped++;
                  continue;
                }
              }
            }
          }
        } catch (leErr) { /* Lead Enrich indisponible — pas bloquant */ }
      }

      // Filtre honeypot : exclure les adresses systeme/generiques qui ne repondront jamais
      const emailPrefix = (contact.email || '').split('@')[0].toLowerCase();
      // Vrais honeypots/system uniquement — info@, contact@, hello@ etc. sont de vrais emails B2B
      const HONEYPOT_PREFIXES = ['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'no-response',
        'noreponse', 'mailer-daemon', 'postmaster', 'hostmaster', 'abuse', 'spam',
        'bounce', 'auto-reply', 'autoreply'];
      if (HONEYPOT_PREFIXES.includes(emailPrefix)) {
        log.info('campaign-engine', 'Skip ' + contact.email + ' (adresse generique: ' + emailPrefix + '@)');
        storage.addToBlacklist(contact.email, 'generic_address');
        skipped++;
        continue;
      }

      // B1 FIX : Verifier AVANT le rate-limit si l'email est deja envoye ou rattachable
      const contactEmails = campaignEmails.filter(e => e.to === contact.email);
      const existing = contactEmails.find(e => e.stepNumber === stepNumber && e.status !== 'failed');
      if (existing) continue;

      // B3 FIX : Guard cross-campagne — 1 prospect = 1 campagne active max
      // Si ce prospect a des steps pending dans une AUTRE campagne plus recente, skip ici
      if (stepNumber > 1) {
        const allCampaigns = storage.getAllCampaigns().filter(c => c.status === 'active' && c.id !== campaignId);
        const contactLower = (contact.email || '').toLowerCase();
        let newerCampaignExists = false;
        for (const otherCamp of allCampaigns) {
          const otherList = storage.getContactList(otherCamp.contactListId);
          if (!otherList || !otherList.contacts) continue;
          const inOther = otherList.contacts.some(c => (c.email || '').toLowerCase() === contactLower);
          if (inOther) {
            // Verifier si l'autre campagne est plus recente (createdAt)
            const thisCamp = storage.getCampaign(campaignId);
            const thisCreated = thisCamp && thisCamp.createdAt ? new Date(thisCamp.createdAt).getTime() : 0;
            const otherCreated = otherCamp.createdAt ? new Date(otherCamp.createdAt).getTime() : 0;
            if (otherCreated > thisCreated) {
              newerCampaignExists = true;
              log.info('campaign-engine', 'B3 cross-dedup: ' + contact.email + ' a une campagne plus recente (' + otherCamp.name + ') — skip step ' + stepNumber + ' de ' + campaign.name);
              break;
            }
          }
        }
        if (newerCampaignExists) {
          skipped++;
          continue;
        }
      }

      // Rattacher un email orphelin existant au lieu de re-envoyer (step 1 uniquement)
      if (stepNumber === 1) {
        const allEmails = storage.getAllEmails();
        const orphan = allEmails.find(e =>
          (e.to || '').toLowerCase() === contact.email.toLowerCase() &&
          !e.campaignId &&
          e.status !== 'failed' &&
          e.sentAt && (Date.now() - new Date(e.sentAt).getTime()) < 14 * 24 * 60 * 60 * 1000
        );
        if (orphan) {
          orphan.campaignId = campaignId;
          orphan.stepNumber = 1;
          storage._save();
          log.info('campaign-engine', 'Email orphelin rattache a campagne ' + campaignId + ' pour ' + contact.email + ' (id: ' + orphan.id + ')');
          sent++;
          continue;
        }
      }

      // Rate limiting inter-campagne : max 1 email/24h par contact (cross-campagne) + max 2/72h
      try {
        const allEmailsToContact = storage.getEmailEventsForRecipient(contact.email);
        const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
        const cutoff72h = Date.now() - 72 * 60 * 60 * 1000;
        const recentSent = allEmailsToContact.filter(e => {
          if (e.status === 'failed' || e.status === 'queued') return false;
          const sentTime = e.sentAt ? new Date(e.sentAt).getTime() : 0;
          return sentTime > 0 && sentTime > cutoff72h;
        });
        const sentToday = recentSent.filter(e => {
          const sentTime = e.sentAt ? new Date(e.sentAt).getTime() : 0;
          return sentTime > cutoff24h;
        });
        if (sentToday.length >= 1) {
          log.info('campaign-engine', 'Skip ' + contact.email + ' (rate limit: deja ' + sentToday.length + ' email(s) en 24h)');
          skipped++;
          continue;
        }
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

      // Gate Google Workspace (optionnel, active via REQUIRE_GOOGLE_WORKSPACE=true)
      try {
        const isGws = await _checkGoogleWorkspace(contact.email);
        if (!isGws) {
          const gwsDomain = (contact.email || '').split('@')[1];
          log.info('campaign-engine', 'Skip ' + contact.email + ' (pas Google Workspace: ' + gwsDomain + ')');
          skipped++;
          continue;
        }
      } catch (gwsErr) {
        log.info('campaign-engine', 'Google Workspace check echoue pour ' + contact.email + ' (non bloquant)');
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

        // Stop sur inactivite : engagement-based auto-pause progressif
        // Step 3+ : skip si zero ouverture sur tous les emails precedents
        // NOTE: ~40% des clients bloquent le pixel de tracking, donc
        // on n'utilise PAS l'ouverture comme critere pour step 2
        // NOTE 2: on n'utilise PLUS le "clicked" car nos emails sont en plain text sans liens
        if (stepNumber >= 3) {
          const prevEmails = contactEmails.filter(e => e.stepNumber < stepNumber && e.status !== 'failed');
          const anyOpened = prevEmails.some(e => e.openedAt || e.status === 'opened');
          // Skip si zero ouverture sur 2+ emails (vraiment mort — mais 40% bloquent le pixel)
          if (prevEmails.length >= 2 && !anyOpened) {
            log.info('campaign-engine', 'Skip ' + contact.email + ' (inactif: zero ouverture sur ' + prevEmails.length + ' emails — step ' + stepNumber + ')');
            skippedInactive++;
            skipped++;
            continue;
          }
        }

        // GLOBAL REPLY STOP: si ce prospect a repondu dans N'IMPORTE quelle campagne → stop partout
        try {
          const allEmailsGlobal = storage.getAllEmails();
          const hasRepliedAnywhere = allEmailsGlobal.some(e =>
            (e.to || '').toLowerCase() === contact.email.toLowerCase() &&
            (e.status === 'replied' || e.hasReplied)
          );
          if (hasRepliedAnywhere) {
            log.info('campaign-engine', 'Skip ' + contact.email + ' (a repondu dans une autre campagne — global reply stop)');
            skippedSentiment++;
            skipped++;
            continue;
          }
        } catch (grsErr) {
          log.info('campaign-engine', 'Global reply stop check skip: ' + grsErr.message);
        }

        // Stop si sentiment negatif detecte par inbox-manager (not_interested OU score eleve)
        const sentimentData = storage.getSentiment ? storage.getSentiment(contact.email) : null;
        if (sentimentData) {
          if (sentimentData.sentiment === 'not_interested') {
            log.info('campaign-engine', 'Skip ' + contact.email + ' (sentiment: not_interested — score ' + sentimentData.score + ')');
            skippedSentiment++;
            skipped++;
            continue;
          }
          // Stop aussi si score de desinteressement >= 0.7 meme si le label est "question" ou autre
          if (sentimentData.score >= 0.7 && sentimentData.sentiment !== 'interested') {
            log.info('campaign-engine', 'Skip ' + contact.email + ' (sentiment score eleve: ' + sentimentData.score + ' / ' + sentimentData.sentiment + ')');
            skippedSentiment++;
            skipped++;
            continue;
          }
        }
      }

      // Personnaliser l'email pour ce contact
      let subject = step.subjectTemplate;
      let body = step.bodyTemplate;
      const firstName = contact.firstName || (contact.name || '').split(' ')[0] || '';
      let currentProspectIntel = ''; // Pour A/B variant B context
      let cachedAnalysisForTracking = null; // Pour FIX 9 tracking angle

      if (stepNumber > 1) {
        // === RELANCES : generation individuelle avec brief complet ===
        const prospectIntel = this._getProspectIntel(contact.email);
        currentProspectIntel = prospectIntel || '';

        if (prospectIntel) {
          try {
            const previousEmails = this._getPreviousEmails(campaignId, contact.email, stepNumber);
            const campaignContext = campaign.context || campaign.name || 'prospection B2B';

            // Strategic Analyst : charger depuis cache AP (analyse faite au step 1)
            let enrichedIntel = prospectIntel;
            try {
              let cachedAnalysis = null;
              try {
                const apStorage = require('../autonomous-pilot/storage.js');
                const cachedResearch = apStorage.getProspectResearch ? apStorage.getProspectResearch(contact.email) : null;
                if (cachedResearch && cachedResearch.strategicAnalysis) {
                  cachedAnalysis = cachedResearch.strategicAnalysis;
                  log.info('campaign-engine', 'Strategic analysis CACHE HIT pour FU ' + contact.email);
                }
              } catch (cErr) {}
              // Fallback : generer si pas en cache
              if (!cachedAnalysis) {
                let fuNiche = null;
                const icpLdr = require('../../gateway/icp-loader.js');
                if (icpLdr && icpLdr.matchLeadToNiche) {
                  fuNiche = icpLdr.matchLeadToNiche({ entreprise: contact.company, titre: contact.title });
                }
                cachedAnalysis = await this.claude.analyzeProspect(contact, prospectIntel, fuNiche);
              }
              cachedAnalysisForTracking = cachedAnalysis; // FIX 9 : sauvegarder pour tracking
              if (cachedAnalysis && cachedAnalysis.topAngles && cachedAnalysis.topAngles.length > 0) {
                enrichedIntel = '=== ANALYSE STRATEGIQUE ===\n' +
                  'MEILLEUR ANGLE: ' + cachedAnalysis.topAngles[0].angle + '\n' +
                  'FAIT CLE: ' + (cachedAnalysis.topAngles[0].fact || cachedAnalysis.bestFact || '') + '\n' +
                  'SOCIAL PROOF: ' + (cachedAnalysis.socialProof || '') + '\n' +
                  'TON: ' + (cachedAnalysis.recommendedTone || 'tutoiement') + '\n' +
                  '=== FIN ANALYSE ===\n\n' + prospectIntel;
                log.info('campaign-engine', 'Strategic analysis FU OK pour ' + contact.email);
              }
            } catch (saErr) {
              log.warn('campaign-engine', 'Strategic analysis FU echoue (non bloquant): ' + saErr.message);
            }

            // FIX 6 : Follow-ups conditionnels selon engagement (opened/not opened/hot)
            const allContactEmails = storage.data.emails.filter(function(e) {
              return e.to === contact.email && e.campaignId === campaignId;
            });
            const openedEmails = allContactEmails.filter(function(e) { return e.openedAt; });
            const hotEmails = allContactEmails.filter(function(e) { return (e.openCount || 0) >= 3; });

            let engagementHint = '';
            if (hotEmails.length > 0) {
              engagementHint = '\n\n=== CONTEXTE ENGAGEMENT : HOT LEAD ===\n' +
                'Le prospect a ouvert tes emails ' + hotEmails[0].openCount + ' fois — c\'est un signal d\'interet FORT.\n' +
                'Sois direct et propose une action concrete (call rapide, demo). Urgence subtile, pas de pression.\n' +
                'Pose UNE question binaire facile a repondre (oui/non).\n';
            } else if (openedEmails.length > 0) {
              engagementHint = '\n\n=== CONTEXTE ENGAGEMENT : A OUVERT MAIS PAS REPONDU ===\n' +
                'Le prospect a lu ton email mais n\'a pas repondu. Il est interesse mais pas convaincu.\n' +
                'Change d\'angle : nouveau social proof, nouvelle question business, nouvel element specifique.\n' +
                'Garde le meme sujet/thread pour rester dans la conversation.\n';
            } else {
              engagementHint = '\n\n=== CONTEXTE ENGAGEMENT : N\'A PAS OUVERT ===\n' +
                'Le prospect n\'a PAS ouvert tes emails precedents. Le sujet ne l\'a pas accroche.\n' +
                'IMPORTANT: Change COMPLETEMENT le sujet (nouveau thread, pas de Re:).\n' +
                'Ecris plus court (25-40 mots MAX). Accroche completement differente.\n' +
                'Essaie un angle personnel (mention directe de son poste/son entreprise dans le sujet).\n';
            }

            const personalized = await this.claude.generatePersonalizedFollowUp(
              contact,
              stepNumber,
              campaign.steps.length,
              enrichedIntel + engagementHint,
              previousEmails,
              campaignContext
            );

            if (personalized && personalized.subject && personalized.body && !personalized.skip) {
              subject = personalized.subject;
              body = personalized.body;
              log.info('campaign-engine', 'Relance individualisee generee pour ' + contact.email + ' (step ' + stepNumber + ')');
              // Check specificite follow-up — block si generique (meme exigence que step 1)
              if (prospectIntel) {
                const specFU = _checkEmailSpecificity(body, subject, prospectIntel);
                if (specFU.level === 'generic') {
                  log.warn('campaign-engine', 'Relance step ' + stepNumber + ' GENERIQUE pour ' + contact.email + ' — retry');
                  // Retry une fois avec instruction critique
                  try {
                    const retryFU = await this.claude.generatePersonalizedFollowUp(
                      contact, stepNumber, campaign.steps.length,
                      prospectIntel + '\n\nATTENTION CRITIQUE: l\'email precedent etait GENERIQUE. Tu DOIS citer un fait SPECIFIQUE du prospect (chiffre, client, techno, evenement).',
                      previousEmails, campaignContext
                    );
                    if (retryFU && retryFU.subject && retryFU.body && !retryFU.skip) {
                      const spec2 = _checkEmailSpecificity(retryFU.body, retryFU.subject, prospectIntel);
                      if (spec2.level !== 'generic') {
                        subject = retryFU.subject;
                        body = retryFU.body;
                        log.info('campaign-engine', 'Relance step ' + stepNumber + ' retry OK pour ' + contact.email + ' — ' + spec2.reason);
                      } else if (contact.company || contact.title || contact.email) {
                        // Follow-ups tolerent le generique si on a au moins un identifiant — un FU court generique > pas de FU du tout
                        subject = retryFU.subject;
                        body = retryFU.body;
                        log.info('campaign-engine', 'Relance step ' + stepNumber + ' generique acceptee pour ' + contact.email + ' (follow-up > silence)');
                      } else {
                        log.warn('campaign-engine', 'Relance step ' + stepNumber + ' TOUJOURS generique pour ' + contact.email + ' — skip');
                        skipped++;
                        continue;
                      }
                    }
                  } catch (retryErr) {
                    log.warn('campaign-engine', 'Relance step ' + stepNumber + ' retry echoue: ' + retryErr.message);
                  }
                }
              }
            } else {
              // Claude a skip (donnees insuffisantes) — essayer relance contextuelle basee sur email precedent
              const prevEmails = this._getPreviousEmails(campaignId, contact.email, stepNumber);
              if (prevEmails.length > 0 && this.claude.personalizeEmail) {
                try {
                  const lastEmail = prevEmails[prevEmails.length - 1];
                  const simpleContext = 'Email precedent envoye: "' + (lastEmail.subject || '') + '". Ecris une relance courte (30-50 mots) qui rebondit sur cet email, avec une question simple.';
                  const simple = await this.claude.generatePersonalizedFollowUp(
                    contact, stepNumber, campaign.steps.length,
                    simpleContext, prevEmails, campaign.context || campaign.name || 'prospection B2B'
                  );
                  if (simple && simple.subject && simple.body && !simple.skip) {
                    subject = simple.subject;
                    body = simple.body;
                    log.info('campaign-engine', 'Relance contextuelle (basee sur email precedent) pour ' + contact.email);
                  } else {
                    log.info('campaign-engine', 'Step ' + stepNumber + ' skip pour ' + contact.email + ' (relance contextuelle aussi echouee): ' + (personalized && personalized.reason || 'generation incomplete'));
                    skipped++;
                    continue;
                  }
                } catch (simpleErr) {
                  log.info('campaign-engine', 'Step ' + stepNumber + ' skip pour ' + contact.email + ' (erreur relance contextuelle): ' + simpleErr.message);
                  skipped++;
                  continue;
                }
              } else {
                // Aucun email precedent et Claude a skip — skip plutot que template generique
                log.info('campaign-engine', 'Step ' + stepNumber + ' skip pour ' + contact.email + ': ' + (personalized && personalized.reason || 'generation incomplete'));
                skipped++;
                continue;
              }
            }
          } catch (genErr) {
            // Erreur technique Claude — skip plutot que template generique
            log.warn('campaign-engine', 'Step ' + stepNumber + ' skip pour ' + contact.email + ' (erreur Claude): ' + genErr.message);
            skipped++;
            continue;
          }
        } else {
          // Pas de brief : essayer personalizeEmail avec le contexte de l'email precedent
          const prevEmails = this._getPreviousEmails(campaignId, contact.email, stepNumber);
          if (prevEmails.length > 0 && this.claude.generatePersonalizedFollowUp) {
            try {
              const lastEmail = prevEmails[prevEmails.length - 1];
              const simpleContext = 'Email precedent envoye: "' + (lastEmail.subject || '') + '" — Corps: ' + (lastEmail.body || '').substring(0, 200);
              const simple = await this.claude.generatePersonalizedFollowUp(
                contact, stepNumber, campaign.steps.length,
                simpleContext, prevEmails, campaign.context || campaign.name || 'prospection B2B'
              );
              if (simple && simple.subject && simple.body && !simple.skip) {
                subject = simple.subject;
                body = simple.body;
                log.info('campaign-engine', 'Relance sans brief (basee sur email precedent) pour ' + contact.email);
              } else {
                log.info('campaign-engine', 'Step ' + stepNumber + ' skip pour ' + contact.email + ' (pas de brief, relance echouee)');
                skipped++;
                continue;
              }
            } catch (personalizeErr) {
              log.info('campaign-engine', 'Step ' + stepNumber + ' skip pour ' + contact.email + ' (erreur personalizeEmail): ' + personalizeErr.message);
              skipped++;
              continue;
            }
          } else {
            // Zero contexte — skip, ne pas envoyer de template generique
            log.info('campaign-engine', 'Step ' + stepNumber + ' skip pour ' + contact.email + ' (zero contexte, pas d\'email precedent)');
            skipped++;
            continue;
          }
        }
      } else {
        // === STEP 1 : brief prospect si dispo, sinon template + personalizeEmail ===
        const step1Intel = this._getProspectIntel(contact.email);
        currentProspectIntel = step1Intel || '';
        if (step1Intel && this.claude.generateSingleEmail) {
          try {
            const campaignCtx = campaign.context || campaign.name || 'prospection B2B';
            let enrichedContext = step1Intel + '\n\nCONTEXTE CAMPAGNE: ' + campaignCtx;

            // Rotation d'angles : empecher les sujets repetitifs entre prospects
            try {
              let apStorage = null;
              try { apStorage = require('../autonomous-pilot/storage.js'); }
              catch (e) { try { apStorage = require('/app/skills/autonomous-pilot/storage.js'); } catch (e2) {} }
              if (apStorage && apStorage.getRecentAnglesForIndustry) {
                const industry = contact.industry || contact.company || '';
                if (industry) {
                  const recentAngles = apStorage.getRecentAnglesForIndustry(industry, 10);
                  if (recentAngles.length > 0) {
                    enrichedContext += '\n\n=== ANGLES DEJA UTILISES (NE PAS REPETER — trouve un angle DIFFERENT) ===\n' + recentAngles.map(a => '- "' + a + '"').join('\n');
                  }
                }
              }
            } catch (e) { log.warn('campaign-engine', 'Enrichissement angles echoue: ' + e.message); }
            const generated = await this.claude.generateSingleEmail(contact, enrichedContext);
            if (generated && generated.subject && generated.body) {
              subject = generated.subject;
              body = generated.body;
              // Gate specificite : l'email doit contenir au moins 1 fait du brief
              const spec = _checkEmailSpecificity(body, subject, step1Intel);
              if (spec.level === 'generic') {
                log.warn('campaign-engine', 'Step 1 GENERIQUE pour ' + contact.email + ' — retry avec instruction critique');
                try {
                  const retryCtx = enrichedContext + '\n\nATTENTION CRITIQUE: l\'email precedent etait TROP GENERIQUE. Tu DOIS citer un FAIT SPECIFIQUE tire des donnees ci-dessus : un client, un chiffre, une technologie, un evenement recent, un service precis. Si aucun fait specifique n\'est disponible, retourne {"skip": true, "reason": "donnees insuffisantes pour email specifique"}.';
                  const retry = await this.claude.generateSingleEmail(contact, retryCtx);
                  if (retry && retry.subject && retry.body && !retry.skip) {
                    const spec2 = _checkEmailSpecificity(retry.body, retry.subject, step1Intel);
                    if (spec2.level !== 'generic') {
                      subject = retry.subject;
                      body = retry.body;
                      log.info('campaign-engine', 'Step 1 retry OK pour ' + contact.email + ' — ' + spec2.reason);
                    } else if (contact.company && contact.title) {
                      // FIX: Envoyer quand meme si on a company+title (pas assez de donnees web mais contact qualifie)
                      subject = retry.subject;
                      body = retry.body;
                      log.info('campaign-engine', 'Step 1 generique accepte pour ' + contact.email + ' (company+title disponibles, donnees web insuffisantes)');
                    } else {
                      log.warn('campaign-engine', 'Step 1 TOUJOURS generique apres retry pour ' + contact.email + ' — skip');
                      skipped++;
                      continue;
                    }
                  } else {
                    log.info('campaign-engine', 'Step 1 skipped (donnees insuffisantes) pour ' + contact.email);
                    skipped++;
                    continue;
                  }
                } catch (retryErr) {
                  log.warn('campaign-engine', 'Step 1 retry echoue pour ' + contact.email + ': ' + retryErr.message + ' — skip');
                  skipped++;
                  continue;
                }
              }
              log.info('campaign-engine', 'Step 1 personnalise avec brief pour ' + contact.email + ' (' + spec.reason + ')');
              // PAS de double personnalisation : generateSingleEmail avec brief = deja hyper-personnalise
            } else if (generated && generated.skip) {
              log.info('campaign-engine', 'Step 1 skipped par Claude pour ' + contact.email + ': ' + (generated.reason || 'donnees insuffisantes'));
              skipped++;
              continue;
            } else {
              // Fallback template + personalizeEmail (pas de brief exploitable)
              subject = this._applyTemplateVars(subject, contact, firstName);
              body = this._applyTemplateVars(body, contact, firstName);
              if (contact.company || contact.title || contact.industry) {
                try {
                  const personalized = await this.claude.personalizeEmail(subject, body, contact);
                  if (personalized && personalized.subject && personalized.body) {
                    subject = personalized.subject;
                    body = personalized.body;
                  }
                } catch (personalizeErr) {
                  log.info('campaign-engine', 'personalizeEmail fallback echoue: ' + personalizeErr.message);
                }
              }
            }
          } catch (genErr) {
            log.info('campaign-engine', 'Step 1 brief echoue pour ' + contact.email + ', fallback template: ' + genErr.message);
            subject = this._applyTemplateVars(subject, contact, firstName);
            body = this._applyTemplateVars(body, contact, firstName);
          }
        } else if (this.claude.generateSingleEmail && (contact.company || contact.title)) {
          // Pas de brief riche : generateSingleEmail avec donnees minimales du contact
          try {
            const minParts = [];
            if (contact.company) minParts.push('ENTREPRISE: ' + contact.company);
            if (contact.title) minParts.push('POSTE: ' + contact.title);
            if (contact.industry) minParts.push('INDUSTRIE: ' + contact.industry);
            if (contact.city) minParts.push('VILLE: ' + contact.city);
            if (contact.country) minParts.push('PAYS: ' + contact.country);
            const campaignCtx = campaign.context || campaign.name || 'prospection B2B';
            const minContext = minParts.join('\n') + '\n\nCONTEXTE CAMPAGNE: ' + campaignCtx;
            const generated = await this.claude.generateSingleEmail(contact, minContext);
            if (generated && generated.subject && generated.body && !generated.skip) {
              subject = generated.subject;
              body = generated.body;
              log.info('campaign-engine', 'Step 1 genere (donnees minimales) pour ' + contact.email);
              // Check specificite sur donnees minimales
              const specMin = _checkEmailSpecificity(body, subject, minContext);
              if (specMin.level === 'generic' && !(contact.company && contact.title)) {
                log.warn('campaign-engine', 'Step 1 minimal GENERIQUE pour ' + contact.email + ' — skip (pas company+title)');
                skipped++;
                continue;
              }
            } else {
              subject = this._applyTemplateVars(subject, contact, firstName);
              body = this._applyTemplateVars(body, contact, firstName);
            }
          } catch (genErr) {
            log.info('campaign-engine', 'generateSingleEmail minimal echoue: ' + genErr.message);
            subject = this._applyTemplateVars(subject, contact, firstName);
            body = this._applyTemplateVars(body, contact, firstName);
          }
        } else {
          // Dernier fallback : template classique
          subject = this._applyTemplateVars(subject, contact, firstName);
          body = this._applyTemplateVars(body, contact, firstName);
        }
      }

      // A/B/C testing avance — hash deterministe, auto-kill perdants
      const ABTesting = require('./ab-testing.js');
      const abTester = new ABTesting(storage);
      const abConfig = campaign.abConfig || { numVariants: 3, metric: 'open_rate', disabledVariants: [] };
      let abVariant = abTester.assignVariant(contact.email, campaignId, abConfig.numVariants);

      // Verifier que le variant n'est pas desactive (auto-kill)
      if (abConfig.disabledVariants && abConfig.disabledVariants.includes(abVariant)) {
        abVariant = 'A'; // Fallback sur le leader
      }

      // A/B variants : B = body+sujet alternatif (nouvel angle), C = sujet alternatif + body original
      if (abVariant === 'B') {
        try {
          const prospectCtx = currentProspectIntel || '';
          const bodyVariant = await this.claude.generateBodyVariant(body, subject, prospectCtx, contact);
          if (bodyVariant && bodyVariant.body && bodyVariant.subject) {
            subject = bodyVariant.subject;
            body = bodyVariant.body;
          } else {
            // Fallback : au moins varier le sujet
            const variantSubject = await this.claude.generateSubjectVariant(subject);
            if (variantSubject && variantSubject.length > 3) subject = variantSubject;
          }
        } catch (abErr) {
          log.info('campaign-engine', 'A/B variant B generation echouee: ' + abErr.message);
          abVariant = 'A';
        }
      } else if (abVariant === 'C') {
        try {
          const variantSubject = await this.claude.generateSubjectVariant(subject);
          if (variantSubject && variantSubject.length > 3) {
            subject = variantSubject;
          }
        } catch (abErr) {
          log.info('campaign-engine', 'A/B variant C generation echouee: ' + abErr.message);
          abVariant = 'A';
        }
      }

      // GATE ANTI-CONTAMINATION : verifier que l'email ne contient pas les donnees d'un autre prospect
      // Empeche d'envoyer "Neha — AeroConsultant" a herve@urbanhello.com
      {
        const contactFirstName = (firstName || '').toLowerCase().trim();
        let contaminated = false;
        let contaminationSource = '';

        // Check 1 : contre le sampleContact stocke sur la campagne
        if (campaign._sampleContact && campaign._sampleContact.email &&
            campaign._sampleContact.email.toLowerCase() !== contact.email.toLowerCase()) {
          const sampleName = (campaign._sampleContact.firstName || '').toLowerCase().trim();
          const sampleCompany = (campaign._sampleContact.company || '').toLowerCase().trim();
          const subjectLower = (subject || '').toLowerCase();
          const bodyLower = (body || '').toLowerCase();

          if (sampleName && sampleName.length >= 3 && sampleName !== contactFirstName) {
            // Chercher le nom du sampleContact comme mot entier dans subject ou body
            const nameRegex = new RegExp('\\b' + sampleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
            if (nameRegex.test(subject) || nameRegex.test(body)) {
              contaminated = true;
              contaminationSource = 'prenom "' + sampleName + '" de ' + campaign._sampleContact.email;
            }
          }
          if (!contaminated && sampleCompany && sampleCompany.length >= 4) {
            const companyRegex = new RegExp('\\b' + sampleCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
            if (companyRegex.test(body)) {
              contaminated = true;
              contaminationSource = 'entreprise "' + sampleCompany + '" de ' + campaign._sampleContact.email;
            }
          }
        }

        // Check 2 : contre tous les autres contacts de la campagne (pour les campagnes sans _sampleContact)
        if (!contaminated && !campaign._sampleContact && list.contacts.length > 1) {
          const subjectLower = (subject || '').toLowerCase();
          const bodyLower = (body || '').toLowerCase();
          for (const otherContact of list.contacts) {
            if ((otherContact.email || '').toLowerCase() === contact.email.toLowerCase()) continue;
            const otherName = (otherContact.firstName || (otherContact.name || '').split(' ')[0] || '').toLowerCase().trim();
            if (otherName && otherName.length >= 3 && otherName !== contactFirstName) {
              const nameRegex = new RegExp('\\b' + otherName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
              if (nameRegex.test(subject) || nameRegex.test(body)) {
                contaminated = true;
                contaminationSource = 'prenom "' + otherName + '" de ' + otherContact.email;
                break;
              }
            }
          }
        }

        if (contaminated) {
          log.warn('campaign-engine', 'CONTAMINATION GATE: email pour ' + contact.email + ' contient ' + contaminationSource + ' — skip');
          skipped++;
          continue;
        }
      }

      // Quality gate post-generation — verifier avant envoi
      const qg = _emailPassesQualityGate(subject, body);
      if (!qg.pass) {
        log.warn('campaign-engine', 'Quality gate FAIL pour ' + contact.email + ': ' + qg.reason + ' — skip envoi');
        skipped++;
        continue;
      }
      // Gate sujet : patterns interdits dans l'objet
      const sg = _subjectPassesGate(subject);
      if (!sg.pass) {
        log.warn('campaign-engine', 'Subject gate FAIL pour ' + contact.email + ': ' + sg.reason + ' — skip envoi');
        skipped++;
        continue;
      }

      // Validation programmatique : word count + forbidden words (word boundary)
      // Follow-ups (step 2+) ont un seuil plus bas (15 mots) car breakups/relances sont naturellement courts
      const fuMinWords = stepNumber >= 2 ? 15 : 30;
      const validationBase = validateEmailOutput(subject, body, { forbiddenWords: [], minWords: fuMinWords });
      if (!validationBase.pass) {
        log.warn('campaign-engine', 'Validation base FAIL pour ' + contact.email + ': ' + validationBase.reasons.join(', ') + ' — skip');
        skipped++;
        continue;
      }
      // Forbidden words depuis AP storage (non bloquant si indisponible)
      try {
        const apStorage = require('../autonomous-pilot/storage.js');
        const apConfig = apStorage.getConfig ? apStorage.getConfig() : {};
        const ep = apConfig.emailPreferences || {};
        if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
          const validationFw = validateEmailOutput(subject, body, { forbiddenWords: ep.forbiddenWords });
          if (!validationFw.pass) {
            log.warn('campaign-engine', 'Forbidden words FAIL pour ' + contact.email + ': ' + validationFw.reasons.join(', ') + ' — skip');
            skipped++;
            continue;
          }
        }
      } catch (valErr) { /* AP storage indisponible — word count deja verifie ci-dessus */ }

      // Scoring Lavender /100 sur les follow-ups (seuil 65, plus tolerant que step 1)
      try {
        const ClaudeWriter = require('./claude-email-writer.js');
        const scorer = new ClaudeWriter();
        const lavFU = scorer._lavenderScore(subject, body, contact);
        if (lavFU.block) {
          log.warn('campaign-engine', 'Lavender BLOCK FU pour ' + contact.email + ': ' + lavFU.reason + ' — skip');
          skipped++;
          continue;
        }
        log.info('campaign-engine', 'Lavender FU ' + lavFU.score + '/100 (grade ' + lavFU.grade + ') pour ' + contact.email + ' step ' + stepNumber);
        if (lavFU.score < 55) {
          log.warn('campaign-engine', 'Lavender FU trop bas ' + lavFU.score + '/100 pour ' + contact.email + ' — skip');
          skipped++;
          continue;
        }
      } catch (lavErr) { /* non bloquant si scorer indisponible */ }

      // Ajouter lien booking Google Calendar dans les relances (step 3+)
      // Steps 1-2 = conversation pure, pas de lien. Step 3+ = CTA direct avec calendrier.
      if (stepNumber >= 3) {
        try {
          const GoogleCalendarClient = require('../meeting-scheduler/google-calendar-client.js');
          const gcal = new GoogleCalendarClient();
          const bookingUrl = await gcal.getBookingLink(null, contact.email, firstName);
          if (bookingUrl) {
            const bookingDomain = (process.env.GOOGLE_BOOKING_URL || '').split('?')[0] || 'calendar.app.google';
            if (!body.includes(bookingDomain) && !body.includes('calendar.app.google') && !body.includes('calendar.google.com')) {
              body += '\n\n' + bookingUrl;
            }
          }
        } catch (calErr) {
          // Google Calendar non dispo — pas bloquant, on envoie sans lien
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
        replyTo: process.env.REPLY_TO_EMAIL || process.env.SENDER_EMAIL,
        fromName: process.env.SENDER_NAME || 'Alexis',
        trackingId: trackingId,
        campaignId: campaignId,
        tags: [
          { name: 'campaign_id', value: campaignId },
          { name: 'step', value: String(stepNumber) }
        ]
      };
      if (stepNumber > 0) {
        // Si le prospect n'a jamais ouvert → nouveau thread (pas de Re:) pour changer le sujet
        const recipientEmails = storage.data.emails.filter(function(e) { return e.to === contact.email && e.campaignId === campaignId; });
        const hasOpened = recipientEmails.some(function(e) { return e.openedAt; });
        if (hasOpened) {
          const prevMessageId = storage.getMessageIdForRecipient(contact.email);
          if (prevMessageId) {
            sendOpts.inReplyTo = prevMessageId;
            sendOpts.references = prevMessageId;
          }
        }
        // Si !hasOpened → pas de inReplyTo → nouveau thread avec nouveau sujet
      }

      const result = await this.resend.sendEmail(contact.email, subject, body, sendOpts);

      // Calculer le score de qualite email (Lavender /100)
      let emailQualityScore = 0;
      let lavenderDetails = null;
      try {
        const ClaudeWriter = require('./claude-email-writer.js');
        const scorer = new ClaudeWriter();
        const lav = scorer._lavenderScore(subject, body, contact);
        emailQualityScore = lav.score || 0;
        lavenderDetails = lav.details || null;
      } catch (scoreErr) { /* non bloquant */ }

      const emailRecord = {
        chatId: campaign.chatId,
        campaignId: campaignId,
        stepNumber: stepNumber,
        to: contact.email,
        subject: subject,
        body: body,
        resendId: result.success ? result.id : null,
        messageId: result.success ? (result.messageId || null) : null,
        senderDomain: result.senderDomain || null,
        trackingId: trackingId,
        status: result.success ? 'sent' : 'failed',
        abVariant: abVariant,
        industry: contact.industry || '',
        company: contact.company || '',
        contactName: contact.name || contact.firstName || '',
        angleType: (cachedAnalysisForTracking && cachedAnalysisForTracking.topAngles && cachedAnalysisForTracking.topAngles[0]) ? cachedAnalysisForTracking.topAngles[0].angle : '',
        niche: contact.niche || contact._nicheSlug || contact.industry || '',
        score: emailQualityScore,
        sendHourParis: new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false })
      };
      storage.addEmail(emailRecord);

      if (result.success) {
        sent++;
        batchSentCount++;
        // FIX 3 : Tracker envoi warmup + date du premier envoi
        storage.setFirstSendDate();
        storage.incrementTodaySendCount();

        // Niche tracking pour suivi performance par industrie
        if (contact.industry) {
          try {
            const apStorage = require('../autonomous-pilot/storage.js');
            if (apStorage.trackNicheEvent) apStorage.trackNicheEvent(contact.industry, 'sent');
          } catch (e) { log.warn('campaign-engine', 'Niche tracking echoue: ' + e.message); }
        }

        // Push auto HubSpot : creer contact + deal au premier email
        if (stepNumber === 1) {
          try {
            const hubspot = _getHubSpotClient();
            if (hubspot) {
              let hsContact = await hubspot.findContactByEmail(contact.email);
              if (!hsContact) {
                hsContact = await hubspot.createContact({
                  firstname: contact.firstName || '',
                  lastname: contact.lastName || '',
                  email: contact.email,
                  jobtitle: contact.title || '',
                  company: contact.company || '',
                  city: contact.city || '',
                  lifecyclestage: 'lead'
                });
                log.info('campaign-engine', 'HubSpot contact cree: ' + contact.email);
              }
              if (hsContact && hsContact.id) {
                const dealName = (contact.company || 'Lead') + ' — ' + (campaign.name || 'Campagne');
                const deal = await hubspot.createDeal({
                  dealname: dealName,
                  dealstage: 'appointmentscheduled'
                });
                if (deal && deal.id) {
                  await hubspot.associateDealToContact(deal.id, hsContact.id);
                  log.info('campaign-engine', 'HubSpot deal cree + associe: ' + contact.email);
                }
              }
              const ffStorage = _getFlowFastStorage();
              if (ffStorage && ffStorage.setLeadPushed) {
                ffStorage.setLeadPushed(contact.email);
              }
            }
          } catch (hsErr) {
            log.warn('campaign-engine', 'HubSpot auto-push failed: ' + contact.email + ' — ' + hsErr.message);
          }
        }
      } else {
        errors++;
        log.error('campaign-engine', 'Erreur envoi a ' + contact.email + ':', result.error);

        // Circuit breaker : si 5+ echecs consecutifs, arreter le batch (probleme SMTP/auth probable)
        const recentEmails = storage.getEmailsByCampaign(campaignId).slice(-7);
        const recentFails = recentEmails.filter(e => e.status === 'failed').length;
        if (recentFails >= 5) {
          log.warn('campaign-engine', 'CIRCUIT BREAKER: 5+ echecs consecutifs — batch interrompu (verifier auth SMTP)');
          break;
        }
      }

      // Rate limiting : 200ms entre chaque envoi
      await new Promise(r => setTimeout(r, 200));
    }

    // Mettre a jour le step
    step.sentCount = (step.sentCount || 0) + sent;
    step.errorCount = (step.errorCount || 0) + errors;

    if (sent > 0 || (sent === 0 && skipped === 0 && errors === 0)) {
      // Step reellement traite (emails envoyes ou aucun contact eligible)
      step.status = 'completed';
      step.sentAt = new Date().toISOString();
    } else if ((step._retryCount || 0) >= ((list.contacts || []).length <= 1 ? 5 : 15)) {
      // Max retries atteint — 5 pour mono-contact, 15 pour multi-contact
      // Ne force complete QUE si tous les skips sont des inactifs (vraiment morts)
      const allInactive = skippedInactive >= skipped && skipped > 0;
      step.status = 'completed';
      step.sentAt = new Date().toISOString();
      step._forceCompleted = true;
      const contactList = list.contacts || [];
      const contactNames = contactList.map(c => c.email || c.name || '?').slice(0, 5).join(', ');
      log.warn('campaign-engine', 'Step ' + stepNumber + ' FORCE completed apres ' + step._retryCount + ' retries sans envoi (' + (allInactive ? 'tous inactifs' : 'generation echouee') + ', contacts: ' + contactNames + ')');
      try {
        const chatId = process.env.ADMIN_CHAT_ID || '1409505520';
        const TelegramBot = require('node-telegram-bot-api');
        const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
        bot.sendMessage(chatId, '⚠️ Relance step ' + stepNumber + ' echouee apres ' + step._retryCount + ' tentatives pour : ' + contactNames + '\n' + (allInactive ? 'Tous les contacts sont inactifs (0 ouverture).' : 'La qualite etait insuffisante.'));
      } catch (notifErr) {}
    } else {
      // Aucun envoi mais des contacts restent — remettre en pending pour retry
      step.status = 'pending';
      step._retryCount = (step._retryCount || 0) + 1;
      const maxRetries = (list.contacts || []).length <= 1 ? 5 : 15;
      // Reporter a +2h pour laisser le temps entre les tentatives
      step.scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      log.info('campaign-engine', 'Step ' + stepNumber + ' remis en pending (retry ' + step._retryCount + '/' + maxRetries + ', sent=' + sent + ', skipped=' + skipped + ', errors=' + errors + ') — prochain essai dans 2h');
    }

    // Avancer le currentStep seulement si step completed
    const nextStep = step.status === 'completed' ? stepNumber + 1 : stepNumber;
    const updates = { steps: campaign.steps, currentStep: nextStep };

    // Si c'etait le dernier step, marquer comme complete
    if (nextStep > campaign.steps.length) {
      updates.status = 'completed';
      updates.completedAt = new Date().toISOString();
    }

    // A/B auto-kill : desactiver les variants sous-performants apres le step
    try {
      const ABTestingPostStep = require('./ab-testing.js');
      const abTesterPost = new ABTestingPostStep(storage);
      const abConfigPost = campaign.abConfig || { numVariants: 3, metric: 'open_rate', disabledVariants: [] };
      if (abConfigPost.numVariants > 1) {
        const disabled = abTesterPost.getDisabledVariants(campaignId, abConfigPost.metric);
        for (const d of disabled) {
          if (!abConfigPost.disabledVariants) abConfigPost.disabledVariants = [];
          if (!abConfigPost.disabledVariants.includes(d.variant)) {
            abConfigPost.disabledVariants.push(d.variant);
            log.info('campaign-engine', 'A/B AUTO-KILL variant ' + d.variant + ' (rate: ' + d.rate + '% vs leader ' + d.leaderVariant + ': ' + d.leaderRate + '%, p=' + d.pValue + ')');
          }
        }
        if (disabled.length > 0) updates.abConfig = abConfigPost;
      }
    } catch (abPostErr) {
      log.info('campaign-engine', 'A/B auto-kill check skip: ' + abPostErr.message);
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
    if (this.schedulerInterval) return; // Guard anti-double start
    // Auto-repair: remettre en pending les steps force-completed avec 0 envois
    this._repairForceCompletedSteps();
    // B2 FIX: reparer les campagnes phantom (step 1 pending sans templates)
    this._repairPhantomCampaigns();
    // B3 FIX: dedupliquer les prospects dans plusieurs campagnes actives
    this._deduplicateCrossCampaigns();
    // Auto-repair: calculer scheduledAt pour les steps qui en manquent (legacy auto-campaigns)
    this._repairMissingScheduledAt();
    log.info('campaign-engine', 'Scheduler demarre (intervalle: 60s)');
    this.schedulerInterval = setInterval(() => this._processScheduled(), 60 * 1000);
    // Premier check immediat
    this._processScheduled();
  }

  _repairForceCompletedSteps() {
    const campaigns = storage.getAllCampaigns().filter(c => c.status === 'active');
    let repaired = 0;
    for (const campaign of campaigns) {
      let modified = false;
      for (const step of campaign.steps) {
        // Remettre en pending les steps completed avec 0 envois effectifs
        if (step.status === 'completed' && (step.sentCount || 0) === 0 && (step._forceCompleted || (step._retryCount || 0) > 0)) {
          step.status = 'pending';
          step._retryCount = 0;
          step._forceCompleted = false;
          step._adaptiveChecked = false;
          // Reporter a +2h pour laisser les rate-limits expirer
          step.scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
          modified = true;
          repaired++;
          log.info('campaign-engine', 'Repair: step ' + step.stepNumber + ' de ' + campaign.name + ' remis en pending (etait force-completed avec 0 envois)');
        }
      }
      if (modified) {
        // Recalculer currentStep (= premier step pending)
        const firstPending = campaign.steps.find(s => s.status === 'pending');
        const newCurrentStep = firstPending ? firstPending.stepNumber : campaign.steps.length + 1;
        storage.updateCampaign(campaign.id, { steps: campaign.steps, currentStep: newCurrentStep });
      }
    }
    if (repaired > 0) {
      log.info('campaign-engine', 'Auto-repair: ' + repaired + ' step(s) remis en pending');
    }
  }

  // B2 FIX: reparer les campagnes phantom (step 1 pending sans templates ou step 1 completed
  // mais avec un email orphelin non rattache)
  _repairPhantomCampaigns() {
    const campaigns = storage.getAllCampaigns().filter(c => c.status === 'active');
    let repaired = 0;
    let cancelled = 0;

    for (const campaign of campaigns) {
      if (!campaign.steps || campaign.steps.length === 0) continue;
      const step1 = campaign.steps[0];

      // Cas 1: step 1 pending sans templates → chercher un orphelin ou annuler
      if (step1.status === 'pending' && !step1.subjectTemplate) {
        const list = storage.getContactList(campaign.contactListId);
        if (!list || list.contacts.length === 0) {
          // Pas de contacts → annuler la campagne
          storage.updateCampaign(campaign.id, { status: 'completed', _repairNote: 'phantom: no contacts' });
          cancelled++;
          log.info('campaign-engine', 'Repair phantom: campagne "' + campaign.name + '" annulee (pas de contacts)');
          continue;
        }

        const contact = list.contacts[0];
        // Chercher un email orphelin pour ce contact
        const allEmails = storage.getAllEmails();
        const orphan = allEmails.find(e =>
          (e.to || '').toLowerCase() === (contact.email || '').toLowerCase() &&
          !e.campaignId &&
          e.status !== 'failed' &&
          e.sentAt
        );
        if (orphan) {
          // Rattacher l'orphelin comme step 1
          orphan.campaignId = campaign.id;
          orphan.stepNumber = 1;
          step1.status = 'completed';
          step1.completedAt = orphan.sentAt;
          step1.sentCount = 1;
          step1.subjectTemplate = orphan.subject || '';
          step1.bodyTemplate = orphan.body || '';
          storage._save();
          storage.updateCampaign(campaign.id, { steps: campaign.steps });
          repaired++;
          log.info('campaign-engine', 'Repair phantom: "' + campaign.name + '" step 1 rattache via orphelin (email ' + orphan.id + ')');
        } else {
          // Pas d'orphelin → annuler la campagne (email jamais envoye)
          storage.updateCampaign(campaign.id, { status: 'completed', _repairNote: 'phantom: no template no orphan' });
          cancelled++;
          log.info('campaign-engine', 'Repair phantom: campagne "' + campaign.name + '" annulee (pas de template ni orphelin)');
        }
      }

      // Cas 2: step 1 pending avec sentAt mais sentCount=0 → l'email a ete envoye, marquer completed
      if (step1.status === 'pending' && step1.sentAt && (step1.sentCount || 0) === 0) {
        step1.status = 'completed';
        step1.completedAt = step1.sentAt;
        step1.sentCount = 1;
        storage.updateCampaign(campaign.id, { steps: campaign.steps });
        repaired++;
        log.info('campaign-engine', 'Repair phantom: "' + campaign.name + '" step 1 marque completed (avait sentAt)');
      }
    }

    if (repaired > 0 || cancelled > 0) {
      log.info('campaign-engine', 'Repair phantom: ' + repaired + ' repare(s), ' + cancelled + ' annule(s)');
    }
  }

  // B3 FIX: dedupliquer les prospects qui sont dans plusieurs campagnes actives
  // Garde la campagne la plus recente, annule les pending steps des anciennes
  _deduplicateCrossCampaigns() {
    const campaigns = storage.getAllCampaigns().filter(c => c.status === 'active');
    const prospectCampaigns = {}; // email -> [{campaignId, createdAt}]
    let deduped = 0;

    for (const campaign of campaigns) {
      const list = storage.getContactList(campaign.contactListId);
      if (!list || !list.contacts) continue;
      for (const contact of list.contacts) {
        const email = (contact.email || '').toLowerCase();
        if (!email) continue;
        if (!prospectCampaigns[email]) prospectCampaigns[email] = [];
        prospectCampaigns[email].push({
          campaignId: campaign.id,
          name: campaign.name,
          createdAt: campaign.createdAt ? new Date(campaign.createdAt).getTime() : 0
        });
      }
    }

    // Pour chaque prospect dans 2+ campagnes, annuler les pending steps des plus anciennes
    for (const email in prospectCampaigns) {
      const entries = prospectCampaigns[email];
      if (entries.length <= 1) continue;

      // Trier par date de creation (plus recente en premier)
      entries.sort(function(a, b) { return b.createdAt - a.createdAt; });
      const keepCampaignId = entries[0].campaignId;

      for (let i = 1; i < entries.length; i++) {
        const oldCamp = storage.getCampaign(entries[i].campaignId);
        if (!oldCamp || !oldCamp.steps) continue;
        let modified = false;
        for (const step of oldCamp.steps) {
          if (step.status === 'pending') {
            step.status = 'completed';
            step._forceCompleted = true;
            step._repairNote = 'B3 dedup: prospect ' + email + ' kept in ' + keepCampaignId;
            modified = true;
          }
        }
        if (modified) {
          storage.updateCampaign(oldCamp.id, { steps: oldCamp.steps });
          deduped++;
          log.info('campaign-engine', 'B3 dedup: ' + email + ' — annule pending steps dans "' + entries[i].name + '" (garde "' + entries[0].name + '")');
        }
      }
    }

    if (deduped > 0) {
      log.info('campaign-engine', 'B3 dedup: ' + deduped + ' campagne(s) nettoyee(s)');
    }
  }

  // Auto-repair: calculer scheduledAt pour les steps pending qui en manquent
  // Protege contre les legacy auto-campaigns creees sans generateCampaignEmails
  _repairMissingScheduledAt() {
    const campaigns = storage.getAllCampaigns().filter(c => c.status === 'active');
    let repaired = 0;
    let cancelled = 0;
    let staggerIndex = 0;
    const now = new Date();

    for (const campaign of campaigns) {
      let modified = false;
      for (const step of campaign.steps) {
        if (step.status !== 'pending') continue;
        if (step.scheduledAt) continue;
        if (step.delayDays == null) continue;

        // Trouver la date de base : completedAt ou sentAt du step precedent, sinon createdAt campagne
        const prevStep = campaign.steps.find(s => s.stepNumber === step.stepNumber - 1);
        let baseDate = null;
        if (prevStep && prevStep.completedAt) {
          baseDate = new Date(prevStep.completedAt);
        } else if (prevStep && prevStep.sentAt) {
          baseDate = new Date(prevStep.sentAt);
        } else if (campaign.startedAt) {
          baseDate = new Date(campaign.startedAt);
        } else if (campaign.createdAt) {
          baseDate = new Date(campaign.createdAt);
        }
        if (!baseDate || isNaN(baseDate.getTime())) continue;

        let scheduledDate = new Date(baseDate.getTime() + step.delayDays * 24 * 60 * 60 * 1000);
        const daysPast = Math.floor((now - scheduledDate) / (24 * 60 * 60 * 1000));

        if (daysPast > 30) {
          // Trop ancien (>30j de retard) — annuler ce step
          step.status = 'completed';
          step._forceCompleted = true;
          step._repairNote = 'auto-cancelled: ' + daysPast + ' days overdue';
          modified = true;
          cancelled++;
          log.info('campaign-engine', 'Repair scheduledAt: step ' + step.stepNumber + ' de "' + campaign.name + '" annule (' + daysPast + 'j de retard)');
          continue;
        }

        if (scheduledDate < now) {
          // Date passee mais < 30j : etaler dans le futur (5 campagnes/jour, 2h d'ecart)
          const staggerDays = Math.floor(staggerIndex / 5);
          const staggerHours = (staggerIndex % 5) * 2;
          scheduledDate = new Date(now.getTime() + (staggerDays * 24 + staggerHours + 1) * 60 * 60 * 1000);
          staggerIndex++;
        }

        scheduledDate = _snapToPreferredSlot(scheduledDate);
        step.scheduledAt = scheduledDate.toISOString();
        step._adaptiveChecked = false;
        modified = true;
        repaired++;
        log.info('campaign-engine', 'Repair scheduledAt: ' + campaign.name + ' step ' + step.stepNumber + ' → ' + step.scheduledAt);
      }
      if (modified) {
        storage.updateCampaign(campaign.id, { steps: campaign.steps });
      }
    }
    if (repaired > 0 || cancelled > 0) {
      log.info('campaign-engine', 'Auto-repair scheduledAt: ' + repaired + ' step(s) repare(s), ' + cancelled + ' annule(s)');
    }
  }

  stop() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      log.info('campaign-engine', 'Scheduler arrete');
    }
  }

  async _processScheduled() {
    // Mutex : eviter les executions paralleles si un cycle dure > 60s
    if (this._schedulerRunning) return;
    this._schedulerRunning = true;
    try {
      await this._processScheduledInner();
    } finally {
      this._schedulerRunning = false;
    }
  }

  async _processScheduledInner() {
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
            } else if (openRate < 0.15 && prevEmails.length >= 5) {
              // Engagement faible : ralentir d'1 jour pour eviter d'agacer
              const scheduledDate = new Date(step.scheduledAt);
              const delayedDate = new Date(scheduledDate.getTime() + 24 * 60 * 60 * 1000);
              step.scheduledAt = delayedDate.toISOString();
              log.info('campaign-engine', 'Delai adaptatif: step ' + step.stepNumber + ' retarde de 1j (open rate ' + Math.round(openRate * 100) + '% au step ' + prevStep.stepNumber + ')');
            }
            step._adaptiveChecked = true;
            storage.updateCampaign(campaign.id, { steps: campaign.steps });
          }
        }

        // Safety net runtime: auto-repair si scheduledAt manquant
        if (!step.scheduledAt && step.delayDays != null) {
          const prevStep = campaign.steps.find(s => s.stepNumber === step.stepNumber - 1);
          const baseTs = prevStep && (prevStep.completedAt || prevStep.sentAt)
            ? new Date(prevStep.completedAt || prevStep.sentAt).getTime()
            : (campaign.startedAt ? new Date(campaign.startedAt).getTime() : null);
          if (baseTs && !isNaN(baseTs)) {
            const repairDate = _snapToPreferredSlot(new Date(baseTs + step.delayDays * 24 * 60 * 60 * 1000));
            step.scheduledAt = repairDate.toISOString();
            step._adaptiveChecked = false;
            storage.updateCampaign(campaign.id, { steps: campaign.steps });
            log.info('campaign-engine', 'Runtime repair: scheduledAt pour "' + campaign.name + '" step ' + step.stepNumber + ' → ' + step.scheduledAt);
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
      .filter(e => e.resendId && !String(e.resendId).startsWith('gmail_') && (e.status === 'sent' || e.status === 'queued' || e.status === 'delivered' || e.status === 'opened'))
      .slice(-100); // Verifier les 100 derniers (Resend API uniquement — Gmail utilise le pixel tracking)

    let bounceCount = 0;
    let replyCount = 0;
    let complainCount = 0;
    let crmSyncCount = 0;

    for (const email of recentEmails) {
      const result = await this.resend.getEmail(email.resendId);
      if (result.success && result.data.last_event) {
        const newStatus = result.data.last_event;
        if (newStatus !== email.status) {
          // Tracking des ouvertures multiples (incrementer openCount)
          if (newStatus === 'opened') {
            const openCount = (email.openCount || 0) + 1;
            storage.updateEmailStatus(email.id, newStatus, { openCount: openCount, openedAt: email.openedAt || new Date().toISOString() });
          } else {
            storage.updateEmailStatus(email.id, newStatus);
          }

          // Tracking des clics
          if (newStatus === 'clicked') {
            storage.updateEmailStatus(email.id, newStatus, { clickedAt: new Date().toISOString() });
          }

          // FIX 14 : Bounce handling — soft vs hard
          if (newStatus === 'bounced') {
            const bounceType = (email.bounceType || '').toLowerCase();
            if (bounceType === 'soft' || bounceType === 'temporary') {
              // Soft bounce : retry via proactive follow-up, pas de blacklist
              log.info('campaign-engine', 'Soft bounce detecte: ' + email.to + ' — retry prevu (pas de blacklist)');
            } else {
              // Hard bounce ou type inconnu via polling : blacklist
              storage.addToBlacklist(email.to, 'hard_bounce');
              log.info('campaign-engine', 'Hard bounce detecte: ' + email.to + ' — ajoute au blacklist');
            }
            bounceCount++;
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

      // Re-verifier quality gates (forbiddenWords/patterns ont pu etre mis a jour)
      const retryQg = _emailPassesQualityGate(email.subject, email.body);
      if (!retryQg.pass) {
        log.warn('campaign-engine', 'Retry quality gate FAIL ' + email.to + ': ' + retryQg.reason + ' — abandon');
        storage.markRetryAttempt(email.id, false, null);
        gaveUp++;
        continue;
      }

      // Gates supplementaires : subject + validation + forbiddenWords (ont pu evoluer)
      const retrySg = _subjectPassesGate(email.subject);
      if (!retrySg.pass) {
        log.warn('campaign-engine', 'Retry subject gate FAIL ' + email.to + ': ' + retrySg.reason + ' — abandon');
        storage.markRetryAttempt(email.id, false, null);
        gaveUp++;
        continue;
      }
      const retryVal = validateEmailOutput(email.subject, email.body, { forbiddenWords: [] });
      if (!retryVal.pass) {
        log.warn('campaign-engine', 'Retry validation FAIL ' + email.to + ': ' + (retryVal.reasons || []).join(', ') + ' — abandon');
        storage.markRetryAttempt(email.id, false, null);
        gaveUp++;
        continue;
      }
      try {
        const apStorage = require('../autonomous-pilot/storage.js');
        const apConfig = apStorage.getConfig ? apStorage.getConfig() : {};
        const ep = apConfig.emailPreferences || {};
        if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
          const retryFw = validateEmailOutput(email.subject, email.body, { forbiddenWords: ep.forbiddenWords });
          if (!retryFw.pass) {
            log.warn('campaign-engine', 'Retry forbidden words FAIL ' + email.to + ': ' + (retryFw.reasons || []).join(', ') + ' — abandon');
            storage.markRetryAttempt(email.id, false, null);
            gaveUp++;
            continue;
          }
        }
      } catch (fwErr) { /* AP storage indisponible, skip ce check */ }

      retried++;
      try {
        // Threading : recuperer messageId precedent pour ce prospect
        const retryOpts = {
          replyTo: process.env.REPLY_TO_EMAIL || process.env.SENDER_EMAIL,
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
CampaignEngine.subjectPassesGate = _subjectPassesGate;
module.exports = CampaignEngine;
