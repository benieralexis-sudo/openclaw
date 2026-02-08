// FlowFast - Connexion Apollo.io
const https = require('https');

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
            resolve(response);
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', (e) => {
        reject(e);
      });

      req.write(postData);
      req.end();
    });
  }

  // Rechercher des leads sur Apollo
  async searchLeads(criteria = {}) {
    console.log('🔍 Recherche de leads sur Apollo...');

    const searchData = {
      page: 1,
      per_page: Math.min(criteria.limit || 10, 100)
    };

    // Postes / titres
    if (criteria.titles && criteria.titles.length > 0) {
      searchData.person_titles = criteria.titles;
    }

    // Localisation des personnes (format "City, CC")
    if (criteria.locations && criteria.locations.length > 0) {
      searchData.person_locations = criteria.locations;
    }

    // Niveau hiérarchique
    if (criteria.seniorities && criteria.seniorities.length > 0) {
      searchData.person_seniorities = criteria.seniorities;
    }

    // Mots-clés libres
    if (criteria.keywords) {
      searchData.q_keywords = criteria.keywords;
    }

    // Domaine d'entreprise
    if (criteria.domain) {
      searchData.q_organization_domains = criteria.domain;
    }

    // Taille d'entreprise
    if (criteria.companySize && criteria.companySize.length > 0) {
      searchData.organization_num_employees_ranges = criteria.companySize;
    }

    // Emails vérifiés uniquement
    if (criteria.verifiedEmails) {
      searchData.contact_email_status = ['verified'];
    }

    console.log('📋 Paramètres Apollo:', JSON.stringify(searchData, null, 2));

    try {
      const result = await this.makeRequest('/v1/people/search', searchData);

      console.log(`✅ Trouvé ${result.people ? result.people.length : 0} leads`);

      return {
        success: true,
        count: result.people ? result.people.length : 0,
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

  // Formater un lead pour affichage
  formatLead(lead) {
    return {
      nom: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
      titre: lead.title || 'Non spécifié',
      entreprise: lead.organization?.name || 'Non spécifié',
      email: lead.email || 'Non disponible',
      linkedin: lead.linkedin_url || 'Non disponible',
      localisation: lead.city || 'Non spécifié'
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
