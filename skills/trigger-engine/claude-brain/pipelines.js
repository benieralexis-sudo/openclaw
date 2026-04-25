'use strict';

/**
 * Pipelines executor — dispatch selon job.pipeline, gère l'appel Opus,
 * le stockage du résultat et l'enregistrement de l'usage.
 *
 * Flux standard par job :
 *   1. Vérifie budget (canSpend)
 *   2. Construit le contexte (context-builder)
 *   3. Appelle Anthropic (anthropic-client)
 *   4. Stocke résultat dans claude_brain_results
 *   5. Enregistre usage dans claude_brain_usage
 *   6. Écrit les champs latéraux (ex: client_leads.opus_score)
 */

const { callAnthropic } = require('./anthropic-client');
const { computeComboBooster, applyBoost } = require('./combo-booster');

const PIPELINE_CONFIG = {
  qualify: { json: true, maxTokens: 2048 },
  pitch: { json: true, maxTokens: 1500 },
  'linkedin-dm': { json: true, maxTokens: 1200 },
  'call-brief': { json: true, maxTokens: 2500 },
  brief: { json: false, maxTokens: 6000 },
  discover: { json: true, maxTokens: 3000 }
};

class PipelineExecutor {
  constructor({ storage, context, budget, log, anthropicCaller }) {
    this.storage = storage;
    this.db = storage.db;
    this.context = context;
    this.budget = budget;
    this.log = log || console;
    this.call = anthropicCaller || callAnthropic;
  }

  /**
   * Execute a job. Throws on unrecoverable error (caller decides requeue/dead).
   */
  async execute(job) {
    const { tenant_id, pipeline, siren, id: jobId } = job;
    const cfg = PIPELINE_CONFIG[pipeline];
    if (!cfg) throw new Error(`Unknown pipeline: ${pipeline}`);

    // Budget pre-check : estimation conservatrice 0.15€ par appel (ajustable)
    const budgetCheck = this.budget.canSpend(tenant_id, 0.15);
    if (!budgetCheck.ok) {
      throw new Error(`Budget ${budgetCheck.reason} for ${tenant_id}`);
    }

    const tenant = this._getTenantConfig(tenant_id);
    const model = tenant.model_preference || 'claude-opus-4-7';

    // Contexte
    const ctx = this.context.build(tenant_id, siren, pipeline);
    if (ctx.dataContext?.error) {
      throw new Error(`Context build failed: ${ctx.dataContext.error}`);
    }
    const dataString = this.context.renderDataContext(ctx.dataContext);

    // Anthropic call
    const callResult = await this.call({
      systemPrompt: ctx.systemPrompt,
      voicePrompt: ctx.voicePrompt,
      dataContext: dataString,
      model,
      maxTokens: cfg.maxTokens,
      json: cfg.json
    });

    // Enregistre usage (compte le coût)
    const usageEntry = this.budget.recordUsage({
      tenantId: tenant_id,
      pipeline,
      siren,
      inputTokens: callResult.usage.inputTokens,
      outputTokens: callResult.usage.outputTokens,
      cachedTokens: callResult.usage.cachedTokens,
      model: callResult.model
    });

    // Stocke résultat versionné
    const version = this._nextVersion(tenant_id, siren, pipeline);
    const resultInsert = this.db.prepare(`
      INSERT INTO claude_brain_results
        (tenant_id, pipeline, siren, job_id, version, result_json,
         model, tokens_input, tokens_output, tokens_cached, cost_eur, latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tenant_id, pipeline, siren, jobId, version,
      cfg.json ? JSON.stringify(callResult.result) : String(callResult.result),
      callResult.model,
      callResult.usage.inputTokens,
      callResult.usage.outputTokens,
      callResult.usage.cachedTokens,
      usageEntry.cost,
      callResult.latency_ms
    );
    const resultId = resultInsert.lastInsertRowid;

    // Effets de bord par pipeline
    await this._postProcess(pipeline, tenant_id, siren, callResult.result, resultId);

    return {
      result_id: resultId,
      version,
      cost_eur: usageEntry.cost,
      latency_ms: callResult.latency_ms,
      model: callResult.model,
      usage: callResult.usage
    };
  }

  _getTenantConfig(tenantId) {
    const row = this.db.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get(tenantId);
    if (!row || !row.claude_brain_config) return {};
    try { return JSON.parse(row.claude_brain_config); } catch { return {}; }
  }

  _nextVersion(tenantId, siren, pipeline) {
    const row = this.db.prepare(`
      SELECT MAX(version) as v FROM claude_brain_results
      WHERE tenant_id = ? AND siren = ? AND pipeline = ?
    `).get(tenantId, siren, pipeline);
    return (row?.v || 0) + 1;
  }

  async _postProcess(pipeline, tenantId, siren, result, resultId) {
    if (pipeline === 'qualify' && result && typeof result === 'object') {
      const rawScore = Number(result.priority_score_opus);
      if (!Number.isNaN(rawScore)) {
        let finalScore = rawScore;
        // Combo booster désactivable via env (défaut: ON)
        if (process.env.COMBO_BOOSTER_ENABLED !== 'false') {
          const combo = computeComboBooster(this.db, siren);
          finalScore = applyBoost(rawScore, combo.multiplier);
          // Stocke la metadata dans le result pour transparence (digest, dashboard)
          result.scoring_metadata = {
            raw_score: rawScore,
            final_score: finalScore,
            combo_multiplier: combo.multiplier,
            combo_label: combo.label,
            hard_signals_count: combo.hard_signals_count,
            hard_signals_categories: combo.categories,
            excluded: combo.excluded
          };
          if (combo.label) {
            this.log.info?.(`[combo-booster] ${combo.label} ×${combo.multiplier} sur ${siren}: ${rawScore.toFixed(1)} → ${finalScore.toFixed(1)} (${combo.hard_signals_count} signaux durs <90j: ${combo.categories.join(', ')})`);
          }
          // Re-écrit le result_json avec metadata
          this.db.prepare('UPDATE claude_brain_results SET result_json = ? WHERE id = ?')
            .run(JSON.stringify(result), resultId);
        }
        this.db.prepare(`
          UPDATE client_leads
          SET opus_score = ?, opus_qualified_at = CURRENT_TIMESTAMP, opus_result_id = ?
          WHERE client_id = ? AND siren = ?
        `).run(finalScore, resultId, tenantId, siren);
      }
    }
    if (pipeline === 'discover' && result && Array.isArray(result.proposed_patterns)) {
      // S'assurer que la table existe (migration 014)
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS claude_brain_pattern_proposals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT,
            proposal_json TEXT NOT NULL,
            pattern_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            reviewed_by TEXT, reviewed_at TEXT, review_note TEXT,
            discover_run_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_cbpp_status ON claude_brain_pattern_proposals(status, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_cbpp_pattern ON claude_brain_pattern_proposals(pattern_id);
        `);
      } catch {}
      const runId = `run-${Date.now()}`;
      const stmt = this.db.prepare(`
        INSERT INTO claude_brain_pattern_proposals (tenant_id, proposal_json, pattern_id, discover_run_id)
        VALUES (?, ?, ?, ?)
      `);
      for (const p of result.proposed_patterns) {
        if (!p?.id) continue;
        stmt.run(tenantId, JSON.stringify(p), p.id, runId);
      }
    }
    // pitch/brief : pas de side-effect sur client_leads (lead garde son status)
  }
}

module.exports = { PipelineExecutor, PIPELINE_CONFIG };
