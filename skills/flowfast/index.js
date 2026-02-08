// FlowFast Skill - Point d'entree OpenClaw
const FlowFastTelegramHandler = require('./telegram-handler.js');

// Creer le handler avec les cles d'environnement
const handler = new FlowFastTelegramHandler(
  process.env.APOLLO_API_KEY,
  process.env.HUBSPOT_API_KEY,
  process.env.OPENAI_API_KEY
);

// Export pour OpenClaw
module.exports = {
  name: 'flowfast',
  description: 'Automatisation prospection B2B - Apollo, IA, HubSpot',

  // Handler principal
  async onMessage(message, context) {
    if (!message || typeof message !== 'string') {
      return null;
    }

    // Retirer le prefixe "flowfast" si present
    let command = message.trim();
    command = command.replace(/^flowfast\s*/i, '').trim();

    // Si le message est vide apres le strip, afficher l'aide
    if (!command) {
      command = 'help';
    }

    // Construire le callback sendReply si le contexte le permet
    const sendReply = context && context.reply
      ? async (reply) => { await context.reply(reply.content); }
      : null;

    try {
      const response = await handler.handleMessage(command, sendReply);

      if (response && response.content) {
        return {
          type: 'text',
          content: response.content,
          parse_mode: 'Markdown'
        };
      }

      return null;
    } catch (error) {
      console.error('FlowFast error:', error);
      return {
        type: 'text',
        content: '❌ Erreur FlowFast : ' + error.message
      };
    }
  },

  // Commandes disponibles
  commands: {
    'flowfast [recherche]': 'Recherche en langage naturel (ex: flowfast cherche 20 CEO tech a Paris)',
    'flowfast stats': 'Affiche les statistiques',
    'flowfast score': 'Voir ou changer le score minimum (ex: flowfast score 8)',
    'flowfast leads': 'Voir les contacts HubSpot',
    'flowfast help': 'Affiche l\'aide',
    'flowfast test': 'Test de connexion'
  }
};
