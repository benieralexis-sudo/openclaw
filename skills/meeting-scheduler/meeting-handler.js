// Meeting Scheduler - Handler Telegram
const log = require('../../gateway/logger.js');
const storage = require('./storage.js');
const CalComClient = require('./calendar-client.js');
const { callOpenAI } = require('../../gateway/shared-nlp.js');
const { escTg, classifyIntent } = require('./utils.js');

class MeetingHandler {
  constructor(openaiKey, calcomApiKey) {
    this.openaiKey = openaiKey;
    this.calcom = new CalComClient(calcomApiKey);
    this.pendingConversations = {};
    this.pendingConfirmations = {};
  }

  start() {
    log.info('meeting-handler', 'Handler meeting-scheduler demarre');
    // Boot check : verifier que l'API key Cal.eu est valide
    if (this.calcom.isConfigured()) {
      this.calcom.getProfile().then(profile => {
        if (profile && profile.username) {
          log.info('meeting-handler', 'Cal.eu connecte: ' + profile.username + ' (' + (profile.email || '?') + ')');
        } else {
          log.error('meeting-handler', 'ALERTE: CALCOM_API_KEY invalide ou profil inaccessible — meetings desactives');
        }
      }).catch(e => {
        log.error('meeting-handler', 'ALERTE: Cal.eu API inaccessible: ' + e.message);
      });
      this._syncEventTypes().catch(e =>
        log.warn('meeting-handler', 'Sync event types echoue:', e.message)
      );
    } else {
      log.warn('meeting-handler', 'CALCOM_API_KEY non configure — meetings desactives');
    }
  }

  stop() {
    log.info('meeting-handler', 'Handler meeting-scheduler arrete');
  }

  // Nettoyage conversations pendantes > 10min
  _cleanupPendingConversations() {
    const now = Date.now();
    const TTL = 10 * 60 * 1000;
    let cleaned = 0;
    for (const id of Object.keys(this.pendingConversations)) {
      if (now - (this.pendingConversations[id].createdAt || 0) > TTL) {
        delete this.pendingConversations[id];
        cleaned++;
      }
    }
    if (cleaned > 0) log.info('meeting-handler', 'Nettoyage ' + cleaned + ' conversations abandonnees');
  }

  async handleMessage(text, chatId, sendReply) {
    const id = String(chatId);
    const textLower = text.toLowerCase().trim();

    // Conversation en cours (proposition de RDV)
    if (this.pendingConversations[id]) {
      return this._handlePendingConversation(text, chatId, sendReply);
    }

    // Classification intention
    const intent = await this._classifyIntent(text);

    switch (intent) {
      case 'propose':
        return this._handlePropose(text, chatId, sendReply);
      case 'no_show':
        return this._handleNoShow(text, chatId);
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
    return classifyIntent(text);
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
    this.pendingConversations[id] = { step: 'ask_email', originalText: text, createdAt: Date.now() };
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
        '📅 *RDV propose \\!*',
        '',
        '👤 *Lead :* ' + escTg(leadName || email),
        '📧 ' + escTg(email),
        '⏱ *Duree :* ' + (eventType.length || 30) + ' min',
        '📋 *Type :* ' + escTg(eventType.title),
        '',
        '🔗 *Lien de reservation :*',
        bookingUrl,
        '',
        '_Envoie ce lien au lead par email ou message\\._',
        '_Tu veux que je l\'integre dans un email \\? Dis "envoie le lien a ' + escTg(email) + '"_'
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
      '*Cal\\.com :* ' + (isConfigured ? '🟢 Configure' : '🔴 Non configure'),
      '*Auto\\-proposition :* ' + (config.autoPropose ? '🟢 Active' : '🔴 Desactive'),
      '',
      '*RDV proposes :* ' + (stats.totalProposed || 0),
      '*RDV confirmes :* ' + (stats.totalBooked || 0),
      '*RDV completes :* ' + (stats.totalCompleted || 0),
      '*RDV expires :* ' + (stats.totalExpired || 0),
      '*RDV annules :* ' + (stats.totalCancelled || 0),
      '*No\\-show :* ' + (stats.totalNoShow || 0),
      '*A venir :* ' + (stats.upcoming || 0),
      '*Taux conversion :* ' + (stats.conversionRate || 0) + '%'
    ];

    if (!isConfigured) {
      lines.push('');
      lines.push('_Ajoute CALCOM\\_API\\_KEY dans \\.env pour activer\\._');
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
      lines.push('• *' + escTg(m.leadName || m.leadEmail) + '* — ' + escTg(date));
      if (m.company) lines.push('  🏢 ' + escTg(m.company));
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
      lines.push(icon + ' *' + escTg(m.leadName || m.leadEmail) + '* — ' + m.status + ' \\(' + date + '\\)');
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
        content: '🔗 *Lien de reservation :*\n\n' + link + '\n\n_Type: ' + escTg(et.title) + ' \\(' + et.length + ' min\\)_'
      };
    }

    return { type: 'text', content: '❌ Impossible de generer le lien.' };
  }

  _handleNoShow(text, chatId) {
    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    let meeting = null;

    if (emailMatch) {
      const meetings = storage.getMeetingByEmail(emailMatch[1]);
      meeting = meetings.find(m => m.status === 'completed' || m.status === 'booked');
    } else {
      const recent = storage.getRecentMeetings(20);
      meeting = recent.find(m => m.status === 'completed' || m.status === 'booked');
    }

    if (!meeting) {
      return { type: 'text', content: '⚠️ Aucun meeting recent a marquer comme no\\-show\\. Precise l\'email du lead\\.' };
    }

    storage.updateMeetingStatus(meeting.id, 'no_show');
    log.info('meeting-handler', 'No-show marque: ' + meeting.leadEmail);

    return {
      type: 'text',
      content: '👻 *No\\-show enregistre*\n\n👤 ' + escTg(meeting.leadName || meeting.leadEmail) +
        '\n📧 ' + escTg(meeting.leadEmail)
    };
  }

  _handleHelp(chatId) {
    const lines = [
      '📅 *Meeting Scheduler — Aide*',
      '',
      'Je t\'aide a proposer des RDV aux prospects chauds\\.',
      '',
      '*Commandes :*',
      '• _"propose un rdv a john@example\\.com"_ — Generer un lien de booking',
      '• _"statut meetings"_ — Voir le statut',
      '• _"rdv a venir"_ — Voir les prochains RDV',
      '• _"historique rdv"_ — Voir l\'historique',
      '• _"no\\-show john@example\\.com"_ — Marquer un RDV comme no\\-show',
      '• _"lien de reservation"_ — Obtenir ton lien Cal\\.com',
      '• _"configurer cal\\.com"_ — Instructions de config',
      '',
      '_Integre avec Cal\\.com pour la gestion automatisee des creneaux\\._'
    ];

    return { type: 'text', content: lines.join('\n') };
  }

  // Appele depuis le routeur/proactive quand un lead est hot
  async proposeAutoMeeting(leadEmail, leadName, company) {
    if (!this.calcom.isConfigured()) {
      log.info('meeting-handler', 'proposeAutoMeeting skip: Cal.com non configure');
      return null;
    }
    const config = storage.getConfig();
    if (!config.autoPropose) {
      log.info('meeting-handler', 'proposeAutoMeeting skip: autoPropose=false');
      return null;
    }

    // Verifier si un meeting existe deja pour ce lead (ignorer cancelled/expired)
    const existing = storage.getMeetingByEmail(leadEmail);
    if (existing.length > 0 && existing[0].status !== 'cancelled' && existing[0].status !== 'expired') {
      log.info('meeting-handler', 'proposeAutoMeeting skip: meeting actif pour ' + leadEmail + ' (status=' + existing[0].status + ')');
      return null;
    }

    // Fix 7: Cooldown 6h — eviter propositions repetees si lead re-ouvre
    const COOLDOWN_MS = 6 * 60 * 60 * 1000;
    const recentInWindow = existing.filter(m =>
      m.proposedAt && (Date.now() - new Date(m.proposedAt).getTime()) < COOLDOWN_MS);
    if (recentInWindow.length > 0) {
      const agoMin = Math.round((Date.now() - new Date(recentInWindow[0].proposedAt).getTime()) / 60000);
      log.info('meeting-handler', 'proposeAutoMeeting skip: cooldown 6h actif pour ' + leadEmail + ' (il y a ' + agoMin + ' min)');
      return null;
    }

    let eventTypes = storage.getEventTypes();
    if (eventTypes.length === 0) {
      eventTypes = await this._syncEventTypes();
    }
    if (eventTypes.length === 0) {
      log.warn('meeting-handler', 'proposeAutoMeeting skip: aucun event type disponible');
      return null;
    }

    const et = eventTypes[0];
    const bookingUrl = await this.calcom.getBookingLink(et.slug, leadEmail, leadName);
    if (!bookingUrl) {
      log.warn('meeting-handler', 'proposeAutoMeeting skip: impossible de generer bookingUrl');
      return null;
    }

    const meeting = storage.createMeeting({
      leadEmail,
      leadName: leadName || '',
      company: company || '',
      bookingUrl,
      duration: et.length || 30
    });

    log.info('meeting-handler', 'proposeAutoMeeting OK: ' + leadEmail + ' → ' + meeting.id);
    return meeting;
  }

  // Transitions automatiques du cycle de vie meetings
  _transitionMeetingLifecycles() {
    const now = Date.now();
    const allMeetings = storage.getRecentMeetings(500);
    let transitions = 0;

    for (const meeting of allMeetings) {
      // booked + passe depuis > duree → completed
      if (meeting.status === 'booked' && meeting.scheduledAt) {
        const meetingEnd = new Date(meeting.scheduledAt).getTime() + (meeting.duration || 30) * 60 * 1000;
        if (meetingEnd < now) {
          storage.updateMeetingStatus(meeting.id, 'completed');
          log.info('meeting-handler', 'Meeting auto-complete: ' + (meeting.leadEmail || meeting.id));
          transitions++;
        }
      }
      // proposed > 7 jours sans booking → expired
      if (meeting.status === 'proposed' && meeting.proposedAt) {
        const proposedAge = now - new Date(meeting.proposedAt).getTime();
        if (proposedAge > 7 * 24 * 60 * 60 * 1000) {
          storage.updateMeetingStatus(meeting.id, 'expired');
          log.info('meeting-handler', 'Meeting auto-expire: ' + (meeting.leadEmail || meeting.id));
          transitions++;
        }
      }
    }
    if (transitions > 0) log.info('meeting-handler', transitions + ' transitions lifecycle appliquees');
  }

  // Sync bookings Cal.eu → met a jour le storage local, notifie, avance deals
  async syncBookings(sendTelegram, hubspotClient, adminChatId) {
    this._cleanupPendingConversations();
    this._transitionMeetingLifecycles();
    if (!this.calcom.isConfigured()) return;

    try {
      const bookings = await this.calcom.getBookings();
      if (bookings.length === 0) return;

      for (const booking of bookings) {
        const attendeeEmails = (booking.attendees || []).map(a => (a.email || '').toLowerCase());
        if (attendeeEmails.length === 0) continue;

        // Fix 8: Match direct par email (sans limite de 100 meetings)
        let meeting = null;
        for (const attendeeEmail of attendeeEmails) {
          const matches = storage.getMeetingByEmail(attendeeEmail);
          if (matches.length > 0) { meeting = matches[0]; break; }
        }
        if (!meeting) continue;
        const leadEmail = meeting.leadEmail.toLowerCase();

        {

          // Match ! Gerer selon les statuts
          if (meeting.status === 'proposed' && (booking.status === 'accepted' || booking.status === 'confirmed' || booking.status === 'pending')) {
            // Nouveau booking confirme
            storage.updateMeetingStatus(meeting.id, 'booked', {
              scheduledAt: booking.startTime,
              calcomBookingId: booking.uid || booking.id
            });

            const dateStr = new Date(booking.startTime).toLocaleDateString('fr-FR', {
              weekday: 'long', day: '2-digit', month: 'long',
              hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
            });

            const notif = [
              '✅ *RDV confirme \\!*',
              '',
              '👤 *' + escTg(meeting.leadName || meeting.leadEmail) + '*',
              '📧 ' + escTg(meeting.leadEmail),
              '📅 ' + escTg(dateStr),
              '⏱ ' + (meeting.duration || 15) + ' min'
            ];
            if (booking.meetingUrl) {
              notif.push('🔗 ' + escTg(booking.meetingUrl));
            }
            if (meeting.company) {
              notif.push('🏢 ' + escTg(meeting.company));
            }
            notif.push('');
            notif.push('_Le lead a reserve un creneau via Cal.eu_');

            if (sendTelegram && adminChatId) {
              await sendTelegram(adminChatId, notif.join('\n'), 'Markdown');
            }

            // Avancer le deal HubSpot
            if (hubspotClient) {
              try {
                const contact = await hubspotClient.findContactByEmail(leadEmail);
                if (contact && contact.id) {
                  await hubspotClient.advanceDealStage(contact.id, 'decisionmakerboughtin', 'meeting_booked');
                  const noteBody = 'RDV confirme via Cal.eu\n' +
                    'Date : ' + dateStr + '\n' +
                    'Duree : ' + (meeting.duration || 15) + ' min\n' +
                    '[Meeting Scheduler — sync automatique]';
                  const note = await hubspotClient.createNote(noteBody);
                  if (note && note.id) await hubspotClient.associateNoteToContact(note.id, contact.id);
                }
              } catch (e) {
                log.warn('meeting-handler', 'HubSpot update echoue pour ' + leadEmail + ':', e.message);
              }
            }

            log.info('meeting-handler', 'Booking sync: ' + leadEmail + ' → booked le ' + dateStr);

          } else if (meeting.status === 'booked' && (booking.status === 'cancelled' || booking.status === 'rejected')) {
            // Annulation
            storage.updateMeetingStatus(meeting.id, 'cancelled');

            if (sendTelegram && adminChatId) {
              await sendTelegram(adminChatId,
                '❌ *RDV annule*\n\n👤 ' + escTg(meeting.leadName || meeting.leadEmail) + '\n📧 ' + escTg(meeting.leadEmail) +
                '\n\n_Le lead a annule son RDV Cal\\.eu_', 'Markdown');
            }

            log.info('meeting-handler', 'Booking sync: ' + leadEmail + ' → annule');
          }
        }
      }

      // Rappels — meetings bookes dans < 1h et pas encore rappele
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      const upcomingMeetings = storage.getUpcomingMeetings();
      for (const meeting of upcomingMeetings) {
        if (meeting.reminderSent || !meeting.scheduledAt) continue;
        const meetingTime = new Date(meeting.scheduledAt).getTime();
        if (meetingTime > now && meetingTime - now < oneHour) {
          // Rappel !
          const dateStr = new Date(meeting.scheduledAt).toLocaleTimeString('fr-FR', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
          });
          if (sendTelegram && adminChatId) {
            await sendTelegram(adminChatId,
              '🔔 *Rappel — RDV dans moins d\'1h*\n\n👤 *' + escTg(meeting.leadName || meeting.leadEmail) +
              '*\n📧 ' + escTg(meeting.leadEmail) + '\n🕐 ' + escTg(dateStr) +
              '\n⏱ ' + (meeting.duration || 15) + ' min', 'Markdown');
          }
          storage.updateMeetingStatus(meeting.id, 'booked', { reminderSent: true });
          log.info('meeting-handler', 'Rappel envoye pour RDV avec ' + meeting.leadEmail);
        }
      }

    } catch (e) {
      log.error('meeting-handler', 'Erreur syncBookings:', e.message);
    }
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
