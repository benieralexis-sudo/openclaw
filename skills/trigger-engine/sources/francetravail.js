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

const FRANCETRAVAIL_API = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';
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
  const params = new URLSearchParams({
    minCreationDate: new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19) + 'Z',
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

  for (const offer of offers) {
    const siret = offer.entreprise?.siret;
    const siren = siret ? String(siret).slice(0, 9) : null;
    const eventType = classifyOffer(offer.intitule, offer.appellationlibelle);
    const offerDate = offer.dateCreation ? offer.dateCreation.slice(0, 10) : new Date().toISOString().slice(0, 10);

    events.push({
      source: 'francetravail',
      event_type: eventType,
      siren,
      attribution_confidence: siren ? 1.0 : 0,
      raw_data: offer,
      normalized: {
        id: offer.id,
        intitule: offer.intitule,
        nom_entreprise: offer.entreprise?.nom,
        siret,
        lieu_travail: offer.lieuTravail?.libelle,
        type_contrat: offer.typeContrat,
        date_creation: offer.dateCreation
      },
      event_date: offerDate
    });

    if (!latestDate || offerDate > latestDate) latestDate = offerDate;
  }

  log?.info?.(`[francetravail] ingested ${events.length} events`);

  return {
    events,
    nextState: { last_event_id: latestDate }
  };
}

module.exports = { ingest, classifyOffer, getAccessToken };
