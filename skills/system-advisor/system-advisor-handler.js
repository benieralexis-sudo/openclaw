// System Advisor - Handler NLP Telegram + crons monitoring systeme
const https = require('https');
const { Cron } = require('croner');
const storage = require('./storage.js');
const SystemMonitor = require('./system-monitor.js');
const ReportGenerator = require('./report-generator.js');
const { retryAsync } = require('../../gateway/utils.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const log = require('../../gateway/logger.js');

class SystemAdvisorHandler {
  constructor(openaiKey, claudeKey, sendTelegramFn) {
    this.openaiKey = openaiKey;
    this.claudeKey = claudeKey;
    this.sendTelegram = sendTelegramFn;
    this.monitor = new SystemMonitor();
    this.reportGen = new ReportGenerator(claudeKey);

    this.pendingConversations = {};
    this.pendingConfirmations = {};
    this.crons = [];
  }

  // --- Lifecycle ---

  start() {
    this.stop();
    const config = storage.getConfig();
    if (!config.enabled) {
      log.info('system-advisor', 'Desactive, pas de crons');
      return;
    }

    const tz = 'Europe/Paris';

    // Snapshot toutes les 5 min
    this.crons.push(new Cron('*/5 * * * *', { timezone: tz }, () => {
      this._collectSnapshot().catch(e => log.error('system-advisor', 'Erreur snapshot:', e.message));
    }));
    log.info('system-advisor', 'Cron: snapshot toutes les 5 min');

    // Health check toutes les heures
    this.crons.push(new Cron('0 * * * *', { timezone: tz }, () => {
      this._hourlyHealthCheck().catch(e => log.error('system-advisor', 'Erreur health check:', e.message));
    }));
    log.info('system-advisor', 'Cron: health check toutes les heures');

    // Rapport quotidien 6h30 (avant le rapport matinal unifie de 8h)
    this.crons.push(new Cron('30 6 * * *', { timezone: tz }, () => {
      this._dailyReport().catch(e => log.error('system-advisor', 'Erreur rapport quotidien:', e.message));
    }));
    log.info('system-advisor', 'Cron: rapport quotidien 6h30');

    // Rapport hebdo lundi 10h30 (decale pour eviter embouteillage matinal)
    this.crons.push(new Cron('30 10 * * 1', { timezone: tz }, () => {
      this._weeklyReport().catch(e => log.error('system-advisor', 'Erreur rapport hebdo:', e.message));
    }));
    log.info('system-advisor', 'Cron: rapport hebdo lundi 10h30');

    log.info('system-advisor', 'Demarre avec ' + this.crons.length + ' cron(s)');
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
    const config = storage.getConfig();

    const systemPrompt = `Tu es l'assistant de monitoring systeme d'un bot Telegram. L'utilisateur parle en francais naturel, souvent informel.
Comprends son INTENTION pour router vers la bonne action.

Mode monitoring : ${config.enabled ? 'ACTIF' : 'DESACTIVE'}

Actions :
- "system_status" : vue d'ensemble du systeme
  Ex: "status systeme", "sante du bot", "comment va le bot ?", "etat du systeme", "ca va ?"
- "memory_detail" : details RAM/memoire
  Ex: "utilisation memoire", "RAM", "combien de memoire ?", "heap", "memoire"
- "disk_detail" : espace disque
  Ex: "espace disque", "stockage", "combien d'espace ?", "disque"
- "recent_errors" : erreurs recentes
  Ex: "erreurs recentes", "des erreurs ?", "bugs", "problemes", "ca plante ?"
- "skill_usage" : stats d'utilisation des skills
  Ex: "skills les plus utilisees", "utilisation", "quelle skill marche le mieux ?", "stats utilisation"
- "full_report" : rapport complet IA
  Ex: "rapport systeme", "rapport complet", "fais un check complet", "analyse systeme"
- "active_alerts" : alertes en cours
  Ex: "alertes systeme", "des alertes ?", "warnings", "alertes"
- "uptime" : duree de fonctionnement
  Ex: "uptime", "depuis quand le bot tourne ?", "temps de fonctionnement"
- "health_check_now" : lancer un health check immediat
  Ex: "check sante", "lance un check", "verifie tout", "diagnostique"
- "response_times" : temps de reponse par skill
  Ex: "temps de reponse", "latence", "c'est rapide ?", "performances"
- "configure" : configurer seuils/alertes
  Params: {"threshold":"ramWarning","value":85}
  Ex: "change le seuil RAM a 85%", "configure les alertes"
- "toggle" : activer/desactiver
  Params: {"enabled":true}
  Ex: "active le monitoring", "desactive les alertes systeme"
- "help" : aide
- "chat" : si aucune action ne correspond

Reponds UNIQUEMENT en JSON strict :
{"action":"system_status"}`;

    try {
      const breaker = getBreaker('openai', { failureThreshold: 3, cooldownMs: 60000 });
      const response = await breaker.call(() => retryAsync(() => this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ], 200), 2, 2000));

      let cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      if (!result.action) return null;
      return result;
    } catch (error) {
      log.error('system-advisor', 'Erreur classifyIntent:', error.message);
      return null;
    }
  }

  // --- Handler principal ---

  async handleMessage(message, chatId, sendReply) {
    const text = message.trim();
    const textLower = text.toLowerCase();

    if (textLower === '/start' || textLower === 'aide systeme' || textLower === 'aide system advisor') {
      return { type: 'text', content: this.getHelp() };
    }

    const command = await this.classifyIntent(text, chatId);
    if (!command) {
      return { type: 'text', content: 'Je n\'ai pas compris. Dis _"aide systeme"_ pour voir ce que je peux faire.' };
    }

    const action = command.action;
    const params = command.params || {};

    switch (action) {
      case 'system_status': return this._showSystemStatus();
      case 'memory_detail': return this._showMemoryDetail();
      case 'disk_detail': return this._showDiskDetail();
      case 'recent_errors': return this._showRecentErrors();
      case 'skill_usage': return this._showSkillUsage();
      case 'full_report': return this._generateFullReport(chatId, sendReply);
      case 'active_alerts': return this._showActiveAlerts();
      case 'uptime': return this._showUptime();
      case 'health_check_now': return this._runHealthCheckNow(sendReply);
      case 'response_times': return this._showResponseTimes();
      case 'configure': return this._configure(params);
      case 'toggle': return this._toggle(params);
      case 'help': return { type: 'text', content: this.getHelp() };
      case 'chat':
      default: return { type: 'text', content: this.getHelp() };
    }
  }

  // --- Actions ---

  _showSystemStatus() {
    const snapshot = this.monitor.collectSystemSnapshot();
    const activeAlerts = storage.getActiveAlerts();
    const routerMetrics = this.monitor.collectSkillUsageFromRouter();

    const ramBar = this._progressBar(snapshot.ram.usagePercent);
    const diskBar = this._progressBar(snapshot.disk.usagePercent);

    const lines = [
      '*Status Systeme iFIND*',
      '',
      '*RAM* ' + ramBar + ' ' + snapshot.ram.usagePercent + '%',
      '  ' + snapshot.ram.usedMB + ' / ' + snapshot.ram.totalMB + ' MB',
      '',
      '*Disque* ' + diskBar + ' ' + snapshot.disk.usagePercent + '%',
      '  ' + snapshot.disk.usedGB + ' / ' + snapshot.disk.totalGB,
      '',
      '*CPU* Load: ' + snapshot.cpu.loadAvg1m + ' (' + snapshot.cpu.cores + ' cores)',
      '*Uptime* ' + snapshot.uptime.processHuman,
      ''
    ];

    if (activeAlerts.length > 0) {
      lines.push('*Alertes actives :* ' + activeAlerts.length);
      for (const a of activeAlerts.slice(0, 3)) {
        const emoji = a.level === 'critical' ? '🔴' : '⚠️';
        lines.push('  ' + emoji + ' ' + a.message);
      }
    } else {
      lines.push('🟢 Aucune alerte');
    }

    // Stats rapides du routeur
    if (routerMetrics.available) {
      const totalMsgs = Object.values(routerMetrics.usage).reduce((sum, u) => sum + (u.count || 0), 0);
      const totalErrors = Object.values(routerMetrics.errors).reduce((sum, e) => sum + (e.count || 0), 0);
      lines.push('');
      lines.push('Messages traites : ' + totalMsgs + ' | Erreurs : ' + totalErrors);
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _showMemoryDetail() {
    const ram = this.monitor._collectRam();
    const recentSnapshots = storage.getRecentSnapshots(6);

    const lines = [
      '*Details Memoire*',
      '',
      '*Systeme :*',
      'Total : ' + ram.totalMB + ' MB',
      'Utilise : ' + ram.usedMB + ' MB (' + ram.usagePercent + '%)',
      'Libre : ' + ram.freeMB + ' MB',
      '',
      '*Process Node.js :*',
      'RSS : ' + ram.process.rssMB + ' MB',
      'Heap utilise : ' + ram.process.heapUsedMB + ' MB',
      'Heap total : ' + ram.process.heapTotalMB + ' MB',
      'External : ' + ram.process.externalMB + ' MB'
    ];

    if (recentSnapshots.length > 1) {
      const first = recentSnapshots[0].ram.usagePercent;
      const last = recentSnapshots[recentSnapshots.length - 1].ram.usagePercent;
      const trend = last > first ? '📈 en hausse' : last < first ? '📉 en baisse' : '➡️ stable';
      lines.push('');
      lines.push('*Tendance (30 min) :* ' + trend + ' (' + first + '% → ' + last + '%)');
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _showDiskDetail() {
    const disk = this.monitor._collectDiskUsage();

    const lines = [
      '*Details Disque*',
      '',
      'Total : ' + disk.totalGB,
      'Utilise : ' + disk.usedGB + ' (' + disk.usagePercent + '%)',
      'Disponible : ' + disk.availableGB,
      ''
    ];

    const skillNames = Object.keys(disk.bySkill);
    if (skillNames.length > 0) {
      lines.push('*Par skill :*');
      const sorted = skillNames.sort((a, b) => {
        const parseSize = s => { const n = parseFloat(s); const u = s.replace(/[0-9.]/g, ''); return u === 'G' ? n * 1024 : u === 'K' ? n / 1024 : n; };
        return parseSize(disk.bySkill[b]) - parseSize(disk.bySkill[a]);
      });
      for (const name of sorted) {
        lines.push('  ' + name + ' : ' + disk.bySkill[name]);
      }
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _showRecentErrors() {
    const skillMetrics = storage.getSkillMetrics();
    const errors = skillMetrics.errors || {};
    const allErrors = [];

    for (const [skill, data] of Object.entries(errors)) {
      for (const err of (data.recentErrors || [])) {
        allErrors.push({ skill: skill, message: err.message, at: err.at });
      }
    }

    if (allErrors.length === 0) {
      return { type: 'text', content: '🟢 Aucune erreur recente. Tout roule !' };
    }

    allErrors.sort((a, b) => new Date(b.at) - new Date(a.at));

    const lines = ['*Erreurs recentes* (' + allErrors.length + ')', ''];
    for (const err of allErrors.slice(0, 15)) {
      const date = new Date(err.at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      lines.push('*' + err.skill + '* — ' + date);
      lines.push('  ' + err.message.substring(0, 100));
      lines.push('');
    }

    // Resume par skill
    lines.push('*Par skill :*');
    for (const [skill, data] of Object.entries(errors)) {
      if (data.total > 0) {
        lines.push('- ' + skill + ' : ' + data.today + ' aujourd\'hui, ' + data.total + ' total');
      }
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _showSkillUsage() {
    const skillMetrics = storage.getSkillMetrics();
    const routerMetrics = this.monitor.collectSkillUsageFromRouter();
    const usage = skillMetrics.usage || {};

    // Merger avec les metriques du routeur en memoire
    const merged = { ...usage };
    if (routerMetrics.available) {
      for (const [skill, data] of Object.entries(routerMetrics.usage)) {
        if (!merged[skill]) merged[skill] = { today: 0, week: 0, total: 0, lastUsedAt: null };
        merged[skill].routerCount = data.count || 0;
        if (data.lastUsedAt) merged[skill].lastUsedAt = data.lastUsedAt;
      }
    }

    const entries = Object.entries(merged);
    if (entries.length === 0) {
      return { type: 'text', content: 'Pas encore de donnees d\'utilisation. Envoie quelques messages d\'abord !' };
    }

    const sorted = entries.sort((a, b) => (b[1].total || b[1].routerCount || 0) - (a[1].total || a[1].routerCount || 0));

    const lines = ['*Utilisation des skills*', ''];
    let rank = 1;
    for (const [skill, data] of sorted) {
      const medals = ['🥇', '🥈', '🥉'];
      const prefix = rank <= 3 ? medals[rank - 1] : rank + '.';
      const total = data.total || data.routerCount || 0;
      const today = data.today || 0;
      const lastUsed = data.lastUsedAt
        ? new Date(data.lastUsedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : 'jamais';
      lines.push(prefix + ' *' + skill + '* : ' + total + ' messages (aujourd\'hui: ' + today + ')');
      lines.push('   Derniere activite : ' + lastUsed);
      rank++;
    }

    return { type: 'text', content: lines.join('\n') };
  }

  async _generateFullReport(chatId, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '_Generation du rapport systeme..._' });

    const snapshot = this.monitor.collectSystemSnapshot();
    const healthCheck = this.monitor.runHealthChecks();
    const skillMetrics = storage.getSkillMetrics();
    const activeAlerts = storage.getActiveAlerts();

    const report = await this.reportGen.generateDailyReport(snapshot, skillMetrics, healthCheck, activeAlerts);
    storage.logAlert('manual_report', report);
    return { type: 'text', content: report };
  }

  _showActiveAlerts() {
    const alerts = storage.getActiveAlerts();
    if (alerts.length === 0) {
      return { type: 'text', content: '🟢 Aucune alerte active. Le systeme est en bonne sante !' };
    }

    const lines = ['*Alertes actives* (' + alerts.length + ')', ''];
    for (const a of alerts) {
      const emoji = a.level === 'critical' ? '🔴' : a.level === 'warning' ? '⚠️' : 'ℹ️';
      const date = new Date(a.createdAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      lines.push(emoji + ' *' + a.type + '* — ' + a.level);
      lines.push('  ' + a.message);
      lines.push('  _Depuis ' + date + '_');
      lines.push('');
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _showUptime() {
    const uptime = this.monitor._collectUptime();
    const stats = storage.getStats();

    const lines = [
      '*Uptime iFIND*',
      '',
      'Process Node.js : *' + uptime.processHuman + '*',
      'Systeme (container) : *' + uptime.osHuman + '*',
      ''
    ];

    if (stats.startedAt) {
      lines.push('Demarre le : ' + new Date(stats.startedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }));
    }
    lines.push('Snapshots collectes : ' + stats.totalSnapshots);
    lines.push('Health checks : ' + stats.totalHealthChecks);
    lines.push('Rapports envoyes : ' + stats.totalReportsSent);
    lines.push('Alertes envoyees : ' + stats.totalAlertsSent);

    return { type: 'text', content: lines.join('\n') };
  }

  async _runHealthCheckNow(sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '_Health check en cours..._' });

    const healthCheck = this.monitor.runHealthChecks();
    const apiCheck = await this.monitor.checkApiReachability();

    storage.saveHealthCheck(healthCheck);

    const statusEmoji = healthCheck.status === 'healthy' ? '🟢' : healthCheck.status === 'warning' ? '🟡' : '🔴';

    const lines = [
      statusEmoji + ' *Health Check — ' + healthCheck.status.toUpperCase() + '*',
      ''
    ];

    for (const check of healthCheck.checks) {
      const emoji = check.status === 'ok' ? '✅' : check.status === 'warning' ? '⚠️' : '❌';
      lines.push(emoji + ' *' + check.name + '* : ' + check.value);
      lines.push('  ' + check.detail);
    }

    lines.push('');
    lines.push('*API externes :*');
    for (const [name, data] of Object.entries(apiCheck)) {
      const emoji = data.reachable ? '✅' : '❌';
      lines.push(emoji + ' ' + name + ' : ' + (data.reachable ? data.latencyMs + 'ms' : 'injoignable'));
    }

    // Storage details
    lines.push('');
    lines.push('*Fichiers de donnees :*');
    for (const [skill, data] of Object.entries(healthCheck.storageDetails)) {
      const emoji = data.valid ? '✅' : data.exists ? '⚠️' : '❌';
      const info = data.valid ? data.sizeKB + 'KB' : (data.error || 'absent');
      lines.push(emoji + ' ' + skill + ' : ' + info);
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _showResponseTimes() {
    const skillMetrics = storage.getSkillMetrics();
    const routerMetrics = this.monitor.collectSkillUsageFromRouter();
    const rt = skillMetrics.responseTimes || {};

    // Merger
    const merged = { ...rt };
    if (routerMetrics.available) {
      for (const [skill, data] of Object.entries(routerMetrics.responseTimes)) {
        if (!merged[skill]) merged[skill] = {};
        if (data.times && data.times.length > 0) {
          const times = data.times;
          merged[skill].routerAvg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
          merged[skill].routerMin = Math.min(...times);
          merged[skill].routerMax = Math.max(...times);
        }
      }
    }

    const entries = Object.entries(merged);
    if (entries.length === 0) {
      return { type: 'text', content: 'Pas encore de donnees de temps de reponse.' };
    }

    const sorted = entries.sort((a, b) => (a[1].avg || a[1].routerAvg || 0) - (b[1].avg || b[1].routerAvg || 0));

    const lines = ['*Temps de reponse par skill*', ''];
    for (const [skill, data] of sorted) {
      const avg = data.avg || data.routerAvg || 0;
      const min = data.min === Infinity ? 'N/A' : (data.min || data.routerMin || 0) + 'ms';
      const max = data.max || data.routerMax || 0;
      const emoji = avg < 1000 ? '🟢' : avg < 3000 ? '🟡' : '🔴';
      lines.push(emoji + ' *' + skill + '* : moy ' + avg + 'ms');
      lines.push('  min ' + min + ' | max ' + max + 'ms');
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _configure(params) {
    if (params.threshold && params.value !== undefined) {
      const validThresholds = ['ramWarning', 'ramCritical', 'diskWarning', 'diskCritical', 'errorRateWarning', 'inactivityHours'];
      if (validThresholds.includes(params.threshold)) {
        storage.setThreshold(params.threshold, params.value);
        return { type: 'text', content: 'Seuil *' + params.threshold + '* mis a jour : ' + params.value };
      }
    }

    // Afficher la config
    const config = storage.getConfig();
    const t = config.thresholds;
    const a = config.alerts;
    const lines = [
      '*Configuration System Advisor*',
      '',
      '*Seuils d\'alerte :*',
      '- RAM warning : ' + t.ramWarning + '%',
      '- RAM critique : ' + t.ramCritical + '%',
      '- Disque warning : ' + t.diskWarning + '%',
      '- Disque critique : ' + t.diskCritical + '%',
      '- Taux erreur warning : ' + t.errorRateWarning + '%',
      '- Inactivite : ' + t.inactivityHours + 'h',
      '',
      '*Crons :*',
      '- Snapshot : toutes les ' + a.metricsCollection.intervalMinutes + ' min ' + (a.metricsCollection.enabled ? '🟢' : '🔴'),
      '- Health check : toutes les ' + a.healthCheck.intervalMinutes + ' min ' + (a.healthCheck.enabled ? '🟢' : '🔴'),
      '- Rapport quotidien : ' + a.dailyReport.hour + 'h ' + (a.dailyReport.enabled ? '🟢' : '🔴'),
      '- Rapport hebdo : lundi ' + a.weeklyReport.hour + 'h ' + (a.weeklyReport.enabled ? '🟢' : '🔴')
    ];
    return { type: 'text', content: lines.join('\n') };
  }

  _toggle(params) {
    const enabled = params.enabled !== undefined ? params.enabled : !storage.getConfig().enabled;
    storage.updateConfig({ enabled: enabled });
    if (enabled) {
      this.start();
      return { type: 'text', content: '🟢 Monitoring systeme active !' };
    } else {
      this.stop();
      return { type: 'text', content: '🔴 Monitoring systeme desactive.' };
    }
  }

  // --- Crons ---

  async _collectSnapshot() {
    const config = storage.getConfig();
    if (!config.enabled) return;

    const snapshot = this.monitor.collectSystemSnapshot();
    storage.saveSnapshot(snapshot);

    // Syncer les metriques du routeur dans le storage
    const routerMetrics = this.monitor.collectSkillUsageFromRouter();
    if (routerMetrics.available) {
      for (const [skill, data] of Object.entries(routerMetrics.usage)) {
        // Mise a jour incrementale
        const current = storage.getSkillMetrics().usage[skill];
        if (!current || (data.count || 0) > (current.routerCount || 0)) {
          // Nouveau messages depuis le dernier sync
        }
      }
    }

    // Verifier les seuils
    const thresholds = config.thresholds;

    // RAM
    if (snapshot.ram.usagePercent >= thresholds.ramCritical) {
      const existing = storage.getActiveAlerts().find(a => a.type === 'ram_critical');
      if (!existing) {
        const alert = storage.addAlert({
          type: 'ram_critical',
          level: 'critical',
          message: 'RAM critique : ' + snapshot.ram.usagePercent + '% (' + snapshot.ram.usedMB + '/' + snapshot.ram.totalMB + 'MB)',
          value: snapshot.ram.usagePercent + '%',
          threshold: thresholds.ramCritical + '%'
        });
        if (this.sendTelegram) {
          const msg = this.reportGen.generateAlertMessage(alert);
          await this.sendTelegram(config.adminChatId, msg).catch(e => log.error('system-advisor', 'Erreur envoi alerte:', e.message));
        }
      }
    } else if (snapshot.ram.usagePercent >= thresholds.ramWarning) {
      const existing = storage.getActiveAlerts().find(a => a.type === 'ram_warning');
      if (!existing) {
        storage.addAlert({
          type: 'ram_warning',
          level: 'warning',
          message: 'RAM elevee : ' + snapshot.ram.usagePercent + '%',
          value: snapshot.ram.usagePercent + '%',
          threshold: thresholds.ramWarning + '%'
        });
      }
    } else {
      // Resoudre les alertes RAM si la situation est revenue a la normale
      storage.resolveAlertsByType('ram_critical');
      storage.resolveAlertsByType('ram_warning');
    }

    // Disk
    if (snapshot.disk.usagePercent >= thresholds.diskCritical) {
      const existing = storage.getActiveAlerts().find(a => a.type === 'disk_critical');
      if (!existing) {
        const alert = storage.addAlert({
          type: 'disk_critical',
          level: 'critical',
          message: 'Disque critique : ' + snapshot.disk.usagePercent + '%',
          value: snapshot.disk.usagePercent + '%',
          threshold: thresholds.diskCritical + '%'
        });
        if (this.sendTelegram) {
          const msg = this.reportGen.generateAlertMessage(alert);
          await this.sendTelegram(config.adminChatId, msg).catch(e => log.error('system-advisor', 'Erreur envoi alerte:', e.message));
        }
      }
    } else {
      storage.resolveAlertsByType('disk_critical');
      storage.resolveAlertsByType('disk_warning');
    }

    // Agregation horaire (toutes les 12 snapshots = 1h)
    const snapshots = storage.getRecentSnapshots(12);
    if (snapshots.length >= 12) {
      const aggregate = this.monitor.aggregateSnapshots(snapshots);
      if (aggregate) storage.saveHourlyAggregate(aggregate);
    }
  }

  async _hourlyHealthCheck() {
    const config = storage.getConfig();
    if (!config.enabled) return;

    log.info('system-advisor', 'Health check horaire');
    const result = this.monitor.runHealthChecks();
    storage.saveHealthCheck(result);

    // Si critique, envoyer alerte Telegram
    if (result.status === 'critical' && this.sendTelegram) {
      const criticalChecks = result.checks.filter(c => c.status === 'critical');
      const msg = '🔴 *HEALTH CHECK CRITIQUE*\n\n' +
        criticalChecks.map(c => '❌ *' + c.name + '* : ' + c.value + '\n  ' + c.detail).join('\n\n');
      await this.sendTelegram(config.adminChatId, msg).catch(e => log.error('system-advisor', 'Erreur envoi alerte:', e.message));
      storage.logAlert('health_check_critical', msg);
    }
  }

  async _dailyReport() {
    const config = storage.getConfig();
    if (!config.enabled || !config.alerts.dailyReport.enabled) return;
    if (!this.sendTelegram) return;

    log.info('system-advisor', 'Rapport quotidien');

    const snapshot = this.monitor.collectSystemSnapshot();
    const healthCheck = this.monitor.runHealthChecks();
    const skillMetrics = storage.getSkillMetrics();
    const activeAlerts = storage.getActiveAlerts();

    const report = await this.reportGen.generateDailyReport(snapshot, skillMetrics, healthCheck, activeAlerts);

    await this.sendTelegram(config.adminChatId, report).catch(e => log.error('system-advisor', 'Erreur rapport:', e.message));
    storage.updateStat('lastDailyReportAt', new Date().toISOString());
    storage.updateStat('totalReportsSent', (storage.getStats().totalReportsSent || 0) + 1);
    storage.logAlert('daily_report', report);

    // Reset daily counters
    storage.resetDailyCounters();
  }

  async _weeklyReport() {
    const config = storage.getConfig();
    if (!config.enabled || !config.alerts.weeklyReport.enabled) return;
    if (!this.sendTelegram) return;

    log.info('system-advisor', 'Rapport hebdomadaire');

    const snapshots = storage.getRecentSnapshots(2016);
    const aggregate = this.monitor.aggregateSnapshots(snapshots);
    const skillMetrics = storage.getSkillMetrics();
    const alertHistory = storage.getRecentAlerts(50);

    const report = await this.reportGen.generateWeeklyReport(aggregate, skillMetrics, alertHistory);

    await this.sendTelegram(config.adminChatId, report).catch(e => log.error('system-advisor', 'Erreur rapport hebdo:', e.message));
    storage.updateStat('lastWeeklyReportAt', new Date().toISOString());
    storage.updateStat('totalReportsSent', (storage.getStats().totalReportsSent || 0) + 1);
    storage.logAlert('weekly_report', report);

    // Reset weekly counters
    storage.resetWeeklyCounters();
  }

  // --- Helpers ---

  _progressBar(percent) {
    const filled = Math.round(percent / 10);
    const empty = 10 - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  }

  getHelp() {
    return [
      '*SYSTEM ADVISOR*',
      '',
      'Je surveille la sante du bot et t\'alerte en cas de probleme.',
      '',
      '*Voir :*',
      '  _"status systeme"_ — vue d\'ensemble',
      '  _"utilisation memoire"_ — details RAM',
      '  _"espace disque"_ — stockage',
      '  _"erreurs recentes"_ — bugs et problemes',
      '  _"skills les plus utilisees"_ — stats',
      '  _"temps de reponse"_ — latence par skill',
      '  _"uptime"_ — depuis quand ca tourne',
      '',
      '*Agir :*',
      '  _"rapport systeme"_ — rapport complet IA',
      '  _"check sante"_ — health check immediat',
      '  _"alertes systeme"_ — alertes en cours',
      '',
      '*Auto :*',
      '  Snapshot 5 min, health check 1h',
      '  Rapport quotidien 7h, hebdo lundi 8h'
    ].join('\n');
  }
}

module.exports = SystemAdvisorHandler;
