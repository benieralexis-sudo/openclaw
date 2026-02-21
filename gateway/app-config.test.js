// Tests — gateway/app-config.js (node:test) — estimateCost, mode, budget
const { describe, it, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

// Utiliser un dossier temp pour isoler les tests (pas de mock fs necessaire)
const tmpDir = path.join(os.tmpdir(), 'ifind-test-config-' + Date.now());
process.env.APP_CONFIG_DIR = tmpDir;

const appConfig = require('./app-config.js');

describe('estimateCost', () => {
  it('GPT-4o-mini : input=0.00015, output=0.0006', () => {
    const cost = appConfig.estimateCost('gpt-4o-mini', 1000, 1000);
    assert.ok(Math.abs(cost - 0.00075) < 0.0001);
  });

  it('Claude Sonnet 4.6 : input=0.003, output=0.015', () => {
    const cost = appConfig.estimateCost('claude-sonnet-4-6', 1000, 500);
    const expected = 0.003 + 0.0075;
    assert.ok(Math.abs(cost - expected) < 0.0001);
  });

  it('Claude Opus 4.6 : input=0.015, output=0.075', () => {
    const cost = appConfig.estimateCost('claude-opus-4-6', 2000, 1000);
    const expected = 0.030 + 0.075;
    assert.ok(Math.abs(cost - expected) < 0.0001);
  });

  it('modele inconnu utilise le taux par defaut', () => {
    const cost = appConfig.estimateCost('unknown-model', 1000, 1000);
    const expected = 0.005 + 0.015;
    assert.ok(Math.abs(cost - expected) < 0.0001);
  });

  it('repartition 70/30 quand outputTokens absent', () => {
    const cost = appConfig.estimateCost('gpt-4o-mini', 1000);
    const expected = (700 / 1000) * 0.00015 + (300 / 1000) * 0.0006;
    assert.ok(Math.abs(cost - expected) < 0.00001);
  });

  it('retourne 0 pour 0 tokens', () => {
    assert.equal(appConfig.estimateCost('gpt-4o-mini', 0, 0), 0);
  });
});

describe('mode production/standby', () => {
  it('demarre en standby par defaut', () => {
    assert.equal(appConfig.getMode(), 'standby');
    assert.equal(appConfig.isStandby(), true);
    assert.equal(appConfig.isProduction(), false);
  });

  it('activateAll passe en production', () => {
    appConfig.activateAll();
    assert.equal(appConfig.getMode(), 'production');
    assert.equal(appConfig.isProduction(), true);
    assert.equal(appConfig.isStandby(), false);
  });

  it('deactivateAll repasse en standby', () => {
    appConfig.deactivateAll();
    assert.equal(appConfig.getMode(), 'standby');
    assert.equal(appConfig.isStandby(), true);
  });
});

describe('budget tracking', () => {
  it('isBudgetExceeded retourne false initialement', () => {
    assert.equal(appConfig.isBudgetExceeded(), false);
  });

  it('recordApiSpend accumule les couts', () => {
    const spent1 = appConfig.recordApiSpend('gpt-4o-mini', 10000, 5000);
    assert.ok(spent1 > 0);
    const spent2 = appConfig.recordApiSpend('gpt-4o-mini', 10000, 5000);
    assert.ok(spent2 > spent1);
  });

  it('assertBudgetAvailable ne lance pas si budget ok', () => {
    assert.doesNotThrow(() => appConfig.assertBudgetAvailable());
  });

  it('getBudgetStatus retourne les champs requis', () => {
    const status = appConfig.getBudgetStatus();
    assert.ok('dailyLimit' in status);
    assert.ok('todaySpent' in status);
    assert.ok('todayDate' in status);
    assert.ok('history' in status);
  });

  it('callback budget exceeded est appele', () => {
    let called = false;
    appConfig.onBudgetExceeded(() => { called = true; });
    // Gros appel Opus pour depasser 5$
    appConfig.recordApiSpend('claude-opus-4-6', 1000000, 1000000);
    assert.equal(called, true);
  });
});

describe('getFixedCosts', () => {
  it('retourne les couts fixes mensuels', () => {
    const costs = appConfig.getFixedCosts();
    assert.ok(costs.googleWorkspace);
    assert.equal(costs.googleWorkspace.amount, 7.00);
    assert.ok(costs.domain);
  });
});

describe('service usage tracking', () => {
  it('getServiceUsage retourne today et history', () => {
    const usage = appConfig.getServiceUsage();
    assert.ok('today' in usage);
    assert.ok('history' in usage);
  });
});
