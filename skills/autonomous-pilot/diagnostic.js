// Autonomous Pilot - Systeme de diagnostic et checklist
const storage = require('./storage.js');

// --- Cross-skill imports (dual-path) ---

function _require(relativePath, absolutePath) {
  try { return require(relativePath); }
  catch (e) {
    try { return require(absolutePath); }
    catch (e2) { return null; }
  }
}

function getLeadEnrichStorage() {
  return _require('../lead-enrich/storage.js', '/app/skills/lead-enrich/storage.js');
}

function getAutomailerStorage() {
  return _require('../automailer/storage.js', '/app/skills/automailer/storage.js');
}

function getMoltbotConfig() {
  return _require('../../gateway/moltbot-config.js', '/app/gateway/moltbot-config.js');
}

// --- Diagnostic checks ---

function checkResendDomain() {
  const senderEmail = process.env.SENDER_EMAIL || '';
  if (!senderEmail || senderEmail === 'onboarding@resend.dev') {
    return {
      type: 'owner_action',
      priority: 'critical',
      category: 'config',
      message: 'Domaine Resend non configure — emails limites a onboarding@resend.dev',
      suggestion: 'Acheter un domaine et le configurer dans Resend, puis mettre a jour SENDER_EMAIL dans .env'
    };
  }
  return null;
}

function checkApolloCredits() {
  const leStorage = getLeadEnrichStorage();
  if (!leStorage) return null;
  try {
    const stats = leStorage.getStats();
    const creditsUsed = stats.apolloCreditsUsed || 0;
    const creditsLimit = stats.apolloCreditsLimit || 100;
    const remaining = creditsLimit - creditsUsed;
    if (remaining <= 0) {
      return {
        type: 'owner_action',
        priority: 'critical',
        category: 'api',
        message: 'Credits Apollo epuises (' + creditsUsed + '/' + creditsLimit + ')',
        suggestion: 'Attendre le reset mensuel (1er du mois) ou passer a un plan payant Apollo'
      };
    }
    if (remaining < 10) {
      return {
        type: 'owner_action',
        priority: 'warning',
        category: 'api',
        message: 'Credits Apollo presque epuises — ' + remaining + ' restants',
        suggestion: 'Limiter les recherches ou passer a un plan payant Apollo'
      };
    }
  } catch (e) {}
  return null;
}

function checkBudgetApi() {
  const config = getMoltbotConfig();
  if (!config) return null;
  try {
    const budget = config.getBudgetStatus();
    const pct = budget.dailyLimit > 0 ? (budget.todaySpent / budget.dailyLimit) * 100 : 0;
    if (pct >= 90) {
      return {
        type: 'bot_fixable',
        priority: 'warning',
        category: 'budget',
        message: 'Budget API a ' + Math.round(pct) + '% — ' +
          budget.todaySpent.toFixed(2) + '$/' + budget.dailyLimit + '$',
        suggestion: 'Le bot va reduire les appels API automatiquement'
      };
    }
  } catch (e) {}
  return null;
}

function checkApiKeys() {
  const items = [];
  const keys = {
    TELEGRAM_BOT_TOKEN: 'Telegram',
    OPENAI_API_KEY: 'OpenAI',
    CLAUDE_API_KEY: 'Claude'
  };
  for (const [envKey, name] of Object.entries(keys)) {
    if (!process.env[envKey]) {
      items.push({
        type: 'owner_action',
        priority: 'critical',
        category: 'config',
        message: 'Cle API ' + name + ' manquante (' + envKey + ')',
        suggestion: 'Ajouter ' + envKey + ' dans le fichier .env et relancer'
      });
    }
  }
  // Keys optionnelles mais importantes
  const optionalKeys = {
    HUBSPOT_API_KEY: 'HubSpot (CRM)',
    APOLLO_API_KEY: 'Apollo (enrichissement)',
    RESEND_API_KEY: 'Resend (emails)'
  };
  for (const [envKey, name] of Object.entries(optionalKeys)) {
    if (!process.env[envKey]) {
      items.push({
        type: 'owner_action',
        priority: 'warning',
        category: 'config',
        message: 'Cle API ' + name + ' manquante — skill correspondante desactivee',
        suggestion: 'Ajouter ' + envKey + ' dans .env pour activer ' + name
      });
    }
  }
  return items;
}

function checkLeadActivity() {
  const progress = storage.getProgress();
  const weekStart = new Date(progress.weekStart);
  const now = new Date();
  const daysSinceStart = (now - weekStart) / (24 * 60 * 60 * 1000);

  if (daysSinceStart >= 3 && progress.leadsFoundThisWeek === 0) {
    return {
      type: 'bot_fixable',
      priority: 'warning',
      category: 'performance',
      message: 'Aucun lead trouve depuis ' + Math.floor(daysSinceStart) + ' jours',
      suggestion: 'Le bot va lancer une recherche automatique au prochain cycle'
    };
  }
  return null;
}

function checkEmailPerformance() {
  const amStorage = getAutomailerStorage();
  if (!amStorage) return null;
  try {
    const stats = amStorage.getStats();
    const sent = stats.totalEmailsSent || 0;
    const opened = stats.totalEmailsOpened || 0;
    if (sent >= 10) {
      const openRate = Math.round((opened / sent) * 100);
      if (openRate < 15) {
        return {
          type: 'bot_fixable',
          priority: 'warning',
          category: 'performance',
          message: 'Open rate faible : ' + openRate + '% (objectif: 25%+)',
          suggestion: 'Le bot va demander a Self-Improve d\'optimiser les sujets d\'email'
        };
      }
    }
  } catch (e) {}
  return null;
}

function checkGoalsReachability() {
  const goals = storage.getGoals();
  const progress = storage.getProgress();
  const weekStart = new Date(progress.weekStart);
  const now = new Date();
  const daysElapsed = (now - weekStart) / (24 * 60 * 60 * 1000);
  const daysRemaining = Math.max(0, 7 - daysElapsed);

  if (daysRemaining <= 2 && daysElapsed >= 3) {
    const leadsNeeded = goals.weekly.leadsToFind - progress.leadsFoundThisWeek;
    const emailsNeeded = goals.weekly.emailsToSend - progress.emailsSentThisWeek;

    if (leadsNeeded > progress.leadsFoundThisWeek * 2) {
      return {
        type: 'bot_fixable',
        priority: 'info',
        category: 'performance',
        message: 'Objectif leads difficile a atteindre — ' + progress.leadsFoundThisWeek +
          '/' + goals.weekly.leadsToFind + ' avec ' + Math.round(daysRemaining) + ' jours restants',
        suggestion: 'Envisager de reduire l\'objectif ou d\'intensifier les recherches'
      };
    }
    if (emailsNeeded > progress.emailsSentThisWeek * 2) {
      return {
        type: 'bot_fixable',
        priority: 'info',
        category: 'performance',
        message: 'Objectif emails difficile a atteindre — ' + progress.emailsSentThisWeek +
          '/' + goals.weekly.emailsToSend + ' avec ' + Math.round(daysRemaining) + ' jours restants',
        suggestion: 'Envisager de reduire l\'objectif ou de preparer un batch d\'emails'
      };
    }
  }
  return null;
}

function checkBusinessContext() {
  const config = storage.getConfig();
  if (!config.businessContext) {
    return {
      type: 'owner_action',
      priority: 'warning',
      category: 'config',
      message: 'Contexte business non defini — le bot ne sait pas ce que tu vends',
      suggestion: 'Dis-moi "mon business c\'est..." sur Telegram pour que je personnalise la prospection'
    };
  }
  return null;
}

// --- Main diagnostic runner ---

function runFullDiagnostic() {
  const results = [];

  // Checks individuels
  const singleChecks = [
    checkResendDomain,
    checkBudgetApi,
    checkLeadActivity,
    checkEmailPerformance,
    checkGoalsReachability,
    checkBusinessContext
  ];

  for (const check of singleChecks) {
    try {
      const result = check();
      if (result) results.push(result);
    } catch (e) {
      console.log('[diagnostic] Erreur check:', e.message);
    }
  }

  // Check Apollo (peut retourner null)
  try {
    const apolloResult = checkApolloCredits();
    if (apolloResult) results.push(apolloResult);
  } catch (e) {}

  // Check API keys (retourne un array)
  try {
    const keyResults = checkApiKeys();
    results.push(...keyResults);
  } catch (e) {}

  // Ajouter les nouveaux items au storage (deduplique par message)
  for (const item of results) {
    storage.addDiagnosticItem(item);
  }

  // Auto-resolve les items qui ne sont plus d'actualite
  const openItems = storage.getOpenDiagnostics();
  const currentMessages = results.map(r => r.message);
  for (const item of openItems) {
    if (!currentMessages.includes(item.message)) {
      storage.resolveDiagnosticItem(item.id);
    }
  }

  storage.updateDiagnosticCheck();
  return storage.getOpenDiagnostics();
}

// --- Format pour Telegram ---

function formatChecklist() {
  const items = storage.getOpenDiagnostics();
  if (items.length === 0) {
    return '✅ *Tout est OK !*\nAucun probleme detecte.';
  }

  const priorityIcons = { critical: '🔴', warning: '🟡', info: '🔵' };
  const typeLabels = { owner_action: '👤 Toi', bot_fixable: '🤖 Bot' };

  let text = '📋 *Checklist Diagnostic*\n\n';

  // Grouper par priorite
  const critical = items.filter(i => i.priority === 'critical');
  const warning = items.filter(i => i.priority === 'warning');
  const info = items.filter(i => i.priority === 'info');

  for (const group of [critical, warning, info]) {
    for (const item of group) {
      const icon = priorityIcons[item.priority] || '⚪';
      const who = typeLabels[item.type] || '?';
      text += icon + ' ' + item.message + '\n';
      text += '   → ' + item.suggestion + '\n';
      text += '   _(' + who + ' | ' + item.category + ')_\n\n';
    }
  }

  const ownerCount = items.filter(i => i.type === 'owner_action').length;
  const botCount = items.filter(i => i.type === 'bot_fixable').length;
  text += '---\n';
  text += '👤 ' + ownerCount + ' action(s) pour toi | 🤖 ' + botCount + ' action(s) pour le bot';

  return text;
}

module.exports = {
  runFullDiagnostic,
  formatChecklist,
  checkResendDomain,
  checkApolloCredits,
  checkBudgetApi,
  checkApiKeys,
  checkLeadActivity,
  checkEmailPerformance,
  checkGoalsReachability,
  checkBusinessContext
};
