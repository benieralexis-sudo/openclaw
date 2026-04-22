// ═══════════════════════════════════════════════════════════════════
// France Travail API ingester — offres d'emploi FR nationales
// ═══════════════════════════════════════════════════════════════════
// Source: https://francetravail.io/catalogue-api
// API: Offres d'emploi v2 (OAuth2 required, free tier: 3000 req/day)
//
// Event types detected:
//   - hiring_tech              (offre tech: dev, QA, data, sysadmin)
//   - hiring_sales             (offre commercial, sales, biz dev)
//   - hiring_marketing         (marketing, growth, content)
//   - hiring_executive         (C-level, VP, Head of)
//   - hiring_finance           (DAF, contrôleur, comptable senior)
//   - hiring_hr                (DRH, HR Manager, recruteur)
//   - mass_hiring              (5+ offres ouvertes même entreprise <30j)
// ═══════════════════════════════════════════════════════════════════

'use strict';

const crypto = require('node:crypto');

const FRANCETRAVAIL_API = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';

/**
 * Génère un pseudo-SIREN stable basé sur le nom de l'entreprise.
 * L'API France Travail ne fournit pas le SIRET, on utilise un hash MD5 tronqué
 * du nom normalisé. Préfixé 'FT' pour distinguer des vrais SIREN INSEE (9 chiffres).
 * @param {string} nom
 * @returns {string|null} pseudo-SIREN de 9 caractères (ex: 'FT1234567') ou null
 */
function pseudoSirenFromName(nom) {
  if (!nom || typeof nom !== 'string') return null;
  const normalized = nom.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove accents
    .replace(/[^a-z0-9]+/g, '');
  if (!normalized) return null;
  const hash = crypto.createHash('md5').update(normalized).digest('hex');
  // 7 hex chars = 28 bits = ~268M unique values (bien plus que le nb d'entreprises FR)
  return 'FT' + hash.slice(0, 7);
}

/**
 * Blacklist des agences d'intérim et de recrutement qui polluent la data
 * car elles publient des centaines d'offres pour le compte de clients (pas pour elles-mêmes).
 * Ces entreprises ne sont PAS des prospects valides.
 */
const STAFFING_AGENCIES_BLACKLIST = [
  'adecco', 'manpower', 'randstad', 'crit', 'synergie', 'proman',
  'expectra', 'kelly services', 'gi group', 'start people', 'leader intérim',
  'supplay', 'rh intérim', 'actual', 'domino rh', 'partnaire',
  'temporis', 'adia', 'aquila rh', 'pole emploi',
  'menway', 'team emploi', 'ras', 'omega interim', 'rinesa', 'axeo'
];

/**
 * Keywords qui, s'ils apparaissent dans le nom, disqualifient l'entreprise
 * comme prospect. Matching par substring (après normalisation).
 * Couvre : intérim non listés, collectivités, écoles, franchises services,
 * banques étrangères, restos/cafés.
 */
const DISQUALIFYING_KEYWORDS = [
  'interim', 'intérim',
  'emploi',
  'mairie', 'commune de ', 'conseil departemental', 'conseil régional',
  'ccas', 'centre communal',
  'formation', ' cfa', 'académie',
  'restaurant', 'brasserie', ' cafe', ' café',
  'sup formation', 'evolution formation',
  'paroisse', 'diocese', 'diocèse'
];

function normalizeName(nom) {
  if (!nom) return '';
  return nom.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function isStaffingAgency(nom) {
  if (!nom) return false;
  const normalized = normalizeName(nom);
  return STAFFING_AGENCIES_BLACKLIST.some(bad =>
    normalized === bad || normalized.startsWith(bad + ' ') || normalized.startsWith(bad + '-')
  );
}

function hasDisqualifyingKeyword(nom) {
  if (!nom) return false;
  const normalized = ' ' + normalizeName(nom) + ' ';
  return DISQUALIFYING_KEYWORDS.some(kw => normalized.includes(kw));
}

function isBlacklisted(nom) {
  return isStaffingAgency(nom) || hasDisqualifyingKeyword(nom);
}
const OAUTH_URL = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire';

// Cache du token OAuth (expire en ~24h typiquement)
let _tokenCache = { token: null, expiresAt: 0 };

/**
 * Authentification OAuth2 client_credentials
 */
async function getAccessToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token;
  }

  const clientId = process.env.FRANCETRAVAIL_CLIENT_ID;
  const clientSecret = process.env.FRANCETRAVAIL_CLIENT_SECRET;
  const scope = process.env.FRANCETRAVAIL_SCOPE || 'api_offresdemploiv2 o2dsoffre';

  if (!clientId || !clientSecret) {
    throw new Error('FRANCETRAVAIL_CLIENT_ID + FRANCETRAVAIL_CLIENT_SECRET required');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope
  });

  const response = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    throw new Error(`France Travail OAuth failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + ((data.expires_in || 1500) * 1000) - 60000 // 60s buffer
  };
  return _tokenCache.token;
}

/**
 * Classifie le type d'offre en fonction du libellé
 */
function classifyOffer(libelle, appellation) {
  const text = `${libelle || ''} ${appellation || ''}`.toLowerCase();

  if (/\b(ceo|cto|cfo|cmo|coo|c-level|directeur|director|vp vice.president|head of)\b/.test(text)) {
    return 'hiring_executive';
  }
  if (/\b(daf|cfo|contr[ôo]leur|comptab(le|ilit[ée])|financier)\b/.test(text)) {
    return 'hiring_finance';
  }
  if (/\b(drh|rrh|human ressource|talent|recruteur|people)\b/.test(text)) {
    return 'hiring_hr';
  }
  if (/\b(developer|d[ée]velopp|dev\b|software|engineer|ing[ée]nieur|data|devops|sysadmin|sre|qa\b|test|frontend|backend|fullstack|cloud|devops)\b/.test(text)) {
    return 'hiring_tech';
  }
  if (/\b(sales|commercial|business dev|account exec|sdr\b|bdr\b|vendeur)\b/.test(text)) {
    return 'hiring_sales';
  }
  if (/\b(marketing|growth|content|communication|brand|seo|sem)\b/.test(text)) {
    return 'hiring_marketing';
  }
  return 'hiring_other';
}

/**
 * Ingestion France Travail
 */
async function ingest({ lastEventId, log } = {}) {
  const events = [];

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    log?.warn?.(`[francetravail] OAuth not configured (${err.message}) — skipping`);
    return { events: [], nextState: { last_error: err.message } };
  }

  // Fetch offres publiées dans les dernières 24h
  // API exige minCreationDate ET maxCreationDate ensemble
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const params = new URLSearchParams({
    minCreationDate: dayAgo.toISOString().slice(0, 19) + 'Z',
    maxCreationDate: now.toISOString().slice(0, 19) + 'Z',
    range: '0-149' // max 150 par requête
  });

  log?.info?.(`[francetravail] fetching offers from last 24h`);

  const response = await fetch(`${FRANCETRAVAIL_API}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`France Travail API: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const offers = data.resultats || [];

  let latestDate = lastEventId;

  let skippedStaffing = 0;
  for (const offer of offers) {
    const siret = offer.entreprise?.siret;
    const nom = offer.entreprise?.nom;

    // Skip les agences d'intérim + keywords disqualifiants (collectivités, écoles, etc.)
    if (isBlacklisted(nom)) {
      skippedStaffing += 1;
      continue;
    }

    // France Travail ne fournit plus le SIRET — fallback: pseudo-SIREN basé sur hash du nom
    let siren = siret ? String(siret).slice(0, 9) : null;
    let confidence = siret ? 1.0 : 0;
    if (!siren && nom) {
      siren = pseudoSirenFromName(nom);
      confidence = 0.6; // attribution par nom = moins fiable que SIRET direct
    }
    const eventType = classifyOffer(offer.intitule, offer.appellationlibelle);
    const offerDate = offer.dateCreation ? offer.dateCreation.slice(0, 10) : new Date().toISOString().slice(0, 10);

    events.push({
      source: 'francetravail',
      event_type: eventType,
      siren,
      attribution_confidence: confidence,
      raw_data: offer,
      normalized: {
        id: offer.id,
        intitule: offer.intitule,
        nom_entreprise: nom,
        siret: siret || null,
        siren_source: siret ? 'api' : 'name-hash',
        lieu_travail: offer.lieuTravail?.libelle,
        type_contrat: offer.typeContrat,
        date_creation: offer.dateCreation
      },
      event_date: offerDate
    });

    if (!latestDate || offerDate > latestDate) latestDate = offerDate;
  }

  log?.info?.(`[francetravail] ingested ${events.length} events (${skippedStaffing} staffing agencies skipped)`);

  return {
    events,
    nextState: { last_event_id: latestDate }
  };
}

module.exports = { ingest, classifyOffer, getAccessToken, isBlacklisted, isStaffingAgency, hasDisqualifyingKeyword };
