// ═══════════════════════════════════════════════════════════════════
// Kaspr — LinkedIn enrichment (email pro + email perso + tel + titre)
// ═══════════════════════════════════════════════════════════════════
// Docs: https://docs.developers.kaspr.io/
// Auth: "authorization: Bearer <KEY>"  (B majuscule obligatoire)
// Base: https://api.developers.kaspr.io
//
// Crédits initiaux (au 27/04/2026) :
//   workEmail 10000 | personalEmail 200 | phone 200 | export 2500
// Rate limits : 60/min, 500/hour, 500/day
//
// Use case principal : pour chaque lead qualifié (score >= 7) du bot,
// si on a une URL LinkedIn de la cible (CTO/DG/Head of QA), Kaspr
// retourne email pro + tel mobile + titre normalisé.
//
// Si pas de LinkedIn URL : Kaspr ne fonctionne PAS. Fallback Pappers
// dirigeants RCS + email patterns Dropcontact.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const BASE = process.env.KASPR_API_BASE || 'https://api.developers.kaspr.io';
const KEY = process.env.KASPR_API_KEY;

function authHeaders() {
  return {
    'authorization': `Bearer ${KEY}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'accept-version': 'v2.0'
  };
}

/**
 * Extrait le LinkedIn ID depuis une URL ou un ID brut.
 * Ex: "https://www.linkedin.com/in/williamhgates/" → "williamhgates"
 *     "williamhgates" → "williamhgates"
 */
function extractLinkedInId(idOrUrl) {
  if (!idOrUrl) return null;
  const s = String(idOrUrl).trim();
  const m = s.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1] : s.replace(/\/+$/, '');
}

/**
 * Vérifie que la clé API est valide. Retourne { user } ou null.
 */
async function verifyKey() {
  if (!KEY) return null;
  const res = await fetch(`${BASE}/keys/verifyKey`, { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Récupère le solde des crédits restants.
 * Retourne { workEmailCredits, personalEmailCredits, phoneCredits, exportCredits } ou null.
 */
async function getRemainingCredits() {
  if (!KEY) return null;
  const res = await fetch(`${BASE}/keys/remainingCredits`, { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Récupère les rate limits du workspace.
 */
async function getRateLimits() {
  if (!KEY) return null;
  const res = await fetch(`${BASE}/keys/rateLimits`, { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Enrichit un profil LinkedIn — coeur du module.
 *
 * @param {object} args
 * @param {string} args.id - LinkedIn ID ou URL complète (ex: "marc-dupont" ou "https://linkedin.com/in/marc-dupont")
 * @param {string} args.name - Nom complet (requis par l'API)
 * @param {Array<string>} [args.dataToGet] - Subset de ['workEmail','directEmail','phone']. Default = tous.
 * @param {Array<string>} [args.requiredData] - Si fourni, l'API ne renvoie qu'un résultat seulement si ces champs sont présents.
 * @returns {Promise<{ok, profile?, credits?, error?}>}
 */
async function enrichLinkedInProfile({ id, name, dataToGet, requiredData }) {
  if (!KEY) return { ok: false, error: 'KASPR_API_KEY missing' };
  if (!id || !name) return { ok: false, error: 'id and name are required' };

  const cleanId = extractLinkedInId(id);
  const body = { id: cleanId, name };
  if (Array.isArray(dataToGet) && dataToGet.length) body.dataToGet = dataToGet;
  if (Array.isArray(requiredData) && requiredData.length) body.requiredData = requiredData;

  const res = await fetch(`${BASE}/profile/linkedin`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });

  // Capture credits headers (pour log/monitoring dashboard v2)
  const credits = {
    workEmail: res.headers.get('Remaining-Work-Email-Credits'),
    directEmail: res.headers.get('Remaining-Direct-Email-Credits'),
    phone: res.headers.get('Remaining-Phone-Credits'),
    export: res.headers.get('Remaining-Export-Credits')
  };

  if (res.status === 402) return { ok: false, error: 'no_credits_left', credits };
  if (res.status === 429) return { ok: false, error: 'rate_limit_exceeded', credits };
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { ok: false, error: `http_${res.status}: ${txt.slice(0, 200)}`, credits };
  }

  const data = await res.json();
  return { ok: true, profile: data.profile, credits };
}

/**
 * Helper : enrichit un dirigeant identifié via Pappers
 * (qui donne prenom + nom + fonction mais pas LinkedIn URL).
 *
 * Stratégie : on suppose que le commercial / le bot a déjà identifié
 * la personne sur LinkedIn (via Sales Nav ou recherche manuelle ou Trigify).
 * Cette fonction est l'aboutissement du flow.
 */
async function enrichKnownProfile(linkedinUrl, fullName, options = {}) {
  return enrichLinkedInProfile({
    id: linkedinUrl,
    name: fullName,
    dataToGet: options.dataToGet || ['workEmail', 'phone'],
    requiredData: options.requiredData
  });
}

module.exports = {
  verifyKey,
  getRemainingCredits,
  getRateLimits,
  enrichLinkedInProfile,
  enrichKnownProfile,
  extractLinkedInId
};
