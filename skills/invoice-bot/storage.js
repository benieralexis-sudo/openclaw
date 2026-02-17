// Invoice Bot - Stockage persistant JSON avec chiffrement AES-256-GCM
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteSync } = require('../../gateway/utils.js');

// --- Chiffrement AES-256-GCM pour donnees sensibles ---
const ENCRYPTION_KEY_FILE = '/data/invoice-bot/.encryption-key';
const CIPHER_ALGO = 'aes-256-gcm';

function _getOrCreateKey() {
  try {
    if (fs.existsSync(ENCRYPTION_KEY_FILE)) {
      return Buffer.from(fs.readFileSync(ENCRYPTION_KEY_FILE, 'utf-8').trim(), 'hex');
    }
    const key = crypto.randomBytes(32);
    const dir = path.dirname(ENCRYPTION_KEY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ENCRYPTION_KEY_FILE, key.toString('hex'), { mode: 0o600 });
    return key;
  } catch (e) {
    console.error('[invoice-bot-storage] Erreur gestion cle chiffrement:', e.message);
    return null;
  }
}

const _encryptionKey = _getOrCreateKey();

function _encrypt(text) {
  if (!_encryptionKey || !text) return text;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(CIPHER_ALGO, _encryptionKey, iv);
    let encrypted = cipher.update(String(text), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return 'ENC:' + iv.toString('hex') + ':' + tag + ':' + encrypted;
  } catch (e) {
    console.error('[invoice-bot-storage] Erreur chiffrement:', e.message);
    return text;
  }
}

function _decrypt(text) {
  if (!_encryptionKey || !text || typeof text !== 'string' || !text.startsWith('ENC:')) return text;
  try {
    const parts = text.split(':');
    if (parts.length !== 4) return text;
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encrypted = parts[3];
    const decipher = crypto.createDecipheriv(CIPHER_ALGO, _encryptionKey, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('[invoice-bot-storage] Erreur dechiffrement:', e.message);
    return text;
  }
}

// Champs sensibles a chiffrer
const SENSITIVE_BIZ_FIELDS = ['rib', 'siret', 'email', 'phone'];
const SENSITIVE_CLIENT_FIELDS = ['email', 'address'];

function _encryptObject(obj, fields) {
  if (!obj || !_encryptionKey) return obj;
  for (const field of fields) {
    if (obj[field] && typeof obj[field] === 'string' && !obj[field].startsWith('ENC:')) {
      obj[field] = _encrypt(obj[field]);
    }
  }
  return obj;
}

function _decryptObject(obj, fields) {
  if (!obj || !_encryptionKey) return obj;
  for (const field of fields) {
    if (obj[field] && typeof obj[field] === 'string' && obj[field].startsWith('ENC:')) {
      obj[field] = _decrypt(obj[field]);
    }
  }
  return obj;
}

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
      atomicWriteSync(DB_FILE, this.data);
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
    return this._decryptedUser(this.data.users[id]);
  }

  setUserName(chatId, name) {
    const user = this.getUser(chatId);
    user.name = name;
    this._save();
  }

  updateBusinessInfo(chatId, info) {
    const user = this.getUser(chatId);
    Object.assign(user.businessInfo, info);
    _encryptObject(user.businessInfo, SENSITIVE_BIZ_FIELDS);
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
    _encryptObject(this.data.clients[id], SENSITIVE_CLIENT_FIELDS);
    this._save();
    return this._decryptedClient(this.data.clients[id]);
  }

  _decryptedClient(client) {
    if (!client) return null;
    const copy = { ...client };
    _decryptObject(copy, SENSITIVE_CLIENT_FIELDS);
    return copy;
  }

  _decryptedUser(user) {
    if (!user) return null;
    const copy = { ...user, businessInfo: { ...user.businessInfo } };
    _decryptObject(copy.businessInfo, SENSITIVE_BIZ_FIELDS);
    return copy;
  }

  getClient(clientId) {
    return this._decryptedClient(this.data.clients[clientId]);
  }

  getClientByName(chatId, name) {
    const nameLower = name.toLowerCase();
    const found = Object.values(this.data.clients).find(c =>
      c.chatId === String(chatId) && (
        c.name.toLowerCase().includes(nameLower) ||
        c.company.toLowerCase().includes(nameLower)
      )
    );
    return this._decryptedClient(found);
  }

  getClientByEmail(chatId, email) {
    const emailLower = email.toLowerCase();
    // Dechiffrer les emails pour comparaison
    const found = Object.values(this.data.clients).find(c => {
      if (c.chatId !== String(chatId)) return false;
      const decEmail = _decrypt(c.email);
      return decEmail.toLowerCase() === emailLower;
    });
    return this._decryptedClient(found);
  }

  getClients(chatId) {
    return Object.values(this.data.clients)
      .filter(c => c.chatId === String(chatId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(c => this._decryptedClient(c));
  }

  updateClient(clientId, updates) {
    const client = this.data.clients[clientId];
    if (!client) return null;
    Object.assign(client, updates);
    _encryptObject(client, SENSITIVE_CLIENT_FIELDS);
    this._save();
    return this._decryptedClient(client);
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
