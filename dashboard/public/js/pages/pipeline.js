/* ===== PIPELINE — Kanban visuel des leads ===== */

window.Pages = window.Pages || {};

(function() {
  const STAGES = [
    { key: 'contacted', label: 'Contacté', color: 'var(--text-muted)', icon: '→' },
    { key: 'opened', label: 'Ouvert', color: 'var(--accent-cyan)', icon: '👁' },
    { key: 'replied', label: 'Répondu', color: 'var(--accent-blue)', icon: '↩' },
    { key: 'interested', label: 'Intéressé', color: 'var(--accent-green)', icon: '●' },
    { key: 'meeting', label: 'RDV Booké', color: 'var(--accent-purple)', icon: '★' }
  ];

  function initials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].substring(0, 2).toUpperCase();
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var diff = Date.now() - new Date(dateStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + ' min';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h';
    var days = Math.floor(hours / 24);
    return days + 'j';
  }

  Pages.pipeline = async function(container) {
    container.innerHTML = '<div class="page-enter">' +
      '<div class="pl-page-header">' +
        '<div>' +
          '<h1 class="page-title">Pipeline</h1>' +
          '<p class="page-subtitle">Vue d\'ensemble de tous vos prospects par étape</p>' +
        '</div>' +
      '</div>' +
      '<div class="pl-board" id="pl-board">' +
        '<div class="pl-summary" style="opacity:0.4">' +
          '<div class="pl-summary-item"><div class="ub-skeleton-line" style="width:60px;height:28px;margin:0 auto 8px"></div><div class="ub-skeleton-line" style="width:80px;height:12px;margin:0 auto"></div></div>'.repeat(4) +
        '</div>' +
        '<div class="pl-columns" style="opacity:0.4">' +
          '<div class="pl-column"><div class="pl-column-header"><div class="ub-skeleton-line" style="width:80px;height:14px"></div></div></div>'.repeat(5) +
        '</div>' +
      '</div>' +
    '</div>';

    // Load data from conversations endpoint (reuse the same data)
    var data = await API.conversations('all', '', 1);
    if (!data || !data.conversations) {
      document.getElementById('pl-board').innerHTML = '<div class="ub-empty"><div class="ub-empty-icon">📊</div><p>Aucun prospect dans le pipeline</p></div>';
      return;
    }

    // Group conversations by status
    var stages = {};
    STAGES.forEach(function(s) { stages[s.key] = []; });

    data.conversations.forEach(function(c) {
      var status = c.status || 'contacted';
      if (!stages[status]) status = 'contacted';
      stages[status].push(c);
    });

    // Render kanban board
    var boardHtml = '<div class="pl-columns">';

    STAGES.forEach(function(stage) {
      var items = stages[stage.key] || [];
      boardHtml += '<div class="pl-column" data-stage="' + stage.key + '">' +
        '<div class="pl-column-header">' +
          '<div class="pl-column-title">' +
            '<span class="pl-column-icon" style="color:' + stage.color + '">' + stage.icon + '</span>' +
            '<span>' + stage.label + '</span>' +
          '</div>' +
          '<span class="pl-column-count" style="background:' + stage.color + '">' + items.length + '</span>' +
        '</div>' +
        '<div class="pl-column-body">';

      if (items.length === 0) {
        boardHtml += '<div class="pl-empty-col">Aucun prospect</div>';
      } else {
        items.forEach(function(c) {
          var name = c.prospectName || (function(email) {
            var local = (email || '').split('@')[0] || '';
            var parts = local.split(/[._-]/);
            if (parts.length >= 2) return parts.map(function(p) { return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); }).join(' ');
            return local.charAt(0).toUpperCase() + local.slice(1);
          })(c.prospectEmail);
          var sentimentColor = stage.color;

          boardHtml += '<div class="pl-card" data-email="' + Utils.escapeHtml(c.prospectEmail) + '">' +
            '<div class="pl-card-header">' +
              '<div class="pl-card-avatar" style="background:' + stage.color + '22;color:' + stage.color + '">' + initials(c.prospectName) + '</div>' +
              '<div class="pl-card-info">' +
                '<div class="pl-card-name">' + Utils.escapeHtml(name) + '</div>' +
                (c.company ? '<div class="pl-card-company">' + Utils.escapeHtml(c.company) + '</div>' : '') +
              '</div>' +
            '</div>' +
            '<div class="pl-card-meta">' +
              '<span>' + c.totalSent + ' email' + (c.totalSent > 1 ? 's' : '') + '</span>' +
              (c.totalReceived > 0 ? '<span>' + c.totalReceived + ' réponse' + (c.totalReceived > 1 ? 's' : '') + '</span>' : '') +
              '<span>' + timeAgo(c.lastMessageAt) + '</span>' +
            '</div>' +
            (c.lastMessage ? '<div class="pl-card-preview">' + Utils.escapeHtml(c.lastMessage.substring(0, 60)) + '</div>' : '') +
          '</div>';
        });
      }

      boardHtml += '</div></div>';
    });

    boardHtml += '</div>';

    // Summary bar
    var total = data.conversations.length;
    var interestedCount = (stages.interested || []).length + (stages.meeting || []).length;
    var repliedCount = (stages.replied || []).length + interestedCount;
    var replyRate = total > 0 ? Math.round((repliedCount / total) * 100) : 0;

    var summaryHtml = '<div class="pl-summary">' +
      '<div class="pl-summary-item"><span class="pl-summary-val">' + total + '</span><span class="pl-summary-label">Total prospects</span></div>' +
      '<div class="pl-summary-item"><span class="pl-summary-val" style="color:var(--accent-blue)">' + repliedCount + '</span><span class="pl-summary-label">Ont répondu</span></div>' +
      '<div class="pl-summary-item"><span class="pl-summary-val" style="color:var(--accent-green)">' + interestedCount + '</span><span class="pl-summary-label">Intéressés + RDV</span></div>' +
      '<div class="pl-summary-item"><span class="pl-summary-val" style="color:var(--accent-cyan)">' + replyRate + '%</span><span class="pl-summary-label">Taux de réponse</span></div>' +
    '</div>';

    document.getElementById('pl-board').innerHTML = summaryHtml + boardHtml;

    // Bind card clicks → navigate to unibox
    document.getElementById('pl-board').addEventListener('click', function(ev) {
      var card = ev.target.closest('.pl-card');
      if (card && card.dataset.email) {
        window.location.hash = 'unibox';
        // Small delay to let the page load, then select the conversation
        setTimeout(function() {
          var items = document.querySelectorAll('.ub-conv-item');
          items.forEach(function(item) {
            if (item.dataset.email === card.dataset.email) {
              item.click();
            }
          });
        }, 500);
      }
    });
  };
})();
