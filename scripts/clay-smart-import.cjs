#!/usr/bin/env node
/**
 * Clay Smart Import v2 — Sales Nav → Clay with MX filter + dedup
 *
 * Features:
 * 1. MX check (free DNS) → filter Google Workspace leads BEFORE Clay import
 * 2. Dedup intra-CSV (same lead twice in file)
 * 3. Dedup against existing Clay table rows (via API)
 * 4. Dedup against local enrichment files on disk
 *
 * Usage:
 *   node scripts/clay-smart-import.cjs <csv-file> <table-id> [options]
 *
 * Options:
 *   --gws-only       Only import Google Workspace leads (MX check)
 *   --dry-run        Show what would be imported without importing
 *   --no-dedup       Skip all deduplication
 *   --no-clay-dedup  Skip Clay API dedup (faster, uses only local files)
 *   --concurrency=N  MX check concurrency (default: 20)
 *
 * Examples:
 *   node scripts/clay-smart-import.cjs leads.csv t_0tctp63ADXP5mFXNdw8 --gws-only
 *   node scripts/clay-smart-import.cjs leads.csv t_0tctp63ADXP5mFXNdw8 --gws-only --dry-run
 *   node scripts/clay-smart-import.cjs leads.csv t_0tcu7swzKxuMiGevHW7
 *
 * Tables connues:
 *   iFIND:     t_0tcu7swzKxuMiGevHW7
 *   Digidemat: t_0tctp63ADXP5mFXNdw8
 */

require('dotenv').config({ path: '/opt/moltbot/.env' });
const https = require('https');
const fs = require('fs');
const dns = require('dns');
const { promisify } = require('util');
const resolveMx = promisify(dns.resolveMx);

// ---- Args ----

const rawArgs = process.argv.slice(2);
const flags = rawArgs.filter(a => a.startsWith('--'));
const positional = rawArgs.filter(a => !a.startsWith('--'));

const GWS_ONLY = flags.includes('--gws-only');
const DRY_RUN = flags.includes('--dry-run');
const NO_DEDUP = flags.includes('--no-dedup');
const NO_CLAY_DEDUP = flags.includes('--no-clay-dedup');
const CONCURRENCY = parseInt((flags.find(f => f.startsWith('--concurrency=')) || '').split('=')[1]) || 20;

if (positional.length < 2) {
  console.log('Usage: node scripts/clay-smart-import.cjs <csv-file> <table-id> [options]');
  console.log('\nOptions:');
  console.log('  --gws-only       Filtrer Google Workspace uniquement (MX check)');
  console.log('  --dry-run        Simulation sans import');
  console.log('  --no-dedup       Pas de déduplication');
  console.log('  --no-clay-dedup  Dédup locale uniquement (pas d\'appel API Clay)');
  console.log('  --concurrency=N  Parallélisme MX check (défaut: 20)');
  console.log('\nTables connues:');
  console.log('  iFIND:     t_0tcu7swzKxuMiGevHW7');
  console.log('  Digidemat: t_0tctp63ADXP5mFXNdw8');
  process.exit(1);
}

// Detect if args are swapped (table ID vs CSV file)
let csvFile = positional[0];
let tableId = positional[1];
if (csvFile.startsWith('t_') && tableId.endsWith('.csv')) {
  [csvFile, tableId] = [tableId, csvFile];
}

const COOKIE = process.env.CLAY_SESSION_COOKIE || '';

// ---- HTTP helper ----

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://api.clay.com' + path);
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname + url.search, method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Cookie': COOKIE,
        'Referer': 'https://app.clay.com/',
        'Origin': 'https://app.clay.com'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          res.statusCode >= 200 && res.statusCode < 300 ? resolve(j) : reject(new Error(res.statusCode + ': ' + (j.message || data.slice(0, 300))));
        } catch (e) { reject(new Error('Parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---- CSV Parser (handles multiline quoted fields from Sales Nav) ----

function parseCSV(content) {
  const rows = [];
  let header = null;
  let currentLine = '';
  let inQuotes = false;

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track quote state to handle multiline fields
    for (const char of line) {
      if (char === '"') inQuotes = !inQuotes;
    }

    currentLine += (currentLine ? '\n' : '') + line;

    // If we're inside quotes, this line continues
    if (inQuotes) continue;

    const values = parseCSVLine(currentLine);
    currentLine = '';
    inQuotes = false;

    if (!header) {
      header = values.map(h => h.trim());
      continue;
    }

    if (values.length === 0 || (values.length === 1 && !values[0].trim())) continue;

    const row = {};
    header.forEach((h, idx) => {
      row[h] = (values[idx] || '').trim();
    });
    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ---- MX Check (Google Workspace detection) ----

const mxCache = {};

async function checkGWS(domain) {
  if (!domain) return false;
  domain = domain.toLowerCase().replace(/^www\./, '').replace(/\/$/, '');

  if (mxCache[domain] !== undefined) return mxCache[domain];

  try {
    const records = await resolveMx(domain);
    const isGWS = records.some(r => {
      const ex = r.exchange.toLowerCase();
      return ex.includes('google') || ex.includes('googlemail');
    });
    mxCache[domain] = isGWS;
    return isGWS;
  } catch (e) {
    mxCache[domain] = false;
    return false;
  }
}

// Parallel MX check with concurrency limit
async function checkGWSBatch(domains, concurrency) {
  const unique = [...new Set(domains.filter(Boolean))];
  let idx = 0;
  let done = 0;

  async function worker() {
    while (idx < unique.length) {
      const domain = unique[idx++];
      await checkGWS(domain);
      done++;
      if (done % 50 === 0 || done === unique.length) {
        process.stdout.write(`\r   MX check: ${done}/${unique.length} domaines...`);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, unique.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  process.stdout.write('\n');
}

// ---- Dedup: normalize key for comparison ----

function normalizeKey(firstName, lastName, company) {
  return [
    (firstName || '').toLowerCase().trim(),
    (lastName || '').toLowerCase().trim(),
    (company || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '')
  ].join('|');
}

function normalizeLinkedIn(url) {
  if (!url) return '';
  return url.toLowerCase().trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/^linkedin\.com/, '')
    .replace(/^fr\.linkedin\.com/, '')
    .replace(/\/+$/, '');
}

// ---- Dedup: fetch existing leads from Clay table via API ----

async function fetchClayExistingLeads(tableId) {
  const existing = { keys: new Set(), linkedins: new Set(), emails: new Set() };

  try {
    // Try multiple endpoints (Clay API varies)
    const endpoints = [
      `/v3/tables/${tableId}/records`,
      `/v3/tables/${tableId}/rows`
    ];

    for (const ep of endpoints) {
      try {
        const data = await request('GET', ep);
        let rows = [];
        if (Array.isArray(data)) rows = data;
        else if (data && Array.isArray(data.data)) rows = data.data;
        else if (data && Array.isArray(data.rows)) rows = data.rows;
        else if (data && Array.isArray(data.records)) rows = data.records;
        else if (data && Array.isArray(data.results)) rows = data.results;
        else continue;

        for (const row of rows) {
          const fields = row.fields || row;
          const firstName = fields['First Name'] || fields['firstName'] || '';
          const lastName = fields['Last Name'] || fields['lastName'] || '';
          const company = fields['Company Name'] || fields['Company'] || fields['company'] || '';
          const linkedin = fields['LinkedIn URL'] || fields['linkedin'] || fields['Person Linkedin Url'] || '';
          const email = fields['Work Email'] || fields['Email'] || fields['email'] || '';

          const key = normalizeKey(firstName, lastName, company);
          if (key && key !== '||') existing.keys.add(key);

          const li = normalizeLinkedIn(linkedin);
          if (li) existing.linkedins.add(li);

          if (email) existing.emails.add(email.toLowerCase().trim());
        }

        console.log(`   Clay API: ${rows.length} rows lues depuis ${ep}`);
        return existing;
      } catch (e) {
        // Try next endpoint
      }
    }

    console.log('   ⚠ Clay API: impossible de lire les rows (cookie expiré ?)');
  } catch (e) {
    console.log('   ⚠ Clay API error: ' + e.message);
  }

  return existing;
}

// ---- Dedup: local enrichment files ----

function getLocalExisting() {
  const existing = { keys: new Set(), linkedins: new Set(), emails: new Set() };

  const dirs = [
    '/opt/moltbot/data/automailer/clay-enrichments/',
    '/opt/moltbot/clients/digidemat/data/automailer/clay-enrichments/',
    '/opt/moltbot/clients/digitestlab/data/automailer/clay-enrichments/'
  ];

  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        try {
          const d = JSON.parse(fs.readFileSync(dir + file, 'utf8'));
          if (d.email) existing.emails.add(d.email.toLowerCase().trim());
          if (d.linkedin) existing.linkedins.add(normalizeLinkedIn(d.linkedin));
          if (d.firstName && d.lastName && d.company) {
            existing.keys.add(normalizeKey(d.firstName, d.lastName, d.company));
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  return existing;
}

// ---- Map Sales Nav CSV columns ----

function mapRow(row) {
  return {
    firstName: row['First Name'] || row['Prénom'] || '',
    lastName: row['Last Name'] || row['Nom'] || row['Nom de famille'] || '',
    fullName: row['Full Name'] || ((row['First Name'] || '') + ' ' + (row['Last Name'] || '')).trim(),
    title: row['Title'] || row['Titre'] || row['Job Title'] || '',
    company: row['Company'] || row['Company Name'] || row['Entreprise'] || '',
    companyDomain: row['Website'] || row['Company Domain'] || row['Domaine'] || '',
    linkedin: row['LinkedIn URL'] || row['Profile URL'] || row['Person Linkedin Url'] || row['Url'] || '',
    location: row['Location'] || row['Geography'] || row['Localisation'] || '',
    industry: row['Industry'] || row['Industrie'] || row['Company Industry'] || '',
    employeeCount: row['Company Size'] || row['Employees'] || row['Company Headcount'] || row['Company Employee Count'] || '',
    companyLocation: row['Company Location'] || row['Company HQ'] || '',
    bio: row['LinkedIn Bio'] || row['Summary'] || row['Bio'] || '',
    companyDescription: row['Company Description'] || '',
  };
}

function extractDomain(raw) {
  if (!raw) return '';
  return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase().trim();
}

// ---- Main ----

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  Clay Smart Import v2                     ║');
  console.log('║  MX Check + Dédup intra-CSV + Clay API    ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log();
  console.log(`CSV:          ${csvFile}`);
  console.log(`Table:        ${tableId}`);
  console.log(`GWS only:     ${GWS_ONLY}`);
  console.log(`Dry run:      ${DRY_RUN}`);
  console.log(`Dedup:        ${!NO_DEDUP}`);
  console.log(`Clay dedup:   ${!NO_DEDUP && !NO_CLAY_DEDUP}`);
  console.log(`Concurrency:  ${CONCURRENCY}`);
  console.log();

  // ═══════════════════════════════════════
  // STEP 1: Parse CSV
  // ═══════════════════════════════════════

  if (!fs.existsSync(csvFile)) {
    console.error('❌ Fichier CSV introuvable: ' + csvFile);
    process.exit(1);
  }

  const content = fs.readFileSync(csvFile, 'utf8');
  const rows = parseCSV(content);
  const leads = rows.map(mapRow).filter(l => (l.firstName || l.lastName) && l.company);

  console.log(`1. CSV parsé: ${rows.length} lignes → ${leads.length} leads valides`);
  if (leads.length > 0) {
    const cols = Object.keys(rows[0]);
    console.log(`   Colonnes: ${cols.join(', ')}`);
  }

  if (leads.length === 0) {
    console.log('❌ Aucun lead valide trouvé.');
    process.exit(1);
  }

  // ═══════════════════════════════════════
  // STEP 2: Dédup intra-CSV
  // ═══════════════════════════════════════

  console.log('\n2. Déduplication intra-CSV...');
  const seenInCSV = new Set();
  const uniqueLeads = [];
  let internalDupes = 0;

  for (const lead of leads) {
    // Primary key: firstName + lastName + company
    const key = normalizeKey(lead.firstName, lead.lastName, lead.company);
    // Secondary key: LinkedIn URL
    const liKey = normalizeLinkedIn(lead.linkedin);

    if (key && key !== '||' && seenInCSV.has(key)) {
      internalDupes++;
      continue;
    }
    if (liKey && seenInCSV.has('li:' + liKey)) {
      internalDupes++;
      continue;
    }

    if (key && key !== '||') seenInCSV.add(key);
    if (liKey) seenInCSV.add('li:' + liKey);
    uniqueLeads.push(lead);
  }

  console.log(`   Doublons intra-CSV: ${internalDupes}`);
  console.log(`   Leads uniques: ${uniqueLeads.length}`);

  // ═══════════════════════════════════════
  // STEP 3: Dédup contre existants
  // ═══════════════════════════════════════

  let newLeads = uniqueLeads;

  if (!NO_DEDUP) {
    console.log('\n3. Déduplication contre existants...');

    // 3a. Local enrichment files
    const local = getLocalExisting();
    console.log(`   Local: ${local.emails.size} emails, ${local.linkedins.size} LinkedIn, ${local.keys.size} noms`);

    // 3b. Clay API (existing table rows)
    let clay = { keys: new Set(), linkedins: new Set(), emails: new Set() };
    if (!NO_CLAY_DEDUP) {
      console.log('   Lecture table Clay...');
      clay = await fetchClayExistingLeads(tableId);
    }

    // Merge both sets
    const allKeys = new Set([...local.keys, ...clay.keys]);
    const allLinkedins = new Set([...local.linkedins, ...clay.linkedins]);
    const allEmails = new Set([...local.emails, ...clay.emails]);

    console.log(`   Total existants: ${allKeys.size} noms, ${allLinkedins.size} LinkedIn, ${allEmails.size} emails`);

    let externalDupes = 0;
    newLeads = uniqueLeads.filter(lead => {
      const key = normalizeKey(lead.firstName, lead.lastName, lead.company);
      const liKey = normalizeLinkedIn(lead.linkedin);

      if (key && key !== '||' && allKeys.has(key)) { externalDupes++; return false; }
      if (liKey && allLinkedins.has(liKey)) { externalDupes++; return false; }
      return true;
    });

    console.log(`   Doublons avec existants: ${externalDupes}`);
    console.log(`   Nouveaux leads: ${newLeads.length}`);
  }

  // ═══════════════════════════════════════
  // STEP 4: MX Check (Google Workspace filter)
  // ═══════════════════════════════════════

  if (GWS_ONLY) {
    console.log('\n4. MX Check — filtre Google Workspace...');

    // Extract unique domains
    const domains = newLeads.map(l => extractDomain(l.companyDomain));
    const uniqueDomains = [...new Set(domains.filter(Boolean))];
    const noDomainCount = newLeads.filter(l => !extractDomain(l.companyDomain)).length;

    console.log(`   ${uniqueDomains.length} domaines uniques à vérifier (${noDomainCount} leads sans domaine)`);

    // Parallel MX check
    await checkGWSBatch(uniqueDomains, CONCURRENCY);

    // Filter
    const gwsLeads = [];
    const nonGwsLeads = [];
    const noDomainLeads = [];

    for (const lead of newLeads) {
      const domain = extractDomain(lead.companyDomain);
      if (!domain) {
        noDomainLeads.push(lead);
        continue;
      }
      if (mxCache[domain]) {
        gwsLeads.push(lead);
      } else {
        nonGwsLeads.push(lead);
      }
    }

    const gwsDomains = Object.entries(mxCache).filter(([, v]) => v);
    const nonGwsDomains = Object.entries(mxCache).filter(([, v]) => !v);

    console.log(`   ✅ Google Workspace: ${gwsDomains.length} domaines → ${gwsLeads.length} leads`);
    console.log(`   ❌ Non-GWS: ${nonGwsDomains.length} domaines → ${nonGwsLeads.length} leads`);
    console.log(`   ⚠  Sans domaine: ${noDomainLeads.length} leads`);

    // Show GWS domains
    if (gwsDomains.length > 0 && gwsDomains.length <= 30) {
      console.log('\n   Domaines GWS détectés:');
      for (const [d] of gwsDomains) {
        const count = newLeads.filter(l => extractDomain(l.companyDomain) === d).length;
        console.log(`     ${d} (${count} leads)`);
      }
    }

    newLeads = gwsLeads;
  }

  // ═══════════════════════════════════════
  // STEP 5: Résumé
  // ═══════════════════════════════════════

  console.log('\n════════════════════════════════════════════');
  console.log(`  RÉSULTAT: ${newLeads.length} leads à importer`);
  console.log('════════════════════════════════════════════');

  if (newLeads.length === 0) {
    console.log('\nRien à importer.');
    return;
  }

  // Show sample
  console.log('\nAperçu (10 premiers):');
  for (const l of newLeads.slice(0, 10)) {
    const domain = extractDomain(l.companyDomain);
    console.log(`  ${l.fullName} | ${l.title} | ${l.company} | ${domain}`);
  }
  if (newLeads.length > 10) {
    console.log(`  ... et ${newLeads.length - 10} autres`);
  }

  // ═══════════════════════════════════════
  // STEP 6: Dry run → save filtered CSV
  // ═══════════════════════════════════════

  if (DRY_RUN) {
    const outFile = csvFile.replace('.csv', '-filtered.csv');
    const headers = ['Full Name', 'First Name', 'Last Name', 'Job Title', 'Company Name', 'Company Domain', 'Location', 'LinkedIn Bio', 'LinkedIn URL', 'Company Industry', 'Company Employee Count', 'Company Location'];
    const fieldMap = { 'Full Name': 'fullName', 'First Name': 'firstName', 'Last Name': 'lastName', 'Job Title': 'title', 'Company Name': 'company', 'Company Domain': 'companyDomain', 'Location': 'location', 'LinkedIn Bio': 'bio', 'LinkedIn URL': 'linkedin', 'Company Industry': 'industry', 'Company Employee Count': 'employeeCount', 'Company Location': 'companyLocation' };

    const csvOut = [headers.join(',')];
    for (const l of newLeads) {
      csvOut.push(headers.map(h => '"' + (l[fieldMap[h]] || '').replace(/"/g, '""') + '"').join(','));
    }
    fs.writeFileSync(outFile, csvOut.join('\n'));
    console.log(`\n--dry-run: aucun import effectué.`);
    console.log(`CSV filtré sauvegardé: ${outFile}`);
    console.log('→ Pour importer: relancer sans --dry-run');
    return;
  }

  // ═══════════════════════════════════════
  // STEP 7: Import into Clay via API
  // ═══════════════════════════════════════

  console.log('\nImport dans Clay...');
  const batchSize = 50;
  let imported = 0, errors = 0;

  for (let i = 0; i < newLeads.length; i += batchSize) {
    const batch = newLeads.slice(i, i + batchSize);
    const payload = {
      rows: batch.map(l => ({
        fields: {
          'First Name': l.firstName,
          'Last Name': l.lastName,
          'Full Name': l.fullName,
          'Job Title': l.title,
          'Company Name': l.company,
          'Company Domain': l.companyDomain,
          'LinkedIn URL': l.linkedin,
          'Location': l.location,
          'Company Industry': l.industry,
          'Company Employee Count': l.employeeCount,
          'Company Location': l.companyLocation,
          'LinkedIn Bio': l.bio,
          'Company Description': l.companyDescription,
        }
      }))
    };

    try {
      await request('POST', `/v3/tables/${tableId}/rows`, payload);
      imported += batch.length;
      process.stdout.write(`\r  ${imported}/${newLeads.length} importés`);
    } catch (e) {
      // Fallback: individual inserts
      for (const l of batch) {
        try {
          await request('POST', `/v3/tables/${tableId}/rows`, {
            rows: [{ fields: {
              'First Name': l.firstName, 'Last Name': l.lastName, 'Full Name': l.fullName,
              'Job Title': l.title, 'Company Name': l.company, 'Company Domain': l.companyDomain,
              'LinkedIn URL': l.linkedin, 'Location': l.location, 'Company Industry': l.industry,
              'Company Employee Count': l.employeeCount, 'Company Location': l.companyLocation,
              'LinkedIn Bio': l.bio, 'Company Description': l.companyDescription,
            }}]
          });
          imported++;
        } catch (e2) {
          errors++;
          if (errors <= 3) console.log(`\n   ⚠ Erreur: ${l.fullName} — ${e2.message.slice(0, 100)}`);
        }
      }
      process.stdout.write(`\r  ${imported}/${newLeads.length} importés (${errors} erreurs)`);
    }
  }

  console.log(`\n\n✅ Import terminé: ${imported} leads importés, ${errors} erreurs`);

  // Save import log
  const logFile = `/opt/moltbot/logs/clay-import-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    fs.mkdirSync('/opt/moltbot/logs', { recursive: true });
    fs.writeFileSync(logFile, JSON.stringify({
      date: new Date().toISOString(),
      csvFile, tableId,
      gwsOnly: GWS_ONLY,
      totalCSV: rows.length,
      afterDedup: uniqueLeads.length,
      afterGWSFilter: newLeads.length,
      imported, errors,
      gwsDomains: GWS_ONLY ? Object.entries(mxCache).filter(([, v]) => v).map(([d]) => d) : [],
    }, null, 2));
    console.log(`Log: ${logFile}`);
  } catch (e) {}
}

main().catch(e => {
  console.error('❌ FATAL:', e.message);
  process.exit(1);
});
