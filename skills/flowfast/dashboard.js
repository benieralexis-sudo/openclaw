// FlowFast Dashboard - Serveur web
const http = require('http');
const storage = require('./storage.js');

const PORT = process.env.DASHBOARD_PORT || 3000;

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

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
<title>🦀 FlowFast Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; }
  .header { background: linear-gradient(135deg, #1a1e2e 0%, #2d1b4e 100%); padding: 24px 32px; border-bottom: 1px solid #30363d; }
  .header h1 { font-size: 24px; color: #fff; }
  .header p { color: #8b949e; margin-top: 4px; }
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
  <h1>🦀 FlowFast Dashboard</h1>
  <p>Prospection B2B — Apollo → IA → HubSpot</p>
</div>
<div class="container">

  <!-- Stats globales -->
  <div class="grid">
    <div class="card"><div class="value">${stats.totalSearches}</div><div class="label">Recherches</div></div>
    <div class="card green"><div class="value">${stats.totalLeadsFound}</div><div class="label">Leads trouves</div></div>
    <div class="card orange"><div class="value">${stats.totalLeadsQualified}</div><div class="label">Leads qualifies</div></div>
    <div class="card purple"><div class="value">${stats.leadsPushedToHubspot}</div><div class="label">Envoyes HubSpot</div></div>
    <div class="card"><div class="value">${stats.activeUsers}</div><div class="label">Utilisateurs</div></div>
    <div class="card green"><div class="value">${stats.positiveFeedbacks}</div><div class="label">👍 Positifs</div></div>
  </div>

  <!-- Utilisateurs -->
  <div class="section">
    <h2>👥 Utilisateurs <a href="/" class="refresh">↻ Rafraichir</a></h2>
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
    <h2>🔍 Recherches recentes</h2>
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
    <h2>👤 Leads (${leads.length} total)</h2>
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
          <td>${l.feedback === 'positive' ? '👍' : l.feedback === 'negative' ? '👎' : '—'}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`}
  </div>

</div>
</body>
</html>`;
}

function renderAPI(path) {
  if (path === '/api/stats') return JSON.stringify(storage.getGlobalStats());
  if (path === '/api/searches') return JSON.stringify(storage.getAllSearches().slice(-100));
  if (path === '/api/leads') return JSON.stringify(storage.getAllLeads());
  if (path === '/api/users') return JSON.stringify(storage.getAllUsers());
  return null;
}

const server = http.createServer((req, res) => {
  // API JSON
  if (req.url.startsWith('/api/')) {
    const json = renderAPI(req.url);
    if (json) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(json);
      return;
    }
  }

  // Dashboard HTML
  if (req.url === '/' || req.url === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDashboard());
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('📊 Dashboard FlowFast demarre sur http://0.0.0.0:' + PORT);
});
