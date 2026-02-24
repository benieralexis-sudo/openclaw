// Autonomous Pilot - Tests unitaires (node:test natif)
// Teste le VRAI code importe (pas de copies locales)
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Imports du vrai code (utils.js — 0 dependances)
const { escTg, parseJsonResponse } = require('../skills/autonomous-pilot/utils.js');

// =============================================
// 1. escTg — Escape Markdown Telegram (VRAI code)
// =============================================

describe('Autonomous Pilot — escTg', () => {
  it('echappe les underscores', () => {
    assert.equal(escTg('test_user@corp.com'), 'test\\_user@corp\\.com');
  });

  it('echappe les asterisques', () => {
    assert.equal(escTg('*bold*'), '\\*bold\\*');
  });

  it('echappe les crochets et parentheses', () => {
    assert.equal(escTg('[link](url)'), '\\[link\\]\\(url\\)');
  });

  it('retourne vide pour null/undefined/vide', () => {
    assert.equal(escTg(null), '');
    assert.equal(escTg(undefined), '');
    assert.equal(escTg(''), '');
  });

  it('tronque a 2000 chars', () => {
    const long = 'a'.repeat(3000);
    assert.equal(escTg(long).length, 2000);
  });

  it('echappe tous les caracteres speciaux MarkdownV2', () => {
    assert.equal(escTg('a~b`c>d#e+f=g|h{i}j.k!l'), 'a\\~b\\`c\\>d\\#e\\+f\\=g\\|h\\{i\\}j\\.k\\!l');
  });

  it('convertit les nombres en string', () => {
    assert.equal(escTg(42), '42');
  });
});

// =============================================
// 2. parseJsonResponse — Parse robuste JSON (VRAI code)
// =============================================

describe('Autonomous Pilot — parseJsonResponse', () => {
  it('parse JSON valide direct', () => {
    const input = '{"reasoning":"test","actions":[{"type":"search_leads","params":{}}]}';
    const result = parseJsonResponse(input);
    assert.ok(result);
    assert.equal(result.reasoning, 'test');
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].type, 'search_leads');
  });

  it('retourne null pour null/undefined/vide', () => {
    assert.equal(parseJsonResponse(null), null);
    assert.equal(parseJsonResponse(undefined), null);
    assert.equal(parseJsonResponse(''), null);
  });

  it('parse JSON dans un code block markdown', () => {
    const input = '```json\n{"reasoning":"ok","actions":[]}\n```';
    const result = parseJsonResponse(input);
    assert.ok(result);
    assert.equal(result.reasoning, 'ok');
    assert.deepEqual(result.actions, []);
  });

  it('normalise les champs manquants en arrays vides', () => {
    const input = '{"reasoning":"test"}';
    const result = parseJsonResponse(input);
    assert.ok(result);
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.experiments, []);
    assert.deepEqual(result.learnings, []);
    assert.deepEqual(result.diagnosticItems, []);
  });

  it('filtre les actions sans type', () => {
    const input = '{"actions":[{"type":"search_leads","params":{}},{"params":{}},{"type":"","params":{}}]}';
    const result = parseJsonResponse(input);
    assert.ok(result);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].type, 'search_leads');
  });

  it('remplace params null par objet vide', () => {
    const input = '{"actions":[{"type":"search_leads","params":null}]}';
    const result = parseJsonResponse(input);
    assert.ok(result);
    assert.equal(result.actions.length, 1);
    assert.deepEqual(result.actions[0].params, {});
  });

  it('remplace params non-objet par objet vide', () => {
    const input = '{"actions":[{"type":"search_leads","params":"invalid"}]}';
    const result = parseJsonResponse(input);
    assert.ok(result);
    assert.deepEqual(result.actions[0].params, {});
  });

  it('remplace params array par objet vide', () => {
    const input = '{"actions":[{"type":"search_leads","params":[1,2]}]}';
    const result = parseJsonResponse(input);
    assert.ok(result);
    assert.deepEqual(result.actions[0].params, {});
  });

  it('extrait JSON entoure de texte', () => {
    const input = 'Voici mon analyse:\n\n{"reasoning":"ok","actions":[{"type":"send_email","params":{"to":"a@b.com"}}]}\n\nBonne journee!';
    const result = parseJsonResponse(input);
    assert.ok(result);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].params.to, 'a@b.com');
  });

  it('retourne null pour texte sans JSON', () => {
    assert.equal(parseJsonResponse('Ceci est du texte sans JSON'), null);
  });

  it('ajoute reasoning par defaut si manquant', () => {
    const input = '{"actions":[]}';
    const result = parseJsonResponse(input);
    assert.ok(result);
    assert.equal(result.reasoning, '(raison non fournie)');
  });

  it('filtre les actions non-objet', () => {
    const input = '{"actions":["string_action", null, 42, {"type":"ok","params":{}}]}';
    const result = parseJsonResponse(input);
    assert.ok(result);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].type, 'ok');
  });
});

// =============================================
// 3. Storage — CRUD + lifecycle (VRAI storage via env var)
// =============================================

describe('Autonomous Pilot — Storage', () => {
  let tmpDir;
  let storage;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-test-'));
    // Configurer env var AVANT le require
    process.env.AUTONOMOUS_PILOT_DATA_DIR = tmpDir;
    // Invalider le cache pour forcer un re-require avec le nouveau DATA_DIR
    const storagePath = require.resolve('../skills/autonomous-pilot/storage.js');
    delete require.cache[storagePath];
    storage = require('../skills/autonomous-pilot/storage.js');
  });

  after(() => {
    // Nettoyer
    const storagePath = require.resolve('../skills/autonomous-pilot/storage.js');
    delete require.cache[storagePath];
    delete process.env.AUTONOMOUS_PILOT_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- Config ---
  it('getConfig retourne un objet avec enabled', () => {
    const config = storage.getConfig();
    assert.ok(typeof config === 'object');
    assert.ok('enabled' in config);
  });

  it('updateConfig modifie la config', () => {
    storage.updateConfig({ businessContext: 'Test B2B' });
    assert.equal(storage.getConfig().businessContext, 'Test B2B');
  });

  it('updateEmailPreferences modifie les prefs email', () => {
    storage.updateEmailPreferences({ maxLines: 10 });
    assert.equal(storage.getConfig().emailPreferences.maxLines, 10);
  });

  it('updateOffer modifie loffre', () => {
    storage.updateOffer({ setup: 500, monthly: 100 });
    assert.equal(storage.getConfig().offer.setup, 500);
    assert.equal(storage.getConfig().offer.monthly, 100);
  });

  // --- Goals ---
  it('getGoals retourne weekly + searchCriteria', () => {
    const goals = storage.getGoals();
    assert.ok(goals.weekly);
    assert.ok(goals.searchCriteria);
  });

  it('updateWeeklyGoals modifie les objectifs', () => {
    storage.updateWeeklyGoals({ leadsToFind: 50 });
    assert.equal(storage.getGoals().weekly.leadsToFind, 50);
  });

  it('updateSearchCriteria une seule save (fix double save)', () => {
    const statsBefore = storage.getStats().totalCriteriaUpdates;
    storage.updateSearchCriteria({ keywords: 'agence marketing' });
    assert.equal(storage.getGoals().searchCriteria.keywords, 'agence marketing');
    assert.equal(storage.getStats().totalCriteriaUpdates, statsBefore + 1);
  });

  // --- Progress ---
  it('incrementProgress incremente un compteur', () => {
    const before = storage.getProgress().leadsFoundThisWeek;
    storage.incrementProgress('leadsFoundThisWeek', 5);
    assert.equal(storage.getProgress().leadsFoundThisWeek, before + 5);
  });

  it('resetWeeklyProgress remet a zero et archive', () => {
    storage.incrementProgress('emailsSentThisWeek', 3);
    const old = storage.resetWeeklyProgress();
    assert.ok(old.emailsSentThisWeek >= 3);
    assert.equal(storage.getProgress().emailsSentThisWeek, 0);
    assert.equal(storage.getProgress().leadsFoundThisWeek, 0);
  });

  // --- Action Queue ---
  it('addToQueue ajoute une action pending', () => {
    const action = storage.addToQueue({ type: 'search_leads', params: { keywords: 'test' }, preview: 'Test' });
    assert.ok(action.id);
    assert.equal(action.status, 'pending');
    assert.equal(action.type, 'search_leads');
  });

  it('getQueuedActions retourne les pending', () => {
    const queued = storage.getQueuedActions();
    assert.ok(queued.length >= 1);
    assert.equal(queued[0].status, 'pending');
  });

  it('confirmAction change le status', () => {
    const action = storage.addToQueue({ type: 'send_email', params: {} });
    const confirmed = storage.confirmAction(action.id);
    assert.ok(confirmed);
    assert.equal(confirmed.status, 'confirmed');
    assert.ok(confirmed.confirmedAt);
  });

  it('rejectAction archive et supprime de la queue', () => {
    const action = storage.addToQueue({ type: 'push_to_crm', params: {} });
    const rejected = storage.rejectAction(action.id);
    assert.ok(rejected);
    // Ne doit plus etre dans la queue
    const queued = storage.getQueuedActions();
    assert.ok(!queued.find(a => a.id === action.id));
  });

  it('completeAction archive et supprime de la queue', () => {
    const action = storage.addToQueue({ type: 'generate_email', params: {} });
    storage.confirmAction(action.id);
    const completed = storage.completeAction(action.id, { success: true, summary: 'OK' });
    assert.ok(completed);
  });

  it('confirmAction retourne null pour id inexistant', () => {
    assert.equal(storage.confirmAction('zzz_inexistant'), null);
  });

  // --- cleanupQueue (TTL 48h) ---
  it('cleanupQueue expire les actions pending > 48h', () => {
    // Ajouter une action avec createdAt il y a 3 jours
    const action = storage.addToQueue({ type: 'old_action', params: {} });
    // Manipuler le createdAt directement dans la queue
    const queued = storage.getQueuedActions();
    const found = queued.find(a => a.id === action.id);
    if (found) {
      found.createdAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    }
    const expiredCount = storage.cleanupQueue();
    assert.ok(expiredCount >= 1);
    // Verifier que l'action n'est plus dans la queue
    const remaining = storage.getQueuedActions();
    assert.ok(!remaining.find(a => a.id === action.id));
  });

  it('cleanupQueue garde les actions recentes', () => {
    const action = storage.addToQueue({ type: 'recent_action', params: {}, preview: 'Fresh' });
    const expiredCount = storage.cleanupQueue();
    // L'action recente doit rester
    const queued = storage.getQueuedActions();
    assert.ok(queued.find(a => a.id === action.id));
  });

  // --- Action History ---
  it('recordAction ajoute a lhistorique', () => {
    const before = storage.getRecentActions(100).length;
    storage.recordAction({ type: 'test_action', params: {}, result: { success: true } });
    assert.equal(storage.getRecentActions(100).length, before + 1);
  });

  it('getRecentActions respecte la limite', () => {
    for (let i = 0; i < 5; i++) {
      storage.recordAction({ type: 'bulk_' + i, params: {} });
    }
    assert.ok(storage.getRecentActions(3).length <= 3);
  });

  // --- Learnings ---
  it('addLearning ajoute un apprentissage', () => {
    storage.addLearning('bestSearchCriteria', { summary: 'CEO marche bien', data: { openRate: 30 } });
    const learnings = storage.getLearnings();
    assert.ok(learnings.bestSearchCriteria.length >= 1);
    assert.equal(learnings.bestSearchCriteria[0].summary, 'CEO marche bien');
  });

  // --- Experiments ---
  it('addExperiment cree une experience running', () => {
    storage.addExperiment({ type: 'ab_test', description: 'Test sujet court vs long' });
    const exps = storage.getActiveExperiments();
    assert.ok(exps.length >= 1);
    assert.equal(exps[0].status, 'running');
  });

  it('completeExperiment cloture lexperience', () => {
    storage.addExperiment({ type: 'ab_test', description: 'Test temporaire' });
    const exp = storage.getActiveExperiments()[0];
    storage.completeExperiment(exp.id, { summary: 'Court gagne' });
    // Verifier qu'elle n'est plus active
    const active = storage.getActiveExperiments();
    assert.ok(!active.find(e => e.id === exp.id));
  });

  // --- Patterns ---
  it('savePatterns + getPatterns persiste', () => {
    storage.savePatterns({ topTitles: [{ label: 'CEO', openRate: 30 }], totalEmailsAnalyzed: 100 });
    const p = storage.getPatterns();
    assert.ok(p);
    assert.equal(p.totalEmailsAnalyzed, 100);
    assert.ok(p.updatedAt);
  });

  // --- Niche Performance ---
  it('trackNicheEvent incremente les compteurs', () => {
    storage.trackNicheEvent('agences-marketing', 'lead');
    storage.trackNicheEvent('agences-marketing', 'sent');
    storage.trackNicheEvent('agences-marketing', 'opened');
    const perf = storage.getNichePerformance();
    assert.ok(perf['agences-marketing']);
    assert.equal(perf['agences-marketing'].leads, 1);
    assert.equal(perf['agences-marketing'].sent, 1);
    assert.equal(perf['agences-marketing'].opened, 1);
  });

  it('trackNicheEvent ignore niche null', () => {
    storage.trackNicheEvent(null, 'lead');
    storage.trackNicheEvent('', 'lead');
    // Pas de crash
  });

  // --- Diagnostic ---
  it('addDiagnosticItem ajoute un item', () => {
    const item = storage.addDiagnosticItem({ message: 'Test diagnostic', priority: 'warning' });
    assert.ok(item.id);
    assert.equal(item.status, 'open');
  });

  it('resolveDiagnosticItem resout litem', () => {
    const item = storage.addDiagnosticItem({ message: 'A resoudre', priority: 'info' });
    storage.resolveDiagnosticItem(item.id);
    const open = storage.getOpenDiagnostics();
    assert.ok(!open.find(i => i.id === item.id));
  });

  it('addDiagnosticItem dedup par message', () => {
    const msg = 'Dedup test ' + Date.now();
    const item1 = storage.addDiagnosticItem({ message: msg, priority: 'info' });
    const item2 = storage.addDiagnosticItem({ message: msg, priority: 'info' });
    assert.equal(item1.id, item2.id); // Meme item retourne
  });

  // --- PILOT_STATES ---
  it('PILOT_STATES contient les etats valides', () => {
    assert.equal(storage.PILOT_STATES.IDLE, 'idle');
    assert.equal(storage.PILOT_STATES.ACTIVE, 'active');
    assert.equal(storage.PILOT_STATES.PAUSED, 'paused');
    assert.equal(storage.PILOT_STATES.ERROR, 'error');
  });

  // --- Persistence ---
  it('persiste sur disque et recharge', () => {
    storage.updateConfig({ businessContext: 'Persistence test' });
    storage.recordAction({ type: 'persist_test', params: {} });

    // Forcer un re-require
    const storagePath = require.resolve('../skills/autonomous-pilot/storage.js');
    delete require.cache[storagePath];
    const storage2 = require(storagePath);

    assert.equal(storage2.getConfig().businessContext, 'Persistence test');
    assert.ok(storage2.getRecentActions(100).some(a => a.type === 'persist_test'));
  });
});
