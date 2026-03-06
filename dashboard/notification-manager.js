// Notification Manager — per-client notification storage
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const log = require('../gateway/logger.js');

const NOTIFS_FILE = path.join(process.env.DASHBOARD_DATA_DIR || '/data/dashboard', 'notifications.json');
const MAX_NOTIFS_PER_CLIENT = 100;

let _notifs = null;
let _loadedAt = 0;
const CACHE_TTL = 3000;

function _load() {
  if (_notifs && (Date.now() - _loadedAt) < CACHE_TTL) return _notifs;
  try {
    if (fs.existsSync(NOTIFS_FILE)) {
      _notifs = JSON.parse(fs.readFileSync(NOTIFS_FILE, 'utf8'));
    } else {
      _notifs = {};
    }
  } catch (e) {
    log.warn('notification-manager', 'Erreur lecture notifications:', e.message);
    _notifs = {};
  }
  _loadedAt = Date.now();
  return _notifs;
}

function _save() {
  try {
    const dir = path.dirname(NOTIFS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = NOTIFS_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(_notifs, null, 2), 'utf8');
    fs.renameSync(tmp, NOTIFS_FILE);
    _loadedAt = Date.now();
  } catch (e) {
    log.warn('notification-manager', 'Erreur sauvegarde notifications:', e.message);
  }
}

function createNotification(clientId, type, title, body, link) {
  const notifs = _load();
  if (!notifs[clientId]) notifs[clientId] = [];

  const notif = {
    id: crypto.randomBytes(8).toString('hex'),
    type: type, // 'draft_pending', 'hot_lead', 'campaign_milestone', 'system'
    title: title,
    body: body || '',
    link: link || null,
    read: false,
    createdAt: new Date().toISOString()
  };

  notifs[clientId].unshift(notif);

  // Trim old notifications
  if (notifs[clientId].length > MAX_NOTIFS_PER_CLIENT) {
    notifs[clientId] = notifs[clientId].slice(0, MAX_NOTIFS_PER_CLIENT);
  }

  _save();
  return notif;
}

function getNotifications(clientId, opts) {
  const notifs = _load();
  const list = notifs[clientId] || [];
  if (opts && opts.unreadOnly) {
    return list.filter(n => !n.read);
  }
  return list;
}

function getUnreadCount(clientId) {
  const notifs = _load();
  return (notifs[clientId] || []).filter(n => !n.read).length;
}

function markRead(clientId, notifId) {
  const notifs = _load();
  const list = notifs[clientId] || [];
  const notif = list.find(n => n.id === notifId);
  if (notif) {
    notif.read = true;
    _save();
    return true;
  }
  return false;
}

function markAllRead(clientId) {
  const notifs = _load();
  const list = notifs[clientId] || [];
  let changed = false;
  for (const n of list) {
    if (!n.read) { n.read = true; changed = true; }
  }
  if (changed) _save();
  return changed;
}

// Poll for new drafts and create notifications
let _lastDraftCheck = {};

async function checkForNewDrafts(clientId, routerUrl) {
  const http = require('http');
  return new Promise((resolve) => {
    const url = new URL(routerUrl + '/api/hitl/drafts');
    const req = http.get({ hostname: url.hostname, port: url.port, path: url.pathname, timeout: 5000, headers: { 'x-api-token': process.env.DASHBOARD_PASSWORD || '' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const drafts = JSON.parse(data);
          if (!Array.isArray(drafts)) return resolve(0);

          const lastCheck = _lastDraftCheck[clientId] || 0;
          const newDrafts = drafts.filter(d => {
            const ts = new Date(d.createdAt || 0).getTime();
            return ts > lastCheck;
          });

          if (newDrafts.length > 0) {
            for (const draft of newDrafts) {
              createNotification(clientId, 'draft_pending',
                'Nouveau brouillon a approuver',
                'Email pour ' + (draft.to || draft.prospectEmail || 'destinataire inconnu') + ' — ' + (draft.subject || '').substring(0, 60),
                '#drafts'
              );
              // Send email notification to client
              sendDraftPendingEmail(clientId, {
                prospectEmail: draft.to || draft.prospectEmail || '',
                prospectName: draft.prospectName || '',
                company: draft.company || '',
                incomingSnippet: draft.incomingSnippet || '',
                subject: draft.subject || '',
                body: draft.body || '',
                grounded: draft.grounded || false
              });
            }
            log.info('notification-manager', newDrafts.length + ' nouveau(x) draft(s) pour ' + clientId);
          }

          _lastDraftCheck[clientId] = Date.now();
          resolve(newDrafts.length);
        } catch (e) {
          resolve(0);
        }
      });
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
  });
}

// --- Email notification via Resend ---
const https = require('https');

// Client email contacts cache (loaded from client registry)
let _clientContacts = {};

function setClientContact(clientId, email, name) {
  _clientContacts[clientId] = { email, name };
}

function _getClientContact(clientId) {
  return _clientContacts[clientId] || null;
}

function _sendResendEmail(to, subject, htmlBody) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return;

  const senderEmail = process.env.SENDER_EMAIL || 'hello@ifind.fr';
  const senderName = process.env.SENDER_NAME || 'iFIND';

  const payload = JSON.stringify({
    from: senderName + ' <' + senderEmail + '>',
    to: [to],
    subject: subject,
    html: htmlBody
  });

  const req = https.request({
    hostname: 'api.resend.com',
    path: '/emails',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 15000
  }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        log.info('notification-manager', 'Email notif envoye a ' + to + ': ' + subject);
      } else {
        log.warn('notification-manager', 'Resend email echec (' + res.statusCode + '): ' + data.substring(0, 200));
      }
    });
  });
  req.on('error', (e) => log.warn('notification-manager', 'Resend email error: ' + e.message));
  req.on('timeout', () => { req.destroy(); });
  req.write(payload);
  req.end();
}

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://srv1319748.hstgr.cloud';

function sendDraftPendingEmail(clientId, draftInfo) {
  const contact = _getClientContact(clientId);
  if (!contact || !contact.email) return;

  const subject = 'Nouveau brouillon en attente — ' + (draftInfo.prospectName || draftInfo.prospectEmail || 'prospect');
  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#1e293b;margin-bottom:16px">Nouveau brouillon a approuver</h2>
  <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin-bottom:16px">
    <p style="margin:0 0 8px;color:#64748b;font-size:13px;text-transform:uppercase;letter-spacing:0.5px">De</p>
    <p style="margin:0;font-weight:600;color:#1e293b">${_escHtml(draftInfo.prospectName || draftInfo.prospectEmail || '')}</p>
    ${draftInfo.company ? '<p style="margin:4px 0 0;color:#64748b;font-size:13px">' + _escHtml(draftInfo.company) + '</p>' : ''}
  </div>
  ${draftInfo.incomingSnippet ? '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px"><p style="margin:0 0 8px;color:#64748b;font-size:13px;text-transform:uppercase;letter-spacing:0.5px">Message recu</p><p style="margin:0;color:#334155;line-height:1.6">' + _escHtml(draftInfo.incomingSnippet).substring(0, 300) + '</p></div>' : ''}
  <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:16px">
    <p style="margin:0 0 8px;color:#3b82f6;font-size:13px;text-transform:uppercase;letter-spacing:0.5px">Reponse proposee</p>
    <p style="margin:0;color:#1e293b;line-height:1.6;white-space:pre-line">${_escHtml((draftInfo.body || '').substring(0, 500))}</p>
  </div>
  <div style="text-align:center;margin-top:20px">
    <a href="${DASHBOARD_URL}/#drafts" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:15px">Voir dans le dashboard</a>
  </div>
  <p style="margin-top:20px;color:#94a3b8;font-size:12px;text-align:center">
    ${draftInfo.grounded ? 'Envoi automatique dans 30 min si pas d\'action.' : 'Validation requise — rien ne sera envoye sans votre accord.'}
  </p>
</div>`;

  _sendResendEmail(contact.email, subject, html);
}

function sendDraftReminderEmail(clientId, pendingCount) {
  const contact = _getClientContact(clientId);
  if (!contact || !contact.email) return;

  const subject = pendingCount + ' brouillon' + (pendingCount > 1 ? 's' : '') + ' en attente de validation';
  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#1e293b;margin-bottom:16px">Rappel : ${pendingCount} brouillon${pendingCount > 1 ? 's' : ''} en attente</h2>
  <p style="color:#64748b;line-height:1.6;margin-bottom:20px">
    Vous avez ${pendingCount} reponse${pendingCount > 1 ? 's' : ''} en attente de validation dans votre tableau de bord.
    Les brouillons expirent apres 24h.
  </p>
  <div style="text-align:center">
    <a href="${DASHBOARD_URL}/#drafts" style="display:inline-block;background:#f59e0b;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:15px">Voir les brouillons</a>
  </div>
</div>`;

  _sendResendEmail(contact.email, subject, html);
}

function sendDraftSentConfirmation(clientId, draftInfo) {
  const contact = _getClientContact(clientId);
  if (!contact || !contact.email) return;

  const subject = 'Email envoye a ' + (draftInfo.prospectName || draftInfo.prospectEmail || 'prospect');
  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="text-align:center;margin-bottom:16px">
    <div style="display:inline-block;width:48px;height:48px;background:#dcfce7;border-radius:50%;line-height:48px;font-size:24px">&#10003;</div>
  </div>
  <h2 style="color:#1e293b;margin-bottom:16px;text-align:center">Email envoye</h2>
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:16px">
    <p style="margin:0 0 4px;color:#64748b;font-size:13px"><strong>A :</strong> ${_escHtml(draftInfo.prospectName || draftInfo.prospectEmail || '')}</p>
    <p style="margin:0 0 8px;color:#64748b;font-size:13px"><strong>Objet :</strong> ${_escHtml(draftInfo.subject || '')}</p>
    <p style="margin:0;color:#334155;line-height:1.6;white-space:pre-line">${_escHtml((draftInfo.body || '').substring(0, 500))}</p>
  </div>
  <div style="text-align:center">
    <a href="${DASHBOARD_URL}/#drafts" style="color:#3b82f6;text-decoration:none;font-size:14px">Voir le tableau de bord</a>
  </div>
</div>`;

  _sendResendEmail(contact.email, subject, html);
}

function _escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Reminder cron (checks every hour, sends reminder after 12h) ---
const _remindersSent = {};

function checkAndSendReminders() {
  const notifs = _load();
  for (const [clientId, list] of Object.entries(notifs)) {
    if (clientId === '_admin') continue;
    const pendingDrafts = list.filter(n => n.type === 'draft_pending' && !n.read);
    if (pendingDrafts.length === 0) continue;

    // Check if oldest unread draft is >12h old
    const oldest = pendingDrafts[pendingDrafts.length - 1];
    const age = Date.now() - new Date(oldest.createdAt).getTime();
    if (age < 12 * 60 * 60 * 1000) continue; // < 12h

    // Check if we already sent a reminder today
    const today = new Date().toISOString().substring(0, 10);
    if (_remindersSent[clientId] === today) continue;

    sendDraftReminderEmail(clientId, pendingDrafts.length);
    _remindersSent[clientId] = today;
    log.info('notification-manager', 'Rappel brouillons envoye a ' + clientId + ' (' + pendingDrafts.length + ' en attente)');
  }
}

// Check reminders every hour
setInterval(checkAndSendReminders, 60 * 60 * 1000);

module.exports = {
  createNotification,
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  checkForNewDrafts,
  setClientContact,
  sendDraftPendingEmail,
  sendDraftReminderEmail,
  sendDraftSentConfirmation,
  checkAndSendReminders
};
