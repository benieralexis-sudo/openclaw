// ICP Loader — Charge la config ICP (Ideal Customer Profile) par client
// Fournit la selection de niche ponderee et le contexte pour le prompt email
'use strict';
const fs = require('fs');
const path = require('path');
const log = require('./logger.js');

let _icpCache = null;
let _icpLoadedAt = 0;
const ICP_CACHE_TTL = 300000; // 5 min — reload apres edit dashboard

// --- Chemins possibles pour icp.json ---
function _getICPPaths() {
  const paths = [];
  // 1. Per-client data dir (multi-tenant)
  const clientDataDir = process.env.ICP_DATA_DIR || process.env.AUTONOMOUS_PILOT_DATA_DIR;
  if (clientDataDir) {
    paths.push(path.join(clientDataDir, 'icp.json'));
  }
  // 2. Dossier data AP standard
  paths.push(path.join(__dirname, '..', 'skills', 'autonomous-pilot', 'data', 'icp.json'));
  // 3. Racine projet
  paths.push(path.join(__dirname, '..', 'icp.json'));
  return paths;
}

function loadICP() {
  const now = Date.now();
  if (_icpCache && (now - _icpLoadedAt) < ICP_CACHE_TTL) return _icpCache;

  for (const p of _getICPPaths()) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        _icpCache = JSON.parse(raw);
        _icpLoadedAt = now;
        log.info('icp-loader', 'ICP charge depuis ' + p + ' (' + (_icpCache.niches || []).length + ' niches)');
        return _icpCache;
      }
    } catch (e) {
      log.warn('icp-loader', 'Erreur lecture ICP ' + p + ': ' + e.message);
    }
  }

  // Fallback : pas d'ICP configure
  _icpCache = null;
  _icpLoadedAt = now;
  return null;
}

// --- Selection ponderee de niche ---
// Retourne une niche selon les weights (probability-based)
function selectNicheWeighted(niches) {
  if (!niches || niches.length === 0) return null;
  if (niches.length === 1) return niches[0];

  const totalWeight = niches.reduce((sum, n) => sum + (n.weight || 10), 0);
  let rand = Math.random() * totalWeight;
  for (const niche of niches) {
    rand -= (niche.weight || 10);
    if (rand <= 0) return niche;
  }
  return niches[0]; // fallback
}

// --- Selection pour un brain cycle ---
// Retourne la niche a utiliser pour ce cycle + son contexte complet
function getNicheForCycle() {
  const icp = loadICP();
  if (!icp || !icp.niches || icp.niches.length === 0) return null;
  return selectNicheWeighted(icp.niches);
}

// --- Contexte ICP pour le prompt email (injecte dans claude-email-writer) ---
function getEmailContext(nicheSlug) {
  const icp = loadICP();
  if (!icp) return null;

  const niche = nicheSlug
    ? (icp.niches || []).find(n => n.slug === nicheSlug)
    : null;

  return {
    clientDescription: icp.clientDescription || '',
    bookingUrl: icp.bookingUrl || process.env.GOOGLE_BOOKING_URL || '',
    niche: niche || null
  };
}

// --- Detecte la niche d'un lead a partir de ses donnees ---
function matchLeadToNiche(lead) {
  const icp = loadICP();
  if (!icp || !icp.niches) return null;

  const haystack = [
    lead.entreprise || lead.company || '',
    lead.titre || lead.title || '',
    lead.industry || '',
    lead.description || '',
    (lead.organization && lead.organization.short_description) || '',
    (lead.organization && lead.organization.industry) || ''
  ].join(' ').toLowerCase();

  if (!haystack || haystack.trim().length < 3) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const niche of icp.niches) {
    let score = 0;
    const patterns = niche.matchPatterns || [];
    for (const pattern of patterns) {
      if (haystack.includes(pattern.toLowerCase())) score += 2;
    }
    // Check keywords aussi (split sur OR)
    const keywords = (niche.keywords || '').split(/\s+OR\s+/i);
    for (const kw of keywords) {
      const kwLower = kw.trim().toLowerCase();
      if (kwLower && haystack.includes(kwLower)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = niche;
    }
  }

  return bestMatch;
}

// --- Detect trigger events from Apollo/lead data ---
function detectTrigger(lead, niche) {
  if (!niche || !niche.triggers) return null;

  const data = {
    hiring: false,
    growth: false,
    funding: false
  };

  // Check hiring signals
  const org = lead.organization || {};
  if (org.current_technologies && org.current_technologies.length > 0) data.tech = true;

  // Check growth from employee count or headcount changes
  if (org.estimated_num_employees && org.estimated_num_employees > 50) data.growth = true;
  if (org.employee_count_by_country && Object.keys(org.employee_count_by_country).length > 1) data.growth = true;

  // Check hiring from job postings
  if (lead.recrutementActif || (org.job_postings && org.job_postings > 0)) {
    data.hiring = true;
  }

  // Check recent funding
  if (org.last_funding_date || org.total_funding) {
    const fundingDate = new Date(org.last_funding_date);
    if (!isNaN(fundingDate.getTime()) && (Date.now() - fundingDate.getTime()) < 180 * 24 * 60 * 60 * 1000) {
      data.funding = true;
    }
  }

  // Match against niche triggers
  for (const trigger of niche.triggers) {
    if (trigger.signal === 'hiring_sales' && data.hiring) return trigger;
    if (trigger.signal === 'growth' && (data.hiring || data.growth)) return trigger;
    if (trigger.signal === 'funding' && data.funding) return trigger;
  }

  // Return default trigger if exists
  return niche.triggers.find(t => t.signal === 'default') || null;
}

// --- Toutes les niches ICP (pour le brain prompt) ---
function getAllNiches() {
  const icp = loadICP();
  if (!icp || !icp.niches) return [];
  return icp.niches;
}

// --- Description client ---
function getClientDescription() {
  const icp = loadICP();
  return (icp && icp.clientDescription) || process.env.CLIENT_DESCRIPTION || '';
}

// --- Booking URL ---
function getBookingUrl() {
  const icp = loadICP();
  return (icp && icp.bookingUrl) || process.env.GOOGLE_BOOKING_URL || '';
}

// --- Force reload (apres edit) ---
function invalidateCache() {
  _icpCache = null;
  _icpLoadedAt = 0;
}

module.exports = {
  loadICP,
  getNicheForCycle,
  selectNicheWeighted,
  getEmailContext,
  matchLeadToNiche,
  detectTrigger,
  getAllNiches,
  getClientDescription,
  getBookingUrl,
  invalidateCache
};
