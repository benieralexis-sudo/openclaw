// Invoice Bot - Handler NLP Telegram
const storage = require('./storage.js');
const invoiceGen = require('./invoice-generator.js');
const https = require('https');
const { retryAsync } = require('../../gateway/utils.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const log = require('../../gateway/logger.js');

class InvoiceBotHandler {
  constructor(openaiKey, resendKey, senderEmail) {
    this.openaiKey = openaiKey;
    this.resendKey = resendKey || '';
    this.senderEmail = senderEmail || 'onboarding@resend.dev';

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
    const id = String(chatId);
    const hasPending = !!this.pendingConversations[id];
    const hasConfirm = !!this.pendingConfirmations[id];

    const systemPrompt = `Tu es l'assistant facturation d'un bot Telegram. L'utilisateur parle en francais naturel, souvent de facon informelle ou avec des fautes.
Tu dois comprendre son INTENTION meme s'il ne dit pas les mots exacts.

Classifie le message en une action JSON.

Actions :
- "create_invoice" : veut creer/faire/preparer une facture
  Ex: "fais moi une facture", "je dois facturer un client", "nouvelle facture pour Acme"
- "list_invoices" : veut voir ses factures, ou un sous-ensemble
  Params: {"status":"all/draft/sent/paid/overdue"}
  Ex: "mes factures", "ou en sont mes factures ?", "les factures pas encore envoyees", "qu'est-ce qui est en attente ?"
- "view_invoice" : veut voir le detail d'une facture precise
  Params: {"number":"FAC-001"}
  Ex: "montre moi la FAC-003", "detail de la derniere facture", "c'est quoi la FAC-001 ?"
- "send_invoice" : veut envoyer une facture par email
  Params: {"number":"FAC-001"}
  Ex: "envoie la FAC-002", "balance la facture au client", "mail la facture 3"
- "mark_paid" : le client a paye / marquer comme reglee
  Params: {"number":"FAC-001"}
  Ex: "FAC-001 payee", "le client a paye la 3", "c'est regle pour la facture 2"
- "mark_overdue" : facture en retard / impayee
  Params: {"number":"FAC-001"}
  Ex: "la FAC-002 est en retard", "relance la 3", "factures impayees"
- "add_client" : ajouter un client
  Params: {"name":"Nom", "email":"email@...", "company":"Societe"}
  Ex: "nouveau client Jean Dupont", "ajoute Acme comme client"
- "list_clients" : voir les clients
  Ex: "mes clients", "qui sont mes clients ?", "la liste des clients"
- "edit_business" : modifier ses infos / RIB / coordonnees
  Params: {"field":"company/address/email/phone/siret/rib", "value":"..."}
  Ex: "change mon RIB", "modifier mon adresse", "mes infos entreprise"
- "invoice_stats" : statistiques / chiffres
  Ex: "mes stats", "combien j'ai facture ?", "mon chiffre d'affaire", "resume facturation"
- "confirm_yes" : confirmation positive
  Ex: "oui", "ok", "go", "c'est bon", "parfait", "envoie", "valide"
- "confirm_no" : refus / annulation
  Ex: "non", "annule", "stop", "laisse tomber", "pas maintenant"
- "help" : demande d'aide explicite
  Ex: "aide", "comment ca marche ?", "qu'est-ce que tu sais faire ?"
- "chat" : UNIQUEMENT si ca ne correspond a aucune action ci-dessus
${hasConfirm ? '\nATTENTION: CONFIRMATION en attente. "oui/ok/go/parfait" = confirm_yes, "non/annule/stop" = confirm_no.' : ''}
${hasPending ? '\nATTENTION: Workflow multi-etapes en cours. Classe en "continue_conversation" sauf si c\'est CLAIREMENT une autre action.' : ''}

Reponds UNIQUEMENT en JSON strict :
{"action":"create_invoice"}
{"action":"list_invoices","params":{"status":"all"}}
{"action":"send_invoice","params":{"number":"FAC-001"}}
{"action":"mark_paid","params":{"number":"FAC-003"}}
{"action":"add_client","params":{"name":"Jean Dupont","email":"jean@example.com","company":"Acme"}}
{"action":"edit_business","params":{"field":"rib","value":"FR76 3000 4028 3700 0100 0123 456"}}`;

    try {
      const openaiBreaker = getBreaker('openai', { failureThreshold: 3, cooldownMs: 60000 });
      const response = await openaiBreaker.call(() => retryAsync(() => this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ], 400), 2, 2000));

      let cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      if (!result.action) return null;
      return result;
    } catch (error) {
      log.error('invoice-bot', 'Erreur classifyIntent:', error.message);
      return null;
    }
  }

  // --- Handler principal ---

  async handleMessage(message, chatId, sendReply) {
    const user = storage.getUser(chatId);
    const text = message.trim();
    const textLower = text.toLowerCase();

    // Commandes rapides
    if (textLower === 'aide facture' || textLower === 'aide invoice' || textLower === 'help invoice') {
      return { type: 'text', content: this.getHelp() };
    }

    // Conversation en cours
    if (this.pendingConversations[String(chatId)]) {
      const cancelKeywords = ['annule', 'stop'];
      if (cancelKeywords.some(kw => textLower === kw)) {
        delete this.pendingConversations[String(chatId)];
        return { type: 'text', content: '👌 Annule.' };
      }
      return await this._continueConversation(chatId, text, sendReply);
    }

    // Confirmation en attente
    if (this.pendingConfirmations[String(chatId)]) {
      if (['oui', 'ok', 'go', 'yes', 'confirme'].some(kw => textLower === kw)) {
        return await this._executeConfirmation(chatId, sendReply);
      }
      if (['non', 'annule', 'stop', 'no'].some(kw => textLower === kw)) {
        delete this.pendingConfirmations[String(chatId)];
        return { type: 'text', content: '👌 Annule.' };
      }
    }

    // Detection rapide par mots-cles
    const quick = this._quickClassify(textLower, text);
    if (quick) {
      return await this._dispatchAction(quick.action, quick.params || {}, chatId, sendReply);
    }

    // Fallback NLP
    const command = await this.classifyIntent(text, chatId);
    if (!command) {
      return { type: 'text', content: 'Je n\'ai pas compris. Dis _"aide facture"_ pour voir ce que je sais faire !' };
    }

    return await this._dispatchAction(command.action, command.params || {}, chatId, sendReply);
  }

  _quickClassify(textLower, text) {
    // Creer une facture
    if (textLower.match(/\b(cree|crée|créer|nouvelle|crer)\b.*\b(facture|devis)\b/) || textLower === 'nouvelle facture') {
      return { action: 'create_invoice' };
    }
    // Lister factures
    if (textLower === 'mes factures' || textLower === 'liste factures') {
      return { action: 'list_invoices', params: { status: 'all' } };
    }
    if (textLower.includes('factures impayees') || textLower.includes('factures impayées')) {
      return { action: 'list_invoices', params: { status: 'overdue' } };
    }
    if (textLower.includes('factures payees') || textLower.includes('factures payées')) {
      return { action: 'list_invoices', params: { status: 'paid' } };
    }
    // Envoyer facture
    const sendMatch = textLower.match(/envoie.*facture\s*(fac-?\d+)?/i) || textLower.match(/facture\s*(fac-?\d+).*envoie/i);
    if (sendMatch) {
      const num = text.match(/FAC-?\d+/i);
      return { action: 'send_invoice', params: { number: num ? num[0].toUpperCase() : null } };
    }
    // Marquer payee
    if (textLower.includes('payee') || textLower.includes('payée') || textLower.match(/\bpaye\b/) || textLower.match(/\bpayé\b/)) {
      const num = text.match(/FAC-?\d+/i);
      return { action: 'mark_paid', params: { number: num ? num[0].toUpperCase() : null } };
    }
    // Voir facture
    const viewMatch = text.match(/FAC-?\d+/i);
    if (viewMatch && !textLower.includes('envoie') && !textLower.includes('paye')) {
      return { action: 'view_invoice', params: { number: viewMatch[0].toUpperCase() } };
    }
    // Clients
    if (textLower === 'mes clients' || textLower === 'liste clients') {
      return { action: 'list_clients' };
    }
    if (textLower.match(/\b(nouveau|ajoute|ajout)\b.*\bclient\b/) || textLower.match(/\bclient\b.*\b(nouveau|ajoute)\b/)) {
      return { action: 'add_client' };
    }
    // Stats
    if (textLower.includes('stats facture') || textLower.includes('statistiques facture') || textLower === 'stats facturation') {
      return { action: 'invoice_stats' };
    }
    // Business info
    if (textLower.includes('mon rib') || textLower.includes('modifier rib') || textLower.includes('mes infos') || textLower.includes('info entreprise')) {
      return { action: 'edit_business' };
    }
    return null;
  }

  async _dispatchAction(action, params, chatId, sendReply) {
    switch (action) {
      case 'create_invoice':
        return await this._handleCreateInvoice(chatId, params, sendReply);
      case 'list_invoices':
        return this._handleListInvoices(chatId, params);
      case 'view_invoice':
        return this._handleViewInvoice(chatId, params);
      case 'send_invoice':
        return await this._handleSendInvoice(chatId, params, sendReply);
      case 'mark_paid':
        return this._handleMarkPaid(chatId, params);
      case 'mark_overdue':
        return this._handleMarkOverdue(chatId, params);
      case 'add_client':
        return this._handleAddClient(chatId, params, sendReply);
      case 'list_clients':
        return this._handleListClients(chatId);
      case 'edit_business':
        return this._handleEditBusiness(chatId, params, sendReply);
      case 'invoice_stats':
        return this._handleStats(chatId);
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
        return await this._continueConversation(chatId, '', sendReply);
      case 'help':
        return { type: 'text', content: this.getHelp() };
      case 'chat': {
        try {
          const openaiBreaker = getBreaker('openai', { failureThreshold: 3, cooldownMs: 60000 });
          const response = await openaiBreaker.call(() => retryAsync(() => this.callOpenAI([
            { role: 'system', content: 'Tu es l\'assistant Invoice Bot du bot Telegram. Tu aides a gerer les factures. Reponds en francais, 1-3 phrases max.' },
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
  // CREATION DE FACTURE (workflow multi-etapes)
  // ============================================================

  async _handleCreateInvoice(chatId, params, sendReply) {
    const clients = storage.getClients(chatId);

    if (clients.length === 0) {
      // Pas de clients — en creer un d'abord
      this.pendingConversations[String(chatId)] = {
        action: 'create_invoice',
        step: 'new_client_name',
        data: { items: [], clientId: null }
      };
      return { type: 'text', content: '🧾 *NOUVELLE FACTURE*\n\nTu n\'as pas encore de client.\nCommence par me donner le *nom du client* :' };
    }

    // Afficher la liste des clients
    const clientList = clients.map((c, i) => (i + 1) + '. *' + (c.company || c.name) + '*' + (c.email ? ' (' + c.email + ')' : '')).join('\n');

    this.pendingConversations[String(chatId)] = {
      action: 'create_invoice',
      step: 'select_client',
      data: { items: [], clientId: null, clients: clients }
    };

    return { type: 'text', content: '🧾 *NOUVELLE FACTURE*\n\nPour quel client ?\n\n' + clientList + '\n\nReponds avec le *numero* ou *"nouveau"* pour un nouveau client.' };
  }

  // ============================================================
  // CONVERSATIONS MULTI-ETAPES
  // ============================================================

  async _continueConversation(chatId, text, sendReply) {
    const conv = this.pendingConversations[String(chatId)];
    if (!conv) return null;

    if (conv.action === 'create_invoice') {
      return await this._invoiceConversation(chatId, text, conv, sendReply);
    }
    if (conv.action === 'add_client') {
      return this._addClientConversation(chatId, text, conv);
    }
    if (conv.action === 'edit_business') {
      return this._editBusinessConversation(chatId, text, conv);
    }
    if (conv.action === 'send_invoice') {
      return await this._sendInvoiceConversation(chatId, text, conv, sendReply);
    }
    if (conv.action === 'mark_paid') {
      return this._markPaidConversation(chatId, text, conv);
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  async _invoiceConversation(chatId, text, conv, sendReply) {
    const id = String(chatId);

    // Etape : selectionner client
    if (conv.step === 'select_client') {
      const textLower = text.toLowerCase().trim();

      if (textLower === 'nouveau' || textLower === 'new') {
        conv.step = 'new_client_name';
        this.pendingConversations[id] = conv;
        return { type: 'text', content: '👤 *Nom du client* :' };
      }

      const num = parseInt(text);
      if (!isNaN(num) && num >= 1 && num <= conv.data.clients.length) {
        conv.data.clientId = conv.data.clients[num - 1].id;
        conv.step = 'add_items';
        delete conv.data.clients;
        this.pendingConversations[id] = conv;
        return { type: 'text', content: '✅ Client selectionne.\n\n📋 *Ajoute les lignes* de la facture.\n\nFormat : _Description | Quantite | Prix unitaire_\nExemple : _Developpement site web | 1 | 2500_\n\nEnvoie une ligne par message.\nDis *"fini"* quand tu as termine.' };
      }

      // Chercher par nom
      const client = storage.getClientByName(chatId, text);
      if (client) {
        conv.data.clientId = client.id;
        conv.step = 'add_items';
        delete conv.data.clients;
        this.pendingConversations[id] = conv;
        return { type: 'text', content: '✅ Client : *' + (client.company || client.name) + '*\n\n📋 *Ajoute les lignes* de la facture.\n\nFormat : _Description | Quantite | Prix unitaire_\nExemple : _Developpement site web | 1 | 2500_\n\nEnvoie une ligne par message.\nDis *"fini"* quand tu as termine.' };
      }

      return { type: 'text', content: '❌ Client introuvable. Reponds avec le *numero* de la liste ou *"nouveau"*.' };
    }

    // Etape : nouveau client — nom
    if (conv.step === 'new_client_name') {
      conv.data.newClientName = text;
      conv.step = 'new_client_email';
      this.pendingConversations[id] = conv;
      return { type: 'text', content: '📧 *Email du client* (ou "passer") :' };
    }

    // Etape : nouveau client — email
    if (conv.step === 'new_client_email') {
      const email = text.toLowerCase().trim();
      conv.data.newClientEmail = (email === 'passer' || email === '-') ? '' : email;
      conv.step = 'new_client_company';
      this.pendingConversations[id] = conv;
      return { type: 'text', content: '🏢 *Nom de l\'entreprise* (ou "passer") :' };
    }

    // Etape : nouveau client — entreprise
    if (conv.step === 'new_client_company') {
      const company = text.trim();
      const companyVal = (company.toLowerCase() === 'passer' || company === '-') ? '' : company;

      // Creer le client
      const newClient = storage.addClient(chatId, {
        name: conv.data.newClientName,
        email: conv.data.newClientEmail,
        company: companyVal
      });
      conv.data.clientId = newClient.id;
      conv.step = 'add_items';
      delete conv.data.newClientName;
      delete conv.data.newClientEmail;
      this.pendingConversations[id] = conv;

      return { type: 'text', content: '✅ Client *' + (companyVal || newClient.name) + '* cree !\n\n📋 *Ajoute les lignes* de la facture.\n\nFormat : _Description | Quantite | Prix unitaire_\nExemple : _Developpement site web | 1 | 2500_\n\nEnvoie une ligne par message.\nDis *"fini"* quand tu as termine.' };
    }

    // Etape : ajouter des lignes
    if (conv.step === 'add_items') {
      const textLower = text.toLowerCase().trim();

      if (textLower === 'fini' || textLower === 'fin' || textLower === 'done' || textLower === 'ok') {
        if (conv.data.items.length === 0) {
          return { type: 'text', content: '❌ Il faut au moins une ligne. Ajoute une ligne ou dis _"annule"_.' };
        }
        // Afficher recapitulatif
        return this._showInvoiceRecap(chatId, conv);
      }

      // Parser la ligne
      const item = this._parseItem(text);
      if (!item) {
        return { type: 'text', content: '❌ Format invalide.\n_Description | Quantite | Prix unitaire_\nExemple : _Consulting | 5 | 150_' };
      }

      conv.data.items.push(item);
      this.pendingConversations[id] = conv;
      const lineTotal = (item.qty * item.unitPrice).toFixed(2);
      return { type: 'text', content: '✅ *' + item.desc + '* — ' + item.qty + ' x ' + item.unitPrice.toFixed(2) + '€ = ' + lineTotal + '€\n\n📋 ' + conv.data.items.length + ' ligne(s). Continue ou dis *"fini"*.' };
    }

    // Etape : notes/echeance
    if (conv.step === 'notes') {
      const textLower = text.toLowerCase().trim();
      conv.data.notes = (textLower === 'passer' || textLower === '-') ? '' : text;

      // Creer la facture
      return this._finalizeInvoice(chatId, conv, sendReply);
    }

    delete this.pendingConversations[id];
    return null;
  }

  _showInvoiceRecap(chatId, conv) {
    const user = storage.getUser(chatId);
    const taxRate = user.prefs.taxRate;
    const items = conv.data.items;
    const subtotal = items.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0);
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    const client = storage.getClient(conv.data.clientId);
    const clientName = client ? (client.company || client.name) : 'Client';

    const itemLines = items.map((item, i) => '  ' + (i + 1) + '. ' + item.desc + ' — ' + item.qty + ' x ' + item.unitPrice.toFixed(2) + '€ = ' + (item.qty * item.unitPrice).toFixed(2) + '€').join('\n');

    conv.step = 'notes';
    this.pendingConversations[String(chatId)] = conv;

    return { type: 'text', content: [
      '🧾 *RECAPITULATIF*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '👤 Client : *' + clientName + '*',
      '',
      '📋 Lignes :',
      itemLines,
      '',
      '💰 Sous-total HT : ' + subtotal.toFixed(2) + '€',
      '📊 TVA (' + Math.round(taxRate * 100) + '%) : ' + taxAmount.toFixed(2) + '€',
      '*💵 Total TTC : ' + total.toFixed(2) + '€*',
      '',
      '📝 Ajoute une *note* pour le client (ou "passer") :'
    ].join('\n') };
  }

  _finalizeInvoice(chatId, conv, sendReply) {
    const user = storage.getUser(chatId);

    const invoice = storage.createInvoice(chatId, {
      clientId: conv.data.clientId,
      items: conv.data.items,
      taxRate: user.prefs.taxRate,
      currency: user.prefs.currency,
      notes: conv.data.notes || ''
    });

    delete this.pendingConversations[String(chatId)];
    storage.logActivity(chatId, 'create_invoice', { number: invoice.number, total: invoice.total });

    const client = storage.getClient(conv.data.clientId);
    const hasEmail = client && client.email;

    return { type: 'text', content: [
      '✅ *FACTURE CREEE*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '🧾 Numero : *' + invoice.number + '*',
      '💵 Total : *' + invoice.total.toFixed(2) + '€*',
      '📅 Echeance : ' + new Date(invoice.dueDate).toLocaleDateString('fr-FR'),
      '📝 Statut : Brouillon',
      '',
      hasEmail ? '👉 _"envoie la facture ' + invoice.number + '"_ pour l\'envoyer par email a ' + client.email : '👉 Ajoute un email au client pour pouvoir envoyer la facture.',
      '👉 _"mes factures"_ pour voir toutes tes factures'
    ].join('\n') };
  }

  _parseItem(text) {
    // Format : Description | Qte | Prix
    const parts = text.split('|').map(p => p.trim());
    if (parts.length >= 3) {
      const desc = parts[0];
      const qty = parseFloat(parts[1]);
      const price = parseFloat(parts[2].replace(/[€$]/g, '').replace(',', '.'));
      if (desc && !isNaN(qty) && qty > 0 && !isNaN(price) && price > 0) {
        return { desc: desc, qty: qty, unitPrice: price };
      }
    }
    // Format alternatif : Description, Qte, Prix
    const parts2 = text.split(',').map(p => p.trim());
    if (parts2.length >= 3) {
      const desc = parts2[0];
      const qty = parseFloat(parts2[1]);
      const price = parseFloat(parts2[2].replace(/[€$]/g, '').replace(',', '.'));
      if (desc && !isNaN(qty) && qty > 0 && !isNaN(price) && price > 0) {
        return { desc: desc, qty: qty, unitPrice: price };
      }
    }
    return null;
  }

  // ============================================================
  // LISTER FACTURES
  // ============================================================

  _handleListInvoices(chatId, params) {
    const status = params.status || 'all';
    const filter = status === 'all' ? null : status;
    const invoices = storage.getInvoices(chatId, filter);

    if (invoices.length === 0) {
      return { type: 'text', content: '📭 Aucune facture' + (filter ? ' ' + filter : '') + '.\n👉 _"cree une facture"_ pour commencer !' };
    }

    const statusEmojis = { draft: '📝', sent: '📧', paid: '✅', overdue: '🔴' };
    const statusLabels = { draft: 'Brouillon', sent: 'Envoyee', paid: 'Payee', overdue: 'Impayee' };

    const lines = ['🧾 *MES FACTURES*', '━━━━━━━━━━━━━━━━━━', ''];

    invoices.forEach(inv => {
      const client = inv.clientId ? storage.getClient(inv.clientId) : null;
      const clientName = client ? (client.company || client.name) : '?';
      const emoji = statusEmojis[inv.status] || '📝';
      lines.push(emoji + ' *' + inv.number + '* — ' + inv.total.toFixed(2) + '€ — ' + clientName);
      lines.push('   ' + (statusLabels[inv.status] || inv.status) + ' | ' + new Date(inv.createdAt).toLocaleDateString('fr-FR'));
      lines.push('');
    });

    return { type: 'text', content: lines.join('\n') };
  }

  // ============================================================
  // VOIR FACTURE
  // ============================================================

  _handleViewInvoice(chatId, params) {
    if (!params.number) {
      const invoices = storage.getInvoices(chatId);
      if (invoices.length === 0) {
        return { type: 'text', content: '📭 Aucune facture.' };
      }
      // Montrer la derniere
      const last = invoices[0];
      const client = last.clientId ? storage.getClient(last.clientId) : null;
      return { type: 'text', content: invoiceGen.generateSummary(last, client) };
    }

    const number = params.number.toUpperCase().replace(/\s/g, '');
    const invoice = storage.getInvoiceByNumber(chatId, number);
    if (!invoice) {
      return { type: 'text', content: '❌ Facture ' + number + ' introuvable.' };
    }

    const client = invoice.clientId ? storage.getClient(invoice.clientId) : null;
    return { type: 'text', content: invoiceGen.generateSummary(invoice, client) };
  }

  // ============================================================
  // ENVOYER FACTURE PAR EMAIL
  // ============================================================

  async _handleSendInvoice(chatId, params, sendReply) {
    if (!this.resendKey) {
      return { type: 'text', content: '❌ L\'envoi d\'email n\'est pas configure (cle Resend manquante).' };
    }

    let invoice = null;

    if (params.number) {
      invoice = storage.getInvoiceByNumber(chatId, params.number.toUpperCase().replace(/\s/g, ''));
    } else {
      // Demander quel numero
      const invoices = storage.getInvoices(chatId).filter(i => i.status === 'draft' || i.status === 'sent');
      if (invoices.length === 0) {
        return { type: 'text', content: '📭 Aucune facture a envoyer.' };
      }
      if (invoices.length === 1) {
        invoice = invoices[0];
      } else {
        this.pendingConversations[String(chatId)] = {
          action: 'send_invoice',
          step: 'select_invoice',
          data: {}
        };
        const list = invoices.map(i => {
          const c = i.clientId ? storage.getClient(i.clientId) : null;
          return '  *' + i.number + '* — ' + i.total.toFixed(2) + '€ — ' + (c ? (c.company || c.name) : '?');
        }).join('\n');
        return { type: 'text', content: '📧 Quelle facture envoyer ?\n\n' + list + '\n\n_Reponds avec le numero (ex: FAC-001)_' };
      }
    }

    if (!invoice) {
      return { type: 'text', content: '❌ Facture introuvable.' };
    }

    const client = invoice.clientId ? storage.getClient(invoice.clientId) : null;
    if (!client || !client.email) {
      return { type: 'text', content: '❌ Le client n\'a pas d\'email. Ajoute-en un d\'abord.' };
    }

    // Envoyer
    if (sendReply) await sendReply({ type: 'text', content: '📧 _Envoi de la facture ' + invoice.number + ' a ' + client.email + '..._' });

    const html = invoiceGen.generateHTML(invoice, chatId);
    const subject = invoiceGen.generateEmailSubject(invoice);

    const resendBreaker = getBreaker('resend', { failureThreshold: 3, cooldownMs: 60000 });
    const result = await resendBreaker.call(() => retryAsync(() => this._sendResendEmail(client.email, subject, html), 2, 2000));

    if (result.success) {
      storage.markInvoiceSent(invoice.id);
      storage.logActivity(chatId, 'send_invoice', { number: invoice.number, email: client.email });

      return { type: 'text', content: '✅ *Facture ' + invoice.number + ' envoyee !*\n\n📧 Destinataire : ' + client.email + '\n💵 Montant : ' + invoice.total.toFixed(2) + '€\n\n👉 _"' + invoice.number + ' payee"_ quand tu recois le paiement' };
    }

    return { type: 'text', content: '❌ Erreur envoi : ' + (result.error || 'inconnue') };
  }

  async _sendInvoiceConversation(chatId, text, conv, sendReply) {
    if (conv.step === 'select_invoice') {
      const num = text.toUpperCase().replace(/\s/g, '');
      delete this.pendingConversations[String(chatId)];
      return await this._handleSendInvoice(chatId, { number: num }, sendReply);
    }
    delete this.pendingConversations[String(chatId)];
    return null;
  }

  // ============================================================
  // MARQUER PAYEE / IMPAYEE
  // ============================================================

  _handleMarkPaid(chatId, params) {
    if (!params.number) {
      this.pendingConversations[String(chatId)] = {
        action: 'mark_paid',
        step: 'select_invoice',
        data: {}
      };
      const invoices = storage.getInvoices(chatId).filter(i => i.status !== 'paid');
      if (invoices.length === 0) {
        delete this.pendingConversations[String(chatId)];
        return { type: 'text', content: '✅ Toutes tes factures sont deja payees !' };
      }
      const list = invoices.map(i => '  *' + i.number + '* — ' + i.total.toFixed(2) + '€').join('\n');
      return { type: 'text', content: '✅ Quelle facture marquer comme payee ?\n\n' + list + '\n\n_Reponds avec le numero_' };
    }

    const number = params.number.toUpperCase().replace(/\s/g, '');
    const invoice = storage.getInvoiceByNumber(chatId, number);
    if (!invoice) {
      return { type: 'text', content: '❌ Facture ' + number + ' introuvable.' };
    }

    storage.markInvoicePaid(invoice.id);
    storage.logActivity(chatId, 'mark_paid', { number: invoice.number });

    return { type: 'text', content: '✅ *' + invoice.number + '* marquee comme *payee* !\n💵 ' + invoice.total.toFixed(2) + '€ encaisses.' };
  }

  _markPaidConversation(chatId, text, conv) {
    if (conv.step === 'select_invoice') {
      const num = text.toUpperCase().replace(/\s/g, '');
      delete this.pendingConversations[String(chatId)];
      return this._handleMarkPaid(chatId, { number: num });
    }
    delete this.pendingConversations[String(chatId)];
    return null;
  }

  _handleMarkOverdue(chatId, params) {
    if (!params.number) {
      return { type: 'text', content: '❌ Indique le numero de facture.\nExemple : _"FAC-001 impayee"_' };
    }
    const number = params.number.toUpperCase().replace(/\s/g, '');
    const invoice = storage.getInvoiceByNumber(chatId, number);
    if (!invoice) {
      return { type: 'text', content: '❌ Facture ' + number + ' introuvable.' };
    }
    storage.markInvoiceOverdue(invoice.id);
    storage.logActivity(chatId, 'mark_overdue', { number: invoice.number });
    return { type: 'text', content: '🔴 *' + invoice.number + '* marquee comme *impayee*.' };
  }

  // ============================================================
  // GESTION CLIENTS
  // ============================================================

  _handleAddClient(chatId, params, sendReply) {
    // Si des params sont fournis directement
    if (params.name) {
      const client = storage.addClient(chatId, {
        name: params.name,
        email: params.email || '',
        company: params.company || ''
      });
      storage.logActivity(chatId, 'add_client', { name: client.name });
      return { type: 'text', content: '✅ Client *' + (client.company || client.name) + '* ajoute !' };
    }

    // Workflow multi-etapes
    this.pendingConversations[String(chatId)] = {
      action: 'add_client',
      step: 'name',
      data: {}
    };
    return { type: 'text', content: '👤 *NOUVEAU CLIENT*\n\n*Nom du client* :' };
  }

  _addClientConversation(chatId, text, conv) {
    const id = String(chatId);

    if (conv.step === 'name') {
      conv.data.name = text;
      conv.step = 'email';
      this.pendingConversations[id] = conv;
      return { type: 'text', content: '📧 *Email* (ou "passer") :' };
    }
    if (conv.step === 'email') {
      const email = text.toLowerCase().trim();
      conv.data.email = (email === 'passer' || email === '-') ? '' : email;
      conv.step = 'company';
      this.pendingConversations[id] = conv;
      return { type: 'text', content: '🏢 *Entreprise* (ou "passer") :' };
    }
    if (conv.step === 'company') {
      const company = text.trim();
      conv.data.company = (company.toLowerCase() === 'passer' || company === '-') ? '' : company;

      const client = storage.addClient(chatId, conv.data);
      storage.logActivity(chatId, 'add_client', { name: client.name });

      delete this.pendingConversations[id];
      return { type: 'text', content: '✅ Client *' + (client.company || client.name) + '* ajoute !\n📧 ' + (client.email || 'pas d\'email') };
    }

    delete this.pendingConversations[id];
    return null;
  }

  _handleListClients(chatId) {
    const clients = storage.getClients(chatId);
    if (clients.length === 0) {
      return { type: 'text', content: '📭 Aucun client.\n👉 _"nouveau client"_ pour en ajouter un !' };
    }

    const lines = ['👥 *MES CLIENTS*', '━━━━━━━━━━━━━━━━━━', ''];
    clients.forEach((c, i) => {
      lines.push('*' + (i + 1) + '. ' + (c.company || c.name) + '*');
      if (c.name && c.company) lines.push('   👤 ' + c.name);
      if (c.email) lines.push('   📧 ' + c.email);
      lines.push('   🧾 ' + c.invoiceCount + ' facture(s) — ' + c.totalBilled.toFixed(2) + '€');
      lines.push('');
    });

    return { type: 'text', content: lines.join('\n') };
  }

  // ============================================================
  // INFOS ENTREPRISE / RIB
  // ============================================================

  _handleEditBusiness(chatId, params, sendReply) {
    const user = storage.getUser(chatId);
    const biz = user.businessInfo;

    // Si un champ specifique est fourni
    if (params.field && params.value) {
      const field = params.field.toLowerCase();
      const validFields = ['company', 'address', 'email', 'phone', 'siret', 'rib'];
      if (validFields.includes(field)) {
        const update = {};
        update[field] = params.value;
        storage.updateBusinessInfo(chatId, update);
        const labels = { company: 'Entreprise', address: 'Adresse', email: 'Email', phone: 'Telephone', siret: 'SIRET', rib: 'RIB' };
        return { type: 'text', content: '✅ *' + labels[field] + '* mis a jour !' };
      }
    }

    // Afficher les infos actuelles et proposer de modifier
    const lines = [
      '🏢 *MES INFOS ENTREPRISE*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '🏢 Entreprise : ' + (biz.company || '_non defini_'),
      '📍 Adresse : ' + (biz.address || '_non defini_'),
      '📧 Email : ' + (biz.email || '_non defini_'),
      '📞 Telephone : ' + (biz.phone || '_non defini_'),
      '🔢 SIRET : ' + (biz.siret || '_non defini_'),
      '🏦 RIB : ' + (biz.rib || '_non defini_'),
      '',
      '━━━━━━━━━━━━━━━━━━',
      'Que veux-tu modifier ? Reponds avec le *champ* :'
    ];

    this.pendingConversations[String(chatId)] = {
      action: 'edit_business',
      step: 'select_field',
      data: {}
    };

    return { type: 'text', content: lines.join('\n') };
  }

  _editBusinessConversation(chatId, text, conv) {
    const id = String(chatId);

    if (conv.step === 'select_field') {
      const textLower = text.toLowerCase().trim();
      const fieldMap = {
        'entreprise': 'company', 'company': 'company', 'societe': 'company', 'société': 'company', 'nom': 'company',
        'adresse': 'address', 'address': 'address',
        'email': 'email', 'mail': 'email',
        'telephone': 'phone', 'téléphone': 'phone', 'tel': 'phone', 'phone': 'phone',
        'siret': 'siret',
        'rib': 'rib', 'iban': 'rib', 'banque': 'rib'
      };
      const field = fieldMap[textLower];
      if (!field) {
        return { type: 'text', content: '❌ Champ non reconnu. Choisis : _entreprise, adresse, email, telephone, siret, rib_' };
      }
      conv.data.field = field;
      conv.step = 'enter_value';
      this.pendingConversations[id] = conv;

      const labels = { company: 'Entreprise', address: 'Adresse', email: 'Email', phone: 'Telephone', siret: 'SIRET', rib: 'RIB/IBAN' };
      return { type: 'text', content: '📝 Nouvelle valeur pour *' + labels[field] + '* :' };
    }

    if (conv.step === 'enter_value') {
      const update = {};
      update[conv.data.field] = text;
      storage.updateBusinessInfo(chatId, update);

      delete this.pendingConversations[id];
      storage.logActivity(chatId, 'edit_business', { field: conv.data.field });
      return { type: 'text', content: '✅ Mis a jour !' };
    }

    delete this.pendingConversations[id];
    return null;
  }

  // ============================================================
  // STATS
  // ============================================================

  _handleStats(chatId) {
    const stats = storage.getUserStats(chatId);

    if (stats.totalInvoices === 0) {
      return { type: 'text', content: '📊 Aucune facture pour l\'instant.\n👉 _"cree une facture"_ pour commencer !' };
    }

    return { type: 'text', content: [
      '📊 *STATISTIQUES FACTURATION*',
      '━━━━━━━━━━━━━━━━━━',
      '',
      '🧾 Total factures : ' + stats.totalInvoices,
      '💰 Montant facture : ' + stats.totalBilled.toFixed(2) + '€',
      '',
      '✅ Payees : ' + stats.countPaid + ' (' + stats.totalPaid.toFixed(2) + '€)',
      '⏳ En attente : ' + stats.countPending + ' (' + stats.totalPending.toFixed(2) + '€)',
      '🔴 Impayees : ' + stats.countOverdue + ' (' + stats.totalOverdue.toFixed(2) + '€)',
      '',
      '━━━━━━━━━━━━━━━━━━',
      '🧾 Invoice Bot'
    ].join('\n') };
  }

  // ============================================================
  // CONFIRMATIONS
  // ============================================================

  async _executeConfirmation(chatId, sendReply) {
    const pending = this.pendingConfirmations[String(chatId)];
    if (!pending) return { type: 'text', content: 'Rien en attente.' };
    delete this.pendingConfirmations[String(chatId)];
    // Pour l'instant pas de confirmations differees
    return { type: 'text', content: '✅ Fait.' };
  }

  // ============================================================
  // EMAIL VIA RESEND
  // ============================================================

  _sendResendEmail(to, subject, html) {
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        from: 'ifind <' + this.senderEmail + '>',
        to: [to],
        subject: subject,
        html: html
      });

      const req = https.request({
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.resendKey,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (res.statusCode === 200 || res.statusCode === 201) {
              resolve({ success: true, id: data.id });
            } else {
              resolve({ success: false, error: data.message || 'Erreur ' + res.statusCode });
            }
          } catch (e) {
            resolve({ success: false, error: 'Reponse invalide' });
          }
        });
      });
      req.on('error', (e) => resolve({ success: false, error: e.message }));
      req.setTimeout(15000, () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
      req.write(postData);
      req.end();
    });
  }

  // ============================================================
  // AIDE
  // ============================================================

  getHelp() {
    return [
      '🧾 *INVOICE BOT*',
      '',
      '📝 *Factures :*',
      '  _"cree une facture"_ — nouvelle facture',
      '  _"mes factures"_ — voir toutes',
      '  _"FAC-001"_ — detail d\'une facture',
      '  _"envoie la facture FAC-001"_ — par email',
      '',
      '💰 *Paiements :*',
      '  _"FAC-001 payee"_ — marquer payee',
      '  _"factures impayees"_ — voir les retards',
      '',
      '👥 *Clients :*',
      '  _"nouveau client"_ — ajouter',
      '  _"mes clients"_ — voir la liste',
      '',
      '🏢 *Mon entreprise :*',
      '  _"mes infos"_ — voir/modifier',
      '  _"modifier rib"_ — coordonnees bancaires',
      '',
      '📊 _"stats facturation"_ — statistiques',
      '',
      '━━━━━━━━━━━━━━━━━━',
      '🧾 Invoice Bot'
    ].join('\n');
  }
}

module.exports = InvoiceBotHandler;
