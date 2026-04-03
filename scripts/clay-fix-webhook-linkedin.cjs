#!/usr/bin/env node
/**
 * Fix LinkedIn Posts in webhook — Create new "Push to Bot v2" field
 * that includes ALL enrichment data (linkedinPosts, companyDescription, etc.)
 *
 * Strategy:
 * 1. Create new webhook field with complete body mapping
 * 2. Run it on all rows (captures linkedinPosts + other missing fields)
 * 3. Once confirmed working, old field can be disabled
 *
 * Usage: node scripts/clay-fix-webhook-linkedin.cjs [--run] [--delete-old]
 */

require('dotenv').config({ path: '/opt/moltbot/.env' });
const https = require('https');

const COOKIE = process.env.CLAY_SESSION_COOKIE || '';
const TABLE_ID = process.env.CLAY_TABLE_ID || 't_0tcu7swzKxuMiGevHW7';
const WEBHOOK_URL = 'https://srv1319748.hstgr.cloud/webhook/clay';
const WEBHOOK_SECRET = process.env.CLAY_WEBHOOK_SECRET || '';
const ALL_ROWS_VIEW = 'gv_0tcu7swjUvi6puoTqGi';
const OLD_PUSH_FIELD = 'f_0tcvulxhcF78nvzSBRs';

const SHOULD_RUN = process.argv.includes('--run');
const DELETE_OLD = process.argv.includes('--delete-old');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://api.clay.com' + path);
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname + url.search, method,
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
          res.statusCode >= 200 && res.statusCode < 300
            ? resolve(j)
            : reject(new Error(res.statusCode + ': ' + JSON.stringify(j).slice(0, 500)));
        } catch (e) { reject(new Error('Parse: ' + data.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  if (!COOKIE) {
    console.error('ERROR: CLAY_SESSION_COOKIE not set');
    process.exit(1);
  }

  console.log('=== Fix LinkedIn Posts Webhook ===\n');

  // Step 1: Get current table structure to verify fields exist
  console.log('1. Getting table structure...');
  const table = await request('GET', `/v3/tables/${TABLE_ID}`);
  const tableData = table.table || table;
  const fields = tableData.fields || [];
  console.log(`   Table: ${tableData.name} — ${fields.length} fields\n`);

  // Show field names for reference
  const fieldNames = fields.map(f => `   ${f.id}: ${f.name} (${f.type})`);
  console.log('   Fields:');
  fieldNames.forEach(f => console.log(f));
  console.log();

  // Step 2: Create new webhook field with COMPLETE body
  console.log('2. Creating new webhook field "Push to Bot v2"...');

  // The body includes ALL enrichment fields from Clay
  const webhookBody = JSON.stringify({
    email: '{{Work Email}}',
    firstName: '{{First Name}}',
    lastName: '{{Last Name}}',
    company: '{{Company}}',
    title: '{{Title}}',
    industry: '{{Industry}}',
    linkedin: '{{Person LinkedIn URL}}',
    website: '{{Website}}',
    location: '{{Location}}',
    employeeCount: '{{Employee Count}}',
    phone: '{{Phone}}',
    // Previously missing fields:
    linkedinBio: '{{Summarize LinkedIn}}',
    linkedinPosts: '{{Professional Posts}}',
    companyDescription: '{{Company Description}}',
    positionStartDate: '{{Position Start Date}}',
    googleNews: '{{Google News}}',
    headcountGrowth: '{{Headcount Growth}}',
    // Scoring
    leadScore: '{{Lead Score}}',
    priority: '{{Priority}}',
    intentSignal: '{{Intent Signal}}'
  });

  const fieldConfig = {
    name: 'Push to Bot v2',
    type: 'action',
    typeSettings: {
      dataTypeSettings: { type: 'json' },
      actionKey: 'http-api-v2',
      actionVersion: 1,
      actionPackageId: 'http-api',
      inputsBinding: {
        method: 'POST',
        url: WEBHOOK_URL,
        headers: JSON.stringify({
          'X-Clay-Secret': WEBHOOK_SECRET,
          'Content-Type': 'application/json'
        }),
        body: webhookBody
      }
    }
  };

  let newFieldId;
  try {
    const result = await request('POST', `/v3/tables/${TABLE_ID}/fields`, fieldConfig);
    const field = result.field || result;
    newFieldId = field.id;
    const errors = field.settingsError || [];
    if (errors.length > 0) {
      console.log(`   ⚠️  Created with errors: ${errors[0].message}`);
    } else {
      console.log(`   ✅ Created: ${newFieldId}`);
    }
  } catch (e) {
    console.error(`   ❌ Failed to create field: ${e.message}`);
    process.exit(1);
  }

  // Step 3: Run on all rows (if --run flag)
  if (SHOULD_RUN && newFieldId) {
    console.log('\n3. Running on all rows...');
    try {
      const result = await request('PATCH', `/v3/tables/${TABLE_ID}/run`, {
        runRecords: { viewId: ALL_ROWS_VIEW },
        fieldIds: [newFieldId]
      });
      console.log(`   ✅ Launched: ${result.recordCount || '?'} records, mode=${result.runMode || '?'}`);
      console.log('   Waiting for Clay to process (this may take a few minutes)...');
    } catch (e) {
      console.error(`   ❌ Run failed: ${e.message}`);
    }
  } else if (!SHOULD_RUN) {
    console.log('\n3. Skipped run (use --run to execute on all rows)');
  }

  // Step 4: Disable old field (if --delete-old flag)
  if (DELETE_OLD) {
    console.log('\n4. Disabling old Push to Bot field...');
    try {
      // Don't delete — just disable via conditionalRunFormulaText = "false"
      await request('PATCH', `/v3/tables/${TABLE_ID}/fields/${OLD_PUSH_FIELD}`, {
        typeSettings: {
          dataTypeSettings: { type: 'json' },
          actionKey: 'http-api-v2',
          actionVersion: 1,
          actionPackageId: 'http-api',
          conditionalRunFormulaText: 'false',
          inputsBinding: {
            method: 'POST',
            url: WEBHOOK_URL,
            headers: JSON.stringify({ 'X-Clay-Secret': WEBHOOK_SECRET, 'Content-Type': 'application/json' }),
            body: '{}' // Neutralized
          }
        }
      });
      console.log('   ✅ Old field disabled (conditional = false)');
    } catch (e) {
      console.error(`   ⚠️  Could not disable old field: ${e.message}`);
      console.log('   You can disable it manually in Clay UI');
    }
  }

  console.log('\n=== Summary ===');
  console.log(`New field: ${newFieldId}`);
  console.log(`Old field: ${OLD_PUSH_FIELD}`);
  if (SHOULD_RUN) {
    console.log('\nRe-push launched. Check enrichment files in ~3-5 minutes:');
    console.log('  docker exec moltbot-telegram-router-1 node -e "');
    console.log('    const fs = require(\'fs\');');
    console.log('    const dir = \'/data/automailer/clay-enrichments\';');
    console.log('    const files = fs.readdirSync(dir);');
    console.log('    let withPosts = 0;');
    console.log('    files.forEach(f => {');
    console.log('      const d = JSON.parse(fs.readFileSync(dir+\'/\'+f));');
    console.log('      if (d.linkedinPosts) withPosts++;');
    console.log('    });');
    console.log('    console.log(\'LinkedIn Posts:\', withPosts, \'/\', files.length);');
    console.log('  "');
  } else {
    console.log('\nNext steps:');
    console.log('  1. Run: node scripts/clay-fix-webhook-linkedin.cjs --run');
    console.log('  2. Wait 3-5 minutes for Clay to process');
    console.log('  3. Verify: check enrichment files for linkedinPosts');
    console.log('  4. If OK: node scripts/clay-fix-webhook-linkedin.cjs --delete-old');
  }
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
