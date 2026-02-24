// Meeting Scheduler - Fonctions utilitaires (testables, 0 dependances)
'use strict';

// Escape Markdown Telegram MarkdownV2
function escTg(text) {
  if (!text) return '';
  return String(text).replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&').substring(0, 2000);
}

// Classification d'intention message utilisateur
function classifyIntent(text) {
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\b(propose|planifi|rdv|rendez|book|reserve|cale|caler)\b/i.test(t)) return 'propose';
  if (/\b(no.?show|pas.?venu|absent|ghost)\b/i.test(t)) return 'no_show';
  if (/\b(statut|status|etat)\b/i.test(t)) return 'status';
  if (/\b(prochain|a venir|upcoming|agenda)\b/i.test(t)) return 'upcoming';
  if (/\b(historique|passe|recents?|derniers?)\b/i.test(t)) return 'history';
  if (/\b(configur|parametr|calcom|cal\.com|cle.*api|api.*key)\b/i.test(t)) return 'configure';
  if (/\b(lien|link|url)\b/i.test(t)) return 'link';
  if (/\b(aide|help)\b/i.test(t)) return 'help';
  return 'status';
}

module.exports = { escTg, classifyIntent };
