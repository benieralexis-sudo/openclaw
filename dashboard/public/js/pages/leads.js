/* ===== Page: Leads (fusion Prospection + Enrichissement + Hot Leads) ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

Pages.leads = async function(container) {
  // Charger prospection + enrichment + hot leads en parallèle
  const [data, enrichData, proactiveData] = await Promise.all([
    API.prospection(),
    API.enrichment(),
    App.userRole === 'admin' ? API.proactive() : Promise.resolve(null)
  ]);
  if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

  const s = data.stats;
  const leads = (data.leads || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const hotLeads = (proactiveData?.hotLeads || []).filter(l => (l.opens || 0) >= 3);
  const apollo = enrichData?.apollo || {};
  const creditPercent = apollo.creditsLimit ? Math.round((apollo.creditsUsed / apollo.creditsLimit) * 100) : 0;

  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <h1 class="page-title">${Utils.icon('target')} Leads</h1>
      <div class="page-actions">
        <div class="search-bar">
          ${Utils.icon('search', 16)}
          <input type="text" placeholder="Rechercher un lead..." id="search-leads">
        </div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon blue">${Utils.icon('target')}</div></div>
        <div class="kpi-value" data-count="${s.total}">${s.total}</div>
        <div class="kpi-label">Leads total</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon green">${Utils.icon('check-circle')}</div></div>
        <div class="kpi-value" data-count="${s.qualified}">${s.qualified}</div>
        <div class="kpi-label">Qualifiés (score 6+)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon orange">${Utils.icon('trending-up')}</div></div>
        <div class="kpi-value" data-count="${s.avgScore}">${s.avgScore}</div>
        <div class="kpi-label">Score moyen</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon purple">${Utils.icon('zap')}</div></div>
        <div class="kpi-value">${apollo.creditsUsed || 0} / ${apollo.creditsLimit || 100}</div>
        <div class="kpi-label">Crédits Apollo (${creditPercent}%)</div>
      </div>
    </div>

    ${hotLeads.length > 0 ? `
    <div class="grid-full">
      <div class="card hot-leads-card">
        <div class="card-header">
          <div class="card-title">${Utils.icon('zap', 16)} &nbsp;Hot Leads</div>
          <span class="badge badge-orange">${hotLeads.length}</span>
        </div>
        <div class="card-body">
          ${hotLeads.slice(0, 8).map(l => `
            <div class="hot-lead-item">
              <div class="hot-lead-info">
                <div class="hot-lead-avatar">${e(Utils.initials(l.apolloData?.name || l.email))}</div>
                <div>
                  <div class="hot-lead-name">${e(l.apolloData?.name || l.email)}</div>
                  <div class="hot-lead-company">${e(l.apolloData?.organization?.name || '—')} · ${l.opens || 0} ouvertures</div>
                </div>
              </div>
              <div class="hot-lead-actions">
                ${l.aiClassification?.score ? `<span class="score-badge ${Utils.scoreClass(l.aiClassification.score)}">${l.aiClassification.score}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    ` : ''}

    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Leads par jour</div>
        </div>
        <div class="card-body">
          <div class="chart-container-sm"><canvas id="chart-leads-daily" role="img" aria-label="Graphique leads par jour sur 30 jours"></canvas></div>
        </div>
      </div>
    </div>

    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Tous les leads</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge badge-blue">${leads.length}</span>
            ${leads.length > 0 ? `<button class="btn-export" data-action="export-leads" title="Exporter CSV">${Utils.icon('download', 14)} CSV</button>` : ''}
          </div>
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table" id="leads-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Entreprise</th>
                  <th>Email</th>
                  <th>Score</th>
                  <th>Source</th>
                  <th>HubSpot</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                ${leads.slice(0, App._leadsPageSize || 50).map(l => `
                  <tr class="lead-row" data-search="${e((l.nom || '').toLowerCase())} ${e((l.entreprise || '').toLowerCase())} ${e((l.email || '').toLowerCase())}">
                    <td style="color:var(--text-primary);font-weight:500">${e(l.nom || '—')}</td>
                    <td>${e(l.entreprise || '—')}</td>
                    <td>${e(l.email || '—')}</td>
                    <td>${l.score || l.aiClassification?.score ? `<span class="score-badge ${Utils.scoreClass(l.score || l.aiClassification?.score)}">${l.score || l.aiClassification?.score}</span>` : '—'}</td>
                    <td><span class="badge ${l.source === 'brain' ? 'badge-purple' : 'badge-blue'}">${l.source === 'brain' ? 'Brain' : 'Search'}</span></td>
                    <td>${l.pushedToHubspot ? '<span class="status-dot green"></span>Oui' : '<span class="status-dot red"></span>Non'}</td>
                    <td>${Utils.formatDate(l.createdAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${leads.length > (App._leadsPageSize || 50) ? `<div style="padding:16px;text-align:center"><button class="btn-export" data-action="show-more-leads" style="padding:10px 24px">Voir plus (${leads.length - (App._leadsPageSize || 50)} restants)</button></div>` : ''}
          ${leads.length === 0 ? '<div class="empty-state"><p>Aucun lead trouvé</p></div>' : ''}
        </div>
      </div>
    </div>
  </div>`;

  if (data.dailyLeads) {
    const labels = data.dailyLeads.map(d => {
      const date = new Date(d.date);
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    });
    Charts.barChart('chart-leads-daily', labels, data.dailyLeads.map(d => d.count), '#3b82f6', 'Leads');
  }
};
}
