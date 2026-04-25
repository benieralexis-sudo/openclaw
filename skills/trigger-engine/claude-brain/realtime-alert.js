'use strict';

/**
 * Alerte temps réel sur pépites : envoie un email quand un lead vient d'atteindre
 * un score Opus ≥ realtime_alert_threshold (défaut 9).
 *
 * Déclenché après chaque qualify (via le cron qui détecte les nouveaux opus_score).
 * Dédup 24h par (tenant_id, siren).
 */

const { sendEmail } = require('./email-sender');

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://srv1319748.hstgr.cloud';
const DEDUP_HOURS = 24;

function ensureTable(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS realtime_alerts_sent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        siren TEXT NOT NULL,
        opus_score REAL,
        email TEXT,
        sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'sent',
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_realtime_dedup
        ON realtime_alerts_sent(tenant_id, siren, sent_at DESC);
    `);
  } catch {}
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildAlertEmail(lead, qualification) {
  const angle = qualification?.angle_pitch_primary || '';
  const decisionMaker = qualification?.decision_maker_real || '';
  const urgency = qualification?.urgency_reason || '';
  const phase = qualification?.phase || '';
  const comboLabel = qualification?.scoring_metadata?.combo_label || null;
  const comboCategories = qualification?.scoring_metadata?.hard_signals_categories || [];
  const comboBadge = comboLabel === 'JACKPOT'
    ? `<span style="display:inline-block;background:#7c3aed;color:#fff;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:700;margin-left:8px">⚡ JACKPOT (${comboCategories.length} signaux durs)</span>`
    : comboLabel === 'COMBO'
      ? `<span style="display:inline-block;background:#0891b2;color:#fff;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:700;margin-left:8px">🎯 COMBO (${comboCategories.length} signaux durs)</span>`
      : '';

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#fef2f2;margin:0;padding:20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:#dc2626;padding:20px;color:#fff">
      <div style="font-size:14px;opacity:0.9;margin-bottom:4px">🔴 PÉPITE DÉTECTÉE</div>
      <h1 style="margin:0;font-size:24px">${escapeHtml(lead.raison_sociale || 'Lead')}${comboBadge}</h1>
      <div style="margin-top:8px;font-size:14px;opacity:0.9">
        Score Opus : <strong>${(lead.opus_score || 0).toFixed(1)}/10</strong>
        · SIREN ${escapeHtml(lead.siren)}
        ${comboCategories.length > 0 ? `<div style="margin-top:4px;font-size:12px">Signaux durs : ${comboCategories.map(escapeHtml).join(' · ')}</div>` : ''}
      </div>
    </div>
    <div style="padding:20px">
      ${phase ? `<div style="margin-bottom:12px"><strong>Phase :</strong> ${escapeHtml(phase)}</div>` : ''}
      ${decisionMaker ? `<div style="margin-bottom:12px"><strong>Décideur :</strong> ${escapeHtml(decisionMaker)}</div>` : ''}
      ${angle ? `<div style="margin-bottom:12px;padding:12px;background:#f9fafb;border-left:3px solid #1e40af;border-radius:4px"><strong>Angle de pitch :</strong><br>${escapeHtml(angle)}</div>` : ''}
      ${urgency ? `<div style="margin-bottom:16px;padding:12px;background:#fef3c7;border-left:3px solid #ea580c;border-radius:4px"><strong>⏱ Urgence :</strong> ${escapeHtml(urgency)}</div>` : ''}
      <div style="text-align:center;margin-top:20px">
        <a href="${DASHBOARD_URL}/#triggers" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Voir le lead + les 3 pitchs Opus →
        </a>
      </div>
      <p style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:11px">
        Les pépites score ≥ 9 sont rares (~5% des leads). Pitch email + LinkedIn + call brief générés automatiquement.
      </p>
    </div>
  </div>
</body></html>
  `;

  return {
    subject: `🔴 Pépite ${(lead.opus_score || 0).toFixed(1)} — ${lead.raison_sociale || 'Lead urgent'}`,
    html,
    text: `Pépite détectée : ${lead.raison_sociale} score ${lead.opus_score}. Voir ${DASHBOARD_URL}/#triggers`
  };
}

/**
 * Scan les leads récemment qualifiés avec score >= threshold et envoie les alertes.
 * Appelé après chaque cycle processing (dans cron).
 */
async function sendRealtimeAlerts(db, options = {}) {
  const log = options.log || console;
  ensureTable(db);

  // Candidats : leads qualifiés dans les 2 dernières heures avec opus_score >= 9 (ou seuil tenant)
  const tenants = db.prepare(`
    SELECT id, name, claude_brain_config FROM clients WHERE status = 'active'
  `).all();

  const stats = { sent: 0, skipped: 0, failed: 0 };

  for (const t of tenants) {
    let cfg = {};
    try { cfg = t.claude_brain_config ? JSON.parse(t.claude_brain_config) : {}; } catch {}

    if (cfg.enabled === false) continue;
    if (cfg.realtime_alert_enabled === false) continue;
    if (!cfg.digest_email) continue; // même email pour digest et alerte

    const threshold = Number(cfg.realtime_alert_threshold ?? 9.0);

    const candidates = db.prepare(`
      SELECT cl.id, cl.siren, cl.opus_score, cl.opus_qualified_at, cl.opus_result_id,
             c.raison_sociale
      FROM client_leads cl
      LEFT JOIN companies c ON c.siren = cl.siren
      WHERE cl.client_id = ?
        AND cl.opus_score >= ?
        AND cl.opus_qualified_at >= datetime('now', '-2 hours')
        AND cl.status IN ('new', 'qualifying')
    `).all(t.id, threshold);

    for (const lead of candidates) {
      // Dédup 24h
      const already = db.prepare(`
        SELECT sent_at FROM realtime_alerts_sent
        WHERE tenant_id = ? AND siren = ?
          AND (julianday('now') - julianday(sent_at)) * 24 < ?
        ORDER BY sent_at DESC LIMIT 1
      `).get(t.id, lead.siren, DEDUP_HOURS);
      if (already) { stats.skipped += 1; continue; }

      // Récupère la qualification Opus
      let qualification = null;
      if (lead.opus_result_id) {
        const qRow = db.prepare('SELECT result_json FROM claude_brain_results WHERE id = ?').get(lead.opus_result_id);
        if (qRow) { try { qualification = JSON.parse(qRow.result_json); } catch {} }
      }

      const email = buildAlertEmail(lead, qualification);
      const r = await sendEmail({
        to: cfg.digest_email,
        subject: email.subject,
        html: email.html,
        text: email.text
      });

      try {
        db.prepare(`
          INSERT INTO realtime_alerts_sent (tenant_id, siren, opus_score, email, status, error)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(t.id, lead.siren, lead.opus_score, cfg.digest_email,
               r.ok ? 'sent' : 'failed', r.ok ? null : String(r.error).slice(0, 300));
      } catch (e) {
        log.warn?.(`[realtime-alert] log write failed: ${e.message}`);
      }

      if (r.ok) {
        stats.sent += 1;
        log.info?.(`[realtime-alert] pépite ${lead.raison_sociale} (${lead.opus_score}) → ${cfg.digest_email}`);
      } else {
        stats.failed += 1;
      }
    }
  }

  return stats;
}

module.exports = { sendRealtimeAlerts, buildAlertEmail };
