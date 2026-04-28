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
let _throttleChain = Promise.resolve();
const MIN_INTERVAL_MS = 1100;

// Circuit breaker : après N 429 consécutifs, pause totale des appels SIRENE.
// Cooldown adaptatif : 5 → 10 → 20 → 30 min selon récidive dans la fenêtre.
let _consecutive429 = 0;
let _circuitOpenUntil = 0;
let _circuitConsecutiveTrips = 0;
let _lastTripAt = 0;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWNS_MS = [5, 10, 20, 30].map(m => m * 60 * 1000);

function isCircuitOpen() {
  return Date.now() < _circuitOpenUntil;
}
function tripCircuit(log) {
  // Si la dernière trip date de >1h, reset le compteur de récidive
  if (Date.now() - _lastTripAt > 60 * 60 * 1000) _circuitConsecutiveTrips = 0;
  const idx = Math.min(_circuitConsecutiveTrips, CIRCUIT_COOLDOWNS_MS.length - 1);
  const cooldown = CIRCUIT_COOLDOWNS_MS[idx];
  _circuitOpenUntil = Date.now() + cooldown;
  _consecutive429 = 0;
  _circuitConsecutiveTrips++;
  _lastTripAt = Date.now();
  log?.warn?.(`[sirene] circuit OPEN ${cooldown / 60000}min (trip #${_circuitConsecutiveTrips}) — too many 429s`);
}
function record429(log) {
  _consecutive429++;
  if (_consecutive429 >= CIRCUIT_THRESHOLD) tripCircuit(log);
}
function recordSuccess() {
  _consecutive429 = 0;
}

// Mutex-chain : garantit que throttle() est séquentiel même en appels parallèles.
// Sans ça, 10 callers simultanés firent tous à t=0 et déclenchent un burst 429.
function throttle() {
  const wait = _throttleChain.then(async () => {
    const elapsed = Date.now() - _lastRequestAt;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
    _lastRequestAt = Date.now();
  });
  _throttleChain = wait.catch(() => {}); // la chain ne doit jamais rejecter
  return wait;
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
const LEGAL_FORMS = /^(sas|sa|sarl|sasu|eurl|sci|snc|selarl|scop|scs|sca|sas?u|societe|ste|stpe|ltd|co|cie|etablissements|ets|groupe|holding)$/;

function stripLegalForms(norm) {
  return norm.split(' ').filter(w => !LEGAL_FORMS.test(w)).join(' ').trim();
}

function isGoodMatch(searchName, apiResult) {
  const normSearch = normalizeName(searchName);
  const normNom = normalizeName(apiResult.nom_complet || '');
  const normSigle = normalizeName(apiResult.sigle || '');
  const normNomRaison = normalizeName(apiResult.nom_raison_sociale || '');

  // Match exact sur l'un des champs
  if (normNom === normSearch || normSigle === normSearch || normNomRaison === normSearch) {
    return true;
  }

  // Match sans forme juridique des 2 côtés (ex: "nda theobroma sasu" == "nda theobroma")
  const stripSearch = stripLegalForms(normSearch);
  const stripNom = stripLegalForms(normNom);
  const stripRaison = stripLegalForms(normNomRaison);
  if (stripSearch && (stripSearch === stripNom || stripSearch === stripRaison)) {
    return true;
  }

  // Match si le nom cherché est la première partie du nom complet (avant forme juridique)
  // Ex: "Qonto" vs "QONTO SAS"
  if (stripNom === normSearch || stripRaison === normSearch) return true;

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
async function fetchApiWithRetry(query, log, filters = {}) {
  if (isCircuitOpen()) {
    // Silent skip pendant cooldown — évite de polluer les logs WARN.
    return null;
  }
  // Filtres ICP avancés (gratuits, réduisent le bruit + évitent rate-limit) :
  //   tranche_effectif_salarie : 21|22|31|32|41 (11-49 / 50-99 / 100-249)
  //   categorie_juridique : 5499|5710|5485 (SAS, SARL, SASU, etc.)
  const qs = new URLSearchParams({ q: query, per_page: '5' });
  if (filters.tranche_effectif) qs.set('tranche_effectif_salarie', filters.tranche_effectif);
  if (filters.categorie_juridique) qs.set('categorie_juridique', filters.categorie_juridique);
  if (filters.code_postal) qs.set('code_postal', filters.code_postal);
  if (filters.est_qualiopi) qs.set('est_qualiopi', 'true');
  const url = `${API_BASE}?${qs.toString()}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000)
      });
      if (res.status === 429) {
        const retryAfterHeader = parseInt(res.headers.get('retry-after') || '', 10);
        // Backoff exponentiel + jitter ±20% : 1500 → 3000 → 6000 → 12000 ms
        const baseDelay = 1500 * Math.pow(2, attempt);
        const jitter = 1 + (Math.random() * 0.4 - 0.2);
        const delay = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? (retryAfterHeader * 1000) + 500
          : Math.round(baseDelay * jitter);
        log?.debug?.(`[sirene] 429 → wait ${delay}ms (attempt ${attempt + 1}/4)`);
        record429(log);
        if (isCircuitOpen()) return null; // circuit vient de s'ouvrir
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (!res.ok) {
        log?.warn?.(`[sirene] API ${res.status} for "${query}"`);
        return null;
      }
      recordSuccess();
      return await res.json();
    } catch (err) {
      log?.warn?.(`[sirene] fetch error for "${query}": ${err.message}`);
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
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

  // Cache hit (TTL : 30j pour found, 7j pour not_found — au-delà on re-tente)
  if (!opts.skipCache) {
    const cached = db.prepare(`
      SELECT *, julianday('now') - julianday(looked_up_at) AS age_days
      FROM siren_lookup_cache WHERE normalized_name = ?
    `).get(key);
    if (cached) {
      const ttlDays = cached.found === 1 ? 30 : 7;
      if (cached.age_days < ttlDays) {
        if (cached.found === 0) return null;
        return {
          siren: cached.siren,
          nom_complet: cached.nom_complet,
          naf_code: cached.naf_code,
          effectif: cached.effectif,
          departement: cached.departement
        };
      }
      // sinon : cache expiré, on re-fetch (l'UPSERT plus bas écrase l'entrée)
    }
  }

  // API call (filtres ICP optionnels via opts.filters pour réduire le bruit)
  const data = await fetchApiWithRetry(nom, log, opts.filters);

  // API failure (rate limit, timeout, 5xx) → don't poison cache, return null for retry later
  if (data === null) {
    // Silent quand le circuit est ouvert (sinon spam de WARN identique)
    if (!isCircuitOpen()) {
      log?.warn?.(`[sirene] API failed for "${nom}" — skipping cache write (will retry next run)`);
    }
    return null;
  }

  const results = data.results || [];

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

/**
 * Lookup par SIREN direct (plus fiable que par nom).
 * Utilisé pour enrichir les companies BODACC avec NAF/effectif/dept.
 * @param {string} siren - 9 chiffres
 * @param {object} [opts] - { log }
 */
async function lookupBySiren(siren, opts = {}) {
  if (!siren || !/^\d{9}$/.test(siren)) return null;
  const log = opts.log;
  const data = await fetchApiWithRetry(siren, log);
  const results = data?.results || [];
  const match = results.find(r => r.siren === siren) || results[0];
  if (!match) return null;
  return extractFields(match);
}

/**
 * Cherche le raw result complet (minimal=false) pour extraire dirigeants + site web.
 * Plus verbeux que lookupBySiren mais inclut les champs riches.
 * @param {string} siren
 * @param {object} [opts]
 * @returns {object|null} raw result ou null
 */
async function fetchFullRecord(siren, opts = {}) {
  if (!siren || !/^\d{9}$/.test(siren)) return null;
  const log = opts.log;
  const url = `${API_BASE}?q=${siren}&minimal=false&per_page=1`;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000)
      });
      if (res.status === 429) continue;
      if (!res.ok) {
        log?.warn?.(`[sirene-full] API ${res.status} for ${siren}`);
        return null;
      }
      const data = await res.json();
      return data.results?.find(r => r.siren === siren) || data.results?.[0] || null;
    } catch (err) {
      log?.warn?.(`[sirene-full] ${siren}: ${err.message}`);
    }
  }
  return null;
}

/**
 * Lookup dirigeants d'un SIREN via recherche-entreprises (minimal=false).
 * Retourne aussi le domaine web s'il est présent.
 * @param {string} siren
 * @param {object} [opts]
 * @returns {{dirigeants: Array, domain: string|null, effectif: number|null}|null}
 */
async function lookupDirigeants(siren, opts = {}) {
  const full = await fetchFullRecord(siren, opts);
  if (!full) return null;

  const dirigeants = (full.dirigeants || []).map(d => ({
    nom: d.nom || null,
    prenom: d.prenoms ? String(d.prenoms).split(/[ ,]+/)[0] : null,  // 1er prénom seulement
    fonction: d.qualite || null,
    annee_naissance: d.annee_de_naissance || null,
    dirigeant_type: d.type_dirigeant || 'personne physique'
  }));

  // Le site web peut être dans plusieurs champs selon l'API
  const sitesWeb = full.siege?.liste_finess || full.complements?.web || full.matching_etablissements?.[0]?.web || null;
  let domain = null;
  if (typeof sitesWeb === 'string') {
    // Extraire le domaine d'une URL
    try {
      const u = new URL(sitesWeb.startsWith('http') ? sitesWeb : 'https://' + sitesWeb);
      domain = u.hostname.replace(/^www\./, '');
    } catch {
      domain = String(sitesWeb).replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0] || null;
    }
  }

  return {
    dirigeants,
    domain,
    effectif: full.tranche_effectif_salarie ? parseInt(full.tranche_effectif_salarie, 10) : null
  };
}

/**
 * Batch enrichment des vrais SIRENs en DB qui n'ont pas de NAF/effectif/dept.
 * Utilise lookupBySiren pour compléter les champs.
 */
async function enrichExistingCompanies(db, opts = {}) {
  const log = opts.log || console;
  const limit = opts.limit || 100;
  const companies = db.prepare(`
    SELECT siren, raison_sociale FROM companies
    WHERE siren NOT LIKE 'FT%' AND naf_code IS NULL
    ORDER BY siren LIMIT ?
  `).all(limit);
  log.info?.(`[sirene-enrich] ${companies.length} vrais SIRENs à enrichir`);

  const upd = db.prepare(`
    UPDATE companies
    SET nom_complet = COALESCE(?, nom_complet),
        naf_code = ?,
        effectif_min = ?,
        effectif_max = ?,
        departement = ?,
        last_enriched_at = CURRENT_TIMESTAMP,
        enriched_source = 'sirene'
    WHERE siren = ?
  `);

  let enriched = 0, notFound = 0;
  for (const c of companies) {
    const result = await lookupBySiren(c.siren, { log });
    if (!result) { notFound += 1; continue; }
    upd.run(result.nom_complet, result.naf_code, result.effectif, result.effectif, result.departement, c.siren);
    enriched += 1;
  }
  log.info?.(`[sirene-enrich] enriched ${enriched}, not found ${notFound}, total ${companies.length}`);
  return { enriched, notFound, total: companies.length };
}

module.exports = {
  lookupByName,
  lookupBySiren,
  lookupDirigeants,
  fetchFullRecord,
  migratePseudoSirens,
  enrichExistingCompanies,
  normalizeName,
  isGoodMatch
};
