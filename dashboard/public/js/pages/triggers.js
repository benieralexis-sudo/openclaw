/* ═══════════════════════════════════════════════════════════════════
 * Page: Triggers FR (Trigger Engine Dashboard)
 * ═══════════════════════════════════════════════════════════════════ */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

Pages.triggers = async function(container) {
  if (App.userRole !== 'admin') {
    container.innerHTML = '<div class="empty-state"><p>Accès réservé aux administrateurs</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1>🎯 Trigger Engine FR</h1>
      <p class="page-subtitle">Moteur de détection signaux d'achat temps réel sur PME françaises</p>
    </div>
    <div id="triggers-content"><div class="empty-state"><p>Chargement...</p></div></div>
  `;

  const content = document.getElementById('triggers-content');

  // Fetch all data in parallel
  const [statsRes, matchesRes, eventsRes, ingestionRes, patternsRes] = await Promise.all([
    fetch('/api/trigger-engine/stats').then(r => r.json()).catch(() => null),
    fetch('/api/trigger-engine/matches?limit=50&min_score=5').then(r => r.json()).catch(() => null),
    fetch('/api/trigger-engine/events?limit=30').then(r => r.json()).catch(() => null),
    fetch('/api/trigger-engine/ingestion-state').then(r => r.json()).catch(() => null),
    fetch('/api/trigger-engine/patterns').then(r => r.json()).catch(() => null)
  ]);

  if (!statsRes || statsRes.enabled === false) {
    content.innerHTML = `
      <div class="card">
        <h2>⚠️ Trigger Engine non initialisé</h2>
        <p>Le Trigger Engine n'est pas encore activé en production. Pour l'activer :</p>
        <ol style="margin-left:1.5em;line-height:1.8">
          <li>Ajouter <code>TRIGGER_ENGINE_ENABLED=true</code> dans <code>/opt/moltbot/.env</code></li>
          <li>Rebuild l'image Docker : <code>docker compose build telegram-router</code></li>
          <li>Restart : <code>docker compose up -d telegram-router</code></li>
          <li>Vérifier les logs : <code>docker compose logs -f telegram-router | grep trigger</code></li>
        </ol>
        <p style="margin-top:1em">Sources par défaut activées : BODACC (6h), JOAFE (12h). France Travail nécessite OAuth2 credentials supplémentaires.</p>
      </div>
    `;
    return;
  }

  const stats = statsRes;
  const matches = (matchesRes && matchesRes.matches) || [];
  const events = (eventsRes && eventsRes.events) || [];
  const ingestion = (ingestionRes && ingestionRes.sources) || [];
  const patterns = (patternsRes && patternsRes.patterns) || [];

  content.innerHTML = `
    <!-- STATS CARDS -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Entreprises cachées</div>
        <div class="stat-value">${stats.companies.toLocaleString('fr-FR')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Events total</div>
        <div class="stat-value">${stats.events_total.toLocaleString('fr-FR')}</div>
        <div class="stat-sub">${stats.events_last_24h} dernières 24h</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Attribution SIREN</div>
        <div class="stat-value">${stats.events_attributed.toLocaleString('fr-FR')}</div>
        <div class="stat-sub">${stats.events_total > 0 ? Math.round(stats.events_attributed / stats.events_total * 100) : 0}% attribués</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Patterns matched actifs</div>
        <div class="stat-value stat-highlight">${stats.matches_active.toLocaleString('fr-FR')}</div>
        <div class="stat-sub">${stats.matches_last_24h} dernières 24h</div>
      </div>
    </div>

    <!-- INGESTION STATE -->
    <div class="card" style="margin-top:1.5em">
      <h2>🔍 Sources</h2>
      ${ingestion.length === 0 ? '<p class="empty-state">Aucune source encore exécutée</p>' :
      `<table class="data-table">
        <thead><tr><th>Source</th><th>Dernier run</th><th>Events</th><th>Erreurs</th><th>Status</th></tr></thead>
        <tbody>
          ${ingestion.map(s => `
            <tr>
              <td><strong>${e(s.source)}</strong></td>
              <td>${s.last_run_at ? new Date(s.last_run_at).toLocaleString('fr-FR') : '—'}</td>
              <td>${s.events_last_run || 0}</td>
              <td>${s.errors_last_run > 0 ? `<span style="color:#dc2626">${s.errors_last_run}</span>` : '0'}</td>
              <td>${s.enabled ? '<span style="color:#16a34a">✓ actif</span>' : '<span style="color:#6b7280">désactivé</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>

    <!-- PATTERNS MATCHED (les leads !) -->
    <div class="card" style="margin-top:1.5em">
      <h2>🎯 Patterns matched (leads candidats)</h2>
      ${matches.length === 0 ? '<p class="empty-state">Aucun match pour le moment. Les matches apparaissent une fois les événements corrélés (15 min après ingestion).</p>' :
      `<table class="data-table">
        <thead><tr><th>Score</th><th>Entreprise</th><th>Pattern</th><th>Signaux</th><th>Matched</th></tr></thead>
        <tbody>
          ${matches.map(m => `
            <tr>
              <td><span class="score-badge score-${m.score >= 9 ? 'red' : m.score >= 7 ? 'orange' : 'yellow'}">${m.score.toFixed(1)}</span></td>
              <td>
                <strong>${e(m.raison_sociale || m.siren)}</strong>
                ${m.naf_label ? `<br><small>${e(m.naf_label)}</small>` : ''}
                ${m.departement ? `<br><small>Dept ${e(m.departement)}</small>` : ''}
              </td>
              <td>${e(m.pattern_name || m.pattern_id)}</td>
              <td>${m.signals.length} event${m.signals.length > 1 ? 's' : ''}</td>
              <td><small>${new Date(m.matched_at).toLocaleString('fr-FR')}</small></td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>

    <!-- RECENT EVENTS -->
    <div class="card" style="margin-top:1.5em">
      <h2>📡 Events récents</h2>
      ${events.length === 0 ? '<p class="empty-state">Aucun event capturé</p>' :
      `<table class="data-table">
        <thead><tr><th>Source</th><th>Type</th><th>Entreprise</th><th>Date</th><th>Attribué ?</th></tr></thead>
        <tbody>
          ${events.slice(0, 30).map(ev => `
            <tr>
              <td><strong>${e(ev.source)}</strong></td>
              <td>${e(ev.event_type)}</td>
              <td>${e(ev.raison_sociale || ev.siren || '—')}</td>
              <td><small>${new Date(ev.captured_at).toLocaleString('fr-FR')}</small></td>
              <td>${ev.siren ? `<span style="color:#16a34a">✓ ${(ev.attribution_confidence * 100).toFixed(0)}%</span>` : '<span style="color:#6b7280">—</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>

    <!-- PATTERNS CATALOG -->
    <div class="card" style="margin-top:1.5em">
      <h2>🧩 Patterns configurés</h2>
      ${patterns.length === 0 ? '<p class="empty-state">Aucun pattern chargé</p>' :
      `<table class="data-table">
        <thead><tr><th>ID</th><th>Nom</th><th>Verticaux</th><th>Min score</th><th>Fenêtre</th></tr></thead>
        <tbody>
          ${patterns.map(p => `
            <tr>
              <td><code>${e(p.id)}</code></td>
              <td>${e(p.name)}</td>
              <td>${(p.verticaux || []).join(', ') || '—'}</td>
              <td>${p.min_score}</td>
              <td>${(p.definition && p.definition.window_days) || 30}j</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>

    <!-- EVENTS BY SOURCE CHART -->
    ${stats.events_by_source && stats.events_by_source.length > 0 ? `
    <div class="card" style="margin-top:1.5em">
      <h2>📊 Events par source (total)</h2>
      <table class="data-table">
        <thead><tr><th>Source</th><th>Count</th><th>Bar</th></tr></thead>
        <tbody>
          ${stats.events_by_source.map(s => {
            const max = Math.max(...stats.events_by_source.map(x => x.n));
            const pct = (s.n / max) * 100;
            return `
            <tr>
              <td><strong>${e(s.source)}</strong></td>
              <td>${s.n.toLocaleString('fr-FR')}</td>
              <td><div style="background:#e5e7eb;height:16px;border-radius:4px;overflow:hidden"><div style="background:#2563EB;height:100%;width:${pct}%"></div></div></td>
            </tr>
          `;}).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}
  `;

  // Inject minimal styles for score badges (if not already in CSS)
  if (!document.getElementById('triggers-page-styles')) {
    const style = document.createElement('style');
    style.id = 'triggers-page-styles';
    style.textContent = `
      .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1em; }
      .stat-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1em; }
      .stat-label { font-size: 0.85em; color: #6b7280; text-transform: uppercase; letter-spacing: 0.03em; }
      .stat-value { font-size: 2em; font-weight: 600; color: #111827; margin-top: 0.25em; }
      .stat-highlight { color: #2563EB; }
      .stat-sub { font-size: 0.8em; color: #6b7280; margin-top: 0.25em; }
      .score-badge { display: inline-block; padding: 0.2em 0.6em; border-radius: 4px; font-weight: 600; font-size: 0.9em; }
      .score-red { background: #fee2e2; color: #dc2626; }
      .score-orange { background: #fed7aa; color: #ea580c; }
      .score-yellow { background: #fef3c7; color: #ca8a04; }
    `;
    document.head.appendChild(style);
  }
};
}
