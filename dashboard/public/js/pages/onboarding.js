/* ===== Page: Onboarding Wizard (v2 — AI-powered + Checkboxes) ===== */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

const STEPS = [
  { id: 'company', label: 'Entreprise', icon: 'briefcase' },
  { id: 'icp', label: 'Cible (ICP)', icon: 'target' },
  { id: 'tone', label: 'Ton', icon: 'edit' },
  { id: 'integrations', label: 'Integrations', icon: 'link' },
  { id: 'summary', label: 'Lancement', icon: 'check-circle' }
];

let _currentStep = 0;
let _onboardingData = {};
let _curatedLists = null;
let _aiSuggestions = null;

async function _loadCuratedLists() {
  if (_curatedLists) return _curatedLists;
  _curatedLists = await API.get('/api/curated-lists');
  return _curatedLists;
}

Pages.onboarding = async function(container) {
  await _loadCuratedLists();
  const data = await API.get('/api/onboarding');
  if (data && !data.error) {
    _onboardingData = data;
    if (data.steps) {
      if (data.steps.integrations) _currentStep = 4;
      else if (data.steps.tone) _currentStep = 3;
      else if (data.steps.icp) _currentStep = 2;
      else if (data.steps.company) _currentStep = 1;
      else _currentStep = 0;
    }
  }
  _renderWizard(container);
};

function _renderWizard(container) {
  container.innerHTML = `
  <div class="page-enter" style="max-width:720px;margin:0 auto">
    <div style="text-align:center;margin-bottom:32px">
      <h1 style="font-size:28px;margin-bottom:8px">Bienvenue sur iFIND</h1>
      <p style="color:var(--text-muted)">Configurons votre prospection en quelques etapes</p>
    </div>
    <div style="display:flex;gap:4px;margin-bottom:32px">
      ${STEPS.map((s, i) => `
        <div style="flex:1;text-align:center">
          <div style="height:4px;border-radius:2px;background:${i <= _currentStep ? 'var(--accent-blue)' : 'var(--border)'};transition:background .3s"></div>
          <div style="font-size:11px;margin-top:4px;color:${i <= _currentStep ? 'var(--text-primary)' : 'var(--text-muted)'}">${s.label}</div>
        </div>
      `).join('')}
    </div>
    <div class="card">
      <div class="card-body" id="onboarding-step-content">
        ${_renderStepContent(_currentStep)}
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:16px">
      <button class="btn-export" data-action="onboarding-prev" style="padding:8px 20px;visibility:${_currentStep > 0 ? 'visible' : 'hidden'}">Precedent</button>
      <button class="btn-export" data-action="onboarding-next" style="padding:8px 20px;background:var(--accent-blue);color:#fff;border:none">${_currentStep === STEPS.length - 1 ? 'Lancer la prospection' : 'Suivant'}</button>
    </div>
    <div id="onboarding-error" style="color:var(--accent-red);font-size:13px;text-align:center;margin-top:8px;display:none"></div>
  </div>`;
}

function _renderCheckboxGroup(id, items, selected, columns) {
  columns = columns || 3;
  return '<div id="' + id + '" class="ob-checkbox-grid" style="grid-template-columns:repeat(' + columns + ',1fr)">' +
    items.map(function(item) {
      const val = typeof item === 'object' ? item.value : item;
      const label = typeof item === 'object' ? item.label : item;
      const checked = (selected || []).includes(val);
      return '<label class="ob-checkbox-item' + (checked ? ' ob-checked' : '') + '">' +
        '<input type="checkbox" value="' + e(val) + '"' + (checked ? ' checked' : '') + '> <span>' + e(label) + '</span></label>';
    }).join('') + '</div>';
}

function _getCheckedValues(containerId) {
  const values = [];
  document.querySelectorAll('#' + containerId + ' input[type=checkbox]:checked').forEach(function(cb) { values.push(cb.value); });
  return values;
}

function _renderStepContent(step) {
  const cfg = _onboardingData.config || {};
  const icp = _onboardingData.icp || {};
  const tone = _onboardingData.tone || {};
  const lists = _curatedLists || {};
  const ai = _aiSuggestions || {};

  switch(step) {
    case 0: return `
      <h2 style="font-size:18px;margin-bottom:16px">${Utils.icon('briefcase', 18)} Votre entreprise</h2>
      <div style="display:grid;gap:16px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label class="ob-label">Nom de l'entreprise *</label>
            <input type="text" id="ob-company-name" value="${e(_onboardingData.name || '')}" placeholder="Acme Corp" class="ob-input">
          </div>
          <div>
            <label class="ob-label">Site web *</label>
            <input type="url" id="ob-website-url" value="${e(cfg.clientWebsite || (cfg.clientDomain ? 'https://' + cfg.clientDomain : ''))}" placeholder="https://acme.fr" class="ob-input">
          </div>
        </div>
        <div>
          <label class="ob-label">Description de l'entreprise</label>
          <input type="text" id="ob-description" value="${e(cfg.clientDescription || '')}" placeholder="Cabinet conseil en strategie digitale" class="ob-input">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label class="ob-label">Prenom du sender</label>
            <input type="text" id="ob-sender-name" value="${e(cfg.senderName || '')}" placeholder="Jean" class="ob-input">
          </div>
          <div>
            <label class="ob-label">Nom complet</label>
            <input type="text" id="ob-sender-full" value="${e(cfg.senderFullName || '')}" placeholder="Jean Dupont" class="ob-input">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label class="ob-label">Titre</label>
            <input type="text" id="ob-sender-title" value="${e(cfg.senderTitle || 'Fondateur')}" placeholder="Fondateur" class="ob-input">
          </div>
          <div>
            <label class="ob-label">Email d'envoi</label>
            <input type="email" id="ob-sender-email" value="${e(cfg.senderEmail || '')}" placeholder="hello@acme.fr" class="ob-input">
          </div>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:4px">${Utils.icon('zap', 14)} Votre site sera analyse par IA pour pre-configurer votre ICP et ton d'email.</p>
      </div>`;

    case 1: {
      const selIndustries = icp.industries && icp.industries.length > 0 ? icp.industries : (ai.suggestedIndustries || []);
      const selTitles = icp.titles && icp.titles.length > 0 ? icp.titles : (ai.suggestedTitles || []);
      const selSeniorities = icp.seniorities && icp.seniorities.length > 0 ? icp.seniorities : (ai.suggestedSeniorities || []);
      const selSizes = icp.companySizes && icp.companySizes.length > 0 ? icp.companySizes : (ai.suggestedCompanySizes || []);
      const selGeo = icp.geography && icp.geography.length > 0 ? icp.geography : (ai.suggestedGeography || []);
      const hasAi = ai.suggestedIndustries && ai.suggestedIndustries.length > 0;

      return `
      <h2 style="font-size:18px;margin-bottom:4px">${Utils.icon('target', 18)} Votre cible (ICP)</h2>
      <p style="color:${hasAi ? 'var(--accent-blue)' : 'var(--text-muted)'};font-size:12px;margin-bottom:16px">${hasAi ? 'Pre-rempli par l\'analyse IA — ajustez selon vos besoins' : 'Selectionnez les criteres de votre prospect ideal'}</p>
      <div style="display:grid;gap:20px">
        <div>
          <label class="ob-label">Industries cibles</label>
          ${_renderCheckboxGroup('ob-industries', lists.INDUSTRIES || [], selIndustries, 3)}
        </div>
        <div>
          <label class="ob-label">Postes / Titres cibles</label>
          ${_renderCheckboxGroup('ob-titles', lists.TITLES || [], selTitles, 3)}
        </div>
        <div>
          <label class="ob-label">Niveau de seniorite</label>
          ${_renderCheckboxGroup('ob-seniorities', lists.SENIORITIES || [], selSeniorities, 3)}
        </div>
        <div>
          <label class="ob-label">Taille d'entreprise</label>
          ${_renderCheckboxGroup('ob-sizes', lists.COMPANY_SIZES || [], selSizes, 6)}
        </div>
        <div>
          <label class="ob-label">Geographie</label>
          ${_renderCheckboxGroup('ob-geography', lists.GEOGRAPHY || [], selGeo, 3)}
        </div>
      </div>`;
    }

    case 2: {
      const selFormality = tone.formality || ai.suggestedFormality || 'decontracte';
      const selVP = tone.valueProposition || ai.suggestedValueProposition || '';
      const selForbidden = tone.forbiddenWords && tone.forbiddenWords.length > 0 ? tone.forbiddenWords : (ai.suggestedForbiddenWords || []);
      const hasAi = ai.suggestedFormality;

      return `
      <h2 style="font-size:18px;margin-bottom:4px">${Utils.icon('edit', 18)} Ton des emails</h2>
      <p style="color:${hasAi ? 'var(--accent-blue)' : 'var(--text-muted)'};font-size:12px;margin-bottom:16px">${hasAi ? 'Pre-rempli par l\'analyse IA' : 'Configurez le style de vos emails'}</p>
      <div style="display:grid;gap:16px">
        <div>
          <label class="ob-label">Niveau de formalite</label>
          <select id="ob-formality" class="ob-input">
            ${(lists.FORMALITIES || []).map(function(f) {
              return '<option value="' + f.value + '"' + (f.value === selFormality ? ' selected' : '') + '>' + e(f.label) + '</option>';
            }).join('')}
          </select>
        </div>
        <div>
          <label class="ob-label">Proposition de valeur</label>
          <textarea id="ob-value-prop" class="ob-input" rows="3" maxlength="500" placeholder="Decrivez en 2-3 phrases ce que vous apportez a vos clients...">${e(selVP)}</textarea>
          <div style="text-align:right;font-size:11px;color:var(--text-muted)" id="ob-vp-count">${selVP.length}/500</div>
        </div>
        <div>
          <label class="ob-label">Mots/expressions a eviter</label>
          ${_renderCheckboxGroup('ob-forbidden', lists.FORBIDDEN_WORDS_STANDARD || [], selForbidden, 3)}
        </div>
      </div>`;
    }

    case 3: return `
      <h2 style="font-size:18px;margin-bottom:16px">${Utils.icon('link', 18)} Integrations (optionnel)</h2>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">Connectez vos outils existants. Vous pouvez sauter cette etape.</p>
      <div style="display:grid;gap:16px">
        <div>
          <label class="ob-label">HubSpot API Key</label>
          <input type="text" id="ob-hubspot" value="${e(cfg.hubspotApiKey || '')}" placeholder="pat-na1-..." class="ob-input">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label class="ob-label">Cal.com API Key</label>
            <input type="text" id="ob-calcom-key" value="${e(cfg.calcomApiKey || '')}" placeholder="cal_live_..." class="ob-input">
          </div>
          <div>
            <label class="ob-label">Cal.com Username</label>
            <input type="text" id="ob-calcom-user" value="${e(cfg.calcomUsername || '')}" placeholder="jean-dupont" class="ob-input">
          </div>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:16px">
          <label class="ob-label">IMAP (suivi des reponses)</label>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:4px">
            <input type="text" id="ob-imap-host" value="${e(cfg.imapHost || '')}" placeholder="imap.gmail.com" class="ob-input">
            <input type="text" id="ob-imap-user" value="${e(cfg.imapUser || '')}" placeholder="hello@acme.fr" class="ob-input">
            <input type="password" id="ob-imap-pass" value="${e(cfg.imapPass || '')}" placeholder="Mot de passe app" class="ob-input">
          </div>
        </div>
      </div>`;

    case 4: {
      const cfg2 = _onboardingData.config || {};
      const icp2 = _onboardingData.icp || {};
      const tone2 = _onboardingData.tone || {};
      return `
      <h2 style="font-size:18px;margin-bottom:16px">${Utils.icon('check-circle', 18)} Resume & Lancement</h2>
      <div style="display:grid;gap:12px">
        <div class="ob-summary-row"><strong>Entreprise :</strong> ${e(cfg2.clientDomain || '—')}</div>
        <div class="ob-summary-row"><strong>Sender :</strong> ${e(cfg2.senderName || '—')} &lt;${e(cfg2.senderEmail || '—')}&gt;</div>
        <div class="ob-summary-row"><strong>Industries :</strong> ${e((icp2.industries || []).join(', ') || '—')}</div>
        <div class="ob-summary-row"><strong>Postes cibles :</strong> ${e((icp2.titles || []).join(', ') || '—')}</div>
        <div class="ob-summary-row"><strong>Seniorites :</strong> ${e((icp2.seniorities || []).join(', ') || '—')}</div>
        <div class="ob-summary-row"><strong>Geographie :</strong> ${e((icp2.geography || []).join(', ') || '—')}</div>
        <div class="ob-summary-row"><strong>Ton :</strong> ${e(tone2.formality || 'decontracte')}</div>
        <div class="ob-summary-row"><strong>Integrations :</strong> ${[
          cfg2.hubspotApiKey ? 'HubSpot' : '',
          cfg2.calcomApiKey ? 'Cal.com' : '',
          cfg2.imapHost ? 'IMAP' : ''
        ].filter(Boolean).join(', ') || 'Aucune'}</div>
      </div>
      <p style="color:var(--text-muted);font-size:13px;margin-top:16px">Cliquez "Lancer la prospection" pour finaliser la configuration et demarrer.</p>`;
    }

    default: return '';
  }
}

async function _analyzeWebsite(url) {
  const container = document.getElementById('onboarding-step-content');
  if (!container) return false;
  container.innerHTML = `
    <div class="ob-loading">
      <div class="ob-spinner"></div>
      <h3 style="margin-top:16px;font-size:16px">Analyse de votre site en cours...</h3>
      <p style="color:var(--text-muted);font-size:13px;margin-top:8px">Notre IA parcourt votre site pour pre-configurer votre prospection.</p>
    </div>`;
  try {
    const res = await API.post('ai/analyze-website', { url: url });
    if (res && res.success && res.analysis) {
      _aiSuggestions = res.analysis;
      if (res.analysis.companyDescription) {
        _onboardingData.config = _onboardingData.config || {};
        _onboardingData.config.clientDescription = res.analysis.companyDescription;
      }
    } else {
      _aiSuggestions = null;
      if (typeof Utils !== 'undefined' && Utils.toast) {
        Utils.toast((res && res.error) || 'Analyse echouee — configuration manuelle');
      }
    }
  } catch (err) {
    _aiSuggestions = null;
  }
  return true;
}

async function _saveCurrentStep() {
  const errEl = document.getElementById('onboarding-error');
  if (errEl) errEl.style.display = 'none';

  switch(_currentStep) {
    case 0: {
      const name = (document.getElementById('ob-company-name')?.value || '').trim();
      const websiteUrl = (document.getElementById('ob-website-url')?.value || '').trim();
      if (!name || !websiteUrl) {
        if (errEl) { errEl.textContent = 'Nom et URL du site requis'; errEl.style.display = ''; }
        return false;
      }
      let domain;
      try {
        const u = new URL(websiteUrl.startsWith('http') ? websiteUrl : 'https://' + websiteUrl);
        domain = u.hostname.replace(/^www\./, '');
      } catch (err) {
        if (errEl) { errEl.textContent = 'URL invalide'; errEl.style.display = ''; }
        return false;
      }
      const res = await API.post('onboarding/company', {
        name,
        domain,
        clientWebsite: websiteUrl,
        description: (document.getElementById('ob-description')?.value || '').trim(),
        senderName: (document.getElementById('ob-sender-name')?.value || '').trim(),
        senderFullName: (document.getElementById('ob-sender-full')?.value || '').trim(),
        senderTitle: (document.getElementById('ob-sender-title')?.value || '').trim(),
        senderEmail: (document.getElementById('ob-sender-email')?.value || '').trim()
      });
      if (!res || res.error) {
        if (errEl) { errEl.textContent = (res && res.error) || 'Erreur'; errEl.style.display = ''; }
        return false;
      }
      _onboardingData.config = { ..._onboardingData.config,
        clientDomain: domain,
        clientWebsite: websiteUrl,
        clientDescription: (document.getElementById('ob-description')?.value || '').trim(),
        senderName: (document.getElementById('ob-sender-name')?.value || '').trim(),
        senderFullName: (document.getElementById('ob-sender-full')?.value || '').trim(),
        senderTitle: (document.getElementById('ob-sender-title')?.value || '').trim(),
        senderEmail: (document.getElementById('ob-sender-email')?.value || '').trim()
      };
      // Launch AI analysis
      await _analyzeWebsite(websiteUrl);
      return true;
    }
    case 1: {
      const icpData = {
        industries: _getCheckedValues('ob-industries'),
        titles: _getCheckedValues('ob-titles'),
        seniorities: _getCheckedValues('ob-seniorities'),
        companySizes: _getCheckedValues('ob-sizes'),
        geography: _getCheckedValues('ob-geography')
      };
      const res = await API.post('onboarding/icp', icpData);
      if (!res || res.error) {
        if (errEl) { errEl.textContent = (res && res.error) || 'Erreur'; errEl.style.display = ''; }
        return false;
      }
      _onboardingData.icp = icpData;
      return true;
    }
    case 2: {
      const toneData = {
        formality: document.getElementById('ob-formality')?.value || 'decontracte',
        valueProposition: (document.getElementById('ob-value-prop')?.value || '').trim(),
        forbiddenWords: _getCheckedValues('ob-forbidden')
      };
      const res = await API.post('onboarding/tone', toneData);
      if (!res || res.error) {
        if (errEl) { errEl.textContent = (res && res.error) || 'Erreur'; errEl.style.display = ''; }
        return false;
      }
      _onboardingData.tone = toneData;
      return true;
    }
    case 3: {
      const res = await API.post('onboarding/integrations', {
        hubspotApiKey: (document.getElementById('ob-hubspot')?.value || '').trim(),
        calcomApiKey: (document.getElementById('ob-calcom-key')?.value || '').trim(),
        calcomUsername: (document.getElementById('ob-calcom-user')?.value || '').trim(),
        imapHost: (document.getElementById('ob-imap-host')?.value || '').trim(),
        imapUser: (document.getElementById('ob-imap-user')?.value || '').trim(),
        imapPass: (document.getElementById('ob-imap-pass')?.value || '').trim()
      });
      if (!res || res.error) {
        if (errEl) { errEl.textContent = (res && res.error) || 'Erreur'; errEl.style.display = ''; }
        return false;
      }
      _onboardingData.config = { ..._onboardingData.config,
        hubspotApiKey: (document.getElementById('ob-hubspot')?.value || '').trim(),
        calcomApiKey: (document.getElementById('ob-calcom-key')?.value || '').trim(),
        calcomUsername: (document.getElementById('ob-calcom-user')?.value || '').trim(),
        imapHost: (document.getElementById('ob-imap-host')?.value || '').trim(),
        imapUser: (document.getElementById('ob-imap-user')?.value || '').trim(),
        imapPass: (document.getElementById('ob-imap-pass')?.value || '').trim()
      };
      return true;
    }
    case 4: {
      const res = await API.post('onboarding/complete', {});
      if (!res || res.error) {
        if (errEl) { errEl.textContent = (res && res.error) || 'Erreur lors de la finalisation'; errEl.style.display = ''; }
        return false;
      }
      window.location.hash = 'dashboard';
      if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast('Configuration terminee ! Bienvenue.');
      return true;
    }
  }
  return true;
}

// Character counter for value proposition
document.addEventListener('input', function(ev) {
  if (ev.target.id === 'ob-value-prop') {
    const counter = document.getElementById('ob-vp-count');
    if (counter) counter.textContent = ev.target.value.length + '/500';
  }
});

// Event handlers for onboarding navigation
document.addEventListener('click', function(ev) {
  const target = ev.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'onboarding-next') {
    target.disabled = true;
    target.textContent = '...';
    _saveCurrentStep().then(function(ok) {
      target.disabled = false;
      target.textContent = _currentStep === STEPS.length - 1 ? 'Lancer la prospection' : 'Suivant';
      if (ok && _currentStep < STEPS.length - 1) {
        _currentStep++;
        const container = document.getElementById('page-container');
        if (container) _renderWizard(container);
      }
    });
  }
  if (action === 'onboarding-prev') {
    if (_currentStep > 0) {
      _currentStep--;
      const container = document.getElementById('page-container');
      if (container) _renderWizard(container);
    }
  }
});
}
