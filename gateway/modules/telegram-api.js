// Module extrait de telegram-router.js — API Telegram (send, buttons, typing)
const https = require('https');
const log = require('../logger.js');

let _token = null;
let _httpsAgent = null;

function init(token, httpsAgent) {
  _token = token;
  _httpsAgent = httpsAgent;
}

function escTg(text) {
  if (!text) return '';
  return String(text).replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&').substring(0, 2000);
}

function telegramAPI(method, body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + _token + '/' + method,
      method: 'POST',
      agent: _httpsAgent,
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
    return telegramAPI('sendMessage', {
      chat_id: chatId,
      text: text,
      reply_markup: JSON.stringify({ inline_keyboard: buttons })
    });
  }
  return result;
}

module.exports = { init, escTg, telegramAPI, sendMessage, sendTyping, sendMessageWithButtons };
