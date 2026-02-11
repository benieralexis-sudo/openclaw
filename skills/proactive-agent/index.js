// Proactive Agent - Entry point
// Note: l'instantiation se fait dans le routeur car ce skill
// a besoin du callback sendTelegram et de callClaude du routeur

module.exports = {
  name: 'proactive-agent',
  description: 'Agent proactif - Rapports, alertes et monitoring automatiques'
};
