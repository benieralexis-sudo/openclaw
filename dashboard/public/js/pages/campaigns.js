/* ===== Page: Campagnes (fusion Emails + Inbox) ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

Pages.campaigns = async function(container) {
  // Charger emails + inbox + health + ab en parallèle
  const [data, inboxData, healthData, abData, heatmapData] = await Promise.all([API.emails(), API.inbox(), API.fetch('email-health/score'), API.fetch('ab-tests'), API.fetch('analytics/heatmap')]);
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

    ${healthData && healthData.score != null ? `
    <div class="grid-full">
      <div class="card" style="border-left:3px solid ${healthData.score >= 80 ? 'var(--accent-green)' : healthData.score >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)'}">
        <div class="card-header">
          <div class="card-title">Health Score</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:28px;font-weight:700;color:${healthData.score >= 80 ? 'var(--accent-green)' : healthData.score >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)'}">${healthData.score}/100</span>
            <span class="badge badge-${healthData.grade === 'A' ? 'green' : healthData.grade === 'B' ? 'blue' : healthData.grade === 'C' ? 'orange' : 'red'}" style="font-size:14px;padding:4px 10px">${healthData.grade}</span>
          </div>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px">
            ${[
              {label: 'Delivrabilite', s: healthData.breakdown.deliverability, color: 'blue'},
              {label: 'Engagement', s: healthData.breakdown.engagement, color: 'green'},
              {label: 'Contenu', s: healthData.breakdown.content, color: 'purple'},
              {label: 'Timing', s: healthData.breakdown.timing, color: 'cyan'}
            ].map(b => `
              <div style="text-align:center">
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${b.label}</div>
                <div style="background:var(--bg-primary);border-radius:4px;height:6px;overflow:hidden">
                  <div style="height:100%;width:${Math.round((b.s.score/b.s.max)*100)}%;background:var(--accent-${b.color});border-radius:4px;transition:width 0.8s ease"></div>
                </div>
                <div style="font-size:12px;font-weight:600;margin-top:4px;color:var(--text-primary)">${b.s.score}/${b.s.max}</div>
              </div>
            `).join('')}
          </div>
          ${healthData.recommendations && healthData.recommendations.length > 0 ? `
            <div style="font-size:12px;color:var(--text-muted)">
              ${healthData.recommendations.map(r => '<div style="margin-top:4px">⚠ ' + e(r) + '</div>').join('')}
            </div>
          ` : '<div style="font-size:12px;color:var(--accent-green)">✓ Aucune recommandation — tout va bien</div>'}
        </div>
      </div>
    </div>
    ` : ''}

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

    ${abData && abData.variants && abData.variants.length > 1 ? `
    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Tests A/B</div>
          ${abData.winner ? '<span class="badge badge-green">Winner: Variant ' + e(abData.winner) + '</span>' : ''}
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Variant</th><th>Envoyes</th><th>Ouverts</th><th>Taux ouv.</th><th>Reponses</th><th>Taux rep.</th><th></th></tr></thead>
              <tbody>
                ${abData.variants.sort((a,b) => b.replyRate - a.replyRate).map(v => `
                  <tr>
                    <td style="font-weight:600;color:var(--text-primary)">Variant ${e(v.name)}</td>
                    <td>${v.sent}</td>
                    <td>${v.opened}</td>
                    <td>${v.openRate}%</td>
                    <td>${v.replied}</td>
                    <td style="font-weight:600;color:${v.replyRate > 3 ? 'var(--accent-green)' : 'var(--text-primary)'}">${v.replyRate}%</td>
                    <td>${abData.winner === v.name ? '<span class="badge badge-green">Winner</span>' : ''}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    ` : ''}

    ${heatmapData && heatmapData.openMatrix && heatmapData.openMatrix.length > 0 ? `
    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">${Utils.icon('clock', 16)} Heatmap Engagement</div>
          <span class="badge badge-purple">Ouvertures par jour/heure</span>
        </div>
        <div class="card-body">
          <div id="heatmap-container" style="overflow-x:auto"></div>
        </div>
      </div>
    </div>
    ` : ''}
  </div>`;

  // Render heatmap
  if (heatmapData && heatmapData.openMatrix && heatmapData.openMatrix.length > 0) {
    const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const matrix = heatmapData.openMatrix;
    let maxVal = 0;
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (matrix[d] && matrix[d][h] > maxVal) maxVal = matrix[d][h];

    let html = '<table style="border-collapse:collapse;width:100%;font-size:11px">';
    html += '<tr><td></td>';
    for (let h = 0; h < 24; h++) html += '<td style="text-align:center;color:var(--text-muted);padding:2px">' + h + 'h</td>';
    html += '</tr>';
    for (let d = 0; d < 7; d++) {
      html += '<tr><td style="padding:4px 8px;color:var(--text-secondary);font-weight:500;white-space:nowrap">' + days[d] + '</td>';
      for (let h = 0; h < 24; h++) {
        const val = (matrix[d] && matrix[d][h]) || 0;
        const intensity = maxVal > 0 ? val / maxVal : 0;
        const bg = intensity === 0 ? 'var(--bg-card)' : 'rgba(59,130,246,' + (0.15 + intensity * 0.75).toFixed(2) + ')';
        html += '<td style="padding:0"><div style="width:100%;height:24px;background:' + bg + ';border-radius:2px;margin:1px" title="' + days[d] + ' ' + h + 'h: ' + val + ' ouverture' + (val > 1 ? 's' : '') + '"></div></td>';
      }
      html += '</tr>';
    }
    html += '</table>';
    const heatmapEl = document.getElementById('heatmap-container');
    if (heatmapEl) heatmapEl.innerHTML = html;
  }

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
