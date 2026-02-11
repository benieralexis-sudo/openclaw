// AutoMailer - Point d'entree OpenClaw
const AutoMailerHandler = require('./automailer-handler.js');

const handler = new AutoMailerHandler(
  process.env.OPENAI_API_KEY,
  process.env.CLAUDE_API_KEY,
  process.env.RESEND_API_KEY,
  process.env.SENDER_EMAIL || 'onboarding@resend.dev'
);

module.exports = {
  name: 'automailer',
  description: 'Campagnes email automatisees avec IA',

  async onMessage(message, context) {
    const sendReply = context && context.reply
      ? async (reply) => await context.reply(reply.content)
      : null;

    const response = await handler.handleMessage(message.replace(/^automailer\s*/i, ''), 'openclaw', sendReply);
    if (response) {
      return { type: response.type, content: response.content, parse_mode: 'Markdown' };
    }
    return null;
  },

  commands: {
    'automailer envoie un email a [email]': 'Envoyer un email',
    'automailer cree une campagne': 'Nouvelle campagne',
    'automailer mes campagnes': 'Voir les campagnes',
    'automailer importe des contacts': 'Importer des contacts',
    'automailer mes contacts': 'Voir les listes',
    'automailer stats': 'Statistiques',
    'automailer aide': 'Aide'
  }
};
