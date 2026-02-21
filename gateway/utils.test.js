// Tests — gateway/utils.js (node:test)
const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Import des fonctions pures (pas besoin de mock fs pour celles-ci)
const { retryAsync, truncateInput, isValidEmail, sanitize } = require('./utils.js');

// --- retryAsync ---

describe('retryAsync', () => {
  it('retourne le resultat au premier essai', async () => {
    let calls = 0;
    const result = await retryAsync(() => { calls++; return Promise.resolve('ok'); }, 2, 10);
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  it('retry apres echec puis succes', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('fail'));
      return Promise.resolve('ok');
    };
    const result = await retryAsync(fn, 2, 10);
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  it('lance l\'erreur apres maxRetries echecs', async () => {
    let calls = 0;
    const fn = () => { calls++; return Promise.reject(new Error('always fail')); };
    await assert.rejects(() => retryAsync(fn, 2, 10), { message: 'always fail' });
    assert.equal(calls, 3); // attempt 0, 1, 2
  });

  it('utilise les valeurs par defaut', async () => {
    const result = await retryAsync(() => Promise.resolve('default'));
    assert.equal(result, 'default');
  });
});

// --- truncateInput ---

describe('truncateInput', () => {
  it('retourne le texte tel quel si court', () => {
    assert.equal(truncateInput('hello'), 'hello');
  });

  it('tronque a maxLen caracteres', () => {
    const long = 'a'.repeat(3000);
    assert.equal(truncateInput(long, 100).length, 100);
  });

  it('utilise maxLen=2000 par defaut', () => {
    const long = 'b'.repeat(5000);
    assert.equal(truncateInput(long).length, 2000);
  });

  it('gere null/undefined/vide', () => {
    assert.equal(truncateInput(null), null);
    assert.equal(truncateInput(undefined), undefined);
    assert.equal(truncateInput(''), '');
  });
});

// --- isValidEmail ---

describe('isValidEmail', () => {
  it('accepte les emails valides', () => {
    assert.equal(isValidEmail('test@example.com'), true);
    assert.equal(isValidEmail('user.name+tag@domain.co.uk'), true);
    assert.equal(isValidEmail('hello@ifind.fr'), true);
  });

  it('rejette les emails invalides', () => {
    assert.equal(isValidEmail(''), false);
    assert.equal(isValidEmail(null), false);
    assert.equal(isValidEmail(undefined), false);
    assert.equal(isValidEmail(123), false);
    assert.equal(isValidEmail('not-an-email'), false);
    assert.equal(isValidEmail('@domain.com'), false);
    assert.equal(isValidEmail('user@'), false);
    assert.equal(isValidEmail('user@domain.c'), false); // TLD trop court
  });

  it('rejette si > 254 caracteres', () => {
    const long = 'a'.repeat(250) + '@b.com';
    assert.equal(isValidEmail(long), false);
  });

  it('trim les espaces autour', () => {
    assert.equal(isValidEmail(' test@example.com '), true);
  });
});

// --- sanitize ---

describe('sanitize', () => {
  it('echappe les entites HTML', () => {
    assert.equal(
      sanitize('<script>alert("xss")</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('echappe & < > " \'', () => {
    assert.equal(sanitize('a & b'), 'a &amp; b');
    assert.equal(sanitize("it's"), "it&#39;s");
  });

  it('retourne chaine vide pour null/undefined/non-string', () => {
    assert.equal(sanitize(null), '');
    assert.equal(sanitize(undefined), '');
    assert.equal(sanitize(123), '');
  });

  it('retourne la meme chaine si pas de caracteres speciaux', () => {
    assert.equal(sanitize('hello world'), 'hello world');
  });
});
