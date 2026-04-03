#!/usr/bin/env node
// iFIND — Fix Clay table: conditions, formulas, renames, Clean Domain
// Usage: node scripts/clay-fix-all.cjs

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { clayRequest } = require('../skills/clay-connector.js');

const TABLE_ID = 't_0tcu7swzKxuMiGevHW7';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// GET field's full definition from table
async function getField(tableId, fieldId) {
  const resp = await clayRequest('GET', `/v3/tables/${tableId}`);
  const fields = (resp.table || resp).fields || [];
  const field = fields.find(f => f.id === fieldId);
  if (!field) throw new Error(`Field ${fieldId} introuvable dans la table`);
  return field;
}

// PATCH field with payload
async function patchField(tableId, fieldId, payload) {
  return clayRequest('PATCH', `/v3/tables/${tableId}/fields/${fieldId}`, payload);
}

// ---- FIX 1: Add condition to LinkedIn Posts field ----
async function fix1() {
  console.log('\n=== FIX 1: Add condition to LinkedIn Posts ===');
  const fieldId = 'f_0tcxbo4euiaFDjPZQKp';
  const linkedinUrlFieldId = 'f_0tcu8rzKcyeB6F3yMRk';

  const field = await getField(TABLE_ID, fieldId);
  console.log(`  Field: ${field.name} (${field.id})`);
  console.log(`  Type: ${field.type}`);
  console.log(`  Current typeSettings keys: ${Object.keys(field.typeSettings || {}).join(', ')}`);

  // Build complete typeSettings with condition added
  const newTypeSettings = { ...field.typeSettings };
  newTypeSettings.conditionalRunFormulaText = `{{${linkedinUrlFieldId}}}`;

  console.log(`  Adding condition: {{${linkedinUrlFieldId}}} (LinkedIn URL must exist)`);

  const result = await patchField(TABLE_ID, fieldId, { typeSettings: newTypeSettings });
  console.log(`  OK — LinkedIn Posts now conditional on LinkedIn URL`);
  return result;
}

// ---- FIX 2: Update Lead Score formula ----
async function fix2() {
  console.log('\n=== FIX 2: Update Lead Score formula ===');
  const fieldId = 'f_0tcvetbYF4hjW3sQdHg';

  const field = await getField(TABLE_ID, fieldId);
  console.log(`  Field: ${field.name} (${field.id})`);
  console.log(`  Current formula: ${field.typeSettings?.formulaText || 'N/A'}`);

  const newFormula = 'String(({{f_0tcvc1egA9yyfqzYYeF}} ? 20 : 0) + (Number({{f_0tcu8rxQgAYMXR6BXQD}}) >= 11 ? 15 : 0) + ({{f_0tcw3b14FGYsxKkVp2j}} ? 10 : 0) + ({{f_0tcvufziaGaionBXGeu}} ? 10 : 0) + ({{f_0tcu8sph53i5RCxB9wU}} ? 5 : 0) + ({{f_0tcxbo4euiaFDjPZQKp}} ? 15 : 0) + ({{f_0tcu8ryVHzafpeJquXs}} ? 10 : 0))';

  const newTypeSettings = { ...field.typeSettings };
  newTypeSettings.formulaText = newFormula;

  console.log(`  New formula: ${newFormula}`);
  console.log(`  Max: 85 points (was 60)`);

  const result = await patchField(TABLE_ID, fieldId, { typeSettings: newTypeSettings });
  console.log(`  OK — Lead Score formula updated`);
  return result;
}

// ---- FIX 3: Update Priority formula thresholds ----
async function fix3() {
  console.log('\n=== FIX 3: Update Priority formula thresholds ===');
  const fieldId = 'f_0tcvetckBeUXtgMesek';

  const field = await getField(TABLE_ID, fieldId);
  console.log(`  Field: ${field.name} (${field.id})`);
  console.log(`  Current formula: ${field.typeSettings?.formulaText || 'N/A'}`);

  const newFormula = 'Number({{f_0tcvetbYF4hjW3sQdHg}}) >= 50 ? "Haute" : Number({{f_0tcvetbYF4hjW3sQdHg}}) >= 30 ? "Moyenne" : "Basse"';

  const newTypeSettings = { ...field.typeSettings };
  newTypeSettings.formulaText = newFormula;

  console.log(`  New formula: ${newFormula}`);

  const result = await patchField(TABLE_ID, fieldId, { typeSettings: newTypeSettings });
  console.log(`  OK — Priority thresholds updated (>=50 Haute, >=30 Moyenne)`);
  return result;
}

// ---- FIX 4: Rename waterfall providers ----
async function fix4() {
  console.log('\n=== FIX 4: Rename waterfall providers ===');
  const renames = [
    { id: 'f_0tcw38pQ6fpjaNU8n8z', name: 'Email - Hunter' },
    { id: 'f_0tcw38pkrxDb3mhj69g', name: 'Email - Prospeo' },
    { id: 'f_0tcw38oxQy2jXBjo8EF', name: 'Email - Findymail' },
    { id: 'f_0tcw38rJHVCsHTJDWxk', name: 'Email - Wiza' },
  ];

  for (const r of renames) {
    try {
      await patchField(TABLE_ID, r.id, { name: r.name });
      console.log(`  OK — ${r.id} → "${r.name}"`);
    } catch (e) {
      console.error(`  ERREUR — ${r.id}: ${e.message}`);
    }
    await delay(500);
  }
}

// ---- FIX 5: Fix Clean Domain formula (strip trailing slash) ----
async function fix5() {
  console.log('\n=== FIX 5: Fix Clean Domain formula ===');
  const fieldId = 'f_0tcu8sph53i5RCxB9wU';

  const field = await getField(TABLE_ID, fieldId);
  console.log(`  Field: ${field.name} (${field.id})`);
  console.log(`  Current formula: ${field.typeSettings?.formulaText || 'N/A'}`);

  const currentFormula = field.typeSettings?.formulaText || '';

  // Add .split("/")[0] at the end to strip trailing slash
  // If formula already has it, skip
  if (currentFormula.includes('.split("/")[0]')) {
    console.log('  Already has .split("/")[0] — skip');
    return;
  }

  // Wrap existing formula: add .split("/")[0] at the end
  // The formula likely returns a domain string, so we append the split
  let newFormula;
  if (currentFormula.endsWith(')')) {
    // Wrap in parentheses and add split
    newFormula = `(${currentFormula}).split("/")[0]`;
  } else {
    newFormula = `${currentFormula}.split("/")[0]`;
  }

  console.log(`  New formula: ${newFormula}`);

  const newTypeSettings = { ...field.typeSettings };
  newTypeSettings.formulaText = newFormula;

  const result = await patchField(TABLE_ID, fieldId, { typeSettings: newTypeSettings });
  console.log(`  OK — Clean Domain now strips trailing slashes`);
  return result;
}

// ---- Main ----
async function main() {
  console.log('=== Clay Fix All — Table ' + TABLE_ID + ' ===');
  console.log('Date: ' + new Date().toISOString());

  try {
    await fix1();
    await delay(1000);

    await fix2();
    await delay(1000);

    await fix3();
    await delay(1000);

    await fix4();
    await delay(1000);

    await fix5();

    console.log('\n=== DONE — All 5 fixes applied ===');
  } catch (e) {
    console.error('\nERREUR FATALE:', e.message);
    process.exit(1);
  }
}

main();
