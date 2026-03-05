/* ===== Page: Approbations (HITL email drafts) ===== */
{
const e = (s) => Utils.escapeHtml(s);

const sentimentInfo = {
  interested:  { class: 'badge-green',  label: 'Intéressé' },
  question:    { class: 'badge-blue',   label: 'Question' },
  objection:   { class: 'badge-orange', label: 'Objection' },
  positive:    { class: 'badge-green',  label: 'Positif' },
  negative:    { class: 'badge-red',    label: 'Négatif' },
  neutral:     { class: 'badge-gray',   label: 'Neutre' }
};

function sentimentBadge(sentiment) {
  const s = sentimentInfo[sentiment] || { class: 'badge-gray', label: sentiment || '—' };
  return `<span class="badge ${s.class}">${s.label}</span>`;
}

function formatTimeLeft(ms) {
  if (ms <= 0) return 'Expiré';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function confidenceBadge(conf) {
  const pct = Math.round((conf || 0) * 100);
  const cls = pct >= 80 ? 'badge-green' : pct >= 60 ? 'badge-orange' : 'badge-red';
  return `<span class="badge ${cls}">${pct}%</span>`;
}

function groundedBadge(grounded) {
  if (grounded === true) {
    return `<span class="badge badge-green" title="Reponse groundee dans la KB — envoi auto possible">KB</span>`;
  }
  if (grounded === false) {
    return `<span class="badge badge-orange" title="Reponse non groundee — validation requise">HITL</span>`;
  }
  return '';
}

function autoSendCountdown(d) {
  if (!d.grounded || !d.autoSendAt) return '';
  const remaining = d.autoSendAt - Date.now();
  if (remaining <= 0) return '<span class="badge badge-green" style="animation:pulse 1s infinite">Envoi imminent</span>';
  const mins = Math.ceil(remaining / 60000);
  return `<span class="badge badge-blue" title="Envoi automatique dans ${mins} min">Auto-send ${mins}min</span>`;
}

window.Pages = window.Pages || {};

// Auto-refresh timer
let _draftsRefreshTimer = null;

Pages.drafts = async function(container) {
  // Clear previous timer
  if (_draftsRefreshTimer) { clearInterval(_draftsRefreshTimer); _draftsRefreshTimer = null; }

  const drafts = await API.drafts();
  if (!drafts) return container.innerHTML = '<div class="empty-state"><p>Impossible de charger les données</p></div>';

  const count = Array.isArray(drafts) ? drafts.length : 0;

  container.innerHTML = `
  <div class="page-enter stagger">
    <div class="page-header">
      <h1 class="page-title">${Utils.icon('inbox')} Approbations</h1>
      <div class="page-actions">
        <span style="color:var(--text-muted);font-size:13px">${count} email${count !== 1 ? 's' : ''} en attente</span>
      </div>
    </div>

    ${count === 0 ? `
    <div class="card">
      <div class="card-body" style="text-align:center;padding:60px 20px">
        <div style="font-size:48px;margin-bottom:16px;opacity:0.3">${Utils.icon('check-circle', 48)}</div>
        <p style="color:var(--text-secondary);font-size:15px;margin:0">Aucun email en attente d'approbation</p>
        <p style="color:var(--text-muted);font-size:13px;margin-top:8px">Les brouillons apparaîtront ici automatiquement</p>
      </div>
    </div>
    ` : `
    <div class="drafts-list" id="drafts-list">
      ${drafts.map(d => renderDraftCard(d)).join('')}
    </div>
    `}
  </div>

  <!-- Modal d'édition -->
  <div id="draft-edit-modal" class="modal-backdrop" style="display:none" role="dialog" aria-modal="true" aria-label="Modifier le brouillon">
    <div class="modal" style="max-width:640px">
      <div class="modal-header">
        <h3 class="modal-title">Modifier la réponse</h3>
        <button class="modal-close" data-action="close-draft-modal" aria-label="Fermer">&times;</button>
      </div>
      <div class="modal-body">
        <div style="margin-bottom:12px">
          <label style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Destinataire</label>
          <div id="modal-recipient" style="font-size:14px;color:var(--text-primary);margin-top:4px"></div>
        </div>
        <div style="margin-bottom:12px">
          <label style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Objet</label>
          <div id="modal-subject" style="font-size:14px;color:var(--text-primary);margin-top:4px"></div>
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Corps du message</label>
          <textarea id="modal-body-edit" style="width:100%;min-height:200px;margin-top:8px;padding:12px;background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius-md);color:var(--text-primary);font-size:14px;font-family:inherit;resize:vertical;line-height:1.6"></textarea>
        </div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
        <button class="btn-secondary" data-action="close-draft-modal">Annuler</button>
        <button class="btn-primary" id="modal-send-btn" data-action="send-edited-draft">${Utils.icon('mail', 14)} Envoyer</button>
      </div>
    </div>
  </div>`;

  // Bind events
  bindDraftActions(container);

  // Auto-refresh every 30s
  _draftsRefreshTimer = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    if (App.currentPage !== 'drafts') { clearInterval(_draftsRefreshTimer); return; }
    // Only refresh if no modal is open
    if (document.getElementById('draft-edit-modal')?.style.display !== 'none') return;
    App.loadPage('drafts', true);
  }, 30000);
};

function renderDraftCard(d) {
  const timeLeft = formatTimeLeft(d.expiresIn || 0);
  const isExpiring = (d.expiresIn || 0) < 3600000; // < 1h

  return `
  <div class="card draft-card" data-draft-id="${e(d.id)}" style="margin-bottom:16px">
    <div class="card-body" style="padding:20px">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--accent-blue-dim);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:14px;color:var(--accent-blue)">${Utils.initials(d.prospectName || d.prospectEmail)}</div>
          <div>
            <div style="font-weight:600;font-size:14px;color:var(--text-primary)">${e(d.prospectName || d.prospectEmail)}</div>
            ${d.company ? `<div style="font-size:12px;color:var(--text-muted)">${e(d.company)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${sentimentBadge(d.sentiment)}
          ${d.subType ? `<span class="badge badge-gray">${e(d.subType)}</span>` : ''}
          ${confidenceBadge(d.confidence)}
          ${groundedBadge(d.grounded)}
          ${autoSendCountdown(d)}
          <span class="badge ${isExpiring ? 'badge-red' : 'badge-gray'}" title="Temps restant">${Utils.icon('clock', 12)} ${timeLeft}</span>
        </div>
      </div>

      <!-- Email prospect (incoming) -->
      ${d.incomingSubject ? `
      <div style="background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Email reçu</div>
        <div style="font-size:13px;color:var(--text-secondary);font-weight:500;margin-bottom:4px">${e(d.incomingSubject)}</div>
        ${d.incomingSnippet ? `<div style="font-size:13px;color:var(--text-muted);line-height:1.5">${e(Utils.truncate(d.incomingSnippet, 200))}</div>` : ''}
      </div>
      ` : ''}

      <!-- Réponse proposée -->
      <div style="background:var(--accent-blue-dim);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-md);padding:12px;margin-bottom:14px">
        <div style="font-size:11px;color:var(--accent-blue);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Réponse proposée</div>
        <div style="font-size:13px;color:var(--text-primary);font-weight:500;margin-bottom:6px">${e(d.subject)}</div>
        <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;white-space:pre-line">${e(d.body)}</div>
      </div>

      ${d.qualityWarning ? `
      <div style="background:var(--accent-orange-dim);border:1px solid rgba(245,158,11,0.2);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:14px;display:flex;align-items:center;gap:8px">
        ${Utils.icon('alert-triangle', 14)}
        <span style="font-size:13px;color:var(--accent-orange)">${e(d.qualityWarning)}</span>
      </div>
      ` : ''}

      <!-- Actions -->
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn-danger-outline draft-action" data-action="reject-draft" data-draft-id="${e(d.id)}" title="Rejeter et blacklister">
          ${Utils.icon('x', 14)} Rejeter
        </button>
        <button class="btn-secondary draft-action" data-action="skip-draft" data-draft-id="${e(d.id)}" title="Ignorer sans blacklister" style="color:var(--text-muted)">
          ${Utils.icon('skip-forward', 14)} Passer
        </button>
        <button class="btn-secondary draft-action" data-action="edit-draft" data-draft-id="${e(d.id)}" data-draft-to="${e(d.prospectEmail)}" data-draft-subject="${e(d.subject)}" data-draft-body="${e(d.body)}" title="Modifier avant envoi">
          ${Utils.icon('edit', 14)} Modifier
        </button>
        <button class="btn-primary draft-action" data-action="approve-draft" data-draft-id="${e(d.id)}" title="Approuver et envoyer">
          ${Utils.icon('check', 14)} Approuver
        </button>
      </div>
    </div>
  </div>`;
}

function bindDraftActions(container) {
  let _editingDraftId = null;

  container.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const draftId = btn.dataset.draftId;

    if (action === 'approve-draft' && draftId) {
      btn.disabled = true;
      btn.innerHTML = `${Utils.icon('loader', 14)} Envoi...`;
      const res = await API.approveDraft(draftId);
      if (res && res.success) {
        Utils.toast('Email envoyé avec succès');
        const card = container.querySelector(`[data-draft-id="${draftId}"].draft-card`);
        if (card) { card.style.opacity = '0.4'; card.style.pointerEvents = 'none'; }
        App.updateBadges();
        setTimeout(() => App.loadPage('drafts', true), 1000);
      } else {
        Utils.toast((res && res.error) || 'Erreur lors de l\'envoi');
        btn.disabled = false;
        btn.innerHTML = `${Utils.icon('check', 14)} Approuver`;
      }
    }

    if (action === 'reject-draft' && draftId) {
      if (!confirm('Rejeter cet email et blacklister le prospect ?')) return;
      btn.disabled = true;
      btn.innerHTML = `${Utils.icon('loader', 14)} ...`;
      const res = await API.rejectDraft(draftId);
      if (res && res.success) {
        Utils.toast('Prospect blacklisté');
        const card = container.querySelector(`[data-draft-id="${draftId}"].draft-card`);
        if (card) { card.style.opacity = '0.4'; card.style.pointerEvents = 'none'; }
        App.updateBadges();
        setTimeout(() => App.loadPage('drafts', true), 1000);
      } else {
        Utils.toast((res && res.error) || 'Erreur lors du rejet');
        btn.disabled = false;
        btn.innerHTML = `${Utils.icon('x', 14)} Rejeter`;
      }
    }

    if (action === 'skip-draft' && draftId) {
      btn.disabled = true;
      btn.innerHTML = `${Utils.icon('loader', 14)} ...`;
      const res = await API.post('drafts/' + encodeURIComponent(draftId) + '/skip', {});
      if (res && res.success) {
        Utils.toast('Brouillon ignore');
        const card = container.querySelector(`[data-draft-id="${draftId}"].draft-card`);
        if (card) { card.style.opacity = '0.4'; card.style.pointerEvents = 'none'; }
        App.updateBadges();
        setTimeout(() => App.loadPage('drafts', true), 1000);
      } else {
        Utils.toast((res && res.error) || 'Erreur');
        btn.disabled = false;
        btn.innerHTML = `${Utils.icon('skip-forward', 14)} Passer`;
      }
    }

    if (action === 'edit-draft' && draftId) {
      _editingDraftId = draftId;
      const modal = document.getElementById('draft-edit-modal');
      document.getElementById('modal-recipient').textContent = btn.dataset.draftTo || '';
      document.getElementById('modal-subject').textContent = btn.dataset.draftSubject || '';
      // Decode HTML entities for textarea
      const tmp = document.createElement('div');
      tmp.innerHTML = btn.dataset.draftBody || '';
      document.getElementById('modal-body-edit').value = tmp.textContent;
      modal.style.display = '';
      document.getElementById('modal-body-edit').focus();
    }

    if (action === 'close-draft-modal') {
      document.getElementById('draft-edit-modal').style.display = 'none';
      _editingDraftId = null;
    }

    if (action === 'send-edited-draft') {
      if (!_editingDraftId) return;
      const body = document.getElementById('modal-body-edit').value.trim();
      if (!body) { Utils.toast('Le corps du message ne peut pas être vide'); return; }
      const sendBtn = document.getElementById('modal-send-btn');
      sendBtn.disabled = true;
      sendBtn.innerHTML = `${Utils.icon('loader', 14)} Envoi...`;
      const res = await API.editDraft(_editingDraftId, body);
      if (res && res.success) {
        Utils.toast('Email modifié et envoyé');
        document.getElementById('draft-edit-modal').style.display = 'none';
        _editingDraftId = null;
        App.updateBadges();
        setTimeout(() => App.loadPage('drafts', true), 1000);
      } else {
        Utils.toast((res && res.error) || 'Erreur lors de l\'envoi');
        sendBtn.disabled = false;
        sendBtn.innerHTML = `${Utils.icon('mail', 14)} Envoyer`;
      }
    }
  });

  // Close modal on overlay click
  const modal = document.getElementById('draft-edit-modal');
  if (modal) {
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) {
        modal.style.display = 'none';
        _editingDraftId = null;
      }
    });
  }

  // Close modal on Escape
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && modal && modal.style.display !== 'none') {
      modal.style.display = 'none';
      _editingDraftId = null;
    }
  });
}
}
