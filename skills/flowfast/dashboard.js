// FlowFast Dashboard - Serveur web securise
const http = require('http');
const crypto = require('crypto');
const storage = require('./storage.js');

const PORT = process.env.DASHBOARD_PORT || 3000;
const PASSWORD = process.env.DASHBOARD_PASSWORD || 'flowfast';
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24h

// Sessions actives
const sessions = {};

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession() {
  const id = generateSessionId();
  sessions[id] = { createdAt: Date.now() };
  return id;
}

function isValidSession(sessionId) {
  if (!sessionId || !sessions[sessionId]) return false;
  if (Date.now() - sessions[sessionId].createdAt > SESSION_DURATION) {
    delete sessions[sessionId];
    return false;
  }
  return true;
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return match ? match.split('=')[1] : null;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// --- Page de login ---

function renderLogin(error) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FlowFast - Connexion</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .login-box { background: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 40px; width: 380px; text-align: center; }
  .login-box h1 { font-size: 28px; margin-bottom: 8px; }
  .login-box p { color: #8b949e; margin-bottom: 24px; font-size: 14px; }
  .input-group { margin-bottom: 16px; text-align: left; }
  .input-group label { display: block; font-size: 13px; color: #8b949e; margin-bottom: 6px; }
  .input-group input { width: 100%; padding: 10px 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; color: #e1e4e8; font-size: 15px; outline: none; }
  .input-group input:focus { border-color: #58a6ff; }
  .btn { width: 100%; padding: 12px; background: linear-gradient(135deg, #238636 0%, #2ea043 100%); border: none; border-radius: 8px; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px; }
  .btn:hover { background: linear-gradient(135deg, #2ea043 0%, #3fb950 100%); }
  .error { background: #490202; color: #f85149; padding: 10px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }
</style>
</head>
<body>
<form class="login-box" method="POST" action="/login">
  <h1>FlowFast</h1>
  <p>Connecte-toi pour acceder au dashboard</p>
  ${error ? '<div class="error">' + escapeHtml(error) + '</div>' : ''}
  <div class="input-group">
    <label>Mot de passe</label>
    <input type="password" name="password" placeholder="Mot de passe" autofocus required>
  </div>
  <button type="submit" class="btn">Se connecter</button>
</form>
</body>
</html>`;
}

// --- Dashboard ---

function renderDashboard() {
  const stats = storage.getGlobalStats();
  const searches = storage.getAllSearches().slice(-50).reverse();
  const leads = storage.getAllLeads();
  const users = storage.getAllUsers();

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FlowFast Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; }
  .header { background: linear-gradient(135deg, #1a1e2e 0%, #2d1b4e 100%); padding: 24px 32px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { font-size: 24px; color: #fff; }
  .header p { color: #8b949e; margin-top: 4px; }
  .header .logout { color: #f85149; text-decoration: none; font-size: 13px; padding: 6px 12px; border: 1px solid #f85149; border-radius: 6px; }
  .header .logout:hover { background: #490202; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 20px; }
  .card .value { font-size: 32px; font-weight: 700; color: #58a6ff; }
  .card .label { font-size: 13px; color: #8b949e; margin-top: 4px; }
  .card.green .value { color: #3fb950; }
  .card.orange .value { color: #d29922; }
  .card.red .value { color: #f85149; }
  .card.purple .value { color: #bc8cff; }
  .section { background: #161b22; border: 1px solid #30363d; border-radius: 12px; margin-bottom: 24px; overflow: hidden; }
  .section h2 { padding: 16px 20px; font-size: 16px; border-bottom: 1px solid #30363d; color: #c9d1d9; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 10px 16px; font-size: 12px; color: #8b949e; text-transform: uppercase; border-bottom: 1px solid #30363d; }
  td { padding: 10px 16px; font-size: 13px; border-bottom: 1px solid #21262d; }
  tr:hover { background: #1c2128; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge-green { background: #0d4429; color: #3fb950; }
  .badge-orange { background: #3d2e00; color: #d29922; }
  .badge-red { background: #490202; color: #f85149; }
  .badge-blue { background: #0c2d6b; color: #58a6ff; }
  .score { display: inline-block; width: 32px; height: 32px; line-height: 32px; text-align: center; border-radius: 50%; font-weight: 700; font-size: 13px; }
  .score-high { background: #0d4429; color: #3fb950; }
  .score-mid { background: #3d2e00; color: #d29922; }
  .score-low { background: #490202; color: #f85149; }
  .empty { padding: 40px; text-align: center; color: #484f58; }
  .refresh { float: right; color: #58a6ff; text-decoration: none; font-size: 13px; }
  .refresh:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>FlowFast Dashboard</h1>
    <p>Prospection B2B — Apollo → IA → HubSpot</p>
  </div>
  <a href="/logout" class="logout">Deconnexion</a>
</div>
<div class="container">

  <!-- Stats globales -->
  <div class="grid">
    <div class="card"><div class="value">${stats.totalSearches}</div><div class="label">Recherches</div></div>
    <div class="card green"><div class="value">${stats.totalLeadsFound}</div><div class="label">Leads trouves</div></div>
    <div class="card orange"><div class="value">${stats.totalLeadsQualified}</div><div class="label">Leads qualifies</div></div>
    <div class="card purple"><div class="value">${stats.leadsPushedToHubspot}</div><div class="label">Envoyes HubSpot</div></div>
    <div class="card"><div class="value">${stats.activeUsers}</div><div class="label">Utilisateurs</div></div>
    <div class="card green"><div class="value">${stats.positiveFeedbacks}</div><div class="label">Positifs</div></div>
  </div>

  <!-- Utilisateurs -->
  <div class="section">
    <h2>Utilisateurs <a href="/" class="refresh">Rafraichir</a></h2>
    ${users.length === 0 ? '<div class="empty">Aucun utilisateur</div>' : `
    <table>
      <thead><tr><th>Nom</th><th>Recherches</th><th>Score min</th><th>Derniere activite</th></tr></thead>
      <tbody>${users.map(u => `
        <tr>
          <td><strong>${escapeHtml(u.name || 'Anonyme')}</strong></td>
          <td>${u.searchCount}</td>
          <td>${u.scoreMinimum}/10</td>
          <td>${formatDate(u.lastActiveAt)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`}
  </div>

  <!-- Recherches recentes -->
  <div class="section">
    <h2>Recherches recentes</h2>
    ${searches.length === 0 ? '<div class="empty">Aucune recherche</div>' : `
    <table>
      <thead><tr><th>Date</th><th>Postes</th><th>Lieu</th><th>Trouves</th><th>Qualifies</th><th>HubSpot</th></tr></thead>
      <tbody>${searches.slice(0, 30).map(s => `
        <tr>
          <td>${formatDate(s.createdAt)}</td>
          <td>${escapeHtml((s.params.titles || []).join(', '))}</td>
          <td>${escapeHtml((s.params.locations || []).join(', '))}</td>
          <td>${s.results?.total || 0}</td>
          <td><span class="badge ${(s.results?.qualified || 0) > 0 ? 'badge-green' : 'badge-red'}">${s.results?.qualified || 0}</span></td>
          <td>${s.results?.created || 0}</td>
        </tr>`).join('')}
      </tbody>
    </table>`}
  </div>

  <!-- Leads -->
  <div class="section">
    <h2>Leads (${leads.length} total)</h2>
    ${leads.length === 0 ? '<div class="empty">Aucun lead</div>' : `
    <table>
      <thead><tr><th>Nom</th><th>Poste</th><th>Entreprise</th><th>Score</th><th>HubSpot</th><th>Feedback</th></tr></thead>
      <tbody>${leads.slice(-50).reverse().map(l => {
        const scoreClass = l.score >= 8 ? 'score-high' : l.score >= 6 ? 'score-mid' : 'score-low';
        return `
        <tr>
          <td><strong>${escapeHtml(l.nom)}</strong><br><small>${escapeHtml(l.email)}</small></td>
          <td>${escapeHtml(l.titre)}</td>
          <td>${escapeHtml(l.entreprise)}</td>
          <td><span class="score ${scoreClass}">${l.score}</span></td>
          <td>${l.pushedToHubspot ? '<span class="badge badge-green">Oui</span>' : '<span class="badge badge-orange">Non</span>'}</td>
          <td>${l.feedback === 'positive' ? 'OK' : l.feedback === 'negative' ? 'NON' : '—'}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`}
  </div>

</div>
</body>
</html>`;
}

// --- API ---

function renderAPI(path) {
  if (path === '/api/stats') return JSON.stringify(storage.getGlobalStats());
  if (path === '/api/searches') return JSON.stringify(storage.getAllSearches().slice(-100));
  if (path === '/api/leads') return JSON.stringify(storage.getAllLeads());
  if (path === '/api/users') return JSON.stringify(storage.getAllUsers());
  return null;
}

// --- Parse body POST ---

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10000) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', () => {
      const params = {};
      body.split('&').forEach(pair => {
        const [key, val] = pair.split('=').map(decodeURIComponent);
        if (key) params[key] = val || '';
      });
      resolve(params);
    });
    req.on('error', reject);
  });
}

// --- Serveur ---

const server = http.createServer(async (req, res) => {
  const sessionId = getCookie(req, 'ff_session');
  const authenticated = isValidSession(sessionId);

  // Health check (public)
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // Login POST
  if (req.url === '/login' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (body.password && body.password === PASSWORD) {
        const newSession = createSession();
        res.writeHead(302, {
          'Set-Cookie': 'ff_session=' + newSession + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400',
          'Location': '/'
        });
        res.end();
        console.log('[dashboard] Connexion reussie');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderLogin('Mot de passe incorrect'));
      }
    } catch (e) {
      res.writeHead(400);
      res.end('Bad request');
    }
    return;
  }

  // Logout
  if (req.url === '/logout') {
    if (sessionId) delete sessions[sessionId];
    res.writeHead(302, {
      'Set-Cookie': 'ff_session=; Path=/; HttpOnly; Max-Age=0',
      'Location': '/login'
    });
    res.end();
    return;
  }

  // Login page
  if (req.url === '/login') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderLogin());
    return;
  }

  // Tout le reste necessite une authentification
  if (!authenticated) {
    res.writeHead(302, { 'Location': '/login' });
    res.end();
    return;
  }

  // API JSON (authentifie)
  if (req.url.startsWith('/api/')) {
    const json = renderAPI(req.url);
    if (json) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(json);
      return;
    }
  }

  // Dashboard HTML (authentifie)
  if (req.url === '/' || req.url === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDashboard());
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[dashboard] FlowFast Dashboard securise sur http://0.0.0.0:' + PORT);
});
