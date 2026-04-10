// iFIND - Structured logger with error classification + Telegram alerts
'use strict';

// --- Error classification ---
// CRITICAL = alerte Telegram immediate (brain timeout, envoi email casse, IMAP down persistant)
// WARNING = log structure, pas d'alerte (gates, retries, DDG rate-limit)
// EXPECTED = ignore proprement (404 scrape, module optionnel absent)

const CRITICAL_PATTERNS = [
  /brain cycle timeout/i,
  /SIGTERM|SIGINT|uncaughtException/i,
  /disk.*full|no space left/i,
  /ENOSPC/i,
  /Resend API.*5\d\d/i,
  /Gmail SMTP.*auth.*fail/i,
  /TELEGRAM_BOT_TOKEN.*invalid/i,
  /Claude API.*rate.*limit/i,
  /ANTHROPIC_API_KEY.*invalid/i,
  /ETAT PARTIEL/i,                     // brain decides avec donnees manquantes
  /JSON.*parse.*error|SyntaxError.*JSON/i, // fichier data corrompu
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT/i,   // API externe down
  /heap.*out.*memory|allocation.*failed/i, // OOM
  /EMFILE|too many open files/i,           // file descriptors epuises
  /TOTALEMENT echouee/i,                   // confirmation Telegram perdue
  /fichier corrompu/i,                     // storage corrompu
  /DISQUE PLEIN/i,                         // ecriture impossible
  /HEARTBEAT/i,                          // brain bloque depuis >26h
  /IMAP.*restart.*max|IMAP.*abandon/i,   // IMAP restart loop epuise
];

const EXPECTED_PATTERNS = [
  /Scrape 404/i,
  /page inexistante/i,
  /DDG 202 rate-limit/i,
  /module.*not found/i,
  /optional.*not installed/i,
  /Google News 0 articles/i,
];

// Telegram alert state (rate limit: max 1 alert per pattern per 30min)
const _alertCooldowns = new Map();
const ALERT_COOLDOWN = 30 * 60 * 1000; // 30 minutes
let _sendTelegramFn = null;

function setSendTelegram(fn) {
  _sendTelegramFn = fn;
}

function _classifyError(msg) {
  const fullMsg = typeof msg === 'string' ? msg : String(msg);
  for (const pattern of CRITICAL_PATTERNS) {
    if (pattern.test(fullMsg)) return 'CRITICAL';
  }
  for (const pattern of EXPECTED_PATTERNS) {
    if (pattern.test(fullMsg)) return 'EXPECTED';
  }
  return 'WARNING';
}

function _sendCriticalAlert(tag, msg) {
  if (!_sendTelegramFn) return;
  const alertKey = tag + ':' + msg.substring(0, 50);
  const now = Date.now();
  const lastAlert = _alertCooldowns.get(alertKey);
  if (lastAlert && (now - lastAlert) < ALERT_COOLDOWN) return; // rate-limited
  _alertCooldowns.set(alertKey, now);
  // Nettoyer les vieux cooldowns (> 1h)
  for (const [key, ts] of _alertCooldowns) {
    if (now - ts > 60 * 60 * 1000) _alertCooldowns.delete(key);
  }
  try {
    const chatId = process.env.ADMIN_CHAT_ID || '1409505520';
    _sendTelegramFn(chatId, '🔴 *CRITICAL ERROR*\n`[' + tag + ']` ' + msg.substring(0, 300));
  } catch (e) {
    // Eviter boucle infinie si Telegram est down
  }
}

// --- Formatting ---

function _toJson(tag, level, args) {
  const msg = args.map(a => {
    if (a instanceof Error) return a.message;
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return String(a); } }
    return String(a);
  }).join(' ');
  return JSON.stringify({ ts: new Date().toISOString(), level, tag, msg });
}

function _fmt(tag, level, args) {
  const ts = new Date().toISOString();
  const parts = ['[' + ts + ']', '[' + tag + ']'];
  if (level === 'warn') parts.push('WARN');
  if (level === 'error') parts.push('ERROR');
  return parts.concat(args);
}

const STRUCTURED = process.env.LOG_FORMAT === 'json';

function info(tag, ...args) {
  if (STRUCTURED) { process.stdout.write(_toJson(tag, 'info', args) + '\n'); }
  else { console.log(..._fmt(tag, 'info', args)); }
}

function warn(tag, ...args) {
  if (STRUCTURED) { process.stdout.write(_toJson(tag, 'warn', args) + '\n'); }
  else { console.warn(..._fmt(tag, 'warn', args)); }
}

function error(tag, ...args) {
  const msg = args.map(a => (a instanceof Error) ? a.message : String(a)).join(' ');
  const classification = _classifyError(msg);

  if (STRUCTURED) { process.stderr.write(_toJson(tag, 'error', args) + '\n'); }
  else { console.error(..._fmt(tag, 'error', args)); }

  // Alertes Telegram pour les erreurs critiques
  if (classification === 'CRITICAL') {
    _sendCriticalAlert(tag, msg);
  }
}

// Classification accessible pour le health score
function classifyError(msg) { return _classifyError(msg); }

module.exports = { info, warn, error, setSendTelegram, classifyError };
