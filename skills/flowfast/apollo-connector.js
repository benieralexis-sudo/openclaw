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
          'Content-Length': postData.length,
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
      per_page: criteria.limit || 10,
      person_titles: criteria.titles || [],
      q_organization_domains: criteria.domain || null,
      organization_num_employees_ranges: criteria.companySize || []
    };

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
