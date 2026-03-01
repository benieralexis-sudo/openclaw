// Client Registry — CRUD multi-tenant clients
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const log = require('../gateway/logger.js');

const CLIENTS_FILE = path.join(process.env.DASHBOARD_DATA_DIR || '/data/dashboard', 'clients.json');
// Inside container: /clients = bind-mounted ./clients on host
const CLIENTS_DIR = process.env.CLIENTS_DIR || '/clients';
const COMPOSE_CLIENTS_FILE = path.join(CLIENTS_DIR, 'docker-compose.clients.yml');

// Skills data directories (must match telegram-router volumes)
const SKILL_DIRS = [
  'flowfast', 'automailer', 'crm-pilot', 'lead-enrich', 'invoice-bot',
  'proactive-agent', 'self-improve', 'web-intelligence', 'system-advisor',
  'autonomous-pilot', 'inbox-manager', 'meeting-scheduler', 'app-config', 'visitors'
];

const SKILL_DB_FILES = {
  'flowfast': 'flowfast-db.json',
  'automailer': 'automailer-db.json',
  'crm-pilot': 'crm-pilot-db.json',
  'lead-enrich': 'lead-enrich-db.json',
  'invoice-bot': 'invoice-bot-db.json',
  'proactive-agent': 'proactive-agent-db.json',
  'self-improve': 'self-improve-db.json',
  'web-intelligence': 'web-intelligence.json',
  'system-advisor': 'system-advisor.json',
  'autonomous-pilot': 'autonomous-pilot.json',
  'inbox-manager': 'inbox-manager-db.json',
  'meeting-scheduler': 'meeting-scheduler-db.json'
};

// In-memory cache
let _clients = null;
let _loadedAt = 0;
const CACHE_TTL = 5000; // 5s

// --- Load / Save ---

function loadClients() {
  if (_clients && (Date.now() - _loadedAt) < CACHE_TTL) return _clients;
  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      const raw = fs.readFileSync(CLIENTS_FILE, 'utf8');
      _clients = JSON.parse(raw);
    } else {
      _clients = {};
    }
  } catch (e) {
    log.error('client-registry', 'Erreur lecture clients.json:', e.message);
    _clients = {};
  }
  _loadedAt = Date.now();
  return _clients;
}

function saveClients(clients) {
  _clients = clients;
  _loadedAt = Date.now();
  try {
    const dir = path.dirname(CLIENTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = CLIENTS_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(clients, null, 2), 'utf8');
    fs.renameSync(tmp, CLIENTS_FILE);
  } catch (e) {
    log.error('client-registry', 'Erreur sauvegarde clients.json:', e.message);
  }
}

// --- CRUD ---

function getClient(clientId) {
  const clients = loadClients();
  return clients[clientId] || null;
}

function listClients() {
  const clients = loadClients();
  return Object.values(clients).filter(c => c.status !== 'deleted');
}

function createClient(data) {
  const clients = loadClients();

  // Generate slug from name
  const id = data.id || data.name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);

  if (clients[id]) {
    throw new Error('Client "' + id + '" existe deja');
  }

  const client = {
    id: id,
    name: data.name,
    plan: data.plan || 'pilot',
    status: 'active',
    routerService: 'router-' + id,
    dataDir: path.join(CLIENTS_DIR, id, 'data'),
    config: {
      senderEmail: data.senderEmail || '',
      senderName: data.senderName || '',
      senderFullName: data.senderFullName || '',
      senderTitle: data.senderTitle || 'Fondateur',
      clientDomain: data.clientDomain || '',
      clientDescription: data.clientDescription || '',
      clientWebsite: data.clientWebsite || '',
      replyToEmail: data.replyToEmail || data.senderEmail || '',
      trackingDomain: data.trackingDomain || data.clientDomain || '',
      telegramBotToken: data.telegramBotToken || '',
      adminChatId: data.adminChatId || '',
      hubspotApiKey: data.hubspotApiKey || '',
      apolloApiKey: data.apolloApiKey || '',
      fullenrichApiKey: data.fullenrichApiKey || '',
      claudeApiKey: data.claudeApiKey || '',
      openaiApiKey: data.openaiApiKey || '',
      resendApiKey: data.resendApiKey || '',
      gmailMailboxes: data.gmailMailboxes || '',
      calcomApiKey: data.calcomApiKey || '',
      calcomUsername: data.calcomUsername || '',
      imapHost: data.imapHost || '',
      imapUser: data.imapUser || '',
      imapPass: data.imapPass || '',
      dailyBudget: data.dailyBudget || 5
    },
    onboarding: {
      completed: false,
      steps: {
        company: null,
        icp: null,
        tone: null,
        integrations: null
      }
    },
    icp: {
      industries: [],
      titles: [],
      seniorities: [],
      companySizes: [],
      geography: []
    },
    tone: {
      formality: 'decontracte',
      valueProposition: '',
      forbiddenWords: []
    },
    notificationPrefs: {
      draftPending: true,
      hotLead: true,
      campaignMilestone: true
    },
    pushSubscriptions: [],
    createdAt: new Date().toISOString()
  };

  // Create data directories
  _ensureClientDirs(id);

  // Generate .env file
  generateClientEnv(id, client.config);

  clients[id] = client;
  saveClients(clients);

  log.info('client-registry', 'Client cree: ' + id + ' (' + client.name + ')');
  return client;
}

function updateClient(clientId, updates) {
  const clients = loadClients();
  if (!clients[clientId]) throw new Error('Client "' + clientId + '" introuvable');

  const client = clients[clientId];

  // Merge top-level fields
  if (updates.name) client.name = updates.name;
  if (updates.plan) client.plan = updates.plan;
  if (updates.status) client.status = updates.status;

  // Merge config
  if (updates.config) {
    client.config = { ...client.config, ...updates.config };
    generateClientEnv(clientId, client.config);
  }

  // Merge onboarding
  if (updates.onboarding) {
    if (updates.onboarding.steps) {
      client.onboarding.steps = { ...client.onboarding.steps, ...updates.onboarding.steps };
    }
    if (updates.onboarding.completed !== undefined) {
      client.onboarding.completed = updates.onboarding.completed;
    }
  }

  // Merge ICP
  if (updates.icp) client.icp = { ...client.icp, ...updates.icp };

  // Merge tone
  if (updates.tone) client.tone = { ...client.tone, ...updates.tone };

  // Merge notification prefs
  if (updates.notificationPrefs) {
    client.notificationPrefs = { ...client.notificationPrefs, ...updates.notificationPrefs };
  }

  // Push subscriptions
  if (updates.pushSubscriptions) client.pushSubscriptions = updates.pushSubscriptions;

  client.updatedAt = new Date().toISOString();
  clients[clientId] = client;
  saveClients(clients);

  return client;
}

function deleteClient(clientId) {
  const clients = loadClients();
  if (!clients[clientId]) throw new Error('Client "' + clientId + '" introuvable');
  clients[clientId].status = 'deleted';
  clients[clientId].deletedAt = new Date().toISOString();
  saveClients(clients);
  log.info('client-registry', 'Client supprime (soft delete): ' + clientId);
  return clients[clientId];
}

// --- Router URL resolution ---

function getClientRouterUrl(clientId) {
  if (!clientId) return process.env.ROUTER_URL || 'http://telegram-router:9090';
  return 'http://router-' + clientId + ':9090';
}

// --- Data paths resolution ---

function getClientDataPaths(clientId) {
  if (!clientId) return null; // Use default DATA_PATHS
  const baseDir = '/clients/' + clientId + '/data';
  const paths = {};
  for (const [skill, dbFile] of Object.entries(SKILL_DB_FILES)) {
    paths[skill] = path.join(baseDir, skill, dbFile);
  }
  return paths;
}

// --- Client .env generation ---

function generateClientEnv(clientId, config) {
  const envDir = path.join(CLIENTS_DIR, clientId);
  const envFile = path.join(envDir, '.env');

  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
  }

  const lines = [
    '# Auto-generated .env for client: ' + clientId,
    '# Generated at: ' + new Date().toISOString(),
    '',
    '# Telegram',
    'TELEGRAM_BOT_TOKEN=' + (config.telegramBotToken || ''),
    'ADMIN_CHAT_ID=' + (config.adminChatId || ''),
    '',
    '# Email',
    'SENDER_EMAIL=' + (config.senderEmail || ''),
    'SENDER_NAME=' + (config.senderName || ''),
    'SENDER_FULL_NAME=' + (config.senderFullName || ''),
    'SENDER_TITLE=' + (config.senderTitle || 'Fondateur'),
    'REPLY_TO_EMAIL=' + (config.replyToEmail || config.senderEmail || ''),
    'CLIENT_DOMAIN=' + (config.clientDomain || ''),
    'TRACKING_DOMAIN=' + (config.trackingDomain || config.clientDomain || ''),
    'CLIENT_NAME=' + (config.clientName || clientId),
    'CLIENT_DESCRIPTION=' + (config.clientDescription || ''),
    'GMAIL_MAILBOXES=' + (config.gmailMailboxes || ''),
    'GMAIL_SMTP_ENABLED=' + (config.gmailMailboxes ? 'true' : 'false'),
    '',
    '# API Keys',
    'CLAUDE_API_KEY=' + (config.claudeApiKey || process.env.CLAUDE_API_KEY || ''),
    'OPENAI_API_KEY=' + (config.openaiApiKey || process.env.OPENAI_API_KEY || ''),
    'RESEND_API_KEY=' + (config.resendApiKey || ''),
    'APOLLO_API_KEY=' + (config.apolloApiKey || ''),
    'FULLENRICH_API_KEY=' + (config.fullenrichApiKey || ''),
    'HUBSPOT_API_KEY=' + (config.hubspotApiKey || ''),
    '',
    '# Calendar',
    'CALCOM_API_KEY=' + (config.calcomApiKey || ''),
    'CALCOM_USERNAME=' + (config.calcomUsername || ''),
    '',
    '# IMAP',
    'IMAP_HOST=' + (config.imapHost || ''),
    'IMAP_USER=' + (config.imapUser || ''),
    'IMAP_PASS=' + (config.imapPass || ''),
    'IMAP_PORT=993',
    '',
    '# Budget',
    'API_DAILY_BUDGET=' + (config.dailyBudget || 5),
    '',
    '# Data dirs (standard paths inside container)',
    'FLOWFAST_DATA_DIR=/data/flowfast',
    'AUTOMAILER_DATA_DIR=/data/automailer',
    'CRM_PILOT_DATA_DIR=/data/crm-pilot',
    'LEAD_ENRICH_DATA_DIR=/data/lead-enrich',
    'INVOICE_BOT_DATA_DIR=/data/invoice-bot',
    'PROACTIVE_DATA_DIR=/data/proactive-agent',
    'SELF_IMPROVE_DATA_DIR=/data/self-improve',
    'WEB_INTEL_DATA_DIR=/data/web-intelligence',
    'SYSTEM_ADVISOR_DATA_DIR=/data/system-advisor',
    'AUTONOMOUS_PILOT_DATA_DIR=/data/autonomous-pilot',
    'INBOX_MANAGER_DATA_DIR=/data/inbox-manager',
    'MEETING_SCHEDULER_DATA_DIR=/data/meeting-scheduler',
    'APP_CONFIG_DIR=/data/app-config',
    'VISITOR_DATA_DIR=/data/visitors',
    ''
  ];

  fs.writeFileSync(envFile, lines.join('\n'), 'utf8');
  // Restrict permissions
  try { fs.chmodSync(envFile, 0o600); } catch (e) {}

  log.info('client-registry', 'Generated .env for client: ' + clientId);
}

// --- Docker Compose generation ---

function generateDockerCompose() {
  const clients = loadClients();
  const activeClients = Object.values(clients).filter(c => c.status === 'active');

  if (activeClients.length === 0) {
    // Write empty compose file
    if (fs.existsSync(COMPOSE_CLIENTS_FILE)) {
      fs.writeFileSync(COMPOSE_CLIENTS_FILE, 'services: {}\n', 'utf8');
    }
    return;
  }

  const services = {};

  for (const client of activeClients) {
    const svc = client.routerService;
    const dataBase = './clients/' + client.id + '/data';

    // Build volumes list : code RO + data RW
    const volumes = [
      './gateway:/app/gateway:ro',
      './skills:/app/skills:ro'
    ];
    for (const skill of SKILL_DIRS) {
      volumes.push(dataBase + '/' + skill + ':/data/' + skill);
    }

    // Build env from client .env file
    services[svc] = {
      image: '${OPENCLAW_IMAGE:-openclaw:local}',
      user: 'root',
      cap_drop: ['ALL'],
      cap_add: ['CHOWN', 'SETUID', 'SETGID'],
      env_file: './clients/' + client.id + '/.env',
      volumes: volumes,
      init: true,
      restart: 'unless-stopped',
      security_opt: ['no-new-privileges:true'],
      deploy: {
        resources: {
          limits: {
            memory: '512M',
            cpus: '1.0'
          }
        }
      },
      entrypoint: [
        'sh', '-c',
        SKILL_DIRS.map(s => 'mkdir -p /data/' + s).join(' && ') +
        ' && ' + SKILL_DIRS.map(s => 'chown -R node:node /data/' + s).join(' && ') +
        ' && cd /app && (node -e "require(\'mailparser\')" 2>/dev/null || npx pnpm add -w mailparser@3.9.3 --ignore-scripts 2>/dev/null) && exec runuser -u node -- node /app/gateway/telegram-router.js'
      ],
      logging: {
        driver: 'json-file',
        options: { 'max-size': '10m', 'max-file': '3' }
      },
      healthcheck: {
        test: ['CMD', 'node', '-e', "const h=require('http');h.get('http://localhost:9090/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"],
        interval: '30s',
        timeout: '10s',
        retries: 3,
        start_period: '30s'
      }
    };
  }

  // Write YAML manually (avoid yaml dependency)
  const yaml = _serializeComposeYaml(services);
  const tmp = COMPOSE_CLIENTS_FILE + '.tmp';
  fs.writeFileSync(tmp, yaml, 'utf8');
  fs.renameSync(tmp, COMPOSE_CLIENTS_FILE);

  log.info('client-registry', 'Generated docker-compose.clients.yml with ' + activeClients.length + ' service(s)');
}

// Simple YAML serializer for docker-compose services (avoids npm dependency)
function _serializeComposeYaml(services) {
  let yaml = 'services:\n';

  for (const [name, svc] of Object.entries(services)) {
    yaml += '  ' + name + ':\n';
    yaml += '    image: ' + svc.image + '\n';
    yaml += '    user: "' + svc.user + '"\n';

    yaml += '    cap_drop:\n';
    for (const c of svc.cap_drop) yaml += '      - ' + c + '\n';

    yaml += '    cap_add:\n';
    for (const c of svc.cap_add) yaml += '      - ' + c + '\n';

    yaml += '    env_file: ' + svc.env_file + '\n';

    yaml += '    volumes:\n';
    for (const v of svc.volumes) yaml += '      - ' + v + '\n';

    yaml += '    init: true\n';
    yaml += '    restart: ' + svc.restart + '\n';

    yaml += '    security_opt:\n';
    for (const s of svc.security_opt) yaml += '      - ' + s + '\n';

    yaml += '    deploy:\n';
    yaml += '      resources:\n';
    yaml += '        limits:\n';
    yaml += '          memory: ' + svc.deploy.resources.limits.memory + '\n';
    yaml += '          cpus: "' + svc.deploy.resources.limits.cpus + '"\n';

    yaml += '    entrypoint:\n';
    for (const e of svc.entrypoint) yaml += '      - "' + e.replace(/"/g, '\\"') + '"\n';

    yaml += '    logging:\n';
    yaml += '      driver: ' + svc.logging.driver + '\n';
    yaml += '      options:\n';
    for (const [k, v] of Object.entries(svc.logging.options)) {
      yaml += '        ' + k + ': "' + v + '"\n';
    }

    yaml += '    healthcheck:\n';
    yaml += '      test:\n';
    for (const t of svc.healthcheck.test) yaml += '        - "' + t.replace(/"/g, '\\"') + '"\n';
    yaml += '      interval: ' + svc.healthcheck.interval + '\n';
    yaml += '      timeout: ' + svc.healthcheck.timeout + '\n';
    yaml += '      retries: ' + svc.healthcheck.retries + '\n';
    yaml += '      start_period: ' + svc.healthcheck.start_period + '\n';

    yaml += '\n';
  }

  return yaml;
}

// --- Docker operations ---

function restartClientRouter(clientId) {
  return new Promise((resolve, reject) => {
    const client = getClient(clientId);
    if (!client) return reject(new Error('Client introuvable'));
    if (client.status !== 'active') return reject(new Error('Client pas actif'));

    const svc = client.routerService;
    execFile('docker', ['compose', '-f', 'docker-compose.yml', '-f', 'clients/docker-compose.clients.yml', 'restart', svc], {
      cwd: process.env.PROJECT_ROOT || path.resolve(__dirname, '..'),
      timeout: 60000
    }, (err, stdout, stderr) => {
      if (err) {
        log.error('client-registry', 'Restart ' + svc + ' echoue:', err.message);
        return reject(new Error('Restart echoue: ' + (stderr || err.message)));
      }
      log.info('client-registry', 'Restarted ' + svc);
      resolve({ success: true, service: svc });
    });
  });
}

function getClientHealth(clientId) {
  return new Promise((resolve) => {
    const client = getClient(clientId);
    if (!client) return resolve({ healthy: false, error: 'Client introuvable' });

    const routerUrl = getClientRouterUrl(clientId);
    const url = new URL(routerUrl + '/health');

    const req = http.get({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ healthy: res.statusCode === 200, ...parsed });
        } catch (e) {
          resolve({ healthy: res.statusCode === 200, raw: data });
        }
      });
    });
    req.on('error', (e) => {
      resolve({ healthy: false, error: e.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ healthy: false, error: 'Timeout' });
    });
  });
}

// --- Helpers ---

function _ensureClientDirs(clientId) {
  const baseDir = path.join(CLIENTS_DIR, clientId, 'data');
  for (const skill of SKILL_DIRS) {
    const dir = path.join(baseDir, skill);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  log.info('client-registry', 'Created data dirs for client: ' + clientId);
}

const http = require('http');

module.exports = {
  loadClients,
  saveClients,
  getClient,
  listClients,
  createClient,
  updateClient,
  deleteClient,
  getClientRouterUrl,
  getClientDataPaths,
  generateClientEnv,
  generateDockerCompose,
  restartClientRouter,
  getClientHealth,
  SKILL_DB_FILES
};
