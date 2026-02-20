// Web Intelligence - Handler NLP Telegram + crons de veille web
const { Cron } = require('croner');
const storage = require('./storage.js');
const WebFetcher = require('./web-fetcher.js');
const IntelligenceAnalyzer = require('./intelligence-analyzer.js');
const { callOpenAI: sharedCallOpenAI } = require('../../gateway/shared-nlp.js');
const { getModule } = require('../../gateway/skill-loader.js');
const log = require('../../gateway/logger.js');

function getHubSpotClient() { return getModule('hubspot-client'); }

class WebIntelligenceHandler {
  constructor(openaiKey, claudeKey, sendTelegramFn) {
    this.openaiKey = openaiKey;
    this.claudeKey = claudeKey;
    this.sendTelegram = sendTelegramFn;
    this.fetcher = new WebFetcher();
    this.analyzer = new IntelligenceAnalyzer(claudeKey);

    this.pendingConversations = {};
    this.pendingConfirmations = {};
    this.crons = [];
  }

  // --- Lifecycle ---

  start() {
    this.stop();
    const config = storage.getConfig();
    if (!config.enabled) {
      log.info('web-intel', 'Desactive, pas de crons');
      return;
    }

    const tz = 'Europe/Paris';

    // Scan automatique toutes les 6h
    this.crons.push(new Cron('0 */6 * * *', { timezone: tz }, () => {
      log.info('web-intel', 'Cron: scan auto');
      this._scheduledScan().catch(e => log.error('web-intel', 'Erreur scan auto:', e.message));
    }));
    log.info('web-intel', 'Cron: scan auto toutes les 6h');

    // Digest quotidien 10h (decale pour eviter embouteillage matinal)
    this.crons.push(new Cron('0 10 * * *', { timezone: tz }, () => {
      log.info('web-intel', 'Cron: digest quotidien');
      this._dailyDigest().catch(e => log.error('web-intel', 'Erreur digest:', e.message));
    }));
    log.info('web-intel', 'Cron: digest quotidien 10h');

    // Digest hebdo lundi 14h (decale pour eviter surcharge matinale du lundi)
    this.crons.push(new Cron('0 14 * * 1', { timezone: tz }, () => {
      log.info('web-intel', 'Cron: digest hebdo');
      this._weeklyDigest().catch(e => log.error('web-intel', 'Erreur digest hebdo:', e.message));
    }));
    log.info('web-intel', 'Cron: digest hebdo lundi 14h');

    // Initialiser les watches par defaut si aucune n'existe (premier demarrage)
    const existingWatches = storage.getWatches();
    if (Object.keys(existingWatches).length === 0) {
      const defaultWatches = [
        {
          name: 'SaaS & Startups France',
          type: 'sector',
          keywords: ['startup SaaS France', 'levée fonds startup', 'B2B SaaS français'],
          googleNewsEnabled: true
        },
        {
          name: 'Automatisation Commerciale',
          type: 'sector',
          keywords: ['automatisation prospection', 'sales automation', 'outbound B2B'],
          googleNewsEnabled: true
        },
        {
          name: 'Concurrents Prospection',
          type: 'competitor',
          keywords: ['Apollo.io', 'Clay.com', 'Lemlist', 'La Growth Machine'],
          googleNewsEnabled: true
        },
        {
          name: 'CEOs Tech PME',
          type: 'prospect',
          keywords: ['CEO startup recrutement', 'dirigeant PME tech', 'fondateur entreprise technologie'],
          googleNewsEnabled: true
        }
      ];
      for (const w of defaultWatches) {
        storage.addWatch(w);
        log.info('web-intel', 'Watch par defaut creee: ' + w.name);
      }
    }

    log.info('web-intel', 'Demarre avec ' + this.crons.length + ' cron(s)');
  }

  stop() {
    for (const cron of this.crons) {
      try { cron.stop(); } catch (e) {}
    }
    this.crons = [];
  }

  // --- NLP (via module partage) ---

  async callOpenAI(messages, maxTokens) {
    const result = await sharedCallOpenAI(this.openaiKey, messages, {
      maxTokens: maxTokens || 300,
      temperature: 0.3,
      timeout: 20000
    });
    return result.content;
  }

  async classifyIntent(message, chatId) {
    const id = String(chatId);
    const hasPendingConv = !!this.pendingConversations[id];
    const hasPendingConfirm = !!this.pendingConfirmations[id];
    const watches = storage.getEnabledWatches();
    const watchNames = watches.map(w => w.name).join(', ') || 'aucune';

    const systemPrompt = `Tu es l'assistant de veille web d'un bot Telegram. L'utilisateur parle en francais naturel, souvent informel.
Comprends son INTENTION pour router vers la bonne action.

Veilles actives : ${watchNames}

Actions :
- "create_watch" : creer une nouvelle veille
  Params: {"name":"...", "type":"prospect|competitor|sector", "keywords":["..."]}
  Ex: "surveille un concurrent", "ajoute une veille sur l'IA", "cree une veille concurrent HubSpot", "suis les news de Microsoft"
- "delete_watch" : supprimer une veille
  Params: {"name":"..."}
  Ex: "supprime la veille HubSpot", "arrete de surveiller HubSpot"
- "list_watches" : lister les veilles
  Ex: "mes veilles", "qu'est-ce que tu surveilles ?", "liste"
- "add_rss" : ajouter un flux RSS a une veille existante
  Params: {"url":"https://...", "watchName":"..."}
  Ex: "ajoute ce flux RSS https://...", "ajoute ce feed a la veille HubSpot"
- "add_scrape_url" : ajouter une page web a scraper
  Params: {"url":"https://...", "watchName":"..."}
  Ex: "surveille aussi cette page https://...", "scrape ce site"
- "check_now" : scanner maintenant
  Params: {"watchName":"..."} (optionnel)
  Ex: "check maintenant", "scan", "des nouvelles ?", "quoi de neuf ?", "scan HubSpot"
- "show_articles" : voir les derniers articles
  Params: {"watchName":"...", "limit":10}
  Ex: "articles HubSpot", "les dernieres news", "montre les articles", "news"
- "show_trends" : analyse de tendances
  Params: {"watchName":"..."}
  Ex: "tendances", "analyse du secteur", "quelles tendances ?"
- "summarize_recent" : l'utilisateur veut un resume des derniers articles/alertes, il a recu trop de messages ou veut un recapitulatif
  Ex: "fais-moi un resume", "resume tout ca", "regroupe les infos", "t'as envoye trop de messages", "un seul message stp", "resume les news", "c'est quoi l'essentiel ?", "dis-moi l'essentiel"
- "configure" : configurer
  Params: {"frequency":6, "digestEnabled":true}
  Ex: "scanne toutes les 2h", "desactive le digest", "configure"
- "competitive_digest" : analyse concurrentielle
  Ex: "digest concurrents", "analyse concurrentielle", "que font mes concurrents ?", "veille concurrentielle"
- "detect_trends" : detection des tendances montantes/descendantes
  Ex: "tendances montantes", "sujets en hausse", "quels sont les sujets qui montent ?", "trending"
- "news_for_company" : chercher les news d'une entreprise specifique pour la prospection
  Params: {"company":"..."}
  Ex: "news sur Microsoft", "articles sur HubSpot", "news de Salesforce"
- "show_stats" : statistiques
  Ex: "stats veille", "combien d'articles ?", "status"
- "confirm_yes" : oui, ok, go, parfait, c'est bon
- "confirm_no" : non, annule, stop
- "help" : aide
- "chat" : si aucune action ne correspond

${hasPendingConfirm ? 'ATTENTION: CONFIRMATION en attente.' : ''}
${hasPendingConv ? 'ATTENTION: Workflow en cours, classe en "continue_conversation".' : ''}

Reponds UNIQUEMENT en JSON strict :
{"action":"create_watch","params":{"name":"HubSpot","type":"competitor","keywords":["hubspot"]}}`;

    try {
      const response = await this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ], 300);

      let cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      if (!result.action) return null;
      return result;
    } catch (error) {
      log.error('web-intel', 'Erreur classifyIntent:', error.message);
      return null;
    }
  }

  // --- Handler principal ---

  async handleMessage(message, chatId, sendReply) {
    const text = message.trim();
    const textLower = text.toLowerCase();

    // Commandes rapides
    if (textLower === '/start' || textLower === 'aide veille' || textLower === 'aide web intelligence') {
      return { type: 'text', content: this.getHelp() };
    }

    // Confirmations en attente
    if (this.pendingConfirmations[String(chatId)]) {
      const yesWords = ['oui', 'ok', 'go', 'yes', 'parfait', 'c\'est bon', 'valide', 'confirme'];
      const noWords = ['non', 'annule', 'stop', 'cancel', 'laisse'];
      if (yesWords.some(w => textLower.includes(w))) {
        const pending = this.pendingConfirmations[String(chatId)];
        delete this.pendingConfirmations[String(chatId)];
        if (pending.onYes) return pending.onYes();
        return { type: 'text', content: 'OK !' };
      }
      if (noWords.some(w => textLower.includes(w))) {
        delete this.pendingConfirmations[String(chatId)];
        return { type: 'text', content: 'Annule.' };
      }
    }

    // Conversations en cours
    if (this.pendingConversations[String(chatId)]) {
      const result = await this._continueConversation(chatId, text, sendReply);
      if (result) return result;
    }

    // NLP
    const command = await this.classifyIntent(text, chatId);
    if (!command) {
      return { type: 'text', content: 'Je n\'ai pas compris. Dis _"aide veille"_ pour voir ce que je peux faire.' };
    }

    const action = command.action;
    const params = command.params || {};

    switch (action) {
      case 'create_watch':
        return this._handleCreateWatch(chatId, params, sendReply);

      case 'delete_watch':
        return this._handleDeleteWatch(chatId, params);

      case 'list_watches':
        return this._handleListWatches();

      case 'add_rss':
        return this._handleAddRss(chatId, params);

      case 'add_scrape_url':
        return this._handleAddScrapeUrl(chatId, params);

      case 'check_now':
        return this._handleCheckNow(chatId, params, sendReply);

      case 'show_articles':
        return this._handleShowArticles(params);

      case 'show_trends':
        return this._handleShowTrends(chatId, params, sendReply);

      case 'summarize_recent':
        return this._handleSummarizeRecent(chatId, sendReply);

      case 'configure':
        return this._handleConfigure(params);

      case 'competitive_digest':
        return this._handleCompetitiveDigest(chatId, sendReply);

      case 'detect_trends':
        return this._handleDetectTrends(chatId, sendReply);

      case 'news_for_company':
        return this._handleNewsForCompany(params);

      case 'show_stats':
        return this._handleShowStats();

      case 'confirm_yes':
      case 'confirm_no': {
        if (this.pendingConfirmations[String(chatId)]) {
          const pending = this.pendingConfirmations[String(chatId)];
          delete this.pendingConfirmations[String(chatId)];
          if (action === 'confirm_yes' && pending.onYes) return pending.onYes();
          return { type: 'text', content: 'Annule.' };
        }
        return { type: 'text', content: 'Rien en attente.' };
      }

      case 'continue_conversation':
        return this._continueConversation(chatId, text, sendReply);

      case 'help':
        return { type: 'text', content: this.getHelp() };

      case 'chat':
      default:
        return { type: 'text', content: this.getHelp() };
    }
  }

  // --- Actions ---

  async _handleCreateWatch(chatId, params, sendReply) {
    const name = params.name;
    const type = params.type;

    if (!name) {
      // Workflow multi-etapes
      this.pendingConversations[String(chatId)] = {
        action: 'create_watch',
        step: 'awaiting_name',
        data: {}
      };
      return { type: 'text', content: 'Comment veux-tu appeler cette veille ? (ex: "HubSpot", "IA Sante", "Mes concurrents")' };
    }

    // Si on a le nom, generer les keywords a partir du nom
    const keywords = params.keywords || [name.toLowerCase()];
    const watchType = type || this._guessType(name);

    const watch = storage.addWatch({
      name: name,
      type: watchType,
      keywords: keywords,
      googleNewsEnabled: true
    });

    const typeLabels = { prospect: 'prospect', competitor: 'concurrent', sector: 'secteur' };
    const typeLabel = typeLabels[watchType] || watchType;

    return {
      type: 'text',
      content: 'Veille *' + watch.name + '* creee !\n\n' +
        'Type : ' + typeLabel + '\n' +
        'Mots-cles : ' + keywords.join(', ') + '\n' +
        'Google News : actif\n' +
        'Frequence : toutes les ' + watch.frequency + 'h\n\n' +
        'Dis _"check maintenant"_ pour un premier scan, ou _"ajoute un flux RSS"_ pour enrichir les sources.'
    };
  }

  _guessType(name) {
    const nameLower = name.toLowerCase();
    const sectorWords = ['secteur', 'industrie', 'marche', 'tendance', 'ia ', 'intelligence artificielle', 'fintech', 'healthtech', 'saas', 'cloud', 'cyber', 'blockchain'];
    const competitorWords = ['concurrent', 'competition', 'rival'];
    if (sectorWords.some(w => nameLower.includes(w))) return 'sector';
    if (competitorWords.some(w => nameLower.includes(w))) return 'competitor';
    return 'prospect';
  }

  async _handleDeleteWatch(chatId, params) {
    const name = params.name;
    if (!name) return { type: 'text', content: 'Quelle veille veux-tu supprimer ? Dis _"mes veilles"_ pour voir la liste.' };

    const watch = storage.getWatchByName(name);
    if (!watch) return { type: 'text', content: 'Veille "' + name + '" introuvable. Dis _"mes veilles"_ pour la liste.' };

    this.pendingConfirmations[String(chatId)] = {
      watchId: watch.id,
      onYes: () => {
        storage.deleteWatch(watch.id);
        return { type: 'text', content: 'Veille *' + watch.name + '* supprimee, avec tous ses articles.' };
      }
    };

    return { type: 'text', content: 'Supprimer la veille *' + watch.name + '* et tous ses articles (' + watch.articleCount + ') ? (oui/non)' };
  }

  _handleListWatches() {
    const watches = storage.getWatches();
    const ids = Object.keys(watches);

    if (ids.length === 0) {
      return { type: 'text', content: 'Aucune veille configuree. Dis _"surveille [nom]"_ pour en creer une !' };
    }

    const typeEmojis = { prospect: '🎯', competitor: '⚔️', sector: '📊' };
    const lines = ['*Mes veilles* (' + ids.length + ')', ''];

    for (const id of ids) {
      const w = watches[id];
      const emoji = typeEmojis[w.type] || '📰';
      const status = w.enabled ? '🟢' : '🔴';
      const lastCheck = w.lastCheckedAt
        ? new Date(w.lastCheckedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : 'jamais';
      lines.push(status + ' ' + emoji + ' *' + w.name + '* (' + w.type + ')');
      lines.push('   Mots-cles: ' + w.keywords.join(', '));
      lines.push('   Articles: ' + w.articleCount + ' | Dernier scan: ' + lastCheck);
      if (w.rssUrls.length > 0) lines.push('   RSS: ' + w.rssUrls.length + ' flux');
      if (w.scrapeUrls.length > 0) lines.push('   Scrape: ' + w.scrapeUrls.length + ' page(s)');
      lines.push('');
    }

    return { type: 'text', content: lines.join('\n') };
  }

  async _handleAddRss(chatId, params) {
    const url = params.url;
    if (!url || !url.startsWith('http')) {
      return { type: 'text', content: 'Donne-moi l\'URL du flux RSS. Ex: _"ajoute https://techcrunch.com/feed/"_' };
    }

    const watchName = params.watchName;
    let watch = null;

    if (watchName) {
      watch = storage.getWatchByName(watchName);
    }

    if (!watch) {
      // Prendre la premiere veille active, ou demander
      const watches = storage.getEnabledWatches();
      if (watches.length === 0) {
        return { type: 'text', content: 'Aucune veille active. Cree d\'abord une veille avec _"surveille [nom]"_.' };
      }
      if (watches.length === 1) {
        watch = watches[0];
      } else {
        this.pendingConversations[String(chatId)] = {
          action: 'add_rss',
          step: 'awaiting_watch',
          data: { url: url }
        };
        const names = watches.map(w => '- ' + w.name).join('\n');
        return { type: 'text', content: 'A quelle veille rattacher ce flux ?\n\n' + names };
      }
    }

    const existing = watch.rssUrls || [];
    if (existing.includes(url)) {
      return { type: 'text', content: 'Ce flux RSS est deja dans la veille *' + watch.name + '*.' };
    }

    existing.push(url);
    storage.updateWatch(watch.id, { rssUrls: existing });

    return { type: 'text', content: 'Flux RSS ajoute a la veille *' + watch.name + '* !\nURL: ' + url };
  }

  async _handleAddScrapeUrl(chatId, params) {
    const url = params.url;
    if (!url || !url.startsWith('http')) {
      return { type: 'text', content: 'Donne-moi l\'URL de la page a surveiller.' };
    }

    const watchName = params.watchName;
    let watch = null;

    if (watchName) {
      watch = storage.getWatchByName(watchName);
    }

    if (!watch) {
      const watches = storage.getEnabledWatches();
      if (watches.length === 0) {
        return { type: 'text', content: 'Aucune veille active. Cree d\'abord une veille.' };
      }
      if (watches.length === 1) {
        watch = watches[0];
      } else {
        this.pendingConversations[String(chatId)] = {
          action: 'add_scrape',
          step: 'awaiting_watch',
          data: { url: url }
        };
        const names = watches.map(w => '- ' + w.name).join('\n');
        return { type: 'text', content: 'A quelle veille rattacher cette page ?\n\n' + names };
      }
    }

    const existing = watch.scrapeUrls || [];
    if (existing.includes(url)) {
      return { type: 'text', content: 'Cette page est deja dans la veille *' + watch.name + '*.' };
    }

    existing.push(url);
    storage.updateWatch(watch.id, { scrapeUrls: existing });

    return { type: 'text', content: 'Page web ajoutee a la veille *' + watch.name + '* !\nURL: ' + url };
  }

  async _handleCheckNow(chatId, params, sendReply) {
    const watchName = params.watchName;

    if (watchName) {
      const watch = storage.getWatchByName(watchName);
      if (!watch) return { type: 'text', content: 'Veille "' + watchName + '" introuvable.' };

      if (sendReply) await sendReply({ type: 'text', content: '_Scan de ' + watch.name + ' en cours..._' });
      const result = await this._scanWatch(watch);
      return { type: 'text', content: result };
    }

    // Scanner toutes les veilles
    const watches = storage.getEnabledWatches();
    if (watches.length === 0) {
      return { type: 'text', content: 'Aucune veille active. Cree-en une avec _"surveille [nom]"_.' };
    }

    if (sendReply) await sendReply({ type: 'text', content: '_Scan de ' + watches.length + ' veille(s) en cours..._' });
    const results = await this._scanAllWatches();
    return { type: 'text', content: results };
  }

  _handleShowArticles(params) {
    const watchName = params.watchName;
    const limit = params.limit || 10;

    let articles;
    let title;

    if (watchName) {
      const watch = storage.getWatchByName(watchName);
      if (!watch) return { type: 'text', content: 'Veille "' + watchName + '" introuvable.' };
      articles = storage.getArticlesForWatch(watch.id, limit);
      title = 'Articles — ' + watch.name;
    } else {
      articles = storage.getRecentArticles(limit);
      title = 'Derniers articles';
    }

    if (articles.length === 0) {
      return { type: 'text', content: 'Aucun article. Dis _"check maintenant"_ pour lancer un scan.' };
    }

    const lines = ['*' + title + '* (' + articles.length + ')', ''];
    for (const a of articles) {
      const score = a.relevanceScore ? ' [' + a.relevanceScore + '/10]' : '';
      const urgent = a.isUrgent ? ' 🔴' : '';
      const crm = a.crmMatch ? ' 🔗' : '';
      const date = a.pubDate ? ' — ' + this._formatDate(a.pubDate) : '';
      lines.push('*' + a.title + '*' + score + urgent + crm);
      if (a.summary) lines.push('  ' + a.summary.substring(0, 120));
      lines.push('  _' + (a.source || '') + date + '_');
      lines.push('');
    }

    return { type: 'text', content: lines.join('\n') };
  }

  async _handleSummarizeRecent(chatId, sendReply) {
    const articles = storage.getRecentArticles(20);
    if (articles.length === 0) {
      return { type: 'text', content: 'Aucun article recent a resumer.' };
    }

    if (sendReply) await sendReply({ type: 'text', content: '_Je te prepare un resume..._' });

    // Grouper par veille
    const byWatch = {};
    for (const a of articles) {
      const watch = storage.getWatch(a.watchId);
      const name = watch ? watch.name : 'Divers';
      if (!byWatch[name]) byWatch[name] = [];
      byWatch[name].push(a);
    }

    // Generer un resume IA
    try {
      const articlesText = articles.slice(0, 15).map(a =>
        '- ' + a.title + (a.summary ? ' : ' + a.summary.substring(0, 100) : '') + ' (' + (a.source || '') + ')'
      ).join('\n');

      const summary = await this.analyzer.callClaude(
        [{ role: 'user', content: 'Voici les derniers articles collectes par la veille web :\n\n' + articlesText }],
        'Tu es un analyste business. Resume les articles suivants en UN SEUL message concis et utile (max 10 lignes). ' +
        'Regroupe par theme, donne les points cles et ce qui est actionnable. ' +
        'Format Markdown Telegram (*gras*, _italique_). Pas de titre en majuscules.',
        1500
      );

      return { type: 'text', content: summary };
    } catch (e) {
      // Fallback sans IA : resume structure
      let message = '*Resume des dernieres news* (' + articles.length + ' articles)\n\n';
      for (const watchName of Object.keys(byWatch)) {
        const watchArticles = byWatch[watchName];
        message += '*' + watchName + '* (' + watchArticles.length + ')\n';
        watchArticles.slice(0, 3).forEach(a => {
          message += '- ' + a.title + '\n';
        });
        if (watchArticles.length > 3) message += '_+ ' + (watchArticles.length - 3) + ' autre(s)_\n';
        message += '\n';
      }
      return { type: 'text', content: message };
    }
  }

  async _handleShowTrends(chatId, params, sendReply) {
    const watchName = params.watchName;

    if (sendReply) await sendReply({ type: 'text', content: '_Analyse des tendances en cours..._' });

    if (watchName) {
      const watch = storage.getWatchByName(watchName);
      if (!watch) return { type: 'text', content: 'Veille "' + watchName + '" introuvable.' };

      const articles = storage.getArticlesForWatch(watch.id, 20);
      if (articles.length === 0) return { type: 'text', content: 'Pas assez d\'articles pour une analyse. Lance un scan d\'abord.' };

      const digest = await this.analyzer.generateDigest(articles, watch.name, watch.type);
      storage.saveAnalysis({ watchId: watch.id, type: 'trend', content: digest });
      return { type: 'text', content: digest };
    }

    // Tendances globales
    const articles = storage.getRecentArticles(30);
    if (articles.length === 0) return { type: 'text', content: 'Pas encore d\'articles. Lance un scan d\'abord.' };

    const digest = await this.analyzer.generateDigest(articles, 'Toutes les veilles', 'global');
    storage.saveAnalysis({ type: 'trend', content: digest });
    return { type: 'text', content: digest };
  }

  _handleConfigure(params) {
    if (params.frequency) {
      const freq = parseInt(params.frequency);
      if (freq >= 1 && freq <= 24) {
        storage.updateConfig({ checkIntervalHours: freq });
        return { type: 'text', content: 'Frequence de scan mise a jour : toutes les ' + freq + 'h.' };
      }
    }

    if (params.digestEnabled !== undefined) {
      const config = storage.getConfig();
      config.notifications.digestEnabled = params.digestEnabled;
      storage.updateConfig({ notifications: config.notifications });
      return { type: 'text', content: 'Digest quotidien ' + (params.digestEnabled ? 'active' : 'desactive') + '.' };
    }

    // Afficher la config actuelle
    const config = storage.getConfig();
    const notif = config.notifications;
    const lines = [
      '*Configuration Web Intelligence*',
      '',
      'Scan auto : toutes les ' + config.checkIntervalHours + 'h',
      'Digest quotidien : ' + (notif.digestEnabled ? '🟢 actif (' + notif.digestHour + 'h)' : '🔴 inactif'),
      'Alertes instantanees : ' + (notif.instantAlerts ? '🟢' : '🔴'),
      'Digest hebdo : ' + (notif.weeklyDigest ? '🟢 lundi ' + notif.weeklyDigestHour + 'h' : '🔴'),
      '',
      'Max articles/veille : ' + config.maxArticlesPerWatch,
      'Max articles total : ' + config.maxArticlesTotal
    ];
    return { type: 'text', content: lines.join('\n') };
  }

  _handleShowStats() {
    const stats = storage.getStats();
    const watches = storage.getWatches();
    const watchCount = Object.keys(watches).length;
    const enabledCount = storage.getEnabledWatches().length;

    const lines = [
      '*Stats Web Intelligence*',
      '',
      'Veilles : ' + enabledCount + ' actives / ' + watchCount + ' total',
      'Articles collectes : ' + stats.totalArticlesFetched,
      'Analyses generees : ' + stats.totalAnalysesGenerated,
      'Alertes envoyees : ' + stats.totalAlertsSent,
      ''
    ];

    if (stats.lastScanAt) {
      lines.push('Dernier scan : ' + new Date(stats.lastScanAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    }
    if (stats.lastDigestAt) {
      lines.push('Dernier digest : ' + new Date(stats.lastDigestAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    }

    // Stats par veille
    const ids = Object.keys(watches);
    if (ids.length > 0) {
      lines.push('');
      lines.push('*Par veille :*');
      for (const id of ids) {
        const w = watches[id];
        const articles = storage.getArticlesForWatch(id, 100);
        const avgScore = articles.length > 0
          ? (articles.reduce((sum, a) => sum + (a.relevanceScore || 0), 0) / articles.length).toFixed(1)
          : '-';
        lines.push('- *' + w.name + '* : ' + w.articleCount + ' articles, score moy. ' + avgScore);
      }
    }

    return { type: 'text', content: lines.join('\n') };
  }

  // --- Competitive Digest (8b) ---

  async _handleCompetitiveDigest(chatId, sendReply) {
    const watches = storage.getWatches();
    const competitorWatchIds = Object.keys(watches).filter(id => watches[id].type === 'competitor');

    if (competitorWatchIds.length === 0) {
      return { type: 'text', content: 'Aucune veille concurrentielle configuree. Cree une veille de type _"concurrent"_ d\'abord.' };
    }

    if (sendReply) await sendReply({ type: 'text', content: '_Analyse concurrentielle en cours..._' });

    // Recuperer les articles des 7 derniers jours pour les veilles "competitor"
    const weekArticles = storage.getArticlesLastWeek();
    const competitorArticles = weekArticles.filter(a => competitorWatchIds.includes(a.watchId));

    if (competitorArticles.length === 0) {
      return { type: 'text', content: 'Aucun article concurrent trouve cette semaine. Lance un _"check maintenant"_ d\'abord.' };
    }

    // Construire le mapping watchId -> watchName
    const watchNames = {};
    for (const id of competitorWatchIds) {
      watchNames[id] = watches[id].name;
    }

    const digest = await this.analyzer.generateCompetitiveDigest(competitorArticles, watchNames);

    // Sauvegarder le digest
    storage.saveCompetitiveDigest(digest);

    // Formater la reponse
    let response = digest.text || '*Analyse concurrentielle*\n\nAucun resultat.';
    if (digest.opportunities && digest.opportunities.length > 0) {
      response += '\n\n*Opportunites :*\n' + digest.opportunities.map(o => '- ' + o).join('\n');
    }
    if (digest.threats && digest.threats.length > 0) {
      response += '\n\n*Menaces :*\n' + digest.threats.map(t => '- ' + t).join('\n');
    }

    storage.saveAnalysis({ type: 'competitive_digest', content: response });
    return { type: 'text', content: response };
  }

  // --- Trend Detection (8c) ---

  async _handleDetectTrends(chatId, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '_Detection des tendances en cours..._' });

    const articles = storage.getRecentArticles(100); // Plus d'articles pour une meilleure analyse
    if (articles.length < 5) {
      return { type: 'text', content: 'Pas assez d\'articles pour une analyse de tendances. Continue la veille pendant quelques jours.' };
    }

    const trends = this.analyzer.detectTrends(articles);

    // Sauvegarder les tendances
    storage.saveTrends(trends);

    // Formater la reponse
    const lines = ['*Detection de tendances* (30 derniers jours)', ''];

    if (trends.rising.length > 0) {
      lines.push('*Sujets en hausse :*');
      for (const t of trends.rising.slice(0, 7)) {
        lines.push('  ↗️ *' + t.keyword + '* (+' + t.change + '%, ' + t.recentMentions + ' mentions recentes)');
      }
      lines.push('');
    }

    if (trends.falling.length > 0) {
      lines.push('*Sujets en baisse :*');
      for (const t of trends.falling.slice(0, 7)) {
        lines.push('  ↘️ _' + t.keyword + '_ (' + t.change + '%, ' + t.recentMentions + ' mentions recentes)');
      }
      lines.push('');
    }

    if (trends.stable.length > 0) {
      lines.push('*Sujets stables :*');
      lines.push('  ' + trends.stable.slice(0, 5).map(t => t.keyword + ' (' + t.mentions + ')').join(', '));
    }

    if (trends.rising.length === 0 && trends.falling.length === 0 && trends.stable.length === 0) {
      lines.push('Pas assez de donnees pour detecter des tendances. Continue la veille !');
    }

    storage.saveAnalysis({ type: 'trend_detection', content: lines.join('\n') });
    return { type: 'text', content: lines.join('\n') };
  }

  // --- News for Company (8a) ---

  _handleNewsForCompany(params) {
    const company = params.company;
    if (!company) {
      return { type: 'text', content: 'Quelle entreprise ? Dis _"news sur [nom]"_.' };
    }

    const news = storage.getRelevantNewsForContact(company);
    if (news.length === 0) {
      return { type: 'text', content: 'Aucune news trouvee pour *' + company + '*. Lance un scan ou ajoute une veille sur cette entreprise.' };
    }

    const lines = ['*News pour ' + company + '* (' + news.length + ')', ''];
    for (const n of news) {
      const date = n.date ? new Date(n.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '';
      lines.push('- *' + n.headline + '* [' + (n.relevance || '?') + '/10]');
      if (date) lines.push('  ' + date + (n.usedInEmail ? ' (deja utilise)' : ''));
      lines.push('');
    }
    lines.push('_Ces news peuvent etre utilisees pour personnaliser tes emails de prospection._');

    return { type: 'text', content: lines.join('\n') };
  }

  // --- Conversations multi-etapes ---

  async _continueConversation(chatId, text, sendReply) {
    const id = String(chatId);
    const conv = this.pendingConversations[id];
    if (!conv) return null;

    if (conv.action === 'create_watch') {
      if (conv.step === 'awaiting_name') {
        conv.data.name = text;
        conv.step = 'awaiting_type';
        return { type: 'text', content: 'Quel type de veille ?\n\n1. *Prospect* — surveiller un client potentiel\n2. *Concurrent* — surveiller la concurrence\n3. *Secteur* — tendances du marche\n\n(Reponds 1, 2, 3 ou le mot)' };
      }

      if (conv.step === 'awaiting_type') {
        const typeLower = text.toLowerCase();
        let type = 'sector';
        if (typeLower.includes('1') || typeLower.includes('prospect')) type = 'prospect';
        else if (typeLower.includes('2') || typeLower.includes('concurrent') || typeLower.includes('compet')) type = 'competitor';
        else if (typeLower.includes('3') || typeLower.includes('secteur') || typeLower.includes('marche') || typeLower.includes('tendance')) type = 'sector';

        conv.data.type = type;
        conv.step = 'awaiting_keywords';
        return { type: 'text', content: 'Quels mots-cles surveiller ? (separes par des virgules)\nEx: _"hubspot, dharmesh shah, crm cloud"_\n\nOu envoie juste _"ok"_ pour utiliser "' + conv.data.name + '" comme mot-cle.' };
      }

      if (conv.step === 'awaiting_keywords') {
        const textLower = text.toLowerCase();
        let keywords;
        if (textLower === 'ok' || textLower === 'oui') {
          keywords = [conv.data.name.toLowerCase()];
        } else {
          keywords = text.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
          if (keywords.length === 0) keywords = [conv.data.name.toLowerCase()];
        }

        delete this.pendingConversations[id];

        const watch = storage.addWatch({
          name: conv.data.name,
          type: conv.data.type,
          keywords: keywords,
          googleNewsEnabled: true
        });

        const typeLabels = { prospect: 'prospect', competitor: 'concurrent', sector: 'secteur' };
        return {
          type: 'text',
          content: 'Veille *' + watch.name + '* creee !\n\n' +
            'Type : ' + typeLabels[watch.type] + '\n' +
            'Mots-cles : ' + keywords.join(', ') + '\n' +
            'Google News : actif\n\n' +
            'Dis _"check maintenant"_ pour un premier scan !'
        };
      }
    }

    if (conv.action === 'add_rss' && conv.step === 'awaiting_watch') {
      const watch = storage.getWatchByName(text);
      if (!watch) {
        delete this.pendingConversations[id];
        return { type: 'text', content: 'Veille introuvable. Annule.' };
      }
      delete this.pendingConversations[id];
      const existing = watch.rssUrls || [];
      existing.push(conv.data.url);
      storage.updateWatch(watch.id, { rssUrls: existing });
      return { type: 'text', content: 'Flux RSS ajoute a la veille *' + watch.name + '* !' };
    }

    if (conv.action === 'add_scrape' && conv.step === 'awaiting_watch') {
      const watch = storage.getWatchByName(text);
      if (!watch) {
        delete this.pendingConversations[id];
        return { type: 'text', content: 'Veille introuvable. Annule.' };
      }
      delete this.pendingConversations[id];
      const existing = watch.scrapeUrls || [];
      existing.push(conv.data.url);
      storage.updateWatch(watch.id, { scrapeUrls: existing });
      return { type: 'text', content: 'Page web ajoutee a la veille *' + watch.name + '* !' };
    }

    delete this.pendingConversations[id];
    return null;
  }

  // --- Moteur de collecte ---

  async _scanAllWatches() {
    const watches = storage.getEnabledWatches();
    if (watches.length === 0) return 'Aucune veille active.';

    const results = [];
    let totalNew = 0;

    for (const watch of watches) {
      try {
        const count = await this._scanWatchInternal(watch);
        totalNew += count;
        results.push('*' + watch.name + '* : ' + count + ' nouveau(x) article(s)');
      } catch (e) {
        log.error('web-intel', 'Erreur scan ' + watch.name + ':', e.message);
        results.push('*' + watch.name + '* : erreur (' + e.message + ')');
      }
      // Espacement entre les requetes pour eviter le rate limiting
      await new Promise(r => setTimeout(r, 2000));
    }

    storage.updateStat('lastScanAt', new Date().toISOString());

    const lines = ['*Scan termine*', '', 'Total : ' + totalNew + ' nouveau(x) article(s)', ''].concat(results);
    return lines.join('\n');
  }

  async _scanWatch(watch) {
    const count = await this._scanWatchInternal(watch);
    storage.updateStat('lastScanAt', new Date().toISOString());
    return '*' + watch.name + '* : ' + count + ' nouveau(x) article(s) trouve(s)';
  }

  async _scanWatchInternal(watch) {
    let allArticles = [];

    // 1. Google News RSS
    if (watch.googleNewsEnabled && watch.keywords.length > 0) {
      const googleArticles = await this.fetcher.fetchGoogleNews(watch.keywords);
      allArticles = allArticles.concat(googleArticles);
      log.info('web-intel', 'Google News "' + watch.name + '": ' + googleArticles.length + ' articles');
    }

    // 2. RSS custom
    for (const rssUrl of (watch.rssUrls || [])) {
      const rssArticles = await this.fetcher.fetchRss(rssUrl);
      allArticles = allArticles.concat(rssArticles);
      log.info('web-intel', 'RSS ' + rssUrl + ': ' + rssArticles.length + ' articles');
      await new Promise(r => setTimeout(r, 1000));
    }

    // 3. Scraping web
    for (const scrapeUrl of (watch.scrapeUrls || [])) {
      const page = await this.fetcher.scrapeWebPage(scrapeUrl);
      if (page && page.title) {
        allArticles.push({
          title: page.title,
          link: page.url,
          source: page.source,
          snippet: page.description || page.textContent.substring(0, 300),
          pubDate: new Date().toISOString()
        });
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    // 4. Deduplication
    const newArticles = allArticles.filter(a => a.link && !storage.hasArticle(a.link));
    if (newArticles.length === 0) {
      storage.updateWatch(watch.id, { lastCheckedAt: new Date().toISOString() });
      return 0;
    }

    // 5. Marquer le watchId
    for (const a of newArticles) {
      a.watchId = watch.id;
    }

    // 6. Analyse IA (score, resume, urgence)
    const analyzed = await this.analyzer.analyzeArticles(newArticles, watch);

    // 7. Detection d'urgence supplementaire
    for (const a of analyzed) {
      if (!a.isUrgent) {
        a.isUrgent = this.analyzer.detectUrgency(a);
      }
    }

    // 8. Cross-reference CRM
    try {
      const HubSpotClient = getHubSpotClient();
      if (HubSpotClient) {
        const hubspotKey = process.env.HUBSPOT_API_KEY;
        if (hubspotKey) {
          const client = new HubSpotClient(hubspotKey);
          const contactsResult = await client.listContacts(100).catch(() => ({ contacts: [] }));
          const dealsResult = await client.listDeals(100).catch(() => ({ deals: [] }));
          this.analyzer.crossReferenceWithCRM(analyzed, contactsResult.contacts || [], dealsResult.deals || []);
        }
      }
    } catch (e) {
      log.warn('web-intel', 'Cross-ref CRM skip:', e.message);
    }

    // 8.5. News-to-Outreach Bridge : stocker les articles mentionnant une entreprise
    for (const article of analyzed) {
      if (article.crmMatch && article.crmMatch.company) {
        storage.saveNewsOutreach({
          company: article.crmMatch.company,
          headline: article.title,
          url: article.link,
          date: article.pubDate || new Date().toISOString(),
          relevance: article.relevanceScore || 5,
          watchId: article.watchId
        });
      }
    }

    // 9. Sauvegarder (retourne les articles effectivement ajoutes, sans doublons)
    const addedResult = storage.addArticlesAndReturnAdded(analyzed);
    const addedCount = addedResult.count;
    const addedArticles = addedResult.articles;
    storage.updateWatch(watch.id, {
      lastCheckedAt: new Date().toISOString(),
      articleCount: (watch.articleCount || 0) + addedCount
    });

    // 9.5. Detection de signaux marche — UNIQUEMENT sur les articles reellement ajoutes (anti-doublons)
    try {
      if (addedArticles.length > 0) {
        const signals = this.analyzer.classifyMarketSignals(addedArticles);
        // Deduplication des signaux (meme titre d'article = meme signal)
        const newSignals = storage.saveMarketSignalsDeduped(signals);
        if (newSignals.length > 0) {
          log.info('web-intel', 'Signaux marche detectes: ' + newSignals.length + ' pour ' + watch.name);

          // Alerter sur les signaux high priority
          const highPriority = newSignals.filter(s => s.priority === 'high');
          if (highPriority.length > 0 && this.sendTelegram) {
            const config = storage.getConfig();
            const chatId = config.adminChatId;
            if (chatId) {
              let alertMsg = '📡 *SIGNAL MARCHE* (' + highPriority.length + ')\n\n';
              for (const s of highPriority.slice(0, 5)) {
                alertMsg += '*' + s.type.toUpperCase() + '* : ' + s.article.title + '\n';
                alertMsg += '→ _' + s.suggestedAction + '_\n\n';
              }
              try { await this.sendTelegram(chatId, alertMsg, 'Markdown'); } catch (e) {}
            }
          }
        }
      }
    } catch (e) {
      log.warn('web-intel', 'Erreur detection signaux:', e.message);
    }

    // 10. Alertes instantanees pour articles urgents
    const urgentArticles = analyzed.filter(a => a.isUrgent);
    if (urgentArticles.length > 0) {
      const config = storage.getConfig();
      if (config.notifications.instantAlerts) {
        await this._sendUrgentAlerts(urgentArticles, watch);
      }
    }

    return addedCount;
  }

  async _sendUrgentAlerts(articles, watch) {
    const config = storage.getConfig();
    const chatId = config.adminChatId;
    if (!chatId || !this.sendTelegram || articles.length === 0) return;

    // Grouper toutes les alertes en un seul message resume
    let message = '🔴 *ALERTE VEILLE — ' + watch.name + '* (' + articles.length + ' article' + (articles.length > 1 ? 's' : '') + ')\n\n';

    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      const crm = a.crmMatch ? ' 🔗' : '';
      const source = a.source ? ' _(' + a.source + ')_' : '';
      message += '*' + (i + 1) + '. ' + a.title + '*' + crm + '\n';
      message += (a.summary || a.snippet || '').substring(0, 150) + source + '\n\n';
    }

    message = message.trimEnd();

    try {
      await this.sendTelegram(chatId, message);
      for (const a of articles) {
        storage.markArticleNotified(a.id);
      }
      storage.incrementStat('totalAlertsSent');
    } catch (e) {
      log.error('web-intel', 'Erreur envoi alerte groupee:', e.message);
    }
  }

  // --- Crons ---

  async _scheduledScan() {
    const config = storage.getConfig();
    if (!config.enabled) return;

    const watches = storage.getEnabledWatches();
    if (watches.length === 0) {
      log.info('web-intel', 'Scan auto skip — aucune veille active');
      return;
    }

    log.info('web-intel', 'Scan planifie de ' + watches.length + ' veille(s) active(s)');
    await this._scanAllWatches();
  }

  async _dailyDigest() {
    const config = storage.getConfig();
    if (!config.enabled || !config.notifications.digestEnabled) return;
    if (!this.sendTelegram) return;

    const chatId = config.adminChatId;
    const articles = storage.getArticlesLast24h();

    if (articles.length === 0) {
      log.info('web-intel', 'Digest quotidien: aucun article');
      return;
    }

    // Grouper par veille
    const byWatch = {};
    for (const a of articles) {
      const watchId = a.watchId || 'unknown';
      const watch = storage.getWatch(watchId);
      const name = watch ? watch.name : 'Divers';
      if (!byWatch[name]) byWatch[name] = [];
      byWatch[name].push(a);
    }

    let message = '📰 *Digest quotidien* — ' + articles.length + ' article(s)\n\n';

    for (const watchName of Object.keys(byWatch)) {
      const watchArticles = byWatch[watchName];
      const top = watchArticles
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, 3);

      message += '*' + watchName + '* (' + watchArticles.length + ')\n';
      for (const a of top) {
        const score = a.relevanceScore ? ' [' + a.relevanceScore + '/10]' : '';
        const urgent = a.isUrgent ? ' 🔴' : '';
        message += '- ' + a.title + score + urgent + '\n';
      }
      if (watchArticles.length > 3) {
        message += '_+ ' + (watchArticles.length - 3) + ' autre(s)_\n';
      }
      message += '\n';
    }

    try {
      await this.sendTelegram(chatId, message);
      storage.updateStat('lastDigestAt', new Date().toISOString());
      storage.incrementStat('totalAlertsSent');
      log.info('web-intel', 'Digest quotidien envoye');
    } catch (e) {
      log.error('web-intel', 'Erreur envoi digest:', e.message);
    }
  }

  async _weeklyDigest() {
    const config = storage.getConfig();
    if (!config.enabled || !config.notifications.weeklyDigest) return;
    if (!this.sendTelegram) return;

    const chatId = config.adminChatId;
    const articles = storage.getArticlesLastWeek();

    if (articles.length === 0) {
      log.info('web-intel', 'Digest hebdo: aucun article');
      return;
    }

    // Grouper par veille
    const byWatch = {};
    for (const a of articles) {
      const watch = storage.getWatch(a.watchId);
      const name = watch ? watch.name : 'Divers';
      if (!byWatch[name]) byWatch[name] = [];
      byWatch[name].push(a);
    }

    const stats = storage.getStats();
    const report = await this.analyzer.generateWeeklyReport(byWatch, stats);

    try {
      await this.sendTelegram(chatId, report);
      storage.updateStat('lastWeeklyDigestAt', new Date().toISOString());
      storage.incrementStat('totalAlertsSent');
      storage.saveAnalysis({ type: 'weekly', content: report });
      log.info('web-intel', 'Digest hebdo envoye');
    } catch (e) {
      log.error('web-intel', 'Erreur envoi digest hebdo:', e.message);
    }
  }

  // --- Helpers ---

  _formatDate(dateStr) {
    try {
      return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    } catch (e) {
      return dateStr;
    }
  }

  getHelp() {
    return [
      '*WEB INTELLIGENCE*',
      '',
      'Je surveille le web pour toi et je t\'alerte.',
      '',
      '*Creer une veille :*',
      '  _"surveille un concurrent"_ — veille prospect',
      '  _"surveille mes concurrents HubSpot"_',
      '  _"cree une veille secteur IA sante"_',
      '',
      '*Gerer :*',
      '  _"mes veilles"_ — lister les veilles',
      '  _"ajoute ce flux RSS https://..."_',
      '  _"supprime la veille HubSpot"_',
      '',
      '*Consulter :*',
      '  _"quoi de neuf ?"_ — scan immediat',
      '  _"articles HubSpot"_ — derniers articles',
      '  _"tendances"_ — analyse IA',
      '  _"tendances montantes"_ — sujets en hausse/baisse',
      '  _"digest concurrents"_ — analyse concurrentielle',
      '  _"news sur [entreprise]"_ — news pour prospection',
      '',
      '*Config :*',
      '  _"scanne toutes les 2h"_',
      '  _"stats veille"_',
      '',
      'Scan auto toutes les 6h + digest quotidien 9h.'
    ].join('\n');
  }
}

module.exports = WebIntelligenceHandler;
