// Visitor Tracking - Stockage persistant JSON
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.VISITOR_DATA_DIR || '/data/visitors';
const DB_FILE = path.join(DATA_DIR, 'visitor-db.json');

class VisitorStorage {
  constructor() {
    this.data = null;
    this._ensureDir();
    this._load();
  }

  _ensureDir() {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  }

  _load() {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      this.data = JSON.parse(raw);
      console.log('[visitor-storage] Base chargee (' + (this.data.visits || []).length + ' visites, ' + Object.keys(this.data.companies || {}).length + ' entreprises)');
    } catch (e) {
      this.data = this._defaultData();
      this._save();
      console.log('[visitor-storage] Nouvelle base creee');
    }
  }

  _save() {
    try {
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('[visitor-storage] Erreur sauvegarde:', e.message);
    }
  }

  _defaultData() {
    return {
      visits: [],
      companies: {},
      alerts: [],
      ipCache: {},
      stats: {
        totalVisits: 0,
        totalUniqueIPs: 0,
        totalCompaniesDetected: 0,
        lastVisitAt: null,
        createdAt: new Date().toISOString()
      }
    };
  }

  _generateId() {
    return 'visit_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  }

  // --- IP Cache (24h TTL) ---

  getCachedIP(ip) {
    const cached = this.data.ipCache[ip];
    if (!cached) return null;
    // TTL 24h
    if (Date.now() - new Date(cached.cachedAt).getTime() > 24 * 60 * 60 * 1000) {
      delete this.data.ipCache[ip];
      return null;
    }
    return cached;
  }

  cacheIPLookup(ip, result) {
    this.data.ipCache[ip] = {
      ...result,
      cachedAt: new Date().toISOString()
    };
    // Limiter le cache a 5000 entrees
    const keys = Object.keys(this.data.ipCache);
    if (keys.length > 5000) {
      const oldest = keys.sort((a, b) =>
        (this.data.ipCache[a].cachedAt || '').localeCompare(this.data.ipCache[b].cachedAt || '')
      );
      for (let i = 0; i < 1000; i++) {
        delete this.data.ipCache[oldest[i]];
      }
    }
    this._save();
  }

  // --- Visits ---

  addVisit(visitData) {
    const visit = {
      id: this._generateId(),
      ip: visitData.ip || '',
      url: (visitData.url || '').substring(0, 500),
      referrer: (visitData.referrer || '').substring(0, 500),
      userAgent: (visitData.userAgent || '').substring(0, 300),
      company: visitData.company || null,
      city: visitData.city || null,
      region: visitData.region || null,
      country: visitData.country || null,
      org: visitData.org || null,
      timestamp: new Date().toISOString()
    };
    this.data.visits.push(visit);
    // Limiter a 10000 visites
    if (this.data.visits.length > 10000) {
      this.data.visits = this.data.visits.slice(-10000);
    }
    this.data.stats.totalVisits++;
    this.data.stats.lastVisitAt = visit.timestamp;

    // Agreger par entreprise
    if (visit.company) {
      const key = visit.company.toLowerCase().replace(/[^a-z0-9]/g, '_');
      if (!this.data.companies[key]) {
        this.data.companies[key] = {
          name: visit.company,
          firstVisit: visit.timestamp,
          lastVisit: visit.timestamp,
          visitCount: 0,
          pages: [],
          ips: []
        };
        this.data.stats.totalCompaniesDetected++;
      }
      const comp = this.data.companies[key];
      comp.lastVisit = visit.timestamp;
      comp.visitCount++;
      if (!comp.pages.includes(visit.url)) {
        comp.pages.push(visit.url);
        if (comp.pages.length > 50) comp.pages = comp.pages.slice(-50);
      }
      if (!comp.ips.includes(visit.ip)) {
        comp.ips.push(visit.ip);
        if (comp.ips.length > 20) comp.ips = comp.ips.slice(-20);
      }
    }

    // Limiter le nombre d'entreprises a 2000
    const companyKeys = Object.keys(this.data.companies);
    if (companyKeys.length > 2000) {
      const sorted = companyKeys.sort((a, b) =>
        (this.data.companies[a].lastVisit || '').localeCompare(this.data.companies[b].lastVisit || '')
      );
      for (let i = 0; i < 500; i++) {
        delete this.data.companies[sorted[i]];
      }
    }

    this._save();
    return visit;
  }

  getRecentVisitors(limit) {
    return this.data.visits.slice(-(limit || 50)).reverse();
  }

  getCompanyVisits(companyName) {
    const key = (companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
    return this.data.companies[key] || null;
  }

  getAllCompanies() {
    return Object.values(this.data.companies);
  }

  // --- Alerts ---

  addAlert(data) {
    const alert = {
      id: this._generateId(),
      company: data.company,
      message: data.message || '',
      type: data.type || 'company_visit',
      createdAt: new Date().toISOString()
    };
    this.data.alerts.unshift(alert);
    if (this.data.alerts.length > 200) {
      this.data.alerts = this.data.alerts.slice(0, 200);
    }
    this._save();
    return alert;
  }

  // --- Weekly Digest ---

  getWeeklyDigest() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentVisits = this.data.visits.filter(v => v.timestamp >= weekAgo);

    // Agreger par entreprise
    const companyVisits = {};
    for (const v of recentVisits) {
      if (!v.company) continue;
      if (!companyVisits[v.company]) {
        companyVisits[v.company] = { name: v.company, count: 0, pages: new Set() };
      }
      companyVisits[v.company].count++;
      companyVisits[v.company].pages.add(v.url);
    }

    // Trier par nombre de visites
    const sorted = Object.values(companyVisits)
      .map(c => ({ name: c.name, count: c.count, pages: [...c.pages] }))
      .sort((a, b) => b.count - a.count);

    return {
      period: { from: weekAgo, to: new Date().toISOString() },
      totalVisits: recentVisits.length,
      uniqueCompanies: sorted.length,
      topCompanies: sorted.slice(0, 20),
      uniqueIPs: new Set(recentVisits.map(v => v.ip)).size
    };
  }

  getStats() {
    return { ...this.data.stats };
  }
}

module.exports = new VisitorStorage();
