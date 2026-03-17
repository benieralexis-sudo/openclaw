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

function _timeAgo(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'a l\'instant';
  if (mins < 60) return 'il y a ' + mins + 'min';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return 'il y a ' + hrs + 'h';
  const days = Math.floor(hrs / 24);
  return 'il y a ' + days + 'j';
}

function _renderChangeRequestsList(reqs, forAdmin) {
  if (!reqs || reqs.length === 0) return '';
  return '<div style="margin-top:12px;display:grid;gap:6px">' +
    reqs.slice(0, 5).map(function(r) {
      const icon = r.status === 'resolved' ? '<span style="color:var(--accent-green)">&#10003;</span>' : '<span style="color:var(--accent-orange,#f59e0b)">&#9679;</span>';
      const status = r.status === 'resolved' ? 'traite' : 'en attente';
      const time = _timeAgo(r.resolvedAt || r.createdAt);
      return '<div style="font-size:12px;color:var(--text-muted);display:flex;gap:6px;align-items:baseline">' +
        icon + ' <span>"' + e(r.message.length > 80 ? r.message.substring(0, 80) + '...' : r.message) + '"</span> <span style="white-space:nowrap">— ' + status + ', ' + time + '</span></div>';
    }).join('') + '</div>';
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
  const changeReqs = data.changeRequests || [];
  const pendingReqs = changeReqs.filter(r => r.status === 'pending');
  const isAdmin = App.userRole === 'admin';

  // Fetch reply mode
  const modeData = await API.fetch('settings/reply-mode').catch(() => null);
  const currentMode = (modeData && modeData.mode) || 'copilot';

  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <h1 class="page-title">${Utils.icon('settings')} Parametres</h1>
    </div>

    <!-- Reply Mode (F7) -->
    <div class="grid-full">
      <div class="card" style="border-left:3px solid var(--accent-purple)">
        <div class="card-header"><div class="card-title">Mode de reponse IA</div></div>
        <div class="card-body" style="display:flex;gap:12px;flex-wrap:wrap">
          <button class="mode-option ${currentMode === 'autopilot' ? 'mode-active' : ''}" data-action="set-reply-mode" data-param="autopilot" style="flex:1;min-width:140px;padding:12px;border-radius:var(--radius-md);border:1px solid ${currentMode === 'autopilot' ? 'var(--accent-green)' : 'var(--border)'};background:${currentMode === 'autopilot' ? 'var(--accent-green-dim)' : 'var(--bg-card)'};cursor:pointer;text-align:center">
            <div style="font-size:20px;margin-bottom:4px">🤖</div>
            <div style="font-weight:600;font-size:13px;color:var(--text-primary)">Autopilot</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">L'IA repond seule si confiance &gt; 80%</div>
          </button>
          <button class="mode-option ${currentMode === 'copilot' ? 'mode-active' : ''}" data-action="set-reply-mode" data-param="copilot" style="flex:1;min-width:140px;padding:12px;border-radius:var(--radius-md);border:1px solid ${currentMode === 'copilot' ? 'var(--accent-blue)' : 'var(--border)'};background:${currentMode === 'copilot' ? 'var(--accent-blue-dim)' : 'var(--bg-card)'};cursor:pointer;text-align:center">
            <div style="font-size:20px;margin-bottom:4px">🤝</div>
            <div style="font-weight:600;font-size:13px;color:var(--text-primary)">Copilot</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">L'IA propose, vous validez</div>
          </button>
          <button class="mode-option ${currentMode === 'manual' ? 'mode-active' : ''}" data-action="set-reply-mode" data-param="manual" style="flex:1;min-width:140px;padding:12px;border-radius:var(--radius-md);border:1px solid ${currentMode === 'manual' ? 'var(--accent-orange)' : 'var(--border)'};background:${currentMode === 'manual' ? 'var(--accent-orange-dim)' : 'var(--bg-card)'};cursor:pointer;text-align:center">
            <div style="font-size:20px;margin-bottom:4px">✋</div>
            <div style="font-weight:600;font-size:13px;color:var(--text-primary)">Manuel</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Aucune auto-reponse</div>
          </button>
        </div>
      </div>
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
          ${isAdmin && pendingReqs.length > 0 ? '<div class="icp-locked-banner" style="background:rgba(245,158,11,0.08);border-color:rgba(245,158,11,0.3);color:var(--accent-orange,#f59e0b)">' + pendingReqs.length + ' demande(s) en attente : "' + e(pendingReqs[0].message.substring(0, 100)) + '" — ' + _timeAgo(pendingReqs[0].createdAt) + '</div>' : ''}
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
          ${isLocked ? '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px"><label class="ob-label">Demander une modification</label><textarea id="change-request-msg" class="ob-input" rows="3" maxlength="1000" placeholder="Ex: Ajouter l\'industrie Telecom, cibler aussi l\'Allemagne, changer le ton en formel..."></textarea><button class="btn-export" data-action="request-change" style="margin-top:8px;padding:8px 20px">Envoyer la demande</button><div id="change-request-status" style="font-size:13px;margin-top:8px;display:none"></div>' + _renderChangeRequestsList(changeReqs, false) + '</div>' : ''}
        </div>
      </div>
    </div>

    <!-- Knowledge Base -->
    <div class="grid-full">
      <div class="card">
        <div class="card-header">
          <div class="card-title">${Utils.icon('book', 16)} Knowledge Base</div>
          <div style="display:flex;gap:8px">
            <button class="btn-export" data-action="save-kb" style="padding:6px 16px;font-size:12px">Sauvegarder la KB</button>
          </div>
        </div>
        <div class="card-body">
          <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">La Knowledge Base definit ce que l'IA peut repondre aux prospects. Elle ne peut PAS inventer — seuls les faits presents ici sont utilises.</p>
          <div id="kb-form" style="display:grid;gap:20px">
            <div id="kb-loading" style="text-align:center;padding:20px;color:var(--text-muted)">Chargement de la KB...</div>
          </div>
          <div id="kb-status" style="font-size:13px;margin-top:8px;display:none"></div>
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
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="pref-email-notif" ${notifPrefs.emailNotifications !== false ? 'checked' : ''}>
              <span>Recevoir les notifications par email</span>
            </label>
            <div>
              <label class="ob-label">Email de notification</label>
              <input type="email" id="pref-notif-email" class="ob-input" placeholder="email@entreprise.com" value="${e(notifPrefs.notificationEmail || cfg.senderEmail || '')}">
            </div>
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

  // Load KB form asynchronously
  _loadKBForm();
};

async function _loadKBForm() {
  const kbData = await API.kb();
  const form = document.getElementById('kb-form');
  if (!form) return;
  const kb = (kbData && kbData.kb) || {};
  const isDefault = kbData && kbData.isDefault;
  const co = kb.company || {};
  const svc = kb.services || {};
  const pr = kb.pricing || {};
  const proc = kb.process || {};

  form.innerHTML = `
    ${isDefault ? '<div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:12px;margin-bottom:8px;font-size:13px;color:var(--accent-orange,#f59e0b)">KB par defaut — remplissez les informations de votre entreprise pour activer les reponses automatiques.</div>' : ''}

    <!-- Company -->
    <fieldset style="border:1px solid var(--border);border-radius:8px;padding:16px">
      <legend style="font-weight:600;font-size:14px;padding:0 8px">Entreprise</legend>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label class="ob-label">Nom *</label><input type="text" id="kb-co-name" class="ob-input" value="${e(co.name || '')}" maxlength="100" required></div>
        <div><label class="ob-label">Tagline</label><input type="text" id="kb-co-tagline" class="ob-input" value="${e(co.tagline || '')}" maxlength="200"></div>
        <div style="grid-column:1/3"><label class="ob-label">Description</label><textarea id="kb-co-desc" class="ob-input" rows="2" maxlength="1000">${e(co.description || '')}</textarea></div>
        <div><label class="ob-label">Fondateur</label><input type="text" id="kb-co-founder" class="ob-input" value="${e(co.founder || '')}" maxlength="100"></div>
        <div><label class="ob-label">Titre</label><input type="text" id="kb-co-title" class="ob-input" value="${e(co.founderTitle || '')}" maxlength="100"></div>
        <div><label class="ob-label">Site web</label><input type="text" id="kb-co-website" class="ob-input" value="${e(co.website || '')}" maxlength="200"></div>
        <div><label class="ob-label">Email</label><input type="email" id="kb-co-email" class="ob-input" value="${e(co.email || '')}" maxlength="200"></div>
      </div>
    </fieldset>

    <!-- Services -->
    <fieldset style="border:1px solid var(--border);border-radius:8px;padding:16px">
      <legend style="font-weight:600;font-size:14px;padding:0 8px">Services</legend>
      <div style="display:grid;gap:12px">
        <div><label class="ob-label">Service principal</label><input type="text" id="kb-svc-main" class="ob-input" value="${e(svc.main || '')}" maxlength="500"></div>
        <div><label class="ob-label">Inclut (1 par ligne)</label><textarea id="kb-svc-includes" class="ob-input" rows="4">${e((svc.includes || []).join('\\n'))}</textarea></div>
        <div><label class="ob-label">N'inclut PAS (1 par ligne)</label><textarea id="kb-svc-excludes" class="ob-input" rows="3">${e((svc.does_not_include || []).join('\\n'))}</textarea></div>
      </div>
    </fieldset>

    <!-- Pricing -->
    <fieldset style="border:1px solid var(--border);border-radius:8px;padding:16px">
      <legend style="font-weight:600;font-size:14px;padding:0 8px">Tarification</legend>
      <div style="display:grid;gap:12px">
        <div><label class="ob-label">Setup</label><input type="text" id="kb-price-setup" class="ob-input" value="${e(typeof pr.setup === 'string' ? pr.setup : '')}" maxlength="300" placeholder="Ex: Pas de frais de setup"></div>
        <div id="kb-plans-container">
          <label class="ob-label">Formules (nom | prix | volume | description)</label>
          ${(pr.monthly_plans || []).map(function(p, i) {
            return '<div class="kb-plan-row" style="display:grid;grid-template-columns:1fr 1fr 1fr 2fr auto;gap:8px;margin-bottom:6px"><input class="ob-input kb-plan-name" value="' + e(p.name || '') + '" placeholder="Nom"><input class="ob-input kb-plan-price" value="' + e(p.price || '') + '" placeholder="Prix"><input class="ob-input kb-plan-vol" value="' + e(p.volume || '') + '" placeholder="Volume"><input class="ob-input kb-plan-desc" value="' + e(p.description || '') + '" placeholder="Description"><button class="btn-danger-outline kb-remove-plan" style="padding:4px 8px;font-size:12px" type="button">X</button></div>';
          }).join('')}
          <button class="btn-export" data-action="add-plan" style="padding:4px 12px;font-size:12px;margin-top:4px" type="button">+ Ajouter une formule</button>
        </div>
        <div><label class="ob-label">Engagement</label><input type="text" id="kb-price-engagement" class="ob-input" value="${e(pr.engagement || '')}" maxlength="300"></div>
        <div><label class="ob-label">Garantie</label><input type="text" id="kb-price-guarantee" class="ob-input" value="${e(pr.guarantee || '')}" maxlength="500"></div>
      </div>
    </fieldset>

    <!-- Process -->
    <fieldset style="border:1px solid var(--border);border-radius:8px;padding:16px">
      <legend style="font-weight:600;font-size:14px;padding:0 8px">Process</legend>
      <div style="display:grid;gap:12px">
        <div><label class="ob-label">Etapes (1 par ligne)</label><textarea id="kb-proc-steps" class="ob-input" rows="4">${e((proc.steps || []).join('\\n'))}</textarea></div>
        <div><label class="ob-label">Ce que le client fournit (1 par ligne)</label><textarea id="kb-proc-provides" class="ob-input" rows="3">${e((proc.what_client_provides || []).join('\\n'))}</textarea></div>
        <div><label class="ob-label">Duree onboarding</label><input type="text" id="kb-proc-time" class="ob-input" value="${e(proc.onboarding_time || '')}" maxlength="200"></div>
      </div>
    </fieldset>

    <!-- Differentiators -->
    <fieldset style="border:1px solid var(--border);border-radius:8px;padding:16px">
      <legend style="font-weight:600;font-size:14px;padding:0 8px">Avantages differenciants</legend>
      <textarea id="kb-differentiators" class="ob-input" rows="4" placeholder="1 avantage par ligne">${e((kb.differentiators || []).join('\\n'))}</textarea>
    </fieldset>

    <!-- FAQ -->
    <fieldset style="border:1px solid var(--border);border-radius:8px;padding:16px">
      <legend style="font-weight:600;font-size:14px;padding:0 8px">FAQ (questions frequentes)</legend>
      <div id="kb-faq-container">
        ${(kb.faq || []).map(function(f, i) {
          return '<div class="kb-faq-row" style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px"><div style="display:grid;gap:8px"><div><label class="ob-label">Question</label><input class="ob-input kb-faq-q" value="' + e(f.question || '') + '" maxlength="300"></div><div><label class="ob-label">Reponse</label><textarea class="ob-input kb-faq-a" rows="2" maxlength="1000">' + e(f.answer || '') + '</textarea></div><button class="btn-danger-outline kb-remove-faq" style="padding:4px 8px;font-size:12px;justify-self:end" type="button">Supprimer</button></div></div>';
        }).join('')}
        <button class="btn-export" data-action="add-faq" style="padding:4px 12px;font-size:12px;margin-top:4px" type="button">+ Ajouter une FAQ</button>
      </div>
    </fieldset>

    <!-- Safety -->
    <fieldset style="border:1px solid var(--border);border-radius:8px;padding:16px">
      <legend style="font-weight:600;font-size:14px;padding:0 8px">Securite anti-hallucination</legend>
      <div style="display:grid;gap:12px">
        <div><label class="ob-label">Claims interdits (1 par ligne)</label><textarea id="kb-forbidden" class="ob-input" rows="4">${e((kb.forbidden_claims || []).join('\\n'))}</textarea></div>
        <div><label class="ob-label">Phrase de fallback (quand l'IA ne sait pas)</label><input type="text" id="kb-fallback" class="ob-input" value="${e(kb.fallback_phrase || '')}" maxlength="300"></div>
        <div><label class="ob-label">Lien de booking (optionnel)</label><input type="url" id="kb-booking" class="ob-input" value="${e(kb.booking_url || '')}" maxlength="300" placeholder="https://calendly.com/..."></div>
      </div>
    </fieldset>
  `;
}

function _collectKBData() {
  const lines = (id) => (document.getElementById(id)?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const val = (id) => (document.getElementById(id)?.value || '').trim();

  // Collect plans
  const plans = [];
  document.querySelectorAll('.kb-plan-row').forEach(row => {
    const name = row.querySelector('.kb-plan-name')?.value?.trim() || '';
    const price = row.querySelector('.kb-plan-price')?.value?.trim() || '';
    const volume = row.querySelector('.kb-plan-vol')?.value?.trim() || '';
    const desc = row.querySelector('.kb-plan-desc')?.value?.trim() || '';
    if (name || price) plans.push({ name, price, volume, description: desc });
  });

  // Collect FAQ
  const faq = [];
  document.querySelectorAll('.kb-faq-row').forEach(row => {
    const q = row.querySelector('.kb-faq-q')?.value?.trim() || '';
    const a = row.querySelector('.kb-faq-a')?.value?.trim() || '';
    if (q && a) faq.push({ question: q, answer: a });
  });

  return {
    company: {
      name: val('kb-co-name'), tagline: val('kb-co-tagline'), description: val('kb-co-desc'),
      founder: val('kb-co-founder'), founderTitle: val('kb-co-title'),
      website: val('kb-co-website'), email: val('kb-co-email')
    },
    services: {
      main: val('kb-svc-main'), includes: lines('kb-svc-includes'), does_not_include: lines('kb-svc-excludes')
    },
    pricing: {
      setup: val('kb-price-setup'), monthly_plans: plans,
      engagement: val('kb-price-engagement'), guarantee: val('kb-price-guarantee')
    },
    process: {
      steps: lines('kb-proc-steps'), what_client_provides: lines('kb-proc-provides'),
      onboarding_time: val('kb-proc-time')
    },
    differentiators: lines('kb-differentiators'),
    faq: faq,
    forbidden_claims: lines('kb-forbidden'),
    fallback_phrase: val('kb-fallback'),
    booking_url: val('kb-booking')
  };
}

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

  if (action === 'save-kb') {
    const kbData = _collectKBData();
    if (!kbData.company.name) { _showStatus('kb-status', 'Le nom de l\'entreprise est requis', false); return; }
    target.disabled = true;
    target.textContent = 'Sauvegarde...';
    API.saveKb(kbData).then(res => {
      target.disabled = false;
      target.textContent = 'Sauvegarder la KB';
      _showStatus('kb-status', res && res.success ? 'Knowledge Base sauvegardee !' : (res && res.error) || 'Erreur', res && res.success);
    });
  }

  if (action === 'add-plan') {
    const container = document.getElementById('kb-plans-container');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'kb-plan-row';
    row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr 2fr auto;gap:8px;margin-bottom:6px';
    row.innerHTML = '<input class="ob-input kb-plan-name" placeholder="Nom"><input class="ob-input kb-plan-price" placeholder="Prix"><input class="ob-input kb-plan-vol" placeholder="Volume"><input class="ob-input kb-plan-desc" placeholder="Description"><button class="btn-danger-outline kb-remove-plan" style="padding:4px 8px;font-size:12px" type="button">X</button>';
    container.insertBefore(row, container.querySelector('[data-action="add-plan"]'));
  }

  if (action === 'add-faq') {
    const container = document.getElementById('kb-faq-container');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'kb-faq-row';
    row.style.cssText = 'border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px';
    row.innerHTML = '<div style="display:grid;gap:8px"><div><label class="ob-label">Question</label><input class="ob-input kb-faq-q" maxlength="300"></div><div><label class="ob-label">Reponse</label><textarea class="ob-input kb-faq-a" rows="2" maxlength="1000"></textarea></div><button class="btn-danger-outline kb-remove-faq" style="padding:4px 8px;font-size:12px;justify-self:end" type="button">Supprimer</button></div>';
    container.insertBefore(row, container.querySelector('[data-action="add-faq"]'));
  }

  if (target.classList.contains('kb-remove-plan')) {
    target.closest('.kb-plan-row')?.remove();
    return;
  }

  if (target.classList.contains('kb-remove-faq')) {
    target.closest('.kb-faq-row')?.remove();
    return;
  }

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
      campaignMilestone: !!document.getElementById('pref-milestone')?.checked,
      emailNotifications: !!document.getElementById('pref-email-notif')?.checked,
      notificationEmail: (document.getElementById('pref-notif-email')?.value || '').trim()
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
