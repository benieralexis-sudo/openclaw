'use strict';

/**
 * Anthropic SDK wrapper — unifie les appels Opus pour tous les pipelines.
 *
 * Responsabilités :
 *   - Instancier le SDK avec la clé (ANTHROPIC_API_KEY ou CLAUDE_API_KEY fallback)
 *   - Construire les messages avec prompt caching (via cache.js)
 *   - Parser la sortie (JSON pour qualify/pitch/discover, markdown pour brief)
 *   - Retry 1x sur parse fail (demande au modèle de corriger son JSON)
 *   - Extraire usage tokens + latency pour tracking budget
 *   - Respecter model override par tenant (opus/sonnet/haiku)
 */

const { buildCachedMessages, extractUsage } = require('./cache');

const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_TOKENS = 4096;

let _sdk = null;
function getSdk() {
  if (_sdk) return _sdk;
  try {
    const { default: Anthropic } = require('@anthropic-ai/sdk');
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY (ou CLAUDE_API_KEY) manquante');
    _sdk = new Anthropic({ apiKey });
    return _sdk;
  } catch (e) {
    throw new Error(`Anthropic SDK load failed: ${e.message}`);
  }
}

/**
 * Modèles autorisés. Mapping nom court → id API complet.
 */
const MODEL_MAP = {
  opus: 'claude-opus-4-7',
  'claude-opus-4-7': 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001'
};

function resolveModel(input) {
  if (!input) return DEFAULT_MODEL;
  return MODEL_MAP[input] || DEFAULT_MODEL;
}

/**
 * Parse JSON strict avec retry. Essaie d'extraire le premier { ... } si le modèle
 * a enrobé la réponse.
 */
function parseJsonStrict(text) {
  if (!text) throw new Error('empty response');
  const trimmed = text.trim();
  // Essai direct
  try { return JSON.parse(trimmed); } catch {}
  // Essai sur le premier bloc {...} ou [...]
  const firstBrace = trimmed.search(/[{[]/);
  const lastBrace = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    return JSON.parse(candidate);
  }
  throw new Error('no valid JSON found in response');
}

/**
 * Extrait le texte de la réponse Anthropic.
 */
function extractText(response) {
  if (!response?.content) return '';
  const parts = Array.isArray(response.content) ? response.content : [response.content];
  return parts
    .filter(p => p?.type === 'text')
    .map(p => p.text)
    .join('\n');
}

/**
 * Appel générique Anthropic avec prompt caching et tracking usage.
 *
 * @param {object} args
 * @param {string} args.systemPrompt
 * @param {string} args.voicePrompt
 * @param {string} args.dataContext
 * @param {string} [args.model] — 'opus' | 'sonnet' | 'haiku' | id complet
 * @param {number} [args.maxTokens]
 * @param {boolean} [args.json] — si true, parse JSON strict
 * @param {object} [args.sdk] — injectable pour tests
 * @returns {Promise<{result: any, usage: object, model: string, latency_ms: number, raw_text: string}>}
 */
async function callAnthropic(args) {
  const sdk = args.sdk || getSdk();
  const model = resolveModel(args.model);
  const maxTokens = args.maxTokens || DEFAULT_MAX_TOKENS;
  const { system, messages } = buildCachedMessages({
    systemPrompt: args.systemPrompt,
    voicePrompt: args.voicePrompt,
    dataContext: args.dataContext
  });

  const t0 = Date.now();
  const response = await sdk.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages
  });
  const latency_ms = Date.now() - t0;
  const rawText = extractText(response);
  const usage = extractUsage(response);

  let result = rawText;
  if (args.json) {
    try {
      result = parseJsonStrict(rawText);
    } catch (e) {
      // Retry 1× : on redemande au modèle de corriger son JSON
      const retryResponse = await sdk.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [
          ...messages,
          { role: 'assistant', content: [{ type: 'text', text: rawText }] },
          { role: 'user', content: [{ type: 'text', text: 'Ta réponse n\'était pas du JSON valide. Renvoie uniquement le JSON de la sortie demandée, sans texte autour, sans markdown.' }] }
        ]
      });
      const retryText = extractText(retryResponse);
      result = parseJsonStrict(retryText);
      // Usage cumulé
      const retryUsage = extractUsage(retryResponse);
      usage.inputTokens += retryUsage.inputTokens;
      usage.outputTokens += retryUsage.outputTokens;
      usage.cachedTokens += retryUsage.cachedTokens;
    }
  }

  return { result, usage, model, latency_ms, raw_text: rawText };
}

module.exports = {
  callAnthropic,
  resolveModel,
  parseJsonStrict,
  extractText,
  MODEL_MAP,
  DEFAULT_MODEL
};
