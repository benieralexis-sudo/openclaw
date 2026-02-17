// Autonomous Pilot - Executeur d'actions cross-skill
const storage = require('./storage.js');
const log = require('../../gateway/logger.js');

// --- Cross-skill imports (dual-path) ---

function _require(relativePath, absolutePath) {
  try { return require(relativePath); }
  catch (e) {
    try { return require(absolutePath); }
    catch (e2) { return null; }
  }
}

function getApolloConnector() {
  return _require('../flowfast/apollo-connector.js', '/app/skills/flowfast/apollo-connector.js');
}

function getFlowFastWorkflow() {
  return _require('../flowfast/flowfast-workflow.js', '/app/skills/flowfast/flowfast-workflow.js');
}

function getFlowFastStorage() {
  return _require('../flowfast/storage.js', '/app/skills/flowfast/storage.js');
}

function getFullEnrichEnricher() {
  return _require('../lead-enrich/fullenrich-enricher.js', '/app/skills/lead-enrich/fullenrich-enricher.js');
}

function getAIClassifier() {
  return _require('../lead-enrich/ai-classifier.js', '/app/skills/lead-enrich/ai-classifier.js');
}

function getLeadEnrichStorage() {
  return _require('../lead-enrich/storage.js', '/app/skills/lead-enrich/storage.js');
}

function getHubSpotClient() {
  return _require('../crm-pilot/hubspot-client.js', '/app/skills/crm-pilot/hubspot-client.js');
}

function getClaudeEmailWriter() {
  return _require('../automailer/claude-email-writer.js', '/app/skills/automailer/claude-email-writer.js');
}

function getResendClient() {
  return _require('../automailer/resend-client.js', '/app/skills/automailer/resend-client.js');
}

function getAutomailerStorage() {
  return _require('../automailer/storage.js', '/app/skills/automailer/storage.js');
}

class ActionExecutor {
  constructor(options) {
    this.apolloKey = options.apolloKey;
    this.fullenrichKey = options.fullenrichKey;
    this.hubspotKey = options.hubspotKey;
    this.openaiKey = options.openaiKey;
    this.claudeKey = options.claudeKey;
    this.resendKey = options.resendKey;
    this.senderEmail = options.senderEmail;
  }

  async executeAction(action) {
    const type = action.type;
    const params = action.params || {};

    try {
      switch (type) {
        case 'search_leads':
          return await this._searchLeads(params);
        case 'enrich_leads':
          return await this._enrichLeads(params);
        case 'push_to_crm':
          return await this._pushToCrm(params);
        case 'generate_email':
          return await this._generateEmail(params);
        case 'send_email':
          return await this._sendEmail(params);
        case 'update_search_criteria':
          return this._updateSearchCriteria(params);
        case 'update_goals':
          return this._updateGoals(params);
        case 'record_learning':
          return this._recordLearning(params);
        default:
          return { success: false, error: 'Action type inconnu: ' + type };
      }
    } catch (e) {
      log.error('action-executor', 'Erreur action ' + type + ':', e.message);
      return { success: false, error: e.message };
    }
  }

  // --- Recherche de leads via Apollo ---
  async _searchLeads(params) {
    if (!this.apolloKey) {
      return { success: false, error: 'Cle Apollo manquante' };
    }

    const ApolloConnector = getApolloConnector();
    if (!ApolloConnector) {
      return { success: false, error: 'Module FlowFast/apollo-connector introuvable' };
    }

    const apollo = new ApolloConnector(this.apolloKey);
    const criteria = params.criteria || storage.getGoals().searchCriteria;

    log.info('action-executor', 'Recherche leads:', JSON.stringify(criteria).substring(0, 200));
    const result = await apollo.searchLeads(criteria);

    if (!result.success) {
      return { success: false, error: 'Recherche Apollo echouee', details: result };
    }

    // Qualifier les leads avec AI
    const FlowFastWorkflow = getFlowFastWorkflow();
    const ffStorage = getFlowFastStorage();
    let qualified = 0;
    let saved = 0;
    const minScore = storage.getGoals().weekly.minLeadScore || 7;

    if (FlowFastWorkflow && result.leads) {
      const workflow = new FlowFastWorkflow(this.apolloKey, this.hubspotKey, this.openaiKey);

      // Mapper les champs Apollo (nouveau endpoint mixed_people/api_search)
      const mappedLeads = result.leads.map(l => ({
        apolloId: l.id,
        nom: (l.first_name || '') + (l.last_name ? ' ' + l.last_name : ''),
        first_name: l.first_name || '',
        last_name: l.last_name || '',
        titre: l.title || '',
        title: l.title || '',
        entreprise: l.organization?.name || '',
        organization: l.organization,
        email: l.email || null,
        linkedin_url: l.linkedin_url || null,
        localisation: l.city || l.state || l.country || '',
        hasEmail: l.has_email || false
      }));

      for (const lead of mappedLeads) {
        try {
          const scored = await workflow.qualifyLead(lead);
          lead.score = scored.score;
          lead.raison = scored.raison;
          if (scored.score >= minScore) qualified++;

          if (ffStorage) {
            ffStorage.addLead({
              nom: lead.nom || 'Inconnu',
              titre: lead.titre,
              entreprise: lead.entreprise,
              email: lead.email,
              linkedin: lead.linkedin_url,
              source: 'autonomous-pilot',
              searchCriteria: JSON.stringify(criteria).substring(0, 200)
            }, scored.score, 'brain-cycle');
            saved++;
          }
        } catch (e) {
          log.info('action-executor', 'Erreur qualification lead:', e.message);
        }
      }

      // Reveler les leads qualifies via Apollo people/match (1 credit chacun)
      const toReveal = mappedLeads.filter(l => !l.email && l.score >= minScore && l.apolloId);
      const leStorage = getLeadEnrichStorage();
      if (toReveal.length > 0) {
        log.info('action-executor', toReveal.length + ' leads qualifies a reveler via Apollo (1 credit chacun)');
        let revealed = 0;
        for (const lead of toReveal) {
          try {
            const revealResult = await apollo.revealLead(lead.apolloId);
            if (revealResult.success && revealResult.lead.email) {
              lead.email = revealResult.lead.email;
              lead.last_name = revealResult.lead.last_name;
              lead.nom = revealResult.lead.nom;
              lead.linkedin_url = revealResult.lead.linkedin_url;
              lead.localisation = revealResult.lead.city;
              revealed++;

              // Tracker le credit Apollo utilise
              if (leStorage) leStorage.trackApolloCredit();

              // Mettre a jour le lead sauvegarde avec l'email
              if (ffStorage) {
                ffStorage.addLead({
                  nom: lead.nom,
                  titre: lead.titre,
                  entreprise: lead.entreprise,
                  email: lead.email,
                  linkedin: lead.linkedin_url,
                  source: 'autonomous-pilot',
                  searchCriteria: JSON.stringify(criteria).substring(0, 200)
                }, lead.score, 'brain-cycle-revealed');
              }
            }
          } catch (e) {
            log.warn('action-executor', 'Erreur reveal lead:', e.message);
          }
        }
        log.info('action-executor', revealed + '/' + toReveal.length + ' leads reveles avec email');
        storage.incrementProgress('leadsEnrichedThisWeek', revealed);
      }
    }

    storage.incrementProgress('leadsFoundThisWeek', result.leads?.length || 0);

    return {
      success: true,
      total: result.leads?.length || 0,
      qualified: qualified,
      saved: saved,
      summary: (result.leads?.length || 0) + ' leads trouves, ' + qualified + ' qualifies (score >= ' + minScore + ')'
    };
  }

  // --- Enrichissement de leads via FullEnrich (waterfall 15+ sources) ---
  async _enrichLeads(params) {
    if (!this.fullenrichKey) {
      return { success: false, error: 'Cle FullEnrich manquante' };
    }

    const FullEnrichEnricher = getFullEnrichEnricher();
    const AIClassifier = getAIClassifier();
    const leStorage = getLeadEnrichStorage();

    if (!FullEnrichEnricher) {
      return { success: false, error: 'Module fullenrich-enricher introuvable' };
    }

    const enricher = new FullEnrichEnricher(this.fullenrichKey);
    const classifier = AIClassifier ? new AIClassifier(this.openaiKey) : null;

    // Accepter emails OU contacts avec nom+entreprise
    const contacts = params.contacts || [];
    const emails = params.emails || [];
    let enriched = 0;
    let classified = 0;

    // Si on a des contacts avec nom+entreprise, utiliser le batch FullEnrich
    if (contacts.length > 0) {
      try {
        const batchResult = await enricher.enrichBatch(contacts);
        if (batchResult.success) {
          for (const result of batchResult.results) {
            if (!result.success) continue;
            enriched++;
            const email = result.person.email;
            if (classifier && email) {
              try {
                const classification = await classifier.classifyLead(result);
                classified++;
                if (leStorage) leStorage.saveEnrichedLead(email, result, classification, 'autonomous-pilot');
              } catch (e) { log.warn('action-executor', 'Classification echouee pour ' + email + ':', e.message); }
            }
          }
        }
      } catch (e) {
        log.info('action-executor', 'Erreur enrichissement batch:', e.message);
      }
    }

    // Enrichir les emails un par un (fallback)
    for (const email of emails) {
      try {
        const result = await enricher.enrichByEmail(email);
        if (result.success) {
          enriched++;
          if (classifier) {
            const classification = await classifier.classifyLead(result);
            classified++;
            if (leStorage) leStorage.saveEnrichedLead(email, result, classification, 'autonomous-pilot');
          }
        }
      } catch (e) {
        log.info('action-executor', 'Erreur enrichissement ' + email + ':', e.message);
      }
    }

    storage.incrementProgress('leadsEnrichedThisWeek', enriched);

    return {
      success: true,
      total: contacts.length + emails.length,
      enriched: enriched,
      classified: classified,
      summary: enriched + '/' + (contacts.length + emails.length) + ' leads enrichis (FullEnrich)'
    };
  }

  // --- Push vers HubSpot CRM ---
  async _pushToCrm(params) {
    if (!this.hubspotKey) {
      return { success: false, error: 'Cle HubSpot manquante' };
    }

    const HubSpotClient = getHubSpotClient();
    if (!HubSpotClient) {
      return { success: false, error: 'Module crm-pilot/hubspot-client introuvable' };
    }

    const hubspot = new HubSpotClient(this.hubspotKey);
    const contacts = params.contacts || [];
    let created = 0;
    let deals = 0;

    for (const contact of contacts) {
      try {
        const existing = await hubspot.findContactByEmail(contact.email);
        if (existing) continue;

        const hsContact = await hubspot.createContact({
          firstname: contact.firstName || contact.nom?.split(' ')[0] || '',
          lastname: contact.lastName || contact.nom?.split(' ').slice(1).join(' ') || '',
          email: contact.email,
          jobtitle: contact.title || contact.titre || '',
          company: contact.company || contact.entreprise || '',
          phone: contact.phone || ''
        });
        created++;

        const minScore = storage.getGoals().weekly.pushToCrmAboveScore || 7;
        if ((contact.score || 0) >= minScore && hsContact && hsContact.id) {
          try {
            const deal = await hubspot.createDeal({
              dealname: (contact.company || contact.entreprise || 'Lead') + ' — Prospection',
              dealstage: 'appointmentscheduled',
              amount: params.dealAmount || 0
            });
            if (deal && deal.id) {
              await hubspot.associateDealToContact(deal.id, hsContact.id);
              deals++;
            }
          } catch (e) {
            log.info('action-executor', 'Erreur creation deal:', e.message);
          }
        }
      } catch (e) {
        log.info('action-executor', 'Erreur push CRM ' + contact.email + ':', e.message);
      }
    }

    storage.incrementProgress('contactsPushedThisWeek', created);
    storage.incrementProgress('dealsPushedThisWeek', deals);

    return {
      success: true,
      total: contacts.length,
      created: created,
      deals: deals,
      summary: created + ' contacts crees, ' + deals + ' deals crees dans HubSpot'
    };
  }

  // --- Generation d'email (sans envoi) ---
  async _generateEmail(params) {
    if (!this.claudeKey) {
      return { success: false, error: 'Cle Claude manquante' };
    }

    const ClaudeEmailWriter = getClaudeEmailWriter();
    if (!ClaudeEmailWriter) {
      return { success: false, error: 'Module automailer/claude-email-writer introuvable' };
    }

    const writer = new ClaudeEmailWriter(this.claudeKey);
    const contact = params.contact || {};
    const config = storage.getConfig();

    // Construire un contexte enrichi avec les preferences email
    let context = config.businessContext || 'prospection B2B';
    const ep = config.emailPreferences || {};
    if (ep.maxLines) context += '\n\nREGLE: Email de ' + ep.maxLines + ' lignes MAXIMUM.';
    if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
      context += '\nMOTS INTERDITS: ' + ep.forbiddenWords.join(', ') + '. NE JAMAIS les utiliser.';
    }
    if (ep.hookStyle) context += '\nSTYLE ACCROCHE: ' + ep.hookStyle;
    if (ep.tone) context += '\nTON: ' + ep.tone;
    if (ep.language === 'fr') context += '\nLANGUE: francais obligatoire';

    // Ajouter l'offre commerciale
    const offer = config.offer || {};
    if (offer.description) context += '\nOFFRE: ' + offer.description;
    if (offer.monthly) context += ' (' + offer.monthly + ' EUR/mois)';
    if (offer.trial) context += '\nESSAI GRATUIT: ' + offer.trial;

    try {
      const email = await writer.generateSingleEmail(contact, context);
      return {
        success: true,
        email: email,
        summary: 'Email genere pour ' + (contact.email || 'inconnu') + ': "' +
          (email.subject || '').substring(0, 50) + '"'
      };
    } catch (e) {
      return { success: false, error: 'Generation email echouee: ' + e.message };
    }
  }

  // --- Envoi d'email (apres confirmation) ---
  async _sendEmail(params) {
    if (!this.resendKey) {
      return { success: false, error: 'Cle Resend manquante' };
    }

    const ResendClient = getResendClient();
    if (!ResendClient) {
      return { success: false, error: 'Module automailer/resend-client introuvable' };
    }

    const resend = new ResendClient(this.resendKey);
    const amStorage = getAutomailerStorage();

    try {
      const result = await resend.sendEmail(
        params.to,
        params.subject,
        params.body,
        { from: this.senderEmail }
      );

      if (result.success) {
        if (amStorage) {
          amStorage.saveEmail({
            to: params.to,
            subject: params.subject,
            body: params.body,
            resendId: result.id || null,
            status: 'sent',
            source: 'autonomous-pilot',
            contactName: params.contactName || '',
            company: params.company || '',
            score: params.score || 0,
            sentAt: new Date().toISOString()
          });
        }

        storage.incrementProgress('emailsSentThisWeek', 1);

        return {
          success: true,
          resendId: result.id,
          summary: 'Email envoye a ' + params.to
        };
      }

      return {
        success: false,
        error: 'Resend erreur: ' + (result.error || 'Erreur inconnue')
      };
    } catch (e) {
      return { success: false, error: 'Envoi echoue: ' + e.message };
    }
  }

  // --- Mise a jour des criteres de recherche ---
  _updateSearchCriteria(params) {
    const updates = {};
    if (params.titles && Array.isArray(params.titles)) updates.titles = params.titles;
    if (params.locations && Array.isArray(params.locations)) updates.locations = params.locations;
    if (params.industries && Array.isArray(params.industries)) updates.industries = params.industries;
    if (params.seniorities && Array.isArray(params.seniorities)) updates.seniorities = params.seniorities;
    if (params.companySize && Array.isArray(params.companySize)) updates.companySize = params.companySize;
    if (params.keywords !== undefined) updates.keywords = params.keywords;
    if (params.limit && typeof params.limit === 'number') updates.limit = params.limit;

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'Aucune modification valide' };
    }

    const result = storage.updateSearchCriteria(updates);
    const changes = Object.keys(updates).map(k => k + ': ' + JSON.stringify(updates[k]).substring(0, 60)).join(', ');

    log.info('action-executor', 'Criteres mis a jour:', changes);

    return {
      success: true,
      updated: updates,
      summary: 'Criteres mis a jour: ' + changes
    };
  }

  // --- Mise a jour des objectifs ---
  _updateGoals(params) {
    const updates = {};
    if (params.leadsToFind && typeof params.leadsToFind === 'number') updates.leadsToFind = params.leadsToFind;
    if (params.emailsToSend && typeof params.emailsToSend === 'number') updates.emailsToSend = params.emailsToSend;
    if (params.responsesTarget && typeof params.responsesTarget === 'number') updates.responsesTarget = params.responsesTarget;
    if (params.rdvTarget && typeof params.rdvTarget === 'number') updates.rdvTarget = params.rdvTarget;
    if (params.minLeadScore && typeof params.minLeadScore === 'number') updates.minLeadScore = params.minLeadScore;
    if (params.minOpenRate && typeof params.minOpenRate === 'number') updates.minOpenRate = params.minOpenRate;

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'Aucune modification valide' };
    }

    const result = storage.updateWeeklyGoals(updates);
    const changes = Object.keys(updates).map(k => k + ': ' + updates[k]).join(', ');

    log.info('action-executor', 'Objectifs mis a jour:', changes);

    return {
      success: true,
      updated: updates,
      summary: 'Objectifs mis a jour: ' + changes
    };
  }

  // --- Enregistrer un apprentissage ---
  _recordLearning(params) {
    const category = params.category || 'bestSearchCriteria';
    const validCategories = ['bestSearchCriteria', 'bestEmailStyles', 'bestSendTimes'];
    if (!validCategories.includes(category)) {
      return { success: false, error: 'Categorie invalide: ' + category };
    }

    storage.addLearning(category, {
      summary: params.summary || '',
      data: params.data || {},
      source: 'brain_action'
    });

    log.info('action-executor', 'Learning enregistre [' + category + ']: ' + (params.summary || '').substring(0, 100));

    return {
      success: true,
      summary: 'Apprentissage enregistre: ' + (params.summary || category)
    };
  }
}

module.exports = ActionExecutor;
