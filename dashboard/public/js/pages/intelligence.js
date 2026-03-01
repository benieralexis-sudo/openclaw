/* ===== Page: Intelligence (3 onglets) ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

Pages.intelligence = async function(container) {
  if (App.userRole !== 'admin') {
    container.innerHTML = '<div class="empty-state"><p>Accès réservé aux administrateurs</p></div>';
    return;
  }

  const tab = App._intelTab || 'alerts';

  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <h1 class="page-title">${Utils.icon('brain')} Intelligence</h1>
    </div>
    <div class="tab-bar">
      <button class="tab-btn ${tab === 'alerts' ? 'active' : ''}" data-action="set-intel-tab" data-param="alerts">${Utils.icon('bell', 14)} Alertes</button>
      <button class="tab-btn ${tab === 'web-intel' ? 'active' : ''}" data-action="set-intel-tab" data-param="web-intel">${Utils.icon('globe', 14)} Veille Web</button>
      <button class="tab-btn ${tab === 'optimization' ? 'active' : ''}" data-action="set-intel-tab" data-param="optimization">${Utils.icon('trending-up', 14)} Optimisation</button>
    </div>
    <div id="intel-content"></div>
  </div>`;

  const content = document.getElementById('intel-content');

  if (tab === 'alerts') {
    await renderAlerts(content);
  } else if (tab === 'web-intel') {
    await renderWebIntel(content);
  } else {
    await renderOptimization(content);
  }

  App.animateCountUps();
};

// ===== Onglet Alertes (ex-Proactive) =====
async function renderAlerts(content) {
  const data = await API.proactive();
  if (!data) { content.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>'; return; }

  const config = data.config || {};
  const stats = data.stats || {};
  const alerts = (data.alerts || []).reverse();
  const hotLeads = (data.hotLeads || []).filter(l => (l.opens || 0) >= 3);

  content.innerHTML = `
    <div class="kpi-grid" style="margin-top:20px">
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon red">${Utils.icon('bell')}</div></div>
        <div class="kpi-value" data-count="${stats.totalAlertsSent || 0}">${stats.totalAlertsSent || 0}</div>
        <div class="kpi-label">Alertes envoyées</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon blue">${Utils.icon('file-text')}</div></div>
        <div class="kpi-value" data-count="${stats.totalReportsSent || 0}">${stats.totalReportsSent || 0}</div>
        <div class="kpi-label">Rapports générés</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon orange">${Utils.icon('zap')}</div></div>
        <div class="kpi-value" data-count="${hotLeads.length}">${hotLeads.length}</div>
        <div class="kpi-label">Hot leads détectés</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon green">${Utils.icon('clock')}</div></div>
        <div class="kpi-value" style="font-size:16px">${stats.lastMorningReport ? Utils.formatDateTime(stats.lastMorningReport) : '—'}</div>
        <div class="kpi-label">Dernier rapport</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Prochains crons</div></div>
        <div class="card-body">
          ${buildCronList(config.alerts || {})}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Hot leads</div></div>
        <div class="card-body">
          ${hotLeads.length > 0 ? hotLeads.slice(0, 10).map(l => `
            <div class="stat-row">
              <span class="stat-label">${e(l.email)}</span>
              <span class="stat-value">${l.opens || 0} ouvertures</span>
            </div>
          `).join('') : '<p style="color:var(--text-muted);font-size:13px">Aucun hot lead</p>'}
        </div>
      </div>
    </div>

    <div class="grid-full">
      <div class="card">
        <div class="card-header"><div class="card-title">Dernières alertes</div></div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Type</th><th>Message</th><th>Date</th></tr></thead>
              <tbody>
                ${alerts.slice(0, 20).map(a => `
                  <tr>
                    <td><span class="badge badge-blue">${a.type || '—'}</span></td>
                    <td>${e(Utils.truncate(a.message, 80))}</td>
                    <td>${Utils.formatDateTime(a.sentAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${alerts.length === 0 ? '<div class="empty-state"><p>Aucune alerte</p></div>' : ''}
        </div>
      </div>
    </div>

    ${data.briefing ? `
    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Dernier briefing nocturne</div>
          <span style="font-size:12px;color:var(--text-muted)">${Utils.formatDateTime(data.briefing.generatedAt)}</span>
        </div>
        <div class="card-body">
          <div class="content-preview">${e(data.briefing.text || 'Aucun briefing')}</div>
        </div>
      </div>
    </div>
    ` : ''}`;
}

// ===== Onglet Veille Web (ex-Web Intel) =====
async function renderWebIntel(content) {
  const data = await API.webIntel();
  if (!data) { content.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>'; return; }

  const stats = data.stats || {};
  const watches = data.watches || [];
  const articles = data.articles || [];
  const analyses = data.analyses || [];
  const typeLabels = { prospect: 'Prospect', competitor: 'Concurrent', sector: 'Secteur' };
  const typeColors = { prospect: 'blue', competitor: 'red', sector: 'indigo' };

  content.innerHTML = `
    <div class="kpi-grid" style="margin-top:20px">
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon indigo">${Utils.icon('globe')}</div></div>
        <div class="kpi-value" data-count="${watches.length}">${watches.length}</div>
        <div class="kpi-label">Veilles actives</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon blue">${Utils.icon('file-text')}</div></div>
        <div class="kpi-value" data-count="${stats.totalArticlesFetched || articles.length}">${stats.totalArticlesFetched || articles.length}</div>
        <div class="kpi-label">Articles collectés</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon purple">${Utils.icon('activity')}</div></div>
        <div class="kpi-value" data-count="${stats.totalAnalysesGenerated || analyses.length}">${stats.totalAnalysesGenerated || analyses.length}</div>
        <div class="kpi-label">Analyses générées</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon orange">${Utils.icon('bell')}</div></div>
        <div class="kpi-value" data-count="${stats.totalAlertsSent || 0}">${stats.totalAlertsSent || 0}</div>
        <div class="kpi-label">Alertes urgentes</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Veilles configurées</div></div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Nom</th><th>Type</th><th>Mots-clés</th><th>Articles</th><th>Dernier scan</th></tr></thead>
              <tbody>
                ${watches.map(w => `
                  <tr>
                    <td style="color:var(--text-primary);font-weight:500">${e(w.name)}</td>
                    <td><span class="badge badge-${typeColors[w.type] || 'gray'}">${typeLabels[w.type] || e(w.type)}</span></td>
                    <td>${e((w.keywords || []).slice(0, 3).join(', '))}</td>
                    <td>${w.articleCount || 0}</td>
                    <td>${Utils.timeAgo(w.lastCheckedAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${watches.length === 0 ? '<div class="empty-state"><p>Aucune veille configurée</p></div>' : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title">Derniers digests</div></div>
        <div class="card-body">
          ${analyses.slice(-5).reverse().map(a => `
            <div class="stat-row" style="flex-direction:column;align-items:flex-start;gap:4px">
              <span class="stat-label">${Utils.formatDateTime(a.generatedAt)}</span>
              <div class="content-preview" style="width:100%;max-height:80px">${e(Utils.truncate(a.content, 200))}</div>
            </div>
          `).join('')}
          ${analyses.length === 0 ? '<p style="color:var(--text-muted);font-size:13px">Les digests apparaîtront ici quand la veille web sera active</p>' : ''}
        </div>
      </div>
    </div>

    <div class="grid-full">
      <div class="card">
        <div class="card-header"><div class="card-title">Articles récents</div></div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Titre</th><th>Source</th><th>Pertinence</th><th>Urgent</th><th>Date</th></tr></thead>
              <tbody>
                ${articles.slice(0, 25).map(a => `
                  <tr>
                    <td style="color:var(--text-primary);font-weight:500;white-space:normal;max-width:300px">${a.url ? `<a href="${e(a.url)}" target="_blank" rel="noopener" style="color:var(--text-primary);text-decoration:underline">${e(Utils.truncate(a.title, 60))}</a>` : e(Utils.truncate(a.title, 60))}</td>
                    <td>${a.source ? (a.sourceUrl ? `<a href="${e(a.sourceUrl)}" target="_blank" rel="noopener" style="color:var(--accent-blue)">${e(a.source)}</a>` : e(a.source)) : '—'}</td>
                    <td>${a.relevanceScore ? `<span class="score-badge ${Utils.scoreClass(a.relevanceScore)}">${a.relevanceScore}</span>` : '—'}</td>
                    <td>${a.isUrgent ? '<span class="status-dot orange"></span>Oui' : '—'}</td>
                    <td>${Utils.formatDate(a.fetchedAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${articles.length === 0 ? '<div class="empty-state"><p>Aucun article</p></div>' : ''}
        </div>
      </div>
    </div>`;
}

// ===== Onglet Optimisation (ex-Self-Improve) =====
async function renderOptimization(content) {
  const data = await API.selfImprove();
  if (!data) { content.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>'; return; }

  const stats = data.stats || {};
  const pending = data.pendingRecommendations || [];
  const applied = data.appliedRecommendations || [];
  const accuracy = data.accuracyHistory || [];
  const lastAccuracy = accuracy.length > 0 ? accuracy[accuracy.length - 1].accuracy : null;

  content.innerHTML = `
    <div class="kpi-grid" style="margin-top:20px">
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon teal">${Utils.icon('activity')}</div></div>
        <div class="kpi-value" data-count="${stats.totalAnalyses || 0}">${stats.totalAnalyses || 0}</div>
        <div class="kpi-label">Analyses effectuées</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon green">${Utils.icon('check-circle')}</div></div>
        <div class="kpi-value" data-count="${stats.totalApplied || 0}">${stats.totalApplied || 0}</div>
        <div class="kpi-label">Recommandations appliquées</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon orange">${Utils.icon('clock')}</div></div>
        <div class="kpi-value" data-count="${pending.length}">${pending.length}</div>
        <div class="kpi-label">En attente</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon blue">${Utils.icon('trending-up')}</div></div>
        <div class="kpi-value" data-count="${lastAccuracy || 0}" data-percent="true">${lastAccuracy != null ? lastAccuracy + '%' : '—'}</div>
        <div class="kpi-label">Précision prédictions</div>
      </div>
    </div>

    ${lastAccuracy != null ? `
    <div class="grid-full">
      <div class="card">
        <div class="card-header"><div class="card-title">Score de santé</div></div>
        <div class="card-body" style="display:flex;align-items:center;justify-content:center;padding:32px">
          <div class="gauge-container">
            <div class="gauge-wrapper">
              <canvas id="chart-health-score" width="120" height="120" role="img" aria-label="Jauge score de santé système"></canvas>
              <div class="gauge-value">${lastAccuracy}%</div>
            </div>
            <div class="gauge-label">Précision globale</div>
          </div>
        </div>
      </div>
    </div>
    ` : ''}

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Recommandations en attente</div>
          <span class="badge badge-orange">${pending.length}</span>
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Titre</th><th>Skill cible</th><th>Priorité</th><th>Date</th></tr></thead>
              <tbody>
                ${pending.map(r => `
                  <tr>
                    <td style="color:var(--text-primary);font-weight:500" title="${e(r.description || r.reason || '')}">${e(r.title)}</td>
                    <td>${e(r.targetSkill || '—')}</td>
                    <td><span class="badge badge-${r.priority === 'high' ? 'red' : r.priority === 'medium' ? 'orange' : 'gray'}">${e(r.priority || 'normal')}</span></td>
                    <td>${Utils.formatDate(r.createdAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${pending.length === 0 ? '<div class="empty-state"><p>Aucune recommandation en attente</p></div>' : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Historique des changements</div>
          <span class="badge badge-green">${applied.length}</span>
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Titre</th><th>Statut</th><th>Date</th></tr></thead>
              <tbody>
                ${applied.slice(-15).reverse().map(r => `
                  <tr>
                    <td style="color:var(--text-primary)">${e(r.title)}</td>
                    <td>${Utils.statusBadge(r.status)}</td>
                    <td>${Utils.formatDate(r.appliedAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${applied.length === 0 ? '<div class="empty-state"><p>Aucun changement appliqué</p></div>' : ''}
        </div>
      </div>
    </div>`;

  if (lastAccuracy != null) {
    const color = lastAccuracy >= 70 ? '#22c55e' : lastAccuracy >= 40 ? '#f59e0b' : '#ef4444';
    Charts.doughnutChart('chart-health-score', lastAccuracy, 100, color);
  }
}
}
