/* ===== Page: Clients Multi-Tenant Hub ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

Pages.clients = async function(container) {
  if (App.userRole !== 'admin') {
    container.innerHTML = '<div class="empty-state"><p>Acces reserve aux administrateurs</p></div>';
    return;
  }

  // Load clients + users in parallel
  const [clientsData, usersData] = await Promise.all([
    API.get('/api/clients'),
    API.users()
  ]);

  const clients = (clientsData && clientsData.clients) || [];
  const userList = (usersData && usersData.users) || [];
  const activeClients = clients.filter(c => c.status === 'active');

  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <h1 class="page-title">${Utils.icon('briefcase')} Clients</h1>
      <div class="page-actions">
        <button class="btn-export" data-action="toggle-add-client" style="padding:8px 16px">${Utils.icon('plus', 14)} Nouveau client</button>
        <button class="btn-export" data-action="toggle-add-user" style="padding:8px 16px">${Utils.icon('user', 14)} Nouvel utilisateur</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon blue">${Utils.icon('briefcase')}</div></div>
        <div class="kpi-value" data-count="${clients.length}">${clients.length}</div>
        <div class="kpi-label">Clients total</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon green">${Utils.icon('check-circle')}</div></div>
        <div class="kpi-value" data-count="${activeClients.length}">${activeClients.length}</div>
        <div class="kpi-label">Actifs</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon purple">${Utils.icon('user')}</div></div>
        <div class="kpi-value" data-count="${userList.length}">${userList.length}</div>
        <div class="kpi-label">Utilisateurs</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><div class="kpi-icon orange">${Utils.icon('target')}</div></div>
        <div class="kpi-value" data-count="${clients.filter(c => c.onboardingCompleted).length}">${clients.filter(c => c.onboardingCompleted).length}</div>
        <div class="kpi-label">Onboarding OK</div>
      </div>
    </div>

    <!-- Add Client Form -->
    <div id="add-client-form" class="grid-full" style="display:none">
      <div class="card">
        <div class="card-header"><div class="card-title">Nouveau client</div></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Nom de l'entreprise *</label>
              <input type="text" id="client-name" placeholder="ex: Acme Corp" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Domaine</label>
              <input type="text" id="client-domain" placeholder="ex: acme.fr" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Plan</label>
              <select id="client-plan" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
                <option value="pipeline">Pipeline (890/mois)</option>
                <option value="multicanal">Multicanal (1490/mois)</option>
                <option value="dedie">Dédié (sur mesure)</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Email sender</label>
              <input type="email" id="client-sender-email" placeholder="hello@acme.fr" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Nom sender</label>
              <input type="text" id="client-sender-name" placeholder="Jean" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Description</label>
              <input type="text" id="client-description" placeholder="cabinet conseil strategie" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
            </div>
          </div>
          <div style="margin-top:16px;display:flex;gap:12px;align-items:center">
            <button class="btn-export" data-action="create-client" style="padding:8px 20px">Creer le client</button>
            <div id="add-client-error" style="color:var(--accent-red);font-size:13px;display:none"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add User Form -->
    <div id="add-user-form" class="grid-full" style="display:none">
      <div class="card">
        <div class="card-header"><div class="card-title">Ajouter un utilisateur</div></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr auto;gap:12px;align-items:end">
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Nom d'utilisateur</label>
              <input type="text" id="new-username" placeholder="ex: client-acme" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Mot de passe</label>
              <input type="password" id="new-password" placeholder="Min 12 caracteres" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Role</label>
              <select id="new-role" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Client associe</label>
              <select id="new-client-id" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
                <option value="">— Aucun —</option>
                ${clients.map(c => `<option value="${e(c.id)}">${e(c.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-muted);display:block;margin-bottom:4px">Entreprise</label>
              <input type="text" id="new-company" placeholder="ex: Acme Corp" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:14px">
            </div>
            <button class="btn-export" data-action="create-user" style="padding:8px 20px;white-space:nowrap">Creer</button>
          </div>
          <div id="add-user-error" style="color:var(--accent-red);font-size:13px;margin-top:8px;display:none"></div>
        </div>
      </div>
    </div>

    <!-- Clients Table -->
    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Tous les clients</div>
          <span class="badge badge-blue">${clients.length}</span>
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Plan</th>
                  <th>Statut</th>
                  <th>Onboarding</th>
                  <th>Service Docker</th>
                  <th>Cree le</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${clients.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">Aucun client. Cliquez "Nouveau client" pour commencer.</td></tr>' : ''}
                ${clients.map(c => `
                  <tr>
                    <td style="color:var(--text-primary);font-weight:500">${e(c.name)}<br><span style="font-size:11px;color:var(--text-muted)">${e(c.id)}</span></td>
                    <td><span class="badge ${c.plan === 'scale' ? 'badge-green' : c.plan === 'growth' ? 'badge-purple' : 'badge-blue'}">${e(c.plan || 'pilot')}</span></td>
                    <td><span class="badge ${c.status === 'active' ? 'badge-green' : 'badge-red'}">${e(c.status)}</span></td>
                    <td>${c.onboardingCompleted ? '<span class="badge badge-green">OK</span>' : '<span class="badge badge-orange">En cours</span>'}</td>
                    <td style="font-family:monospace;font-size:12px">${e(c.routerService)}</td>
                    <td>${Utils.formatDate(c.createdAt)}</td>
                    <td style="white-space:nowrap">
                      <button class="btn-export" data-action="view-client" data-param="${e(c.id)}" style="padding:4px 10px;font-size:12px" title="Voir dans le dashboard">Dashboard</button>
                      <button class="btn-export" data-action="health-client" data-param="${e(c.id)}" style="padding:4px 10px;font-size:12px" title="Health check">Health</button>
                      <button class="btn-export" data-action="restart-client" data-param="${e(c.id)}" style="padding:4px 10px;font-size:12px" title="Restart router">Restart</button>
                      <button class="btn-export" data-action="delete-client" data-param="${e(c.id)}" style="padding:4px 10px;font-size:12px;color:var(--accent-red)" title="Supprimer">Suppr</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Users Table -->
    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Utilisateurs</div>
          <span class="badge badge-blue">${userList.length}</span>
        </div>
        <div class="card-body no-pad">
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Nom d'utilisateur</th>
                  <th>Role</th>
                  <th>Client associe</th>
                  <th>Entreprise</th>
                  <th>Cree le</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${userList.map(u => `
                  <tr>
                    <td style="color:var(--text-primary);font-weight:500">${e(u.username)}</td>
                    <td><span class="badge ${u.role === 'admin' ? 'badge-green' : 'badge-purple'}">${u.role === 'admin' ? 'Admin' : 'Client'}</span></td>
                    <td>${e(u.clientId || '—')}</td>
                    <td>${e(u.company || '—')}</td>
                    <td>${Utils.formatDate(u.createdAt)}</td>
                    <td>${u.username === 'admin' ? '<span style="color:var(--text-muted);font-size:12px">Protege</span>' : `<button class="btn-export" data-action="delete-user" data-param="${e(u.username)}" style="padding:4px 12px;font-size:12px;color:var(--accent-red)">Supprimer</button>`}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>`;
};
}
