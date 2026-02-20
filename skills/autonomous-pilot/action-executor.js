// Autonomous Pilot - Executeur d'actions cross-skill
const crypto = require('crypto');
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

function getFlowFastStorage() {
  return _require('../flowfast/storage.js', '/app/skills/flowfast/storage.js');
}

// NLP partage pour scoring leads (anciennement dans FlowFast workflow)
function _getSharedNLP() {
  return _require('../../gateway/shared-nlp.js', '/app/gateway/shared-nlp.js');
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

function getProspectResearcher() {
  return _require('./prospect-researcher.js', '/app/skills/autonomous-pilot/prospect-researcher.js');
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
    this.campaignEngine = options.campaignEngine || null;
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
        case 'create_followup_sequence':
          return await this._createFollowUpSequence(params);
        default:
          return { success: false, error: 'Action type inconnu: ' + type };
      }
    } catch (e) {
      log.error('action-executor', 'Erreur action ' + type + ':', e.message);
      return { success: false, error: e.message };
    }
  }

  // --- Qualification IA d'un lead (scoring GPT-4o-mini) ---
  async _qualifyLead(lead) {
    const sharedNLP = _getSharedNLP();
    if (!sharedNLP || !this.openaiKey) {
      // Fallback sans IA
      return this._qualifyLeadFallback(lead);
    }

    const sanitize = (val) => (!val || typeof val !== 'string') ? 'N/A' : val.replace(/[{}"\\`$]/g, '').substring(0, 200);
    const prompt = `Evalue ce lead B2B pour une agence d'automatisation IA (iFIND). Reponds UNIQUEMENT en JSON strict.

Lead :
- Nom : ${sanitize(lead.nom)}
- Titre : ${sanitize(lead.titre)}
- Entreprise : ${sanitize(lead.entreprise)}
- Localisation : ${sanitize(lead.localisation)}

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

Format JSON strict :
{"score":7,"raison":"CTO startup tech Lyon, bon profil mais petite structure","recommandation":"contacter"}`;

    try {
      const result = await sharedNLP.callOpenAI(this.openaiKey, [{ role: 'user', content: prompt }], { maxTokens: 200, temperature: 0.3 });
      let cleaned = (result.content || '').trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      log.info('action-executor', 'Scoring IA echoue (' + e.message + '), fallback');
      return this._qualifyLeadFallback(lead);
    }
  }

  _qualifyLeadFallback(lead) {
    const titre = (lead.titre || '').toLowerCase();
    let score = 5;
    if (titre.includes('ceo') || titre.includes('founder') || titre.includes('president')) score = 9;
    else if (titre.includes('cto') || titre.includes('cfo') || titre.includes('vp')) score = 8;
    else if (titre.includes('director') || titre.includes('head')) score = 7;
    else if (titre.includes('manager')) score = 6;
    else if (titre.includes('junior') || titre.includes('intern')) score = 3;
    return { score, raison: 'Scoring fallback titre: ' + (lead.titre || 'inconnu'), recommandation: score >= 6 ? 'contacter' : 'skip' };
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

    // Qualifier les leads avec AI (scoring direct, sans FlowFast)
    const ffStorage = getFlowFastStorage();
    let qualified = 0;
    let saved = 0;
    const minScore = storage.getGoals().weekly.minLeadScore || 7;

    if (result.leads) {

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
          const scored = await this._qualifyLead(lead);
          lead.score = scored.score;
          lead.raison = scored.raison;
          if (scored.score >= minScore) qualified++;

          if (ffStorage) {
            // Ne sauvegarder que si le lead a un email OU un score suffisant
            // (evite de creer des entrees orphelines nom_entreprise)
            if (lead.email || scored.score >= minScore) {
              ffStorage.addLead({
                nom: lead.nom || 'Inconnu',
                titre: lead.titre,
                entreprise: lead.entreprise,
                email: lead.email,
                linkedin: lead.linkedin_url,
                source: 'autonomous-pilot',
                raison: scored.raison || '',
                recommandation: scored.recommandation || '',
                searchCriteria: JSON.stringify(criteria).substring(0, 200),
                organizationData: JSON.stringify(lead.organization || {}).substring(0, 2000)
              }, scored.score, 'brain-cycle');
              saved++;
            }
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

              // Supprimer l'ancienne entree sans email (cle nom_entreprise) pour eviter les doublons
              if (ffStorage) {
                const oldKey = (lead.nom || '') + '_' + (lead.entreprise || '');
                if (ffStorage.removeLead) ffStorage.removeLead(oldKey);

                ffStorage.addLead({
                  nom: lead.nom,
                  titre: lead.titre,
                  entreprise: lead.entreprise,
                  email: lead.email,
                  linkedin: lead.linkedin_url,
                  source: 'autonomous-pilot',
                  raison: lead.raison || '',
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
        if (existing) {
          // Marquer comme pousse meme si deja dans HubSpot (evite re-push)
          const ffS = getFlowFastStorage();
          if (ffS && ffS.setLeadPushed) {
            const pushed = ffS.setLeadPushed(contact.email);
            if (!pushed) log.warn('action-executor', 'setLeadPushed: lead non trouve pour ' + contact.email);
          }
          log.info('action-executor', 'Contact ' + contact.email + ' deja dans HubSpot — marque comme pousse');
          continue;
        }

        const hsContact = await hubspot.createContact({
          firstname: contact.firstName || contact.nom?.split(' ')[0] || '',
          lastname: contact.lastName || contact.nom?.split(' ').slice(1).join(' ') || '',
          email: contact.email,
          jobtitle: contact.title || contact.titre || '',
          company: contact.company || contact.entreprise || '',
          phone: contact.phone || ''
        });
        created++;

        // Marquer le lead comme pousse dans FlowFast storage
        const ffStorage2 = getFlowFastStorage();
        if (ffStorage2 && ffStorage2.setLeadPushed) {
          const pushed = ffStorage2.setLeadPushed(contact.email);
          if (!pushed) log.warn('action-executor', 'setLeadPushed apres creation: lead non trouve pour ' + contact.email);
        }

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
    const rawContact = params.contact || {};
    const config = storage.getConfig();

    // Mapper les champs FR vers EN pour le writer
    const contact = {
      name: rawContact.nom || rawContact.name || '',
      firstName: (rawContact.nom || rawContact.name || '').split(' ')[0],
      title: rawContact.titre || rawContact.title || '',
      company: rawContact.entreprise || rawContact.company || '',
      email: rawContact.email || params.to || ''
    };

    // Construire un contexte enrichi — SANS pitch commercial (premier email = ouvrir une conversation)
    let context = 'MISSION: Premier contact. Ouvrir une conversation, PAS vendre. Aucun pitch.';
    context += '\nQUI TU ES: Alexis, fondateur — prospection B2B.';
    context += '\nREGLE ABSOLUE: Ne mentionne PAS de prix, PAS d\'offre, PAS de "pilote gratuit".';

    const ep = config.emailPreferences || {};
    if (ep.maxLines) context += '\nLONGUEUR: ' + ep.maxLines + ' lignes MAXIMUM.';
    if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
      context += '\nMOTS INTERDITS (ne JAMAIS utiliser): ' + ep.forbiddenWords.join(', ');
    }
    if (ep.tone) context += '\nTON: ' + ep.tone;

    // Injecter les informations de recherche prospect — structurees et prioritaires
    if (params._prospectIntel) {
      context += '\n\n=== DONNEES PROSPECT (OBLIGATOIRE — base ton email sur ces faits) ===\n' + params._prospectIntel;
      context += '\n=== FIN DONNEES PROSPECT ===';
      context += '\nINSTRUCTION: Utilise les donnees ci-dessus pour une observation SPECIFIQUE. Si elles sont trop vagues pour ca, retourne {"skip": true, "reason": "..."}.';
    } else {
      context += '\n\nATTENTION: Aucune donnee prospect disponible. Retourne {"skip": true, "reason": "pas de donnees prospect"}.';
    }

    // Signature ajoutee automatiquement par resend-client.js (HTML minimal)
    context += '\nSIGNATURE: NE PAS ajouter de signature — elle est ajoutee automatiquement apres le corps du mail.';

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

    // Validation format email
    if (!params.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.to)) {
      return { success: false, error: 'Adresse email invalide: ' + (params.to || 'vide') };
    }

    // Rate limiting : delai aleatoire 2-5 min entre chaque envoi (pattern humain)
    if (ActionExecutor._lastSendTime) {
      const minDelay = 2 * 60 * 1000; // 2 min
      const maxDelay = 5 * 60 * 1000; // 5 min
      const randomDelay = minDelay + Math.floor(Math.random() * (maxDelay - minDelay));
      const elapsed = Date.now() - ActionExecutor._lastSendTime;
      if (elapsed < randomDelay) {
        const waitMs = randomDelay - elapsed;
        log.info('action-executor', 'Rate limiting humain: attente ' + Math.round(waitMs / 1000) + 's avant prochain envoi');
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
    ActionExecutor._lastSendTime = Date.now();

    // Warm-up domaine : limiter les envois par jour (domaine neuf = max 5/jour semaine 1-2, puis 10, puis 20)
    const amStorage = getAutomailerStorage();
    if (amStorage) {
      // FIX 19 : Utiliser les compteurs persistants au lieu du filtre dynamique
      const sentToday = amStorage.getTodaySendCount();

      // Domaine getifind.fr cree le 20 fev 2026 — calculer l'age en jours
      const domainAge = Math.floor((Date.now() - new Date('2026-02-20').getTime()) / (24 * 60 * 60 * 1000));
      let dailyLimit = 5; // Semaine 1-2
      if (domainAge > 14) dailyLimit = 10;
      if (domainAge > 28) dailyLimit = 20;
      if (domainAge > 56) dailyLimit = 50;

      if (sentToday >= dailyLimit) {
        log.info('action-executor', 'Warm-up: ' + sentToday + '/' + dailyLimit + ' emails envoyes aujourd\'hui (domaine age: ' + domainAge + 'j) — limite atteinte');
        return { success: false, error: 'Limite warm-up atteinte (' + dailyLimit + '/jour)', warmupLimited: true };
      }
      log.info('action-executor', 'Warm-up: ' + sentToday + '/' + dailyLimit + ' emails aujourd\'hui (domaine age: ' + domainAge + 'j)');
    }

    // Deduplication : verifier si un email a deja ete envoye a cette adresse
    if (amStorage && params.to) {
      const existing = amStorage.getEmailEventsForRecipient(params.to);
      const alreadySent = existing.some(e => e.status === 'sent' || e.status === 'delivered' || e.status === 'opened' || e.status === 'replied');
      if (alreadySent) {
        log.info('action-executor', 'Email deja envoye a ' + params.to + ' — skip (deduplication)');
        return { success: false, error: 'Email deja envoye a ' + params.to, deduplicated: true };
      }
      // Verifier la blacklist
      if (amStorage.isBlacklisted(params.to)) {
        log.info('action-executor', params.to + ' est blackliste — skip');
        return { success: false, error: params.to + ' est blackliste' };
      }
    }

    // Verification statut email (FullEnrich) — bloquer les INVALID avant de depenser un appel Claude
    const leStorageCheck = getLeadEnrichStorage();
    if (leStorageCheck) {
      const enriched = leStorageCheck.getEnrichedLead(params.to);
      if (enriched && enriched.enrichData && enriched.enrichData._fullenrich) {
        const emailStatus = enriched.enrichData._fullenrich.emailStatus;
        if (emailStatus === 'INVALID' || emailStatus === 'INVALID_DOMAIN') {
          log.info('action-executor', params.to + ' emailStatus=' + emailStatus + ' — skip (invalide)');
          return { success: false, error: 'Email invalide (FullEnrich: ' + emailStatus + ')', invalidEmail: true };
        }
        if (emailStatus === 'CATCH_ALL') {
          log.warn('action-executor', params.to + ' emailStatus=CATCH_ALL — envoi avec prudence');
        }
      }
    }

    // Si _generateFirst est true, generer le contenu avant envoi
    if (params._generateFirst && (!params.subject || !params.body)) {
      // Recherche pre-envoi sur le prospect (scrape site, news, Apollo data)
      try {
        const ProspectResearcher = getProspectResearcher();
        if (ProspectResearcher) {
          const researcher = new ProspectResearcher({ claudeKey: this.claudeKey });
          const intel = await researcher.researchProspect({
            email: params.to,
            nom: params.contactName || (params.contact && params.contact.nom),
            entreprise: params.company || (params.contact && params.contact.entreprise),
            titre: params.contact && params.contact.titre,
            organization: params.contact && params.contact.organization
          });
          if (intel && intel.brief) {
            params._prospectIntel = intel.brief;
          }
        }
      } catch (e) {
        log.warn('action-executor', 'Recherche prospect echouee (non bloquant):', e.message);
      }

      log.info('action-executor', 'Generation email avant envoi pour ' + params.to);
      const genResult = await this._generateEmail(params);
      if (!genResult.success || !genResult.email) {
        return { success: false, error: 'Generation email echouee: ' + (genResult.error || 'pas de contenu') };
      }
      // Si le writer retourne skip:true = donnees insuffisantes pour personnalisation
      if (genResult.email.skip) {
        log.info('action-executor', 'Email skip pour ' + params.to + ': ' + (genResult.email.reason || 'donnees insuffisantes'));
        return { success: false, error: 'Donnees insuffisantes pour email personnalise', skipped: true };
      }
      params.subject = genResult.email.subject;
      params.body = genResult.email.body || genResult.email.text || genResult.email.html || '';
    }

    if (!params.subject || !params.body) {
      return { success: false, error: 'Subject et body requis pour envoyer un email' };
    }

    // Validation post-generation : verifier mots interdits
    const config = storage.getConfig();
    const epCheck = config.emailPreferences || {};
    if (epCheck.forbiddenWords && epCheck.forbiddenWords.length > 0) {
      const emailText = (params.subject + ' ' + params.body).toLowerCase();
      const foundWords = epCheck.forbiddenWords.filter(w => emailText.includes(w.toLowerCase()));
      if (foundWords.length > 0) {
        log.warn('action-executor', 'Mots interdits detectes dans email: ' + foundWords.join(', ') + ' — regeneration');
        // Regenerer avec instruction explicite d'eviter ces mots
        params._prospectIntel = (params._prospectIntel || '') +
          '\nATTENTION CRITIQUE: l\'email precedent contenait ces mots INTERDITS: ' + foundWords.join(', ') +
          '. Tu ne dois ABSOLUMENT PAS les utiliser. Reformule completement.';
        params.subject = null;
        params.body = null;
        const retryGen = await this._generateEmail(params);
        if (retryGen.success && retryGen.email && !retryGen.email.skip) {
          params.subject = retryGen.email.subject;
          params.body = retryGen.email.body || retryGen.email.text || '';
          // 2e verification
          const retryText = (params.subject + ' ' + params.body).toLowerCase();
          const stillFound = epCheck.forbiddenWords.filter(w => retryText.includes(w.toLowerCase()));
          if (stillFound.length > 0) {
            log.error('action-executor', 'Mots interdits persistants apres retry: ' + stillFound.join(', ') + ' — envoi bloque');
            return { success: false, error: 'Mots interdits persistants: ' + stillFound.join(', ') };
          }
        } else {
          return { success: false, error: 'Regeneration email echouee apres detection mots interdits' };
        }
      }
    }

    const ResendClient = getResendClient();
    if (!ResendClient) {
      return { success: false, error: 'Module automailer/resend-client introuvable' };
    }

    const resend = new ResendClient(this.resendKey, this.senderEmail);
    // amStorage deja obtenu en haut pour la deduplication

    // Generer un tracking ID unique pour le pixel d'ouverture
    const trackingId = crypto.randomBytes(16).toString('hex');

    try {
      const result = await resend.sendEmail(
        params.to,
        params.subject,
        params.body,
        { replyTo: 'hello@ifind.fr', fromName: 'Alexis', trackingId: trackingId }
      );

      if (result.success) {
        // Recuperer le chatId admin depuis la config AP
        const apConfig = storage.getConfig();
        const adminChatId = apConfig.adminChatId || '1409505520';

        if (amStorage) {
          amStorage.addEmail({
            chatId: adminChatId,
            to: params.to,
            subject: params.subject,
            body: params.body,
            resendId: result.id || null,
            trackingId: trackingId,
            status: 'sent',
            source: 'autonomous-pilot',
            contactName: params.contactName || '',
            company: params.company || '',
            score: params.score || 0,
            sentAt: new Date().toISOString()
          });

          // FIX 19 : Tracker warmup dans les compteurs persistants
          amStorage.setFirstSendDate();
          amStorage.incrementTodaySendCount();
        }

        storage.incrementProgress('emailsSentThisWeek', 1);

        // Marquer le lead comme _emailSent dans FlowFast pour eviter re-envoi
        const ffStorage = getFlowFastStorage();
        if (ffStorage && ffStorage.markEmailSent) {
          const marked = ffStorage.markEmailSent(params.to);
          if (!marked) {
            log.warn('action-executor', 'markEmailSent: lead non trouve pour ' + params.to + ' — le lead pourrait etre re-contacte');
          }
        } else {
          log.warn('action-executor', 'FlowFast storage indisponible pour markEmailSent');
        }

        // FIX 20 : Sauvegarder les donnees prospect dans Lead Enrich DB
        if (params._prospectIntel) {
          try {
            const leStorage = getLeadEnrichStorage();
            if (leStorage && leStorage.saveEnrichedLead) {
              const existing = leStorage.getEnrichedLead ? leStorage.getEnrichedLead(params.to) : null;
              if (!existing) {
                leStorage.saveEnrichedLead(params.to, {
                  person: { fullName: params.contactName || '', title: params.contact && params.contact.titre || '', email: params.to },
                  organization: { name: params.company || '' }
                }, {
                  score: params.score || 5,
                  reasoning: 'Enrichi via ProspectResearcher lors envoi email',
                  prospectIntel: params._prospectIntel
                }, 'prospect-researcher', adminChatId);
                log.info('action-executor', 'Lead Enrich: donnees sauvegardees pour ' + params.to);
              }
            }
          } catch (leErr) {
            log.info('action-executor', 'Lead Enrich save skip:', leErr.message);
          }
        }

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

  // --- Creation de sequence de follow-up via campaign-engine ---
  async _createFollowUpSequence(params) {
    if (!this.campaignEngine) {
      return { success: false, error: 'Campaign engine non disponible' };
    }

    const contacts = params.contacts || [];
    if (contacts.length === 0) {
      return { success: false, error: 'Aucun contact pour la sequence' };
    }

    const amStorage = getAutomailerStorage();
    if (!amStorage) {
      return { success: false, error: 'Automailer storage non disponible' };
    }

    const apConfig = storage.getConfig();
    const adminChatId = apConfig.adminChatId || '1409505520';
    const totalSteps = params.totalSteps || 3;
    const intervalDays = params.intervalDays || 4; // J+4, J+8, J+16

    try {
      // 1. Creer une liste de contacts pour la campagne
      const listName = 'AP-Relance-' + new Date().toISOString().slice(0, 10);
      const list = amStorage.createContactList(adminChatId, listName);

      for (const contact of contacts) {
        amStorage.addContactToList(list.id, {
          email: contact.email,
          name: contact.nom || contact.name || '',
          firstName: (contact.nom || contact.name || '').split(' ')[0],
          company: contact.entreprise || contact.company || '',
          title: contact.titre || contact.title || ''
        });
      }

      // 2. Creer la campagne
      const campaign = await this.campaignEngine.createCampaign(adminChatId, {
        name: 'Relance auto ' + new Date().toLocaleDateString('fr-FR'),
        contactListId: list.id,
        totalContacts: contacts.length
      });

      // 3. Construire le contexte pour la generation d'emails
      let context = apConfig.businessContext || 'prospection B2B pour iFIND, agence d\'automatisation IA';
      const ep = apConfig.emailPreferences || {};
      if (ep.maxLines) context += '\nREGLE: Email de ' + ep.maxLines + ' lignes MAXIMUM.';
      if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
        context += '\nMOTS INTERDITS: ' + ep.forbiddenWords.join(', ');
      }
      if (ep.tone) context += '\nTON: ' + ep.tone;
      context += '\nSIGNATURE: Alexis — iFIND';
      context += '\nCONTEXTE: Ce sont des RELANCES (le prospect a deja recu un premier email sans repondre).';
      context += '\nRelance 1 (J+' + intervalDays + '): Nouvel angle de valeur, question ouverte courte.';
      context += '\nRelance 2 (J+' + (intervalDays * 2) + '): Preuve sociale, cas client concret.';
      context += '\nRelance 3 (J+' + (intervalDays * 4) + '): Breakup email, derniere chance, court et direct.';

      const offer = apConfig.offer || {};
      if (offer.description) context += '\nOFFRE: ' + offer.description;
      if (offer.trial) context += '\nESSAI: ' + offer.trial;

      // 4. Generer les emails de relance (3 steps)
      const steps = await this.campaignEngine.generateCampaignEmails(
        campaign.id,
        context,
        totalSteps,
        intervalDays
      );

      // 5. Demarrer la campagne (le scheduler du campaign-engine gerera les envois)
      await this.campaignEngine.startCampaign(campaign.id);

      log.info('action-executor', 'Sequence follow-up creee: ' + campaign.id +
        ' (' + contacts.length + ' contacts, ' + totalSteps + ' relances, intervalle ' + intervalDays + 'j)');

      return {
        success: true,
        campaignId: campaign.id,
        contacts: contacts.length,
        steps: totalSteps,
        summary: 'Sequence de ' + totalSteps + ' relances creee pour ' + contacts.length +
          ' lead(s) (J+' + intervalDays + ', J+' + (intervalDays * 2) + ', J+' + (intervalDays * 4) + ')'
      };
    } catch (e) {
      log.error('action-executor', 'Erreur creation sequence follow-up:', e.message);
      return { success: false, error: 'Creation sequence echouee: ' + e.message };
    }
  }
}

// Static pour le rate limiting email
ActionExecutor._lastSendTime = 0;

module.exports = ActionExecutor;
