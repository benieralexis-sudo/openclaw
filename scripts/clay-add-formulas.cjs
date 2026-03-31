#!/usr/bin/env node
// iFIND — Ajoute les 4 formules manquantes à une table Clay
// Usage: node scripts/clay-add-formulas.cjs [tableId]
// Sans argument, utilise CLAY_TABLE_ID du .env

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { clayRequest } = require('../skills/clay-connector.js');

const TABLE_ID = process.argv[2] || process.env.CLAY_TABLE_ID;
if (!TABLE_ID) {
  console.error('ERREUR: CLAY_TABLE_ID requis (en argument ou dans .env)');
  process.exit(1);
}

// ---- Helpers ----

async function getFields(tableId) {
  const resp = await clayRequest('GET', `/v3/tables/${tableId}`);
  return (resp.table || resp).fields || [];
}

function findFieldId(fields, name) {
  const f = fields.find(f => f.name === name);
  return f ? f.id : null;
}

async function createField(tableId, body) {
  const result = await clayRequest('POST', `/v3/tables/${tableId}/fields`, body);
  return result.field || result;
}

// ---- Main ----

async function main() {
  console.log(`\n=== Clay Add Formulas ===`);
  console.log(`Table: ${TABLE_ID}\n`);

  const fields = await getFields(TABLE_ID);
  console.log(`${fields.length} champs existants`);
  const names = new Set(fields.map(f => f.name));

  // Trouver les IDs des champs source
  const enrichCompanyId = findFieldId(fields, 'Enrich Company');
  const workEmailId = findFieldId(fields, 'Work Email');
  const newsId = findFieldId(fields, 'Google News');
  const jobsId = findFieldId(fields, 'Google Job Listings');
  const headcountId = findFieldId(fields, 'Headcount Growth');
  const techStackId = findFieldId(fields, 'Tech Stack');
  const linkedinUrlId = findFieldId(fields, 'Find LinkedIn URL');
  const linkedinBioId = findFieldId(fields, 'LinkedIn Bio');

  if (!enrichCompanyId) {
    console.error('ERREUR: Champ "Enrich Company" introuvable — requis pour Industry et Employee Count');
    process.exit(1);
  }

  console.log(`Enrich Company: ${enrichCompanyId}`);
  console.log('');

  let created = 0;

  // 1. Industry — extract from Enrich Company
  if (names.has('Industry')) {
    console.log('  → Industry existe déjà — skip');
  } else {
    try {
      const r = await createField(TABLE_ID, {
        name: 'Industry',
        type: 'formula',
        typeSettings: {
          dataTypeSettings: { type: 'text' },
          formulaType: 'text',
          formulaText: `{{${enrichCompanyId}}}?.industry`
        },
        isExtractedField: true,
        extractedField: {
          fieldIdExtractedFrom: enrichCompanyId,
          extractedKeyPath: '?.industry'
        }
      });
      console.log(`  ✓ Industry créé (${r.id})`);
      created++;
    } catch (e) {
      console.error(`  ✗ Industry: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // 2. Employee Count — extract from Enrich Company
  if (names.has('Employee Count')) {
    console.log('  → Employee Count existe déjà — skip');
  } else {
    try {
      const r = await createField(TABLE_ID, {
        name: 'Employee Count',
        type: 'formula',
        typeSettings: {
          dataTypeSettings: { type: 'number' },
          formulaType: 'text',
          formulaText: `{{${enrichCompanyId}}}?.employee_count`
        },
        isExtractedField: true,
        extractedField: {
          fieldIdExtractedFrom: enrichCompanyId,
          extractedKeyPath: '?.employee_count'
        }
      });
      console.log(`  ✓ Employee Count créé (${r.id})`);
      created++;
    } catch (e) {
      console.error(`  ✗ Employee Count: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Refresh fields pour avoir les IDs des nouveaux champs
  const updatedFields = created > 0 ? await getFields(TABLE_ID) : fields;
  const employeeCountId = findFieldId(updatedFields, 'Employee Count');

  // 3. Lead Score — scoring formula
  if (names.has('Lead Score')) {
    console.log('  → Lead Score existe déjà — skip');
  } else {
    // Build formula with actual field IDs
    const parts = [];
    if (jobsId) parts.push(`({{${jobsId}}} && String({{${jobsId}}}) !== "" ? 25 : 0)`);
    if (newsId) parts.push(`({{${newsId}}} && String({{${newsId}}}) !== "" ? 20 : 0)`);
    if (headcountId) parts.push(`({{${headcountId}}} && typeof {{${headcountId}}} === 'object' && {{${headcountId}}}.employee_count > ({{${headcountId}}}.employee_count_6_months_ago || 0) ? 15 : 0)`);
    if (employeeCountId) parts.push(`(Number({{${employeeCountId}}}) >= 50 ? 15 : Number({{${employeeCountId}}}) >= 10 ? 10 : 0)`);
    if (techStackId) parts.push(`({{${techStackId}}} && String({{${techStackId}}}) !== "" ? 10 : 0)`);
    if (workEmailId) parts.push(`({{${workEmailId}}} ? 10 : 0)`);
    if (linkedinUrlId) parts.push(`({{${linkedinUrlId}}} ? 5 : 0)`);

    const formulaText = parts.join(' + ') || '0';
    const inputFieldIds = [jobsId, newsId, headcountId, employeeCountId, techStackId, workEmailId, linkedinUrlId].filter(Boolean);

    try {
      const r = await createField(TABLE_ID, {
        name: 'Lead Score',
        type: 'formula',
        typeSettings: {
          dataTypeSettings: { type: 'number' },
          formulaType: 'text',
          formulaText: formulaText
        }
      });
      console.log(`  ✓ Lead Score créé (${r.id})`);
      console.log(`    Formule: ${formulaText.slice(0, 120)}...`);
      created++;
    } catch (e) {
      console.error(`  ✗ Lead Score: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // 4. Priority — Haute/Moyenne/Basse
  if (names.has('Priority')) {
    console.log('  → Priority existe déjà — skip');
  } else {
    // Refresh to get Lead Score ID
    const latestFields = created > 0 ? await getFields(TABLE_ID) : updatedFields;
    const leadScoreId = findFieldId(latestFields, 'Lead Score');

    if (!leadScoreId) {
      console.error('  ✗ Priority: Lead Score introuvable — créer Lead Score d\'abord');
    } else {
      try {
        const r = await createField(TABLE_ID, {
          name: 'Priority',
          type: 'formula',
          typeSettings: {
            dataTypeSettings: { type: 'text' },
            formulaType: 'text',
            formulaText: `Number({{${leadScoreId}}}) >= 60 ? "Haute" : Number({{${leadScoreId}}}) >= 35 ? "Moyenne" : "Basse"`
          }
        });
        console.log(`  ✓ Priority créé (${r.id})`);
        created++;
      } catch (e) {
        console.error(`  ✗ Priority: ${e.message}`);
      }
    }
  }

  console.log(`\n=== Résultat: ${created} formule(s) créée(s) ===`);
  if (created > 0) {
    console.log(`⚠️  Aller dans l'UI Clay → cliquer "Run" sur chaque nouveau champ pour activer.`);
  }
}

main().catch(e => {
  console.error('Erreur fatale:', e.message);
  process.exit(1);
});
