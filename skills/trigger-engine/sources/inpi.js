// ═══════════════════════════════════════════════════════════════════
// INPI Diffusion PI ingester — Marques + Brevets + Dessins & Modèles
// ═══════════════════════════════════════════════════════════════════
// Source: https://api-gateway.inpi.fr/services/apidiffusion
// Auth: OAuth2 client_credentials (client_id + secret émis par INPI 24-48h
// après acceptation de la licence — arrivent par email)
//
// Event types détectés:
//   - marque_deposee           (dépôt nouvelle marque = signal produit)
//   - marque_modifiee          (modif existante, moins fort)
//   - brevet_depose            (R&D active)
//   - dessin_depose            (produit physique)
// ═══════════════════════════════════════════════════════════════════

'use strict';

const API_BASE = 'https://api-gateway.inpi.fr/services/apidiffusion/api';
const OAUTH_URL = 'https://api-gateway.inpi.fr/services/apidiffusion/api/oauth/token';

let _tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  const clientId = process.env.INPI_CLIENT_ID;
  const clientSecret = process.env.INPI_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt - 30_000) {
    return _tokenCache.token;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) return null;
  const json = await res.json();
  _tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000
  };
  return _tokenCache.token;
}

function mapInpiType(base, statut) {
  if (base === 'marques') {
    if (statut && /deposee|demande/i.test(statut)) return 'marque_deposee';
    return 'marque_deposee';
  }
  if (base === 'brevets') return 'brevet_depose';
  if (base === 'modeles') return 'dessin_depose';
  return 'inpi_other';
}

async function searchBase(base, token, { since, size = 50 } = {}) {
  const url = `${API_BASE}/${base}/search`;
  const body = {
    size,
    query: {
      bool: {
        filter: [
          { range: { depotDate: { gte: since } } }
        ]
      }
    },
    sort: [{ depotDate: 'desc' }]
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  return json?.results || json?.hits?.hits || json?.data || [];
}

function extractSiren(deposant) {
  if (!deposant) return null;
  const siren = deposant.siren || deposant.siret?.slice(0, 9) || null;
  return siren && /^\d{9}$/.test(siren) ? siren : null;
}

function extractCompanyName(deposant) {
  return deposant?.nom_commercial || deposant?.denomination || deposant?.nom || null;
}

async function ingest({ lastEventId, log } = {}) {
  const token = await getAccessToken();
  if (!token) {
    log?.info?.('[inpi] INPI_CLIENT_ID/SECRET not set yet — awaiting INPI email with OAuth credentials');
    return {
      events: [],
      nextState: { last_event_id: lastEventId, last_error: 'awaiting-oauth-credentials' }
    };
  }

  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const events = [];
  let maxId = lastEventId || '';

  for (const base of ['marques', 'brevets', 'modeles']) {
    try {
      const items = await searchBase(base, token, { since, size: 100 });
      for (const it of items) {
        const doc = it._source || it;
        const id = `${base}_${doc.numNat || doc.applicationNumber || doc.id}`;
        if (lastEventId && id <= lastEventId) continue;

        const deposant = Array.isArray(doc.deposants) ? doc.deposants[0] : doc.deposant;
        const siren = extractSiren(deposant);
        const companyName = extractCompanyName(deposant);
        if (!siren && !companyName) continue;

        events.push({
          source: 'inpi',
          source_event_id: id,
          event_type: mapInpiType(base, doc.statut),
          event_date: doc.depotDate || doc.dateDepot || new Date().toISOString(),
          siren: siren || `INPI${Buffer.from(companyName || id).toString('hex').slice(0, 8)}`,
          raw_company_name: companyName,
          raw_data: {
            base,
            nom_marque: doc.nom_marque || doc.denomination,
            statut: doc.statut,
            classes: doc.classes_produits || doc.classesProduits
          },
          confidence: siren ? 0.95 : 0.6
        });
        if (id > maxId) maxId = id;
      }
    } catch (err) {
      log?.warn?.(`[inpi] ${base}:`, err.message);
    }
  }

  log?.info?.(`[inpi] ${events.length} events extracted`);
  return {
    events,
    nextState: { last_event_id: maxId, last_run_at: new Date().toISOString() }
  };
}

module.exports = { ingest, mapInpiType, getAccessToken };
