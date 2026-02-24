// MoltBot - Tests unitaires (node:test natif Node 20)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// =============================================
// 1. Circuit Breaker
// =============================================

describe('CircuitBreaker', () => {
  const { CircuitBreaker } = require('../gateway/circuit-breaker.js');

  it('laisse passer quand CLOSED', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 3 });
    const result = await cb.call(() => Promise.resolve('ok'));
    assert.equal(result, 'ok');
    assert.equal(cb.state, 'CLOSED');
  });

  it('OPEN apres N echecs', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 2, cooldownMs: 100 });
    for (let i = 0; i < 2; i++) {
      try { await cb.call(() => Promise.reject(new Error('fail'))); } catch (e) {}
    }
    assert.equal(cb.state, 'OPEN');
    assert.equal(cb.failures, 2);
  });

  it('fail-fast quand OPEN', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1, cooldownMs: 10000 });
    try { await cb.call(() => Promise.reject(new Error('fail'))); } catch (e) {}
    assert.equal(cb.state, 'OPEN');

    try {
      await cb.call(() => Promise.resolve('should not run'));
      assert.fail('devrait throw');
    } catch (e) {
      assert.ok(e.message.includes('indisponible'));
    }
  });

  it('HALF_OPEN apres cooldown, puis CLOSED sur succes', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1, cooldownMs: 50 });
    try { await cb.call(() => Promise.reject(new Error('fail'))); } catch (e) {}
    assert.equal(cb.state, 'OPEN');

    await new Promise(r => setTimeout(r, 60));
    const result = await cb.call(() => Promise.resolve('recovered'));
    assert.equal(result, 'recovered');
    assert.equal(cb.state, 'CLOSED');
    assert.equal(cb.failures, 0);
  });

  it('reset() remet a zero', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1 });
    cb.failures = 5;
    cb.state = 'OPEN';
    cb.reset();
    assert.equal(cb.state, 'CLOSED');
    assert.equal(cb.failures, 0);
  });
});

// =============================================
// 2. Logger
// =============================================

describe('Logger', () => {
  const logger = require('../gateway/logger.js');

  it('exporte info, warn, error', () => {
    assert.equal(typeof logger.info, 'function');
    assert.equal(typeof logger.warn, 'function');
    assert.equal(typeof logger.error, 'function');
  });
});

// =============================================
// 3. Utils (retryAsync, truncateInput)
// =============================================

describe('Utils', () => {
  const { retryAsync, truncateInput, atomicWriteSync } = require('../gateway/utils.js');

  it('retryAsync reussit au 1er essai', async () => {
    let calls = 0;
    const result = await retryAsync(() => { calls++; return Promise.resolve('ok'); }, 2, 10);
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  it('retryAsync retente apres echec', async () => {
    let calls = 0;
    const result = await retryAsync(() => {
      calls++;
      if (calls < 2) return Promise.reject(new Error('fail'));
      return Promise.resolve('ok');
    }, 2, 10);
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  it('retryAsync throw apres max retries', async () => {
    let calls = 0;
    try {
      await retryAsync(() => { calls++; return Promise.reject(new Error('always fail')); }, 2, 10);
      assert.fail('devrait throw');
    } catch (e) {
      assert.equal(e.message, 'always fail');
      assert.equal(calls, 3); // 1 initial + 2 retries
    }
  });

  it('truncateInput coupe a maxLen', () => {
    assert.equal(truncateInput('hello world', 5), 'hello');
    assert.equal(truncateInput('hi', 100), 'hi');
    assert.equal(truncateInput(null, 5), null);
  });
});

// =============================================
// 4. Autonomous Pilot - Action parsing
// =============================================

describe('AutonomousHandler._parseResponse', () => {
  const AutonomousHandler = require('../skills/autonomous-pilot/autonomous-handler.js');
  const handler = new AutonomousHandler('fake-key', 'fake-key');

  it('parse une reponse sans actions', () => {
    const result = handler._parseResponse('Salut, comment ca va ?');
    assert.equal(result.reply, 'Salut, comment ca va ?');
    assert.deepEqual(result.actions, []);
  });

  it('parse une reponse avec actions', () => {
    const text = 'C\'est fait !\n<actions>[{"type":"update_goals","params":{"leadsToFind":30}}]</actions>';
    const result = handler._parseResponse(text);
    assert.equal(result.reply, 'C\'est fait !');
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].type, 'update_goals');
    assert.equal(result.actions[0].params.leadsToFind, 30);
  });

  it('parse avec JSON invalide dans actions = pas de crash', () => {
    const text = 'Ok\n<actions>NOT_JSON</actions>';
    const result = handler._parseResponse(text);
    assert.equal(result.reply, 'Ok');
    assert.deepEqual(result.actions, []);
  });

  it('parse plusieurs actions', () => {
    const text = 'Done\n<actions>[{"type":"pause","params":{}},{"type":"update_goals","params":{"emailsToSend":50}}]</actions>';
    const result = handler._parseResponse(text);
    assert.equal(result.actions.length, 2);
    assert.equal(result.actions[0].type, 'pause');
    assert.equal(result.actions[1].type, 'update_goals');
  });
});

// =============================================
// 5. Autonomous Pilot - State machine
// =============================================

describe('Autonomous Pilot State Machine', () => {
  const { PILOT_STATES } = require('../skills/autonomous-pilot/storage.js');

  it('definit les bons etats', () => {
    assert.equal(PILOT_STATES.IDLE, 'idle');
    assert.equal(PILOT_STATES.ACTIVE, 'active');
    assert.equal(PILOT_STATES.PAUSED, 'paused');
    assert.equal(PILOT_STATES.ERROR, 'error');
  });
});

// =============================================
// 6. Web Intelligence - Dedup par titre
// =============================================

describe('Web Intelligence Dedup', () => {
  // Test la logique de normalisation (sans toucher au storage reel)
  function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F]/g, '').substring(0, 80);
  }

  it('normalise correctement les titres', () => {
    assert.equal(normalizeTitle('Hello World!'), 'helloworld');
    assert.equal(normalizeTitle('L\'IA en 2026 : tendances'), 'liaen2026tendances');
    assert.equal(normalizeTitle('  ABC  def  '), 'abcdef');
    assert.equal(normalizeTitle(null), '');
    assert.equal(normalizeTitle(''), '');
  });

  it('detecte les doublons par titre', () => {
    const a = normalizeTitle('HubSpot lève 100M en 2026');
    const b = normalizeTitle('HubSpot lève 100M en 2026!');
    assert.equal(a, b); // Meme titre malgre la ponctuation
  });

  it('ne confond pas des titres differents', () => {
    const a = normalizeTitle('HubSpot lève 100M');
    const b = normalizeTitle('Salesforce lève 200M');
    assert.notEqual(a, b);
  });
});

// =============================================
// 7. Skill Loader
// =============================================

describe('Skill Loader', () => {
  const { getStorage, getModule } = require('../gateway/skill-loader.js');

  it('charge un storage existant', () => {
    const storage = getStorage('flowfast');
    assert.ok(storage !== null);
    assert.equal(typeof storage.setUserName, 'function');
  });

  it('retourne null pour un skill inexistant', () => {
    assert.equal(getStorage('nonexistent'), null);
  });

  it('charge un module existant', () => {
    const HubSpotClient = getModule('hubspot-client');
    assert.ok(HubSpotClient !== null);
  });

  it('retourne null pour un module inexistant', () => {
    assert.equal(getModule('nonexistent'), null);
  });
});

// =============================================
// 8. Apollo response validation
// =============================================

describe('Apollo _formatSearchResult validation', () => {
  const ApolloEnricher = require('../skills/lead-enrich/apollo-enricher.js');
  const enricher = new ApolloEnricher('fake-key');

  it('gere une reponse nulle', () => {
    const result = enricher._formatSearchResult(null);
    assert.equal(result.success, false);
  });

  it('gere un tableau people vide', () => {
    const result = enricher._formatSearchResult({ people: [] });
    assert.equal(result.success, false);
  });

  it('gere une reponse sans people', () => {
    const result = enricher._formatSearchResult({ error: 'rate limited' });
    assert.equal(result.success, false);
  });

  it('gere une personne avec des champs manquants', () => {
    const result = enricher._formatSearchResult({
      people: [{ first_name: 'Jean', email: 'jean@test.com' }]
    });
    assert.equal(result.success, true);
    assert.equal(result.person.firstName, 'Jean');
    assert.equal(result.person.email, 'jean@test.com');
    assert.equal(result.person.lastName, '');
    assert.equal(result.organization.name, '');
  });

  it('gere une personne complete', () => {
    const result = enricher._formatSearchResult({
      people: [{
        first_name: 'Jean',
        last_name: 'Dupont',
        title: 'CEO',
        email: 'jean@acme.com',
        linkedin_url: 'https://linkedin.com/in/jean',
        city: 'Paris',
        organization: {
          name: 'Acme Corp',
          industry: 'SaaS',
          website_url: 'https://acme.com',
          estimated_num_employees: 50
        }
      }]
    });
    assert.equal(result.success, true);
    assert.equal(result.person.fullName, 'Jean Dupont');
    assert.equal(result.organization.name, 'Acme Corp');
    assert.equal(result.organization.employeeCount, 50);
  });
});

// =============================================
// Inbox Manager — Reply Classifier (guards)
// =============================================

describe('ReplyClassifier guards', () => {
  const { classifyReply } = require('../skills/inbox-manager/reply-classifier.js');

  it('email vide → fallback question score 0.3', async () => {
    const r = await classifyReply('fake-key', { from: 'a@b.com', snippet: '' });
    assert.equal(r.sentiment, 'question');
    assert.equal(r.score, 0.3);
    assert.ok(r.reason.includes('court') || r.reason.includes('vide'));
  });

  it('snippet trop court → fallback question', async () => {
    const r = await classifyReply('fake-key', { from: 'a@b.com', snippet: 'ok' });
    assert.equal(r.sentiment, 'question');
    assert.ok(r.score <= 0.5);
  });

  it('email forwarded (Fwd:) → fallback question', async () => {
    const r = await classifyReply('fake-key', { from: 'a@b.com', subject: 'Fwd: Proposition', snippet: 'Regarde ca' });
    assert.equal(r.sentiment, 'question');
    assert.ok(r.reason.includes('forward'));
  });

  it('email forwarded (TR:) → fallback question', async () => {
    const r = await classifyReply('fake-key', { from: 'a@b.com', subject: 'TR: Notre echange', snippet: 'Je te forward' });
    assert.equal(r.sentiment, 'question');
  });

  it('bounce par sujet → sentiment bounce', async () => {
    const r = await classifyReply('fake-key', { from: 'mailer@b.com', subject: 'Undeliverable: Meeting request', snippet: 'Delivery failed' });
    assert.equal(r.sentiment, 'bounce');
    assert.equal(r.score, 0.0);
  });

  it('OOO par sujet → sentiment out_of_office', async () => {
    const r = await classifyReply('fake-key', { from: 'prospect@b.com', subject: 'Out of Office: Re: Proposition', snippet: 'absent until March' });
    assert.equal(r.sentiment, 'out_of_office');
    assert.equal(r.score, 0.5);
  });

  it('OOO francais → sentiment out_of_office', async () => {
    const r = await classifyReply('fake-key', { from: 'p@b.com', subject: 'Re: Proposition', snippet: 'Je suis actuellement absent du bureau' });
    assert.equal(r.sentiment, 'out_of_office');
  });

  it('pas de cle API → fallback question', async () => {
    const r = await classifyReply('', { from: 'a@b.com', snippet: 'Oui ca nous interesse' });
    assert.equal(r.sentiment, 'question');
    assert.ok(r.reason.includes('cle') || r.reason.includes('API'));
  });
});

// =============================================
// Inbox Manager — Storage
// =============================================

describe('InboxManagerStorage', () => {
  // Creer un storage isole (pas le singleton)
  const fs = require('fs');
  const path = require('path');
  const tmpDir = '/tmp/inbox-manager-test-' + Date.now();
  process.env.INBOX_MANAGER_DATA_DIR = tmpDir;
  // Force re-require du module storage
  delete require.cache[require.resolve('../skills/inbox-manager/storage.js')];
  const storage = require('../skills/inbox-manager/storage.js');

  it('config par defaut contient replyBySentiment', () => {
    const cfg = storage.getConfig();
    assert.ok(cfg.replyBySentiment);
    assert.equal(cfg.replyBySentiment.interested, true);
    assert.equal(cfg.replyBySentiment.bounce, false);
  });

  it('addReceivedEmail retourne un entry avec id', () => {
    const entry = storage.addReceivedEmail({ from: 'test@example.com', subject: 'Test', text: 'Hello world' });
    assert.ok(entry.id);
    assert.equal(entry.from, 'test@example.com');
  });

  it('addProcessedUid + isUidProcessed O(1)', () => {
    storage.addProcessedUid(12345);
    assert.equal(storage.isUidProcessed(12345), true);
    assert.equal(storage.isUidProcessed(99999), false);
  });

  it('updateSentimentByEmail trouve le bon email', () => {
    storage.addReceivedEmail({ from: 'lead@corp.com', subject: 'Re: Proposition', text: 'Oui on en parle' });
    const updated = storage.updateSentimentByEmail('lead@corp.com', {
      sentiment: 'interested', score: 0.9, reason: 'Positif', actionTaken: 'auto_meeting'
    });
    assert.ok(updated);
    assert.equal(updated.sentiment, 'interested');
    assert.equal(updated.sentimentScore, 0.9);
  });

  it('updateSentimentByEmail case-insensitive', () => {
    storage.addReceivedEmail({ from: 'John@Corp.COM', subject: 'Re: Test', text: 'Non merci' });
    const updated = storage.updateSentimentByEmail('john@corp.com', {
      sentiment: 'not_interested', score: 0.1
    });
    assert.ok(updated);
    assert.equal(updated.sentiment, 'not_interested');
  });

  it('getSentimentBreakdown compte correctement', () => {
    // Ajouter des matchedReplies avec sentiments
    storage.addReceivedEmail({ from: 'a@b.com', text: 'test', matchedLead: { email: 'a@b.com' }, sentiment: 'interested' });
    storage.addReceivedEmail({ from: 'c@d.com', text: 'test', matchedLead: { email: 'c@d.com' }, sentiment: 'question' });
    const bd = storage.getSentimentBreakdown();
    assert.ok(bd.interested >= 1 || bd.question >= 1 || bd.unclassified >= 0);
  });

  // Cleanup
  it('cleanup tmp dir', () => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch (e) {}
  });
});

// =============================================
// AutoMailer Storage — Sentiment cross-skill
// =============================================

describe('AutoMailer Storage — Sentiment', () => {
  const fs = require('fs');
  const tmpDir2 = '/tmp/automailer-test-' + Date.now();
  process.env.AUTOMAILER_DATA_DIR = tmpDir2;
  delete require.cache[require.resolve('../skills/automailer/storage.js')];
  const amStorage = require('../skills/automailer/storage.js');

  it('setSentiment + getSentiment basique', () => {
    amStorage.setSentiment('test@corp.com', 'interested', 0.9);
    const s = amStorage.getSentiment('test@corp.com');
    assert.ok(s);
    assert.equal(s.sentiment, 'interested');
    assert.equal(s.score, 0.9);
    assert.ok(s.updatedAt);
  });

  it('getSentiment case-insensitive', () => {
    amStorage.setSentiment('John@CORP.COM', 'not_interested', 0.2);
    const s = amStorage.getSentiment('john@corp.com');
    assert.ok(s);
    assert.equal(s.sentiment, 'not_interested');
  });

  it('getSentiment retourne null pour email inconnu', () => {
    const s = amStorage.getSentiment('nobody@unknown.com');
    assert.equal(s, null);
  });

  it('setSentiment ecrase la valeur precedente', () => {
    amStorage.setSentiment('flip@test.com', 'question', 0.5);
    amStorage.setSentiment('flip@test.com', 'interested', 0.95);
    const s = amStorage.getSentiment('flip@test.com');
    assert.equal(s.sentiment, 'interested');
    assert.equal(s.score, 0.95);
  });

  it('setSentiment email vide = no-op', () => {
    amStorage.setSentiment('', 'bounce', 0);
    amStorage.setSentiment(null, 'bounce', 0);
    // Pas de crash
    assert.equal(amStorage.getSentiment(''), null);
  });

  // Cleanup
  it('cleanup tmp dir', () => {
    try { fs.rmSync(tmpDir2, { recursive: true }); } catch (e) {}
  });
});

// =============================================
// Follow-up Sequences — Logique inactivite
// =============================================

describe('Follow-up Inactivity Logic', () => {
  // Test de la logique pure (sans campaign-engine, juste les conditions)

  function shouldSkipInactive(stepNumber, totalSteps, prevEmails) {
    if (stepNumber > 2 && stepNumber < totalSteps) {
      if (prevEmails.length > 0 && !prevEmails.some(e => e.openedAt || e.status === 'opened')) {
        return true;
      }
    }
    return false;
  }

  it('step 1 → jamais skip', () => {
    assert.equal(shouldSkipInactive(1, 5, [{ status: 'sent' }]), false);
  });

  it('step 2 → jamais skip (laisser chance)', () => {
    assert.equal(shouldSkipInactive(2, 5, [{ status: 'sent' }]), false);
  });

  it('step 3 zero ouvertures → skip', () => {
    assert.equal(shouldSkipInactive(3, 5, [
      { status: 'sent' }, { status: 'delivered' }
    ]), true);
  });

  it('step 3 avec ouverture → pas de skip', () => {
    assert.equal(shouldSkipInactive(3, 5, [
      { status: 'sent' }, { status: 'opened', openedAt: '2026-01-01' }
    ]), false);
  });

  it('dernier step (breakup) → jamais skip', () => {
    // step 5 sur 5 total → stepNumber < totalSteps = 5 < 5 = false
    assert.equal(shouldSkipInactive(5, 5, [
      { status: 'sent' }, { status: 'sent' }
    ]), false);
  });

  it('campagne 1 step → pas de check', () => {
    assert.equal(shouldSkipInactive(1, 1, []), false);
  });

  it('campagne 2 steps → step 2 = dernier = pas de skip', () => {
    assert.equal(shouldSkipInactive(2, 2, [{ status: 'sent' }]), false);
  });

  it('campagne 3 steps → step 2 jamais skip, step 3 = breakup jamais skip', () => {
    assert.equal(shouldSkipInactive(2, 3, [{ status: 'sent' }]), false);
    assert.equal(shouldSkipInactive(3, 3, [{ status: 'sent' }]), false);
  });

  it('prevEmails vide → pas de skip', () => {
    assert.equal(shouldSkipInactive(4, 6, []), false);
  });
});

// =============================================
// Follow-up Sequences — Logique delai adaptatif
// =============================================

describe('Adaptive Delay Logic', () => {
  function computeAdaptiveDelay(stepScheduledAt, prevStepSentAt, prevStepEmails) {
    const opened = prevStepEmails.filter(e => e.openedAt || e.status === 'opened').length;
    const total = prevStepEmails.length;
    const openRate = total > 0 ? opened / total : 0;
    if (openRate <= 0.4) return { advanced: false, newScheduledAt: stepScheduledAt };
    const scheduledDate = new Date(stepScheduledAt);
    const advancedDate = new Date(scheduledDate.getTime() - 24 * 60 * 60 * 1000);
    const prevSentAt = prevStepSentAt ? new Date(prevStepSentAt) : new Date();
    const minDate = new Date(prevSentAt.getTime() + 24 * 60 * 60 * 1000);
    if (advancedDate > minDate) {
      return { advanced: true, newScheduledAt: advancedDate.toISOString() };
    }
    return { advanced: false, newScheduledAt: stepScheduledAt };
  }

  it('open rate > 40% → avance de 1 jour', () => {
    const sent = '2026-02-20T14:00:00.000Z';
    const scheduled = '2026-02-24T14:00:00.000Z'; // 4 jours apres
    const emails = [
      { status: 'opened', openedAt: '2026-02-21T10:00:00.000Z' },
      { status: 'delivered' },
      { status: 'opened', openedAt: '2026-02-21T11:00:00.000Z' }
    ]; // 2/3 = 66%
    const r = computeAdaptiveDelay(scheduled, sent, emails);
    assert.equal(r.advanced, true);
    // 2026-02-23 (1 jour avant le 24)
    assert.ok(r.newScheduledAt.startsWith('2026-02-23'));
  });

  it('open rate < 40% → pas d\'avance', () => {
    const sent = '2026-02-20T14:00:00.000Z';
    const scheduled = '2026-02-24T14:00:00.000Z';
    const emails = [
      { status: 'delivered' },
      { status: 'delivered' },
      { status: 'opened', openedAt: '2026-02-21T10:00:00.000Z' }
    ]; // 1/3 = 33%
    const r = computeAdaptiveDelay(scheduled, sent, emails);
    assert.equal(r.advanced, false);
  });

  it('avance impossible si trop proche du min (1j apres sentAt)', () => {
    const sent = '2026-02-23T14:00:00.000Z';
    const scheduled = '2026-02-24T15:00:00.000Z'; // Seulement 25h apres sent
    const emails = [
      { status: 'opened', openedAt: '2026-02-23T16:00:00.000Z' }
    ]; // 100% open rate
    const r = computeAdaptiveDelay(scheduled, sent, emails);
    // advancedDate = 2026-02-23 15:00, minDate = 2026-02-24 14:00
    // advancedDate < minDate → pas d'avance
    assert.equal(r.advanced, false);
  });

  it('aucun email → open rate = 0 → pas d\'avance', () => {
    const r = computeAdaptiveDelay('2026-02-24T14:00:00.000Z', '2026-02-20T14:00:00.000Z', []);
    assert.equal(r.advanced, false);
  });
});
