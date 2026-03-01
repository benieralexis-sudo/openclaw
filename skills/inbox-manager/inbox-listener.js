// Inbox Manager - IMAP Listener (imapflow + mailparser)
let ImapFlow = null;
try {
  ImapFlow = require('imapflow').ImapFlow;
} catch (e) {
  // imapflow non installe — sera installe au premier demarrage ou via pnpm add
}
let simpleParser = null;
try {
  simpleParser = require('mailparser').simpleParser;
} catch (e) {
  // mailparser non installe — fallback regex extraction
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
    log.info('inbox-manager', 'Demarrage IMAP listener pour ' + this.user + '@' + this.host +
      (simpleParser ? ' (MIME parser actif)' : ' (fallback regex)'));

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
      emitLogs: false,
      tls: { rejectUnauthorized: false }
    });

    // Timeout 15s pour eviter les hangs silencieux
    const connectTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('IMAP connect timeout (15s)')), 15000)
    );
    try {
      await Promise.race([client.connect(), connectTimeout]);
    } catch (e) {
      // Detruire le client si le timeout gagne (evite connection leak)
      try { client.close(); } catch (_) {}
      throw e;
    }
    return client;
  }

  async _checkNewEmails() {
    if (!this._pollCount) this._pollCount = 0;
    this._pollCount++;

    let client = null;
    try {
      client = await this._getClient();

      // Ouvrir INBOX en lecture seule
      const lock = await client.getMailboxLock('INBOX');

      try {
        // Chercher TOUS les messages des 7 derniers jours (pas seulement UNSEEN)
        // Le filtre par UID deja traite evite les doublons
        const since = new Date();
        since.setDate(since.getDate() - 7);

        const messages = [];
        let totalChecked = 0;
        for await (const msg of client.fetch(
          { since: since },
          { envelope: true, bodyStructure: true, source: { maxLength: 8192 } }
        )) {
          totalChecked++;
          // Normaliser UID en nombre pour eviter mismatch string/int
          const uid = typeof msg.uid === 'string' ? parseInt(msg.uid, 10) : msg.uid;

          // Verifier si deja traite
          if (storage.isUidProcessed(uid)) continue;

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

          // Extraire le snippet via MIME parser ou fallback regex
          const snippet = await this._extractSnippet(msg.source);

          messages.push({
            uid,
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
          log.info('inbox-manager', messages.length + ' nouveau(x) email(s) detecte(s) (sur ' + totalChecked + ' verifies)');
          await this._processNewEmails(messages);
        }

        // Heartbeat log toutes les 10 polls (~20 min) pour confirmer que le polling tourne
        if (this._pollCount % 10 === 0) {
          log.info('inbox-manager', 'Heartbeat: poll #' + this._pollCount + ' — ' + totalChecked + ' emails verifies, ' + messages.length + ' nouveaux');
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

  /**
   * Extrait le texte brut d'un email source (MIME ou fallback regex).
   * Retourne un snippet de max 500 chars.
   */
  async _extractSnippet(source) {
    if (!source) return '';

    // Methode 1 : mailparser (parse MIME correctement : multipart, base64, quoted-printable, charsets)
    if (simpleParser) {
      try {
        const parsed = await simpleParser(source, { skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true });
        const text = (parsed.text || parsed.textAsHtml || '').trim();
        if (text) {
          return text
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 500);
        }
      } catch (e) {
        log.warn('inbox-manager', 'mailparser echoue, fallback regex:', e.message);
      }
    }

    // Methode 2 : fallback regex (extraction brute apres headers)
    const bodyStr = source.toString('utf-8');
    const bodyStart = bodyStr.indexOf('\r\n\r\n');
    if (bodyStart > -1) {
      return bodyStr.substring(bodyStart + 4, bodyStart + 1004)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&#160;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&mdash;|&#8212;/g, '-')
        .replace(/&[a-z]+;/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 500);
    }
    return '';
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

      // Verifier si le sender est un lead connu (exact match d'abord, puis fuzzy sur local part)
      let isKnownLead = knownEmails.has(senderEmail);
      let matchedLead = isKnownLead
        ? knownLeads.find(l => (l.email || l.to || '').toLowerCase() === senderEmail)
        : null;

      // Fuzzy match : meme local part (avant @) avec domaine different (.com vs .fr, etc.)
      if (!isKnownLead && senderEmail.includes('@')) {
        const senderLocal = senderEmail.split('@')[0];
        const fuzzyMatch = knownLeads.find(l => {
          const leadEmail = (l.email || l.to || '').toLowerCase();
          return leadEmail.includes('@') && leadEmail.split('@')[0] === senderLocal && leadEmail !== senderEmail;
        });
        if (fuzzyMatch) {
          isKnownLead = true;
          matchedLead = fuzzyMatch;
          log.info('inbox-manager', 'Fuzzy match: ' + senderEmail + ' → ' + (fuzzyMatch.email || fuzzyMatch.to) + ' (meme local part, domaine different)');
        }
      }

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

      // Si c'est une reponse d'un lead connu → notification + CRM update
      if (isKnownLead) {
        log.info('inbox-manager', 'REPONSE DETECTEE de ' + senderEmail + ' — sujet: ' + msg.subject);

        // Notifier sur Telegram (escape Markdown pour eviter crash formatage)
        const esc = (t) => (t || '').replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&').substring(0, 500);
        const notif = [
          '📬 *Reponse email detectee !*',
          '',
          '👤 *De :* ' + esc(msg.fromName || senderEmail),
          '📧 ' + esc(senderEmail),
          '📋 *Sujet :* ' + esc(msg.subject),
          '📅 ' + new Date(msg.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
          ''
        ];

        if (msg.snippet) {
          notif.push('💬 _' + esc(msg.snippet.substring(0, 200)) + (msg.snippet.length > 200 ? '...' : '') + '_');
          notif.push('');
        }

        if (matchedLead && matchedLead.campaignId) {
          notif.push('🎯 Campagne : ' + esc(matchedLead.campaignId));
        }

        notif.push('_Ce lead a repondu a ton email \\! Reponds\\-lui vite\\._');

        await this.sendTelegram(this.adminChatId, notif.join('\n'));

        // Callback pour update CRM/scoring
        try {
          await this.onReplyDetected({
            from: senderEmail,
            fromName: msg.fromName,
            subject: msg.subject,
            date: msg.date,
            snippet: msg.snippet || '',
            matchedLead
          });
        } catch (e) {
          log.error('inbox-manager', 'Erreur onReplyDetected callback:', e.message);
        }
      }

      // Marquer UID comme traite APRES classification/callback (evite perte si crash)
      storage.addProcessedUid(msg.uid);
    }
  }

  _isSystemEmail(email) {
    const systemPatterns = [
      'noreply', 'no-reply', 'mailer-daemon', 'postmaster',
      'bounce', 'notification@', 'alert@', 'system@',
      'donotreply', 'do-not-reply', 'auto-reply',
      'notifications@github.com', 'notifications@linkedin.com',
      'no-reply@accounts.google.com', 'noreply@medium.com',
      'calendar-notification', 'feedback@', 'updates@'
    ];
    return systemPatterns.some(p => email.includes(p));
  }
}

module.exports = InboxListener;
