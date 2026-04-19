// Tests — webhook-tenant (Phase B2)
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  resolveTenantFromSecret,
  resolveTenantFromHmac,
  listTenantsFor,
  GLOBAL_TENANT,
} = require('./webhook-tenant.js');

let _envSnapshot;
function snapshot() { _envSnapshot = { ...process.env }; }
function restore() {
  for (const k of Object.keys(process.env)) {
    if (!(k in _envSnapshot)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(_envSnapshot)) process.env[k] = v;
}

describe('resolveTenantFromSecret', () => {
  beforeEach(() => snapshot());
  afterEach(() => restore());

  it('returns null when no secret configured', () => {
    delete process.env.PHAROW_WEBHOOK_SECRET;
    assert.equal(resolveTenantFromSecret('anything', 'PHAROW_WEBHOOK_SECRET'), null);
  });

  it('returns null when header is empty', () => {
    process.env.PHAROW_WEBHOOK_SECRET = 'global-secret';
    assert.equal(resolveTenantFromSecret('', 'PHAROW_WEBHOOK_SECRET'), null);
    assert.equal(resolveTenantFromSecret(null, 'PHAROW_WEBHOOK_SECRET'), null);
  });

  it('matches global secret → __global__', () => {
    process.env.PHAROW_WEBHOOK_SECRET = 'global-secret-xyz';
    assert.equal(resolveTenantFromSecret('global-secret-xyz', 'PHAROW_WEBHOOK_SECRET'), GLOBAL_TENANT);
  });

  it('matches tenant-specific secret → tenant name', () => {
    process.env.PHAROW_WEBHOOK_SECRET_FIMMOP = 'fimmop-secret-abc';
    process.env.PHAROW_WEBHOOK_SECRET_DIGITESTLAB = 'digitestlab-secret-def';
    assert.equal(resolveTenantFromSecret('fimmop-secret-abc', 'PHAROW_WEBHOOK_SECRET'), 'fimmop');
    assert.equal(resolveTenantFromSecret('digitestlab-secret-def', 'PHAROW_WEBHOOK_SECRET'), 'digitestlab');
  });

  it('tenant-specific takes priority over global', () => {
    process.env.PHAROW_WEBHOOK_SECRET = 'global';
    process.env.PHAROW_WEBHOOK_SECRET_FIMMOP = 'fimmop';
    assert.equal(resolveTenantFromSecret('fimmop', 'PHAROW_WEBHOOK_SECRET'), 'fimmop');
    assert.equal(resolveTenantFromSecret('global', 'PHAROW_WEBHOOK_SECRET'), GLOBAL_TENANT);
  });

  it('strips Bearer prefix from header', () => {
    process.env.PHAROW_WEBHOOK_SECRET_FIMMOP = 'mysecret';
    assert.equal(resolveTenantFromSecret('Bearer mysecret', 'PHAROW_WEBHOOK_SECRET'), 'fimmop');
    assert.equal(resolveTenantFromSecret('bearer  mysecret  ', 'PHAROW_WEBHOOK_SECRET'), 'fimmop');
  });

  it('returns null on invalid secret', () => {
    process.env.PHAROW_WEBHOOK_SECRET = 'global';
    process.env.PHAROW_WEBHOOK_SECRET_FIMMOP = 'fimmop';
    assert.equal(resolveTenantFromSecret('wrong-secret', 'PHAROW_WEBHOOK_SECRET'), null);
  });

  it('does not confuse PREFIX with PREFIX_GLOBAL', () => {
    // env vars exactly equal to the prefix are the global secret, not a tenant
    process.env.PHAROW_WEBHOOK_SECRET = 'global';
    assert.equal(resolveTenantFromSecret('global', 'PHAROW_WEBHOOK_SECRET'), GLOBAL_TENANT);
    // listing tenants should NOT include 'pharow_webhook_secret' as a tenant
    const tenants = listTenantsFor('PHAROW_WEBHOOK_SECRET');
    assert.deepEqual(tenants, [GLOBAL_TENANT]);
  });
});

describe('resolveTenantFromHmac', () => {
  beforeEach(() => snapshot());
  afterEach(() => restore());

  it('matches HMAC against tenant secret', () => {
    process.env.RODZ_WEBHOOK_SECRET_FIMMOP = 'fimmop-rodz-secret';
    process.env.RODZ_WEBHOOK_SECRET_DIGITESTLAB = 'digitestlab-rodz-secret';
    const body = '{"signal":"funding_round"}';
    const fimmopSig = crypto.createHmac('sha256', 'fimmop-rodz-secret').update(body).digest('hex');
    const dlSig = crypto.createHmac('sha256', 'digitestlab-rodz-secret').update(body).digest('hex');
    assert.equal(resolveTenantFromHmac(body, fimmopSig, 'RODZ_WEBHOOK_SECRET'), 'fimmop');
    assert.equal(resolveTenantFromHmac(body, dlSig, 'RODZ_WEBHOOK_SECRET'), 'digitestlab');
    assert.equal(resolveTenantFromHmac(body, 'sha256=' + fimmopSig, 'RODZ_WEBHOOK_SECRET'), 'fimmop');
  });

  it('returns null on tampered body', () => {
    process.env.RODZ_WEBHOOK_SECRET_FIMMOP = 'fimmop-rodz';
    const sig = crypto.createHmac('sha256', 'fimmop-rodz').update('original').digest('hex');
    assert.equal(resolveTenantFromHmac('tampered', sig, 'RODZ_WEBHOOK_SECRET'), null);
  });

  it('falls back to global secret', () => {
    process.env.RODZ_WEBHOOK_SECRET = 'global-rodz';
    const body = '{}';
    const sig = crypto.createHmac('sha256', 'global-rodz').update(body).digest('hex');
    assert.equal(resolveTenantFromHmac(body, sig, 'RODZ_WEBHOOK_SECRET'), GLOBAL_TENANT);
  });
});

describe('listTenantsFor', () => {
  beforeEach(() => snapshot());
  afterEach(() => restore());

  it('returns sorted tenant list + global', () => {
    process.env.X_SECRET = 'g';
    process.env.X_SECRET_BBB = 'b';
    process.env.X_SECRET_AAA = 'a';
    assert.deepEqual(listTenantsFor('X_SECRET'), ['aaa', 'bbb', GLOBAL_TENANT]);
  });

  it('returns empty when nothing configured', () => {
    delete process.env.NONE;
    assert.deepEqual(listTenantsFor('NONE'), []);
  });
});
