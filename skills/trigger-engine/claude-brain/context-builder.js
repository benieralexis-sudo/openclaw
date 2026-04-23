'use strict';

/**
 * Context Builder — assemble le contexte d'un lead pour un pipeline Opus.
 *
 * Sortie en 3 parties pour exploiter le prompt caching Anthropic :
 *   1. systemPrompt   : instructions stables (chargé depuis prompts/<pipeline>.md)   [CACHÉ]
 *   2. voicePrompt    : voice template du tenant (stable par tenant)                  [CACHÉ]
 *   3. dataContext    : données du lead (variable par appel)                          [NON CACHÉ]
 *
 * Anonymisation : les contacts sensibles (email) sont exposés à Opus mais NE DOIVENT PAS
 * apparaître dans les logs production (voir toString()).
 */

const fs = require('node:fs');
const path = require('node:path');

const PROMPTS_DIR = path.join(__dirname, 'prompts');

/**
 * Fenêtres temporelles par pipeline.
 * qualify  : 90 jours de signaux récents → décision tactique
 * pitch    : 60 jours → accroche contextuelle récente
 * brief    : 1825 jours (5 ans) → dossier complet avec historique long
 * discover : N/A (opère sur les leads agrégés)
 */
const PIPELINE_WINDOWS_DAYS = {
  qualify: 90,
  pitch: 60,
  brief: 1825,
  discover: 30
};

const PIPELINE_EVENT_LIMITS = {
  qualify: 50,
  pitch: 30,
  brief: 300,  // Brief exploite 1M context d'Opus 4.7
  discover: 0
};

const CONTACTS_LIMIT = 5;

// Budget caractères approximatif pour data context (évite blow-up).
// Opus 4.7 supporte 1M tokens mais on cap à ~200k caractères (≈50k tokens) pour coût raisonnable.
const MAX_DATA_CONTEXT_CHARS = 200_000;

class ContextBuilder {
  constructor(db, options = {}) {
    this.db = db;
    this.log = options.log || console;
    this._promptCache = new Map();
  }

  _loadPrompt(pipeline) {
    if (this._promptCache.has(pipeline)) return this._promptCache.get(pipeline);
    const file = path.join(PROMPTS_DIR, `${pipeline}.md`);
    if (!fs.existsSync(file)) throw new Error(`Prompt not found: ${pipeline}.md`);
    const content = fs.readFileSync(file, 'utf8');
    this._promptCache.set(pipeline, content);
    return content;
  }

  _getTenantConfig(tenantId) {
    const row = this.db.prepare('SELECT claude_brain_config, name, industry FROM clients WHERE id = ?').get(tenantId);
    if (!row) return null;
    let cfg = {};
    try { cfg = row.claude_brain_config ? JSON.parse(row.claude_brain_config) : {}; } catch {}
    return { ...cfg, _tenant_name: row.name, _tenant_industry: row.industry };
  }

  _getCompany(siren) {
    return this.db.prepare(`
      SELECT siren, raison_sociale, nom_complet, forme_juridique,
             naf_code, naf_label, effectif_min, effectif_max,
             departement, region, date_creation, date_cessation
      FROM companies WHERE siren = ?
    `).get(siren);
  }

  _getEvents(siren, windowDays = 90, limit = 200) {
    return this.db.prepare(`
      SELECT source, event_type, event_date, raw_data, normalized
      FROM events
      WHERE siren = ?
        AND event_date >= date('now', '-' || ? || ' days')
      ORDER BY event_date DESC
      LIMIT ?
    `).all(siren, String(windowDays), limit);
  }

  _getActiveMatches(siren) {
    return this.db.prepare(`
      SELECT pm.pattern_id, pm.score, pm.matched_at, p.name as pattern_name, p.pitch_angle
      FROM patterns_matched pm
      LEFT JOIN patterns p ON p.id = pm.pattern_id
      WHERE pm.siren = ?
        AND (pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP)
      ORDER BY pm.score DESC
    `).all(siren);
  }

  _getContacts(siren) {
    return this.db.prepare(`
      SELECT prenom, nom, fonction, email, email_confidence, domain_web
      FROM leads_contacts
      WHERE siren = ?
      ORDER BY email_confidence DESC
      LIMIT ?
    `).all(siren, CONTACTS_LIMIT);
  }

  /**
   * Build a full context for a given (tenantId, siren, pipeline).
   * Returns { systemPrompt, voicePrompt, dataContext, meta }.
   * meta contains siren, tenantId, event_count, contact_count for logs.
   */
  build(tenantId, siren, pipeline) {
    const systemPrompt = this._loadPrompt(pipeline);
    const tenant = this._getTenantConfig(tenantId);
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

    const voicePrompt = this._renderVoice(tenant);
    const dataContext = pipeline === 'discover'
      ? this._buildDiscoverContext(tenantId)
      : this._buildLeadContext(siren, pipeline);

    // Pour qualify/pitch/brief, joindre la qualification précédente si dispo (pipeline aval)
    if (['pitch', 'brief'].includes(pipeline) && dataContext && !dataContext.error) {
      const prevQualify = this.db.prepare(`
        SELECT result_json FROM claude_brain_results
        WHERE tenant_id = ? AND siren = ? AND pipeline = 'qualify'
        ORDER BY version DESC, created_at DESC LIMIT 1
      `).get(tenantId, siren);
      if (prevQualify) {
        try {
          dataContext.qualification = JSON.parse(prevQualify.result_json);
        } catch {}
      }
    }

    return {
      systemPrompt,
      voicePrompt,
      dataContext,
      meta: {
        tenantId,
        siren,
        pipeline,
        tenant_name: tenant._tenant_name,
        event_count: dataContext?.events_count || 0,
        contact_count: dataContext?.contacts_count || 0
      }
    };
  }

  _renderVoice(tenant) {
    const lines = [
      `Client cible : ${tenant._tenant_name || 'N/A'}`,
      tenant._tenant_industry ? `Secteur : ${tenant._tenant_industry}` : null,
      tenant.voice_template ? `Voice : ${tenant.voice_template}` : null,
      tenant.icp_nuance ? `ICP nuance : ${tenant.icp_nuance}` : null,
      tenant.pitch_language ? `Langage : utiliser "${tenant.pitch_language}" dans les emails` : null
    ].filter(Boolean);
    return lines.join('\n');
  }

  _buildLeadContext(siren, pipeline = 'qualify') {
    const company = this._getCompany(siren);
    if (!company) return { error: 'company-not-found', siren };
    const windowDays = PIPELINE_WINDOWS_DAYS[pipeline] || 90;
    const eventLimit = PIPELINE_EVENT_LIMITS[pipeline] || 50;
    const events = this._getEvents(siren, windowDays, eventLimit + 50);
    const matches = this._getActiveMatches(siren);
    const contacts = this._getContacts(siren);

    const eventsSummary = events.slice(0, eventLimit).map(e => {
      let norm = null;
      try { norm = e.normalized ? JSON.parse(e.normalized) : null; } catch {}
      const label = norm?.label || norm?.title || e.event_type;
      return `${e.event_date.slice(0, 10)} · ${e.source} · ${e.event_type}${label && label !== e.event_type ? ' — ' + String(label).slice(0, 120) : ''}`;
    }).join('\n');

    const matchesSummary = matches.map(m => `${m.pattern_id} (score ${m.score.toFixed(1)})`).join(', ');
    const contactsSummary = contacts.map(c =>
      `- ${c.prenom || '?'} ${c.nom || '?'} — ${c.fonction || '-'}${c.email ? ' — ' + c.email + ' (conf ' + (c.email_confidence || 0).toFixed(2) + ')' : ''}`
    ).join('\n');

    return {
      company: {
        siren: company.siren,
        raison_sociale: company.raison_sociale,
        naf: `${company.naf_code || '?'} ${company.naf_label || ''}`.trim(),
        effectif: company.effectif_min === company.effectif_max
          ? company.effectif_min
          : `${company.effectif_min || '?'}-${company.effectif_max || '?'}`,
        departement: company.departement || '?',
        date_creation: company.date_creation
      },
      events_count: events.length,
      events_summary: eventsSummary || '(aucun event récent)',
      active_matches: matchesSummary || '(aucun match actif)',
      contacts_count: contacts.length,
      contacts_summary: contactsSummary || '(aucun contact enrichi)',
      window_days: windowDays,
      pipeline
    };
  }

  _buildDiscoverContext(tenantId) {
    // Agrège :
    //   - 50 leads convertis (status='booked' ou 'replied_positive')
    //   - 50 leads ignorés (status='sent' avec pas de reply depuis >=14j)
    //   - 20 leads négatifs (status='replied_negative' ou 'discarded')
    //   - Liste des patterns actifs dans le catalogue
    const filter = tenantId ? 'AND cl.client_id = ?' : '';
    const params = tenantId ? [tenantId] : [];

    const convertis = this.db.prepare(`
      SELECT cl.siren, c.raison_sociale, c.naf_code, c.naf_label, c.effectif_min, cl.opus_score, cl.score, cl.priority,
             GROUP_CONCAT(pm.pattern_id, ',') as patterns
      FROM client_leads cl
      LEFT JOIN companies c ON c.siren = cl.siren
      LEFT JOIN patterns_matched pm ON pm.siren = cl.siren AND (pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP)
      WHERE cl.status IN ('booked', 'replied_positive', 'attended') ${filter}
      GROUP BY cl.id LIMIT 50
    `).all(...params);

    const ignores = this.db.prepare(`
      SELECT cl.siren, c.raison_sociale, c.naf_code, c.naf_label, cl.opus_score, cl.score,
             GROUP_CONCAT(pm.pattern_id, ',') as patterns
      FROM client_leads cl
      LEFT JOIN companies c ON c.siren = cl.siren
      LEFT JOIN patterns_matched pm ON pm.siren = cl.siren AND (pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP)
      WHERE cl.status = 'sent' AND cl.replied_at IS NULL
        AND cl.sent_at <= datetime('now', '-14 days') ${filter}
      GROUP BY cl.id LIMIT 50
    `).all(...params);

    const negatifs = this.db.prepare(`
      SELECT cl.siren, c.raison_sociale, c.naf_code, cl.opus_score, cl.score,
             GROUP_CONCAT(pm.pattern_id, ',') as patterns
      FROM client_leads cl
      LEFT JOIN companies c ON c.siren = cl.siren
      LEFT JOIN patterns_matched pm ON pm.siren = cl.siren AND (pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP)
      WHERE cl.status IN ('replied_negative', 'discarded') ${filter}
      GROUP BY cl.id LIMIT 20
    `).all(...params);

    const patterns = this.db.prepare(`SELECT id, name, description FROM patterns WHERE enabled = 1`).all();

    return {
      tenantId,
      summary: {
        convertis_count: convertis.length,
        ignores_count: ignores.length,
        negatifs_count: negatifs.length,
        patterns_active: patterns.length
      },
      convertis,
      ignores,
      negatifs,
      patterns_actuels: patterns
    };
  }

  /**
   * Sérialise dataContext en string pour Anthropic. Tronque à MAX_DATA_CONTEXT_CHARS.
   */
  renderDataContext(ctx) {
    if (!ctx || ctx.error) return `[contexte indisponible: ${ctx?.error || 'unknown'}]`;

    // Discover context (structure différente)
    if (ctx.summary && !ctx.company) {
      return this._renderDiscoverContext(ctx);
    }

    if (ctx.note && !ctx.company) return `[${ctx.note}]`;

    const parts = [
      '# Entreprise',
      `SIREN : ${ctx.company.siren}`,
      `Raison sociale : ${ctx.company.raison_sociale}`,
      `NAF : ${ctx.company.naf}`,
      `Effectif : ${ctx.company.effectif}`,
      `Département : ${ctx.company.departement}`,
      ctx.company.date_creation ? `Date création : ${ctx.company.date_creation}` : null,
      '',
      `# Patterns matchés`,
      ctx.active_matches,
      '',
      `# Events (${ctx.events_count} sur ${ctx.window_days || 90} jours)`,
      ctx.events_summary,
      '',
      `# Contacts connus (${ctx.contacts_count})`,
      ctx.contacts_summary
    ];

    // Injection qualification si pipeline aval (pitch/brief)
    if (ctx.qualification) {
      parts.push('');
      parts.push('# Qualification Opus précédente');
      parts.push(JSON.stringify(ctx.qualification, null, 2));
    }

    let rendered = parts.filter(l => l !== null).join('\n');
    if (rendered.length > MAX_DATA_CONTEXT_CHARS) {
      rendered = rendered.slice(0, MAX_DATA_CONTEXT_CHARS) + '\n\n[…tronqué à ' + MAX_DATA_CONTEXT_CHARS + ' chars]';
    }
    return rendered;
  }

  _renderDiscoverContext(ctx) {
    const fmtLead = l => {
      const patterns = l.patterns ? [...new Set(l.patterns.split(','))].join('+') : '-';
      const eff = l.effectif_min ?? '?';
      return `- ${l.raison_sociale || l.siren} | NAF ${l.naf_code || '?'} | eff ${eff} | opus ${l.opus_score ?? '?'} | patterns ${patterns}`;
    };
    const patternsList = ctx.patterns_actuels.map(p => `- ${p.id} : ${p.name}`).join('\n');
    const parts = [
      `# Résumé`,
      `Tenant analysé : ${ctx.tenantId || 'TOUS'}`,
      `Convertis : ${ctx.summary.convertis_count}, Ignorés : ${ctx.summary.ignores_count}, Négatifs : ${ctx.summary.negatifs_count}`,
      `Patterns actifs : ${ctx.summary.patterns_active}`,
      '',
      `# Patterns actifs dans le catalogue`,
      patternsList,
      '',
      `# Leads CONVERTIS (RDV booké / reply positif) — ${ctx.convertis.length}`,
      ctx.convertis.map(fmtLead).join('\n') || '(aucun)',
      '',
      `# Leads IGNORÉS (sent >14j sans reply) — ${ctx.ignores.length}`,
      ctx.ignores.map(fmtLead).join('\n') || '(aucun)',
      '',
      `# Leads NÉGATIFS (reply neg / discarded) — ${ctx.negatifs.length}`,
      ctx.negatifs.map(fmtLead).join('\n') || '(aucun)'
    ];
    let rendered = parts.join('\n');
    if (rendered.length > MAX_DATA_CONTEXT_CHARS) {
      rendered = rendered.slice(0, MAX_DATA_CONTEXT_CHARS) + '\n\n[…tronqué]';
    }
    return rendered;
  }

  /**
   * Version safe-for-logs du contexte (sans emails ni PII).
   */
  renderDataContextForLog(ctx) {
    if (!ctx || ctx.error) return `[err: ${ctx?.error || 'unknown'}]`;
    return `siren=${ctx.company?.siren} events=${ctx.events_count} contacts=${ctx.contacts_count} matches=${(ctx.active_matches || '').split(',').length}`;
  }
}

module.exports = { ContextBuilder, PIPELINE_WINDOWS_DAYS, PIPELINE_EVENT_LIMITS, MAX_DATA_CONTEXT_CHARS };
