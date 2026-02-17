// FlowFast - Workflow complet Apollo → IA → HubSpot
const ApolloConnector = require('./apollo-connector.js');
const { callOpenAI: sharedCallOpenAI } = require('../../gateway/shared-nlp.js');

// Utilise le HubSpotClient centralise de CRM Pilot
function _getHubSpotClient() {
  try { return require('../crm-pilot/hubspot-client.js'); }
  catch (e) {
    try { return require('/app/skills/crm-pilot/hubspot-client.js'); }
    catch (e2) { return null; }
  }
}

// Wrapper de compatibilite : interface FlowFast (prenom/nom/entreprise) → CRM Pilot (firstname/lastname/company)
class HubSpotCompat {
  constructor(apiKey) {
    const HubSpotClient = _getHubSpotClient();
    this.client = HubSpotClient ? new HubSpotClient(apiKey) : null;
    this.apiKey = apiKey;
  }

  async upsertContact(contactData) {
    if (!this.client) return { success: false, error: 'HubSpot client non disponible' };
    const existing = await this.client.findContactByEmail(contactData.email);
    if (existing) return { success: true, existed: true, contactId: existing.id };
    const result = await this.client.createContact({
      firstname: contactData.prenom || '',
      lastname: contactData.nom || contactData.nom_famille || '',
      email: contactData.email,
      jobtitle: contactData.titre || '',
      company: contactData.entreprise || '',
      phone: contactData.telephone || '',
      city: contactData.ville || ''
    });
    return result ? { success: true, contactId: result.id } : { success: false, error: 'Echec creation' };
  }
}

class FlowFastWorkflow {
  constructor(apolloKey, hubspotKey, openaiKey) {
    this.apollo = new ApolloConnector(apolloKey);
    this.hubspot = new HubSpotCompat(hubspotKey);
    this.openaiKey = openaiKey;
  }

  // Sanitize une valeur avant injection dans un prompt IA
  _sanitizeForPrompt(val) {
    if (!val || typeof val !== 'string') return 'N/A';
    return val.replace(/[{}"\\`$]/g, '').substring(0, 200);
  }

  // Qualifier un lead avec l'IA
  async qualifyLead(lead) {
    console.log(`🤖 Qualification IA de ${lead.nom}...`);

    const sNom = this._sanitizeForPrompt(lead.nom);
    const sTitre = this._sanitizeForPrompt(lead.titre);
    const sEntreprise = this._sanitizeForPrompt(lead.entreprise);
    const sLocalisation = this._sanitizeForPrompt(lead.localisation);

    const prompt = `Evalue ce lead B2B pour une agence d'automatisation IA (iFIND). Reponds UNIQUEMENT en JSON strict.

Lead :
- Nom : ${sNom}
- Titre : ${sTitre}
- Entreprise : ${sEntreprise}
- Localisation : ${sLocalisation}

Grille de scoring (sur 10, SOIS STRICT et DISCRIMINANT) :
- Pouvoir de decision : decision-maker direct = 3pts, influence = 2pts, executant = 1pt
- Taille entreprise estimee : PME 10-250 salaries = 3pts (cible ideale), startup <10 = 1pt, grand groupe >500 = 2pts
- Besoin potentiel en automatisation IA : fort (tech/SaaS/ecommerce/marketing) = 2pts, moyen = 1pt, faible (artisan/asso) = 0pt
- Localisation : France = 2pts, Europe = 1pt, autre = 0pt

EXEMPLES de calibration :
- CEO PME SaaS Paris = 10/10 (decision + PME + besoin fort + France)
- CTO startup 3 personnes Lyon = 7/10 (decision + startup petite + besoin fort + France)
- Marketing Manager grand groupe = 5/10 (influence seulement + grand groupe + besoin moyen + France)
- Freelance consultant = 3/10 (pas de budget entreprise)
- Titre inconnu, entreprise inconnue = 4/10

Format JSON strict :
{"score":7,"raison":"CTO startup tech Lyon, bon profil mais petite structure","recommandation":"contacter"}

Reponds UNIQUEMENT le JSON :`;

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

  // Appeler l'API OpenAI (via module partage)
  async callOpenAI(prompt) {
    const result = await sharedCallOpenAI(this.openaiKey, [
      { role: 'user', content: prompt }
    ], { maxTokens: 200, temperature: 0.3 });
    return result.content;
  }

  // Ajouter des contacts à une liste HubSpot
  async addContactsToList(listId, contactIds) {
    if (contactIds.length === 0) return;
    
    console.log(`📋 Ajout de ${contactIds.length} contacts à la liste ${listId}...`);
    
    try {
      // HubSpot Lists API — appel direct via le client CRM Pilot
      const HubSpotClient = _getHubSpotClient();
      if (HubSpotClient) {
        const client = new HubSpotClient(this.hubspot.apiKey);
        if (client.addContactsToList) {
          await client.addContactsToList(listId, contactIds);
          console.log(`   Contacts ajoutes a la liste !`);
        }
      }
    } catch (error) {
      console.log(`   Erreur ajout liste: ${error.message}`);
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
