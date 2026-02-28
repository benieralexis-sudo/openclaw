/* ===== Page: Leads (fusion Prospection + Enrichissement + Hot Leads) ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

let _allLeads = [];
let _filters = { score: 'all', source: 'all', hubspot: 'all' };
let _currentPage = 1;
const PER_PAGE = 25;

function getFilteredLeads() {
  let list = _allLeads;
  const q = (document.getElementById('search-leads')?.value || '').toLowerCase();
  if (q) list = list.filter(l =>
    (l.nom || '').toLowerCase().includes(q) ||
    (l.entreprise || '').toLowerCase().includes(q) ||
    (l.email || '').toLowerCase().includes(q)
  );
  if (_filters.score === '8+') list = list.filter(l => (l.score || l.aiClassification?.score || 0) >= 8);
  else if (_filters.score === '6+') list = list.filter(l => (l.score || l.aiClassification?.score || 0) >= 6);
  else if (_filters.score === '<6') list = list.filter(l => (l.score || l.aiClassification?.score || 0) < 6);
  if (_filters.source === 'brain') list = list.filter(l => l.source === 'brain');
  else if (_filters.source === 'search') list = list.filter(l => l.source !== 'brain');
  if (_filters.hubspot === 'oui') list = list.filter(l => l.pushedToHubspot);
  else if (_filters.hubspot === 'non') list = list.filter(l => !l.pushedToHubspot);
  return list;
}

function refreshTable() {
  const filtered = getFilteredLeads();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  if (_currentPage > totalPages) _currentPage = totalPages;
  const start = (_currentPage - 1) * PER_PAGE;
  const pageLeads = filtered.slice(start, start + PER_PAGE);

  const tbody = document.getElementById('leads-tbody');
  if (tbody) {
    tbody.innerHTML = pageLeads.length === 0
      ? '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted)">Aucun lead trouvé</td></tr>'
      : pageLeads.map(l => `
        <tr>
          <td style="color:var(--text-primary);font-weight:500">${e(l.nom || '—')}</td>
          <td>${e(l.entreprise || '—')}</td>
          <td>${e(l.email || '—')}</td>
          <td>${l.score || l.aiClassification?.score ? `<span class="score-badge ${Utils.scoreClass(l.score || l.aiClassification?.score)}">${l.score || l.aiClassification?.score}</span>` : '—'}</td>
          <td><span class="badge ${l.source === 'brain' ? 'badge-purple' : 'badge-blue'}">${l.source === 'brain' ? 'Brain' : 'Search'}</span></td>
          <td>${l.pushedToHubspot ? '<span class="status-dot green"></span>Oui' : '<span class="status-dot red"></span>Non'}</td>
          <td>${Utils.formatDate(l.createdAt)}</td>
        </tr>
      `).join('');
  }

  const countEl = document.getElementById('leads-filtered-count');
  if (countEl) countEl.textContent = filtered.length;

  const pagEl = document.getElementById('leads-pagination');
  if (!pagEl) return;
  if (totalPages <= 1) { pagEl.innerHTML = ''; return; }

  let btns = `<button class="page-btn" data-action="set-leads-page" data-param="${_currentPage - 1}" ${_currentPage <= 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - _currentPage) <= 1) {
      btns += `<button class="page-btn ${i === _currentPage ? 'active' : ''}" data-action="set-leads-page" data-param="${i}">${i}</button>`;
    } else if (i === _currentPage - 2 || i === _currentPage + 2) {
      btns += '<span style="color:var(--text-muted);padding:0 4px">…</span>';
    }
  }
  btns += `<button class="page-btn" data-action="set-leads-page" data-param="${_currentPage + 1}" ${_currentPage >= totalPages ? 'disabled' : ''}>›</button>`;
  pagEl.innerHTML = `<div class="pagination">${btns}</div>`;
}

window._refreshLeadsTable = refreshTable;
window._setLeadsPage = function(p) { _currentPage = p; refreshTable(); };

Pages.leads = async function(container) {
  const [data, enrichData, proactiveData] = await Promise.all([
    API.prospection(),
    API.enrichment(),
    App.userRole === 'admin' ? API.proactive() : Promise.resolve(null)
  ]);
  if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

  const s = data.stats;
  _allLeads = (data.leads || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  _currentPage = 1;
  _filters = { score: 'all', source: 'all', hubspot: 'all' };
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
          <input type="text" placeholder="Rechercher..." id="search-leads">
        </div>
        ${_allLeads.length > 0 ? `<button class="btn-export" data-action="export-leads" title="Exporter CSV">${Utils.icon('download', 14)} CSV</button>` : ''}
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-bar-label">Filtres</div>
      <select class="filter-select" id="filter-score" data-filter="score">
        <option value="all">Score: Tous</option>
        <option value="8+">Score 8+</option>
        <option value="6+">Score 6+</option>
        <option value="<6">Score &lt; 6</option>
      </select>
      <select class="filter-select" id="filter-source" data-filter="source">
        <option value="all">Source: Toutes</option>
        <option value="brain">Brain</option>
        <option value="search">Search</option>
      </select>
      <select class="filter-select" id="filter-hubspot" data-filter="hubspot">
        <option value="all">HubSpot: Tous</option>
        <option value="oui">Poussé</option>
        <option value="non">Non poussé</option>
      </select>
      <span class="filter-count"><span id="leads-filtered-count">${_allLeads.length}</span> / ${_allLeads.length} leads</span>
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
          <span class="badge badge-blue">${_allLeads.length}</span>
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
              <tbody id="leads-tbody"></tbody>
            </table>
          </div>
          <div id="leads-pagination"></div>
        </div>
      </div>
    </div>
  </div>`;

  refreshTable();

  if (data.dailyLeads) {
    const labels = data.dailyLeads.map(d => {
      const date = new Date(d.date);
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    });
    Charts.barChart('chart-leads-daily', labels, data.dailyLeads.map(d => d.count), '#3b82f6', 'Leads');
  }

  document.querySelectorAll('.filter-select[data-filter]').forEach(sel => {
    sel.addEventListener('change', () => {
      _filters[sel.dataset.filter] = sel.value;
      _currentPage = 1;
      refreshTable();
    });
  });
};
}
