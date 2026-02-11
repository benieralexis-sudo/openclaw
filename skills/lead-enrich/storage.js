// Lead Enrich - Stockage persistant JSON
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.LEAD_ENRICH_DATA_DIR || '/data/lead-enrich';
const DB_FILE = path.join(DATA_DIR, 'lead-enrich-db.json');

class LeadEnrichStorage {
  constructor() {
    this.data = {
      users: {},
      enrichedLeads: {},
      apolloUsage: {
        creditsUsed: 0,
        creditsLimit: 100,
        lastResetAt: new Date().toISOString(),
        history: []
      },
      activityLog: [],
      stats: {
        totalEnrichments: 0,
        totalHubspotEnrichments: 0,
        totalAutomailerEnrichments: 0,
        totalTelegramEnrichments: 0,
        totalScored: 0,
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
        if (!this.data.enrichedLeads) this.data.enrichedLeads = {};
        if (!this.data.apolloUsage) this.data.apolloUsage = { creditsUsed: 0, creditsLimit: 100, lastResetAt: new Date().toISOString(), history: [] };
        console.log('[lead-enrich-storage] Base chargee (' + Object.keys(this.data.enrichedLeads).length + ' leads enrichis)');
      } else {
        console.log('[lead-enrich-storage] Nouvelle base creee');
        this._save();
      }
    } catch (e) {
      console.error('[lead-enrich-storage] Erreur chargement:', e.message);
    }
  }

  _save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[lead-enrich-storage] Erreur sauvegarde:', e.message);
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
        stats: {
          enrichmentsDone: 0,
          batchesRun: 0,
          topScore: 0
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

  // --- Leads enrichis ---

  getEnrichedLead(email) {
    return this.data.enrichedLeads[email.toLowerCase()] || null;
  }

  isAlreadyEnriched(email) {
    return !!this.data.enrichedLeads[email.toLowerCase()];
  }

  saveEnrichedLead(email, apolloData, aiClassification, source, chatId) {
    const key = email.toLowerCase();
    this.data.enrichedLeads[key] = {
      email: key,
      apolloData: apolloData,
      aiClassification: aiClassification,
      enrichedAt: new Date().toISOString(),
      source: source,
      chatId: String(chatId)
    };
    this.data.stats.totalEnrichments++;
    if (source === 'hubspot') this.data.stats.totalHubspotEnrichments++;
    else if (source === 'automailer') this.data.stats.totalAutomailerEnrichments++;
    else this.data.stats.totalTelegramEnrichments++;
    this.data.stats.totalScored++;
    this._save();
  }

  getAllEnrichedLeads(chatId) {
    const id = String(chatId);
    return Object.values(this.data.enrichedLeads)
      .filter(l => l.chatId === id);
  }

  getTopLeads(chatId, limit) {
    limit = limit || 10;
    return this.getAllEnrichedLeads(chatId)
      .filter(l => l.aiClassification && l.aiClassification.score)
      .sort((a, b) => (b.aiClassification.score || 0) - (a.aiClassification.score || 0))
      .slice(0, limit);
  }

  // --- Credits Apollo ---

  trackApolloCredit() {
    this.resetApolloUsageIfNewMonth();
    this.data.apolloUsage.creditsUsed++;
    this._save();
  }

  getApolloCreditsRemaining() {
    this.resetApolloUsageIfNewMonth();
    return Math.max(0, this.data.apolloUsage.creditsLimit - this.data.apolloUsage.creditsUsed);
  }

  getApolloCreditsUsed() {
    this.resetApolloUsageIfNewMonth();
    return this.data.apolloUsage.creditsUsed;
  }

  resetApolloUsageIfNewMonth() {
    const now = new Date();
    const lastReset = new Date(this.data.apolloUsage.lastResetAt);
    if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
      this.data.apolloUsage.creditsUsed = 0;
      this.data.apolloUsage.lastResetAt = now.toISOString();
      this._save();
    }
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

  // --- Stats ---

  getGlobalStats() {
    return { ...this.data.stats };
  }
}

module.exports = new LeadEnrichStorage();
