// Invoice Bot - Stockage persistant JSON
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.INVOICE_BOT_DATA_DIR || '/data/invoice-bot';
const DB_FILE = path.join(DATA_DIR, 'invoice-bot-db.json');

class InvoiceBotStorage {
  constructor() {
    this.data = {
      users: {},
      clients: {},
      invoices: {},
      nextInvoiceNumber: 1,
      activityLog: [],
      stats: {
        totalInvoices: 0,
        totalBilled: 0,
        totalPaid: 0,
        totalPending: 0,
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
        if (!this.data.clients) this.data.clients = {};
        if (!this.data.invoices) this.data.invoices = {};
        const invCount = Object.keys(this.data.invoices).length;
        const cliCount = Object.keys(this.data.clients).length;
        console.log('[invoice-bot-storage] Base chargee (' + invCount + ' factures, ' + cliCount + ' clients)');
      } else {
        console.log('[invoice-bot-storage] Nouvelle base creee');
        this._save();
      }
    } catch (e) {
      console.error('[invoice-bot-storage] Erreur chargement:', e.message);
    }
  }

  _save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[invoice-bot-storage] Erreur sauvegarde:', e.message);
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
        businessInfo: {
          company: '',
          address: '',
          email: '',
          phone: '',
          siret: '',
          rib: ''
        },
        prefs: {
          currency: 'EUR',
          taxRate: 0.20
        },
        stats: { invoicesSent: 0, totalBilled: 0 },
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

  updateBusinessInfo(chatId, info) {
    const user = this.getUser(chatId);
    Object.assign(user.businessInfo, info);
    this._save();
  }

  updatePrefs(chatId, prefs) {
    const user = this.getUser(chatId);
    Object.assign(user.prefs, prefs);
    this._save();
  }

  // --- Clients ---

  addClient(chatId, clientData) {
    const id = this._generateId();
    this.data.clients[id] = {
      id: id,
      chatId: String(chatId),
      name: clientData.name || '',
      email: clientData.email || '',
      company: clientData.company || '',
      address: clientData.address || '',
      notes: clientData.notes || '',
      invoiceCount: 0,
      totalBilled: 0,
      createdAt: new Date().toISOString()
    };
    this._save();
    return this.data.clients[id];
  }

  getClient(clientId) {
    return this.data.clients[clientId] || null;
  }

  getClientByName(chatId, name) {
    const nameLower = name.toLowerCase();
    return Object.values(this.data.clients).find(c =>
      c.chatId === String(chatId) && (
        c.name.toLowerCase().includes(nameLower) ||
        c.company.toLowerCase().includes(nameLower)
      )
    ) || null;
  }

  getClientByEmail(chatId, email) {
    const emailLower = email.toLowerCase();
    return Object.values(this.data.clients).find(c =>
      c.chatId === String(chatId) && c.email.toLowerCase() === emailLower
    ) || null;
  }

  getClients(chatId) {
    return Object.values(this.data.clients)
      .filter(c => c.chatId === String(chatId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  updateClient(clientId, updates) {
    const client = this.data.clients[clientId];
    if (!client) return null;
    Object.assign(client, updates);
    this._save();
    return client;
  }

  // --- Factures ---

  createInvoice(chatId, invoiceData) {
    const id = this._generateId();
    const number = 'FAC-' + String(this.data.nextInvoiceNumber).padStart(3, '0');
    this.data.nextInvoiceNumber++;

    const items = invoiceData.items || [];
    const taxRate = invoiceData.taxRate || 0.20;
    const subtotal = items.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0);
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    this.data.invoices[id] = {
      id: id,
      number: number,
      chatId: String(chatId),
      clientId: invoiceData.clientId || '',
      items: items,
      subtotal: subtotal,
      taxRate: taxRate,
      taxAmount: taxAmount,
      total: total,
      currency: invoiceData.currency || 'EUR',
      status: 'draft',
      notes: invoiceData.notes || '',
      dueDate: invoiceData.dueDate || this._defaultDueDate(),
      createdAt: new Date().toISOString(),
      sentAt: null,
      paidAt: null
    };

    // Stats
    this.data.stats.totalInvoices++;
    this.data.stats.totalBilled += total;
    this.data.stats.totalPending += total;

    // Client stats
    const client = this.data.clients[invoiceData.clientId];
    if (client) {
      client.invoiceCount++;
      client.totalBilled += total;
    }

    this._save();
    return this.data.invoices[id];
  }

  getInvoice(invoiceId) {
    return this.data.invoices[invoiceId] || null;
  }

  getInvoiceByNumber(chatId, number) {
    const numUpper = number.toUpperCase();
    return Object.values(this.data.invoices).find(i =>
      i.chatId === String(chatId) && i.number === numUpper
    ) || null;
  }

  getInvoices(chatId, statusFilter) {
    let invoices = Object.values(this.data.invoices)
      .filter(i => i.chatId === String(chatId));
    if (statusFilter) {
      invoices = invoices.filter(i => i.status === statusFilter);
    }
    return invoices.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  markInvoiceSent(invoiceId) {
    const inv = this.data.invoices[invoiceId];
    if (!inv) return null;
    inv.status = 'sent';
    inv.sentAt = new Date().toISOString();
    this._save();
    return inv;
  }

  markInvoicePaid(invoiceId) {
    const inv = this.data.invoices[invoiceId];
    if (!inv) return null;
    const wasPending = inv.status !== 'paid';
    inv.status = 'paid';
    inv.paidAt = new Date().toISOString();
    if (wasPending) {
      this.data.stats.totalPaid += inv.total;
      this.data.stats.totalPending -= inv.total;
    }
    this._save();
    return inv;
  }

  markInvoiceOverdue(invoiceId) {
    const inv = this.data.invoices[invoiceId];
    if (!inv) return null;
    inv.status = 'overdue';
    this._save();
    return inv;
  }

  // --- Stats ---

  getGlobalStats() {
    return { ...this.data.stats };
  }

  getUserStats(chatId) {
    const invoices = this.getInvoices(chatId);
    const paid = invoices.filter(i => i.status === 'paid');
    const pending = invoices.filter(i => i.status === 'sent' || i.status === 'draft');
    const overdue = invoices.filter(i => i.status === 'overdue');
    return {
      totalInvoices: invoices.length,
      totalBilled: invoices.reduce((s, i) => s + i.total, 0),
      totalPaid: paid.reduce((s, i) => s + i.total, 0),
      totalPending: pending.reduce((s, i) => s + i.total, 0),
      totalOverdue: overdue.reduce((s, i) => s + i.total, 0),
      countPaid: paid.length,
      countPending: pending.length,
      countOverdue: overdue.length
    };
  }

  // --- Journal ---

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

  // --- Helpers ---

  _defaultDueDate() {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  }
}

module.exports = new InvoiceBotStorage();
