/* ===== UNIBOX — Conversations par Lead ===== */

window.Pages = window.Pages || {};

(function() {
  let _currentFilter = 'all';
  let _searchQuery = '';
  let _selectedEmail = null;
  let _conversations = [];
  let _searchTimeout = null;

  const SENTIMENT_MAP = {
    interested: { label: 'Intéressé', color: 'var(--accent-green)', bg: 'var(--accent-green-dim)', icon: '●' },
    positive: { label: 'Intéressé', color: 'var(--accent-green)', bg: 'var(--accent-green-dim)', icon: '●' },
    question: { label: 'Question', color: 'var(--accent-blue)', bg: 'var(--accent-blue-dim)', icon: '?' },
    objection: { label: 'Objection', color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)', icon: '!' },
    not_interested: { label: 'Pas intéressé', color: 'var(--accent-red)', bg: 'var(--accent-red-dim)', icon: '✕' },
    meeting: { label: 'RDV', color: 'var(--accent-purple)', bg: 'var(--accent-purple-dim)', icon: '★' },
    booking: { label: 'RDV', color: 'var(--accent-purple)', bg: 'var(--accent-purple-dim)', icon: '★' },
    out_of_office: { label: 'Absent', color: 'var(--text-muted)', bg: 'var(--bg-card)', icon: '○' }
  };

  const STATUS_MAP = {
    contacted: { label: 'Contacté', color: 'var(--text-muted)' },
    opened: { label: 'Ouvert', color: 'var(--accent-cyan)' },
    replied: { label: 'Répondu', color: 'var(--accent-blue)' },
    interested: { label: 'Intéressé', color: 'var(--accent-green)' },
    meeting: { label: 'RDV', color: 'var(--accent-purple)' }
  };

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "À l'instant";
    if (mins < 60) return mins + ' min';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + 'j';
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return weeks + ' sem';
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  function initials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].substring(0, 2).toUpperCase();
  }

  function nameFromEmail(email) {
    if (!email) return '?';
    var local = email.split('@')[0] || '';
    // Try to parse first.last or first_last
    var parts = local.split(/[._-]/);
    if (parts.length >= 2) {
      return parts.map(function(p) { return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); }).join(' ');
    }
    return local.charAt(0).toUpperCase() + local.slice(1);
  }

  function sentimentBadge(sentiment) {
    const s = SENTIMENT_MAP[sentiment];
    if (!s) return '';
    return '<span class="ub-sentiment-badge" style="background:' + s.bg + ';color:' + s.color + '">' + s.icon + ' ' + s.label + '</span>';
  }

  function renderConversationList(conversations) {
    if (!conversations || conversations.length === 0) {
      return '<div class="ub-empty"><div class="ub-empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2 8 12 14 22 8"/></svg></div><p>Aucune conversation</p><p class="ub-empty-sub">Les conversations apparaîtront ici quand les prospects répondront à vos emails.</p></div>';
    }

    return conversations.map(function(c) {
      const isActive = _selectedEmail === c.prospectEmail;
      const unreadClass = c.unread ? ' ub-conv-unread' : '';
      const activeClass = isActive ? ' ub-conv-active' : '';
      const name = c.prospectName || nameFromEmail(c.prospectEmail);
      const companyDisplay = c.company || (c.prospectEmail.split('@')[1] || '').replace(/\.(com|fr|io|co|net|org)$/i, '');
      const companyText = companyDisplay ? '<span class="ub-conv-company">' + Utils.escapeHtml(companyDisplay) + '</span>' : '';
      const lastMsg = c.lastMessage ? Utils.escapeHtml(c.lastMessage.substring(0, 80)) : '';
      const msgIcon = c.lastMessageType === 'received' ? '←' : c.lastMessageType === 'auto_reply' ? '⟲' : '→';

      return '<div class="ub-conv-item' + unreadClass + activeClass + '" data-email="' + Utils.escapeHtml(c.prospectEmail) + '">' +
        '<div class="ub-conv-avatar" style="background:' + (SENTIMENT_MAP[c.sentiment] || {}).bg + ';color:' + ((SENTIMENT_MAP[c.sentiment] || {}).color || 'var(--text-muted)') + '">' + initials(c.prospectName) + '</div>' +
        '<div class="ub-conv-content">' +
          '<div class="ub-conv-header">' +
            '<span class="ub-conv-name">' + Utils.escapeHtml(name) + '</span>' +
            '<span class="ub-conv-time">' + timeAgo(c.lastMessageAt) + '</span>' +
          '</div>' +
          (companyText ? '<div class="ub-conv-meta">' + companyText + '</div>' : '') +
          '<div class="ub-conv-preview">' +
            '<span class="ub-conv-direction">' + msgIcon + '</span> ' + lastMsg +
          '</div>' +
          '<div class="ub-conv-footer">' +
            sentimentBadge(c.sentiment) +
            '<span class="ub-conv-counts">' + c.totalSent + ' envoyé' + (c.totalSent > 1 ? 's' : '') +
              (c.totalReceived > 0 ? ' · ' + c.totalReceived + ' réponse' + (c.totalReceived > 1 ? 's' : '') : '') +
            '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderThread(data) {
    if (!data || !data.messages || data.messages.length === 0) {
      return '<div class="ub-thread-empty"><div class="ub-empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><p>Aucun message dans cette conversation</p></div>';
    }

    const p = data.prospect || {};
    const s = STATUS_MAP[p.status] || STATUS_MAP.contacted;

    let html = '<div class="ub-thread-header">' +
      '<div class="ub-thread-prospect">' +
        '<div class="ub-thread-avatar" style="background:' + (SENTIMENT_MAP[p.sentiment] || {}).bg + ';color:' + ((SENTIMENT_MAP[p.sentiment] || {}).color || 'var(--text-muted)') + '">' + initials(p.name) + '</div>' +
        '<div class="ub-thread-info">' +
          '<div class="ub-thread-name">' + Utils.escapeHtml(p.name || p.email) + '</div>' +
          '<div class="ub-thread-meta">' +
            (p.title ? Utils.escapeHtml(p.title) + ' — ' : '') +
            (p.company ? Utils.escapeHtml(p.company) : '') +
            ' · <span style="color:' + s.color + '">' + s.label + '</span>' +
            (p.score != null ? ' · Score ' + p.score + '/10' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ub-thread-actions">' +
        (data.handoff ? '<span class="ub-handoff-badge">🤝 Handoff actif</span>' : '') +
      '</div>' +
    '</div>';

    html += '<div class="ub-thread-messages">';

    for (const msg of data.messages) {
      const isSent = msg.type === 'sent' || msg.type === 'auto_reply';
      const bubbleClass = isSent ? 'ub-msg-sent' : 'ub-msg-received';
      const typeLabel = msg.type === 'auto_reply' ? '<span class="ub-msg-auto">IA</span>' : '';
      const time = msg.date ? new Date(msg.date).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

      let metaInfo = '';
      if (msg.type === 'sent') {
        const statusIcon = msg.openedAt ? '👁' : msg.status === 'delivered' ? '✓✓' : msg.status === 'sent' ? '✓' : '';
        metaInfo = statusIcon + (msg.stepNumber != null ? ' Step ' + msg.stepNumber : '');
      } else if (msg.type === 'received' && msg.sentiment) {
        metaInfo = sentimentBadge(msg.sentiment);
      } else if (msg.type === 'auto_reply' && msg.confidence != null) {
        metaInfo = 'Confiance ' + Math.round(msg.confidence * 100) + '%';
      }

      const bodyHtml = (msg.body || '').replace(/\n/g, '<br>');

      html += '<div class="ub-msg ' + bubbleClass + '">' +
        '<div class="ub-msg-bubble">' +
          (msg.subject ? '<div class="ub-msg-subject">' + Utils.escapeHtml(msg.subject) + '</div>' : '') +
          '<div class="ub-msg-body">' + bodyHtml + '</div>' +
          '<div class="ub-msg-footer">' +
            typeLabel +
            '<span class="ub-msg-time">' + time + '</span>' +
            (metaInfo ? '<span class="ub-msg-meta">' + metaInfo + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }

    html += '</div>';

    return html;
  }

  async function loadConversations() {
    const data = await API.conversations(_currentFilter, _searchQuery);
    if (!data) return;
    _conversations = data.conversations || [];

    const listEl = document.getElementById('ub-conv-list');
    if (listEl) {
      listEl.innerHTML = renderConversationList(_conversations);
    }

    // Update unibox badge
    const unreadCount = _conversations.filter(function(c) { return c.unread; }).length;
    const badge = document.getElementById('badge-unibox');
    if (badge) {
      if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  async function loadThread(email) {
    _selectedEmail = email;

    // Highlight active conversation
    document.querySelectorAll('.ub-conv-item').forEach(function(el) {
      el.classList.toggle('ub-conv-active', el.dataset.email === email);
      if (el.dataset.email === email) el.classList.remove('ub-conv-unread');
    });

    const threadEl = document.getElementById('ub-thread');
    if (threadEl) {
      threadEl.innerHTML = '<div class="ub-thread-loading"><div class="spinner"></div></div>';
    }

    const data = await API.conversationThread(email);
    if (threadEl) {
      threadEl.innerHTML = renderThread(data);
      // Scroll to bottom of messages
      const msgsEl = threadEl.querySelector('.ub-thread-messages');
      if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
    }
  }

  Pages.unibox = async function(container) {
    const filterButtons = [
      { key: 'all', label: 'Tout' },
      { key: 'interested', label: 'Intéressés' },
      { key: 'question', label: 'Questions' },
      { key: 'objection', label: 'Objections' },
      { key: 'not_interested', label: 'Pas intéressés' }
    ];

    container.innerHTML = '<div class="page-enter">' +
      '<div class="ub-page-header">' +
        '<div>' +
          '<h1 class="page-title">Unibox</h1>' +
          '<p class="page-subtitle">Toutes les conversations avec vos prospects</p>' +
        '</div>' +
      '</div>' +
      '<div class="ub-container">' +
        '<div class="ub-sidebar">' +
          '<div class="ub-search-wrap">' +
            '<svg class="ub-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '<input type="text" id="ub-search" class="ub-search" placeholder="Rechercher un prospect..." autocomplete="off">' +
          '</div>' +
          '<div class="ub-filters">' +
            filterButtons.map(function(f) {
              return '<button class="ub-filter-btn' + (f.key === _currentFilter ? ' ub-filter-active' : '') + '" data-filter="' + f.key + '">' + f.label + '</button>';
            }).join('') +
          '</div>' +
          '<div id="ub-conv-list" class="ub-conv-list">' +
            Array.from({length: 6}, function() {
              return '<div class="ub-skeleton-item">' +
                '<div class="ub-skeleton-avatar"></div>' +
                '<div class="ub-skeleton-lines">' +
                  '<div class="ub-skeleton-line"></div>' +
                  '<div class="ub-skeleton-line"></div>' +
                  '<div class="ub-skeleton-line"></div>' +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div id="ub-thread" class="ub-thread">' +
          '<div class="ub-thread-empty">' +
            '<div class="ub-empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>' +
            '<p>Sélectionne une conversation</p>' +
            '<p class="ub-empty-sub">Clique sur un prospect à gauche pour voir l\'historique complet des échanges.</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Bind filter buttons
    container.querySelectorAll('.ub-filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _currentFilter = btn.dataset.filter;
        container.querySelectorAll('.ub-filter-btn').forEach(function(b) { b.classList.remove('ub-filter-active'); });
        btn.classList.add('ub-filter-active');
        loadConversations();
      });
    });

    // Bind search
    var searchInput = document.getElementById('ub-search');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        clearTimeout(_searchTimeout);
        _searchTimeout = setTimeout(function() {
          _searchQuery = searchInput.value.trim();
          loadConversations();
        }, 300);
      });
    }

    // Bind conversation clicks (delegation)
    var listEl = document.getElementById('ub-conv-list');
    if (listEl) {
      listEl.addEventListener('click', function(ev) {
        var item = ev.target.closest('.ub-conv-item');
        if (item && item.dataset.email) {
          loadThread(item.dataset.email);

          // On mobile, show thread panel
          var threadEl = document.getElementById('ub-thread');
          if (threadEl && window.innerWidth < 768) {
            threadEl.classList.add('ub-thread-mobile-active');
          }
        }
      });
    }

    // Load conversations
    await loadConversations();

    // Auto-select first conversation on desktop
    if (_conversations.length > 0 && window.innerWidth >= 768) {
      loadThread(_conversations[0].prospectEmail);
    }
  };
})();
