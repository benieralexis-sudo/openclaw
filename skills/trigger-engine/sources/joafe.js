// ═══════════════════════════════════════════════════════════════════
// JOAFE ingester — Journal Officiel des Associations et Fondations d'Entreprise
// ═══════════════════════════════════════════════════════════════════
// Source: https://www.journal-officiel.gouv.fr/associations/
// RSS: https://www.journal-officiel.gouv.fr/associations/rss/
// Free, no auth required.
//
// Event types detected:
//   - association_creation      (création association)
//   - association_modification  (modification statuts)
//   - association_dissolution   (dissolution)
//
// Use case: détecte fondations d'entreprise (CSR/RSE budget), nouvelles
// associations professionnelles (potentiel B2B), clubs sectoriels.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const JOAFE_RSS = 'https://www.journal-officiel.gouv.fr/associations/rss/';

/**
 * Map JOAFE type vers event_type
 */
function mapJoafeType(titre) {
  const t = (titre || '').toLowerCase();
  if (t.includes('création')) return 'association_creation';
  if (t.includes('modification')) return 'association_modification';
  if (t.includes('dissolution')) return 'association_dissolution';
  return 'joafe_other';
}

/**
 * Parse un RSS feed très basique (sans dépendance externe)
 * Extrait les items <item>...</item>
 */
function parseRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    const content = match[1];
    const title = (/<title>([\s\S]*?)<\/title>/.exec(content) || [])[1] || '';
    const link = (/<link>([\s\S]*?)<\/link>/.exec(content) || [])[1] || '';
    const pubDate = (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(content) || [])[1] || '';
    const description = (/<description>([\s\S]*?)<\/description>/.exec(content) || [])[1] || '';
    items.push({ title: title.trim(), link: link.trim(), pubDate: pubDate.trim(), description: description.trim() });
  }
  return items;
}

/**
 * Ingestion JOAFE
 */
async function ingest({ lastEventId, log } = {}) {
  const events = [];

  log?.info?.(`[joafe] fetching RSS: ${JOAFE_RSS}`);

  const response = await fetch(JOAFE_RSS, {
    headers: {
      'User-Agent': 'iFIND TriggerEngine/1.0 (contact: hello@ifind.fr)',
      Accept: 'application/rss+xml, application/xml, text/xml'
    }
  });

  if (!response.ok) {
    throw new Error(`JOAFE RSS returned ${response.status}`);
  }

  const xml = await response.text();
  const items = parseRss(xml);

  let latestDate = lastEventId;

  for (const item of items) {
    const eventType = mapJoafeType(item.title);
    const itemDate = item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    // Skip si déjà ingéré (last_event_id = dernière date)
    if (lastEventId && itemDate <= lastEventId) continue;

    events.push({
      source: 'joafe',
      event_type: eventType,
      siren: null, // JOAFE ne donne PAS de SIREN directement (associations, pas entreprises commerciales)
      attribution_confidence: 0, // attribution à faire via matching nom plus tard
      raw_data: item,
      normalized: {
        title: item.title,
        link: item.link,
        pubDate: item.pubDate
      },
      event_date: itemDate
    });

    if (!latestDate || itemDate > latestDate) latestDate = itemDate;
  }

  log?.info?.(`[joafe] ingested ${events.length} events, latest: ${latestDate}`);

  return {
    events,
    nextState: { last_event_id: latestDate }
  };
}

module.exports = { ingest, mapJoafeType, parseRss };
