/* ===== APP — MISSION CONTROL SPA ===== */

const App = {
  currentPage: null,
  currentPeriod: '30d',

  init() {
    this.bindNav();
    this.bindMobile();
    this.routeFromHash();
    window.addEventListener('hashchange', () => this.routeFromHash());
    startAutoRefresh();
  },

  bindNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        window.location.hash = page;
      });
    });
  },

  bindMobile() {
    const hamburger = document.getElementById('hamburger');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (hamburger) {
      hamburger.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('visible');
      });
    }
    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
      });
    }
    // Close sidebar on nav click (mobile)
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
      });
    });
  },

  routeFromHash() {
    const hash = (window.location.hash || '#overview').replace('#', '');
    this.loadPage(hash);
  },

  setActiveNav(page) {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
  },

  _loadId: 0,

  async loadPage(page, silent = false) {
    this.currentPage = page;
    this.setActiveNav(page);
    Charts.destroyAll();
    const loadId = ++this._loadId;

    const container = document.getElementById('page-container');
    if (!silent) {
      container.innerHTML = `<div class="page-enter stagger">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px">
          <div><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text" style="width:120px"></div></div>
          <div class="skeleton" style="width:200px;height:36px;border-radius:8px"></div>
        </div>
        <div class="kpi-grid">
          ${[1,2,3,4].map(() => `<div class="kpi-card"><div class="kpi-header"><div class="skeleton" style="width:36px;height:36px;border-radius:8px"></div></div><div class="skeleton skeleton-value" style="margin-bottom:8px"></div><div class="skeleton skeleton-text" style="width:100px"></div></div>`).join('')}
        </div>
        <div class="card"><div class="card-body"><div class="skeleton skeleton-chart"></div></div></div>
      </div>`;
    }

    const pages = {
      'overview': this.renderOverview,
      'prospection': this.renderProspection,
      'emails': this.renderEmails,
      'crm': this.renderCRM,
      'enrichment': this.renderEnrichment,
      'content': this.renderContent,
      'invoices': this.renderInvoices,
      'proactive': this.renderProactive,
      'self-improve': this.renderSelfImprove,
      'web-intel': this.renderWebIntel,
      'system': this.renderSystem
    };

    const renderer = pages[page] || pages['overview'];
    try {
      await renderer.call(this, container);
      if (loadId !== this._loadId) return; // race condition guard
      this.animateCountUps();
    } catch (err) {
      if (loadId !== this._loadId) return;
      console.error('[app] Erreur page ' + page + ':', err);
      container.innerHTML = '<div class="empty-state"><p>Erreur de chargement. <a href="#' + page + '" onclick="App.loadPage(\'' + page + '\')">Reessayer</a></p></div>';
    }
  },

  animateCountUps() {
    document.querySelectorAll('[data-count]').forEach(el => {
      const target = parseFloat(el.dataset.count);
      Utils.countUp(el, target);
    });
  },

  // ========================================
  // PAGE: Vue d'ensemble
  // ========================================
  async renderOverview(container) {
    const data = await API.overview(this.currentPeriod);
    if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

    const k = data.kpis;
    container.innerHTML = `
    <div class="page-enter stagger">
      <div class="page-header">
        <div class="page-greeting">
          <h1>Bonjour${data.ownerName ? ' ' + data.ownerName : ''}</h1>
          <div class="date">${Utils.todayString()}</div>
        </div>
        <div class="page-actions">
          <div class="period-selector">
            <button class="period-btn ${this.currentPeriod === '1d' ? 'active' : ''}" onclick="App.setPeriod('1d')">Aujourd'hui</button>
            <button class="period-btn ${this.currentPeriod === '7d' ? 'active' : ''}" onclick="App.setPeriod('7d')">7 jours</button>
            <button class="period-btn ${this.currentPeriod === '30d' ? 'active' : ''}" onclick="App.setPeriod('30d')">30 jours</button>
          </div>
        </div>
      </div>

      ${data.moltbotStatus && data.moltbotStatus.mode === 'standby' ? `
      <div class="standby-banner">
        &#9208;&#65039; MoltBot est en <strong>mode stand-by</strong> &mdash; crons d&eacute;sactiv&eacute;s, z&eacute;ro consommation automatique. Dis <em>&laquo; active tout &raquo;</em> sur Telegram pour lancer.
      </div>
      ` : data.moltbotStatus && data.moltbotStatus.mode === 'production' ? `
      <div class="production-banner">
        &#9989; MoltBot en <strong>production</strong> &mdash; ${data.moltbotStatus.cronsActive ? '14 crons actifs' : 'crons en pause'}
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
        <div class="kpi-card">
          <div class="kpi-header">
            <div class="kpi-icon green">${Utils.icon('dollar-sign')}</div>
            ${Utils.changeBadge(k.revenue.change)}
          </div>
          <div class="kpi-value" data-count="${k.revenue.value}" data-currency="true">${Utils.formatCurrency(k.revenue.value)}</div>
          <div class="kpi-label">Revenus encaissés</div>
        </div>
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
                  <div class="hot-lead-avatar">${Utils.initials(l.apolloData?.name || l.email)}</div>
                  <div>
                    <div class="hot-lead-name">${l.apolloData?.name || l.email}</div>
                    <div class="hot-lead-company">${l.apolloData?.organization?.name || '—'} · ${l.opens || 0} ouvertures</div>
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
            <div class="card-title">Activité — 30 jours</div>
          </div>
          <div class="card-body">
            <div class="chart-container">
              <canvas id="chart-overview"></canvas>
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
                  <div class="next-action-label">${a.label}</div>
                  <div class="next-action-time">${a.time}</div>
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
                        <div class="feed-text">${f.text}</div>
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
  },

  setPeriod(p) {
    this.currentPeriod = p;
    API.invalidate('overview?period=' + p);
    this.loadPage('overview');
  },

  // ========================================
  // PAGE: Prospection (FlowFast)
  // ========================================
  async renderProspection(container) {
    const data = await API.prospection();
    if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

    const s = data.stats;
    const leads = (data.leads || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    container.innerHTML = `
    <div class="page-enter stagger">
      <div class="page-header">
        <h1 class="page-title">${Utils.icon('target')} Prospection</h1>
        <div class="page-actions">
          <div class="search-bar">
            ${Utils.icon('search', 16)}
            <input type="text" placeholder="Rechercher un lead..." id="search-leads" oninput="App.filterLeads()">
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
          <div class="kpi-header"><div class="kpi-icon purple">${Utils.icon('bar-chart')}</div></div>
          <div class="kpi-value" data-count="${s.pushedToHubspot || 0}">${s.pushedToHubspot || 0}</div>
          <div class="kpi-label">Poussés vers HubSpot</div>
        </div>
      </div>

      <div class="grid-full">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Leads par jour</div>
          </div>
          <div class="card-body">
            <div class="chart-container-sm"><canvas id="chart-leads-daily"></canvas></div>
          </div>
        </div>
      </div>

      <div class="grid-full">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Tous les leads</div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="badge badge-blue">${leads.length}</span>
              ${leads.length > 0 ? `<button class="btn-export" onclick="App.exportLeads()" title="Exporter CSV">${Utils.icon('download', 14)} CSV</button>` : ''}
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
                    <th>HubSpot</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  ${leads.slice(0, App._leadsPageSize || 50).map(l => `
                    <tr class="lead-row" data-search="${(l.nom || '').toLowerCase()} ${(l.entreprise || '').toLowerCase()} ${(l.email || '').toLowerCase()}">
                      <td style="color:var(--text-primary);font-weight:500">${l.nom || '—'}</td>
                      <td>${l.entreprise || '—'}</td>
                      <td>${l.email || '—'}</td>
                      <td>${l.score ? `<span class="score-badge ${Utils.scoreClass(l.score)}">${l.score}</span>` : '—'}</td>
                      <td>${l.pushedToHubspot ? '<span class="status-dot green"></span>Oui' : '<span class="status-dot red"></span>Non'}</td>
                      <td>${Utils.formatDate(l.createdAt)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            ${leads.length > (App._leadsPageSize || 50) ? `<div style="padding:16px;text-align:center"><button class="btn-export" onclick="App.showMoreLeads()" style="padding:10px 24px">Voir plus (${leads.length - (App._leadsPageSize || 50)} restants)</button></div>` : ''}
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
  },

  _leadsPageSize: 50,
  _leadsCache: null,

  filterLeads() {
    const q = (document.getElementById('search-leads')?.value || '').toLowerCase();
    document.querySelectorAll('.lead-row').forEach(row => {
      row.style.display = row.dataset.search.includes(q) ? '' : 'none';
    });
  },

  showMoreLeads() {
    this._leadsPageSize = (this._leadsPageSize || 50) + 50;
    this.loadPage('prospection');
  },

  async exportLeads() {
    const data = await API.prospection();
    if (!data || !data.leads) return;
    const headers = ['Nom', 'Entreprise', 'Email', 'Score', 'HubSpot', 'Date'];
    const rows = data.leads.map(l => [
      l.nom || '', l.entreprise || '', l.email || '',
      l.score || '', l.pushedToHubspot ? 'Oui' : 'Non',
      l.createdAt ? new Date(l.createdAt).toLocaleDateString('fr-FR') : ''
    ]);
    Utils.exportCSV(headers, rows, 'leads-krest-' + new Date().toISOString().slice(0, 10) + '.csv');
  },

  // ========================================
  // PAGE: Emails (AutoMailer)
  // ========================================
  async renderEmails(container) {
    const data = await API.emails();
    if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

    const s = data.stats;
    const campaigns = data.campaigns || [];

    container.innerHTML = `
    <div class="page-enter stagger">
      <div class="page-header">
        <h1 class="page-title">${Utils.icon('mail')} Emails</h1>
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
          <div class="kpi-header"><div class="kpi-icon red">${Utils.icon('alert-triangle')}</div></div>
          <div class="kpi-value" data-count="${s.bounced}">${s.bounced}</div>
          <div class="kpi-label">Rebonds</div>
        </div>
      </div>

      <div class="grid-full">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Taux d'ouverture — 30 jours</div>
          </div>
          <div class="card-body">
            <div class="chart-container-sm"><canvas id="chart-open-rate"></canvas></div>
          </div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Campagnes</div>
            <span class="badge badge-purple">${campaigns.length}</span>
          </div>
          <div class="card-body no-pad">
            <div class="table-wrapper">
              <table class="data-table">
                <thead><tr><th>Nom</th><th>Statut</th><th>Contacts</th><th>Date</th></tr></thead>
                <tbody>
                  ${campaigns.map(c => `
                    <tr>
                      <td style="color:var(--text-primary);font-weight:500">${c.name || 'Sans nom'}</td>
                      <td>${Utils.statusBadge(c.status)}</td>
                      <td>${c.totalContacts || 0}</td>
                      <td>${Utils.formatDate(c.createdAt)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            ${campaigns.length === 0 ? '<div class="empty-state"><p>Aucune campagne</p></div>' : ''}
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
                  ${(data.topEmails || []).map(e => `
                    <tr>
                      <td>${e.to || '—'}</td>
                      <td style="color:var(--text-primary)">${Utils.truncate(e.subject, 40)}</td>
                      <td>${Utils.statusBadge(e.status)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            ${(data.topEmails || []).length === 0 ? '<div class="empty-state"><p>Aucun email ouvert</p></div>' : ''}
          </div>
        </div>
      </div>
    </div>`;

    if (data.dailyOpenRate) {
      const labels = data.dailyOpenRate.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
      });
      Charts.areaChart('chart-open-rate', labels, data.dailyOpenRate.map(d => d.rate), '#8b5cf6', "Taux d'ouverture %");
    }
  },

  // ========================================
  // PAGE: CRM (CRM Pilot)
  // ========================================
  async renderCRM(container) {
    const data = await API.crm();
    if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

    const s = data.stats;
    const stages = ['Prospect', 'Contacté', 'Intéressé', 'RDV', 'Négociation', 'Signé', 'Perdu'];
    const deals = data.deals || [];
    const log = data.activityLog || [];

    // Group deals by stage (simulated if no real pipeline)
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
            <div class="pipeline-board">
              ${stages.map(stage => `
                <div class="pipeline-column">
                  <div class="pipeline-column-header">
                    ${stage}
                    <span class="pipeline-count">${dealsByStage[stage].length}</span>
                  </div>
                  ${dealsByStage[stage].map(d => {
                    const props = d.properties || d;
                    const daysSince = props.createdAt ? Math.floor((Date.now() - new Date(props.createdAt).getTime()) / 86400000) : 0;
                    return `
                    <div class="pipeline-card ${daysSince > 7 ? 'stagnant' : ''}">
                      <div class="pipeline-card-name">${props.dealname || props.name || '—'}</div>
                      <div class="pipeline-card-company">${props.company || '—'}</div>
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
                      <td style="color:var(--text-primary);font-weight:500">${l.action || '—'}</td>
                      <td>${Utils.truncate(JSON.stringify(l.details || {}), 60)}</td>
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
  },

  // ========================================
  // PAGE: Enrichissement (Lead Enrich)
  // ========================================
  async renderEnrichment(container) {
    const data = await API.enrichment();
    if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

    const s = data.stats;
    const apollo = data.apollo || {};
    const enriched = (data.enriched || []).sort((a, b) => (b.enrichedAt || '').localeCompare(a.enrichedAt || ''));
    const creditPercent = apollo.creditsLimit ? Math.round((apollo.creditsUsed / apollo.creditsLimit) * 100) : 0;

    container.innerHTML = `
    <div class="page-enter stagger">
      <div class="page-header">
        <h1 class="page-title">${Utils.icon('search')} Enrichissement</h1>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-header"><div class="kpi-icon orange">${Utils.icon('search')}</div></div>
          <div class="kpi-value" data-count="${s.total}">${s.total}</div>
          <div class="kpi-label">Leads enrichis</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-header"><div class="kpi-icon green">${Utils.icon('trending-up')}</div></div>
          <div class="kpi-value" data-count="${s.avgScore}">${s.avgScore}</div>
          <div class="kpi-label">Score moyen</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-header"><div class="kpi-icon blue">${Utils.icon('zap')}</div></div>
          <div class="kpi-value">${apollo.creditsUsed || 0} / ${apollo.creditsLimit || 100}</div>
          <div class="kpi-label">Crédits Apollo</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-header"><div class="kpi-icon purple">${Utils.icon('activity')}</div></div>
          <div class="kpi-value" style="font-size:20px">
            <div class="progress-bar" style="margin-top:8px">
              <div class="progress-fill" style="width:${creditPercent}%;background:${creditPercent > 80 ? 'var(--accent-red)' : 'var(--accent-blue)'}"></div>
            </div>
          </div>
          <div class="kpi-label">${creditPercent}% utilisés</div>
        </div>
      </div>

      <div class="grid-full">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Derniers enrichissements</div>
            <span class="badge badge-orange">${enriched.length}</span>
          </div>
          <div class="card-body no-pad">
            <div class="table-wrapper">
              <table class="data-table">
                <thead><tr><th>Email</th><th>Source</th><th>Industrie</th><th>Score</th><th>Date</th></tr></thead>
                <tbody>
                  ${enriched.slice(0, 30).map(e => `
                    <tr>
                      <td style="color:var(--text-primary);font-weight:500">${e.email || '—'}</td>
                      <td>${Utils.statusBadge(e.source || 'telegram')}</td>
                      <td>${e.aiClassification?.industry || '—'}</td>
                      <td>${e.aiClassification?.score ? `<span class="score-badge ${Utils.scoreClass(e.aiClassification.score)}">${e.aiClassification.score}</span>` : '—'}</td>
                      <td>${Utils.formatDate(e.enrichedAt)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            ${enriched.length === 0 ? '<div class="empty-state"><p>Aucun lead enrichi</p></div>' : ''}
          </div>
        </div>
      </div>
    </div>`;
  },

  // ========================================
  // PAGE: Contenu (Content Gen)
  // ========================================
  async renderContent(container) {
    const data = await API.content();
    if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

    const s = data.stats;
    const contents = data.contents || [];
    const byType = s.byType || {};
    const typeLabels = { linkedin: 'LinkedIn', pitch: 'Pitch', description: 'Description', script: 'Script', email: 'Email', bio: 'Bio', refine: 'Reformulation' };
    const typeColors = { linkedin: 'blue', pitch: 'purple', description: 'cyan', script: 'orange', email: 'pink', bio: 'green', refine: 'teal' };

    container.innerHTML = `
    <div class="page-enter stagger">
      <div class="page-header">
        <h1 class="page-title">${Utils.icon('pen-tool')} Contenu</h1>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-header"><div class="kpi-icon pink">${Utils.icon('pen-tool')}</div></div>
          <div class="kpi-value" data-count="${s.totalGenerated || contents.length}">${s.totalGenerated || contents.length}</div>
          <div class="kpi-label">Contenus générés</div>
        </div>
        ${Object.entries(byType).slice(0, 3).map(([type, count]) => `
          <div class="kpi-card">
            <div class="kpi-header"><div class="kpi-icon ${typeColors[type] || 'blue'}">${Utils.icon('file-text')}</div></div>
            <div class="kpi-value" data-count="${count}">${count}</div>
            <div class="kpi-label">${typeLabels[type] || type}</div>
          </div>
        `).join('')}
      </div>

      <div class="grid-full">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Historique des contenus</div>
          </div>
          <div class="card-body no-pad">
            <div class="table-wrapper">
              <table class="data-table">
                <thead><tr><th>Type</th><th>Sujet</th><th>Aperçu</th><th>Date</th></tr></thead>
                <tbody>
                  ${contents.slice(0, 30).map(c => `
                    <tr>
                      <td><span class="badge badge-${typeColors[c.type] || 'gray'}">${typeLabels[c.type] || c.type}</span></td>
                      <td style="color:var(--text-primary);font-weight:500">${Utils.truncate(c.topic, 40)}</td>
                      <td>${Utils.truncate(c.content, 60)}</td>
                      <td>${Utils.formatDate(c.createdAt)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            ${contents.length === 0 ? '<div class="empty-state"><p>Aucun contenu généré</p></div>' : ''}
          </div>
        </div>
      </div>
    </div>`;
  },

  // ========================================
  // PAGE: Facturation (Invoice Bot)
  // ========================================
  async renderInvoices(container) {
    const data = await API.invoices();
    if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

    const s = data.stats;
    const invoices = data.invoices || [];
    const clients = data.clients || [];

    container.innerHTML = `
    <div class="page-enter stagger">
      <div class="page-header">
        <h1 class="page-title">${Utils.icon('file-text')} Facturation</h1>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-header"><div class="kpi-icon green">${Utils.icon('dollar-sign')}</div></div>
          <div class="kpi-value" data-count="${s.paid || 0}" data-currency="true">${Utils.formatCurrency(s.paid || 0)}</div>
          <div class="kpi-label">Payé</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-header"><div class="kpi-icon orange">${Utils.icon('clock')}</div></div>
          <div class="kpi-value" data-count="${s.pending || 0}" data-currency="true">${Utils.formatCurrency(s.pending || 0)}</div>
          <div class="kpi-label">En attente</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-header"><div class="kpi-icon red">${Utils.icon('alert-triangle')}</div></div>
          <div class="kpi-value" data-count="${s.overdue || 0}" data-currency="true">${Utils.formatCurrency(s.overdue || 0)}</div>
          <div class="kpi-label">Impayé</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-header"><div class="kpi-icon blue">${Utils.icon('user')}</div></div>
          <div class="kpi-value" data-count="${s.totalClients}">${s.totalClients}</div>
          <div class="kpi-label">Clients</div>
        </div>
      </div>

      <div class="grid-full">
        <div class="card">
          <div class="card-header"><div class="card-title">Revenus par mois</div></div>
          <div class="card-body">
            <div class="chart-container-sm"><canvas id="chart-revenue"></canvas></div>
          </div>
        </div>
      </div>

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
                      <td style="color:var(--text-primary);font-weight:600">${i.number || i.id}</td>
                      <td>${client?.name || client?.company || '—'}</td>
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
    </div>`;

    if (data.monthlyRevenue && Object.keys(data.monthlyRevenue).length > 0) {
      Charts.monthlyRevenue('chart-revenue', data.monthlyRevenue);
    }
  },

  // ========================================
  // PAGE: Agent Proactif
  // ========================================
  async renderProactive(container) {
    const data = await API.proactive();
    if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

    const config = data.config || {};
    const stats = data.stats || {};
    const alerts = (data.alerts || []).reverse();
    const hotLeads = data.hotLeads || [];

    container.innerHTML = `
    <div class="page-enter stagger">
      <div class="page-header">
        <h1 class="page-title">${Utils.icon('bot')} Agent Proactif</h1>
        <div class="page-actions">
          <span style="font-size:13px;color:var(--text-muted);margin-right:8px">Mode proactif</span>
          <div class="toggle-switch ${config.enabled !== false ? 'active' : ''}" title="Activé/Désactivé"></div>
        </div>
      </div>

      <div class="kpi-grid">
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
          <div class="card-header">
            <div class="card-title">Prochains crons</div>
          </div>
          <div class="card-body">
            ${buildCronList(config.alerts || {})}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">Hot leads</div>
          </div>
          <div class="card-body">
            ${hotLeads.length > 0 ? hotLeads.slice(0, 10).map(l => `
              <div class="stat-row">
                <span class="stat-label">${l.email}</span>
                <span class="stat-value">${l.opens || 0} ouvertures</span>
              </div>
            `).join('') : '<p style="color:var(--text-muted);font-size:13px">Aucun hot lead</p>'}
          </div>
        </div>
      </div>

      <div class="grid-full">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Dernières alertes</div>
          </div>
          <div class="card-body no-pad">
            <div class="table-wrapper">
              <table class="data-table">
                <thead><tr><th>Type</th><th>Message</th><th>Date</th></tr></thead>
                <tbody>
                  ${alerts.slice(0, 20).map(a => `
                    <tr>
                      <td><span class="badge badge-blue">${a.type || '—'}</span></td>
                      <td>${Utils.truncate(a.message, 80)}</td>
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
            <div class="content-preview">${data.briefing.text || 'Aucun briefing'}</div>
          </div>
        </div>
      </div>
      ` : ''}
    </div>`;
  },

  // ========================================
  // PAGE: Auto-Amélioration (Self-Improve)
  // ========================================
  async renderSelfImprove(container) {
    const data = await API.selfImprove();
    if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

    const stats = data.stats || {};
    const pending = data.pendingRecommendations || [];
    const applied = data.appliedRecommendations || [];
    const accuracy = data.accuracyHistory || [];
    const lastAccuracy = accuracy.length > 0 ? accuracy[accuracy.length - 1].accuracy : null;

    container.innerHTML = `
    <div class="page-enter stagger">
      <div class="page-header">
        <h1 class="page-title">${Utils.icon('brain')} Auto-Amélioration</h1>
      </div>

      <div class="kpi-grid">
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
                <canvas id="chart-health-score" width="120" height="120"></canvas>
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
                      <td style="color:var(--text-primary);font-weight:500">${r.title}</td>
                      <td>${r.targetSkill || '—'}</td>
                      <td><span class="badge badge-${r.priority === 'high' ? 'red' : r.priority === 'medium' ? 'orange' : 'gray'}">${r.priority || 'normal'}</span></td>
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
                      <td style="color:var(--text-primary)">${r.title}</td>
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
      </div>
    </div>`;

    if (lastAccuracy != null) {
      const color = lastAccuracy >= 70 ? '#22c55e' : lastAccuracy >= 40 ? '#f59e0b' : '#ef4444';
      Charts.doughnutChart('chart-health-score', lastAccuracy, 100, color);
    }
  },

  // ========================================
  // PAGE: Web Intelligence
  // ========================================
  async renderWebIntel(container) {
    const data = await API.webIntel();
    if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

    const stats = data.stats || {};
    const watches = data.watches || [];
    const articles = data.articles || [];
    const analyses = data.analyses || [];
    const typeLabels = { prospect: 'Prospect', competitor: 'Concurrent', sector: 'Secteur' };
    const typeColors = { prospect: 'blue', competitor: 'red', sector: 'indigo' };

    container.innerHTML = `
    <div class="page-enter stagger">
      <div class="page-header">
        <h1 class="page-title">${Utils.icon('globe')} Web Intelligence</h1>
      </div>

      <div class="kpi-grid">
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
          <div class="card-header">
            <div class="card-title">Veilles configurées</div>
          </div>
          <div class="card-body no-pad">
            <div class="table-wrapper">
              <table class="data-table">
                <thead><tr><th>Nom</th><th>Type</th><th>Mots-clés</th><th>Articles</th><th>Dernier scan</th></tr></thead>
                <tbody>
                  ${watches.map(w => `
                    <tr>
                      <td style="color:var(--text-primary);font-weight:500">${w.name}</td>
                      <td><span class="badge badge-${typeColors[w.type] || 'gray'}">${typeLabels[w.type] || w.type}</span></td>
                      <td>${(w.keywords || []).slice(0, 3).join(', ')}</td>
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
          <div class="card-header">
            <div class="card-title">Derniers digests</div>
          </div>
          <div class="card-body">
            ${analyses.slice(-5).reverse().map(a => `
              <div class="stat-row" style="flex-direction:column;align-items:flex-start;gap:4px">
                <span class="stat-label">${Utils.formatDateTime(a.generatedAt)}</span>
                <div class="content-preview" style="width:100%;max-height:80px">${Utils.truncate(a.content, 200)}</div>
              </div>
            `).join('')}
            ${analyses.length === 0 ? '<p style="color:var(--text-muted);font-size:13px">Aucun digest</p>' : ''}
          </div>
        </div>
      </div>

      <div class="grid-full">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Articles récents</div>
          </div>
          <div class="card-body no-pad">
            <div class="table-wrapper">
              <table class="data-table">
                <thead><tr><th>Titre</th><th>Source</th><th>Pertinence</th><th>Urgent</th><th>Date</th></tr></thead>
                <tbody>
                  ${articles.slice(0, 25).map(a => `
                    <tr>
                      <td style="color:var(--text-primary);font-weight:500;white-space:normal;max-width:300px">${Utils.truncate(a.title, 60)}</td>
                      <td>${a.source || '—'}</td>
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
      </div>
    </div>`;
  },

  // ========================================
  // PAGE: Système (System Advisor)
  // ========================================
  async renderSystem(container) {
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
                      <td>${a.message}</td>
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
            <div class="chart-container"><canvas id="chart-system"></canvas></div>
          </div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Utilisation par skill</div>
          </div>
          <div class="card-body">
            ${Object.entries(usage).map(([skill, u]) => `
              <div class="stat-row">
                <div>
                  <span class="stat-label">${skill}</span>
                </div>
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
          <div class="card-header">
            <div class="card-title">Temps de réponse</div>
          </div>
          <div class="card-body">
            ${Object.entries(responseTimes).map(([skill, rt]) => `
              <div class="stat-row">
                <span class="stat-label">${skill}</span>
                <span class="stat-value">${rt.avg ? Math.round(rt.avg) : 0} ms</span>
              </div>
            `).join('')}
            ${Object.keys(responseTimes).length === 0 ? '<p style="color:var(--text-muted);font-size:13px">Aucune donnée</p>' : ''}
          </div>
        </div>
      </div>

      <div class="grid-full">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Erreurs récentes</div>
          </div>
          <div class="card-body no-pad">
            <div class="table-wrapper">
              <table class="data-table">
                <thead><tr><th>Skill</th><th>Erreur</th><th>Aujourd'hui</th><th>Semaine</th><th>Total</th></tr></thead>
                <tbody>
                  ${Object.entries(errors).filter(([, e]) => e.total > 0).map(([skill, e]) => `
                    <tr>
                      <td style="color:var(--text-primary);font-weight:500">${skill}</td>
                      <td style="color:var(--accent-red)">${e.recentErrors?.[0]?.message ? Utils.truncate(e.recentErrors[0].message, 50) : '—'}</td>
                      <td>${e.today || 0}</td>
                      <td>${e.week || 0}</td>
                      <td>${e.total || 0}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            ${Object.entries(errors).filter(([, e]) => e.total > 0).length === 0 ? '<div class="empty-state"><p>Aucune erreur</p></div>' : ''}
          </div>
        </div>
      </div>
    </div>`;

    if (recentSnapshots.length > 0) {
      Charts.systemGauges('chart-system', recentSnapshots);
    }
  }
};

// ===== Helpers =====
function buildCronList(alerts) {
  const crons = [];
  if (alerts.morningReport?.enabled) crons.push({ label: 'Rapport matinal', time: `${alerts.morningReport.hour || 8}h${String(alerts.morningReport.minute || 0).padStart(2, '0')}` });
  if (alerts.pipelineAlerts?.enabled) crons.push({ label: 'Alertes pipeline', time: `${alerts.pipelineAlerts.hour || 9}h${String(alerts.pipelineAlerts.minute || 0).padStart(2, '0')}` });
  if (alerts.weeklyReport?.enabled) crons.push({ label: 'Rapport hebdomadaire', time: `Lundi ${alerts.weeklyReport.hour || 9}h` });
  if (alerts.monthlyReport?.enabled) crons.push({ label: 'Rapport mensuel', time: `1er du mois ${alerts.monthlyReport.hour || 9}h` });
  if (alerts.nightlyAnalysis?.enabled) crons.push({ label: 'Analyse nocturne', time: `${alerts.nightlyAnalysis.hour || 2}h00` });
  if (alerts.emailStatusCheck?.enabled) crons.push({ label: 'Check emails', time: `Toutes les ${alerts.emailStatusCheck.intervalMinutes || 30} min` });

  if (crons.length === 0) return '<p style="color:var(--text-muted);font-size:13px">Aucun cron configuré</p>';

  return crons.map(c => `
    <div class="next-action-item">
      <div class="next-action-label">${c.label}</div>
      <div class="next-action-time">${c.time}</div>
    </div>
  `).join('');
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}j ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => App.init());
