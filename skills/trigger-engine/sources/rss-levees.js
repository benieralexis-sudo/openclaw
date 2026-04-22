// ═══════════════════════════════════════════════════════════════════
// RSS Levées FR ingester — Maddyness + Sifted + Frenchweb + Les Echos
// ═══════════════════════════════════════════════════════════════════
// Détecte les annonces de levée de fonds FR publiées en RSS.
// Signal fort : intention d'achat B2B SaaS/services post-levée.
//
// Event types:
//   - funding         (levée détectée, tous montants)
//   - funding_seed    (Seed / amorçage)
//   - funding_series  (Série A/B/C/D)
// ═══════════════════════════════════════════════════════════════════

'use strict';

const crypto = require('node:crypto');
const { XMLParser } = require('fast-xml-parser');
const sirene = require('./sirene');

// Feeds FR focus levées. Maddyness = source #1 (startup FR), Frenchweb = backup.
// Autres feeds (lesechos, latribune, bfm) testés → trop généralistes, peu de signal levée.
const FEEDS = [
  { name: 'maddyness', url: 'https://www.maddyness.com/feed/' },
  { name: 'frenchweb', url: 'https://www.frenchweb.fr/feed' }
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata'
});

function pseudoSirenFromName(nom) {
  if (!nom || typeof nom !== 'string') return null;
  const normalized = nom.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  if (!normalized) return null;
  const hash = crypto.createHash('md5').update(normalized).digest('hex');
  return 'FT' + hash.slice(0, 7);
}

function cleanText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v.__cdata) return v.__cdata;
  if (typeof v === 'object' && v['#text']) return v['#text'];
  return String(v);
}

/**
 * Regex détection levée FR/EN
 */
const FUNDING_PATTERNS = [
  /\bl[èe]ve[nt]?\b/i,
  /\blev[ée]e de fonds\b/i,
  /\b(s[ée]curise|boucle|annonce|obtient|d[ée]croche|r[ée]alise)[a-z]*\s+(une|sa|son|un)?\s*(tour|lev[ée]e|round|financement|investissement)\b/i,
  /\braises?\s+[\$€£]?\s*\d/i,
  /\bs[ée]rie\s+[A-E]\b/i,
  /\bseed(\s+round)?\b/i,
  /\b(pre.?seed|pr[ée].?amor[çc]age|amor[çc]age)\b/i,
  /\b\d+[,\.]?\d*\s*(m€|meur|m euros|million[s]?|k€|keur|k euros|\$m|m\$)/i,
  /\bmillions?\s+(d['e]\s*)?euros?\b/i
];

function looksLikeFunding(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  return FUNDING_PATTERNS.some(rx => rx.test(text));
}

/**
 * Extraction naïve du nom d'entreprise depuis le titre.
 * Heuristiques :
 *   - "<Company> lève..."    → Company = 1-3 mots avant "lève"
 *   - "La startup <Company>" → Company = mots après
 *   - Fallback : 1er mot capitalisé
 */
function extractCompanyName(title) {
  if (!title) return null;
  const t = title.trim();

  // Pattern: "La startup/scaleup/fintech/entreprise X ..."
  const mStartup = t.match(/\b(?:la startup|la scaleup|la scale-up|la fintech|l'entreprise|la soci[ée]t[ée]|le groupe)\s+([A-Z][A-Za-zÀ-ÿ0-9\-\.']+(?:\s+[A-Z][A-Za-zÀ-ÿ0-9\-\.']+){0,2})/i);
  if (mStartup) return mStartup[1].trim();

  // Pattern: "<Company> lève/boucle/annonce/..."
  const mBefore = t.match(/^([A-Z][A-Za-zÀ-ÿ0-9\-\.' ]{1,40}?)\s+(?:l[èe]ve|boucle|annonce|s[ée]curise|obtient|d[ée]croche|r[ée]alise|raises?|raises|secures|closes|bags)/);
  if (mBefore) return mBefore[1].trim();

  // Pattern "[Company]" en tête avant un tiret ou deux-points
  const mPrefix = t.match(/^([A-Z][A-Za-zÀ-ÿ0-9\-\.']{1,30}(?:\s+[A-Z][A-Za-zÀ-ÿ0-9\-\.']+){0,2})\s*[:|\-–—]/);
  if (mPrefix) return mPrefix[1].trim();

  return null;
}

/**
 * Extraction du montant levé (en euros, best effort)
 */
function extractAmount(text) {
  if (!text) return null;
  // Essai 1 : "10 M€", "5m$", etc.
  let m = text.match(/(\d+[,\.]?\d*)\s*(m€|meur|million|mn|k€|keur|m\$|\$m)/i);
  if (m) {
    let value = parseFloat(m[1].replace(',', '.'));
    const unit = m[2].toLowerCase();
    if (unit.startsWith('m') || unit.includes('million')) value *= 1_000_000;
    else if (unit.startsWith('k')) value *= 1_000;
    return Math.round(value);
  }
  // Essai 2 : "486 millions d'euros"
  m = text.match(/(\d+[,\.]?\d*)\s*millions?\s+(d['e]\s*)?euros?/i);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1_000_000);
  return null;
}

/**
 * Détecte le type précis (seed / series / generic funding)
 */
function detectFundingType(text) {
  const t = text.toLowerCase();
  if (/\b(pre.?seed|pr[ée].?amor[çc]age|amor[çc]age)\b/.test(t)) return 'funding_seed';
  if (/\bseed(\s+round)?\b/.test(t)) return 'funding_seed';
  if (/\bs[ée]rie\s+[a-eA-E]\b/.test(t)) return 'funding_series';
  return 'funding';
}

async function fetchFeed(feed, log) {
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (TriggerEngine FR)' },
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      log?.warn?.(`[rss-levees] ${feed.name}: HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const parsed = parser.parse(xml);
    const items = parsed?.rss?.channel?.item
      || parsed?.feed?.entry
      || [];
    return Array.isArray(items) ? items : [items];
  } catch (err) {
    log?.warn?.(`[rss-levees] ${feed.name}: ${err.message}`);
    return [];
  }
}

function normalizeItem(item, feedName) {
  const title = cleanText(item.title);
  const description = cleanText(item.description || item.summary || item.content || item['content:encoded']);
  const link = cleanText(item.link?.['@_href'] || item.link || item.guid);
  const pubDate = item.pubDate || item.published || item.updated || item['dc:date'];
  let date = null;
  if (pubDate) {
    const d = new Date(pubDate);
    if (!isNaN(d)) date = d.toISOString().slice(0, 10);
  }
  return { title, description, link, date, feedName };
}

async function ingest({ lastEventId, log, storage } = {}) {
  const events = [];
  const db = storage?.db || null;
  let totalItems = 0;
  let fundingDetected = 0;
  let sireneResolved = 0;

  for (const feed of FEEDS) {
    log?.info?.(`[rss-levees] fetching ${feed.name}`);
    const items = await fetchFeed(feed, log);
    totalItems += items.length;

    for (const item of items) {
      const norm = normalizeItem(item, feed.name);
      if (!norm.title) continue;

      // Only keep last 14 days
      if (norm.date) {
        const ageDays = (Date.now() - new Date(norm.date).getTime()) / (1000 * 3600 * 24);
        if (ageDays > 14) continue;
      }

      if (!looksLikeFunding(norm.title, norm.description)) continue;

      const companyName = extractCompanyName(norm.title);
      if (!companyName) continue;

      fundingDetected += 1;

      // Attribution : tenter SIRENE d'abord (vrai SIREN INSEE), fallback pseudo-hash
      let siren = null;
      let confidence = 0.5;
      let sireneData = null;
      if (db) {
        sireneData = await sirene.lookupByName(companyName, db, { log });
        if (sireneData?.siren) {
          siren = sireneData.siren;
          confidence = 0.85;
          sireneResolved += 1;
        }
      }
      if (!siren) {
        siren = pseudoSirenFromName(companyName);
        confidence = 0.5;
      }

      const fullText = `${norm.title} ${norm.description}`;
      const eventType = detectFundingType(fullText);
      const amount = extractAmount(fullText);

      events.push({
        source: 'rss-levees',
        event_type: eventType,
        siren,
        attribution_confidence: confidence,
        raw_data: {
          feed: feed.name,
          title: norm.title,
          description: norm.description?.slice(0, 500),
          link: norm.link,
          pubDate: norm.date
        },
        normalized: {
          nom_entreprise: companyName,
          siren_source: sireneData?.siren ? 'sirene-lookup' : 'rss-title-extraction',
          sirene_naf: sireneData?.naf_code || null,
          sirene_effectif: sireneData?.effectif || null,
          sirene_departement: sireneData?.departement || null,
          amount_eur: amount,
          funding_type: eventType,
          link: norm.link,
          feed: feed.name
        },
        event_date: norm.date || new Date().toISOString().slice(0, 10)
      });
    }
  }

  log?.info?.(`[rss-levees] ${totalItems} items scanned, ${fundingDetected} funding events (${sireneResolved} SIRENE resolved)`);

  return {
    events,
    nextState: { last_event_id: new Date().toISOString() }
  };
}

module.exports = {
  ingest,
  looksLikeFunding,
  extractCompanyName,
  extractAmount,
  detectFundingType,
  FEEDS
};
