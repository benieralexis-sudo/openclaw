// Self-Improve - Handler Telegram NLP + Cron hebdomadaire
const https = require('https');
const { Cron } = require('croner');
const storage = require('./storage.js');
const MetricsCollector = require('./metrics-collector.js');
const Analyzer = require('./analyzer.js');
const Optimizer = require('./optimizer.js');
const { retryAsync } = require('../../gateway/utils.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const log = require('../../gateway/logger.js');

class SelfImproveHandler {
  constructor(openaiKey, claudeKey, sendTelegramFn) {
    this.openaiKey = openaiKey;
    this.claudeKey = claudeKey;
    this.sendTelegram = sendTelegramFn || null;

    this.metricsCollector = new MetricsCollector();
    this.analyzer = new Analyzer(claudeKey);
    this.optimizer = new Optimizer();

    this.pendingConversations = {};
    this.pendingConfirmations = {};
    this.crons = [];
  }

  // --- Lifecycle ---

  start() {
    const config = storage.getConfig();
    if (!config.enabled) {
      log.info('self-improve', 'Mode desactive');
      return;
    }

    this.stop();
    const tz = 'Europe/Paris';

    // Cron hebdomadaire : dimanche 21h
    this.crons.push(new Cron('0 21 * * 0', { timezone: tz }, () => this._weeklyAnalysis()));
    log.info('self-improve', 'Cron: analyse hebdo dimanche 21h');

    log.info('self-improve', 'Demarre avec ' + this.crons.length + ' cron(s)');
  }

  stop() {
    for (const cron of this.crons) {
      try { cron.stop(); } catch (e) {}
    }
    this.crons = [];
  }

  // --- NLP ---

  callOpenAI(messages, maxTokens) {
    maxTokens = maxTokens || 300;
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.3,
        max_tokens: maxTokens
      });
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.openaiKey,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (response.choices && response.choices[0]) {
              resolve(response.choices[0].message.content);
            } else {
              reject(new Error('Reponse OpenAI invalide'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout OpenAI')); });
      req.write(postData);
      req.end();
    });
  }

  async classifyIntent(message, chatId) {
    const hasPendingConv = !!this.pendingConversations[String(chatId)];
    const hasPendingConfirm = !!this.pendingConfirmations[String(chatId)];
    const config = storage.getConfig();
    const stats = storage.getStats();
    const pendingCount = storage.getPendingRecommendations().length;

    const systemPrompt = `Tu es l'assistant d'amelioration automatique d'un bot Telegram B2B. L'utilisateur parle en francais naturel.

Classifie le message en une action JSON.

Actions :
- "show_recommendations" : voir les recommandations en attente
  Ex: "tes recommandations", "qu'est-ce que tu proposes ?", "quoi de neuf ?", "des suggestions ?"
- "apply_improvements" : appliquer les ameliorations
  Params: {"indices": [1,2,3]} (optionnel, si l'utilisateur precise lesquelles)
  Ex: "applique les ameliorations", "ok fais-le", "applique", "applique 1 et 3", "go pour tout"
- "show_metrics" : voir les metriques de performance
  Ex: "metriques de la semaine", "comment ca performe ?", "les stats", "resultats"
- "show_history" : voir l'historique des ameliorations appliquees
  Ex: "historique des ameliorations", "qu'est-ce que t'as change ?", "modifications recentes"
- "rollback" : annuler la derniere amelioration
  Ex: "annule la derniere amelioration", "reviens en arriere", "rollback", "defais"
- "force_analysis" : lancer une analyse maintenant (sans attendre dimanche)
  Ex: "analyse maintenant", "relance l'analyse", "fais le point", "check les perfs"
- "status" : statut du mode self-improve
  Ex: "status self-improve", "la boucle marche ?", "c'est actif ?", "mode amelioration"
- "toggle" : activer/desactiver
  Params: {"enabled": true/false}
  Ex: "desactive self-improve", "active l'amelioration"
- "dismiss" : rejeter une recommandation
  Params: {"index": 2}
  Ex: "ignore 2", "rejette la 3", "non pour la 1"
- "toggle_auto_apply" : activer/desactiver l'application automatique
  Params: {"enabled": true/false}
  Ex: "active auto-apply", "desactive auto-apply", "mode automatique", "mode manuel"
- "confirm_yes" : confirmation positive
  Ex: "oui", "ok", "go", "c'est bon"
- "confirm_no" : refus
  Ex: "non", "annule", "stop"
- "help" : aide
  Ex: "aide", "comment ca marche ?"

Mode self-improve : ${config.enabled ? 'ACTIF' : 'DESACTIVE'}
Recommandations en attente : ${pendingCount}
Derniere analyse : ${stats.lastAnalysisAt || 'jamais'}
${hasPendingConfirm ? 'ATTENTION: CONFIRMATION en attente.' : ''}
${hasPendingConv ? 'ATTENTION: Workflow en cours.' : ''}

Reponds UNIQUEMENT en JSON strict :
{"action":"show_recommendations"}`;

    try {
      const breaker = getBreaker('openai', { failureThreshold: 3, cooldownMs: 60000 });
      const response = await breaker.call(() => retryAsync(() => this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ], 300), 2, 2000));

      let cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      if (!result.action) return null;
      return result;
    } catch (error) {
      log.error('self-improve', 'Erreur classifyIntent:', error.message);
      return null;
    }
  }

  // --- Handler principal ---

  async handleMessage(message, chatId, sendReply) {
    const text = message.trim();
    const textLower = text.toLowerCase();

    // Commandes rapides
    if (textLower === '/start' || textLower === 'aide self-improve' || textLower === 'aide amelioration') {
      return { type: 'text', content: this.getHelp() };
    }

    // Confirmations en cours
    if (this.pendingConfirmations[String(chatId)]) {
      const confirm = textLower;
      if (confirm === 'oui' || confirm === 'ok' || confirm === 'go' || confirm === 'yes') {
        const pending = this.pendingConfirmations[String(chatId)];
        delete this.pendingConfirmations[String(chatId)];
        if (pending.onYes) return pending.onYes();
      }
      if (confirm === 'non' || confirm === 'annule' || confirm === 'stop') {
        delete this.pendingConfirmations[String(chatId)];
        return { type: 'text', content: 'Annule.' };
      }
    }

    // NLP
    const command = await this.classifyIntent(text, chatId);
    if (!command) {
      return { type: 'text', content: 'Je n\'ai pas compris. Dis _"aide self-improve"_ pour voir ce que je peux faire.' };
    }

    const action = command.action;
    const params = command.params || {};

    switch (action) {
      case 'show_recommendations':
        return this._showRecommendations(chatId);

      case 'apply_improvements':
        return this._applyImprovements(chatId, params, sendReply);

      case 'show_metrics':
        return this._showMetrics(chatId);

      case 'show_history':
        return this._showHistory(chatId);

      case 'rollback':
        return this._rollback(chatId);

      case 'force_analysis':
        return this._forceAnalysis(chatId, sendReply);

      case 'status':
        return this._showStatus(chatId);

      case 'toggle': {
        const enabled = params.enabled !== undefined ? params.enabled : !storage.getConfig().enabled;
        storage.updateConfig({ enabled: enabled });
        if (enabled) {
          this.start();
          return { type: 'text', content: 'Self-Improve active ! Analyse hebdomadaire chaque dimanche a 21h.' };
        } else {
          this.stop();
          return { type: 'text', content: 'Self-Improve desactive. Dis _"active self-improve"_ pour reactiver.' };
        }
      }

      case 'toggle_auto_apply': {
        const autoApply = params.enabled !== undefined ? params.enabled : !storage.getConfig().autoApply;
        storage.updateConfig({ autoApply: autoApply });
        if (autoApply) {
          return { type: 'text', content: 'Auto-Apply active ! Les recommandations a haute confiance (>= 70%) seront appliquees automatiquement apres chaque analyse.\nDis _"desactive auto-apply"_ pour revenir en mode manuel.' };
        } else {
          return { type: 'text', content: 'Auto-Apply desactive. Les recommandations resteront en attente pour validation manuelle.\nDis _"active auto-apply"_ pour reactiver.' };
        }
      }

      case 'dismiss': {
        const idx = (params.index || 1) - 1;
        const pending = storage.getPendingRecommendations();
        if (idx >= 0 && idx < pending.length) {
          storage.dismissRecommendation(pending[idx].id);
          return { type: 'text', content: 'Recommandation ' + (idx + 1) + ' rejetee.' };
        }
        return { type: 'text', content: 'Numero invalide. Il y a ' + pending.length + ' recommandation(s) en attente.' };
      }

      case 'confirm_yes':
        if (this.pendingConfirmations[String(chatId)]) {
          const pending = this.pendingConfirmations[String(chatId)];
          delete this.pendingConfirmations[String(chatId)];
          if (pending.onYes) return pending.onYes();
        }
        return { type: 'text', content: 'Rien en attente.' };

      case 'confirm_no':
        delete this.pendingConfirmations[String(chatId)];
        return { type: 'text', content: 'Annule.' };

      case 'help':
        return { type: 'text', content: this.getHelp() };

      default:
        return { type: 'text', content: this.getHelp() };
    }
  }

  // --- Actions ---

  _showRecommendations(chatId) {
    const pending = storage.getPendingRecommendations();
    if (pending.length === 0) {
      const stats = storage.getStats();
      return { type: 'text', content: 'Aucune recommandation en attente.' +
        (stats.lastAnalysisAt ? '\nDerniere analyse : ' + new Date(stats.lastAnalysisAt).toLocaleDateString('fr-FR') : '') +
        '\nDis _"analyse maintenant"_ pour forcer une analyse.' };
    }

    const lines = ['*Recommandations en attente (' + pending.length + ')* :'];
    lines.push('');
    pending.forEach((r, i) => {
      lines.push('*' + (i + 1) + '.* ' + r.description);
      if (r.expectedImpact) lines.push('   Impact : ' + r.expectedImpact);
      if (r.confidence) lines.push('   Confiance : ' + Math.round(r.confidence * 100) + '%');
    });
    lines.push('');
    lines.push('_"applique"_ = tout | _"applique 1"_ = une seule | _"ignore 2"_ = rejeter');

    return { type: 'text', content: lines.join('\n') };
  }

  async _applyImprovements(chatId, params, sendReply) {
    const pending = storage.getPendingRecommendations();
    if (pending.length === 0) {
      return { type: 'text', content: 'Aucune recommandation a appliquer. Dis _"analyse maintenant"_ pour en generer.' };
    }

    // Indices specifiques ?
    if (params.indices && Array.isArray(params.indices) && params.indices.length > 0) {
      const ids = params.indices
        .map(i => pending[i - 1])
        .filter(r => r)
        .map(r => r.id);

      if (ids.length === 0) {
        return { type: 'text', content: 'Numeros invalides. Il y a ' + pending.length + ' recommandation(s).' };
      }

      const results = this.optimizer.applyMultiple(ids);
      const applied = results.filter(r => r.success).length;
      return { type: 'text', content: applied + '/' + ids.length + ' recommandation(s) appliquee(s). Dis _"historique"_ pour voir les details.' };
    }

    // Tout appliquer — demander confirmation
    this.pendingConfirmations[String(chatId)] = {
      action: 'apply_all',
      onYes: async () => {
        const result = this.optimizer.applyAll();
        return { type: 'text', content: result.applied + '/' + result.total + ' recommandation(s) appliquee(s) ! Backup cree automatiquement. Dis _"rollback"_ pour annuler.' };
      }
    };

    const lines = ['Appliquer *' + pending.length + '* recommandation(s) ?'];
    lines.push('');
    pending.forEach((r, i) => {
      lines.push((i + 1) + '. ' + r.description);
    });
    lines.push('');
    lines.push('Reponds _"oui"_ ou _"non"_.');

    return { type: 'text', content: lines.join('\n') };
  }

  _showMetrics(chatId) {
    const latest = storage.getLatestSnapshot();
    if (!latest) {
      return { type: 'text', content: 'Pas encore de metriques. Dis _"analyse maintenant"_ pour lancer la premiere collecte.' };
    }

    const lines = ['*Metriques — ' + (latest.date || '?') + '*'];
    lines.push('');

    if (latest.email && latest.email.available) {
      lines.push('*Emails*');
      lines.push(latest.email.totalSent + ' envoyes | ' + latest.email.openRate + '% ouverts');
      if (latest.email.activeCampaigns) lines.push(latest.email.activeCampaigns + ' campagne(s) active(s)');
      lines.push('');
    }

    if (latest.leads && latest.leads.available) {
      lines.push('*Leads*');
      lines.push(latest.leads.totalLeads + ' enrichis | Score moyen : ' + latest.leads.avgScore + '/10');
      const bs = latest.leads.byScore || {};
      lines.push('Score 8+ : ' + (bs.high || 0) + ' | 6-7 : ' + (bs.medium || 0) + ' | < 6 : ' + (bs.low || 0));
      lines.push('');
    }

    if (latest.cross && latest.cross.available) {
      lines.push('*Croisement email/leads*');
      lines.push(latest.cross.totalCrossed + ' emails croises avec scores');
      if (latest.cross.byScoreRange) {
        for (const [range, data] of Object.entries(latest.cross.byScoreRange)) {
          if (data.sent > 0) {
            lines.push('  Score ' + range + ' : ' + Math.round((data.opened / data.sent) * 100) + '% ouverture (' + data.sent + ' emails)');
          }
        }
      }
      lines.push('');
    }

    // Accuracy
    const accuracy = storage.getAccuracyHistory(1);
    if (accuracy.length > 0) {
      lines.push('*Scoring*');
      lines.push('Precision : ' + accuracy[0].accuracy + '% (' + accuracy[0].correct + '/' + accuracy[0].verified + ')');
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _showHistory(chatId) {
    const history = this.optimizer.getModificationHistory(10);
    if (history.length === 0) {
      return { type: 'text', content: 'Aucune amelioration appliquee pour l\'instant.' };
    }

    const lines = ['*Historique des ameliorations (' + history.length + ')* :'];
    lines.push('');
    for (const h of history) {
      const date = h.appliedAt ? new Date(h.appliedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '?';
      lines.push('- *' + date + '* : ' + h.description);
    }
    lines.push('');
    lines.push('Dis _"rollback"_ pour annuler la derniere modification.');

    return { type: 'text', content: lines.join('\n') };
  }

  _rollback(chatId) {
    const result = this.optimizer.rollbackLast();
    if (result.success) {
      return { type: 'text', content: 'Rollback effectue ! Config restauree depuis le backup du ' +
        new Date(result.restoredFrom).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '.' };
    }
    return { type: 'text', content: result.error || 'Aucun backup disponible pour rollback.' };
  }

  async _forceAnalysis(chatId, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '_Analyse en cours... collecte des metriques et generation IA._' });

    try {
      // 1. Collecter les metriques
      const snapshot = this.metricsCollector.buildWeeklySnapshot();

      // 2. Feedback loop
      const accuracyRecord = this.analyzer.comparePredictions();

      // 3. Analyse IA
      const history = storage.getWeeklySnapshots(4);
      const analysis = await this.analyzer.analyzePerformance(snapshot, history.slice(1));

      // 4. Sauvegarder
      storage.saveAnalysis(analysis);
      if (analysis.recommendations && analysis.recommendations.length > 0) {
        storage.savePendingRecommendations(analysis.recommendations);
      }

      // 5. Generer le rapport
      const report = this.analyzer.generateReport(snapshot, analysis, accuracyRecord);

      // FIX 16 : Auto-application si autoApply est active
      const config = storage.getConfig();
      let autoApplyMsg = '';
      if (config.autoApply && analysis.recommendations && analysis.recommendations.length > 0) {
        const autoApplyResult = this._autoApplyRecommendations(analysis.recommendations);
        if (autoApplyResult.applied > 0) {
          autoApplyMsg = '\n\nAuto-Improve : ' + autoApplyResult.applied + '/' +
            autoApplyResult.total + ' recommandation(s) appliquee(s) automatiquement' +
            ' (confiance >= 70%). Dis _"rollback"_ pour annuler.';
        }
      }

      // 6. Analyses avancees Self-Improve v2 (timing + frequency + email perf)
      let advancedMsg = '';
      try {
        const timingData = this._analyzeTimingOptimization();
        const frequencyData = this._analyzeFrequencyOptimization();
        const emailPerfAnalysis = this.analyzer.analyzeEmailPerformance();

        if (emailPerfAnalysis.available && emailPerfAnalysis.recommendations.length > 0) {
          const extraRecos = emailPerfAnalysis.recommendations.map(r => ({
            ...r,
            id: storage._generateId(),
            source: 'email_performance_analysis'
          }));
          const existingPending = storage.getPendingRecommendations();
          storage.savePendingRecommendations([...existingPending, ...extraRecos]);
        }

        if ((emailPerfAnalysis.available && emailPerfAnalysis.insights.length > 0) || timingData || (frequencyData && frequencyData.recommendation)) {
          advancedMsg += '\n\n🔬 *Analyse avancee :*\n';

          if (emailPerfAnalysis.available && emailPerfAnalysis.insights.length > 0) {
            for (const insight of emailPerfAnalysis.insights) {
              advancedMsg += '• ' + insight + '\n';
            }
          }

          if (timingData) {
            advancedMsg += '• Meilleure heure d\'envoi : ' + timingData.bestHour + 'h (' + timingData.bestHourRate + '% open rate)\n';
          }

          if (frequencyData && frequencyData.recommendation) {
            advancedMsg += '• ' + frequencyData.recommendation.description + '\n';
          }
        }
      } catch (e2) {
        log.error('self-improve', 'Erreur analyses avancees (force):', e2.message);
      }

      return { type: 'text', content: report + autoApplyMsg + advancedMsg };
    } catch (error) {
      log.error('self-improve', 'Erreur analyse forcee:', error.message);
      return { type: 'text', content: 'Erreur lors de l\'analyse : ' + error.message };
    }
  }

  _showStatus(chatId) {
    const config = storage.getConfig();
    const stats = storage.getStats();
    const pending = storage.getPendingRecommendations();
    const accuracy = storage.getAccuracyHistory(1);

    const lines = [
      '*Self-Improve :* ' + (config.enabled ? 'ACTIF' : 'DESACTIF'),
      '*Auto-Apply :* ' + (config.autoApply ? 'ACTIF (confiance >= 70%)' : 'DESACTIF (mode manuel)'),
      '*Crons :* ' + this.crons.length + ' actif(s)',
      ''
    ];

    if (stats.lastAnalysisAt) {
      lines.push('Derniere analyse : ' + new Date(stats.lastAnalysisAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    } else {
      lines.push('Aucune analyse encore effectuee');
    }

    lines.push('Analyses totales : ' + stats.totalAnalyses);
    lines.push('Recommandations generees : ' + stats.totalRecommendations);
    lines.push('Ameliorations appliquees : ' + stats.totalApplied);
    lines.push('Rollbacks : ' + stats.totalRollbacks);

    if (pending.length > 0) {
      lines.push('');
      lines.push('*' + pending.length + ' recommandation(s) en attente*');
    }

    if (accuracy.length > 0) {
      lines.push('');
      lines.push('Precision scoring : ' + accuracy[0].accuracy + '%');
    }

    // Overrides actifs
    const weights = storage.getScoringWeights();
    const prefs = storage.getEmailPreferences();
    const criteria = storage.getTargetingCriteria();

    const activeOverrides = [];
    if (weights) activeOverrides.push('scoring');
    if (prefs.maxLength) activeOverrides.push('longueur email');
    if (prefs.preferredSendDay) activeOverrides.push('timing');
    if (criteria.minScore) activeOverrides.push('score minimum');

    if (activeOverrides.length > 0) {
      lines.push('');
      lines.push('*Overrides actifs :* ' + activeOverrides.join(', '));
    }

    return { type: 'text', content: lines.join('\n') };
  }

  // --- Cron hebdomadaire ---

  async _weeklyAnalysis() {
    const config = storage.getConfig();
    if (!config.enabled) return;

    log.info('self-improve', 'Analyse hebdomadaire en cours...');

    try {
      // 1. Collecter les metriques
      const snapshot = this.metricsCollector.buildWeeklySnapshot();

      // 2. Feedback loop
      const accuracyRecord = this.analyzer.comparePredictions();

      // 3. Analyse IA
      const history = storage.getWeeklySnapshots(4);
      const analysis = await this.analyzer.analyzePerformance(snapshot, history.slice(1));

      // 4. Sauvegarder
      storage.saveAnalysis(analysis);
      if (analysis.recommendations && analysis.recommendations.length > 0) {
        storage.savePendingRecommendations(analysis.recommendations);
      }

      // 5. Generer et envoyer le rapport
      const report = this.analyzer.generateReport(snapshot, analysis, accuracyRecord);

      if (this.sendTelegram) {
        await this.sendTelegram(config.adminChatId, report);
        log.info('self-improve', 'Rapport hebdomadaire envoye a ' + config.adminChatId);
      }

      // FIX 16 : Auto-application des recommandations a haute confiance
      if (config.autoApply && analysis.recommendations && analysis.recommendations.length > 0) {
        const autoApplyResult = this._autoApplyRecommendations(analysis.recommendations);
        if (autoApplyResult.applied > 0 && this.sendTelegram) {
          const autoMsg = 'Auto-Improve : ' + autoApplyResult.applied + '/' +
            autoApplyResult.total + ' recommandation(s) appliquee(s) automatiquement' +
            ' (confiance >= 70%).\nDis _"rollback"_ pour annuler.';
          await this.sendTelegram(config.adminChatId, autoMsg);
        }
      }

      // 6. Enregistrer des predictions pour la feedback loop
      this._createPredictions(snapshot);

      // 7. Timing Optimization (4b) + Frequency Optimization (4c)
      try {
        const timingData = this._analyzeTimingOptimization();
        const frequencyData = this._analyzeFrequencyOptimization();

        // 8. Email Performance Analysis (4a) — enrichir les recommandations
        const emailPerfAnalysis = this.analyzer.analyzeEmailPerformance();
        if (emailPerfAnalysis.available && emailPerfAnalysis.recommendations.length > 0) {
          // Ajouter les recommandations email perf aux pending
          const extraRecos = emailPerfAnalysis.recommendations.map(r => ({
            ...r,
            id: storage._generateId(),
            source: 'email_performance_analysis'
          }));
          const existingPending = storage.getPendingRecommendations();
          storage.savePendingRecommendations([...existingPending, ...extraRecos]);

          log.info('self-improve', 'Email perf analysis: ' + emailPerfAnalysis.insights.length + ' insights, ' + extraRecos.length + ' recos ajoutees');
        }

        // Envoyer un complement de rapport si des optimisations timing/frequency
        if (this.sendTelegram && (timingData || frequencyData || (emailPerfAnalysis.available && emailPerfAnalysis.insights.length > 0))) {
          let addMsg = '🔬 *Analyse avancee Self-Improve v2*\n\n';

          if (emailPerfAnalysis.available && emailPerfAnalysis.insights.length > 0) {
            addMsg += '📧 *Performance Email :*\n';
            for (const insight of emailPerfAnalysis.insights) {
              addMsg += '• ' + insight + '\n';
            }
            addMsg += '\n';
          }

          if (timingData) {
            addMsg += '⏰ *Timing Optimal :*\n';
            addMsg += '• Meilleure heure : ' + timingData.bestHour + 'h (' + timingData.bestHourRate + '% open rate)\n';
            addMsg += '• Pire heure : ' + timingData.worstHour + 'h (' + timingData.worstHourRate + '% open rate)\n\n';
          }

          if (frequencyData && frequencyData.recommendation) {
            addMsg += '🔄 *Frequence Follow-ups :*\n';
            addMsg += '• ' + frequencyData.recommendation.description + '\n\n';
          }

          await this.sendTelegram(config.adminChatId, addMsg);
        }
      } catch (e2) {
        log.error('self-improve', 'Erreur analyses avancees:', e2.message);
      }

      log.info('self-improve', 'Analyse hebdomadaire terminee (' +
        (analysis.recommendations ? analysis.recommendations.length : 0) + ' recos)');
    } catch (error) {
      log.error('self-improve', 'Erreur analyse hebdomadaire:', error.message);
    }
  }

  // FIX 16 : Auto-appliquer les recommandations a haute confiance (>= 0.7)
  _autoApplyRecommendations(recommendations) {
    const MIN_CONFIDENCE = 0.7;
    const pending = storage.getPendingRecommendations();
    if (pending.length === 0) return { applied: 0, total: 0, results: [] };

    // Filtrer les recommandations a haute confiance
    const highConfidence = pending.filter(r => (r.confidence || 0) >= MIN_CONFIDENCE);
    if (highConfidence.length === 0) {
      log.info('self-improve', 'Auto-apply: aucune recommandation avec confiance >= ' + (MIN_CONFIDENCE * 100) + '%');
      return { applied: 0, total: pending.length, results: [] };
    }

    // Creer un backup avant toute modification
    const ids = highConfidence.map(r => r.id);
    const results = this.optimizer.applyMultiple(ids);
    const applied = results.filter(r => r.success).length;

    log.info('self-improve', 'Auto-apply: ' + applied + '/' + highConfidence.length +
      ' recommandation(s) appliquee(s) (confiance >= ' + (MIN_CONFIDENCE * 100) + '%)');

    return { applied: applied, total: pending.length, results: results };
  }

  // --- 4b. Timing Optimization : analyse les heures d'envoi et stocke la meilleure plage ---
  _analyzeTimingOptimization() {
    try {
      const automailerStorage = getAutomailerStorageSafe();
      if (!automailerStorage || !automailerStorage.data) return null;

      const emails = automailerStorage.data.emails || [];
      const sentEmails = emails.filter(e => e.sentAt && e.to);

      if (sentEmails.length < 5) {
        log.info('self-improve', 'Timing optim: pas assez d\'emails (' + sentEmails.length + ')');
        return null;
      }

      // Calculer le taux d'ouverture par creneau horaire
      const byHour = {};
      for (const email of sentEmails) {
        const sentDate = new Date(email.sentAt);
        const hour = sentDate.getHours();
        if (!byHour[hour]) byHour[hour] = { sent: 0, opened: 0 };
        byHour[hour].sent++;
        if (email.openedAt) byHour[hour].opened++;
      }

      // Calculer les taux et trier
      const hourRates = Object.entries(byHour)
        .filter(([, d]) => d.sent >= 2)
        .map(([hour, d]) => ({
          hour: parseInt(hour),
          sent: d.sent,
          opened: d.opened,
          openRate: Math.round((d.opened / d.sent) * 100)
        }))
        .sort((a, b) => b.openRate - a.openRate || b.sent - a.sent);

      if (hourRates.length === 0) return null;

      const best = hourRates[0];
      const worst = hourRates[hourRates.length - 1];

      // Stocker la meilleure plage horaire dans le storage self-improve
      const timingData = {
        bestHour: best.hour,
        bestHourRate: best.openRate,
        bestHourEmails: best.sent,
        worstHour: worst.hour,
        worstHourRate: worst.openRate,
        allHourRates: hourRates,
        analyzedEmails: sentEmails.length,
        analyzedAt: new Date().toISOString()
      };

      // Ecrire la preference dans le storage pour que campaign-engine la lise
      storage.setEmailPreferences({
        preferredSendHour: best.hour,
        bestHourOpenRate: best.openRate
      });

      log.info('self-improve', 'Timing optim: meilleure heure=' + best.hour + 'h (' +
        best.openRate + '% sur ' + best.sent + ' emails), pire=' + worst.hour + 'h (' +
        worst.openRate + '%)');

      return timingData;
    } catch (e) {
      log.error('self-improve', 'Erreur timing optimization:', e.message);
      return null;
    }
  }

  // --- 4c. Frequency Optimization : analyse le taux de reponse par nombre de follow-ups ---
  _analyzeFrequencyOptimization() {
    try {
      const automailerStorage = getAutomailerStorageSafe();
      if (!automailerStorage || !automailerStorage.data) return null;

      const campaigns = Object.values(automailerStorage.data.campaigns || {});
      const emails = automailerStorage.data.emails || [];

      if (campaigns.length === 0 || emails.length < 5) {
        log.info('self-improve', 'Frequency optim: pas assez de donnees');
        return null;
      }

      // Analyser le taux de reponse (ouverture) par step de campagne
      const byStep = {};
      for (const email of emails) {
        if (!email.campaignId || email.stepNumber === null || email.stepNumber === undefined) continue;
        const step = email.stepNumber;
        if (!byStep[step]) byStep[step] = { sent: 0, opened: 0 };
        byStep[step].sent++;
        if (email.openedAt) byStep[step].opened++;
      }

      const stepRates = Object.entries(byStep)
        .map(([step, d]) => ({
          step: parseInt(step),
          sent: d.sent,
          opened: d.opened,
          openRate: d.sent > 0 ? Math.round((d.opened / d.sent) * 100) : 0
        }))
        .sort((a, b) => a.step - b.step);

      if (stepRates.length === 0) {
        log.info('self-improve', 'Frequency optim: pas de donnees par step');
        return null;
      }

      // Detecter a partir de quel step le taux chute sous 2%
      const POOR_THRESHOLD = 2; // %
      let recommendedMaxSteps = null;
      let recommendation = null;

      for (const sr of stepRates) {
        if (sr.step >= 3 && sr.sent >= 5 && sr.openRate < POOR_THRESHOLD) {
          recommendedMaxSteps = sr.step;
          recommendation = {
            type: 'frequency',
            description: 'Limiter les follow-ups a ' + (sr.step - 1) + ' steps — le step ' + sr.step + ' n\'a que ' + sr.openRate + '% de reponse sur ' + sr.sent + ' emails',
            action: 'set_max_steps',
            params: { maxSteps: sr.step - 1 },
            confidence: Math.min(0.8, 0.4 + (sr.sent / 30))
          };
          break;
        }
      }

      const frequencyData = {
        stepRates: stepRates,
        recommendedMaxSteps: recommendedMaxSteps,
        recommendation: recommendation,
        analyzedCampaigns: campaigns.length,
        analyzedAt: new Date().toISOString()
      };

      // Sauvegarder la recommandation si elle existe
      if (recommendation) {
        storage.setEmailPreferences({
          recommendedMaxSteps: recommendedMaxSteps ? recommendedMaxSteps - 1 : null
        });
        log.info('self-improve', 'Frequency optim: recommande max ' + (recommendedMaxSteps - 1) + ' steps (step ' + recommendedMaxSteps + ' a < ' + POOR_THRESHOLD + '% reponse)');
      } else {
        log.info('self-improve', 'Frequency optim: pas de limite recommandee (' + stepRates.length + ' steps analyses)');
      }

      return frequencyData;
    } catch (e) {
      log.error('self-improve', 'Erreur frequency optimization:', e.message);
      return null;
    }
  }

  // Creer des predictions pour le feedback loop
  _createPredictions(snapshot) {
    if (!snapshot.cross || !snapshot.cross.available) return;

    try {
      const automailerStorage = getAutomailerStorageSafe();
      const leadStorage = getLeadEnrichStorageSafe();
      if (!automailerStorage || !leadStorage) return;

      const emails = automailerStorage.data.emails || [];
      const enrichedLeads = leadStorage.data.enrichedLeads || {};

      // Pour chaque email recent non encore predit
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentEmails = emails.filter(e => {
        const ts = e.sentAt ? new Date(e.sentAt).getTime() : 0;
        return ts >= oneWeekAgo && e.to;
      });

      for (const email of recentEmails.slice(-20)) {
        const lead = enrichedLeads[email.to.toLowerCase()];
        if (!lead || !lead.aiClassification) continue;

        const score = lead.aiClassification.score || 0;
        storage.addPrediction({
          email: email.to.toLowerCase(),
          score: score,
          predictedOpen: score >= 7,
          industry: lead.aiClassification.industry,
          persona: lead.aiClassification.persona
        });
      }
    } catch (e) {
      log.warn('self-improve', 'Erreur creation predictions:', e.message);
    }
  }

  // --- Aide ---

  getHelp() {
    return [
      '*SELF-IMPROVE*',
      '',
      'J\'analyse les performances du bot chaque semaine et je propose des ameliorations.',
      '',
      '*Voir :*',
      '  _"tes recommandations"_ — suggestions d\'amelioration',
      '  _"metriques"_ — stats de performance',
      '  _"historique"_ — modifications appliquees',
      '  _"status self-improve"_ — etat du systeme',
      '',
      '*Agir :*',
      '  _"applique"_ — valider les recommandations',
      '  _"rollback"_ — annuler la derniere modif',
      '  _"analyse maintenant"_ — forcer une analyse',
      '',
      '*Config :*',
      '  _"active/desactive self-improve"_',
      '  _"active/desactive auto-apply"_ — application auto des recos a haute confiance',
      '',
      'Analyse auto chaque dimanche a 21h.'
    ].join('\n');
  }
}

// Helpers cross-skill
function getAutomailerStorageSafe() {
  try { return require('../automailer/storage.js'); }
  catch (e) {
    try { return require('/app/skills/automailer/storage.js'); }
    catch (e2) { return null; }
  }
}

function getLeadEnrichStorageSafe() {
  try { return require('../lead-enrich/storage.js'); }
  catch (e) {
    try { return require('/app/skills/lead-enrich/storage.js'); }
    catch (e2) { return null; }
  }
}

module.exports = SelfImproveHandler;
