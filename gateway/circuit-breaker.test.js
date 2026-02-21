// Tests — CircuitBreaker (node:test)
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { CircuitBreaker, getBreaker, getAllStatus } = require('./circuit-breaker.js');

describe('CircuitBreaker', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker('test-svc', { failureThreshold: 3, cooldownMs: 500 });
  });

  it('initialise en etat CLOSED', () => {
    assert.equal(cb.state, 'CLOSED');
    assert.equal(cb.failures, 0);
    assert.equal(cb.name, 'test-svc');
  });

  it('appel reussi reste CLOSED', async () => {
    const result = await cb.call(async () => 'ok');
    assert.equal(result, 'ok');
    assert.equal(cb.state, 'CLOSED');
    assert.equal(cb.failures, 0);
  });

  it('compteur failures incremente sur echec', async () => {
    await assert.rejects(() => cb.call(async () => { throw new Error('fail'); }), { message: 'fail' });
    assert.equal(cb.failures, 1);
    assert.equal(cb.state, 'CLOSED');
  });

  it('passe OPEN apres failureThreshold echecs', async () => {
    for (let i = 0; i < 3; i++) {
      await assert.rejects(() => cb.call(async () => { throw new Error('f'); }));
    }
    assert.equal(cb.state, 'OPEN');
    assert.equal(cb.failures, 3);
  });

  it('OPEN rejette immediatement (fail-fast)', async () => {
    cb.state = 'OPEN';
    cb.lastFailureAt = Date.now();
    await assert.rejects(() => cb.call(async () => 'ok'), /indisponible/);
  });

  it('OPEN → HALF_OPEN → CLOSED apres cooldown + succes', async () => {
    cb.state = 'OPEN';
    cb.lastFailureAt = Date.now() - 1000; // > cooldownMs (500ms)
    const result = await cb.call(async () => 'recovered');
    assert.equal(result, 'recovered');
    assert.equal(cb.state, 'CLOSED');
  });

  it('HALF_OPEN + succes → CLOSED avec reset failures', async () => {
    cb.state = 'HALF_OPEN';
    cb.failures = 3;
    const result = await cb.call(async () => 'ok');
    assert.equal(result, 'ok');
    assert.equal(cb.state, 'CLOSED');
    assert.equal(cb.failures, 0);
  });

  it('HALF_OPEN + echec continue d\'incrementer', async () => {
    cb.state = 'HALF_OPEN';
    cb.failures = 3;
    await assert.rejects(() => cb.call(async () => { throw new Error('x'); }));
    assert.equal(cb.failures, 4);
  });

  it('reset() remet a zero', () => {
    cb.state = 'OPEN';
    cb.failures = 10;
    cb.reset();
    assert.equal(cb.state, 'CLOSED');
    assert.equal(cb.failures, 0);
  });

  it('getStatus() retourne l\'etat courant', () => {
    cb.failures = 2;
    const status = cb.getStatus();
    assert.deepEqual(status, { name: 'test-svc', state: 'CLOSED', failures: 2 });
  });

  it('valeurs par defaut (failureThreshold=5, cooldownMs=30000)', () => {
    const def = new CircuitBreaker('default');
    assert.equal(def.failureThreshold, 5);
    assert.equal(def.cooldownMs, 30000);
  });
});

describe('getBreaker (registre global)', () => {
  it('retourne la meme instance pour le meme nom', () => {
    const a = getBreaker('singleton-test', { failureThreshold: 2 });
    const b = getBreaker('singleton-test');
    assert.strictEqual(a, b);
  });

  it('retourne des instances differentes pour des noms differents', () => {
    const a = getBreaker('svc-a');
    const b = getBreaker('svc-b');
    assert.notStrictEqual(a, b);
  });
});

describe('getAllStatus', () => {
  it('retourne le statut de tous les breakers', () => {
    getBreaker('status-1');
    getBreaker('status-2');
    const all = getAllStatus();
    assert.ok(all['status-1']);
    assert.ok(all['status-2']);
    assert.equal(all['status-1'].state, 'CLOSED');
  });
});
