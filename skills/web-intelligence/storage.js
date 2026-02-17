// Web Intelligence - Stockage JSON persistant
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../../gateway/utils.js');

const DATA_DIR = process.env.WEB_INTEL_DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'web-intelligence.json');

let _data = null;

function _defaultData() {
  return {
    config: {
      enabled: true,
      adminChatId: '1409505520',
      checkIntervalHours: 6,
      maxArticlesPerWatch: 50,
      maxArticlesTotal: 500,
      notifications: {
        digestEnabled: true,
        digestHour: 9,
        instantAlerts: true,
        weeklyDigest: true,
        weeklyDigestDay: 1,
        weeklyDigestHour: 9
      }
    },
    watches: {},
    articles: [],
    analyses: [],
    stats: {
      totalArticlesFetched: 0,
      totalAnalysesGenerated: 0,
      totalAlertsSent: 0,
      lastScanAt: null,
      lastDigestAt: null,
      lastWeeklyDigestAt: null,
      watchesCreated: 0,
      createdAt: new Date().toISOString()
    }
  };
}

function _ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function _load() {
  if (_data) return _data;
  _ensureDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      _data = JSON.parse(raw);
      // Merge avec defaults pour les nouvelles proprietes
      const def = _defaultData();
      if (!_data.config) _data.config = def.config;
      if (!_data.watches) _data.watches = {};
      if (!_data.articles) _data.articles = [];
      if (!_data.analyses) _data.analyses = [];
      if (!_data.stats) _data.stats = def.stats;
      if (!_data.config.notifications) _data.config.notifications = def.config.notifications;
      console.log('[web-intel-storage] Donnees chargees (' + Object.keys(_data.watches).length + ' veilles, ' + _data.articles.length + ' articles)');
    } else {
      _data = _defaultData();
      _save();
      console.log('[web-intel-storage] Nouvelle base creee');
    }
  } catch (e) {
    console.log('[web-intel-storage] Erreur lecture, reset:', e.message);
    _data = _defaultData();
    _save();
  }
  return _data;
}

function _save() {
  _ensureDir();
  try {
    atomicWriteSync(DATA_FILE, _data);
  } catch (e) {
    console.log('[web-intel-storage] Erreur ecriture:', e.message);
  }
}

function _generateId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
}

// --- Config ---

function getConfig() {
  return _load().config;
}

function updateConfig(updates) {
  const data = _load();
  Object.assign(data.config, updates);
  _save();
  return data.config;
}

// --- Watches ---

function addWatch(watch) {
  const data = _load();
  const id = _generateId('watch');
  const fullWatch = {
    id: id,
    name: watch.name || 'Sans nom',
    type: watch.type || 'sector',
    keywords: watch.keywords || [],
    rssUrls: watch.rssUrls || [],
    scrapeUrls: watch.scrapeUrls || [],
    googleNewsEnabled: watch.googleNewsEnabled !== false,
    frequency: watch.frequency || 6,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastCheckedAt: null,
    articleCount: 0
  };
  data.watches[id] = fullWatch;
  data.stats.watchesCreated++;
  _save();
  return fullWatch;
}

function getWatch(id) {
  return _load().watches[id] || null;
}

function getWatchByName(name) {
  const data = _load();
  const nameLower = name.toLowerCase();
  for (const id of Object.keys(data.watches)) {
    if (data.watches[id].name.toLowerCase().includes(nameLower)) {
      return data.watches[id];
    }
  }
  return null;
}

function updateWatch(id, updates) {
  const data = _load();
  if (!data.watches[id]) return null;
  Object.assign(data.watches[id], updates);
  _save();
  return data.watches[id];
}

function deleteWatch(id) {
  const data = _load();
  if (!data.watches[id]) return false;
  delete data.watches[id];
  // Supprimer les articles associes
  data.articles = data.articles.filter(a => a.watchId !== id);
  data.analyses = data.analyses.filter(a => a.watchId !== id);
  _save();
  return true;
}

function getWatches() {
  return _load().watches;
}

function getEnabledWatches() {
  const data = _load();
  const result = [];
  for (const id of Object.keys(data.watches)) {
    if (data.watches[id].enabled) {
      result.push(data.watches[id]);
    }
  }
  return result;
}

function getWatchesByType(type) {
  const data = _load();
  const result = [];
  for (const id of Object.keys(data.watches)) {
    if (data.watches[id].type === type) {
      result.push(data.watches[id]);
    }
  }
  return result;
}

// --- Articles ---

function _normalizeTitle(title) {
  if (!title) return '';
  return title.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F]/g, '').substring(0, 80);
}

function hasArticle(link) {
  const data = _load();
  return data.articles.some(a => a.link === link);
}

function hasArticleByTitle(title) {
  if (!title) return false;
  const norm = _normalizeTitle(title);
  if (norm.length < 10) return false; // titre trop court = pas fiable
  const data = _load();
  return data.articles.some(a => _normalizeTitle(a.title) === norm);
}

function addArticles(articles) {
  const data = _load();
  let added = 0;
  for (const article of articles) {
    // Deduplication par URL + titre (articles syndiques avec URLs differentes)
    if (hasArticle(article.link)) continue;
    if (hasArticleByTitle(article.title)) continue;

    const fullArticle = {
      id: _generateId('art'),
      watchId: article.watchId || null,
      title: article.title || '',
      link: article.link || '',
      source: article.source || '',
      pubDate: article.pubDate || null,
      snippet: (article.snippet || '').substring(0, 300),
      relevanceScore: article.relevanceScore || 5,
      summary: article.summary || '',
      matchedKeywords: article.matchedKeywords || [],
      crmMatch: article.crmMatch || null,
      isUrgent: article.isUrgent || false,
      notifiedAt: null,
      fetchedAt: new Date().toISOString()
    };
    data.articles.push(fullArticle);
    added++;
  }

  // Limiter le nombre total d'articles
  if (data.articles.length > data.config.maxArticlesTotal) {
    data.articles = data.articles.slice(-data.config.maxArticlesTotal);
  }

  data.stats.totalArticlesFetched += added;
  _save();
  return added;
}

function getArticlesForWatch(watchId, limit) {
  limit = limit || 10;
  const data = _load();
  return data.articles
    .filter(a => a.watchId === watchId)
    .sort((a, b) => new Date(b.fetchedAt) - new Date(a.fetchedAt))
    .slice(0, limit);
}

function getRecentArticles(limit) {
  limit = limit || 20;
  const data = _load();
  return data.articles
    .sort((a, b) => new Date(b.fetchedAt) - new Date(a.fetchedAt))
    .slice(0, limit);
}

function getUnnotifiedArticles() {
  const data = _load();
  return data.articles.filter(a => !a.notifiedAt && a.isUrgent);
}

function markArticleNotified(id) {
  const data = _load();
  const article = data.articles.find(a => a.id === id);
  if (article) {
    article.notifiedAt = new Date().toISOString();
    _save();
  }
}

function getArticlesByDateRange(startDate, endDate) {
  const data = _load();
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return data.articles.filter(a => {
    const t = new Date(a.fetchedAt).getTime();
    return t >= start && t <= end;
  });
}

function getArticlesLast24h() {
  const now = Date.now();
  return getArticlesByDateRange(new Date(now - 24 * 60 * 60 * 1000).toISOString(), new Date(now).toISOString());
}

function getArticlesLastWeek() {
  const now = Date.now();
  return getArticlesByDateRange(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(), new Date(now).toISOString());
}

// --- News-to-Outreach Bridge (8a) ---

function saveNewsOutreach(newsItem) {
  const data = _load();
  if (!data.newsOutreach) data.newsOutreach = [];
  const entry = {
    id: _generateId('nob'),
    company: newsItem.company || '',
    headline: newsItem.headline || newsItem.title || '',
    url: newsItem.url || newsItem.link || '',
    date: newsItem.date || new Date().toISOString(),
    relevance: newsItem.relevance || newsItem.relevanceScore || 5,
    watchId: newsItem.watchId || null,
    usedInEmail: false,
    savedAt: new Date().toISOString()
  };
  data.newsOutreach.push(entry);
  // Limiter a 200 entrees
  if (data.newsOutreach.length > 200) {
    data.newsOutreach = data.newsOutreach.slice(-200);
  }
  _save();
  return entry;
}

function getRelevantNewsForContact(companyName) {
  const data = _load();
  if (!companyName || !data.newsOutreach) return [];
  const companyLower = companyName.toLowerCase().trim();
  if (companyLower.length < 2) return [];
  return data.newsOutreach
    .filter(n => n.company && n.company.toLowerCase().includes(companyLower))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);
}

function getRecentNewsOutreach(limit) {
  const data = _load();
  limit = limit || 20;
  return (data.newsOutreach || [])
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
    .slice(0, limit);
}

function markNewsUsedInEmail(newsId) {
  const data = _load();
  if (!data.newsOutreach) return;
  const item = data.newsOutreach.find(n => n.id === newsId);
  if (item) {
    item.usedInEmail = true;
    item.usedAt = new Date().toISOString();
    _save();
  }
}

// --- Competitive Digest Cache ---

function saveCompetitiveDigest(digest) {
  const data = _load();
  if (!data.competitiveDigests) data.competitiveDigests = [];
  const entry = {
    id: _generateId('cdig'),
    text: digest.text || '',
    opportunities: digest.opportunities || [],
    threats: digest.threats || [],
    keyMoves: digest.keyMoves || [],
    articles: digest.articles || 0,
    generatedAt: new Date().toISOString()
  };
  data.competitiveDigests.push(entry);
  if (data.competitiveDigests.length > 20) {
    data.competitiveDigests = data.competitiveDigests.slice(-20);
  }
  _save();
  return entry;
}

function getLatestCompetitiveDigest() {
  const data = _load();
  if (!data.competitiveDigests || data.competitiveDigests.length === 0) return null;
  return data.competitiveDigests[data.competitiveDigests.length - 1];
}

// --- Trend Cache ---

function saveTrends(trends) {
  const data = _load();
  if (!data.trendHistory) data.trendHistory = [];
  const entry = {
    id: _generateId('trend'),
    rising: trends.rising || [],
    falling: trends.falling || [],
    stable: trends.stable || [],
    generatedAt: new Date().toISOString()
  };
  data.trendHistory.push(entry);
  if (data.trendHistory.length > 30) {
    data.trendHistory = data.trendHistory.slice(-30);
  }
  _save();
  return entry;
}

function getLatestTrends() {
  const data = _load();
  if (!data.trendHistory || data.trendHistory.length === 0) return null;
  return data.trendHistory[data.trendHistory.length - 1];
}

// --- Analyses ---

function saveAnalysis(analysis) {
  const data = _load();
  const fullAnalysis = {
    id: _generateId('ana'),
    watchId: analysis.watchId || null,
    type: analysis.type || 'digest',
    content: analysis.content || '',
    generatedAt: new Date().toISOString()
  };
  data.analyses.push(fullAnalysis);
  // Garder max 50 analyses
  if (data.analyses.length > 50) {
    data.analyses = data.analyses.slice(-50);
  }
  data.stats.totalAnalysesGenerated++;
  _save();
  return fullAnalysis;
}

function getRecentAnalyses(limit) {
  limit = limit || 5;
  const data = _load();
  return data.analyses
    .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))
    .slice(0, limit);
}

// --- Stats ---

function getStats() {
  return _load().stats;
}

function updateStat(key, value) {
  const data = _load();
  data.stats[key] = value;
  _save();
}

function incrementStat(key) {
  const data = _load();
  data.stats[key] = (data.stats[key] || 0) + 1;
  _save();
}

// --- Market Signals (Intelligence Reelle v5) ---

function saveMarketSignals(signals) {
  const data = _load();
  if (!data.marketSignals) data.marketSignals = [];
  for (const s of signals) {
    s.id = _generateId('sig');
    data.marketSignals.push(s);
  }
  // Limiter a 200 signaux
  if (data.marketSignals.length > 200) {
    data.marketSignals = data.marketSignals.slice(-200);
  }
  _save();
  return signals;
}

function getRecentMarketSignals(limit) {
  const data = _load();
  limit = limit || 20;
  return (data.marketSignals || [])
    .sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt))
    .slice(0, limit);
}

function getHighPrioritySignals() {
  const data = _load();
  return (data.marketSignals || [])
    .filter(s => s.priority === 'high')
    .sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt))
    .slice(0, 10);
}

module.exports = {
  getConfig, updateConfig,
  addWatch, getWatch, getWatchByName, updateWatch, deleteWatch,
  getWatches, getEnabledWatches, getWatchesByType,
  hasArticle, hasArticleByTitle, addArticles, getArticlesForWatch, getRecentArticles,
  getUnnotifiedArticles, markArticleNotified,
  getArticlesByDateRange, getArticlesLast24h, getArticlesLastWeek,
  saveNewsOutreach, getRelevantNewsForContact, getRecentNewsOutreach, markNewsUsedInEmail,
  saveCompetitiveDigest, getLatestCompetitiveDigest,
  saveTrends, getLatestTrends,
  saveMarketSignals, getRecentMarketSignals, getHighPrioritySignals,
  saveAnalysis, getRecentAnalyses,
  getStats, updateStat, incrementStat
};
