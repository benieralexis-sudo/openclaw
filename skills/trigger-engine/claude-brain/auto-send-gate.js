'use strict';

/**
 * Auto-Send Gate — 8 règles de sécurité avant envoi Smartlead.
 *
 * Appelé JUSTE AVANT un envoi automatique. Retourne { ok, reason, checks[] }
 * avec le détail de chaque règle. Si une seule règle fail → { ok: false }.
 *
 * Les règles sont testées dans l'ordre du moins coûteux au plus coûteux.
 * Aucune règle n'appelle Opus par défaut (règle 8 optionnelle).
 */

const CONTACT_BLACKOUT_DAYS = 60;
const REPLY_RATE_WINDOW_DAYS = 7;
const REPLY_RATE_MIN = 0.02; // 2%
const MAILBOX_DAILY_CAP = 50;

const FORBIDDEN_PATTERNS = [
  /procédure\s+collective/i,
  /liquidation\s+judiciaire/i,
  /redressement\s+judiciaire/i,
  /cessation\s+(d'activité|de\s+paiement)/i
];

class AutoSendGate {
  constructor(db, options = {}) {
    this.db = db;
    this.log = options.log || console;
    this.anthropicCaller = options.anthropicCaller || null; // optionnel — règle 8
    this.now = options.now || (() => new Date());
  }

  /**
   * Évalue les 8 règles pour un lead donné.
   * @param {object} input
   * @param {number} input.leadId - id de client_leads
   * @param {object} [input.tenantConfig] - config du tenant (sinon lue depuis DB)
   * @param {string} [input.pitchText] - texte du pitch (règle 8)
   * @param {string} [input.mailboxId] - id de la mailbox qui va envoyer (règle 5)
   * @returns {Promise<{ok:boolean, reason:string|null, checks:array}>}
   */
  async canSend(input) {
    const lead = this._getLead(input.leadId);
    if (!lead) return { ok: false, reason: 'lead-not-found', checks: [] };

    const cfg = input.tenantConfig || this._getTenantConfig(lead.client_id);
    const checks = [];
    const thresholds = {
      opus: Number(cfg.auto_send_threshold_opus ?? 8.5),
      emailConfidence: Number(cfg.auto_send_threshold_email_confidence ?? 0.85)
    };

    // Règle 1 — Opus score
    const r1 = this._checkOpusScore(lead, thresholds.opus);
    checks.push(r1);
    if (!r1.ok) return this._fail('opus_score_too_low', checks);

    // Règle 2 — Email deliverability (confidence + MX)
    const r2 = this._checkEmailDeliverability(lead, thresholds.emailConfidence);
    checks.push(r2);
    if (!r2.ok) return this._fail('email_not_deliverable', checks);

    // Règle 3 — Pas contacté récemment (60j)
    const r3 = this._checkNoRecentContact(lead);
    checks.push(r3);
    if (!r3.ok) return this._fail('recent_contact_60d', checks);

    // Règle 4 — Timing autorisé
    const r4 = this._checkTimingAllowed();
    checks.push(r4);
    if (!r4.ok) return this._fail('timing_not_allowed', checks);

    // Règle 5 — Quota mailbox
    const r5 = this._checkMailboxQuota(input.mailboxId);
    checks.push(r5);
    if (!r5.ok) return this._fail('mailbox_quota_exceeded', checks);

    // Règle 6 — Reply rate global > 2%
    const r6 = this._checkReplyRate(lead.client_id);
    checks.push(r6);
    if (!r6.ok) return this._fail('reply_rate_too_low', checks);

    // Règle 7 — Blacklist sémantique
    const r7 = this._checkSemanticBlacklist(lead);
    checks.push(r7);
    if (!r7.ok) return this._fail('semantic_blacklist_hit', checks);

    // Règle 8 — Validation finale Opus (optionnel, si caller fourni)
    if (this.anthropicCaller && input.pitchText) {
      const r8 = await this._checkOpusFinalValidation(lead, cfg, input.pitchText);
      checks.push(r8);
      if (!r8.ok) return this._fail('opus_final_rejected', checks);
    } else {
      checks.push({ rule: 'opus_final', ok: true, skipped: true, note: 'pas de caller Opus fourni' });
    }

    return { ok: true, reason: null, checks };
  }

  _fail(reason, checks) {
    return { ok: false, reason, checks };
  }

  _getLead(leadId) {
    return this.db.prepare(`
      SELECT cl.id, cl.client_id, cl.siren, cl.status, cl.opus_score,
             cl.sent_at, cl.created_at,
             c.raison_sociale, c.naf_code, c.naf_label
      FROM client_leads cl
      LEFT JOIN companies c ON c.siren = cl.siren
      WHERE cl.id = ?
    `).get(leadId);
  }

  _getTenantConfig(tenantId) {
    const row = this.db.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get(tenantId);
    if (!row || !row.claude_brain_config) return {};
    try { return JSON.parse(row.claude_brain_config); } catch { return {}; }
  }

  _checkOpusScore(lead, threshold) {
    const ok = lead.opus_score != null && lead.opus_score >= threshold;
    return { rule: 'opus_score', ok, value: lead.opus_score, threshold };
  }

  _checkEmailDeliverability(lead, confidenceThreshold) {
    const contact = this.db.prepare(`
      SELECT email, email_confidence, email_source
      FROM leads_contacts
      WHERE siren = ? AND email IS NOT NULL
      ORDER BY email_confidence DESC LIMIT 1
    `).get(lead.siren);
    if (!contact) return { rule: 'email_deliverability', ok: false, reason: 'no-email' };
    const ok = (contact.email_confidence || 0) >= confidenceThreshold;
    // Si MX vérifié dans email_source → bonus accepté à confidence plus basse
    const mxVerified = (contact.email_source || '').includes('mx-verified');
    if (mxVerified && (contact.email_confidence || 0) >= 0.5) {
      return { rule: 'email_deliverability', ok: true, email: contact.email, confidence: contact.email_confidence, mxVerified: true };
    }
    return { rule: 'email_deliverability', ok, email: contact.email, confidence: contact.email_confidence, threshold: confidenceThreshold };
  }

  _checkNoRecentContact(lead) {
    const row = this.db.prepare(`
      SELECT MAX(sent_at) as last_sent
      FROM client_leads
      WHERE siren = ? AND sent_at IS NOT NULL
    `).get(lead.siren);
    if (!row || !row.last_sent) return { rule: 'no_recent_contact', ok: true };
    const lastSent = new Date(row.last_sent);
    const daysSince = (Date.now() - lastSent.getTime()) / (1000 * 3600 * 24);
    const ok = daysSince >= CONTACT_BLACKOUT_DAYS;
    return { rule: 'no_recent_contact', ok, last_sent: row.last_sent, days_since: Math.floor(daysSince), blackout_days: CONTACT_BLACKOUT_DAYS };
  }

  _checkTimingAllowed() {
    const now = this.now();
    const h = now.getHours();
    const d = now.getDay(); // 0 = dimanche, 6 = samedi
    // Refusé : nuit (20h-8h), weekend, lundi matin (avant 10h), vendredi après 15h
    if (h < 8 || h >= 20) return { rule: 'timing', ok: false, reason: 'outside_business_hours', hour: h };
    if (d === 0 || d === 6) return { rule: 'timing', ok: false, reason: 'weekend', day: d };
    if (d === 1 && h < 10) return { rule: 'timing', ok: false, reason: 'monday_morning', hour: h };
    if (d === 5 && h >= 15) return { rule: 'timing', ok: false, reason: 'friday_afternoon', hour: h };
    return { rule: 'timing', ok: true, hour: h, day: d };
  }

  _checkMailboxQuota(mailboxId) {
    if (!mailboxId) {
      return { rule: 'mailbox_quota', ok: true, note: 'no mailbox specified (check skipped)' };
    }
    // On suppose qu'une table mailbox_send_log existe, sinon skip
    try {
      const row = this.db.prepare(`
        SELECT COUNT(*) as n FROM mailbox_send_log
        WHERE mailbox_id = ? AND sent_at >= date('now', 'start of day')
      `).get(mailboxId);
      const sentToday = row?.n || 0;
      const ok = sentToday < MAILBOX_DAILY_CAP;
      return { rule: 'mailbox_quota', ok, mailbox: mailboxId, sent_today: sentToday, cap: MAILBOX_DAILY_CAP };
    } catch {
      return { rule: 'mailbox_quota', ok: true, note: 'log table missing (check skipped)' };
    }
  }

  _checkReplyRate(tenantId) {
    // Ratio : replied_positive / sent sur WINDOW_DAYS
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN sent_at >= datetime('now', '-${REPLY_RATE_WINDOW_DAYS} days') THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'replied_positive' AND replied_at >= datetime('now', '-${REPLY_RATE_WINDOW_DAYS} days') THEN 1 ELSE 0 END) as replied
      FROM client_leads
      WHERE client_id = ?
    `).get(tenantId);
    const sent = row?.sent || 0;
    const replied = row?.replied || 0;
    if (sent < 20) {
      return { rule: 'reply_rate', ok: true, note: 'too few samples (<20), check skipped', sent, replied };
    }
    const rate = replied / sent;
    const ok = rate >= REPLY_RATE_MIN;
    return { rule: 'reply_rate', ok, rate, sent, replied, min: REPLY_RATE_MIN };
  }

  _checkSemanticBlacklist(lead) {
    // NAF label ou raison sociale contient un motif interdit ?
    const text = `${lead.raison_sociale || ''} ${lead.naf_label || ''}`.toLowerCase();
    for (const pat of FORBIDDEN_PATTERNS) {
      if (pat.test(text)) return { rule: 'semantic_blacklist', ok: false, matched: String(pat) };
    }
    // Check events récents pour mots-clés négatifs
    const recent = this.db.prepare(`
      SELECT raw_data FROM events
      WHERE siren = ? AND event_date >= date('now', '-90 days')
      ORDER BY event_date DESC LIMIT 30
    `).all(lead.siren);
    for (const e of recent) {
      for (const pat of FORBIDDEN_PATTERNS) {
        if (pat.test(e.raw_data || '')) return { rule: 'semantic_blacklist', ok: false, matched: String(pat), from_events: true };
      }
    }
    // Qualification Opus précédente a-t-elle des red flags critiques ?
    const q = this.db.prepare(`
      SELECT result_json FROM claude_brain_results
      WHERE siren = ? AND pipeline = 'qualify'
      ORDER BY version DESC LIMIT 1
    `).get(lead.siren);
    if (q) {
      try {
        const parsed = JSON.parse(q.result_json);
        const flags = parsed.red_flags || [];
        for (const f of flags) {
          if (/procédure|cessation|radié|liquidation|difficulté|retard paiement/i.test(f)) {
            return { rule: 'semantic_blacklist', ok: false, matched: f, from_qualif: true };
          }
        }
      } catch {}
    }
    return { rule: 'semantic_blacklist', ok: true };
  }

  async _checkOpusFinalValidation(lead, cfg, pitchText) {
    // Règle 8 : demander à Opus (Haiku pour économie) si l'email est safe à envoyer
    try {
      const systemPrompt = `Tu es un superviseur qualité commerciale. Ton rôle : valider qu'un email outbound peut partir maintenant.\n\nRéponds en JSON strict : {"verdict": "OUI" | "NON" | "DOUTE", "reason": "1 phrase"}\n\nRègles de refus :\n- Red flag business (procédure, fraude, cessation)\n- Email agressif, trop familier, ou inapproprié pour le contexte\n- Informations incorrectes ou hallucinées\n\nSi DOUTE ou NON → bloqué.`;
      const dataContext = `Entreprise : ${lead.raison_sociale}\nSIREN : ${lead.siren}\nNAF : ${lead.naf_label}\n\nPitch à envoyer :\n---\n${pitchText}\n---`;
      const r = await this.anthropicCaller({
        systemPrompt,
        voicePrompt: '',
        dataContext,
        model: cfg.validation_model || 'claude-haiku-4-5-20251001',
        maxTokens: 200,
        json: true
      });
      const verdict = (r.result?.verdict || '').toUpperCase();
      const ok = verdict === 'OUI';
      return { rule: 'opus_final', ok, verdict, reason: r.result?.reason, cost_eur: r.usage ? r.usage : null };
    } catch (e) {
      return { rule: 'opus_final', ok: false, reason: 'validation_call_failed: ' + e.message };
    }
  }
}

module.exports = { AutoSendGate, CONTACT_BLACKOUT_DAYS, REPLY_RATE_WINDOW_DAYS, REPLY_RATE_MIN, MAILBOX_DAILY_CAP, FORBIDDEN_PATTERNS };
