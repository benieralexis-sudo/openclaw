/* ===== Page: Settings (Client) — v2 Checkboxes + AI Re-analyze ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

let _settingsCuratedLists = null;

async function _loadSettingsLists() {
  if (_settingsCuratedLists) return _settingsCuratedLists;
  _settingsCuratedLists = await API.get('/api/curated-lists');
  return _settingsCuratedLists;
}

function _renderSettingsCheckboxGroup(id, items, selected, columns, disabled) {
  columns = columns || 3;
  const dis = disabled ? ' disabled' : '';
  return '<div id="' + id + '" class="ob-checkbox-grid" style="grid-template-columns:repeat(' + columns + ',1fr)">' +
    items.map(function(item) {
      const val = typeof item === 'object' ? item.value : item;
      const label = typeof item === 'object' ? item.label : item;
      const checked = (selected || []).includes(val);
      return '<label class="ob-checkbox-item' + (checked ? ' ob-checked' : '') + (disabled ? ' ob-disabled' : '') + '">' +
        '<input type="checkbox" value="' + e(val) + '"' + (checked ? ' checked' : '') + dis + '> <span>' + e(label) + '</span></label>';
    }).join('') + '</div>';
}

function _getSettingsCheckedValues(containerId) {
  const values = [];
  document.querySelectorAll('#' + containerId + ' input[type=checkbox]:checked').forEach(function(cb) { values.push(cb.value); });
  return values;
}

Pages.settings = async function(container) {
  const lists = await _loadSettingsLists();
  const data = await API.get('/api/settings');
  if (!data || data.error) {
    container.innerHTML = '<div class="empty-state"><p>' + (data && data.error ? e(data.error) : 'Impossible de charger les parametres') + '</p></div>';
    return;
  }

  const cfg = data.config || {};
  const icp = data.icp || {};
  const tone = data.tone || {};
  const notifPrefs = data.notificationPrefs || {};
  const L = lists || {};
  const isLocked = data.icpLocked && App.userRole === 'client';
  const _dis = isLocked ? ' disabled' : '';

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
            <div><span class="ob-label">Site web</span><div>${e(cfg.clientWebsite || cfg.clientDomain || '—')}</div></div>
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
          ${isLocked ? '' : '<div style="display:flex;gap:8px"><button class="btn-export" data-action="reanalyze-site" style="padding:6px 16px;font-size:12px">' + Utils.icon('zap', 14) + ' Re-analyser le site</button><button class="btn-export" data-action="save-icp" style="padding:6px 16px;font-size:12px">Sauvegarder</button></div>'}
        </div>
        <div class="card-body">
          ${isLocked ? '<div class="icp-locked-banner">' + Utils.icon('lock', 14) + ' Configuration verrouill\\u00e9e pour optimiser les performances du bot. Utilisez le bouton ci-dessous pour demander une modification.</div>' : ''}
          <div id="settings-ai-loading" style="display:none" class="ob-loading">
            <div class="ob-spinner"></div>
            <p style="margin-top:12px;font-size:13px;color:var(--text-muted)">Re-analyse du site en cours...</p>
          </div>
          <div id="settings-icp-content" style="display:grid;gap:16px">
            <div>
              <label class="ob-label">Industries cibles</label>
              ${_renderSettingsCheckboxGroup('set-industries', L.INDUSTRIES || [], icp.industries || [], 3, isLocked)}
            </div>
            <div>
              <label class="ob-label">Postes / Titres cibles</label>
              ${_renderSettingsCheckboxGroup('set-titles', L.TITLES || [], icp.titles || [], 3, isLocked)}
            </div>
            <div>
              <label class="ob-label">Niveau de seniorite</label>
              ${_renderSettingsCheckboxGroup('set-seniorities', L.SENIORITIES || [], icp.seniorities || [], 3, isLocked)}
            </div>
            <div>
              <label class="ob-label">Taille d'entreprise</label>
              ${_renderSettingsCheckboxGroup('set-sizes', L.COMPANY_SIZES || [], icp.companySizes || [], 6, isLocked)}
            </div>
            <div>
              <label class="ob-label">Geographie</label>
              ${_renderSettingsCheckboxGroup('set-geography', L.GEOGRAPHY || [], icp.geography || [], 3, isLocked)}
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
          ${isLocked ? '' : '<button class="btn-export" data-action="save-tone" style="padding:6px 16px;font-size:12px">Sauvegarder</button>'}
        </div>
        <div class="card-body">
          ${isLocked ? '<div class="icp-locked-banner">' + Utils.icon('lock', 14) + ' Ton verrouill\\u00e9 pour optimiser les performances.</div>' : ''}
          <div style="display:grid;gap:16px">
            <div>
              <label class="ob-label">Niveau de formalite</label>
              <select id="set-formality" class="ob-input"${_dis}>
                ${(L.FORMALITIES || []).map(function(f) {
                  return '<option value="' + f.value + '"' + (f.value === (tone.formality || 'decontracte') ? ' selected' : '') + '>' + e(f.label) + '</option>';
                }).join('')}
              </select>
            </div>
            <div>
              <label class="ob-label">Proposition de valeur</label>
              <textarea id="set-value-prop" class="ob-input" rows="3" maxlength="500"${_dis}>${e(tone.valueProposition || '')}</textarea>
              <div style="text-align:right;font-size:11px;color:var(--text-muted)" id="set-vp-count">${(tone.valueProposition || '').length}/500</div>
            </div>
            <div>
              <label class="ob-label">Mots/expressions a eviter</label>
              ${_renderSettingsCheckboxGroup('set-forbidden', L.FORBIDDEN_WORDS_STANDARD || [], tone.forbiddenWords || [], 3, isLocked)}
            </div>
          </div>
          <div id="tone-status" style="font-size:13px;margin-top:8px;display:none"></div>
          ${isLocked ? '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px"><label class="ob-label">Demander une modification</label><textarea id="change-request-msg" class="ob-input" rows="3" maxlength="1000" placeholder="Ex: Ajouter l\'industrie Telecom, cibler aussi l\'Allemagne, changer le ton en formel..."></textarea><button class="btn-export" data-action="request-change" style="margin-top:8px;padding:8px 20px">Envoyer la demande</button><div id="change-request-status" style="font-size:13px;margin-top:8px;display:none"></div></div>' : ''}
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

function _showStatus(id, msg, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? 'var(--accent-green)' : 'var(--accent-red)';
  el.style.display = '';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// Character counter for value proposition
document.addEventListener('input', function(ev) {
  if (ev.target.id === 'set-value-prop') {
    const counter = document.getElementById('set-vp-count');
    if (counter) counter.textContent = ev.target.value.length + '/500';
  }
});

// Event handlers
document.addEventListener('click', (ev) => {
  const target = ev.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'save-icp') {
    target.disabled = true;
    API.put('settings/icp', {
      industries: _getSettingsCheckedValues('set-industries'),
      titles: _getSettingsCheckedValues('set-titles'),
      seniorities: _getSettingsCheckedValues('set-seniorities'),
      companySizes: _getSettingsCheckedValues('set-sizes'),
      geography: _getSettingsCheckedValues('set-geography')
    }).then(res => {
      target.disabled = false;
      _showStatus('icp-status', res && res.success ? 'ICP sauvegarde' : (res && res.error) || 'Erreur', res && res.success);
    });
  }

  if (action === 'save-tone') {
    target.disabled = true;
    API.put('settings/tone', {
      formality: document.getElementById('set-formality')?.value || 'decontracte',
      valueProposition: (document.getElementById('set-value-prop')?.value || '').trim(),
      forbiddenWords: _getSettingsCheckedValues('set-forbidden')
    }).then(res => {
      target.disabled = false;
      _showStatus('tone-status', res && res.success ? 'Ton sauvegarde' : (res && res.error) || 'Erreur', res && res.success);
    });
  }

  if (action === 'save-notif-prefs') {
    target.disabled = true;
    API.put('settings/notifications', {
      draftPending: !!document.getElementById('pref-draft')?.checked,
      hotLead: !!document.getElementById('pref-hotlead')?.checked,
      campaignMilestone: !!document.getElementById('pref-milestone')?.checked
    }).then(res => {
      target.disabled = false;
      _showStatus('notif-prefs-status', res && res.success ? 'Preferences sauvegardees' : (res && res.error) || 'Erreur', res && res.success);
    });
  }

  if (action === 'change-password') {
    const current = document.getElementById('pw-current')?.value || '';
    const newPw = document.getElementById('pw-new')?.value || '';
    if (!current || !newPw) { _showStatus('pw-status', 'Les deux champs sont requis', false); return; }
    if (newPw.length < 12) { _showStatus('pw-status', 'Minimum 12 caracteres', false); return; }
    target.disabled = true;
    API.post('me/password', { currentPassword: current, newPassword: newPw }).then(res => {
      target.disabled = false;
      if (res && res.success) {
        _showStatus('pw-status', 'Mot de passe change', true);
        document.getElementById('pw-current').value = '';
        document.getElementById('pw-new').value = '';
      } else {
        _showStatus('pw-status', (res && res.error) || 'Erreur', false);
      }
    });
  }

  if (action === 'request-change') {
    const msg = (document.getElementById('change-request-msg')?.value || '').trim();
    if (!msg) { _showStatus('change-request-status', 'Decrivez votre demande', false); return; }
    target.disabled = true;
    API.post('settings/request-change', { message: msg }).then(res => {
      target.disabled = false;
      if (res && res.success) {
        _showStatus('change-request-status', 'Demande envoyee ! Nous reviendrons vers vous.', true);
        document.getElementById('change-request-msg').value = '';
      } else {
        _showStatus('change-request-status', (res && res.error) || 'Erreur', false);
      }
    });
  }

  if (action === 'reanalyze-site') {
    target.disabled = true;
    target.textContent = 'Analyse...';
    const loadingEl = document.getElementById('settings-ai-loading');
    const contentEl = document.getElementById('settings-icp-content');
    if (loadingEl) loadingEl.style.display = '';
    if (contentEl) contentEl.style.display = 'none';

    API.get('/api/settings').then(function(settingsData) {
      const website = settingsData && settingsData.config && (settingsData.config.clientWebsite || settingsData.config.clientDomain);
      if (!website) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = '';
        target.disabled = false;
        target.innerHTML = Utils.icon('zap', 14) + ' Re-analyser le site';
        _showStatus('icp-status', 'Aucun site web configure', false);
        return;
      }
      const url = website.startsWith('http') ? website : 'https://' + website;
      return API.post('ai/analyze-website', { url: url });
    }).then(function(res) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (contentEl) contentEl.style.display = '';
      target.disabled = false;
      target.innerHTML = Utils.icon('zap', 14) + ' Re-analyser le site';

      if (res && res.success && res.analysis) {
        const a = res.analysis;
        // Update checkboxes from AI suggestions
        _updateCheckboxesFromAI('set-industries', a.suggestedIndustries || []);
        _updateCheckboxesFromAI('set-titles', a.suggestedTitles || []);
        _updateCheckboxesFromAI('set-seniorities', a.suggestedSeniorities || []);
        _updateCheckboxesFromAI('set-sizes', a.suggestedCompanySizes || []);
        _updateCheckboxesFromAI('set-geography', a.suggestedGeography || []);
        _updateCheckboxesFromAI('set-forbidden', a.suggestedForbiddenWords || []);
        // Update formality
        if (a.suggestedFormality) {
          const sel = document.getElementById('set-formality');
          if (sel) sel.value = a.suggestedFormality;
        }
        // Update value proposition
        if (a.suggestedValueProposition) {
          const vp = document.getElementById('set-value-prop');
          if (vp) {
            vp.value = a.suggestedValueProposition;
            const counter = document.getElementById('set-vp-count');
            if (counter) counter.textContent = vp.value.length + '/500';
          }
        }
        _showStatus('icp-status', 'Analyse terminee — verifiez et sauvegardez', true);
      } else {
        _showStatus('icp-status', (res && res.error) || 'Analyse echouee', false);
      }
    }).catch(function() {
      if (loadingEl) loadingEl.style.display = 'none';
      if (contentEl) contentEl.style.display = '';
      target.disabled = false;
      target.innerHTML = Utils.icon('zap', 14) + ' Re-analyser le site';
      _showStatus('icp-status', 'Erreur lors de l\'analyse', false);
    });
  }
});

function _updateCheckboxesFromAI(containerId, selectedValues) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
    const shouldCheck = selectedValues.includes(cb.value);
    cb.checked = shouldCheck;
    const label = cb.closest('.ob-checkbox-item');
    if (label) {
      if (shouldCheck) label.classList.add('ob-checked');
      else label.classList.remove('ob-checked');
    }
  });
}
}
