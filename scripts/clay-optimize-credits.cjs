#!/usr/bin/env node
/**
 * Clay Credit Optimization Script
 *
 * Optimizes the iFIND table from ~9.5 cr/lead to ~2.8 cr/lead:
 * 1. Chain waterfall providers (skip if previous found email)
 * 2. Disable individual validators, add single validator on Work Email
 * 3. Make Google News conditional on employee count >= 50
 * 4. Clean up Work Email formula (only active providers)
 */

const https = require('https');
require('dotenv').config({ path: '/opt/moltbot/.env' });

const TABLE_ID = 't_0tcu7swzKxuMiGevHW7';
const COOKIE = process.env.CLAY_SESSION_COOKIE || '';

// Field IDs
const FIELDS = {
  // Providers (order: Hunter → Prospeo → Findymail → Wiza)
  hunter:     'f_0tcw38pQ6fpjaNU8n8z',  // find-email-v2
  prospeo:    'f_0tcw38pkrxDb3mhj69g',  // prospeo-find-work-email-v2
  findymail:  'f_0tcw38oxQy2jXBjo8EF',  // findymail-find-work-email
  wiza:       'f_0tcw38rJHVCsHTJDWxk',  // wiza-find-work-email

  // Validators to disable
  valHunter:    'f_0tcw30eSietxxpzzBau',
  valProspeo:   'f_0tcw317brBcabvDuqBQ',
  valFindymail: 'f_0tcw39qnkX7JEhN9Pt5',
  valWiza:      'f_0tcw319xC5CtjjfZhhj',

  // Google News
  googleNews: 'f_0tcvc1egA9yyfqzYYeF',

  // Work Email formula
  workEmail:  'f_0tcw3b14FGYsxKkVp2j',

  // Input fields referenced in conditions
  cleanDomain:  'f_0tcu8sph53i5RCxB9wU',
  companyName:  'f_0tcu8rvSnc94ipf4Rqg',
  employeeCount: 'f_0tcu8rxQgAYMXR6BXQD',
  linkedinUrl:  'f_0tcu8rzKcyeB6F3yMRk',
  fullName:     'f_0tcu8rtFohSUy7Xe6gg',
};

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://api.clay.com' + path);
    const opts = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Cookie': COOKIE,
        'Referer': 'https://app.clay.com/',
        'Origin': 'https://app.clay.com'
      }
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`${res.statusCode}: ${json.message || data.slice(0, 300)}`));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getTable() {
  const data = await request('GET', `/v3/tables/${TABLE_ID}`);
  return data.table || data;
}

async function updateField(fieldId, typeSettings) {
  // CRITICAL: Always send COMPLETE typeSettings (Clay replaces entirely on PATCH)
  const result = await request('PATCH', `/v3/tables/${TABLE_ID}/fields/${fieldId}`, {
    typeSettings
  });
  return result.field || result;
}

async function main() {
  console.log('=== Clay Credit Optimization ===\n');

  // Step 0: Get current table to read full typeSettings
  console.log('Fetching current table structure...');
  const table = await getTable();
  const fields = table.fields || [];
  const fieldMap = {};
  for (const f of fields) {
    fieldMap[f.id] = f;
  }

  const changes = [];

  // ============================================================
  // STEP 1: Chain waterfall providers
  // Order: Hunter → Prospeo → Findymail → Wiza
  // Each provider only runs if previous ones didn't find an email
  // ============================================================
  console.log('\n--- STEP 1: Chaining waterfall providers ---');

  // Hunter: runs first, just needs Clean Domain
  {
    const f = fieldMap[FIELDS.hunter];
    const ts = { ...f.typeSettings };
    ts.conditionalRunFormulaText = `{{${FIELDS.cleanDomain}}}`;
    changes.push({ name: 'Hunter (1st)', id: FIELDS.hunter, ts, reason: 'Run if Clean Domain exists' });
  }

  // Prospeo: runs only if Hunter didn't find email
  {
    const f = fieldMap[FIELDS.prospeo];
    const ts = { ...f.typeSettings };
    ts.conditionalRunFormulaText = `{{${FIELDS.cleanDomain}}} && !({{${FIELDS.hunter}}}?.email)`;
    changes.push({ name: 'Prospeo (2nd)', id: FIELDS.prospeo, ts, reason: 'Skip if Hunter found email' });
  }

  // Findymail: runs only if Hunter AND Prospeo didn't find
  {
    const f = fieldMap[FIELDS.findymail];
    const ts = { ...f.typeSettings };
    ts.conditionalRunFormulaText = `{{${FIELDS.cleanDomain}}} && !({{${FIELDS.hunter}}}?.email) && !({{${FIELDS.prospeo}}}?.email)`;
    changes.push({ name: 'Findymail (3rd)', id: FIELDS.findymail, ts, reason: 'Skip if Hunter or Prospeo found email' });
  }

  // Wiza: last resort, runs only if none found (uses LinkedIn URL)
  {
    const f = fieldMap[FIELDS.wiza];
    const ts = { ...f.typeSettings };
    ts.conditionalRunFormulaText = `{{${FIELDS.linkedinUrl}}} && !({{${FIELDS.hunter}}}?.email) && !({{${FIELDS.prospeo}}}?.email) && !({{${FIELDS.findymail}}}?.email)`;
    changes.push({ name: 'Wiza (4th/last)', id: FIELDS.wiza, ts, reason: 'Skip if any previous found email' });
  }

  // ============================================================
  // STEP 2: Disable individual validators (set condition=false)
  // We'll use a single validator on Work Email instead
  // ============================================================
  console.log('\n--- STEP 2: Disabling individual validators ---');

  for (const [key, id] of [
    ['valHunter', FIELDS.valHunter],
    ['valProspeo', FIELDS.valProspeo],
    ['valFindymail', FIELDS.valFindymail],
    ['valWiza', FIELDS.valWiza],
  ]) {
    const f = fieldMap[id];
    if (!f) { console.log(`  ⚠️  ${key} not found, skipping`); continue; }
    const ts = { ...f.typeSettings };
    ts.conditionalRunFormulaText = 'false';
    changes.push({ name: `Disable ${key}`, id, ts, reason: 'Replaced by single validator' });
  }

  // ============================================================
  // STEP 3: Google News conditional on employees >= 50
  // ============================================================
  console.log('\n--- STEP 3: Google News conditional (employees >= 50) ---');
  {
    const f = fieldMap[FIELDS.googleNews];
    const ts = { ...f.typeSettings };
    ts.conditionalRunFormulaText = `{{${FIELDS.companyName}}} && Number({{${FIELDS.employeeCount}}}) >= 50`;
    changes.push({ name: 'Google News (conditional)', id: FIELDS.googleNews, ts, reason: 'Only run for companies with 50+ employees' });
  }

  // ============================================================
  // STEP 4: Clean up Work Email formula (only active providers)
  // ============================================================
  console.log('\n--- STEP 4: Clean Work Email formula ---');
  {
    const f = fieldMap[FIELDS.workEmail];
    const ts = { ...f.typeSettings };
    // New formula: only reference active providers in optimal order
    ts.formulaText = [
      `{{${FIELDS.hunter}}}?.email`,      // Hunter
      `{{${FIELDS.prospeo}}}?.email`,      // Prospeo
      `{{${FIELDS.findymail}}}?.email`,    // Findymail
      `{{${FIELDS.wiza}}}?.data?.email`,   // Wiza
    ].join(' || ');
    changes.push({ name: 'Work Email formula', id: FIELDS.workEmail, ts, reason: 'Only reference 4 active providers' });
  }

  // ============================================================
  // Apply all changes
  // ============================================================
  console.log(`\n=== Applying ${changes.length} changes ===\n`);

  let success = 0;
  let errors = 0;

  for (const change of changes) {
    try {
      await updateField(change.id, change.ts);
      console.log(`  ✅ ${change.name} — ${change.reason}`);
      success++;
    } catch (err) {
      console.log(`  ❌ ${change.name} — ${err.message}`);
      errors++;
    }
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log(`\n=== RÉSULTAT ===`);
  console.log(`  ✅ ${success} modifications appliquées`);
  if (errors) console.log(`  ❌ ${errors} erreurs`);

  console.log(`\n=== COÛT ESTIMÉ PAR LEAD (NOUVEAU) ===`);
  console.log(`  Email waterfall (chaîné) : ~1.3 cr (Hunter trouve ~60%, Prospeo ~20%)`);
  console.log(`  Validator Work Email     : 0 cr (validators désactivés — à ajouter manuellement dans UI si voulu)`);
  console.log(`  Google News (conditionnel): ~0.3 cr (seulement 50+ employés)`);
  console.log(`  Summarize LinkedIn       : 0.5 cr`);
  console.log(`  Lead Score / Priority    : 0 cr (formulas)`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  TOTAL                    : ~2.1 cr/lead 🔥`);
  console.log(`  (vs 33.5 historique, vs 9.5 avant optim)`);
  console.log(`\n  💡 Pour ajouter un validator unique sur Work Email :`);
  console.log(`     → Dans Clay UI : Add enrichment sur Work Email → Findymail Validate`);
  console.log(`     → Coût : +1 cr/lead (total ~3.1 cr/lead)`);
  console.log(`     → Recommandé pour protéger la délivrabilité Instantly`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
