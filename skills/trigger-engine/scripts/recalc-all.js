// Recalcule tous les patterns depuis zéro : purge patterns_matched + reset processed_at + run processor

'use strict';

const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.TRIGGER_ENGINE_DB || '/app/skills/trigger-engine/data/trigger-engine.db';
const db = new DatabaseSync(DB_PATH);

const before = {
  events: db.prepare('SELECT COUNT(*) as n FROM events').get().n,
  companies: db.prepare('SELECT COUNT(*) as n FROM companies').get().n,
  matches: db.prepare('SELECT COUNT(*) as n FROM patterns_matched').get().n
};
console.log('Before:', before);

db.exec('BEGIN');
db.exec('DELETE FROM patterns_matched');
db.exec('UPDATE events SET processed_at = NULL');
db.exec('COMMIT');
console.log('Reset: patterns_matched cleared, processed_at nullified');
db.close();

// Reload processor
const path = require('path');
process.chdir('/app/skills/trigger-engine');
const { TriggerEngineStorage } = require('/app/skills/trigger-engine/storage');
const { TriggerEngineProcessor } = require('/app/skills/trigger-engine/processor');

const storage = new TriggerEngineStorage(DB_PATH);
const proc = new TriggerEngineProcessor(storage, { log: console });

const stats = proc.processUnprocessed(20000);
console.log('Stats:', stats);

const db2 = new DatabaseSync(DB_PATH);
const after = {
  events: db2.prepare('SELECT COUNT(*) as n FROM events').get().n,
  companies: db2.prepare('SELECT COUNT(*) as n FROM companies').get().n,
  matches: db2.prepare('SELECT COUNT(*) as n FROM patterns_matched').get().n
};
console.log('After:', after);

console.log('\nTop 20 matches:');
console.table(db2.prepare(`
  SELECT c.raison_sociale, pm.siren, pm.pattern_id, pm.score, c.naf_code, c.departement
  FROM patterns_matched pm
  LEFT JOIN companies c ON c.siren=pm.siren
  ORDER BY pm.score DESC, pm.matched_at DESC
  LIMIT 25
`).all());

console.log('\nMatches par pattern:');
console.table(db2.prepare('SELECT pattern_id, COUNT(*) as n FROM patterns_matched GROUP BY pattern_id ORDER BY n DESC').all());
db2.close();
