// Tests — admin-resolver (Phase B6)
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Snapshot/restore env so tests don't leak into each other.
let _envSnapshot;
function snapshot() {
  _envSnapshot = { ...process.env };
}
function restore() {
  for (const k of Object.keys(process.env)) {
    if (!(k in _envSnapshot)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(_envSnapshot)) process.env[k] = v;
}

// Fresh require per test to reset the warned-once flag.
function freshResolver() {
  delete require.cache[require.resolve('./admin-resolver.js')];
  return require('./admin-resolver.js');
}

describe('getAdminChatId', () => {
  beforeEach(() => snapshot());
  afterEach(() => restore());

  it('legacy fallback when nothing configured', () => {
    delete process.env.CLIENT_NAME;
    delete process.env.ADMIN_CHAT_ID;
    const { getAdminChatId, LEGACY_FALLBACK } = freshResolver();
    assert.equal(getAdminChatId(), LEGACY_FALLBACK);
  });

  it('uses ADMIN_CHAT_ID when set globally', () => {
    delete process.env.CLIENT_NAME;
    process.env.ADMIN_CHAT_ID = '999';
    const { getAdminChatId } = freshResolver();
    assert.equal(getAdminChatId(), '999');
  });

  it('explicit clientId beats global ADMIN_CHAT_ID', () => {
    process.env.ADMIN_CHAT_ID = '999';
    process.env.CLIENT_ADMIN_CHAT_ID_FIMMOP = '111';
    const { getAdminChatId } = freshResolver();
    assert.equal(getAdminChatId('fimmop'), '111');
    assert.equal(getAdminChatId('digitestlab'), '999', 'falls back to global if no per-client var');
  });

  it('CLIENT_NAME env auto-resolves', () => {
    process.env.CLIENT_NAME = 'fimmop';
    process.env.CLIENT_ADMIN_CHAT_ID_FIMMOP = '111';
    process.env.ADMIN_CHAT_ID = '999';
    const { getAdminChatId } = freshResolver();
    assert.equal(getAdminChatId(), '111');
  });

  it('explicit clientId takes priority over CLIENT_NAME', () => {
    process.env.CLIENT_NAME = 'fimmop';
    process.env.CLIENT_ADMIN_CHAT_ID_FIMMOP = '111';
    process.env.CLIENT_ADMIN_CHAT_ID_DIGITESTLAB = '222';
    const { getAdminChatId } = freshResolver();
    assert.equal(getAdminChatId('digitestlab'), '222');
  });

  it('clientId with special chars is sanitized in env key lookup', () => {
    process.env['CLIENT_ADMIN_CHAT_ID_MY_CLIENT_42'] = '777';
    const { getAdminChatId } = freshResolver();
    assert.equal(getAdminChatId('my-client.42'), '777');
  });
});

describe('getAllAdminChatIds', () => {
  beforeEach(() => snapshot());
  afterEach(() => restore());

  it('returns legacy when nothing configured', () => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('CLIENT_ADMIN_CHAT_ID_') || k === 'ADMIN_CHAT_ID') delete process.env[k];
    }
    const { getAllAdminChatIds, LEGACY_FALLBACK } = freshResolver();
    assert.deepEqual(getAllAdminChatIds(), [LEGACY_FALLBACK]);
  });

  it('aggregates per-client + global, deduplicated', () => {
    process.env.ADMIN_CHAT_ID = '999';
    process.env.CLIENT_ADMIN_CHAT_ID_A = '111';
    process.env.CLIENT_ADMIN_CHAT_ID_B = '222';
    process.env.CLIENT_ADMIN_CHAT_ID_C = '111'; // duplicate of A
    const { getAllAdminChatIds } = freshResolver();
    const ids = getAllAdminChatIds().sort();
    assert.deepEqual(ids, ['111', '222', '999']);
  });
});

describe('getClientFromAdminChatId', () => {
  beforeEach(() => snapshot());
  afterEach(() => restore());

  it('reverse-lookup tenant from chat id', () => {
    process.env.CLIENT_ADMIN_CHAT_ID_FIMMOP = '111';
    process.env.CLIENT_ADMIN_CHAT_ID_DIGITESTLAB = '222';
    const { getClientFromAdminChatId } = freshResolver();
    assert.equal(getClientFromAdminChatId('111'), 'fimmop');
    assert.equal(getClientFromAdminChatId('222'), 'digitestlab');
    assert.equal(getClientFromAdminChatId('999'), null);
    assert.equal(getClientFromAdminChatId(null), null);
  });
});
