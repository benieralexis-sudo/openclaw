// Tests — quota-manager (Phase B5)
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const TEST_DIR = '/tmp/quota-test-' + process.pid;

let _envSnapshot;
function snapshot() { _envSnapshot = { ...process.env }; }
function restore() {
  for (const k of Object.keys(process.env)) {
    if (!(k in _envSnapshot)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(_envSnapshot)) process.env[k] = v;
}

function fresh() {
  delete require.cache[require.resolve('./quota-manager.js')];
  return require('./quota-manager.js');
}

describe('quota-manager basic', () => {
  beforeEach(() => {
    snapshot();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    process.env.QUOTA_DIR = TEST_DIR;
    process.env.CLIENT_NAME = 'tenant-a';
  });
  afterEach(() => {
    restore();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('check() does not throw when under limit', () => {
    process.env.QUOTA_CLAUDE_TOKENS_DAILY = '1000';
    const { forCurrentTenant } = fresh();
    const q = forCurrentTenant();
    assert.doesNotThrow(() => q.check('claude:tokens_daily', 500));
    assert.equal(q.usage('claude:tokens_daily'), 0, 'check() should not mutate');
  });

  it('check() throws when amount would exceed limit', () => {
    process.env.QUOTA_CLAUDE_TOKENS_DAILY = '1000';
    const { forCurrentTenant } = fresh();
    const q = forCurrentTenant();
    q.increment('claude:tokens_daily', 600);
    assert.throws(
      () => q.check('claude:tokens_daily', 500),
      err => err.code === 'QUOTA_EXCEEDED' && err.resource === 'claude:tokens_daily'
    );
  });

  it('consume() = check + increment atomically', () => {
    process.env.QUOTA_CLAUDE_TOKENS_DAILY = '1000';
    const { forCurrentTenant } = fresh();
    const q = forCurrentTenant();
    assert.equal(q.consume('claude:tokens_daily', 300), 300);
    assert.equal(q.consume('claude:tokens_daily', 400), 700);
    assert.throws(() => q.consume('claude:tokens_daily', 400), err => err.code === 'QUOTA_EXCEEDED');
    assert.equal(q.usage('claude:tokens_daily'), 700, 'failed consume should not increment');
  });

  it('remaining() returns Infinity when no limit configured', () => {
    delete process.env.QUOTA_CLAUDE_TOKENS_DAILY;
    const { forCurrentTenant, DEFAULT_LIMITS } = fresh();
    DEFAULT_LIMITS['claude:tokens_daily'] = 0; // mark unlimited for this test
    const q = forCurrentTenant();
    assert.equal(q.remaining('claude:tokens_daily'), Infinity);
    DEFAULT_LIMITS['claude:tokens_daily'] = 500000; // restore
  });
});

describe('per-tenant isolation', () => {
  beforeEach(() => {
    snapshot();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    process.env.QUOTA_DIR = TEST_DIR;
  });
  afterEach(() => {
    restore();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('different tenants have separate usage counters', () => {
    process.env.CLIENT_NAME = 'tenant-a';
    process.env.QUOTA_CLAUDE_TOKENS_DAILY = '1000';
    const { forCurrentTenant } = fresh();
    const q = forCurrentTenant();
    q.increment('claude:tokens_daily', 500, 'tenant-a');
    q.increment('claude:tokens_daily', 200, 'tenant-b');
    assert.equal(q.usage('claude:tokens_daily', 'tenant-a'), 500);
    assert.equal(q.usage('claude:tokens_daily', 'tenant-b'), 200);
  });

  it('tenant-specific QUOTA_X_TENANT overrides global QUOTA_X', () => {
    process.env.CLIENT_NAME = 'tenant-a';
    process.env.QUOTA_CLAUDE_TOKENS_DAILY = '1000';
    process.env.QUOTA_CLAUDE_TOKENS_DAILY_TENANT_B = '50';
    const { forCurrentTenant } = fresh();
    const q = forCurrentTenant();
    // tenant-a uses global limit
    assert.doesNotThrow(() => q.check('claude:tokens_daily', 800, 'tenant-a'));
    // tenant-b uses smaller per-tenant limit
    assert.throws(() => q.check('claude:tokens_daily', 100, 'tenant-b'), err => err.code === 'QUOTA_EXCEEDED');
  });
});

describe('persistence', () => {
  beforeEach(() => {
    snapshot();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    process.env.QUOTA_DIR = TEST_DIR;
    process.env.CLIENT_NAME = 'tenant-a';
  });
  afterEach(() => {
    restore();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('survives module reload via .json file', () => {
    process.env.QUOTA_CLAUDE_TOKENS_DAILY = '1000';
    let mod = fresh();
    let q = mod.forCurrentTenant();
    q.increment('claude:tokens_daily', 333);
    q._save ? q._save() : null;
    // hack: trigger save by reaching into instance
    const QuotaStoreCtor = Object.getPrototypeOf(q).constructor;
    QuotaStoreCtor.prototype._save.call(q);
    // reload
    mod = fresh();
    const q2 = mod.forCurrentTenant();
    assert.equal(q2.usage('claude:tokens_daily'), 333);
  });
});

describe('snapshot', () => {
  beforeEach(() => {
    snapshot();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    process.env.QUOTA_DIR = TEST_DIR;
    process.env.CLIENT_NAME = 'tenant-a';
  });
  afterEach(() => {
    restore();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns used/limit/percent per resource', () => {
    process.env.QUOTA_CLAUDE_TOKENS_DAILY = '1000';
    const { forCurrentTenant } = fresh();
    const q = forCurrentTenant();
    q.increment('claude:tokens_daily', 250);
    const snap = q.snapshot();
    assert.equal(snap['claude:tokens_daily'].used, 250);
    assert.equal(snap['claude:tokens_daily'].limit, 1000);
    assert.equal(snap['claude:tokens_daily'].percent, 25);
  });
});
