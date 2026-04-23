'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SEED_PATH = path.join(__dirname, 'clients-seed.json');

function normalizeName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function matchesICP(company, icp, patternId, score, patternMinScore) {
  if (!icp) return { ok: false, reason: 'no-icp' };

  const nafAllow = icp.naf_prefixes_allow || [];
  const nafBlock = icp.naf_prefixes_block || [];
  const naf = company?.naf_code || '';

  if (nafBlock.some(p => naf.startsWith(p))) return { ok: false, reason: 'naf-blocked' };
  if (nafAllow.length > 0 && naf && !nafAllow.some(p => naf.startsWith(p))) {
    return { ok: false, reason: 'naf-not-allowed' };
  }

  const deptAllow = icp.departements_allow || [];
  const deptBlock = icp.departements_block || [];
  const dept = company?.departement || '';
  if (deptBlock.includes(dept)) return { ok: false, reason: 'dept-blocked' };
  if (deptAllow.length > 0 && dept && !deptAllow.includes(dept)) {
    return { ok: false, reason: 'dept-not-allowed' };
  }

  if (icp.effectif_min != null && company?.effectif_max != null && company.effectif_max < icp.effectif_min) {
    return { ok: false, reason: 'effectif-too-small' };
  }
  if (icp.effectif_max != null && company?.effectif_min != null && company.effectif_min > icp.effectif_max) {
    return { ok: false, reason: 'effectif-too-large' };
  }

  const nameLower = normalizeName(company?.raison_sociale);
  const nameBlocks = (icp.keywords_name_block || []).map(normalizeName);
  if (nameBlocks.some(k => k && nameLower.includes(k))) {
    return { ok: false, reason: 'name-keyword-blocked' };
  }

  return { ok: true };
}

function boostScore(baseScore, company, icp) {
  let score = baseScore;
  const naf = company?.naf_code || '';
  if ((icp.naf_prefixes_allow || []).some(p => naf.startsWith(p))) score += 0.5;
  if (company?.effectif_min != null && icp.effectif_min != null && icp.effectif_max != null) {
    if (company.effectif_min >= icp.effectif_min && (company.effectif_max || company.effectif_min) <= icp.effectif_max) {
      score += 0.3;
    }
  }
  return Math.min(10, score);
}

function priorityFromScore(score) {
  if (score >= 8) return 'red';
  if (score >= 6.5) return 'orange';
  return 'yellow';
}

class ClientRouter {
  constructor(storage, options = {}) {
    this.storage = storage;
    this.log = options.log || console;
    this.db = storage.db;
  }

  loadSeed() {
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    const upsertStmt = this.db.prepare(`
      INSERT INTO clients (id, name, industry, icp, patterns, min_score, monthly_lead_cap, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        industry = excluded.industry,
        icp = excluded.icp,
        patterns = excluded.patterns,
        min_score = excluded.min_score,
        monthly_lead_cap = excluded.monthly_lead_cap,
        status = excluded.status
    `);
    for (const c of seed) {
      upsertStmt.run(
        c.id,
        c.name,
        c.industry || null,
        JSON.stringify(c.icp || {}),
        c.patterns ? JSON.stringify(c.patterns) : null,
        c.min_score ?? 7.0,
        c.monthly_lead_cap ?? 500,
        c.status || 'active'
      );
    }
    this.log.info?.(`[router] seeded ${seed.length} clients`);
    return seed.length;
  }

  getActiveClients() {
    return this.db.prepare("SELECT * FROM clients WHERE status = 'active'").all().map(c => ({
      ...c,
      icp: c.icp ? JSON.parse(c.icp) : {},
      patterns: c.patterns ? JSON.parse(c.patterns) : null
    }));
  }

  routeMatch(match, company) {
    const clients = this.getActiveClients();
    const routed = [];
    for (const client of clients) {
      if (client.patterns && !client.patterns.includes(match.pattern_id)) {
        continue;
      }
      const icpCheck = matchesICP(company, client.icp, match.pattern_id, match.score, client.min_score);
      if (!icpCheck.ok) continue;
      const boosted = boostScore(match.score, company, client.icp);
      if (boosted < client.min_score) continue;
      routed.push({ client, score: boosted, priority: priorityFromScore(boosted) });
    }
    return routed;
  }

  upsertClientLead(clientId, match, company, boostedScore, priority, contact = null) {
    const existing = this.db.prepare(
      'SELECT id, status FROM client_leads WHERE client_id = ? AND siren = ? AND pattern_matched_id = ?'
    ).get(clientId, match.siren, match.id);
    if (existing) {
      this.db.prepare(`
        UPDATE client_leads
        SET score = ?, priority = ?, decision_maker_email = COALESCE(?, decision_maker_email),
            decision_maker_name = COALESCE(?, decision_maker_name),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        boostedScore, priority,
        contact?.email || null,
        contact ? `${contact.prenom || ''} ${contact.nom || ''}`.trim() || null : null,
        existing.id
      );
      return { id: existing.id, created: false };
    }
    const result = this.db.prepare(`
      INSERT INTO client_leads (client_id, siren, pattern_matched_id, score, priority,
                                decision_maker_email, decision_maker_name, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'new')
    `).run(
      clientId, match.siren, match.id, boostedScore, priority,
      contact?.email || null,
      contact ? `${contact.prenom || ''} ${contact.nom || ''}`.trim() || null : null
    );
    return { id: result.lastInsertRowid, created: true };
  }

  routeAllActiveMatches() {
    const matches = this.db.prepare(`
      SELECT pm.*, c.raison_sociale, c.naf_code, c.departement,
             c.effectif_min, c.effectif_max
      FROM patterns_matched pm
      LEFT JOIN companies c ON c.siren = pm.siren
      WHERE pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP
    `).all();

    const stats = { clients: {}, total: 0, created: 0, updated: 0 };
    for (const m of matches) {
      const company = {
        raison_sociale: m.raison_sociale,
        naf_code: m.naf_code,
        departement: m.departement,
        effectif_min: m.effectif_min,
        effectif_max: m.effectif_max
      };
      const routed = this.routeMatch(m, company);
      for (const r of routed) {
        const contact = this.db.prepare(
          'SELECT prenom, nom, email FROM leads_contacts WHERE siren = ? AND email IS NOT NULL ORDER BY email_confidence DESC LIMIT 1'
        ).get(m.siren);
        const out = this.upsertClientLead(r.client.id, m, company, r.score, r.priority, contact);
        stats.total += 1;
        if (out.created) stats.created += 1; else stats.updated += 1;
        stats.clients[r.client.id] = (stats.clients[r.client.id] || 0) + 1;
      }
    }
    return stats;
  }
}

module.exports = { ClientRouter, matchesICP, boostScore, priorityFromScore };
