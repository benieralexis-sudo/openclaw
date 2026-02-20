// Lead Enrich - Client FullEnrich API (waterfall enrichment 15+ fournisseurs)
// API 100% asynchrone : POST → enrichment_id → polling resultats
const https = require('https');
const log = require('../../gateway/logger.js');
let _appConfig = null;
try { _appConfig = require('../../gateway/app-config.js'); } catch (e) {}

const BASE_HOST = 'app.fullenrich.com';
const BASE_PATH = '/api/v2';
const POLL_INTERVAL_MS = 15000;   // 15s entre chaque poll
const MAX_POLL_MS = 180000;       // 3 min max d'attente
const BATCH_MAX_POLL_MS = 600000; // 10 min max pour les batches

class FullEnrichEnricher {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this._lastRequestTime = 0;
  }

  // Rate limit : 60 calls/min → 1 call/seconde
  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this._lastRequestTime;
    if (elapsed < 1100) {
      await new Promise(r => setTimeout(r, 1100 - elapsed));
    }
    this._lastRequestTime = Date.now();
  }

  // --- HTTP generique ---
  _makeRequest(method, path, data) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: BASE_HOST,
        path: BASE_PATH + path,
        method: method,
        headers: {
          'Authorization': 'Bearer ' + this.apiKey
        }
      };

      let postData = null;
      if (data) {
        postData = JSON.stringify(data);
        options.headers['Content-Type'] = 'application/json';
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(response);
            } else {
              const errMsg = response.error || response.message || JSON.stringify(response).substring(0, 300);
              reject(new Error('FullEnrich ' + res.statusCode + ': ' + errMsg));
            }
          } catch (e) {
            reject(new Error('Reponse FullEnrich invalide (' + res.statusCode + '): ' + body.substring(0, 300)));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout FullEnrich API')); });
      if (postData) req.write(postData);
      req.end();
    });
  }

  // --- Soumettre un enrichissement bulk (1 a 100 contacts) ---
  // Par defaut : emails seulement (1 credit). Phones = 10 credits en plus.
  async _submitEnrichment(contacts, enrichFields) {
    await this._rateLimit();
    const payload = {
      name: 'ifind-' + Date.now(),
      data: contacts.map(c => ({
        ...c,
        enrich_fields: enrichFields || ['contact.emails']
      }))
    };
    return await this._makeRequest('POST', '/contact/enrich/bulk', payload);
  }

  // --- Polling des resultats ---
  async _pollResults(enrichmentId, maxWaitMs) {
    maxWaitMs = maxWaitMs || MAX_POLL_MS;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      await this._rateLimit();

      try {
        const result = await this._makeRequest('GET', '/contact/enrich/bulk/' + enrichmentId);

        if (result.status === 'FINISHED') {
          // Track usage
          const contactCount = (result.data || []).length;
          if (_appConfig && _appConfig.recordServiceUsage) {
            _appConfig.recordServiceUsage('fullenrich', { credits: contactCount });
          }
          return result;
        }
        if (result.status === 'CANCELED') {
          return { ...result, _error: 'Enrichissement annule' };
        }
        if (result.status === 'CREDITS_INSUFFICIENT') {
          return { ...result, _error: 'Credits FullEnrich insuffisants' };
        }
        // CREATED, IN_PROGRESS → continuer le polling
        log.info('fullenrich', 'Polling ' + enrichmentId + ' — status: ' + result.status + ' (' + Math.round((Date.now() - start) / 1000) + 's)');
      } catch (e) {
        // 400 "enrichment in progress" → normal, continuer
        if (e.message && e.message.includes('in_progress')) {
          log.info('fullenrich', 'Enrichissement en cours, retry dans ' + (POLL_INTERVAL_MS / 1000) + 's...');
          continue;
        }
        throw e;
      }
    }

    // Timeout → tenter avec forceResults
    log.warn('fullenrich', 'Timeout polling ' + enrichmentId + ' apres ' + (maxWaitMs / 1000) + 's, force results...');
    await this._rateLimit();
    try {
      return await this._makeRequest('GET', '/contact/enrich/bulk/' + enrichmentId + '?forceResults=true');
    } catch (e) {
      return { status: 'TIMEOUT', data: [], _error: 'Timeout enrichissement (' + (maxWaitMs / 1000) + 's)' };
    }
  }

  // ============================================================
  // INTERFACE PUBLIQUE (meme signature que ApolloEnricher)
  // ============================================================

  async enrichByEmail(email) {
    // FullEnrich : reverse email lookup
    try {
      await this._rateLimit();
      const result = await this._makeRequest('POST', '/contact/reverse/email/bulk', {
        name: 'ifind-reverse-' + Date.now(),
        data: [{ email: email }]
      });

      if (result.enrichment_id) {
        const enriched = await this._pollResults(result.enrichment_id);
        if (enriched._error) {
          return { success: false, error: enriched._error };
        }
        return this._formatResult(enriched);
      }
      return { success: false, error: 'Pas de enrichment_id retourne' };
    } catch (e) {
      log.warn('fullenrich', 'Reverse email echoue:', e.message);
      // Tenter d'enrichir avec le domain extrait de l'email
      const domain = email.split('@')[1];
      if (domain) {
        try {
          const submitResult = await this._submitEnrichment([{ domain: domain }]);
          if (submitResult.enrichment_id) {
            const enriched = await this._pollResults(submitResult.enrichment_id);
            if (!enriched._error) return this._formatResult(enriched);
          }
        } catch (e2) {
          // Ignorer
        }
      }
      return { success: false, error: 'Enrichissement par email seul non supporte. Utilise nom+entreprise ou LinkedIn.' };
    }
  }

  async enrichByNameAndCompany(firstName, lastName, company, options) {
    try {
      const contact = {
        first_name: firstName,
        last_name: lastName,
        company_name: company
      };
      const fields = (options && options.includePhone) ? ['contact.emails', 'contact.phones'] : undefined;
      const submitResult = await this._submitEnrichment([contact], fields);

      if (!submitResult.enrichment_id) {
        return { success: false, error: 'Pas de enrichment_id retourne' };
      }

      const result = await this._pollResults(submitResult.enrichment_id);
      if (result._error) {
        return { success: false, error: result._error };
      }
      return this._formatResult(result);
    } catch (e) {
      log.error('fullenrich', 'Erreur enrichByNameAndCompany:', e.message);
      return { success: false, error: e.message };
    }
  }

  async enrichByLinkedIn(linkedinUrl, options) {
    try {
      const fields = (options && options.includePhone) ? ['contact.emails', 'contact.phones'] : undefined;
      const submitResult = await this._submitEnrichment([{
        linkedin_url: linkedinUrl
      }], fields);

      if (!submitResult.enrichment_id) {
        return { success: false, error: 'Pas de enrichment_id retourne' };
      }

      const result = await this._pollResults(submitResult.enrichment_id);
      if (result._error) {
        return { success: false, error: result._error };
      }
      return this._formatResult(result);
    } catch (e) {
      log.error('fullenrich', 'Erreur enrichByLinkedIn:', e.message);
      return { success: false, error: e.message };
    }
  }

  // --- Enrichissement batch (jusqu'a 100 contacts) ---
  async enrichBatch(contacts) {
    // contacts = [{ firstName, lastName, company, email, linkedin }]
    const feData = contacts.map((c, i) => {
      const entry = {
        custom: { idx: String(i) }
      };
      if (c.linkedin) {
        entry.linkedin_url = c.linkedin;
      } else if (c.firstName && c.lastName && c.company) {
        entry.first_name = c.firstName;
        entry.last_name = c.lastName;
        entry.company_name = c.company;
      } else if (c.email) {
        // Extraire le domain
        const domain = c.email.split('@')[1];
        if (c.firstName || c.lastName) {
          entry.first_name = c.firstName || '';
          entry.last_name = c.lastName || '';
          entry.domain = domain;
        } else {
          // Pas assez de donnees — skip
          return null;
        }
      } else {
        return null;
      }
      return entry;
    }).filter(Boolean);

    if (feData.length === 0) {
      return { success: false, results: [], error: 'Aucun contact enrichissable' };
    }

    try {
      const submitResult = await this._submitEnrichment(feData);
      if (!submitResult.enrichment_id) {
        return { success: false, results: [], error: 'Pas de enrichment_id' };
      }

      const maxWait = Math.min(BATCH_MAX_POLL_MS, Math.max(60000, feData.length * 15000 + 60000));
      const result = await this._pollResults(submitResult.enrichment_id, maxWait);

      if (result._error) {
        return { success: false, results: [], error: result._error };
      }

      // Matcher les resultats par custom.idx (FullEnrich ne garantit pas l'ordre)
      const resultMap = {};
      for (const d of (result.data || [])) {
        const idx = (d.custom && d.custom.idx) ? parseInt(d.custom.idx) : -1;
        if (idx >= 0) {
          resultMap[idx] = this._formatSingleResult(d);
        }
      }
      // Reconstruire dans l'ordre original
      const formatted = [];
      for (let i = 0; i < contacts.length; i++) {
        formatted.push(resultMap[i] || { success: false, error: 'Contact non trouve' });
      }
      return {
        success: true,
        results: formatted,
        creditsUsed: result.cost ? result.cost.credits : 0,
        enrichmentId: result.id
      };
    } catch (e) {
      log.error('fullenrich', 'Erreur enrichBatch:', e.message);
      return { success: false, results: [], error: e.message };
    }
  }

  // ============================================================
  // FORMATAGE (meme structure de retour que ApolloEnricher)
  // ============================================================

  _formatResult(result) {
    if (!result || !result.data || !Array.isArray(result.data) || result.data.length === 0) {
      return { success: false, error: 'Contact non trouve sur FullEnrich' };
    }
    return this._formatSingleResult(result.data[0]);
  }

  _formatSingleResult(d) {
    if (!d) return { success: false, error: 'Donnees contact vides' };

    const profile = d.profile || {};
    const contactInfo = d.contact_info || {};
    const input = d.input || {};
    const employment = (profile.employment && profile.employment.current) || {};
    const company = employment.company || {};
    const location = profile.location || {};
    const socialProfiles = profile.social_profiles || {};

    // Meilleur email pro — filtrer les emails INVALID
    let workEmail = '';
    let emailStatus = '';
    if (contactInfo.most_probable_work_email && contactInfo.most_probable_work_email.email) {
      workEmail = contactInfo.most_probable_work_email.email;
      emailStatus = contactInfo.most_probable_work_email.status || '';
    } else if (contactInfo.work_emails && contactInfo.work_emails.length > 0) {
      // Prendre le premier email non-INVALID
      const valid = contactInfo.work_emails.find(e => e.status !== 'INVALID' && e.status !== 'INVALID_DOMAIN');
      if (valid) {
        workEmail = valid.email;
        emailStatus = valid.status || '';
      }
    }

    // Meilleur telephone
    const phone = (contactInfo.most_probable_phone && contactInfo.most_probable_phone.number) ||
                  (contactInfo.phones && contactInfo.phones[0] && contactInfo.phones[0].number) || '';

    // LinkedIn
    const linkedinUrl = (socialProfiles.linkedin && socialProfiles.linkedin.url) || '';

    const firstName = String(profile.first_name || input.first_name || '');
    const lastName = String(profile.last_name || input.last_name || '');

    if (!workEmail && !phone && !linkedinUrl && !profile.full_name) {
      return { success: false, error: 'Aucune donnee trouvee pour ce contact' };
    }

    return {
      success: true,
      person: {
        firstName: firstName,
        lastName: lastName,
        fullName: String(profile.full_name || ((firstName + ' ' + lastName).trim()) || ''),
        title: String(employment.title || ''),
        email: workEmail,
        phone: phone,
        linkedinUrl: linkedinUrl,
        city: String(location.city || ''),
        state: String(location.region || ''),
        country: String(location.country || '')
      },
      organization: {
        name: String(company.name || input.company_name || ''),
        industry: String((company.industry && company.industry.main_industry) || ''),
        website: company.domain ? ('https://' + company.domain) : '',
        employeeCount: Number(company.headcount) || 0,
        foundedYear: company.year_founded || null,
        city: String((company.locations && company.locations.headquarters && company.locations.headquarters.city) || ''),
        state: '',
        country: String((company.locations && company.locations.headquarters && company.locations.headquarters.country) || '')
      },
      _fullenrich: {
        emailStatus: emailStatus,
        custom: d.custom || {}
      }
    };
  }

  // ============================================================
  // UTILITAIRES
  // ============================================================

  async getCreditsBalance() {
    await this._rateLimit();
    try {
      const result = await this._makeRequest('GET', '/account/credits');
      return result.balance || 0;
    } catch (e) {
      log.error('fullenrich', 'Erreur getCreditsBalance:', e.message);
      return -1;
    }
  }

  async verifyKey() {
    await this._rateLimit();
    try {
      const result = await this._makeRequest('GET', '/account/keys/verify');
      return !!result.workspace_id;
    } catch (e) {
      log.error('fullenrich', 'Cle API invalide:', e.message);
      return false;
    }
  }
}

module.exports = FullEnrichEnricher;
