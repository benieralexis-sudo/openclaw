// Proactive Agent - Handler NLP Telegram
const storage = require('./storage.js');
const https = require('https');

class ProactiveHandler {
  constructor(openaiKey, proactiveEngine) {
    this.openaiKey = openaiKey;
    this.engine = proactiveEngine;

    this.pendingConversations = {};
    this.pendingConfirmations = {};
  }

  start() {}
  stop() {}

  // --- NLP ---

  callOpenAI(messages, maxTokens) {
    maxTokens = maxTokens || 200;
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
    const systemPrompt = `Tu es l'assistant de gestion proactive d'un bot Telegram. L'utilisateur parle en francais naturel, souvent de facon informelle.
Tu dois comprendre son INTENTION meme s'il ne dit pas les mots exacts.

Classifie le message en une action JSON.

Actions :
- "toggle_proactive" : activer ou desactiver le mode proactif
  Params: {"enabled": true/false}
  Ex: "active le mode proactif", "desactive les alertes", "stop les notifications", "reactive les rapports"
- "configure_alerts" : configurer une alerte (horaire, seuil, activer/desactiver)
  Params: {"alert":"morningReport/pipelineAlerts/weeklyReport/monthlyReport/emailStatusCheck/nightlyAnalysis", "enabled":true, "hour":8}
  Ex: "change l'heure du rapport a 7h", "desactive le rapport hebdo", "configure les alertes"
- "report_now" : generer un rapport quotidien immediat
  Ex: "rapport maintenant", "fais moi un point", "resume", "ou en est-on ?", "donne moi un recap"
- "weekly_report_now" : generer le rapport hebdo maintenant
  Ex: "rapport de la semaine", "bilan hebdo", "resume de la semaine"
- "monthly_report_now" : generer le rapport mensuel maintenant
  Ex: "rapport du mois", "bilan mensuel", "resume du mois"
- "list_alerts" : voir les alertes configurees
  Ex: "mes alertes", "montre les alertes", "quelles alertes sont actives ?", "configuration proactive"
- "alert_history" : voir l'historique des alertes envoyees
  Params: {"limit": 10}
  Ex: "historique des alertes", "qu'est-ce que tu m'as envoye ?", "dernieres notifications"
- "proactive_status" : statut du mode proactif
  Ex: "mode proactif status", "statut proactif", "comment vont les alertes ?", "c'est actif ?"
- "confirm_yes" : confirmation positive
  Ex: "oui", "ok", "go", "c'est bon", "parfait"
- "confirm_no" : refus / annulation
  Ex: "non", "annule", "stop", "laisse tomber"
- "help" : demande d'aide explicite
  Ex: "aide proactif", "comment ca marche ?"
- "chat" : UNIQUEMENT si ca ne correspond a aucune action ci-dessus

Mode proactif actuellement : ${config.enabled ? 'ACTIF' : 'DESACTIVE'}
${hasPendingConfirm ? 'ATTENTION: CONFIRMATION en attente.' : ''}
${hasPendingConv ? 'ATTENTION: Workflow en cours. Classe en "continue_conversation".' : ''}

Reponds UNIQUEMENT en JSON strict :
{"action":"toggle_proactive","params":{"enabled":true}}
{"action":"report_now"}
{"action":"list_alerts"}`;

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
      console.log('[proactive-NLP] Erreur classifyIntent:', error.message);
      return null;
    }
  }

  // --- Handler principal ---

  async handleMessage(message, chatId, sendReply) {
    const text = message.trim();
    const textLower = text.toLowerCase();

    // Commandes rapides
    if (textLower === '/start' || textLower === 'aide proactif' || textLower === 'aide alertes') {
      return { type: 'text', content: this.getHelp() };
    }

    // Conversations en cours
    if (this.pendingConversations[String(chatId)]) {
      const result = await this._continueConversation(chatId, text, sendReply);
      if (result) return result;
    }

    // NLP
    const command = await this.classifyIntent(text, chatId);
    if (!command) {
      return { type: 'text', content: 'Je n\'ai pas compris. Dis _"aide proactif"_ pour voir ce que je peux faire.' };
    }

    const action = command.action;
    const params = command.params || {};

    switch (action) {
      case 'toggle_proactive': {
        const config = storage.getConfig();
        const enabled = params.enabled !== undefined ? params.enabled : !config.enabled;
        storage.updateConfig({ enabled: enabled });
        if (enabled) {
          this.engine.restart();
          return { type: 'text', content: 'Mode proactif active ! Tu recevras des rapports et alertes automatiquement. Dis _"mes alertes"_ pour voir la config.' };
        } else {
          this.engine.stop();
          return { type: 'text', content: 'Mode proactif desactive. Plus de notifications automatiques. Dis _"active le mode proactif"_ pour reactiver.' };
        }
      }

      case 'configure_alerts': {
        if (params.alert && params.enabled !== undefined) {
          storage.setAlertEnabled(params.alert, params.enabled);
          this.engine.restart();
          return { type: 'text', content: 'Alerte *' + params.alert + '* ' + (params.enabled ? 'activee' : 'desactivee') + '.' };
        }
        if (params.alert && params.hour !== undefined) {
          const alerts = storage.getConfig().alerts;
          if (alerts[params.alert]) {
            alerts[params.alert].hour = params.hour;
            storage.updateConfig({ alerts: alerts });
            this.engine.restart();
            return { type: 'text', content: 'Horaire de *' + params.alert + '* mis a jour : ' + params.hour + 'h.' };
          }
        }
        // Afficher la config pour laisser choisir
        return { type: 'text', content: this._formatAlertConfig() };
      }

      case 'report_now': {
        if (sendReply) await sendReply({ type: 'text', content: '_Generation du rapport en cours..._' });
        try {
          const data = await this.engine.reportGenerator.collectDailyData();
          const briefing = storage.getNightlyBriefing();
          const report = await this.engine.reportGenerator.generateMorningReport(data, briefing);
          storage.logAlert('manual_report', report, { date: data.date });
          return { type: 'text', content: report };
        } catch (e) {
          return { type: 'text', content: 'Erreur lors de la generation du rapport : ' + e.message };
        }
      }

      case 'weekly_report_now': {
        if (sendReply) await sendReply({ type: 'text', content: '_Generation du rapport hebdo..._' });
        try {
          const data = await this.engine.reportGenerator.collectWeeklyData();
          const report = await this.engine.reportGenerator.generateWeeklyReport(data);
          storage.logAlert('manual_weekly_report', report, { date: data.date });
          return { type: 'text', content: report };
        } catch (e) {
          return { type: 'text', content: 'Erreur : ' + e.message };
        }
      }

      case 'monthly_report_now': {
        if (sendReply) await sendReply({ type: 'text', content: '_Generation du rapport mensuel..._' });
        try {
          const data = await this.engine.reportGenerator.collectMonthlyData();
          const report = await this.engine.reportGenerator.generateMonthlyReport(data);
          storage.logAlert('manual_monthly_report', report, { date: data.date });
          return { type: 'text', content: report };
        } catch (e) {
          return { type: 'text', content: 'Erreur : ' + e.message };
        }
      }

      case 'list_alerts': {
        return { type: 'text', content: this._formatAlertConfig() };
      }

      case 'alert_history': {
        const limit = params.limit || 10;
        const alerts = storage.getRecentAlerts(limit);
        if (alerts.length === 0) {
          return { type: 'text', content: 'Aucune alerte envoyee pour l\'instant.' };
        }
        const lines = ['*Dernieres alertes :*', ''];
        for (const a of alerts) {
          const date = new Date(a.sentAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          const typeLabels = {
            morning_report: 'Rapport matinal',
            weekly_report: 'Rapport hebdo',
            monthly_report: 'Rapport mensuel',
            pipeline_alert: 'Alerte pipeline',
            hot_lead: 'Hot lead',
            manual_report: 'Rapport manuel'
          };
          const label = typeLabels[a.type] || a.type;
          lines.push('- *' + label + '* — ' + date);
        }
        return { type: 'text', content: lines.join('\n') };
      }

      case 'proactive_status': {
        return { type: 'text', content: this._formatStatus() };
      }

      case 'confirm_yes':
      case 'confirm_no': {
        if (this.pendingConfirmations[String(chatId)]) {
          const pending = this.pendingConfirmations[String(chatId)];
          delete this.pendingConfirmations[String(chatId)];
          if (action === 'confirm_yes' && pending.onYes) return pending.onYes();
          return { type: 'text', content: 'Annule.' };
        }
        return { type: 'text', content: 'Rien en attente. Dis-moi ce que tu veux faire !' };
      }

      case 'help':
        return { type: 'text', content: this.getHelp() };

      case 'chat':
      default:
        return { type: 'text', content: this.getHelp() };
    }
  }

  // --- Conversations multi-etapes ---

  async _continueConversation(chatId, text, sendReply) {
    const conv = this.pendingConversations[String(chatId)];
    if (!conv) return null;

    // Configure alerts workflow
    if (conv.action === 'configure_alerts') {
      // A implementer si necessaire
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  // --- Formatage ---

  _formatAlertConfig() {
    const config = storage.getConfig();
    const a = config.alerts;
    const t = config.thresholds;

    const alertStatus = (alert, label, timeInfo) => {
      const status = alert.enabled ? 'ON' : 'OFF';
      return (alert.enabled ? '🟢' : '🔴') + ' *' + label + '* — ' + status + ' (' + timeInfo + ')';
    };

    const lines = [
      '*Mode proactif :* ' + (config.enabled ? '🟢 Actif' : '🔴 Inactif'),
      '',
      alertStatus(a.morningReport, 'Rapport matinal', a.morningReport.hour + 'h'),
      alertStatus(a.pipelineAlerts, 'Alertes pipeline', a.pipelineAlerts.hour + 'h'),
      alertStatus(a.weeklyReport, 'Rapport hebdo', 'lundi ' + a.weeklyReport.hour + 'h'),
      alertStatus(a.monthlyReport, 'Rapport mensuel', '1er du mois ' + a.monthlyReport.hour + 'h'),
      alertStatus(a.emailStatusCheck, 'Check emails', 'toutes les ' + a.emailStatusCheck.intervalMinutes + ' min'),
      alertStatus(a.nightlyAnalysis, 'Analyse nocturne', a.nightlyAnalysis.hour + 'h'),
      '',
      '*Seuils :*',
      '- Deal stagnant : ' + t.stagnantDealDays + ' jours',
      '- Hot lead : ' + t.hotLeadOpens + '+ ouvertures',
      '- Alerte cloture : ' + t.dealCloseWarningDays + ' jours avant'
    ];
    return lines.join('\n');
  }

  _formatStatus() {
    const config = storage.getConfig();
    const stats = storage.getStats();
    const status = this.engine.getStatus();

    const lines = [
      '*Mode proactif :* ' + (config.enabled ? '🟢 Actif' : '🔴 Inactif'),
      '*Crons actifs :* ' + status.activeCrons,
      ''
    ];

    if (stats.lastMorningReport) {
      lines.push('Dernier rapport matinal : ' + new Date(stats.lastMorningReport).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    }
    if (stats.lastWeeklyReport) {
      lines.push('Dernier rapport hebdo : ' + new Date(stats.lastWeeklyReport).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    }
    if (stats.lastNightlyAnalysis) {
      lines.push('Derniere analyse nocturne : ' + new Date(stats.lastNightlyAnalysis).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    }
    if (stats.lastEmailCheck) {
      lines.push('Dernier check emails : ' + new Date(stats.lastEmailCheck).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    }

    lines.push('');
    lines.push('Rapports envoyes : ' + stats.totalReportsSent);
    lines.push('Alertes envoyees : ' + stats.totalAlertsSent);

    const hotLeads = storage.getHotLeads();
    const hotCount = Object.keys(hotLeads).length;
    if (hotCount > 0) {
      lines.push('');
      lines.push('Hot leads detectes : ' + hotCount);
    }

    return lines.join('\n');
  }

  getHelp() {
    return [
      '*PROACTIVE AGENT*',
      '',
      'Je travaille en arriere-plan et t\'envoie des rapports et alertes automatiques.',
      '',
      '*Rapports :*',
      '  _"rapport maintenant"_ — point quotidien',
      '  _"rapport de la semaine"_ — bilan hebdo',
      '  _"rapport du mois"_ — bilan mensuel',
      '',
      '*Configuration :*',
      '  _"mes alertes"_ — voir la config',
      '  _"active/desactive le mode proactif"_',
      '  _"mode proactif status"_ — statut detaille',
      '',
      '*Alertes automatiques :*',
      '  Rapport matinal (8h), alertes pipeline (9h),',
      '  rapport hebdo (lundi 9h), rapport mensuel (1er),',
      '  detection hot leads (toutes les 30 min)'
    ].join('\n');
  }
}

module.exports = ProactiveHandler;
