#!/usr/bin/env node
/**
 * Retry LinkedIn Posts enrichment in small batches to avoid LinkedIn rate limiting.
 *
 * Clay's "find-recent-linkedin-posts-for-user" gets rate-limited by LinkedIn
 * when run on 400+ rows at once. This script retries errored rows in batches
 * of 20 with 2-minute pauses between batches.
 *
 * Usage: node scripts/clay-retry-linkedin-posts.cjs
 */

require('dotenv').config({ path: '/opt/moltbot/.env' });
const https = require('https');

const COOKIE = process.env.CLAY_SESSION_COOKIE || '';
const TABLE_ID = 't_0tcu7swzKxuMiGevHW7';
const LINKEDIN_POSTS_FIELD = 'f_0tcxbo4euiaFDjPZQKp';
const PUSH_TO_BOT_FIELD = 'f_0tcvulxhcF78nvzSBRs';
const ERRORED_VIEW = 'gv_0tcu7swAjc83dfgZkx4';
const ALL_ROWS_VIEW = 'gv_0tcu7swjUvi6puoTqGi';

const BATCH_PAUSE_MS = 2 * 60 * 1000; // 2 minutes between batches
const MAX_BATCHES = 25; // Safety limit

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://api.clay.com' + path);
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname, method,
      headers: {
        'Content-Type': 'application/json', 'Accept': 'application/json',
        'Cookie': COOKIE, 'Referer': 'https://app.clay.com/', 'Origin': 'https://app.clay.com'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          res.statusCode >= 200 && res.statusCode < 300 ? resolve(j) : reject(new Error(res.statusCode + ': ' + (j.message || data.slice(0, 300))));
        } catch (e) { reject(new Error('Parse: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getErroredCount() {
  const r = await request('POST', `/v3/tables/${TABLE_ID}/export`, { format: 'csv', viewId: ERRORED_VIEW });
  return r.totalRecordsInViewCount || 0;
}

async function main() {
  console.log('=== LinkedIn Posts Batch Retry ===\n');

  let batch = 0;
  let lastErrored = await getErroredCount();
  console.log(`Errored rows: ${lastErrored}\n`);

  while (batch < MAX_BATCHES) {
    batch++;
    console.log(`--- Batch ${batch} (${new Date().toISOString().slice(11, 19)}) ---`);

    // Run LinkedIn Posts on errored rows
    const r = await request('PATCH', `/v3/tables/${TABLE_ID}/run`, {
      runRecords: { viewId: ERRORED_VIEW },
      fieldIds: [LINKEDIN_POSTS_FIELD]
    });
    console.log(`  Lancé: ${r.recordCount || '?'} rows`);

    // Wait for Clay to process
    console.log(`  Attente 2 min...`);
    await sleep(BATCH_PAUSE_MS);

    // Re-push to capture results
    await request('PATCH', `/v3/tables/${TABLE_ID}/run`, {
      runRecords: { viewId: ALL_ROWS_VIEW },
      fieldIds: [PUSH_TO_BOT_FIELD]
    });
    await sleep(15000); // Wait for push to arrive

    // Check progress
    const currentErrored = await getErroredCount();
    const fixed = lastErrored - currentErrored;
    console.log(`  Errored: ${lastErrored} → ${currentErrored} (${fixed > 0 ? '+' + fixed + ' traités' : 'pas de progrès'})`);

    if (currentErrored === 0) {
      console.log('\n✅ Tous les rows traités !');
      break;
    }

    if (fixed <= 0 && batch >= 3) {
      console.log('\n⚠️  Pas de progrès après 3 batches. LinkedIn bloque toujours.');
      console.log('   Réessayer dans quelques heures.');
      break;
    }

    lastErrored = currentErrored;
  }

  // Final count
  console.log('\n=== Résultat final ===');
  const fs = require('fs');
  const dir = '/data/automailer/clay-enrichments/';
  // This runs on the host, not in the container
  console.log('Vérifier les résultats avec:');
  console.log('  docker exec -u node moltbot-telegram-router-1 node -e "...(check linkedinPosts count)..."');
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
