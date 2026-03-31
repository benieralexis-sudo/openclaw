// iFIND — Clay API Connector v2
// Auto-sync enriched leads from Clay tables every 30 min
// Uses Clay v3 API (cookie session auth) + fallback to API key
// CommonJS module

const fs = require('fs');
const path = require('path');
const https = require('https');
const log = require('../gateway/logger.js');
const { atomicWriteSync } = require('../gateway/utils.js');

const CLAY_API_BASE = 'https://api.clay.com';
const SYNC_STATE_FILE = '/data/automailer/clay-sync-state.json';
const ENRICHMENT_DIR = '/data/automailer/clay-enrichments';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '1409505520';

// ---- HTTP helper (v3 with cookie + API key fallback) ----

function clayRequest(method, endpoint, body, retries) {
  if (typeof body === 'number') { retries = body; body = null; }
  retries = retries === undefined ? 1 : retries;

  const apiKey = process.env.CLAY_API_KEY;
  const cookie = process.env.CLAY_SESSION_COOKIE;
  if (!apiKey && !cookie) return Promise.reject(new Error('CLAY_API_KEY ou CLAY_SESSION_COOKIE requis'));

  const url = CLAY_API_BASE + endpoint;

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Referer': 'https://app.clay.com/',
      'Origin': 'https://app.clay.com'
    };

    // Cookie auth takes priority (v3 endpoints need it)
    // IMPORTANT: Ne PAS envoyer Authorization + Cookie ensemble — Clay rejette en 401
    if (cookie) {
      headers['Cookie'] = cookie;
    } else if (apiKey) {
      headers['Authorization'] = 'Bearer ' + apiKey;
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: headers
    };

    const req = https.request(options, (res) => {
      let respBody = '';
      res.on('data', (chunk) => { respBody += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(respBody));
          } catch (e) {
            reject(new Error('Clay API: reponse JSON invalide — ' + respBody.slice(0, 200)));
          }
        } else if (retries > 0 && res.statusCode >= 500) {
          log.warn('clay-connector', 'Clay API ' + res.statusCode + ', retry dans 3s...');
          setTimeout(() => {
            clayRequest(method, endpoint, body, retries - 1).then(resolve).catch(reject);
          }, 3000);
        } else {
          reject(new Error('Clay API ' + res.statusCode + ': ' + respBody.slice(0, 300)));
        }
      });
    });

    req.on('error', (e) => {
      if (retries > 0) {
        log.warn('clay-connector', 'Clay API erreur reseau, retry dans 3s: ' + e.message);
        setTimeout(() => {
          clayRequest(method, endpoint, body, retries - 1).then(resolve).catch(reject);
        }, 3000);
      } else {
        reject(new Error('Clay API erreur reseau: ' + e.message));
      }
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Clay API timeout 30s'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ---- Sync state persistence ----

function loadSyncState() {
  try {
    if (fs.existsSync(SYNC_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf8'));
    }
  } catch (e) {
    log.warn('clay-connector', 'Erreur lecture sync state: ' + e.message);
  }
  return { lastSync: null, syncedEmails: [] };
}

function saveSyncState(state) {
  try {
    const dir = path.dirname(SYNC_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(SYNC_STATE_FILE, state);
  } catch (e) {
    log.warn('clay-connector', 'Erreur sauvegarde sync state: ' + e.message);
  }
}

// ---- Table ID ----

function getTableId() {
  const tableId = process.env.CLAY_TABLE_ID;
  if (tableId) return Promise.resolve(tableId);
  return Promise.reject(new Error('CLAY_TABLE_ID non configure dans .env — ajouter l\'ID de la table Clay'));
}

// ---- Fetch table rows (v3 API) ----

async function fetchTableRows(tableId) {
  // v3 endpoint: /v3/tables/{tableId}/records
  // Also try /v3/sources/{tableId}/rows as fallback
  const endpoints = [
    '/v3/tables/' + tableId + '/records',
    '/v3/tables/' + tableId + '/rows'
  ];

  for (const ep of endpoints) {
    try {
      const data = await clayRequest('GET', ep);
      // Response format varies
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.data)) return data.data;
      if (data && Array.isArray(data.rows)) return data.rows;
      if (data && Array.isArray(data.records)) return data.records;
      if (data && Array.isArray(data.results)) return data.results;
      log.warn('clay-connector', 'Endpoint ' + ep + ' reponse inattendue: ' + JSON.stringify(data).slice(0, 200));
    } catch (e) {
      log.warn('clay-connector', 'Endpoint ' + ep + ' echoue: ' + e.message);
    }
  }
  throw new Error('Impossible de recuperer les rows de la table ' + tableId);
}

// ---- Create webhook action field in Clay table ----

async function createWebhookField(tableId) {
  const webhookUrl = 'https://srv1319748.hstgr.cloud/webhook/clay';
  const secret = process.env.CLAY_WEBHOOK_SECRET || '';

  // Create an HTTP API enrichment field that POSTs lead data to our webhook
  const fieldConfig = {
    name: 'Push to iFIND Bot',
    type: 'enrichment',
    typeSettings: {
      actionKey: 'http-api-v2',
      inputsBinding: {
        method: 'POST',
        url: webhookUrl,
        headers: JSON.stringify({ 'X-Clay-Secret': secret, 'Content-Type': 'application/json' }),
        body: JSON.stringify({
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
          linkedinBio: '{{Summarize LinkedIn}}',
          funding: '{{Funding Data}}',
          headcountGrowth: '{{Headcount Growth}}',
          leadScore: '{{Lead Score}}',
          priority: '{{Priority}}',
          intentSignal: '{{Intent Signal}}'
        })
      }
    }
  };

  try {
    const result = await clayRequest('POST', '/v3/tables/' + tableId + '/fields', fieldConfig);
    log.info('clay-connector', 'Webhook field cree dans Clay: ' + JSON.stringify(result).slice(0, 200));
    return result;
  } catch (e) {
    log.error('clay-connector', 'Erreur creation webhook field Clay: ' + e.message);
    throw e;
  }
}

// ---- Column mapping ----

function mapRowToLead(row) {
  function pick(row, ...names) {
    for (const name of names) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
      const lower = name.toLowerCase();
      for (const key of Object.keys(row)) {
        if (key.toLowerCase() === lower) return row[key];
      }
    }
    return '';
  }

  const email = pick(row, 'Work Email', 'work_email', 'Email', 'email', 'Waterfall Email', 'waterfall_email', 'Email Address', 'email_address');
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;

  let firstName = pick(row, 'First Name', 'first_name', 'firstName', 'prenom');
  let lastName = pick(row, 'Last Name', 'last_name', 'lastName', 'nom');
  if (!firstName && !lastName) {
    const fullName = pick(row, 'Full Name', 'full_name', 'Name', 'name', 'Nom complet');
    if (fullName) {
      const parts = fullName.trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }
  }

  const company = pick(row, 'Company', 'company', 'Company Name', 'company_name', 'Organization', 'organization', 'entreprise');
  const title = pick(row, 'Title', 'title', 'Job Title', 'job_title', 'Position', 'position', 'titre');
  const linkedin = pick(row, 'LinkedIn URL', 'linkedin_url', 'LinkedIn', 'linkedin', 'Person LinkedIn URL', 'person_linkedin_url');
  const website = pick(row, 'Website', 'website', 'Company Website', 'company_website', 'Domain', 'domain');
  const industry = pick(row, 'Industry', 'industry', 'Sector', 'sector', 'industrie');
  const employeeCount = pick(row, 'Employee Count', 'employee_count', 'Employees', 'employees', 'Company Size', 'company_size', 'headcount') || null;
  const location = pick(row, 'Location', 'location', 'City', 'city', 'Country', 'country', 'localisation');
  const phone = pick(row, 'Phone', 'phone', 'Phone Number', 'phone_number', 'Direct Phone', 'direct_phone');

  const linkedinBio = pick(row, 'Summarize LinkedIn', 'summarize_linkedin', 'Summarize LinkedIn profile', 'LinkedIn Bio', 'linkedin_bio', 'LinkedIn Summary', 'linkedin_summary');
  const linkedinPosts = pick(row, 'Professional Posts', 'professional_posts', 'Get professional posts and shares', 'LinkedIn Posts', 'linkedin_posts', 'Recent Posts', 'recent_posts');
  const builtWith = pick(row, 'BuiltWith', 'builtwith', 'Technologies', 'technologies', 'Tech Stack', 'tech_stack') || null;
  const funding = pick(row, 'Funding', 'funding', 'Total Funding', 'total_funding', 'Funding Data', 'funding_data') || null;

  const hgRaw = pick(row, 'Headcount Growth', 'headcount_growth', 'Growth', 'growth') || null;
  let headcountGrowth = null;
  let headcountData = null;
  if (hgRaw && typeof hgRaw === 'object') {
    headcountData = {
      employeeCount: hgRaw.employee_count || null,
      employeeCount6moAgo: hgRaw.employee_count_6_months_ago || null,
      employeeCount12moAgo: hgRaw.employee_count_12_months_ago || null,
      companyLinkedIn: hgRaw.url || null
    };
    if (headcountData.employeeCount && headcountData.employeeCount6moAgo) {
      headcountGrowth = Math.round((headcountData.employeeCount - headcountData.employeeCount6moAgo) / headcountData.employeeCount6moAgo * 100);
    }
  } else if (hgRaw) {
    headcountGrowth = hgRaw;
  }

  const leadScore = pick(row, 'Lead Score', 'lead_score', 'Score') || null;
  const priority = pick(row, 'Priority', 'priority') || null;
  const intentSignal = pick(row, 'Intent Signal', 'intent_signal') || null;

  const finalEmployeeCount = employeeCount || (headcountData && headcountData.employeeCount) || null;

  return {
    email: email.toLowerCase().trim(),
    firstName: firstName || '',
    lastName: lastName || '',
    company: company || '',
    title: title || '',
    linkedin: linkedin || '',
    website: website || '',
    industry: industry || '',
    employeeCount: finalEmployeeCount,
    location: location || '',
    phone: phone || '',
    linkedinBio: linkedinBio || null,
    linkedinPosts: linkedinPosts || null,
    builtWith: builtWith,
    funding: funding,
    headcountGrowth: headcountGrowth,
    headcountData: headcountData,
    leadScore: leadScore,
    priority: priority,
    intentSignal: intentSignal
  };
}

// ---- Main sync function ----

async function syncNewLeads(tableId) {
  const apiKey = process.env.CLAY_API_KEY;
  const cookie = process.env.CLAY_SESSION_COOKIE;
  if (!apiKey && !cookie) {
    log.warn('clay-connector', 'CLAY_API_KEY ou CLAY_SESSION_COOKIE requis — sync skip');
    return { imported: 0, skipped: 0 };
  }

  try {
    if (!tableId) {
      tableId = await getTableId();
    }

    log.info('clay-connector', 'Debut sync Clay table ' + tableId);

    const rows = await fetchTableRows(tableId);
    log.info('clay-connector', 'Clay API: ' + rows.length + ' rows recuperees');

    const state = loadSyncState();
    const syncedSet = new Set(state.syncedEmails || []);

    const automailerStorage = require('./automailer/storage.js');
    const ffStorage = require('./flowfast/storage.js');

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        const lead = mapRowToLead(row);
        if (!lead) {
          skipped++;
          continue;
        }

        if (syncedSet.has(lead.email)) {
          skipped++;
          continue;
        }

        if (!lead.firstName || !lead.lastName || !lead.company) {
          log.warn('clay-connector', 'Lead skip (champs manquants): ' + lead.email);
          skipped++;
          continue;
        }

        // Skip Priority C leads (hors ICP)
        if (lead.priority && lead.priority.toUpperCase() === 'C') {
          log.info('clay-connector', 'Lead skip (Priority C): ' + lead.email + ' — ' + lead.company);
          syncedSet.add(lead.email);
          skipped++;
          continue;
        }

        if (automailerStorage.isBlacklisted(lead.email)) {
          log.info('clay-connector', 'Lead skip (blacklist): ' + lead.email);
          syncedSet.add(lead.email);
          skipped++;
          continue;
        }

        const allLists = automailerStorage.getAllContactLists();
        let duplicate = false;
        for (const list of allLists) {
          if (list.contacts.some(c => (c.email || '').toLowerCase() === lead.email)) {
            duplicate = true;
            break;
          }
        }
        if (duplicate) {
          log.info('clay-connector', 'Lead skip (doublon): ' + lead.email);
          syncedSet.add(lead.email);
          skipped++;
          continue;
        }

        let clayList = automailerStorage.findContactListByName(ADMIN_CHAT_ID, 'Clay Imports');
        if (!clayList) {
          clayList = automailerStorage.createContactList(ADMIN_CHAT_ID, 'Clay Imports');
          log.info('clay-connector', 'Liste "Clay Imports" creee: ' + clayList.id);
        }

        automailerStorage.addContactToList(clayList.id, {
          email: lead.email,
          firstName: lead.firstName,
          lastName: lead.lastName,
          name: (lead.firstName + ' ' + lead.lastName).trim(),
          company: lead.company,
          title: lead.title,
          industry: lead.industry
        });

        try {
          if (!fs.existsSync(ENRICHMENT_DIR)) fs.mkdirSync(ENRICHMENT_DIR, { recursive: true });
          const enrichmentFile = ENRICHMENT_DIR + '/' + lead.email.replace(/[^a-z0-9@._-]/g, '_') + '.json';
          const enrichmentData = {
            email: lead.email,
            firstName: lead.firstName,
            lastName: lead.lastName,
            company: lead.company,
            title: lead.title,
            linkedin: lead.linkedin,
            website: lead.website,
            industry: lead.industry,
            employeeCount: lead.employeeCount,
            location: lead.location,
            phone: lead.phone,
            builtWith: lead.builtWith,
            funding: lead.funding,
            headcountGrowth: lead.headcountGrowth,
            linkedinBio: lead.linkedinBio,
            linkedinPosts: lead.linkedinPosts,
            leadScore: lead.leadScore,
            priority: lead.priority,
            intentSignal: lead.intentSignal,
            enrichment: {},
            source: 'clay',
            importedAt: new Date().toISOString()
          };
          atomicWriteSync(enrichmentFile, enrichmentData);
        } catch (e) {
          log.warn('clay-connector', 'Erreur sauvegarde enrichment pour ' + lead.email + ': ' + e.message);
        }

        try {
          ffStorage.addLead({
            email: lead.email,
            nom: (lead.firstName + ' ' + lead.lastName).trim(),
            entreprise: lead.company,
            titre: lead.title,
            industry: lead.industry,
            linkedin: lead.linkedin,
            localisation: lead.location
          }, lead.leadScore ? parseInt(lead.leadScore) : 7, 'clay');
          log.info('clay-connector', 'FlowFast lead ajoute: ' + lead.email + ' (score ' + (lead.leadScore || 7) + ', source clay)');
        } catch (e) {
          log.warn('clay-connector', 'FlowFast injection echouee pour ' + lead.email + ': ' + e.message);
        }

        syncedSet.add(lead.email);
        imported++;
        log.info('clay-connector', 'Lead importe: ' + lead.email + ' (' + lead.company + ')');

      } catch (e) {
        errors++;
        log.warn('clay-connector', 'Erreur traitement row: ' + e.message);
      }
    }

    saveSyncState({
      lastSync: new Date().toISOString(),
      syncedEmails: Array.from(syncedSet)
    });

    log.info('clay-connector', 'Clay sync termine: ' + imported + ' new leads importes, ' + skipped + ' deja synced' + (errors > 0 ? ', ' + errors + ' erreurs' : ''));
    return { imported, skipped, errors };

  } catch (e) {
    log.error('clay-connector', 'Clay sync echoue: ' + e.message);
    return { imported: 0, skipped: 0, error: e.message };
  }
}

module.exports = { fetchTableRows, syncNewLeads, getTableId, createWebhookField, clayRequest };
