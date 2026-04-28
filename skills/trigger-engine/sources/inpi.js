// ═══════════════════════════════════════════════════════════════════
// INPI Diffusion PI ingester — Marques FR (signal "nouveau produit")
// ═══════════════════════════════════════════════════════════════════
// Source: https://api-gateway.inpi.fr/services/apidiffusion
// Auth: compte DATA INPI (email + password) via session + XSRF
//   1. GET /services/uaa/api/authenticate        → seed XSRF-TOKEN
//   2. POST /auth/login JSON                     → access_token + refresh_token
//   3. POST /services/apidiffusion/api/marques/search
//      Accept: application/xml (bug INPI JSON renderer)
//      Cookie: XSRF-TOKEN + access_token + session_token
//      x-forwarded-for requis (gestion quota)
//
// Filtre : `[ApplicationDate=X:99991231] ET [ApplicantIdentifier=*]`
//   → ne retourne que les marques déposées par des sociétés ayant un SIREN
//   → exclut individus & sociétés étrangères (~50% des dépôts)
//
// Limitation : ApplicantIdentifier est indexé côté INPI mais jamais renvoyé
// dans la réponse XML. On résout donc chaque DEPOSANT via SIRENE (recherche-entreprises.api.gouv.fr).
//
// Indexation INPI : hebdo le vendredi → fenêtre requête = 30 jours.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { XMLParser } = require('fast-xml-parser');

const GATEWAY = 'https://api-gateway.inpi.fr';
const SEED_URL = `${GATEWAY}/services/uaa/api/authenticate`;
const LOGIN_URL = `${GATEWAY}/auth/login`;
const SEARCH_MARQUES = `${GATEWAY}/services/apidiffusion/api/marques/search`;

const FIELDS = ['ApplicationNumber', 'Mark', 'DEPOSANT', 'ApplicationDate', 'ClassNumber', 'MarkCurrentStatusCode'];

let _session = { jar: null, expiresAt: 0 };

function updateJar(jar, res) {
  for (const c of res.headers.getSetCookie?.() || []) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1));
  }
}
const cookieHeader = (jar) => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function authenticate(log) {
  const user = process.env.INPI_USERNAME;
  const pwd = process.env.INPI_PASSWORD;
  if (!user || !pwd) {
    log?.info?.('[inpi] INPI_USERNAME/PASSWORD not set — skipping');
    return null;
  }
  const jar = new Map();

  const seed = await fetch(SEED_URL).catch(() => null);
  if (seed) updateJar(jar, seed);
  if (!jar.get('XSRF-TOKEN')) { log?.warn?.('[inpi] no XSRF-TOKEN'); return null; }

  const r = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-XSRF-TOKEN': jar.get('XSRF-TOKEN'),
      'Cookie': cookieHeader(jar)
    },
    body: JSON.stringify({ username: user, password: pwd, rememberMe: true }),
    signal: AbortSignal.timeout(15_000)
  });
  updateJar(jar, r);
  if (!r.ok) { log?.warn?.(`[inpi] login ${r.status}`); return null; }
  const body = await r.json().catch(() => null);
  if (body?.access_token && !jar.get('access_token')) jar.set('access_token', body.access_token);
  if (body?.refresh_token && !jar.get('refresh_token')) jar.set('refresh_token', body.refresh_token);

  if (!jar.get('access_token')) return null;
  return { jar, expiresAt: Date.now() + 4 * 60 * 1000 };
}

async function getSession(log) {
  if (_session.jar && Date.now() < _session.expiresAt) return _session;
  const s = await authenticate(log);
  if (s) _session = s;
  return s;
}

async function searchMarques(session, { since, from = 0, size = 100 } = {}) {
  const jar = session.jar;
  const XSRF = jar.get('XSRF-TOKEN');
  const cookie = [
    `XSRF-TOKEN=${XSRF}`,
    `access_token=${jar.get('access_token')}`,
    `session_token=${jar.get('access_token')}`  // testé : access_token marche, refresh_token ne marche pas
  ].join('; ');

  const res = await fetch(SEARCH_MARQUES, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/xml',  // JSON renderer INPI buggé → on force XML
      'X-XSRF-TOKEN': XSRF,
      'Cookie': cookie,
      'x-forwarded-for': '127.0.0.1'
    },
    body: JSON.stringify({
      collections: ['FR'],
      query: `[ApplicationDate=${since}:99991231] ET [ApplicantIdentifier=*]`,
      fields: FIELDS,
      position: from,
      size
    }),
    signal: AbortSignal.timeout(20_000)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`search marques ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.text();
}

const _parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'result' || name === 'field' || name === 'value'
});

function parseMarques(xml) {
  const j = _parser.parse(xml);
  const results = j.trademarkSearch?.results?.result || [];
  const count = parseInt(j.trademarkSearch?.metadata?.count) || 0;

  const items = results.map(r => {
    const out = { _documentId: r['@_documentId'] };
    const fields = r.fields?.field || [];
    for (const f of fields) {
      const name = f['@_name'];
      if (!name) continue;
      // Value peut être <value>X</value> ou <values><value>X</value>...</values>
      let value = f.value;
      if (Array.isArray(value)) value = value.map(v => String(v).trim()).filter(Boolean);
      else if (f.values?.value) value = (Array.isArray(f.values.value) ? f.values.value : [f.values.value]).map(v => String(v).trim());
      out[name] = value;
    }
    return out;
  });
  return { items, count };
}

function formatDate(d) {
  const s = Array.isArray(d) ? d[0] : d;
  const str = String(s || '').trim();
  if (/^\d{8}$/.test(str)) return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  return str || new Date().toISOString().slice(0, 10);
}

async function ingest({ lastEventId, log, storage } = {}) {
  const session = await getSession(log);
  if (!session) return { events: [], nextState: { last_event_id: lastEventId, last_error: 'auth-failed' } };
  const db = storage?.db || null;

  // Indexation hebdo vendredi → fenêtre 30j capture les retards
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');

  // Résolution SIREN via SIRENE (optionnelle — marche aussi sans DB)
  let sireneLookup = null;
  try {
    const sirene = require('./sirene');
    sireneLookup = sirene.lookupByName;
  } catch (e) { /* sirene module absent, fallback pseudo-SIREN */ }

  const events = [];
  let maxId = lastEventId || '';
  let totalCount = 0;
  let skippedNoSirenResolved = 0;
  let sirenResolved = 0;
  const MAX_SIRENE_LOOKUPS_PER_RUN = 50; // SIRENE rate-limite fortement
  let lookupsDone = 0;

  // Une seule page de 100 — on fait 1 run/jour via cron, ça suffit (indexation INPI hebdo)
  for (let page = 0; page < 1; page++) {
    let xml;
    try {
      xml = await searchMarques(session, { since, from: page * 200, size: 100 });
    } catch (err) {
      log?.warn?.(`[inpi] page ${page} failed: ${err.message}`);
      break;
    }
    const { items, count } = parseMarques(xml);
    totalCount = count;
    if (items.length === 0) break;

    for (const hit of items) {
      const appNum = Array.isArray(hit.ApplicationNumber) ? hit.ApplicationNumber[0] : hit.ApplicationNumber;
      if (!appNum) continue;
      const id = `marque_${appNum}`;
      if (lastEventId && id <= lastEventId) continue;

      const deposant = Array.isArray(hit.DEPOSANT) ? hit.DEPOSANT[0] : hit.DEPOSANT;
      if (!deposant) continue;

      // Résoudre via SIRENE — plafond de 50 lookups par run pour éviter rate-limit cascade
      let siren = null;
      let confidence = 0.6;
      if (sireneLookup && db && lookupsDone < MAX_SIRENE_LOOKUPS_PER_RUN) {
        try {
          const resolved = await sireneLookup(deposant, db, { log });
          lookupsDone++;
          if (resolved?.siren) {
            siren = resolved.siren;
            confidence = 0.9;
            sirenResolved++;
          }
        } catch (e) { /* silent */ }
      }

      if (!siren) {
        skippedNoSirenResolved++;
        continue; // pas de SIREN résolu = skip (retenté au prochain run)
      }

      const mark = Array.isArray(hit.Mark) ? hit.Mark[0] : hit.Mark;
      const classes = Array.isArray(hit.ClassNumber) ? hit.ClassNumber : (hit.ClassNumber ? [hit.ClassNumber] : []);

      events.push({
        source: 'inpi',
        source_event_id: id,
        event_type: 'marque_deposee',
        event_date: formatDate(hit.ApplicationDate),
        siren,
        raw_company_name: deposant,
        raw_data: {
          application_number: appNum,
          mark_name: mark,
          class_numbers: classes,
          status: hit.MarkCurrentStatusCode
        },
        confidence
      });
      if (id > maxId) maxId = id;
    }

    if (items.length < 200) break;
  }

  log?.info?.(`[inpi] ${events.length} events (${sirenResolved} SIREN resolved / ${totalCount} total in window / ${skippedNoSirenResolved} skipped)`);
  return {
    events,
    nextState: { last_event_id: maxId, last_run_at: new Date().toISOString() }
  };
}

module.exports = { ingest, authenticate, parseMarques };
