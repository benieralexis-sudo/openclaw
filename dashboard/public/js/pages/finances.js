/* ===== Page: Finances (Admin) ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

Pages.finances = async function(container) {
  if (App.userRole !== 'admin') {
    container.innerHTML = '<div class="empty-state"><p>Accès réservé aux administrateurs</p></div>';
    return;
  }

  // Charger les deux sources de données en parallèle
  const [invData, finData] = await Promise.all([API.invoices(), API.finance()]);
  if (!invData && !finData) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

  // Données facturation
  const invStats = invData?.stats || {};
  const invoices = invData?.invoices || [];
  const clients = invData?.clients || [];

  // Données finance
  const t = finData?.today || {};
  const m = finData?.month || {};
  const services = m.services || {};
  const proj = finData?.projections || [];
  const pctBudget = t.limit > 0 ? Math.round((t.spent / t.limit) * 100) : 0;
  const pctClass = pctBudget > 80 ? 'badge-red' : pctBudget > 50 ? 'badge-orange' : 'badge-green';

  // Lignes services
  const svcRows = [
    { key: 'claude', label: 'Claude (Opus/Sonnet)', icon: 'brain', detail: (s) => s.calls + ' appels, ' + ((s.inputTokens || 0) / 1000).toFixed(0) + 'K tokens' },
    { key: 'openai', label: 'OpenAI (GPT-4o-mini)', icon: 'bot', detail: (s) => s.calls + ' appels, ' + ((s.inputTokens || 0) / 1000).toFixed(0) + 'K tokens' },
    { key: 'apollo', label: 'Apollo (Leads)', icon: 'search', detail: (s) => (s.searches || 0) + ' recherches, ' + (s.reveals || 0) + ' reveals' },
    { key: 'fullenrich', label: 'FullEnrich', icon: 'target', detail: (s) => (s.credits || 0) + ' credits utilisés' },
    { key: 'gmail', label: 'Gmail SMTP', icon: 'mail', detail: (s) => (s.emails || 0) + ' emails envoyés' },
    { key: 'resend', label: 'Resend (fallback)', icon: 'mail', detail: (s) => (s.emails || 0) + ' emails envoyés' }
  ];

  const svcHtml = svcRows.map(r => {
    const s = services[r.key] || {};
    const cost = (s.cost || 0).toFixed(4);
    const hasActivity = (s.calls || 0) + (s.credits || 0) + (s.emails || 0) + (s.searches || 0) + (s.reveals || 0) > 0;
    return '<tr' + (hasActivity ? '' : ' style="opacity:0.5"') + '>'
      + '<td>' + Utils.icon(r.icon, 14) + ' ' + e(r.label) + '</td>'
      + '<td style="text-align:right;font-weight:600">$' + cost + '</td>'
      + '<td style="color:var(--text-secondary)">' + r.detail(s) + '</td>'
      + '</tr>';
  }).join('');

  // Coûts fixes
  const fixedCosts = finData?.fixedCosts || {};
  const fixedHtml = Object.values(fixedCosts).map(f =>
    '<tr><td>' + e(f.label) + '</td><td style="text-align:right;font-weight:600">' + f.currency + ' ' + f.amount.toFixed(2) + '/mois</td><td style="color:var(--text-secondary)">Coût fixe</td></tr>'
  ).join('');

  // Projections
  const projHtml = proj.map(p =>
    '<tr><td style="font-weight:600">' + e(p.scale) + '</td>'
    + '<td style="text-align:right">$' + p.emailCost.toFixed(2) + '</td>'
    + '<td style="text-align:right">$' + p.brainCost.toFixed(2) + '</td>'
    + '<td style="text-align:right">$' + p.fixedCost.toFixed(2) + '</td>'
    + '<td style="text-align:right;font-weight:700;color:var(--primary)">$' + p.total.toFixed(2) + '</td></tr>'
  ).join('');

  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <h1 class="page-title">${Utils.icon('dollar-sign')} Finances</h1>
      <div class="page-actions">
        ${finData ? `<span class="badge ${pctClass}" style="padding:6px 12px;font-size:13px">Budget: $${t.spent.toFixed(2)} / $${t.limit.toFixed(2)} (${pctBudget}%)</span>` : ''}
        ${invoices.length > 0 ? `<button class="btn-export" data-action="export-invoices" title="Exporter CSV">${Utils.icon('download', 14)} CSV</button>` : ''}
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon green">${Utils.icon('dollar-sign')}</div></div>
        <div class="kpi-value" data-count="${invStats.paid || 0}" data-currency="true">${Utils.formatCurrency(invStats.paid || 0)}</div>
        <div class="kpi-label">Payé</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon orange">${Utils.icon('clock')}</div></div>
        <div class="kpi-value" data-count="${invStats.pending || 0}" data-currency="true">${Utils.formatCurrency(invStats.pending || 0)}</div>
        <div class="kpi-label">En attente</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon blue">${Utils.icon('bar-chart')}</div></div>
        <div class="kpi-value" data-count="${m.grandTotal || 0}">$${(m.grandTotal || 0).toFixed(2)}</div>
        <div class="kpi-label">Coûts API mois</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon purple">${Utils.icon('mail')}</div></div>
        <div class="kpi-value" data-count="${finData?.totalEmailsSent || 0}">${finData?.totalEmailsSent || 0}</div>
        <div class="kpi-label">Emails ce mois</div>
      </div>
    </div>

    ${finData ? `
    <div class="grid-full">
      <div class="card">
        <div class="card-header"><div class="card-title">Dépenses journalières (30 jours)</div></div>
        <div class="card-body"><canvas id="finance-chart" height="200"></canvas></div>
      </div>
    </div>
    ` : ''}

    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Factures</div>
          <span class="badge badge-green">${invoices.length}</span>
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>N°</th><th>Client</th><th>Montant</th><th>Statut</th><th>Date</th></tr></thead>
              <tbody>
                ${invoices.map(i => {
                  const client = clients.find(c => c.id === i.clientId);
                  return `
                  <tr>
                    <td style="color:var(--text-primary);font-weight:600">${e(i.number || i.id)}</td>
                    <td>${e(client?.name || client?.company || '—')}</td>
                    <td style="font-weight:600">${Utils.formatCurrency(i.total)}</td>
                    <td>${Utils.statusBadge(i.status)}</td>
                    <td>${Utils.formatDate(i.createdAt)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
          ${invoices.length === 0 ? '<div class="empty-state"><p>Aucune facture</p></div>' : ''}
        </div>
      </div>
    </div>

    ${finData ? `
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Détail par service — ${e(m.period || '')}</div></div>
        <div class="card-body">
          <table class="data-table" style="width:100%">
            <thead><tr><th>Service</th><th style="text-align:right">Coût</th><th>Détail</th></tr></thead>
            <tbody>${svcHtml}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Coûts fixes mensuels</div></div>
        <div class="card-body">
          <table class="data-table" style="width:100%">
            <thead><tr><th>Service</th><th style="text-align:right">Montant</th><th>Type</th></tr></thead>
            <tbody>${fixedHtml}</tbody>
          </table>
          <div style="margin-top:16px;padding:12px;background:var(--bg-secondary);border-radius:8px;font-size:13px;color:var(--text-secondary)">
            Total fixe: <strong>$${(m.fixedTotal || 0).toFixed(2)}/mois</strong>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title">Projections mensuelles</div></div>
      <div class="card-body">
        <table class="data-table" style="width:100%">
          <thead>
            <tr><th>Échelle</th><th style="text-align:right">Emails</th><th style="text-align:right">Brain</th><th style="text-align:right">Fixe</th><th style="text-align:right">Total /mois</th></tr>
          </thead>
          <tbody>${projHtml}</tbody>
        </table>
      </div>
    </div>
    ` : ''}
  </div>`;

  // Chart
  const dailyCosts = finData?.dailyCosts || [];
  if (dailyCosts.length > 0) {
    const labels = dailyCosts.map(d => d.date.substring(5));
    const values = dailyCosts.map(d => d.cost);
    Charts.barChart('finance-chart', labels, values, '#3b82f6', 'Dépenses API ($)');
  }

  // Revenue chart
  if (invData?.monthlyRevenue && Object.keys(invData.monthlyRevenue).length > 0) {
    // Le chart de revenue est maintenant inclus dans le chart finance
  }
};
}
