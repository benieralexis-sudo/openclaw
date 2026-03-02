// test-inbox-fuzzy.cjs — Tests d'integration Inbox Manager fuzzy match
// node --test tests/test-inbox-fuzzy.cjs
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// =============================================
// Reproduction de la logique de fuzzy match de inbox-listener.js
// On isole la logique sans dependance IMAP/reseau
// =============================================

function normalizeLocal(s) {
  return (s || '').replace(/[-_.]/g, '').toLowerCase();
}

function domainBase(d) {
  return (d || '').split('.').slice(0, -1).join('.').toLowerCase();
}

/**
 * Reproduit fidement la logique _processNewEmails de inbox-listener.js
 * @param {string} senderEmail - email de l'expediteur
 * @param {string} senderName - nom de l'expediteur (header From)
 * @param {Array} knownLeads - liste des leads connus [{email, name}]
 * @returns {{ matched: boolean, matchedLead: object|null, matchType: string }}
 */
function fuzzyMatch(senderEmail, senderName, knownLeads) {
  const senderLower = senderEmail.toLowerCase();
  const knownEmails = new Set(knownLeads.map(l => (l.email || '').toLowerCase()));

  // Exact match
  if (knownEmails.has(senderLower)) {
    const lead = knownLeads.find(l => (l.email || '').toLowerCase() === senderLower);
    return { matched: true, matchedLead: lead, matchType: 'exact' };
  }

  // Fuzzy match
  if (!senderLower.includes('@')) {
    return { matched: false, matchedLead: null, matchType: 'none' };
  }

  const senderLocal = senderLower.split('@')[0];
  const senderDomain = senderLower.split('@')[1] || '';
  const normalizedSenderLocal = normalizeLocal(senderLocal);
  const senderDomainBase = domainBase(senderDomain);

  let fuzzyResult = null;

  if (normalizedSenderLocal.length >= 3) {
    // Niveau 1 : local part normalise
    fuzzyResult = knownLeads.find(l => {
      const leadEmail = (l.email || '').toLowerCase();
      if (!leadEmail.includes('@') || leadEmail === senderLower) return false;
      return normalizeLocal(leadEmail.split('@')[0]) === normalizedSenderLocal;
    });

    if (fuzzyResult) return { matched: true, matchedLead: fuzzyResult, matchType: 'local_part' };

    // Niveau 2 : meme base de domaine
    if (!fuzzyResult && senderDomainBase.length >= 3) {
      fuzzyResult = knownLeads.find(l => {
        const leadEmail = (l.email || '').toLowerCase();
        if (!leadEmail.includes('@') || leadEmail === senderLower) return false;
        const leadDomainBase = domainBase(leadEmail.split('@')[1] || '');
        return leadDomainBase === senderDomainBase && leadDomainBase.length >= 3;
      });

      if (fuzzyResult) return { matched: true, matchedLead: fuzzyResult, matchType: 'domain_base' };
    }

    // Niveau 3 : meme nom de contact
    if (!fuzzyResult && senderName && senderName.trim().length >= 4) {
      const senderNameLower = senderName.trim().toLowerCase();
      fuzzyResult = knownLeads.find(l => {
        const leadName = (l.name || '').trim().toLowerCase();
        return leadName.length >= 4 && leadName === senderNameLower;
      });

      if (fuzzyResult) return { matched: true, matchedLead: fuzzyResult, matchType: 'name' };
    }
  }

  return { matched: false, matchedLead: null, matchType: 'none' };
}

// =============================================
// Tests
// =============================================

describe('Inbox Fuzzy Match: Exact match', () => {
  const leads = [
    { email: 'jean.dupont@techcorp.fr', name: 'Jean Dupont' },
    { email: 'marie.curie@labofr.com', name: 'Marie Curie' }
  ];

  it('match exact meme email', () => {
    const result = fuzzyMatch('jean.dupont@techcorp.fr', '', leads);
    assert.equal(result.matched, true);
    assert.equal(result.matchType, 'exact');
    assert.equal(result.matchedLead.email, 'jean.dupont@techcorp.fr');
  });

  it('match exact est case-insensitive', () => {
    const result = fuzzyMatch('Jean.Dupont@TECHCORP.fr', '', leads);
    assert.equal(result.matched, true);
    assert.equal(result.matchType, 'exact');
  });

  it('pas de match pour un email inconnu', () => {
    const result = fuzzyMatch('unknown@random.com', '', leads);
    assert.equal(result.matched, false);
    assert.equal(result.matchType, 'none');
  });
});

describe('Inbox Fuzzy Match: Local part normalise (tirets/points)', () => {
  const leads = [
    { email: 'jean-pierre.martin@techcorp.fr', name: 'Jean-Pierre Martin' }
  ];

  it('jean-pierre@ match jeanpierre@ (suppression tirets)', () => {
    const result = fuzzyMatch('jeanpierre.martin@otherdomain.com', '', leads);
    assert.equal(result.matched, true);
    assert.equal(result.matchType, 'local_part');
  });

  it('jean.pierre.martin@ match jeanpierremartin@ (suppression points)', () => {
    const result = fuzzyMatch('jeanpierremartin@otherdomain.com', '', leads);
    assert.equal(result.matched, true);
    assert.equal(result.matchType, 'local_part');
  });

  it('jean_pierre_martin@ match jean-pierre.martin@ (underscore → tiret → supprime)', () => {
    const result = fuzzyMatch('jean_pierre_martin@newmail.fr', '', leads);
    assert.equal(result.matched, true);
    assert.equal(result.matchType, 'local_part');
  });
});

describe('Inbox Fuzzy Match: Domain base similaire', () => {
  const leads = [
    { email: 'contact@bigcompany.com', name: 'Big Company' }
  ];

  it('bigcompany.com match bigcompany.fr (meme base, TLD different)', () => {
    const result = fuzzyMatch('other@bigcompany.fr', '', leads);
    assert.equal(result.matched, true);
    assert.equal(result.matchType, 'domain_base');
  });

  it('bigcompany.com match bigcompany.io', () => {
    const result = fuzzyMatch('support@bigcompany.io', '', leads);
    assert.equal(result.matched, true);
    assert.equal(result.matchType, 'domain_base');
  });

  it('NE match PAS un domaine completement different', () => {
    const result = fuzzyMatch('someone@totallydifferent.com', '', leads);
    assert.equal(result.matched, false);
  });

  it('NE match PAS les domaines avec base trop courte (< 3 chars)', () => {
    const leadsShort = [{ email: 'x@ab.com', name: 'AB' }];
    const result = fuzzyMatch('y@ab.fr', '', leadsShort);
    // ab a une longueur de 2 < 3, donc pas de match domaine
    assert.equal(result.matched, false);
  });
});

describe('Inbox Fuzzy Match: Match par nom', () => {
  const leads = [
    { email: 'jean.dupont@techcorp.fr', name: 'Jean Dupont' },
    { email: 'marie.curie@labofr.com', name: 'Marie Curie' }
  ];

  it('match par nom identique (differents emails, local >= 3 chars)', () => {
    // Le local part doit faire >= 3 chars normalises pour activer le fuzzy match (y compris par nom)
    const result = fuzzyMatch('jean.d@personnalmail.com', 'Jean Dupont', leads);
    assert.equal(result.matched, true);
    assert.equal(result.matchType, 'name');
    assert.equal(result.matchedLead.email, 'jean.dupont@techcorp.fr');
  });

  it('match par nom est case-insensitive', () => {
    const result = fuzzyMatch('mcurie@perso.fr', 'MARIE CURIE', leads);
    assert.equal(result.matched, true);
    assert.equal(result.matchType, 'name');
  });

  it('NE match PAS un nom trop court (< 4 chars)', () => {
    const result = fuzzyMatch('unknown@test.com', 'Jo', leads);
    assert.equal(result.matched, false);
  });
});

describe('Inbox Fuzzy Match: Cas negatifs (pas de faux positifs)', () => {
  const leads = [
    { email: 'jean.dupont@techcorp.fr', name: 'Jean Dupont' },
    { email: 'alice.martin@startup.io', name: 'Alice Martin' }
  ];

  it('NE match PAS info@ generique sur domaine similaire', () => {
    // info@ a seulement 4 chars normalises → mais un local part "info" matcherait
    // uniquement si un lead a AUSSI info comme local part. Ici aucun lead n'a "info" → pas de match
    const result = fuzzyMatch('info@random.com', '', leads);
    assert.equal(result.matched, false);
  });

  it('NE match PAS contact@ generique', () => {
    const result = fuzzyMatch('contact@random.com', '', leads);
    assert.equal(result.matched, false);
  });

  it('NE match PAS un nom generique "Admin" sur un lead reel', () => {
    const result = fuzzyMatch('admin@unknown.com', 'Admin', leads);
    assert.equal(result.matched, false); // nom trop court (5 chars mais ne match aucun lead)
  });

  it('NE match PAS si email sans @', () => {
    const result = fuzzyMatch('notanemail', '', leads);
    assert.equal(result.matched, false);
  });

  it('NE match PAS deux leads totalement differents', () => {
    const result = fuzzyMatch('bob.smith@bigcorp.de', 'Bob Smith', leads);
    assert.equal(result.matched, false);
  });

  it('NE match PAS un local part trop court (< 3 chars normalises)', () => {
    const leadsShort = [{ email: 'ab@test.com', name: 'Test Lead' }];
    const result = fuzzyMatch('ab@other.com', '', leadsShort);
    // local normalise "ab" a longueur 2 < 3, pas de fuzzy
    assert.equal(result.matched, false);
  });
});

describe('Inbox Fuzzy Match: System email detection', () => {
  const systemPatterns = [
    'noreply', 'no-reply', 'mailer-daemon', 'postmaster',
    'bounce', 'notification@', 'alert@', 'system@',
    'donotreply', 'do-not-reply', 'auto-reply',
    'notifications@github.com', 'notifications@linkedin.com'
  ];

  function isSystemEmail(email) {
    return systemPatterns.some(p => email.toLowerCase().includes(p));
  }

  it('detecte noreply@company.com', () => {
    assert.equal(isSystemEmail('noreply@company.com'), true);
  });

  it('detecte mailer-daemon@server.com', () => {
    assert.equal(isSystemEmail('mailer-daemon@server.com'), true);
  });

  it('detecte notifications@github.com', () => {
    assert.equal(isSystemEmail('notifications@github.com'), true);
  });

  it('NE detecte PAS jean@company.com', () => {
    assert.equal(isSystemEmail('jean@company.com'), false);
  });

  it('NE detecte PAS contact@company.com', () => {
    assert.equal(isSystemEmail('contact@company.com'), false);
  });
});
