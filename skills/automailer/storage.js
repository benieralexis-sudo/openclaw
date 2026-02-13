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
      console.error('[automailer-storage] Erreur chargement:', e.message);
    }
  }

  _save() {
    try {
      atomicWriteSync(DB_FILE, this.data);
    } catch (e) {
      console.error('[automailer-storage] Erreur sauvegarde:', e.message);
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
      chatId: String(record.chatId),
      campaignId: record.campaignId || null,
      stepNumber: record.stepNumber || null,
      from: record.from || 'onboarding@resend.dev',
      to: record.to,
      subject: record.subject,
      body: record.body || '',
      status: record.status || 'queued',
      lastEvent: record.status || 'queued',
      sentAt: record.status === 'sent' ? new Date().toISOString() : null,
      deliveredAt: null,
      openedAt: null,
      createdAt: new Date().toISOString()
    };
    this.data.emails.push(entry);
    // Garder max 2000 emails
    if (this.data.emails.length > 2000) {
      this.data.emails = this.data.emails.slice(-2000);
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

  getEmailsByCampaign(campaignId) {
    return this.data.emails.filter(e => e.campaignId === campaignId);
  }

  getRecentEmails(chatId, limit) {
    limit = limit || 20;
    return this.data.emails
      .filter(e => e.chatId === String(chatId))
      .slice(-limit);
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
}

module.exports = new AutoMailerStorage();
