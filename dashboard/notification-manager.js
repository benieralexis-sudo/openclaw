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
    const req = http.get({ hostname: url.hostname, port: url.port, path: url.pathname, timeout: 5000 }, (res) => {
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
                'Email pour ' + (draft.to || 'destinataire inconnu') + ' — ' + (draft.subject || '').substring(0, 60),
                '#drafts'
              );
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

module.exports = {
  createNotification,
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  checkForNewDrafts
};
