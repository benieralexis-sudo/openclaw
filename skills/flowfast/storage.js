// FlowFast - Stockage persistant JSON
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../../gateway/utils.js');

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
        this._deduplicateLeads();
        console.log('[storage] Base chargee (' + Object.keys(this.data.users).length + ' utilisateurs, ' + this.data.searches.length + ' recherches, ' + Object.keys(this.data.leads || {}).length + ' leads)');
      } else {
        console.log('[storage] Nouvelle base creee');
        this._save();
      }
    } catch (e) {
      console.error('[storage] Erreur chargement (fichier corrompu?):', e.message);
      try { if (fs.existsSync(DB_FILE)) fs.renameSync(DB_FILE, DB_FILE + '.corrupt.' + Date.now()); } catch (_) {}
      this._save();
    }
  }

  _save() {
    try {
      atomicWriteSync(DB_FILE, this.data);
    } catch (e) {
      console.error('[storage] Erreur sauvegarde:', e.message);
    }
  }

  // Supprime les doublons nom_entreprise quand une entree email existe
  _deduplicateLeads() {
    if (!this.data.leads) return;
    const leads = this.data.leads;
    const emailLeads = {}; // entreprise -> lead avec email
    let removed = 0;

    // Indexer les leads qui ont un email
    for (const [key, lead] of Object.entries(leads)) {
      if (lead.email && lead.entreprise) {
        const ent = lead.entreprise.toLowerCase().trim();
        if (!emailLeads[ent]) emailLeads[ent] = [];
        emailLeads[ent].push(key);
      }
    }

    // Supprimer les entrees nom_entreprise si une entree email existe pour la meme entreprise
    for (const [key, lead] of Object.entries(leads)) {
      if (!lead.email && lead.entreprise) {
        const ent = lead.entreprise.toLowerCase().trim();
        if (emailLeads[ent] && emailLeads[ent].length > 0) {
          delete leads[key];
          removed++;
        }
      }
    }

    if (removed > 0) {
      console.log('[storage] Deduplication: ' + removed + ' doublons supprimes');
      this._save();
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

    // Deduplication : si on ajoute avec email, supprimer l'ancienne entree nom_entreprise
    if (lead.email && lead.nom && lead.entreprise) {
      const oldKey = lead.nom + '_' + lead.entreprise;
      if (this.data.leads[oldKey] && !this.data.leads[key]) {
        // Merger les donnees de l'ancienne entree
        const old = this.data.leads[oldKey];
        lead = { ...old, ...lead }; // Nouvelles donnees prioritaires
        if (old.feedback) lead.feedback = old.feedback;
        if (old.pushedToHubspot) lead.pushedToHubspot = true;
        if (old._emailSent) lead._emailSent = true;
        delete this.data.leads[oldKey];
      }
    }

    // Normaliser score si > 10 (ex: imports Clay qui utilisent une echelle /100)
    let adjustedScore = (typeof score === 'number' && score > 10) ? Math.round(score / 10) : score;
    // Penalite score pour donnees manquantes
    if (!lead.email) adjustedScore = Math.min(adjustedScore, 7); // Pas d'email = max 7
    if (!lead.linkedin && !lead.linkedinUrl && !lead.linkedin_url) adjustedScore = Math.max(0, adjustedScore - 0.5);

    this.data.leads[key] = {
      ...lead,
      score: adjustedScore,
      searchId: searchId,
      feedback: (lead.feedback !== undefined) ? lead.feedback : null,
      pushedToHubspot: lead.pushedToHubspot || false,
      createdAt: lead.createdAt || new Date().toISOString()
    };
    // Cap a 5000 leads — supprimer les plus anciens si depasse
    const MAX_LEADS = 5000;
    const leadKeys = Object.keys(this.data.leads);
    if (leadKeys.length > MAX_LEADS) {
      const sorted = leadKeys
        .map(k => ({ key: k, createdAt: this.data.leads[k].createdAt || '' }))
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      const toRemove = sorted.slice(0, leadKeys.length - MAX_LEADS);
      for (const item of toRemove) delete this.data.leads[item.key];
      console.log('[storage] Leads cap: ' + toRemove.length + ' anciens leads supprimes');
    }
    this._save();
    return this.data.leads[key];
  }

  // Cherche la cle d'un lead par email (exact key OU valeur .email dans les leads)
  _findLeadKeyByEmail(email) {
    if (!email) return null;
    const normalized = email.toLowerCase().trim();
    // 1. Exact key match
    if (this.data.leads[email]) return email;
    if (this.data.leads[normalized]) return normalized;
    // 2. Search by email value in all leads
    for (const [key, lead] of Object.entries(this.data.leads)) {
      if (lead.email && lead.email.toLowerCase().trim() === normalized) return key;
    }
    return null;
  }

  setLeadFeedback(email, feedback) {
    const key = this._findLeadKeyByEmail(email);
    if (key) {
      this.data.leads[key].feedback = feedback;
      this._save();
    }
  }

  setLeadPushed(email) {
    const key = this._findLeadKeyByEmail(email);
    if (key) {
      this.data.leads[key].pushedToHubspot = true;
      this.data.leads[key].pushedAt = new Date().toISOString();
      this._save();
      console.log('[storage] Lead marque pushedToHubspot: ' + email + ' (cle: ' + key + ')');
      return true;
    }
    console.warn('[storage] setLeadPushed: lead non trouve pour ' + email);
    return false;
  }

  isLeadKnown(email) {
    return !!this._findLeadKeyByEmail(email);
  }

  removeLead(key) {
    if (this.data.leads[key]) {
      delete this.data.leads[key];
      this._save();
    }
  }

  markEmailSent(email) {
    const key = this._findLeadKeyByEmail(email);
    if (key) {
      this.data.leads[key]._emailSent = true;
      this.data.leads[key]._emailSentAt = new Date().toISOString();
      this._save();
      console.log('[storage] Lead marque emailSent: ' + email + ' (cle: ' + key + ')');
      return true;
    }
    console.warn('[storage] markEmailSent: lead non trouve pour ' + email);
    return false;
  }

  updateLeadScore(key, newScore, reason) {
    if (!this.data.leads[key]) return null;
    const lead = this.data.leads[key];
    const oldScore = lead.score || 0;
    lead.score = Math.min(10, Math.max(0, newScore));
    if (!lead.scoreHistory) lead.scoreHistory = [];
    lead.scoreHistory.push({ from: oldScore, to: lead.score, reason: reason, at: new Date().toISOString() });
    if (lead.scoreHistory.length > 20) lead.scoreHistory = lead.scoreHistory.slice(-20);
    // Persister _processedSignals si present (evite perte au restart)
    if (lead._processedSignals) {
      // deja sur l'objet lead, sera sauvegarde avec _save()
    }
    this._save();
    return lead;
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

  // --- Job Change Detection ---

  // Retourne les leads qui ont un apolloId (enrichis via Apollo reveal)
  // Filtre optionnel : seulement les leads actifs (email envoye, score >= seuil)
  getLeadsWithApolloId(options) {
    options = options || {};
    const maxResults = options.maxResults || 50;
    const onlyActive = options.onlyActive !== false; // defaut: true
    const maxDaysSinceContact = options.maxDaysSinceContact || 90;
    const cutoffDate = new Date(Date.now() - maxDaysSinceContact * 24 * 60 * 60 * 1000).toISOString();

    const results = [];
    for (const [key, lead] of Object.entries(this.data.leads)) {
      if (!lead.apolloId) continue;
      if (!lead.email) continue;
      if (onlyActive) {
        // Seulement les leads contactes (email envoye) et pas trop anciens
        if (!lead._emailSent && !lead._emailSentAt) continue;
        const contactDate = lead._emailSentAt || lead.createdAt;
        if (contactDate && contactDate < cutoffDate) continue;
      }
      // Dedup: skip les leads deja checks dans les 6 derniers jours
      if (lead._lastApolloCheck) {
        const minInterval = (options.minDaysBetweenChecks || 6) * 24 * 60 * 60 * 1000;
        if (Date.now() - new Date(lead._lastApolloCheck).getTime() < minInterval) continue;
      }
      results.push({
        email: lead.email,
        apolloId: lead.apolloId,
        firstName: lead.first_name || (lead.nom || '').split(' ')[0] || '',
        lastName: lead.last_name || (lead.nom || '').split(' ').slice(1).join(' ') || '',
        currentTitle: lead.titre || lead.title || '',
        currentCompany: lead.entreprise || (lead.organization && lead.organization.name) || '',
        score: lead.score || 0,
        lastContact: lead._emailSentAt || lead.createdAt || ''
      });
      if (results.length >= maxResults) break;
    }
    return results;
  }

  // Met a jour le snapshot Apollo d'un lead et stocke l'historique du changement
  updateLeadApolloSnapshot(email, oldData, newData) {
    const key = this._findLeadKeyByEmail(email);
    if (!key) return null;
    const lead = this.data.leads[key];

    // Stocker le changement dans l'historique
    if (!lead._apolloHistory) lead._apolloHistory = [];
    lead._apolloHistory.push({
      detectedAt: new Date().toISOString(),
      old: { title: oldData.title || '', company: oldData.company || '' },
      new: { title: newData.title || '', company: newData.company || '' }
    });
    if (lead._apolloHistory.length > 10) lead._apolloHistory = lead._apolloHistory.slice(-10);

    // Mettre a jour les champs actuels
    if (newData.title) {
      lead.titre = newData.title;
      lead.title = newData.title;
    }
    if (newData.company) {
      lead.entreprise = newData.company;
    }
    if (newData.linkedinUrl) {
      lead.linkedin_url = newData.linkedinUrl;
    }
    lead._lastApolloCheck = new Date().toISOString();
    this._save();
    return lead;
  }

  // --- Multi-Threading (Company Groups) ---

  _ensureCompanyGroups() {
    if (!this.data.companyGroups) {
      this.data.companyGroups = {};
    }
  }

  _normalizeCompanyName(name) {
    return (name || '')
      .toLowerCase()
      .replace(/[^a-z0-9àâäéèêëïîôùûüç ]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  // Creer ou mettre a jour un groupe entreprise
  // contacts: [{email, name, title, role:'primary'|'secondary', emailAngle:'main_pitch'|'technical'|'roi'|'testimonial'}]
  createCompanyGroup(companyName, contacts) {
    this._ensureCompanyGroups();
    const key = this._normalizeCompanyName(companyName);
    if (!key) return null;

    if (this.data.companyGroups[key]) {
      // Ajouter les nouveaux contacts sans doublons
      const existing = this.data.companyGroups[key];
      const existingEmails = new Set(existing.contacts.map(c => c.email.toLowerCase()));
      for (const c of contacts) {
        if (!existingEmails.has(c.email.toLowerCase())) {
          existing.contacts.push({
            email: c.email,
            name: c.name || '',
            title: c.title || '',
            role: c.role || 'secondary',
            emailAngle: c.emailAngle || 'main_pitch',
            status: 'pending',
            sentAt: null,
            scheduledAt: null
          });
        }
      }
      this._save();
      return existing;
    }

    const staggerDays = parseInt(process.env.MULTI_THREAD_STAGGER_DAYS) || 2;
    const group = {
      companyName: companyName,
      normalizedName: key,
      contacts: contacts.map((c, i) => ({
        email: c.email,
        name: c.name || '',
        title: c.title || '',
        role: i === 0 ? 'primary' : (c.role || 'secondary'),
        emailAngle: c.emailAngle || (i === 0 ? 'main_pitch' : (i === 1 ? 'technical' : 'roi')),
        status: i === 0 ? 'pending' : 'scheduled',
        sentAt: null,
        scheduledAt: i === 0 ? null : new Date(Date.now() + i * staggerDays * 24 * 60 * 60 * 1000).toISOString()
      })),
      status: 'active',
      repliedBy: null,
      repliedAt: null,
      createdAt: new Date().toISOString()
    };
    this.data.companyGroups[key] = group;
    // Expirer les groupes actifs > 90 jours
    const expirationCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    for (const [k, g] of Object.entries(this.data.companyGroups)) {
      if (g.status === 'active' && g.createdAt && g.createdAt < expirationCutoff) {
        g.status = 'expired';
      }
    }
    // Limiter a 200 groupes
    const keys = Object.keys(this.data.companyGroups);
    if (keys.length > 200) {
      // Supprimer les plus anciens qui ne sont pas actifs
      const sortable = keys.map(k => ({ key: k, group: this.data.companyGroups[k] }))
        .filter(g => g.group.status !== 'active')
        .sort((a, b) => (a.group.createdAt || '').localeCompare(b.group.createdAt || ''));
      for (let i = 0; i < Math.min(50, sortable.length); i++) {
        delete this.data.companyGroups[sortable[i].key];
      }
    }
    this._save();
    return group;
  }

  getCompanyGroup(companyName) {
    this._ensureCompanyGroups();
    const key = this._normalizeCompanyName(companyName);
    return this.data.companyGroups[key] || null;
  }

  // Verifier si l'entreprise a un groupe actif (email deja envoye ou en cours)
  isCompanyGroupActive(companyName) {
    const group = this.getCompanyGroup(companyName);
    if (!group) return false;
    return group.status === 'active' && group.contacts.some(c => c.status === 'sent' || c.status === 'pending');
  }

  // Checker si l'entreprise a deja ete contactee (peu importe le statut du groupe)
  hasCompanyBeenContacted(companyName) {
    const group = this.getCompanyGroup(companyName);
    if (!group) return false;
    return group.contacts.some(c => c.status === 'sent');
  }

  // Marquer qu'un contact de l'entreprise a repondu → stopper TOUS les contacts
  markCompanyReplied(email) {
    this._ensureCompanyGroups();
    const emailLower = (email || '').toLowerCase();
    for (const [key, group] of Object.entries(this.data.companyGroups)) {
      const contact = group.contacts.find(c => c.email.toLowerCase() === emailLower);
      if (contact) {
        group.status = 'replied';
        group.repliedBy = emailLower;
        group.repliedAt = new Date().toISOString();
        // Annuler les contacts non encore envoyes
        for (const c of group.contacts) {
          if (c.status === 'pending' || c.status === 'scheduled') {
            c.status = 'cancelled';
            c.cancelledAt = new Date().toISOString();
            c.cancelReason = 'company_replied';
          }
        }
        this._save();
        return group;
      }
    }
    return null;
  }

  // Marquer un contact comme envoye
  markCompanyContactSent(email) {
    this._ensureCompanyGroups();
    const emailLower = (email || '').toLowerCase();
    for (const [key, group] of Object.entries(this.data.companyGroups)) {
      const contact = group.contacts.find(c => c.email.toLowerCase() === emailLower);
      if (contact) {
        contact.status = 'sent';
        contact.sentAt = new Date().toISOString();
        this._save();
        return group;
      }
    }
    return null;
  }

  // Retourner les contacts secondaires dont le delai est ecoule et l'entreprise toujours active
  getSecondariesDueForSend() {
    this._ensureCompanyGroups();
    const now = new Date().toISOString();
    const due = [];
    for (const [key, group] of Object.entries(this.data.companyGroups)) {
      if (group.status !== 'active') continue;
      // Le primaire doit avoir ete envoye
      const primarySent = group.contacts.some(c => c.role === 'primary' && c.status === 'sent');
      if (!primarySent) continue;
      for (const contact of group.contacts) {
        if (contact.role === 'secondary' && contact.status === 'scheduled' && contact.scheduledAt && contact.scheduledAt <= now) {
          due.push({
            companyName: group.companyName,
            groupKey: key,
            email: contact.email,
            name: contact.name,
            title: contact.title,
            emailAngle: contact.emailAngle
          });
        }
      }
    }
    return due;
  }

  // Trouver le groupe d'une entreprise par email d'un de ses contacts
  findCompanyGroupByEmail(email) {
    this._ensureCompanyGroups();
    const emailLower = (email || '').toLowerCase();
    for (const [key, group] of Object.entries(this.data.companyGroups)) {
      if (group.contacts.some(c => c.email.toLowerCase() === emailLower)) {
        return group;
      }
    }
    return null;
  }
}

module.exports = new Storage();
