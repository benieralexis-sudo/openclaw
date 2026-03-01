/* ===== Page: Dashboard ===== */
const _e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

Pages.dashboard = async function(container) {
  const data = await API.overview(App.currentPeriod);
  if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

  const k = data.kpis;
  const cn = _e(data.clientName || 'iFIND');
  App._clientSlug = (data.clientName || 'ifind').toLowerCase().replace(/[^a-z0-9]/g, '-');
  if (data.clientName) document.title = 'Mission Control — ' + cn;

  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <div class="page-greeting">
        <h1>Bonjour${data.ownerName ? ' ' + _e(data.ownerName) : ''}</h1>
        <div class="date">${Utils.todayString()}</div>
      </div>
      <div class="page-actions">
        <div class="period-selector">
          <button class="period-btn ${App.currentPeriod === '1d' ? 'active' : ''}" data-action="set-period" data-param="1d">Aujourd'hui</button>
          <button class="period-btn ${App.currentPeriod === '7d' ? 'active' : ''}" data-action="set-period" data-param="7d">7 jours</button>
          <button class="period-btn ${App.currentPeriod === '30d' ? 'active' : ''}" data-action="set-period" data-param="30d">30 jours</button>
        </div>
      </div>
    </div>

    ${data.appStatus && data.appStatus.mode === 'standby' ? `
    <div class="standby-banner">
      ${cn} est en <strong>mode stand-by</strong> &mdash; crons d&eacute;sactiv&eacute;s, z&eacute;ro consommation automatique. Dis <em>&laquo; active tout &raquo;</em> sur Telegram pour lancer.
    </div>
    ` : data.appStatus && data.appStatus.mode === 'production' ? `
    <div class="production-banner">
      ${cn} en <strong>production</strong> &mdash; ${data.appStatus.cronsActive ? 'crons actifs' : 'crons en pause'}
    </div>
    ` : ''}

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-header">
          <div class="kpi-icon blue">${Utils.icon('target')}</div>
          ${Utils.changeBadge(k.leads.change)}
        </div>
        <div class="kpi-value" data-count="${k.leads.value}">${k.leads.value}</div>
        <div class="kpi-label">Leads trouvés</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header">
          <div class="kpi-icon purple">${Utils.icon('mail')}</div>
          ${Utils.changeBadge(k.emails.change)}
        </div>
        <div class="kpi-value" data-count="${k.emails.value}">${k.emails.value}</div>
        <div class="kpi-label">Emails envoyés</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header">
          <div class="kpi-icon ${k.openRate.value >= 5 ? 'green' : 'orange'}">${Utils.icon('trending-up')}</div>
          ${Utils.changeBadge(k.openRate.change)}
        </div>
        <div class="kpi-value" data-count="${k.openRate.value}" data-percent="true">${k.openRate.value}%</div>
        <div class="kpi-label">Taux d'ouverture</div>
      </div>
      ${App.userRole === 'admin' ? `<div class="kpi-card">
        <div class="kpi-header">
          <div class="kpi-icon green">${Utils.icon('dollar-sign')}</div>
          ${Utils.changeBadge(k.revenue.change)}
        </div>
        <div class="kpi-value" data-count="${k.revenue.value}" data-currency="true">${Utils.formatCurrency(k.revenue.value)}</div>
        <div class="kpi-label">Revenus encaissés</div>
      </div>` : `<div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon green">${Utils.icon('message-circle')}</div></div>
        <div class="kpi-value" data-count="${data.hotLeads.length}">${data.hotLeads.length}</div>
        <div class="kpi-label">Leads chauds</div>
      </div>`}
    </div>

    ${data.hotLeads.length > 0 ? `
    <div class="grid-full">
      <div class="card hot-leads-card">
        <div class="card-header">
          <div class="card-title">${Utils.icon('zap', 16)} &nbsp;Leads Chauds</div>
          <span class="badge badge-orange">${data.hotLeads.length} leads</span>
        </div>
        <div class="card-body">
          ${data.hotLeads.map(l => `
            <div class="hot-lead-item">
              <div class="hot-lead-info">
                <div class="hot-lead-avatar">${_e(Utils.initials(l.apolloData?.name || l.email))}</div>
                <div>
                  <div class="hot-lead-name">${_e(l.apolloData?.name || l.email)}</div>
                  <div class="hot-lead-company">${_e(l.apolloData?.organization?.name || '—')} · ${l.opens || 0} ouvertures</div>
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

    <div class="grid-3">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Activité — ${App.currentPeriod === '1d' ? "aujourd'hui" : App.currentPeriod === '7d' ? '7 jours' : '30 jours'}</div>
        </div>
        <div class="card-body">
          <div class="chart-container">
            <canvas id="chart-overview" role="img" aria-label="Graphique activité 30 jours : leads, emails envoyés, emails ouverts"></canvas>
          </div>
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-header">
            <div class="card-title">${Utils.icon('clock', 16)} &nbsp;Prochaines actions</div>
          </div>
          <div class="card-body">
            ${data.nextActions.length > 0 ? data.nextActions.map(a => `
              <div class="next-action-item">
                <div class="next-action-label">${_e(a.label)}</div>
                <div class="next-action-time">${_e(a.time)}</div>
              </div>
            `).join('') : '<p style="color:var(--text-muted);font-size:13px">Aucune action programmée</p>'}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">${Utils.icon('activity', 16)} &nbsp;Fil d'activité</div>
          </div>
          <div class="card-body" style="max-height:320px;overflow-y:auto">
            ${data.feed.length > 0 ? `
              <ul class="feed-list">
                ${data.feed.map(f => `
                  <li class="feed-item">
                    <div class="feed-dot ${f.skill}"></div>
                    <div>
                      <div class="feed-text">${_e(f.text)}</div>
                      <div class="feed-time">${Utils.timeAgo(f.time)}</div>
                    </div>
                  </li>
                `).join('')}
              </ul>
            ` : '<p style="color:var(--text-muted);font-size:13px">Aucune activité récente</p>'}
          </div>
        </div>
      </div>
    </div>
  </div>`;

  if (data.chartData) {
    Charts.overviewLine('chart-overview', data.chartData);
  }
};
