// iFIND - Client Telegram (API wrapper)
// Extrait de telegram-router.js — fonctions d'envoi Telegram

const https = require('https');
const log = require('./logger.js');

/**
 * Cree un client Telegram avec le token et l'agent HTTPS fournis.
 * @param {string} token - TELEGRAM_BOT_TOKEN
 * @param {https.Agent} httpsAgent - Agent HTTPS avec keepAlive
 * @returns {{ telegramAPI, sendMessage, sendTyping, sendMessageWithButtons }}
 */
function createTelegramClient(token, httpsAgent) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN manquant');

  function telegramAPI(method, body) {
    return new Promise((resolve, reject) => {
      const postData = body ? JSON.stringify(body) : '';
      const req = https.request({
        hostname: 'api.telegram.org',
        path: '/bot' + token + '/' + method,
        method: 'POST',
        agent: httpsAgent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Reponse Telegram invalide')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(postData);
      req.end();
    });
  }

  async function sendMessage(chatId, text, parseMode) {
    const maxLen = 4096;
    if (text.length <= maxLen) {
      const result = await telegramAPI('sendMessage', {
        chat_id: chatId,
        text: text,
        parse_mode: parseMode || undefined
      });
      if (!result.ok && parseMode) {
        return telegramAPI('sendMessage', { chat_id: chatId, text: text });
      }
      return result;
    }
    for (let i = 0; i < text.length; i += maxLen) {
      const chunk = text.slice(i, i + maxLen);
      await telegramAPI('sendMessage', {
        chat_id: chatId,
        text: chunk,
        parse_mode: parseMode || undefined
      }).catch(() => telegramAPI('sendMessage', { chat_id: chatId, text: chunk }));
    }
  }

  async function sendTyping(chatId) {
    await telegramAPI('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(e => log.warn('router', 'sendTyping echoue:', e.message));
  }

  async function sendMessageWithButtons(chatId, text, buttons) {
    const result = await telegramAPI('sendMessage', {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      reply_markup: JSON.stringify({ inline_keyboard: buttons })
    });
    if (!result.ok) {
      // Fallback sans Markdown
      return telegramAPI('sendMessage', {
        chat_id: chatId,
        text: text,
        reply_markup: JSON.stringify({ inline_keyboard: buttons })
      });
    }
    return result;
  }

  return { telegramAPI, sendMessage, sendTyping, sendMessageWithButtons };
}

module.exports = { createTelegramClient };
