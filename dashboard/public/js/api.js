/* ===== API LAYER — MISSION CONTROL ===== */

const API = {
  cache: {},
  CACHE_TTL: 5 * 60 * 1000, // 5 min localStorage cache

  async fetch(endpoint) {
    // Check localStorage cache
    const cacheKey = 'mc_' + endpoint;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch('/api/' + endpoint, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.status === 401) {
        window.location.href = '/login';
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.setCache(cacheKey, data);
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error(`[API] Timeout ${endpoint} (15s)`);
        if (typeof Utils !== 'undefined' && Utils.toast) {
          Utils.toast('Timeout : le serveur ne répond pas');
        }
      } else {
        console.error(`[API] Erreur ${endpoint}:`, err);
        if (typeof Utils !== 'undefined' && Utils.toast) {
          Utils.toast('Erreur de chargement des données');
        }
      }
      return null;
    }
  },

  getCache(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > this.CACHE_TTL) {
        localStorage.removeItem(key);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  },

  setCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
    } catch {
      // Storage full — clear old entries
      this.clearOldCache();
    }
  },

  clearOldCache() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('mc_')) keys.push(key);
    }
    keys.forEach(k => localStorage.removeItem(k));
  },

  invalidate(endpoint) {
    localStorage.removeItem('mc_' + endpoint);
  },

  invalidateAll() {
    this.clearOldCache();
  },

  async post(endpoint, body) {
    try {
      const res = await fetch('/api/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.status === 401) { window.location.href = '/login'; return null; }
      return await res.json();
    } catch (err) {
      console.error('[API] POST ' + endpoint + ':', err);
      return null;
    }
  },

  async del(endpoint) {
    try {
      const res = await fetch('/api/' + endpoint, { method: 'DELETE' });
      if (res.status === 401) { window.location.href = '/login'; return null; }
      return await res.json();
    } catch (err) {
      console.error('[API] DELETE ' + endpoint + ':', err);
      return null;
    }
  },

  async put(endpoint, body) {
    try {
      const res = await fetch('/api/' + endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.status === 401) { window.location.href = '/login'; return null; }
      return await res.json();
    } catch (err) {
      console.error('[API] PUT ' + endpoint + ':', err);
      return null;
    }
  },

  async get(endpoint) {
    try {
      const res = await fetch(endpoint);
      if (res.status === 401) { window.location.href = '/login'; return null; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      console.error('[API] GET ' + endpoint + ':', err);
      return null;
    }
  },

  // Shortcuts
  overview(period = '30d') { return this.fetch('overview?period=' + period); },
  prospection() { return this.fetch('prospection'); },
  emails() { return this.fetch('emails'); },
  crm() { return this.fetch('crm'); },
  enrichment() { return this.fetch('enrichment'); },
  content() { return this.fetch('content'); },
  invoices() { return this.fetch('invoices'); },
  proactive() { return this.fetch('proactive'); },
  selfImprove() { return this.fetch('self-improve'); },
  webIntel() { return this.fetch('web-intelligence'); },
  system() { return this.fetch('system'); },
  finance() { return this.fetch('finance'); },
  inbox() { return this.fetch('inbox'); },
  me() { return this.fetch('me'); },
  users() { return this.fetch('users'); },
  createUser(data) { return this.post('users', data); },
  deleteUser(username) { return this.del('users/' + encodeURIComponent(username)); },

  // Client management
  clients() { return this.get('/api/clients'); },
  clientDetail(id) { return this.get('/api/clients/' + encodeURIComponent(id)); },
  createClient(data) { return this.post('clients', data); },
  updateClient(id, data) { return this.put('clients/' + encodeURIComponent(id), data); },
  deleteClient(id) { return this.del('clients/' + encodeURIComponent(id)); },
  restartClient(id) { return this.post('clients/' + encodeURIComponent(id) + '/restart', {}); },
  clientHealth(id) { return this.get('/api/clients/' + encodeURIComponent(id) + '/health'); },

  // Drafts — no cache (time-sensitive)
  async drafts() {
    try {
      const res = await fetch('/api/drafts');
      if (res.status === 401) { window.location.href = '/login'; return null; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('[API] drafts:', err);
      return null;
    }
  },
  approveDraft(id) { return this.post('drafts/' + encodeURIComponent(id) + '/approve', {}); },
  rejectDraft(id) { return this.post('drafts/' + encodeURIComponent(id) + '/reject', {}); },
  editDraft(id, body) { return this.post('drafts/' + encodeURIComponent(id) + '/edit', { body }); },

  // Knowledge Base
  kb() { return this.get('/api/settings/kb'); },
  saveKb(kb) { return this.put('settings/kb', kb); },
  kbTemplate() { return this.get('/api/settings/kb/template'); },

  // Unibox — conversations (no cache, time-sensitive)
  async conversations(filter, q, page) {
    let url = 'conversations?limit=50';
    if (filter && filter !== 'all') url += '&filter=' + encodeURIComponent(filter);
    if (q) url += '&q=' + encodeURIComponent(q);
    if (page && page > 1) url += '&page=' + page;
    try {
      const res = await fetch('/api/' + url);
      if (res.status === 401) { window.location.href = '/login'; return null; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      console.error('[API] conversations:', err);
      return null;
    }
  },
  async conversationThread(email) {
    try {
      const res = await fetch('/api/conversations/' + encodeURIComponent(email));
      if (res.status === 401) { window.location.href = '/login'; return null; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      console.error('[API] conversation thread:', err);
      return null;
    }
  },
  async pipeline() {
    return this.fetch('pipeline');
  }
};

// Auto-refresh every 60s (pause when tab hidden)
let _refreshInterval = null;
function startAutoRefresh() {
  if (_refreshInterval) clearInterval(_refreshInterval);
  _refreshInterval = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    API.invalidateAll();
    if (typeof App !== 'undefined' && App.currentPage) {
      App.loadPage(App.currentPage, true);
    }
  }, 60000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && typeof App !== 'undefined' && App.currentPage) {
      API.invalidateAll();
      App.loadPage(App.currentPage, true);
    }
  });
}
