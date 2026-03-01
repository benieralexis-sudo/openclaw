/* ===== Page: Onboarding Wizard ===== */
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

Pages.onboarding = async function(container) {
  // Load current onboarding state
  const data = await API.get('/api/onboarding');
  if (data && !data.error) {
    _onboardingData = data;
    // Determine current step from saved progress
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
  <div class="page-enter" style="max-width:700px;margin:0 auto">
    <div style="text-align:center;margin-bottom:32px">
      <h1 style="font-size:28px;margin-bottom:8px">Bienvenue sur iFIND</h1>
      <p style="color:var(--text-muted)">Configurons votre prospection en quelques etapes</p>
    </div>

    <!-- Progress bar -->
    <div style="display:flex;gap:4px;margin-bottom:32px">
      ${STEPS.map((s, i) => `
        <div style="flex:1;text-align:center">
          <div style="height:4px;border-radius:2px;background:${i <= _currentStep ? 'var(--accent-blue)' : 'var(--border)'};transition:background .3s"></div>
          <div style="font-size:11px;margin-top:4px;color:${i <= _currentStep ? 'var(--text-primary)' : 'var(--text-muted)'}">${s.label}</div>
        </div>
      `).join('')}
    </div>

    <!-- Step content -->
    <div class="card">
      <div class="card-body" id="onboarding-step-content">
        ${_renderStepContent(_currentStep)}
      </div>
    </div>

    <!-- Navigation -->
    <div style="display:flex;justify-content:space-between;margin-top:16px">
      <button class="btn-export" data-action="onboarding-prev" style="padding:8px 20px;visibility:${_currentStep > 0 ? 'visible' : 'hidden'}">Precedent</button>
      <button class="btn-export" data-action="onboarding-next" style="padding:8px 20px;background:var(--accent-blue);color:#fff;border:none">${_currentStep === STEPS.length - 1 ? 'Lancer la prospection' : 'Suivant'}</button>
    </div>
    <div id="onboarding-error" style="color:var(--accent-red);font-size:13px;text-align:center;margin-top:8px;display:none"></div>
  </div>`;
}

function _renderStepContent(step) {
  const cfg = _onboardingData.config || {};
  const icp = _onboardingData.icp || {};
  const tone = _onboardingData.tone || {};

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
            <label class="ob-label">Domaine *</label>
            <input type="text" id="ob-domain" value="${e(cfg.clientDomain || '')}" placeholder="acme.fr" class="ob-input">
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
      </div>`;

    case 1: return `
      <h2 style="font-size:18px;margin-bottom:16px">${Utils.icon('target', 18)} Votre cible (ICP)</h2>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">Decrivez votre prospect ideal. Separez les valeurs par des virgules.</p>
      <div style="display:grid;gap:16px">
        <div>
          <label class="ob-label">Industries cibles</label>
          <input type="text" id="ob-industries" value="${e((icp.industries || []).join(', '))}" placeholder="SaaS, Tech, FinTech, E-commerce" class="ob-input">
        </div>
        <div>
          <label class="ob-label">Titres / Postes cibles</label>
          <input type="text" id="ob-titles" value="${e((icp.titles || []).join(', '))}" placeholder="CEO, CTO, VP Sales, Head of Growth" class="ob-input">
        </div>
        <div>
          <label class="ob-label">Tailles d'entreprise</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px" id="ob-sizes">
            ${['1-10', '11-50', '51-200', '201-500', '501-1000', '1001+'].map(s => `
              <label style="display:flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:13px">
                <input type="checkbox" value="${s}" ${(icp.companySizes || []).includes(s) ? 'checked' : ''}> ${s}
              </label>
            `).join('')}
          </div>
        </div>
        <div>
          <label class="ob-label">Geographie</label>
          <input type="text" id="ob-geography" value="${e((icp.geography || []).join(', '))}" placeholder="France, Belgique, Suisse" class="ob-input">
        </div>
      </div>`;

    case 2: return `
      <h2 style="font-size:18px;margin-bottom:16px">${Utils.icon('edit', 18)} Ton des emails</h2>
      <div style="display:grid;gap:16px">
        <div>
          <label class="ob-label">Niveau de formalite</label>
          <select id="ob-formality" class="ob-input">
            <option value="tres-formel" ${tone.formality === 'tres-formel' ? 'selected' : ''}>Tres formel (vouvoiement strict)</option>
            <option value="formel" ${tone.formality === 'formel' ? 'selected' : ''}>Formel (vouvoiement souple)</option>
            <option value="decontracte" ${tone.formality === 'decontracte' || !tone.formality ? 'selected' : ''}>Decontracte (tutoiement)</option>
            <option value="familier" ${tone.formality === 'familier' ? 'selected' : ''}>Familier (tutoiement direct)</option>
          </select>
        </div>
        <div>
          <label class="ob-label">Proposition de valeur</label>
          <textarea id="ob-value-prop" class="ob-input" rows="3" placeholder="Decrivez en 2-3 phrases ce que vous apportez a vos clients...">${e(tone.valueProposition || '')}</textarea>
        </div>
        <div>
          <label class="ob-label">Mots/expressions a eviter (separes par virgule)</label>
          <input type="text" id="ob-forbidden" value="${e((tone.forbiddenWords || []).join(', '))}" placeholder="synergies, disruptif, revolutionnaire" class="ob-input">
        </div>
      </div>`;

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

function _parseTags(input) {
  return (input || '').split(',').map(s => s.trim()).filter(Boolean);
}

async function _saveCurrentStep() {
  const errEl = document.getElementById('onboarding-error');
  if (errEl) errEl.style.display = 'none';

  switch(_currentStep) {
    case 0: {
      const name = (document.getElementById('ob-company-name')?.value || '').trim();
      const domain = (document.getElementById('ob-domain')?.value || '').trim();
      if (!name || !domain) {
        if (errEl) { errEl.textContent = 'Nom et domaine requis'; errEl.style.display = ''; }
        return false;
      }
      const res = await API.post('onboarding/company', {
        name,
        domain,
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
      // Update local data
      _onboardingData.config = { ..._onboardingData.config,
        clientDomain: domain,
        clientDescription: (document.getElementById('ob-description')?.value || '').trim(),
        senderName: (document.getElementById('ob-sender-name')?.value || '').trim(),
        senderFullName: (document.getElementById('ob-sender-full')?.value || '').trim(),
        senderTitle: (document.getElementById('ob-sender-title')?.value || '').trim(),
        senderEmail: (document.getElementById('ob-sender-email')?.value || '').trim()
      };
      return true;
    }
    case 1: {
      const checkedSizes = [];
      document.querySelectorAll('#ob-sizes input[type=checkbox]:checked').forEach(cb => checkedSizes.push(cb.value));
      const res = await API.post('onboarding/icp', {
        industries: _parseTags(document.getElementById('ob-industries')?.value),
        titles: _parseTags(document.getElementById('ob-titles')?.value),
        companySizes: checkedSizes,
        geography: _parseTags(document.getElementById('ob-geography')?.value)
      });
      if (!res || res.error) {
        if (errEl) { errEl.textContent = (res && res.error) || 'Erreur'; errEl.style.display = ''; }
        return false;
      }
      _onboardingData.icp = {
        industries: _parseTags(document.getElementById('ob-industries')?.value),
        titles: _parseTags(document.getElementById('ob-titles')?.value),
        companySizes: checkedSizes,
        geography: _parseTags(document.getElementById('ob-geography')?.value)
      };
      return true;
    }
    case 2: {
      const res = await API.post('onboarding/tone', {
        formality: document.getElementById('ob-formality')?.value || 'decontracte',
        valueProposition: (document.getElementById('ob-value-prop')?.value || '').trim(),
        forbiddenWords: _parseTags(document.getElementById('ob-forbidden')?.value)
      });
      if (!res || res.error) {
        if (errEl) { errEl.textContent = (res && res.error) || 'Erreur'; errEl.style.display = ''; }
        return false;
      }
      _onboardingData.tone = {
        formality: document.getElementById('ob-formality')?.value || 'decontracte',
        valueProposition: (document.getElementById('ob-value-prop')?.value || '').trim(),
        forbiddenWords: _parseTags(document.getElementById('ob-forbidden')?.value)
      };
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
      // Complete onboarding
      const res = await API.post('onboarding/complete', {});
      if (!res || res.error) {
        if (errEl) { errEl.textContent = (res && res.error) || 'Erreur lors de la finalisation'; errEl.style.display = ''; }
        return false;
      }
      // Redirect to dashboard
      window.location.hash = 'dashboard';
      if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast('Configuration terminee ! Bienvenue.');
      return true;
    }
  }
  return true;
}

// Event handlers for onboarding navigation
document.addEventListener('click', (ev) => {
  const target = ev.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'onboarding-next') {
    _saveCurrentStep().then(ok => {
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
