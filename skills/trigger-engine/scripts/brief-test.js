#!/usr/bin/env node
'use strict';

const { TriggerEngineStorage } = require('/app/skills/trigger-engine/storage');
const { ClaudeBrain } = require('/app/skills/trigger-engine/claude-brain');
const { ClaudeBrainWorker } = require('/app/skills/trigger-engine/claude-brain/worker');

async function main() {
  if (process.env.CLAUDE_BRAIN_ENABLED !== 'true') { console.error('❌ CLAUDE_BRAIN_ENABLED=true requis'); process.exit(1); }
  const log = { info: (...a) => console.log('[info]', ...a), warn: (...a) => console.warn('[warn]', ...a), error: (...a) => console.error('[err]', ...a) };
  const storage = new TriggerEngineStorage();
  const brain = new ClaudeBrain(storage, { log, enabled: true });

  // Top lead iFIND : Axomove
  const lead = storage.db.prepare(`
    SELECT cl.id, cl.client_id, cl.siren, cl.opus_score, c.raison_sociale
    FROM client_leads cl LEFT JOIN companies c ON c.siren = cl.siren
    WHERE cl.client_id = 'ifind' AND cl.opus_score IS NOT NULL
    ORDER BY cl.opus_score DESC LIMIT 1
  `).get();
  if (!lead) { console.error('Pas de lead dispo'); process.exit(1); }

  console.log(`📋 Test brief sur ${lead.raison_sociale} (${lead.client_id}, opus ${lead.opus_score})`);
  const r = brain.enqueueBrief(lead.client_id, lead.siren, { userTriggered: 'brief-test' });
  if (!r.enqueued) { console.error('enqueue échoué:', r.reason); process.exit(1); }

  const worker = new ClaudeBrainWorker({
    storage, queue: brain.queue, context: brain.context, budget: brain.budget, log,
    pollIntervalMs: 1500, killSwitch: () => true
  });
  worker.start();

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const status = storage.db.prepare('SELECT status FROM claude_brain_queue WHERE id = ?').get(r.id)?.status;
    if (status === 'completed' || status === 'dead') break;
  }
  await worker.stop();

  const result = storage.db.prepare(`
    SELECT result_json, model, cost_eur, tokens_input, tokens_output, tokens_cached, latency_ms
    FROM claude_brain_results WHERE job_id = ? ORDER BY version DESC LIMIT 1
  `).get(r.id);
  if (!result) { console.error('❌ Pas de résultat'); process.exit(1); }

  const md = result.result_json;
  const wordCount = md.split(/\s+/).length;
  const sectionCount = (md.match(/^##\s/gm) || []).length;
  const cacheRate = result.tokens_input ? (result.tokens_cached / result.tokens_input * 100).toFixed(0) : 0;

  console.log(`\n━━━━━━━━━━ BRIEF ${lead.raison_sociale} ━━━━━━━━━━`);
  console.log(`[${result.model} · ${result.cost_eur.toFixed(4)}€ · ${result.latency_ms}ms · cache ${cacheRate}%]`);
  console.log(`Tokens : input=${result.tokens_input} output=${result.tokens_output} cached=${result.tokens_cached}`);
  console.log(`Stats  : ${wordCount} mots, ${sectionCount} sections markdown\n`);
  console.log(md);
  console.log('\n═══ FIN BRIEF ═══');
  storage.close();
  process.exit(0);
}
main().catch(err => { console.error('FATAL:', err.stack || err); process.exit(1); });
