// Inbox Manager - Handler Telegram
const log = require('../../gateway/logger.js');
const storage = require('./storage.js');
const { callOpenAI } = require('../../gateway/shared-nlp.js');

// Escape Telegram Markdown v1
function escTg(text) {
  if (!text) return '';
  return String(text).replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&').substring(0, 500);
}

class InboxHandler {
  constructor(openaiKey) {
    this.openaiKey = openaiKey;
    this.pendingConversations = {};
    this.pendingConfirmations = {};
  }

  start() {
    log.info('inbox-handler', 'Handler inbox-manager demarre');
  }

  stop() {
    log.info('inbox-handler', 'Handler inbox-manager arrete');
  }

  async handleMessage(text, chatId, sendReply) {
    const id = String(chatId);
    const textLower = text.toLowerCase().trim();

    // Conversation en cours
    if (this.pendingConfirmations[id]) {
      return this._handleConfirmation(text, chatId, sendReply);
    }

    // Classification intention
    const intent = await this._classifyIntent(text);

    switch (intent) {
      case 'status':
        return this._handleStatus(chatId);
      case 'replies':
        return this._handleReplies(chatId);
      case 'recent':
        return this._handleRecent(chatId);
      case 'configure':
        return this._handleConfigure(text, chatId, sendReply);
      case 'enable':
        return this._handleEnable(chatId);
      case 'disable':
        return this._handleDisable(chatId);
      default:
        return this._handleHelp(chatId);
    }
  }

  async _classifyIntent(text) {
    const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Regex rapide
    if (/\b(statut|status|etat)\b/i.test(t)) return 'status';
    if (/\b(reponse|reply|repond|recu)\b/i.test(t)) return 'replies';
    if (/\b(recent|dernier|nouveau|inbox|boite)\b/i.test(t)) return 'recent';
    if (/\b(configur|parametr|imap|connect)\b/i.test(t)) return 'configure';
    if (/\b(activ|demarre?|lance|enable)\b/i.test(t)) return 'enable';
    if (/\b(desactiv|arret|stopp|disable)\b/i.test(t)) return 'disable';
    if (/\b(aide|help)\b/i.test(t)) return 'help';

    return 'status';
  }

  _handleStatus(chatId) {
    const config = storage.getConfig();
    const stats = storage.getStats();

    const lines = [
      '📬 *Inbox Manager*',
      '',
      '*Statut :* ' + (config.enabled ? '🟢 Actif' : '🔴 Desactive'),
      '*Derniere verification :* ' + (stats.lastCheckAt ? this._timeAgo(stats.lastCheckAt) : 'Jamais'),
      '*Verifications effectuees :* ' + (stats.checksCount || 0),
      '',
      '*Emails recus :* ' + (stats.totalReceived || 0),
      '*Reponses de leads :* ' + (stats.totalMatched || 0),
      '*Autres emails :* ' + (stats.totalUnmatched || 0)
    ];

    // Repartition par sentiment
    const breakdown = storage.getSentimentBreakdown();
    const totalClassified = breakdown.interested + breakdown.question + breakdown.not_interested + breakdown.out_of_office + breakdown.bounce;
    if (totalClassified > 0) {
      lines.push('');
      lines.push('*Analyse des reponses :*');
      if (breakdown.interested) lines.push('  🟢 Interesses : ' + breakdown.interested);
      if (breakdown.question) lines.push('  🟡 Questions : ' + breakdown.question);
      if (breakdown.not_interested) lines.push('  🔴 Pas interesses : ' + breakdown.not_interested);
      if (breakdown.out_of_office) lines.push('  🏖️ Absents : ' + breakdown.out_of_office);
      if (breakdown.bounce) lines.push('  💀 Bounces : ' + breakdown.bounce);
      if (breakdown.unclassified) lines.push('  ❓ Non classes : ' + breakdown.unclassified);
    }

    if (!config.enabled) {
      lines.push('');
      lines.push('_Configure les identifiants IMAP dans .env pour activer._');
      lines.push('_Variables : IMAP\\_HOST, IMAP\\_USER, IMAP\\_PASS_');
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _handleReplies(chatId) {
    const replies = storage.getRecentReplies(10);

    if (replies.length === 0) {
      return { type: 'text', content: '📬 Aucune reponse de lead detectee pour le moment.' };
    }

    const lines = ['📬 *Dernieres reponses de leads :*', ''];

    const SEMOJIS = { interested: '🟢', question: '🟡', not_interested: '🔴', out_of_office: '🏖️', bounce: '💀' };
    const SLABELS = { interested: 'Interesse', question: 'Question', not_interested: 'Pas interesse', out_of_office: 'Absent', bounce: 'Bounce' };

    for (const r of replies) {
      const name = r.matchedLead ? (r.matchedLead.name || r.from) : r.from;
      const date = new Date(r.processedAt).toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      const sIcon = r.sentiment ? (SEMOJIS[r.sentiment] || '❓') : '';
      const sLabel = r.sentiment ? ' — ' + (SLABELS[r.sentiment] || r.sentiment) : '';
      const sScore = r.sentimentScore != null ? ' (' + r.sentimentScore + ')' : '';
      lines.push((sIcon || '👤') + ' *' + escTg(name) + '*' + sLabel + sScore);
      lines.push('   📧 ' + escTg(r.from));
      lines.push('   📋 ' + escTg(r.subject || '(sans sujet)'));
      if (r.snippet) {
        lines.push('   💬 _' + escTg(r.snippet.substring(0, 100)) + (r.snippet.length > 100 ? '...' : '') + '_');
      }
      if (r.actionTaken) {
        const ACTIONS = {
          auto_meeting: '📅 Meeting propose', question_reply: '💬 Reponse IA',
          polite_decline: '👋 Decline poli', deferred_ooo: '⏳ Reporte',
          bounce_blacklist: '💀 Blackliste'
        };
        lines.push('   ⚡ ' + (ACTIONS[r.actionTaken] || r.actionTaken));
      }
      lines.push('   📅 ' + date);
      lines.push('');
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _handleRecent(chatId) {
    const emails = storage.getRecentEmails(15);

    if (emails.length === 0) {
      return { type: 'text', content: '📬 Aucun email recu dans la boite de reception.' };
    }

    const lines = ['📬 *Derniers emails recus :*', ''];

    for (const e of emails) {
      const isLead = !!e.matchedLead;
      const icon = isLead ? '🎯' : '📧';
      const date = new Date(e.processedAt).toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      lines.push(icon + ' *' + escTg(e.from) + '* — ' + escTg(e.subject || '(sans sujet)'));
      lines.push('   📅 ' + date + (isLead ? ' _(lead connu)_' : ''));
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _handleEnable(chatId) {
    storage.updateConfig({ enabled: true });
    return { type: 'text', content: '✅ Inbox Manager active ! Je surveille ta boite email.' };
  }

  _handleDisable(chatId) {
    storage.updateConfig({ enabled: false });
    return { type: 'text', content: '🔴 Inbox Manager desactive. Je ne surveille plus la boite email.' };
  }

  _handleConfigure(text, chatId, sendReply) {
    const config = storage.getConfig();
    const lines = [
      '⚙️ *Configuration Inbox Manager*',
      '',
      'Pour configurer l\'IMAP, ajoute ces variables dans ton `.env` :',
      '',
      '```',
      'IMAP_HOST=imap.ton-provider.com',
      'IMAP_PORT=993',
      'IMAP_USER=hello@ifind.fr',
      'IMAP_PASS=ton_mot_de_passe',
      '```',
      '',
      'Puis redemarre le bot avec `docker compose down && docker compose up -d`.',
      '',
      '*Intervalle de verification :* ' + ((config.pollIntervalMs || 120000) / 1000) + 's',
      '',
      '_Compatible avec tout provider IMAP : Gmail, OVH, Hostinger, Zoho, etc._'
    ];

    return { type: 'text', content: lines.join('\n') };
  }

  _handleConfirmation(text, chatId, sendReply) {
    const id = String(chatId);
    delete this.pendingConfirmations[id];
    return { type: 'text', content: 'OK !' };
  }

  _handleHelp(chatId) {
    const lines = [
      '📬 *Inbox Manager — Aide*',
      '',
      'Je surveille ta boite email pour detecter quand un prospect repond.',
      '',
      '*Commandes :*',
      '• _"statut inbox"_ — Voir le statut du listener',
      '• _"reponses recues"_ — Voir les reponses de leads',
      '• _"emails recents"_ — Voir les derniers emails',
      '• _"configurer imap"_ — Instructions de configuration',
      '• _"active inbox"_ — Activer la surveillance',
      '• _"desactive inbox"_ — Desactiver',
      '',
      'Quand un prospect connu repond, je te previens instantanement !'
    ];

    return { type: 'text', content: lines.join('\n') };
  }

  _timeAgo(isoDate) {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'A l\'instant';
    if (mins < 60) return 'Il y a ' + mins + ' min';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return 'Il y a ' + hours + 'h';
    const days = Math.floor(hours / 24);
    return 'Il y a ' + days + 'j';
  }
}

module.exports = InboxHandler;
