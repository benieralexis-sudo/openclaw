/* ===== PROSPECT DRAWER — Profile + Timeline ===== */

const ProspectDrawer = {
  _open: false,
  _currentEmail: null,

  open(email) {
    if (!email) return;
    this._currentEmail = email;
    this._open = true;
    this._render(email);
  },

  close() {
    this._open = false;
    this._currentEmail = null;
    const drawer = document.getElementById('prospect-drawer');
    if (drawer) {
      drawer.classList.remove('open');
      setTimeout(() => { drawer.innerHTML = ''; }, 300);
    }
    const overlay = document.getElementById('drawer-overlay');
    if (overlay) overlay.classList.remove('visible');
  },

  async _render(email) {
    const drawer = document.getElementById('prospect-drawer');
    const overlay = document.getElementById('drawer-overlay');
    if (!drawer) return;

    // Show loading state
    drawer.classList.add('open');
    if (overlay) overlay.classList.add('visible');
    drawer.innerHTML = '<div class="drawer-loading"><div class="spinner"></div></div>';

    // Fetch data in parallel
    const [threadData, convData] = await Promise.all([
      API.conversationThread(email),
      API.conversations('all', email)
    ]);

    if (!this._open || this._currentEmail !== email) return;

    const prospect = (threadData && threadData.prospect) || {};
    const messages = (threadData && threadData.messages) || [];
    const convMatch = ((convData && convData.conversations) || []).find(c => c.prospectEmail === email);
    const _e = Utils.escapeHtml;

    const name = prospect.name || _nameFromEmail(email);
    const company = prospect.company || (email.split('@')[1] || '').replace(/\.(com|fr|io|co|net|org)$/i, '');
    const sentCount = messages.filter(m => m.type === 'sent').length;
    const receivedCount = messages.filter(m => m.type === 'received').length;
    const autoReplyCount = messages.filter(m => m.type === 'auto_reply').length;

    const sentimentColors = {
      interested: 'var(--accent-green)', positive: 'var(--accent-green)',
      question: 'var(--accent-blue)', objection: 'var(--accent-orange)',
      not_interested: 'var(--accent-red)', meeting: 'var(--accent-purple)',
      booking: 'var(--accent-purple)', out_of_office: 'var(--text-muted)'
    };
    const sentimentLabels = {
      interested: 'Interesse', positive: 'Interesse', question: 'Question',
      objection: 'Objection', not_interested: 'Pas interesse', meeting: 'RDV',
      booking: 'RDV', out_of_office: 'Absent'
    };
    const statusLabels = {
      contacted: 'Contacte', opened: 'Ouvert', replied: 'Repondu',
      interested: 'Interesse', meeting: 'RDV'
    };

    const sentiment = prospect.sentiment || (convMatch && convMatch.sentiment) || '';
    const status = prospect.status || (convMatch && convMatch.status) || 'contacted';
    const sentColor = sentimentColors[sentiment] || 'var(--text-muted)';

    // Build timeline from messages
    const timeline = messages.map(m => {
      const typeMap = {
        sent: { icon: '→', label: 'Email envoye', color: 'var(--accent-blue)' },
        received: { icon: '←', label: 'Reponse recue', color: 'var(--accent-green)' },
        auto_reply: { icon: '⟲', label: 'Reponse IA', color: 'var(--accent-purple)' }
      };
      const t = typeMap[m.type] || typeMap.sent;
      const dateStr = m.date ? new Date(m.date).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const snippet = (m.body || '').substring(0, 120).replace(/</g, '&lt;');
      return `<div class="tl-item">
        <div class="tl-dot" style="background:${t.color}"></div>
        <div class="tl-content">
          <div class="tl-header">
            <span class="tl-icon" style="color:${t.color}">${t.icon}</span>
            <span class="tl-label">${t.label}</span>
            <span class="tl-time">${dateStr}</span>
          </div>
          ${m.subject ? '<div class="tl-subject">' + _e(m.subject) + '</div>' : ''}
          <div class="tl-snippet">${snippet}</div>
        </div>
      </div>`;
    }).join('');

    drawer.innerHTML = `
      <div class="drawer-header">
        <button class="drawer-close" onclick="ProspectDrawer.close()" aria-label="Fermer">&times;</button>
        <div class="drawer-title">Profil prospect</div>
      </div>
      <div class="drawer-body">
        <div class="dp-profile">
          <div class="dp-avatar" style="background:${sentColor}20;color:${sentColor}">${_initials(name)}</div>
          <div class="dp-info">
            <div class="dp-name">${_e(name)}</div>
            <div class="dp-company">${_e(company)}</div>
            <div class="dp-email">${_e(email)}</div>
            ${prospect.title ? '<div class="dp-title">' + _e(prospect.title) + '</div>' : ''}
          </div>
        </div>

        <div class="dp-badges">
          ${sentiment ? '<span class="badge" style="background:' + sentColor + '20;color:' + sentColor + '">' + (sentimentLabels[sentiment] || sentiment) + '</span>' : ''}
          <span class="badge" style="background:var(--accent-blue-dim);color:var(--accent-blue)">${statusLabels[status] || status}</span>
          ${prospect.score != null ? '<span class="badge" style="background:var(--accent-orange-dim);color:var(--accent-orange)">Score ' + prospect.score + '/10</span>' : ''}
          ${threadData && threadData.handoff ? '<span class="badge" style="background:var(--accent-purple-dim);color:var(--accent-purple)">Handoff actif</span>' : ''}
        </div>

        <div class="dp-stats">
          <div class="dp-stat"><span class="dp-stat-value">${sentCount}</span><span class="dp-stat-label">Envoyes</span></div>
          <div class="dp-stat"><span class="dp-stat-value">${receivedCount}</span><span class="dp-stat-label">Reponses</span></div>
          <div class="dp-stat"><span class="dp-stat-value">${autoReplyCount}</span><span class="dp-stat-label">Auto-IA</span></div>
        </div>

        <div class="dp-actions">
          <button class="dp-action-btn" onclick="window.location.hash='unibox';setTimeout(function(){document.querySelector('[data-email=&quot;${_e(email)}&quot;]')&&document.querySelector('[data-email=&quot;${_e(email)}&quot;]').click()},300)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Conversation
          </button>
        </div>

        <div class="dp-section">
          <div class="dp-section-title">Timeline</div>
          <div class="dp-timeline">${timeline || '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">Aucun evenement</div>'}</div>
        </div>
      </div>
    `;
  }
};

function _initials(name) {
  if (!name) return '?';
  var parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].substring(0, 2).toUpperCase();
}

function _nameFromEmail(email) {
  if (!email) return '?';
  var local = email.split('@')[0] || '';
  var parts = local.split(/[._-]/);
  if (parts.length >= 2) return parts.map(function(p) { return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); }).join(' ');
  return local.charAt(0).toUpperCase() + local.slice(1);
}
