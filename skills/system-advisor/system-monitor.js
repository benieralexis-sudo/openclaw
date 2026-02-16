// System Advisor - Collecte metriques systeme et application
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class SystemMonitor {
  constructor() {
    this._lastCpuUsage = process.cpuUsage();
    this._lastCpuTime = Date.now();
  }

  // --- Snapshot systeme complet ---

  collectSystemSnapshot() {
    return {
      timestamp: new Date().toISOString(),
      ram: this._collectRam(),
      cpu: this._collectCpu(),
      disk: this._collectDiskUsage(),
      uptime: this._collectUptime()
    };
  }

  _collectRam() {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;
    const mem = process.memoryUsage();

    return {
      totalMB: Math.round(totalBytes / 1024 / 1024),
      freeMB: Math.round(freeBytes / 1024 / 1024),
      usedMB: Math.round(usedBytes / 1024 / 1024),
      usagePercent: Math.round((usedBytes / totalBytes) * 100),
      process: {
        rssMB: Math.round(mem.rss / 1024 / 1024),
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024)
      }
    };
  }

  _collectCpu() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    // CPU usage du process
    const now = Date.now();
    const currentUsage = process.cpuUsage(this._lastCpuUsage);
    const elapsedMs = now - this._lastCpuTime;
    const userPercent = elapsedMs > 0 ? (currentUsage.user / 1000 / elapsedMs * 100) : 0;
    const systemPercent = elapsedMs > 0 ? (currentUsage.system / 1000 / elapsedMs * 100) : 0;

    this._lastCpuUsage = process.cpuUsage();
    this._lastCpuTime = Date.now();

    return {
      cores: cpus.length,
      model: cpus[0] ? cpus[0].model : 'Inconnu',
      loadAvg1m: loadAvg[0].toFixed(2),
      loadAvg5m: loadAvg[1].toFixed(2),
      loadAvg15m: loadAvg[2].toFixed(2),
      processUserPercent: userPercent.toFixed(1),
      processSystemPercent: systemPercent.toFixed(1)
    };
  }

  _collectDiskUsage() {
    const result = {
      totalGB: 0,
      usedGB: 0,
      availableGB: 0,
      usagePercent: 0,
      bySkill: {}
    };

    // df -h /data
    try {
      const dfOutput = execSync('df -h /data 2>/dev/null || df -h / 2>/dev/null', { timeout: 5000, encoding: 'utf8' });
      const lines = dfOutput.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 5) {
          result.totalGB = parts[1];
          result.usedGB = parts[2];
          result.availableGB = parts[3];
          result.usagePercent = parseInt(parts[4]) || 0;
        }
      }
    } catch (e) {
      console.log('[system-monitor] Erreur df:', e.message);
    }

    // du -sh /data/* pour repartition par skill
    try {
      const duOutput = execSync('du -sh /data/* 2>/dev/null || echo "N/A"', { timeout: 10000, encoding: 'utf8' });
      const lines = duOutput.trim().split('\n');
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && parts[1] !== 'N/A') {
          const skillName = path.basename(parts[1]);
          result.bySkill[skillName] = parts[0];
        }
      }
    } catch (e) {
      console.log('[system-monitor] Erreur du:', e.message);
    }

    return result;
  }

  _collectUptime() {
    const processUp = process.uptime();
    const osUp = os.uptime();

    return {
      processSeconds: Math.round(processUp),
      processHuman: this._formatUptime(processUp),
      osSeconds: Math.round(osUp),
      osHuman: this._formatUptime(osUp)
    };
  }

  _formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(days + 'j');
    if (hours > 0) parts.push(hours + 'h');
    parts.push(minutes + 'm');
    return parts.join(' ');
  }

  // --- Sante des storages de skills ---

  collectSkillStorageHealth() {
    const skills = [
      { name: 'flowfast', file: '/data/flowfast/flowfast-db.json' },
      { name: 'automailer', file: '/data/automailer/automailer-db.json' },
      { name: 'crm-pilot', file: '/data/crm-pilot/crm-pilot-db.json' },
      { name: 'lead-enrich', file: '/data/lead-enrich/lead-enrich-db.json' },
      { name: 'content-gen', file: '/data/content-gen/content-gen-db.json' },
      { name: 'invoice-bot', file: '/data/invoice-bot/invoice-bot-db.json' },
      { name: 'proactive-agent', file: '/data/proactive-agent/proactive-agent-db.json' },
      { name: 'self-improve', file: '/data/self-improve/self-improve-db.json' },
      { name: 'web-intelligence', file: '/data/web-intelligence/web-intelligence.json' }
    ];

    const results = {};
    for (const skill of skills) {
      try {
        if (fs.existsSync(skill.file)) {
          const stat = fs.statSync(skill.file);
          // Verifier que le JSON est valide
          const content = fs.readFileSync(skill.file, 'utf8');
          JSON.parse(content);
          results[skill.name] = {
            exists: true,
            readable: true,
            valid: true,
            sizeKB: Math.round(stat.size / 1024 * 10) / 10,
            lastModified: stat.mtime.toISOString()
          };
        } else {
          results[skill.name] = { exists: false, readable: false, valid: false, sizeKB: 0, lastModified: null };
        }
      } catch (e) {
        results[skill.name] = { exists: true, readable: false, valid: false, sizeKB: 0, error: e.message };
      }
    }
    return results;
  }

  // --- Health Checks complet ---

  runHealthChecks() {
    const checks = [];
    let overallStatus = 'healthy';

    // 1. RAM
    const ram = this._collectRam();
    const ramCheck = {
      name: 'RAM',
      status: 'ok',
      value: ram.usagePercent + '%',
      detail: ram.usedMB + 'MB / ' + ram.totalMB + 'MB'
    };
    if (ram.usagePercent >= 95) { ramCheck.status = 'critical'; overallStatus = 'critical'; }
    else if (ram.usagePercent >= 80) { ramCheck.status = 'warning'; if (overallStatus !== 'critical') overallStatus = 'warning'; }
    checks.push(ramCheck);

    // 2. Disk
    const disk = this._collectDiskUsage();
    const diskCheck = {
      name: 'Disque',
      status: 'ok',
      value: disk.usagePercent + '%',
      detail: disk.usedGB + ' / ' + disk.totalGB
    };
    if (disk.usagePercent >= 95) { diskCheck.status = 'critical'; overallStatus = 'critical'; }
    else if (disk.usagePercent >= 80) { diskCheck.status = 'warning'; if (overallStatus !== 'critical') overallStatus = 'warning'; }
    checks.push(diskCheck);

    // 3. Process memory (heap)
    const heapPercent = ram.process.heapTotalMB > 0
      ? Math.round((ram.process.heapUsedMB / ram.process.heapTotalMB) * 100) : 0;
    checks.push({
      name: 'Heap Node.js',
      status: heapPercent > 90 ? 'warning' : 'ok',
      value: heapPercent + '%',
      detail: ram.process.heapUsedMB + 'MB / ' + ram.process.heapTotalMB + 'MB'
    });

    // 4. Uptime
    const uptime = this._collectUptime();
    checks.push({
      name: 'Uptime',
      status: 'ok',
      value: uptime.processHuman,
      detail: 'Process: ' + uptime.processHuman + ', OS: ' + uptime.osHuman
    });

    // 5. Storage files
    const storageHealth = this.collectSkillStorageHealth();
    let storageIssues = 0;
    for (const skill of Object.keys(storageHealth)) {
      if (!storageHealth[skill].valid) storageIssues++;
    }
    checks.push({
      name: 'Storages',
      status: storageIssues > 0 ? 'warning' : 'ok',
      value: (Object.keys(storageHealth).length - storageIssues) + '/' + Object.keys(storageHealth).length + ' OK',
      detail: storageIssues > 0 ? storageIssues + ' fichier(s) invalide(s)' : 'Tous les fichiers sont valides'
    });

    // 6. CPU load
    const cpu = this._collectCpu();
    const loadPerCore = parseFloat(cpu.loadAvg1m) / cpu.cores;
    checks.push({
      name: 'CPU',
      status: loadPerCore > 2 ? 'warning' : 'ok',
      value: 'Load ' + cpu.loadAvg1m,
      detail: cpu.cores + ' cores, load: ' + cpu.loadAvg1m + '/' + cpu.loadAvg5m + '/' + cpu.loadAvg15m
    });

    if (storageIssues > 0 && overallStatus !== 'critical') overallStatus = 'warning';

    return {
      status: overallStatus,
      checks: checks,
      storageDetails: storageHealth,
      checkedAt: new Date().toISOString()
    };
  }

  // --- Reachabilite des API externes ---

  async checkApiReachability() {
    const apis = [
      { name: 'Telegram', hostname: 'api.telegram.org', path: '/' },
      { name: 'Claude', hostname: 'api.anthropic.com', path: '/' },
      { name: 'OpenAI', hostname: 'api.openai.com', path: '/' }
    ];

    const results = {};
    for (const api of apis) {
      const start = Date.now();
      try {
        await this._httpHead(api.hostname, api.path);
        results[api.name] = { reachable: true, latencyMs: Date.now() - start };
      } catch (e) {
        results[api.name] = { reachable: false, latencyMs: Date.now() - start, error: e.message };
      }
    }
    return results;
  }

  _httpHead(hostname, urlPath) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: hostname,
        path: urlPath,
        method: 'HEAD',
        timeout: 5000
      }, (res) => {
        resolve({ statusCode: res.statusCode });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }

  // --- Metriques du routeur (via global) ---

  collectSkillUsageFromRouter() {
    const metrics = global.__ifindMetrics;
    if (!metrics) return { available: false };
    return {
      available: true,
      usage: metrics.skillUsage || {},
      responseTimes: metrics.responseTimes || {},
      errors: metrics.errors || {}
    };
  }

  // --- Agregation ---

  aggregateSnapshots(snapshots) {
    if (!snapshots || snapshots.length === 0) return null;

    const ramValues = snapshots.map(s => s.ram.usagePercent);
    const diskValues = snapshots.map(s => s.disk.usagePercent).filter(v => v > 0);
    const heapValues = snapshots.map(s => s.ram.process.heapUsedMB);

    return {
      timestamp: new Date().toISOString(),
      period: snapshots.length + ' snapshots',
      ram: {
        avgPercent: Math.round(ramValues.reduce((a, b) => a + b, 0) / ramValues.length),
        minPercent: Math.min(...ramValues),
        maxPercent: Math.max(...ramValues)
      },
      disk: diskValues.length > 0 ? {
        avgPercent: Math.round(diskValues.reduce((a, b) => a + b, 0) / diskValues.length),
        minPercent: Math.min(...diskValues),
        maxPercent: Math.max(...diskValues)
      } : null,
      heap: {
        avgMB: Math.round(heapValues.reduce((a, b) => a + b, 0) / heapValues.length),
        minMB: Math.min(...heapValues),
        maxMB: Math.max(...heapValues)
      }
    };
  }
}

module.exports = SystemMonitor;
