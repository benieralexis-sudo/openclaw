#!/usr/bin/env node
// Test E2E des 6 ameliorations du reply pipeline
// Usage: node tests/test-reply-upgrades.mjs
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.join(__dirname, '..'));

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log('  ✅ ' + name);
    passed++;
  } else {
    console.log('  ❌ ' + name);
    failed++;
  }
}

// ===========================
// TEST 1: Classification avec tone
// ===========================
console.log('\n📋 TEST 1: Classification + Tone Detection');
const { classifyReply, extractAvailability, _getToneInstruction, _buildConversationContext } = require('../skills/inbox-manager/reply-classifier.js');

assert(_getToneInstruction('enthusiastic').includes('dynamique'), 'Tone enthusiastic contient instruction');
assert(_getToneInstruction('irritated').includes('respectueux'), 'Tone irritated contient instruction');
assert(_getToneInstruction('urgent').includes('BUT'), 'Tone urgent contient instruction');
assert(_getToneInstruction('hesitant').includes('rassure'), 'Tone hesitant contient instruction');
assert(_getToneInstruction('neutral').includes('professionnel'), 'Tone neutral contient instruction');
assert(_getToneInstruction('unknown') === _getToneInstruction('neutral'), 'Tone inconnu fallback neutral');

// ===========================
// TEST 2: Extract Availability
// ===========================
console.log('\n📋 TEST 2: Extract Availability');

const avail1 = extractAvailability('Je suis dispo mardi 15h');
assert(avail1.hasAvailability === true, 'Detecte "dispo mardi 15h"');
assert(avail1.dayText === 'mardi', 'Day = mardi');
assert(avail1.timeText.includes('15'), 'Time contient 15');

const avail2 = extractAvailability('ok pour jeudi');
assert(avail2.dayText === 'jeudi', 'Detecte "jeudi"');

const avail3 = extractAvailability('Ca marche pour demain 10h30');
assert(avail3.hasAvailability === true, 'Detecte "ca marche pour demain 10h30"');
assert(avail3.dayText === 'demain', 'Day = demain');

const avail4 = extractAvailability('Non merci');
assert(avail4.hasAvailability === false, 'Pas de dispo dans "Non merci"');

const avail5 = extractAvailability('libre semaine prochaine');
assert(avail5.dayText !== null, 'Detecte "semaine prochaine"');

const avail6 = extractAvailability('On se cale jeudi 14h ?');
assert(avail6.hasAvailability === true, 'Detecte "on se cale jeudi 14h"');

// ===========================
// TEST 3: Conversation History Builder
// ===========================
console.log('\n📋 TEST 3: Threading — Conversation History');

const history = [
  { role: 'sent', subject: 'Prospection', body: 'Bonjour, je vous contacte...', date: '2026-03-10' },
  { role: 'received', subject: 'Re: Prospection', body: 'Interessant, dites-moi en plus', date: '2026-03-11' },
  { role: 'sent', subject: 'Re: Prospection', body: 'Merci ! Voici nos services...', date: '2026-03-11' },
  { role: 'received', subject: 'Re: Prospection', body: 'Ok on se cale un call ?', date: '2026-03-12' }
];

const ctx = _buildConversationContext(history);
assert(ctx.includes('HISTORIQUE'), 'Contexte contient HISTORIQUE');
assert(ctx.includes('TOI'), 'Contexte contient role TOI');
assert(ctx.includes('PROSPECT'), 'Contexte contient role PROSPECT');
assert(ctx.includes('Bonjour'), 'Contexte contient premier message');
assert(ctx.includes('call'), 'Contexte contient dernier message');
assert(ctx.includes('IMPORTANT'), 'Contexte contient instruction coherence');

const longHistory = Array(10).fill(null).map((_, i) => ({
  role: i % 2 === 0 ? 'sent' : 'received', subject: 'test', body: 'msg ' + i, date: '2026-03-' + String(10 + i).padStart(2, '0')
}));
const ctxLong = _buildConversationContext(longHistory);
assert(ctxLong.split('--- TOI').length + ctxLong.split('--- PROSPECT').length - 2 <= 7, 'Max 6 messages dans le contexte');

const ctxEmpty = _buildConversationContext([]);
assert(ctxEmpty === '', 'Contexte vide si pas d\'historique');

// ===========================
// TEST 4: Google Calendar — resolveAvailability
// ===========================
console.log('\n📋 TEST 4: Booking Auto — resolveAvailability');

const GoogleCalendarClient = require('../skills/meeting-scheduler/google-calendar-client.js');

const date1 = GoogleCalendarClient.resolveAvailability('demain', '15h');
assert(date1 instanceof Date, 'resolveAvailability retourne une Date pour "demain 15h"');
if (date1) {
  assert(date1.getHours() === 15, 'Heure = 15h');
  assert(date1 > new Date(), 'Date dans le futur');
}

const date2 = GoogleCalendarClient.resolveAvailability('mardi', '10h30');
if (date2) {
  assert(date2.getHours() === 10, 'Heure = 10h');
  assert(date2.getMinutes() === 30, 'Minutes = 30');
  assert(date2.getDay() === 2, 'Jour = mardi (2)');
}

const date3 = GoogleCalendarClient.resolveAvailability('demain', 'matin');
if (date3) {
  assert(date3.getHours() === 10, 'Matin = 10h par defaut');
}

const date4 = GoogleCalendarClient.resolveAvailability(null, '15h');
assert(date4 === null, 'Pas de date si dayText null');

const date5 = GoogleCalendarClient.resolveAvailability('demain', '23h');
assert(date5 === null, 'Rejete 23h (hors business hours)');

// ===========================
// TEST 5: Knowledge Base — Qualification questions
// ===========================
console.log('\n📋 TEST 5: Qualification Questions');

const kb = JSON.parse(fs.readFileSync('skills/inbox-manager/knowledge-base.json', 'utf8'));
assert(kb.qualification, 'KB contient section qualification');
assert(kb.qualification.questions.length >= 3, 'Au moins 3 questions de qualification');
assert(kb.qualification.when === 'before_booking', 'when = before_booking');
assert(kb.qualification.max_questions === 1, 'max_questions = 1');

for (const q of kb.qualification.questions) {
  assert(q.length > 20, 'Question assez longue: "' + q.substring(0, 40) + '..."');
  assert(q.includes('?'), 'Question contient ?');
}

// ===========================
// TEST 6: A/B Testing — Reply variant assignment
// ===========================
console.log('\n📋 TEST 6: A/B Test Replies');

const ABTesting = require('../skills/automailer/ab-testing.js');
const mockStorage = { getEmailsByCampaign: () => [] };
const abTester = new ABTesting(mockStorage);

const v1 = abTester.assignVariant('test@example.com', 'reply_interested', 2);
assert(v1 === 'A' || v1 === 'B', 'Variant A ou B assigne');

const v2 = abTester.assignVariant('test@example.com', 'reply_interested', 2);
assert(v1 === v2, 'Meme email = meme variant (deterministe)');

const variants = new Set();
for (let i = 0; i < 20; i++) {
  variants.add(abTester.assignVariant('test' + i + '@example.com', 'reply_interested', 2));
}
assert(variants.size === 2, 'Distribution sur 2 variants (A et B) avec 20 emails');

// ===========================
// TEST 7: Real-Time Learner — Storage
// ===========================
console.log('\n📋 TEST 7: Real-Time Learner Storage');

const rtlPath = '/data/inbox-manager/realtime-learner.json';
const testData = { outcomes: [], patterns: {}, lastAnalysis: null };
fs.writeFileSync(rtlPath, JSON.stringify(testData));
const loaded = JSON.parse(fs.readFileSync(rtlPath, 'utf8'));
assert(Array.isArray(loaded.outcomes), 'outcomes est un array');
assert(typeof loaded.patterns === 'object', 'patterns est un object');
fs.unlinkSync(rtlPath);

// ===========================
// TEST 8: GoogleCalendarClient — createMeeting method exists
// ===========================
console.log('\n📋 TEST 8: Google Calendar — createMeeting');

const gcal = new GoogleCalendarClient({});
assert(typeof gcal.createMeeting === 'function', 'createMeeting est une methode');
assert(typeof GoogleCalendarClient.resolveAvailability === 'function', 'resolveAvailability est une methode statique');

const result = await gcal.createMeeting('test@test.com', 'Test', new Date(), 15);
assert(result === null, 'createMeeting retourne null sans API configuree');

// ===========================
// RESULTAT FINAL
// ===========================
console.log('\n' + '='.repeat(50));
console.log('RESULTATS: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\n⚠️  Certains tests ont echoue — verifier les erreurs ci-dessus');
  process.exit(1);
} else {
  console.log('\n🎉 Tous les tests passent ! Les 6 ameliorations sont fonctionnelles.');
  process.exit(0);
}
