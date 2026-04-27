// ═══════════════════════════════════════════════════════════════════
// Postgres Sync — pousse les client_leads SQLite vers Postgres `Lead`
// ═══════════════════════════════════════════════════════════════════
// Le trigger-engine bot écrit dans SQLite (rapide, multi-tenant interne).
// Le dashboard-v2 lit dans Postgres `Lead` + `Trigger` (Prisma, multi-tenant ext).
// Ce module synchronise les leads qualifiés (score≥7, opus≥5) vers Postgres
// pour qu'ils soient visibles dans le dashboard client.
//
// Mapping client_id (SQLite) → clientId (Postgres) :
//   - 'digitestlab' → résolu dynamiquement via SELECT id FROM "Client" WHERE...
//   - 'fimmop'      → idem (mais désactivé pour l'instant, FIMMOP supprimé du dashboard)
//   - 'ifind'       → tenant interne, pas de sync (pas de client réel)
//
// Idempotent : utilise triggerId stable `te-{client}-{siren}-{pattern}`.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { Client } = require('pg');

const log = (() => {
  try { return require('../../../gateway/logger.js'); }
  catch { return console; }
})();

function getDashboardDbUrl() {
  return process.env.DASHBOARD_DATABASE_URL
      || process.env.IFIND_DATABASE_URL
      || process.env.DATABASE_URL_V2
      || 'postgresql://ifind:b7718738d59bc43b64810242d0f5d961fd3569229f1d94ff@127.0.0.1:5433/ifind';
}

// Mapping pattern_id → TriggerType Prisma enum
function patternToTriggerType(patternId) {
  if (!patternId) return 'OTHER';
  const p = patternId.toLowerCase();
  if (p.includes('exec') || p.includes('leadership') || p.includes('new-c-level')) return 'LEADERSHIP_CHANGE';
  if (p.includes('hiring') || p.includes('scaling') || p.includes('multi-role')) return 'HIRING_KEY';
  if (p.includes('funding') || p.includes('levee') || p.includes('raise')) return 'FUNDRAISING';
  if (p.includes('trademark') || p.includes('marque') || p.includes('inpi')) return 'TRADEMARK';
  if (p.includes('patent') || p.includes('brevet')) return 'PATENT';
  if (p.includes('ad-') || p.includes('campaign') || p.includes('meta')) return 'AD_CAMPAIGN';
  if (p.includes('expansion') || p.includes('new-company')) return 'EXPANSION';
  if (p.includes('regulatory') || p.includes('reglement')) return 'REGULATORY';
  return 'OTHER';
}

// Génère titre humain depuis pattern_id + signaux count
function buildTriggerTitle(patternId, signalsCount) {
  const titles = {
    'hiring-surge': `Recrutement massif (${signalsCount} offres typées en 30j)`,
    'multi-role-scaling': `Scaling multi-départements (${signalsCount} offres)`,
    'new-company-hiring': `Nouvelle entreprise + recrutement actif`,
    'new-exec-hire': `Recrutement C-level récent`,
    'sales-team-scaling': `Scaling équipe commerciale (${signalsCount} offres)`,
    'tech-team-scaling': `Scaling équipe tech (${signalsCount} offres)`,
    'funding-recent': `Levée de fonds récente`,
    'media-buzz': `Buzz média / actu entreprise`,
  };
  return titles[patternId] || `Signal ${patternId} (${signalsCount} événements)`;
}

// Mapping SQLite client_id → tenant config Postgres
async function resolveClientMapping(pg) {
  // Récupère tous les clients Postgres et map sur SQLite client_id par convention nom
  const { rows } = await pg.query(`SELECT id, name FROM "Client" WHERE "deletedAt" IS NULL`);
  const map = {};
  for (const r of rows) {
    const norm = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm.includes('digitest') || norm === 'digidemat') map.digitestlab = r.id;
    if (norm === 'fimmop') map.fimmop = r.id;
    if (norm.includes('ifind')) map.ifind = r.id;
  }
  return map;
}

// Génère un cuid-like (compatible Prisma @default(cuid()))
function genCuid() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 14);
  return `c${ts}${rand}`.slice(0, 25).padEnd(25, '0');
}

/**
 * Sync principal.
 * @param {Database} sqliteDb — instance better-sqlite3 / node:sqlite du trigger-engine
 * @param {Object} options
 * @param {number} options.minScore — défaut 7
 * @param {number} options.minOpus — défaut 5
 * @param {string[]} options.clientCodes — défaut ['digitestlab']
 */
async function syncToPostgres(sqliteDb, options = {}) {
  const minScore = options.minScore ?? 7;
  const minOpus = options.minOpus ?? 5;
  const clientCodes = options.clientCodes || ['digitestlab'];

  const pg = new Client({ connectionString: getDashboardDbUrl() });
  await pg.connect();

  let stats = { scanned: 0, skipped_quality: 0, upserted_triggers: 0, upserted_leads: 0, errors: 0 };

  try {
    const clientMap = await resolveClientMapping(pg);

    for (const code of clientCodes) {
      const pgClientId = clientMap[code];
      if (!pgClientId) {
        log.warn?.(`[postgres-sync] no Postgres Client for SQLite code='${code}', skipped`);
        continue;
      }

      // Lit les leads SQLite qualifiés (score+opus+taille) avec leurs métadonnées
      // Filtre taille : DTL = ICP 11-200p (rejet groupes type Saint-Gobain).
      const maxEffectif = (code === 'digitestlab') ? 200 : 5000;
      const rows = sqliteDb.prepare(`
        SELECT
          cl.siren,
          cl.score,
          cl.opus_score,
          cl.priority,
          cl.status,
          cl.created_at,
          cl.decision_maker_email,
          cl.decision_maker_name,
          cl.decision_maker_linkedin,
          c.raison_sociale,
          c.naf_code,
          c.naf_label,
          c.departement,
          c.region,
          c.effectif_min,
          c.effectif_max,
          pm.pattern_id,
          pm.signals,
          pm.matched_at
        FROM client_leads cl
        LEFT JOIN companies c ON c.siren = cl.siren
        LEFT JOIN patterns_matched pm ON pm.id = cl.pattern_matched_id
        WHERE cl.client_id = ?
          AND cl.score >= ?
          AND (cl.opus_score IS NULL OR cl.opus_score >= ?)
          AND (c.effectif_max IS NULL OR c.effectif_max <= ?)
      `).all(code, minScore, minOpus, maxEffectif);

      stats.scanned += rows.length;

      // Listes de neutralisation hors-ICP (collectivités, géants, conseil RH généraliste)
      const namePatternsBlock = [
        /agglomeration/i, /commune/i, /mairie/i, /conseil\s+(régional|departemental|général)/i,
        /saint-gobain/i, /bnp\s*paribas/i, /cnp\s+assurances/i, /total\s*energies/i,
        /carrefour/i, /orange\s*business/i, /sncf/i, /la\s+poste/i, /pole\s+emploi/i, /paritel/i,
        /les\s+recruteurs/i, /\bcimem\b/i, /^e\.?\s*leclerc/i, /tous\s+bénévoles/i,
        /jeveuxaider/i, /aerocontact/i, /jober\s+group/i, /alphéa\s+conseil/i,
      ];

      for (const r of rows) {
        try {
          // 1. SIRENE non résolu (raison_sociale absente OU SIREN non numérique type FT_xxx)
          if (!r.raison_sociale) {
            stats.skipped_quality += 1;
            continue;
          }
          if (typeof r.siren === 'string' && !/^\d+$/.test(r.siren)) {
            stats.skipped_quality += 1;
            continue;
          }
          // 2. Patterns de raison sociale hors ICP (collectivités, mastodontes connus)
          if (namePatternsBlock.some((re) => re.test(r.raison_sociale))) {
            stats.skipped_quality += 1;
            continue;
          }
          // 3. Volume événements anormal (>=20 = signal noyé, indique mauvaise attribution
          //    ou groupe géant — un vrai PME ICP DTL recrute typiquement 1-5 personnes/30j).
          let signalsCount = 0;
          try { signalsCount = JSON.parse(r.signals || '[]').length; } catch {}
          if (signalsCount >= 20) {
            stats.skipped_quality += 1;
            continue;
          }

          const triggerId = `te-${code}-${r.siren}-${r.pattern_id || 'p'}`.slice(0, 30);
          const triggerType = patternToTriggerType(r.pattern_id);
          const title = buildTriggerTitle(r.pattern_id, signalsCount);
          const score10 = Math.round(Math.min(10, Math.max(1, r.score || 5)));
          const isHot = score10 >= 9;
          const sizeStr = r.effectif_min || r.effectif_max
            ? `${r.effectif_min || 0}-${r.effectif_max || '?'}p`
            : null;

          // Récupère les 5 derniers signaux concrets (offres d'emploi, levées, etc)
          // pour enrichir le `detail` du Trigger côté commerciaux.
          let signalDetails = '';
          try {
            const sigIds = JSON.parse(r.signals || '[]');
            if (sigIds.length > 0) {
              const events = sqliteDb.prepare(
                `SELECT source, event_type, event_date, normalized FROM events
                 WHERE id IN (${sigIds.slice(0, 8).map(() => '?').join(',')})
                 ORDER BY event_date DESC LIMIT 5`
              ).all(...sigIds.slice(0, 8));
              const lines = events.map((e) => {
                let label = '';
                try {
                  const n = JSON.parse(e.normalized || '{}');
                  label = (n.job_title || n.title || n.intitule || n.objet || n.event_subtype || e.event_type).toString().slice(0, 80);
                } catch { label = e.event_type; }
                return `• ${e.event_date} — ${label}`;
              });
              if (lines.length > 0) signalDetails = `Signaux détectés :\n${lines.join('\n')}`;
            }
          } catch {}
          const opusLine = r.opus_score ? `Opus score: ${r.opus_score.toFixed(2)}/10` : null;
          const fullDetail = [signalDetails, opusLine].filter(Boolean).join('\n\n') || null;

          // UPSERT Trigger
          await pg.query(`
            INSERT INTO "Trigger" (
              id, "clientId", "sourceCode", "capturedAt", "publishedAt",
              "companyName", "companySiret", "companyNaf", "industry", "region", "size",
              type, title, detail, score, "scoreReason", "isHot", "isCombo",
              status, "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9, $10, $11,
              $12::"TriggerType", $13, $14, $15, $16, $17, false,
              'NEW'::"TriggerStatus", NOW(), NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              score = EXCLUDED.score,
              "scoreReason" = EXCLUDED."scoreReason",
              "isHot" = EXCLUDED."isHot",
              detail = EXCLUDED.detail,
              title = EXCLUDED.title,
              "updatedAt" = NOW()
          `, [
            triggerId, pgClientId, `trigger-engine.${r.pattern_id || 'unknown'}`,
            new Date(r.matched_at || r.created_at), null,
            r.raison_sociale, r.siren, r.naf_code, r.naf_label, r.region || r.departement, sizeStr,
            triggerType, title, fullDetail, score10, opusLine, isHot,
          ]);
          stats.upserted_triggers += 1;

          // UPSERT Lead — clé : triggerId (unique)
          // Si lead existe déjà sur ce trigger : update soft (status seul)
          const existing = await pg.query(`SELECT id FROM "Lead" WHERE "triggerId" = $1 LIMIT 1`, [triggerId]);
          if (existing.rows.length === 0) {
            const leadId = genCuid();
            await pg.query(`
              INSERT INTO "Lead" (
                id, "clientId", "triggerId",
                "fullName", email, "linkedinUrl",
                "companyName", "companySiret",
                status, "emailStatus", "createdAt", "updatedAt"
              ) VALUES (
                $1, $2, $3,
                $4, $5, $6,
                $7, $8,
                'NEW'::"LeadStatus", 'UNVERIFIED'::"EmailStatus", NOW(), NOW()
              )
            `, [
              leadId, pgClientId, triggerId,
              r.decision_maker_name || null,
              r.decision_maker_email || null,
              r.decision_maker_linkedin || null,
              r.raison_sociale, r.siren,
            ]);
            stats.upserted_leads += 1;
          }
        } catch (e) {
          stats.errors += 1;
          log.warn?.(`[postgres-sync] err siren=${r.siren} pattern=${r.pattern_id}: ${e.message}`);
        }
      }
    }
  } finally {
    await pg.end();
  }

  return stats;
}

module.exports = { syncToPostgres, patternToTriggerType };
