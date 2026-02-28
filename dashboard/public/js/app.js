/* ===== APP — MISSION CONTROL SPA (Core) ===== */

const App = {
  currentPage: null,
  currentPeriod: '30d',
  userRole: 'admin',
  userName: '',
  _clientSlug: 'ifind',
  _emailPeriod: 'all',
  _leadsPageSize: 50,
  _leadsCache: null,
  _intelTab: 'alerts',
  _loadId: 0,

  init() {
    this.bindNav();
    this.bindMobile();
    this.loadUserInfo();
    this.routeFromHash();
    window.addEventListener('hashchange', () => this.routeFromHash());
    startAutoRefresh();
    this.updateBadges();
  },

  async loadUserInfo() {
    const me = await API.me();
    if (!me) return;
    this.userRole = me.role || 'admin';
    this.userName = me.username || '';
    const nameEl = document.querySelector('.client-selector span');
    if (nameEl) nameEl.textContent = me.username;
    this.applyRoleVisibility();
  },

  applyRoleVisibility() {
    const adminPages = ['finances', 'intelligence', 'system', 'clients'];
    document.querySelectorAll('.nav-item').forEach(item => {
      const page = item.dataset.page;
      if (adminPages.includes(page)) {
        item.style.display = this.userRole === 'admin' ? '' : 'none';
      }
    });
    // Masquer aussi le label "ADMIN" pour les clients
    document.querySelectorAll('.nav-section-label').forEach(label => {
      if (label.textContent.trim() === 'ADMIN') {
        label.style.display = this.userRole === 'admin' ? '' : 'none';
      }
    });
  },

  bindNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (ev) => {
        ev.preventDefault();
        const page = item.dataset.page;
        window.location.hash = page;
      });
    });
  },

  bindMobile() {
    const hamburger = document.getElementById('hamburger');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    const closeSidebar = () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
      document.body.style.overflow = '';
      if (hamburger) hamburger.focus();
    };

    if (hamburger) {
      hamburger.addEventListener('click', () => {
        const isOpen = sidebar.classList.toggle('open');
        overlay.classList.toggle('visible');
        document.body.style.overflow = isOpen ? 'hidden' : '';
      });
    }
    if (overlay) {
      overlay.addEventListener('click', closeSidebar);
    }
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', closeSidebar);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (sidebar.classList.contains('open')) closeSidebar();
      }
    });
  },

  // Legacy hash redirects
  _hashAliases: {
    'overview': 'dashboard',
    'prospection': 'leads',
    'emails': 'campaigns',
    'enrichment': 'leads',
    'content': 'dashboard',
    'invoices': 'finances',
    'finance': 'finances',
    'proactive': 'intelligence',
    'self-improve': 'intelligence',
    'web-intel': 'intelligence',
    'users': 'clients'
  },

  routeFromHash() {
    let hash = (window.location.hash || '#dashboard').replace('#', '');
    // Redirect legacy hashes
    if (this._hashAliases[hash]) {
      hash = this._hashAliases[hash];
      window.location.hash = hash;
      return;
    }
    this.loadPage(hash);
    const gs = document.getElementById('global-search');
    if (gs) { gs.value = ''; document.querySelectorAll('.nav-item').forEach(n => n.style.display = ''); this.applyRoleVisibility(); }
  },

  setActiveNav(page) {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
  },

  async loadPage(page, silent) {
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

    const renderer = (window.Pages && window.Pages[page]) || (window.Pages && window.Pages['dashboard']);
    try {
      await renderer(container);
      if (loadId !== this._loadId) return;
      this.animateCountUps();
    } catch (err) {
      if (loadId !== this._loadId) return;
      console.error('[app] Erreur page ' + page + ':', err);
      container.innerHTML = '<div class="empty-state"><p>Erreur de chargement. <button class="btn-retry" data-action="retry">Réessayer</button></p></div>';
    }
  },

  animateCountUps() {
    document.querySelectorAll('[data-count]').forEach(el => {
      const target = parseFloat(el.dataset.count);
      Utils.countUp(el, target);
    });
  },

  // ===== Period / filter helpers =====
  setPeriod(p) {
    this.currentPeriod = p;
    API.invalidate('overview?period=' + p);
    this.loadPage('dashboard');
  },

  setEmailPeriod(p) {
    this._emailPeriod = p;
    this.loadPage('campaigns');
  },

  _debouncedFilter: null,

  filterLeads() {
    if (window._refreshLeadsTable) { window._refreshLeadsTable(); return; }
  },

  async exportLeads() {
    const data = await API.prospection();
    if (!data || !data.leads) return;
    const headers = ['Nom', 'Entreprise', 'Email', 'Score', 'Source', 'HubSpot', 'Date'];
    const rows = data.leads.map(l => [
      l.nom || '', l.entreprise || '', l.email || '',
      l.score || '', l.source === 'brain' ? 'Brain' : 'Search',
      l.pushedToHubspot ? 'Oui' : 'Non',
      l.createdAt ? new Date(l.createdAt).toLocaleDateString('fr-FR') : ''
    ]);
    Utils.exportCSV(headers, rows, 'leads-' + (this._clientSlug || 'ifind') + '-' + new Date().toISOString().slice(0, 10) + '.csv');
  },

  async exportEmails() {
    const data = await API.emails();
    if (!data || !data.emails) return;
    const headers = ['Destinataire', 'Objet', 'Statut', 'Campagne', 'Date'];
    const rows = data.emails.map(em => [
      em.to || '', em.subject || '', em.status || '',
      em.campaignName || '', em.createdAt ? new Date(em.createdAt).toLocaleDateString('fr-FR') : ''
    ]);
    Utils.exportCSV(headers, rows, 'emails-' + (this._clientSlug || 'ifind') + '-' + new Date().toISOString().slice(0, 10) + '.csv');
  },

  async exportInvoices() {
    const data = await API.invoices();
    if (!data || !data.invoices) return;
    const headers = ['Numéro', 'Client', 'Montant', 'Statut', 'Date'];
    const rows = data.invoices.map(i => {
      const client = (data.clients || []).find(c => c.id === i.clientId);
      return [
        i.number || i.id || '', client?.name || client?.company || '',
        i.total || 0, i.status || '',
        i.createdAt ? new Date(i.createdAt).toLocaleDateString('fr-FR') : ''
      ];
    });
    Utils.exportCSV(headers, rows, 'factures-' + (this._clientSlug || 'ifind') + '-' + new Date().toISOString().slice(0, 10) + '.csv');
  },

  // ===== Dynamic sidebar badges =====
  async updateBadges() {
    try {
      const data = await API.proactive();
      if (data) {
        const hotCount = (data.hotLeads || []).filter(l => (l.opens || 0) >= 3).length;
        const badge = document.getElementById('badge-leads');
        if (badge) {
          if (hotCount > 0) {
            badge.textContent = hotCount;
            badge.style.display = '';
          } else {
            badge.style.display = 'none';
          }
        }
      }
    } catch (e) {}
  }
};

// Init debounce after App is defined
App._debouncedFilter = Utils.debounce(() => App.filterLeads(), 200);

// ===== Helpers (used by pages) =====
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

// ===== Global search =====
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'global-search') {
    const q = ev.target.value.trim().toLowerCase();
    if (!q) {
      document.querySelectorAll('.nav-item').forEach(n => n.style.display = '');
      App.applyRoleVisibility();
      return;
    }
    const pageKeywords = {
      'dashboard': 'vue ensemble accueil dashboard kpi overview',
      'leads': 'leads prospects recherche flowfast apollo prospection enrichissement',
      'campaigns': 'email campagne automailer envoi ouverture emails',
      'crm': 'crm hubspot pipeline deals contacts',
      'chat': 'chat conversation bot message telegram',
      'finances': 'factures facturation clients paiement revenus finance budget',
      'intelligence': 'proactif alertes cron rapports hot leads amelioration optimisation veille web intel',
      'system': 'systeme ram cpu disque erreurs uptime',
      'clients': 'utilisateurs users clients admin comptes'
    };
    document.querySelectorAll('.nav-item').forEach(n => {
      const page = n.dataset.page;
      if (!page) return;
      const label = (n.textContent || '').toLowerCase();
      const kw = pageKeywords[page] || '';
      const match = label.includes(q) || kw.includes(q);
      n.style.display = match ? '' : 'none';
    });
  }
});

// ===== Event delegation =====
document.addEventListener('click', (ev) => {
  const target = ev.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const param = target.dataset.param;

  switch (action) {
    case 'set-period': App.setPeriod(param); break;
    case 'set-email-period': App.setEmailPeriod(param); break;
    case 'retry': App.loadPage(App.currentPage); break;
    case 'export-leads': App.exportLeads(); break;
    case 'export-emails': App.exportEmails(); break;
    case 'export-invoices': App.exportInvoices(); break;
    case 'set-leads-page': if (window._setLeadsPage) window._setLeadsPage(parseInt(param)); break;
    case 'set-intel-tab': App._intelTab = param; App.loadPage('intelligence', true); break;
    case 'send-chat': if (window._sendChatMessage) window._sendChatMessage(); break;
    case 'chat-suggestion': if (window._sendChatMessage) window._sendChatMessage(param); break;
    case 'clear-chat': sessionStorage.removeItem('mc_chat'); App.loadPage('chat'); break;
    case 'toggle-add-user': {
      const form = document.getElementById('add-user-form');
      if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
      break;
    }
    case 'create-user': {
      const username = (document.getElementById('new-username')?.value || '').trim();
      const password = document.getElementById('new-password')?.value || '';
      const role = document.getElementById('new-role')?.value || 'client';
      const company = (document.getElementById('new-company')?.value || '').trim();
      const errEl = document.getElementById('add-user-error');
      if (!username || !password) {
        if (errEl) { errEl.textContent = 'Nom et mot de passe requis'; errEl.style.display = ''; }
        break;
      }
      API.createUser({ username, password, role, company: company || null }).then(res => {
        if (res && res.success) {
          API.invalidate('users');
          App.loadPage('clients');
        } else {
          if (errEl) { errEl.textContent = (res && res.error) || 'Erreur de création'; errEl.style.display = ''; }
        }
      });
      break;
    }
    case 'delete-user': {
      if (!param || !confirm('Supprimer l\'utilisateur "' + param + '" ?')) break;
      API.deleteUser(param).then(res => {
        if (res && res.success) {
          API.invalidate('users');
          App.loadPage('clients');
        }
      });
      break;
    }
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'search-leads') App._debouncedFilter();
});

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => App.init());
