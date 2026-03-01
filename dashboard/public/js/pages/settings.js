/* ===== Page: Settings (Client) ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

Pages.settings = async function(container) {
  const data = await API.get('/api/settings');
  if (!data || data.error) {
    container.innerHTML = '<div class="empty-state"><p>' + (data && data.error ? e(data.error) : 'Impossible de charger les parametres') + '</p></div>';
    return;
  }

  const cfg = data.config || {};
  const icp = data.icp || {};
  const tone = data.tone || {};
  const notifPrefs = data.notificationPrefs || {};

  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <h1 class="page-title">${Utils.icon('settings')} Parametres</h1>
    </div>

    <!-- Company Info (read-only summary) -->
    <div class="grid-full">
      <div class="card">
        <div class="card-header"><div class="card-title">Entreprise</div></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
            <div><span class="ob-label">Domaine</span><div>${e(cfg.clientDomain || '—')}</div></div>
            <div><span class="ob-label">Sender</span><div>${e(cfg.senderName || '—')} (${e(cfg.senderEmail || '—')})</div></div>
            <div><span class="ob-label">Titre</span><div>${e(cfg.senderTitle || '—')}</div></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ICP -->
    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Cible (ICP)</div>
          <button class="btn-export" data-action="save-icp" style="padding:6px 16px;font-size:12px">Sauvegarder</button>
        </div>
        <div class="card-body">
          <div style="display:grid;gap:12px">
            <div>
              <label class="ob-label">Industries (virgules)</label>
              <input type="text" id="set-industries" value="${e((icp.industries || []).join(', '))}" class="ob-input">
            </div>
            <div>
              <label class="ob-label">Postes cibles (virgules)</label>
              <input type="text" id="set-titles" value="${e((icp.titles || []).join(', '))}" class="ob-input">
            </div>
            <div>
              <label class="ob-label">Tailles d'entreprise</label>
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px" id="set-sizes">
                ${['1-10', '11-50', '51-200', '201-500', '501-1000', '1001+'].map(s => `
                  <label style="display:flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:13px">
                    <input type="checkbox" value="${s}" ${(icp.companySizes || []).includes(s) ? 'checked' : ''}> ${s}
                  </label>
                `).join('')}
              </div>
            </div>
            <div>
              <label class="ob-label">Geographie (virgules)</label>
              <input type="text" id="set-geography" value="${e((icp.geography || []).join(', '))}" class="ob-input">
            </div>
          </div>
          <div id="icp-status" style="font-size:13px;margin-top:8px;display:none"></div>
        </div>
      </div>
    </div>

    <!-- Tone -->
    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Ton des emails</div>
          <button class="btn-export" data-action="save-tone" style="padding:6px 16px;font-size:12px">Sauvegarder</button>
        </div>
        <div class="card-body">
          <div style="display:grid;gap:12px">
            <div>
              <label class="ob-label">Formalite</label>
              <select id="set-formality" class="ob-input">
                <option value="tres-formel" ${tone.formality === 'tres-formel' ? 'selected' : ''}>Tres formel</option>
                <option value="formel" ${tone.formality === 'formel' ? 'selected' : ''}>Formel</option>
                <option value="decontracte" ${tone.formality === 'decontracte' || !tone.formality ? 'selected' : ''}>Decontracte</option>
                <option value="familier" ${tone.formality === 'familier' ? 'selected' : ''}>Familier</option>
              </select>
            </div>
            <div>
              <label class="ob-label">Proposition de valeur</label>
              <textarea id="set-value-prop" class="ob-input" rows="3">${e(tone.valueProposition || '')}</textarea>
            </div>
            <div>
              <label class="ob-label">Mots a eviter (virgules)</label>
              <input type="text" id="set-forbidden" value="${e((tone.forbiddenWords || []).join(', '))}" class="ob-input">
            </div>
          </div>
          <div id="tone-status" style="font-size:13px;margin-top:8px;display:none"></div>
        </div>
      </div>
    </div>

    <!-- Notification Preferences -->
    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Preferences de notification</div>
          <button class="btn-export" data-action="save-notif-prefs" style="padding:6px 16px;font-size:12px">Sauvegarder</button>
        </div>
        <div class="card-body">
          <div style="display:grid;gap:12px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="pref-draft" ${notifPrefs.draftPending !== false ? 'checked' : ''}>
              <span>Brouillons en attente d'approbation</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="pref-hotlead" ${notifPrefs.hotLead !== false ? 'checked' : ''}>
              <span>Leads chauds detectes</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="pref-milestone" ${notifPrefs.campaignMilestone !== false ? 'checked' : ''}>
              <span>Jalons de campagne</span>
            </label>
          </div>
          <div id="notif-prefs-status" style="font-size:13px;margin-top:8px;display:none"></div>
        </div>
      </div>
    </div>

    <!-- Password change -->
    <div class="grid-full">
      <div class="card">
        <div class="card-header"><div class="card-title">Changer le mot de passe</div></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end">
            <div>
              <label class="ob-label">Mot de passe actuel</label>
              <input type="password" id="pw-current" class="ob-input" placeholder="Actuel">
            </div>
            <div>
              <label class="ob-label">Nouveau (min 12 chars)</label>
              <input type="password" id="pw-new" class="ob-input" placeholder="Nouveau">
            </div>
            <button class="btn-export" data-action="change-password" style="padding:8px 20px">Changer</button>
          </div>
          <div id="pw-status" style="font-size:13px;margin-top:8px;display:none"></div>
        </div>
      </div>
    </div>
  </div>`;
};

function _parseTags(val) {
  return (val || '').split(',').map(s => s.trim()).filter(Boolean);
}

function _showStatus(id, msg, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? 'var(--accent-green)' : 'var(--accent-red)';
  el.style.display = '';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// Event handlers
document.addEventListener('click', (ev) => {
  const target = ev.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'save-icp') {
    const sizes = [];
    document.querySelectorAll('#set-sizes input:checked').forEach(cb => sizes.push(cb.value));
    API.put('settings/icp', {
      industries: _parseTags(document.getElementById('set-industries')?.value),
      titles: _parseTags(document.getElementById('set-titles')?.value),
      companySizes: sizes,
      geography: _parseTags(document.getElementById('set-geography')?.value)
    }).then(res => {
      _showStatus('icp-status', res && res.success ? 'ICP sauvegarde' : (res && res.error) || 'Erreur', res && res.success);
    });
  }

  if (action === 'save-tone') {
    API.put('settings/tone', {
      formality: document.getElementById('set-formality')?.value || 'decontracte',
      valueProposition: (document.getElementById('set-value-prop')?.value || '').trim(),
      forbiddenWords: _parseTags(document.getElementById('set-forbidden')?.value)
    }).then(res => {
      _showStatus('tone-status', res && res.success ? 'Ton sauvegarde' : (res && res.error) || 'Erreur', res && res.success);
    });
  }

  if (action === 'save-notif-prefs') {
    API.put('settings/notifications', {
      draftPending: !!document.getElementById('pref-draft')?.checked,
      hotLead: !!document.getElementById('pref-hotlead')?.checked,
      campaignMilestone: !!document.getElementById('pref-milestone')?.checked
    }).then(res => {
      _showStatus('notif-prefs-status', res && res.success ? 'Preferences sauvegardees' : (res && res.error) || 'Erreur', res && res.success);
    });
  }

  if (action === 'change-password') {
    const current = document.getElementById('pw-current')?.value || '';
    const newPw = document.getElementById('pw-new')?.value || '';
    if (!current || !newPw) { _showStatus('pw-status', 'Les deux champs sont requis', false); return; }
    if (newPw.length < 12) { _showStatus('pw-status', 'Minimum 12 caracteres', false); return; }
    API.post('me/password', { currentPassword: current, newPassword: newPw }).then(res => {
      if (res && res.success) {
        _showStatus('pw-status', 'Mot de passe change', true);
        document.getElementById('pw-current').value = '';
        document.getElementById('pw-new').value = '';
      } else {
        _showStatus('pw-status', (res && res.error) || 'Erreur', false);
      }
    });
  }
});
}
