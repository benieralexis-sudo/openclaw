// FlowFast - Connexion Apollo.io
const https = require('https');
let _appConfig = null;
try { _appConfig = require('../../gateway/app-config.js'); } catch (e) {}

class ApolloConnector {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'api.apollo.io';
  }

  // Fonction pour faire des requêtes à Apollo
  makeRequest(path, data) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(data);
      
      const options = {
        hostname: this.baseUrl,
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-Api-Key': this.apiKey
        }
      };

      const req = https.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (res.statusCode >= 400) {
              reject(new Error('Apollo ' + res.statusCode + ': ' + (response.error || response.message || body.substring(0, 200))));
              return;
            }
            resolve(response);
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', (e) => {
        reject(e);
      });
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Timeout Apollo (15s)'));
      });

      req.write(postData);
      req.end();
    });
  }

  // Construire les params de base (sans keywords)
  _buildSearchData(criteria) {
    const searchData = {
      page: 1,
      per_page: Math.min(criteria.limit || 10, 100)
    };
    if (criteria.titles && criteria.titles.length > 0) {
      searchData.person_titles = criteria.titles;
    }
    if (criteria.locations && criteria.locations.length > 0) {
      searchData.person_locations = criteria.locations;
    }
    if (criteria.seniorities && criteria.seniorities.length > 0) {
      searchData.person_seniorities = criteria.seniorities;
    }
    if (criteria.domain) {
      searchData.q_organization_domains = criteria.domain;
    }
    if (criteria.companySize && criteria.companySize.length > 0) {
      searchData.organization_num_employees_ranges = criteria.companySize;
    }
    if (criteria.verifiedEmails) {
      searchData.contact_email_status = ['verified'];
    }
    return searchData;
  }

  // Rechercher des leads sur Apollo
  // Supporte keywords multiples via " OR " (Apollo ne gere pas OR nativement)
  async searchLeads(criteria = {}) {
    console.log('🔍 Recherche de leads sur Apollo...');

    const keywords = (criteria.keywords || '').trim();

    // Si keywords contient " OR ", splitter et faire une recherche par terme
    if (keywords.includes(' OR ')) {
      const terms = keywords.split(/\s+OR\s+/).map(t => t.trim()).filter(Boolean);
      console.log('[apollo] Multi-keywords detectes:', terms.length, 'termes:', terms.join(' | '));

      const allLeads = [];
      const seenIds = new Set();
      let searchCount = 0;

      for (const term of terms) {
        const searchData = this._buildSearchData(criteria);
        searchData.q_keywords = term;
        console.log('[apollo] Recherche "' + term + '"...');

        try {
          const result = await this.makeRequest('/v1/mixed_people/api_search', searchData);
          searchCount++;
          const people = result.people || [];
          let added = 0;
          for (const p of people) {
            if (!seenIds.has(p.id)) {
              seenIds.add(p.id);
              allLeads.push(p);
              added++;
            }
          }
          console.log('   → ' + people.length + ' resultats (' + added + ' nouveaux)');
          // Rate limit entre les appels
          if (terms.indexOf(term) < terms.length - 1) {
            await new Promise(r => setTimeout(r, 500));
          }
        } catch (e) {
          console.error('   ❌ Erreur pour "' + term + '":', e.message);
        }
      }

      // Limiter au nombre demande
      const limited = allLeads.slice(0, criteria.limit || 10);
      console.log('✅ Total: ' + allLeads.length + ' leads uniques (' + searchCount + ' recherches), retourne ' + limited.length);

      if (_appConfig && _appConfig.recordServiceUsage) {
        _appConfig.recordServiceUsage('apollo', { searches: searchCount });
      }

      return { success: true, count: limited.length, leads: limited };
    }

    // Recherche simple (un seul keyword ou aucun)
    const searchData = this._buildSearchData(criteria);
    if (keywords) {
      searchData.q_keywords = keywords;
    }

    console.log('[apollo] Recherche avec ' + Object.keys(searchData).length + ' criteres, limit=' + searchData.per_page);

    try {
      const result = await this.makeRequest('/v1/mixed_people/api_search', searchData);

      const count = result.people ? result.people.length : 0;
      console.log(`✅ Trouvé ${count} leads`);

      if (_appConfig && _appConfig.recordServiceUsage) {
        _appConfig.recordServiceUsage('apollo', { searches: 1 });
      }

      return {
        success: true,
        count: count,
        leads: result.people || []
      };

    } catch (error) {
      console.error('❌ Erreur Apollo:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Reveler les donnees completes d'un lead (nom, email, LinkedIn, ville)
  // Coute 1 credit Apollo par appel
  async revealLead(apolloId) {
    try {
      const result = await this.makeRequest('/v1/people/match', { id: apolloId });
      // Track usage (1 credit par reveal)
      if (_appConfig && _appConfig.recordServiceUsage) {
        _appConfig.recordServiceUsage('apollo', { reveals: 1, credits: 1 });
      }
      if (result.person) {
        const p = result.person;
        return {
          success: true,
          lead: {
            apolloId: p.id,
            first_name: p.first_name || '',
            last_name: p.last_name || '',
            nom: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
            title: p.title || '',
            email: p.email || '',
            linkedin_url: p.linkedin_url || '',
            city: p.city || '',
            state: p.state || '',
            country: p.country || '',
            organization: p.organization || {}
          }
        };
      }
      return { success: false, error: 'Lead non trouve' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Reveler un batch de leads (1 credit chacun)
  async revealLeads(apolloIds) {
    const results = [];
    for (const id of apolloIds) {
      const result = await this.revealLead(id);
      results.push(result);
      // Rate limit: 1 appel/seconde
      await new Promise(r => setTimeout(r, 1100));
    }
    return results;
  }

  // Formater un lead pour affichage (compatible ancien et nouveau endpoint Apollo)
  formatLead(lead) {
    return {
      nom: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Inconnu',
      titre: lead.title || 'Non spécifié',
      entreprise: lead.organization?.name || 'Non spécifié',
      email: lead.email || (lead.has_email ? 'A enrichir' : 'Non disponible'),
      linkedin: lead.linkedin_url || 'Non disponible',
      localisation: lead.city || (lead.has_city ? 'Disponible' : 'Non spécifié'),
      hasEmail: lead.has_email || !!lead.email
    };
  }
}

// Export pour utilisation
module.exports = ApolloConnector;

// Test si exécuté directement
if (require.main === module) {
  const apiKey = process.env.APOLLO_API_KEY;
  
  if (!apiKey) {
    console.error('❌ APOLLO_API_KEY non définie !');
    process.exit(1);
  }
  
  const apollo = new ApolloConnector(apiKey);
  
  // Test avec Stripe comme exemple
  apollo.searchLeads({ 
    domain: 'stripe.com',
    limit: 5 
  }).then(result => {
    if (result.success) {
      console.log('\n📊 Résultats :');
      result.leads.slice(0, 3).forEach((lead, i) => {
        const formatted = apollo.formatLead(lead);
        console.log(`\n👤 Lead ${i + 1}:`);
        console.log(`   Nom: ${formatted.nom}`);
        console.log(`   Titre: ${formatted.titre}`);
        console.log(`   Entreprise: ${formatted.entreprise}`);
      });
    }
  });
}
