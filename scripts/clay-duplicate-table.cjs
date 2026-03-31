#!/usr/bin/env node
// iFIND — Duplique la table Clay template pour un nouveau client
// Usage: node scripts/clay-duplicate-table.cjs <clientName> [sourceTableId]
// Sans sourceTableId, utilise CLAY_TABLE_ID du .env

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { clayRequest } = require('../skills/clay-connector.js');

const CLIENT_NAME = process.argv[2];
const SOURCE_TABLE = process.argv[3] || process.env.CLAY_TABLE_ID;
const WORKSPACE_ID = '1070768';

if (!CLIENT_NAME) {
  console.error(`
Usage: node scripts/clay-duplicate-table.cjs <clientName> [sourceTableId]

Exemple:
  node scripts/clay-duplicate-table.cjs "DigitestLab"
  node scripts/clay-duplicate-table.cjs "Acme Corp" t_0tcct108yw3VAt3NPhn
`);
  process.exit(1);
}

if (!SOURCE_TABLE) {
  console.error('ERREUR: CLAY_TABLE_ID requis');
  process.exit(1);
}

async function main() {
  console.log(`\n=== Clay Table Duplicator ===`);
  console.log(`Client: ${CLIENT_NAME}`);
  console.log(`Source: ${SOURCE_TABLE}\n`);

  // 1. Lire la table source
  const resp = await clayRequest('GET', `/v3/tables/${SOURCE_TABLE}`);
  const table = resp.table || resp;
  const fields = table.fields || [];

  console.log(`Table source: "${table.name}" — ${fields.length} champs`);

  // Catégoriser les champs
  const inputFields = fields.filter(f => f.type === 'text' || f.type === 'date');
  const actionFields = fields.filter(f => f.type === 'action');
  const formulaFields = fields.filter(f => f.type === 'formula');
  const sourceFields = fields.filter(f => f.type === 'source');

  console.log(`  Input: ${inputFields.length} | Actions: ${actionFields.length} | Formules: ${formulaFields.length} | Sources: ${sourceFields.length}`);

  // 2. Créer la table
  const tableName = `${CLIENT_NAME} — Leads iFIND`;
  let newTableId;

  try {
    const r = await clayRequest('POST', '/v3/tables', {
      name: tableName,
      workspaceId: parseInt(WORKSPACE_ID),
      type: table.type || 'people'
    });
    newTableId = (r.table || r).id || r.tableId;
    console.log(`\n✓ Table créée: ${newTableId}`);
  } catch (e) {
    console.error(`\n✗ Création table échouée: ${e.message}`);
    console.log('\nAlternative: crée la table dans l\'UI Clay et relance avec son ID.');
    console.log('Ou utilise le bouton "Duplicate" dans le menu ··· de la table source.');
    process.exit(1);
  }

  // 3. Dupliquer les champs (ordre: input → action → formula)
  console.log('\nDuplication des champs...');
  const oldToNewId = {};
  let created = 0;
  let errors = 0;

  // 3a. Input fields (texte, date — sauf système)
  for (const f of inputFields) {
    if (f.id === 'f_created_at' || f.id === 'f_updated_at') continue;
    try {
      const r = await clayRequest('POST', `/v3/tables/${newTableId}/fields`, {
        name: f.name,
        type: f.type,
        typeSettings: f.typeSettings || {}
      });
      const newField = r.field || r;
      oldToNewId[f.id] = newField.id;
      console.log(`  ✓ ${f.name} (${f.type})`);
      created++;
    } catch (e) {
      console.error(`  ✗ ${f.name}: ${e.message.slice(0, 80)}`);
      errors++;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // 3b. Action fields (enrichments)
  for (const f of actionFields) {
    try {
      const body = {
        name: f.name,
        type: 'action',
        typeSettings: f.typeSettings || {}
      };
      if (f.groupId) body.groupId = f.groupId;

      const r = await clayRequest('POST', `/v3/tables/${newTableId}/fields`, body);
      const newField = r.field || r;
      oldToNewId[f.id] = newField.id;
      console.log(`  ✓ ${f.name} (action)`);
      created++;
    } catch (e) {
      console.error(`  ✗ ${f.name}: ${e.message.slice(0, 80)}`);
      errors++;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // 3c. Formula fields — remap les IDs
  for (const f of formulaFields) {
    if (f.id === 'f_created_at' || f.id === 'f_updated_at') continue;
    if (f.typeSettings?.formulaType === 'waterfall') {
      console.log(`  → ${f.name} (waterfall merge) — créé auto avec le waterfall`);
      continue;
    }

    try {
      let formulaText = f.typeSettings?.formulaText || '';
      for (const [oldId, newId] of Object.entries(oldToNewId)) {
        formulaText = formulaText.replace(new RegExp(oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newId);
      }

      const body = {
        name: f.name,
        type: 'formula',
        typeSettings: {
          dataTypeSettings: f.typeSettings?.dataTypeSettings || { type: 'text' },
          formulaType: 'text',
          formulaText: formulaText
        }
      };

      if (f.isExtractedField && f.extractedField) {
        body.isExtractedField = true;
        body.extractedField = {
          fieldIdExtractedFrom: oldToNewId[f.extractedField.fieldIdExtractedFrom] || f.extractedField.fieldIdExtractedFrom,
          extractedKeyPath: f.extractedField.extractedKeyPath
        };
      }

      const r = await clayRequest('POST', `/v3/tables/${newTableId}/fields`, body);
      const newField = r.field || r;
      oldToNewId[f.id] = newField.id;
      console.log(`  ✓ ${f.name} (formula)`);
      created++;
    } catch (e) {
      console.error(`  ✗ ${f.name}: ${e.message.slice(0, 80)}`);
      errors++;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // 4. Résumé
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  TABLE DUPLIQUÉE`);
  console.log(`${'='.repeat(50)}`);
  console.log(`  Nom: ${tableName}`);
  console.log(`  ID: ${newTableId}`);
  console.log(`  Champs: ${created} créés, ${errors} erreurs`);

  const slug = CLIENT_NAME.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  console.log(`\n  .env:`);
  console.log(`  CLAY_TABLE_ID_${slug}=${newTableId}`);

  console.log(`\n⚠️  ACTIONS MANUELLES:`);
  console.log(`  1. UI Clay → table "${tableName}" → "Run" sur chaque champ action`);
  console.log(`  2. Vérifier les auth accounts (Anthropic, PredictLeads, Crunchbase)`);
  console.log(`  3. Configurer le champ "Push to iFIND Bot" si nécessaire`);
  console.log(`  4. Importer les leads (CSV ou Sales Nav)`);
}

main().catch(e => {
  console.error('Erreur fatale:', e.message);
  process.exit(1);
});
