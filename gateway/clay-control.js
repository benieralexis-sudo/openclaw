/**
 * Clay Control Layer — Full programmatic control of Clay tables
 * Allows reading data, running enrichments, monitoring status, and managing fields
 * without needing the Clay UI (except for waterfall creation)
 */

const https = require('https');
const log = require('./logger');

const CLAY_API_BASE = 'https://api.clay.com';

// ---- Config ----

function getConfig() {
  return {
    cookie: process.env.CLAY_SESSION_COOKIE || '',
    tableId: process.env.CLAY_TABLE_ID || '',
    webhookSecret: process.env.CLAY_WEBHOOK_SECRET || ''
  };
}

function headers(cookie) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Cookie': cookie || getConfig().cookie,
    'Referer': 'https://app.clay.com/',
    'Origin': 'https://app.clay.com'
  };
}

// ---- Core HTTP ----

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(CLAY_API_BASE + path);
    const opts = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: headers()
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
            reject(new Error(`Clay API ${res.statusCode}: ${json.message || data.slice(0, 200)}`));
          }
        } catch (e) {
          reject(new Error(`Clay API parse error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---- Table Info ----

/**
 * Get full table structure: fields, views, waterfalls
 */
async function getTable(tableId) {
  tableId = tableId || getConfig().tableId;
  const data = await request('GET', `/v3/tables/${tableId}`);
  return data.table || data;
}

/**
 * List all tables in workspace
 */
async function listTables(workspaceId) {
  workspaceId = workspaceId || '1070768';
  const data = await request('GET', `/v3/workspaces/${workspaceId}/tables`);
  return (data.results || []).map(t => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt
  }));
}

/**
 * Get row count for a table (or specific view)
 */
async function getRowCount(tableId, viewId) {
  tableId = tableId || getConfig().tableId;
  const body = { format: 'csv' };
  if (viewId) body.viewId = viewId;
  const data = await request('POST', `/v3/tables/${tableId}/export`, body);
  return data.totalRecordsInViewCount || 0;
}

// ---- Field Audit ----

/**
 * Audit all fields — returns ok fields and broken fields
 */
async function auditFields(tableId) {
  const table = await getTable(tableId);
  const fields = table.fields || [];
  const ok = [];
  const broken = [];

  for (const f of fields) {
    const se = f.settingsError || [];
    const ts = f.typeSettings || {};
    const info = {
      id: f.id,
      name: f.name,
      type: f.type,
      actionKey: ts.actionKey || null,
      inputCount: (ts.inputsBinding || []).length,
      autoRun: ts.autoRun || false
    };

    if (se.length > 0) {
      info.error = se[0].message || 'Unknown error';
      broken.push(info);
    } else {
      ok.push(info);
    }
  }

  return { ok, broken, total: fields.length };
}

// ---- Views ----

/**
 * Get all views for a table
 */
async function getViews(tableId) {
  const table = await getTable(tableId);
  return (table.views || []).map(v => ({
    id: v.id,
    name: v.name
  }));
}

/**
 * Find view by name (partial match)
 */
async function findView(tableId, nameFragment) {
  const views = await getViews(tableId);
  return views.find(v => v.name.toLowerCase().includes(nameFragment.toLowerCase()));
}

// ---- Run Enrichments ----

/**
 * Run specific fields on all rows in a view
 * @param {string} tableId
 * @param {string[]} fieldIds - field IDs to run
 * @param {string} viewId - view to run on (use "all rows" view for everything)
 * @returns {{ recordCount: number, runMode: string }}
 */
async function runFields(tableId, fieldIds, viewId) {
  tableId = tableId || getConfig().tableId;

  // If no viewId provided, find "All rows" view
  if (!viewId) {
    const view = await findView(tableId, 'all rows');
    if (!view) {
      const views = await getViews(tableId);
      // Fall back to first view
      viewId = views[0]?.id;
    } else {
      viewId = view.id;
    }
  }

  if (!viewId) throw new Error('No view found to run on');

  const result = await request('PATCH', `/v3/tables/${tableId}/run`, {
    runRecords: { viewId },
    fieldIds
  });

  log.info('clay-control', `Run ${fieldIds.length} fields on view ${viewId}: ${result.recordCount} records, mode=${result.runMode}`);
  return result;
}

/**
 * Run ALL action fields (non-waterfall) on a table
 */
async function runAllEnrichments(tableId) {
  const table = await getTable(tableId);
  const fields = table.fields || [];

  // Get non-waterfall action fields
  const actionFields = fields.filter(f => {
    if (f.type !== 'action') return false;
    const key = (f.typeSettings || {}).actionKey || '';
    // Skip waterfall sub-fields
    if (key.includes('validate') || key.includes('find-email') ||
        key.includes('find-work') || key.includes('leadmagic-find') ||
        key.includes('findymail-find')) return false;
    // Skip if has errors
    if ((f.settingsError || []).length > 0) return false;
    return true;
  });

  if (actionFields.length === 0) {
    log.warn('clay-control', 'No action fields to run');
    return { recordCount: 0, fields: 0 };
  }

  const fieldIds = actionFields.map(f => f.id);
  log.info('clay-control', `Running ${fieldIds.length} enrichments: ${actionFields.map(f => f.name).join(', ')}`);

  return runFields(tableId, fieldIds);
}

// ---- Field Management ----

/**
 * Create an action field
 */
async function createAction(tableId, name, actionKey, packageId, inputsBinding, authAccountId) {
  const ts = {
    dataTypeSettings: { type: 'json' },
    actionKey,
    actionVersion: 1,
    actionPackageId: packageId,
    inputsBinding
  };
  if (authAccountId) ts.authAccountId = authAccountId;

  const result = await request('POST', `/v3/tables/${tableId}/fields`, {
    name,
    type: 'action',
    typeSettings: ts
  });

  const field = result.field || result;
  const se = field.settingsError || [];
  if (se.length > 0) {
    log.error('clay-control', `Field ${name} created with error: ${se[0].message}`);
  } else {
    log.info('clay-control', `Field ${name} created: ${field.id}`);
  }
  return field;
}

/**
 * Create a formula field
 */
async function createFormula(tableId, name, formulaText) {
  const result = await request('POST', `/v3/tables/${tableId}/fields`, {
    name,
    type: 'formula',
    typeSettings: {
      dataTypeSettings: { type: 'text' },
      formulaType: 'text',
      formulaText
    }
  });
  const field = result.field || result;
  log.info('clay-control', `Formula ${name} created: ${field.id}`);
  return field;
}

/**
 * Delete a field
 */
async function deleteField(tableId, fieldId) {
  await request('DELETE', `/v3/tables/${tableId}/fields/${fieldId}`);
  log.info('clay-control', `Field ${fieldId} deleted`);
}

/**
 * Rename a table
 */
async function renameTable(tableId, newName) {
  const result = await request('PATCH', `/v3/tables/${tableId}`, { name: newName });
  log.info('clay-control', `Table renamed to: ${newName}`);
  return result;
}

/**
 * Delete a table
 */
async function deleteTable(tableId) {
  await request('DELETE', `/v3/tables/${tableId}`);
  log.info('clay-control', `Table ${tableId} deleted`);
}

// ---- Status Dashboard ----

/**
 * Get a complete status report for a table
 */
async function getStatus(tableId) {
  tableId = tableId || getConfig().tableId;
  const [table, rowCount] = await Promise.all([
    getTable(tableId),
    getRowCount(tableId)
  ]);

  const fields = table.fields || [];
  const actions = fields.filter(f => f.type === 'action');
  const formulas = fields.filter(f => f.type === 'formula');
  const broken = fields.filter(f => (f.settingsError || []).length > 0);

  const views = (table.views || []).map(v => ({ id: v.id, name: v.name }));

  return {
    name: table.name,
    id: tableId,
    rowCount,
    fields: {
      total: fields.length,
      actions: actions.length,
      formulas: formulas.length,
      broken: broken.length,
      brokenList: broken.map(f => ({
        name: f.name,
        error: (f.settingsError || [])[0]?.message || '?'
      }))
    },
    views
  };
}

/**
 * Print a human-readable status report
 */
async function printStatus(tableId) {
  const status = await getStatus(tableId);
  const lines = [
    `\n=== CLAY TABLE STATUS ===`,
    `Table: ${status.name} (${status.id})`,
    `Rows: ${status.rowCount}`,
    `Fields: ${status.fields.total} (${status.fields.actions} actions, ${status.fields.formulas} formulas)`,
    `Broken: ${status.fields.broken}`
  ];

  if (status.fields.broken > 0) {
    lines.push(`\nBroken fields:`);
    for (const f of status.fields.brokenList) {
      lines.push(`  ❌ ${f.name}: ${f.error}`);
    }
  }

  lines.push(`\nViews:`);
  for (const v of status.views) {
    lines.push(`  ${v.id} — ${v.name}`);
  }

  const report = lines.join('\n');
  log.info('clay-control', report);
  return report;
}

// ---- Webhook Data Capture ----

// In-memory buffer for captured webhook data
const _capturedData = [];
const MAX_CAPTURED = 1000;

/**
 * Called by the webhook handler to capture incoming lead data
 */
function captureWebhookData(lead) {
  _capturedData.push({
    ...lead,
    capturedAt: new Date().toISOString()
  });
  if (_capturedData.length > MAX_CAPTURED) {
    _capturedData.shift(); // Remove oldest
  }
}

/**
 * Get captured data (for reading lead info)
 */
function getCapturedData(filter) {
  if (!filter) return [..._capturedData];
  return _capturedData.filter(lead => {
    for (const [key, value] of Object.entries(filter)) {
      if (lead[key] !== value) return false;
    }
    return true;
  });
}

/**
 * Clear captured data
 */
function clearCapturedData() {
  _capturedData.length = 0;
}

// ---- Convenience: Full Pipeline ----

/**
 * Run the optimized enrichment pipeline:
 * 1. Wait for waterfall email to finish (must be started manually or already running)
 * 2. Run other enrichments only on leads with email (via "Fully enriched" view or similar)
 * 3. Run Push to Bot last
 *
 * @param {string} tableId
 * @param {Object} fieldMap - { googleNews, summarize, funding, pushToBot }
 */
async function runPipeline(tableId, fieldMap) {
  tableId = tableId || getConfig().tableId;

  const steps = [];

  // Step 1: Run enrichments (skip waterfall - must be done in UI or already running)
  if (fieldMap.googleNews) steps.push(fieldMap.googleNews);
  if (fieldMap.summarize) steps.push(fieldMap.summarize);
  if (fieldMap.funding) steps.push(fieldMap.funding);

  if (steps.length > 0) {
    log.info('clay-control', `Pipeline step 1: Running ${steps.length} enrichments`);
    await runFields(tableId, steps);
  }

  // Step 2: Wait, then push to bot
  if (fieldMap.pushToBot) {
    log.info('clay-control', `Pipeline step 2: Push to Bot will be run after enrichments complete`);
    // Don't auto-run push - needs to wait for enrichments
    // Return the field ID so caller can run it later
    return {
      enrichmentsStarted: steps.length,
      pushToBotFieldId: fieldMap.pushToBot,
      message: 'Run pushToBot after enrichments complete'
    };
  }

  return { enrichmentsStarted: steps.length };
}

// ---- Exports ----

module.exports = {
  // Table info
  getTable,
  listTables,
  getRowCount,
  getViews,
  findView,

  // Field management
  auditFields,
  createAction,
  createFormula,
  deleteField,
  renameTable,
  deleteTable,

  // Run enrichments
  runFields,
  runAllEnrichments,
  runPipeline,

  // Status
  getStatus,
  printStatus,

  // Data capture
  captureWebhookData,
  getCapturedData,
  clearCapturedData,

  // Low-level
  request
};
