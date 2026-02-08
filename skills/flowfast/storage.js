// FlowFast - Stockage persistant JSON
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.FLOWFAST_DATA_DIR || '/data/flowfast';
const DB_FILE = path.join(DATA_DIR, 'flowfast-db.json');

class Storage {
  constructor() {
    this.data = {
      users: {},       // Par chat_id : preferences, historique
      searches: [],    // Historique global des recherches
      leads: {},       // Leads traites (par email = cle unique)
      emails: [],      // Historique des emails envoyes
      stats: {         // Stats globales
        totalSearches: 0,
        totalLeadsFound: 0,
        totalLeadsQualified: 0,
        totalLeadsPushed: 0,
        totalEmailsSent: 0,
        totalEmailsDrafted: 0,
        createdAt: new Date().toISOString()
      }
    };
    this._ensureDir();
    this._load();
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch (e) {
      console.error('[storage] Impossible de creer ' + DATA_DIR + ':', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const loaded = JSON.parse(raw);
        this.data = { ...this.data, ...loaded };
        console.log('[storage] Base chargee (' + Object.keys(this.data.users).length + ' utilisateurs, ' + this.data.searches.length + ' recherches)');
      } else {
        console.log('[storage] Nouvelle base creee');
        this._save();
      }
    } catch (e) {
      console.error('[storage] Erreur chargement:', e.message);
    }
  }

  _save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('[storage] Erreur sauvegarde:', e.message);
    }
  }

  // --- Utilisateurs ---

  getUser(chatId) {
    const id = String(chatId);
    if (!this.data.users[id]) {
      this.data.users[id] = {
        chatId: id,
        name: null,
        scoreMinimum: 6,
        preferences: {
          defaultLimit: 10,
          autoHubspot: true
        },
        searchCount: 0,
        feedbacks: { positive: 0, negative: 0 },
        joinedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString()
      };
      this._save();
    }
    this.data.users[id].lastActiveAt = new Date().toISOString();
    return this.data.users[id];
  }

  updateUser(chatId, updates) {
    const user = this.getUser(chatId);
    Object.assign(user, updates);
    this._save();
    return user;
  }

  setUserName(chatId, name) {
    const user = this.getUser(chatId);
    user.name = name;
    this._save();
  }

  getUserScore(chatId) {
    return this.getUser(chatId).scoreMinimum;
  }

  setUserScore(chatId, score) {
    const user = this.getUser(chatId);
    user.scoreMinimum = score;
    this._save();
  }

  // --- Recherches ---

  addSearch(chatId, params, results) {
    const search = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      chatId: String(chatId),
      params: params,
      results: results,
      createdAt: new Date().toISOString()
    };
    this.data.searches.push(search);
    // Garder max 500 recherches
    if (this.data.searches.length > 500) {
      this.data.searches = this.data.searches.slice(-500);
    }
    // Mettre a jour les stats
    this.data.stats.totalSearches++;
    if (results) {
      this.data.stats.totalLeadsFound += results.total || 0;
      this.data.stats.totalLeadsQualified += results.qualified || 0;
      this.data.stats.totalLeadsPushed += results.created || 0;
    }
    // Stats utilisateur
    const user = this.getUser(chatId);
    user.searchCount++;
    this._save();
    return search;
  }

  getRecentSearches(chatId, limit) {
    limit = limit || 5;
    const id = String(chatId);
    return this.data.searches
      .filter(s => s.chatId === id)
      .slice(-limit);
  }

  // --- Leads ---

  addLead(lead, score, searchId) {
    const key = lead.email || (lead.nom + '_' + lead.entreprise);
    this.data.leads[key] = {
      ...lead,
      score: score,
      searchId: searchId,
      feedback: null,
      pushedToHubspot: false,
      createdAt: new Date().toISOString()
    };
    this._save();
    return this.data.leads[key];
  }

  setLeadFeedback(email, feedback) {
    if (this.data.leads[email]) {
      this.data.leads[email].feedback = feedback;
      this._save();
    }
  }

  setLeadPushed(email) {
    if (this.data.leads[email]) {
      this.data.leads[email].pushedToHubspot = true;
      this.data.leads[email].pushedAt = new Date().toISOString();
      this._save();
    }
  }

  isLeadKnown(email) {
    return !!this.data.leads[email];
  }

  getLeadsBySearch(searchId) {
    return Object.values(this.data.leads).filter(l => l.searchId === searchId);
  }

  // --- Feedbacks ---

  addFeedback(chatId, type) {
    const user = this.getUser(chatId);
    if (type === 'positive') user.feedbacks.positive++;
    if (type === 'negative') user.feedbacks.negative++;
    this._save();
  }

  // --- Emails ---

  addEmail(chatId, leadEmail, subject, body, status) {
    if (!this.data.emails) this.data.emails = [];
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      chatId: String(chatId),
      leadEmail: leadEmail,
      subject: subject,
      body: body,
      status: status, // 'sent', 'failed', 'drafted'
      sentAt: status === 'sent' ? new Date().toISOString() : null,
      createdAt: new Date().toISOString()
    };
    this.data.emails.push(record);
    // Garder max 500 emails
    if (this.data.emails.length > 500) {
      this.data.emails = this.data.emails.slice(-500);
    }
    if (status === 'sent') this.data.stats.totalEmailsSent = (this.data.stats.totalEmailsSent || 0) + 1;
    if (status === 'drafted') this.data.stats.totalEmailsDrafted = (this.data.stats.totalEmailsDrafted || 0) + 1;
    this._save();
    return record;
  }

  getEmailsByLead(leadEmail) {
    if (!this.data.emails) return [];
    return this.data.emails.filter(e => e.leadEmail === leadEmail);
  }

  getRecentEmails(chatId, limit) {
    limit = limit || 10;
    if (!this.data.emails) return [];
    return this.data.emails
      .filter(e => e.chatId === String(chatId))
      .slice(-limit);
  }

  getAllEmails() {
    return this.data.emails || [];
  }

  // --- Stats dashboard ---

  getGlobalStats() {
    const users = Object.values(this.data.users);
    const leads = Object.values(this.data.leads);
    return {
      ...this.data.stats,
      activeUsers: users.length,
      totalLeadsStored: leads.length,
      leadsWithFeedback: leads.filter(l => l.feedback !== null).length,
      positiveFeedbacks: leads.filter(l => l.feedback === 'positive').length,
      negativeFeedbacks: leads.filter(l => l.feedback === 'negative').length,
      leadsPushedToHubspot: leads.filter(l => l.pushedToHubspot).length,
      totalEmailsSent: this.data.stats.totalEmailsSent || 0,
      totalEmailsDrafted: this.data.stats.totalEmailsDrafted || 0,
      recentSearches: this.data.searches.slice(-20),
      topUsers: users
        .sort((a, b) => b.searchCount - a.searchCount)
        .slice(0, 10)
        .map(u => ({ name: u.name, chatId: u.chatId, searches: u.searchCount, lastActive: u.lastActiveAt }))
    };
  }

  getAllSearches() {
    return this.data.searches;
  }

  getAllLeads() {
    return Object.values(this.data.leads);
  }

  getAllUsers() {
    return Object.values(this.data.users);
  }
}

module.exports = new Storage();
