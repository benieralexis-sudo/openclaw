#!/usr/bin/env node
/**
 * Backfill LinkedIn Posts from Clay API into local enrichment files.
 *
 * Problem: The Clay webhook "Push to iFIND Bot" never included linkedinPosts
 * in its body, so all 481 enrichment files have linkedinPosts: null even though
 * Clay has the data.
 *
 * This script:
 * 1. Fetches all rows from the Clay table (with all columns)
 * 2. For each row that has Professional Posts data, updates the local enrichment file
 * 3. Also backfills other missing fields (companyDescription, googleNews, positionStartDate)
 *
 * Usage: docker exec moltbot-telegram-router-1 node /app/scripts/clay-backfill-linkedin-posts.cjs
 *    or: cd /opt/moltbot && node scripts/clay-backfill-linkedin-posts.cjs
 */

require('dotenv').config({ path: '/opt/moltbot/.env' });
const https = require('https');
const fs = require('fs');
const path = require('path');

const COOKIE = process.env.CLAY_SESSION_COOKIE || '';
const TABLE_ID = process.env.CLAY_TABLE_ID || 't_0tcu7swzKxuMiGevHW7';

// Enrichment dir — works both on host and in container
const ENRICHMENT_DIRS = [
  '/data/automailer/clay-enrichments',
  '/opt/moltbot/data/automailer/clay-enrichments'
];

function getEnrichmentDir() {
  for (const dir of ENRICHMENT_DIRS) {
    if (fs.existsSync(dir)) return dir;
  }
  return ENRICHMENT_DIRS[0];
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://api.clay.com' + urlPath);
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
            : reject(new Error(res.statusCode + ': ' + (j.message || data.slice(0, 500))));
        } catch (e) { reject(new Error('Parse error: ' + data.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout 60s')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function pick(row, ...names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
    const lower = name.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === lower) return row[key];
    }
  }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAllRows() {
  // Try export endpoint first (returns all data including enrichment results)
  console.log('Fetching rows from Clay table ' + TABLE_ID + '...');

  // Try paginated records endpoint
  let allRows = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    try {
      const data = await request('GET', `/v3/tables/${TABLE_ID}/records?limit=${limit}&offset=${offset}`);
      const rows = Array.isArray(data) ? data : (data.data || data.rows || data.records || data.results || []);
      if (rows.length === 0) {
        hasMore = false;
      } else {
        allRows = allRows.concat(rows);
        offset += rows.length;
        console.log(`  Fetched ${allRows.length} rows...`);
        if (rows.length < limit) hasMore = false;
        await sleep(500); // Rate limit safety
      }
    } catch (e) {
      console.error('  Error fetching at offset ' + offset + ': ' + e.message);
      // Try alternative endpoint
      if (offset === 0) {
        console.log('  Trying alternative endpoint...');
        try {
          const data = await request('GET', `/v3/tables/${TABLE_ID}/rows`);
          allRows = Array.isArray(data) ? data : (data.data || data.rows || data.records || []);
          console.log(`  Got ${allRows.length} rows from /rows endpoint`);
        } catch (e2) {
          console.error('  Alternative also failed: ' + e2.message);
          // Last resort: try sources endpoint
          try {
            const data = await request('GET', `/v3/sources/${TABLE_ID}/rows`);
            allRows = Array.isArray(data) ? data : (data.data || data.rows || []);
            console.log(`  Got ${allRows.length} rows from /sources endpoint`);
          } catch (e3) {
            console.error('  All endpoints failed: ' + e3.message);
          }
        }
      }
      hasMore = false;
    }
  }

  return allRows;
}

async function main() {
  if (!COOKIE) {
    console.error('ERROR: CLAY_SESSION_COOKIE not set in .env');
    process.exit(1);
  }

  console.log('=== Clay LinkedIn Posts Backfill ===\n');

  const rows = await fetchAllRows();
  if (rows.length === 0) {
    console.error('No rows found. Check CLAY_SESSION_COOKIE (may be expired).');
    process.exit(1);
  }
  console.log(`\nTotal rows from Clay: ${rows.length}\n`);

  // Debug: show available columns from first row
  if (rows[0]) {
    const keys = Object.keys(rows[0]);
    console.log(`Columns available (${keys.length}): ${keys.join(', ')}\n`);
  }

  const enrichmentDir = getEnrichmentDir();
  if (!fs.existsSync(enrichmentDir)) {
    console.error('Enrichment dir not found: ' + enrichmentDir);
    process.exit(1);
  }

  let updated = 0;
  let noEmail = 0;
  let noFile = 0;
  let noNewData = 0;
  let withPosts = 0;
  let withDesc = 0;
  let withNews = 0;

  for (const row of rows) {
    const email = pick(row, 'Work Email', 'work_email', 'Email', 'email', 'Waterfall Email', 'Email Address');
    if (!email || !email.includes('@')) {
      noEmail++;
      continue;
    }

    const emailNorm = email.toLowerCase().trim();
    const fileName = emailNorm.replace(/[^a-z0-9@._-]/g, '_') + '.json';
    const filePath = path.join(enrichmentDir, fileName);

    if (!fs.existsSync(filePath)) {
      noFile++;
      continue;
    }

    // Extract fields from Clay row
    const linkedinPosts = pick(row, 'Professional Posts', 'professional_posts', 'Get professional posts and shares', 'LinkedIn Posts', 'linkedin_posts', 'Recent Posts');
    const companyDescription = pick(row, 'Company Description', 'company_description', 'Description');
    const googleNews = pick(row, 'Google News', 'google_news', 'News');
    const positionStartDate = pick(row, 'Position Start Date', 'position_start_date', 'Start Date');
    const headcountGrowth = pick(row, 'Headcount Growth', 'headcount_growth', 'Growth');
    const linkedinBio = pick(row, 'Summarize LinkedIn', 'summarize_linkedin', 'LinkedIn Bio', 'LinkedIn Summary');

    if (linkedinPosts) withPosts++;
    if (companyDescription) withDesc++;
    if (googleNews) withNews++;

    // Read existing enrichment
    let existing;
    try {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.warn('  Error reading ' + fileName + ': ' + e.message);
      continue;
    }

    // Check if any new data to add
    let changed = false;

    if (linkedinPosts && !existing.linkedinPosts) {
      existing.linkedinPosts = linkedinPosts;
      changed = true;
    }
    if (companyDescription && !existing.companyDescription) {
      existing.companyDescription = companyDescription;
      changed = true;
    }
    if (googleNews && !existing.googleNews) {
      existing.googleNews = googleNews;
      changed = true;
    }
    if (positionStartDate && !existing.positionStartDate) {
      existing.positionStartDate = positionStartDate;
      changed = true;
    }
    if (headcountGrowth && !existing.headcountGrowth) {
      existing.headcountGrowth = headcountGrowth;
      changed = true;
    }
    if (linkedinBio && !existing.linkedinBio) {
      existing.linkedinBio = linkedinBio;
      changed = true;
    }

    if (!changed) {
      noNewData++;
      continue;
    }

    // Write updated enrichment
    existing.backfilledAt = new Date().toISOString();
    try {
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(existing, null, 2));
      fs.renameSync(tmp, filePath);
      updated++;
    } catch (e) {
      console.warn('  Error writing ' + fileName + ': ' + e.message);
    }
  }

  console.log('\n=== Résultat ===');
  console.log(`Rows Clay: ${rows.length}`);
  console.log(`Sans email: ${noEmail}`);
  console.log(`Pas de fichier enrichment: ${noFile}`);
  console.log(`Rien de nouveau: ${noNewData}`);
  console.log(`Mis à jour: ${updated}`);
  console.log(`\nDans Clay:`);
  console.log(`  Avec LinkedIn Posts: ${withPosts}`);
  console.log(`  Avec Company Description: ${withDesc}`);
  console.log(`  Avec Google News: ${withNews}`);
  console.log(`\nTerminé.`);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
