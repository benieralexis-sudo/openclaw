// Self-Improve - Point d'entree OpenClaw
const SelfImproveHandler = require('./self-improve-handler.js');

module.exports = {
  name: 'self-improve',
  description: 'Boucle d\'amelioration continue du bot',
  handler: SelfImproveHandler
};
