// Tests unitaires — gateway/utils.js (3 cas critiques)
// node --test tests/test-utils-unit.cjs
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { atomicWriteSync, withTimeout } = require('../gateway/utils.js');

// === 1. atomicWriteSync : writes en queue ne sont pas perdus ===
describe('atomicWriteSync', () => {
  const tmpDir = os.tmpdir();
  let testFile;

  beforeEach(() => {
    testFile = path.join(tmpDir, 'test-atomic-' + Date.now() + '.json');
  });

  it('ecrit un fichier atomiquement', () => {
    const data = { key: 'value', count: 42 };
    atomicWriteSync(testFile, data);

    const content = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    assert.deepEqual(content, data);

    // Cleanup
    fs.unlinkSync(testFile);
  });

  it('ecrit via tmp + rename (pas de corruption)', () => {
    // Verifier que le fichier .tmp n'existe pas apres l'ecriture
    const data = { safe: true };
    atomicWriteSync(testFile, data);

    const tmpFile = testFile + '.tmp';
    assert.equal(fs.existsSync(tmpFile), false, 'le fichier .tmp ne devrait plus exister');
    assert.equal(fs.existsSync(testFile), true, 'le fichier final devrait exister');

    // Cleanup
    fs.unlinkSync(testFile);
  });

  it('les writes successifs ne perdent pas de donnees', () => {
    // Simuler 3 writes successifs — le dernier doit gagner
    atomicWriteSync(testFile, { version: 1 });
    atomicWriteSync(testFile, { version: 2 });
    atomicWriteSync(testFile, { version: 3 });

    const content = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    assert.equal(content.version, 3, 'le dernier write doit etre celui sur disque');

    // Cleanup
    fs.unlinkSync(testFile);
  });

  it('gere les donnees complexes (arrays, nested objects)', () => {
    const complexData = {
      emails: [
        { to: 'a@b.com', status: 'sent' },
        { to: 'c@d.com', status: 'delivered' }
      ],
      stats: { opens: 5, clicks: 2 },
      tags: ['campaign-1', 'test']
    };
    atomicWriteSync(testFile, complexData);

    const content = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    assert.deepEqual(content, complexData);

    // Cleanup
    fs.unlinkSync(testFile);
  });
});

// === 2. withTimeout : rejet apres timeout ===
describe('withTimeout', () => {
  it('rejette apres timeout avec le bon message', async () => {
    const slowPromise = new Promise(resolve => setTimeout(() => resolve('done'), 10000));
    await assert.rejects(
      () => withTimeout(slowPromise, 50, 'SlowAPI'),
      (err) => {
        assert.ok(err.message.includes('SlowAPI'));
        assert.ok(err.message.includes('timeout'));
        assert.ok(err.message.includes('50ms'));
        return true;
      }
    );
  });

  // === 3. withTimeout : promesse reussie passe ===
  it('laisse passer une promesse reussie avant le timeout', async () => {
    const fastPromise = Promise.resolve('success');
    const result = await withTimeout(fastPromise, 5000, 'FastAPI');
    assert.equal(result, 'success');
  });

  it('laisse passer une promesse qui resolve avec un delai court', async () => {
    const promise = new Promise(resolve => setTimeout(() => resolve('ok'), 10));
    const result = await withTimeout(promise, 1000, 'ShortDelay');
    assert.equal(result, 'ok');
  });

  it('rejette si la promesse elle-meme rejette', async () => {
    const failingPromise = Promise.reject(new Error('API error'));
    await assert.rejects(
      () => withTimeout(failingPromise, 5000, 'FailAPI'),
      { message: 'API error' }
    );
  });
});
