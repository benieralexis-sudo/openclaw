/* ===== Page: Clients (ex-Utilisateurs) ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

Pages.clients = async function(container) {
  if (App.userRole !== 'admin') {
    container.innerHTML = '<div class="empty-state"><p>Accès réservé aux administrateurs</p></div>';
    return;
  }

  const data = await API.users();
  if (!data) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

  const userList = data.users || [];

  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <h1 class="page-title">${Utils.icon('user')} Clients</h1>
      <div class="page-actions">
        <button class="btn-export" data-action="toggle-add-user" style="padding:8px 16px">${Utils.icon('plus', 14)} Nouvel utilisateur</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon blue">${Utils.icon('user')}</div></div>
        <div class="kpi-value" data-count="${userList.length}">${userList.length}</div>
        <div class="kpi-label">Utilisateurs</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon green">${Utils.icon('check-circle')}</div></div>
        <div class="kpi-value" data-count="${userList.filter(u => u.role === 'admin').length}">${userList.filter(u => u.role === 'admin').length}</div>
        <div class="kpi-label">Administrateurs</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon purple">${Utils.icon('target')}</div></div>
        <div class="kpi-value" data-count="${userList.filter(u => u.role === 'client').length}">${userList.filter(u => u.role === 'client').length}</div>
        <div class="kpi-label">Clients</div>
      </div>
    </div>

    <div id="add-user-form" class="grid-full" style="display:none">
      <div class="card">
        <div class="card-header"><div class="card-title">Ajouter un utilisateur</div></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:12px;align-items:end">
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Nom d'utilisateur</label>
              <input type="text" id="new-username" placeholder="ex: client-acme" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Mot de passe</label>
              <input type="password" id="new-password" placeholder="Min 12 caractères" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Rôle</label>
              <select id="new-role" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Entreprise (client)</label>
              <input type="text" id="new-company" placeholder="ex: Acme Corp" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
            </div>
            <button class="btn-export" data-action="create-user" style="padding:8px 20px;white-space:nowrap">Créer</button>
          </div>
          <div id="add-user-error" style="color:var(--accent-red);font-size:13px;margin-top:8px;display:none"></div>
        </div>
      </div>
    </div>

    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Tous les utilisateurs</div>
          <span class="badge badge-blue">${userList.length}</span>
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Nom d'utilisateur</th>
                  <th>Rôle</th>
                  <th>Entreprise</th>
                  <th>Créé le</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${userList.map(u => `
                  <tr>
                    <td style="color:var(--text-primary);font-weight:500">${e(u.username)}</td>
                    <td><span class="badge ${u.role === 'admin' ? 'badge-green' : 'badge-purple'}">${u.role === 'admin' ? 'Admin' : 'Client'}</span></td>
                    <td>${e(u.company || '—')}</td>
                    <td>${Utils.formatDate(u.createdAt)}</td>
                    <td>${u.username === 'admin' ? '<span style="color:var(--text-muted);font-size:12px">Protégé</span>' : `<button class="btn-export" data-action="delete-user" data-param="${e(u.username)}" style="padding:4px 12px;font-size:12px;color:var(--accent-red)">Supprimer</button>`}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${userList.length === 0 ? '<div class="empty-state"><p>Aucun utilisateur</p></div>' : ''}
        </div>
      </div>
    </div>
  </div>`;
};
}
