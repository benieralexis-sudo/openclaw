// Content Gen - Stockage persistant JSON
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../../gateway/utils.js');

const DATA_DIR = process.env.CONTENT_GEN_DATA_DIR || '/data/content-gen';
const DB_FILE = path.join(DATA_DIR, 'content-gen-db.json');

class ContentGenStorage {
  constructor() {
    this.data = {
      users: {},
      generatedContents: {},
      activityLog: [],
      stats: {
        totalGenerated: 0,
        byType: {
          linkedin: 0,
          pitch: 0,
          description: 0,
          script: 0,
          email: 0,
          bio: 0,
          refine: 0
        },
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
        if (!this.data.generatedContents) this.data.generatedContents = {};
        if (!this.data.stats.byType) this.data.stats.byType = { linkedin: 0, pitch: 0, description: 0, script: 0, email: 0, bio: 0, refine: 0 };
        const total = Object.values(this.data.generatedContents).reduce((sum, arr) => sum + arr.length, 0);
        console.log('[content-gen-storage] Base chargee (' + total + ' contenus generes)');
      } else {
        console.log('[content-gen-storage] Nouvelle base creee');
        this._save();
      }
    } catch (e) {
      console.error('[content-gen-storage] Erreur chargement:', e.message);
    }
  }

  _save() {
    try {
      atomicWriteSync(DB_FILE, this.data);
    } catch (e) {
      console.error('[content-gen-storage] Erreur sauvegarde:', e.message);
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
        stats: { contentsGenerated: 0 },
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

  // --- Contenus generes ---

  saveContent(chatId, type, topic, content, tone) {
    const id = String(chatId);
    if (!this.data.generatedContents[id]) {
      this.data.generatedContents[id] = [];
    }

    const entry = {
      id: this._generateId(),
      type: type,
      topic: topic || '',
      content: content,
      tone: tone || 'professionnel',
      createdAt: new Date().toISOString()
    };

    this.data.generatedContents[id].push(entry);

    // Limiter a 100 contenus par user
    if (this.data.generatedContents[id].length > 100) {
      this.data.generatedContents[id] = this.data.generatedContents[id].slice(-100);
    }

    // Stats
    this.data.stats.totalGenerated++;
    if (this.data.stats.byType[type] !== undefined) {
      this.data.stats.byType[type]++;
    }
    const user = this.getUser(chatId);
    user.stats.contentsGenerated++;

    this._save();
    return entry;
  }

  getContents(chatId, limit) {
    limit = limit || 10;
    const id = String(chatId);
    const contents = this.data.generatedContents[id] || [];
    return contents.slice(-limit);
  }

  getContentById(chatId, contentId) {
    const id = String(chatId);
    const contents = this.data.generatedContents[id] || [];
    return contents.find(c => c.id === contentId) || null;
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

  // --- Stats ---

  getGlobalStats() {
    return { ...this.data.stats };
  }
}

module.exports = new ContentGenStorage();
