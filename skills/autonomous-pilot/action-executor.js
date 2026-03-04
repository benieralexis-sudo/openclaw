// Autonomous Pilot - Executeur d'actions cross-skill
const crypto = require('crypto');
const storage = require('./storage.js');
const log = require('../../gateway/logger.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const { getWarmupDailyLimit } = require('../../gateway/utils.js');

// --- Cross-skill imports via skill-loader centralise ---
const { getStorage, getModule } = require('../../gateway/skill-loader.js');

function getApolloConnector() { return getModule('apollo-connector'); }
function getFlowFastStorage() { return getStorage('flowfast'); }
function getLeadEnrichStorage() { return getStorage('lead-enrich'); }
function getHubSpotClient() { return getModule('hubspot-client'); }
function getClaudeEmailWriter() { return getModule('claude-email-writer'); }
function getResendClient() { return getModule('resend-client'); }
function getAutomailerStorage() { return getStorage('automailer'); }
function getProspectResearcher() { return getModule('prospect-researcher'); }
function getWebIntelStorage() { return getStorage('web-intelligence'); }

function _getSharedNLP() {
  try { return require('../../gateway/shared-nlp.js'); }
  catch (e) { return null; }
}

class ActionExecutor {
  constructor(options) {
    this.apolloKey = options.apolloKey;
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
        // enrich_leads supprime — FullEnrich inutile (Apollo + SMTP verify suffisent)
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
    const prompt = `Evalue ce lead B2B pour ${process.env.CLIENT_DESCRIPTION || "une agence d'automatisation IA"} (${process.env.CLIENT_NAME || 'iFIND'}). Reponds UNIQUEMENT en JSON strict.

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

    // Lire les overrides Self-Improve (targeting criteria)
    let siTargeting = {};
    try {
      const siStorage = require('../self-improve/storage.js');
      siTargeting = siStorage.getTargetingCriteria() || {};
    } catch (e) {
      try {
        const siStorage = require('/app/skills/self-improve/storage.js');
        siTargeting = siStorage.getTargetingCriteria() || {};
      } catch (e2) {}
    }

    // Priorite : Brain params (explicit) > Self-Improve overrides > Config locale AP > Defaults
    const configCriteria = storage.getGoals().searchCriteria || {};
    const brainCriteria = params.criteria || params;
    const criteria = {
      titles: brainCriteria.titles && brainCriteria.titles.length > 0
        ? brainCriteria.titles
        : (siTargeting.preferredTitles && siTargeting.preferredTitles.length > 0 ? siTargeting.preferredTitles : configCriteria.titles),
      locations: brainCriteria.locations && brainCriteria.locations.length > 0 ? brainCriteria.locations : configCriteria.locations,
      seniorities: configCriteria.seniorities && configCriteria.seniorities.length > 0 ? configCriteria.seniorities : brainCriteria.seniorities,
      companySize: brainCriteria.companySize && brainCriteria.companySize.length > 0
        ? brainCriteria.companySize
        : (siTargeting.preferredCompanySize && siTargeting.preferredCompanySize.length > 0 ? siTargeting.preferredCompanySize : configCriteria.companySize),
      // Keywords : le brain OVERRIDE la config pour varier les niches
      keywords: brainCriteria.keywords || configCriteria.keywords || '',
      industries: brainCriteria.industries || (siTargeting.focusNiches && siTargeting.focusNiches.length > 0 ? siTargeting.focusNiches : configCriteria.industries) || [],
      limit: brainCriteria.limit || configCriteria.limit || 10
    };
    // Si keywords est un array, joindre en string (Apollo attend une string)
    if (Array.isArray(criteria.keywords)) {
      criteria.keywords = criteria.keywords.join(' OR ');
    }

    // --- Guard ICP: JAMAIS de recherche sans criteres de base ---
    const ICP = storage.ICP_DEFAULTS || {};
    if (!criteria.titles || criteria.titles.length === 0) {
      criteria.titles = ICP.titles || ['CEO', 'Founder', 'Co-founder', 'CTO', 'Fondateur', 'Directeur', 'Gerant', 'Associe'];
      log.warn('action-executor', 'ICP Guard: titles vide, defaults injectes');
    }
    if (!criteria.locations || criteria.locations.length === 0) {
      criteria.locations = ICP.locations || ['France'];
      log.warn('action-executor', 'ICP Guard: locations vide, defaults injectes');
    }
    if (!criteria.seniorities || criteria.seniorities.length === 0) {
      criteria.seniorities = ICP.seniorities || ['founder', 'c_suite', 'director', 'owner'];
      log.warn('action-executor', 'ICP Guard: seniorities vide, defaults injectes');
    }

    log.info('action-executor', 'Recherche leads (config+brain+SI):', JSON.stringify(criteria).substring(0, 300));
    const result = await getBreaker('apollo', { failureThreshold: 3, cooldownMs: 60000 }).call(() => apollo.searchLeads(criteria));

    if (!result.success) {
      return { success: false, error: 'Recherche Apollo echouee', details: result };
    }

    // Qualifier les leads avec AI (scoring direct, sans FlowFast)
    const ffStorage = getFlowFastStorage();
    let qualified = 0;
    let saved = 0;
    // Self-Improve peut overrider le minScore (prend le plus bas des deux pour etre plus permissif)
    const configMinScore = storage.getGoals().weekly.minLeadScore || 7;
    const minScore = (siTargeting.minScore && siTargeting.minScore > 0 && siTargeting.minScore <= 10)
      ? Math.min(configMinScore, siTargeting.minScore) : configMinScore;
    // Industries a exclure (Self-Improve)
    const excludeNiches = (siTargeting.excludeNiches || []).map(n => n.toLowerCase());

    if (result.leads) {

      // Filtrer les industries exclues par Self-Improve
      let filteredLeads = result.leads;
      if (excludeNiches.length > 0) {
        const beforeCount = filteredLeads.length;
        filteredLeads = filteredLeads.filter(l => {
          const industry = (l.organization?.industry || '').toLowerCase();
          return !excludeNiches.some(ex => industry.includes(ex));
        });
        if (filteredLeads.length < beforeCount) {
          log.info('action-executor', 'Self-Improve excludeNiches: ' + (beforeCount - filteredLeads.length) + ' leads exclus (' + excludeNiches.join(', ') + ')');
        }
      }

      // Mapper les champs Apollo (nouveau endpoint mixed_people/api_search)
      const mappedLeads = filteredLeads.map(l => ({
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
            const revealResult = await getBreaker('apollo', { failureThreshold: 3, cooldownMs: 60000 }).call(() => apollo.revealLead(lead.apolloId));
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
                  searchCriteria: JSON.stringify(criteria).substring(0, 200),
                  organizationData: JSON.stringify(lead.organization || {}).substring(0, 2000)
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

    // Tracker la niche si fournie par le brain
    const niche = params.niche || this._inferNiche(params.criteria?.keywords || '');
    if (niche) {
      for (let ni = 0; ni < saved; ni++) {
        storage.trackNicheEvent(niche, 'lead');
      }
    }

    // --- Multi-Threading : grouper les leads qualifies par entreprise ---
    if (process.env.MULTI_THREAD_ENABLED !== 'false' && ffStorage && ffStorage.createCompanyGroup) {
      try {
        const maxContacts = parseInt(process.env.MULTI_THREAD_MAX_CONTACTS) || 3;
        const qualifiedWithOrg = (result.leads || []).filter(l => l.email && l.organization && l.organization.name && l.score >= minScore);

        // Grouper par entreprise
        const byCompany = {};
        for (const l of qualifiedWithOrg) {
          const orgName = l.organization.name;
          if (!byCompany[orgName]) byCompany[orgName] = [];
          byCompany[orgName].push(l);
        }

        let groupsCreated = 0;
        for (const [orgName, leads] of Object.entries(byCompany)) {
          if (leads.length < 2) continue; // Mono-contact, pas besoin de groupe
          if (ffStorage.hasCompanyBeenContacted(orgName)) continue; // Deja contacte

          const ANGLES = ['main_pitch', 'technical', 'roi', 'testimonial'];
          const contacts = leads.slice(0, maxContacts).map((l, i) => ({
            email: l.email,
            name: ((l.first_name || '') + ' ' + (l.last_name || '')).trim(),
            title: l.title || '',
            role: i === 0 ? 'primary' : 'secondary',
            emailAngle: ANGLES[i] || 'main_pitch'
          }));

          ffStorage.createCompanyGroup(orgName, contacts);
          groupsCreated++;
        }
        if (groupsCreated > 0) {
          log.info('action-executor', 'Multi-threading: ' + groupsCreated + ' groupes entreprise crees');
        }
      } catch (e) {
        log.warn('action-executor', 'Multi-threading groupement echoue:', e.message);
      }
    }

    return {
      success: true,
      total: result.leads?.length || 0,
      qualified: qualified,
      saved: saved,
      niche: niche || null,
      summary: (result.leads?.length || 0) + ' leads trouves, ' + qualified + ' qualifies (score >= ' + minScore + ')' + (niche ? ' [niche: ' + niche + ']' : '')
    };
  }

  // --- _enrichLeads supprime (FullEnrich retire — Apollo + SMTP verify suffisent) ---

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
        const existing = await getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 }).call(() => hubspot.findContactByEmail(contact.email));
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

        const hsContact = await getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 }).call(() => hubspot.createContact({
          firstname: contact.firstName || contact.nom?.split(' ')[0] || '',
          lastname: contact.lastName || contact.nom?.split(' ').slice(1).join(' ') || '',
          email: contact.email,
          jobtitle: contact.title || contact.titre || '',
          company: contact.company || contact.entreprise || '',
          phone: contact.phone || ''
        }));
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
            const deal = await getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 }).call(() => hubspot.createDeal({
              dealname: (contact.company || contact.entreprise || 'Lead') + ' — Prospection',
              dealstage: 'appointmentscheduled'
            }));
            if (deal && deal.id) {
              await getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 }).call(() => hubspot.associateDealToContact(deal.id, hsContact.id));
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

    // Contexte minimal — le systemPrompt du writer contient deja toutes les regles
    let context = '';

    const ep = config.emailPreferences || {};
    if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
      context += 'MOTS INTERDITS: ' + ep.forbiddenWords.join(', ');
    }

    // Injecter les donnees prospect
    if (params._prospectIntel) {
      context += '\n\n' + params._prospectIntel;
    }

    // Rotation d'angles : injecter les angles DEJA utilises pour eviter les repetitions
    let industryForAngles = '';
    try {
      // Deduire l'industrie depuis le brief, Lead Enrich, ou Apollo
      if (params._prospectIntel) {
        const indMatch = params._prospectIntel.match(/(?:industrie|industry):\s*([^,\n)]+)/i);
        if (indMatch) industryForAngles = indMatch[1].trim();
      }
      if (!industryForAngles) {
        const leStorage = getLeadEnrichStorage();
        if (leStorage) {
          const enriched = leStorage.getEnrichedLead ? leStorage.getEnrichedLead(contact.email) : null;
          if (enriched && enriched.aiClassification) industryForAngles = enriched.aiClassification.industry || '';
        }
      }
      if (!industryForAngles && rawContact.industry) industryForAngles = rawContact.industry;
    } catch (e) {}

    if (industryForAngles) {
      params._industryForAngles = industryForAngles;
      const recentAngles = storage.getRecentAnglesForIndustry(industryForAngles, 10);
      if (recentAngles.length > 0) {
        context += '\n\n=== ANGLES DEJA UTILISES (NE PAS REPETER) ===';
        context += '\nSecteur : ' + industryForAngles;
        context += '\nLes accroches suivantes ont DEJA ete envoyees a des prospects de ce secteur. Tu DOIS utiliser un angle COMPLETEMENT DIFFERENT :';
        for (const angle of recentAngles) {
          context += '\n- "' + angle + '"';
        }
        context += '\n=== FIN ANGLES UTILISES ===';
      }
    }

    // Signature ajoutee automatiquement par resend-client.js (HTML minimal)
    context += '\nSIGNATURE: NE PAS ajouter de signature — elle est ajoutee automatiquement apres le corps du mail.';

    // Generation avec retry (max 2 tentatives sur erreur Claude API)
    const MAX_GEN_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_GEN_RETRIES; attempt++) {
      try {
        const email = await writer.generateSingleEmail(contact, context);
        return {
          success: true,
          email: email,
          summary: 'Email genere pour ' + (contact.email || 'inconnu') + ': "' +
            (email.subject || '').substring(0, 50) + '"'
        };
      } catch (e) {
        if (attempt < MAX_GEN_RETRIES) {
          log.warn('action-executor', 'Claude API erreur (retry ' + (attempt + 1) + '/' + MAX_GEN_RETRIES + '): ' + e.message);
          await new Promise(r => setTimeout(r, (attempt + 1) * 2000)); // backoff 2s, 4s
        } else {
          return { success: false, error: 'Generation email echouee apres ' + (MAX_GEN_RETRIES + 1) + ' tentatives: ' + e.message };
        }
      }
    }
  }

  // --- Quality gate : verifier que l'email contient un fait specifique du brief ---
  _checkEmailSpecificity(body, subject, prospectIntel) {
    const emailText = ((subject || '') + ' ' + (body || '')).toLowerCase();
    const intelText = (prospectIntel || '').toLowerCase();
    const facts = [];

    // 1. Nom d'entreprise/produit cite (pas juste "agence" ou "ESN")
    const companyMatch = prospectIntel.match(/ENTREPRISE:\s*([^(\n]+)/);
    if (companyMatch) {
      const companyName = companyMatch[1].trim().toLowerCase();
      // Verifier le nom complet ou les mots significatifs (> 3 chars)
      if (companyName.length > 3 && emailText.includes(companyName)) {
        facts.push('entreprise');
      } else {
        const parts = companyName.split(/[\s-]+/).filter(w => w.length > 3);
        for (const part of parts) {
          if (emailText.includes(part)) { facts.push('entreprise_partiel:' + part); break; }
        }
      }
    }

    // 2. Chiffre specifique du brief retrouve dans l'email
    const intelNumbers = intelText.match(/\d{2,}/g) || [];
    const emailNumbers = emailText.match(/\d{2,}/g) || [];
    const sharedNumbers = emailNumbers.filter(n => intelNumbers.includes(n) && parseInt(n) > 3 && parseInt(n) < 100000);
    if (sharedNumbers.length > 0) facts.push('chiffre:' + sharedNumbers[0]);

    // 3. Technologie du brief citee dans l'email
    const techMatch = intelText.match(/STACK TECHNIQUE:\s*([^\n]+)/);
    if (techMatch) {
      const techs = techMatch[1].split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 2);
      for (const tech of techs) {
        if (emailText.includes(tech)) { facts.push('tech:' + tech); break; }
      }
    }

    // 4. Evenement recent (news, signal) cite
    const eventKws = ['levee', 'leve', 'recrute', 'recrutement', 'lance', 'acquisition', 'fusion', 'partenariat', 'expansion', 'ouvert', 'ouvre'];
    for (const kw of eventKws) {
      if (emailText.includes(kw) && intelText.includes(kw)) { facts.push('evenement:' + kw); break; }
    }

    // 5. Client/service specifique de la page /clients ou /services
    const pageMatch = intelText.match(/\[PAGE [^\]]+\]\s*([^\n]+)/g);
    if (pageMatch) {
      for (const pageLine of pageMatch) {
        const words = pageLine.replace(/\[PAGE [^\]]+\]\s*/, '').split(/\s+/).filter(w => w.length > 4 && !/^(notre|votre|agence|services|clients|pour|avec|dans|plus|tout|nous)$/i.test(w));
        for (const word of words.slice(0, 15)) {
          if (emailText.includes(word.toLowerCase())) { facts.push('site:' + word); break; }
        }
        if (facts.some(f => f.startsWith('site:'))) break;
      }
    }

    // 6. Mot-cle Apollo ou activite cite
    const kwMatch = intelText.match(/MOTS-CLES:\s*([^\n]+)/);
    if (kwMatch) {
      const keywords = kwMatch[1].split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 3);
      for (const kw of keywords) {
        if (emailText.includes(kw)) { facts.push('keyword:' + kw); break; }
      }
    }

    // 7. Client/marque detecte par DDG ou extraction noms propres
    const clientMatch = intelText.match(/CLIENTS\/MARQUES DETECTES:\s*([^\n]+)/);
    if (clientMatch) {
      const clients = clientMatch[1].split(',').map(c => c.trim().toLowerCase()).filter(c => c.length > 2);
      for (const client of clients) {
        if (emailText.includes(client)) { facts.push('client:' + client); break; }
      }
    }
    // 7b. Noms propres du site web
    const nomsMatch = intelText.match(/\[NOMS DETECTES\]\s*([^\n]+)/);
    if (nomsMatch) {
      const noms = nomsMatch[1].split(',').map(n => n.trim().toLowerCase()).filter(n => n.length > 2);
      for (const nom of noms) {
        if (emailText.includes(nom)) { facts.push('nom_propre:' + nom); break; }
      }
    }

    // 8. Profil public personne (interview, podcast, conference)
    const profileMatch = intelText.match(/profil public[^:]*:([\s\S]*?)(?=\nsignaux|\npriori|\nstack|\nmots|\ncontexte|\nenrich|\n$)/i);
    if (profileMatch) {
      const profileKws = profileMatch[1].match(/"([^"]+)"/g);
      if (profileKws) {
        for (const pk of profileKws) {
          const title = pk.replace(/"/g, '').toLowerCase();
          const words = title.split(/\s+/).filter(w => w.length > 4 && !/^(interview|podcast|article|conference|mention)$/i.test(w));
          for (const word of words.slice(0, 5)) {
            if (emailText.includes(word)) { facts.push('person_profile:' + word); break; }
          }
          if (facts.some(f => f.startsWith('person_profile:'))) break;
        }
      }
    }

    const level = facts.length >= 1 ? 'specific' : 'generic';
    const reason = facts.length === 0 ? 'Aucun fait specifique du brief dans l\'email' : facts.length + ' fait(s)';
    return { level, facts, reason };
  }

  // --- Envoi d'email (apres confirmation) ---
  async _sendEmail(params) {
    // FORCE _generateFirst : TOUJOURS passer par ProspectResearcher + ClaudeEmailWriter
    // Le brain pre-remplit parfois subject/body avec du contenu generique — on les ignore
    // C'est la SEULE facon de garantir des emails personnalises et sans mots interdits
    if (!params._generateFirst) {
      log.info('action-executor', 'Force _generateFirst=true pour ' + (params.to || 'unknown') + ' (securite anti-generique)');
      params._generateFirst = true;
    }

    // Verifier qu'au moins un service email est configure (Gmail SMTP ou Resend)
    const gmailReady = process.env.GMAIL_SMTP_ENABLED === 'true' && process.env.GMAIL_SMTP_USER;
    if (!this.resendKey && !gmailReady) {
      return { success: false, error: 'Aucun service email configure (Resend ou Gmail)' };
    }

    // Validation format email
    if (!params.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.to)) {
      return { success: false, error: 'Adresse email invalide: ' + (params.to || 'vide') };
    }

    // Rate limiting : delai aleatoire 45-90s entre chaque envoi (pattern humain, adapte au warmup jour 10+)
    if (ActionExecutor._lastSendTime) {
      const minDelay = 45 * 1000;     // 45 sec
      const maxDelay = 90 * 1000;     // 90 sec
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
      // FIX WARMUP : utiliser domain-manager comme source de verite (par domaine, pas global)
      let sentToday, dailyLimit, warmupDays;
      try {
        const domainManager = require('../automailer/domain-manager.js');
        const stats = domainManager.getStats ? domainManager.getStats() : [];
        const activeStats = stats.filter(s => s.active);
        if (activeStats.length > 0) {
          // Prendre la limite la plus basse parmi les domaines actifs (prudence warmup)
          dailyLimit = Math.min(...activeStats.map(s => s.warmupLimit || 5));
          sentToday = activeStats.reduce((sum, s) => sum + (s.todaySends || 0), 0);
          const youngest = activeStats.reduce((min, s) => {
            const d = s.firstSendDate ? Math.floor((Date.now() - new Date(s.firstSendDate).getTime()) / 86400000) : 0;
            return d < min ? d : min;
          }, 999);
          warmupDays = youngest;
        } else {
          sentToday = amStorage.getTodaySendCount();
          const firstSendDate = amStorage.getFirstSendDate ? amStorage.getFirstSendDate() : null;
          dailyLimit = getWarmupDailyLimit(firstSendDate);
          warmupDays = firstSendDate ? Math.floor((Date.now() - new Date(firstSendDate).getTime()) / 86400000) : 0;
        }
      } catch (dmErr) {
        sentToday = amStorage.getTodaySendCount();
        const firstSendDate = amStorage.getFirstSendDate ? amStorage.getFirstSendDate() : null;
        dailyLimit = getWarmupDailyLimit(firstSendDate);
        warmupDays = firstSendDate ? Math.floor((Date.now() - new Date(firstSendDate).getTime()) / 86400000) : 0;
      }

      if (sentToday >= dailyLimit) {
        log.info('action-executor', 'Warm-up: ' + sentToday + '/' + dailyLimit + ' emails envoyes aujourd\'hui (day ' + warmupDays + ') — limite atteinte');
        return { success: false, error: 'Limite warm-up atteinte (' + dailyLimit + '/jour)', warmupLimited: true };
      }
      log.info('action-executor', 'Warm-up: ' + sentToday + '/' + dailyLimit + ' emails aujourd\'hui (day ' + warmupDays + ')');
    }

    // Deduplication : verifier si un email a deja ete envoye a cette adresse
    // Revival emails bypass le check dedup (c'est intentionnel — on re-contacte un ancien lead)
    if (amStorage && params.to) {
      const isRevival = params.source === 'revival';
      if (!isRevival) {
        const existing = amStorage.getEmailEventsForRecipient(params.to);
        const alreadySent = existing.some(e => e.status === 'sent' || e.status === 'delivered' || e.status === 'opened' || e.status === 'replied');
        if (alreadySent) {
          log.info('action-executor', 'Email deja envoye a ' + params.to + ' — skip (deduplication)');
          return { success: false, error: 'Email deja envoye a ' + params.to, deduplicated: true };
        }
      } else {
        log.info('action-executor', 'Revival email pour ' + params.to + ' — dedup bypass (intentionnel)');
      }
      // Verifier la blacklist (hard blacklist bloque meme les revivals)
      if (amStorage.isBlacklisted(params.to)) {
        // Pour les revivals, seule la hard blacklist bloque
        if (isRevival && amStorage.isHardBlacklisted) {
          if (amStorage.isHardBlacklisted(params.to)) {
            log.info('action-executor', params.to + ' est hard-blackliste — skip revival');
            return { success: false, error: params.to + ' est hard-blackliste (bounce/spam/rgpd)' };
          }
          // Soft blacklist (decline, human_takeover) : OK pour revival
          log.info('action-executor', params.to + ' soft-blackliste mais revival autorise');
        } else {
          log.info('action-executor', params.to + ' est blackliste — skip');
          return { success: false, error: params.to + ' est blackliste' };
        }
      }
    }

    // Multi-Threading : company-level dedup — si l'entreprise a deja recu une reponse, skip TOUS les contacts
    if (process.env.MULTI_THREAD_ENABLED !== 'false' && params.company) {
      const ffStorageMT = getFlowFastStorage();
      if (ffStorageMT && ffStorageMT.findCompanyGroupByEmail) {
        let companyGroup = ffStorageMT.findCompanyGroupByEmail(params.to);
        if (!companyGroup && params.company && ffStorageMT.getCompanyGroup) {
          companyGroup = ffStorageMT.getCompanyGroup(params.company);
        }
        if (companyGroup && companyGroup.status === 'replied') {
          log.info('action-executor', 'Multi-thread: entreprise ' + companyGroup.companyName + ' a deja repondu (via ' + companyGroup.repliedBy + ') — skip ' + params.to);
          return { success: false, error: 'Entreprise ' + companyGroup.companyName + ' a deja repondu', companyReplied: true };
        }
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

    // === GATE 1 : Validation Lead Enrich — bloquer leads hors-cible avant de depenser un appel Claude ===
    if (leStorageCheck) {
      const enrichedGate = leStorageCheck.getEnrichedLead(params.to);
      if (enrichedGate && enrichedGate.aiClassification) {
        const aiClass = enrichedGate.aiClassification;
        const aiScore = aiClass.score != null ? aiClass.score : 10;
        const aiIndustry = (aiClass.industry || '').toLowerCase();
        if (aiScore <= 5 && aiIndustry === 'autre') {
          log.warn('action-executor', 'GATE 1 BLOCK — Lead Enrich hors-cible pour ' + params.to +
            ' (score: ' + aiScore + '/10, industrie: ' + aiClass.industry + ') — skip');
          return { success: false, error: 'Lead hors-cible (Lead Enrich score ' + aiScore + ', industrie: ' + aiClass.industry + ')', gateBlocked: true };
        }
        if (aiScore <= 5 || aiIndustry === 'autre') {
          log.warn('action-executor', 'GATE 1 WARNING — Lead suspect pour ' + params.to +
            ' (score: ' + aiScore + '/10, industrie: ' + aiClass.industry + ') — envoi avec prudence');
        }
      }
    }

    // === FIX : Recuperer organization Apollo + LinkedIn depuis FlowFast ===
    if (params._generateFirst && !(params.contact && params.contact.organization)) {
      try {
        const ffStorageOrg = getFlowFastStorage();
        if (ffStorageOrg && ffStorageOrg.data) {
          const leadsObj = ffStorageOrg.data.leads || {};
          for (const lid of Object.keys(leadsObj)) {
            if (leadsObj[lid].email === params.to) {
              const orgDataRaw = leadsObj[lid].organizationData;
              if (orgDataRaw) {
                try {
                  const orgParsed = typeof orgDataRaw === 'string' ? JSON.parse(orgDataRaw) : orgDataRaw;
                  if (orgParsed && orgParsed.name) {
                    if (!params.contact) params.contact = {};
                    params.contact.organization = orgParsed;
                    log.info('action-executor', 'Organization Apollo recuperee depuis FlowFast pour ' + params.to + ': ' + orgParsed.name);
                  }
                } catch (parseErr) {}
              }
              if (!params.contact) params.contact = {};
              if (!params.contact.linkedin_url) {
                params.contact.linkedin_url = leadsObj[lid].linkedin || leadsObj[lid].linkedinUrl || '';
              }
              break;
            }
          }
        }
      } catch (orgErr) {
        log.info('action-executor', 'Recuperation org FlowFast skip: ' + orgErr.message);
      }
    }

    // Si _generateFirst est true, TOUJOURS regenerer via ProspectResearcher + ClaudeEmailWriter
    // (le brain pre-remplit parfois subject/body avec du contenu generique — on les ignore)
    if (params._generateFirst) {
      params.subject = null;
      params.body = null;

      // Deduire la niche du lead depuis FlowFast (pour Gate 2)
      let leadNiche = null;
      try {
        const ffStorageNiche = getFlowFastStorage();
        if (ffStorageNiche && ffStorageNiche.data) {
          const leadsNiche = ffStorageNiche.data.leads || {};
          for (const lid of Object.keys(leadsNiche)) {
            if (leadsNiche[lid].email === params.to) {
              leadNiche = this._inferLeadNiche(leadsNiche[lid]);
              break;
            }
          }
        }
      } catch (e) {}

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
            organization: params.contact && params.contact.organization,
            linkedin_url: params.contact && params.contact.linkedin_url,
            niche: leadNiche
          });
          if (intel && intel.brief) {
            params._prospectIntel = intel.brief;
          }
          // === GATE 2 : Coherence Niche / Site Web ===
          if (intel && intel.nicheCoherent === false) {
            log.warn('action-executor', 'GATE 2 BLOCK — Niche mismatch pour ' + params.to +
              ' (' + (intel.nicheWarning || 'site web hors-cible') + ') — skip');
            return { success: false, error: 'Niche mismatch: ' + (intel.nicheWarning || 'site web ne correspond pas a la niche'), gateBlocked: true };
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

      // === QUALITY GATE : verifier la specificite de l'email ===
      if (params.body && params._prospectIntel) {
        const specificity = this._checkEmailSpecificity(params.body, params.subject, params._prospectIntel);
        if (specificity.level === 'generic') {
          log.warn('action-executor', 'Quality gate FAIL pour ' + params.to + ': ' + specificity.reason + ' — regeneration');
          params._prospectIntel += '\n\n=== INSTRUCTION CRITIQUE ===\nL\'email precedent etait TROP GENERIQUE. Tu DOIS citer un FAIT SPECIFIQUE tire des donnees prospect ci-dessus : un client, un chiffre, une technologie, un evenement recent, un service precis. Si aucun fait specifique n\'est disponible, retourne {"skip": true, "reason": "donnees insuffisantes pour email specifique"}.';
          params.subject = null;
          params.body = null;
          const retryResult = await this._generateEmail(params);
          if (retryResult.success && retryResult.email && !retryResult.email.skip) {
            params.subject = retryResult.email.subject;
            params.body = retryResult.email.body || retryResult.email.text || '';
            const retrySpecificity = this._checkEmailSpecificity(params.body, params.subject, params._prospectIntel);
            if (retrySpecificity.level === 'generic') {
              log.warn('action-executor', 'Quality gate STILL GENERIC apres retry pour ' + params.to + ' — skip');
              return { success: false, error: 'Email trop generique meme apres retry', skipped: true };
            }
            log.info('action-executor', 'Quality gate OK apres retry pour ' + params.to + ': ' + retrySpecificity.facts.join(', '));
          } else if (retryResult.email && retryResult.email.skip) {
            log.info('action-executor', 'Quality gate → skip pour ' + params.to + ': donnees insuffisantes');
            return { success: false, error: 'Skip: donnees insuffisantes pour email specifique', skipped: true };
          } else {
            return { success: false, error: 'Regeneration echouee apres quality gate' };
          }
        } else {
          log.info('action-executor', 'Quality gate OK pour ' + params.to + ': ' + specificity.facts.join(', '));
        }
      }

      // Tracker l'angle utilise pour la rotation
      if (params.body && params._industryForAngles) {
        const firstLine = params.body.split(/[\n.!?]/)[0].trim();
        if (firstLine.length > 10) storage.trackUsedAngle(params._industryForAngles, firstLine);
      }
    }

    if (!params.subject || !params.body) {
      return { success: false, error: 'Subject et body requis pour envoyer un email' };
    }

    // Validation post-generation : verifier mots interdits (boucle retry jusqu'a 4 tentatives)
    const config = storage.getConfig();
    const epCheck = config.emailPreferences || {};
    if (epCheck.forbiddenWords && epCheck.forbiddenWords.length > 0) {
      const MAX_FORBIDDEN_RETRIES = 4;
      let forbiddenRetry = 0;
      let emailText = (params.subject + ' ' + params.body).toLowerCase();
      let foundWords = epCheck.forbiddenWords.filter(w => {
        const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('\\b' + escaped + '\\b', 'i').test(emailText);
      });

      while (foundWords.length > 0 && forbiddenRetry < MAX_FORBIDDEN_RETRIES) {
        forbiddenRetry++;
        log.warn('action-executor', 'Mots interdits detectes (tentative ' + forbiddenRetry + '/' + MAX_FORBIDDEN_RETRIES + '): ' + foundWords.join(', ') + ' — regeneration');
        // Injecter les mots specifiques trouves directement dans _prospectIntel pour le systemPrompt
        params._prospectIntel = (params._prospectIntel || '').replace(/\nATTENTION CRITIQUE:.*Reformule completement\./g, '') +
          '\n\nATTENTION CRITIQUE: l\'email precedent contenait ces mots INTERDITS: ' + foundWords.join(', ') +
          '. Tu ne dois ABSOLUMENT PAS les utiliser. Remplace-les par des synonymes ou reformule completement. ' +
          'Mots a eviter imperativement: ' + foundWords.map(w => '"' + w + '"').join(', ') + '.';
        params.subject = null;
        params.body = null;
        const retryGen = await this._generateEmail(params);
        if (retryGen.success && retryGen.email && !retryGen.email.skip) {
          params.subject = retryGen.email.subject;
          params.body = retryGen.email.body || retryGen.email.text || '';
          emailText = (params.subject + ' ' + params.body).toLowerCase();
          foundWords = epCheck.forbiddenWords.filter(w => {
            const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp('\\b' + escaped + '\\b', 'i').test(emailText);
          });
        } else {
          return { success: false, error: 'Regeneration email echouee apres detection mots interdits (tentative ' + forbiddenRetry + ')' };
        }
      }

      if (foundWords.length > 0) {
        log.error('action-executor', 'Mots interdits persistants apres ' + MAX_FORBIDDEN_RETRIES + ' retries: ' + foundWords.join(', ') + ' — envoi bloque');
        return { success: false, error: 'Mots interdits persistants apres ' + MAX_FORBIDDEN_RETRIES + ' tentatives: ' + foundWords.join(', ') };
      }
    }

    // === GATE SUJET : Patterns interdits dans le subject ===
    {
      const subjectLower = (params.subject || '').toLowerCase();
      const subjectBans = [
        'prospection', 'acquisition', 'gen de leads', 'generation de leads',
        'rdv qualifi', 'rdv/mois', 'pipeline', 'sans recruter',
        'et si vous', 'et si tu', 'saviez-vous', 'notre solution', 'notre outil'
      ];
      const found = subjectBans.filter(b => subjectLower.includes(b));
      if (found.length > 0) {
        log.error('action-executor', 'GATE SUJET BLOCK — Patterns interdits dans subject pour ' + params.to + ': ' + found.join(', ') + ' — skip');
        return { success: false, error: 'Subject contient patterns interdits: ' + found.join(', '), gateBlocked: true };
      }
    }

    // === GATE LONGUEUR : max 120 mots — au-dela c'est du LinkedIn, pas du cold email ===
    {
      const bodyWords = (params.body || '').trim().split(/\s+/).filter(w => w.length > 0);
      if (bodyWords.length > 120) {
        log.error('action-executor', 'GATE LONGUEUR BLOCK — Email trop long (' + bodyWords.length + ' mots, max 120) pour ' + params.to + ' — skip');
        return { success: false, error: 'Email trop long: ' + bodyWords.length + ' mots (max 120)', gateBlocked: true };
      }
      if (bodyWords.length > 90) {
        log.warn('action-executor', 'GATE LONGUEUR WARN — Email long (' + bodyWords.length + ' mots) pour ' + params.to + ' — envoye mais sous-optimal');
      }
    }

    // === GATE 3 : Completude Email — verifier que l'email est complet avant envoi ===
    {
      const subjectTrimmed = (params.subject || '').trim();
      const bodyTrimmed = (params.body || '').trim();
      const bodyWordCount = bodyTrimmed.split(/\s+/).filter(w => w.length > 0).length;
      const endsWithPunctuation = /[.!?]$/.test(bodyTrimmed);
      const endsWithEllipsis = /\.{2,}$/.test(bodyTrimmed);

      if (subjectTrimmed.length < 5) {
        log.error('action-executor', 'GATE 3 BLOCK — Subject trop court (' + subjectTrimmed.length + ' chars) pour ' + params.to + ' — skip');
        return { success: false, error: 'Email incomplet: subject trop court (' + subjectTrimmed.length + ' chars)', gateBlocked: true };
      }
      if (bodyTrimmed.length < 50) {
        log.error('action-executor', 'GATE 3 BLOCK — Body trop court (' + bodyTrimmed.length + ' chars) pour ' + params.to + ' — skip');
        return { success: false, error: 'Email incomplet: body trop court (' + bodyTrimmed.length + ' chars)', gateBlocked: true };
      }
      if (bodyWordCount < 8) {
        log.error('action-executor', 'GATE 3 BLOCK — Body trop peu de mots (' + bodyWordCount + ') pour ' + params.to + ' — skip');
        return { success: false, error: 'Email incomplet: body trop court (' + bodyWordCount + ' mots)', gateBlocked: true };
      }
      if (!endsWithPunctuation || endsWithEllipsis) {
        log.error('action-executor', 'GATE 3 BLOCK — Body potentiellement tronque pour ' + params.to +
          ' (termine par: "' + bodyTrimmed.slice(-20) + '") — skip');
        return { success: false, error: 'Email potentiellement tronque (ne finit pas par . ! ou ?)', gateBlocked: true };
      }
      log.info('action-executor', 'GATE 3 OK — Email complet pour ' + params.to +
        ' (subject: ' + subjectTrimmed.length + ' chars, body: ' + bodyTrimmed.length + ' chars / ' + bodyWordCount + ' mots)');
    }

    // === GATE 4 : Patterns generiques (GENERIC_PATTERNS de campaign-engine) ===
    try {
      const CampaignEngine = getModule('campaign-engine');
      if (CampaignEngine && CampaignEngine.emailPassesQualityGate) {
        const aeQg = CampaignEngine.emailPassesQualityGate(params.subject, params.body);
        if (!aeQg.pass) {
          log.error('action-executor', 'GATE 4 GENERIC_PATTERNS BLOCK pour ' + params.to + ': ' + aeQg.reason + ' — skip');
          return { success: false, error: 'Email contient pattern generique: ' + aeQg.reason, gateBlocked: true };
        }
        log.info('action-executor', 'GATE 4 OK — Pas de pattern generique pour ' + params.to);
      }
    } catch (qgErr) {
      log.warn('action-executor', 'GATE 4 skip (campaign-engine indisponible): ' + qgErr.message);
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
      // Threading : recuperer messageId precedent pour ce prospect
      const sendOpts = { replyTo: process.env.REPLY_TO_EMAIL || process.env.SENDER_EMAIL, fromName: process.env.SENDER_NAME || 'Alexis', trackingId: trackingId };
      if (amStorage) {
        const prevMsgId = amStorage.getMessageIdForRecipient(params.to);
        if (prevMsgId) {
          sendOpts.inReplyTo = prevMsgId;
          sendOpts.references = prevMsgId;
        }
      }
      const result = await getBreaker('gmail-smtp', { failureThreshold: 3, cooldownMs: 60000 }).call(() => resend.sendEmail(
        params.to,
        params.subject,
        params.body,
        sendOpts
      ));

      if (result.success) {
        // Recuperer le chatId admin depuis la config AP
        const apConfig = storage.getConfig();
        const adminChatId = apConfig.adminChatId || process.env.ADMIN_CHAT_ID || '1409505520';

        if (amStorage) {
          amStorage.addEmail({
            chatId: adminChatId,
            to: params.to,
            subject: params.subject,
            body: params.body,
            resendId: result.id || null,
            messageId: result.messageId || null,
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

        // Tracker la niche de ce lead pour l'auto-pivot
        const ffStorageNiche = getFlowFastStorage();
        if (ffStorageNiche && ffStorageNiche.data) {
          const leadsObj2 = ffStorageNiche.data.leads || {};
          for (const lid of Object.keys(leadsObj2)) {
            if (leadsObj2[lid].email === params.to) {
              const leadNiche = this._inferLeadNiche(leadsObj2[lid]);
              if (leadNiche) {
                storage.trackNicheEvent(leadNiche, 'sent');
                log.info('action-executor', 'Niche tracking: email sent [' + leadNiche + '] pour ' + params.to);
              }
              break;
            }
          }
        }

        // Marquer le lead comme _emailSent dans FlowFast pour eviter re-envoi
        const ffStorage = getFlowFastStorage();
        if (ffStorage && ffStorage.markEmailSent) {
          const marked = ffStorage.markEmailSent(params.to);
          if (!marked) {
            log.warn('action-executor', 'markEmailSent: lead non trouve pour ' + params.to + ' — le lead pourrait etre re-contacte');
          }
          // Multi-Threading : marquer le contact comme envoye dans son company group
          if (ffStorage.markCompanyContactSent) {
            ffStorage.markCompanyContactSent(params.to);
          }
        } else {
          log.warn('action-executor', 'FlowFast storage indisponible pour markEmailSent');
        }

        // Marquer les news WI comme utilisees dans cet email (evite recyclage infini)
        try {
          const wiStorage = getWebIntelStorage();
          if (wiStorage && wiStorage.markNewsUsedInEmail) {
            // Marquage explicite si Claude a passe un newsId
            if (params._wiNewsId) {
              wiStorage.markNewsUsedInEmail(params._wiNewsId);
              log.info('action-executor', 'WI news marquee (explicite) id=' + params._wiNewsId + ' pour ' + params.company);
            }
            // Marquage auto par matching company (filet de securite)
            if (wiStorage.getRecentNewsOutreach) {
              const companyLower = (params.company || '').toLowerCase().trim();
              if (companyLower.length >= 2) {
                const allNews = wiStorage.getRecentNewsOutreach(50);
                const matched = allNews.filter(n =>
                  !n.usedInEmail && n.company && n.company.toLowerCase().includes(companyLower)
                );
                for (const news of matched) {
                  wiStorage.markNewsUsedInEmail(news.id);
                  log.info('action-executor', 'WI news marquee (auto) "' + news.headline + '" pour ' + params.company);
                }
              }
            }
          }
        } catch (e) {
          log.warn('action-executor', 'Erreur marquage WI news:', e.message);
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

        // Inter-Prospect Memory : enregistrer le contact sectoriel
        try {
          let industry = '';
          if (params._prospectIntel) {
            const indMatch = params._prospectIntel.match(/(?:industrie|industry):\s*([^,\n)]+)/i);
            if (indMatch) industry = indMatch[1].trim();
          }
          if (!industry) {
            const leStorageInd = getLeadEnrichStorage();
            if (leStorageInd && leStorageInd.getEnrichedLead) {
              const enriched = leStorageInd.getEnrichedLead(params.to);
              if (enriched && enriched.aiClassification) industry = enriched.aiClassification.industry || '';
            }
          }
          if (industry) {
            const domain = params.to ? params.to.split('@')[1] : '';
            const org = params.contact && params.contact.organization;
            storage.recordCompetitorContact(industry, {
              name: params.company || (org && org.name) || '',
              domain: domain,
              keywords: org ? (org.keywords || []).slice(0, 5) : [],
              employees: org ? (org.estimated_num_employees || null) : null,
              score: params.score || 0,
              city: org ? (org.city || null) : null
            });
            log.info('action-executor', 'CompanyIntelligence: enregistre ' + (params.company || '?') + ' dans [' + industry + ']');
          }
        } catch (ciErr) {}

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

    // Validation emails : le brain invente parfois des emails (andrea@trendex.com au lieu de andrea@trendex.tech)
    // Corriger en croisant avec FlowFast et automailer
    const amStorage = getAutomailerStorage();
    const ffStorage = getFlowFastStorage();
    if (ffStorage && ffStorage.data) {
      const leadsObj = ffStorage.data.leads || {};
      const leadIds = Object.keys(leadsObj);
      const sentEmails = amStorage ? (amStorage.data.emails || []) : [];

      for (let ci = 0; ci < contacts.length; ci++) {
        const c = contacts[ci];
        // Verifier si l'email existe dans FlowFast ou automailer
        let emailFound = false;
        for (const lid of leadIds) {
          if (leadsObj[lid].email === c.email) { emailFound = true; break; }
        }
        if (!emailFound) {
          for (const se of sentEmails) {
            if (se.to === c.email) { emailFound = true; break; }
          }
        }
        if (!emailFound) {
          // Chercher par nom dans FlowFast
          const nom = c.nom || c.name || '';
          let correctedEmail = null;
          for (const lid of leadIds) {
            const lead = leadsObj[lid];
            if (lead.email && lead.nom && lead.nom.toLowerCase() === nom.toLowerCase()) {
              correctedEmail = lead.email;
              break;
            }
          }
          if (correctedEmail) {
            log.warn('action-executor', 'Follow-up email corrige: ' + c.email + ' -> ' + correctedEmail);
            c.email = correctedEmail;
          } else {
            log.warn('action-executor', 'Follow-up email inconnu: ' + c.email + ' (pas dans FlowFast/automailer) — retire');
            contacts.splice(ci, 1);
            ci--;
          }
        }
      }
      if (contacts.length === 0) {
        return { success: false, error: 'Aucun contact valide apres validation emails' };
      }
    }

    if (!amStorage) {
      return { success: false, error: 'Automailer storage non disponible' };
    }

    // Cross-dedup : retirer les contacts qui ont deja un reactive follow-up pending
    try {
      const paStorage = _require('../proactive-agent/storage.js', '/app/skills/proactive-agent/storage.js');
      if (paStorage && paStorage.getPendingFollowUps) {
        const pendingFUs = paStorage.getPendingFollowUps();
        const pendingEmails = new Set(pendingFUs.map(f => f.prospectEmail.toLowerCase()));
        const before = contacts.length;
        for (let ci = contacts.length - 1; ci >= 0; ci--) {
          if (pendingEmails.has((contacts[ci].email || '').toLowerCase())) {
            log.info('action-executor', 'Follow-up sequence: ' + contacts[ci].email + ' a deja un reactive FU pending — retire');
            contacts.splice(ci, 1);
          }
        }
        if (contacts.length < before) {
          log.info('action-executor', 'Cross-dedup: ' + (before - contacts.length) + ' contact(s) retire(s) (reactive FU pending)');
        }
      }
    } catch (crossErr) {
      log.info('action-executor', 'Cross-dedup check skip: ' + crossErr.message);
    }

    if (contacts.length === 0) {
      return { success: false, error: 'Aucun contact apres cross-dedup' };
    }

    const apConfig = storage.getConfig();
    const adminChatId = apConfig.adminChatId || '1409505520';
    const fuConfig = apConfig.followUpConfig || {};
    const totalSteps = params.totalSteps || fuConfig.sequenceTotalSteps || 4;
    const stepDays = fuConfig.sequenceStepDays || [3, 7, 14, 21];
    // Legacy: si params.intervalDays est fourni, utiliser l'ancien mode (intervalles fixes)
    const intervalDays = params.intervalDays || null;

    try {
      // 1. Creer une liste de contacts pour la campagne
      const listName = 'AP-Relance-' + new Date().toISOString().slice(0, 10);
      const list = amStorage.createContactList(adminChatId, listName);

      // FIX DEDUP RENFORCEE: exclure contacts deja en campagne OU ayant recu un email < 14 jours
      const allCampaigns = amStorage.getAllCampaigns();
      const alreadyInCampaign = new Set();
      // 1. Contacts dans n'importe quelle campagne (active OU completed)
      for (const camp of allCampaigns) {
        const campList = amStorage.data.contactLists[camp.contactListId];
        if (campList && campList.contacts) {
          for (const c of campList.contacts) {
            alreadyInCampaign.add((c.email || '').toLowerCase());
          }
        }
      }
      // 2. Contacts ayant recu un email dans les 14 derniers jours (toutes sources)
      const cutoff14d = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const allEmails = amStorage.getAllEmails ? amStorage.getAllEmails() : (amStorage.data.emails || []);
      for (const e of allEmails) {
        if (e.to && e.sentAt && e.status !== 'failed') {
          const sentTs = new Date(e.sentAt).getTime();
          if (sentTs > cutoff14d) {
            alreadyInCampaign.add((e.to || '').toLowerCase());
          }
        }
      }

      let addedCount = 0;
      for (const contact of contacts) {
        if (alreadyInCampaign.has((contact.email || '').toLowerCase())) {
          log.info('action-executor', 'Skip ' + contact.email + ' (deja en campagne ou email < 14j)');
          continue;
        }
        amStorage.addContactToList(list.id, {
          email: contact.email,
          name: contact.nom || contact.name || '',
          firstName: (contact.nom || contact.name || '').split(' ')[0],
          company: contact.entreprise || contact.company || '',
          title: contact.titre || contact.title || '',
          industry: contact.organization?.industry || contact.industry || contact.industrie || ''
        });
        addedCount++;
      }
      if (addedCount === 0) {
        log.info('action-executor', 'Tous les contacts sont deja dans des campagnes actives — pas de nouvelle campagne');
        return { success: true, message: 'Tous les contacts sont deja en campagne active' };
      }

      // 2. Creer la campagne
      const campaign = await this.campaignEngine.createCampaign(adminChatId, {
        name: 'Relance auto ' + new Date().toLocaleDateString('fr-FR'),
        contactListId: list.id,
        totalContacts: contacts.length
      });

      // 3. Construire le contexte pour la generation d'emails
      let context = apConfig.businessContext || 'prospection B2B pour ' + (process.env.CLIENT_NAME || 'iFIND') + ', ' + (process.env.CLIENT_DESCRIPTION || "agence d'automatisation IA");
      const ep = apConfig.emailPreferences || {};
      if (ep.maxLines) context += '\nREGLE: Email de ' + ep.maxLines + ' lignes MAXIMUM.';
      if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
        context += '\nMOTS INTERDITS: ' + ep.forbiddenWords.join(', ');
      }
      if (ep.tone) context += '\nTON: ' + ep.tone;
      context += '\nSIGNATURE: ' + (process.env.SENDER_NAME || 'Alexis') + ' — ' + (process.env.CLIENT_NAME || 'iFIND');
      context += '\nCONTEXTE: Ce sont des RELANCES (le prospect a deja recu un premier email sans repondre).';
      context += '\nRelance 1 (J+' + stepDays[0] + '): Nouvel angle tire des DONNEES PROSPECT, question ouverte.';
      context += '\nRelance 2 (J+' + stepDays[1] + '): Preuve sociale, mini cas client anonymise.';
      context += '\nRelance 3 (J+' + stepDays[2] + '): Dernier angle de valeur, question directe.';
      context += '\nRelance 4 (J+' + stepDays[3] + '): BREAKUP — 2 lignes max, choix binaire.';

      const offer = apConfig.offer || {};
      if (offer.description) context += '\nOFFRE: ' + offer.description;
      if (offer.trial) context += '\nESSAI: ' + offer.trial;

      // 4. Collecter les sujets deja envoyes a ces contacts (eviter repetitions)
      const usedAngles = [];
      try {
        for (const contact of contacts) {
          const events = amStorage.getEmailEventsForRecipient ? amStorage.getEmailEventsForRecipient(contact.email) : [];
          for (const ev of events) {
            if (ev.subject && (ev.status === 'sent' || ev.status === 'delivered' || ev.status === 'opened')) {
              usedAngles.push(ev.subject);
            }
          }
        }
      } catch (angleErr) {
        log.info('action-executor', 'Collecte usedAngles skip: ' + angleErr.message);
      }

      // 5. Generer les emails de relance (4 steps avec stepDays variables)
      const steps = await this.campaignEngine.generateCampaignEmails(
        campaign.id,
        context,
        totalSteps,
        intervalDays || stepDays,
        { usedAngles: usedAngles }
      );

      // 5. Demarrer la campagne (le scheduler du campaign-engine gerera les envois)
      await this.campaignEngine.startCampaign(campaign.id);

      const daysLabel = stepDays.map(function(d) { return 'J+' + d; }).join(', ');
      log.info('action-executor', 'Sequence follow-up creee: ' + campaign.id +
        ' (' + contacts.length + ' contacts, ' + totalSteps + ' relances, ' + daysLabel + ')');

      return {
        success: true,
        campaignId: campaign.id,
        contacts: contacts.length,
        steps: totalSteps,
        summary: 'Sequence de ' + totalSteps + ' relances creee pour ' + contacts.length +
          ' lead(s) (' + daysLabel + ')'
      };
    } catch (e) {
      log.error('action-executor', 'Erreur creation sequence follow-up:', e.message);
      return { success: false, error: 'Creation sequence echouee: ' + e.message };
    }
  }

  // --- Inference de niche a partir des keywords de recherche ---
  _inferNiche(keywords) {
    if (!keywords) return null;
    const kw = keywords.toLowerCase();
    // Utiliser la liste centralisee de niches depuis storage
    const nicheList = storage.getNicheList ? storage.getNicheList() : storage.B2B_NICHE_LIST || [];
    for (const n of nicheList) {
      for (const p of n.patterns) {
        if (kw.includes(p)) return n.slug;
      }
    }
    return null;
  }

  // --- Inference niche d'un lead a partir de ses donnees FlowFast ---
  _inferLeadNiche(lead) {
    if (!lead) return null;
    // Chercher dans les criteres de recherche stockes avec le lead
    if (lead.searchCriteria) {
      const niche = this._inferNiche(lead.searchCriteria);
      if (niche) return niche;
    }
    // Chercher dans le nom d'entreprise / industrie via la liste centralisee
    const orgData = lead.organizationData ? (typeof lead.organizationData === 'string' ? lead.organizationData : JSON.stringify(lead.organizationData)) : '';
    const combined = ((lead.entreprise || '') + ' ' + orgData).toLowerCase();
    const nicheList = storage.getNicheList ? storage.getNicheList() : storage.B2B_NICHE_LIST || [];
    for (const n of nicheList) {
      for (const p of n.patterns) {
        if (combined.includes(p)) return n.slug;
      }
    }
    return null;
  }
}

// Static pour le rate limiting email
ActionExecutor._lastSendTime = 0;

module.exports = ActionExecutor;
