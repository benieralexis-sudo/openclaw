// FlowFast - Gestion des listes HubSpot
const https = require('https');

class HubSpotLists {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'api.hubapi.com';
  }

  // Requête API HubSpot
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
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const response = body ? JSON.parse(body) : {};
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(response);
            } else {
              reject(new Error(`HubSpot error ${res.statusCode}: ${response.message || body}`));
            }
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Timeout HubSpot Lists (15s)'));
      });
      if (postData) req.write(postData);
      req.end();
    });
  }

  // Créer une liste dans HubSpot
  async createList(listName) {
    console.log(`📋 Création de la liste "${listName}"...`);
    
    try {
      const result = await this.makeRequest('/crm/v3/lists', 'POST', {
        name: listName,
        processingType: "MANUAL"
      });
      
      console.log(`   ✅ Liste créée ! ID: ${result.id}`);
      return result;
      
    } catch (error) {
      console.log(`   ❌ Erreur création liste: ${error.message}`);
      return null;
    }
  }

  // Trouver une liste par nom
  async findListByName(listName) {
    try {
      const result = await this.makeRequest('/crm/v3/lists/search', 'POST', {
        query: listName,
        count: 100
      });
      
      if (result.lists && result.lists.length > 0) {
        const exactMatch = result.lists.find(l => l.name === listName);
        return exactMatch || result.lists[0];
      }
      
      return null;
      
    } catch (error) {
      console.log(`   ⚠️  Erreur recherche liste: ${error.message}`);
      return null;
    }
  }

  // Créer ou récupérer une liste
  async getOrCreateList(listName) {
    console.log(`🔍 Recherche de la liste "${listName}"...`);
    
    // Chercher si elle existe
    const existing = await this.findListByName(listName);
    
    if (existing) {
      console.log(`   ✅ Liste trouvée ! ID: ${existing.id}`);
      return existing;
    }
    
    // Sinon créer
    return await this.createList(listName);
  }

  // Ajouter des contacts à une liste (VERSION CORRIGÉE)
  async addContactsToList(listId, contactIds) {
    console.log(`➕ Ajout de ${contactIds.length} contacts à la liste ${listId}...`);
    
    try {
      // Convertir en nombres (HubSpot veut des integers)
      const recordIds = contactIds.map(id => parseInt(id, 10));
      
      await this.makeRequest(`/crm/v3/lists/${listId}/memberships/add`, 'PUT', recordIds);
      
      console.log(`   ✅ ${contactIds.length} contacts ajoutés !`);
      return true;
      
    } catch (error) {
      console.log(`   ❌ Erreur ajout contacts: ${error.message}`);
      return false;
    }
  }
}

module.exports = HubSpotLists;

// Test
if (require.main === module) {
  const apiKey = process.env.HUBSPOT_API_KEY;
  
  if (!apiKey) {
    console.error('❌ HUBSPOT_API_KEY manquante !');
    process.exit(1);
  }
  
  const lists = new HubSpotLists(apiKey);
  
  lists.getOrCreateList('Leads Qualifiés FlowFast').then(list => {
    if (list) {
      console.log('\n✅ Succès !');
      console.log(`Liste : ${list.name}`);
      console.log(`ID : ${list.id}`);
    }
  });
}
