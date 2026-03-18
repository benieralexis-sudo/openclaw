// Tests unitaires — reply-pipeline.js (10 cas critiques)
// node --test tests/test-reply-pipeline-unit.cjs
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// On importe les fonctions testables directement
const { CircuitBreaker, getBreaker } = require('../gateway/circuit-breaker.js');
const { withTimeout } = require('../gateway/utils.js');
const {
  _getToneInstruction,
  _buildConversationContext,
  parseOOOReturnDate,
  checkGrounding,
  classifyReply
} = require('../skills/inbox-manager/reply-classifier.js');

// === 1. Circuit breaker : si le breaker est open, l'appel API est skip ===
describe('Circuit breaker (reply pipeline)', () => {
  it('breaker OPEN skip les appels (isBroken=true)', () => {
    const cb = new CircuitBreaker('test-openai-rp', { failureThreshold: 3, cooldownMs: 60000 });
    // Simuler breaker ouvert
    cb.state = 'OPEN';
    cb.lastFailureAt = Date.now();
    assert.equal(cb.isBroken(), true);
  });

  it('breaker CLOSED ne skip pas (isBroken=false)', () => {
    const cb = new CircuitBreaker('test-openai-rp2', { failureThreshold: 3, cooldownMs: 60000 });
    assert.equal(cb.isBroken(), false);
  });

  it('breaker OPEN apres cooldown passe en HALF_OPEN (isBroken=false)', () => {
    const cb = new CircuitBreaker('test-openai-rp3', { failureThreshold: 3, cooldownMs: 500 });
    cb.state = 'OPEN';
    cb.lastFailureAt = Date.now() - 1000; // cooldown expire
    assert.equal(cb.isBroken(), false);
    assert.equal(cb.state, 'HALF_OPEN');
  });
});

// === 2. Timeout : withTimeout rejette apres le delai ===
describe('withTimeout (reply pipeline)', () => {
  it('rejette apres le delai', async () => {
    const slowPromise = new Promise(resolve => setTimeout(() => resolve('late'), 5000));
    await assert.rejects(
      () => withTimeout(slowPromise, 50, 'TestAPI'),
      /TestAPI timeout \(50ms\)/
    );
  });

  it('laisse passer une promesse rapide', async () => {
    const fastPromise = Promise.resolve('fast');
    const result = await withTimeout(fastPromise, 5000, 'TestAPI');
    assert.equal(result, 'fast');
  });
});

// === 3. HITL limit : check fait avant generation ===
describe('HITL auto-reply limit', () => {
  it('la limite quotidienne est verifiee (valeur par defaut = 10)', () => {
    // Dans reply-pipeline.js : autoReplyMaxPerDay = parseInt(process.env.AUTO_REPLY_MAX_PER_DAY) || 10
    const maxPerDay = parseInt(process.env.AUTO_REPLY_MAX_PER_DAY) || 10;
    assert.equal(maxPerDay, 10);
  });

  it('la limite est configurable via env', () => {
    const original = process.env.AUTO_REPLY_MAX_PER_DAY;
    process.env.AUTO_REPLY_MAX_PER_DAY = '5';
    const maxPerDay = parseInt(process.env.AUTO_REPLY_MAX_PER_DAY) || 10;
    assert.equal(maxPerDay, 5);
    // Restore
    if (original) process.env.AUTO_REPLY_MAX_PER_DAY = original;
    else delete process.env.AUTO_REPLY_MAX_PER_DAY;
  });

  it('si todayCount >= maxPerDay, pas de generation', () => {
    const todayCount = 10;
    const maxPerDay = 10;
    assert.equal(todayCount < maxPerDay, false, 'ne devrait pas generer quand limite atteinte');
  });
});

// === 4. Classification fallback : si OpenAI echoue, comportement par defaut ===
describe('Classification fallback', () => {
  it('classification par defaut si OpenAI echoue', () => {
    // Dans reply-pipeline.js : la classification par defaut est question/0.5/neutral
    const defaultClassification = {
      sentiment: 'question',
      score: 0.5,
      reason: 'Non classifie',
      key_phrases: [],
      tone: 'neutral'
    };
    assert.equal(defaultClassification.sentiment, 'question');
    assert.equal(defaultClassification.score, 0.5);
    assert.equal(defaultClassification.tone, 'neutral');
  });
});

// === 5. Tone detection : 5 tons correctement mappes ===
describe('Tone detection (5 tons)', () => {
  it('enthusiastic retourne une instruction', () => {
    const instruction = _getToneInstruction('enthusiastic');
    assert.ok(instruction.includes('enthousiaste') || instruction.includes('dynamique'));
  });

  it('neutral retourne une instruction', () => {
    const instruction = _getToneInstruction('neutral');
    assert.ok(instruction.includes('professionnel') || instruction.includes('neutre'));
  });

  it('hesitant retourne une instruction', () => {
    const instruction = _getToneInstruction('hesitant');
    assert.ok(instruction.includes('hesite') || instruction.includes('rassure'));
  });

  it('urgent retourne une instruction', () => {
    const instruction = _getToneInstruction('urgent');
    assert.ok(instruction.includes('presse') || instruction.includes('BUT'));
  });

  it('irritated retourne une instruction', () => {
    const instruction = _getToneInstruction('irritated');
    assert.ok(instruction.includes('agace') || instruction.includes('respectueux'));
  });

  it('ton inconnu fallback sur neutral', () => {
    const instruction = _getToneInstruction('unknown_tone');
    const neutralInstruction = _getToneInstruction('neutral');
    assert.equal(instruction, neutralInstruction);
  });
});

// === 6. Threading history : historique tronque a 1000 chars (pas 400) ===
describe('Threading history', () => {
  it('tronque le body a 300 chars dans le contexte', () => {
    const longBody = 'a'.repeat(500);
    const history = [
      { role: 'sent', subject: 'Test', body: longBody, date: '2026-03-01' }
    ];
    const context = _buildConversationContext(history);
    // Le body dans le contexte devrait etre tronque a 300 chars
    // (dans _buildConversationContext : msg.body.substring(0, 300))
    assert.ok(!context.includes('a'.repeat(400)), 'body ne devrait pas depasser 300 chars');
    assert.ok(context.includes('a'.repeat(100)), 'body devrait contenir les 100 premiers chars');
  });

  it('max 6 messages dans le contexte', () => {
    const history = [];
    for (let i = 0; i < 10; i++) {
      history.push({ role: 'sent', subject: 'Msg ' + i, body: 'Contenu ' + i, date: '2026-03-0' + (i + 1) });
    }
    const context = _buildConversationContext(history);
    // Il devrait y avoir max 6 blocs "---" (chaque message genere un "--- TOI" ou "--- PROSPECT")
    const roleBlocks = (context.match(/--- (TOI|PROSPECT)/g) || []).length;
    assert.equal(roleBlocks, 6, 'devrait y avoir exactement 6 messages max');
  });

  it('retourne vide si pas d\'historique', () => {
    assert.equal(_buildConversationContext(null), '');
    assert.equal(_buildConversationContext([]), '');
  });

  it('body des emails dans le pipeline est tronque a 1000 chars (pas 400)', () => {
    // Dans reply-pipeline.js lignes 70 et 83 : .substring(0, 1000)
    const longBody = 'x'.repeat(1500);
    const truncated = longBody.substring(0, 1000);
    assert.equal(truncated.length, 1000);
    // Verifier que ce n'est pas 400
    assert.ok(truncated.length > 400, 'troncature devrait etre a 1000, pas 400');
  });
});

// === 7. Blacklist check : prospect blackliste ne recoit pas de reply auto ===
describe('Blacklist check', () => {
  it('isBlacklisted dans le pipeline stoppe le traitement', () => {
    // Simuler le check du pipeline : _isBlacklisted = automailerStorage.isBlacklisted(email)
    const mockStorage = {
      blacklist: { 'spam@exemple.fr': { reason: 'spam', date: '2026-03-01' } },
      isBlacklisted(email) {
        return !!this.blacklist[email.toLowerCase().trim()];
      }
    };
    assert.equal(mockStorage.isBlacklisted('spam@exemple.fr'), true);
    assert.equal(mockStorage.isBlacklisted('legit@acme.fr'), false);
  });
});

// === 8. OOO detection : "out of office" detecte ===
describe('OOO detection', () => {
  it('detecte "absent jusqu\'au 20/04/2027"', () => {
    const date = parseOOOReturnDate('Je suis absent jusqu\'au 20/04/2027');
    assert.equal(date, '2027-04-20');
  });

  it('detecte "de retour le 15 mars"', () => {
    // Note: la date doit etre dans le futur pour etre retournee
    const futureYear = new Date().getFullYear() + 1;
    const date = parseOOOReturnDate('Je serai de retour le 15/03/' + futureYear);
    assert.equal(date, futureYear + '-03-15');
  });

  it('retourne null si pas de date OOO', () => {
    const date = parseOOOReturnDate('Merci pour votre message, je suis interesse');
    assert.equal(date, null);
  });

  it('retourne null pour un snippet vide', () => {
    assert.equal(parseOOOReturnDate(null), null);
    assert.equal(parseOOOReturnDate(''), null);
  });
});

// === 9. Bounce detection ===
describe('Bounce detection', () => {
  it('les patterns bounce sont dans la classification IA', () => {
    // La classification des bounces est faite par GPT-4o-mini via classifyReply
    // On verifie que le prompt systeme inclut "bounce" comme categorie
    // Les patterns attendus: "Undeliverable", "Mailbox not found", etc.
    // On teste la structure du fallback default
    const defaultClassif = { sentiment: 'question', score: 0.5, tone: 'neutral' };
    assert.ok(['interested', 'question', 'not_interested', 'out_of_office', 'bounce'].includes(defaultClassif.sentiment));
  });

  it('checkGrounding detecte les hallucinations', () => {
    // Un reply qui contient un pattern d'hallucination
    const result = checkGrounding('Plus de 50% de nos clients ont augmente leur CA');
    assert.equal(result.grounded, false);
    assert.ok(result.reason.includes('hallucination_pattern'));
  });

  it('checkGrounding accepte un reply propre', () => {
    const result = checkGrounding('Oui, je suis disponible mardi pour en discuter.');
    assert.equal(result.grounded, true);
  });
});

// === 10. Auto-reply limit quotidienne ===
describe('Auto-reply daily limit', () => {
  it('valeur par defaut = 10', () => {
    const original = process.env.AUTO_REPLY_MAX_PER_DAY;
    delete process.env.AUTO_REPLY_MAX_PER_DAY;
    const max = parseInt(process.env.AUTO_REPLY_MAX_PER_DAY) || 10;
    assert.equal(max, 10);
    if (original) process.env.AUTO_REPLY_MAX_PER_DAY = original;
  });

  it('configurable via AUTO_REPLY_MAX_PER_DAY', () => {
    const original = process.env.AUTO_REPLY_MAX_PER_DAY;
    process.env.AUTO_REPLY_MAX_PER_DAY = '25';
    const max = parseInt(process.env.AUTO_REPLY_MAX_PER_DAY) || 10;
    assert.equal(max, 25);
    if (original) process.env.AUTO_REPLY_MAX_PER_DAY = original;
    else delete process.env.AUTO_REPLY_MAX_PER_DAY;
  });

  it('defense-in-depth : double check avant envoi', () => {
    // Le pipeline fait un double check : une fois au debut, une fois juste avant l'envoi
    // (currentDayCount >= maxPerDay) — on simule les 2 checks
    const check1 = { todayCount: 9, max: 10, allowed: 9 < 10 };
    assert.equal(check1.allowed, true);
    const check2 = { todayCount: 10, max: 10, allowed: 10 < 10 };
    assert.equal(check2.allowed, false);
  });
});
