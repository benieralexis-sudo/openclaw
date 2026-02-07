const TelegramBot = require('/usr/local/lib/node_modules/node-telegram-bot-api');
const FlowFastTelegramHandler = require('./telegram-handler.js');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HUBSPOT_KEY = process.env.HUBSPOT_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const APOLLO_KEY = process.env.APOLLO_API_KEY || '';
const ALLOWED_CHAT_ID = 1409505520;

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN manquant !');
  process.exit(1);
}

console.log('Demarrage FlowFast Telegram Bot...');

const bot = new TelegramBot(TOKEN, { polling: true });
const handler = new FlowFastTelegramHandler(APOLLO_KEY, HUBSPOT_KEY, OPENAI_KEY);

console.log('Bot connecte ! En attente de messages...');

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  if (chatId !== ALLOWED_CHAT_ID) {
    console.log('Acces refuse pour chat ID: ' + chatId);
    await bot.sendMessage(chatId, 'Acces refuse.');
    return;
  }

  console.log('Message recu de ' + msg.from.first_name + ': ' + text);
  try {
    const sendReply = async (reply) => {
      await bot.sendMessage(chatId, reply.content, { parse_mode: 'Markdown' });
    };
    const response = await handler.handleMessage(text, sendReply);
    if (response) {
      await bot.sendMessage(chatId, response.content, { parse_mode: 'Markdown' });
      console.log('Reponse envoyee');
    } else {
      await bot.sendMessage(chatId, 'Desole, je n\'ai pas compris. Tape `help` pour voir les commandes.', { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('Erreur:', error.message);
    await bot.sendMessage(chatId, 'Erreur: ' + error.message);
  }
});

bot.on('polling_error', (error) => {
  console.error('Erreur polling:', error.code || error.message);
});

console.log('FlowFast Bot pret ! Envoie "run" sur Telegram.');
