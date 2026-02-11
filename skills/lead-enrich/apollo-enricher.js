// Lead Enrich - Client Apollo People Search API (free plan)
const https = require('https');

class ApolloEnricher {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this._lastRequestTime = 0;
  }

  // Rate limit : 1 requete/seconde (Apollo free plan)
  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this._lastRequestTime;
    if (elapsed < 1000) {
      await new Promise(r => setTimeout(r, 1000 - elapsed));
    }
    this._lastRequestTime = Date.now();
  }

  makeRequest(path, data) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(data);
      const req = https.request({
        hostname: 'api.apollo.io',
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.apiKey,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(response);
            } else {
              reject(new Error('Apollo ' + res.statusCode + ': ' + (response.error || response.message || body.substring(0, 200))));
            }
          } catch (e) {
            reject(new Error('Reponse Apollo invalide: ' + body.substring(0, 200)));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout Apollo API')); });
      req.write(postData);
      req.end();
    });
  }

  async enrichByEmail(email) {
    await this._rateLimit();
    try {
      const result = await this.makeRequest('/v1/people/search', {
        q_keywords: email,
        page: 1,
        per_page: 1
      });
      return this._formatSearchResult(result);
    } catch (error) {
      console.log('[apollo-enricher] Erreur enrichByEmail:', error.message);
      return { success: false, error: error.message };
    }
  }

  async enrichByNameAndCompany(firstName, lastName, company) {
    await this._rateLimit();
    try {
      const result = await this.makeRequest('/v1/people/search', {
        q_keywords: (firstName + ' ' + lastName).trim(),
        q_organization_name: company,
        page: 1,
        per_page: 1
      });
      return this._formatSearchResult(result);
    } catch (error) {
      console.log('[apollo-enricher] Erreur enrichByName:', error.message);
      return { success: false, error: error.message };
    }
  }

  async enrichByLinkedIn(linkedinUrl) {
    await this._rateLimit();
    try {
      const result = await this.makeRequest('/v1/people/search', {
        q_keywords: linkedinUrl,
        page: 1,
        per_page: 1
      });
      return this._formatSearchResult(result);
    } catch (error) {
      console.log('[apollo-enricher] Erreur enrichByLinkedIn:', error.message);
      return { success: false, error: error.message };
    }
  }

  _formatSearchResult(result) {
    if (!result || !result.people || result.people.length === 0) {
      return { success: false, error: 'Contact non trouve sur Apollo' };
    }
    const p = result.people[0];
    const o = p.organization || {};
    return {
      success: true,
      person: {
        firstName: p.first_name || '',
        lastName: p.last_name || '',
        fullName: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
        title: p.title || '',
        email: p.email || '',
        phone: (p.phone_numbers && p.phone_numbers[0] && p.phone_numbers[0].sanitized_number) || '',
        linkedinUrl: p.linkedin_url || '',
        city: p.city || '',
        state: p.state || '',
        country: p.country || ''
      },
      organization: {
        name: o.name || '',
        industry: o.industry || '',
        website: o.website_url || '',
        employeeCount: o.estimated_num_employees || 0,
        foundedYear: o.founded_year || null,
        city: o.city || '',
        state: o.state || '',
        country: o.country || ''
      }
    };
  }
}

module.exports = ApolloEnricher;
