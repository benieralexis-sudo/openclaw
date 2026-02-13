/* ===== API LAYER — MISSION CONTROL ===== */

const API = {
  cache: {},
  CACHE_TTL: 5 * 60 * 1000, // 5 min localStorage cache

  async fetch(endpoint) {
    // Check localStorage cache
    const cacheKey = 'mc_' + endpoint;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const res = await fetch('/api/' + endpoint);
      if (res.status === 401) {
        window.location.href = '/login';
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.setCache(cacheKey, data);
      return data;
    } catch (err) {
      console.error(`[API] Erreur ${endpoint}:`, err);
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
  system() { return this.fetch('system'); }
};

// Auto-refresh every 60s
let _refreshInterval = null;
function startAutoRefresh() {
  if (_refreshInterval) clearInterval(_refreshInterval);
  _refreshInterval = setInterval(() => {
    API.invalidateAll();
    if (typeof App !== 'undefined' && App.currentPage) {
      App.loadPage(App.currentPage, true);
    }
  }, 60000);
}
