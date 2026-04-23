#!/usr/bin/env node
'use strict';

/**
 * Pitch test — génère des pitchs Opus pour les N top leads (opus_score le plus haut).
 * Usage : node skills/trigger-engine/scripts/pitch-test.js [--limit 5]
 */

const { TriggerEngineStorage } = require('/app/skills/trigger-engine/storage');
const { ClaudeBrain } = require('/app/skills/trigger-engine/claude-brain');
const { ClaudeBrainWorker } = require('/app/skills/trigger-engine/claude-brain/worker');

async function main() {
  const limit = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) || 5);

  if (process.env.CLAUDE_BRAIN_ENABLED !== 'true') {
    console.error('❌ CLAUDE_BRAIN_ENABLED=true requis.'); process.exit(1);
  }
  const log = { info: (...a) => console.log('[info]', ...a), warn: (...a) => console.warn('[warn]', ...a), error: (...a) => console.error('[err]', ...a) };

  const storage = new TriggerEngineStorage();
  const brain = new ClaudeBrain(storage, { log, enabled: true });

  const leads = storage.db.prepare(`
    SELECT cl.id, cl.client_id, cl.siren, cl.opus_score, c.raison_sociale
    FROM client_leads cl
    LEFT JOIN companies c ON c.siren = cl.siren
    WHERE cl.opus_score IS NOT NULL
    ORDER BY cl.opus_score DESC
    LIMIT ?
  `).all(limit);
  console.log(`🎯 Test pitch sur ${leads.length} leads top :`);
  leads.forEach(l => console.log(`  - ${l.client_id} ${l.raison_sociale} (opus ${l.opus_score})`));

  const jobIds = [];
  for (const l of leads) {
    const r = brain.enqueuePitch(l.client_id, l.siren, { userTriggered: 'pitch-test-script' });
    if (r.enqueued) {
      jobIds.push({ id: r.id, lead: l });
      console.log(`📥 pitch job ${r.id} enqueued for ${l.raison_sociale}`);
    } else {
      console.log(`⏭ skipped ${l.raison_sociale}: ${r.reason}`);
    }
  }

  const worker = new ClaudeBrainWorker({
    storage, queue: brain.queue, context: brain.context, budget: brain.budget, log,
    pollIntervalMs: 1000, killSwitch: () => true
  });
  worker.start();

  // Attendre que tous les jobs soient traités
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const pending = storage.db.prepare(`SELECT COUNT(*) as n FROM claude_brain_queue WHERE status IN ('pending', 'claimed') AND pipeline = 'pitch'`).get().n;
    if (pending === 0 && !worker._busy) break;
  }
  await worker.stop();

  console.log('\n═══════════════ PITCHS GÉNÉRÉS ═══════════════\n');
  for (const { id, lead } of jobIds) {
    const r = storage.db.prepare(`
      SELECT result_json, model, cost_eur, tokens_input, tokens_cached, latency_ms
      FROM claude_brain_results WHERE job_id = ? ORDER BY version DESC LIMIT 1
    `).get(id);
    if (!r) {
      console.log(`❌ ${lead.raison_sociale} : pas de résultat`);
      continue;
    }
    const p = JSON.parse(r.result_json);
    const cacheRate = r.tokens_input ? (r.tokens_cached / r.tokens_input * 100).toFixed(0) : 0;
    console.log(`━━━━━━━━━━ ${lead.raison_sociale} (opus ${lead.opus_score}) ━━━━━━━━━━`);
    console.log(`[${r.model} · ${r.cost_eur.toFixed(4)}€ · ${r.latency_ms}ms · cache ${cacheRate}%]`);
    console.log(`Objet : ${p.subject}`);
    console.log(`Ton : ${p.tone_used} | CTA : ${p.cta_type}`);
    console.log();
    console.log(p.body);
    console.log();
    if (p.personalization_hooks_used?.length) {
      console.log(`Hooks utilisés : ${p.personalization_hooks_used.join(', ')}`);
    }
    console.log();
  }

  const totalCost = storage.db.prepare(`SELECT COALESCE(SUM(cost_eur), 0) as c FROM claude_brain_results WHERE pipeline='pitch' AND created_at >= datetime('now', '-10 minutes')`).get();
  console.log(`💰 Coût total test pitch : ${totalCost.c.toFixed(4)}€`);
  storage.close();
  process.exit(0);
}

main().catch(err => { console.error('FATAL:', err.stack || err); process.exit(1); });
