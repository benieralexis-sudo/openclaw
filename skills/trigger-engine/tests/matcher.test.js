// Tests unitaires du Pattern Matcher

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { evaluatePattern, matchAllPatterns, eventsInWindow } = require('../patterns/matcher');

const PATTERN_SCALEUP = {
  id: 'scale-up-tech',
  name: 'test',
  min_score: 7.0,
  max_score: 10.0,
  window_days: 30,
  signals_required: {
    any_of: [
      { types: ['funding'], weight: 3.0 }
    ],
    must_have_at_least_one_of: [
      { types: ['hiring_tech'], min_count: 2, weight: 3.0 }
    ]
  },
  bonuses: [
    { types: ['hiring_executive'], event_type_match: 'cto|vp eng', weight: 2.0 }
  ],
  exclusions: [
    { types: ['procedure_collective'] }
  ],
  enabled: true
};

test('evaluatePattern matches scale-up with funding + 2 hiring_tech', () => {
  const today = new Date().toISOString().slice(0, 10);
  const events = [
    { source: 'rodz', event_type: 'funding', event_date: today, normalized: {} },
    { source: 'rodz', event_type: 'hiring_tech', event_date: today, normalized: {} },
    { source: 'rodz', event_type: 'hiring_tech', event_date: today, normalized: {} }
  ];
  const result = evaluatePattern(PATTERN_SCALEUP, events);
  assert.equal(result.matched, true);
  assert.ok(result.score >= 6.0);
});

test('evaluatePattern with bonus C-level CTO adds score', () => {
  const today = new Date().toISOString().slice(0, 10);
  const events = [
    { source: 'rodz', event_type: 'funding', event_date: today, normalized: {} },
    { source: 'rodz', event_type: 'hiring_tech', event_date: today, normalized: {} },
    { source: 'rodz', event_type: 'hiring_tech', event_date: today, normalized: {} },
    { source: 'rodz', event_type: 'hiring_executive', event_date: today, normalized: { intitule: 'New CTO' } }
  ];
  const result = evaluatePattern(PATTERN_SCALEUP, events);
  assert.equal(result.matched, true);
  assert.ok(result.score >= 7.0);
});

test('evaluatePattern rejects if exclusion present', () => {
  const today = new Date().toISOString().slice(0, 10);
  const events = [
    { source: 'rodz', event_type: 'funding', event_date: today, normalized: {} },
    { source: 'rodz', event_type: 'hiring_tech', event_date: today, normalized: {} },
    { source: 'rodz', event_type: 'hiring_tech', event_date: today, normalized: {} },
    { source: 'bodacc', event_type: 'procedure_collective', event_date: today, normalized: {} }
  ];
  const result = evaluatePattern(PATTERN_SCALEUP, events);
  assert.equal(result.matched, false);
  assert.equal(result.score, 0);
  assert.match(result.reason, /excluded/);
});

test('evaluatePattern rejects if only 1 hiring_tech (need 2)', () => {
  const today = new Date().toISOString().slice(0, 10);
  const events = [
    { source: 'rodz', event_type: 'funding', event_date: today, normalized: {} },
    { source: 'rodz', event_type: 'hiring_tech', event_date: today, normalized: {} }
  ];
  const result = evaluatePattern(PATTERN_SCALEUP, events);
  assert.equal(result.matched, false);
  assert.match(result.reason, /must_have/);
});

test('eventsInWindow filters by date correctly', () => {
  const now = new Date();
  const recent = new Date(now.getTime() - 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const tooOld = new Date(now.getTime() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const events = [
    { event_date: recent },
    { event_date: tooOld }
  ];
  const filtered = eventsInWindow(events, 30);
  assert.equal(filtered.length, 1);
});

test('matchAllPatterns loads definitions from disk', () => {
  // smoke test : loadPatterns ne doit pas crasher
  const { loadPatterns } = require('../patterns/matcher');
  const patterns = loadPatterns();
  assert.ok(Array.isArray(patterns));
  // Au moins le scale-up-tech pattern
  assert.ok(patterns.some(p => p.id === 'scale-up-tech'));
});
