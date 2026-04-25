'use strict';

/**
 * Declarative Pain Detector — analyse un texte arbitraire (post LinkedIn,
 * avis Glassdoor, comment Reddit/HN) et détecte si l'auteur exprime un
 * signal d'achat B2B (recherche active, plainte, projet).
 *
 * Si match + nom d'entreprise détecté :
 *   1. Attribution SIRENE via lookupByName (sirene.js, gratuit)
 *   2. Insert event de type 'declarative_pain' dans events
 *   3. Boost opus_score à minimum 9.0 sur les client_leads existants
 *
 * Désactivable via env DECLARATIVE_PAIN_ENABLED=false (défaut OFF).
 */

const fs = require('node:fs');
const path = require('node:path');
const { callAnthropic } = require('./anthropic-client');

const PROMPT_PATH = path.join(__dirname, 'prompts', 'detect-pain.md');
let _systemPrompt = null;
function getSystemPrompt() {
  if (!_systemPrompt) _systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf8');
  return _systemPrompt;
}

const MIN_TEXT_LENGTH = 30;     // skip texts trop courts
const MAX_TEXT_LENGTH = 4000;   // tronque pour cap coût Opus
const MIN_INTENT_STRENGTH = 5;  // ignore les matches faibles
const PAIN_SCORE_FLOOR = 9.0;   // boost minimum sur les leads matchés

/**
 * Analyse un texte, détecte un signal de douleur, et si match : attribue SIRENE +
 * insert event + boost score.
 *
 * @param {object} opts
 * @param {object} opts.db - sqlite handle
 * @param {string} opts.text - texte à analyser
 * @param {string} opts.sourceUrl - URL d'origine (LinkedIn post, Glassdoor review, etc.)
 * @param {string} opts.sourceType - 'linkedin' | 'glassdoor' | 'indeed' | 'reddit' | 'hn' | 'other'
 * @param {function} opts.lookupByName - fonction d'attribution SIRENE (injectable pour tests)
 * @param {function} opts.anthropicCaller - injectable pour tests
 * @param {object} opts.budget - tracker budget (optionnel, recordUsage si fourni)
 * @param {string} opts.tenantId - pour budget tracking (optionnel)
 * @param {object} opts.log
 * @returns {object} { match, action, siren?, event_id?, leads_boosted?, skip_reason? }
 */
async function analyzePain(opts) {
  const { db, text, sourceUrl, sourceType = 'other' } = opts;
  const log = opts.log || console;

  if (process.env.DECLARATIVE_PAIN_ENABLED !== 'true') {
    return { match: false, action: 'skipped', skip_reason: 'feature_disabled' };
  }
  if (!text || typeof text !== 'string' || text.trim().length < MIN_TEXT_LENGTH) {
    return { match: false, action: 'skipped', skip_reason: 'text_too_short' };
  }
  // Dédup par hash URL (évite re-analyse du même post)
  if (sourceUrl) {
    const already = db.prepare(`
      SELECT id FROM events
      WHERE source = 'declarative-pain'
        AND json_extract(raw_data, '$.source_url') = ?
      LIMIT 1
    `).get(sourceUrl);
    if (already) return { match: false, action: 'skipped', skip_reason: 'already_analyzed' };
  }

  const truncatedText = text.slice(0, MAX_TEXT_LENGTH);
  const caller = opts.anthropicCaller || callAnthropic;

  let result;
  try {
    const callResult = await caller({
      systemPrompt: getSystemPrompt(),
      voicePrompt: '',
      dataContext: `## Texte à analyser\nSource: ${sourceType}\n\n${truncatedText}`,
      model: 'opus',
      maxTokens: 800,
      json: true
    });
    result = callResult.result;
    // Tracking budget si fourni
    if (opts.budget && opts.tenantId) {
      try {
        opts.budget.recordUsage({
          tenantId: opts.tenantId,
          pipeline: 'detect-pain',
          inputTokens: callResult.usage.inputTokens,
          outputTokens: callResult.usage.outputTokens,
          cachedTokens: callResult.usage.cachedTokens,
          model: callResult.model
        });
      } catch (e) { log.warn?.(`[declarative-pain] budget record failed: ${e.message}`); }
    }
  } catch (e) {
    log.warn?.(`[declarative-pain] Opus call failed: ${e.message}`);
    return { match: false, action: 'error', skip_reason: e.message };
  }

  if (!result || result.match !== true) {
    return { match: false, action: 'no_signal', skip_reason: result?.reason };
  }

  const intentStrength = Number(result.intent_strength) || 0;
  if (intentStrength < MIN_INTENT_STRENGTH) {
    return { match: false, action: 'low_intent', skip_reason: `intent=${intentStrength}<${MIN_INTENT_STRENGTH}` };
  }

  // Pas de nom d'entreprise détecté → on ne peut pas attribuer
  if (!result.company_name) {
    return { match: true, action: 'no_attribution', pain_text: result.pain_text, intent_strength: intentStrength };
  }

  // Attribution SIRENE
  const lookupByName = opts.lookupByName;
  if (typeof lookupByName !== 'function') {
    log.warn?.('[declarative-pain] lookupByName non fourni — skip attribution');
    return { match: true, action: 'no_lookup_fn', pain_text: result.pain_text };
  }
  let attribution;
  try {
    attribution = await lookupByName(result.company_name, db);
  } catch (e) {
    log.warn?.(`[declarative-pain] lookupByName error: ${e.message}`);
    return { match: true, action: 'lookup_error', pain_text: result.pain_text, skip_reason: e.message };
  }
  if (!attribution || !attribution.siren) {
    return { match: true, action: 'siren_not_found', pain_text: result.pain_text, company_name: result.company_name };
  }

  // Upsert company si pas déjà connue
  try {
    db.prepare(`
      INSERT INTO companies (siren, raison_sociale, nom_complet, naf_code, naf_label, departement, effectif_min, effectif_max, enriched_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sirene')
      ON CONFLICT(siren) DO NOTHING
    `).run(
      attribution.siren,
      attribution.raison_sociale || result.company_name,
      attribution.nom_complet || null,
      attribution.naf_code || null,
      attribution.naf_label || null,
      attribution.departement || null,
      attribution.effectif_min || null,
      attribution.effectif_max || null
    );
  } catch (e) { log.warn?.(`[declarative-pain] company upsert failed: ${e.message}`); }

  // Insert event declarative_pain
  const rawData = {
    source_url: sourceUrl || null,
    source_type: sourceType,
    text_snippet: truncatedText.slice(0, 500),
    pain_text: result.pain_text,
    topic: result.topic,
    author_role: result.author_role,
    intent_strength: intentStrength,
    intent_reasoning: result.intent_strength_reasoning,
    suggested_pitch_angle: result.suggested_pitch_angle,
    detected_company_name: result.company_name
  };
  const eventInsert = db.prepare(`
    INSERT INTO events (source, event_type, siren, attribution_confidence, raw_data, normalized, event_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'declarative-pain',
    'declarative_pain',
    attribution.siren,
    intentStrength / 10,
    JSON.stringify(rawData),
    JSON.stringify({ topic: result.topic, intent: intentStrength }),
    new Date().toISOString()
  );

  // Boost les client_leads existants pour ce SIREN à PAIN_SCORE_FLOOR minimum
  const updateLeads = db.prepare(`
    UPDATE client_leads
    SET opus_score = MAX(COALESCE(opus_score, 0), ?),
        updated_at = CURRENT_TIMESTAMP
    WHERE siren = ? AND status IN ('new', 'qualifying')
  `).run(PAIN_SCORE_FLOOR, attribution.siren);

  log.info?.(`[declarative-pain] MATCH ${attribution.siren} (${result.company_name}) topic=${result.topic} intent=${intentStrength} → ${updateLeads.changes} leads boosted`);

  return {
    match: true,
    action: 'detected',
    siren: attribution.siren,
    event_id: eventInsert.lastInsertRowid,
    leads_boosted: updateLeads.changes,
    pain_text: result.pain_text,
    topic: result.topic,
    intent_strength: intentStrength
  };
}

module.exports = {
  analyzePain,
  MIN_TEXT_LENGTH,
  MAX_TEXT_LENGTH,
  MIN_INTENT_STRENGTH,
  PAIN_SCORE_FLOOR
};
