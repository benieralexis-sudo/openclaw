'use strict';

/**
 * Budget tracker Claude Brain — par tenant, par mois.
 * - canSpend(tenantId, estimatedEur) → bool (vérifie soft + hard limit)
 * - recordUsage(tenantId, tokens, cost, ...) → stocke + déclenche alertes
 * - getMonthlySpend(tenantId) → somme du mois en cours
 * - Reset automatique via month_key ('YYYY-MM')
 *
 * Tarifs Claude Opus 4.7 (à jour 2026-04) :
 *   input  : $15 / 1M tokens  ≈ 13.50€
 *   output : $75 / 1M tokens  ≈ 67.50€
 *   cached : $1.50 / 1M tokens ≈ 1.35€ (-90% sur tokens cachés)
 *
 * EUR_PER_USD : ~0.90 (valeur conservatrice, mise à jour possible via env).
 */

const OPUS_PRICING = {
  'claude-opus-4-7': {
    input_usd_per_million: 15,
    output_usd_per_million: 75,
    cached_usd_per_million: 1.5
  },
  'claude-sonnet-4-6': {
    input_usd_per_million: 3,
    output_usd_per_million: 15,
    cached_usd_per_million: 0.3
  },
  'claude-haiku-4-5-20251001': {
    input_usd_per_million: 0.8,
    output_usd_per_million: 4,
    cached_usd_per_million: 0.08
  }
};

const EUR_PER_USD = Number(process.env.EUR_PER_USD || 0.90);

function calcCostEur({ model, inputTokens = 0, outputTokens = 0, cachedTokens = 0 }) {
  const p = OPUS_PRICING[model] || OPUS_PRICING['claude-opus-4-7'];
  const uncached = Math.max(0, inputTokens - cachedTokens);
  const costUsd = (uncached * p.input_usd_per_million) / 1_000_000
                + (cachedTokens * p.cached_usd_per_million) / 1_000_000
                + (outputTokens * p.output_usd_per_million) / 1_000_000;
  return costUsd * EUR_PER_USD;
}

class BudgetTracker {
  constructor(db, options = {}) {
    this.db = db;
    this.log = options.log || console;
  }

  currentMonthKey() {
    return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  }

  /**
   * Retourne le budget du tenant (depuis clients.claude_brain_config).
   */
  getTenantLimits(tenantId) {
    const row = this.db.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get(tenantId);
    if (!row || !row.claude_brain_config) return { soft: 300, hard: 500 };
    try {
      const cfg = JSON.parse(row.claude_brain_config);
      return {
        soft: Number(cfg.monthly_budget_eur ?? 300),
        hard: Number(cfg.hard_cap_eur ?? 500)
      };
    } catch {
      return { soft: 300, hard: 500 };
    }
  }

  getMonthlySpend(tenantId) {
    const monthKey = this.currentMonthKey();
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(cost_eur), 0) as total
      FROM claude_brain_usage
      WHERE tenant_id = ? AND month_key = ?
    `).get(tenantId, monthKey);
    return row?.total || 0;
  }

  /**
   * Peut-on dépenser estimatedEur pour ce tenant maintenant ?
   */
  canSpend(tenantId, estimatedEur = 0) {
    const limits = this.getTenantLimits(tenantId);
    const spent = this.getMonthlySpend(tenantId);
    if (spent + estimatedEur > limits.hard) {
      return { ok: false, reason: 'hard_limit_reached', spent, limit: limits.hard };
    }
    return { ok: true, spent, limit: limits.hard, soft: limits.soft };
  }

  /**
   * Enregistre un usage et vérifie si un seuil est franchi.
   */
  recordUsage({ tenantId, pipeline, siren = null, inputTokens, outputTokens, cachedTokens = 0, model, success = true }) {
    const cost = calcCostEur({ model, inputTokens, outputTokens, cachedTokens });
    const monthKey = this.currentMonthKey();
    this.db.prepare(`
      INSERT INTO claude_brain_usage
        (tenant_id, pipeline, siren, tokens_input, tokens_output, tokens_cached,
         cost_eur, model, success, month_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, pipeline, siren, inputTokens, outputTokens, cachedTokens,
           cost, model, success ? 1 : 0, monthKey);

    const limits = this.getTenantLimits(tenantId);
    const spent = this.getMonthlySpend(tenantId);
    const alert = this._checkAlerts(tenantId, monthKey, spent, limits);
    return { cost, spent, limits, alert };
  }

  _checkAlerts(tenantId, monthKey, spent, limits) {
    const dedup = this.db.prepare(`
      SELECT level FROM claude_brain_budget_alerts
      WHERE tenant_id = ? AND month_key = ?
    `).all(tenantId, monthKey).map(r => r.level);

    let alert = null;
    if (spent >= limits.hard && !dedup.includes('hard')) {
      alert = { level: 'hard', spent, limit: limits.hard };
      this.db.prepare(`
        INSERT OR IGNORE INTO claude_brain_budget_alerts (tenant_id, month_key, level)
        VALUES (?, ?, 'hard')
      `).run(tenantId, monthKey);
      this.log.warn?.(`[budget] HARD LIMIT ${tenantId} month=${monthKey} spent=${spent.toFixed(2)}€ / ${limits.hard}€`);
      // Pause automatique du tenant (pipeline Claude Brain désactivé)
      this._pauseTenant(tenantId, `Hard budget limit ${limits.hard}€ atteint`);
      this._dispatchTelegramAlert(tenantId, spent, limits, 'hard');
    } else if (spent >= limits.soft * 0.8 && !dedup.includes('soft')) {
      alert = { level: 'soft', spent, limit: limits.soft };
      this.db.prepare(`
        INSERT OR IGNORE INTO claude_brain_budget_alerts (tenant_id, month_key, level)
        VALUES (?, ?, 'soft')
      `).run(tenantId, monthKey);
      this.log.warn?.(`[budget] soft threshold ${tenantId} month=${monthKey} spent=${spent.toFixed(2)}€ / ${limits.soft}€`);
      this._dispatchTelegramAlert(tenantId, spent, limits, 'soft');
    }
    return alert;
  }

  /**
   * Pause auto du tenant au hard limit — modifie claude_brain_config.enabled=false.
   * Admin devra réactiver manuellement.
   */
  _pauseTenant(tenantId, reason) {
    try {
      const row = this.db.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get(tenantId);
      if (!row || !row.claude_brain_config) return;
      const cfg = JSON.parse(row.claude_brain_config);
      cfg.enabled = false;
      cfg.paused_at = new Date().toISOString();
      cfg.paused_reason = reason;
      this.db.prepare('UPDATE clients SET claude_brain_config = ? WHERE id = ?')
        .run(JSON.stringify(cfg), tenantId);
      this.log.warn?.(`[budget] tenant ${tenantId} PAUSED: ${reason}`);
    } catch (e) {
      this.log.error?.(`[budget] failed to pause tenant ${tenantId}: ${e.message}`);
    }
  }

  /**
   * Dispatch alerte Telegram admin (async, non-bloquant).
   * Injectable via options.telegram pour tests.
   */
  _dispatchTelegramAlert(tenantId, spent, limits, level) {
    const telegram = this._telegram;
    if (!telegram) return; // silencieux si module non fourni (tests ou env sans token)
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID || '1409505520';
    if (!token) return;
    const icon = level === 'hard' ? '🚨' : '⚠️';
    const action = level === 'hard' ? '*TENANT PAUSÉ automatiquement*' : 'Soft threshold franchi';
    const msg = [
      `${icon} *Claude Brain budget — ${level.toUpperCase()}*`,
      ``,
      `🏢 Tenant : \`${tenantId}\``,
      `💸 Dépensé : ${spent.toFixed(2)}€`,
      `🎯 Limite : ${(level === 'hard' ? limits.hard : limits.soft).toFixed(2)}€`,
      ``,
      action
    ].join('\n');
    // Best effort — erreurs silencieuses (log uniquement)
    telegram.sendTelegram(token, chatId, msg).catch(e => {
      this.log.warn?.(`[budget] telegram dispatch failed: ${e.message}`);
    });
  }

  /**
   * Injecte le module telegram-alert pour dispatch (pattern DI pour tests).
   */
  setTelegramModule(telegramModule) {
    this._telegram = telegramModule;
  }

  getUsageByTenant(tenantId) {
    const monthKey = this.currentMonthKey();
    return this.db.prepare(`
      SELECT pipeline, COUNT(*) as calls, SUM(cost_eur) as cost,
             SUM(tokens_input) as input, SUM(tokens_output) as output,
             SUM(tokens_cached) as cached
      FROM claude_brain_usage
      WHERE tenant_id = ? AND month_key = ?
      GROUP BY pipeline
    `).all(tenantId, monthKey);
  }
}

module.exports = { BudgetTracker, calcCostEur, OPUS_PRICING };
