// Inbox Manager - Stockage persistant JSON
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../../gateway/utils.js');

const DATA_DIR = process.env.INBOX_MANAGER_DATA_DIR || '/data/inbox-manager';
const DB_FILE = path.join(DATA_DIR, 'inbox-manager-db.json');

class InboxManagerStorage {
  constructor() {
    this.data = {
      config: {
        enabled: false,
        pollIntervalMs: 120000, // 2 minutes
        lastCheckedAt: null,
        autoReplyEnabled: true,
        replyBySentiment: {
          interested: true,
          question: true,
          not_interested: true,
          out_of_office: false,
          bounce: false
        }
      },
      receivedEmails: [],   // [{id, from, to, subject, date, matchedLead, processedAt}]
      matchedReplies: [],   // Emails qui matchent un lead connu
      stats: {
        totalReceived: 0,
        totalMatched: 0,
        totalUnmatched: 0,
        lastCheckAt: null,
        checksCount: 0,
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
        if (!this.data.receivedEmails) this.data.receivedEmails = [];
        if (!this.data.matchedReplies) this.data.matchedReplies = [];
        console.log('[inbox-manager-storage] Base chargee (' + this.data.matchedReplies.length + ' replies matchees)');
      } else {
        console.log('[inbox-manager-storage] Nouvelle base creee');
        this._save();
      }
    } catch (e) {
      console.error('[inbox-manager-storage] Erreur chargement:', e.message);
    }
  }

  _save() {
    try {
      atomicWriteSync(DB_FILE, this.data);
    } catch (e) {
      console.error('[inbox-manager-storage] Erreur sauvegarde:', e.message);
    }
  }

  getConfig() {
    return { ...this.data.config };
  }

  updateConfig(updates) {
    Object.assign(this.data.config, updates);
    this._save();
    return this.data.config;
  }

  // Enregistrer un email recu
  addReceivedEmail(emailData) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const entry = {
      id,
      from: emailData.from || '',
      to: emailData.to || '',
      subject: emailData.subject || '',
      date: emailData.date || new Date().toISOString(),
      snippet: (emailData.text || '').substring(0, 500),
      matchedLead: emailData.matchedLead || null,
      processedAt: new Date().toISOString(),
      sentiment: emailData.sentiment || null,
      sentimentScore: emailData.sentimentScore || null,
      sentimentReason: emailData.sentimentReason || null,
      actionTaken: emailData.actionTaken || null
    };

    this.data.receivedEmails.push(entry);
    this.data.stats.totalReceived++;

    // Garder max 500 emails
    if (this.data.receivedEmails.length > 500) {
      this.data.receivedEmails = this.data.receivedEmails.slice(-500);
    }

    if (entry.matchedLead) {
      this.data.matchedReplies.push(entry);
      this.data.stats.totalMatched++;
      // Garder max 200 replies matchees
      if (this.data.matchedReplies.length > 200) {
        this.data.matchedReplies = this.data.matchedReplies.slice(-200);
      }
    } else {
      this.data.stats.totalUnmatched++;
    }

    this._save();
    return entry;
  }

  // Verifier si un email a deja ete traite (par message-id ou uid)
  isEmailProcessed(uid) {
    return this.data.receivedEmails.some(e => e.uid === uid);
  }

  addProcessedUid(uid) {
    // UIDs stockes en array (JSON-serialisable) mais lookup via Set en memoire
    if (!this.data._processedUids) this.data._processedUids = [];
    if (!this._uidSet) this._uidSet = new Set(this.data._processedUids);
    if (!this._uidSet.has(uid)) {
      this.data._processedUids.push(uid);
      this._uidSet.add(uid);
      // Garder les 2000 derniers UIDs
      if (this.data._processedUids.length > 2000) {
        this.data._processedUids = this.data._processedUids.slice(-2000);
        this._uidSet = new Set(this.data._processedUids);
      }
      this._save();
    }
  }

  isUidProcessed(uid) {
    if (!this._uidSet) {
      this._uidSet = new Set(this.data._processedUids || []);
    }
    return this._uidSet.has(uid);
  }

  recordCheck() {
    this.data.stats.lastCheckAt = new Date().toISOString();
    this.data.stats.checksCount++;
    this.data.config.lastCheckedAt = new Date().toISOString();
    this._save();
  }

  getStats() {
    return { ...this.data.stats };
  }

  getRecentReplies(limit) {
    limit = limit || 10;
    return this.data.matchedReplies.slice(-limit).reverse();
  }

  getRecentEmails(limit) {
    limit = limit || 20;
    return this.data.receivedEmails.slice(-limit).reverse();
  }

  updateEmailSentiment(emailId, sentimentData) {
    const email = this.data.receivedEmails.find(e => e.id === emailId);
    if (!email) return null;
    if (sentimentData.sentiment) email.sentiment = sentimentData.sentiment;
    if (sentimentData.score != null) email.sentimentScore = sentimentData.score;
    if (sentimentData.reason) email.sentimentReason = sentimentData.reason;
    if (sentimentData.actionTaken) email.actionTaken = sentimentData.actionTaken;
    const reply = this.data.matchedReplies.find(e => e.id === emailId);
    if (reply) {
      reply.sentiment = email.sentiment;
      reply.sentimentScore = email.sentimentScore;
      reply.actionTaken = email.actionTaken;
    }
    this._save();
    return email;
  }

  // Cherche le plus recent email d'un sender et update son sentiment
  updateSentimentByEmail(senderEmail, sentimentData) {
    const emailLower = (senderEmail || '').toLowerCase();
    // Chercher dans toute la liste (du plus recent au plus ancien)
    for (let i = this.data.receivedEmails.length - 1; i >= 0; i--) {
      const e = this.data.receivedEmails[i];
      if (e.from && e.from.toLowerCase() === emailLower) {
        return this.updateEmailSentiment(e.id, sentimentData);
      }
    }
    return null;
  }

  getSentimentBreakdown() {
    const breakdown = { interested: 0, question: 0, not_interested: 0, out_of_office: 0, bounce: 0, unclassified: 0 };
    for (const reply of this.data.matchedReplies) {
      const s = reply.sentiment || 'unclassified';
      if (breakdown[s] !== undefined) breakdown[s]++;
      else breakdown.unclassified++;
    }
    return breakdown;
  }
}

module.exports = new InboxManagerStorage();
