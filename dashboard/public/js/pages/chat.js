/* ===== Page: Chat ===== */
window.Pages = window.Pages || {};

Pages.chat = async function(container) {
  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <h1 class="page-title">${Utils.icon('message-circle')} Chat</h1>
    </div>
    <div class="grid-full">
      <div class="card">
        <div class="card-body" style="text-align:center;padding:60px 20px">
          <div style="font-size:48px;margin-bottom:16px">${Utils.icon('message-circle', 48)}</div>
          <h2 style="color:var(--text-primary);margin-bottom:8px">Chat bot en cours de construction</h2>
          <p style="color:var(--text-muted);font-size:14px">La conversation avec le bot sera bientôt disponible ici.</p>
        </div>
      </div>
    </div>
  </div>`;
};
