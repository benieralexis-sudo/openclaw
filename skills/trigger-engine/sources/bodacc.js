// ═══════════════════════════════════════════════════════════════════
// BODACC ingester — Bulletin officiel des annonces civiles et commerciales
// ═══════════════════════════════════════════════════════════════════
// Source: https://bodacc-datadila.opendatasoft.com/explore/dataset/annonces-commerciales/
// API: https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/
// Free, no auth required. Updates daily around 03:00 UTC.
//
// Event types detected:
//   - company_creation     (immatriculation)
//   - company_cessation    (radiation)
//   - company_merger       (fusion)
//   - procedure_collective (redressement, liquidation, sauvegarde)
//   - modification_statuts (changement forme juridique, capital, siège)
// ═══════════════════════════════════════════════════════════════════

'use strict';

const BODACC_API = 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';

/**
 * Normalise un type d'annonce BODACC vers notre taxonomie d'events
 */
function mapFamilleAvis(familleAvis, typeAvis, contenu) {
  const f = (familleAvis || '').toLowerCase();
  const t = (typeAvis || '').toLowerCase();
  const c = (contenu || '').toLowerCase();

  if (f.includes('création') || t.includes('création')) return 'company_creation';
  if (f.includes('radiation') || t.includes('radiation')) return 'company_cessation';
  if (f.includes('procédure') || t.includes('redressement') || t.includes('liquidation') || t.includes('sauvegarde')) {
    return 'procedure_collective';
  }
  if (f.includes('fusion') || t.includes('fusion')) return 'company_merger';
  // Augmentation de capital = signal levée pré-officiel (1-2 sem avant Rodz/RSS).
  // Détection sur familleAvis OU contenu (ex: "augmentation du capital social")
  if (
    /augmentation\s+(de\s+|du\s+)?capital/.test(f) ||
    /augmentation\s+(de\s+|du\s+)?capital/.test(t) ||
    /augmentation\s+(de\s+|du\s+)?capital/.test(c)
  ) {
    return 'capital_increase';
  }
  if (f.includes('modification') || t.includes('modification')) return 'modification_statuts';
  return 'bodacc_other';
}

/**
 * Extrait le SIREN depuis les champs BODACC (parfois numerodegestion, parfois siren dans registre)
 */
function extractSiren(record) {
  if (record.registre && Array.isArray(record.registre)) {
    for (const reg of record.registre) {
      if (typeof reg === 'string' && /^\d{9}/.test(reg)) {
        return reg.slice(0, 9);
      }
    }
  }
  if (record.numerodepartement && record.numerodegestion) {
    // Formats possibles, on tente extraction simple
    const match = String(record.numerodegestion).match(/\d{9}/);
    if (match) return match[0];
  }
  return null;
}

/**
 * Ingestion BODACC
 * @param {object} ctx - { lastEventId, storage, log }
 * @returns {Promise<{events: Array, nextState: object}>}
 */
async function ingest({ lastEventId, log } = {}) {
  const events = [];
  const url = new URL(BODACC_API);

  // Fetch les 100 dernières annonces (ordre desc par dateparution)
  url.searchParams.set('limit', '100');
  url.searchParams.set('order_by', 'dateparution DESC');

  // Si on a déjà ingéré jusqu'à une certaine date, on filtre (>= pour inclure
  // la même journée, la dedup se fait via UNIQUE constraint sur (source, source_id))
  if (lastEventId) {
    url.searchParams.set('where', `dateparution >= date'${lastEventId}'`);
  }

  log?.info?.(`[bodacc] fetching: ${url.toString()}`);

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'iFIND TriggerEngine/1.0 (contact: hello@ifind.fr)',
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(`BODACC API returned ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const records = data.results || data.records || [];

  let latestDate = lastEventId;

  for (const record of records) {
    const siren = extractSiren(record);
    // Combine plusieurs champs pour la détection (ex: contenu_modification, modificationsgenerales)
    const contenuExtra = [
      record.contenu_modification,
      record.modificationsgenerales,
      record.contenu,
      typeof record.commercant === 'string' ? record.commercant : null,
    ].filter(Boolean).join(' ');
    const eventType = mapFamilleAvis(record.familleavis_lib, record.typeavis_lib, contenuExtra);
    const eventDate = record.dateparution || new Date().toISOString().slice(0, 10);

    events.push({
      source: 'bodacc',
      event_type: eventType,
      siren,
      attribution_confidence: siren ? 0.95 : 0,
      raw_data: record,
      normalized: {
        annonce_id: record.id,
        publication: record.publication,
        numerodepartement: record.numerodepartement,
        commercant: record.commercant,
        ville: record.ville,
        departement_nom: record.departement_nom_officiel,
        date_parution: eventDate
      },
      event_date: eventDate
    });

    if (!latestDate || eventDate > latestDate) {
      latestDate = eventDate;
    }
  }

  log?.info?.(`[bodacc] ingested ${events.length} events, latest: ${latestDate}`);

  return {
    events,
    nextState: {
      last_event_id: latestDate
    }
  };
}

module.exports = { ingest, mapFamilleAvis, extractSiren };
