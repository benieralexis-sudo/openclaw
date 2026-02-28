/* ===== Page: CRM ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

Pages.crm = async function(container) {
  const data = await API.crm();
  if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

  const s = data.stats;
  const stages = ['Prospect', 'Contacté', 'Intéressé', 'RDV', 'Négociation', 'Signé', 'Perdu'];
  const deals = data.deals || [];
  const log = data.activityLog || [];

  const dealsByStage = {};
  stages.forEach(st => dealsByStage[st] = []);
  deals.forEach(d => {
    const props = d.properties || d;
    const stage = props.dealstage || props.stage || 'Prospect';
    const mappedStage = stages.find(s => stage.toLowerCase().includes(s.toLowerCase())) || 'Prospect';
    dealsByStage[mappedStage].push(d);
  });

  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <h1 class="page-title">${Utils.icon('bar-chart')} CRM</h1>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon cyan">${Utils.icon('bar-chart')}</div></div>
        <div class="kpi-value" data-count="${deals.length}">${deals.length}</div>
        <div class="kpi-label">Deals en cours</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon green">${Utils.icon('check-circle')}</div></div>
        <div class="kpi-value" data-count="${s.contactsCreated}">${s.contactsCreated}</div>
        <div class="kpi-label">Contacts créés</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon blue">${Utils.icon('file-text')}</div></div>
        <div class="kpi-value" data-count="${s.notesAdded}">${s.notesAdded}</div>
        <div class="kpi-label">Notes ajoutées</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon purple">${Utils.icon('activity')}</div></div>
        <div class="kpi-value" data-count="${s.totalActions}">${s.totalActions}</div>
        <div class="kpi-label">Actions CRM</div>
      </div>
    </div>

    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Pipeline</div>
        </div>
        <div class="card-body">
          <div class="pipeline-board" role="list" aria-label="Pipeline CRM">
            ${stages.map(stage => `
              <div class="pipeline-column" role="listitem" aria-label="${e(stage)} (${dealsByStage[stage].length})">
                <div class="pipeline-column-header">
                  ${e(stage)}
                  <span class="pipeline-count">${dealsByStage[stage].length}</span>
                </div>
                ${dealsByStage[stage].map(d => {
                  const props = d.properties || d;
                  const daysSince = props.createdAt ? Math.floor((Date.now() - new Date(props.createdAt).getTime()) / 86400000) : 0;
                  return `
                  <div class="pipeline-card ${daysSince > 7 ? 'stagnant' : ''}" role="article">
                    <div class="pipeline-card-name">${e(props.dealname || props.name || '—')}</div>
                    <div class="pipeline-card-company">${e(props.company || '—')}</div>
                    <div class="pipeline-card-footer">
                      <div class="pipeline-card-amount">${props.amount ? Utils.formatCurrency(props.amount) : '—'}</div>
                      <div class="pipeline-card-days">${daysSince}j</div>
                    </div>
                  </div>`;
                }).join('')}
              </div>
            `).join('')}
          </div>
          ${deals.length === 0 ? '<div class="empty-state"><p>Aucun deal dans le pipeline</p></div>' : ''}
        </div>
      </div>
    </div>

    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Activité récente</div>
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Action</th><th>Détails</th><th>Date</th></tr></thead>
              <tbody>
                ${log.slice(-20).reverse().map(l => `
                  <tr>
                    <td style="color:var(--text-primary);font-weight:500">${e(l.action || '—')}</td>
                    <td>${e(Utils.truncate(JSON.stringify(l.details || {}), 60))}</td>
                    <td>${Utils.formatDateTime(l.createdAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${log.length === 0 ? '<div class="empty-state"><p>Aucune activité</p></div>' : ''}
        </div>
      </div>
    </div>
  </div>`;
};
}
