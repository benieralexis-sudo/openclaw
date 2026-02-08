// FlowFast Telegram Bot - Standalone multi-utilisateurs
const https = require('https');
const FlowFastTelegramHandler = require('./telegram-handler.js');
const storage = require('./storage.js');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HUBSPOT_KEY = process.env.HUBSPOT_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const APOLLO_KEY = process.env.APOLLO_API_KEY || '';
const CLAUDE_KEY = process.env.CLAUDE_API_KEY || '';
const SENDGRID_KEY = process.env.SENDGRID_API_KEY || '';
const SENDER_EMAIL = process.env.SENDER_EMAIL || '';

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN manquant !');
  process.exit(1);
}

const handler = new FlowFastTelegramHandler(APOLLO_KEY, HUBSPOT_KEY, OPENAI_KEY, CLAUDE_KEY, SENDGRID_KEY, SENDER_EMAIL);
let offset = 0;

// --- API Telegram ---

function telegramAPI(method, body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + TOKEN + '/' + method,
      method: 'POST',
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
    // Si erreur Markdown, renvoyer sans parse_mode
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
  await telegramAPI('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
}

// --- Traitement des messages ---

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const userName = msg.from.first_name || 'Utilisateur';

  // Enregistrer/mettre a jour l'utilisateur
  storage.setUserName(chatId, userName);

  console.log('[' + new Date().toISOString() + '] ' + userName + ' (' + chatId + '): ' + text);

  await sendTyping(chatId);

  try {
    const sendReply = async (reply) => {
      await sendMessage(chatId, reply.content, 'Markdown');
    };

    const response = await handler.handleMessage(text, chatId, sendReply);

    if (response && response.content) {
      await sendMessage(chatId, response.content, 'Markdown');
      console.log('[' + new Date().toISOString() + '] Reponse envoyee a ' + userName);
    } else {
      await sendMessage(chatId, '🦀 Dis-moi ce que tu cherches !\n\nPar exemple :\n• _"cherche 10 CEO tech a Paris"_\n• _"trouve 5 agents immobiliers a Londres"_\n• _"aide"_', 'Markdown');
    }
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erreur:', error.message);
    await sendMessage(chatId, '❌ Oups, une erreur est survenue. Reessaie !');
  }
}

// --- Callback queries (boutons) ---

async function handleCallback(update) {
  const cb = update.callback_query;
  if (!cb || !cb.data) return;

  const chatId = cb.message.chat.id;
  const data = cb.data;

  // Acquitter le callback
  await telegramAPI('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});

  if (data.startsWith('feedback_')) {
    const parts = data.split('_');
    const type = parts[1]; // positive ou negative
    const email = parts.slice(2).join('_');
    storage.setLeadFeedback(email, type);
    storage.addFeedback(chatId, type);
    await sendMessage(chatId, type === 'positive' ? '👍 Merci pour le feedback !' : '👎 Note, je ferai mieux la prochaine fois !');
  }
}

// --- Long polling ---

async function poll() {
  while (true) {
    try {
      const result = await telegramAPI('getUpdates', {
        offset: offset,
        timeout: 30,
        allowed_updates: ['message', 'callback_query']
      });

      if (result.ok && result.result && result.result.length > 0) {
        for (const update of result.result) {
          offset = update.update_id + 1;
          if (update.callback_query) {
            handleCallback(update).catch(e => console.error('Erreur callback:', e.message));
          } else {
            handleUpdate(update).catch(e => console.error('Erreur handleUpdate:', e.message));
          }
        }
      }
    } catch (error) {
      console.error('[' + new Date().toISOString() + '] Erreur polling:', error.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// --- Demarrage ---

console.log('🦀 FlowFast Bot demarre...');
telegramAPI('getMe').then(result => {
  if (result.ok) {
    console.log('🦀 Bot connecte : @' + result.result.username + ' (' + result.result.first_name + ')');
    // Enregistrer les commandes du menu Telegram
    telegramAPI('setMyCommands', {
      commands: [
        { command: 'start', description: '🦀 Demarrer Mister Krabs' },
        { command: 'aide', description: '❓ Voir l\'aide' }
      ]
    }).catch(() => {});
    console.log('🦀 En attente de messages...');
    poll();
  } else {
    console.error('Erreur Telegram:', JSON.stringify(result));
    process.exit(1);
  }
}).catch(e => {
  console.error('Erreur fatale:', e.message);
  process.exit(1);
});
