'use strict';

const https = require('node:https');

const ALERT_THRESHOLD_SCORE = 8.0;
const ALERT_MULTI_PATTERN_MIN = 2;
const ALERT_DEDUP_DAYS = 7;

function sendTelegram(token, chatId, text) {
  return new Promise((resolve) => {
    if (!token || !chatId) return resolve({ ok: false, reason: 'missing-creds' });
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ ok: false, reason: 'parse-error' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, reason: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

function ensureAlertTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trigger_alerts_sent (
      siren TEXT NOT NULL,
      reason TEXT NOT NULL,
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (siren, reason)
    );
  `);
}

async function checkAndAlert(db, options = {}) {
  const log = options.log || console;
  const token = options.token || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.ADMIN_CHAT_ID || '1409505520';
  if (!token) return { sent: 0, reason: 'no-token' };

  ensureAlertTable(db);

  const candidates = db.prepare(`
    SELECT pm.siren, c.raison_sociale, c.naf_label, c.departement,
           pm.pattern_id, pm.score, pm.matched_at,
           (SELECT COUNT(DISTINCT pattern_id) FROM patterns_matched
            WHERE siren = pm.siren
              AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)) as n_patterns,
           (SELECT SUM(score) FROM patterns_matched
            WHERE siren = pm.siren
              AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)) as total_score
    FROM patterns_matched pm
    LEFT JOIN companies c ON c.siren = pm.siren
    WHERE (pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP)
      AND pm.matched_at >= datetime('now', '-1 day')
      AND (pm.score >= ? OR pm.siren IN (
        SELECT siren FROM patterns_matched
        WHERE (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        GROUP BY siren HAVING COUNT(DISTINCT pattern_id) >= ?
      ))
  `).all(ALERT_THRESHOLD_SCORE, ALERT_MULTI_PATTERN_MIN);

  const dedupCheck = db.prepare(`
    SELECT sent_at FROM trigger_alerts_sent
    WHERE siren = ? AND reason = ?
      AND (julianday('now') - julianday(sent_at)) < ?
  `);
  const recordAlert = db.prepare(`
    INSERT OR REPLACE INTO trigger_alerts_sent (siren, reason, sent_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);

  const bySiren = new Map();
  for (const c of candidates) {
    if (!bySiren.has(c.siren)) bySiren.set(c.siren, c);
  }

  let sent = 0;
  for (const [siren, lead] of bySiren) {
    const reason = lead.n_patterns >= ALERT_MULTI_PATTERN_MIN ? `multi-${lead.n_patterns}` : `score-${Math.floor(lead.score)}`;
    const already = dedupCheck.get(siren, reason, ALERT_DEDUP_DAYS);
    if (already) continue;

    const contact = db.prepare(`
      SELECT prenom, nom, fonction, email
      FROM leads_contacts WHERE siren = ? AND email IS NOT NULL
      ORDER BY email_confidence DESC LIMIT 1
    `).get(siren);

    const patterns = db.prepare(`
      SELECT pattern_id, score FROM patterns_matched
      WHERE siren = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      ORDER BY score DESC
    `).all(siren);

    const nomSafe = (lead.raison_sociale || siren).replace(/([_*\[\]`])/g, '\\$1');
    const patternsLine = patterns.map(p => `${p.pattern_id} ${p.score.toFixed(1)}`).join(' · ');
    const contactLine = contact ? `👤 ${contact.prenom || ''} ${contact.nom || ''} (${contact.fonction || '-'})\n📧 ${contact.email}` : '👤 contact non enrichi';
    const dashboardUrl = 'https://srv1319748.hstgr.cloud/#triggers';

    const msg = [
      `🚨 *Nouveau lead Trigger Engine* (${reason})`,
      ``,
      `🏢 *${nomSafe}* — SIREN \`${siren}\``,
      `📍 ${lead.departement || '?'} · ${lead.naf_label || 'NAF non enrichi'}`,
      `🎯 ${patternsLine}`,
      `💯 Score cumulé : *${(lead.total_score || lead.score).toFixed(1)}*`,
      ``,
      contactLine,
      ``,
      `Dashboard : ${dashboardUrl}`
    ].join('\n');

    const r = await sendTelegram(token, chatId, msg);
    if (r.ok) {
      recordAlert.run(siren, reason);
      sent += 1;
      log.info?.(`[alert] envoyé pour ${siren} (${reason})`);
    } else {
      log.warn?.(`[alert] échec envoi ${siren}: ${r.reason || 'unknown'}`);
    }
  }

  return { sent, candidates: bySiren.size };
}

module.exports = { checkAndAlert, sendTelegram };
