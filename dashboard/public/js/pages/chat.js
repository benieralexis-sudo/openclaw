/* ===== Page: Chat (bridge Telegram ↔ Dashboard) ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

// Historique des messages persistant en session
const chatHistory = JSON.parse(sessionStorage.getItem('mc_chat') || '[]');
function saveChatHistory() {
  sessionStorage.setItem('mc_chat', JSON.stringify(chatHistory.slice(-100)));
}

Pages.chat = async function(container) {
  container.innerHTML = `
  <div class="page-enter stagger" style="height:calc(100vh - 80px);display:flex;flex-direction:column">
    <div class="page-header" style="flex-shrink:0">
      <h1 class="page-title">${Utils.icon('message-circle')} Chat</h1>
      <div class="page-actions">
        <button class="btn-export" data-action="clear-chat" style="padding:6px 14px;font-size:12px">Effacer</button>
      </div>
    </div>

    <div class="card" style="flex:1;display:flex;flex-direction:column;overflow:hidden;margin-bottom:0">
      <div id="chat-messages" style="flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px">
        ${chatHistory.length === 0 ? `
          <div class="chat-welcome">
            <div style="font-size:32px;margin-bottom:12px">${Utils.icon('message-circle', 32)}</div>
            <h3 style="color:var(--text-primary);margin-bottom:8px">Bienvenue dans le chat</h3>
            <p style="color:var(--text-muted);font-size:13px;max-width:400px;margin:0 auto">Posez vos questions au bot. Il utilise le même cerveau que sur Telegram.</p>
          </div>
        ` : chatHistory.map(m => renderMessage(m)).join('')}
      </div>

      <div id="chat-suggestions" style="padding:8px 20px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border);flex-shrink:0">
        ${['Rapport maintenant', 'Status pipeline', 'Combien de leads ?', 'Prochains emails ?'].map(s => `
          <button class="chat-suggestion" data-action="chat-suggestion" data-param="${e(s)}">${e(s)}</button>
        `).join('')}
      </div>

      <div style="padding:12px 20px;border-top:1px solid var(--border);flex-shrink:0;display:flex;gap:10px;align-items:center">
        <input type="text" id="chat-input" placeholder="Écrivez un message..." autocomplete="off"
          style="flex:1;padding:10px 16px;border:1px solid var(--border);border-radius:10px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px;font-family:inherit;outline:none;transition:border-color 0.2s">
        <button id="chat-send" data-action="send-chat" style="padding:10px 20px;background:var(--primary);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;transition:opacity 0.2s;white-space:nowrap">
          Envoyer
        </button>
      </div>
    </div>
  </div>`;

  // Scroll en bas
  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;

  // Focus input
  const input = document.getElementById('chat-input');
  if (input) {
    input.focus();
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        sendChatMessage();
      }
    });
  }
};

function renderMessage(m) {
  if (m.role === 'user') {
    return `<div class="chat-msg chat-msg-user"><div class="chat-msg-content">${e(m.text)}</div><div class="chat-msg-time">${m.time || ''}</div></div>`;
  }
  // Bot message — render Markdown-like (bold, newlines)
  let html = e(m.text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
  return `<div class="chat-msg chat-msg-bot"><div class="chat-msg-avatar">${Utils.icon('bot', 16)}</div><div><div class="chat-msg-content">${html}</div><div class="chat-msg-meta"><span class="chat-msg-skill">${e(m.skill || '')}</span><span class="chat-msg-time">${m.time || ''}</span></div></div></div>`;
}

async function sendChatMessage(text) {
  const input = document.getElementById('chat-input');
  const msg = text || (input?.value || '').trim();
  if (!msg) return;
  if (input) input.value = '';

  // Masquer le welcome + suggestions après le 1er message
  const welcome = document.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // Ajouter message user
  chatHistory.push({ role: 'user', text: msg, time: now });
  saveChatHistory();

  const messagesEl = document.getElementById('chat-messages');
  messagesEl.insertAdjacentHTML('beforeend', renderMessage({ role: 'user', text: msg, time: now }));

  // Typing indicator
  const typingId = 'typing-' + Date.now();
  messagesEl.insertAdjacentHTML('beforeend', `<div id="${typingId}" class="chat-msg chat-msg-bot"><div class="chat-msg-avatar">${Utils.icon('bot', 16)}</div><div class="chat-msg-content chat-typing"><span></span><span></span><span></span></div></div>`);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Désactiver l'input pendant le chargement
  const sendBtn = document.getElementById('chat-send');
  if (input) input.disabled = true;
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '...'; }

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });

    const data = await resp.json();
    const botText = data.text || data.error || 'Pas de réponse';
    const skill = data.skill || '';

    chatHistory.push({ role: 'bot', text: botText, skill, time: now });
    saveChatHistory();

    // Retirer typing indicator et ajouter la vraie réponse
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();
    messagesEl.insertAdjacentHTML('beforeend', renderMessage({ role: 'bot', text: botText, skill, time: now }));
  } catch (err) {
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();
    messagesEl.insertAdjacentHTML('beforeend', renderMessage({ role: 'bot', text: 'Erreur de connexion: ' + err.message, skill: 'error', time: now }));
  }

  // Réactiver input
  if (input) { input.disabled = false; input.focus(); }
  if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Envoyer'; }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Exposer pour le event delegation
window._sendChatMessage = sendChatMessage;
}
