// CRM Pilot - Handler NLP Telegram
const HubSpotClient = require('./hubspot-client.js');
const storage = require('./storage.js');
const https = require('https');
const { retryAsync } = require('../../gateway/utils.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const log = require('../../gateway/logger.js');

class CRMPilotHandler {
  constructor(openaiKey, hubspotKey) {
    this.openaiKey = openaiKey;
    this.hubspot = hubspotKey ? new HubSpotClient(hubspotKey) : null;

    // Etats conversationnels
    this.pendingConversations = {};   // chatId -> { step, action, data }
    this.pendingConfirmations = {};   // chatId -> { action, data }

    // Cache pipeline en memoire
    this._pipelineCache = null;
  }

  start() {
    // Pas de scheduler pour CRM Pilot pour l'instant
  }

  stop() {
    // Cleanup
  }

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

    const systemPrompt = `Tu es l'assistant CRM d'un bot Telegram. L'utilisateur parle en francais naturel, souvent de facon informelle ou avec des fautes.
Tu dois comprendre son INTENTION meme s'il ne dit pas les mots exacts.

Classifie le message en une action JSON.

Actions :
- "list_contacts" : voir les contacts HubSpot
  Params: {"limit": 10}
  Ex: "mes contacts", "qui j'ai dans le CRM ?", "montre mes contacts"
- "search_contact" : chercher un contact par email, nom ou entreprise
  Params: {"query": "jean@example.com", "by": "email|name|company"}
  Ex: "cherche jean dupont", "t'as le mail de chez Acme ?", "trouve le contact de Google"
- "show_contact" : detail complet d'un contact
  Params: {"email": "jean@...", "contact_id": "123"}
  Ex: "detail de jean@example.com", "montre moi tout sur ce contact"
- "create_contact" : creer un nouveau contact
  Params: {"email": "...", "firstname": "...", "lastname": "...", "company": "...", "jobtitle": "...", "phone": "..."}
  Ex: "ajoute jean@acme.com", "nouveau contact: Marie Durand, CTO chez Acme"
- "update_contact" : modifier un contact existant
  Params: {"email": "...", "updates": {"jobtitle": "CTO"}}
  Ex: "change le poste de jean a CTO", "mets a jour le tel de marie"
- "list_deals" : lister les deals / offres / opportunites
  Params: {"status": "all|open|won|lost", "limit": 10}
  Ex: "mes deals", "les offres en cours", "ou en sont mes opportunites ?", "combien de deals ouverts ?"
- "show_deal" : detail d'un deal
  Params: {"deal_id": "...", "name": "..."}
- "create_deal" : creer un deal / offre
  Params: {"name": "...", "amount": 5000, "contact_email": "..."}
  Ex: "nouveau deal Acme 5000€", "cree une offre pour jean@acme.com"
- "update_deal" : modifier un deal
  Params: {"deal_id": "...", "name": "...", "updates": {"dealstage": "closedwon", "amount": "10000"}}
  Ex: "le deal Acme est gagne", "passe le deal a 10000€"
- "pipeline_summary" : resume visuel du pipeline
  Ex: "pipeline", "mon pipeline", "resume du pipe", "ou en est le funnel ?"
- "add_note" : ajouter une note
  Params: {"target_email": "jean@...", "target_type": "contact|deal", "note_text": "..."}
  Ex: "note pour jean: rappeler lundi", "ajoute une note au deal Acme"
- "create_task" : creer une tache / un rappel
  Params: {"subject": "...", "due_date": "demain|lundi|2026-02-15", "target_email": "...", "priority": "HIGH|MEDIUM|LOW"}
  Ex: "rappelle moi de relancer jean demain", "tache: envoyer devis lundi"
- "list_tasks" : voir les taches en cours
  Ex: "mes taches", "qu'est-ce que j'ai a faire ?", "mes rappels"
- "weekly_report" : rapport hebdomadaire
  Ex: "rapport de la semaine", "resume hebdo", "bilan"
- "crm_stats" : statistiques globales
  Ex: "stats CRM", "mes chiffres", "combien de contacts j'ai ?"
- "search_company" : chercher par entreprise
  Params: {"company": "Acme"}
  Ex: "les contacts chez Google", "tout ce qu'on a sur Acme"
- "confirm_yes" : confirmation positive
  Ex: "oui", "ok", "go", "c'est bon", "parfait", "valide"
- "confirm_no" : refus / annulation
  Ex: "non", "annule", "stop", "laisse tomber"
- "help" : demande d'aide explicite
  Ex: "aide CRM", "comment ca marche ?", "qu'est-ce que tu sais faire ?"
- "chat" : UNIQUEMENT si ca ne correspond a aucune action ci-dessus

${hasPendingConfirm ? 'ATTENTION: CONFIRMATION en attente. "oui/ok/go/parfait" = confirm_yes, "non/annule/stop" = confirm_no.' : ''}
${hasPendingConv ? 'ATTENTION: Workflow multi-etapes en cours. Classe en "continue_conversation" sauf si c\'est CLAIREMENT une autre action.' : ''}

Reponds UNIQUEMENT en JSON strict :
{"action":"search_contact","params":{"query":"jean@example.com","by":"email"}}
{"action":"create_deal","params":{"name":"Contrat Acme","amount":5000}}
{"action":"pipeline_summary"}
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
      log.error('crm-pilot', 'Erreur classifyIntent:', error.message);
      return null;
    }
  }

  // --- Handler principal ---

  async handleMessage(message, chatId, sendReply) {
    const user = storage.getUser(chatId);
    const text = message.trim();
    const textLower = text.toLowerCase();

    if (!this.hubspot) {
      return { type: 'text', content: '❌ La cle API HubSpot n\'est pas configuree.' };
    }

    // Commandes rapides
    if (textLower === 'aide crm' || textLower === 'help crm' || textLower === '/start') {
      return { type: 'text', content: this.getHelp() };
    }

    // Conversation en cours
    if (this.pendingConversations[String(chatId)]) {
      // Detecter si l'utilisateur veut annuler ou changer d'action
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
      return { type: 'text', content: 'Je n\'ai pas compris. Dis _"aide crm"_ pour voir ce que je sais faire !' };
    }

    switch (command.action) {

      // --- CONTACTS ---
      case 'list_contacts':
        return await this._handleListContacts(chatId, command.params || {}, sendReply);

      case 'search_contact':
        return await this._handleSearchContact(chatId, command.params || {}, sendReply);

      case 'show_contact':
        return await this._handleShowContact(chatId, command.params || {}, sendReply);

      case 'create_contact':
        return await this._handleCreateContact(chatId, command.params || {}, sendReply);

      case 'update_contact':
        return await this._handleUpdateContact(chatId, command.params || {}, sendReply);

      case 'search_company':
        return await this._handleSearchCompany(chatId, command.params || {}, sendReply);

      // --- DEALS ---
      case 'list_deals':
        return await this._handleListDeals(chatId, command.params || {}, sendReply);

      case 'show_deal':
        return await this._handleShowDeal(chatId, command.params || {}, sendReply);

      case 'create_deal':
        return await this._handleCreateDeal(chatId, command.params || {}, sendReply);

      case 'update_deal':
        return await this._handleUpdateDeal(chatId, command.params || {}, sendReply);

      // --- PIPELINE ---
      case 'pipeline_summary':
        return await this._handlePipelineSummary(chatId, sendReply);

      // --- NOTES ---
      case 'add_note':
        return await this._handleAddNote(chatId, command.params || {}, sendReply);

      // --- TACHES ---
      case 'create_task':
        return await this._handleCreateTask(chatId, command.params || {}, sendReply);

      case 'list_tasks':
        return await this._handleListTasks(chatId, sendReply);

      // --- RAPPORTS ---
      case 'weekly_report':
        return await this._handleWeeklyReport(chatId, sendReply);

      case 'crm_stats':
        return await this._handleCRMStats(chatId, sendReply);

      // --- CONFIRMATIONS ---
      case 'confirm_yes': {
        const pending = this.pendingConfirmations[String(chatId)];
        if (pending) return await this._executeConfirmation(chatId, sendReply);
        return { type: 'text', content: 'Rien en attente. Dis-moi ce que tu veux faire !' };
      }

      case 'confirm_no': {
        delete this.pendingConfirmations[String(chatId)];
        delete this.pendingConversations[String(chatId)];
        return { type: 'text', content: '👌 Annule.' };
      }

      case 'continue_conversation':
        return await this._continueConversation(chatId, text, sendReply);

      case 'help':
        return { type: 'text', content: this.getHelp() };

      case 'chat': {
        try {
          const openaiBreaker = getBreaker('openai', { failureThreshold: 3, cooldownMs: 60000 });
          const response = await openaiBreaker.call(() => retryAsync(() => this.callOpenAI([
            { role: 'system', content: 'Tu es l\'assistant CRM Pilot du bot Telegram. Tu aides a gerer le CRM HubSpot. Reponds en francais, 1-3 phrases max.' },
            { role: 'user', content: text }
          ], 200), 2, 2000));
          return { type: 'text', content: response.trim() };
        } catch (e) {
          return { type: 'text', content: 'Dis-moi ce que tu veux faire ! Exemples :\n_"mes contacts hubspot"_\n_"mon pipeline"_\n_"cree une offre"_' };
        }
      }

      default:
        return { type: 'text', content: this.getHelp() };
    }
  }

  // ============================================================
  // CONTACTS
  // ============================================================

  async _handleListContacts(chatId, params, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '🔍 _Chargement des contacts HubSpot..._' });
    try {
      const limit = params.limit || 10;
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const result = await hsBreaker.call(() => retryAsync(() => this.hubspot.listContacts(limit), 2, 2000));
      storage.incrementStat(chatId, 'contactsViewed');

      if (result.contacts.length === 0) {
        return { type: 'text', content: '📭 Aucun contact dans HubSpot.' };
      }

      const lines = ['📋 *CONTACTS HUBSPOT*', '━━━━━━━━━━━━━━━━━━', ''];
      result.contacts.forEach((c, i) => {
        lines.push((i + 1) + '. *' + (c.name || 'Sans nom') + '*');
        lines.push('   📧 ' + (c.email || 'pas d\'email'));
        if (c.company || c.jobtitle) {
          lines.push('   🏢 ' + (c.company || '') + (c.jobtitle ? ' | ' + c.jobtitle : ''));
        }
        if (c.city) lines.push('   📍 ' + c.city);
        lines.push('');
      });

      if (result.hasMore) {
        lines.push('... et d\'autres contacts');
      }
      lines.push('━━━━━━━━━━━━━━━━━━');
      lines.push('📊 CRM Pilot');

      return { type: 'text', content: lines.join('\n') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur HubSpot : ' + error.message };
    }
  }

  async _handleSearchContact(chatId, params, sendReply) {
    const query = params.query;
    const by = params.by || 'email';

    if (!query) {
      return { type: 'text', content: '❌ Donne-moi un email, nom ou entreprise a chercher.\nExemple : _"cherche jean@example.com"_' };
    }

    if (sendReply) await sendReply({ type: 'text', content: '🔍 _Recherche de "' + query + '"..._' });

    try {
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const contacts = await hsBreaker.call(() => retryAsync(() => this.hubspot.searchContacts(query, by), 2, 2000));
      storage.incrementStat(chatId, 'searchesPerformed');

      if (contacts.length === 0) {
        return { type: 'text', content: '📭 Contact "' + query + '" introuvable dans HubSpot.\n👉 _"ajoute un contact ' + query + '"_ pour le creer' };
      }

      if (contacts.length === 1) {
        return { type: 'text', content: this._formatContactDetail(contacts[0]) };
      }

      const lines = ['🔍 *RESULTATS* (' + contacts.length + ' contacts)', '━━━━━━━━━━━━━━━━━━', ''];
      contacts.forEach((c, i) => {
        lines.push((i + 1) + '. *' + (c.name || 'Sans nom') + '* — ' + (c.email || ''));
        if (c.company) lines.push('   🏢 ' + c.company + (c.jobtitle ? ' | ' + c.jobtitle : ''));
        lines.push('');
      });

      return { type: 'text', content: lines.join('\n') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur recherche : ' + error.message };
    }
  }

  async _handleShowContact(chatId, params, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '🔍 _Chargement..._' });
    try {
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      let contact = null;
      if (params.contact_id) {
        contact = await hsBreaker.call(() => retryAsync(() => this.hubspot.getContact(params.contact_id), 2, 2000));
      } else if (params.email) {
        contact = await hsBreaker.call(() => retryAsync(() => this.hubspot.findContactByEmail(params.email), 2, 2000));
      }
      if (!contact) {
        return { type: 'text', content: '📭 Contact introuvable.' };
      }
      storage.incrementStat(chatId, 'contactsViewed');
      return { type: 'text', content: this._formatContactDetail(contact) };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur : ' + error.message };
    }
  }

  async _handleCreateContact(chatId, params, sendReply) {
    // Si on a assez d'infos, demander confirmation directe
    if (params.email && params.email.includes('@')) {
      const summary = this._buildContactSummary(params);
      this.pendingConfirmations[String(chatId)] = {
        action: 'create_contact',
        data: params
      };
      return { type: 'text', content: '👤 *NOUVEAU CONTACT*\n━━━━━━━━━━━━━━━━━━\n\n' + summary + '\n\n👉 _"oui"_ pour creer | _"annule"_ pour annuler' };
    }

    // Sinon, workflow multi-etapes
    this.pendingConversations[String(chatId)] = {
      action: 'create_contact',
      step: 'awaiting_email',
      data: { ...params }
    };
    return { type: 'text', content: '👤 *Nouveau contact*\n\nQuelle est l\'adresse email ?' };
  }

  async _handleUpdateContact(chatId, params, sendReply) {
    const email = params.email;
    const updates = params.updates || {};

    if (!email) {
      return { type: 'text', content: '❌ Donne-moi l\'email du contact a modifier.\nExemple : _"modifie jean@example.com, son poste est CTO"_' };
    }

    if (sendReply) await sendReply({ type: 'text', content: '🔍 _Recherche du contact..._' });

    try {
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const contact = await hsBreaker.call(() => retryAsync(() => this.hubspot.findContactByEmail(email), 2, 2000));
      if (!contact) {
        return { type: 'text', content: '📭 Contact "' + email + '" introuvable.' };
      }

      if (Object.keys(updates).length === 0) {
        // Demander quoi modifier
        this.pendingConversations[String(chatId)] = {
          action: 'update_contact',
          step: 'awaiting_field',
          data: { contactId: contact.id, email: email, contact: contact }
        };
        return { type: 'text', content: this._formatContactDetail(contact) + '\n\n✏️ Que veux-tu modifier ?\nExemple : _"poste = CTO"_, _"entreprise = Acme Corp"_, _"telephone = +33612345678"_' };
      }

      // Appliquer les modifications
      const updated = await hsBreaker.call(() => retryAsync(() => this.hubspot.updateContact(contact.id, updates), 2, 2000));
      storage.incrementStat(chatId, 'contactsUpdated');
      storage.logActivity(chatId, 'update_contact', { email: email, updates: updates });
      storage.invalidateContactCache(chatId);

      return { type: 'text', content: '✅ *Contact modifie !*\n\n' + this._formatContactDetail(updated) };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur modification : ' + error.message };
    }
  }

  async _handleSearchCompany(chatId, params, sendReply) {
    const company = params.company;
    if (!company) {
      return { type: 'text', content: '❌ Quelle entreprise ?\nExemple : _"contacts de la societe Acme"_' };
    }

    if (sendReply) await sendReply({ type: 'text', content: '🔍 _Recherche contacts de "' + company + '"..._' });

    try {
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const contacts = await hsBreaker.call(() => retryAsync(() => this.hubspot.searchContacts(company, 'company'), 2, 2000));
      storage.incrementStat(chatId, 'searchesPerformed');

      if (contacts.length === 0) {
        return { type: 'text', content: '📭 Aucun contact trouve pour "' + company + '".' };
      }

      const lines = ['🏢 *CONTACTS DE ' + company.toUpperCase() + '* (' + contacts.length + ')', '━━━━━━━━━━━━━━━━━━', ''];
      contacts.forEach((c, i) => {
        lines.push((i + 1) + '. *' + (c.name || 'Sans nom') + '* — ' + (c.email || ''));
        if (c.jobtitle) lines.push('   💼 ' + c.jobtitle);
        lines.push('');
      });

      return { type: 'text', content: lines.join('\n') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur recherche : ' + error.message };
    }
  }

  // ============================================================
  // DEALS
  // ============================================================

  async _handleListDeals(chatId, params, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '🔍 _Chargement des offres..._' });
    try {
      const limit = params.limit || 10;
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const result = await hsBreaker.call(() => retryAsync(() => this.hubspot.listDeals(limit), 2, 2000));
      const pipeline = await this._getPipeline();

      if (result.deals.length === 0) {
        return { type: 'text', content: '📭 Aucune offre dans HubSpot.\n👉 _"cree une offre"_ pour commencer' };
      }

      const lines = ['💼 *MES OFFRES*', '━━━━━━━━━━━━━━━━━━', ''];
      result.deals.forEach((d, i) => {
        const stageName = this._getStageName(pipeline, d.stage);
        const stageIcon = this._getStageIcon(d.stage);
        lines.push(stageIcon + ' *' + (i + 1) + '. ' + (d.name || 'Sans nom') + '*');
        lines.push('   📌 ' + stageName + (d.amount ? ' | 💰 ' + this._formatAmount(d.amount) : ''));
        if (d.closeDate) lines.push('   📅 Cloture : ' + this._formatDate(d.closeDate));
        lines.push('');
      });

      return { type: 'text', content: lines.join('\n') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur : ' + error.message };
    }
  }

  async _handleShowDeal(chatId, params, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '🔍 _Chargement..._' });
    try {
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      let deal = null;
      if (params.deal_id) {
        deal = await hsBreaker.call(() => retryAsync(() => this.hubspot.getDeal(params.deal_id), 2, 2000));
      } else if (params.name) {
        const deals = await hsBreaker.call(() => retryAsync(() => this.hubspot.searchDeals(params.name), 2, 2000));
        deal = deals.length > 0 ? deals[0] : null;
      }
      if (!deal) {
        return { type: 'text', content: '📭 Offre introuvable.' };
      }
      const pipeline = await this._getPipeline();
      return { type: 'text', content: this._formatDealDetail(deal, pipeline) };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur : ' + error.message };
    }
  }

  async _handleCreateDeal(chatId, params, sendReply) {
    // Si on a assez d'infos
    if (params.name) {
      const pipeline = await this._getPipeline();
      this.pendingConfirmations[String(chatId)] = {
        action: 'create_deal',
        data: {
          dealname: params.name,
          amount: params.amount || 0,
          dealstage: params.stage || (pipeline.stages.length > 0 ? pipeline.stages[0].id : 'appointmentscheduled'),
          contact_email: params.contact_email || null
        }
      };
      const stageName = this._getStageName(pipeline, this.pendingConfirmations[String(chatId)].data.dealstage);
      return { type: 'text', content: '💼 *NOUVELLE OFFRE*\n━━━━━━━━━━━━━━━━━━\n\n📌 *' + params.name + '*\n💰 ' + this._formatAmount(params.amount || 0) + '\n📊 Etape : ' + stageName + '\n\n👉 _"oui"_ pour creer | _"annule"_ pour annuler' };
    }

    // Workflow multi-etapes
    this.pendingConversations[String(chatId)] = {
      action: 'create_deal',
      step: 'awaiting_name',
      data: {}
    };
    return { type: 'text', content: '💼 *Nouvelle offre*\n\nQuel nom pour cette offre ?' };
  }

  async _handleUpdateDeal(chatId, params, sendReply) {
    if (!params.deal_id && !params.name) {
      return { type: 'text', content: '❌ Quelle offre modifier ?\nExemple : _"change le statut de l\'offre Acme"_' };
    }

    if (sendReply) await sendReply({ type: 'text', content: '🔍 _Recherche de l\'offre..._' });

    try {
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      let deal = null;
      if (params.deal_id) {
        deal = await hsBreaker.call(() => retryAsync(() => this.hubspot.getDeal(params.deal_id), 2, 2000));
      } else {
        const deals = await hsBreaker.call(() => retryAsync(() => this.hubspot.searchDeals(params.name), 2, 2000));
        deal = deals.length > 0 ? deals[0] : null;
      }
      if (!deal) {
        return { type: 'text', content: '📭 Offre introuvable.' };
      }

      const pipeline = await this._getPipeline();
      const updates = params.updates || {};

      if (Object.keys(updates).length === 0) {
        // Demander quoi modifier — afficher les stages possibles
        const stageList = pipeline.stages.map((s, i) => (i + 1) + '. ' + s.label).join('\n');
        this.pendingConversations[String(chatId)] = {
          action: 'update_deal',
          step: 'awaiting_update',
          data: { dealId: deal.id, deal: deal, pipeline: pipeline }
        };
        const currentStage = this._getStageName(pipeline, deal.stage);
        return { type: 'text', content: '💼 *' + deal.name + '* (actuellement : ' + currentStage + ')\n\nQue veux-tu modifier ?\n\n📊 *Etapes disponibles :*\n' + stageList + '\n\nExemple : _"etape 3"_, _"montant 10000"_, _"gagne"_' };
      }

      // Appliquer les modifications
      const updated = await hsBreaker.call(() => retryAsync(() => this.hubspot.updateDeal(deal.id, updates), 2, 2000));
      storage.incrementStat(chatId, 'dealsUpdated');
      storage.logActivity(chatId, 'update_deal', { dealId: deal.id, updates: updates });
      storage.invalidateDealCache(chatId);

      return { type: 'text', content: '✅ *Offre modifiee !*\n\n' + this._formatDealDetail(updated, pipeline) };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur : ' + error.message };
    }
  }

  // ============================================================
  // PIPELINE
  // ============================================================

  async _handlePipelineSummary(chatId, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '📊 _Chargement du pipeline..._' });
    try {
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const pipeline = await this._getPipeline();
      const result = await hsBreaker.call(() => retryAsync(() => this.hubspot.listDeals(100), 2, 2000));
      storage.incrementStat(chatId, 'pipelineViewed');

      // Grouper les deals par stage
      const dealsByStage = {};
      pipeline.stages.forEach(s => { dealsByStage[s.id] = []; });
      result.deals.forEach(d => {
        if (dealsByStage[d.stage]) {
          dealsByStage[d.stage].push(d);
        }
      });

      const lines = ['📊 *MON PIPELINE*', '━━━━━━━━━━━━━━━━━━', ''];
      let totalPipeline = 0;

      pipeline.stages.forEach(stage => {
        const deals = dealsByStage[stage.id] || [];
        const stageTotal = deals.reduce((sum, d) => sum + (d.amount || 0), 0);
        const icon = this._getStageIcon(stage.id);

        lines.push(icon + ' *' + stage.label + '* (' + deals.length + ' offre' + (deals.length > 1 ? 's' : '') + ')');

        if (deals.length > 0) {
          deals.slice(0, 5).forEach(d => {
            lines.push('   • ' + d.name + (d.amount ? ' — ' + this._formatAmount(d.amount) : ''));
          });
          if (deals.length > 5) lines.push('   ... et ' + (deals.length - 5) + ' autres');
          if (stageTotal > 0) lines.push('   💰 Total : ' + this._formatAmount(stageTotal));
        }
        lines.push('');

        if (!stage.id.includes('closed') && !stage.id.includes('lost')) {
          totalPipeline += stageTotal;
        }
      });

      lines.push('━━━━━━━━━━━━━━━━━━');
      lines.push('💰 Pipeline actif : ' + this._formatAmount(totalPipeline));

      return { type: 'text', content: lines.join('\n') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur pipeline : ' + error.message };
    }
  }

  // ============================================================
  // NOTES
  // ============================================================

  async _handleAddNote(chatId, params, sendReply) {
    const targetEmail = params.target_email;
    const noteText = params.note_text;

    if (!targetEmail) {
      this.pendingConversations[String(chatId)] = {
        action: 'add_note',
        step: 'awaiting_email',
        data: { noteText: noteText || null }
      };
      return { type: 'text', content: '📝 *Ajouter une note*\n\nSur quel contact ? (donne l\'email)' };
    }

    if (!noteText) {
      this.pendingConversations[String(chatId)] = {
        action: 'add_note',
        step: 'awaiting_text',
        data: { targetEmail: targetEmail }
      };
      return { type: 'text', content: '📝 Quelle note veux-tu ajouter au contact *' + targetEmail + '* ?' };
    }

    // On a tout, executer
    return await this._executeAddNote(chatId, targetEmail, noteText, sendReply);
  }

  async _executeAddNote(chatId, email, noteText, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '📝 _Ajout de la note..._' });
    try {
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const contact = await hsBreaker.call(() => retryAsync(() => this.hubspot.findContactByEmail(email), 2, 2000));
      if (!contact) {
        return { type: 'text', content: '📭 Contact "' + email + '" introuvable dans HubSpot.' };
      }

      const note = await hsBreaker.call(() => retryAsync(() => this.hubspot.createNote(noteText), 2, 2000));
      await hsBreaker.call(() => retryAsync(() => this.hubspot.associateNoteToContact(note.id, contact.id), 2, 2000));

      storage.incrementStat(chatId, 'notesAdded');
      storage.incrementGlobalStat('totalNotesAdded');
      storage.logActivity(chatId, 'add_note', { email: email, noteId: note.id });

      return { type: 'text', content: '✅ *Note ajoutee !*\n\n👤 ' + (contact.name || email) + '\n📝 ' + noteText };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur : ' + error.message };
    }
  }

  // ============================================================
  // TACHES
  // ============================================================

  async _handleCreateTask(chatId, params, sendReply) {
    const subject = params.subject;
    const dueDate = params.due_date;

    if (!subject) {
      this.pendingConversations[String(chatId)] = {
        action: 'create_task',
        step: 'awaiting_subject',
        data: { targetEmail: params.target_email || null }
      };
      return { type: 'text', content: '✅ *Nouvelle tache*\n\nQuel est l\'objet de la tache ?' };
    }

    const parsedDate = dueDate ? this._parseDateRelative(dueDate) : null;

    if (!parsedDate) {
      this.pendingConversations[String(chatId)] = {
        action: 'create_task',
        step: 'awaiting_due_date',
        data: { subject: subject, targetEmail: params.target_email || null, priority: params.priority || 'MEDIUM' }
      };
      return { type: 'text', content: '📅 Pour quand ? (demain, lundi, dans 3 jours, 15/02...)' };
    }

    return await this._executeCreateTask(chatId, {
      subject: subject,
      dueDate: parsedDate,
      targetEmail: params.target_email || null,
      priority: params.priority || 'MEDIUM'
    }, sendReply);
  }

  async _executeCreateTask(chatId, data, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '✅ _Creation de la tache..._' });
    try {
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const task = await hsBreaker.call(() => retryAsync(() => this.hubspot.createTask({
        subject: data.subject,
        body: data.subject,
        status: 'NOT_STARTED',
        priority: data.priority,
        dueDate: data.dueDate
      }), 2, 2000));

      // Associer a un contact si specifie
      if (data.targetEmail) {
        const contact = await hsBreaker.call(() => retryAsync(() => this.hubspot.findContactByEmail(data.targetEmail), 2, 2000));
        if (contact) {
          await hsBreaker.call(() => retryAsync(() => this.hubspot.associateTaskToContact(task.id, contact.id), 2, 2000));
        }
      }

      storage.incrementStat(chatId, 'tasksCreated');
      storage.incrementGlobalStat('totalTasksCreated');
      storage.logActivity(chatId, 'create_task', { subject: data.subject, dueDate: data.dueDate });

      return { type: 'text', content: '✅ *Tache creee !*\n\n📌 ' + data.subject + '\n📅 Echeance : ' + this._formatDate(data.dueDate) + '\n⚡ Priorite : ' + data.priority + (data.targetEmail ? '\n👤 Contact : ' + data.targetEmail : '') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur : ' + error.message };
    }
  }

  async _handleListTasks(chatId, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '🔍 _Chargement des taches..._' });
    try {
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const tasks = await hsBreaker.call(() => retryAsync(() => this.hubspot.listTasks(15), 2, 2000));

      if (tasks.length === 0) {
        return { type: 'text', content: '📭 Aucune tache.\n👉 _"cree une tache pour rappeler..."_' };
      }

      const lines = ['✅ *MES TACHES*', '━━━━━━━━━━━━━━━━━━', ''];
      tasks.forEach((t, i) => {
        const statusIcon = t.status === 'COMPLETED' ? '✅' : t.status === 'IN_PROGRESS' ? '🔄' : '⬜';
        lines.push(statusIcon + ' *' + (i + 1) + '. ' + (t.subject || 'Sans objet') + '*');
        if (t.dueDate) lines.push('   📅 Echeance : ' + this._formatDate(t.dueDate));
        lines.push('   ⚡ ' + (t.priority || 'MEDIUM') + ' | ' + (t.status || 'NOT_STARTED'));
        lines.push('');
      });

      return { type: 'text', content: lines.join('\n') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur : ' + error.message };
    }
  }

  // ============================================================
  // RAPPORTS
  // ============================================================

  async _handleWeeklyReport(chatId, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '📊 _Generation du rapport..._' });
    try {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Recuperer contacts et deals recents
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const contactsResult = await hsBreaker.call(() => retryAsync(() => this.hubspot.listContacts(100), 2, 2000));
      const dealsResult = await hsBreaker.call(() => retryAsync(() => this.hubspot.listDeals(100), 2, 2000));
      const pipeline = await this._getPipeline();

      // Filtrer par date de creation (cette semaine)
      const newContacts = contactsResult.contacts.filter(c => c.createdAt && new Date(c.createdAt) >= weekAgo);
      const newDeals = dealsResult.deals.filter(d => d.createdAt && new Date(d.createdAt) >= weekAgo);

      // Stats deals
      const wonDeals = dealsResult.deals.filter(d => d.stage && (d.stage.includes('closedwon') || d.stage === 'closedwon'));
      const wonThisWeek = wonDeals.filter(d => d.updatedAt && new Date(d.updatedAt) >= weekAgo);
      const wonAmount = wonThisWeek.reduce((s, d) => s + (d.amount || 0), 0);

      const activeDeals = dealsResult.deals.filter(d => !d.stage.includes('closed') && !d.stage.includes('lost'));
      const pipelineTotal = activeDeals.reduce((s, d) => s + (d.amount || 0), 0);

      // Activite locale
      const recentActivity = storage.getRecentActivity(chatId, 50);
      const weekActivity = recentActivity.filter(a => new Date(a.createdAt) >= weekAgo);
      const notesCount = weekActivity.filter(a => a.action === 'add_note').length;
      const tasksCount = weekActivity.filter(a => a.action === 'create_task').length;

      storage.incrementStat(chatId, 'reportsGenerated');

      const fromDate = weekAgo.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const toDate = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

      const lines = [
        '📊 *RAPPORT HEBDO CRM*',
        '━━━━━━━━━━━━━━━━━━',
        '📅 Semaine du ' + fromDate + ' au ' + toDate,
        '',
        '👥 *Contacts*',
        '   ➕ ' + newContacts.length + ' nouveau' + (newContacts.length > 1 ? 'x' : '') + ' contact' + (newContacts.length > 1 ? 's' : ''),
        '',
        '💼 *Offres*',
        '   ➕ ' + newDeals.length + ' nouvelle' + (newDeals.length > 1 ? 's' : '') + ' offre' + (newDeals.length > 1 ? 's' : ''),
        '   ✅ ' + wonThisWeek.length + ' offre' + (wonThisWeek.length > 1 ? 's' : '') + ' gagnee' + (wonThisWeek.length > 1 ? 's' : '') + (wonAmount > 0 ? ' (' + this._formatAmount(wonAmount) + ')' : ''),
        '   📊 Pipeline actif : ' + this._formatAmount(pipelineTotal),
        '',
        '📝 *Activite*',
        '   📓 ' + notesCount + ' note' + (notesCount > 1 ? 's' : '') + ' ajoutee' + (notesCount > 1 ? 's' : ''),
        '   ✅ ' + tasksCount + ' tache' + (tasksCount > 1 ? 's' : '') + ' creee' + (tasksCount > 1 ? 's' : ''),
        '',
        '━━━━━━━━━━━━━━━━━━',
        '📊 CRM Pilot'
      ];

      return { type: 'text', content: lines.join('\n') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur rapport : ' + error.message };
    }
  }

  async _handleCRMStats(chatId, sendReply) {
    if (sendReply) await sendReply({ type: 'text', content: '📊 _Chargement des stats..._' });
    try {
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const contactsResult = await hsBreaker.call(() => retryAsync(() => this.hubspot.listContacts(1), 2, 2000));
      const dealsResult = await hsBreaker.call(() => retryAsync(() => this.hubspot.listDeals(100), 2, 2000));
      const userStats = storage.getUser(chatId).stats;

      const activeDeals = dealsResult.deals.filter(d => !d.stage.includes('closed') && !d.stage.includes('lost'));
      const pipelineTotal = activeDeals.reduce((s, d) => s + (d.amount || 0), 0);
      const totalRevenue = dealsResult.deals
        .filter(d => d.stage && d.stage.includes('closedwon'))
        .reduce((s, d) => s + (d.amount || 0), 0);

      const lines = [
        '📊 *STATISTIQUES CRM*',
        '━━━━━━━━━━━━━━━━━━',
        '',
        '👥 Contacts : ' + (contactsResult.total || contactsResult.contacts.length),
        '💼 Offres : ' + dealsResult.deals.length + ' (dont ' + activeDeals.length + ' actives)',
        '💰 Pipeline : ' + this._formatAmount(pipelineTotal),
        '🏆 CA gagne : ' + this._formatAmount(totalRevenue),
        '',
        '📝 *Ton activite*',
        '   🔍 ' + userStats.searchesPerformed + ' recherches',
        '   👤 ' + userStats.contactsCreated + ' contacts crees',
        '   💼 ' + userStats.dealsCreated + ' offres creees',
        '   📓 ' + userStats.notesAdded + ' notes',
        '   ✅ ' + userStats.tasksCreated + ' taches',
        '',
        '━━━━━━━━━━━━━━━━━━',
        '📊 CRM Pilot'
      ];

      return { type: 'text', content: lines.join('\n') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur stats : ' + error.message };
    }
  }

  // ============================================================
  // CONVERSATIONS MULTI-ETAPES
  // ============================================================

  async _continueConversation(chatId, text, sendReply) {
    const conv = this.pendingConversations[String(chatId)];
    if (!conv) return null;

    if (conv.action === 'create_contact') return await this._createContactConversation(chatId, text, conv, sendReply);
    if (conv.action === 'create_deal') return await this._createDealConversation(chatId, text, conv, sendReply);
    if (conv.action === 'add_note') return await this._addNoteConversation(chatId, text, conv, sendReply);
    if (conv.action === 'create_task') return await this._createTaskConversation(chatId, text, conv, sendReply);
    if (conv.action === 'update_contact') return await this._updateContactConversation(chatId, text, conv, sendReply);
    if (conv.action === 'update_deal') return await this._updateDealConversation(chatId, text, conv, sendReply);

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  async _createContactConversation(chatId, text, conv, sendReply) {
    switch (conv.step) {
      case 'awaiting_email':
        if (!text.includes('@')) {
          return { type: 'text', content: '❌ Donne une adresse email valide.' };
        }
        conv.data.email = text.trim();
        conv.step = 'awaiting_name';
        return { type: 'text', content: '👤 Nom et prenom ?' };

      case 'awaiting_name': {
        const parts = text.trim().split(/\s+/);
        conv.data.firstname = parts[0] || '';
        conv.data.lastname = parts.slice(1).join(' ') || '';
        conv.step = 'awaiting_company';
        return { type: 'text', content: '🏢 Entreprise et poste ? (ou _"passe"_ pour ignorer)\nExemple : _"Acme Corp, CEO"_' };
      }

      case 'awaiting_company': {
        if (text.toLowerCase() !== 'passe') {
          const parts = text.split(',').map(s => s.trim());
          conv.data.company = parts[0] || '';
          conv.data.jobtitle = parts[1] || '';
        }
        // Demander confirmation
        const summary = this._buildContactSummary(conv.data);
        this.pendingConfirmations[String(chatId)] = {
          action: 'create_contact',
          data: conv.data
        };
        delete this.pendingConversations[String(chatId)];
        return { type: 'text', content: '👤 *RESUME*\n━━━━━━━━━━━━━━━━━━\n\n' + summary + '\n\n👉 _"oui"_ pour creer | _"annule"_ pour annuler' };
      }
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  async _createDealConversation(chatId, text, conv, sendReply) {
    switch (conv.step) {
      case 'awaiting_name':
        conv.data.dealname = text.trim();
        conv.step = 'awaiting_amount';
        return { type: 'text', content: '💰 Quel montant (en EUR) ?\n(ou _"0"_ si pas de montant)' };

      case 'awaiting_amount': {
        const amount = parseFloat(text.replace(/[^\d.]/g, '')) || 0;
        conv.data.amount = amount;
        conv.step = 'awaiting_stage';
        const pipeline = await this._getPipeline();
        const stageList = pipeline.stages.map((s, i) => (i + 1) + '. ' + s.label).join('\n');
        return { type: 'text', content: '📊 Quelle etape du pipeline ?\n\n' + stageList + '\n\n_Reponds avec le numero._' };
      }

      case 'awaiting_stage': {
        const pipeline = await this._getPipeline();
        const num = parseInt(text);
        let stage;
        if (!isNaN(num) && num >= 1 && num <= pipeline.stages.length) {
          stage = pipeline.stages[num - 1];
        } else {
          stage = pipeline.stages.find(s => s.label.toLowerCase().includes(text.toLowerCase()));
        }
        if (!stage) {
          return { type: 'text', content: '❌ Etape invalide. Donne le numero (1-' + pipeline.stages.length + ').' };
        }
        conv.data.dealstage = stage.id;

        // Confirmation
        const stageName = stage.label;
        this.pendingConfirmations[String(chatId)] = {
          action: 'create_deal',
          data: conv.data
        };
        delete this.pendingConversations[String(chatId)];
        return { type: 'text', content: '💼 *RESUME*\n━━━━━━━━━━━━━━━━━━\n\n📌 *' + conv.data.dealname + '*\n💰 ' + this._formatAmount(conv.data.amount) + '\n📊 Etape : ' + stageName + '\n\n👉 _"oui"_ pour creer | _"annule"_ pour annuler' };
      }
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  async _addNoteConversation(chatId, text, conv, sendReply) {
    switch (conv.step) {
      case 'awaiting_email':
        if (!text.includes('@')) {
          return { type: 'text', content: '❌ Donne une adresse email valide.' };
        }
        conv.data.targetEmail = text.trim();
        if (conv.data.noteText) {
          delete this.pendingConversations[String(chatId)];
          return await this._executeAddNote(chatId, conv.data.targetEmail, conv.data.noteText, sendReply);
        }
        conv.step = 'awaiting_text';
        return { type: 'text', content: '📝 Quelle note ?' };

      case 'awaiting_text':
        delete this.pendingConversations[String(chatId)];
        return await this._executeAddNote(chatId, conv.data.targetEmail, text, sendReply);
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  async _createTaskConversation(chatId, text, conv, sendReply) {
    switch (conv.step) {
      case 'awaiting_subject':
        conv.data.subject = text.trim();
        conv.step = 'awaiting_due_date';
        return { type: 'text', content: '📅 Pour quand ? (demain, lundi, dans 3 jours, 15/02...)' };

      case 'awaiting_due_date': {
        const parsedDate = this._parseDateRelative(text);
        if (!parsedDate) {
          return { type: 'text', content: '❌ Date non comprise. Exemples : _"demain"_, _"lundi"_, _"dans 3 jours"_, _"15/02"_' };
        }
        delete this.pendingConversations[String(chatId)];
        return await this._executeCreateTask(chatId, {
          subject: conv.data.subject,
          dueDate: parsedDate,
          targetEmail: conv.data.targetEmail || null,
          priority: conv.data.priority || 'MEDIUM'
        }, sendReply);
      }
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  async _updateContactConversation(chatId, text, conv, sendReply) {
    if (conv.step === 'awaiting_field') {
      // Parser "poste = CTO" ou "entreprise = Acme" ou "telephone = +33..."
      const updates = this._parseContactUpdates(text);
      if (Object.keys(updates).length === 0) {
        return { type: 'text', content: '❌ Format non compris. Exemples :\n_"poste = CTO"_\n_"entreprise = Acme Corp"_\n_"telephone = +33612345678"_' };
      }

      delete this.pendingConversations[String(chatId)];

      try {
        const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
        const updated = await hsBreaker.call(() => retryAsync(() => this.hubspot.updateContact(conv.data.contactId, updates), 2, 2000));
        storage.incrementStat(chatId, 'contactsUpdated');
        storage.logActivity(chatId, 'update_contact', { email: conv.data.email, updates: updates });
        storage.invalidateContactCache(chatId);
        return { type: 'text', content: '✅ *Contact modifie !*\n\n' + this._formatContactDetail(updated) };
      } catch (error) {
        return { type: 'text', content: '❌ Erreur : ' + error.message };
      }
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  async _updateDealConversation(chatId, text, conv, sendReply) {
    if (conv.step === 'awaiting_update') {
      const textLower = text.toLowerCase();
      const pipeline = conv.data.pipeline;
      const updates = {};

      // Detecter "etape X" ou nom de stage
      const stageMatch = text.match(/etape\s*(\d+)/i) || text.match(/(\d+)/);
      if (stageMatch) {
        const num = parseInt(stageMatch[1]);
        if (num >= 1 && num <= pipeline.stages.length) {
          updates.dealstage = pipeline.stages[num - 1].id;
        }
      }

      // Detecter stage par mot-cle
      if (!updates.dealstage) {
        if (textLower.includes('gagne') || textLower.includes('won')) {
          const wonStage = pipeline.stages.find(s => s.id.includes('closedwon') || s.label.toLowerCase().includes('gagne'));
          if (wonStage) updates.dealstage = wonStage.id;
        } else if (textLower.includes('perdu') || textLower.includes('lost')) {
          const lostStage = pipeline.stages.find(s => s.id.includes('closedlost') || s.label.toLowerCase().includes('perdu'));
          if (lostStage) updates.dealstage = lostStage.id;
        } else {
          const matchedStage = pipeline.stages.find(s => textLower.includes(s.label.toLowerCase()));
          if (matchedStage) updates.dealstage = matchedStage.id;
        }
      }

      // Detecter "montant XXXX"
      const amountMatch = text.match(/montant\s*([\d\s.]+)/i);
      if (amountMatch) {
        updates.amount = amountMatch[1].replace(/\s/g, '');
      }

      if (Object.keys(updates).length === 0) {
        return { type: 'text', content: '❌ Je n\'ai pas compris. Exemples :\n_"etape 3"_\n_"gagne"_\n_"montant 10000"_' };
      }

      delete this.pendingConversations[String(chatId)];

      try {
        const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
        const updated = await hsBreaker.call(() => retryAsync(() => this.hubspot.updateDeal(conv.data.dealId, updates), 2, 2000));
        storage.incrementStat(chatId, 'dealsUpdated');
        storage.logActivity(chatId, 'update_deal', { dealId: conv.data.dealId, updates: updates });
        storage.invalidateDealCache(chatId);
        return { type: 'text', content: '✅ *Offre modifiee !*\n\n' + this._formatDealDetail(updated, pipeline) };
      } catch (error) {
        return { type: 'text', content: '❌ Erreur : ' + error.message };
      }
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  // ============================================================
  // CONFIRMATIONS
  // ============================================================

  async _executeConfirmation(chatId, sendReply) {
    const pending = this.pendingConfirmations[String(chatId)];
    if (!pending) return { type: 'text', content: 'Rien en attente.' };

    delete this.pendingConfirmations[String(chatId)];

    if (pending.action === 'create_contact') {
      if (sendReply) await sendReply({ type: 'text', content: '👤 _Creation du contact..._' });
      try {
        const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
        const contact = await hsBreaker.call(() => retryAsync(() => this.hubspot.createContact(pending.data), 2, 2000));
        storage.incrementStat(chatId, 'contactsCreated');
        storage.incrementGlobalStat('totalContactsCreated');
        storage.logActivity(chatId, 'create_contact', { email: pending.data.email, hubspotId: contact.id });
        storage.invalidateContactCache(chatId);
        return { type: 'text', content: '✅ *Contact cree dans HubSpot !*\n\n' + this._formatContactDetail(contact) };
      } catch (error) {
        return { type: 'text', content: '❌ Erreur creation : ' + error.message };
      }
    }

    if (pending.action === 'create_deal') {
      if (sendReply) await sendReply({ type: 'text', content: '💼 _Creation de l\'offre..._' });
      try {
        const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
        const deal = await hsBreaker.call(() => retryAsync(() => this.hubspot.createDeal(pending.data), 2, 2000));

        // Associer a un contact si specifie
        if (pending.data.contact_email) {
          const contact = await hsBreaker.call(() => retryAsync(() => this.hubspot.findContactByEmail(pending.data.contact_email), 2, 2000));
          if (contact) {
            await hsBreaker.call(() => retryAsync(() => this.hubspot.associateDealToContact(deal.id, contact.id), 2, 2000));
          }
        }

        storage.incrementStat(chatId, 'dealsCreated');
        storage.incrementGlobalStat('totalDealsCreated');
        storage.logActivity(chatId, 'create_deal', { name: pending.data.dealname, dealId: deal.id });
        storage.invalidateDealCache(chatId);

        const pipeline = await this._getPipeline();
        return { type: 'text', content: '✅ *Offre creee dans HubSpot !*\n\n' + this._formatDealDetail(deal, pipeline) };
      } catch (error) {
        return { type: 'text', content: '❌ Erreur creation : ' + error.message };
      }
    }

    return { type: 'text', content: 'Action inconnue.' };
  }

  // ============================================================
  // UTILITAIRES
  // ============================================================

  async _getPipeline() {
    if (this._pipelineCache) return this._pipelineCache;
    const cached = storage.getCachedPipeline();
    if (cached) {
      this._pipelineCache = cached;
      return cached;
    }
    try {
      const hsBreaker = getBreaker('hubspot', { failureThreshold: 3, cooldownMs: 60000 });
      const pipeline = await hsBreaker.call(() => retryAsync(() => this.hubspot.getDealPipeline('default'), 2, 2000));
      storage.cachePipeline(pipeline);
      this._pipelineCache = pipeline;
      return pipeline;
    } catch (e) {
      return { id: 'default', label: 'Pipeline', stages: [] };
    }
  }

  _getStageName(pipeline, stageId) {
    if (!pipeline || !pipeline.stages) return stageId || 'Inconnu';
    const stage = pipeline.stages.find(s => s.id === stageId);
    return stage ? stage.label : stageId || 'Inconnu';
  }

  _getStageIcon(stageId) {
    if (!stageId) return '📌';
    if (stageId.includes('closedwon') || stageId === 'closedwon') return '✅';
    if (stageId.includes('closedlost') || stageId === 'closedlost') return '❌';
    if (stageId.includes('decision') || stageId.includes('negotiation')) return '🤝';
    if (stageId.includes('proposal') || stageId.includes('presentation')) return '💬';
    if (stageId.includes('qualification') || stageId.includes('qualifiedtobuy')) return '📥';
    return '📌';
  }

  _formatContactDetail(contact) {
    if (!contact) return '📭 Contact introuvable.';
    const lines = [
      '👤 *FICHE CONTACT*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '📧 ' + (contact.email || 'pas d\'email'),
      '👤 *' + (contact.name || 'Sans nom') + '*'
    ];
    if (contact.company || contact.jobtitle) {
      lines.push('🏢 ' + (contact.company || '') + (contact.jobtitle ? ' | ' + contact.jobtitle : ''));
    }
    if (contact.phone) lines.push('📞 ' + contact.phone);
    if (contact.city) lines.push('📍 ' + contact.city);
    if (contact.lifecyclestage) lines.push('📌 Lifecycle : ' + contact.lifecyclestage);
    if (contact.createdAt) lines.push('\n📅 Cree le ' + this._formatDate(contact.createdAt));
    return lines.join('\n');
  }

  _formatDealDetail(deal, pipeline) {
    if (!deal) return '📭 Offre introuvable.';
    const stageName = this._getStageName(pipeline, deal.stage);
    const stageIcon = this._getStageIcon(deal.stage);
    const lines = [
      '💼 *FICHE OFFRE*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '📌 *' + (deal.name || 'Sans nom') + '*',
      stageIcon + ' Etape : ' + stageName,
      '💰 Montant : ' + this._formatAmount(deal.amount)
    ];
    if (deal.closeDate) lines.push('📅 Cloture : ' + this._formatDate(deal.closeDate));
    if (deal.createdAt) lines.push('📅 Cree le ' + this._formatDate(deal.createdAt));
    return lines.join('\n');
  }

  _buildContactSummary(data) {
    const lines = [];
    if (data.firstname || data.lastname) lines.push('👤 ' + (data.firstname || '') + ' ' + (data.lastname || ''));
    if (data.email) lines.push('📧 ' + data.email);
    if (data.company) lines.push('🏢 ' + data.company + (data.jobtitle ? ' | ' + data.jobtitle : ''));
    if (data.phone) lines.push('📞 ' + data.phone);
    if (data.city) lines.push('📍 ' + data.city);
    return lines.join('\n') || '(aucune info)';
  }

  _parseContactUpdates(text) {
    const updates = {};
    const fieldMap = {
      'poste': 'jobtitle', 'titre': 'jobtitle', 'job': 'jobtitle', 'fonction': 'jobtitle',
      'entreprise': 'company', 'societe': 'company', 'société': 'company',
      'telephone': 'phone', 'téléphone': 'phone', 'tel': 'phone', 'phone': 'phone',
      'ville': 'city', 'city': 'city',
      'prenom': 'firstname', 'prénom': 'firstname', 'firstname': 'firstname',
      'nom': 'lastname', 'lastname': 'lastname',
      'email': 'email'
    };

    // Format "champ = valeur" ou "champ : valeur"
    const pairs = text.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    for (const pair of pairs) {
      const match = pair.match(/^([^=:]+)[=:]\s*(.+)$/);
      if (match) {
        const fieldName = match[1].trim().toLowerCase();
        const value = match[2].trim();
        const hubspotField = fieldMap[fieldName];
        if (hubspotField) {
          updates[hubspotField] = value;
        }
      }
    }
    return updates;
  }

  _formatAmount(amount) {
    if (!amount || amount === 0) return '0 EUR';
    return new Intl.NumberFormat('fr-FR').format(amount) + ' EUR';
  }

  _formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  }

  _parseDateRelative(text) {
    const lower = text.toLowerCase().trim();
    const now = new Date();

    if (lower === 'demain' || lower === 'tomorrow') {
      const d = new Date(now); d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    }
    if (lower === 'apres-demain' || lower === 'après-demain') {
      const d = new Date(now); d.setDate(d.getDate() + 2);
      return d.toISOString().split('T')[0];
    }
    if (lower === 'semaine prochaine') {
      const d = new Date(now); d.setDate(d.getDate() + 7);
      return d.toISOString().split('T')[0];
    }

    // "dans X jours"
    const daysMatch = lower.match(/dans\s+(\d+)\s+jours?/);
    if (daysMatch) {
      const d = new Date(now); d.setDate(d.getDate() + parseInt(daysMatch[1]));
      return d.toISOString().split('T')[0];
    }

    // Jours de la semaine
    const joursSemaine = { 'lundi': 1, 'mardi': 2, 'mercredi': 3, 'jeudi': 4, 'vendredi': 5, 'samedi': 6, 'dimanche': 0 };
    for (const [jour, dayNum] of Object.entries(joursSemaine)) {
      if (lower.includes(jour)) {
        const d = new Date(now);
        const currentDay = d.getDay();
        let diff = dayNum - currentDay;
        if (diff <= 0) diff += 7;
        d.setDate(d.getDate() + diff);
        return d.toISOString().split('T')[0];
      }
    }

    // Format DD/MM ou DD/MM/YYYY
    const dateMatch = lower.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1]);
      const month = parseInt(dateMatch[2]) - 1;
      const year = dateMatch[3] ? (dateMatch[3].length === 2 ? 2000 + parseInt(dateMatch[3]) : parseInt(dateMatch[3])) : now.getFullYear();
      const d = new Date(year, month, day);
      return d.toISOString().split('T')[0];
    }

    // Format YYYY-MM-DD
    const isoMatch = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return isoMatch[0];

    // "15 fevrier" etc.
    const moisFr = { 'janvier': 0, 'fevrier': 1, 'février': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5, 'juillet': 6, 'aout': 7, 'août': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'decembre': 11, 'décembre': 11 };
    for (const [mois, monthNum] of Object.entries(moisFr)) {
      const moisMatch = lower.match(new RegExp('(\\d{1,2})\\s*' + mois));
      if (moisMatch) {
        const d = new Date(now.getFullYear(), monthNum, parseInt(moisMatch[1]));
        if (d < now) d.setFullYear(d.getFullYear() + 1);
        return d.toISOString().split('T')[0];
      }
    }

    return null;
  }

  getHelp() {
    return [
      '📊 *CRM PILOT*',
      '',
      '👥 *Contacts :*',
      '  _"mes contacts hubspot"_ — lister',
      '  _"cherche jean@example.com"_ — rechercher',
      '  _"ajoute un contact"_ — creer',
      '  _"modifie le contact jean@..."_ — modifier',
      '  _"contacts de la societe Acme"_ — par entreprise',
      '',
      '💼 *Offres / Deals :*',
      '  _"cree une offre"_ — nouveau deal',
      '  _"mes offres"_ — lister',
      '  _"change le statut de l\'offre..."_ — modifier',
      '  _"mon pipeline"_ — vue pipeline',
      '',
      '📝 *Notes et taches :*',
      '  _"ajoute une note au contact..."_ — note',
      '  _"cree une tache pour..."_ — tache/rappel',
      '  _"mes taches"_ — lister',
      '',
      '📊 *Rapports :*',
      '  _"rapport hebdo"_ — resume semaine',
      '  _"stats crm"_ — statistiques',
      '',
      '━━━━━━━━━━━━━━━━━━',
      '📊 CRM Pilot | HubSpot'
    ].join('\n');
  }
}

module.exports = CRMPilotHandler;
