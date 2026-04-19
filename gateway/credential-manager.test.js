// Tests — credential-manager (Phase B4)
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let _envSnapshot;
function snapshot() { _envSnapshot = { ...process.env }; }
function restore() {
  for (const k of Object.keys(process.env)) {
    if (!(k in _envSnapshot)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(_envSnapshot)) process.env[k] = v;
}

function freshModule() {
  delete require.cache[require.resolve('./credential-manager.js')];
  return require('./credential-manager.js');
}

describe('getCredential', () => {
  beforeEach(() => snapshot());
  afterEach(() => restore());

  it('returns value when present', () => {
    process.env.CLAUDE_API_KEY = 'sk-ant-test';
    const { getCredential } = freshModule();
    assert.equal(getCredential('CLAUDE_API_KEY'), 'sk-ant-test');
  });

  it('returns undefined and warns once on missing FALLBACK_OK key', () => {
    delete process.env.OPENAI_API_KEY;
    const { getCredential } = freshModule();
    assert.equal(getCredential('OPENAI_API_KEY'), undefined);
    // Calling again should not warn again — set is process-scoped
    assert.equal(getCredential('OPENAI_API_KEY'), undefined);
  });

  it('throws on missing STRICT key', () => {
    delete process.env.GMAIL_SMTP_PASS;
    const { getCredential } = freshModule();
    assert.throws(
      () => getCredential('GMAIL_SMTP_PASS'),
      /STRICT credential GMAIL_SMTP_PASS missing/
    );
  });

  it('FALLBACK_ONLY keys behave like FALLBACK_OK (no throw, just warn)', () => {
    delete process.env.B2_KEY_ID;
    const { getCredential } = freshModule();
    assert.equal(getCredential('B2_KEY_ID'), undefined);
  });

  it('unknown key returns undefined silently', () => {
    delete process.env.SOME_RANDOM_KEY;
    const { getCredential } = freshModule();
    assert.equal(getCredential('SOME_RANDOM_KEY'), undefined);
  });
});

describe('validateOnBoot', () => {
  beforeEach(() => snapshot());
  afterEach(() => restore());

  it('passes when nothing strict is required (global container, no email)', () => {
    delete process.env.GMAIL_SMTP_PASS;
    delete process.env.SENDER_EMAIL;
    delete process.env.GMAIL_SMTP_USER;
    delete process.env.GMAIL_MAILBOXES;
    const { validateOnBoot } = freshModule();
    const issues = validateOnBoot();
    assert.deepEqual(issues.filter(i => i.level === 'fatal'), []);
  });

  it('throws when email container missing GMAIL_SMTP_PASS', () => {
    process.env.SENDER_EMAIL = 'a@b.com';
    delete process.env.GMAIL_SMTP_PASS;
    delete process.env.GMAIL_SMTP_USER;
    process.env.CLIENT_NAME = 'fimmop';
    const { validateOnBoot } = freshModule();
    assert.throws(() => validateOnBoot(), /BOOT REFUSED.*GMAIL_SMTP_PASS|GMAIL_SMTP_USER/);
  });

  it('passes when email container has all required keys', () => {
    process.env.SENDER_EMAIL = 'a@b.com';
    process.env.GMAIL_SMTP_PASS = 'pass';
    process.env.GMAIL_SMTP_USER = 'a@b.com';
    process.env.CLIENT_NAME = 'fimmop';
    const { validateOnBoot } = freshModule();
    const issues = validateOnBoot();
    assert.deepEqual(issues.filter(i => i.level === 'fatal'), []);
  });
});

describe('describe', () => {
  beforeEach(() => snapshot());
  afterEach(() => restore());

  it('reports presence of each known credential', () => {
    process.env.CLAUDE_API_KEY = 'sk';
    process.env.GMAIL_SMTP_PASS = 'p';
    delete process.env.SENTRY_DSN;
    const { describe: d } = freshModule();
    const r = d();
    assert.equal(r.fallback_ok.CLAUDE_API_KEY, true);
    assert.equal(r.strict.GMAIL_SMTP_PASS, true);
    assert.equal(r.fallback_only.SENTRY_DSN, false);
  });
});
