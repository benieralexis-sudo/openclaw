// ═══════════════════════════════════════════════════════════════════
// INPI Open Data ingester — Marques + brevets déposés en France
// ═══════════════════════════════════════════════════════════════════
// Source: https://data.inpi.fr/
// API: https://data.inpi.fr/export/api/
// Free, requires registration for some endpoints but marks search is public.
//
// Event types detected:
//   - marque_deposee           (dépôt nouvelle marque)
//   - brevet_depose            (dépôt brevet — rare sur PME)
//   - dessin_depose            (dépôt dessin et modèle)
//   - certification_label      (certification attribuée)
// ═══════════════════════════════════════════════════════════════════

'use strict';

// Note: INPI a 2 APIs — RNCS (Registre National du Commerce et des Sociétés, payant)
// et Data Open (marques/brevets/dessins, gratuit).
// Pour le MVP on utilise l'open data uniquement.
// Documentation: https://data.inpi.fr/page/api

const INPI_API = 'https://data.inpi.fr/export/api/';

/**
 * Normalise un type d'actif INPI vers event_type
 */
function mapInpiType(typeProtection) {
  const t = (typeProtection || '').toLowerCase();
  if (t.includes('marque')) return 'marque_deposee';
  if (t.includes('brevet')) return 'brevet_depose';
  if (t.includes('dessin') || t.includes('modèle')) return 'dessin_depose';
  if (t.includes('certification') || t.includes('label')) return 'certification_label';
  return 'inpi_other';
}

/**
 * Ingestion INPI — récupère les dépôts récents.
 *
 * NOTE: au démarrage Phase 1, on utilise un endpoint mock-ready qui peut être
 * remplacé par l'API réelle INPI quand testée en production. Placeholder pour
 * structurer le code sans dépendance externe bloquante.
 *
 * TODO (Phase 1 terrain):
 *   - Tester l'endpoint réel data.inpi.fr après inscription compte
 *   - Ajouter OAuth si requis pour l'API RNCS
 *   - Parser le format XML/JSON réel (à confirmer)
 */
async function ingest({ lastEventId, log } = {}) {
  log?.info?.('[inpi] ingester stub — TODO: wire real INPI open data API after account setup');

  // Return empty events pour l'instant — pattern matching ne dépend PAS d'INPI
  // en phase MVP. L'ingester sera activé dès que l'account INPI sera créé.
  return {
    events: [],
    nextState: {
      last_event_id: lastEventId,
      last_error: 'stub-not-activated'
    }
  };
}

module.exports = { ingest, mapInpiType, INPI_API };
