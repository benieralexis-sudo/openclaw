// test-campaign-engine.cjs — Tests d'integration Campaign Engine
// node --test tests/test-campaign-engine.cjs
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// =============================================
// Helpers : mock des modules requis par campaign-engine
// =============================================

// On ne peut pas require campaign-engine directement car il depend de storage, dns, etc.
// On teste les fonctions pures + logique en isolation via extraction ou mock du require cache.

// --- 1. getWarmupDailyLimit (source unique dans gateway/utils.js) ---

const { getWarmupDailyLimit, applySpintax, validateEmailOutput, isValidEmail } = require('../gateway/utils.js');

describe('getWarmupDailyLimit', () => {
  it('retourne 5 si pas de firstSendDate', () => {
    assert.equal(getWarmupDailyLimit(null), 5);
    assert.equal(getWarmupDailyLimit(undefined), 5);
    assert.equal(getWarmupDailyLimit(''), 5);
  });

  it('retourne 5 au jour 0 (premier envoi)', () => {
    const now = new Date().toISOString();
    assert.equal(getWarmupDailyLimit(now), 5);
  });

  it('retourne 10 au jour 1', () => {
    const yesterday = new Date(Date.now() - 1 * 86400000).toISOString();
    assert.equal(getWarmupDailyLimit(yesterday), 10);
  });

  it('retourne 20 au jour 3', () => {
    const d3 = new Date(Date.now() - 3 * 86400000).toISOString();
    assert.equal(getWarmupDailyLimit(d3), 20);
  });

  it('retourne 50 au jour 7', () => {
    const d7 = new Date(Date.now() - 7 * 86400000).toISOString();
    assert.equal(getWarmupDailyLimit(d7), 50);
  });

  it('retourne 75 au jour 14', () => {
    const d14 = new Date(Date.now() - 14 * 86400000).toISOString();
    assert.equal(getWarmupDailyLimit(d14), 75);
  });

  it('retourne 100 au jour 28+', () => {
    const d28 = new Date(Date.now() - 28 * 86400000).toISOString();
    assert.equal(getWarmupDailyLimit(d28), 100);
  });

  it('retourne 100 au jour 365 (longue duree)', () => {
    const d365 = new Date(Date.now() - 365 * 86400000).toISOString();
    assert.equal(getWarmupDailyLimit(d365), 100);
  });

  it('retourne 5 si firstSendDate est dans le futur', () => {
    const future = new Date(Date.now() + 10 * 86400000).toISOString();
    assert.equal(getWarmupDailyLimit(future), 5);
  });

  it('accepte un objet Date', () => {
    const d3 = new Date(Date.now() - 3 * 86400000);
    assert.equal(getWarmupDailyLimit(d3), 20);
  });
});

// --- 2. getDailyLimit (headroom via domain-manager mock) ---

describe('getDailyLimit (headroom domain-manager)', () => {
  it('calcule le headroom total des domaines actifs', () => {
    // Simule la logique de getDailyLimit dans campaign-engine
    const mockStats = [
      { domain: 'ifind.fr', active: true, warmupLimit: 50, todaySends: 10, headroom: 40 },
      { domain: 'getifind.fr', active: true, warmupLimit: 30, todaySends: 20, headroom: 10 },
      { domain: 'paused.fr', active: false, warmupLimit: 50, todaySends: 0, headroom: 50 }
    ];

    const totalHeadroom = mockStats
      .filter(s => s.active)
      .reduce((sum, s) => sum + Math.max(0, s.headroom), 0);

    assert.equal(totalHeadroom, 50); // 40 + 10
  });

  it('retourne 0 quand tous les domaines sont a la limite', () => {
    const mockStats = [
      { domain: 'ifind.fr', active: true, warmupLimit: 20, todaySends: 20, headroom: 0 }
    ];
    const totalHeadroom = mockStats
      .filter(s => s.active)
      .reduce((sum, s) => sum + Math.max(0, s.headroom), 0);
    assert.equal(totalHeadroom, 0);
  });

  it('ignore les domaines inactifs', () => {
    const mockStats = [
      { domain: 'paused.fr', active: false, warmupLimit: 100, todaySends: 0, headroom: 100 }
    ];
    const totalHeadroom = mockStats
      .filter(s => s.active)
      .reduce((sum, s) => sum + Math.max(0, s.headroom), 0);
    assert.equal(totalHeadroom, 0);
  });
});

// --- 3. Quality gates : honeypot detection ---

describe('Quality Gate: Honeypot/System addresses', () => {
  const HONEYPOT_PREFIXES = ['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'no-response',
    'noreponse', 'mailer-daemon', 'postmaster', 'hostmaster', 'abuse', 'spam',
    'bounce', 'auto-reply', 'autoreply'];

  function isHoneypot(email) {
    const prefix = (email || '').split('@')[0].toLowerCase();
    return HONEYPOT_PREFIXES.includes(prefix);
  }

  it('detecte noreply@example.com comme honeypot', () => {
    assert.equal(isHoneypot('noreply@example.com'), true);
  });

  it('detecte mailer-daemon@example.com', () => {
    assert.equal(isHoneypot('mailer-daemon@example.com'), true);
  });

  it('detecte postmaster@example.com', () => {
    assert.equal(isHoneypot('postmaster@example.com'), true);
  });

  it('detecte abuse@example.com', () => {
    assert.equal(isHoneypot('abuse@example.com'), true);
  });

  it('NE detecte PAS info@example.com (vrai email B2B)', () => {
    assert.equal(isHoneypot('info@example.com'), false);
  });

  it('NE detecte PAS contact@example.com (vrai email B2B)', () => {
    assert.equal(isHoneypot('contact@example.com'), false);
  });

  it('NE detecte PAS jean.dupont@example.com', () => {
    assert.equal(isHoneypot('jean.dupont@example.com'), false);
  });

  it('NE detecte PAS hello@example.com', () => {
    assert.equal(isHoneypot('hello@example.com'), false);
  });
});

// --- 4. Quality gates : blacklist check ---

describe('Quality Gate: Blacklist', () => {
  it('isBlacklisted est case-insensitive', () => {
    const blacklist = {};
    const addToBlacklist = (email) => { blacklist[email.toLowerCase().trim()] = true; };
    const isBlacklisted = (email) => !!blacklist[email.toLowerCase().trim()];

    addToBlacklist('SPAM@example.com');
    assert.equal(isBlacklisted('spam@example.com'), true);
    assert.equal(isBlacklisted('SPAM@EXAMPLE.COM'), true);
    assert.equal(isBlacklisted('legit@example.com'), false);
  });
});

// --- 5. Quality gates : subject bans ---

describe('Quality Gate: Subject bans', () => {
  const SUBJECT_BANS = [
    'prospection', 'acquisition', 'gen de leads', 'generation de leads',
    'rdv qualifi', 'rdv/mois', 'pipeline', 'sans recruter',
    'et si vous', 'et si tu', 'saviez-vous', 'notre solution', 'notre outil'
  ];

  function subjectPassesGate(subject) {
    const subjectLower = (subject || '').toLowerCase();
    for (const ban of SUBJECT_BANS) {
      if (subjectLower.includes(ban)) return { pass: false, reason: 'banned_subject: ' + ban };
    }
    return { pass: true };
  }

  it('bloque un sujet contenant "prospection"', () => {
    const result = subjectPassesGate('Votre prospection automatisee');
    assert.equal(result.pass, false);
  });

  it('bloque un sujet contenant "notre solution"', () => {
    const result = subjectPassesGate('Decouvrez notre solution');
    assert.equal(result.pass, false);
  });

  it('laisse passer un sujet neutre', () => {
    const result = subjectPassesGate('Question rapide sur votre approche');
    assert.equal(result.pass, true);
  });

  it('laisse passer un sujet vide', () => {
    const result = subjectPassesGate('');
    assert.equal(result.pass, true);
  });
});

// --- 6. Warmup plafond ---

describe('Warmup respect du plafond', () => {
  it('un domaine neuf (jour 0) a un plafond de 5', () => {
    const limit = getWarmupDailyLimit(new Date().toISOString());
    assert.equal(limit, 5);
  });

  it('le plafond ne depasse jamais 100', () => {
    for (let d = 0; d < 365; d++) {
      const fsd = new Date(Date.now() - d * 86400000).toISOString();
      const limit = getWarmupDailyLimit(fsd);
      assert.ok(limit <= 100, 'Jour ' + d + ' depasse 100: ' + limit);
    }
  });

  it('le plafond est monotone croissant (ne diminue jamais)', () => {
    let prev = 0;
    for (let d = 0; d < 60; d++) {
      const fsd = new Date(Date.now() - d * 86400000).toISOString();
      const limit = getWarmupDailyLimit(fsd);
      assert.ok(limit >= prev, 'Jour ' + d + ' a diminue: ' + limit + ' < ' + prev);
      prev = limit;
    }
  });
});

// --- 7. Generation de steps avec bons stepNumbers ---

describe('Step generation (stepNumbers)', () => {
  function generateSteps(emailTemplates, stepDays, intervalDays) {
    intervalDays = intervalDays || 4;
    const steps = [];
    const now = new Date();
    for (let i = 0; i < emailTemplates.length; i++) {
      const dayOffset = stepDays ? (stepDays[i] || stepDays[stepDays.length - 1]) : (i * intervalDays);
      steps.push({
        stepNumber: i + 1,
        subjectTemplate: emailTemplates[i].subject,
        bodyTemplate: emailTemplates[i].body,
        delayDays: dayOffset,
        status: 'pending',
        sentCount: 0,
        errorCount: 0
      });
    }
    return steps;
  }

  it('genere des stepNumbers sequentiels commencant a 1', () => {
    const templates = [
      { subject: 'S1', body: 'B1' },
      { subject: 'S2', body: 'B2' },
      { subject: 'S3', body: 'B3' }
    ];
    const steps = generateSteps(templates, null, 4);
    assert.equal(steps.length, 3);
    assert.equal(steps[0].stepNumber, 1);
    assert.equal(steps[1].stepNumber, 2);
    assert.equal(steps[2].stepNumber, 3);
  });

  it('les delayDays utilisent stepDays quand fourni', () => {
    const templates = [
      { subject: 'S1', body: 'B1' },
      { subject: 'S2', body: 'B2' },
      { subject: 'S3', body: 'B3' },
      { subject: 'S4', body: 'B4' }
    ];
    const steps = generateSteps(templates, [3, 7, 14, 21], null);
    assert.equal(steps[0].delayDays, 3);
    assert.equal(steps[1].delayDays, 7);
    assert.equal(steps[2].delayDays, 14);
    assert.equal(steps[3].delayDays, 21);
  });

  it('les delayDays utilisent intervalDays fixe en fallback', () => {
    const templates = [
      { subject: 'S1', body: 'B1' },
      { subject: 'S2', body: 'B2' },
      { subject: 'S3', body: 'B3' }
    ];
    const steps = generateSteps(templates, null, 5);
    assert.equal(steps[0].delayDays, 0);
    assert.equal(steps[1].delayDays, 5);
    assert.equal(steps[2].delayDays, 10);
  });

  it('tous les steps commencent en status pending', () => {
    const templates = [{ subject: 'S1', body: 'B1' }, { subject: 'S2', body: 'B2' }];
    const steps = generateSteps(templates, null, 4);
    for (const step of steps) {
      assert.equal(step.status, 'pending');
      assert.equal(step.sentCount, 0);
      assert.equal(step.errorCount, 0);
    }
  });

  it('stepDays fallback au dernier element si plus de templates que de jours', () => {
    const templates = [
      { subject: 'S1', body: 'B1' },
      { subject: 'S2', body: 'B2' },
      { subject: 'S3', body: 'B3' }
    ];
    // Seulement 2 elements dans stepDays, 3 templates
    const steps = generateSteps(templates, [3, 7], null);
    assert.equal(steps[2].delayDays, 7); // fallback au dernier element
  });
});

// --- 8. Email quality gate (generic patterns) ---

describe('Quality Gate: Generic patterns', () => {
  const GENERIC_PATTERNS = [
    /j[a'']ai (?:vu|lu|decouvert|trouve|remarque)/i,
    /suis tomb[eé]/i,
    /en parcourant (?:ton|votre) (?:profil|linkedin|site)/i,
    /je me permets de/i,
    /me present(?:e|er)/i,
    /n'h[eé]site[zs]? pas [aà] me contacter/i,
    /saviez.vous que/i,
    /et si (?:on|vous|tu)/i,
    /cordonnier/i,
    /nerf de la guerre/i,
    /notre (?:solution|outil|plateforme)/i,
    /je serais ravi/i,
    /g[eé]n[eé]ration de leads/i
  ];

  function emailPassesGenericCheck(body) {
    for (const pattern of GENERIC_PATTERNS) {
      if (pattern.test(body)) return { pass: false, reason: pattern.source };
    }
    return { pass: true };
  }

  it('bloque "j\'ai vu votre site"', () => {
    assert.equal(emailPassesGenericCheck("j'ai vu votre site et c'est top").pass, false);
  });

  it('bloque "je me permets de vous contacter"', () => {
    assert.equal(emailPassesGenericCheck('je me permets de vous ecrire').pass, false);
  });

  it('bloque "notre solution"', () => {
    assert.equal(emailPassesGenericCheck('Decouvrez notre solution cloud').pass, false);
  });

  it('laisse passer un email specifique et naturel', () => {
    const body = "TechCorp vient de lever, felicitations.\nLa croissance implique des defis RH importants — recruter un commercial prend 6 mois.\nAlexis";
    assert.equal(emailPassesGenericCheck(body).pass, true);
  });
});

// --- 9. validateEmailOutput ---

describe('validateEmailOutput', () => {
  it('accepte un email dans les limites', () => {
    const result = validateEmailOutput('Sujet court', 'Ceci est un email de test avec assez de mots pour passer le seuil minimum requis ici.', { minWords: 10, maxWords: 60 });
    assert.equal(result.pass, true);
    assert.equal(result.reasons.length, 0);
  });

  it('rejette un body trop court', () => {
    const result = validateEmailOutput('Sujet', 'Salut', { minWords: 10, maxWords: 60 });
    assert.equal(result.pass, false);
    assert.ok(result.reasons.some(r => r.startsWith('too_few_words')));
  });

  it('rejette un body trop long', () => {
    const longBody = Array(70).fill('mot').join(' ');
    const result = validateEmailOutput('Sujet', longBody, { minWords: 10, maxWords: 60 });
    assert.equal(result.pass, false);
    assert.ok(result.reasons.some(r => r.startsWith('too_many_words')));
  });

  it('rejette un mot interdit', () => {
    const result = validateEmailOutput('Sujet', 'Notre pipeline commercial est performant et nous avons des resultats.', { forbiddenWords: ['pipeline'], minWords: 5 });
    assert.equal(result.pass, false);
    assert.ok(result.reasons.some(r => r.startsWith('forbidden:pipeline')));
  });

  it('ne rejette pas un mot contenu dans un autre (solution vs dissolution)', () => {
    const result = validateEmailOutput('Sujet', 'La dissolution de la societe a eu des consequences importantes pour tous les collaborateurs concernes.', { forbiddenWords: ['solution'], minWords: 5 });
    assert.equal(result.pass, true);
  });
});

// --- 10. MX check (logique pure, pas d'appel reseau) ---

describe('Quality Gate: MX check logic', () => {
  it('email sans @ retourne false', () => {
    const domain = ('nodomain' || '').split('@')[1];
    assert.equal(!!domain, false);
  });

  it('email normal extrait le domaine correctement', () => {
    const domain = 'test@example.com'.split('@')[1];
    assert.equal(domain, 'example.com');
  });
});
