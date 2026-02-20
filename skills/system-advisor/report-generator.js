// System Advisor - Generation de rapports IA via Claude Sonnet 4.5
const https = require('https');
const { retryAsync } = require('../../gateway/utils.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const log = require('../../gateway/logger.js');

class ReportGenerator {
  constructor(claudeKey) {
    this.claudeKey = claudeKey;
  }

  callClaude(messages, systemPrompt, maxTokens, model) {
    maxTokens = maxTokens || 1500;
    model = model || 'claude-sonnet-4-6';
    return new Promise((resolve, reject) => {
      const body = {
        model: model,
        max_tokens: maxTokens,
        messages: messages
      };
      if (systemPrompt) {
        body.system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
      }

      const postData = JSON.stringify(body);
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.claudeKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.content && response.content[0]) {
              const cached = response.usage ? (response.usage.cache_read_input_tokens || 0) : 0;
              if (cached > 0) log.info('system-advisor', 'Cache hit: ' + cached + ' tokens caches');
              resolve(response.content[0].text);
            } else if (response.error) {
              reject(new Error('Claude API: ' + (response.error.message || JSON.stringify(response.error))));
            } else {
              reject(new Error('Reponse Claude invalide'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout Claude API')); });
      req.write(postData);
      req.end();
    });
  }

  // --- Rapport quotidien ---

  async generateDailyReport(snapshot, skillMetrics, healthCheck, activeAlerts) {
    if (!this.claudeKey) return this._fallbackDailyReport(snapshot, skillMetrics, healthCheck, activeAlerts);

    const dataStr = `SNAPSHOT SYSTEME :
- RAM : ${snapshot.ram.usedMB}MB / ${snapshot.ram.totalMB}MB (${snapshot.ram.usagePercent}%)
- Process Node.js : RSS ${snapshot.ram.process.rssMB}MB, Heap ${snapshot.ram.process.heapUsedMB}/${snapshot.ram.process.heapTotalMB}MB
- CPU : ${snapshot.cpu.cores} cores, load ${snapshot.cpu.loadAvg1m}/${snapshot.cpu.loadAvg5m}/${snapshot.cpu.loadAvg15m}
- Disque : ${snapshot.disk.usedGB} / ${snapshot.disk.totalGB} (${snapshot.disk.usagePercent}%)
- Uptime : ${snapshot.uptime.processHuman}

HEALTH CHECK : ${healthCheck.status.toUpperCase()}
${healthCheck.checks.map(c => '- ' + c.name + ' : ' + c.status + ' (' + c.value + ')').join('\n')}

UTILISATION DES SKILLS :
${Object.entries(skillMetrics.usage || {}).map(([k, v]) => '- ' + k + ' : ' + (v.today || 0) + ' messages aujourd\'hui, ' + (v.total || 0) + ' total').join('\n') || 'Aucune donnee'}

ERREURS :
${Object.entries(skillMetrics.errors || {}).filter(([k, v]) => v.today > 0).map(([k, v]) => '- ' + k + ' : ' + v.today + ' erreur(s) aujourd\'hui').join('\n') || 'Aucune erreur'}

ALERTES ACTIVES : ${activeAlerts.length}
${activeAlerts.map(a => '- [' + a.level + '] ' + a.message).join('\n') || 'Aucune'}`;

    const systemPrompt = `Tu es un ingenieur DevOps qui surveille un bot Telegram (iFIND) avec 10 skills B2B.
Genere un rapport de sante systeme concis en francais.

REGLES :
- Format Telegram Markdown : *gras*, _italique_
- Commence par un emoji d'etat : 🟢 si tout va bien, 🟡 si warning, 🔴 si critique
- Sois concis (max 15 lignes)
- Mets en avant les problemes et les points d'attention
- Si tout va bien, dis-le simplement
- Termine par une recommandation si necessaire`;

    try {
      const breaker = getBreaker('claude-sonnet', { failureThreshold: 3, cooldownMs: 60000 });
      const response = await breaker.call(() => retryAsync(() => this.callClaude(
        [{ role: 'user', content: dataStr }],
        systemPrompt,
        1000
      ), 2, 3000));
      return response;
    } catch (e) {
      log.error('system-advisor', 'Erreur rapport quotidien Claude:', e.message);
      return this._fallbackDailyReport(snapshot, skillMetrics, healthCheck, activeAlerts);
    }
  }

  _fallbackDailyReport(snapshot, skillMetrics, healthCheck, activeAlerts) {
    const statusEmoji = healthCheck.status === 'healthy' ? '🟢' : healthCheck.status === 'warning' ? '🟡' : '🔴';
    const lines = [
      statusEmoji + ' *Rapport systeme quotidien*',
      '',
      '*Ressources :*',
      'RAM : ' + snapshot.ram.usagePercent + '% (' + snapshot.ram.usedMB + '/' + snapshot.ram.totalMB + ' MB)',
      'Disque : ' + snapshot.disk.usagePercent + '% (' + snapshot.disk.usedGB + '/' + snapshot.disk.totalGB + ')',
      'CPU load : ' + snapshot.cpu.loadAvg1m + ' (' + snapshot.cpu.cores + ' cores)',
      'Uptime : ' + snapshot.uptime.processHuman,
      ''
    ];

    const usageEntries = Object.entries(skillMetrics.usage || {});
    if (usageEntries.length > 0) {
      lines.push('*Skills actives :*');
      const sorted = usageEntries.sort((a, b) => (b[1].today || 0) - (a[1].today || 0));
      for (const [name, data] of sorted.slice(0, 5)) {
        lines.push('- ' + name + ' : ' + (data.today || 0) + ' msg');
      }
      lines.push('');
    }

    if (activeAlerts.length > 0) {
      lines.push('*Alertes (' + activeAlerts.length + ') :*');
      for (const a of activeAlerts) {
        lines.push('- [' + a.level + '] ' + a.message);
      }
    } else {
      lines.push('Aucune alerte active.');
    }

    return lines.join('\n');
  }

  // --- Rapport hebdomadaire ---

  async generateWeeklyReport(weeklyAggregates, skillMetrics, alertHistory) {
    if (!this.claudeKey) return this._fallbackWeeklyReport(weeklyAggregates, skillMetrics, alertHistory);

    const usageStr = Object.entries(skillMetrics.usage || {})
      .map(([k, v]) => '- ' + k + ' : ' + (v.week || 0) + ' messages cette semaine, ' + (v.total || 0) + ' total')
      .join('\n') || 'Aucune donnee';

    const rtStr = Object.entries(skillMetrics.responseTimes || {})
      .map(([k, v]) => '- ' + k + ' : moy ' + (v.avg || 0) + 'ms, min ' + (v.min === Infinity ? 'N/A' : v.min + 'ms') + ', max ' + (v.max || 0) + 'ms')
      .join('\n') || 'Aucune donnee';

    const errStr = Object.entries(skillMetrics.errors || {})
      .filter(([k, v]) => v.week > 0)
      .map(([k, v]) => '- ' + k + ' : ' + v.week + ' erreurs')
      .join('\n') || 'Aucune erreur';

    const alertCount = (alertHistory || []).filter(a => {
      const d = new Date(a.sentAt || a.createdAt);
      return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
    }).length;

    const dataStr = `AGREGATS HEBDO :
${weeklyAggregates ? 'RAM moy: ' + (weeklyAggregates.ram?.avgPercent || '?') + '%, max: ' + (weeklyAggregates.ram?.maxPercent || '?') + '%' : 'Pas d\'agregats'}
${weeklyAggregates?.heap ? 'Heap moy: ' + weeklyAggregates.heap.avgMB + 'MB, max: ' + weeklyAggregates.heap.maxMB + 'MB' : ''}

UTILISATION SKILLS :
${usageStr}

TEMPS DE REPONSE :
${rtStr}

ERREURS :
${errStr}

ALERTES CETTE SEMAINE : ${alertCount}`;

    const systemPrompt = `Tu es un ingenieur DevOps. Genere un rapport hebdomadaire de iFIND en francais.

REGLES :
- Format Telegram Markdown
- Identifie les tendances (RAM en hausse/baisse, skills de plus en plus utilisees)
- Compare les performances des skills
- Signale les anomalies
- Recommandations concretes si necessaire
- Max 20 lignes, concis et actionnable`;

    try {
      const breaker = getBreaker('claude-sonnet', { failureThreshold: 3, cooldownMs: 60000 });
      const response = await breaker.call(() => retryAsync(() => this.callClaude(
        [{ role: 'user', content: dataStr }],
        systemPrompt,
        1500
      ), 2, 3000));
      return response;
    } catch (e) {
      log.error('system-advisor', 'Erreur rapport hebdo Claude:', e.message);
      return this._fallbackWeeklyReport(weeklyAggregates, skillMetrics, alertHistory);
    }
  }

  _fallbackWeeklyReport(aggregates, skillMetrics, alertHistory) {
    const lines = [
      '*Rapport hebdomadaire systeme*',
      ''
    ];

    if (aggregates) {
      lines.push('*Ressources (moyennes) :*');
      if (aggregates.ram) lines.push('RAM : ' + aggregates.ram.avgPercent + '% (max ' + aggregates.ram.maxPercent + '%)');
      if (aggregates.heap) lines.push('Heap : ' + aggregates.heap.avgMB + 'MB (max ' + aggregates.heap.maxMB + 'MB)');
      lines.push('');
    }

    const usageEntries = Object.entries(skillMetrics.usage || {});
    if (usageEntries.length > 0) {
      lines.push('*Top skills :*');
      const sorted = usageEntries.sort((a, b) => (b[1].week || 0) - (a[1].week || 0));
      for (const [name, data] of sorted.slice(0, 5)) {
        lines.push('- ' + name + ' : ' + (data.week || 0) + ' msg');
      }
    }

    return lines.join('\n');
  }

  // --- Formatage d'alertes ---

  generateAlertMessage(alert) {
    const levelEmojis = { info: 'ℹ️', warning: '⚠️', critical: '🔴' };
    const emoji = levelEmojis[alert.level] || '⚠️';

    return emoji + ' *ALERTE SYSTEME*\n\n' +
      '*Type :* ' + alert.type + '\n' +
      '*Niveau :* ' + alert.level + '\n' +
      '*Detail :* ' + alert.message + '\n' +
      (alert.value ? '*Valeur :* ' + alert.value + '\n' : '') +
      (alert.threshold ? '*Seuil :* ' + alert.threshold + '\n' : '') +
      '_' + new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) + '_';
  }
}

module.exports = ReportGenerator;
