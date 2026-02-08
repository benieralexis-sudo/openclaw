// FlowFast - Connexion HubSpot
const https = require('https');

class HubSpotConnector {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'api.hubapi.com';
  }

  // Fonction pour faire des requêtes à HubSpot
  makeRequest(path, method = 'POST', data = null) {
    return new Promise((resolve, reject) => {
      const postData = data ? JSON.stringify(data) : '';
      
      const options = {
        hostname: this.baseUrl,
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      };

      if (postData) {
        options.headers['Content-Length'] = postData.length;
      }

      const req = https.request(options, (res) => {
        let body = '';
        
        res.on('data', (chunk) => {
          body += chunk;
        });
        
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(response);
            } else {
              reject(new Error(`HubSpot error: ${response.message || body}`));
            }
          } catch (e) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(body);
            } else {
              reject(new Error('Invalid JSON response'));
            }
          }
        });
      });

      req.on('error', (e) => {
        reject(e);
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  // Créer un contact dans HubSpot
  async createContact(contactData) {
    console.log('📝 Création contact HubSpot...');
    
    const properties = {
      firstname: contactData.prenom,
      lastname: contactData.nom,
      email: contactData.email,
      jobtitle: contactData.titre,
      company: contactData.entreprise,
      phone: contactData.telephone || '',
      city: contactData.ville || '',
      lifecyclestage: 'lead'
    };

    try {
      const result = await this.makeRequest(
        '/crm/v3/objects/contacts',
        'POST',
        { properties }
      );
      
      console.log(`✅ Contact créé ! ID: ${result.id}`);
      return {
        success: true,
        contactId: result.id,
        data: result
      };
      
    } catch (error) {
      console.error('❌ Erreur création contact:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Rechercher un contact par email (éviter doublons)
  async findContactByEmail(email) {
    try {
      const result = await this.makeRequest(
        `/crm/v3/objects/contacts/search`,
        'POST',
        {
          filterGroups: [{
            filters: [{
              propertyName: 'email',
              operator: 'EQ',
              value: email
            }]
          }]
        }
      );
      
      return result.results && result.results.length > 0 ? result.results[0] : null;
      
    } catch (error) {
      console.error('❌ Erreur recherche contact:', error.message);
      return null;
    }
  }

  // Créer ou mettre à jour un contact
  async upsertContact(contactData) {
    console.log(`🔍 Vérification si ${contactData.email} existe...`);
    
    const existing = await this.findContactByEmail(contactData.email);
    
    if (existing) {
      console.log('⚠️  Contact existe déjà, skip.');
      return {
        success: true,
        existed: true,
        contactId: existing.id
      };
    }
    
    return await this.createContact(contactData);
  }
}

// Export
module.exports = HubSpotConnector;

// Test si exécuté directement
if (require.main === module) {
  const apiKey = process.env.HUBSPOT_API_KEY;
  
  if (!apiKey) {
    console.error('❌ HUBSPOT_API_KEY non définie !');
    process.exit(1);
  }
  
  const hubspot = new HubSpotConnector(apiKey);
  
  // Test avec un contact fictif
  const testContact = {
    prenom: 'Jean',
    nom: 'Test',
    email: 'jean.test@flowfast-demo.com',
    titre: 'CEO',
    entreprise: 'FlowFast Demo',
    telephone: '+33612345678',
    ville: 'Paris'
  };
  
  console.log('🧪 Test création contact...\n');
  
  hubspot.upsertContact(testContact).then(result => {
    if (result.success) {
      console.log('\n🎉 SUCCESS !');
      console.log('Contact ID:', result.contactId);
      if (result.existed) {
        console.log('(Contact existait déjà)');
      }
    } else {
      console.log('\n❌ ÉCHEC');
    }
  });
}
