// ═══════════════════════════════════════════════════════════════════
// Dashboard API — Trigger Engine read-only endpoints
// ═══════════════════════════════════════════════════════════════════
// Uses Node 22 built-in `node:sqlite` (experimental but stable).
// Reads the .db file shared via Docker volume with telegram-router.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const fs = require('node:fs');
const path = require('node:path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.warn('[trigger-engine-api] node:sqlite not available, API disabled');
}

let pitchGenerator = null;
try {
  pitchGenerator = require('./trigger-engine-pitch.js');
} catch (e) {
  console.warn('[trigger-engine-api] pitch-generator not available:', e.message);
}

const DB_PATH = process.env.TRIGGER_ENGINE_DB
  || path.join('/app/skills/trigger-engine/data', 'trigger-engine.db');

let _db = null;

function getDb() {
  if (!DatabaseSync) return null;
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) return null;
  try {
    _db = new DatabaseSync(DB_PATH, { readOnly: true });
    _db.exec('PRAGMA busy_timeout = 2000;');
    return _db;
  } catch (e) {
    console.warn('[trigger-engine-api] open DB failed:', e.message);
    return null;
  }
}

function registerTriggerEngineRoutes(app, authMiddleware) {
  app.get('/api/trigger-engine/stats', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, reason: 'db-not-found' });

    try {
      const getCount = (sql, ...params) => db.prepare(sql).get(...params)?.n ?? 0;
      const stats = {
        enabled: true,
        companies: getCount('SELECT COUNT(*) as n FROM companies'),
        events_total: getCount('SELECT COUNT(*) as n FROM events'),
        events_attributed: getCount('SELECT COUNT(*) as n FROM events WHERE siren IS NOT NULL'),
        events_unprocessed: getCount('SELECT COUNT(*) as n FROM events WHERE processed_at IS NULL'),
        events_last_24h: getCount(`SELECT COUNT(*) as n FROM events WHERE captured_at >= datetime('now', '-1 day')`),
        patterns_total: getCount('SELECT COUNT(*) as n FROM patterns'),
        matches_active: getCount(`
          SELECT COUNT(*) as n FROM patterns_matched
          WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP
        `),
        matches_last_24h: getCount(`SELECT COUNT(*) as n FROM patterns_matched WHERE matched_at >= datetime('now', '-1 day')`),
        clients_active: getCount("SELECT COUNT(*) as n FROM clients WHERE status = 'active'"),
        leads_new: getCount("SELECT COUNT(*) as n FROM client_leads WHERE status = 'new'"),
        events_by_source: db.prepare(`
          SELECT source, COUNT(*) as n FROM events GROUP BY source ORDER BY n DESC
        `).all(),
        metrics_daily: db.prepare(`
          SELECT * FROM metrics_daily ORDER BY date DESC LIMIT 7
        `).all()
      };
      res.json(stats);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trigger-engine/events', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, events: [] });

    const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
    const source = req.query.source || null;

    try {
      const sql = `
        SELECT e.id, e.source, e.event_type, e.siren, e.attribution_confidence,
               e.event_date, e.captured_at, e.processed_at,
               c.raison_sociale, c.nom_complet
        FROM events e
        LEFT JOIN companies c ON c.siren = e.siren
        ${source ? 'WHERE source = ?' : ''}
        ORDER BY e.captured_at DESC
        LIMIT ?
      `;
      const params = source ? [source, limit] : [limit];
      const events = db.prepare(sql).all(...params);
      res.json({ enabled: true, events });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trigger-engine/matches', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, matches: [] });

    const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
    const minScore = parseFloat(req.query.min_score || '0');

    try {
      const matches = db.prepare(`
        SELECT pm.id, pm.siren, pm.pattern_id, pm.score, pm.signals,
               pm.matched_at, pm.expires_at,
               p.name as pattern_name, p.pitch_angle,
               c.raison_sociale, c.nom_complet, c.naf_label, c.departement
        FROM patterns_matched pm
        LEFT JOIN patterns p ON p.id = pm.pattern_id
        LEFT JOIN companies c ON c.siren = pm.siren
        WHERE (pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP)
          AND pm.score >= ?
        ORDER BY pm.score DESC, pm.matched_at DESC
        LIMIT ?
      `).all(minScore, limit);

      for (const m of matches) {
        try { m.signals = JSON.parse(m.signals || '[]'); } catch (e) { m.signals = []; }
      }
      res.json({ enabled: true, matches });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trigger-engine/patterns', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, patterns: [] });

    try {
      const patterns = db.prepare('SELECT * FROM patterns WHERE enabled = 1').all();
      for (const p of patterns) {
        try { p.verticaux = JSON.parse(p.verticaux || '[]'); } catch (e) { p.verticaux = []; }
        try { p.definition = JSON.parse(p.definition || '{}'); } catch (e) { p.definition = {}; }
      }
      res.json({ enabled: true, patterns });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ───── LEADS JSON : matches enrichis avec ICP + pitch email ─────
  app.get('/api/trigger-engine/leads', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, leads: [] });

    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const minScore = parseFloat(req.query.min_score || '0');
    const patternId = req.query.pattern || null;
    const dept = req.query.dept || null;

    try {
      const filters = ['(pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP)', 'pm.score >= ?'];
      const params = [minScore];
      if (patternId) { filters.push('pm.pattern_id = ?'); params.push(patternId); }
      if (dept) { filters.push('c.departement = ?'); params.push(dept); }

      // UNIQUE(siren, pattern_id) garanti par migration 004 — plus besoin de GROUP BY
      const rows = db.prepare(`
        SELECT pm.id, pm.siren, pm.pattern_id, pm.score, pm.signals, pm.matched_at,
               p.name as pattern_name, p.pitch_angle, p.verticaux,
               c.raison_sociale, c.nom_complet, c.naf_code, c.naf_label,
               c.effectif_min, c.effectif_max, c.departement
        FROM patterns_matched pm
        LEFT JOIN patterns p ON p.id = pm.pattern_id
        LEFT JOIN companies c ON c.siren = pm.siren
        WHERE ${filters.join(' AND ')}
        ORDER BY pm.score DESC, pm.matched_at DESC
        LIMIT ?
      `).all(...params, limit);

      // Fetch contacts (dirigeants + emails) pour chaque SIREN matché
      const contactsBySiren = {};
      if (rows.length > 0) {
        const sirens = [...new Set(rows.map(r => r.siren))];
        const placeholders = sirens.map(() => '?').join(',');
        const contacts = db.prepare(`
          SELECT siren, prenom, nom, fonction, domain_web, email, email_source, email_confidence
          FROM leads_contacts
          WHERE siren IN (${placeholders})
          ORDER BY email_confidence DESC, fonction
        `).all(...sirens);
        for (const c of contacts) {
          if (!contactsBySiren[c.siren]) contactsBySiren[c.siren] = [];
          contactsBySiren[c.siren].push(c);
        }
      }

      const leads = rows.map(r => {
        r.contacts = contactsBySiren[r.siren] || [];
        try { r.signals = JSON.parse(r.signals || '[]'); } catch (e) { r.signals = []; }
        try { r.verticaux = JSON.parse(r.verticaux || '[]'); } catch (e) { r.verticaux = []; }
        const pitch = pitchGenerator ? pitchGenerator.generatePitch(r) : null;
        return {
          id: r.id,
          siren: r.siren,
          is_real_siren: !String(r.siren || '').startsWith('FT'),
          raison_sociale: r.raison_sociale,
          naf_code: r.naf_code,
          naf_label: r.naf_label,
          departement: r.departement,
          effectif: r.effectif_min || r.effectif_max,
          pattern_id: r.pattern_id,
          pattern_name: r.pattern_name,
          verticaux: r.verticaux,
          score: r.score,
          signals_count: (r.signals || []).length,
          matched_at: r.matched_at,
          contacts: r.contacts,
          pitch
        };
      });

      res.json({ enabled: true, total: leads.length, leads });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ───── LEADS CSV : export téléchargeable ─────
  app.get('/api/trigger-engine/leads.csv', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).send('Trigger Engine non initialisé');

    const minScore = parseFloat(req.query.min_score || '0');
    const patternId = req.query.pattern || null;

    try {
      const filters = ['(pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP)', 'pm.score >= ?'];
      const params = [minScore];
      if (patternId) { filters.push('pm.pattern_id = ?'); params.push(patternId); }

      const rows = db.prepare(`
        SELECT pm.siren, pm.pattern_id, pm.score, pm.matched_at,
               p.name as pattern_name, p.pitch_angle, p.verticaux,
               c.raison_sociale, c.naf_code, c.naf_label,
               c.effectif_min, c.departement
        FROM patterns_matched pm
        LEFT JOIN patterns p ON p.id = pm.pattern_id
        LEFT JOIN companies c ON c.siren = pm.siren
        WHERE ${filters.join(' AND ')}
        ORDER BY pm.score DESC, pm.matched_at DESC
        LIMIT 1000
      `).all(...params);

      const escape = (v) => {
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",;\n\r]/.test(s) ? `"${s}"` : s;
      };

      // Fetch contacts pour chaque SIREN
      const sirens = [...new Set(rows.map(r => r.siren))];
      const contactsBySiren = {};
      if (sirens.length > 0) {
        const ph = sirens.map(() => '?').join(',');
        const contacts = db.prepare(`
          SELECT siren, prenom, nom, fonction, domain_web, email, email_confidence
          FROM leads_contacts WHERE siren IN (${ph})
          ORDER BY email_confidence DESC
        `).all(...sirens);
        for (const c of contacts) {
          if (!contactsBySiren[c.siren]) contactsBySiren[c.siren] = [];
          contactsBySiren[c.siren].push(c);
        }
      }

      const header = ['SIREN', 'Nom entreprise', 'NAF', 'Libellé NAF', 'Département', 'Effectif', 'Pattern', 'Pattern ID', 'Score', 'Matched at', 'Dirigeant 1', 'Fonction 1', 'Email 1', 'Confidence 1', 'Dirigeant 2', 'Fonction 2', 'Email 2', 'Email objet', 'Email corps'].join(';');
      const lines = [header];

      for (const r of rows) {
        try { r.verticaux = JSON.parse(r.verticaux || '[]'); } catch (e) { r.verticaux = []; }
        const pitch = pitchGenerator ? pitchGenerator.generatePitch(r) : { subject: '', body: '' };
        const c = contactsBySiren[r.siren] || [];
        const d1 = c[0] || {};
        const d2 = c[1] || {};
        lines.push([
          r.siren,
          r.raison_sociale,
          r.naf_code,
          r.naf_label,
          r.departement,
          r.effectif_min,
          r.pattern_name,
          r.pattern_id,
          r.score != null ? r.score.toFixed(1) : '',
          r.matched_at,
          [d1.prenom, d1.nom].filter(Boolean).join(' '),
          d1.fonction || '',
          d1.email || '',
          d1.email_confidence != null ? d1.email_confidence.toFixed(2) : '',
          [d2.prenom, d2.nom].filter(Boolean).join(' '),
          d2.fonction || '',
          d2.email || '',
          pitch.subject,
          pitch.body
        ].map(escape).join(';'));
      }

      const csv = '﻿' + lines.join('\r\n'); // BOM + CRLF pour Excel FR
      const filename = `triggers-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      res.send(csv);
    } catch (e) {
      res.status(500).send('Error: ' + e.message);
    }
  });

  // ───── CLIENTS : liste des clients actifs + ICP ─────
  app.get('/api/trigger-engine/clients', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, clients: [] });
    try {
      const clients = db.prepare(`
        SELECT c.id, c.name, c.industry, c.min_score, c.monthly_lead_cap, c.status,
               (SELECT COUNT(*) FROM client_leads cl WHERE cl.client_id = c.id) as total_leads,
               (SELECT COUNT(*) FROM client_leads cl WHERE cl.client_id = c.id AND cl.status = 'new') as new_leads,
               (SELECT COUNT(*) FROM client_leads cl WHERE cl.client_id = c.id AND cl.created_at >= datetime('now', '-7 day')) as leads_last_7d
        FROM clients c
        WHERE c.status = 'active'
        ORDER BY c.name
      `).all();
      res.json({ enabled: true, clients });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ───── LEADS par client ─────
  app.get('/api/trigger-engine/clients/:clientId/leads', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, leads: [] });
    const clientId = req.params.clientId;
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const status = req.query.status || null;
    try {
      const filters = ['cl.client_id = ?'];
      const params = [clientId];
      if (status) { filters.push('cl.status = ?'); params.push(status); }
      const rows = db.prepare(`
        SELECT cl.id, cl.siren, cl.pattern_matched_id, cl.score, cl.priority,
               cl.decision_maker_name, cl.decision_maker_email, cl.status,
               cl.sent_at, cl.replied_at, cl.booked_at, cl.created_at,
               pm.pattern_id, pm.signals, pm.matched_at,
               p.name as pattern_name, p.pitch_angle, p.verticaux,
               c.raison_sociale, c.naf_code, c.naf_label,
               c.effectif_min, c.effectif_max, c.departement
        FROM client_leads cl
        LEFT JOIN patterns_matched pm ON pm.id = cl.pattern_matched_id
        LEFT JOIN patterns p ON p.id = pm.pattern_id
        LEFT JOIN companies c ON c.siren = cl.siren
        WHERE ${filters.join(' AND ')}
        ORDER BY cl.priority DESC, cl.score DESC, cl.created_at DESC
        LIMIT ?
      `).all(...params, limit);

      const sirens = [...new Set(rows.map(r => r.siren))];
      const contactsBySiren = {};
      if (sirens.length) {
        const ph = sirens.map(() => '?').join(',');
        const contacts = db.prepare(`
          SELECT siren, prenom, nom, fonction, domain_web, email, email_confidence, email_source
          FROM leads_contacts WHERE siren IN (${ph})
          ORDER BY email_confidence DESC
        `).all(...sirens);
        for (const c of contacts) {
          if (!contactsBySiren[c.siren]) contactsBySiren[c.siren] = [];
          contactsBySiren[c.siren].push(c);
        }
      }

      const leads = rows.map(r => {
        try { r.signals = JSON.parse(r.signals || '[]'); } catch (e) { r.signals = []; }
        try { r.verticaux = JSON.parse(r.verticaux || '[]'); } catch (e) { r.verticaux = []; }
        r.contacts = contactsBySiren[r.siren] || [];
        const pitch = pitchGenerator ? pitchGenerator.generatePitch(r) : null;
        return {
          id: r.id,
          siren: r.siren,
          is_real_siren: !String(r.siren || '').startsWith('FT') && !String(r.siren || '').startsWith('ASS'),
          raison_sociale: r.raison_sociale,
          naf_code: r.naf_code,
          naf_label: r.naf_label,
          departement: r.departement,
          effectif: r.effectif_min || r.effectif_max,
          pattern_id: r.pattern_id,
          pattern_name: r.pattern_name,
          score: r.score,
          priority: r.priority,
          status: r.status,
          decision_maker_name: r.decision_maker_name,
          decision_maker_email: r.decision_maker_email,
          sent_at: r.sent_at,
          replied_at: r.replied_at,
          booked_at: r.booked_at,
          matched_at: r.matched_at,
          created_at: r.created_at,
          contacts: r.contacts,
          pitch
        };
      });
      res.json({ enabled: true, client_id: clientId, total: leads.length, leads });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trigger-engine/clients/:clientId/leads.csv', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).send('Trigger Engine non initialisé');
    const clientId = req.params.clientId;
    try {
      const rows = db.prepare(`
        SELECT cl.siren, cl.score, cl.priority, cl.status,
               cl.decision_maker_name, cl.decision_maker_email,
               pm.pattern_id, p.name as pattern_name, p.pitch_angle, p.verticaux,
               c.raison_sociale, c.naf_code, c.naf_label, c.effectif_min, c.departement,
               cl.created_at
        FROM client_leads cl
        LEFT JOIN patterns_matched pm ON pm.id = cl.pattern_matched_id
        LEFT JOIN patterns p ON p.id = pm.pattern_id
        LEFT JOIN companies c ON c.siren = cl.siren
        WHERE cl.client_id = ?
        ORDER BY cl.priority DESC, cl.score DESC
        LIMIT 2000
      `).all(clientId);

      const sirens = [...new Set(rows.map(r => r.siren))];
      const contactsBySiren = {};
      if (sirens.length) {
        const ph = sirens.map(() => '?').join(',');
        const contacts = db.prepare(`
          SELECT siren, prenom, nom, fonction, email, email_confidence
          FROM leads_contacts WHERE siren IN (${ph})
          ORDER BY email_confidence DESC
        `).all(...sirens);
        for (const c of contacts) {
          if (!contactsBySiren[c.siren]) contactsBySiren[c.siren] = [];
          contactsBySiren[c.siren].push(c);
        }
      }

      const escape = (v) => {
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",;\n\r]/.test(s) ? `"${s}"` : s;
      };

      const header = ['SIREN', 'Nom', 'NAF', 'Libellé NAF', 'Dépt', 'Effectif', 'Pattern', 'Score', 'Priorité', 'Statut', 'Dirigeant', 'Email', 'Confidence', 'Email objet', 'Email corps', 'Créé le'].join(';');
      const lines = [header];
      for (const r of rows) {
        try { r.verticaux = JSON.parse(r.verticaux || '[]'); } catch (e) { r.verticaux = []; }
        const pitch = pitchGenerator ? pitchGenerator.generatePitch(r) : { subject: '', body: '' };
        const c = (contactsBySiren[r.siren] || [])[0] || {};
        lines.push([
          r.siren, r.raison_sociale, r.naf_code, r.naf_label, r.departement,
          r.effectif_min, r.pattern_name, r.score != null ? r.score.toFixed(1) : '',
          r.priority, r.status,
          [c.prenom, c.nom].filter(Boolean).join(' '),
          r.decision_maker_email || c.email || '',
          c.email_confidence != null ? c.email_confidence.toFixed(2) : '',
          pitch.subject, pitch.body, r.created_at
        ].map(escape).join(';'));
      }

      const csv = '﻿' + lines.join('\r\n');
      const filename = `leads-${clientId}-${new Date().toISOString().slice(0, 10)}.csv`;
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` });
      res.send(csv);
    } catch (e) {
      res.status(500).send('Error: ' + e.message);
    }
  });

  app.get('/api/trigger-engine/ingestion-state', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false, sources: [] });

    try {
      const sources = db.prepare('SELECT * FROM ingestion_state ORDER BY source').all();
      res.json({ enabled: true, sources });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ───── Claude Brain — controls pause (admin only) ─────
  app.get('/api/trigger-engine/controls', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'db-not-found' });
    try {
      const clients = db.prepare(`
        SELECT id, name, status, claude_brain_config FROM clients ORDER BY id
      `).all();
      const parsed = clients.map(c => {
        let cfg = {};
        try { cfg = c.claude_brain_config ? JSON.parse(c.claude_brain_config) : {}; } catch {}
        return {
          client_id: c.id,
          name: c.name,
          status: c.status,
          claude_brain_enabled: cfg.enabled !== false,
          auto_send_enabled: cfg.auto_send_enabled === true,
          auto_send_threshold_opus: cfg.auto_send_threshold_opus ?? 8.5,
          auto_send_threshold_email_confidence: cfg.auto_send_threshold_email_confidence ?? 0.85,
          paused_at: cfg.paused_at || null,
          paused_reason: cfg.paused_reason || null,
          paused_patterns: cfg.paused_patterns || [],
          paused_mailboxes: cfg.paused_mailboxes || []
        };
      });
      res.json({ enabled: true, tenants: parsed });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Toggle pause/resume par tenant, pattern, mailbox (admin only)
  app.post('/api/trigger-engine/controls/:tenantId', authMiddleware, (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    const tenantId = req.params.tenantId;
    const patch = req.body || {};
    try {
      const { DatabaseSync: RW } = require('node:sqlite');
      const rwDb = new RW(DB_PATH, { readOnly: false });
      rwDb.exec('PRAGMA busy_timeout = 3000;');
      const row = rwDb.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get(tenantId);
      if (!row) { rwDb.close(); return res.status(404).json({ error: 'tenant-not-found' }); }
      let cfg = {};
      try { cfg = row.claude_brain_config ? JSON.parse(row.claude_brain_config) : {}; } catch {}

      const ALLOWED_KEYS = [
        'enabled', 'auto_send_enabled',
        'auto_send_threshold_opus', 'auto_send_threshold_email_confidence',
        'paused_patterns', 'paused_mailboxes',
        'monthly_budget_eur', 'hard_cap_eur',
        'voice_template', 'pitch_language', 'pipelines'
      ];
      for (const k of Object.keys(patch)) {
        if (ALLOWED_KEYS.includes(k)) cfg[k] = patch[k];
      }
      // Reset paused_at / paused_reason si on réactive
      if (patch.enabled === true) {
        delete cfg.paused_at;
        delete cfg.paused_reason;
      } else if (patch.enabled === false) {
        cfg.paused_at = new Date().toISOString();
        cfg.paused_reason = patch.paused_reason || 'manual pause';
      }

      rwDb.prepare('UPDATE clients SET claude_brain_config = ? WHERE id = ?')
        .run(JSON.stringify(cfg), tenantId);
      rwDb.close();
      res.json({ ok: true, config: cfg });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ───── Claude Brain — file "à valider" (leads orange avec pitch prêt) ─────
  app.get('/api/trigger-engine/to-validate', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'db-not-found' });
    try {
      const clientFilter = req.query.clientId;
      const filters = [
        "cl.status IN ('new', 'qualifying')",
        "cl.opus_score >= 6.0",
        "cl.opus_score < 8.0",
        // lead doit avoir au moins un pitch généré
        "EXISTS (SELECT 1 FROM claude_brain_results cbr WHERE cbr.tenant_id = cl.client_id AND cbr.siren = cl.siren AND cbr.pipeline = 'pitch')"
      ];
      const params = [];
      if (clientFilter) { filters.push('cl.client_id = ?'); params.push(clientFilter); }

      // Scope commercial
      if (req.user?.role === 'commercial') {
        const scope = Array.isArray(req.user.scopeClients) ? req.user.scopeClients : [];
        if (scope.length === 0) return res.json({ enabled: true, total: 0, leads: [] });
        const placeholders = scope.map(() => '?').join(',');
        filters.push(`cl.client_id IN (${placeholders})`);
        params.push(...scope);
      }

      const rows = db.prepare(`
        SELECT cl.id, cl.client_id, cl.siren, cl.opus_score, cl.opus_qualified_at,
               cl.priority, cl.status, c.raison_sociale, c.naf_code, c.departement,
               (SELECT MAX(created_at) FROM claude_brain_results cbr
                WHERE cbr.tenant_id = cl.client_id AND cbr.siren = cl.siren AND cbr.pipeline = 'pitch') as last_pitch_at
        FROM client_leads cl
        LEFT JOIN companies c ON c.siren = cl.siren
        WHERE ${filters.join(' AND ')}
        ORDER BY cl.opus_score DESC, last_pitch_at DESC
        LIMIT 100
      `).all(...params);
      res.json({ enabled: true, total: rows.length, leads: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Actions valider / skip sur lead
  app.post('/api/trigger-engine/leads/:leadId/action', authMiddleware, (req, res) => {
    const leadId = req.params.leadId;
    const action = req.body?.action;
    if (!['validate', 'skip', 'sent', 'booked'].includes(action)) {
      return res.status(400).json({ error: 'action doit être validate|skip|sent|booked' });
    }
    try {
      const { DatabaseSync: RW } = require('node:sqlite');
      const rwDb = new RW(DB_PATH, { readOnly: false });
      rwDb.exec('PRAGMA busy_timeout = 3000;');
      const lead = rwDb.prepare('SELECT client_id FROM client_leads WHERE id = ?').get(leadId);
      if (!lead) { rwDb.close(); return res.status(404).json({ error: 'lead-not-found' }); }
      if (req.user?.role === 'commercial') {
        const scope = Array.isArray(req.user.scopeClients) ? req.user.scopeClients : [];
        if (!scope.includes(lead.client_id)) { rwDb.close(); return res.status(403).json({ error: 'hors scope' }); }
      }
      const statusMap = { validate: 'sent', skip: 'discarded', sent: 'sent', booked: 'booked' };
      const newStatus = statusMap[action];
      const tsCol = action === 'booked' ? 'booked_at' : (action === 'sent' || action === 'validate' ? 'sent_at' : null);
      const sql = tsCol
        ? `UPDATE client_leads SET status = ?, ${tsCol} = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        : `UPDATE client_leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      rwDb.prepare(sql).run(newStatus, leadId);
      rwDb.close();
      res.json({ ok: true, status: newStatus });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ───── Claude Brain — génération brief RDV on-demand ─────
  app.post('/api/trigger-engine/leads/:leadId/brief/generate', authMiddleware, async (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'db-not-found' });
    const leadId = req.params.leadId;
    try {
      const { DatabaseSync: RW } = require('node:sqlite');
      const rwDb = new RW(DB_PATH, { readOnly: false });
      rwDb.exec('PRAGMA busy_timeout = 3000;');

      const lead = rwDb.prepare('SELECT id, client_id, siren FROM client_leads WHERE id = ?').get(leadId);
      if (!lead) { rwDb.close(); return res.status(404).json({ error: 'lead-not-found' }); }
      if (req.user?.role === 'commercial') {
        const scope = Array.isArray(req.user.scopeClients) ? req.user.scopeClients : [];
        if (!scope.includes(lead.client_id)) { rwDb.close(); return res.status(403).json({ error: 'hors scope' }); }
      }
      const tRow = rwDb.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get(lead.client_id);
      let cfg = {};
      try { cfg = tRow?.claude_brain_config ? JSON.parse(tRow.claude_brain_config) : {}; } catch {}
      if (cfg.enabled === false || (cfg.pipelines && !cfg.pipelines.includes('brief'))) {
        rwDb.close();
        return res.status(409).json({ error: 'pipeline brief désactivé pour ce tenant' });
      }

      const version = Date.now();
      const crypto = require('node:crypto');
      const payload = JSON.stringify({ user: req.user?.username, ts: version });
      const idempotencyKey = crypto.createHash('sha256')
        .update(`${lead.client_id}|brief|${lead.siren}|${payload}`)
        .digest('hex').slice(0, 32);

      const inserted = rwDb.prepare(`
        INSERT INTO claude_brain_queue
          (tenant_id, pipeline, siren, payload, idempotency_key, priority, max_retries, status, scheduled_at)
        VALUES (?, 'brief', ?, ?, ?, 2, 2, 'pending', CURRENT_TIMESTAMP)
      `).run(lead.client_id, lead.siren, payload, idempotencyKey);
      const jobId = inserted.lastInsertRowid;
      rwDb.close();

      const timeoutMs = 90_000; // brief prend plus de temps (6000 tokens output)
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const job = db.prepare('SELECT status, error FROM claude_brain_queue WHERE id = ?').get(jobId);
        if (!job) break;
        if (job.status === 'completed') {
          const r = db.prepare(`
            SELECT id, version, result_json, model, tokens_input, tokens_output, tokens_cached,
                   cost_eur, latency_ms, created_at
            FROM claude_brain_results WHERE job_id = ? ORDER BY version DESC LIMIT 1
          `).get(jobId);
          return res.json({
            status: 'completed',
            brief_markdown: r?.result_json || '',
            meta: r ? {
              result_id: r.id, version: r.version, model: r.model,
              tokens_input: r.tokens_input, tokens_output: r.tokens_output,
              tokens_cached: r.tokens_cached, cost_eur: r.cost_eur,
              latency_ms: r.latency_ms, created_at: r.created_at
            } : null
          });
        }
        if (job.status === 'dead') {
          return res.status(502).json({ status: 'dead', error: job.error });
        }
        await new Promise(r => setTimeout(r, 1500));
      }
      return res.status(504).json({ status: 'timeout', job_id: jobId });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trigger-engine/leads/:leadId/brief', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'db-not-found' });
    try {
      const lead = db.prepare('SELECT client_id, siren FROM client_leads WHERE id = ?').get(req.params.leadId);
      if (!lead) return res.status(404).json({ error: 'lead-not-found' });
      if (req.user?.role === 'commercial') {
        const scope = Array.isArray(req.user.scopeClients) ? req.user.scopeClients : [];
        if (!scope.includes(lead.client_id)) return res.status(403).json({ error: 'hors scope' });
      }
      const r = db.prepare(`
        SELECT id, version, result_json, cost_eur, latency_ms, created_at
        FROM claude_brain_results
        WHERE tenant_id = ? AND siren = ? AND pipeline = 'brief'
        ORDER BY version DESC LIMIT 1
      `).get(lead.client_id, lead.siren);
      if (!r) return res.json({ enabled: true, brief: null });
      // Download mode si ?format=md
      if (req.query.format === 'md') {
        const filename = `brief-${lead.siren}-${new Date().toISOString().slice(0,10)}.md`;
        res.set({
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        });
        return res.send(r.result_json);
      }
      res.json({
        enabled: true,
        brief_markdown: r.result_json,
        meta: { version: r.version, cost_eur: r.cost_eur, latency_ms: r.latency_ms, created_at: r.created_at }
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ───── Claude Brain — génération pitch on-demand ─────
  // NB : le dashboard n'a pas le module ClaudeBrain en mémoire (container séparé).
  // On enqueue directement en DB, le worker du telegram-router consomme, on poll le résultat.
  app.post('/api/trigger-engine/leads/:leadId/pitch/generate', authMiddleware, async (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'db-not-found' });
    const leadId = req.params.leadId;

    try {
      // Le dashboard ouvre la DB en readOnly — on ouvre un handle write via un require dynamique
      const { DatabaseSync: RW } = require('node:sqlite');
      const rwDb = new RW(DB_PATH, { readOnly: false });
      rwDb.exec('PRAGMA busy_timeout = 3000;');

      const lead = rwDb.prepare(`
        SELECT cl.id, cl.client_id, cl.siren, cl.opus_score
        FROM client_leads cl WHERE cl.id = ?
      `).get(leadId);
      if (!lead) { rwDb.close(); return res.status(404).json({ error: 'lead-not-found' }); }

      if (req.user?.role === 'commercial') {
        const scope = Array.isArray(req.user.scopeClients) ? req.user.scopeClients : [];
        if (!scope.includes(lead.client_id)) {
          rwDb.close();
          return res.status(403).json({ error: 'Ce lead n\'est pas dans votre périmètre' });
        }
      }

      // Tenant config : pipeline pitch activé ?
      const tRow = rwDb.prepare('SELECT claude_brain_config FROM clients WHERE id = ?').get(lead.client_id);
      let cfg = {};
      try { cfg = tRow?.claude_brain_config ? JSON.parse(tRow.claude_brain_config) : {}; } catch {}
      if (cfg.enabled === false || (cfg.pipelines && !cfg.pipelines.includes('pitch'))) {
        rwDb.close();
        return res.status(409).json({ error: 'pipeline pitch désactivé pour ce tenant' });
      }

      // Version unique pour forcer un nouveau job (régénération)
      const version = Date.now();
      const crypto = require('node:crypto');
      const payload = JSON.stringify({ user: req.user?.username, ts: version });
      const idempotencyKey = crypto.createHash('sha256')
        .update(`${lead.client_id}|pitch|${lead.siren}|${payload}`)
        .digest('hex').slice(0, 32);

      const inserted = rwDb.prepare(`
        INSERT INTO claude_brain_queue
          (tenant_id, pipeline, siren, payload, idempotency_key, priority, max_retries, status, scheduled_at)
        VALUES (?, 'pitch', ?, ?, ?, 2, 3, 'pending', CURRENT_TIMESTAMP)
      `).run(lead.client_id, lead.siren, payload, idempotencyKey);
      const jobId = inserted.lastInsertRowid;
      rwDb.close();

      // Polling jusqu'à completion (timeout 45s)
      const timeoutMs = 45_000;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const job = db.prepare('SELECT status, error FROM claude_brain_queue WHERE id = ?').get(jobId);
        if (!job) break;
        if (job.status === 'completed') {
          const r = db.prepare(`
            SELECT id, version, result_json, model, tokens_input, tokens_output, tokens_cached,
                   cost_eur, latency_ms, created_at
            FROM claude_brain_results
            WHERE job_id = ? ORDER BY version DESC LIMIT 1
          `).get(jobId);
          if (!r) return res.json({ status: 'completed-no-result' });
          let parsed = null;
          try { parsed = JSON.parse(r.result_json); } catch { parsed = r.result_json; }
          return res.json({
            status: 'completed',
            pitch: parsed,
            meta: {
              result_id: r.id, version: r.version, model: r.model,
              tokens_input: r.tokens_input, tokens_output: r.tokens_output,
              tokens_cached: r.tokens_cached, cost_eur: r.cost_eur,
              latency_ms: r.latency_ms, created_at: r.created_at
            }
          });
        }
        if (job.status === 'dead') {
          return res.status(502).json({ status: 'dead', error: job.error });
        }
        await new Promise(r => setTimeout(r, 800));
      }
      return res.status(504).json({ status: 'timeout', job_id: jobId });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // Liste historique des pitchs pour un lead
  app.get('/api/trigger-engine/leads/:leadId/pitches', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'db-not-found' });
    try {
      const lead = db.prepare('SELECT client_id, siren FROM client_leads WHERE id = ?').get(req.params.leadId);
      if (!lead) return res.status(404).json({ error: 'lead-not-found' });
      if (req.user?.role === 'commercial') {
        const scope = Array.isArray(req.user.scopeClients) ? req.user.scopeClients : [];
        if (!scope.includes(lead.client_id)) return res.status(403).json({ error: 'hors scope' });
      }
      const rows = db.prepare(`
        SELECT id, version, result_json, model, cost_eur, latency_ms, created_at
        FROM claude_brain_results
        WHERE tenant_id = ? AND siren = ? AND pipeline = 'pitch'
        ORDER BY version DESC, created_at DESC
        LIMIT 20
      `).all(lead.client_id, lead.siren);
      const versions = rows.map(r => {
        let parsed = null; try { parsed = JSON.parse(r.result_json); } catch {}
        return { ...r, pitch: parsed };
      });
      res.json({ enabled: true, total: versions.length, versions });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ───── Claude Brain — qualification par lead ─────
  app.get('/api/trigger-engine/leads/:leadId/qualification', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'db-not-found' });
    const leadId = req.params.leadId;
    try {
      const lead = db.prepare(`
        SELECT cl.id, cl.client_id, cl.siren, cl.opus_score, cl.opus_qualified_at, cl.opus_result_id,
               c.raison_sociale
        FROM client_leads cl
        LEFT JOIN companies c ON c.siren = cl.siren
        WHERE cl.id = ?
      `).get(leadId);
      if (!lead) return res.status(404).json({ error: 'lead-not-found' });

      // Commercial : scope check
      if (req.user?.role === 'commercial') {
        const scope = Array.isArray(req.user.scopeClients) ? req.user.scopeClients : [];
        if (!scope.includes(lead.client_id)) {
          return res.status(403).json({ error: 'Ce lead n\'est pas dans votre périmètre' });
        }
      }

      const latestResult = db.prepare(`
        SELECT id, version, result_json, model, tokens_input, tokens_output, tokens_cached,
               cost_eur, latency_ms, created_at
        FROM claude_brain_results
        WHERE tenant_id = ? AND siren = ? AND pipeline = 'qualify'
        ORDER BY version DESC, created_at DESC LIMIT 1
      `).get(lead.client_id, lead.siren);

      let qualification = null;
      if (latestResult) {
        try { qualification = JSON.parse(latestResult.result_json); } catch {}
      }

      res.json({
        enabled: true,
        lead: {
          id: lead.id,
          client_id: lead.client_id,
          siren: lead.siren,
          raison_sociale: lead.raison_sociale,
          opus_score: lead.opus_score,
          opus_qualified_at: lead.opus_qualified_at
        },
        qualification,
        meta: latestResult ? {
          result_id: latestResult.id,
          version: latestResult.version,
          model: latestResult.model,
          tokens_input: latestResult.tokens_input,
          tokens_output: latestResult.tokens_output,
          tokens_cached: latestResult.tokens_cached,
          cost_eur: latestResult.cost_eur,
          latency_ms: latestResult.latency_ms,
          created_at: latestResult.created_at
        } : null
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trigger-engine/health', authMiddleware, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ enabled: false });
    const SOURCE_THRESHOLDS = { bodacc: 12, francetravail: 4, joafe: 18, 'rss-levees': 12, 'news-buzz': 18, 'google-trends': 30, 'meta-ad-library': 30, inpi: 30 };
    try {
      const sources = db.prepare(`
        SELECT source, last_run_at, events_last_run, errors_last_run, last_error, enabled,
               (julianday('now') - julianday(last_run_at)) * 24 as hours_since
        FROM ingestion_state ORDER BY source
      `).all();
      const health = sources.map(s => ({
        ...s,
        threshold_hours: SOURCE_THRESHOLDS[s.source] || 24,
        state: s.enabled === 0 ? 'disabled'
             : (s.hours_since == null || s.hours_since > (SOURCE_THRESHOLDS[s.source] || 24)) ? 'stale'
             : (s.errors_last_run > 0 && s.last_error) ? 'error'
             : 'ok'
      }));
      res.json({ enabled: true, sources: health });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerTriggerEngineRoutes, getDb };
