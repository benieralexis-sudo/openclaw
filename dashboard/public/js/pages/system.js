/* ===== Page: Système ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

Pages.system = async function(container) {
  if (App.userRole !== 'admin') {
    container.innerHTML = '<div class="empty-state"><p>Accès réservé aux administrateurs</p></div>';
    return;
  }

  const data = await API.system();
  if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

  const snap = data.lastSnapshot || {};
  const stats = data.stats || {};
  const activeAlerts = data.activeAlerts || [];
  const errors = data.errors || {};
  const usage = data.skillUsage || {};
  const responseTimes = data.responseTimes || {};
  const lastHealth = data.lastHealthCheck;
  const recentSnapshots = data.recentSnapshots || [];

  const ramPct = snap.ram?.percent || 0;
  const cpuPct = snap.cpu?.percent || 0;
  const diskPct = snap.disk?.percent || 0;

  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <h1 class="page-title">${Utils.icon('settings')} Système</h1>
      ${lastHealth ? `<span style="font-size:13px">${Utils.statusBadge(lastHealth.status || 'ok')}</span>` : ''}
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-header">
          <div class="kpi-icon ${ramPct > 90 ? 'red' : ramPct > 70 ? 'orange' : 'blue'}">${Utils.icon('cpu')}</div>
        </div>
        <div class="kpi-value" data-count="${ramPct}" data-percent="true">${ramPct}%</div>
        <div class="kpi-label">RAM (${snap.ram?.used ? Math.round(snap.ram.used / 1048576) : 0} / ${snap.ram?.total ? Math.round(snap.ram.total / 1048576) : 0} Mo)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header">
          <div class="kpi-icon ${cpuPct > 90 ? 'red' : cpuPct > 70 ? 'orange' : 'green'}">${Utils.icon('activity')}</div>
        </div>
        <div class="kpi-value" data-count="${cpuPct}" data-percent="true">${cpuPct}%</div>
        <div class="kpi-label">CPU</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header">
          <div class="kpi-icon ${diskPct > 90 ? 'red' : diskPct > 70 ? 'orange' : 'green'}">${Utils.icon('hard-drive')}</div>
        </div>
        <div class="kpi-value" data-count="${diskPct}" data-percent="true">${diskPct}%</div>
        <div class="kpi-label">Disque</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon blue">${Utils.icon('clock')}</div></div>
        <div class="kpi-value" style="font-size:18px">${snap.uptime ? formatUptime(snap.uptime) : '—'}</div>
        <div class="kpi-label">Uptime</div>
      </div>
    </div>

    ${activeAlerts.length > 0 ? `
    <div class="grid-full">
      <div class="card" style="border-color:rgba(239,68,68,0.3)">
        <div class="card-header">
          <div class="card-title" style="color:var(--accent-red)">${Utils.icon('alert-triangle', 16)} &nbsp;Alertes actives</div>
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Niveau</th><th>Message</th><th>Valeur</th><th>Seuil</th><th>Date</th></tr></thead>
              <tbody>
                ${activeAlerts.map(a => `
                  <tr>
                    <td>${Utils.statusBadge(a.level)}</td>
                    <td>${e(a.message)}</td>
                    <td>${a.value != null ? a.value + '%' : '—'}</td>
                    <td>${a.threshold != null ? a.threshold + '%' : '—'}</td>
                    <td>${Utils.formatDateTime(a.createdAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    ` : ''}

    <div class="grid-full">
      <div class="card">
        <div class="card-header"><div class="card-title">Métriques système — 24h</div></div>
        <div class="card-body">
          <div class="chart-container"><canvas id="chart-system" role="img" aria-label="Graphique monitoring système : RAM, CPU, disque sur 24h"></canvas></div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Utilisation par skill</div></div>
        <div class="card-body">
          ${Object.entries(usage).map(([skill, u]) => `
            <div class="stat-row">
              <div><span class="stat-label">${e(skill)}</span></div>
              <div style="text-align:right">
                <span class="stat-value">${u.total || 0}</span>
                <span style="font-size:11px;color:var(--text-muted);margin-left:4px">(${u.today || 0} aujourd'hui)</span>
              </div>
            </div>
          `).join('')}
          ${Object.keys(usage).length === 0 ? '<p style="color:var(--text-muted);font-size:13px">Aucune donnée</p>' : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title">Temps de réponse</div></div>
        <div class="card-body">
          ${Object.entries(responseTimes).map(([skill, rt]) => `
            <div class="stat-row">
              <span class="stat-label">${e(skill)}</span>
              <span class="stat-value">${rt.avg ? Math.round(rt.avg) : 0} ms</span>
            </div>
          `).join('')}
          ${Object.keys(responseTimes).length === 0 ? '<p style="color:var(--text-muted);font-size:13px">Aucune donnée</p>' : ''}
        </div>
      </div>
    </div>

    <div class="grid-full">
      <div class="card">
        <div class="card-header"><div class="card-title">Erreurs récentes</div></div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Skill</th><th>Erreur</th><th>Aujourd'hui</th><th>Semaine</th><th>Total</th></tr></thead>
              <tbody>
                ${Object.entries(errors).filter(([, errs]) => errs.total > 0).map(([skill, errs]) => `
                  <tr>
                    <td style="color:var(--text-primary);font-weight:500">${e(skill)}</td>
                    <td style="color:var(--accent-red)">${errs.recentErrors?.[0]?.message ? e(Utils.truncate(errs.recentErrors[0].message, 50)) : '—'}</td>
                    <td>${errs.today || 0}</td>
                    <td>${errs.week || 0}</td>
                    <td>${errs.total || 0}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${Object.entries(errors).filter(([, errs]) => errs.total > 0).length === 0 ? '<div class="empty-state"><p>Aucune erreur</p></div>' : ''}
        </div>
      </div>
    </div>
  </div>`;

  if (recentSnapshots.length > 0) {
    Charts.systemGauges('chart-system', recentSnapshots);
  }
};
}
