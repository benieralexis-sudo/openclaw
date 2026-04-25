'use strict';

/**
 * Pappers API — enrichissement premium FR
 *
 * Pourquoi Pappers en complément de SIRENE/recherche-entreprises gratuit :
 *   - Pas de rate limit aussi strict (Plan 75€/mois = 100 000 req/mois)
 *   - Bilans détaillés (CA, résultat net, effectif exact, capital social)
 *   - Dirigeants nominatifs (président, DG, gérants) avec dates de prise/fin
 *   - NAF labels complets et libellés FR propres
 *   - Forme juridique structurée
 *   - Statut "actif/cessé/radié" autoritatif
 *
 * Stratégie : SIRENE/recherche-entreprises reste la source PRIMAIRE pour
 * lookupByName (cache local), Pappers enrichit a posteriori les SIRENs détectés.
 *
 * Auth : PAPPERS_API_TOKEN dans .env (token URL query string)
 * Doc  : https://www.pappers.fr/api/documentation
 *
 * Fallback safe : si pas de token, toutes les fonctions retournent null
 * (appels skippés silencieusement).
 */

const API_BASE = 'https://api.pappers.fr/v2';
const USER_AGENT = 'iFIND-TriggerEngine/2.0';
const TIMEOUT_MS = 10_000;
const MIN_INTERVAL_MS = 100; // ~10 req/sec safe pour plan 75€

let _lastRequestAt = 0;
let _throttleChain = Promise.resolve();
let _consecutive_errors = 0;
let _circuitOpenUntil = 0;
const CIRCUIT_THRESHOLD = 8;
const CIRCUIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 min

function getToken() {
  return process.env.PAPPERS_API_TOKEN || null;
}

function isAvailable() {
  return !!getToken();
}

function isCircuitOpen() {
  return Date.now() < _circuitOpenUntil;
}

function tripCircuit(log) {
  _circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  _consecutive_errors = 0;
  log?.warn?.(`[pappers] circuit breaker OPEN ${CIRCUIT_COOLDOWN_MS / 60000}min`);
}

function throttle() {
  const wait = _throttleChain.then(async () => {
    const elapsed = Date.now() - _lastRequestAt;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
    _lastRequestAt = Date.now();
  });
  _throttleChain = wait.catch(() => {});
  return wait;
}

async function pappersFetch(path, log) {
  const token = getToken();
  if (!token) return null;
  if (isCircuitOpen()) {
    log?.debug?.(`[pappers] circuit open — skipping ${path}`);
    return null;
  }
  await throttle();
  const sep = path.includes('?') ? '&' : '?';
  const url = `${API_BASE}${path}${sep}api_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (res.status === 404) {
      _consecutive_errors = 0;
      return { _notFound: true };
    }
    if (res.status === 429 || res.status >= 500) {
      _consecutive_errors += 1;
      if (_consecutive_errors >= CIRCUIT_THRESHOLD) tripCircuit(log);
      log?.warn?.(`[pappers] ${res.status} on ${path}`);
      return null;
    }
    if (!res.ok) {
      log?.warn?.(`[pappers] ${res.status} on ${path}`);
      return null;
    }
    _consecutive_errors = 0;
    return await res.json();
  } catch (e) {
    _consecutive_errors += 1;
    if (_consecutive_errors >= CIRCUIT_THRESHOLD) tripCircuit(log);
    log?.warn?.(`[pappers] fetch error: ${e.message}`);
    return null;
  }
}

/**
 * Enrichissement détaillé d'une entreprise par SIREN.
 * @returns {object|null} { siren, raison_sociale, nom_complet, forme_juridique,
 *   naf_code, naf_label, effectif_min, effectif_max, departement, region,
 *   date_creation, date_cessation, capital_social, ca_dernier_exercice,
 *   resultat_net_dernier_exercice, dirigeants: [...], statut }
 */
async function enrichBySiren(siren, log) {
  if (!siren || !/^\d{9}$/.test(siren)) return null;
  const data = await pappersFetch(`/entreprise?siren=${siren}`, log);
  if (!data || data._notFound) return null;
  return normalizePappersResponse(data);
}

/**
 * Recherche entreprise par nom (alternative à SIRENE gratuit).
 * Utilisable en fallback ou pour confirmation cross-source.
 */
async function lookupByName(nom, log) {
  if (!nom || typeof nom !== 'string') return null;
  const data = await pappersFetch(
    `/recherche?q=${encodeURIComponent(nom)}&precision=standard&longueur=1`,
    log
  );
  if (!data?.resultats || data.resultats.length === 0) return null;
  return normalizePappersResponse(data.resultats[0]);
}

function normalizePappersResponse(raw) {
  if (!raw) return null;
  const tranche = parseTrancheEffectif(raw.tranche_effectif);
  const finances = (raw.finances && raw.finances[0]) || {};
  const dirigeants = Array.isArray(raw.representants)
    ? raw.representants.slice(0, 8).map(r => ({
        nom: r.nom_complet || `${r.prenom || ''} ${r.nom || ''}`.trim(),
        qualite: r.qualite || null,
        date_prise: r.date_prise_de_poste || null
      }))
    : [];
  return {
    siren: raw.siren,
    raison_sociale: raw.nom_entreprise || raw.denomination || raw.nom || null,
    nom_complet: raw.nom_entreprise || raw.denomination || null,
    forme_juridique: raw.forme_juridique || null,
    naf_code: raw.code_naf || raw.activite_principale || null,
    naf_label: raw.libelle_code_naf || raw.activite_principale_libelle || null,
    effectif_min: tranche.min,
    effectif_max: tranche.max,
    departement: raw.siege?.departement || raw.departement || null,
    region: raw.siege?.region || null,
    date_creation: raw.date_creation || null,
    date_cessation: raw.date_cessation || null,
    capital_social: raw.capital ? Number(raw.capital) : null,
    ca_dernier_exercice: finances.chiffre_affaires ? Number(finances.chiffre_affaires) : null,
    resultat_net_dernier_exercice: finances.resultat ? Number(finances.resultat) : null,
    dirigeants,
    statut: raw.entreprise_cessee ? 'cessee' : (raw.statut_rcs === 'Radié' ? 'radiee' : 'active'),
    enriched_source: 'pappers'
  };
}

function parseTrancheEffectif(tranche) {
  if (!tranche || typeof tranche !== 'string') return { min: null, max: null };
  const m = tranche.match(/(\d+)[\s ]*(?:à|-)\s*(\d+)/);
  if (m) return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
  const single = tranche.match(/(\d+)/);
  if (single) {
    const v = parseInt(single[1], 10);
    return { min: v, max: v };
  }
  return { min: null, max: null };
}

/**
 * Enrichit (ou met à jour) une row dans la table companies via SIREN.
 * Ne fait rien si Pappers indisponible ou SIREN inconnu côté API.
 */
async function enrichCompanyRow(db, siren, log) {
  if (!isAvailable()) return { skipped: true, reason: 'no-token' };
  const data = await enrichBySiren(siren, log);
  if (!data) return { skipped: true, reason: 'not-found-or-error' };
  db.prepare(`
    UPDATE companies
    SET raison_sociale = COALESCE(?, raison_sociale),
        nom_complet = COALESCE(?, nom_complet),
        forme_juridique = COALESCE(?, forme_juridique),
        naf_code = COALESCE(?, naf_code),
        naf_label = COALESCE(?, naf_label),
        effectif_min = COALESCE(?, effectif_min),
        effectif_max = COALESCE(?, effectif_max),
        departement = COALESCE(?, departement),
        region = COALESCE(?, region),
        date_creation = COALESCE(?, date_creation),
        date_cessation = COALESCE(?, date_cessation),
        last_enriched_at = CURRENT_TIMESTAMP,
        enriched_source = 'pappers'
    WHERE siren = ?
  `).run(
    data.raison_sociale, data.nom_complet, data.forme_juridique,
    data.naf_code, data.naf_label,
    data.effectif_min, data.effectif_max,
    data.departement, data.region,
    data.date_creation, data.date_cessation,
    siren
  );
  return { ok: true, data };
}

module.exports = {
  isAvailable,
  enrichBySiren,
  lookupByName,
  enrichCompanyRow,
  normalizePappersResponse,
  parseTrancheEffectif
};
