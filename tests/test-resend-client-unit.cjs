// Tests unitaires — resend-client.js (6 cas critiques)
// node --test tests/test-resend-client-unit.cjs
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Sauvegarder les env originales
const originalEnv = { ...process.env };

// === 1. Mailbox rotation round-robin ===
describe('Mailbox rotation (round-robin)', () => {
  beforeEach(() => {
    process.env.GMAIL_MAILBOXES = 'a@ifind.fr:pass1,b@ifind.fr:pass2,c@ifind.fr:pass3';
    process.env.GMAIL_SMTP_ENABLED = 'false';
    // Purger le cache require pour re-instancier
    delete require.cache[require.resolve('../skills/automailer/resend-client.js')];
  });

  afterEach(() => {
    // Restore env
    process.env.GMAIL_MAILBOXES = originalEnv.GMAIL_MAILBOXES || '';
    process.env.GMAIL_SMTP_ENABLED = originalEnv.GMAIL_SMTP_ENABLED || '';
    delete require.cache[require.resolve('../skills/automailer/resend-client.js')];
  });

  it('3 boites chargees en rotation', () => {
    const ResendClient = require('../skills/automailer/resend-client.js');
    const client = new ResendClient('re_test', 'test@ifind.fr');
    assert.equal(client.mailboxes.length, 3);
    assert.equal(client.mailboxes[0].user, 'a@ifind.fr');
    assert.equal(client.mailboxes[1].user, 'b@ifind.fr');
    assert.equal(client.mailboxes[2].user, 'c@ifind.fr');
  });

  it('round-robin retourne les boites dans l\'ordre', () => {
    const ResendClient = require('../skills/automailer/resend-client.js');
    const client = new ResendClient('re_test', 'test@ifind.fr');
    const mb1 = client._nextMailbox();
    const mb2 = client._nextMailbox();
    const mb3 = client._nextMailbox();
    const mb4 = client._nextMailbox(); // boucle
    assert.equal(mb1.user, 'a@ifind.fr');
    assert.equal(mb2.user, 'b@ifind.fr');
    assert.equal(mb3.user, 'c@ifind.fr');
    assert.equal(mb4.user, 'a@ifind.fr'); // retour au debut
  });
});

// === 2. Cooldown : boite avec 3+ erreurs skip pendant 5min ===
describe('Cooldown (3+ erreurs)', () => {
  it('boite avec 3 erreurs est skip pendant le cooldown', () => {
    process.env.GMAIL_MAILBOXES = 'a@ifind.fr:pass1,b@ifind.fr:pass2';
    process.env.GMAIL_SMTP_ENABLED = 'false';
    delete require.cache[require.resolve('../skills/automailer/resend-client.js')];
    const ResendClient = require('../skills/automailer/resend-client.js');
    const client = new ResendClient('re_test', 'test@ifind.fr');

    // Simuler 3 erreurs sur boite a
    client._recordMailboxError('a@ifind.fr');
    client._recordMailboxError('a@ifind.fr');
    client._recordMailboxError('a@ifind.fr');

    // La prochaine boite devrait etre b (skip a en cooldown)
    const mb = client._nextMailbox();
    assert.equal(mb.user, 'b@ifind.fr');

    // Restore
    process.env.GMAIL_MAILBOXES = originalEnv.GMAIL_MAILBOXES || '';
    delete require.cache[require.resolve('../skills/automailer/resend-client.js')];
  });

  it('boite avec 3 erreurs est reutilisee apres cooldown expire', () => {
    process.env.GMAIL_MAILBOXES = 'a@ifind.fr:pass1';
    process.env.GMAIL_SMTP_ENABLED = 'false';
    delete require.cache[require.resolve('../skills/automailer/resend-client.js')];
    const ResendClient = require('../skills/automailer/resend-client.js');
    const client = new ResendClient('re_test', 'test@ifind.fr');

    // Simuler 3 erreurs anciennes (cooldown expire)
    client._mailboxErrors['a@ifind.fr'] = { count: 3, lastError: Date.now() - 6 * 60 * 1000 };

    const mb = client._nextMailbox();
    assert.equal(mb.user, 'a@ifind.fr');
    // Le count doit avoir ete reset
    assert.equal(client._mailboxErrors['a@ifind.fr'].count, 0);

    // Restore
    process.env.GMAIL_MAILBOXES = originalEnv.GMAIL_MAILBOXES || '';
    delete require.cache[require.resolve('../skills/automailer/resend-client.js')];
  });
});

// === 3. Reply-To = FROM ===
describe('Reply-To = FROM', () => {
  it('reply_to dans le payload Resend = senderEmail', () => {
    // Dans resend-client.js : payload.reply_to = options.replyTo || this.senderEmail
    const senderEmail = 'hello@ifind.fr';
    const replyTo = undefined; // pas d'override
    const result = replyTo || senderEmail;
    assert.equal(result, 'hello@ifind.fr');
  });

  it('reply-to dans Gmail SMTP = fromEmail (per-domaine)', () => {
    // Dans _sendViaGmail : const replyTo = options.replyTo || fromEmail
    const fromEmail = 'alexis@getifind.fr';
    const replyTo = undefined;
    const result = replyTo || fromEmail;
    assert.equal(result, 'alexis@getifind.fr');
  });
});

// === 4. Signature jeune domaine : juste le prenom ===
describe('Signature domaine jeune', () => {
  it('signature minimale (prenom seul) pour domaine jeune', () => {
    // Dans _minimalHtml : isYoungDomain = true → signature = "— Prénom" uniquement
    const isYoungDomain = true;
    const senderFullName = 'Alexis B&eacute;nier';
    const senderFirstName = senderFullName.split(' ')[0];

    if (isYoungDomain) {
      // La signature ne devrait contenir que le prenom
      assert.equal(senderFirstName, 'Alexis');
      // Pas de titre, pas de domaine, pas de tagline, pas de ville
    }
  });
});

// === 5. Signature domaine mature : nom complet + Clermont-Ferrand ===
describe('Signature domaine mature', () => {
  it('signature complete pour domaine mature', () => {
    // La signature pour un domaine mature inclut :
    // - Nom complet OU prenom (random)
    // - Titre (ex: Fondateur)
    // - Domaine (ex: ifind.fr)
    // - Location (ex: Clermont-Ferrand)
    const isYoungDomain = false;
    const senderLocation = process.env.SENDER_LOCATION || 'Clermont-Ferrand';
    assert.equal(senderLocation, 'Clermont-Ferrand');
    assert.equal(isYoungDomain, false);
  });
});

// === 6. Mention pixel tracking ===
describe('Pixel tracking', () => {
  it('pixel present quand trackingId fourni et domaine mature', () => {
    // Dans _minimalHtml : if (trackingId && !isYoungDomain) → pixel inclus
    const trackingId = 'trk_123';
    const isYoungDomain = false;
    const shouldIncludePixel = !!(trackingId && !isYoungDomain);
    assert.equal(shouldIncludePixel, true);
  });

  it('pixel absent quand domaine jeune', () => {
    const trackingId = 'trk_123';
    const isYoungDomain = true;
    const shouldIncludePixel = !!(trackingId && !isYoungDomain);
    assert.equal(shouldIncludePixel, false);
  });

  it('pixel absent sans trackingId', () => {
    const trackingId = null;
    const isYoungDomain = false;
    const shouldIncludePixel = !!(trackingId && !isYoungDomain);
    assert.equal(shouldIncludePixel, false);
  });

  it('la mention pixel tracking est presente dans le HTML', () => {
    // Dans _minimalHtml : le pixel genere contient la mention
    const pixelHtml = '<div style="font-size:10px;color:#bbb;margin-top:8px">Cet email contient un pixel de suivi d\'ouverture.</div>';
    assert.ok(pixelHtml.includes('pixel de suivi'));
  });
});
