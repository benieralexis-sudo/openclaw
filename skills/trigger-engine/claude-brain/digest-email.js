'use strict';

/**
 * Digest email builder + sender.
 *
 * Chaque matin 8h Paris, pour chaque tenant actif avec digest_enabled + digest_email :
 *   1. Query leads "frais" (créés dernières 24h OU re-qualifiés dernières 24h)
 *   2. Group par priorité (red ≥8 / orange 6-8 / yellow <6)
 *   3. Build HTML responsive avec preview pitchs
 *   4. Envoi via Resend
 *   5. Log dans digest_sends (dédup par date)
 */

const { sendEmail } = require('./email-sender');

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://srv1319748.hstgr.cloud';

function ensureTable(db) {
  // Self-healing : créé si la migration 015 n'a pas encore tourné
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS digest_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        date TEXT NOT NULL,
        email TEXT NOT NULL,
        leads_count INTEGER DEFAULT 0,
        red_count INTEGER DEFAULT 0,
        sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'sent',
        error TEXT,
        UNIQUE(tenant_id, date)
      );
    `);
  } catch {}
}

function parisDate() {
  // Format 'YYYY-MM-DD' en heure de Paris
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return paris.toISOString().slice(0, 10);
}

function parisHour() {
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return paris.getHours();
}

/**
 * Fetch les leads du digest pour un tenant : nouveaux ou re-qualifiés last 24h.
 */
function getDigestLeads(db, tenantId) {
  return db.prepare(`
    SELECT cl.id, cl.siren, cl.opus_score, cl.opus_qualified_at, cl.status, cl.created_at,
           c.raison_sociale, c.naf_label, c.departement, c.effectif_min
    FROM client_leads cl
    LEFT JOIN companies c ON c.siren = cl.siren
    WHERE cl.client_id = ?
      AND cl.status IN ('new', 'qualifying', 'sent')
      AND (
        cl.created_at >= datetime('now', '-24 hours')
        OR cl.opus_qualified_at >= datetime('now', '-24 hours')
      )
      AND cl.opus_score IS NOT NULL
    ORDER BY cl.opus_score DESC
    LIMIT 30
  `).all(tenantId);
}

function groupByPriority(leads) {
  const red = leads.filter(l => (l.opus_score || 0) >= 8);
  const orange = leads.filter(l => (l.opus_score || 0) >= 6 && (l.opus_score || 0) < 8);
  const yellow = leads.filter(l => (l.opus_score || 0) < 6);
  return { red, orange, yellow };
}

function renderLeadHtml(lead) {
  const score = (lead.opus_score || 0).toFixed(1);
  const color = lead.opus_score >= 8 ? '#dc2626' : (lead.opus_score >= 6 ? '#ea580c' : '#ca8a04');
  const nafShort = (lead.naf_label || '').slice(0, 50);
  return `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top">
        <span style="display:inline-block;background:${color};color:#fff;padding:3px 8px;border-radius:4px;font-weight:600;font-size:13px">${score}</span>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb">
        <a href="${DASHBOARD_URL}/#triggers" style="color:#1e40af;text-decoration:none;font-weight:600">${escapeHtml(lead.raison_sociale || 'Sans nom')}</a>
        <div style="color:#6b7280;font-size:12px;margin-top:2px">
          SIREN ${escapeHtml(lead.siren)} · ${escapeHtml(nafShort)} · Dpt ${escapeHtml(lead.departement || '?')}
        </div>
      </td>
    </tr>
  `;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildDigest(db, tenantId, tenantName = '') {
  const leads = getDigestLeads(db, tenantId);
  if (leads.length === 0) return null;
  const { red, orange, yellow } = groupByPriority(leads);

  const allLeadsHtml = [...red, ...orange, ...yellow].map(renderLeadHtml).join('');

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f9fafb;margin:0;padding:20px">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:linear-gradient(135deg,#1e40af 0%,#059669 100%);padding:24px;color:#fff">
      <h1 style="margin:0;font-size:22px">📬 Vos leads du jour</h1>
      <p style="margin:8px 0 0;opacity:0.9;font-size:14px">${leads.length} leads qualifiés par iFIND — ${new Date().toLocaleDateString('fr-FR')}</p>
    </div>

    <div style="padding:20px">
      <div style="display:flex;gap:12px;margin-bottom:20px">
        <div style="flex:1;background:#fef2f2;padding:12px;border-radius:6px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#dc2626">${red.length}</div>
          <div style="font-size:12px;color:#991b1b">🔴 URGENTS (≥8)</div>
        </div>
        <div style="flex:1;background:#fff7ed;padding:12px;border-radius:6px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#ea580c">${orange.length}</div>
          <div style="font-size:12px;color:#9a3412">🟠 Qualifiés (6-8)</div>
        </div>
        <div style="flex:1;background:#fefce8;padding:12px;border-radius:6px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#ca8a04">${yellow.length}</div>
          <div style="font-size:12px;color:#854d0e">🟡 À explorer</div>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="padding:8px;background:#f3f4f6;text-align:left;font-size:12px;color:#4b5563">Score</th>
            <th style="padding:8px;background:#f3f4f6;text-align:left;font-size:12px;color:#4b5563">Entreprise</th>
          </tr>
        </thead>
        <tbody>${allLeadsHtml}</tbody>
      </table>

      <div style="margin-top:24px;text-align:center">
        <a href="${DASHBOARD_URL}/#triggers" style="display:inline-block;background:#1e40af;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Voir tous les leads sur le dashboard →
        </a>
      </div>

      <p style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5">
        Chaque lead contient : qualification stratégique Opus, email pré-rédigé, DM LinkedIn, script de call, et brief RDV à la demande.
        <br><br>
        Tu ne veux plus recevoir ce digest ? Désactive dans tes settings du dashboard.
      </p>
    </div>
  </div>
</body></html>
  `;

  const subject = red.length > 0
    ? `🔴 ${red.length} lead${red.length > 1 ? 's' : ''} urgent${red.length > 1 ? 's' : ''} + ${orange.length + yellow.length} autres — ${tenantName || 'iFIND Leads'}`
    : `${leads.length} nouveaux leads qualifiés — ${tenantName || 'iFIND Leads'}`;

  return {
    subject,
    html,
    text: `Vous avez ${leads.length} nouveaux leads qualifiés aujourd'hui (${red.length} urgents). Voir sur ${DASHBOARD_URL}/#triggers`,
    leads_count: leads.length,
    red_count: red.length
  };
}

/**
 * Envoie le digest à tous les tenants actifs.
 * Idempotent via digest_sends (UNIQUE tenant_id, date).
 * @returns {{sent, skipped, failed}}
 */
async function sendDailyDigests(db, options = {}) {
  const log = options.log || console;
  ensureTable(db);
  const today = parisDate();

  const tenants = db.prepare(`
    SELECT id, name, claude_brain_config FROM clients WHERE status = 'active'
  `).all();

  const stats = { sent: 0, skipped: 0, failed: 0 };

  for (const t of tenants) {
    let cfg = {};
    try { cfg = t.claude_brain_config ? JSON.parse(t.claude_brain_config) : {}; } catch {}

    if (cfg.enabled === false) { stats.skipped += 1; continue; }
    if (cfg.digest_enabled === false) { stats.skipped += 1; continue; }
    if (!cfg.digest_email) { stats.skipped += 1; continue; }

    // Dédup : déjà envoyé aujourd'hui ?
    const already = db.prepare(`
      SELECT id FROM digest_sends WHERE tenant_id = ? AND date = ?
    `).get(t.id, today);
    if (already) { stats.skipped += 1; continue; }

    const digest = buildDigest(db, t.id, t.name);
    if (!digest) {
      // Pas de leads → on log quand même comme "sent=skipped"
      try {
        db.prepare(`INSERT INTO digest_sends (tenant_id, date, email, leads_count, status) VALUES (?, ?, ?, 0, 'skipped')`)
          .run(t.id, today, cfg.digest_email);
      } catch {}
      stats.skipped += 1;
      continue;
    }

    const r = await sendEmail({
      to: cfg.digest_email,
      subject: digest.subject,
      html: digest.html,
      text: digest.text
    });

    try {
      db.prepare(`
        INSERT INTO digest_sends (tenant_id, date, email, leads_count, red_count, status, error)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(t.id, today, cfg.digest_email, digest.leads_count, digest.red_count,
             r.ok ? 'sent' : 'failed', r.ok ? null : String(r.error).slice(0, 300));
    } catch (e) {
      log.warn?.(`[digest] log write failed for ${t.id}: ${e.message}`);
    }

    if (r.ok) {
      stats.sent += 1;
      log.info?.(`[digest] envoyé à ${cfg.digest_email} (tenant=${t.id}, ${digest.leads_count} leads, ${digest.red_count} urgents)`);
    } else {
      stats.failed += 1;
      log.warn?.(`[digest] échec ${t.id}: ${r.error}`);
    }
  }

  return stats;
}

// ═══════════════════════════════════════════════════════════
// RÉSUMÉ HEBDOMADAIRE (lundi 8h Paris)
// Opt-in via claude_brain_config.weekly_digest_enabled = true
// Dédup par semaine ISO (YYYY-Www) dans weekly_digest_sends.
// ═══════════════════════════════════════════════════════════

function ensureWeeklyTable(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS weekly_digest_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        week_key TEXT NOT NULL,
        email TEXT NOT NULL,
        leads_count INTEGER DEFAULT 0,
        red_count INTEGER DEFAULT 0,
        sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'sent',
        error TEXT,
        UNIQUE(tenant_id, week_key)
      );
    `);
  } catch {}
}

function parisWeekKey() {
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const year = paris.getFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const diffDays = Math.floor((paris - start) / (24 * 3600 * 1000));
  const week = Math.ceil((diffDays + start.getUTCDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function parisDayOfWeek() {
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return paris.getDay(); // 0=dimanche, 1=lundi
}

function getWeeklyDigestLeads(db, tenantId) {
  return db.prepare(`
    SELECT cl.id, cl.siren, cl.opus_score, cl.opus_qualified_at, cl.status, cl.created_at,
           c.raison_sociale, c.naf_label, c.departement, c.effectif_min
    FROM client_leads cl
    LEFT JOIN companies c ON c.siren = cl.siren
    WHERE cl.client_id = ?
      AND cl.status IN ('new', 'qualifying', 'sent')
      AND (
        cl.created_at >= datetime('now', '-7 days')
        OR cl.opus_qualified_at >= datetime('now', '-7 days')
      )
      AND cl.opus_score IS NOT NULL
    ORDER BY cl.opus_score DESC
    LIMIT 100
  `).all(tenantId);
}

function buildWeeklyDigest(db, tenantId, tenantName = '') {
  const leads = getWeeklyDigestLeads(db, tenantId);
  if (leads.length === 0) return null;
  const { red, orange, yellow } = groupByPriority(leads);
  const allLeadsHtml = [...red, ...orange, ...yellow].slice(0, 30).map(renderLeadHtml).join('');
  const moreHidden = Math.max(0, leads.length - 30);

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f9fafb;margin:0;padding:20px">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:linear-gradient(135deg,#1e40af 0%,#059669 100%);padding:24px;color:#fff">
      <h1 style="margin:0;font-size:22px">📊 Votre semaine iFIND</h1>
      <p style="margin:8px 0 0;opacity:0.9;font-size:14px">${leads.length} leads qualifiés les 7 derniers jours — ${new Date().toLocaleDateString('fr-FR')}</p>
    </div>
    <div style="padding:20px">
      <div style="display:flex;gap:12px;margin-bottom:20px">
        <div style="flex:1;background:#fef2f2;padding:12px;border-radius:6px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#dc2626">${red.length}</div>
          <div style="font-size:12px;color:#991b1b">🔴 Pépites (≥8)</div>
        </div>
        <div style="flex:1;background:#fff7ed;padding:12px;border-radius:6px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#ea580c">${orange.length}</div>
          <div style="font-size:12px;color:#9a3412">🟠 Qualifiés (6-8)</div>
        </div>
        <div style="flex:1;background:#fefce8;padding:12px;border-radius:6px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#ca8a04">${yellow.length}</div>
          <div style="font-size:12px;color:#854d0e">🟡 À explorer</div>
        </div>
      </div>
      <h3 style="margin:24px 0 8px;font-size:15px;color:#374151">Top leads de la semaine</h3>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="padding:8px;background:#f3f4f6;text-align:left;font-size:12px;color:#4b5563">Score</th>
            <th style="padding:8px;background:#f3f4f6;text-align:left;font-size:12px;color:#4b5563">Entreprise</th>
          </tr>
        </thead>
        <tbody>${allLeadsHtml}</tbody>
      </table>
      ${moreHidden > 0 ? `<p style="margin-top:12px;color:#6b7280;font-size:13px">+ ${moreHidden} autres leads disponibles dans le dashboard.</p>` : ''}
      <div style="margin-top:24px;text-align:center">
        <a href="${DASHBOARD_URL}/#triggers" style="display:inline-block;background:#1e40af;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Voir tous les leads sur le dashboard →
        </a>
      </div>
      <p style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5">
        Chaque lead contient : qualification Opus, email pré-rédigé, message LinkedIn, brief d'appel.
        <br><br>
        Tu ne veux plus recevoir ce résumé hebdo ? Désactive-le dans les settings du dashboard.
      </p>
    </div>
  </div>
</body></html>
  `;

  const subject = red.length > 0
    ? `📊 Votre semaine : ${red.length} pépite${red.length > 1 ? 's' : ''} + ${orange.length + yellow.length} autres leads`
    : `📊 Votre semaine iFIND : ${leads.length} leads qualifiés`;

  return {
    subject,
    html,
    text: `Cette semaine : ${leads.length} leads qualifiés (${red.length} pépites). Voir sur ${DASHBOARD_URL}/#triggers`,
    leads_count: leads.length,
    red_count: red.length
  };
}

/**
 * Envoie le résumé hebdo aux tenants avec weekly_digest_enabled === true.
 * Idempotent via weekly_digest_sends (UNIQUE tenant_id, week_key).
 */
async function sendWeeklyDigests(db, options = {}) {
  const log = options.log || console;
  ensureWeeklyTable(db);
  const weekKey = parisWeekKey();

  const tenants = db.prepare(`
    SELECT id, name, claude_brain_config FROM clients WHERE status = 'active'
  `).all();

  const stats = { sent: 0, skipped: 0, failed: 0 };

  for (const t of tenants) {
    let cfg = {};
    try { cfg = t.claude_brain_config ? JSON.parse(t.claude_brain_config) : {}; } catch {}

    if (cfg.enabled === false) { stats.skipped += 1; continue; }
    // Opt-in explicite : le client doit activer weekly_digest_enabled = true
    if (cfg.weekly_digest_enabled !== true) { stats.skipped += 1; continue; }
    if (!cfg.digest_email) { stats.skipped += 1; continue; }

    const already = db.prepare(`
      SELECT id FROM weekly_digest_sends WHERE tenant_id = ? AND week_key = ?
    `).get(t.id, weekKey);
    if (already) { stats.skipped += 1; continue; }

    const digest = buildWeeklyDigest(db, t.id, t.name);
    if (!digest) {
      try {
        db.prepare(`INSERT INTO weekly_digest_sends (tenant_id, week_key, email, leads_count, status) VALUES (?, ?, ?, 0, 'skipped')`)
          .run(t.id, weekKey, cfg.digest_email);
      } catch {}
      stats.skipped += 1;
      continue;
    }

    const r = await sendEmail({
      to: cfg.digest_email,
      subject: digest.subject,
      html: digest.html,
      text: digest.text
    });

    try {
      db.prepare(`
        INSERT INTO weekly_digest_sends (tenant_id, week_key, email, leads_count, red_count, status, error)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(t.id, weekKey, cfg.digest_email, digest.leads_count, digest.red_count,
             r.ok ? 'sent' : 'failed', r.ok ? null : String(r.error).slice(0, 300));
    } catch (e) {
      log.warn?.(`[weekly-digest] log write failed for ${t.id}: ${e.message}`);
    }

    if (r.ok) {
      stats.sent += 1;
      log.info?.(`[weekly-digest] envoyé à ${cfg.digest_email} (tenant=${t.id}, ${digest.leads_count} leads semaine)`);
    } else {
      stats.failed += 1;
      log.warn?.(`[weekly-digest] échec ${t.id}: ${r.error}`);
    }
  }

  return stats;
}

module.exports = {
  sendDailyDigests, buildDigest, getDigestLeads, parisDate, parisHour,
  sendWeeklyDigests, buildWeeklyDigest, getWeeklyDigestLeads, parisWeekKey, parisDayOfWeek,
};
