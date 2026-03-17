/* ===== Notifications — Bell + Dropdown ===== */

const Notifications = {
  _pollInterval: null,
  _lastCount: 0,
  _sseAttached: false,

  init() {
    const bell = document.getElementById('notif-bell');
    const btn = document.getElementById('notif-bell-btn');
    const dropdown = document.getElementById('notif-dropdown');
    const markAll = document.getElementById('notif-mark-all');

    if (!bell || !btn) return;

    // Show bell
    bell.style.display = '';

    // Toggle dropdown
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const visible = dropdown.style.display !== 'none';
      dropdown.style.display = visible ? 'none' : '';
      if (!visible) this.loadNotifications();
    });

    // Close on outside click
    document.addEventListener('click', (ev) => {
      if (!bell.contains(ev.target)) {
        dropdown.style.display = 'none';
      }
    });

    // Mark all read
    if (markAll) {
      markAll.addEventListener('click', async () => {
        await fetch('/api/notifications/read-all', { method: 'POST' });
        this.loadNotifications();
        this._updateBadge(0);
      });
    }

    // Initial load + SSE-driven updates (once only)
    this.poll();
    if (!this._sseAttached) {
      this._sseAttached = true;
      API.onEvent('notification', () => this.poll());
      API.onEvent('badge_update', () => this.poll());
    }

    // Fallback polling every 90s
    this._pollInterval = setInterval(() => {
      if (document.visibilityState !== 'hidden') this.poll();
    }, 90000);
  },

  async poll() {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      this._updateBadge(data.unread || 0);
    } catch (e) {}
  },

  async loadNotifications() {
    const list = document.getElementById('notif-list');
    if (!list) return;

    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      const notifs = data.notifications || [];

      if (notifs.length === 0) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">Aucune notification</div>';
        return;
      }

      list.innerHTML = notifs.slice(0, 20).map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-notif-id="${n.id}" ${n.link ? 'data-link="' + n.link + '"' : ''}>
          <div class="notif-icon">${_notifIcon(n.type)}</div>
          <div class="notif-content">
            <div class="notif-title">${_esc(n.title)}</div>
            ${n.body ? '<div class="notif-body">' + _esc(n.body).substring(0, 100) + '</div>' : ''}
            <div class="notif-time">${_relTime(n.createdAt)}</div>
          </div>
        </div>
      `).join('');

      // Click to mark read + navigate
      list.querySelectorAll('.notif-item').forEach(item => {
        item.addEventListener('click', async () => {
          const id = item.dataset.notifId;
          const link = item.dataset.link;
          await fetch('/api/notifications/' + encodeURIComponent(id) + '/read', { method: 'POST' });
          item.classList.remove('unread');
          if (link) window.location.hash = link.replace('#', '');
          document.getElementById('notif-dropdown').style.display = 'none';
          this.poll();
        });
      });

      this._updateBadge(data.unread || 0);
    } catch (e) {}
  },

  _updateBadge(count) {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
    this._lastCount = count;
  }
};

function _notifIcon(type) {
  switch(type) {
    case 'draft_pending': return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    case 'hot_lead': return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-orange)" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>';
    case 'campaign_milestone': return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    default: return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg>';
  }
}

function _esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function _relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'a l\'instant';
  if (mins < 60) return mins + ' min';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  const days = Math.floor(hrs / 24);
  return days + 'j';
}

// Init when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Delay init slightly to let app.js load user info first
  setTimeout(() => Notifications.init(), 500);
});
