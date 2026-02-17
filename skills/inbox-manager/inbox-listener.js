// Inbox Manager - IMAP Listener (imapflow)
let ImapFlow = null;
try {
  ImapFlow = require('imapflow').ImapFlow;
} catch (e) {
  // imapflow non installe — sera installe au premier demarrage ou via pnpm add
}
const log = require('../../gateway/logger.js');
const storage = require('./storage.js');

class InboxListener {
  constructor(options) {
    this.host = options.imapHost || '';
    this.port = options.imapPort || 993;
    this.user = options.imapUser || '';
    this.pass = options.imapPass || '';
    this.adminChatId = options.adminChatId || '';
    this.sendTelegram = options.sendTelegram || (async () => {});
    this.getKnownLeads = options.getKnownLeads || (() => []);
    this.onReplyDetected = options.onReplyDetected || (async () => {});

    this._client = null;
    this._pollInterval = null;
    this._running = false;
    this._connected = false;
  }

  isConfigured() {
    return !!(ImapFlow && this.host && this.user && this.pass);
  }

  async start() {
    if (!this.isConfigured()) {
      log.warn('inbox-manager', 'IMAP non configure (IMAP_HOST/USER/PASS manquants) — inbox-manager desactive');
      return;
    }

    this._running = true;
    log.info('inbox-manager', 'Demarrage IMAP listener pour ' + this.user + '@' + this.host);

    // Premier check immediat
    await this._checkNewEmails();

    // Poll toutes les 2 minutes
    const interval = storage.getConfig().pollIntervalMs || 120000;
    this._pollInterval = setInterval(() => {
      if (this._running) {
        this._checkNewEmails().catch(e => {
          log.error('inbox-manager', 'Erreur check periodique:', e.message);
        });
      }
    }, interval);

    log.info('inbox-manager', 'IMAP polling actif (interval: ' + (interval / 1000) + 's)');
  }

  stop() {
    this._running = false;
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    if (this._client) {
      this._client.close().catch(() => {});
      this._client = null;
    }
    log.info('inbox-manager', 'IMAP listener arrete');
  }

  async _getClient() {
    // Creer une nouvelle connexion a chaque check (plus fiable que maintenir une connexion IDLE)
    const client = new ImapFlow({
      host: this.host,
      port: this.port,
      secure: true,
      auth: {
        user: this.user,
        pass: this.pass
      },
      logger: false, // Desactiver le logging verbose d'imapflow
      emitLogs: false
    });

    await client.connect();
    return client;
  }

  async _checkNewEmails() {
    let client = null;
    try {
      client = await this._getClient();

      // Ouvrir INBOX en lecture seule
      const lock = await client.getMailboxLock('INBOX');

      try {
        // Chercher les messages non vus (UNSEEN) des 7 derniers jours
        const since = new Date();
        since.setDate(since.getDate() - 7);

        const messages = [];
        for await (const msg of client.fetch(
          { seen: false, since: since },
          { envelope: true, bodyStructure: true, source: { maxLength: 2000 } }
        )) {
          // Verifier si deja traite
          if (storage.isUidProcessed(msg.uid)) continue;

          const from = msg.envelope.from && msg.envelope.from[0]
            ? (msg.envelope.from[0].address || '')
            : '';
          const fromName = msg.envelope.from && msg.envelope.from[0]
            ? (msg.envelope.from[0].name || '')
            : '';
          const subject = msg.envelope.subject || '';
          const date = msg.envelope.date ? msg.envelope.date.toISOString() : new Date().toISOString();
          const to = msg.envelope.to && msg.envelope.to[0]
            ? (msg.envelope.to[0].address || '')
            : '';

          // Extraire un snippet du body si disponible
          let snippet = '';
          if (msg.source) {
            const bodyStr = msg.source.toString('utf-8');
            // Extraire le texte brut apres les headers
            const bodyStart = bodyStr.indexOf('\r\n\r\n');
            if (bodyStart > -1) {
              snippet = bodyStr.substring(bodyStart + 4, bodyStart + 504)
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            }
          }

          messages.push({
            uid: msg.uid,
            from,
            fromName,
            to,
            subject,
            date,
            snippet
          });
        }

        // Traiter les nouveaux messages
        if (messages.length > 0) {
          log.info('inbox-manager', messages.length + ' nouveau(x) email(s) detecte(s)');
          await this._processNewEmails(messages);
        }

        storage.recordCheck();
      } finally {
        lock.release();
      }
    } catch (e) {
      log.error('inbox-manager', 'Erreur IMAP check:', e.message);
    } finally {
      if (client) {
        try { await client.logout(); } catch (e) {}
      }
    }
  }

  async _processNewEmails(messages) {
    // Recuperer les leads connus (emails des prospects contactes)
    const knownLeads = this.getKnownLeads();
    const knownEmails = new Set(knownLeads.map(l => (l.email || l.to || '').toLowerCase()));

    for (const msg of messages) {
      const senderEmail = msg.from.toLowerCase();

      // Ignorer les emails systeme (noreply, mailer-daemon, etc.)
      if (this._isSystemEmail(senderEmail)) {
        storage.addProcessedUid(msg.uid);
        continue;
      }

      // Verifier si le sender est un lead connu
      const isKnownLead = knownEmails.has(senderEmail);
      const matchedLead = isKnownLead
        ? knownLeads.find(l => (l.email || l.to || '').toLowerCase() === senderEmail)
        : null;

      // Enregistrer dans le storage
      const entry = storage.addReceivedEmail({
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        date: msg.date,
        text: msg.snippet,
        matchedLead: matchedLead ? {
          email: matchedLead.email || matchedLead.to,
          name: matchedLead.name || matchedLead.fromName || msg.fromName,
          campaignId: matchedLead.campaignId || null
        } : null
      });

      storage.addProcessedUid(msg.uid);

      // Si c'est une reponse d'un lead connu → notification + CRM update
      if (isKnownLead) {
        log.info('inbox-manager', 'REPONSE DETECTEE de ' + senderEmail + ' — sujet: ' + msg.subject);

        // Notifier sur Telegram
        const notif = [
          '📬 *Reponse email detectee !*',
          '',
          '👤 *De :* ' + (msg.fromName || senderEmail),
          '📧 ' + senderEmail,
          '📋 *Sujet :* ' + msg.subject,
          '📅 ' + new Date(msg.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
          ''
        ];

        if (msg.snippet) {
          notif.push('💬 _' + msg.snippet.substring(0, 200) + (msg.snippet.length > 200 ? '...' : '') + '_');
          notif.push('');
        }

        if (matchedLead && matchedLead.campaignId) {
          notif.push('🎯 Campagne : ' + matchedLead.campaignId);
        }

        notif.push('_Ce lead a repondu a ton email ! Reponds-lui vite._');

        await this.sendTelegram(this.adminChatId, notif.join('\n'));

        // Callback pour update CRM/scoring
        try {
          await this.onReplyDetected({
            from: senderEmail,
            fromName: msg.fromName,
            subject: msg.subject,
            date: msg.date,
            matchedLead
          });
        } catch (e) {
          log.error('inbox-manager', 'Erreur onReplyDetected callback:', e.message);
        }
      }
    }
  }

  _isSystemEmail(email) {
    const systemPatterns = [
      'noreply', 'no-reply', 'mailer-daemon', 'postmaster',
      'bounce', 'notification', 'alert@', 'system@',
      'donotreply', 'do-not-reply', 'auto-reply'
    ];
    return systemPatterns.some(p => email.includes(p));
  }
}

module.exports = InboxListener;
