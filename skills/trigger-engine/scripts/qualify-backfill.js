#!/usr/bin/env node
'use strict';

/**
 * Qualify Backfill — enqueue tous les client_leads actifs pour qualification Opus.
 *
 * Usage (dans le container telegram-router) :
 *   node skills/trigger-engine/scripts/qualify-backfill.js [--limit N] [--tenant ID] [--dry-run]
 *
 * Par défaut, enqueue TOUS les leads actifs sans qualification récente (<7j),
 * puis lance le worker inline jusqu'à vidange complète ou timeout.
 *
 * Safety :
 *   - Réutilise la logique budget + circuit breaker + rate limiter
 *   - CLAUDE_BRAIN_ENABLED=true requis
 *   - Timeout max 10 min
 */

const path = require('node:path');
const { TriggerEngineStorage } = require('/app/skills/trigger-engine/storage');
const { ClaudeBrain } = require('/app/skills/trigger-engine/claude-brain');
const { ClaudeBrainWorker } = require('/app/skills/trigger-engine/claude-brain/worker');
const { PipelineExecutor } = require('/app/skills/trigger-engine/claude-brain/pipelines');

const TIMEOUT_MS = 10 * 60_000;

function parseArgs(argv) {
  const args = { limit: 500, tenant: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = Number(argv[++i] || 500);
    else if (a === '--tenant') args.tenant = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const log = {
    info: (...a) => console.log('[info]', ...a),
    warn: (...a) => console.warn('[warn]', ...a),
    error: (...a) => console.error('[err]', ...a)
  };

  if (process.env.CLAUDE_BRAIN_ENABLED !== 'true') {
    console.error('❌ CLAUDE_BRAIN_ENABLED=true requis. Abandon.');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY (ou CLAUDE_API_KEY) manquante. Abandon.');
    process.exit(1);
  }

  const storage = new TriggerEngineStorage();
  const brain = new ClaudeBrain(storage, { log, enabled: true });

  // Sélection des leads à enqueue
  const filters = ['1=1'];
  const params = [];
  if (args.tenant) { filters.push('cl.client_id = ?'); params.push(args.tenant); }

  const leads = storage.db.prepare(`
    SELECT DISTINCT cl.client_id, cl.siren
    FROM client_leads cl
    LEFT JOIN (
      SELECT tenant_id, siren, MAX(created_at) as last_qualif
      FROM claude_brain_results
      WHERE pipeline = 'qualify'
      GROUP BY tenant_id, siren
    ) q ON q.tenant_id = cl.client_id AND q.siren = cl.siren
    WHERE ${filters.join(' AND ')}
      AND cl.status IN ('new', 'qualifying', 'sent', 'replied_positive')
      AND (q.last_qualif IS NULL OR (julianday('now') - julianday(q.last_qualif)) > 7)
    ORDER BY cl.priority DESC, cl.score DESC
    LIMIT ?
  `).all(...params, args.limit);

  console.log(`🧠 ${leads.length} leads à qualifier` + (args.dryRun ? ' (dry-run)' : ''));
  if (leads.length === 0) {
    console.log('Rien à faire.');
    process.exit(0);
  }

  // Aperçu
  const byTenant = {};
  for (const l of leads) byTenant[l.client_id] = (byTenant[l.client_id] || 0) + 1;
  console.log('Répartition par tenant:', JSON.stringify(byTenant));

  if (args.dryRun) {
    process.exit(0);
  }

  // Estimer le coût (conservateur : 0.10€/lead en moyenne)
  const estCostEur = (leads.length * 0.10).toFixed(2);
  console.log(`💰 Coût estimé : ~${estCostEur}€ (conservateur)`);

  // Enqueue
  let enqueued = 0;
  for (const l of leads) {
    const r = brain.enqueueQualify(l.client_id, l.siren);
    if (r.enqueued) enqueued += 1;
  }
  console.log(`📥 ${enqueued} jobs enqueued (${leads.length - enqueued} doublons skippés)`);

  // Lance le worker inline et attend vidange
  const worker = new ClaudeBrainWorker({
    storage,
    queue: brain.queue,
    context: brain.context,
    budget: brain.budget,
    log,
    pollIntervalMs: 2000,
    killSwitch: () => true
  });
  worker.start();

  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, 3000));
    const stats = brain.queue.stats();
    const pending = stats.find(s => s.status === 'pending')?.n || 0;
    const claimed = stats.find(s => s.status === 'claimed')?.n || 0;
    const dead = stats.find(s => s.status === 'dead')?.n || 0;
    console.log(`⏳ processed=${worker.stats.processed} failed=${worker.stats.failed} pending=${pending} claimed=${claimed} dead=${dead}`);
    if (pending === 0 && claimed === 0 && !worker._busy) break;
  }

  await worker.stop();

  // Rapport final
  const totalCost = storage.db.prepare(`
    SELECT COALESCE(SUM(cost_eur), 0) as total, COUNT(*) as calls
    FROM claude_brain_usage
    WHERE month_key = strftime('%Y-%m', 'now')
  `).get();

  const results = storage.db.prepare(`
    SELECT tenant_id, COUNT(*) as n, AVG(latency_ms) as avg_latency,
           AVG(tokens_cached * 1.0 / NULLIF(tokens_input, 0)) as avg_cache_hit
    FROM claude_brain_results
    WHERE pipeline = 'qualify'
      AND created_at >= datetime('now', '-30 minutes')
    GROUP BY tenant_id
  `).all();

  const scoreDistrib = storage.db.prepare(`
    SELECT client_id,
      SUM(CASE WHEN opus_score >= 8 THEN 1 ELSE 0 END) as red,
      SUM(CASE WHEN opus_score >= 6 AND opus_score < 8 THEN 1 ELSE 0 END) as orange,
      SUM(CASE WHEN opus_score < 6 THEN 1 ELSE 0 END) as yellow,
      AVG(opus_score) as avg_score
    FROM client_leads
    WHERE opus_score IS NOT NULL
      AND opus_qualified_at >= datetime('now', '-30 minutes')
    GROUP BY client_id
  `).all();

  console.log('\n═══════════════ RAPPORT BACKFILL ═══════════════');
  console.log(`✅ Processed : ${worker.stats.processed}`);
  console.log(`❌ Failed : ${worker.stats.failed}`);
  console.log(`⏭  Skipped rate limit : ${worker.stats.skipped_rate_limit}`);
  console.log(`🚦 Skipped breaker : ${worker.stats.skipped_breaker}`);
  console.log(`💰 Coût total mois : ${totalCost.total.toFixed(4)}€ (${totalCost.calls} calls)`);
  console.log('\n--- Par tenant ---');
  console.table(results);
  console.log('\n--- Distribution scores Opus ---');
  console.table(scoreDistrib);
  console.log('════════════════════════════════════════════════');

  storage.close();
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.stack || err);
  process.exit(1);
});
