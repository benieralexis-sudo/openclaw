/* ===== KEYBOARD SHORTCUTS — MISSION CONTROL ===== */

const Keyboard = {
  _bindings: {},
  _sequence: '',
  _sequenceTimer: null,
  _helpVisible: false,

  init() {
    document.addEventListener('keydown', (ev) => this._handleKeydown(ev));
    this._registerDefaults();
  },

  register(combo, handler, description) {
    this._bindings[combo] = { handler, description: description || '' };
  },

  _isInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  },

  _handleKeydown(ev) {
    // Never intercept when typing in inputs (except Escape and Ctrl combos)
    if (this._isInputFocused() && ev.key !== 'Escape' && !ev.ctrlKey && !ev.metaKey) return;

    // Ctrl/Cmd combos
    if (ev.ctrlKey || ev.metaKey) {
      const combo = 'ctrl+' + ev.key.toLowerCase();
      if (this._bindings[combo]) {
        ev.preventDefault();
        this._bindings[combo].handler();
        return;
      }
    }

    // Escape — always works
    if (ev.key === 'Escape') {
      if (this._helpVisible) { this.hideHelp(); return; }
      // Close any open drawer/modal/dropdown
      const drawer = document.getElementById('prospect-drawer');
      if (drawer && drawer.classList.contains('open')) { drawer.classList.remove('open'); return; }
      const cmdPalette = document.getElementById('command-palette');
      if (cmdPalette && cmdPalette.style.display !== 'none') { cmdPalette.style.display = 'none'; return; }
      return;
    }

    // Skip if input focused for non-special keys
    if (this._isInputFocused()) return;

    const key = ev.key.toLowerCase();

    // Sequence mode (g + key)
    if (this._sequence) {
      const combo = this._sequence + ' ' + key;
      clearTimeout(this._sequenceTimer);
      this._sequence = '';
      if (this._bindings[combo]) {
        ev.preventDefault();
        this._bindings[combo].handler();
        return;
      }
    }

    // Start sequence
    if (key === 'g') {
      this._sequence = 'g';
      this._sequenceTimer = setTimeout(() => { this._sequence = ''; }, 600);
      return;
    }

    // Single key bindings
    if (this._bindings[key]) {
      ev.preventDefault();
      this._bindings[key].handler();
    }
  },

  _registerDefaults() {
    // Navigation (g + key)
    this.register('g d', () => { window.location.hash = 'dashboard'; }, 'Dashboard');
    this.register('g u', () => { window.location.hash = 'unibox'; }, 'Unibox');
    this.register('g p', () => { window.location.hash = 'pipeline'; }, 'Pipeline');
    this.register('g l', () => { window.location.hash = 'leads'; }, 'Leads');
    this.register('g c', () => { window.location.hash = 'campaigns'; }, 'Campagnes');
    this.register('g a', () => { window.location.hash = 'drafts'; }, 'Approbations');
    this.register('g s', () => { window.location.hash = 'settings'; }, 'Parametres');
    this.register('g i', () => { window.location.hash = 'intelligence'; }, 'Intelligence');
    this.register('g f', () => { window.location.hash = 'finances'; }, 'Finances');

    // Page-specific shortcuts (Unibox)
    this.register('r', () => {
      if (App.currentPage === 'unibox') { const el = document.getElementById('ub-reply-input'); if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth' }); } }
      else if (App.currentPage === 'drafts') { const first = document.querySelector('.draft-checkbox'); if (first) first.closest('.draft-card').querySelector('[data-action="reject-draft"]')?.click(); }
    }, 'Repondre (Unibox)');

    this.register('h', () => {
      if (App.currentPage === 'unibox') { const btn = document.getElementById('ub-handoff-toggle'); if (btn) btn.click(); }
    }, 'Handoff (Unibox)');

    this.register('a', () => {
      if (App.currentPage === 'drafts') { const first = document.querySelector('.draft-card [data-action="approve-draft"]'); if (first) first.click(); }
    }, 'Approuver (Drafts)');

    this.register('x', () => {
      if (App.currentPage === 'drafts') { const first = document.querySelector('.draft-card [data-action="reject-draft"]'); if (first) first.click(); }
    }, 'Rejeter (Drafts)');

    this.register('s', () => {
      if (App.currentPage === 'drafts') { const first = document.querySelector('.draft-card [data-action="skip-draft"]'); if (first) first.click(); }
    }, 'Passer (Drafts)');

    this.register('e', () => {
      if (App.currentPage === 'drafts') { const first = document.querySelector('.draft-card [data-action="edit-draft"]'); if (first) first.click(); }
    }, 'Modifier (Drafts)');

    // Help
    this.register('?', () => this.toggleHelp(), 'Aide raccourcis');

    // Global search focus
    this.register('/', () => {
      const search = document.getElementById('global-search');
      if (search) search.focus();
    }, 'Rechercher');

    // Ctrl+K — Command Palette
    this.register('ctrl+k', () => {
      if (typeof CommandPalette !== 'undefined') CommandPalette.open();
    }, 'Command Palette');
  },

  toggleHelp() {
    if (this._helpVisible) this.hideHelp();
    else this.showHelp();
  },

  showHelp() {
    if (document.getElementById('keyboard-help')) return;
    const overlay = document.createElement('div');
    overlay.id = 'keyboard-help';
    overlay.className = 'kbd-overlay';
    overlay.innerHTML = `
      <div class="kbd-modal">
        <div class="kbd-header">
          <h3 style="margin:0;font-size:16px;font-weight:600">Raccourcis clavier</h3>
          <button class="kbd-close" aria-label="Fermer">&times;</button>
        </div>
        <div class="kbd-body">
          <div class="kbd-section">
            <div class="kbd-section-title">Navigation</div>
            <div class="kbd-row"><kbd>g</kbd> <kbd>d</kbd> <span>Dashboard</span></div>
            <div class="kbd-row"><kbd>g</kbd> <kbd>u</kbd> <span>Unibox</span></div>
            <div class="kbd-row"><kbd>g</kbd> <kbd>p</kbd> <span>Pipeline</span></div>
            <div class="kbd-row"><kbd>g</kbd> <kbd>l</kbd> <span>Leads</span></div>
            <div class="kbd-row"><kbd>g</kbd> <kbd>c</kbd> <span>Campagnes</span></div>
            <div class="kbd-row"><kbd>g</kbd> <kbd>a</kbd> <span>Approbations</span></div>
            <div class="kbd-row"><kbd>g</kbd> <kbd>s</kbd> <span>Parametres</span></div>
          </div>
          <div class="kbd-section">
            <div class="kbd-section-title">Unibox</div>
            <div class="kbd-row"><kbd>j</kbd> / <kbd>k</kbd> <span>Conversation suiv./prec.</span></div>
            <div class="kbd-row"><kbd>r</kbd> <span>Repondre</span></div>
            <div class="kbd-row"><kbd>h</kbd> <span>Handoff IA/Humain</span></div>
          </div>
          <div class="kbd-section">
            <div class="kbd-section-title">Approbations</div>
            <div class="kbd-row"><kbd>a</kbd> <span>Approuver</span></div>
            <div class="kbd-row"><kbd>x</kbd> <span>Rejeter</span></div>
            <div class="kbd-row"><kbd>s</kbd> <span>Passer</span></div>
            <div class="kbd-row"><kbd>e</kbd> <span>Modifier</span></div>
          </div>
          <div class="kbd-section">
            <div class="kbd-section-title">Global</div>
            <div class="kbd-row"><kbd>/</kbd> <span>Rechercher</span></div>
            <div class="kbd-row"><kbd>Ctrl</kbd> <kbd>K</kbd> <span>Recherche rapide</span></div>
            <div class="kbd-row"><kbd>?</kbd> <span>Cette aide</span></div>
            <div class="kbd-row"><kbd>Esc</kbd> <span>Fermer</span></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this._helpVisible = true;

    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay || ev.target.closest('.kbd-close')) this.hideHelp();
    });
  },

  hideHelp() {
    const el = document.getElementById('keyboard-help');
    if (el) el.remove();
    this._helpVisible = false;
  }
};
