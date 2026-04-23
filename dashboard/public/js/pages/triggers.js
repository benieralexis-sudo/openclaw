/* ═══════════════════════════════════════════════════════════════════
 * Page: Triggers FR (Trigger Engine Dashboard)
 * ═══════════════════════════════════════════════════════════════════ */
{
const e = (s) => Utils.escapeHtml(s);
window.Pages = window.Pages || {};

// State du filtrage, persisté pendant la session
const filterState = {
  minScore: 6,
  pattern: '',
  dept: ''
};

Pages.triggers = async function(container) {
  if (App.userRole !== 'admin') {
    container.innerHTML = '<div class="empty-state"><p>Accès réservé aux administrateurs</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1>🎯 Trigger Engine FR</h1>
      <p class="page-subtitle">Moteur de détection signaux d'achat temps réel sur PME françaises</p>
    </div>
    <div id="triggers-content"><div class="empty-state"><p>Chargement...</p></div></div>
  `;

  await renderContent();
};

async function renderContent() {
  const content = document.getElementById('triggers-content');
  if (!content) return;

  const [statsRes, leadsRes, eventsRes, ingestionRes, patternsRes] = await Promise.all([
    fetch('/api/trigger-engine/stats').then(r => r.json()).catch(() => null),
    fetchLeads(),
    fetch('/api/trigger-engine/events?limit=30').then(r => r.json()).catch(() => null),
    fetch('/api/trigger-engine/ingestion-state').then(r => r.json()).catch(() => null),
    fetch('/api/trigger-engine/patterns').then(r => r.json()).catch(() => null)
  ]);

  if (!statsRes || statsRes.enabled === false) {
    content.innerHTML = `<div class="card"><h2>⚠️ Trigger Engine non initialisé</h2><p>Ajouter TRIGGER_ENGINE_ENABLED=true dans /opt/moltbot/.env + redémarrer.</p></div>`;
    return;
  }

  const stats = statsRes;
  const leads = (leadsRes && leadsRes.leads) || [];
  const events = (eventsRes && eventsRes.events) || [];
  const ingestion = (ingestionRes && ingestionRes.sources) || [];
  const patterns = (patternsRes && patternsRes.patterns) || [];

  const csvUrl = buildCsvUrl();

  content.innerHTML = `
    <!-- STATS CARDS -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Entreprises cachées</div>
        <div class="stat-value">${stats.companies.toLocaleString('fr-FR')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Events total</div>
        <div class="stat-value">${stats.events_total.toLocaleString('fr-FR')}</div>
        <div class="stat-sub">${stats.events_last_24h} dernières 24h</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Attribution SIREN</div>
        <div class="stat-value">${stats.events_attributed.toLocaleString('fr-FR')}</div>
        <div class="stat-sub">${stats.events_total > 0 ? Math.round(stats.events_attributed / stats.events_total * 100) : 0}% attribués</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Patterns matched actifs</div>
        <div class="stat-value stat-highlight">${stats.matches_active.toLocaleString('fr-FR')}</div>
        <div class="stat-sub">${stats.matches_last_24h} dernières 24h</div>
      </div>
    </div>

    <!-- LEADS avec filtres + export -->
    <div class="card" style="margin-top:1.5em">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1em">
        <h2 style="margin:0">🎯 Leads qualifiés (${leads.length})</h2>
        <div style="display:flex;gap:0.5em;flex-wrap:wrap">
          <a href="${csvUrl}" class="btn btn-primary" download>⬇ Export CSV</a>
        </div>
      </div>

      <!-- Filtres -->
      <div style="display:flex;gap:1em;margin:1em 0;flex-wrap:wrap;align-items:end">
        <div>
          <label style="display:block;font-size:0.85em;color:#6b7280;margin-bottom:0.25em">Score min</label>
          <select id="filter-score" class="form-control" style="width:120px">
            <option value="0">Tous</option>
            <option value="5" ${filterState.minScore === 5 ? 'selected' : ''}>≥ 5</option>
            <option value="6" ${filterState.minScore === 6 ? 'selected' : ''}>≥ 6 (par défaut)</option>
            <option value="7" ${filterState.minScore === 7 ? 'selected' : ''}>≥ 7</option>
            <option value="9" ${filterState.minScore === 9 ? 'selected' : ''}>≥ 9 (hot)</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.85em;color:#6b7280;margin-bottom:0.25em">Pattern</label>
          <select id="filter-pattern" class="form-control" style="width:200px">
            <option value="">Tous</option>
            ${patterns.map(p => `<option value="${e(p.id)}" ${filterState.pattern === p.id ? 'selected' : ''}>${e(p.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.85em;color:#6b7280;margin-bottom:0.25em">Département</label>
          <input id="filter-dept" type="text" class="form-control" placeholder="ex: 75" value="${e(filterState.dept)}" style="width:100px">
        </div>
        <button id="filter-apply" class="btn">Appliquer</button>
        <button id="filter-reset" class="btn btn-outline">Reset</button>
      </div>

      ${leads.length === 0 ? '<p class="empty-state">Aucun lead ne matche ces filtres. Essayez score ≥ 5 ou reset.</p>' :
      `<table class="data-table">
        <thead><tr>
          <th>Score</th><th>Entreprise</th><th>SIREN</th><th>Activité</th><th>Localisation</th><th>Effectif</th><th>Contact principal</th><th>Pattern</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${leads.map(l => renderLeadRow(l)).join('')}
        </tbody>
      </table>`}
    </div>

    <!-- SOURCES -->
    <div class="card" style="margin-top:1.5em">
      <h2>🔍 Sources ingestion</h2>
      ${ingestion.length === 0 ? '<p class="empty-state">Aucune source encore exécutée</p>' :
      `<table class="data-table">
        <thead><tr><th>Source</th><th>Dernier run</th><th>Events</th><th>Erreurs</th><th>Status</th></tr></thead>
        <tbody>
          ${ingestion.map(s => `
            <tr>
              <td><strong>${e(s.source)}</strong></td>
              <td>${s.last_run_at ? new Date(s.last_run_at).toLocaleString('fr-FR') : '—'}</td>
              <td>${s.events_last_run || 0}</td>
              <td>${s.errors_last_run > 0 ? `<span style="color:#dc2626">${s.errors_last_run}</span>` : '0'}</td>
              <td>${s.enabled ? '<span style="color:#16a34a">✓ actif</span>' : '<span style="color:#6b7280">désactivé</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>

    <!-- RECENT EVENTS -->
    <div class="card" style="margin-top:1.5em">
      <h2>📡 Events récents</h2>
      ${events.length === 0 ? '<p class="empty-state">Aucun event capturé</p>' :
      `<table class="data-table">
        <thead><tr><th>Source</th><th>Type</th><th>Entreprise</th><th>Date</th><th>Attribué ?</th></tr></thead>
        <tbody>
          ${events.slice(0, 30).map(ev => `
            <tr>
              <td><strong>${e(ev.source)}</strong></td>
              <td>${e(ev.event_type)}</td>
              <td>${e(ev.raison_sociale || ev.siren || '—')}</td>
              <td><small>${new Date(ev.captured_at).toLocaleString('fr-FR')}</small></td>
              <td>${ev.siren ? `<span style="color:#16a34a">✓ ${(ev.attribution_confidence * 100).toFixed(0)}%</span>` : '<span style="color:#6b7280">—</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>

    <!-- PATTERNS -->
    <div class="card" style="margin-top:1.5em">
      <h2>🧩 Patterns configurés</h2>
      ${patterns.length === 0 ? '<p class="empty-state">Aucun pattern chargé</p>' :
      `<table class="data-table">
        <thead><tr><th>ID</th><th>Nom</th><th>Verticaux</th><th>Min score</th></tr></thead>
        <tbody>
          ${patterns.map(p => `<tr><td><code>${e(p.id)}</code></td><td>${e(p.name)}</td><td>${(p.verticaux || []).join(', ') || '—'}</td><td>${p.min_score}</td></tr>`).join('')}
        </tbody>
      </table>`}
    </div>
  `;

  injectStyles();
  wireFilters();
  wirePitchButtons();
}

function renderLeadRow(l) {
  const scoreClass = l.score >= 9 ? 'red' : l.score >= 7 ? 'orange' : 'yellow';
  const sirenDisplay = l.is_real_siren
    ? `<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/${e(l.siren)}" target="_blank" rel="noopener" style="color:#2563EB;text-decoration:none">${e(l.siren)} ↗</a>`
    : `<small style="color:#9ca3af" title="Pseudo-SIREN (non résolu par INSEE)">${e(l.siren)}</small>`;
  const loc = l.departement ? `Dept ${e(l.departement)}` : '—';
  const naf = l.naf_code ? `${e(l.naf_code)}${l.naf_label ? ' — ' + e(l.naf_label) : ''}` : '—';
  const eff = l.effectif ? `${l.effectif}` : '—';
  const contacts = l.contacts || [];
  const mainContact = contacts[0];
  const contactSummary = mainContact
    ? `<strong>${e(mainContact.prenom || '')} ${e(mainContact.nom || '')}</strong><br><small style="color:#6b7280">${e(mainContact.fonction || '')}</small>`
    : '<small style="color:#9ca3af">—</small>';

  return `
    <tr data-lead-id="${l.id}">
      <td><span class="score-badge score-${scoreClass}">${l.score.toFixed(1)}</span></td>
      <td><strong>${e(l.raison_sociale || '—')}</strong></td>
      <td>${sirenDisplay}</td>
      <td><small>${naf}</small></td>
      <td><small>${loc}</small></td>
      <td>${eff}</td>
      <td>${contactSummary}</td>
      <td><small>${e(l.pattern_name || l.pattern_id)}</small></td>
      <td>
        <button class="btn btn-sm pitch-btn" data-lead-id="${l.id}">✉ Pitch</button>
        <button class="btn btn-sm opus-btn" data-lead-id="${l.id}" style="margin-left:0.25em">🧠 Opus</button>
      </td>
    </tr>
    <tr class="pitch-row" data-lead-id="${l.id}" style="display:none">
      <td colspan="9" style="background:#f9fafb">
        <div style="padding:0.75em">
          <div class="opus-block" data-lead-id="${l.id}" style="display:none;background:#eff6ff;padding:0.75em;border-left:3px solid #2563EB;border-radius:4px;margin-bottom:1em"></div>
          ${contacts.length > 0 ? `
          <div style="font-weight:600;margin-bottom:0.5em">Contacts identifiés (${contacts.length}) :</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:0.5em;margin-bottom:1em">
            ${contacts.map(c => `
              <div style="background:#fff;padding:0.5em 0.75em;border:1px solid #e5e7eb;border-radius:4px">
                <div><strong>${e(c.prenom || '')} ${e(c.nom || '')}</strong> <small style="color:#6b7280">— ${e(c.fonction || '')}</small></div>
                ${c.email ? `
                <div style="margin-top:0.25em">
                  <code style="font-size:0.85em">${e(c.email)}</code>
                  <button class="btn btn-sm btn-outline copy-email-btn" data-email="${e(c.email)}" style="margin-left:0.5em;padding:0.1em 0.4em;font-size:0.75em">📋</button>
                  ${c.email_confidence != null ? `<span style="font-size:0.75em;color:#6b7280;margin-left:0.5em">confiance ${(c.email_confidence*100).toFixed(0)}%</span>` : ''}
                  ${c.email_source && c.email_source.includes('guessed-domain') ? '<span style="font-size:0.75em;color:#ea580c;margin-left:0.5em" title="Domaine deviné — à valider manuellement">⚠ à vérifier</span>' : ''}
                </div>
                ` : '<div style="margin-top:0.25em;font-size:0.85em;color:#9ca3af">Email non trouvé</div>'}
                ${c.domain_web ? `<div style="font-size:0.75em;color:#6b7280;margin-top:0.25em">🌐 ${e(c.domain_web)}</div>` : ''}
              </div>
            `).join('')}
          </div>
          ` : '<div style="background:#fef3c7;padding:0.5em;border-radius:4px;margin-bottom:1em;font-size:0.9em">Aucun contact identifié pour ce SIREN. Cliquer ici pour chercher sur annuaire-entreprises.data.gouv.fr ↗</div>'}

          <div style="font-weight:600;margin-bottom:0.5em">Objet :</div>
          <div style="background:#fff;padding:0.5em 0.75em;border:1px solid #e5e7eb;border-radius:4px;font-family:monospace;font-size:0.9em">${e((l.pitch && l.pitch.subject) || '—')}</div>
          <div style="font-weight:600;margin:0.75em 0 0.5em">Corps :</div>
          <div style="background:#fff;padding:0.75em;border:1px solid #e5e7eb;border-radius:4px;white-space:pre-wrap;font-size:0.9em;line-height:1.5">${e((l.pitch && l.pitch.body) || '—')}</div>
          <button class="btn btn-sm btn-outline copy-pitch-btn" data-lead-id="${l.id}" style="margin-top:0.5em">📋 Copier email complet</button>
        </div>
      </td>
    </tr>
  `;
}

function fetchLeads() {
  const params = new URLSearchParams();
  if (filterState.minScore > 0) params.set('min_score', filterState.minScore);
  if (filterState.pattern) params.set('pattern', filterState.pattern);
  if (filterState.dept) params.set('dept', filterState.dept);
  params.set('limit', '200');
  return fetch('/api/trigger-engine/leads?' + params.toString()).then(r => r.json()).catch(() => null);
}

function buildCsvUrl() {
  const params = new URLSearchParams();
  if (filterState.minScore > 0) params.set('min_score', filterState.minScore);
  if (filterState.pattern) params.set('pattern', filterState.pattern);
  return '/api/trigger-engine/leads.csv?' + params.toString();
}

function wireFilters() {
  document.getElementById('filter-apply')?.addEventListener('click', () => {
    filterState.minScore = parseFloat(document.getElementById('filter-score').value || '0');
    filterState.pattern = document.getElementById('filter-pattern').value || '';
    filterState.dept = document.getElementById('filter-dept').value.trim() || '';
    renderContent();
  });
  document.getElementById('filter-reset')?.addEventListener('click', () => {
    filterState.minScore = 6;
    filterState.pattern = '';
    filterState.dept = '';
    renderContent();
  });
}

function wirePitchButtons() {
  document.querySelectorAll('.pitch-btn').forEach(btn => {
    btn.addEventListener('click', (evt) => {
      const id = evt.currentTarget.dataset.leadId;
      const row = document.querySelector(`.pitch-row[data-lead-id="${id}"]`);
      if (row) {
        row.style.display = row.style.display === 'none' ? '' : 'none';
      }
    });
  });
  document.querySelectorAll('.copy-pitch-btn').forEach(btn => {
    btn.addEventListener('click', (evt) => {
      const id = evt.currentTarget.dataset.leadId;
      const row = document.querySelector(`.pitch-row[data-lead-id="${id}"]`);
      if (!row) return;
      const blocks = row.querySelectorAll('div > div[style*="font-family:monospace"], div > div[style*="white-space:pre-wrap"]');
      const subject = blocks[0]?.innerText || '';
      const body = blocks[1]?.innerText || '';
      const txt = `Objet : ${subject}\n\n${body}`;
      navigator.clipboard.writeText(txt).then(() => {
        evt.currentTarget.innerText = '✓ Copié !';
        setTimeout(() => { evt.currentTarget.innerText = '📋 Copier email complet'; }, 2000);
      });
    });
  });
  document.querySelectorAll('.copy-email-btn').forEach(btn => {
    btn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      const email = evt.currentTarget.dataset.email;
      navigator.clipboard.writeText(email).then(() => {
        const orig = evt.currentTarget.innerText;
        evt.currentTarget.innerText = '✓';
        setTimeout(() => { evt.currentTarget.innerText = orig; }, 1500);
      });
    });
  });
  // Opus qualification
  document.querySelectorAll('.opus-btn').forEach(btn => {
    btn.addEventListener('click', async (evt) => {
      const id = evt.currentTarget.dataset.leadId;
      const row = document.querySelector(`.pitch-row[data-lead-id="${id}"]`);
      const block = document.querySelector(`.opus-block[data-lead-id="${id}"]`);
      if (!row || !block) return;
      row.style.display = '';
      block.style.display = '';
      block.innerHTML = '<small style="color:#6b7280">🧠 Chargement qualification Opus...</small>';
      try {
        const r = await fetch('/api/trigger-engine/leads/' + id + '/qualification').then(r => r.json());
        if (!r.qualification) {
          block.innerHTML = '<small style="color:#6b7280">Pas encore de qualification Opus pour ce lead. Le backfill n\'a peut-être pas tourné ou le budget Claude Brain est à zéro.</small>';
          return;
        }
        const q = r.qualification;
        const meta = r.meta || {};
        const redFlags = (q.red_flags || []).map(f => `<span style="display:inline-block;background:#fee2e2;color:#991b1b;padding:0.15em 0.5em;border-radius:3px;margin-right:0.25em;font-size:0.8em">${escapeHtml(f)}</span>`).join('');
        const antiAngles = (q.anti_angles || []).map(a => `<li>${escapeHtml(a)}</li>`).join('');
        const hooks = (q.personalization_hooks || []).map(h => `<li>${escapeHtml(h)}</li>`).join('');
        block.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5em">
            <strong style="color:#1e40af">🧠 Qualification Opus</strong>
            <div style="font-size:0.75em;color:#6b7280">
              Score Opus <strong style="color:#1e40af;font-size:1.1em">${q.priority_score_opus ?? '?'}</strong> / 10
              · ${escapeHtml(q.buying_stage || '-')}
              · v${meta.version || '?'} · ${meta.model || '-'} · ${(meta.cost_eur || 0).toFixed(4)}€
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:0.5em;margin-bottom:0.5em">
            <div><strong>Phase :</strong> ${escapeHtml(q.phase || '-')}</div>
            <div><strong>Décideur réel :</strong> ${escapeHtml(q.decision_maker_real || '-')}</div>
            <div><strong>Timing :</strong> ${q.timing_window_days || '?'} jours</div>
          </div>
          ${q.decision_maker_reasoning ? `<div style="font-size:0.85em;color:#4b5563;margin-bottom:0.5em"><em>${escapeHtml(q.decision_maker_reasoning)}</em></div>` : ''}
          <div style="background:#fff;padding:0.5em;border-radius:4px;margin-bottom:0.5em">
            <strong>Angle primary :</strong> ${escapeHtml(q.angle_pitch_primary || '-')}<br>
            ${q.angle_pitch_backup ? `<small><strong>Backup :</strong> ${escapeHtml(q.angle_pitch_backup)}</small>` : ''}
          </div>
          ${q.urgency_reason ? `<div style="margin-bottom:0.5em"><strong>Urgency :</strong> ${escapeHtml(q.urgency_reason)}</div>` : ''}
          ${redFlags ? `<div style="margin-bottom:0.5em"><strong>Red flags :</strong> ${redFlags}</div>` : ''}
          ${antiAngles ? `<div style="margin-bottom:0.5em"><strong>À éviter :</strong><ul style="margin:0.25em 0 0 1.5em">${antiAngles}</ul></div>` : ''}
          ${hooks ? `<div><strong>Hooks perso :</strong><ul style="margin:0.25em 0 0 1.5em">${hooks}</ul></div>` : ''}
        `;
      } catch (err) {
        block.innerHTML = `<small style="color:#dc2626">Erreur : ${escapeHtml(err.message)}</small>`;
      }
    });
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function injectStyles() {
  if (document.getElementById('triggers-page-styles')) return;
  const style = document.createElement('style');
  style.id = 'triggers-page-styles';
  style.textContent = `
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1em; }
    .stat-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1em; }
    .stat-label { font-size: 0.85em; color: #6b7280; text-transform: uppercase; letter-spacing: 0.03em; }
    .stat-value { font-size: 2em; font-weight: 600; color: #111827; margin-top: 0.25em; }
    .stat-highlight { color: #2563EB; }
    .stat-sub { font-size: 0.8em; color: #6b7280; margin-top: 0.25em; }
    .score-badge { display: inline-block; padding: 0.2em 0.6em; border-radius: 4px; font-weight: 600; font-size: 0.9em; }
    .score-red { background: #fee2e2; color: #dc2626; }
    .score-orange { background: #fed7aa; color: #ea580c; }
    .score-yellow { background: #fef3c7; color: #ca8a04; }
    .btn-sm { padding: 0.25em 0.6em; font-size: 0.85em; }
  `;
  document.head.appendChild(style);
}
}
