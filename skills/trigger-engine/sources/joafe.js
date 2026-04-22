// ═══════════════════════════════════════════════════════════════════
// JOAFE ingester — Journal Officiel Associations et Fondations d'Entreprise
// ═══════════════════════════════════════════════════════════════════
// Source : DILA Open Data — https://echanges.dila.gouv.fr/OPENDATA/ASSOCIATIONS/
// Publication : ~1 fichier/semaine (bulk tar + XML ISO-8859-1, ~3.7 MB)
// Filename: ASSYYYYNNNN.taz (tar non-gzippé, le serveur décompresse auto)
//
// Event types détectés :
//   - association_creation       (type code="1")
//   - association_modification   (type code="2")
//   - association_dissolution    (type code="3")
//
// Attribution : on utilise l'idAssoc RNA (préfixé W0xxx) comme SIREN préfixé "ASS".
// Pour les fondations d'entreprise avec SIREN réel, on utilise le SIREN.
//
// Use case trigger-engine : détecte fondations d'entreprise récentes (CSR/RSE
// budget), associations professionnelles (B2B potentiel), clubs sectoriels.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { XMLParser } = require('fast-xml-parser');

const DILA_BASE = 'https://echanges.dila.gouv.fr/OPENDATA/ASSOCIATIONS';
const USER_AGENT = 'Mozilla/5.0 iFIND-TriggerEngine/1.0';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true
});

function latin1ToUtf8(buf) {
  return buf.toString('latin1');
}

/**
 * Extrait le contenu d'un tar archive simple (1 fichier interne).
 */
function extractFirstFileFromTar(buf) {
  if (buf.length < 512) return null;
  const sizeStr = buf.slice(124, 136).toString('utf8').replace(/\0/g, '').trim();
  const size = parseInt(sizeStr, 8);
  if (isNaN(size) || size <= 0 || size > buf.length - 512) return null;
  return buf.slice(512, 512 + size);
}

/**
 * Liste les fichiers ASS de l'année courante, retourne le plus récent.
 */
async function fetchLatestFilename(log) {
  const year = new Date().getFullYear();
  const url = `${DILA_BASE}/ASS_${year}/`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      log?.warn?.(`[joafe] index ${year} HTTP ${res.status}`);
      return null;
    }
    const html = await res.text();
    const matches = [...html.matchAll(/<a href="(ASS\d{8}\.taz)">/g)].map(m => m[1]);
    if (matches.length === 0) return null;
    matches.sort();
    return { filename: matches[matches.length - 1], year };
  } catch (err) {
    log?.warn?.(`[joafe] index fetch error: ${err.message}`);
    return null;
  }
}

async function downloadParution(filename, year, log) {
  const url = `${DILA_BASE}/ASS_${year}/${filename}`;
  log?.info?.(`[joafe] downloading ${filename}`);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const xml = extractFirstFileFromTar(buf);
  if (!xml) throw new Error('tar extraction failed');
  return latin1ToUtf8(xml);
}

function classifyAnnonce(annonce) {
  const typeCode = annonce.metadonnees?.type?.['@_code'];
  const contenu = annonce.contenu?.assoLoi1901 || annonce.contenu?.fondation || annonce.contenu;
  if (!contenu) return null;

  if (contenu.creation) return { type: 'association_creation', data: contenu.creation };
  if (contenu.modification) return { type: 'association_modification', data: contenu.modification };
  if (contenu.dissolution) return { type: 'association_dissolution', data: contenu.dissolution };
  if (typeCode === '1') return { type: 'association_creation', data: contenu };
  if (typeCode === '2') return { type: 'association_modification', data: contenu };
  if (typeCode === '3') return { type: 'association_dissolution', data: contenu };
  return null;
}

function extractIdentity(annonce, detail) {
  const contenu = annonce.contenu?.assoLoi1901 || annonce.contenu?.fondation || {};
  const title = detail?.titre || contenu.titre || contenu.nom || null;
  const objet = detail?.objet || contenu.objet || null;
  const siege = detail?.siegeSocial || contenu.siegeSocial || contenu.siege || null;
  const ville = siege?.ville || null;
  const cp = siege?.codePostal || null;
  const dept = annonce.metadonnees?.dept || (cp ? String(cp).slice(0, 2) : null);
  return { title, objet, ville, cp, dept };
}

async function ingest({ lastEventId, log } = {}) {
  const latest = await fetchLatestFilename(log);
  if (!latest) {
    log?.warn?.('[joafe] no parution found');
    return { events: [], nextState: { last_error: 'no parution' } };
  }

  if (lastEventId === latest.filename) {
    log?.info?.(`[joafe] already processed ${latest.filename}, skipping`);
    return { events: [], nextState: { last_event_id: latest.filename } };
  }

  let xml;
  try {
    xml = await downloadParution(latest.filename, latest.year, log);
  } catch (err) {
    log?.warn?.(`[joafe] download failed: ${err.message}`);
    return { events: [], nextState: { last_error: err.message } };
  }

  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    log?.warn?.(`[joafe] XML parse failed: ${err.message}`);
    return { events: [], nextState: { last_error: err.message } };
  }

  const dateParution = parsed.parution?.dateParution || new Date().toISOString().slice(0, 10);
  const annonces = parsed.parution?.listeAnnonces?.annonce || [];
  const arr = Array.isArray(annonces) ? annonces : [annonces];

  const events = [];
  let skipped = 0;

  for (const annonce of arr) {
    const idAssoc = annonce.metadonnees?.idAssoc;
    if (!idAssoc) { skipped += 1; continue; }

    const classified = classifyAnnonce(annonce);
    if (!classified) { skipped += 1; continue; }

    const identity = extractIdentity(annonce, classified.data);
    // Pour les fondations d'entreprise, on cherche un siren réel si présent
    const sirenReel = annonce.contenu?.fondation?.siren || annonce.contenu?.fondation?.identifiantSiren || null;
    const siren = sirenReel || `ASS${idAssoc}`;

    events.push({
      source: 'joafe',
      event_type: classified.type,
      siren,
      attribution_confidence: sirenReel ? 1.0 : 0.8,
      raw_data: {
        numAnnonce: annonce.metadonnees?.numAnnonce,
        identifiant: annonce.metadonnees?.identifiant,
        idAssoc,
        dateParution
      },
      normalized: {
        nom: identity.title,
        objet: identity.objet ? String(identity.objet).slice(0, 500) : null,
        ville: identity.ville,
        codePostal: identity.cp,
        departement: identity.dept,
        idAssoc,
        type: classified.type,
        dateParution,
        is_fondation: !!annonce.contenu?.fondation
      },
      event_date: dateParution
    });
  }

  log?.info?.(`[joafe] ${arr.length} annonces, ${events.length} events, ${skipped} skipped`);

  return {
    events,
    nextState: { last_event_id: latest.filename }
  };
}

module.exports = {
  ingest,
  classifyAnnonce,
  extractIdentity
};
