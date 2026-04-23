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
const EVENTS_WINDOW_DAYS = 90;
const CONTACTS_LIMIT = 5;

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

  _getEvents(siren) {
    return this.db.prepare(`
      SELECT source, event_type, event_date, raw_data, normalized
      FROM events
      WHERE siren = ?
        AND event_date >= date('now', '-' || ? || ' days')
      ORDER BY event_date DESC
      LIMIT 200
    `).all(siren, String(EVENTS_WINDOW_DAYS));
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
      : this._buildLeadContext(siren);

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

  _buildLeadContext(siren) {
    const company = this._getCompany(siren);
    if (!company) return { error: 'company-not-found', siren };
    const events = this._getEvents(siren);
    const matches = this._getActiveMatches(siren);
    const contacts = this._getContacts(siren);

    const eventsSummary = events.slice(0, 50).map(e => {
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
      tenant_id: undefined // rempli en amont si besoin
    };
  }

  _buildDiscoverContext(tenantId) {
    // Placeholder J7
    return { tenantId, note: 'discover context built in J7' };
  }

  /**
   * Serialize dataContext to a string suitable for sending to Opus.
   * Keep it compact.
   */
  renderDataContext(ctx) {
    if (!ctx || ctx.error) return `[contexte indisponible: ${ctx?.error || 'unknown'}]`;
    return [
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
      `# Events ${ctx.events_count} derniers 90j (max 50 affichés)`,
      ctx.events_summary,
      '',
      `# Contacts connus (${ctx.contacts_count})`,
      ctx.contacts_summary
    ].filter(l => l !== null).join('\n');
  }
}

module.exports = { ContextBuilder };
