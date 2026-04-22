// ═══════════════════════════════════════════════════════════════════
// SIRENE Enricher — API gouvernementale gratuite recherche-entreprises
// ═══════════════════════════════════════════════════════════════════
// API: https://recherche-entreprises.api.gouv.fr/
// Docs: https://recherche-entreprises.api.gouv.fr/docs/
// Rate limit: 7 req/sec en anonyme → on throttle à 2 req/sec pour être safe
// Auth: aucune (gratuit, public)
//
// Usage:
//   const { lookupByName } = require('./sources/sirene');
//   const result = await lookupByName('Qonto', db);
//   // { siren, nom_complet, naf_code, effectif, departement } ou null si introuvable
//
// Cache: toutes les lookups sont cachées dans `siren_lookup_cache` (migration 002).
// Un lookup "not found" est aussi caché (évite de retaper l'API pour des noms chelous).
// ═══════════════════════════════════════════════════════════════════

'use strict';

const API_BASE = 'https://recherche-entreprises.api.gouv.fr/search';
const USER_AGENT = 'Mozilla/5.0 iFIND-TriggerEngine/1.0';

// Throttle global : 1 requête toutes les 1100ms max (~0.9 req/sec)
// L'API annonce 7 req/s mais on observe des 429 dès 2 req/s consécutives.
let _lastRequestAt = 0;
const MIN_INTERVAL_MS = 1100;

async function throttle() {
  const elapsed = Date.now() - _lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  _lastRequestAt = Date.now();
}

/**
 * Normalise un nom d'entreprise pour clé de cache stable.
 */
function normalizeName(nom) {
  if (!nom) return '';
  return nom.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Cherche un match exact/très proche entre le nom recherché et un résultat API.
 * Tolère les variantes SA/SAS/SARL/SASU en suffixe.
 */
function isGoodMatch(searchName, apiResult) {
  const normSearch = normalizeName(searchName);
  const normNom = normalizeName(apiResult.nom_complet || '');
  const normSigle = normalizeName(apiResult.sigle || '');
  const normNomRaison = normalizeName(apiResult.nom_raison_sociale || '');

  // Match exact sur l'un des champs
  if (normNom === normSearch || normSigle === normSearch || normNomRaison === normSearch) {
    return true;
  }

  // Match si le nom cherché est la première partie du nom complet (avant forme juridique)
  // Ex: "Qonto" vs "QONTO SAS"
  const firstWordsNom = normNom.split(' ').filter(w => !/^(sas|sa|sarl|sasu|eurl|sci|snc|selarl)$/.test(w)).join(' ');
  if (firstWordsNom === normSearch) return true;

  return false;
}

/**
 * Extrait les infos utiles du résultat API.
 */
function extractFields(apiResult) {
  return {
    siren: apiResult.siren,
    nom_complet: apiResult.nom_complet || apiResult.nom_raison_sociale || null,
    naf_code: apiResult.activite_principale || null,
    effectif: apiResult.tranche_effectif_salarie ? parseInt(apiResult.tranche_effectif_salarie, 10) : null,
    departement: apiResult.siege?.departement || null
  };
}

/**
 * Call API avec retry simple sur 429 (backoff linéaire).
 */
async function fetchApiWithRetry(query, log) {
  const url = `${API_BASE}?q=${encodeURIComponent(query)}&per_page=5`;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      const delay = 1500 * attempt;
      log?.debug?.(`[sirene] retry after ${delay}ms (attempt ${attempt + 1})`);
      await new Promise(r => setTimeout(r, delay));
    }
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000)
      });
      if (res.status === 429) continue; // retry
      if (!res.ok) {
        log?.warn?.(`[sirene] API ${res.status} for "${query}"`);
        return null;
      }
      return await res.json();
    } catch (err) {
      log?.warn?.(`[sirene] fetch error for "${query}": ${err.message}`);
    }
  }
  return null;
}

/**
 * Lookup principal : cherche un SIREN par nom d'entreprise.
 * @param {string} nom
 * @param {DatabaseSync} db - instance sqlite pour cache
 * @param {object} [opts] - { log, skipCache }
 * @returns {{siren, nom_complet, naf_code, effectif, departement}|null}
 */
async function lookupByName(nom, db, opts = {}) {
  if (!nom || !db) return null;
  const log = opts.log;
  const key = normalizeName(nom);
  if (!key) return null;

  // Cache hit
  if (!opts.skipCache) {
    const cached = db.prepare('SELECT * FROM siren_lookup_cache WHERE normalized_name = ?').get(key);
    if (cached) {
      if (cached.found === 0) return null;
      return {
        siren: cached.siren,
        nom_complet: cached.nom_complet,
        naf_code: cached.naf_code,
        effectif: cached.effectif,
        departement: cached.departement
      };
    }
  }

  // API call
  const data = await fetchApiWithRetry(nom, log);
  const results = data?.results || [];

  // Trouve le meilleur match
  let match = results.find(r => isGoodMatch(nom, r));
  // Fallback : si pas de match strict mais un seul résultat, prendre avec confidence réduite
  if (!match && results.length === 1) match = results[0];

  const upsert = db.prepare(`
    INSERT INTO siren_lookup_cache (normalized_name, siren, nom_complet, naf_code, effectif, departement, found, looked_up_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(normalized_name) DO UPDATE SET
      siren = excluded.siren,
      nom_complet = excluded.nom_complet,
      naf_code = excluded.naf_code,
      effectif = excluded.effectif,
      departement = excluded.departement,
      found = excluded.found,
      looked_up_at = CURRENT_TIMESTAMP
  `);

  if (!match) {
    upsert.run(key, null, null, null, null, null, 0);
    return null;
  }

  const extracted = extractFields(match);
  upsert.run(
    key,
    extracted.siren,
    extracted.nom_complet,
    extracted.naf_code,
    extracted.effectif,
    extracted.departement,
    1
  );
  log?.debug?.(`[sirene] ${nom} → ${extracted.siren} (${extracted.nom_complet})`);
  return extracted;
}

/**
 * Batch enrichment : résout les pseudo-SIREN 'FT...' existants en vrais SIRENs.
 * Merge les events vers le vrai SIREN et supprime la pseudo-company.
 *
 * @param {DatabaseSync} db
 * @param {object} [opts] - { log, limit }
 */
async function migratePseudoSirens(db, opts = {}) {
  const log = opts.log || console;
  const limit = opts.limit || 100;

  const pseudoCompanies = db.prepare(`
    SELECT c.siren, c.raison_sociale
    FROM companies c
    WHERE c.siren LIKE 'FT%'
    ORDER BY c.siren
    LIMIT ?
  `).all(limit);

  log.info?.(`[sirene-migrate] ${pseudoCompanies.length} pseudo-SIRENs à résoudre`);

  const updateEvent = db.prepare('UPDATE events SET siren = ?, attribution_confidence = 0.9 WHERE siren = ?');
  const deleteMatches = db.prepare('DELETE FROM patterns_matched WHERE siren = ?');
  const upsertCompany = db.prepare(`
    INSERT INTO companies (siren, raison_sociale, nom_complet, naf_code, effectif_min, effectif_max, departement, last_enriched_at, enriched_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'sirene')
    ON CONFLICT(siren) DO UPDATE SET
      raison_sociale = COALESCE(excluded.raison_sociale, raison_sociale),
      nom_complet = COALESCE(excluded.nom_complet, nom_complet),
      naf_code = COALESCE(excluded.naf_code, naf_code),
      departement = COALESCE(excluded.departement, departement),
      last_enriched_at = CURRENT_TIMESTAMP,
      enriched_source = 'sirene'
  `);
  const deleteCompany = db.prepare('DELETE FROM companies WHERE siren = ?');

  let resolved = 0;
  let notFound = 0;

  for (const c of pseudoCompanies) {
    const result = await lookupByName(c.raison_sociale, db, { log });
    if (!result || !result.siren) {
      notFound += 1;
      continue;
    }
    // Create/merge real company
    upsertCompany.run(
      result.siren,
      c.raison_sociale,
      result.nom_complet,
      result.naf_code,
      result.effectif,
      result.effectif,
      result.departement
    );
    // Migrate events from pseudo-siren to real siren
    updateEvent.run(result.siren, c.siren);
    // Remove matches on old pseudo-siren (will be re-computed on next processor cycle)
    deleteMatches.run(c.siren);
    // Remove pseudo-company
    deleteCompany.run(c.siren);
    resolved += 1;
  }

  log.info?.(`[sirene-migrate] resolved ${resolved}, not found ${notFound}, total ${pseudoCompanies.length}`);
  return { resolved, notFound, total: pseudoCompanies.length };
}

module.exports = {
  lookupByName,
  migratePseudoSirens,
  normalizeName,
  isGoodMatch
};
