// FlowFast - Workflow complet Apollo → IA → HubSpot
const ApolloConnector = require('./apollo-connector.js');
const HubSpotConnector = require('./hubspot-connector.js');
const https = require('https');

class FlowFastWorkflow {
  constructor(apolloKey, hubspotKey, openaiKey) {
    this.apollo = new ApolloConnector(apolloKey);
    this.hubspot = new HubSpotConnector(hubspotKey);
    this.openaiKey = openaiKey;
  }

  // Qualifier un lead avec l'IA
  async qualifyLead(lead) {
    console.log(`🤖 Qualification IA de ${lead.nom}...`);
    
    const prompt = `Évalue ce lead B2B et réponds UNIQUEMENT avec un objet JSON, sans texte avant ou après.

Lead :
- Nom : ${lead.nom}
- Titre : ${lead.titre}
- Entreprise : ${lead.entreprise}
- Localisation : ${lead.localisation}

Évalue sur 10 selon :
1. Seniority (CEO/CTO = 10, Manager = 7, Junior = 3)
2. Pertinence entreprise (Tech/SaaS = +2 bonus)
3. Localisation (France = +1, Europe = +0.5)

Format JSON strict :
{"score":8,"raison":"CEO dans tech à Paris","recommandation":"contacter"}

Réponds UNIQUEMENT le JSON, rien d'autre :`;

    try {
      const response = await this.callOpenAI(prompt);
      
      // Nettoyer la réponse (enlever markdown, espaces, etc.)
      let cleaned = response.trim();
      
      // Enlever les backticks markdown si présents
      cleaned = cleaned.replace(/```json\n?/g, '');
      cleaned = cleaned.replace(/```\n?/g, '');
      cleaned = cleaned.trim();
      
      // Parser le JSON
      const result = JSON.parse(cleaned);
      
      console.log(`   📊 Score : ${result.score}/10`);
      console.log(`   💡 Raison : ${result.raison}`);
      console.log(`   ✅ Action : ${result.recommandation}`);
      
      return result;
      
    } catch (error) {
      console.log(`   ⚠️  Erreur IA (${error.message}), scoring fallback`);
      
      // Fallback : scoring simple basé sur le titre
      const titre = lead.titre.toLowerCase();
      let score = 5;
      
      if (titre.includes('ceo') || titre.includes('founder') || titre.includes('president')) {
        score = 9;
      } else if (titre.includes('cto') || titre.includes('cfo') || titre.includes('vp')) {
        score = 8;
      } else if (titre.includes('director') || titre.includes('head')) {
        score = 7;
      } else if (titre.includes('manager')) {
        score = 6;
      } else if (titre.includes('junior') || titre.includes('intern')) {
        score = 3;
      }
      
      console.log(`   🎯 Score fallback : ${score}/10 (basé sur titre)`);
      
      return { 
        score: score, 
        raison: `Évaluation basée sur titre: ${lead.titre}`, 
        recommandation: score >= 6 ? "contacter" : "skip" 
      };
    }
  }

  // Appeler l'API OpenAI
  callOpenAI(prompt) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 200
      });

      const options = {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiKey}`,
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (response.choices && response.choices[0]) {
              resolve(response.choices[0].message.content);
            } else {
              reject(new Error('Invalid OpenAI response'));
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  // Ajouter des contacts à une liste HubSpot
  async addContactsToList(listId, contactIds) {
    if (contactIds.length === 0) return;
    
    console.log(`📋 Ajout de ${contactIds.length} contacts à la liste ${listId}...`);
    
    try {
      const HubSpotLists = require('./hubspot-lists.js');
      const lists = new HubSpotLists(this.hubspot.apiKey);
      
      await lists.addContactsToList(listId, contactIds);
      console.log(`   ✅ Contacts ajoutés !`);
      
    } catch (error) {
      console.log(`   ⚠️  Erreur ajout liste: ${error.message}`);
    }
  }

  // Workflow complet avec 2 listes (prioritaire et qualifié)
  async processLeads(leads, minScore = 6) {
    console.log('\n🚀 DÉMARRAGE WORKFLOW FLOWFAST\n');
    console.log(`📊 ${leads.length} leads à traiter`);
    console.log(`🎯 Score minimum : ${minScore}/10`);
    console.log(`🔥 Score prioritaire : 8+/10\n`);

    const results = {
      total: leads.length,
      qualified: 0,
      priority: 0,
      created: 0,
      skipped: 0,
      errors: 0
    };

    const priorityContacts = []; // Score ≥ 8
    const qualifiedContacts = []; // Score 6-7

    for (const lead of leads) {
      console.log(`\n--- Lead ${results.qualified + results.skipped + results.errors + 1}/${leads.length} ---`);
      console.log(`👤 ${lead.nom} - ${lead.titre} @ ${lead.entreprise}`);

      // 1. Qualification IA
      const qualification = await this.qualifyLead(lead);
      
      if (qualification.score < minScore) {
        console.log(`   ⏭️  Skip (score ${qualification.score} < ${minScore})`);
        results.skipped++;
        continue;
      }

      results.qualified++;

      // Déterminer la liste
      const isPriority = qualification.score >= 8;
      if (isPriority) {
        results.priority++;
        console.log(`   🔥 PRIORITAIRE !`);
      }

      // 2. Création HubSpot
      const hubspotResult = await this.hubspot.upsertContact({
        prenom: lead.prenom,
        nom: lead.nom_famille,
        email: lead.email,
        titre: lead.titre,
        entreprise: lead.entreprise,
        ville: lead.localisation
      });

      if (hubspotResult.success) {
        if (hubspotResult.existed) {
          console.log(`   ℹ️  Déjà existant dans HubSpot`);
        } else {
          console.log(`   ✅ Créé dans HubSpot (ID: ${hubspotResult.contactId})`);
        }
        results.created++;

        // Ajouter à la bonne liste
        if (hubspotResult.contactId) {
          if (isPriority) {
            priorityContacts.push(hubspotResult.contactId);
          } else {
            qualifiedContacts.push(hubspotResult.contactId);
          }
        }
      } else {
        console.log(`   ❌ Erreur HubSpot: ${hubspotResult.error}`);
        results.errors++;
      }

      // Pause pour éviter rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 3. Ajouter aux listes HubSpot
    console.log('\n\n📋 AJOUT AUX LISTES HUBSPOT');
    console.log('============================');
    
    if (priorityContacts.length > 0) {
      console.log(`🔥 Leads prioritaires (≥8/10) → Liste "Leads à contacter en priorité"`);
      await this.addContactsToList('16', priorityContacts);
    }
    
    if (qualifiedContacts.length > 0) {
      console.log(`✅ Leads qualifiés (6-7/10) → Liste "Leads Qualifiés"`);
      await this.addContactsToList('14', qualifiedContacts);
    }

    console.log('\n\n📊 RÉSULTATS FINAUX');
    console.log('==================');
    console.log(`Total traités        : ${results.total}`);
    console.log(`Qualifiés (≥${minScore}/10)   : ${results.qualified}`);
    console.log(`  └─ Prioritaires 🔥 : ${results.priority} (score ≥8)`);
    console.log(`  └─ Qualifiés ✅    : ${results.qualified - results.priority} (score 6-7)`);
    console.log(`Créés HubSpot        : ${results.created}`);
    console.log(`Skippés              : ${results.skipped}`);
    console.log(`Erreurs              : ${results.errors}`);
    console.log('\n✅ Workflow terminé !\n');

    return results;
  }
}

// Export
module.exports = FlowFastWorkflow;

// Test avec des données simulées
if (require.main === module) {
  const apolloKey = process.env.APOLLO_API_KEY;
  const hubspotKey = process.env.HUBSPOT_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!hubspotKey || !openaiKey) {
    console.error('❌ Clés manquantes !');
    process.exit(1);
  }

  const workflow = new FlowFastWorkflow(apolloKey, hubspotKey, openaiKey);

  // Leads de démonstration avec différents scores
  const demoLeads = [
    {
      nom: 'Marie Dubois',
      prenom: 'Marie',
      nom_famille: 'Dubois',
      titre: 'CEO',
      entreprise: 'TechStart Paris',
      email: 'marie.dubois@techstart.fr',
      localisation: 'Paris, France'
    },
    {
      nom: 'Jean Martin',
      prenom: 'Jean',
      nom_famille: 'Martin',
      titre: 'Junior Developer',
      entreprise: 'SmallCorp',
      email: 'jean.martin@smallcorp.fr',
      localisation: 'Lyon, France'
    },
    {
      nom: 'Sophie Laurent',
      prenom: 'Sophie',
      nom_famille: 'Laurent',
      titre: 'CTO',
      entreprise: 'InnovateTech',
      email: 'sophie.laurent@innovatetech.fr',
      localisation: 'Marseille, France'
    },
    {
      nom: 'Pierre Durand',
      prenom: 'Pierre',
      nom_famille: 'Durand',
      titre: 'VP Sales',
      entreprise: 'SalesTech Pro',
      email: 'pierre.durand@salestech.fr',
      localisation: 'Nice, France'
    },
    {
      nom: 'Julie Bernard',
      prenom: 'Julie',
      nom_famille: 'Bernard',
      titre: 'Sales Manager',
      entreprise: 'BizDev Corp',
      email: 'julie.bernard@bizdev.fr',
      localisation: 'Bordeaux, France'
    }
  ];

  console.log('🧪 TEST WORKFLOW FLOWFAST avec segmentation intelligente\n');
  
  workflow.processLeads(demoLeads, 6).then(results => {
    console.log('✅ Test terminé !');
  }).catch(error => {
    console.error('❌ Erreur workflow:', error);
  });
}
