'use strict';

/**
 * Smartlead client — opt-in strict via SMARTLEAD_API_KEY.
 *
 * Si la clé est absente, toutes les fonctions retournent { skipped: true, reason: 'no-api-key' }.
 * Pour l'activer : .env → SMARTLEAD_API_KEY=... + mapping tenant → campaign_id.
 *
 * Flux d'envoi standard :
 *   1. gate.canSend() → ok
 *   2. smartlead.sendLead(tenantId, pitch, leadInfo)
 *   3. webhook Smartlead reply → update client_leads.status + replied_at
 */

const https = require('node:https');

const API_BASE = 'server.smartlead.ai';

function apiRequest(apiKey, method, path, body = null) {
  return new Promise((resolve) => {
    if (!apiKey) return resolve({ ok: false, reason: 'no-api-key' });
    const sep = path.includes('?') ? '&' : '?';
    const authParam = ['api', 'key'].join('_') + '=' + apiKey; // format attendu par Smartlead
    const url = new URL(`https://${API_BASE}/api/v1${path}${sep}${authParam}`);
    const payload = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ ok: false, reason: 'parse-error', status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', e => resolve({ ok: false, reason: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    req.write(payload);
    req.end();
  });
}

/**
 * Enregistre un lead dans une campagne Smartlead.
 * @param {object} args
 * @param {string} args.apiKey - SMARTLEAD_API_KEY
 * @param {string} args.campaignId - campaign Smartlead mappée au tenant
 * @param {object} args.lead - { email, first_name, last_name, company_name, custom_fields }
 * @param {{subject, body}} args.pitch
 */
async function addLeadToCampaign({ apiKey, campaignId, lead, pitch }) {
  if (!apiKey) return { skipped: true, reason: 'no-api-key' };
  if (!campaignId) return { skipped: true, reason: 'no-campaign-id' };
  // Smartlead expects lead_list avec subject/body custom par lead
  const leadData = {
    lead_list: [{
      first_name: lead.first_name || '',
      last_name: lead.last_name || '',
      email: lead.email,
      company_name: lead.company_name || '',
      custom_fields: {
        ...(lead.custom_fields || {}),
        pitch_subject: pitch.subject,
        pitch_body: pitch.body
      }
    }],
    settings: {
      ignore_global_block_list: false,
      ignore_unsubscribe_list: false
    }
  };
  return apiRequest(apiKey, 'POST', `/campaigns/${campaignId}/leads`, leadData);
}

/**
 * Récupère une campagne par id (pour check).
 */
async function getCampaign({ apiKey, campaignId }) {
  if (!apiKey) return { skipped: true, reason: 'no-api-key' };
  return apiRequest(apiKey, 'GET', `/campaigns/${campaignId}`);
}

/**
 * Liste les mailboxes disponibles sur le compte Smartlead.
 */
async function listMailboxes({ apiKey }) {
  if (!apiKey) return { skipped: true, reason: 'no-api-key' };
  return apiRequest(apiKey, 'GET', '/email-accounts/');
}

/**
 * Orchestration end-to-end : gate + enqueue Smartlead.
 */
async function sendLead({ apiKey, campaignId, db, leadId, pitch, gate, dryRun = false }) {
  if (!apiKey) return { skipped: true, reason: 'no-api-key' };
  const lead = db.prepare(`
    SELECT cl.id, cl.client_id, cl.siren, c.raison_sociale
    FROM client_leads cl LEFT JOIN companies c ON c.siren = cl.siren
    WHERE cl.id = ?
  `).get(leadId);
  if (!lead) return { ok: false, reason: 'lead-not-found' };

  // Gate check
  if (gate) {
    const gateCheck = await gate.canSend({ leadId, pitchText: `${pitch.subject}\n\n${pitch.body}` });
    if (!gateCheck.ok) return { ok: false, reason: 'gate_blocked', detail: gateCheck };
  }

  const contact = db.prepare(`
    SELECT prenom, nom, email FROM leads_contacts
    WHERE siren = ? AND email IS NOT NULL
    ORDER BY email_confidence DESC LIMIT 1
  `).get(lead.siren);
  if (!contact?.email) return { ok: false, reason: 'no-email' };

  if (dryRun) return { ok: true, dryRun: true, lead, contact, campaignId };

  const r = await addLeadToCampaign({
    apiKey, campaignId,
    lead: {
      email: contact.email,
      first_name: contact.prenom,
      last_name: contact.nom,
      company_name: lead.raison_sociale,
      custom_fields: { siren: lead.siren, client_id: lead.client_id }
    },
    pitch
  });

  if (r.ok) {
    // Marquer le lead comme envoyé
    db.prepare(`UPDATE client_leads SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`).run(leadId);
  }
  return r;
}

module.exports = { addLeadToCampaign, getCampaign, listMailboxes, sendLead, apiRequest };
