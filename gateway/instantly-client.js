// iFIND Bot — Client API Instantly v2
// Gere : campagnes, leads (bulk-add avec custom variables), comptes, analytics, webhooks
'use strict';

const https = require('https');
const log = require('./logger.js');
const { getBreaker } = require('./circuit-breaker.js');

const API_BASE = 'api.instantly.ai';
const API_PREFIX = '/api/v2';

class InstantlyClient {
  constructor(apiKey) {
    if (!apiKey) throw new Error('INSTANTLY_API_KEY manquant');
    this.apiKey = apiKey;
    this.breaker = getBreaker('instantly');
  }

  // --- HTTP helper ---
  _rawRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: API_BASE,
        port: 443,
        path: API_PREFIX + path,
        method,
        headers: {
          'Authorization': 'Bearer ' + this.apiKey,
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              const err = new Error('Instantly API ' + res.statusCode + ': ' + (parsed.message || parsed.error || data.substring(0, 200)));
              err.statusCode = res.statusCode;
              err.body = parsed;
              reject(err);
            }
          } catch (e) {
            reject(new Error('Instantly parse error: ' + e.message));
          }
        });
      });

      req.on('error', (e) => {
        reject(new Error('Instantly network error: ' + e.message));
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Instantly timeout 30s'));
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async _request(method, path, body = null) {
    return this.breaker.call(() => this._rawRequest(method, path, body));
  }

  // === COMPTES EMAIL ===

  async listAccounts() {
    const result = await this._request('GET', '/accounts');
    return result.items || result;
  }

  // === CAMPAGNES ===

  /**
   * Creer une campagne Instantly avec 3 steps (cold email sequences)
   * Les templates utilisent {{custom_subject_N}} et {{custom_body_N}} par lead
   */
  async createCampaign(name, options = {}) {
    const {
      accounts = [],        // liste d'emails sending accounts
      timezone = 'Europe/Belgrade',  // Europe/Paris non supporte par Instantly, Belgrade = meme fuseau CET/CEST
      startHour = '08:00',
      endHour = '17:00',
      dailyLimit = 50,
      stepDelays = [0, 3, 10],  // jours entre steps
      stopOnReply = true,
      textOnly = true       // plain text = meilleure delivrabilite
    } = options;

    // Construire les steps avec custom variables per-lead
    const steps = stepDelays.map((delay, i) => {
      const stepNum = i + 1;
      return {
        type: 'email',
        delay: delay,
        delay_unit: 'days',
        variants: [
          {
            subject: '{{custom_subject_' + stepNum + '}}',
            body: '{{custom_body_' + stepNum + '}}'
          }
        ]
      };
    });

    const payload = {
      name: name,
      campaign_schedule: {
        schedules: [
          {
            name: 'Business Hours',
            timing: { from: startHour, to: endHour },
            days: {
              '0': false,  // dimanche
              '1': true,   // lundi
              '2': true,
              '3': true,
              '4': true,
              '5': true,   // vendredi
              '6': false   // samedi
            },
            timezone: timezone
          }
        ]
      },
      sequences: [{ steps }],
      email_list: accounts,
      daily_limit: dailyLimit,
      stop_on_reply: stopOnReply,
      text_only: textOnly,
      open_tracking: false,   // tracking OFF = meilleure delivrabilite (v8.5)
      link_tracking: false
    };

    const campaign = await this._request('POST', '/campaigns', payload);
    log.info('instantly', 'Campagne creee: ' + campaign.id + ' (' + name + ') — ' + steps.length + ' steps, ' + accounts.length + ' comptes');
    return campaign;
  }

  async listCampaigns(limit = 100) {
    return this._request('GET', '/campaigns?limit=' + limit);
  }

  async getCampaign(campaignId) {
    return this._request('GET', '/campaigns/' + campaignId);
  }

  async activateCampaign(campaignId) {
    const result = await this._request('POST', '/campaigns/' + campaignId + '/activate');
    log.info('instantly', 'Campagne activee: ' + campaignId);
    return result;
  }

  async pauseCampaign(campaignId) {
    const result = await this._request('POST', '/campaigns/' + campaignId + '/stop');
    log.info('instantly', 'Campagne pausee: ' + campaignId);
    return result;
  }

  async getCampaignAnalytics(campaignId) {
    return this._request('GET', '/campaigns/' + campaignId + '/analytics/overview');
  }

  async getAllCampaignAnalytics() {
    return this._request('GET', '/campaigns/analytics/overview');
  }

  // === LEADS ===

  /**
   * Ajouter des leads a une campagne avec des emails personnalises par Claude
   *
   * @param {string} campaignId - ID de la campagne Instantly
   * @param {Array} leads - Liste de leads avec emails generes
   *   [{
   *     email: 'prospect@company.com',
   *     firstName: 'Jean',
   *     lastName: 'Dupont',
   *     companyName: 'Acme SAS',
   *     emails: {
   *       step1: { subject: '...', body: '...' },
   *       step2: { subject: '...', body: '...' },
   *       step3: { subject: '...', body: '...' }
   *     },
   *     extraVars: { ... }  // variables supplementaires
   *   }]
   * @returns {Object} Resultat de l'ajout
   */
  async addLeadsToCampaign(campaignId, leads) {
    if (!leads || leads.length === 0) return { added: 0 };

    // Instantly accepte max 1000 leads par requete
    const batches = [];
    for (let i = 0; i < leads.length; i += 1000) {
      batches.push(leads.slice(i, i + 1000));
    }

    let totalAdded = 0;
    for (const batch of batches) {
      const instantlyLeads = batch.map(lead => {
        const customVars = {};

        // Injecter les emails generes comme variables custom
        if (lead.emails) {
          if (lead.emails.step1) {
            customVars.custom_subject_1 = lead.emails.step1.subject || '';
            customVars.custom_body_1 = lead.emails.step1.body || '';
          }
          if (lead.emails.step2) {
            customVars.custom_subject_2 = lead.emails.step2.subject || '';
            customVars.custom_body_2 = lead.emails.step2.body || '';
          }
          if (lead.emails.step3) {
            customVars.custom_subject_3 = lead.emails.step3.subject || '';
            customVars.custom_body_3 = lead.emails.step3.body || '';
          }
        }

        // Variables supplementaires
        if (lead.extraVars) {
          Object.assign(customVars, lead.extraVars);
        }

        return {
          email: lead.email,
          first_name: lead.firstName || '',
          last_name: lead.lastName || '',
          company_name: lead.companyName || '',
          custom_variables: customVars
        };
      });

      const payload = {
        campaign_id: campaignId,
        leads: instantlyLeads,
        skip_if_in_workspace: false,
        skip_if_in_campaign: true,  // eviter les doublons dans la meme campagne
        verify_leads_on_import: false  // on verifie deja via MillionVerifier
      };

      const result = await this._request('POST', '/leads/add', payload);
      const added = (result && result.upload_count) || batch.length;
      totalAdded += added;
      log.info('instantly', 'Leads ajoutes: ' + added + '/' + batch.length + ' a campagne ' + campaignId);
    }

    return { added: totalAdded, total: leads.length };
  }

  /**
   * Ajouter UN SEUL lead a une campagne (wrapper pour integration existante)
   * C'est cette methode qui remplace resend.sendEmail() dans le flow actuel
   */
  async addLeadToCampaign(campaignId, lead) {
    return this.addLeadsToCampaign(campaignId, [lead]);
  }

  async listLeads(campaignId, limit = 100) {
    return this._request('POST', '/leads/list', {
      campaign_id: campaignId,
      limit: limit
    });
  }

  async updateLeadStatus(leadId, status) {
    // status: 0=active, 1=completed, 2=unsubscribed, -1=lead_not_interested, -2=wrong_person, -3=won
    return this._request('PATCH', '/leads/' + leadId + '/interest-status', {
      interest_status: status
    });
  }

  // === BLOCKLIST ===

  async addToBlocklist(entries) {
    // entries: [{type: 'email'|'domain', entry: 'value'}]
    return this._request('POST', '/block-list-entries/bulk-create', { entries });
  }

  // === WEBHOOKS ===

  async createWebhook(url, eventTypes) {
    // eventTypes: ['email.sent', 'email.opened', 'lead.replied', 'email.bounced', ...]
    const result = await this._request('POST', '/webhooks', {
      target_hook_url: url,
      event_type: eventTypes[0]
    });
    log.info('instantly', 'Webhook cree: ' + url + ' — events: ' + eventTypes.join(', '));
    return result;
  }

  async listWebhooks() {
    return this._request('GET', '/webhooks');
  }

  async deleteWebhook(webhookId) {
    return this._request('DELETE', '/webhooks/' + webhookId);
  }

  async getWebhookEventTypes() {
    return this._request('GET', '/webhooks/event-types');
  }

  // === ANALYTICS ===

  async getAccountDailyAnalytics(startDate, endDate) {
    let path = '/accounts/daily-analytics';
    const params = [];
    if (startDate) params.push('start_date=' + startDate);
    if (endDate) params.push('end_date=' + endDate);
    if (params.length) path += '?' + params.join('&');
    return this._request('GET', path);
  }

  // === UTILS ===

  /**
   * Tester la connexion API
   */
  async testConnection() {
    try {
      const accounts = await this.listAccounts();
      return {
        success: true,
        accounts: accounts.length,
        emails: accounts.map(a => a.email)
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Trouver ou creer une campagne par nom
   */
  async findOrCreateCampaign(name, options = {}) {
    const campaigns = await this.listCampaigns();
    const items = campaigns.items || campaigns;
    const existing = (Array.isArray(items) ? items : []).find(c => c.name === name);
    if (existing) {
      log.info('instantly', 'Campagne existante trouvee: ' + existing.id + ' (' + name + ')');
      return existing;
    }
    return this.createCampaign(name, options);
  }
}

module.exports = InstantlyClient;
