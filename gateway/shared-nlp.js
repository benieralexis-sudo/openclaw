// MoltBot - Module NLP partage (callOpenAI centralise)
// Evite la duplication du meme code HTTP dans chaque handler
'use strict';

const https = require('https');
const { retryAsync } = require('./utils.js');
const { getBreaker } = require('./circuit-breaker.js');

/**
 * Appel OpenAI GPT-4o-mini unique (sans retry).
 * @param {string} apiKey - Cle API OpenAI
 * @param {Array} messages - Messages [{role, content}]
 * @param {Object} opts - Options {maxTokens, temperature, timeout, model}
 * @returns {Promise<{content: string, usage: Object|null}>}
 */
function _callOnce(apiKey, messages, opts) {
  opts = opts || {};
  const maxTokens = opts.maxTokens || 300;
  const temperature = opts.temperature || 0.2;
  const timeout = opts.timeout || 15000;
  const model = opts.model || 'gpt-4o-mini';

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: model,
      messages: messages,
      temperature: temperature,
      max_tokens: maxTokens
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (response.choices && response.choices[0]) {
            resolve({
              content: response.choices[0].message.content.trim(),
              usage: response.usage || null
            });
          } else {
            reject(new Error('Reponse OpenAI invalide: ' + body.substring(0, 200)));
          }
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout OpenAI NLP')); });
    req.write(postData);
    req.end();
  });
}

/**
 * Appel OpenAI avec retry (2 tentatives, backoff exponentiel).
 * @param {string} apiKey - Cle API OpenAI
 * @param {Array} messages - Messages [{role, content}]
 * @param {Object} opts - Options {maxTokens, temperature, timeout, model}
 * @returns {Promise<{content: string, usage: Object|null}>}
 */
function callOpenAI(apiKey, messages, opts) {
  const breaker = getBreaker('openai', { failureThreshold: 3, cooldownMs: 60000 });
  return breaker.call(() => retryAsync(() => _callOnce(apiKey, messages, opts), 2, 1000));
}

module.exports = { callOpenAI };
