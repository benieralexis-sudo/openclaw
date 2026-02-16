/* ===== UTILS — MISSION CONTROL ===== */

const Utils = {
  // HTML entity escaping (XSS prevention)
  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  // Focus trap for modals/dialogs
  createFocusTrap(container) {
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    function getFocusable() { return [...container.querySelectorAll(sel)].filter(el => el.offsetParent !== null); }
    function handleKey(ev) {
      if (ev.key !== 'Tab') return;
      const els = getFocusable();
      if (!els.length) { ev.preventDefault(); return; }
      const first = els[0], last = els[els.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
    container.addEventListener('keydown', handleKey);
    const els = getFocusable();
    if (els.length) els[0].focus();
    return () => container.removeEventListener('keydown', handleKey);
  },

  // Format number with locale
  formatNumber(n) {
    if (n == null) return '0';
    return new Intl.NumberFormat('fr-FR').format(n);
  },

  // Format currency
  formatCurrency(n, currency = 'EUR') {
    if (n == null) return '0 €';
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  },

  // Format percentage
  formatPercent(n) {
    if (n == null) return '0%';
    return `${n}%`;
  },

  // Format date
  formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  // Format date + time
  formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' +
           d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  },

  // Format time only
  formatTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  },

  // Relative time
  timeAgo(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "à l'instant";
    if (mins < 60) return `il y a ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `il y a ${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `il y a ${days}j`;
    return Utils.formatDate(iso);
  },

  // Today date string
  todayString() {
    return new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  },

  // Score badge class
  scoreClass(score) {
    if (score >= 8) return 'score-high';
    if (score >= 6) return 'score-mid';
    return 'score-low';
  },

  // Change badge HTML
  changeBadge(change) {
    if (change > 0) return `<span class="kpi-change up">+${change}%</span>`;
    if (change < 0) return `<span class="kpi-change down">${change}%</span>`;
    return `<span class="kpi-change neutral">0%</span>`;
  },

  // Status badge
  statusBadge(status) {
    const map = {
      // Invoices
      'paid': { class: 'badge-green', label: 'Payée' },
      'sent': { class: 'badge-blue', label: 'Envoyée' },
      'draft': { class: 'badge-gray', label: 'Brouillon' },
      'overdue': { class: 'badge-red', label: 'Impayée' },
      // Emails
      'delivered': { class: 'badge-green', label: 'Délivré' },
      'opened': { class: 'badge-purple', label: 'Ouvert' },
      'bounced': { class: 'badge-red', label: 'Rebond' },
      'queued': { class: 'badge-gray', label: 'En attente' },
      // Campaigns
      'active': { class: 'badge-green', label: 'Active' },
      'completed': { class: 'badge-blue', label: 'Terminée' },
      // Recommendations
      'applied': { class: 'badge-green', label: 'Appliquée' },
      'pending': { class: 'badge-orange', label: 'En attente' },
      'refused': { class: 'badge-red', label: 'Refusée' },
      // Leads
      'new': { class: 'badge-blue', label: 'Nouveau' },
      'contacted': { class: 'badge-purple', label: 'Contacté' },
      'replied': { class: 'badge-green', label: 'Répondu' },
      // Health
      'ok': { class: 'badge-green', label: 'OK' },
      'warning': { class: 'badge-orange', label: 'Attention' },
      'critical': { class: 'badge-red', label: 'Critique' }
    };
    const s = map[status] || { class: 'badge-gray', label: status || '—' };
    return `<span class="badge ${s.class}">${s.label}</span>`;
  },

  // Icon HTML
  icon(name, size = 18) {
    return `<svg width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/public/assets/icons.svg#${name}"/></svg>`;
  },

  // Truncate text
  truncate(text, max = 60) {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '...' : text;
  },

  // Initials from name
  initials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  },

  // Count up animation
  countUp(el, target, duration = 800) {
    const start = 0;
    const startTime = performance.now();
    const isCurrency = el.dataset.currency === 'true';

    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (target - start) * eased);

      if (isCurrency) {
        el.textContent = Utils.formatCurrency(current);
      } else if (el.dataset.percent === 'true') {
        el.textContent = current + '%';
      } else {
        el.textContent = Utils.formatNumber(current);
      }

      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  },

  // Debounce
  debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },

  // Skeleton HTML
  skeleton(type = 'text', count = 3) {
    if (type === 'kpi') {
      return `<div class="kpi-card"><div class="kpi-header"><div class="skeleton" style="width:36px;height:36px;border-radius:8px"></div></div><div class="skeleton skeleton-value"></div><div class="skeleton skeleton-text" style="width:100px"></div></div>`;
    }
    if (type === 'chart') {
      return `<div class="skeleton skeleton-chart"></div>`;
    }
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `<div class="skeleton skeleton-text" style="width:${60 + Math.random() * 40}%"></div>`;
    }
    return html;
  },

  // Safe get nested value
  get(obj, path, def = null) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : def), obj);
  },

  // Export data as CSV file
  exportCSV(headers, rows, filename = 'export.csv') {
    const escape = (v) => {
      const s = String(v == null ? '' : v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    Utils.toast(rows.length + ' lignes exportées');
  },

  // Toast notification
  toast(message, duration = 3000) {
    const el = document.createElement('div');
    el.className = 'toast-notification';
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }
};
