// CRM Pilot - Stockage persistant JSON
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.CRM_PILOT_DATA_DIR || '/data/crm-pilot';
const DB_FILE = path.join(DATA_DIR, 'crm-pilot-db.json');

class CRMPilotStorage {
  constructor() {
    this.data = {
      users: {},
      cache: {
        contacts: {},
        deals: {},
        pipeline: null
      },
      activityLog: [],
      stats: {
        totalActions: 0,
        totalContactsCreated: 0,
        totalDealsCreated: 0,
        totalNotesAdded: 0,
        totalTasksCreated: 0,
        createdAt: new Date().toISOString()
      }
    };
    this._ensureDir();
    this._load();
  }

  _ensureDir() {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  }

  _load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const loaded = JSON.parse(raw);
        this.data = { ...this.data, ...loaded };
        if (!this.data.cache) this.data.cache = { contacts: {}, deals: {}, pipeline: null };
        if (!this.data.activityLog) this.data.activityLog = [];
        console.log('[crm-pilot-storage] Base chargee (' + Object.keys(this.data.users).length + ' utilisateurs)');
      } else {
        console.log('[crm-pilot-storage] Nouvelle base creee');
        this._save();
      }
    } catch (e) {
      console.error('[crm-pilot-storage] Erreur chargement:', e.message);
    }
  }

  _save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[crm-pilot-storage] Erreur sauvegarde:', e.message);
    }
  }

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // --- Utilisateurs ---

  getUser(chatId) {
    const id = String(chatId);
    if (!this.data.users[id]) {
      this.data.users[id] = {
        chatId: id,
        name: '',
        preferences: {
          defaultPipeline: 'default',
          dealCurrency: 'EUR',
          contactsPerPage: 10,
          dealsPerPage: 10
        },
        stats: {
          contactsViewed: 0,
          contactsCreated: 0,
          contactsUpdated: 0,
          dealsCreated: 0,
          dealsUpdated: 0,
          notesAdded: 0,
          tasksCreated: 0,
          pipelineViewed: 0,
          reportsGenerated: 0,
          searchesPerformed: 0
        },
        joinedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString()
      };
      this._save();
    }
    this.data.users[id].lastActiveAt = new Date().toISOString();
    return this.data.users[id];
  }

  setUserName(chatId, name) {
    const user = this.getUser(chatId);
    user.name = name;
    this._save();
  }

  incrementStat(chatId, statKey) {
    const user = this.getUser(chatId);
    if (user.stats[statKey] !== undefined) {
      user.stats[statKey]++;
    }
    this._save();
  }

  // --- Cache ---

  cacheContacts(chatId, contacts) {
    this.data.cache.contacts[String(chatId)] = {
      data: contacts,
      cachedAt: Date.now(),
      ttl: 300000 // 5 minutes
    };
  }

  getCachedContacts(chatId) {
    const cached = this.data.cache.contacts[String(chatId)];
    if (cached && (Date.now() - cached.cachedAt) < cached.ttl) {
      return cached.data;
    }
    return null;
  }

  invalidateContactCache(chatId) {
    delete this.data.cache.contacts[String(chatId)];
  }

  cacheDeals(chatId, deals) {
    this.data.cache.deals[String(chatId)] = {
      data: deals,
      cachedAt: Date.now(),
      ttl: 300000
    };
  }

  getCachedDeals(chatId) {
    const cached = this.data.cache.deals[String(chatId)];
    if (cached && (Date.now() - cached.cachedAt) < cached.ttl) {
      return cached.data;
    }
    return null;
  }

  invalidateDealCache(chatId) {
    delete this.data.cache.deals[String(chatId)];
  }

  cachePipeline(pipelineData) {
    this.data.cache.pipeline = {
      data: pipelineData,
      cachedAt: Date.now(),
      ttl: 3600000 // 1 heure
    };
  }

  getCachedPipeline() {
    const cached = this.data.cache.pipeline;
    if (cached && (Date.now() - cached.cachedAt) < cached.ttl) {
      return cached.data;
    }
    return null;
  }

  // --- Journal d'activite ---

  logActivity(chatId, action, details) {
    this.data.activityLog.push({
      id: this._generateId(),
      chatId: String(chatId),
      action: action,
      details: details || {},
      createdAt: new Date().toISOString()
    });
    this.data.stats.totalActions++;
    // Garder les 500 derniers
    if (this.data.activityLog.length > 500) {
      this.data.activityLog = this.data.activityLog.slice(-500);
    }
    this._save();
  }

  getRecentActivity(chatId, limit) {
    limit = limit || 20;
    return this.data.activityLog
      .filter(a => a.chatId === String(chatId))
      .slice(-limit);
  }

  // --- Stats globales ---

  getGlobalStats() {
    return { ...this.data.stats };
  }

  incrementGlobalStat(key) {
    if (this.data.stats[key] !== undefined) {
      this.data.stats[key]++;
    }
    this._save();
  }
}

module.exports = new CRMPilotStorage();
