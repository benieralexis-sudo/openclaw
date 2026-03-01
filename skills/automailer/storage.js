// AutoMailer - Stockage persistant JSON
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../../gateway/utils.js');

const DATA_DIR = process.env.AUTOMAILER_DATA_DIR || '/data/automailer';
const DB_FILE = path.join(DATA_DIR, 'automailer-db.json');

class AutoMailerStorage {
  constructor() {
    this.data = {
      users: {},
      contactLists: {},
      templates: {},
      campaigns: {},
      emails: [],
      blacklist: {},
      stats: {
        totalCampaigns: 0,
        totalEmailsSent: 0,
        totalEmailsDelivered: 0,
        totalEmailsOpened: 0,
        totalEmailsBounced: 0,
        totalContactsImported: 0,
        totalTemplatesCreated: 0,
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
      console.error('[automailer-storage] Impossible de creer ' + DATA_DIR + ':', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const loaded = JSON.parse(raw);
        this.data = { ...this.data, ...loaded };
        console.log('[automailer-storage] Base chargee (' +
          Object.keys(this.data.users).length + ' utilisateurs, ' +
          Object.keys(this.data.campaigns).length + ' campagnes, ' +
          this.data.emails.length + ' emails)');
      } else {
        console.log('[automailer-storage] Nouvelle base creee');
        this._save();
      }
    } catch (e) {
      console.error('[automailer-storage] Erreur chargement (fichier corrompu?):', e.message);
      // Backup du fichier corrompu et reset aux defaults
      try { if (fs.existsSync(DB_FILE)) fs.renameSync(DB_FILE, DB_FILE + '.corrupt.' + Date.now()); } catch (_) {}
      this._save();
    }
  }

  _save() {
    try {
      atomicWriteSync(DB_FILE, this.data);
    } catch (e) {
      console.error('[automailer-storage] Erreur sauvegarde:', e.message);
    }
  }

  // Public save (pour appel cross-skill)
  save() {
    this._save();
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
        name: null,
        preferences: {
          defaultSender: process.env.SENDER_EMAIL || 'onboarding@resend.dev',
          signature: '',
          language: 'fr'
        },
        campaignCount: 0,
        emailsSent: 0,
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

  // --- Listes de contacts ---

  createContactList(chatId, name) {
    const id = 'lst_' + this._generateId();
    this.data.contactLists[id] = {
      id: id,
      chatId: String(chatId),
      name: name,
      contacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this._save();
    return this.data.contactLists[id];
  }

  getContactList(listId) {
    return this.data.contactLists[listId] || null;
  }

  getContactLists(chatId) {
    const id = String(chatId);
    return Object.values(this.data.contactLists).filter(l => l.chatId === id);
  }

  addContactToList(listId, contact) {
    const list = this.data.contactLists[listId];
    if (!list) return null;
    // Eviter les doublons par email
    const exists = list.contacts.find(c => c.email === contact.email);
    if (exists) return exists;
    const entry = {
      email: contact.email,
      name: contact.name || '',
      firstName: contact.firstName || '',
      lastName: contact.lastName || '',
      company: contact.company || '',
      title: contact.title || '',
      addedAt: new Date().toISOString()
    };
    list.contacts.push(entry);
    list.updatedAt = new Date().toISOString();
    this.data.stats.totalContactsImported++;
    this._save();
    return entry;
  }

  removeContactFromList(listId, email) {
    const list = this.data.contactLists[listId];
    if (!list) return false;
    const before = list.contacts.length;
    list.contacts = list.contacts.filter(c => c.email !== email);
    if (list.contacts.length < before) {
      list.updatedAt = new Date().toISOString();
      this._save();
      return true;
    }
    return false;
  }

  findContactListByName(chatId, name) {
    const id = String(chatId);
    const lower = name.toLowerCase();
    return Object.values(this.data.contactLists).find(
      l => l.chatId === id && l.name.toLowerCase() === lower
    ) || null;
  }

  // --- Templates ---

  createTemplate(chatId, name, subject, body) {
    const id = 'tpl_' + this._generateId();
    // Detecter les variables {{...}}
    const vars = [];
    const regex = /\{\{(\w+)\}\}/g;
    let match;
    const combined = (subject || '') + ' ' + (body || '');
    while ((match = regex.exec(combined)) !== null) {
      if (vars.indexOf(match[1]) === -1) vars.push(match[1]);
    }
    this.data.templates[id] = {
      id: id,
      chatId: String(chatId),
      name: name,
      subject: subject,
      body: body,
      variables: vars,
      createdAt: new Date().toISOString()
    };
    this.data.stats.totalTemplatesCreated++;
    this._save();
    return this.data.templates[id];
  }

  getTemplate(templateId) {
    return this.data.templates[templateId] || null;
  }

  getTemplates(chatId) {
    const id = String(chatId);
    return Object.values(this.data.templates).filter(t => t.chatId === id);
  }

  deleteTemplate(templateId) {
    if (this.data.templates[templateId]) {
      delete this.data.templates[templateId];
      this._save();
      return true;
    }
    return false;
  }

  // --- Campagnes ---

  createCampaign(chatId, config) {
    const id = 'cmp_' + this._generateId();
    this.data.campaigns[id] = {
      id: id,
      chatId: String(chatId),
      name: config.name || 'Campagne sans nom',
      status: 'draft',
      contactListId: config.contactListId || null,
      steps: config.steps || [],
      totalContacts: config.totalContacts || 0,
      currentStep: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null
    };
    this.data.stats.totalCampaigns++;
    const user = this.getUser(chatId);
    user.campaignCount++;
    this._save();
    return this.data.campaigns[id];
  }

  getCampaign(campaignId) {
    return this.data.campaigns[campaignId] || null;
  }

  getCampaigns(chatId) {
    const id = String(chatId);
    return Object.values(this.data.campaigns).filter(c => c.chatId === id);
  }

  updateCampaign(campaignId, updates) {
    const campaign = this.data.campaigns[campaignId];
    if (!campaign) return null;
    Object.assign(campaign, updates);
    this._save();
    return campaign;
  }

  // --- Emails ---

  addEmail(record) {
    const entry = {
      id: 'eml_' + this._generateId(),
      resendId: record.resendId || null,
      trackingId: record.trackingId || null,
      messageId: record.messageId || null,
      chatId: String(record.chatId || ''),
      campaignId: record.campaignId || null,
      stepNumber: record.stepNumber || null,
      from: record.from || process.env.REPLY_TO_EMAIL || 'hello@ifind.fr',
      to: record.to,
      subject: record.subject,
      body: record.body || '',
      contactName: record.contactName || '',
      company: record.company || '',
      score: record.score || 0,
      source: record.source || 'manual',
      status: record.status || 'queued',
      lastEvent: record.status || 'queued',
      sentAt: record.status === 'sent' ? new Date().toISOString() : null,
      deliveredAt: null,
      openedAt: null,
      abVariant: record.abVariant || null,
      senderDomain: record.senderDomain || null,
      createdAt: new Date().toISOString()
    };
    this.data.emails.push(entry);
    // Garder max 10000 emails actifs (archivage auto des >90j)
    if (this.data.emails.length > 10000) {
      this.data.emails = this.data.emails.slice(-10000);
    }
    if (record.status === 'sent') {
      this.data.stats.totalEmailsSent++;
      const user = this.getUser(record.chatId);
      user.emailsSent++;
    }
    this._save();
    return entry;
  }

  updateEmailStatus(emailId, status, eventData) {
    const email = this.data.emails.find(e => e.id === emailId);
    if (!email) return null;
    email.status = status;
    email.lastEvent = status;
    if (status === 'delivered') {
      email.deliveredAt = new Date().toISOString();
      this.data.stats.totalEmailsDelivered++;
    } else if (status === 'opened') {
      email.openedAt = new Date().toISOString();
      this.data.stats.totalEmailsOpened++;
    } else if (status === 'bounced') {
      this.data.stats.totalEmailsBounced++;
    }
    if (eventData) Object.assign(email, eventData);
    this._save();
    return email;
  }

  findEmailByResendId(resendId) {
    return this.data.emails.find(e => e.resendId === resendId) || null;
  }

  findEmailByTrackingId(trackingId) {
    return this.data.emails.find(e => e.trackingId === trackingId) || null;
  }

  getEmailsByCampaign(campaignId) {
    return this.data.emails.filter(e => e.campaignId === campaignId);
  }

  getRecentEmails(chatId, limit) {
    limit = limit || 20;
    return this.data.emails
      .filter(e => e.chatId === String(chatId))
      .slice(-limit);
  }

  // --- Blacklist ---

  addToBlacklist(email, reason) {
    if (!this.data.blacklist) this.data.blacklist = {};
    const key = email.toLowerCase().trim();
    this.data.blacklist[key] = {
      email: key,
      reason: reason || 'unknown',
      addedAt: new Date().toISOString()
    };
    this._save();
    return this.data.blacklist[key];
  }

  isBlacklisted(email) {
    if (!this.data.blacklist) return false;
    return !!this.data.blacklist[email.toLowerCase().trim()];
  }

  getBlacklist() {
    if (!this.data.blacklist) return [];
    return Object.values(this.data.blacklist);
  }

  removeFromBlacklist(email) {
    if (!this.data.blacklist) return false;
    const key = (email || '').toLowerCase().trim();
    if (this.data.blacklist[key]) {
      delete this.data.blacklist[key];
      this._save();
      return true;
    }
    return false;
  }

  isHardBlacklisted(email) {
    if (!this.data.blacklist) return false;
    const entry = this.data.blacklist[(email || '').toLowerCase().trim()];
    if (!entry) return false;
    const hardReasons = ['bounce_detected', 'spam_complaint', 'permanent_block', 'rgpd', 'ne_me_contactez_plus'];
    return hardReasons.some(r => (entry.reason || '').toLowerCase().includes(r));
  }

  getMessageIdForRecipient(recipientEmail) {
    const emailLower = (recipientEmail || '').toLowerCase();
    if (!emailLower) return null;
    const emails = this.data.emails.filter(e => (e.to || '').toLowerCase() === emailLower && e.messageId);
    if (emails.length === 0) return null;
    return emails[emails.length - 1].messageId;
  }

  // --- Warmup tracking ---

  getFirstSendDate() {
    if (!this.data.stats || !this.data.stats.firstSendDate) return null;
    return this.data.stats.firstSendDate;
  }

  setFirstSendDate() {
    if (!this.data.stats.firstSendDate) {
      this.data.stats.firstSendDate = new Date().toISOString();
      this._save();
    }
  }

  getTodaySendCount() {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (!this.data.stats.dailySends) this.data.stats.dailySends = {};
    return this.data.stats.dailySends[today] || 0;
  }

  incrementTodaySendCount() {
    const today = new Date().toISOString().slice(0, 10);
    if (!this.data.stats.dailySends) this.data.stats.dailySends = {};
    this.data.stats.dailySends[today] = (this.data.stats.dailySends[today] || 0) + 1;
    // Nettoyer les vieux jours (garder 30 derniers)
    const keys = Object.keys(this.data.stats.dailySends).sort();
    while (keys.length > 30) {
      delete this.data.stats.dailySends[keys.shift()];
    }
    this._save();
  }

  // --- Reply tracking ---

  markAsReplied(emailId) {
    const email = this.data.emails.find(e => e.id === emailId);
    if (!email) return null;
    email.hasReplied = true;
    email.repliedAt = new Date().toISOString();
    email.status = 'replied';
    email.lastEvent = 'replied';
    this._save();
    return email;
  }

  getRepliedEmails(campaignId) {
    return this.data.emails.filter(e => {
      if (campaignId && e.campaignId !== campaignId) return false;
      return e.hasReplied === true || e.status === 'replied';
    });
  }

  getHotLeads() {
    // Aggreger les events par destinataire
    const byRecipient = {};
    for (const email of this.data.emails) {
      const to = (email.to || '').toLowerCase();
      if (!to) continue;
      if (!byRecipient[to]) {
        byRecipient[to] = { email: to, opens: 0, clicks: 0, replied: false, bounced: false, complained: false, sentAt: null, openedAt: null };
      }
      const r = byRecipient[to];
      if (email.status === 'opened' || email.openedAt) r.opens++;
      if (email.status === 'clicked' || email.clickedAt) r.clicks++;
      if (email.hasReplied || email.status === 'replied') r.replied = true;
      if (email.status === 'bounced') r.bounced = true;
      if (email.status === 'complained') r.complained = true;
      if (email.sentAt && (!r.sentAt || email.sentAt < r.sentAt)) r.sentAt = email.sentAt;
      if (email.openedAt && (!r.openedAt || email.openedAt < r.openedAt)) r.openedAt = email.openedAt;
    }

    // Filtrer les hot leads : opens >= 3 OU clicks >= 1 OU replied
    return Object.values(byRecipient).filter(r => {
      if (r.bounced || r.complained) return false;
      return r.opens >= 3 || r.clicks >= 1 || r.replied;
    }).sort((a, b) => {
      // Trier par engagement decroissant
      const scoreA = (a.replied ? 10 : 0) + a.clicks * 3 + a.opens;
      const scoreB = (b.replied ? 10 : 0) + b.clicks * 3 + b.opens;
      return scoreB - scoreA;
    });
  }

  // Obtenir les evenements email pour un destinataire specifique (cross-skill)
  getEmailEventsForRecipient(recipientEmail) {
    const email = (recipientEmail || '').toLowerCase();
    if (!email) return [];
    return this.data.emails.filter(e => (e.to || '').toLowerCase() === email);
  }

  // --- Archivage auto (emails > 90 jours) ---

  archiveOldEmails() {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 jours
    const toArchive = this.data.emails.filter(e => {
      const ts = e.sentAt || e.createdAt;
      return ts && new Date(ts).getTime() < cutoff;
    });
    if (toArchive.length === 0) return 0;

    // Charger l'archive existante
    const archiveFile = path.join(DATA_DIR, 'automailer-archive.json');
    let archive = [];
    try {
      if (fs.existsSync(archiveFile)) {
        archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
      }
    } catch (e) {
      console.error('[automailer-storage] Erreur lecture archive:', e.message);
    }

    // Ajouter les emails a archiver
    archive.push(...toArchive);
    // Garder max 50000 emails en archive
    if (archive.length > 50000) {
      archive = archive.slice(-50000);
    }

    // Sauvegarder l'archive
    try {
      atomicWriteSync(archiveFile, archive);
    } catch (e) {
      console.error('[automailer-storage] Erreur sauvegarde archive:', e.message);
      return 0;
    }

    // Retirer les emails archives de la base active
    const archivedIds = new Set(toArchive.map(e => e.id));
    this.data.emails = this.data.emails.filter(e => !archivedIds.has(e.id));
    this._save();

    console.log('[automailer-storage] Archive: ' + toArchive.length + ' emails > 90j deplaces (reste ' + this.data.emails.length + ' actifs, ' + archive.length + ' archives)');
    return toArchive.length;
  }

  getArchivedEmails(limit) {
    const archiveFile = path.join(DATA_DIR, 'automailer-archive.json');
    try {
      if (fs.existsSync(archiveFile)) {
        const archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
        return limit ? archive.slice(-limit) : archive;
      }
    } catch (e) {}
    return [];
  }

  getArchiveStats() {
    const archiveFile = path.join(DATA_DIR, 'automailer-archive.json');
    try {
      if (fs.existsSync(archiveFile)) {
        const archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
        return {
          count: archive.length,
          oldestDate: archive.length > 0 ? (archive[0].sentAt || archive[0].createdAt) : null,
          newestDate: archive.length > 0 ? (archive[archive.length - 1].sentAt || archive[archive.length - 1].createdAt) : null
        };
      }
    } catch (e) {}
    return { count: 0, oldestDate: null, newestDate: null };
  }

  // --- Retry queue helpers ---

  getFailedEmailsForRetry(maxRetries) {
    maxRetries = maxRetries || 3;
    return this.data.emails.filter(e => {
      if (e.status !== 'failed') return false;
      if ((e.retryCount || 0) >= maxRetries) return false;
      // Backoff: attendre 5min * 2^retryCount avant de retenter
      if (e.lastRetryAt) {
        const backoff = 5 * 60 * 1000 * Math.pow(2, e.retryCount || 0);
        if (Date.now() - new Date(e.lastRetryAt).getTime() < backoff) return false;
      }
      return true;
    });
  }

  markRetryAttempt(emailId, success, newResendId) {
    const email = this.data.emails.find(e => e.id === emailId);
    if (!email) return null;
    email.retryCount = (email.retryCount || 0) + 1;
    email.lastRetryAt = new Date().toISOString();
    if (success) {
      email.status = 'sent';
      email.sentAt = new Date().toISOString();
      if (newResendId) email.resendId = newResendId;
      this.data.stats.totalEmailsSent++;
      const user = this.getUser(email.chatId);
      user.emailsSent++;
    }
    this._save();
    return email;
  }

  // --- A/B Testing ---

  recordABVariant(emailId, variant) {
    const email = this.data.emails.find(e => e.id === emailId);
    if (!email) return null;
    email.abVariant = variant;
    this._save();
    return email;
  }

  getABTestResults(campaignId, stepNumber) {
    const emails = this.getEmailsByCampaign(campaignId)
      .filter(e => e.abVariant && (stepNumber ? e.stepNumber === stepNumber : true));

    // Construire dynamiquement les stats par variant (A, B, C...)
    const variants = {};
    for (const email of emails) {
      const v = email.abVariant;
      if (!variants[v]) variants[v] = { sent: 0, delivered: 0, opened: 0, replied: 0, bounced: 0 };
      variants[v].sent++;
      if (['delivered', 'opened'].includes(email.status) || email.deliveredAt) variants[v].delivered++;
      if (email.status === 'opened' || email.openedAt) variants[v].opened++;
      if (email.status === 'replied' || email.hasReplied) variants[v].replied++;
      if (email.status === 'bounced') variants[v].bounced++;
    }

    // Calculer les taux pour chaque variant
    for (const v of Object.keys(variants)) {
      const s = variants[v];
      s.openRate = s.delivered > 0 ? Math.round((s.opened / s.delivered) * 100) : 0;
      s.replyRate = s.sent > 0 ? Math.round((s.replied / s.sent) * 100) : 0;
    }

    // Determiner le winner (meilleur open rate)
    const variantKeys = Object.keys(variants);
    let winner = variantKeys[0] || 'A';
    for (const v of variantKeys) {
      if ((variants[v].openRate || 0) > (variants[winner].openRate || 0)) winner = v;
    }

    // Retrocompat : exposer A et B directement
    const results = {
      ...variants,
      A: variants.A || { sent: 0, delivered: 0, opened: 0, replied: 0, bounced: 0, openRate: 0, replyRate: 0 },
      B: variants.B || { sent: 0, delivered: 0, opened: 0, replied: 0, bounced: 0, openRate: 0, replyRate: 0 },
      variants,
      winner,
      totalEmails: emails.length,
      numVariants: variantKeys.length
    };

    return results;
  }

  // --- Stats dashboard ---

  getGlobalStats() {
    const users = Object.values(this.data.users);
    const campaigns = Object.values(this.data.campaigns);
    return {
      ...this.data.stats,
      activeUsers: users.length,
      activeCampaigns: campaigns.filter(c => c.status === 'active').length,
      completedCampaigns: campaigns.filter(c => c.status === 'completed').length,
      totalContacts: Object.values(this.data.contactLists)
        .reduce((sum, l) => sum + l.contacts.length, 0),
      totalLists: Object.keys(this.data.contactLists).length,
      recentEmails: this.data.emails.slice(-50),
      topUsers: users
        .sort((a, b) => b.emailsSent - a.emailsSent)
        .slice(0, 10)
        .map(u => ({ name: u.name, chatId: u.chatId, emails: u.emailsSent, lastActive: u.lastActiveAt }))
    };
  }

  getAllCampaigns() { return Object.values(this.data.campaigns); }
  getAllContactLists() { return Object.values(this.data.contactLists); }
  getAllTemplates() { return Object.values(this.data.templates); }
  getAllEmails() { return this.data.emails; }
  getAllUsers() { return Object.values(this.data.users); }

  // --- Lead Revival candidates ---

  getRevivalCandidates(options) {
    options = options || {};
    const minDaysOpened = options.minDaysOpened || 30;
    const minDaysNotNow = options.minDaysNotNow || 45;
    const minDaysHotStale = options.minDaysHotStale || 21;
    const cutoffOpened = Date.now() - minDaysOpened * 24 * 60 * 60 * 1000;
    const cutoffNotNow = Date.now() - minDaysNotNow * 24 * 60 * 60 * 1000;
    const cutoffHot = Date.now() - minDaysHotStale * 24 * 60 * 60 * 1000;
    const candidates = [];

    // Grouper emails par destinataire
    const byRecipient = {};
    for (const email of this.data.emails) {
      const to = (email.to || '').toLowerCase();
      if (!to) continue;
      if (!byRecipient[to]) byRecipient[to] = [];
      byRecipient[to].push(email);
    }

    for (const [recipientEmail, emails] of Object.entries(byRecipient)) {
      // Skip si deja repondu
      if (emails.some(e => e.hasReplied || e.status === 'replied')) continue;
      // Skip si bounce
      if (emails.some(e => e.status === 'bounced')) continue;
      // Skip si hard blacklist
      if (this.isHardBlacklisted(recipientEmail)) continue;

      const openedEmails = emails.filter(e => e.openedAt);
      const openCount = openedEmails.length;
      const lastSent = emails.filter(e => e.sentAt).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))[0];
      const lastSentAt = lastSent ? new Date(lastSent.sentAt).getTime() : 0;

      // Cat A: Ouvert mais jamais repondu, >30 jours
      if (openCount >= 1 && lastSentAt > 0 && lastSentAt < cutoffOpened) {
        candidates.push({
          email: recipientEmail,
          name: (lastSent && lastSent.contactName) || '',
          company: (lastSent && lastSent.company) || '',
          reason: 'opened_no_reply',
          openCount: openCount,
          lastContactAt: lastSent.sentAt
        });
        continue;
      }

      // Cat B: Sentiment "not now" (score 0.15-0.25), >45 jours
      const sentiment = this.getSentiment(recipientEmail);
      if (sentiment && sentiment.sentiment === 'not_interested' && sentiment.score >= 0.15 && sentiment.score <= 0.25) {
        const sentimentTime = new Date(sentiment.updatedAt).getTime();
        if (sentimentTime > 0 && sentimentTime < cutoffNotNow) {
          candidates.push({
            email: recipientEmail,
            name: (lastSent && lastSent.contactName) || '',
            company: (lastSent && lastSent.company) || '',
            reason: 'not_now_expired',
            openCount: openCount,
            lastContactAt: sentiment.updatedAt
          });
          continue;
        }
      }

      // Cat C: 3+ ouvertures, >21 jours, pas de RDV (hot lead stagnant)
      if (openCount >= 3 && lastSentAt > 0 && lastSentAt < cutoffHot) {
        candidates.push({
          email: recipientEmail,
          name: (lastSent && lastSent.contactName) || '',
          company: (lastSent && lastSent.company) || '',
          reason: 'hot_lead_stale',
          openCount: openCount,
          lastContactAt: lastSent.sentAt
        });
      }
    }

    // Trier par openCount decroissant (les plus engages en premier)
    return candidates.sort((a, b) => b.openCount - a.openCount);
  }

  // --- Sentiment (cross-skill : inbox-manager → campaign-engine) ---

  setSentiment(email, sentiment, score) {
    if (!this.data._sentiments) this.data._sentiments = {};
    const key = (email || '').toLowerCase().trim();
    if (!key) return;
    this.data._sentiments[key] = {
      sentiment: sentiment,
      score: score || 0,
      updatedAt: new Date().toISOString()
    };
    this._save();
  }

  getSentiment(email) {
    if (!this.data._sentiments) return null;
    const key = (email || '').toLowerCase().trim();
    return this.data._sentiments[key] || null;
  }
}

module.exports = new AutoMailerStorage();
