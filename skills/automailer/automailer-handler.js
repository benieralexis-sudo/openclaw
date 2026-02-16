// AutoMailer - Handler NLP Telegram
const ClaudeEmailWriter = require('./claude-email-writer.js');
const ResendClient = require('./resend-client.js');
const ContactManager = require('./contact-manager.js');
const CampaignEngine = require('./campaign-engine.js');
const storage = require('./storage.js');
const https = require('https');
const { retryAsync } = require('../../gateway/utils.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const log = require('../../gateway/logger.js');

class AutoMailerHandler {
  constructor(openaiKey, claudeKey, resendKey, senderEmail) {
    this.openaiKey = openaiKey;
    this.claude = claudeKey ? new ClaudeEmailWriter(claudeKey) : null;
    this.resend = resendKey ? new ResendClient(resendKey, senderEmail) : null;
    this.contacts = new ContactManager();
    this.campaignEngine = this.resend && this.claude
      ? new CampaignEngine(this.resend, this.claude)
      : null;

    // Etats conversationnels
    this.pendingEmails = {};          // chatId -> { to, email: { subject, body } }
    this.pendingConversations = {};   // chatId -> { step, action, data }
    this.pendingImports = {};         // chatId -> { listId, listName }
  }

  start() {
    if (this.campaignEngine) this.campaignEngine.start();
  }

  stop() {
    if (this.campaignEngine) this.campaignEngine.stop();
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
    const user = storage.getUser(chatId);
    const hasPendingEmail = !!this.pendingEmails[String(chatId)];
    const hasPendingConv = !!this.pendingConversations[String(chatId)];
    const hasPendingImport = !!this.pendingImports[String(chatId)];

    const lists = storage.getContactLists(chatId);
    const campaigns = storage.getCampaigns(chatId);
    const listContext = lists.length > 0
      ? '\nListes de contacts existantes:\n' + lists.map(l => '- "' + l.name + '" (' + l.contacts.length + ' contacts, id: ' + l.id + ')').join('\n')
      : '';
    const campaignContext = campaigns.length > 0
      ? '\nCampagnes existantes:\n' + campaigns.map(c => '- "' + c.name + '" (status: ' + c.status + ', id: ' + c.id + ')').join('\n')
      : '';

    const systemPrompt = `Tu es l'assistant email marketing d'un bot Telegram. L'utilisateur parle en francais naturel, souvent de facon informelle ou avec des fautes.
Tu dois comprendre son INTENTION meme s'il ne dit pas les mots exacts.

Classifie le message en une action JSON.

Actions :
- "create_campaign" : veut creer/lancer une campagne ou sequence d'emails
  Ex: "lance une campagne", "sequence de 3 mails pour mes prospects", "je veux emailer ma liste", "nouvelle campagne de relance"
  Params: {"name":"nom optionnel","steps":3,"interval_days":3}

- "list_campaigns" : veut voir ses campagnes / savoir ou en sont ses campagnes
  Ex: "mes campagnes", "ou en sont les envois ?", "comment se passent mes campagnes ?", "ca donne quoi les campagnes ?"
- "show_campaign" : detail d'une campagne precise
  Params: {"campaign_id":"cmp_..."}
- "pause_campaign" : mettre en pause
  Params: {"campaign_id":"cmp_..."}
- "resume_campaign" : relancer / reprendre
  Params: {"campaign_id":"cmp_..."}

- "create_template" : creer un modele / template d'email
  Params: {"name":"nom","context":"description"}
  Ex: "cree un template de relance", "nouveau modele d'email"
- "list_templates" : voir les templates
  Ex: "mes templates", "quels modeles j'ai ?"

- "import_contacts" : importer des contacts dans une liste
  Params: {"list_name":"nom de la liste"}
  Ex: "importe des contacts", "j'ai une liste a ajouter"
- "list_contacts" : voir les listes de contacts
  Ex: "mes contacts", "mes listes", "combien de contacts j'ai ?"
- "show_contacts" : voir les contacts d'une liste precise
  Params: {"list_id":"lst_...","list_name":"nom"}

- "send_single" : envoyer un email ponctuel a quelqu'un
  Params: {"to":"email@example.com","context":"contexte optionnel"}
  Ex: "envoie un mail a jean@example.com", "ecris un email de prospection a ce lead", "balance un mail a..."

- "campaign_stats" : stats d'une campagne ou stats globales
  Params: {"campaign_id":"cmp_..."}
  Ex: "stats des campagnes", "taux d'ouverture", "ca donne quoi les envois ?"

- "email_history" : historique des emails envoyes
  Ex: "historique", "qu'est-ce que j'ai envoye ?", "les derniers mails"

- "confirm_yes" : confirmation positive
  Ex: "oui", "ok", "go", "envoie", "lance", "c'est bon", "parfait", "valide"
- "confirm_no" : refus / annulation
  Ex: "non", "annule", "stop", "laisse tomber", "pas maintenant"
- "edit_email" : modifier l'email en cours avant envoi
  Params: {"instruction":"plus court"}
  Ex: "plus court", "change le ton", "ajoute un CTA", "reformule"

- "help" : demande d'aide explicite
  Ex: "aide", "comment ca marche ?", "qu'est-ce que tu sais faire ?"
- "chat" : UNIQUEMENT si ca ne correspond a aucune action ci-dessus

${hasPendingEmail ? 'IMPORTANT: L\'utilisateur a un EMAIL en attente. "oui/envoie/go" = confirm_yes, "non/annule" = confirm_no, modification = edit_email.' : ''}
${hasPendingConv ? 'IMPORTANT: L\'utilisateur est en plein workflow multi-etapes (creation campagne). Classe en "continue_conversation" sauf si c\'est clairement une autre action.' : ''}
${hasPendingImport ? 'IMPORTANT: L\'utilisateur a un import de contacts en attente. S\'il colle des donnees (emails, CSV), classe en "import_data".' : ''}
${listContext}
${campaignContext}

JSON strict, exemples :
{"action":"create_campaign","params":{"name":"Ma campagne","steps":3,"interval_days":4}}
{"action":"send_single","params":{"to":"jean@example.com","context":"proposer une demo"}}
{"action":"import_contacts","params":{"list_name":"Prospects"}}
{"action":"confirm_yes"}
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
      log.error('automailer', 'Erreur classifyIntent:', error.message);
      return null;
    }
  }

  // --- Handler principal ---

  async handleMessage(message, chatId, sendReply) {
    const user = storage.getUser(chatId);
    const text = message.trim();
    const textLower = text.toLowerCase();

    // Commandes rapides
    if (textLower === '/start' || textLower === 'aide automailer') {
      return { type: 'text', content: this.getHelp() };
    }

    // Import en attente : l'utilisateur colle des donnees
    // Mais si le message ressemble a une commande, annuler l'import et traiter normalement
    if (this.pendingImports[String(chatId)]) {
      const cancelKeywords = ['campagne', 'campaign', 'template', 'aide', 'help', 'annule', 'stop',
        'envoie un email', 'envoie un mail', 'mail a ', 'email a ', 'mes contacts', 'mes listes',
        'mes campagnes', 'mes templates', 'stats', 'historique', 'cree une', 'crée une'];
      const isCommand = cancelKeywords.some(kw => textLower.includes(kw));
      if (isCommand) {
        const listName = this.pendingImports[String(chatId)].listName;
        delete this.pendingImports[String(chatId)];
        if (sendReply) await sendReply({ type: 'text', content: '👌 Import dans "' + listName + '" annule.' });
        // Continuer vers la classification NLP ci-dessous
      } else {
        return await this._handleImportData(chatId, text, sendReply);
      }
    }

    // Conversation en cours (workflow multi-etapes)
    // Meme logique : si le message est clairement une autre commande, annuler le workflow
    if (this.pendingConversations[String(chatId)]) {
      const cancelKeywords = ['annule', 'stop', 'aide', 'help'];
      const newCommandKeywords = ['envoie un email', 'envoie un mail', 'mail a ', 'email a ',
        'importe des contacts', 'mes contacts', 'mes listes', 'mes campagnes', 'mes templates',
        'stats', 'historique', 'cree une campagne', 'crée une campagne'];
      const isCancel = cancelKeywords.some(kw => textLower.includes(kw));
      const isNewCommand = newCommandKeywords.some(kw => textLower.includes(kw));
      if (isCancel) {
        delete this.pendingConversations[String(chatId)];
        if (isCancel && !isNewCommand) return { type: 'text', content: '👌 Annule.' };
        // Si c'est une nouvelle commande + annule, continuer vers NLP
      } else if (isNewCommand) {
        delete this.pendingConversations[String(chatId)];
        // Continuer vers la classification NLP ci-dessous
      } else {
        return await this._continueConversation(chatId, text, sendReply);
      }
    }

    // Classification NLP
    const command = await this.classifyIntent(text, chatId);
    if (!command) {
      return { type: 'text', content: 'Je n\'ai pas compris. Dis _"aide"_ pour voir ce que je sais faire !' };
    }

    switch (command.action) {

      // --- EMAIL PONCTUEL ---
      case 'send_single': {
        if (!this.claude || !this.resend) {
          return { type: 'text', content: '❌ Les cles API ne sont pas configurees.' };
        }
        const params = command.params || {};
        const to = params.to;
        const context = params.context || null;

        if (!to || !to.includes('@')) {
          return { type: 'text', content: '❌ Donne-moi une adresse email valide.\nExemple : _"envoie un email a jean@example.com pour proposer une demo"_' };
        }

        if (sendReply) await sendReply({ type: 'text', content: '✍️ _Redaction d\'un email pour ' + to + '..._' });

        try {
          const contact = { email: to, name: '', firstName: '', company: '' };
          // Chercher dans les listes de contacts pour personnaliser
          const lists = storage.getContactLists(chatId);
          for (const list of lists) {
            const found = list.contacts.find(c => c.email === to);
            if (found) {
              contact.name = found.name;
              contact.firstName = found.firstName;
              contact.company = found.company;
              contact.title = found.title;
              break;
            }
          }

          const claudeBreaker = getBreaker('claude-sonnet', { failureThreshold: 3, cooldownMs: 60000 });
          const email = await claudeBreaker.call(() => retryAsync(() => this.claude.generateSingleEmail(contact, context), 2, 2000));
          this.pendingEmails[String(chatId)] = { to: to, email: email };

          return { type: 'text', content: [
            '✉️ *MAIL PROPOSE*',
            '━━━━━━━━━━━━━━━━━━',
            '',
            '📧 *A :* ' + to,
            '📌 *Objet :* ' + email.subject,
            '',
            email.body,
            '',
            '━━━━━━━━━━━━━━━━━━',
            '👉 _"envoie"_ pour envoyer',
            '👉 _"plus court"_ / _"plus formel"_ pour modifier',
            '👉 _"annule"_ pour annuler'
          ].join('\n') };
        } catch (error) {
          return { type: 'text', content: '❌ Erreur generation email : ' + error.message };
        }
      }

      // --- CONFIRMATION ---
      case 'confirm_yes': {
        // Email en attente
        const pendingEmail = this.pendingEmails[String(chatId)];
        if (pendingEmail) {
          return await this._sendPendingEmail(chatId, sendReply);
        }
        return { type: 'text', content: 'Rien en attente. Dis-moi ce que tu veux faire !' };
      }

      case 'confirm_no': {
        if (this.pendingEmails[String(chatId)]) {
          delete this.pendingEmails[String(chatId)];
          return { type: 'text', content: '👌 Email annule.' };
        }
        if (this.pendingConversations[String(chatId)]) {
          delete this.pendingConversations[String(chatId)];
          return { type: 'text', content: '👌 Annule.' };
        }
        return { type: 'text', content: '👌 OK !' };
      }

      case 'edit_email': {
        const pendingEmail = this.pendingEmails[String(chatId)];
        if (!pendingEmail) {
          return { type: 'text', content: 'Pas d\'email en cours. Envoie d\'abord un email !' };
        }
        const instruction = (command.params && command.params.instruction) || text;
        if (sendReply) await sendReply({ type: 'text', content: '✍️ _Modification en cours..._' });

        try {
          const claudeBreaker = getBreaker('claude-sonnet', { failureThreshold: 3, cooldownMs: 60000 });
          const newEmail = await claudeBreaker.call(() => retryAsync(() => this.claude.editEmail(pendingEmail.email, instruction), 2, 2000));
          pendingEmail.email = newEmail;

          return { type: 'text', content: [
            '✉️ *MAIL MODIFIE*',
            '━━━━━━━━━━━━━━━━━━',
            '',
            '📧 *A :* ' + pendingEmail.to,
            '📌 *Objet :* ' + newEmail.subject,
            '',
            newEmail.body,
            '',
            '━━━━━━━━━━━━━━━━━━',
            '👉 _"envoie"_ ou _"annule"_'
          ].join('\n') };
        } catch (error) {
          return { type: 'text', content: '❌ Erreur modification : ' + error.message };
        }
      }

      // --- CAMPAGNES ---
      case 'create_campaign': {
        if (!this.claude || !this.resend) {
          return { type: 'text', content: '❌ Les cles API ne sont pas configurees.' };
        }
        const params = command.params || {};
        const lists = storage.getContactLists(chatId);

        if (lists.length === 0) {
          return { type: 'text', content: '📭 Tu n\'as aucune liste de contacts.\nImporte d\'abord des contacts avec _"importe des contacts"_' };
        }

        // Demarrer le workflow multi-etapes
        this.pendingConversations[String(chatId)] = {
          action: 'create_campaign',
          step: params.name ? 'awaiting_list' : 'awaiting_name',
          data: {
            name: params.name || null,
            steps: params.steps || null,
            intervalDays: params.interval_days || null,
            contactListId: null,
            context: null
          }
        };

        if (params.name) {
          // On a deja le nom, demander la liste
          const listText = lists.map((l, i) => (i + 1) + '. *' + l.name + '* (' + l.contacts.length + ' contacts)').join('\n');
          return { type: 'text', content: '📋 Quelle liste de contacts pour la campagne *' + params.name + '* ?\n\n' + listText + '\n\n_Reponds avec le numero ou le nom de la liste._' };
        }

        return { type: 'text', content: '📧 *Nouvelle campagne*\n\nQuel nom pour ta campagne ?' };
      }

      case 'list_campaigns': {
        const campaigns = storage.getCampaigns(chatId);
        if (campaigns.length === 0) {
          return { type: 'text', content: '📭 Aucune campagne. Cree-en une avec _"cree une campagne"_' };
        }
        const lines = ['📧 *MES CAMPAGNES*', '━━━━━━━━━━━━━━━━━━', ''];
        campaigns.forEach((c, i) => {
          const statusIcon = c.status === 'active' ? '🟢' : c.status === 'paused' ? '⏸️' : c.status === 'completed' ? '✅' : '📝';
          lines.push(statusIcon + ' *' + (i + 1) + '. ' + c.name + '*');
          lines.push('   Status : ' + c.status + ' | Contacts : ' + c.totalContacts + ' | Etapes : ' + c.steps.length);
          if (c.startedAt) lines.push('   Lancee le : ' + new Date(c.startedAt).toLocaleDateString('fr-FR'));
          lines.push('');
        });
        return { type: 'text', content: lines.join('\n') };
      }

      case 'show_campaign': {
        const params = command.params || {};
        let campaign = null;
        if (params.campaign_id) {
          campaign = storage.getCampaign(params.campaign_id);
        } else {
          const campaigns = storage.getCampaigns(chatId);
          campaign = campaigns.length > 0 ? campaigns[campaigns.length - 1] : null;
        }
        if (!campaign) return { type: 'text', content: '📭 Campagne introuvable.' };

        const stats = this.campaignEngine ? this.campaignEngine.getCampaignStats(campaign.id) : null;
        const lines = [
          '📧 *CAMPAGNE : ' + campaign.name + '*',
          '━━━━━━━━━━━━━━━━━━',
          '',
          '📌 Status : ' + campaign.status,
          '👥 Contacts : ' + campaign.totalContacts,
          '📬 Etapes : ' + campaign.steps.length,
          ''
        ];
        campaign.steps.forEach(s => {
          const icon = s.status === 'completed' ? '✅' : s.status === 'sending' ? '📤' : '⏳';
          lines.push(icon + ' Etape ' + s.stepNumber + ' : ' + s.status);
          if (s.sentCount) lines.push('   Envoyes : ' + s.sentCount + (s.errorCount > 0 ? ' | Erreurs : ' + s.errorCount : ''));
          if (s.scheduledAt) lines.push('   Prevu : ' + new Date(s.scheduledAt).toLocaleDateString('fr-FR'));
        });
        if (stats) {
          lines.push('', '📊 *Stats emails*');
          lines.push('   Envoyes : ' + stats.emailStats.sent);
          lines.push('   Delivres : ' + stats.emailStats.delivered);
          lines.push('   Ouverts : ' + stats.emailStats.opened + ' (' + stats.emailStats.openRate + '%)');
          if (stats.emailStats.bounced > 0) lines.push('   Bounces : ' + stats.emailStats.bounced);
        }
        return { type: 'text', content: lines.join('\n') };
      }

      case 'pause_campaign': {
        const params = command.params || {};
        let campaignId = params.campaign_id;
        if (!campaignId) {
          const campaigns = storage.getCampaigns(chatId).filter(c => c.status === 'active');
          campaignId = campaigns.length > 0 ? campaigns[campaigns.length - 1].id : null;
        }
        if (!campaignId || !this.campaignEngine) return { type: 'text', content: '❌ Aucune campagne active a mettre en pause.' };
        const ok = this.campaignEngine.pauseCampaign(campaignId);
        return { type: 'text', content: ok ? '⏸️ Campagne mise en pause.' : '❌ Impossible de mettre en pause cette campagne.' };
      }

      case 'resume_campaign': {
        const params = command.params || {};
        let campaignId = params.campaign_id;
        if (!campaignId) {
          const campaigns = storage.getCampaigns(chatId).filter(c => c.status === 'paused');
          campaignId = campaigns.length > 0 ? campaigns[campaigns.length - 1].id : null;
        }
        if (!campaignId || !this.campaignEngine) return { type: 'text', content: '❌ Aucune campagne en pause a relancer.' };
        const ok = this.campaignEngine.resumeCampaign(campaignId);
        return { type: 'text', content: ok ? '🟢 Campagne relancee !' : '❌ Impossible de relancer cette campagne.' };
      }

      case 'campaign_stats': {
        const params = command.params || {};
        if (params.campaign_id && this.campaignEngine) {
          const stats = this.campaignEngine.getCampaignStats(params.campaign_id);
          if (!stats) return { type: 'text', content: '❌ Campagne introuvable.' };
          return { type: 'text', content: this._formatCampaignStats(stats) };
        }
        // Stats globales
        const globalStats = storage.getGlobalStats();
        return { type: 'text', content: [
          '📊 *STATISTIQUES AUTOMAILER*',
          '━━━━━━━━━━━━━━━━━━',
          '',
          '📧 Emails envoyes : ' + globalStats.totalEmailsSent,
          '✅ Emails delivres : ' + globalStats.totalEmailsDelivered,
          '👁️ Emails ouverts : ' + globalStats.totalEmailsOpened,
          '❌ Bounces : ' + globalStats.totalEmailsBounced,
          '',
          '📋 Campagnes : ' + globalStats.totalCampaigns + ' (dont ' + globalStats.activeCampaigns + ' actives)',
          '👥 Contacts : ' + globalStats.totalContacts + ' dans ' + globalStats.totalLists + ' listes',
          '📝 Templates : ' + globalStats.totalTemplatesCreated
        ].join('\n') };
      }

      // --- CONTACTS ---
      case 'import_contacts': {
        const params = command.params || {};
        const listName = params.list_name || null;

        if (listName) {
          // Creer ou trouver la liste
          let list = this.contacts.findListByName(chatId, listName);
          if (!list) list = this.contacts.createList(chatId, listName);

          this.pendingImports[String(chatId)] = { listId: list.id, listName: list.name };
          return { type: 'text', content: '📥 *Import dans la liste "' + list.name + '"*\n\nColle tes contacts ici :\n- Un email par ligne\n- Ou format : Nom Prenom <email>\n- Ou CSV (nom,email,entreprise,poste)\n\n_Colle les donnees maintenant._' };
        }

        this.pendingConversations[String(chatId)] = {
          action: 'import_contacts',
          step: 'awaiting_list_name',
          data: {}
        };
        return { type: 'text', content: '📥 *Import de contacts*\n\nQuel nom pour la liste ?' };
      }

      case 'list_contacts': {
        const lists = storage.getContactLists(chatId);
        if (lists.length === 0) {
          return { type: 'text', content: '📭 Aucune liste. Importe des contacts avec _"importe des contacts"_' };
        }
        const lines = ['👥 *MES LISTES DE CONTACTS*', '━━━━━━━━━━━━━━━━━━', ''];
        lists.forEach((l, i) => {
          lines.push((i + 1) + '. *' + l.name + '* — ' + l.contacts.length + ' contacts');
          lines.push('   Creee le ' + new Date(l.createdAt).toLocaleDateString('fr-FR'));
          lines.push('');
        });
        return { type: 'text', content: lines.join('\n') };
      }

      case 'show_contacts': {
        const params = command.params || {};
        let list = null;
        if (params.list_id) {
          list = storage.getContactList(params.list_id);
        } else if (params.list_name) {
          list = this.contacts.findListByName(chatId, params.list_name);
        } else {
          const lists = storage.getContactLists(chatId);
          list = lists.length > 0 ? lists[lists.length - 1] : null;
        }
        if (!list) return { type: 'text', content: '📭 Liste introuvable.' };

        if (list.contacts.length === 0) {
          return { type: 'text', content: '📭 La liste *' + list.name + '* est vide.' };
        }

        const lines = ['👥 *' + list.name + '* (' + list.contacts.length + ' contacts)', '━━━━━━━━━━━━━━━━━━', ''];
        const max = Math.min(list.contacts.length, 20);
        list.contacts.slice(0, max).forEach((c, i) => {
          lines.push((i + 1) + '. ' + (c.name || c.firstName || '') + ' — ' + c.email);
          if (c.company) lines.push('   🏢 ' + c.company + (c.title ? ' | ' + c.title : ''));
        });
        if (list.contacts.length > 20) lines.push('\n... et ' + (list.contacts.length - 20) + ' autres');
        return { type: 'text', content: lines.join('\n') };
      }

      // --- TEMPLATES ---
      case 'create_template': {
        const params = command.params || {};
        this.pendingConversations[String(chatId)] = {
          action: 'create_template',
          step: params.name ? 'awaiting_subject' : 'awaiting_name',
          data: { name: params.name || null, subject: null, body: null }
        };
        if (params.name) {
          return { type: 'text', content: '📝 Template *' + params.name + '*\n\nQuel objet (subject) ? Utilise {{firstName}}, {{company}} pour personnaliser.' };
        }
        return { type: 'text', content: '📝 *Nouveau template*\n\nQuel nom pour ce template ?' };
      }

      case 'list_templates': {
        const templates = storage.getTemplates(chatId);
        if (templates.length === 0) {
          return { type: 'text', content: '📭 Aucun template. Cree-en un avec _"cree un template"_' };
        }
        const lines = ['📝 *MES TEMPLATES*', '━━━━━━━━━━━━━━━━━━', ''];
        templates.forEach((t, i) => {
          lines.push((i + 1) + '. *' + t.name + '*');
          lines.push('   📌 ' + t.subject);
          if (t.variables.length > 0) lines.push('   Variables : ' + t.variables.map(v => '{{' + v + '}}').join(', '));
          lines.push('');
        });
        return { type: 'text', content: lines.join('\n') };
      }

      // --- HISTORIQUE ---
      case 'email_history': {
        const emails = storage.getRecentEmails(chatId, 15);
        if (emails.length === 0) return { type: 'text', content: '📭 Aucun email envoye.' };
        const lines = ['✉️ *HISTORIQUE EMAILS*', '━━━━━━━━━━━━━━━━━━', ''];
        emails.reverse().forEach((e, i) => {
          const statusIcon = e.status === 'sent' || e.status === 'delivered' ? '✅' : e.status === 'opened' ? '👁️' : e.status === 'bounced' ? '❌' : '📤';
          const date = new Date(e.createdAt).toLocaleDateString('fr-FR');
          lines.push(statusIcon + ' ' + (i + 1) + '. ' + date + ' → ' + e.to);
          lines.push('   📌 ' + e.subject + ' [' + e.status + ']');
          lines.push('');
        });
        return { type: 'text', content: lines.join('\n') };
      }

      // --- AIDE ---
      case 'help':
        return { type: 'text', content: this.getHelp() };

      case 'chat': {
        try {
          const openaiBreaker = getBreaker('openai', { failureThreshold: 3, cooldownMs: 60000 });
          const response = await openaiBreaker.call(() => retryAsync(() => this.callOpenAI([
            { role: 'system', content: 'Tu es l\'assistant AutoMailer du bot Telegram. Tu aides a envoyer des emails et gerer des campagnes. Reponds en francais, 1-3 phrases max. Si perdu, donne un exemple.' },
            { role: 'user', content: text }
          ], 200), 2, 2000));
          return { type: 'text', content: response.trim() };
        } catch (e) {
          return { type: 'text', content: 'Dis-moi ce que tu veux faire ! Exemples :\n_"envoie un email a jean@example.com"_\n_"cree une campagne"_\n_"importe des contacts"_' };
        }
      }

      case 'continue_conversation':
        return await this._continueConversation(chatId, text, sendReply);

      case 'import_data':
        return await this._handleImportData(chatId, text, sendReply);

      default:
        return { type: 'text', content: this.getHelp() };
    }
  }

  // --- Workflows multi-etapes ---

  async _continueConversation(chatId, text, sendReply) {
    const conv = this.pendingConversations[String(chatId)];
    if (!conv) return null;

    if (conv.action === 'create_campaign') {
      return await this._campaignConversation(chatId, text, conv, sendReply);
    }
    if (conv.action === 'import_contacts') {
      return await this._importConversation(chatId, text, conv, sendReply);
    }
    if (conv.action === 'create_template') {
      return await this._templateConversation(chatId, text, conv, sendReply);
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  async _campaignConversation(chatId, text, conv, sendReply) {
    const lists = storage.getContactLists(chatId);

    switch (conv.step) {
      case 'awaiting_name':
        conv.data.name = text;
        conv.step = 'awaiting_list';
        if (lists.length === 0) {
          delete this.pendingConversations[String(chatId)];
          return { type: 'text', content: '📭 Tu n\'as aucune liste de contacts. Importe d\'abord des contacts avec _"importe des contacts"_' };
        }
        const listText = lists.map((l, i) => (i + 1) + '. *' + l.name + '* (' + l.contacts.length + ' contacts)').join('\n');
        return { type: 'text', content: '📋 Quelle liste de contacts ?\n\n' + listText + '\n\n_Reponds avec le numero ou le nom._' };

      case 'awaiting_list': {
        // Trouver la liste par numero ou nom
        let list = null;
        const num = parseInt(text);
        if (!isNaN(num) && num >= 1 && num <= lists.length) {
          list = lists[num - 1];
        } else {
          list = this.contacts.findListByName(chatId, text);
        }
        if (!list) {
          return { type: 'text', content: '❌ Liste introuvable. Reessaie avec le numero ou le nom exact.' };
        }
        conv.data.contactListId = list.id;
        conv.step = 'awaiting_steps';
        return { type: 'text', content: '📬 Combien d\'emails dans la sequence ?\nExemple : _"3 emails, un tous les 4 jours"_' };
      }

      case 'awaiting_steps': {
        // Parser "3 emails tous les 4 jours" ou juste "3"
        const numMatch = text.match(/(\d+)/);
        const intervalMatch = text.match(/(\d+)\s*jours?/i);
        conv.data.steps = numMatch ? parseInt(numMatch[1]) : 3;
        conv.data.intervalDays = intervalMatch ? parseInt(intervalMatch[1]) : 3;
        if (conv.data.steps < 1) conv.data.steps = 1;
        if (conv.data.steps > 10) conv.data.steps = 10;
        conv.step = 'awaiting_context';
        return { type: 'text', content: '🎯 Quel est l\'objectif de cette campagne ?\nExemple : _"proposer une demo de notre SaaS"_, _"invitation webinar"_, _"suivi apres salon"_' };
      }

      case 'awaiting_context': {
        conv.data.context = text;
        conv.step = 'awaiting_confirmation';

        if (sendReply) await sendReply({ type: 'text', content: '🤖 _Generation de ' + conv.data.steps + ' emails pour la sequence..._' });

        try {
          // Creer la campagne
          const campaign = await this.campaignEngine.createCampaign(chatId, {
            name: conv.data.name,
            contactListId: conv.data.contactListId
          });

          // Generer les emails
          const steps = await this.campaignEngine.generateCampaignEmails(
            campaign.id, conv.data.context, conv.data.steps, conv.data.intervalDays
          );

          // Sauvegarder l'ID pour la confirmation
          conv.data.campaignId = campaign.id;

          const list = storage.getContactList(conv.data.contactListId);
          const lines = [
            '📧 *CAMPAGNE PRETE*',
            '━━━━━━━━━━━━━━━━━━',
            '',
            '📌 *' + conv.data.name + '*',
            '👥 ' + (list ? list.contacts.length : 0) + ' contacts',
            '📬 ' + steps.length + ' emails, 1 tous les ' + conv.data.intervalDays + ' jours',
            ''
          ];

          steps.forEach((s, i) => {
            lines.push('📩 *Email ' + (i + 1) + '/' + steps.length + '* (Jour ' + (i * conv.data.intervalDays) + ')');
            lines.push('📌 Objet : ' + s.subjectTemplate);
            lines.push(s.bodyTemplate.substring(0, 150) + (s.bodyTemplate.length > 150 ? '...' : ''));
            lines.push('');
          });

          lines.push('━━━━━━━━━━━━━━━━━━');
          lines.push('👉 _"lance"_ pour demarrer la campagne');
          lines.push('👉 _"annule"_ pour annuler');

          return { type: 'text', content: lines.join('\n') };
        } catch (error) {
          delete this.pendingConversations[String(chatId)];
          return { type: 'text', content: '❌ Erreur creation campagne : ' + error.message };
        }
      }

      case 'awaiting_confirmation': {
        const lower = text.toLowerCase();
        if (lower === 'oui' || lower === 'ok' || lower === 'go' || lower === 'lance' || lower === 'envoie') {
          if (sendReply) await sendReply({ type: 'text', content: '🚀 _Lancement de la campagne..._' });
          try {
            const result = await this.campaignEngine.startCampaign(conv.data.campaignId);
            delete this.pendingConversations[String(chatId)];
            return { type: 'text', content: '✅ *Campagne lancee !*\n\n📤 Premier email envoye a ' + result.sent + ' contacts\n' + (result.errors > 0 ? '❌ ' + result.errors + ' erreurs\n' : '') + '\nProchain email dans ' + conv.data.intervalDays + ' jours.\nDis _"stats campagne"_ pour suivre.' };
          } catch (error) {
            delete this.pendingConversations[String(chatId)];
            return { type: 'text', content: '❌ Erreur lancement : ' + error.message };
          }
        }
        delete this.pendingConversations[String(chatId)];
        return { type: 'text', content: '👌 Campagne sauvegardee en brouillon. Dis _"mes campagnes"_ pour la voir.' };
      }
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  async _importConversation(chatId, text, conv, sendReply) {
    if (conv.step === 'awaiting_list_name') {
      let list = this.contacts.findListByName(chatId, text);
      if (!list) list = this.contacts.createList(chatId, text);

      this.pendingImports[String(chatId)] = { listId: list.id, listName: list.name };
      delete this.pendingConversations[String(chatId)];

      return { type: 'text', content: '📥 *Import dans "' + list.name + '"*\n\nColle tes contacts :\n- Un email par ligne\n- Ou : Nom <email>\n- Ou CSV : nom,email,entreprise,poste\n\n_Colle maintenant._' };
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  async _templateConversation(chatId, text, conv, sendReply) {
    switch (conv.step) {
      case 'awaiting_name':
        conv.data.name = text;
        conv.step = 'awaiting_subject';
        return { type: 'text', content: '📌 Quel objet (subject) ?\n\nVariables dispo : {{firstName}}, {{lastName}}, {{company}}, {{title}}\nExemple : _"{{firstName}}, une question rapide"_' };

      case 'awaiting_subject':
        conv.data.subject = text;
        conv.step = 'awaiting_body';
        return { type: 'text', content: '📝 Ecris le corps du mail.\n\nUtilise les memes variables : {{firstName}}, {{company}}, etc.' };

      case 'awaiting_body': {
        conv.data.body = text;
        const template = storage.createTemplate(chatId, conv.data.name, conv.data.subject, conv.data.body);
        delete this.pendingConversations[String(chatId)];
        return { type: 'text', content: '✅ *Template "' + template.name + '" cree !*\n\n📌 Objet : ' + template.subject + '\n' + (template.variables.length > 0 ? '🔤 Variables : ' + template.variables.map(v => '{{' + v + '}}').join(', ') : '') };
      }
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  // --- Import de donnees ---

  async _handleImportData(chatId, text, sendReply) {
    const pending = this.pendingImports[String(chatId)];
    if (!pending) return null;

    if (sendReply) await sendReply({ type: 'text', content: '📥 _Import en cours..._' });

    // Detecter si c'est du CSV ou du texte simple
    const isCSV = text.includes(',') && text.split('\n')[0].split(',').length >= 2;
    let result;

    if (isCSV) {
      result = this.contacts.importFromCSV(text, pending.listId);
    } else {
      result = this.contacts.importFromText(text, pending.listId);
    }

    delete this.pendingImports[String(chatId)];

    const lines = ['✅ *Import termine !*', ''];
    lines.push('📥 ' + result.imported + ' contacts importes dans *' + pending.listName + '*');
    if (result.errors.length > 0) {
      lines.push('');
      lines.push('⚠️ ' + result.errors.length + ' erreurs :');
      result.errors.slice(0, 5).forEach(e => {
        lines.push('   Ligne ' + e.line + ' : ' + e.reason);
      });
      if (result.errors.length > 5) lines.push('   ... et ' + (result.errors.length - 5) + ' autres erreurs');
    }

    return { type: 'text', content: lines.join('\n') };
  }

  // --- Envoi email en attente ---

  async _sendPendingEmail(chatId, sendReply) {
    const pending = this.pendingEmails[String(chatId)];
    if (!pending) return { type: 'text', content: 'Pas d\'email en attente.' };

    if (sendReply) await sendReply({ type: 'text', content: '📤 _Envoi en cours vers ' + pending.to + '..._' });

    try {
      const resendBreaker = getBreaker('resend', { failureThreshold: 3, cooldownMs: 60000 });
      const result = await resendBreaker.call(() => retryAsync(() => this.resend.sendEmail(
        pending.to,
        pending.email.subject,
        pending.email.body
      ), 2, 2000));

      storage.addEmail({
        chatId: chatId,
        to: pending.to,
        subject: pending.email.subject,
        body: pending.email.body,
        resendId: result.success ? result.id : null,
        status: result.success ? 'sent' : 'failed'
      });
      delete this.pendingEmails[String(chatId)];

      if (result.success) {
        return { type: 'text', content: '✅ *Email envoye !*\n\n📧 ' + pending.to + '\n📌 ' + pending.email.subject };
      }
      return { type: 'text', content: '❌ Echec envoi : ' + (result.error || 'erreur inconnue') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur envoi : ' + error.message };
    }
  }

  // --- Formatage ---

  _formatCampaignStats(stats) {
    const c = stats.campaign;
    const e = stats.emailStats;
    return [
      '📊 *STATS : ' + c.name + '*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '📧 Emails : ' + e.sent + ' envoyes, ' + e.delivered + ' delivres',
      '👁️ Ouverts : ' + e.opened + ' (' + e.openRate + '%)',
      '❌ Bounces : ' + e.bounced + ' | Echecs : ' + e.failed,
      '',
      '*Etapes :*',
      ...stats.stepStats.map(s => {
        const icon = s.status === 'completed' ? '✅' : s.status === 'sending' ? '📤' : '⏳';
        return icon + ' Etape ' + s.stepNumber + ' : ' + s.sentCount + ' envoyes' + (s.sentAt ? ' le ' + new Date(s.sentAt).toLocaleDateString('fr-FR') : '');
      })
    ].join('\n');
  }

  getHelp() {
    return [
      '📧 *AUTOMAILER*',
      '',
      '✉️ *Envoyer un email :*',
      '  _"envoie un email a jean@example.com"_',
      '  _"mail a marie@startup.com pour proposer une demo"_',
      '',
      '📋 *Campagnes :*',
      '  _"cree une campagne"_ — nouvelle sequence',
      '  _"mes campagnes"_ — voir les campagnes',
      '  _"pause la campagne"_ / _"relance la campagne"_',
      '  _"stats campagne"_ — statistiques',
      '',
      '👥 *Contacts :*',
      '  _"importe des contacts"_ — importer une liste',
      '  _"mes contacts"_ — voir les listes',
      '',
      '📝 *Templates :*',
      '  _"cree un template"_ — nouveau modele',
      '  _"mes templates"_ — voir les modeles',
      '',
      '📊 *Suivi :*',
      '  _"stats"_ — statistiques globales',
      '  _"historique emails"_ — emails envoyes',
      '',
      '━━━━━━━━━━━━━━━━━━',
      '📧 iFIND AutoMailer'
    ].join('\n');
  }
}

module.exports = AutoMailerHandler;
