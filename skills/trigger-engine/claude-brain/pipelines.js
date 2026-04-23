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

const PIPELINE_CONFIG = {
  qualify: { json: true, maxTokens: 2048 },
  pitch: { json: true, maxTokens: 1500 },
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
      const score = Number(result.priority_score_opus);
      if (!Number.isNaN(score)) {
        // Met à jour les client_leads pour ce (tenant, siren)
        this.db.prepare(`
          UPDATE client_leads
          SET opus_score = ?, opus_qualified_at = CURRENT_TIMESTAMP, opus_result_id = ?
          WHERE client_id = ? AND siren = ?
        `).run(score, resultId, tenantId, siren);
      }
    }
    // pitch/brief : pas de side-effect sur client_leads (lead garde son status)
    // discover : résultat persisté dans claude_brain_results pour review admin
  }
}

module.exports = { PipelineExecutor, PIPELINE_CONFIG };
