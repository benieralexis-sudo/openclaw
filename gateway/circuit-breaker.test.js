// Tests — CircuitBreaker (node:test)
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { CircuitBreaker, getBreaker, getAllStatus, resetForTenant } = require('./circuit-breaker.js');

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

// Phase B1 — per-tenant isolation
describe('Per-tenant isolation', () => {
  beforeEach(() => {
    delete process.env.CLIENT_NAME;
  });

  it('isole les breakers par opts.clientId', async () => {
    const aBreaker = getBreaker('shared-svc', { clientId: 'tenant-a', failureThreshold: 2 });
    const bBreaker = getBreaker('shared-svc', { clientId: 'tenant-b', failureThreshold: 2 });
    assert.notStrictEqual(aBreaker, bBreaker, 'breakers should be distinct per tenant');

    // tenant-a fails twice → OPEN
    for (let i = 0; i < 2; i++) {
      await assert.rejects(() => aBreaker.call(async () => { throw new Error('a-fail'); }));
    }
    assert.equal(aBreaker.state, 'OPEN');
    // tenant-b should remain CLOSED
    assert.equal(bBreaker.state, 'CLOSED');
    const result = await bBreaker.call(async () => 'b-ok');
    assert.equal(result, 'b-ok');
  });

  it('process.env.CLIENT_NAME isole automatiquement', () => {
    process.env.CLIENT_NAME = 'fimmop';
    const fimmopBreaker = getBreaker('auto-isolated-svc');
    process.env.CLIENT_NAME = 'digitestlab';
    const digitestlabBreaker = getBreaker('auto-isolated-svc');
    delete process.env.CLIENT_NAME;
    const globalBreaker = getBreaker('auto-isolated-svc');
    assert.notStrictEqual(fimmopBreaker, digitestlabBreaker);
    assert.notStrictEqual(fimmopBreaker, globalBreaker);
    assert.notStrictEqual(digitestlabBreaker, globalBreaker);
  });

  it('legacy getBreaker(name) sans clientId reste partage', () => {
    const a = getBreaker('legacy-shared');
    const b = getBreaker('legacy-shared');
    assert.strictEqual(a, b);
  });

  it('resetForTenant ne reset que les breakers du tenant cible', async () => {
    const a = getBreaker('reset-svc', { clientId: 'reset-a', failureThreshold: 2 });
    const b = getBreaker('reset-svc', { clientId: 'reset-b', failureThreshold: 2 });
    for (let i = 0; i < 2; i++) {
      await assert.rejects(() => a.call(async () => { throw new Error('x'); }));
      await assert.rejects(() => b.call(async () => { throw new Error('x'); }));
    }
    assert.equal(a.state, 'OPEN');
    assert.equal(b.state, 'OPEN');
    resetForTenant('reset-a');
    assert.equal(a.state, 'CLOSED');
    assert.equal(b.state, 'OPEN', 'tenant-b breaker should not be reset');
  });

  it('getAllStatus() expose les breakers per-tenant avec key prefixee', () => {
    getBreaker('exposed-svc', { clientId: 'tenant-x' });
    const all = getAllStatus();
    assert.ok(all['tenant-x:exposed-svc'], 'expected key with tenant prefix');
  });
});
