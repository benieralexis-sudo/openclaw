/* ===== UNIBOX — Conversations par Lead ===== */

window.Pages = window.Pages || {};

(function() {
  let _currentFilter = 'all';
  let _searchQuery = '';
  let _selectedEmail = null;
  let _conversations = [];
  let _searchTimeout = null;
  let _refreshInterval = null;

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

  function sanitizeBody(text) {
    if (!text) return '';
    // Escape HTML entities then convert newlines
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
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
      '<button class="ub-back-btn" onclick="document.getElementById(\'ub-thread\').classList.remove(\'ub-thread-mobile-active\')" aria-label="Retour">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
      '</button>' +
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
        '<button class="ub-profile-btn" data-action="open-prospect" data-param="' + Utils.escapeHtml(p.email) + '" title="Voir profil"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></button>' +
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

      const bodyHtml = sanitizeBody(msg.body);

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

    // Reply zone
    html += '<div class="ub-reply-zone">' +
      '<div class="ub-reply-actions-top">' +
        '<button class="ub-suggest-btn" id="ub-suggest-btn" title="Suggestions IA">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/><line x1="9" y1="21" x2="15" y2="21"/></svg>' +
          ' Suggestions IA' +
        '</button>' +
        '<button class="ub-handoff-toggle' + (data.handoff ? ' ub-handoff-active' : '') + '" id="ub-handoff-toggle" data-email="' + Utils.escapeHtml(p.email) + '" title="' + (data.handoff ? 'Relâcher au bot' : 'Prendre en main') + '">' +
          (data.handoff ? '🤝 Handoff actif — Cliquer pour relâcher' : '🤖 Bot actif — Prendre en main') +
        '</button>' +
      '</div>' +
      '<div id="ub-suggestions" class="ub-suggestions" style="display:none"></div>' +
      '<div class="ub-reply-input-wrap">' +
        '<textarea id="ub-reply-input" class="ub-reply-input" placeholder="Écrire une réponse..." rows="3"></textarea>' +
        '<button id="ub-send-btn" class="ub-send-btn" title="Envoyer">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';

    return html;
  }

  let _advancedFilters = {};

  async function loadConversations(silent) {
    const data = await API.conversations(_currentFilter, _searchQuery, null, _advancedFilters);
    if (!data) return;
    _conversations = data.conversations || [];

    const listEl = document.getElementById('ub-conv-list');
    if (listEl) {
      listEl.innerHTML = renderConversationList(_conversations);
    }

    // Update header count
    var countEl = document.getElementById('ub-count');
    if (countEl) {
      countEl.textContent = data.total > 0 ? '(' + data.total + ')' : '';
    }

    // Update unibox badge
    var unreadCount = _conversations.filter(function(c) { return c.unread; }).length;
    var badge = document.getElementById('badge-unibox');
    if (badge) {
      if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }

    // Re-highlight selected conversation if we have one
    if (_selectedEmail && !silent) {
      document.querySelectorAll('.ub-conv-item').forEach(function(el) {
        el.classList.toggle('ub-conv-active', el.dataset.email === _selectedEmail);
      });
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
      var msgsEl = threadEl.querySelector('.ub-thread-messages');
      if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;

      // Bind send button
      var sendBtn = document.getElementById('ub-send-btn');
      var replyInput = document.getElementById('ub-reply-input');
      if (sendBtn && replyInput) {
        sendBtn.addEventListener('click', async function() {
          var body = replyInput.value.trim();
          if (!body) return;
          sendBtn.disabled = true;
          sendBtn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px"></div>';
          var result = await API.post('conversations/' + encodeURIComponent(email) + '/reply', { body: body });
          if (result && result.success) {
            replyInput.value = '';
            if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast('Réponse envoyée');
            // Reload thread to show the new message
            setTimeout(function() { loadThread(email); }, 1000);
          } else {
            if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast('Erreur d\'envoi : ' + ((result && result.error) || 'inconnue'));
          }
          sendBtn.disabled = false;
          sendBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
        });

        // Ctrl+Enter to send
        replyInput.addEventListener('keydown', function(ev) {
          if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
            ev.preventDefault();
            sendBtn.click();
          }
        });
      }

      // Bind AI suggestions button
      var suggestBtn = document.getElementById('ub-suggest-btn');
      if (suggestBtn) {
        suggestBtn.addEventListener('click', async function() {
          var sugBox = document.getElementById('ub-suggestions');
          if (!sugBox) return;
          suggestBtn.disabled = true;
          suggestBtn.textContent = 'Génération...';
          sugBox.style.display = '';
          sugBox.innerHTML = '<div class="ub-loading" style="padding:12px"><div class="spinner"></div></div>';

          var result = await API.post('conversations/' + encodeURIComponent(email) + '/suggest', {});
          suggestBtn.disabled = false;
          suggestBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/><line x1="9" y1="21" x2="15" y2="21"/></svg> Suggestions IA';

          if (result && result.suggestions && result.suggestions.length > 0) {
            sugBox.innerHTML = result.suggestions.map(function(s, i) {
              return '<div class="ub-suggestion" data-idx="' + i + '">' +
                '<div class="ub-suggestion-body">' + Utils.escapeHtml(s.body) + '</div>' +
                '<div class="ub-suggestion-meta">' +
                  '<span class="ub-suggestion-tone">' + (s.tone || '') + '</span>' +
                  '<span class="ub-suggestion-conf">' + Math.round((s.confidence || 0) * 100) + '% confiance</span>' +
                '</div>' +
              '</div>';
            }).join('');

            // Click suggestion → insert in textarea
            sugBox.querySelectorAll('.ub-suggestion').forEach(function(el) {
              el.addEventListener('click', function() {
                var idx = parseInt(el.dataset.idx);
                if (replyInput && result.suggestions[idx]) {
                  replyInput.value = result.suggestions[idx].body;
                  replyInput.focus();
                  sugBox.style.display = 'none';
                }
              });
            });
          } else {
            sugBox.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">Aucune suggestion disponible</div>';
          }
        });
      }

      // Bind handoff toggle
      var handoffBtn = document.getElementById('ub-handoff-toggle');
      if (handoffBtn) {
        handoffBtn.addEventListener('click', async function() {
          var isActive = handoffBtn.classList.contains('ub-handoff-active');
          handoffBtn.disabled = true;
          var result = await API.post('conversations/' + encodeURIComponent(email) + '/handoff', { active: !isActive });
          handoffBtn.disabled = false;
          if (result && result.success) {
            if (isActive) {
              handoffBtn.classList.remove('ub-handoff-active');
              handoffBtn.textContent = '🤖 Bot actif — Prendre en main';
              if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast('Bot réactivé');
            } else {
              handoffBtn.classList.add('ub-handoff-active');
              handoffBtn.textContent = '🤝 Handoff actif — Cliquer pour relâcher';
              if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast('Handoff activé — le bot ne répondra plus');
            }
          }
        });
      }
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

    // Clear previous refresh interval
    if (_refreshInterval) { clearInterval(_refreshInterval); _refreshInterval = null; }

    container.innerHTML = '<div class="page-enter">' +
      '<div class="ub-page-header">' +
        '<div>' +
          '<h1 class="page-title">Unibox <span id="ub-count" class="ub-header-count"></span></h1>' +
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
            '<button class="ub-filter-btn ub-filter-advanced-toggle" id="ub-toggle-advanced" title="Filtres avances">⚙</button>' +
          '</div>' +
          '<div id="ub-advanced-filters" class="ub-advanced-filters" style="display:none">' +
            '<div class="ub-af-row">' +
              '<label class="ub-af-label">Du</label>' +
              '<input type="date" id="ub-filter-from" class="ub-af-input">' +
              '<label class="ub-af-label">Au</label>' +
              '<input type="date" id="ub-filter-to" class="ub-af-input">' +
            '</div>' +
            '<div class="ub-af-row">' +
              '<button class="ub-af-clear" id="ub-clear-advanced">Effacer filtres</button>' +
            '</div>' +
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

    // Bind advanced filters toggle
    var toggleAdvanced = document.getElementById('ub-toggle-advanced');
    if (toggleAdvanced) {
      toggleAdvanced.addEventListener('click', function() {
        var panel = document.getElementById('ub-advanced-filters');
        if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
      });
    }
    var filterFrom = document.getElementById('ub-filter-from');
    var filterTo = document.getElementById('ub-filter-to');
    if (filterFrom) {
      filterFrom.addEventListener('change', function() {
        _advancedFilters.dateFrom = filterFrom.value || undefined;
        loadConversations();
      });
    }
    if (filterTo) {
      filterTo.addEventListener('change', function() {
        _advancedFilters.dateTo = filterTo.value || undefined;
        loadConversations();
      });
    }
    var clearAdvanced = document.getElementById('ub-clear-advanced');
    if (clearAdvanced) {
      clearAdvanced.addEventListener('click', function() {
        _advancedFilters = {};
        if (filterFrom) filterFrom.value = '';
        if (filterTo) filterTo.value = '';
        loadConversations();
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

    // Bind keyboard navigation
    var _keyHandler = function(ev) {
      if (App.currentPage !== 'unibox') return;
      if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;

      if (ev.key === 'ArrowDown' || ev.key === 'j') {
        ev.preventDefault();
        var idx = _conversations.findIndex(function(c) { return c.prospectEmail === _selectedEmail; });
        if (idx < _conversations.length - 1) {
          loadThread(_conversations[idx + 1].prospectEmail);
        }
      } else if (ev.key === 'ArrowUp' || ev.key === 'k') {
        ev.preventDefault();
        var idx2 = _conversations.findIndex(function(c) { return c.prospectEmail === _selectedEmail; });
        if (idx2 > 0) {
          loadThread(_conversations[idx2 - 1].prospectEmail);
        }
      } else if (ev.key === 'Escape') {
        // Mobile: go back to list
        var threadEl = document.getElementById('ub-thread');
        if (threadEl) threadEl.classList.remove('ub-thread-mobile-active');
      }
    };
    document.addEventListener('keydown', _keyHandler);

    // Load conversations
    await loadConversations();

    // Auto-select first conversation on desktop
    if (_conversations.length > 0 && window.innerWidth >= 768) {
      loadThread(_conversations[0].prospectEmail);
    }

    // SSE-driven refresh instead of polling
    function _onConversationUpdate() {
      if (App.currentPage !== 'unibox') return;
      if (document.visibilityState === 'hidden') return;
      loadConversations(true);
    }
    API.onEvent('conversation_update', _onConversationUpdate);
    API.onEvent('new_reply', _onConversationUpdate);

    // Fallback: light polling every 60s
    _refreshInterval = setInterval(function() {
      if (App.currentPage !== 'unibox') { clearInterval(_refreshInterval); _refreshInterval = null; API.offEvent('conversation_update', _onConversationUpdate); API.offEvent('new_reply', _onConversationUpdate); return; }
      if (document.visibilityState === 'hidden') return;
      loadConversations(true);
    }, 60000);
  };
})();
