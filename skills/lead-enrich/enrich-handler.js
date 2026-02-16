// Lead Enrich - Handler NLP Telegram (FullEnrich waterfall enrichment)
const FullEnrichEnricher = require('./fullenrich-enricher.js');
const AIClassifier = require('./ai-classifier.js');
const storage = require('./storage.js');
const https = require('https');
const { retryAsync } = require('../../gateway/utils.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const log = require('../../gateway/logger.js');

// Cross-skill imports (avec fallback pour Docker)
function getHubSpotClient() {
  try { return require('../crm-pilot/hubspot-client.js'); }
  catch (e) {
    try { return require('/app/skills/crm-pilot/hubspot-client.js'); }
    catch (e2) { return null; }
  }
}

function getAutomailerStorage() {
  try { return require('../automailer/storage.js'); }
  catch (e) {
    try { return require('/app/skills/automailer/storage.js'); }
    catch (e2) { return null; }
  }
}

class LeadEnrichHandler {
  constructor(openaiKey, fullenrichKey, hubspotKey) {
    this.openaiKey = openaiKey;
    this.enricher = fullenrichKey ? new FullEnrichEnricher(fullenrichKey) : null;
    this.classifier = new AIClassifier(openaiKey);
    this.hubspotKey = hubspotKey;

    // Etats conversationnels
    this.pendingConversations = {};
    this.pendingConfirmations = {};
  }

  start() {}
  stop() {}

  // --- NLP ---

  callOpenAI(messages, maxTokens) {
    maxTokens = maxTokens || 200;
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.3,
        max_tokens: maxTokens
      });
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.openaiKey,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (response.choices && response.choices[0]) {
              resolve(response.choices[0].message.content);
            } else {
              reject(new Error('Reponse OpenAI invalide'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout OpenAI')); });
      req.write(postData);
      req.end();
    });
  }

  async classifyIntent(message, chatId) {
    const hasPendingConv = !!this.pendingConversations[String(chatId)];
    const hasPendingConfirm = !!this.pendingConfirmations[String(chatId)];

    const systemPrompt = `Tu es l'assistant d'enrichissement de leads d'un bot Telegram. L'utilisateur parle en francais naturel, souvent de facon informelle ou avec des fautes.
Tu dois comprendre son INTENTION meme s'il ne dit pas les mots exacts.

Classifie le message en une action JSON.

Actions :
- "enrich_single" : enrichir un contact (email, nom+entreprise, ou LinkedIn)
  Params: {"email":"jean@...", "name":"Jean Dupont", "company":"Acme", "linkedin":"https://linkedin.com/in/..."}
  Ex: "enrichis jean@example.com", "trouve moi des infos sur Jean Dupont chez Acme", "check ce LinkedIn", "qu'est-ce qu'on sait sur ce lead ?"
- "enrich_hubspot" : enrichir en masse les contacts HubSpot
  Params: {"limit": 20}
  Ex: "enrichis mes contacts HubSpot", "complete les infos manquantes du CRM", "lance un enrichissement"
- "enrich_automailer_list" : enrichir une liste de contacts AutoMailer
  Params: {"list_name":"Prospects"}
  Ex: "enrichis la liste Prospects", "complete ma liste de contacts"
- "score_lead" : voir le score/classification d'un lead
  Params: {"email":"jean@..."}
  Ex: "score de jean@example.com", "il vaut combien ce lead ?", "c'est un bon prospect ?"
- "enrich_report" : rapport / stats d'enrichissement
  Ex: "rapport enrichissement", "stats des enrichissements", "combien j'ai enrichi ?"
- "top_leads" : voir les meilleurs leads
  Params: {"limit": 10}
  Ex: "mes meilleurs leads", "top prospects", "les leads les mieux notes", "t'as trouve des trucs interessants ?"
- "hot_leads" : leads chauds / engages (basé sur comportement email)
  Params: {"limit": 10}
  Ex: "mes hot leads", "leads chauds", "leads engages", "qui est interesse ?", "qui a repondu ?", "leads les plus reactifs"
- "enrich_credits" : credits enrichissement restants
  Ex: "combien de credits ?", "credits", "il me reste combien ?"
- "confirm_yes" : confirmation positive
  Ex: "oui", "ok", "go", "lance", "c'est bon", "parfait"
- "confirm_no" : refus / annulation
  Ex: "non", "annule", "stop", "laisse tomber"
- "help" : demande d'aide explicite
  Ex: "aide", "comment ca marche ?"
- "chat" : UNIQUEMENT si ca ne correspond a aucune action ci-dessus

${hasPendingConfirm ? 'ATTENTION: CONFIRMATION en attente. "oui/ok/go/parfait" = confirm_yes, "non/annule/stop" = confirm_no.' : ''}
${hasPendingConv ? 'ATTENTION: Workflow en cours. Classe en "continue_conversation" sauf si c\'est CLAIREMENT une autre action.' : ''}

Reponds UNIQUEMENT en JSON strict :
{"action":"enrich_single","params":{"email":"jean@example.com"}}
{"action":"enrich_single","params":{"name":"Jean Dupont","company":"Acme"}}
{"action":"enrich_hubspot","params":{"limit":20}}
{"action":"top_leads","params":{"limit":10}}
{"action":"hot_leads","params":{"limit":10}}
{"action":"help"}`;

    try {
      const openaiBreaker = getBreaker('openai', { failureThreshold: 3, cooldownMs: 60000 });
      const response = await openaiBreaker.call(() => retryAsync(() => this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ], 300), 2, 2000));

      let cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      if (!result.action) return null;
      return result;
    } catch (error) {
      log.error('lead-enrich', 'Erreur classifyIntent:', error.message);
      return null;
    }
  }

  // --- Handler principal ---

  async handleMessage(message, chatId, sendReply) {
    const user = storage.getUser(chatId);
    const text = message.trim();
    const textLower = text.toLowerCase();

    // Commandes rapides
    if (textLower === 'aide enrichissement' || textLower === 'aide enrich' || textLower === 'help enrich') {
      return { type: 'text', content: this.getHelp() };
    }

    // Conversation en cours
    if (this.pendingConversations[String(chatId)]) {
      const cancelKeywords = ['annule', 'stop', 'aide', 'help'];
      if (cancelKeywords.some(kw => textLower.includes(kw))) {
        delete this.pendingConversations[String(chatId)];
        return { type: 'text', content: '👌 Annule.' };
      }
      return await this._continueConversation(chatId, text, sendReply);
    }

    // Classification NLP
    const command = await this.classifyIntent(text, chatId);
    if (!command) {
      return { type: 'text', content: 'Je n\'ai pas compris. Dis _"aide enrichissement"_ pour voir ce que je sais faire !' };
    }

    switch (command.action) {
      case 'enrich_single':
        return await this._handleEnrichSingle(chatId, command.params || {}, sendReply);

      case 'enrich_hubspot':
        return await this._handleEnrichHubSpot(chatId, command.params || {}, sendReply);

      case 'enrich_automailer_list':
        return await this._handleEnrichAutomailerList(chatId, command.params || {}, sendReply);

      case 'score_lead':
        return await this._handleScoreLead(chatId, command.params || {}, sendReply);

      case 'enrich_report':
        return await this._handleEnrichReport(chatId, sendReply);

      case 'top_leads':
        return await this._handleTopLeads(chatId, command.params || {}, sendReply);

      case 'hot_leads':
        return await this._handleHotLeads(chatId, command.params || {}, sendReply);

      case 'enrich_credits':
        return await this._handleEnrichCredits(chatId);

      case 'confirm_yes': {
        const pending = this.pendingConfirmations[String(chatId)];
        if (pending) return await this._executeConfirmation(chatId, sendReply);
        return { type: 'text', content: 'Rien en attente.' };
      }

      case 'confirm_no':
        delete this.pendingConfirmations[String(chatId)];
        delete this.pendingConversations[String(chatId)];
        return { type: 'text', content: '👌 Annule.' };

      case 'continue_conversation':
        return await this._continueConversation(chatId, text, sendReply);

      case 'help':
        return { type: 'text', content: this.getHelp() };

      case 'chat': {
        try {
          const openaiBreaker = getBreaker('openai', { failureThreshold: 3, cooldownMs: 60000 });
          const response = await openaiBreaker.call(() => retryAsync(() => this.callOpenAI([
            { role: 'system', content: 'Tu es l\'assistant Lead Enrich du bot Telegram. Tu aides a enrichir des leads B2B. Reponds en francais, 1-3 phrases max.' },
            { role: 'user', content: text }
          ], 200), 2, 2000));
          return { type: 'text', content: response.trim() };
        } catch (e) {
          return { type: 'text', content: this.getHelp() };
        }
      }

      default:
        return { type: 'text', content: this.getHelp() };
    }
  }

  // ============================================================
  // ENRICHISSEMENT SINGLE
  // ============================================================

  async _handleEnrichSingle(chatId, params, sendReply) {
    if (!this.enricher) {
      return { type: 'text', content: '❌ L\'enrichissement n\'est pas disponible actuellement.\n💡 Cle API FullEnrich non configuree.\n\n👉 En attendant, tu peux utiliser les autres fonctions : _"leads prioritaires"_, _"rapport enrichissement"_' };
    }

    let enrichResult = null;

    // Par email
    if (params.email && params.email.includes('@')) {
      // Verifier cache (90 jours)
      const cached = storage.getEnrichedLead(params.email);
      if (cached && cached.enrichedAt) {
        const ageMs = Date.now() - new Date(cached.enrichedAt).getTime();
        const MAX_CACHE_AGE = 90 * 24 * 60 * 60 * 1000; // 90 jours
        if (ageMs < MAX_CACHE_AGE) {
          const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
          return { type: 'text', content: this._formatEnrichedProfile(cached) + '\n\n_Donnees du cache (enrichi il y a ' + ageDays + ' jour' + (ageDays > 1 ? 's' : '') + ')_' };
        }
      }

      if (sendReply) await sendReply({ type: 'text', content: '🔍 _Enrichissement de ' + params.email + ' via FullEnrich (15+ sources)..._\n⏳ _~60 secondes_' });
      const feBreaker = getBreaker('fullenrich', { failureThreshold: 3, cooldownMs: 60000 });
      enrichResult = await feBreaker.call(() => this.enricher.enrichByEmail(params.email));
    }
    // Par nom + entreprise
    else if (params.name && params.company) {
      const nameParts = params.name.trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      if (sendReply) await sendReply({ type: 'text', content: '🔍 _Recherche de ' + params.name + ' chez ' + params.company + ' via FullEnrich (15+ sources)..._\n⏳ _~60 secondes_' });
      const feBreaker = getBreaker('fullenrich', { failureThreshold: 3, cooldownMs: 60000 });
      enrichResult = await feBreaker.call(() => this.enricher.enrichByNameAndCompany(firstName, lastName, params.company));
    }
    // Par LinkedIn
    else if (params.linkedin) {
      if (sendReply) await sendReply({ type: 'text', content: '🔍 _Enrichissement via LinkedIn + FullEnrich (15+ sources)..._\n⏳ _~60 secondes_' });
      const feBreaker = getBreaker('fullenrich', { failureThreshold: 3, cooldownMs: 60000 });
      enrichResult = await feBreaker.call(() => this.enricher.enrichByLinkedIn(params.linkedin));
    }
    else {
      return { type: 'text', content: '❌ Donne-moi un email, un nom+entreprise, ou un lien LinkedIn.\nExemple : _"enrichis jean@example.com"_' };
    }

    if (!enrichResult || !enrichResult.success) {
      return { type: 'text', content: '📭 Contact non trouve.\n' + (enrichResult && enrichResult.error ? '💡 ' + enrichResult.error : '') };
    }

    // Classification IA
    if (sendReply) await sendReply({ type: 'text', content: '🤖 _Analyse du profil..._' });
    const openaiBreaker = getBreaker('openai', { failureThreshold: 3, cooldownMs: 60000 });
    const classification = await openaiBreaker.call(() => retryAsync(() => this.classifier.classifyLead(enrichResult), 2, 2000));

    // Sauvegarder
    const email = enrichResult.person.email || params.email || '';
    storage.saveEnrichedLead(email, enrichResult, classification, 'telegram', chatId);
    storage.trackEnrichCredit();
    storage.logActivity(chatId, 'enrich_single', { email: email });

    // UPGRADE 1 : Calculer le behavior score si des events email existent
    try {
      const behaviorData = this.classifier.calculateBehaviorScore(email);
      if (behaviorData.behaviorScore !== 0 || behaviorData.signals.length > 0) {
        storage.updateLeadScore(email, behaviorData);
      }
    } catch (e) {
      log.warn('lead-enrich', 'Erreur calcul behavior score:', e.message);
    }

    const lead = storage.getEnrichedLead(email);

    return { type: 'text', content: this._formatEnrichedProfile(lead) };
  }

  // ============================================================
  // ENRICHISSEMENT BATCH HUBSPOT
  // ============================================================

  async _handleEnrichHubSpot(chatId, params, sendReply) {
    if (!this.enricher) {
      return { type: 'text', content: '❌ Cle API FullEnrich non configuree.' };
    }
    const HubSpotClient = getHubSpotClient();
    if (!HubSpotClient || !this.hubspotKey) {
      return { type: 'text', content: '❌ HubSpot non disponible.' };
    }

    if (sendReply) await sendReply({ type: 'text', content: '🔍 _Scan des contacts HubSpot..._' });

    try {
      const hubspot = new HubSpotClient(this.hubspotKey);
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const result = await hsBreaker.call(() => retryAsync(() => hubspot.listContacts(100), 2, 2000));
      const contacts = result.contacts || [];

      // Filtrer ceux qui ont des donnees manquantes et pas encore enrichis (ou cache expire > 90 jours)
      const MAX_CACHE_AGE = 90 * 24 * 60 * 60 * 1000; // 90 jours
      const toEnrich = contacts.filter(c => {
        if (!c.email) return false;
        const existingLead = storage.getEnrichedLead(c.email);
        if (existingLead && existingLead.enrichedAt) {
          const ageMs = Date.now() - new Date(existingLead.enrichedAt).getTime();
          if (ageMs < MAX_CACHE_AGE) return false; // Deja enrichi recemment
        }
        return !c.jobtitle || !c.company || !c.phone;
      });

      if (toEnrich.length === 0) {
        return { type: 'text', content: '✅ Tous les contacts HubSpot sont deja enrichis ou complets !' };
      }

      const enrichCount = Math.min(toEnrich.length, 100); // FullEnrich max 100/batch

      this.pendingConfirmations[String(chatId)] = {
        action: 'enrich_hubspot',
        data: { contacts: toEnrich.slice(0, enrichCount), totalContacts: contacts.length }
      };

      return { type: 'text', content: [
        '📋 *ENRICHISSEMENT HUBSPOT*',
        '━━━━━━━━━━━━━━━━━━',
        '',
        '👥 ' + contacts.length + ' contacts dans HubSpot',
        '❓ ' + toEnrich.length + ' avec donnees manquantes',
        '',
        '➡️ ' + enrichCount + ' contacts a enrichir (FullEnrich waterfall)',
        '💰 Cout : ~' + enrichCount + ' credits FullEnrich',
        '⏳ Duree estimee : ~' + Math.ceil(enrichCount * 1.5) + ' min',
        '',
        '👉 _"go"_ pour lancer | _"annule"_ pour annuler'
      ].join('\n') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur HubSpot : ' + error.message };
    }
  }

  // ============================================================
  // ENRICHISSEMENT BATCH AUTOMAILER
  // ============================================================

  async _handleEnrichAutomailerList(chatId, params, sendReply) {
    if (!this.enricher) {
      return { type: 'text', content: '❌ Cle API FullEnrich non configuree.' };
    }
    const automailerStorage = getAutomailerStorage();
    if (!automailerStorage) {
      return { type: 'text', content: '❌ AutoMailer non disponible.' };
    }

    const lists = automailerStorage.getContactLists(chatId);
    if (lists.length === 0) {
      return { type: 'text', content: '📭 Tu n\'as aucune liste dans AutoMailer.' };
    }

    // Trouver la liste
    let list = null;
    if (params.list_name) {
      list = lists.find(l => l.name.toLowerCase().includes(params.list_name.toLowerCase()));
    }

    if (!list) {
      // Demander quelle liste
      const listText = lists.map((l, i) => (i + 1) + '. *' + l.name + '* (' + l.contacts.length + ' contacts)').join('\n');
      this.pendingConversations[String(chatId)] = {
        action: 'enrich_automailer_list',
        step: 'awaiting_list',
        data: { lists: lists }
      };
      return { type: 'text', content: '📋 Quelle liste enrichir ?\n\n' + listText + '\n\n_Reponds avec le numero ou le nom._' };
    }

    return this._prepareAutomailerBatch(chatId, list);
  }

  _prepareAutomailerBatch(chatId, list) {
    const MAX_CACHE_AGE = 90 * 24 * 60 * 60 * 1000; // 90 jours
    const toEnrich = list.contacts.filter(c => {
      if (!c.email) return false;
      const existingLead = storage.getEnrichedLead(c.email);
      if (existingLead && existingLead.enrichedAt) {
        const ageMs = Date.now() - new Date(existingLead.enrichedAt).getTime();
        if (ageMs < MAX_CACHE_AGE) return false; // Deja enrichi recemment
      }
      return true;
    });

    if (toEnrich.length === 0) {
      return { type: 'text', content: '✅ Tous les contacts de "' + list.name + '" sont deja enrichis !' };
    }

    const enrichCount = Math.min(toEnrich.length, 100); // FullEnrich max 100/batch

    this.pendingConfirmations[String(chatId)] = {
      action: 'enrich_automailer_list',
      data: { listId: list.id, listName: list.name, contacts: toEnrich.slice(0, enrichCount) }
    };

    return { type: 'text', content: [
      '📋 *ENRICHISSEMENT LISTE "' + list.name + '"*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '📧 ' + list.contacts.length + ' contacts dans la liste',
      '✅ ' + (list.contacts.length - toEnrich.length) + ' deja enrichis',
      '',
      '➡️ ' + enrichCount + ' contacts a enrichir (FullEnrich waterfall)',
      '💰 Cout : ~' + enrichCount + ' credits FullEnrich',
      '⏳ Duree estimee : ~' + Math.ceil(enrichCount * 1.5) + ' min',
      '',
      '👉 _"go"_ pour lancer | _"annule"_ pour annuler'
    ].join('\n') };
  }

  // ============================================================
  // CONFIRMATIONS (execute batch)
  // ============================================================

  async _executeConfirmation(chatId, sendReply) {
    const pending = this.pendingConfirmations[String(chatId)];
    if (!pending) return { type: 'text', content: 'Rien en attente.' };
    delete this.pendingConfirmations[String(chatId)];

    if (pending.action === 'enrich_hubspot') {
      return await this._executeBatchHubSpot(chatId, pending.data, sendReply);
    }
    if (pending.action === 'enrich_automailer_list') {
      return await this._executeBatchAutomailer(chatId, pending.data, sendReply);
    }
    return { type: 'text', content: 'Action inconnue.' };
  }

  async _executeBatchHubSpot(chatId, data, sendReply) {
    const contacts = data.contacts;
    const HubSpotClient = getHubSpotClient();
    const hubspot = HubSpotClient ? new HubSpotClient(this.hubspotKey) : null;

    if (sendReply) await sendReply({ type: 'text', content: '🚀 _Lancement FullEnrich pour ' + contacts.length + ' contacts (waterfall 15+ sources)..._\n⏳ _Duree estimee : ~' + Math.ceil(contacts.length * 1.5) + ' min_' });

    // Preparer les contacts pour le bulk FullEnrich
    const batchContacts = contacts.map(c => ({
      email: c.email,
      firstName: c.firstname || '',
      lastName: c.lastname || '',
      company: c.company || ''
    }));

    const feBreaker = getBreaker('fullenrich', { failureThreshold: 3, cooldownMs: 60000 });
    const openaiBreaker = getBreaker('openai', { failureThreshold: 3, cooldownMs: 60000 });
    const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });

    // Soumettre en bulk via FullEnrich
    let batchResult;
    try {
      batchResult = await feBreaker.call(() => this.enricher.enrichBatch(batchContacts));
    } catch (e) {
      return { type: 'text', content: '❌ Erreur FullEnrich batch : ' + e.message };
    }

    if (!batchResult || !batchResult.success) {
      return { type: 'text', content: '❌ Echec enrichissement : ' + (batchResult ? batchResult.error : 'erreur inconnue') };
    }

    if (sendReply) await sendReply({ type: 'text', content: '🤖 _Classification IA de ' + batchResult.results.length + ' resultats..._' });

    let done = 0;
    let errors = 0;
    let totalScore = 0;
    let highScoreCount = 0;

    for (let i = 0; i < batchResult.results.length; i++) {
      const enrichResult = batchResult.results[i];
      const contact = contacts[i] || {};

      if (!enrichResult || !enrichResult.success) {
        errors++;
        done++;
        continue;
      }

      try {
        const classification = await openaiBreaker.call(() => retryAsync(() => this.classifier.classifyLead(enrichResult), 2, 2000));
        const email = enrichResult.person.email || contact.email || '';
        storage.saveEnrichedLead(email, enrichResult, classification, 'hubspot', chatId);
        storage.trackEnrichCredit();

        totalScore += classification.score || 0;
        if ((classification.score || 0) >= 8) highScoreCount++;

        // Mettre a jour HubSpot avec les nouvelles donnees
        if (hubspot && contact.id) {
          const updates = {};
          if (!contact.jobtitle && enrichResult.person.title) updates.jobtitle = enrichResult.person.title;
          if (!contact.company && enrichResult.organization.name) updates.company = enrichResult.organization.name;
          if (!contact.phone && enrichResult.person.phone) updates.phone = enrichResult.person.phone;
          if (!contact.city && enrichResult.person.city) updates.city = enrichResult.person.city;
          if (Object.keys(updates).length > 0) {
            try { await hsBreaker.call(() => retryAsync(() => hubspot.updateContact(contact.id, updates), 2, 2000)); } catch (e) {}
          }
        }
      } catch (e) {
        errors++;
      }
      done++;
    }

    storage.logActivity(chatId, 'enrich_hubspot_batch', { total: contacts.length, done: done, errors: errors, creditsUsed: batchResult.creditsUsed || 0 });
    const avgScore = done > errors ? (totalScore / (done - errors)).toFixed(1) : 0;

    return { type: 'text', content: [
      '✅ *ENRICHISSEMENT TERMINE*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '✅ ' + (done - errors) + ' contacts enrichis (FullEnrich)',
      errors > 0 ? '❌ ' + errors + ' non trouve' + (errors > 1 ? 's' : '') : '',
      '📊 Score moyen : ' + avgScore + '/10',
      '🔥 ' + highScoreCount + ' lead' + (highScoreCount > 1 ? 's' : '') + ' prioritaire' + (highScoreCount > 1 ? 's' : '') + ' (8+/10)',
      batchResult.creditsUsed ? '💰 Credits utilises : ' + batchResult.creditsUsed : '',
      '',
      '👉 _"leads prioritaires"_ pour voir les meilleurs'
    ].join('\n') };
  }

  async _executeBatchAutomailer(chatId, data, sendReply) {
    const contacts = data.contacts;

    if (sendReply) await sendReply({ type: 'text', content: '🚀 _FullEnrich pour ' + contacts.length + ' contacts de "' + data.listName + '" (waterfall 15+ sources)..._\n⏳ _Duree estimee : ~' + Math.ceil(contacts.length * 1.5) + ' min_' });

    // Preparer les contacts pour le bulk FullEnrich
    const batchContacts = contacts.map(c => ({
      email: c.email,
      firstName: c.firstName || c.firstname || '',
      lastName: c.lastName || c.lastname || '',
      company: c.company || ''
    }));

    const feBreaker = getBreaker('fullenrich', { failureThreshold: 3, cooldownMs: 60000 });
    const openaiBreaker = getBreaker('openai', { failureThreshold: 3, cooldownMs: 60000 });

    let batchResult;
    try {
      batchResult = await feBreaker.call(() => this.enricher.enrichBatch(batchContacts));
    } catch (e) {
      return { type: 'text', content: '❌ Erreur FullEnrich batch : ' + e.message };
    }

    if (!batchResult || !batchResult.success) {
      return { type: 'text', content: '❌ Echec enrichissement : ' + (batchResult ? batchResult.error : 'erreur inconnue') };
    }

    if (sendReply) await sendReply({ type: 'text', content: '🤖 _Classification IA de ' + batchResult.results.length + ' resultats..._' });

    let done = 0;
    let errors = 0;
    let totalScore = 0;
    let highScoreCount = 0;

    for (let i = 0; i < batchResult.results.length; i++) {
      const enrichResult = batchResult.results[i];
      const contact = contacts[i] || {};

      if (!enrichResult || !enrichResult.success) {
        errors++;
        done++;
        continue;
      }

      try {
        const classification = await openaiBreaker.call(() => retryAsync(() => this.classifier.classifyLead(enrichResult), 2, 2000));
        const email = enrichResult.person.email || contact.email || '';
        storage.saveEnrichedLead(email, enrichResult, classification, 'automailer', chatId);
        storage.trackEnrichCredit();

        totalScore += classification.score || 0;
        if ((classification.score || 0) >= 8) highScoreCount++;
      } catch (e) {
        errors++;
      }
      done++;
    }

    storage.logActivity(chatId, 'enrich_automailer_batch', { listName: data.listName, total: contacts.length, done: done, errors: errors, creditsUsed: batchResult.creditsUsed || 0 });
    const avgScore = done > errors ? (totalScore / (done - errors)).toFixed(1) : 0;

    return { type: 'text', content: [
      '✅ *ENRICHISSEMENT TERMINE*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '📧 Liste : *' + data.listName + '*',
      '✅ ' + (done - errors) + ' contacts enrichis (FullEnrich)',
      errors > 0 ? '❌ ' + errors + ' non trouve' + (errors > 1 ? 's' : '') : '',
      '📊 Score moyen : ' + avgScore + '/10',
      '🔥 ' + highScoreCount + ' lead' + (highScoreCount > 1 ? 's' : '') + ' prioritaire' + (highScoreCount > 1 ? 's' : '') + ' (8+/10)',
      batchResult.creditsUsed ? '💰 Credits utilises : ' + batchResult.creditsUsed : '',
      '',
      '👉 _"leads prioritaires"_ pour voir les meilleurs'
    ].join('\n') };
  }

  // ============================================================
  // SCORE / RAPPORTS
  // ============================================================

  async _handleScoreLead(chatId, params, sendReply) {
    const email = params.email;
    if (!email) {
      return { type: 'text', content: '❌ Donne-moi un email.\nExemple : _"score de jean@example.com"_' };
    }

    const lead = storage.getEnrichedLead(email);
    if (lead) {
      // UPGRADE 1 : Recalculer le behavior score a chaque consultation
      try {
        const behaviorData = this.classifier.calculateBehaviorScore(email);
        if (behaviorData.behaviorScore !== 0 || behaviorData.signals.length > 0) {
          storage.updateLeadScore(email, behaviorData);
        }
      } catch (e) {
        log.warn('lead-enrich', 'Erreur calcul behavior score:', e.message);
      }

      const updatedLead = storage.getEnrichedLead(email);
      return { type: 'text', content: this._formatEnrichedProfile(updatedLead) };
    }

    // Pas encore enrichi -> lancer l'enrichissement
    return await this._handleEnrichSingle(chatId, { email: email }, sendReply);
  }

  async _handleTopLeads(chatId, params, sendReply) {
    const limit = params.limit || 10;
    const topLeads = storage.getTopLeads(chatId, limit);

    if (topLeads.length === 0) {
      return { type: 'text', content: '📭 Aucun lead enrichi.\n👉 _"enrichis jean@example.com"_ pour commencer' };
    }

    const lines = ['🔥 *LEADS PRIORITAIRES*', '━━━━━━━━━━━━━━━━━━', ''];
    topLeads.forEach((lead, i) => {
      const src = lead.enrichData || lead.apolloData || {};
      const p = src.person || {};
      const o = src.organization || {};
      const c = lead.aiClassification || {};

      const scoreIcon = (c.score || 0) >= 8 ? '🔥' : (c.score || 0) >= 6 ? '✅' : '⚪';
      lines.push(scoreIcon + ' *' + (i + 1) + '. ' + (p.fullName || lead.email) + '* — ' + (c.score || '?') + '/10');
      lines.push('   💼 ' + (p.title || '?') + ' @ ' + (o.name || '?'));
      lines.push('   📧 ' + lead.email);
      if (c.persona) lines.push('   👤 ' + c.persona + ' | ' + (c.companySize || ''));
      lines.push('');
    });

    return { type: 'text', content: lines.join('\n') };
  }

  async _handleHotLeads(chatId, params, sendReply) {
    const limit = params.limit || 10;

    // Methode 1 : Leads enrichis avec behaviorScore >= 5
    const hotFromEnrich = storage.getHotLeads(limit);

    // Methode 2 : Hot leads depuis AutoMailer (cross-skill)
    let hotFromAutomailer = [];
    try {
      const automailerStorage = getAutomailerStorage();
      if (automailerStorage && automailerStorage.getHotLeads) {
        hotFromAutomailer = automailerStorage.getHotLeads();
      }
    } catch (e) {
      log.warn('lead-enrich', 'Erreur lecture hot leads automailer:', e.message);
    }

    // Fusionner et deduper par email
    const seen = new Set();
    const allHotLeads = [];

    // D'abord les leads enrichis avec behavior score
    for (const lead of hotFromEnrich) {
      const key = (lead.email || '').toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        allHotLeads.push({
          email: key,
          name: lead.enrichData ? (lead.enrichData.person || {}).fullName : null,
          title: lead.enrichData ? (lead.enrichData.person || {}).title : null,
          company: lead.enrichData ? (lead.enrichData.organization || {}).name : null,
          staticScore: lead.aiClassification ? lead.aiClassification.score : null,
          behaviorScore: lead.behaviorScore || 0,
          combinedScore: lead.combinedScore || 0,
          signals: lead.behaviorSignals || [],
          hotLead: true,
          source: 'enrichi'
        });
      }
    }

    // Ensuite les hot leads automailer non enrichis
    for (const hl of hotFromAutomailer) {
      const key = (hl.email || '').toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        // Calculer le behavior score pour ce lead
        let behaviorData = { behaviorScore: 0, signals: [], hotLead: false };
        try {
          behaviorData = this.classifier.calculateBehaviorScore(key);
        } catch (e) {}

        allHotLeads.push({
          email: key,
          name: null,
          title: null,
          company: null,
          staticScore: null,
          behaviorScore: behaviorData.behaviorScore,
          combinedScore: behaviorData.behaviorScore,
          signals: behaviorData.signals,
          hotLead: true,
          source: 'automailer',
          opens: hl.opens || 0,
          clicks: hl.clicks || 0,
          replied: hl.replied || false
        });
      }
    }

    if (allHotLeads.length === 0) {
      return { type: 'text', content: '📭 Aucun lead chaud pour l\'instant.\n\n💡 Les leads deviennent "chauds" quand ils ouvrent tes emails 3+ fois, cliquent, ou repondent.\n\n👉 _"enrichis jean@example.com"_ pour enrichir un lead' };
    }

    // Trier par score combine decroissant
    allHotLeads.sort((a, b) => (b.combinedScore || b.behaviorScore) - (a.combinedScore || a.behaviorScore));
    const display = allHotLeads.slice(0, limit);

    const lines = ['🔥 *LEADS CHAUDS* (engagement email)', '━━━━━━━━━━━━━━━━━━', ''];

    display.forEach((lead, i) => {
      const name = lead.name || lead.email;
      const scoreDisplay = lead.staticScore ? lead.staticScore + '/10' : '-';
      const behaviorDisplay = lead.behaviorScore > 0 ? '+' + lead.behaviorScore : String(lead.behaviorScore);

      lines.push('🔥 *' + (i + 1) + '. ' + name + '*');
      if (lead.title || lead.company) {
        lines.push('   💼 ' + (lead.title || '?') + (lead.company ? ' @ ' + lead.company : ''));
      }
      lines.push('   📧 ' + lead.email);
      lines.push('   📊 Score statique: ' + scoreDisplay + ' | Comportement: ' + behaviorDisplay);
      if (lead.signals && lead.signals.length > 0) {
        lines.push('   ⚡ ' + lead.signals.slice(0, 3).join(' | '));
      }
      if (lead.replied) {
        lines.push('   ✉️ *A REPONDU*');
      }
      lines.push('');
    });

    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('💡 _Un lead est "chaud" si son score comportemental >= 5_');

    return { type: 'text', content: lines.join('\n') };
  }

  async _handleEnrichReport(chatId, sendReply) {
    const stats = storage.getGlobalStats();
    const allLeads = storage.getAllEnrichedLeads(chatId);
    const creditsUsed = storage.getEnrichCreditsUsed();

    // Distribution des scores
    let high = 0, medium = 0, low = 0;
    const industries = {};
    const personas = {};

    allLeads.forEach(lead => {
      const score = lead.aiClassification ? lead.aiClassification.score || 0 : 0;
      if (score >= 8) high++;
      else if (score >= 6) medium++;
      else low++;

      const industry = lead.aiClassification ? lead.aiClassification.industry || 'Autre' : 'Autre';
      industries[industry] = (industries[industry] || 0) + 1;

      const persona = lead.aiClassification ? lead.aiClassification.persona || 'Autre' : 'Autre';
      personas[persona] = (personas[persona] || 0) + 1;
    });

    const total = allLeads.length || 1;
    const topIndustries = Object.entries(industries).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const lines = [
      '📊 *RAPPORT ENRICHISSEMENT*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '🔢 Total enrichis : ' + allLeads.length,
      '💰 Credits FullEnrich utilises : ' + creditsUsed,
      '',
      '📊 *Distribution scores :*',
      '   🔥 8-10 : ' + high + ' leads (' + Math.round(high / total * 100) + '%)',
      '   ✅ 6-7 : ' + medium + ' leads (' + Math.round(medium / total * 100) + '%)',
      '   ⚪ 1-5 : ' + low + ' leads (' + Math.round(low / total * 100) + '%)',
      ''
    ];

    if (topIndustries.length > 0) {
      lines.push('🏢 *Top industries :*');
      topIndustries.forEach(([industry, count]) => {
        lines.push('   ' + industry + ' : ' + count);
      });
      lines.push('');
    }

    lines.push('📦 *Sources :*');
    lines.push('   Telegram : ' + stats.totalTelegramEnrichments);
    lines.push('   HubSpot : ' + stats.totalHubspotEnrichments);
    lines.push('   AutoMailer : ' + stats.totalAutomailerEnrichments);
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('🔍 Lead Enrich | FullEnrich');

    return { type: 'text', content: lines.join('\n') };
  }

  async _handleEnrichCredits(chatId) {
    const used = storage.getEnrichCreditsUsed();

    // Tenter de recuperer le solde reel depuis FullEnrich
    let realBalance = null;
    if (this.enricher) {
      try {
        realBalance = await this.enricher.getCreditsBalance();
      } catch (e) {
        log.warn('lead-enrich', 'Erreur recuperation solde FullEnrich:', e.message);
      }
    }

    const lines = [
      '💰 *CREDITS FULLENRICH*',
      '━━━━━━━━━━━━━━━━━━',
      ''
    ];

    if (realBalance !== null && realBalance >= 0) {
      const total = realBalance + used;
      const pct = total > 0 ? Math.round(used / total * 20) : 0;
      const bar = '█'.repeat(pct) + '░'.repeat(20 - pct);
      lines.push('📊 ' + used + ' utilises | ' + realBalance + ' restants');
      lines.push('   [' + bar + ']');
    } else {
      lines.push('📊 ' + used + ' credits utilises (total local)');
      lines.push('⚠️ Solde FullEnrich non disponible');
    }

    lines.push('');
    lines.push('💡 1 credit = 1 email pro | 10 credits = 1 telephone');
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('🔍 Lead Enrich | FullEnrich');

    return { type: 'text', content: lines.join('\n') };
  }

  // ============================================================
  // CONVERSATIONS MULTI-ETAPES
  // ============================================================

  async _continueConversation(chatId, text, sendReply) {
    const conv = this.pendingConversations[String(chatId)];
    if (!conv) return null;

    if (conv.action === 'enrich_automailer_list') {
      return await this._automailerListConversation(chatId, text, conv, sendReply);
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  async _automailerListConversation(chatId, text, conv, sendReply) {
    if (conv.step === 'awaiting_list') {
      const lists = conv.data.lists;
      let list = null;
      const num = parseInt(text);
      if (!isNaN(num) && num >= 1 && num <= lists.length) {
        list = lists[num - 1];
      } else {
        list = lists.find(l => l.name.toLowerCase().includes(text.toLowerCase()));
      }
      if (!list) {
        return { type: 'text', content: '❌ Liste introuvable. Reessaie avec le numero ou le nom.' };
      }

      delete this.pendingConversations[String(chatId)];
      return this._prepareAutomailerBatch(chatId, list);
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  // ============================================================
  // FORMATAGE
  // ============================================================

  _formatEnrichedProfile(lead) {
    const src = lead.enrichData || lead.apolloData || {};
    const p = src.person || {};
    const o = src.organization || {};
    const c = lead.aiClassification || {};

    const scoreIcon = (c.score || 0) >= 8 ? '🔥' : (c.score || 0) >= 6 ? '✅' : '⚪';

    const lines = [
      '👤 *PROFIL ENRICHI*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '👤 *' + (p.fullName || lead.email) + '*',
      '💼 ' + (p.title || 'Poste inconnu') + ' @ ' + (o.name || 'Entreprise inconnue')
    ];

    const details = [];
    if (c.industry || o.industry) details.push(c.industry || o.industry);
    if (c.companySize) details.push(c.companySize);
    if (o.employeeCount) details.push(o.employeeCount + ' employes');
    if (details.length > 0) lines.push('🏢 ' + details.join(' | '));

    const location = [p.city, p.country].filter(Boolean).join(', ');
    if (location) lines.push('📍 ' + location + (o.foundedYear ? ' | Fondee en ' + o.foundedYear : ''));

    lines.push('');
    const fe = src._fullenrich || {};
    const emailStatusIcon = fe.emailStatus === 'DELIVERABLE' ? ' ✅' : fe.emailStatus === 'HIGH_PROBABILITY' ? ' 🟡' : fe.emailStatus === 'CATCH_ALL' ? ' ⚠️' : '';
    if (p.email || lead.email) lines.push('📧 ' + (p.email || lead.email) + emailStatusIcon);
    if (p.phone) lines.push('📞 ' + p.phone);
    if (p.linkedinUrl) lines.push('🔗 ' + p.linkedinUrl);
    if (o.website) lines.push('🌐 ' + o.website);

    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push(scoreIcon + ' *Score : ' + (c.score || '?') + '/10*');
    if (c.persona) lines.push('👤 ' + c.persona);
    if (c.scoreExplanation) lines.push('💡 _"' + c.scoreExplanation + '"_');

    // UPGRADE 1 : Afficher le behavior score si disponible
    if (lead.behaviorScore !== undefined && lead.behaviorScore !== 0) {
      lines.push('');
      lines.push('⚡ *Engagement email :* ' + (lead.behaviorScore > 0 ? '+' : '') + lead.behaviorScore + ' pts');
      if (lead.hotLead) {
        lines.push('🔥 *HOT LEAD*');
      }
      if (lead.behaviorSignals && lead.behaviorSignals.length > 0) {
        lead.behaviorSignals.forEach(function(signal) {
          lines.push('   • ' + signal);
        });
      }
      if (lead.combinedScore) {
        lines.push('📊 Score combine : ' + lead.combinedScore + '/10');
      }
    }

    return lines.join('\n');
  }

  getHelp() {
    return [
      '🔍 *LEAD ENRICH*',
      '',
      '👤 *Enrichir un lead :*',
      '  _"enrichis jean@example.com"_',
      '  _"enrichis Jean Dupont chez Acme"_',
      '  _"score de jean@example.com"_',
      '',
      '📋 *Enrichir en masse :*',
      '  _"enrichis mes contacts hubspot"_',
      '  _"enrichis la liste Prospects"_',
      '',
      '📊 *Rapports :*',
      '  _"leads prioritaires"_',
      '  _"leads chauds"_ / _"hot leads"_',
      '  _"rapport enrichissement"_',
      '  _"credits"_',
      '',
      '━━━━━━━━━━━━━━━━━━',
      '🔍 Lead Enrich | FullEnrich + IA'
    ].join('\n');
  }
}

module.exports = LeadEnrichHandler;
