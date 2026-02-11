// Lead Enrich - Handler NLP Telegram
const ApolloEnricher = require('./apollo-enricher.js');
const AIClassifier = require('./ai-classifier.js');
const storage = require('./storage.js');
const https = require('https');

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
  constructor(openaiKey, apolloKey, hubspotKey) {
    this.openaiKey = openaiKey;
    this.apollo = apolloKey ? new ApolloEnricher(apolloKey) : null;
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
- "apollo_credits" : credits Apollo restants
  Ex: "combien de credits ?", "credits Apollo", "il me reste combien ?"
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
{"action":"help"}`;

    try {
      const response = await this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ], 300);

      let cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      if (!result.action) return null;
      return result;
    } catch (error) {
      console.log('[lead-enrich-NLP] Erreur classifyIntent:', error.message);
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

      case 'apollo_credits':
        return await this._handleApolloCredits(chatId);

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
          const response = await this.callOpenAI([
            { role: 'system', content: 'Tu es l\'assistant Lead Enrich du bot Telegram. Tu aides a enrichir des leads B2B. Reponds en francais, 1-3 phrases max.' },
            { role: 'user', content: text }
          ], 200);
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
    if (!this.apollo) {
      return { type: 'text', content: '❌ L\'enrichissement Apollo n\'est pas disponible actuellement.\n💡 Un plan Apollo payant est requis pour l\'acces API.\n\n👉 En attendant, tu peux utiliser les autres fonctions : _"leads prioritaires"_, _"rapport enrichissement"_' };
    }

    // Verifier credits
    const credits = storage.getApolloCreditsRemaining();
    if (credits <= 0) {
      return { type: 'text', content: '⚠️ Credits Apollo epuises pour ce mois (' + storage.getApolloCreditsUsed() + '/' + storage.data.apolloUsage.creditsLimit + ').\nLes credits se resetent le 1er du mois.' };
    }

    let enrichResult = null;

    // Par email
    if (params.email && params.email.includes('@')) {
      // Verifier cache
      const cached = storage.getEnrichedLead(params.email);
      if (cached) {
        return { type: 'text', content: this._formatEnrichedProfile(cached) + '\n\n_Enrichi le ' + new Date(cached.enrichedAt).toLocaleDateString('fr-FR') + ' (cache)_' };
      }

      if (sendReply) await sendReply({ type: 'text', content: '🔍 _Enrichissement de ' + params.email + '..._' });
      enrichResult = await this.apollo.enrichByEmail(params.email);
    }
    // Par nom + entreprise
    else if (params.name && params.company) {
      const nameParts = params.name.trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      if (sendReply) await sendReply({ type: 'text', content: '🔍 _Recherche de ' + params.name + ' chez ' + params.company + '..._' });
      enrichResult = await this.apollo.enrichByNameAndCompany(firstName, lastName, params.company);
    }
    // Par LinkedIn
    else if (params.linkedin) {
      if (sendReply) await sendReply({ type: 'text', content: '🔍 _Enrichissement via LinkedIn..._' });
      enrichResult = await this.apollo.enrichByLinkedIn(params.linkedin);
    }
    else {
      return { type: 'text', content: '❌ Donne-moi un email, un nom+entreprise, ou un lien LinkedIn.\nExemple : _"enrichis jean@example.com"_' };
    }

    if (!enrichResult || !enrichResult.success) {
      return { type: 'text', content: '📭 Contact non trouve sur Apollo.\n' + (enrichResult && enrichResult.error ? '💡 ' + enrichResult.error : '') };
    }

    // Classification IA
    if (sendReply) await sendReply({ type: 'text', content: '🤖 _Analyse du profil..._' });
    const classification = await this.classifier.classifyLead(enrichResult);

    // Sauvegarder
    const email = enrichResult.person.email || params.email || '';
    storage.saveEnrichedLead(email, enrichResult, classification, 'telegram', chatId);
    storage.trackApolloCredit();
    storage.logActivity(chatId, 'enrich_single', { email: email });

    const lead = storage.getEnrichedLead(email);
    const creditsLeft = storage.getApolloCreditsRemaining();

    return { type: 'text', content: this._formatEnrichedProfile(lead) + '\n\n📊 Credits Apollo : ' + creditsLeft + '/' + storage.data.apolloUsage.creditsLimit };
  }

  // ============================================================
  // ENRICHISSEMENT BATCH HUBSPOT
  // ============================================================

  async _handleEnrichHubSpot(chatId, params, sendReply) {
    if (!this.apollo) {
      return { type: 'text', content: '❌ Cle API Apollo non configuree.' };
    }
    const HubSpotClient = getHubSpotClient();
    if (!HubSpotClient || !this.hubspotKey) {
      return { type: 'text', content: '❌ HubSpot non disponible.' };
    }

    if (sendReply) await sendReply({ type: 'text', content: '🔍 _Scan des contacts HubSpot..._' });

    try {
      const hubspot = new HubSpotClient(this.hubspotKey);
      const result = await hubspot.listContacts(100);
      const contacts = result.contacts || [];

      // Filtrer ceux qui ont des donnees manquantes et pas encore enrichis
      const toEnrich = contacts.filter(c => {
        if (!c.email) return false;
        if (storage.isAlreadyEnriched(c.email)) return false;
        // Considerer comme "incomplet" si pas de poste OU pas d'entreprise OU pas de telephone
        return !c.jobtitle || !c.company || !c.phone;
      });

      if (toEnrich.length === 0) {
        return { type: 'text', content: '✅ Tous les contacts HubSpot sont deja enrichis ou complets !' };
      }

      const credits = storage.getApolloCreditsRemaining();
      const enrichCount = Math.min(toEnrich.length, credits);

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
        '➡️ ' + enrichCount + ' contacts a enrichir',
        '💰 Cout : ~' + enrichCount + ' credits Apollo (reste ' + credits + ')',
        toEnrich.length > credits ? '\n⚠️ Seulement ' + credits + ' credits dispo, on enrichit les ' + enrichCount + ' premiers' : '',
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
    if (!this.apollo) {
      return { type: 'text', content: '❌ Cle API Apollo non configuree.' };
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
    const toEnrich = list.contacts.filter(c => {
      if (!c.email) return false;
      return !storage.isAlreadyEnriched(c.email);
    });

    if (toEnrich.length === 0) {
      return { type: 'text', content: '✅ Tous les contacts de "' + list.name + '" sont deja enrichis !' };
    }

    const credits = storage.getApolloCreditsRemaining();
    const enrichCount = Math.min(toEnrich.length, credits);

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
      '➡️ ' + enrichCount + ' contacts a enrichir',
      '💰 Cout : ~' + enrichCount + ' credits Apollo (reste ' + credits + ')',
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

    if (sendReply) await sendReply({ type: 'text', content: '🚀 _Lancement de l\'enrichissement de ' + contacts.length + ' contacts..._' });

    let done = 0;
    let errors = 0;
    let totalScore = 0;
    let highScoreCount = 0;

    for (const contact of contacts) {
      try {
        const enrichResult = await this.apollo.enrichByEmail(contact.email);
        if (!enrichResult || !enrichResult.success) {
          errors++;
          done++;
          continue;
        }

        const classification = await this.classifier.classifyLead(enrichResult);
        storage.saveEnrichedLead(contact.email, enrichResult, classification, 'hubspot', chatId);
        storage.trackApolloCredit();

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
            try { await hubspot.updateContact(contact.id, updates); } catch (e) {}
          }
        }

        done++;
      } catch (error) {
        errors++;
        done++;
      }

      // Progression tous les 5 contacts
      if (done % 5 === 0 && done < contacts.length && sendReply) {
        await sendReply({ type: 'text', content: '📊 ' + done + '/' + contacts.length + ' contacts enrichis...' });
      }
    }

    storage.logActivity(chatId, 'enrich_hubspot_batch', { total: contacts.length, done: done, errors: errors });
    const avgScore = done > errors ? (totalScore / (done - errors)).toFixed(1) : 0;
    const creditsLeft = storage.getApolloCreditsRemaining();

    return { type: 'text', content: [
      '✅ *ENRICHISSEMENT TERMINE*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '✅ ' + (done - errors) + ' contacts enrichis',
      errors > 0 ? '❌ ' + errors + ' erreur' + (errors > 1 ? 's' : '') : '',
      '📊 Score moyen : ' + avgScore + '/10',
      '🔥 ' + highScoreCount + ' lead' + (highScoreCount > 1 ? 's' : '') + ' prioritaire' + (highScoreCount > 1 ? 's' : '') + ' (8+/10)',
      '💰 Credits restants : ' + creditsLeft + '/' + storage.data.apolloUsage.creditsLimit,
      '',
      '👉 _"leads prioritaires"_ pour voir les meilleurs'
    ].join('\n') };
  }

  async _executeBatchAutomailer(chatId, data, sendReply) {
    const contacts = data.contacts;

    if (sendReply) await sendReply({ type: 'text', content: '🚀 _Enrichissement de ' + contacts.length + ' contacts de "' + data.listName + '"..._' });

    let done = 0;
    let errors = 0;
    let totalScore = 0;
    let highScoreCount = 0;

    for (const contact of contacts) {
      try {
        const enrichResult = await this.apollo.enrichByEmail(contact.email);
        if (!enrichResult || !enrichResult.success) {
          errors++;
          done++;
          continue;
        }

        const classification = await this.classifier.classifyLead(enrichResult);
        storage.saveEnrichedLead(contact.email, enrichResult, classification, 'automailer', chatId);
        storage.trackApolloCredit();

        totalScore += classification.score || 0;
        if ((classification.score || 0) >= 8) highScoreCount++;
        done++;
      } catch (error) {
        errors++;
        done++;
      }

      if (done % 5 === 0 && done < contacts.length && sendReply) {
        await sendReply({ type: 'text', content: '📊 ' + done + '/' + contacts.length + ' contacts enrichis...' });
      }
    }

    storage.logActivity(chatId, 'enrich_automailer_batch', { listName: data.listName, total: contacts.length, done: done, errors: errors });
    const avgScore = done > errors ? (totalScore / (done - errors)).toFixed(1) : 0;
    const creditsLeft = storage.getApolloCreditsRemaining();

    return { type: 'text', content: [
      '✅ *ENRICHISSEMENT TERMINE*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '📧 Liste : *' + data.listName + '*',
      '✅ ' + (done - errors) + ' contacts enrichis',
      errors > 0 ? '❌ ' + errors + ' erreur' + (errors > 1 ? 's' : '') : '',
      '📊 Score moyen : ' + avgScore + '/10',
      '🔥 ' + highScoreCount + ' lead' + (highScoreCount > 1 ? 's' : '') + ' prioritaire' + (highScoreCount > 1 ? 's' : '') + ' (8+/10)',
      '💰 Credits restants : ' + creditsLeft + '/' + storage.data.apolloUsage.creditsLimit,
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
      return { type: 'text', content: this._formatEnrichedProfile(lead) };
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
      const p = lead.apolloData && lead.apolloData.person ? lead.apolloData.person : {};
      const o = lead.apolloData && lead.apolloData.organization ? lead.apolloData.organization : {};
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

  async _handleEnrichReport(chatId, sendReply) {
    const stats = storage.getGlobalStats();
    const allLeads = storage.getAllEnrichedLeads(chatId);
    const credits = storage.getApolloCreditsRemaining();
    const creditsUsed = storage.getApolloCreditsUsed();

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
      '💰 Credits Apollo : ' + creditsUsed + '/' + storage.data.apolloUsage.creditsLimit + ' utilises',
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
    lines.push('🔍 Lead Enrich');

    return { type: 'text', content: lines.join('\n') };
  }

  _handleApolloCredits(chatId) {
    const credits = storage.getApolloCreditsRemaining();
    const used = storage.getApolloCreditsUsed();
    const limit = storage.data.apolloUsage.creditsLimit;

    const bar = '█'.repeat(Math.round(used / limit * 20)) + '░'.repeat(20 - Math.round(used / limit * 20));

    return { type: 'text', content: [
      '💰 *CREDITS APOLLO*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '📊 ' + used + ' / ' + limit + ' utilises',
      '   [' + bar + ']',
      '',
      '✅ ' + credits + ' credits restants ce mois',
      '',
      '📅 Reset le 1er du mois prochain',
      '',
      '━━━━━━━━━━━━━━━━━━',
      '🔍 Lead Enrich | Apollo'
    ].join('\n') };
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
    const p = lead.apolloData && lead.apolloData.person ? lead.apolloData.person : {};
    const o = lead.apolloData && lead.apolloData.organization ? lead.apolloData.organization : {};
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
    if (p.email || lead.email) lines.push('📧 ' + (p.email || lead.email));
    if (p.phone) lines.push('📞 ' + p.phone);
    if (p.linkedinUrl) lines.push('🔗 ' + p.linkedinUrl);
    if (o.website) lines.push('🌐 ' + o.website);

    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push(scoreIcon + ' *Score : ' + (c.score || '?') + '/10*');
    if (c.persona) lines.push('👤 ' + c.persona);
    if (c.scoreExplanation) lines.push('💡 _"' + c.scoreExplanation + '"_');

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
      '  _"rapport enrichissement"_',
      '  _"credits apollo"_',
      '',
      '━━━━━━━━━━━━━━━━━━',
      '🔍 Lead Enrich | Apollo + IA'
    ].join('\n');
  }
}

module.exports = LeadEnrichHandler;
