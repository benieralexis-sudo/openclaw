// Purge les companies/events/matches correspondant aux nouvelles règles blacklist
// (nom disqualifiant + NAF non-ICP). À lancer après extension de la blacklist.

'use strict';

const { DatabaseSync } = require('node:sqlite');
const { isBlacklisted } = require('../sources/francetravail');

const BLACKLISTED_NAF_PREFIXES = [
  '84.', '56.', '10.71', '10.72', '87.', '88.', '94.', '91.'
];
const isBlacklistedNaf = (naf) =>
  naf ? BLACKLISTED_NAF_PREFIXES.some(p => naf.startsWith(p)) : false;

const DB_PATH = process.env.TRIGGER_ENGINE_DB || '/app/skills/trigger-engine/data/trigger-engine.db';
const db = new DatabaseSync(DB_PATH);

const companies = db.prepare('SELECT siren, raison_sociale, naf_code FROM companies').all();

const toPurge = [];
for (const c of companies) {
  const byName = isBlacklisted(c.raison_sociale);
  const byNaf = isBlacklistedNaf(c.naf_code);
  if (byName || byNaf) {
    toPurge.push({ siren: c.siren, nom: c.raison_sociale, naf: c.naf_code, reason: byName ? 'name' : 'naf' });
  }
}

console.log(`Found ${toPurge.length} companies to purge (over ${companies.length} total)`);
if (toPurge.length > 0) console.table(toPurge.slice(0, 30));

const delMatch = db.prepare('DELETE FROM patterns_matched WHERE siren = ?');
const delEvt = db.prepare('DELETE FROM events WHERE siren = ?');
const delCmp = db.prepare('DELETE FROM companies WHERE siren = ?');

let totM = 0, totE = 0, totC = 0;
db.exec('BEGIN');
for (const p of toPurge) {
  totM += delMatch.run(p.siren).changes;
  totE += delEvt.run(p.siren).changes;
  totC += delCmp.run(p.siren).changes;
}
db.exec('COMMIT');

console.log(`Purged: ${totC} companies, ${totE} events, ${totM} matches`);
db.close();
