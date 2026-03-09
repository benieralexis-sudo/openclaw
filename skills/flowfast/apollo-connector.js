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
  // FIX: Normalise les keywords multi-mots (>2 mots sans OR) en recherches separees
  async searchLeads(criteria = {}) {
    console.log('🔍 Recherche de leads sur Apollo...');

    let keywords = (criteria.keywords || '').trim();

    // FIX: Si keywords contient 3+ mots SANS "OR", c'est probablement une erreur du brain
    // Ex: "SaaS B2B editeur logiciel" -> chercher "SaaS B2B" puis "editeur logiciel" separement
    // Apollo fait un AND implicite sur les mots, donc 3+ mots = quasi 0 resultats
    if (keywords && !keywords.includes(' OR ') && keywords.split(/\s+/).filter(Boolean).length > 2) {
      const words = keywords.split(/\s+/).filter(Boolean);
      // Grouper les mots par paires de 2 max et joindre avec OR
      const pairs = [];
      for (let i = 0; i < words.length; i += 2) {
        if (i + 1 < words.length) {
          pairs.push(words[i] + ' ' + words[i + 1]);
        } else {
          pairs.push(words[i]);
        }
      }
      const normalized = pairs.join(' OR ');
      console.log('[apollo-connector] Keywords multi-mots normalises: "' + keywords + '" -> "' + normalized + '" (' + words.length + ' mots, ' + pairs.length + ' paires)');
      keywords = normalized;
    }

    // Si keywords contient " OR ", splitter et faire une recherche par terme
    if (keywords.includes(' OR ')) {
      const terms = keywords.split(/\s+OR\s+/).map(t => t.trim()).filter(Boolean);
      if (terms.length === 0) {
        console.log('[apollo-connector] WARN: Aucun terme valide apres normalisation de: "' + (criteria.keywords || '') + '"');
        return { leads: [], total: 0 };
      }
      console.log('[apollo-connector] Multi-keywords: ' + terms.length + ' termes: ' + terms.join(' | '));

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

      return { success: true, count: limited.length, leads: limited, totalAvailable: allLeads.length };
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
        leads: result.people || [],
        totalAvailable: result.total_entries || (result.pagination && result.pagination.total_entries) || count
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

  // Re-verifier une personne sur Apollo (pour detection changement de poste)
  // Coute 1 credit par appel (people/match)
  async reCheckPerson(params) {
    const matchData = {};
    if (params.email) matchData.email = params.email;
    if (params.firstName) matchData.first_name = params.firstName;
    if (params.lastName) matchData.last_name = params.lastName;
    if (params.apolloId) matchData.id = params.apolloId;
    if (params.organizationName) matchData.organization_name = params.organizationName;

    try {
      const result = await this.makeRequest('/v1/people/match', matchData);
      if (_appConfig && _appConfig.recordServiceUsage) {
        _appConfig.recordServiceUsage('apollo', { reveals: 1, credits: 1 });
      }
      if (result.person) {
        const p = result.person;
        return {
          success: true,
          person: {
            apolloId: p.id,
            firstName: p.first_name || '',
            lastName: p.last_name || '',
            title: p.title || '',
            email: p.email || '',
            linkedinUrl: p.linkedin_url || '',
            city: p.city || '',
            organizationName: (p.organization && p.organization.name) || '',
            organizationId: (p.organization && p.organization.id) || '',
            organizationWebsite: (p.organization && p.organization.website_url) || ''
          }
        };
      }
      return { success: false, error: 'Personne non trouvee' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Rechercher des leads avec intent topics (prospects qui recherchent activement un sujet)
  // Utilise le meme endpoint mais avec q_intent_topics + intent_strength
  // 0 credit pour la recherche, 1 credit par reveal
  async searchLeadsWithIntent(criteria = {}) {
    console.log('[apollo] Recherche intent-based...');

    const searchData = this._buildSearchData(criteria);

    // Intent topics : filtrer par sujets recherches activement
    if (criteria.intentTopics && criteria.intentTopics.length > 0) {
      searchData.intent_topic_ids = criteria.intentTopics;
    }

    // Intent strength : 'high' ou 'medium' (default 'high' pour max qualite)
    if (criteria.intentStrength) {
      searchData.intent_strength = criteria.intentStrength;
    }

    // Filtres org supplementaires
    if (criteria.organizationIds && criteria.organizationIds.length > 0) {
      searchData.organization_ids = criteria.organizationIds;
    }
    if (criteria.revenueRange) {
      searchData.organization_revenue_ranges = criteria.revenueRange;
    }
    if (criteria.technologies && criteria.technologies.length > 0) {
      searchData.organization_latest_funding_stage_cd = criteria.fundingStage;
    }

    // Keywords en complement (optionnel)
    if (criteria.keywords) {
      searchData.q_keywords = criteria.keywords;
    }

    try {
      const result = await this.makeRequest('/v1/mixed_people/api_search', searchData);
      const count = result.people ? result.people.length : 0;
      console.log('[apollo] Intent search: ' + count + ' leads trouves');

      if (_appConfig && _appConfig.recordServiceUsage) {
        _appConfig.recordServiceUsage('apollo', { searches: 1, intentSearch: true });
      }

      return {
        success: true,
        count: count,
        leads: result.people || [],
        totalAvailable: result.total_entries || (result.pagination && result.pagination.total_entries) || count,
        intentBased: true
      };
    } catch (error) {
      console.error('[apollo] Erreur intent search:', error.message);
      return { success: false, error: error.message, intentBased: true };
    }
  }

  // Enrichir une organisation (funding, tech stack, hiring, etc.)
  // 0 credit — endpoint gratuit
  async enrichOrganization(domain) {
    if (!domain) return { success: false, error: 'Domain requis' };
    try {
      const result = await this.makeRequest('/v1/organizations/enrich', {
        domain: domain
      });
      if (result.organization) {
        const org = result.organization;
        return {
          success: true,
          organization: {
            id: org.id,
            name: org.name || null,
            domain: org.primary_domain || domain,
            industry: org.industry || null,
            employeeCount: org.estimated_num_employees || null,
            foundedYear: org.founded_year || null,
            lastFundingDate: org.last_funding_date || null,
            lastFundingType: org.last_funding_type || null,
            totalFunding: org.total_funding_printed || null,
            technologies: (org.current_technologies || []).slice(0, 20),
            keywords: (org.keywords || []).slice(0, 15),
            shortDescription: (org.short_description || '').substring(0, 300),
            city: org.city || null,
            country: org.country || null,
            linkedinUrl: org.linkedin_url || null,
            revenue: org.annual_revenue_printed || null,
            jobPostings: org.publicly_traded_exchange || null,
            departmentHeadcount: org.department_head_count || null
          }
        };
      }
      return { success: false, error: 'Organisation non trouvee' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Lister les intent topics disponibles sur Apollo
  // Utile pour mapper nos niches aux topic IDs Apollo
  async listIntentTopics(query) {
    try {
      const result = await this.makeRequest('/v1/intent_topics/search', {
        q_intent_topic_name: query || '',
        per_page: 25
      });
      return {
        success: true,
        topics: (result.intent_topics || []).map(t => ({
          id: t.id,
          name: t.display_name || t.name,
          category: t.category || null
        }))
      };
    } catch (e) {
      return { success: false, error: e.message, topics: [] };
    }
  }

  // Rechercher les changements de poste recents (job changes = signal intent fort)
  // 0 credit pour la recherche
  async searchJobChanges(criteria = {}) {
    const searchData = this._buildSearchData(criteria);
    // Filtrer par changement de poste recent (< 90 jours)
    searchData.person_changed_job_within_last_n_days = criteria.jobChangeDays || 90;

    try {
      const result = await this.makeRequest('/v1/mixed_people/api_search', searchData);
      const count = result.people ? result.people.length : 0;
      console.log('[apollo] Job changes search: ' + count + ' leads');

      if (_appConfig && _appConfig.recordServiceUsage) {
        _appConfig.recordServiceUsage('apollo', { searches: 1, jobChangeSearch: true });
      }

      return {
        success: true,
        count: count,
        leads: result.people || [],
        totalAvailable: result.total_entries || (result.pagination && result.pagination.total_entries) || count
      };
    } catch (error) {
      console.error('[apollo] Erreur job changes search:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Compter les prospects disponibles pour un critere (0 credit, 1 appel API)
  async countAvailable(criteria = {}) {
    const searchData = this._buildSearchData({ ...criteria, limit: 1 });
    searchData.per_page = 1;
    if (criteria.keywords) searchData.q_keywords = criteria.keywords;

    try {
      const result = await this.makeRequest('/v1/mixed_people/api_search', searchData);
      return {
        success: true,
        totalAvailable: result.total_entries || (result.pagination && result.pagination.total_entries) || 0
      };
    } catch (e) {
      return { success: false, totalAvailable: 0, error: e.message };
    }
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
