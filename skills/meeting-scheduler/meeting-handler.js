// Meeting Scheduler - Handler Telegram
const log = require('../../gateway/logger.js');
const storage = require('./storage.js');
const CalComClient = require('./calendar-client.js');
const { callOpenAI } = require('../../gateway/shared-nlp.js');

class MeetingHandler {
  constructor(openaiKey, calcomApiKey) {
    this.openaiKey = openaiKey;
    this.calcom = new CalComClient(calcomApiKey);
    this.pendingConversations = {};
    this.pendingConfirmations = {};
  }

  start() {
    log.info('meeting-handler', 'Handler meeting-scheduler demarre');
    // Sync event types au demarrage si configure
    if (this.calcom.isConfigured()) {
      this._syncEventTypes().catch(e =>
        log.warn('meeting-handler', 'Sync event types echoue:', e.message)
      );
    }
  }

  stop() {
    log.info('meeting-handler', 'Handler meeting-scheduler arrete');
  }

  async handleMessage(text, chatId, sendReply) {
    const id = String(chatId);
    const textLower = text.toLowerCase().trim();

    // Conversation en cours (proposition de RDV)
    if (this.pendingConversations[id]) {
      return this._handlePendingConversation(text, chatId, sendReply);
    }

    if (this.pendingConfirmations[id]) {
      return this._handleConfirmation(text, chatId, sendReply);
    }

    // Classification intention
    const intent = await this._classifyIntent(text);

    switch (intent) {
      case 'propose':
        return this._handlePropose(text, chatId, sendReply);
      case 'status':
        return this._handleStatus(chatId);
      case 'upcoming':
        return this._handleUpcoming(chatId);
      case 'history':
        return this._handleHistory(chatId);
      case 'configure':
        return this._handleConfigure(text, chatId);
      case 'link':
        return this._handleGetLink(text, chatId);
      default:
        return this._handleHelp(chatId);
    }
  }

  async _classifyIntent(text) {
    const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    if (/\b(propose|planifi|rdv|rendez|book|reserve|cale|caler)\b/i.test(t)) return 'propose';
    if (/\b(statut|status|etat)\b/i.test(t)) return 'status';
    if (/\b(prochain|a venir|upcoming|agenda)\b/i.test(t)) return 'upcoming';
    if (/\b(historique|passe|recent|dernier)\b/i.test(t)) return 'history';
    if (/\b(configur|parametr|calcom|cal\.com|cle.*api|api.*key)\b/i.test(t)) return 'configure';
    if (/\b(lien|link|url)\b/i.test(t)) return 'link';
    if (/\b(aide|help)\b/i.test(t)) return 'help';

    return 'status';
  }

  async _handlePropose(text, chatId, sendReply) {
    const id = String(chatId);

    if (!this.calcom.isConfigured()) {
      return {
        type: 'text',
        content: '⚠️ Cal.com n\'est pas configure.\nAjoute `CALCOM_API_KEY` dans ton `.env` pour activer la prise de RDV.'
      };
    }

    // Extraire l'email du lead du message
    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);

    if (emailMatch) {
      // Email trouve directement dans le message
      return this._proposeToLead(emailMatch[1], text, chatId);
    }

    // Pas d'email → demander
    this.pendingConversations[id] = { step: 'ask_email', originalText: text };
    return {
      type: 'text',
      content: '📅 A qui veux-tu proposer un RDV ? Donne-moi l\'email du lead.'
    };
  }

  async _handlePendingConversation(text, chatId, sendReply) {
    const id = String(chatId);
    const state = this.pendingConversations[id];

    if (state.step === 'ask_email') {
      const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailMatch) {
        delete this.pendingConversations[id];
        return this._proposeToLead(emailMatch[1], state.originalText, chatId);
      }
      return { type: 'text', content: 'Hmm, je n\'ai pas detecte d\'email valide. Reessaie avec une adresse email.' };
    }

    delete this.pendingConversations[id];
    return { type: 'text', content: 'OK, on reprend.' };
  }

  async _proposeToLead(email, text, chatId) {
    try {
      // Recuperer les event types
      let eventTypes = storage.getEventTypes();
      if (eventTypes.length === 0) {
        eventTypes = await this._syncEventTypes();
      }

      if (eventTypes.length === 0) {
        return {
          type: 'text',
          content: '⚠️ Aucun type de RDV configure dans Cal.com. Cree d\'abord un event type sur cal.com.'
        };
      }

      // Utiliser le premier event type (ou celui configure par defaut)
      const config = storage.getConfig();
      const eventType = config.defaultEventTypeId
        ? eventTypes.find(et => et.id === config.defaultEventTypeId) || eventTypes[0]
        : eventTypes[0];

      // Extraire le nom du lead si possible
      const nameMatch = text.match(/(?:avec|pour|a)\s+([A-Z][a-záàâäéèêëïîôùûüç]+(?:\s+[A-Z][a-záàâäéèêëïîôùûüç]+)*)/);
      const leadName = nameMatch ? nameMatch[1] : '';

      // Generer le lien de booking
      const bookingUrl = await this.calcom.getBookingLink(eventType.slug, email, leadName);

      if (!bookingUrl) {
        return {
          type: 'text',
          content: '❌ Impossible de generer le lien de reservation. Verifie ta configuration Cal.com.'
        };
      }

      // Enregistrer le meeting propose
      const meeting = storage.createMeeting({
        leadEmail: email,
        leadName: leadName,
        bookingUrl: bookingUrl,
        duration: eventType.length || 30
      });

      const lines = [
        '📅 *RDV propose !*',
        '',
        '👤 *Lead :* ' + (leadName || email),
        '📧 ' + email,
        '⏱ *Duree :* ' + (eventType.length || 30) + ' min',
        '📋 *Type :* ' + eventType.title,
        '',
        '🔗 *Lien de reservation :*',
        bookingUrl,
        '',
        '_Envoie ce lien au lead par email ou message._',
        '_Tu veux que je l\'integre dans un email ? Dis "envoie le lien a ' + email + '"_'
      ];

      return { type: 'text', content: lines.join('\n') };
    } catch (e) {
      log.error('meeting-handler', 'Erreur proposeToLead:', e.message);
      return { type: 'text', content: '❌ Erreur : ' + e.message };
    }
  }

  _handleStatus(chatId) {
    const config = storage.getConfig();
    const stats = storage.getStats();
    const isConfigured = this.calcom.isConfigured();

    const lines = [
      '📅 *Meeting Scheduler*',
      '',
      '*Cal.com :* ' + (isConfigured ? '🟢 Configure' : '🔴 Non configure'),
      '*Auto-proposition :* ' + (config.autoPropose ? '🟢 Active' : '🔴 Desactive'),
      '',
      '*RDV proposes :* ' + (stats.totalProposed || 0),
      '*RDV confirmes :* ' + (stats.totalBooked || 0),
      '*RDV annules :* ' + (stats.totalCancelled || 0),
      '*A venir :* ' + (stats.upcoming || 0)
    ];

    if (!isConfigured) {
      lines.push('');
      lines.push('_Ajoute CALCOM\\_API\\_KEY dans .env pour activer._');
    }

    return { type: 'text', content: lines.join('\n') };
  }

  async _handleUpcoming(chatId) {
    const upcoming = storage.getUpcomingMeetings();

    if (upcoming.length === 0) {
      return { type: 'text', content: '📅 Aucun RDV a venir.' };
    }

    const lines = ['📅 *RDV a venir :*', ''];

    for (const m of upcoming) {
      const date = new Date(m.scheduledAt).toLocaleDateString('fr-FR', {
        weekday: 'long', day: '2-digit', month: 'long',
        hour: '2-digit', minute: '2-digit'
      });
      lines.push('• *' + (m.leadName || m.leadEmail) + '* — ' + date);
      if (m.company) lines.push('  🏢 ' + m.company);
      lines.push('  ⏱ ' + m.duration + ' min');
      lines.push('');
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _handleHistory(chatId) {
    const meetings = storage.getRecentMeetings(10);

    if (meetings.length === 0) {
      return { type: 'text', content: '📅 Aucun historique de RDV.' };
    }

    const STATUS_ICONS = {
      proposed: '📤',
      booked: '✅',
      completed: '🏁',
      cancelled: '❌',
      no_show: '👻'
    };

    const lines = ['📅 *Historique des RDV :*', ''];

    for (const m of meetings) {
      const icon = STATUS_ICONS[m.status] || '📅';
      const date = new Date(m.proposedAt).toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit'
      });
      lines.push(icon + ' *' + (m.leadName || m.leadEmail) + '* — ' + m.status + ' (' + date + ')');
    }

    return { type: 'text', content: lines.join('\n') };
  }

  _handleConfigure(text, chatId) {
    const config = storage.getConfig();
    const lines = [
      '⚙️ *Configuration Meeting Scheduler*',
      '',
      'Pour configurer Cal.com, ajoute cette variable dans ton `.env` :',
      '',
      '```',
      'CALCOM_API_KEY=cal_live_xxxxxxxxxxxxxxxx',
      '```',
      '',
      'Puis redemarre le bot.',
      '',
      '*Comment obtenir la cle API :*',
      '1. Va sur cal.com/settings/developer/api-keys',
      '2. Cree une nouvelle cle API',
      '3. Copie-la dans ton .env',
      '',
      '*Status actuel :* ' + (this.calcom.isConfigured() ? '🟢 Configure' : '🔴 Non configure'),
      '*Auto-proposition (lead hot) :* ' + (config.autoPropose ? 'Oui' : 'Non')
    ];

    return { type: 'text', content: lines.join('\n') };
  }

  async _handleGetLink(text, chatId) {
    if (!this.calcom.isConfigured()) {
      return { type: 'text', content: '⚠️ Cal.com non configure. Ajoute `CALCOM_API_KEY` dans .env.' };
    }

    let eventTypes = storage.getEventTypes();
    if (eventTypes.length === 0) {
      eventTypes = await this._syncEventTypes();
    }

    if (eventTypes.length === 0) {
      return { type: 'text', content: '⚠️ Aucun event type Cal.com trouve.' };
    }

    const et = eventTypes[0];
    const link = await this.calcom.getBookingLink(et.slug);

    if (link) {
      return {
        type: 'text',
        content: '🔗 *Lien de reservation :*\n\n' + link + '\n\n_Type: ' + et.title + ' (' + et.length + ' min)_'
      };
    }

    return { type: 'text', content: '❌ Impossible de generer le lien.' };
  }

  _handleConfirmation(text, chatId) {
    const id = String(chatId);
    delete this.pendingConfirmations[id];
    return { type: 'text', content: 'OK !' };
  }

  _handleHelp(chatId) {
    const lines = [
      '📅 *Meeting Scheduler — Aide*',
      '',
      'Je t\'aide a proposer des RDV aux prospects chauds.',
      '',
      '*Commandes :*',
      '• _"propose un rdv a john@example.com"_ — Generer un lien de booking',
      '• _"statut meetings"_ — Voir le statut',
      '• _"rdv a venir"_ — Voir les prochains RDV',
      '• _"historique rdv"_ — Voir l\'historique',
      '• _"lien de reservation"_ — Obtenir ton lien Cal.com',
      '• _"configurer cal.com"_ — Instructions de config',
      '',
      '_Integre avec Cal.com pour la gestion automatisee des creneaux._'
    ];

    return { type: 'text', content: lines.join('\n') };
  }

  // Appele depuis le routeur/proactive quand un lead est hot
  async proposeAutoMeeting(leadEmail, leadName, company) {
    if (!this.calcom.isConfigured()) return null;
    const config = storage.getConfig();
    if (!config.autoPropose) return null;

    // Verifier si un meeting existe deja pour ce lead
    const existing = storage.getMeetingByEmail(leadEmail);
    if (existing.length > 0 && existing[0].status !== 'cancelled') {
      return null; // Deja un meeting en cours
    }

    let eventTypes = storage.getEventTypes();
    if (eventTypes.length === 0) {
      eventTypes = await this._syncEventTypes();
    }
    if (eventTypes.length === 0) return null;

    const et = eventTypes[0];
    const bookingUrl = await this.calcom.getBookingLink(et.slug, leadEmail, leadName);
    if (!bookingUrl) return null;

    const meeting = storage.createMeeting({
      leadEmail,
      leadName: leadName || '',
      company: company || '',
      bookingUrl,
      duration: et.length || 30
    });

    return meeting;
  }

  async _syncEventTypes() {
    try {
      const types = await this.calcom.getEventTypes();
      if (types.length > 0) {
        storage.setEventTypes(types);
        log.info('meeting-handler', types.length + ' event types Cal.com synchronises');
      }
      return types;
    } catch (e) {
      log.error('meeting-handler', 'Erreur sync event types:', e.message);
      return [];
    }
  }
}

module.exports = MeetingHandler;
