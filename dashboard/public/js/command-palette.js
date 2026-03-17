/* ===== COMMAND PALETTE — Ctrl+K (F22) ===== */

const CommandPalette = {
  _visible: false,
  _activeIndex: 0,
  _results: [],

  open() {
    if (this._visible) { this.close(); return; }
    this._visible = true;
    this._activeIndex = 0;

    const overlay = document.createElement('div');
    overlay.id = 'command-palette';
    overlay.className = 'cp-overlay';
    overlay.innerHTML = `
      <div class="cp-modal">
        <div class="cp-input-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="cp-input" class="cp-input" placeholder="Rechercher pages, actions, prospects..." autocomplete="off" autofocus>
          <kbd>Esc</kbd>
        </div>
        <div id="cp-results" class="cp-results"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = document.getElementById('cp-input');
    if (input) {
      input.focus();
      input.addEventListener('input', () => this._search(input.value));
      input.addEventListener('keydown', (ev) => this._handleKey(ev));
    }
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) this.close();
    });

    this._showDefaults();
  },

  close() {
    const el = document.getElementById('command-palette');
    if (el) el.remove();
    this._visible = false;
  },

  _showDefaults() {
    this._results = [
      { type: 'page', label: 'Dashboard', icon: '🏠', action: () => { window.location.hash = 'dashboard'; } },
      { type: 'page', label: 'Unibox', icon: '💬', action: () => { window.location.hash = 'unibox'; } },
      { type: 'page', label: 'Pipeline', icon: '📊', action: () => { window.location.hash = 'pipeline'; } },
      { type: 'page', label: 'Leads', icon: '🎯', action: () => { window.location.hash = 'leads'; } },
      { type: 'page', label: 'Campagnes', icon: '📧', action: () => { window.location.hash = 'campaigns'; } },
      { type: 'page', label: 'Approbations', icon: '📝', action: () => { window.location.hash = 'drafts'; } },
      { type: 'page', label: 'Parametres', icon: '⚙', action: () => { window.location.hash = 'settings'; } },
      { type: 'page', label: 'CRM', icon: '📈', action: () => { window.location.hash = 'crm'; } },
      { type: 'action', label: 'Raccourcis clavier', icon: '⌨', action: () => { if (typeof Keyboard !== 'undefined') Keyboard.showHelp(); } },
    ];
    this._render();
  },

  async _search(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) { this._showDefaults(); return; }

    // Local fuzzy search on pages
    const pages = [
      { label: 'Dashboard', keywords: 'dashboard accueil home kpi overview', hash: 'dashboard', icon: '🏠' },
      { label: 'Unibox', keywords: 'unibox inbox conversations messages replies', hash: 'unibox', icon: '💬' },
      { label: 'Pipeline', keywords: 'pipeline kanban funnel stages deals', hash: 'pipeline', icon: '📊' },
      { label: 'Leads', keywords: 'leads prospects recherche apollo enrichissement', hash: 'leads', icon: '🎯' },
      { label: 'Campagnes', keywords: 'campagnes emails envoi ouverture automailer', hash: 'campaigns', icon: '📧' },
      { label: 'Approbations', keywords: 'approbations brouillons drafts hitl validation', hash: 'drafts', icon: '📝' },
      { label: 'Parametres', keywords: 'parametres settings config icp tone kb', hash: 'settings', icon: '⚙' },
      { label: 'CRM', keywords: 'crm hubspot deals contacts pipeline', hash: 'crm', icon: '📈' },
      { label: 'Intelligence', keywords: 'intelligence alertes veille web optimisation', hash: 'intelligence', icon: '🧠' },
      { label: 'Finances', keywords: 'finances factures budget couts revenus', hash: 'finances', icon: '💰' },
      { label: 'Systeme', keywords: 'systeme ram cpu disque erreurs uptime', hash: 'system', icon: '🖥' },
      { label: 'Clients', keywords: 'clients utilisateurs users admin', hash: 'clients', icon: '👥' },
    ];

    const matchedPages = pages.filter(p =>
      p.label.toLowerCase().includes(q) || p.keywords.includes(q)
    ).map(p => ({
      type: 'page', label: p.label, icon: p.icon,
      action: () => { window.location.hash = p.hash; }
    }));

    // Server search (prospects, emails)
    let serverResults = [];
    if (q.length >= 2) {
      try {
        const data = await API.fetch('search?q=' + encodeURIComponent(q));
        if (data && data.results) {
          serverResults = data.results.slice(0, 8).map(r => ({
            type: r.type,
            label: r.type === 'prospect' ? (r.name || r.email) + (r.company ? ' — ' + r.company : '') :
                   r.type === 'email' ? r.subject || r.to : r.prospectEmail,
            icon: r.type === 'prospect' ? '👤' : r.type === 'email' ? '📧' : '💬',
            action: () => {
              if (r.type === 'prospect' && typeof ProspectDrawer !== 'undefined') {
                ProspectDrawer.open(r.email);
              } else {
                window.location.hash = 'unibox';
              }
            }
          }));
        }
      } catch (e) {}
    }

    this._results = [...matchedPages, ...serverResults];
    this._activeIndex = 0;
    this._render();
  },

  _render() {
    const container = document.getElementById('cp-results');
    if (!container) return;

    if (this._results.length === 0) {
      container.innerHTML = '<div class="cp-empty">Aucun resultat</div>';
      return;
    }

    container.innerHTML = this._results.map((r, i) => `
      <div class="cp-item ${i === this._activeIndex ? 'cp-active' : ''}" data-index="${i}">
        <span class="cp-item-icon">${r.icon}</span>
        <span class="cp-item-label">${Utils.escapeHtml(r.label)}</span>
        <span class="cp-item-type">${r.type === 'page' ? 'Page' : r.type === 'prospect' ? 'Prospect' : r.type === 'email' ? 'Email' : r.type === 'action' ? 'Action' : r.type}</span>
      </div>
    `).join('');

    // Click handlers
    container.querySelectorAll('.cp-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        if (this._results[idx]) {
          this._results[idx].action();
          this.close();
        }
      });
    });
  },

  _handleKey(ev) {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this._activeIndex = Math.min(this._activeIndex + 1, this._results.length - 1);
      this._render();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this._activeIndex = Math.max(this._activeIndex - 1, 0);
      this._render();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (this._results[this._activeIndex]) {
        this._results[this._activeIndex].action();
        this.close();
      }
    } else if (ev.key === 'Escape') {
      this.close();
    }
  }
};
