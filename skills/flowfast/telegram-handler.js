const FlowFastWorkflow = require('./flowfast-workflow.js');
const ClaudeClient = require('./claude-client.js');
const SendGridClient = require('./sendgrid-client.js');
const storage = require('./storage.js');
const { callOpenAI: sharedCallOpenAI } = require('../../gateway/shared-nlp.js');

class FlowFastTelegramHandler {
  constructor(apolloKey, hubspotKey, openaiKey, claudeKey, sendgridKey, senderEmail) {
    this.workflow = new FlowFastWorkflow(apolloKey, hubspotKey, openaiKey);
    this.hubspotKey = hubspotKey;
    this.openaiKey = openaiKey;
    this.claude = claudeKey ? new ClaudeClient(claudeKey) : null;
    this.sendgrid = sendgridKey ? new SendGridClient(sendgridKey, senderEmail) : null;
    // Stockage temporaire des resultats en attente de confirmation par user
    this.pendingResults = {};  // chatId -> { leads, searchParams, searchId }
    this.pendingEmails = {};   // chatId -> { lead, email: { subject, body } }
  }

  // --- NLP (via module partage) ---

  async callOpenAI(messages, maxTokens) {
    const result = await sharedCallOpenAI(this.openaiKey, messages, {
      maxTokens: maxTokens || 200,
      temperature: 0.3,
      timeout: 20000
    });
    return result.content;
  }

  async classifyIntent(message, chatId) {
    const user = storage.getUser(chatId);
    const recentSearches = storage.getRecentSearches(chatId, 3);
    const recentContext = recentSearches.length > 0
      ? '\nRecherches recentes de cet utilisateur:\n' + recentSearches.map(s =>
          '- ' + (s.params.titles || []).join(', ') + ' a ' + (s.params.locations || []).join(', ') + ' (' + (s.results?.total || 0) + ' resultats)'
        ).join('\n')
      : '';

    const hasPendingResults = !!this.pendingResults[String(chatId)];
    const hasPendingEmail = !!this.pendingEmails[String(chatId)];

    const systemPrompt = `Tu es l'assistant de prospection B2B d'un bot Telegram. L'utilisateur parle en francais naturel, souvent de facon informelle ou avec des fautes.
Tu dois comprendre son INTENTION meme s'il ne dit pas les mots exacts.

Classifie le message en une action JSON.

Actions :
- "search" : recherche de leads/contacts/prospects. L'utilisateur decrit QUI, OU, COMBIEN.
  Ex: "cherche 20 agents immobiliers a Londres", "trouve des CEO tech a Paris", "10 devs Berlin"
  Ex naturel: "tu peux me trouver des directeurs commerciaux sur Lyon ?", "j'ai besoin de leads dans la restauration a Marseille"

- "confirm_yes" : confirmation positive
  Ex: "oui", "ok", "go", "envoie", "valide", "c'est bon", "pousse-les", "parfait"
- "confirm_no" : refus / annulation
  Ex: "non", "annule", "stop", "pas maintenant", "laisse tomber"
- "refine" : affiner la recherche precedente
  Ex: "seulement les CEO", "filtre par Paris", "plus de resultats", "et pour Lyon ?", "uniquement les seniors"

- "write_email" : ecrire/envoyer un email a un ou plusieurs leads
  Ex: "ecris un mail au dernier lead", "envoie un email a tous", "mail de prospection", "contacte-le", "envoie-leur un truc"
  Params : "target" = "last", "all", ou une adresse email. "context" = instructions optionnelles.
- "edit_email" : modifier l'email en cours avant envoi
  Ex: "plus court", "plus formel", "change l'objet", "ajoute un CTA"
  Params : "instruction" = ce qu'il faut modifier
- "email_history" : historique des emails envoyes
  Ex: "historique", "qu'est-ce que j'ai envoye ?", "derniers mails"

- "set_score" : changer le score minimum (1-10)
- "show_score" : voir le score actuel
- "leads" : voir les contacts HubSpot
  Ex: "mes leads", "les contacts trouves", "qu'est-ce qu'on a ?"
- "stats" : statistiques
  Ex: "stats", "mes chiffres", "resume"
- "history" : recherches precedentes
  Ex: "historique recherches", "qu'est-ce que j'ai cherche ?"
- "test" : verifier le bot
- "help" : demande d'aide explicite
- "chat" : UNIQUEMENT si ca ne correspond a aucune action ci-dessus

${hasPendingResults ? 'IMPORTANT: L\'utilisateur a des resultats de RECHERCHE en attente de confirmation. Si son message ressemble a un oui/non, classifie en confirm_yes ou confirm_no.' : ''}
${hasPendingEmail ? 'IMPORTANT: L\'utilisateur a un EMAIL en attente de confirmation. "oui/envoie/go" = confirm_yes, "non/annule" = confirm_no, toute modification = edit_email.' : ''}

REGLES POUR "search" - extraire dans "params" :
- "titles" : tableau de titres EN ANGLAIS pour Apollo. Traduis le francais.
  "agent immobilier" → ["Real Estate Agent", "Realtor", "Property Agent"]
  "developpeur" → ["Software Developer", "Software Engineer"]
  "directeur commercial" → ["Sales Director", "VP Sales", "Head of Sales"]
- "locations" : tableau "City, CODE_PAYS".
  "Londres" → ["London, GB"], "Paris" → ["Paris, FR"]
  Si pays entier ("en France"), utilise grandes villes: ["Paris, FR", "Lyon, FR", "Marseille, FR", "Bordeaux, FR", "Toulouse, FR"]
- "seniorities" : niveaux si mentionnes: "c_suite", "vp", "director", "manager", "senior", "entry". Null sinon.
- "keywords" : mots-cles supplementaires (secteur, competence). Null sinon.
- "limit" : nombre de leads (defaut 10, max 100).
${recentContext}

Preferences utilisateur: score minimum = ${user.scoreMinimum}/10, limite par defaut = ${user.preferences.defaultLimit}

JSON strict :
Pour search: {"action":"search","params":{"titles":[...],"locations":[...],"seniorities":null,"keywords":null,"limit":10}}
Pour set_score: {"action":"set_score","value":8}
Pour write_email: {"action":"write_email","params":{"target":"last","context":null}}
Pour edit_email: {"action":"edit_email","params":{"instruction":"plus court"}}
Pour autres: {"action":"..."}`;

    try {
      const response = await this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ], 300);

      let cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      if (!result.action) return null;

      if (result.action === 'set_score' && result.value !== null) {
        const num = parseInt(result.value);
        if (num >= 1 && num <= 10) return { action: 'set_score', value: num };
        return { action: 'score_error' };
      }
      return result;
    } catch (error) {
      console.log('[NLP] Erreur classifyIntent:', error.message);
      return null;
    }
  }

  async generateChatResponse(message) {
    try {
      const response = await this.callOpenAI([
        { role: 'system', content: 'Tu es Mister Krabs 🦀, assistant de prospection B2B. Reponds en francais, 1-3 phrases max. Si l\'utilisateur semble perdu, donne un exemple: "cherche 10 CEO tech a Paris". Sois decontracte et chaleureux.' },
        { role: 'user', content: message }
      ], 200);
      return response.trim();
    } catch (error) {
      return 'Dis-moi ce que tu cherches ! Par exemple: _"cherche 10 CEO tech a Paris"_';
    }
  }

  // --- Recherche ---

  async executeSearch(searchParams, chatId) {
    const apolloCriteria = { limit: searchParams.limit || 10 };
    if (searchParams.titles && searchParams.titles.length > 0) apolloCriteria.titles = searchParams.titles;
    if (searchParams.locations && searchParams.locations.length > 0) apolloCriteria.locations = searchParams.locations;
    if (searchParams.seniorities && searchParams.seniorities.length > 0) apolloCriteria.seniorities = searchParams.seniorities;
    if (searchParams.keywords) apolloCriteria.keywords = searchParams.keywords;

    const apolloResult = await this.workflow.apollo.searchLeads(apolloCriteria);
    if (!apolloResult.success || apolloResult.leads.length === 0) return null;

    const leads = apolloResult.leads.map(lead => ({
      nom: ((lead.first_name || '') + ' ' + (lead.last_name || '')).trim(),
      prenom: lead.first_name || '',
      nom_famille: lead.last_name || '',
      titre: lead.title || 'Non specifie',
      entreprise: (lead.organization && lead.organization.name) || 'Non specifie',
      email: lead.email || 'Non disponible',
      localisation: lead.city || lead.state || 'Non specifie',
      linkedin: lead.linkedin_url || null
    }));

    return leads;
  }

  async scoreLeads(leads, minScore) {
    const scored = [];
    for (const lead of leads) {
      const qualification = await this.workflow.qualifyLead(lead);
      scored.push({ ...lead, score: qualification.score, raison: qualification.raison, recommandation: qualification.recommandation });
    }
    return scored;
  }

  // --- Formatage ---

  formatLeadsList(leads, showActions) {
    const lines = [];
    leads.forEach((lead, i) => {
      const emoji = lead.score >= 8 ? '🔥' : lead.score >= 6 ? '✅' : '⚪';
      lines.push(emoji + ' *' + (i + 1) + '. ' + lead.nom + '* — ' + lead.score + '/10');
      lines.push('   👔 ' + lead.titre);
      lines.push('   🏢 ' + lead.entreprise);
      lines.push('   📍 ' + lead.localisation);
      if (lead.email && lead.email !== 'Non disponible') {
        lines.push('   ✉️ ' + lead.email);
      }
      lines.push('');
    });
    return lines.join('\n');
  }

  getHelp() {
    return [
      '🦀 *PROSPECTION B2B*',
      '',
      '🔍 *Recherche* — parle-moi naturellement :',
      '  _"cherche 20 agents immobiliers a Londres"_',
      '  _"trouve des CEO fintech a Paris"_',
      '  _"10 developpeurs Java a Berlin"_',
      '',
      '✉️ *Emails :*',
      '  _"ecris un mail au dernier lead"_',
      '  _"envoie un email a tous les leads"_',
      '  _"historique emails"_',
      '',
      '📊 *Suivi :*',
      '  _"mes stats"_ — tes statistiques',
      '  _"historique"_ — tes recherches precedentes',
      '  _"leads"_ — contacts HubSpot',
      '',
      '⚙️ *Reglages :*',
      '  _"score"_ — voir le score minimum',
      '  _"mets le score a 8"_ — changer le seuil',
      '',
      '━━━━━━━━━━━━━━━━━━',
      '🦀 Apollo → IA → HubSpot'
    ].join('\n');
  }

  // --- HubSpot ---

  async getLeadsFromHubspot() {
    try {
      const contacts = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.hubapi.com',
          path: '/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,company,jobtitle,email',
          method: 'GET',
          headers: { 'Authorization': 'Bearer ' + this.hubspotKey }
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => { try { resolve(JSON.parse(data).results || []); } catch (e) { reject(e); } });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
      });

      if (!contacts || contacts.length === 0) return '📭 Aucun contact dans HubSpot.';

      const lines = ['📋 *LEADS HUBSPOT* (' + contacts.length + ' contacts)', '━━━━━━━━━━━━━━━━━━', ''];
      const max = Math.min(contacts.length, 10);
      for (let i = 0; i < max; i++) {
        const p = contacts[i].properties || {};
        lines.push((i + 1) + '. *' + ((p.firstname || '') + ' ' + (p.lastname || '')).trim() + '*');
        lines.push('   🏢 ' + (p.company || 'N/A') + ' | ' + (p.jobtitle || 'N/A'));
        lines.push('   ✉️ ' + (p.email || 'N/A'));
        lines.push('');
      }
      if (contacts.length > 10) lines.push('... et ' + (contacts.length - 10) + ' autres');
      return lines.join('\n');
    } catch (error) {
      return '❌ Erreur HubSpot : ' + error.message;
    }
  }

  // --- Handler principal ---

  async handleMessage(message, chatId, sendReply) {
    const user = storage.getUser(chatId);
    const text = message.trim();
    const textLower = text.toLowerCase();

    // Commandes rapides (sans NLP)
    if (textLower === 'help' || textLower === 'aide' || textLower === '/start') {
      return { type: 'text', content: this.getHelp() };
    }
    if (textLower === 'test') {
      return { type: 'text', content: '✅ Mister Krabs est operationnel ! 🦀\n\nScore : ' + user.scoreMinimum + '/10\nRecherches : ' + user.searchCount + '\n\nDis-moi ce que tu cherches !' };
    }

    // Classification NLP
    const command = await this.classifyIntent(text, chatId);
    if (!command) return null;

    switch (command.action) {

      // --- RECHERCHE ---
      case 'search': {
        const params = command.params || {};
        const scoreMin = user.scoreMinimum;

        // Message de confirmation
        const confirmLines = ['🔍 *Recherche en cours...*', ''];
        if (params.titles && params.titles.length > 0) confirmLines.push('👔 Postes : ' + params.titles.join(', '));
        if (params.locations && params.locations.length > 0) confirmLines.push('📍 Lieu : ' + params.locations.join(', '));
        if (params.keywords) confirmLines.push('🔑 Mots-cles : ' + params.keywords);
        confirmLines.push('📋 Limite : ' + (params.limit || 10) + ' leads');
        confirmLines.push('⚙️ Score minimum : ' + scoreMin + '/10');

        if (sendReply) await sendReply({ type: 'text', content: confirmLines.join('\n') });

        try {
          const leads = await this.executeSearch(params, chatId);

          if (!leads || leads.length === 0) {
            storage.addSearch(chatId, params, { total: 0, qualified: 0, created: 0 });
            return { type: 'text', content: '📭 Aucun lead trouve pour cette recherche.\n\nEssaie avec des criteres differents !' };
          }

          // Scorer les leads
          if (sendReply) await sendReply({ type: 'text', content: '🤖 _Qualification IA de ' + leads.length + ' leads..._' });
          const scoredLeads = await this.scoreLeads(leads, scoreMin);

          // Filtrer par score
          const qualified = scoredLeads.filter(l => l.score >= scoreMin);
          const priority = qualified.filter(l => l.score >= 8);

          // Sauvegarder la recherche
          const searchRecord = storage.addSearch(chatId, params, {
            total: leads.length,
            qualified: qualified.length,
            priority: priority.length,
            created: 0,
            skipped: leads.length - qualified.length
          });

          // Sauvegarder les leads
          scoredLeads.forEach(l => storage.addLead(l, l.score, searchRecord.id));

          if (qualified.length === 0) {
            return { type: 'text', content: '📊 *' + leads.length + ' leads trouves* mais aucun ne depasse le score de ' + scoreMin + '/10.\n\nBaisse le score avec _"mets le score a 4"_ ou affine ta recherche.' };
          }

          // Stocker en attente de confirmation
          this.pendingResults[String(chatId)] = {
            leads: qualified,
            searchParams: params,
            searchId: searchRecord.id
          };

          const lines = [
            '🎯 *RESULTATS* — ' + qualified.length + '/' + leads.length + ' qualifies',
            '━━━━━━━━━━━━━━━━━━',
            '',
            this.formatLeadsList(qualified.slice(0, 10)),
            qualified.length > 10 ? '... et ' + (qualified.length - 10) + ' autres\n' : '',
            '━━━━━━━━━━━━━━━━━━',
            '🔥 Prioritaires (≥8) : ' + priority.length,
            '✅ Qualifies (≥' + scoreMin + ') : ' + qualified.length,
            '',
            '👉 *Tu veux que je les pousse dans HubSpot ?*',
            'Reponds _"oui"_ ou _"non"_'
          ];

          return { type: 'text', content: lines.join('\n') };

        } catch (error) {
          return { type: 'text', content: '❌ Erreur : ' + error.message };
        }
      }

      // --- CONFIRMATION ---
      case 'confirm_yes': {
        // Priorite : email en attente > resultats de recherche
        const pendingEmail = this.pendingEmails[String(chatId)];
        if (pendingEmail) {
          return await this._sendPendingEmail(chatId, sendReply);
        }

        const pending = this.pendingResults[String(chatId)];
        if (!pending) {
          return { type: 'text', content: 'Pas de resultats en attente. Fais une recherche d\'abord !' };
        }

        if (sendReply) await sendReply({ type: 'text', content: '📤 _Envoi de ' + pending.leads.length + ' leads vers HubSpot..._' });

        let created = 0;
        let errors = 0;
        for (const lead of pending.leads) {
          const result = await this.workflow.hubspot.upsertContact({
            prenom: lead.prenom,
            nom: lead.nom_famille,
            email: lead.email,
            titre: lead.titre,
            entreprise: lead.entreprise,
            ville: lead.localisation
          });
          if (result.success) {
            created++;
            storage.setLeadPushed(lead.email);
          } else {
            errors++;
          }
          await new Promise(r => setTimeout(r, 500));
        }

        delete this.pendingResults[String(chatId)];
        storage.data.stats.totalLeadsPushed += created;
        storage._save();

        return { type: 'text', content: '✅ *Fait !*\n\n📝 ' + created + ' leads crees dans HubSpot\n' + (errors > 0 ? '❌ ' + errors + ' erreurs\n' : '') + '\n🔗 https://app-eu1.hubspot.com/contacts/147742541' };
      }

      case 'confirm_no': {
        const pendingEmail = this.pendingEmails[String(chatId)];
        if (pendingEmail) {
          delete this.pendingEmails[String(chatId)];
          return { type: 'text', content: '👌 Email annule.' };
        }
        const pending = this.pendingResults[String(chatId)];
        if (pending) {
          delete this.pendingResults[String(chatId)];
          return { type: 'text', content: '👌 Resultats annules. Dis-moi si tu veux affiner la recherche !' };
        }
        return { type: 'text', content: '👌 OK ! Dis-moi ce que tu cherches.' };
      }

      // --- SCORE ---
      case 'show_score':
        return { type: 'text', content: '📌 Ton score minimum : *' + user.scoreMinimum + '/10*\n\nDis _"mets le score a 8"_ pour changer.' };

      case 'set_score':
        storage.setUserScore(chatId, command.value);
        return { type: 'text', content: '✅ Score mis a jour : *' + command.value + '/10*\n\nLes prochains leads devront avoir au moins ' + command.value + '/10.' };

      case 'score_error':
        return { type: 'text', content: '❌ Score invalide (entre 1 et 10).' };

      // --- DONNEES ---
      case 'leads':
        return { type: 'text', content: await this.getLeadsFromHubspot() };

      case 'stats': {
        const searches = storage.getRecentSearches(chatId);
        const totalLeads = storage.getAllLeads().filter(l => l.searchId && storage.data.searches.find(s => s.id === l.searchId && s.chatId === String(chatId)));
        return { type: 'text', content: [
          '📊 *TES STATISTIQUES*',
          '━━━━━━━━━━━━━━━━━━',
          '🔍 Recherches : ' + user.searchCount,
          '⚙️ Score minimum : ' + user.scoreMinimum + '/10',
          '👤 Membre depuis : ' + new Date(user.joinedAt).toLocaleDateString('fr-FR'),
          '',
          searches.length > 0 ? '*Dernieres recherches :*\n' + searches.map(s =>
            '• ' + (s.params.titles || []).join(', ') + ' a ' + (s.params.locations || []).join(', ') + ' → ' + (s.results?.qualified || 0) + ' qualifies'
          ).join('\n') : 'Aucune recherche recente.'
        ].join('\n') };
      }

      case 'history': {
        const searches = storage.getRecentSearches(chatId, 10);
        if (searches.length === 0) return { type: 'text', content: 'Aucune recherche dans l\'historique.' };
        const lines = ['📜 *HISTORIQUE*', '━━━━━━━━━━━━━━━━━━', ''];
        searches.reverse().forEach((s, i) => {
          const date = new Date(s.createdAt).toLocaleDateString('fr-FR');
          lines.push((i + 1) + '. ' + date + ' — ' + (s.params.titles || []).join(', '));
          lines.push('   📍 ' + (s.params.locations || []).join(', ') + ' | ' + (s.results?.total || 0) + ' trouves, ' + (s.results?.qualified || 0) + ' qualifies');
          lines.push('');
        });
        return { type: 'text', content: lines.join('\n') };
      }

      // --- AIDE ---
      case 'help':
        return { type: 'text', content: this.getHelp() };

      case 'test':
        return { type: 'text', content: '✅ Mister Krabs operationnel ! 🦀' };

      // --- EMAILS ---
      case 'write_email': {
        if (!this.claude) {
          return { type: 'text', content: '❌ La cle API Claude n\'est pas configuree. Ajoute CLAUDE_API_KEY dans le .env.' };
        }
        if (!this.sendgrid) {
          return { type: 'text', content: '❌ La cle API SendGrid n\'est pas configuree. Ajoute SENDGRID_API_KEY dans le .env.' };
        }

        const params = command.params || {};
        const target = params.target || 'last';
        const context = params.context || null;

        // Trouver le lead cible
        let lead = null;
        if (target === 'last') {
          const allLeads = storage.getAllLeads();
          lead = allLeads.length > 0 ? allLeads[allLeads.length - 1] : null;
        } else if (target.includes('@')) {
          lead = storage.data.leads[target] || null;
        } else {
          const allLeads = storage.getAllLeads();
          lead = allLeads.length > 0 ? allLeads[allLeads.length - 1] : null;
        }

        if (!lead) {
          return { type: 'text', content: '📭 Aucun lead trouve. Fais d\'abord une recherche !' };
        }
        if (!lead.email || lead.email === 'Non disponible') {
          return { type: 'text', content: '❌ Ce lead n\'a pas d\'adresse email : *' + lead.nom + '*' };
        }

        if (sendReply) await sendReply({ type: 'text', content: '✍️ _Claude redige un email pour ' + lead.nom + '..._' });

        try {
          const email = await this.claude.generateEmail(lead, context);

          // Stocker en attente de confirmation
          this.pendingEmails[String(chatId)] = { lead: lead, email: email };

          const lines = [
            '✉️ *MAIL PROPOSE*',
            '━━━━━━━━━━━━━━━━━━',
            '',
            '📧 *A :* ' + lead.email,
            '📌 *Objet :* ' + email.subject,
            '',
            email.body,
            '',
            '━━━━━━━━━━━━━━━━━━',
            '👉 _"envoie"_ pour envoyer',
            '👉 _"plus court"_ / _"plus formel"_ pour modifier',
            '👉 _"reecris"_ pour un nouveau mail',
            '👉 _"annule"_ pour annuler'
          ];

          return { type: 'text', content: lines.join('\n') };
        } catch (error) {
          console.error('[email] Erreur generation:', error.message);
          return { type: 'text', content: '❌ Erreur generation email : ' + error.message };
        }
      }

      case 'edit_email': {
        const pendingEmail = this.pendingEmails[String(chatId)];
        if (!pendingEmail) {
          return { type: 'text', content: 'Pas d\'email en cours. Dis _"ecris un mail au dernier lead"_ d\'abord.' };
        }

        const instruction = (command.params && command.params.instruction) || text;
        if (sendReply) await sendReply({ type: 'text', content: '✍️ _Modification en cours..._' });

        try {
          const newEmail = await this.claude.editEmail(pendingEmail.email, instruction);
          pendingEmail.email = newEmail;

          const lines = [
            '✉️ *MAIL MODIFIE*',
            '━━━━━━━━━━━━━━━━━━',
            '',
            '📧 *A :* ' + pendingEmail.lead.email,
            '📌 *Objet :* ' + newEmail.subject,
            '',
            newEmail.body,
            '',
            '━━━━━━━━━━━━━━━━━━',
            '👉 _"envoie"_ ou _"annule"_'
          ];

          return { type: 'text', content: lines.join('\n') };
        } catch (error) {
          return { type: 'text', content: '❌ Erreur modification : ' + error.message };
        }
      }

      case 'email_history': {
        const emails = storage.getRecentEmails(chatId, 10);
        if (emails.length === 0) return { type: 'text', content: '📭 Aucun email envoye pour l\'instant.' };
        const lines = ['✉️ *HISTORIQUE EMAILS*', '━━━━━━━━━━━━━━━━━━', ''];
        emails.reverse().forEach((e, i) => {
          const date = new Date(e.createdAt).toLocaleDateString('fr-FR');
          const statusIcon = e.status === 'sent' ? '✅' : '❌';
          lines.push(statusIcon + ' ' + (i + 1) + '. ' + date + ' — ' + e.leadEmail);
          lines.push('   📌 ' + e.subject);
          lines.push('');
        });
        return { type: 'text', content: lines.join('\n') };
      }

      // --- CONVERSATION ---
      case 'chat': {
        const response = await this.generateChatResponse(text);
        return { type: 'text', content: response };
      }

      default:
        return { type: 'text', content: this.getHelp() };
    }
  }

  // --- Envoi email en attente ---

  async _sendPendingEmail(chatId, sendReply) {
    const pending = this.pendingEmails[String(chatId)];
    if (!pending) return { type: 'text', content: 'Pas d\'email en attente.' };

    if (sendReply) await sendReply({ type: 'text', content: '📤 _Envoi en cours vers ' + pending.lead.email + '..._' });

    try {
      const result = await this.sendgrid.sendEmail(
        pending.lead.email,
        pending.email.subject,
        pending.email.body
      );

      const status = result.success ? 'sent' : 'failed';
      storage.addEmail(chatId, pending.lead.email, pending.email.subject, pending.email.body, status);
      delete this.pendingEmails[String(chatId)];

      if (result.success) {
        return { type: 'text', content: '✅ *Email envoye !*\n\n📧 ' + pending.lead.email + '\n📌 ' + pending.email.subject };
      } else {
        return { type: 'text', content: '❌ Echec de l\'envoi : ' + (result.error || 'erreur inconnue') };
      }
    } catch (error) {
      return { type: 'text', content: '❌ Erreur envoi : ' + error.message };
    }
  }
}

module.exports = FlowFastTelegramHandler;
