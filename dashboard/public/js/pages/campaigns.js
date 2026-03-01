/* ===== Page: Campagnes (fusion Emails + Inbox) ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

Pages.campaigns = async function(container) {
  // Charger emails + inbox en parallèle
  const [data, inboxData] = await Promise.all([API.emails(), API.inbox()]);
  if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

  const campaigns = data.campaigns || [];
  const replies = inboxData?.replies || [];

  // Filtre par période
  const allEmails = data.emails || [];
  const now = Date.now();
  const periodMs = { '1d': 86400000, '7d': 604800000, '30d': 2592000000 };
  const cutoff = App._emailPeriod !== 'all' ? now - (periodMs[App._emailPeriod] || 0) : 0;
  const emails = cutoff ? allEmails.filter(em => new Date(em.createdAt).getTime() > cutoff) : allEmails;

  const sent = emails.filter(em => ['sent', 'delivered', 'opened', 'clicked'].includes(em.status) || em.openedAt).length;
  const delivered = emails.filter(em => ['delivered', 'opened', 'clicked'].includes(em.status) || em.openedAt).length;
  const opened = emails.filter(em => em.openedAt).length;
  const bounced = emails.filter(em => em.status === 'bounced').length;
  const s = { sent, delivered, opened, bounced, openRate: sent > 0 ? Math.round((opened / sent) * 100) : 0 };

  const filteredCampaigns = cutoff ? campaigns.filter(c => new Date(c.createdAt || 0).getTime() > cutoff) : campaigns;
  const topEmails = emails
    .filter(em => em.openedAt)
    .sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''))
    .slice(0, 5);

  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <h1 class="page-title">${Utils.icon('mail')} Campagnes</h1>
      <div class="page-actions">
        <div class="period-selector">
          <button class="period-btn ${App._emailPeriod === '1d' ? 'active' : ''}" data-action="set-email-period" data-param="1d">Aujourd'hui</button>
          <button class="period-btn ${App._emailPeriod === '7d' ? 'active' : ''}" data-action="set-email-period" data-param="7d">7 jours</button>
          <button class="period-btn ${App._emailPeriod === '30d' ? 'active' : ''}" data-action="set-email-period" data-param="30d">30 jours</button>
          <button class="period-btn ${App._emailPeriod === 'all' ? 'active' : ''}" data-action="set-email-period" data-param="all">Tout</button>
        </div>
        ${s.sent > 0 ? `<button class="btn-export" data-action="export-emails" title="Exporter CSV">${Utils.icon('download', 14)} CSV</button>` : ''}
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon purple">${Utils.icon('mail')}</div></div>
        <div class="kpi-value" data-count="${s.sent}">${s.sent}</div>
        <div class="kpi-label">Envoyés</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon blue">${Utils.icon('eye')}</div></div>
        <div class="kpi-value" data-count="${s.openRate}" data-percent="true">${s.openRate}%</div>
        <div class="kpi-label">Taux d'ouverture</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon green">${Utils.icon('check-circle')}</div></div>
        <div class="kpi-value" data-count="${s.delivered}">${s.delivered}</div>
        <div class="kpi-label">Délivrés</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon orange">${Utils.icon('message-circle')}</div></div>
        <div class="kpi-value" data-count="${replies.length}">${replies.length}</div>
        <div class="kpi-label">Réponses reçues</div>
      </div>
    </div>

    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Taux d'ouverture${App._emailPeriod === '1d' ? " — aujourd'hui" : App._emailPeriod === '7d' ? ' — 7 jours' : App._emailPeriod === '30d' ? ' — 30 jours' : ''}</div>
        </div>
        <div class="card-body">
          <div class="chart-container-sm"><canvas id="chart-open-rate" role="img" aria-label="Graphique taux d'ouverture emails sur 30 jours"></canvas></div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Campagnes</div>
          <span class="badge badge-purple">${filteredCampaigns.length}</span>
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Nom</th><th>Statut</th><th>Contacts</th><th>Date</th></tr></thead>
              <tbody>
                ${filteredCampaigns.map(c => `
                  <tr>
                    <td style="color:var(--text-primary);font-weight:500">${e(c.name || 'Sans nom')}</td>
                    <td>${Utils.statusBadge(c.status)}</td>
                    <td>${c.totalContacts || 0}</td>
                    <td>${Utils.formatDate(c.createdAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${filteredCampaigns.length === 0 ? '<div class="empty-state"><p>Aucune campagne</p></div>' : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Meilleurs emails</div>
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Destinataire</th><th>Objet</th><th>Statut</th></tr></thead>
              <tbody>
                ${topEmails.map(em => `
                  <tr>
                    <td>${e(em.to || '—')}</td>
                    <td style="color:var(--text-primary)">${e(Utils.truncate(em.subject, 40))}</td>
                    <td>${Utils.statusBadge(em.status)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${topEmails.length === 0 ? '<div class="empty-state"><p>Aucun email ouvert</p></div>' : ''}
        </div>
      </div>
    </div>

    ${replies.length > 0 ? `
    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">${Utils.icon('message-circle', 16)} &nbsp;Réponses reçues</div>
          <span class="badge badge-green">${replies.length}</span>
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>De</th><th>Objet</th><th>Sentiment</th><th>Date</th></tr></thead>
              <tbody>
                ${replies.map(r => `
                  <tr>
                    <td style="color:var(--text-primary);font-weight:500">${e(r.from || r.prospectEmail || '—')}</td>
                    <td>${e(Utils.truncate(r.subject || r.originalSubject || '—', 50))}</td>
                    <td>${r.sentiment ? `<span class="badge badge-${r.sentiment === 'positive' ? 'green' : r.sentiment === 'negative' ? 'red' : 'gray'}">${e(r.sentiment)}</span>` : '—'}</td>
                    <td>${Utils.formatDateTime(r.matchedAt || r.processedAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    ` : ''}
  </div>`;

  // Graphique taux d'ouverture
  if (data.dailyOpenRate) {
    const chartDays = App._emailPeriod === '1d' ? 1 : App._emailPeriod === '7d' ? 7 : App._emailPeriod === '30d' ? 30 : data.dailyOpenRate.length;
    const chartData = data.dailyOpenRate.slice(-chartDays);
    const labels = chartData.map(d => {
      const date = new Date(d.date);
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    });
    Charts.areaChart('chart-open-rate', labels, chartData.map(d => d.rate), '#8b5cf6', "Taux d'ouverture %");
  }
};
}
