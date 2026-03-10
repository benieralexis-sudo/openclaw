// Lead Enrich - Client Dropcontact API (enrichissement email B2B)
// Waterfall fallback quand Apollo ne trouve pas l'email
// API asynchrone : POST batch → request_id → polling resultats
const https = require('https');
const log = require('../../gateway/logger.js');
let _appConfig = null;
try { _appConfig = require('../../gateway/app-config.js'); } catch (e) {}

const BASE_HOST = 'api.dropcontact.io';
const POLL_INTERVAL_MS = 10000;   // 10s entre chaque poll
const MAX_POLL_MS = 120000;       // 2 min max (Dropcontact est rapide)

class DropcontactEnricher {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this._lastRequestTime = 0;
  }

  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this._lastRequestTime;
    if (elapsed < 1100) {
      await new Promise(r => setTimeout(r, 1100 - elapsed));
    }
    this._lastRequestTime = Date.now();
  }

  _makeRequest(method, path, data) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: BASE_HOST,
        path: path,
        method: method,
        headers: {
          'X-Access-Token': this.apiKey
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
              const errMsg = response.error || response.reason || JSON.stringify(response).substring(0, 300);
              reject(new Error('Dropcontact ' + res.statusCode + ': ' + errMsg));
            }
          } catch (e) {
            reject(new Error('Reponse Dropcontact invalide (' + res.statusCode + '): ' + body.substring(0, 300)));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout Dropcontact API')); });
      if (postData) req.write(postData);
      req.end();
    });
  }

  // Soumettre un enrichissement
  async _submitBatch(contacts) {
    await this._rateLimit();
    const payload = {
      data: contacts.map(c => {
        const entry = {};
        if (c.first_name) entry.first_name = c.first_name;
        if (c.last_name) entry.last_name = c.last_name;
        if (c.company_name) entry.company_name = c.company_name;
        if (c.website) entry.website = c.website;
        if (c.email) entry.email = c.email;
        if (c.linkedin) entry.linkedin = c.linkedin;
        return entry;
      }),
      siren: true
    };
    return await this._makeRequest('POST', '/batch', payload);
  }

  // Polling des resultats
  async _pollResults(requestId) {
    const start = Date.now();

    while (Date.now() - start < MAX_POLL_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      await this._rateLimit();

      try {
        const result = await this._makeRequest('GET', '/batch/' + requestId);

        if (result.success === true && result.data) {
          if (_appConfig && _appConfig.recordServiceUsage) {
            _appConfig.recordServiceUsage('dropcontact', { credits: result.credits_left != null ? 1 : 0 });
          }
          return result;
        }
        if (result.error) {
          return { success: false, _error: result.reason || result.error };
        }
        // Pas encore pret
        log.info('dropcontact', 'Polling ' + requestId + ' (' + Math.round((Date.now() - start) / 1000) + 's)');
      } catch (e) {
        if (e.message && e.message.includes('404')) {
          log.info('dropcontact', 'Batch pas encore pret, retry...');
          continue;
        }
        throw e;
      }
    }

    return { success: false, _error: 'Timeout polling (' + (MAX_POLL_MS / 1000) + 's)' };
  }

  // ============================================================
  // INTERFACE PUBLIQUE
  // ============================================================

  // Enrichir par nom + entreprise + website (cas principal : Apollo a le nom mais pas l'email)
  async enrichByNameAndCompany(firstName, lastName, company, website) {
    try {
      const entry = {
        first_name: firstName,
        last_name: lastName,
        company_name: company
      };
      if (website) entry.website = website;
      const result = await this._submitBatch([entry]);

      if (!result.request_id) {
        return { success: false, error: 'Pas de request_id retourne' };
      }

      const enriched = await this._pollResults(result.request_id);
      if (enriched._error) {
        return { success: false, error: enriched._error };
      }

      return this._formatResult(enriched);
    } catch (e) {
      log.error('dropcontact', 'Erreur enrichByNameAndCompany:', e.message);
      return { success: false, error: e.message };
    }
  }

  // Enrichir par email (reverse lookup — verification + enrichissement)
  async enrichByEmail(email) {
    try {
      const result = await this._submitBatch([{ email: email }]);

      if (!result.request_id) {
        return { success: false, error: 'Pas de request_id retourne' };
      }

      const enriched = await this._pollResults(result.request_id);
      if (enriched._error) {
        return { success: false, error: enriched._error };
      }

      return this._formatResult(enriched);
    } catch (e) {
      log.error('dropcontact', 'Erreur enrichByEmail:', e.message);
      return { success: false, error: e.message };
    }
  }

  // Enrichissement batch (jusqu'a 250 contacts)
  async enrichBatch(contacts) {
    if (!contacts || contacts.length === 0) {
      return { success: false, results: [], error: 'Aucun contact' };
    }

    try {
      const dcContacts = contacts.map(c => ({
        first_name: c.firstName || c.first_name || '',
        last_name: c.lastName || c.last_name || '',
        company_name: c.company || c.company_name || '',
        email: c.email || '',
        website: c.website || ''
      }));

      const result = await this._submitBatch(dcContacts);
      if (!result.request_id) {
        return { success: false, results: [], error: 'Pas de request_id' };
      }

      const enriched = await this._pollResults(result.request_id);
      if (enriched._error) {
        return { success: false, results: [], error: enriched._error };
      }

      const results = (enriched.data || []).map(d => this._formatSingleResult(d));
      return { success: true, results };
    } catch (e) {
      log.error('dropcontact', 'Erreur enrichBatch:', e.message);
      return { success: false, results: [], error: e.message };
    }
  }

  // ============================================================
  // FORMATAGE
  // ============================================================

  _formatResult(result) {
    if (!result || !result.data || !Array.isArray(result.data) || result.data.length === 0) {
      return { success: false, error: 'Contact non trouve sur Dropcontact' };
    }
    return this._formatSingleResult(result.data[0]);
  }

  _formatSingleResult(d) {
    if (!d) return { success: false, error: 'Donnees contact vides' };

    // Dropcontact retourne les emails dans un array [{email, type, qualification}]
    const emails = d.email || [];
    let bestEmail = '';
    let emailQual = '';

    if (Array.isArray(emails) && emails.length > 0) {
      // Priorite : pro > perso, qualified > non-qualified
      const pro = emails.find(e => e.type === 'pro' && e.qualification === 'qualified');
      const anyPro = emails.find(e => e.type === 'pro');
      const any = emails[0];
      const best = pro || anyPro || any;
      bestEmail = best.email || '';
      emailQual = best.qualification || '';
    } else if (typeof emails === 'string') {
      bestEmail = emails;
    }

    if (!bestEmail && !d.first_name && !d.last_name && !d.siren && !d.phone) {
      return { success: false, error: 'Aucune donnee trouvee' };
    }

    // success = true si email trouvé OU données enrichissement utiles (tel, SIREN, LinkedIn, ville)
    const hasUsefulData = !!bestEmail || !!(d.phone && d.phone[0]) || !!d.siren || !!d.linkedin || !!d.city || !!(d.job && d.job.length > 3);

    return {
      success: hasUsefulData,
      person: {
        firstName: d.first_name || '',
        lastName: d.last_name || '',
        fullName: d.full_name || ((d.first_name || '') + ' ' + (d.last_name || '')).trim(),
        title: d.job || '',
        email: bestEmail,
        phone: (d.phone && d.phone[0] && d.phone[0].number) || '',
        linkedinUrl: d.linkedin || '',
        city: d.city || '',
        country: d.country || ''
      },
      organization: {
        name: d.company_name || '',
        website: d.website || '',
        siren: d.siren || '',
        siret: d.siret || ''
      },
      _dropcontact: {
        emailQualification: emailQual,
        civility: d.civility || ''
      }
    };
  }

  // Verifier la cle API
  async verifyKey() {
    try {
      // Dropcontact n'a pas d'endpoint verify, on tente un batch vide
      await this._rateLimit();
      const result = await this._makeRequest('POST', '/batch', { data: [{ email: 'test@test.com' }] });
      return !!result.request_id;
    } catch (e) {
      log.error('dropcontact', 'Cle API invalide:', e.message);
      return false;
    }
  }
}

module.exports = DropcontactEnricher;
