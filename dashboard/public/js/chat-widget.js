/* ===== Chat Widget (bulle flottante persistante) ===== */
(function() {
  const widget = document.getElementById('chat-widget');
  const btn = document.getElementById('chat-widget-btn');
  const popup = document.getElementById('chat-widget-popup');
  if (!btn || !popup) return;

  let isOpen = false;

  btn.addEventListener('click', () => {
    isOpen = !isOpen;
    popup.style.display = isOpen ? 'flex' : 'none';
    btn.classList.toggle('active', isOpen);
    if (isOpen) {
      renderWidgetMessages();
      const input = document.getElementById('chat-widget-input');
      if (input) input.focus();
    }
  });

  function renderWidgetMessages() {
    const history = JSON.parse(sessionStorage.getItem('mc_chat') || '[]');
    const recent = history.slice(-8);
    const el = document.getElementById('chat-widget-messages');
    if (!el) return;
    if (recent.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:30px 16px;color:var(--text-muted);font-size:13px">Posez une question au bot</div>';
    } else {
      el.innerHTML = recent.map(m => {
        const text = Utils.escapeHtml(m.text).replace(/\n/g, '<br>');
        return m.role === 'user'
          ? `<div class="cw-msg cw-msg-user">${text}</div>`
          : `<div class="cw-msg cw-msg-bot">${text}</div>`;
      }).join('');
      el.scrollTop = el.scrollHeight;
    }
  }

  const input = document.getElementById('chat-widget-input');
  const sendBtn = document.getElementById('chat-widget-send');

  async function sendWidgetMessage() {
    const text = (input?.value || '').trim();
    if (!text) return;
    input.value = '';
    if (sendBtn) { sendBtn.disabled = true; }

    const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const history = JSON.parse(sessionStorage.getItem('mc_chat') || '[]');
    history.push({ role: 'user', text, time: now });
    sessionStorage.setItem('mc_chat', JSON.stringify(history.slice(-100)));
    renderWidgetMessages();

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await resp.json();
      const botText = data.text || data.error || 'Pas de réponse';
      const updated = JSON.parse(sessionStorage.getItem('mc_chat') || '[]');
      updated.push({ role: 'bot', text: botText, skill: data.skill || '', time: now });
      sessionStorage.setItem('mc_chat', JSON.stringify(updated.slice(-100)));
    } catch (err) {
      const updated = JSON.parse(sessionStorage.getItem('mc_chat') || '[]');
      updated.push({ role: 'bot', text: 'Erreur: ' + err.message, skill: 'error', time: now });
      sessionStorage.setItem('mc_chat', JSON.stringify(updated.slice(-100)));
    }

    if (sendBtn) { sendBtn.disabled = false; }
    renderWidgetMessages();
  }

  // Command autocomplete for /commands
  const CHAT_COMMANDS = [
    { cmd: '/stats', desc: 'Statistiques du jour' },
    { cmd: '/approve', desc: 'Approuver le premier brouillon' },
    { cmd: '/leads', desc: 'Nombre de leads' },
    { cmd: '/pipeline', desc: 'Status pipeline' },
    { cmd: '/rapport', desc: 'Generer un rapport' },
    { cmd: '/pause', desc: 'Mettre en pause' },
    { cmd: '/resume', desc: 'Reprendre' }
  ];

  function showCommandHints(query) {
    let hintsEl = document.getElementById('cw-cmd-hints');
    if (!hintsEl) {
      hintsEl = document.createElement('div');
      hintsEl.id = 'cw-cmd-hints';
      hintsEl.style.cssText = 'position:absolute;bottom:100%;left:0;right:0;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);max-height:160px;overflow-y:auto;z-index:10;margin-bottom:4px';
      input.parentElement.style.position = 'relative';
      input.parentElement.appendChild(hintsEl);
    }
    const q = query.toLowerCase();
    const matches = CHAT_COMMANDS.filter(c => c.cmd.includes(q));
    if (matches.length === 0) { hintsEl.style.display = 'none'; return; }
    hintsEl.style.display = '';
    hintsEl.innerHTML = matches.map(c =>
      '<div class="cw-cmd-hint" data-cmd="' + c.cmd + '" style="padding:6px 10px;cursor:pointer;font-size:12px;display:flex;gap:8px;transition:background 0.1s">' +
        '<span style="color:var(--accent-blue);font-weight:500">' + c.cmd + '</span>' +
        '<span style="color:var(--text-muted)">' + c.desc + '</span>' +
      '</div>'
    ).join('');
    hintsEl.querySelectorAll('.cw-cmd-hint').forEach(el => {
      el.addEventListener('click', () => {
        input.value = el.dataset.cmd + ' ';
        input.focus();
        hintsEl.style.display = 'none';
      });
      el.addEventListener('mouseenter', () => { el.style.background = 'var(--bg-card-hover)'; });
      el.addEventListener('mouseleave', () => { el.style.background = ''; });
    });
  }

  if (input) {
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); sendWidgetMessage(); const h = document.getElementById('cw-cmd-hints'); if (h) h.style.display = 'none'; }
    });
    input.addEventListener('input', () => {
      const val = input.value;
      if (val.startsWith('/') && val.length >= 1) {
        showCommandHints(val);
      } else {
        const h = document.getElementById('cw-cmd-hints'); if (h) h.style.display = 'none';
      }
    });
  }
  if (sendBtn) {
    sendBtn.addEventListener('click', sendWidgetMessage);
  }

  // Masquer le widget quand on est sur la page chat plein écran
  function checkChatPage() {
    const hash = (window.location.hash || '').replace('#', '');
    if (widget) widget.style.display = hash === 'chat' ? 'none' : '';
  }
  window.addEventListener('hashchange', checkChatPage);
  checkChatPage();

  // Fermer avec Escape
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && isOpen) {
      isOpen = false;
      popup.style.display = 'none';
      btn.classList.remove('active');
    }
  });

  // Fermer si on clique sur "plein écran"
  popup.addEventListener('click', (ev) => {
    if (ev.target.closest('.chat-widget-fullscreen')) {
      isOpen = false;
      popup.style.display = 'none';
      btn.classList.remove('active');
    }
  });
})();
