// ═══════════════════════════════════════════════════════════════════
// Dropcontact — email finder & verifier (skeleton)
// ═══════════════════════════════════════════════════════════════════
// Docs: https://documenter.getpostman.com/view/3591390/TVsvhQpV
//
// Flow (sync endpoint):
//   POST /v1/enrich/all
//   Body: { data: [{ first_name, last_name, website, company }] }
//   Headers: { 'X-Access-Token': API_KEY }
//   Returns: { data: [{ email, email_qualification, ... }], ... }
//
// Tant que DROPCONTACT_API_KEY n'est pas dans .env, le module retourne
// null proprement (pas d'erreur). À activer quand Alexis souscrit le plan.
//
// Fallback pattern-guess: si Dropcontact indispo, génère des candidats
// email via patterns classiques FR (prenom.nom@, p.nom@, etc.) avec
// confidence basse.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const DROPCONTACT_API = 'https://api.dropcontact.io/v1/enrich/all';

function normalizeEmailPart(s) {
  if (!s) return '';
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Génère 3-4 candidats email selon patterns FR classiques.
 * @param {string} prenom
 * @param {string} nom
 * @param {string} domain - ex: 'axomove.com'
 * @returns {Array<{email, pattern, confidence}>}
 */
function guessEmails(prenom, nom, domain) {
  if (!domain || !prenom || !nom) return [];
  const p = normalizeEmailPart(prenom);
  const n = normalizeEmailPart(nom);
  if (!p || !n) return [];

  return [
    { email: `${p}.${n}@${domain}`, pattern: 'prenom.nom', confidence: 0.55 },
    { email: `${p[0]}.${n}@${domain}`, pattern: 'p.nom', confidence: 0.35 },
    { email: `${p}${n}@${domain}`, pattern: 'prenomnom', confidence: 0.30 },
    { email: `${n}@${domain}`, pattern: 'nom', confidence: 0.20 }
  ];
}

/**
 * Trouve email via Dropcontact si clé API configurée.
 * @returns {object|null} { email, confidence, source } ou null
 */
async function findEmail({ prenom, nom, domain, company }, opts = {}) {
  const log = opts.log;
  const apiKey = process.env.DROPCONTACT_API_KEY;
  if (!apiKey) {
    log?.debug?.('[dropcontact] DROPCONTACT_API_KEY not set — skipping');
    return null;
  }
  if (!prenom || !nom) return null;

  try {
    const res = await fetch(DROPCONTACT_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Token': apiKey
      },
      body: JSON.stringify({
        data: [{ first_name: prenom, last_name: nom, website: domain, company: company || '' }],
        siren: true,
        language: 'fr'
      }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!res.ok) {
      log?.warn?.(`[dropcontact] HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    // Note: Dropcontact retourne parfois un request_id (async). Pour la sync,
    // le flag 'data' est présent directement.
    if (json.request_id && !json.data) {
      log?.debug?.('[dropcontact] async mode detected — polling not yet implemented');
      return null;
    }
    const r = json.data?.[0];
    if (!r || !r.email?.[0]?.email) return null;
    return {
      email: r.email[0].email,
      confidence: r.email[0].qualification === 'correct' ? 0.95 : 0.7,
      source: 'dropcontact'
    };
  } catch (err) {
    log?.warn?.(`[dropcontact] error: ${err.message}`);
    return null;
  }
}

/**
 * Combine Dropcontact (si dispo) + fallback patterns.
 * Retourne une liste ordonnée par confidence décroissante.
 */
async function findEmails({ prenom, nom, domain, company }, opts = {}) {
  const results = [];

  // 1. Dropcontact en priorité (email vérifié)
  const dc = await findEmail({ prenom, nom, domain, company }, opts);
  if (dc) results.push(dc);

  // 2. Patterns en fallback (candidats non vérifiés)
  if (domain) {
    const guesses = guessEmails(prenom, nom, domain);
    for (const g of guesses) {
      results.push({ ...g, source: 'pattern-guess' });
    }
  }

  return results;
}

module.exports = {
  findEmail,
  findEmails,
  guessEmails,
  normalizeEmailPart
};
