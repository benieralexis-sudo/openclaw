// iFIND — Clay API Connector
// Auto-sync enriched leads from Clay tables every 30 min
// CommonJS module

const fs = require('fs');
const path = require('path');
const https = require('https');
const log = require('../gateway/logger.js');
const { atomicWriteSync } = require('../gateway/utils.js');

const CLAY_API_BASE = 'https://api.clay.com/v1';
const SYNC_STATE_FILE = '/data/automailer/clay-sync-state.json';
const ENRICHMENT_DIR = '/data/automailer/clay-enrichments';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '1409505520';

// ---- HTTP helper ----

function clayRequest(method, endpoint, retries) {
  retries = retries === undefined ? 1 : retries;
  const apiKey = process.env.CLAY_API_KEY;
  if (!apiKey) return Promise.reject(new Error('CLAY_API_KEY non configure'));

  const url = CLAY_API_BASE + endpoint;

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Clay API: reponse JSON invalide — ' + body.slice(0, 200)));
          }
        } else if (retries > 0 && res.statusCode >= 500) {
          log.warn('clay-connector', 'Clay API ' + res.statusCode + ', retry dans 3s...');
          setTimeout(() => {
            clayRequest(method, endpoint, retries - 1).then(resolve).catch(reject);
          }, 3000);
        } else {
          reject(new Error('Clay API ' + res.statusCode + ': ' + body.slice(0, 300)));
        }
      });
    });

    req.on('error', (e) => {
      if (retries > 0) {
        log.warn('clay-connector', 'Clay API erreur reseau, retry dans 3s: ' + e.message);
        setTimeout(() => {
          clayRequest(method, endpoint, retries - 1).then(resolve).catch(reject);
        }, 3000);
      } else {
        reject(new Error('Clay API erreur reseau: ' + e.message));
      }
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Clay API timeout 30s'));
    });

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

// ---- Table ID helper ----

let _cachedTableId = null;

async function getTableId() {
  if (_cachedTableId) return _cachedTableId;

  // Try /v1/tables first (standard pattern)
  const endpoints = ['/tables'];
  for (const ep of endpoints) {
    try {
      const data = await clayRequest('GET', ep);
      // Response could be { data: [...] } or { tables: [...] } or just [...]
      let tables = null;
      if (Array.isArray(data)) tables = data;
      else if (data && Array.isArray(data.data)) tables = data.data;
      else if (data && Array.isArray(data.tables)) tables = data.tables;

      if (tables && tables.length > 0) {
        _cachedTableId = tables[0].id || tables[0]._id || tables[0].tableId;
        log.info('clay-connector', 'Table trouvee: ' + (tables[0].name || _cachedTableId) + ' (id: ' + _cachedTableId + ')');
        return _cachedTableId;
      }
    } catch (e) {
      log.warn('clay-connector', 'Endpoint ' + ep + ' echoue: ' + e.message);
    }
  }
  throw new Error('Aucune table Clay trouvee — verifier API key et permissions');
}

// ---- Fetch table rows ----

async function fetchTableRows(tableId) {
  // Try multiple endpoint patterns (Clay API varies)
  const endpoints = [
    '/tables/' + tableId + '/rows',
    '/sources/' + tableId + '/rows'
  ];

  for (const ep of endpoints) {
    try {
      const data = await clayRequest('GET', ep);
      // Response could be { data: [...] } or { rows: [...] } or just [...]
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.data)) return data.data;
      if (data && Array.isArray(data.rows)) return data.rows;
      if (data && Array.isArray(data.results)) return data.results;
      log.warn('clay-connector', 'Endpoint ' + ep + ' reponse inattendue: ' + JSON.stringify(data).slice(0, 200));
    } catch (e) {
      log.warn('clay-connector', 'Endpoint ' + ep + ' echoue: ' + e.message);
    }
  }
  throw new Error('Impossible de recuperer les rows de la table ' + tableId);
}

// ---- Column mapping ----

function mapRowToLead(row) {
  // Clay columns may have various naming conventions
  // Try multiple possible column names for each field
  function pick(row, ...names) {
    for (const name of names) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
      // Also try case-insensitive
      const lower = name.toLowerCase();
      for (const key of Object.keys(row)) {
        if (key.toLowerCase() === lower) return row[key];
      }
    }
    return '';
  }

  const email = pick(row, 'Work Email', 'work_email', 'Email', 'email', 'Waterfall Email', 'waterfall_email', 'Email Address', 'email_address');
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;

  // Parse full name if no separate first/last
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

  // Enrichment data
  const linkedinBio = pick(row, 'Summarize LinkedIn', 'summarize_linkedin', 'LinkedIn Bio', 'linkedin_bio', 'LinkedIn Summary', 'linkedin_summary');
  const linkedinPosts = pick(row, 'Professional Posts', 'professional_posts', 'LinkedIn Posts', 'linkedin_posts', 'Recent Posts', 'recent_posts');
  const builtWith = pick(row, 'BuiltWith', 'builtwith', 'Technologies', 'technologies', 'Tech Stack', 'tech_stack') || null;
  const funding = pick(row, 'Funding', 'funding', 'Total Funding', 'total_funding') || null;
  const headcountGrowth = pick(row, 'Headcount Growth', 'headcount_growth', 'Growth', 'growth') || null;

  return {
    email: email.toLowerCase().trim(),
    firstName: firstName || '',
    lastName: lastName || '',
    company: company || '',
    title: title || '',
    linkedin: linkedin || '',
    website: website || '',
    industry: industry || '',
    employeeCount: employeeCount,
    location: location || '',
    phone: phone || '',
    linkedinBio: linkedinBio || null,
    linkedinPosts: linkedinPosts || null,
    builtWith: builtWith,
    funding: funding,
    headcountGrowth: headcountGrowth
  };
}

// ---- Main sync function ----

async function syncNewLeads(tableId) {
  if (!process.env.CLAY_API_KEY) {
    log.warn('clay-connector', 'CLAY_API_KEY non configure — sync skip');
    return { imported: 0, skipped: 0 };
  }

  try {
    // Resolve table ID if not provided
    if (!tableId) {
      tableId = await getTableId();
    }

    log.info('clay-connector', 'Debut sync Clay table ' + tableId);

    // Fetch all rows
    const rows = await fetchTableRows(tableId);
    log.info('clay-connector', 'Clay API: ' + rows.length + ' rows recuperees');

    // Load sync state
    const state = loadSyncState();
    const syncedSet = new Set(state.syncedEmails || []);

    // Load dependencies
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

        // Already synced?
        if (syncedSet.has(lead.email)) {
          skipped++;
          continue;
        }

        // Validation minimum
        if (!lead.firstName || !lead.lastName || !lead.company) {
          log.warn('clay-connector', 'Lead skip (champs manquants): ' + lead.email);
          skipped++;
          continue;
        }

        // Check blacklist
        if (automailerStorage.isBlacklisted(lead.email)) {
          log.info('clay-connector', 'Lead skip (blacklist): ' + lead.email);
          syncedSet.add(lead.email);
          skipped++;
          continue;
        }

        // Check duplicate across all lists
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

        // Find or create "Clay Imports" list
        let clayList = automailerStorage.findContactListByName(ADMIN_CHAT_ID, 'Clay Imports');
        if (!clayList) {
          clayList = automailerStorage.createContactList(ADMIN_CHAT_ID, 'Clay Imports');
          log.info('clay-connector', 'Liste "Clay Imports" creee: ' + clayList.id);
        }

        // Add contact to automailer list
        automailerStorage.addContactToList(clayList.id, {
          email: lead.email,
          firstName: lead.firstName,
          lastName: lead.lastName,
          name: (lead.firstName + ' ' + lead.lastName).trim(),
          company: lead.company,
          title: lead.title,
          industry: lead.industry
        });

        // Store enrichment file (same format as webhook handler)
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
            enrichment: {},
            source: 'clay',
            importedAt: new Date().toISOString()
          };
          atomicWriteSync(enrichmentFile, enrichmentData);
        } catch (e) {
          log.warn('clay-connector', 'Erreur sauvegarde enrichment pour ' + lead.email + ': ' + e.message);
        }

        // Add to FlowFast
        try {
          ffStorage.addLead({
            email: lead.email,
            nom: (lead.firstName + ' ' + lead.lastName).trim(),
            entreprise: lead.company,
            titre: lead.title,
            industry: lead.industry,
            linkedin: lead.linkedin,
            localisation: lead.location
          }, 7, 'clay');
          log.info('clay-connector', 'FlowFast lead ajoute: ' + lead.email + ' (score 7, source clay)');
        } catch (e) {
          log.warn('clay-connector', 'FlowFast injection echouee pour ' + lead.email + ': ' + e.message);
        }

        // Mark as synced
        syncedSet.add(lead.email);
        imported++;
        log.info('clay-connector', 'Lead importe: ' + lead.email + ' (' + lead.company + ')');

      } catch (e) {
        errors++;
        log.warn('clay-connector', 'Erreur traitement row: ' + e.message);
      }
    }

    // Save sync state
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

module.exports = { fetchTableRows, syncNewLeads, getTableId };
