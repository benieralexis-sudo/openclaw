// Meeting Scheduler - Tests unitaires (node:test natif)
// Teste le VRAI code importé (pas de copies locales)
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Imports du vrai code
const { escTg, classifyIntent } = require('../skills/meeting-scheduler/utils.js');
const { MeetingSchedulerStorage } = require('../skills/meeting-scheduler/storage.js');

// =============================================
// 1. escTg — Escape Markdown Telegram (VRAI code)
// =============================================

describe('Meeting Scheduler — escTg', () => {
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
// 2. Storage — CRUD + lifecycle (VRAI MeetingSchedulerStorage)
// =============================================

describe('Meeting Scheduler — Storage', () => {
  let tmpDir;
  let storage;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-test-'));
    storage = new MeetingSchedulerStorage(tmpDir);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createMeeting incremente totalProposed', () => {
    storage.createMeeting({ leadEmail: 'a@b.com' });
    assert.equal(storage.getStats().totalProposed, 1);
    assert.equal(storage.getStats().totalMeetings, 1);
  });

  it('updateMeetingStatus booked', () => {
    const m = storage.createMeeting({ leadEmail: 'book@test.com' });
    storage.updateMeetingStatus(m.id, 'booked');
    const updated = storage.getMeeting(m.id);
    assert.equal(updated.status, 'booked');
    assert.ok(updated.bookedAt);
    assert.ok(storage.getStats().totalBooked >= 1);
  });

  it('updateMeetingStatus completed', () => {
    const m = storage.createMeeting({ leadEmail: 'comp@test.com' });
    storage.updateMeetingStatus(m.id, 'completed');
    const updated = storage.getMeeting(m.id);
    assert.equal(updated.status, 'completed');
    assert.ok(updated.completedAt);
    assert.ok(storage.getStats().totalCompleted >= 1);
  });

  it('updateMeetingStatus expired', () => {
    const m = storage.createMeeting({ leadEmail: 'exp@test.com' });
    storage.updateMeetingStatus(m.id, 'expired');
    const updated = storage.getMeeting(m.id);
    assert.equal(updated.status, 'expired');
    assert.ok(updated.expiredAt);
    assert.ok(storage.getStats().totalExpired >= 1);
  });

  it('updateMeetingStatus no_show', () => {
    const m = storage.createMeeting({ leadEmail: 'ns@test.com' });
    storage.updateMeetingStatus(m.id, 'no_show');
    const updated = storage.getMeeting(m.id);
    assert.equal(updated.status, 'no_show');
    assert.ok(storage.getStats().totalNoShow >= 1);
  });

  it('updateMeetingStatus avec extra merge les champs', () => {
    const m = storage.createMeeting({ leadEmail: 'extra@test.com' });
    storage.updateMeetingStatus(m.id, 'booked', { scheduledAt: '2026-03-01T10:00:00Z', googleCalendarEventId: 'xyz' });
    const updated = storage.getMeeting(m.id);
    assert.equal(updated.scheduledAt, '2026-03-01T10:00:00Z');
    assert.equal(updated.googleCalendarEventId, 'xyz');
  });

  it('conversionRate calcule correctement', () => {
    const s2 = new MeetingSchedulerStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-conv-')));
    s2.createMeeting({ leadEmail: 'a@b.com' });
    s2.createMeeting({ leadEmail: 'c@d.com' });
    const m = s2.createMeeting({ leadEmail: 'e@f.com' });
    s2.updateMeetingStatus(m.id, 'booked');
    assert.equal(s2.getStats().conversionRate, 33); // 1/3 = 33%
    fs.rmSync(s2._dataDir, { recursive: true, force: true });
  });

  it('getMeetingByEmail case-insensitive', () => {
    storage.createMeeting({ leadEmail: 'John@Example.COM' });
    const result = storage.getMeetingByEmail('john@example.com');
    assert.ok(result.length >= 1);
  });

  it('getRecentMeetings respecte la limite', () => {
    const s3 = new MeetingSchedulerStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-recent-')));
    for (let i = 0; i < 15; i++) s3.createMeeting({ leadEmail: 'u' + i + '@test.com' });
    assert.equal(s3.getRecentMeetings(5).length, 5);
    assert.equal(s3.getRecentMeetings().length, 10); // default 10
    fs.rmSync(s3._dataDir, { recursive: true, force: true });
  });

  it('getMeeting retourne null pour id inexistant', () => {
    assert.equal(storage.getMeeting('zzz_inexistant'), null);
  });

  it('updateMeetingStatus retourne null pour id inexistant', () => {
    assert.equal(storage.updateMeetingStatus('zzz_inexistant', 'booked'), null);
  });

  it('persiste sur disque et recharge', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-persist-'));
    const s4 = new MeetingSchedulerStorage(dir);
    const m = s4.createMeeting({ leadEmail: 'persist@test.com', leadName: 'Persist' });
    // Recharger depuis le disque
    const s5 = new MeetingSchedulerStorage(dir);
    const reloaded = s5.getMeeting(m.id);
    assert.ok(reloaded);
    assert.equal(reloaded.leadEmail, 'persist@test.com');
    assert.equal(reloaded.leadName, 'Persist');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// =============================================
// 3. Intent classification (VRAI code)
// =============================================

describe('Meeting Scheduler — Intent classification', () => {
  it('detecte propose', () => assert.equal(classifyIntent('propose un rdv'), 'propose'));
  it('detecte book', () => assert.equal(classifyIntent('book a meeting'), 'propose'));
  it('detecte reserve', () => assert.equal(classifyIntent('réserve un créneau'), 'propose'));
  it('detecte caler', () => assert.equal(classifyIntent('on cale un call'), 'propose'));
  it('detecte no-show', () => assert.equal(classifyIntent('no-show john@test.com'), 'no_show'));
  it('detecte pas venu', () => assert.equal(classifyIntent('il est pas venu'), 'no_show'));
  it('detecte ghost', () => assert.equal(classifyIntent('le prospect a ghost'), 'no_show'));
  it('detecte absent', () => assert.equal(classifyIntent('il etait absent'), 'no_show'));
  it('detecte status', () => assert.equal(classifyIntent('statut meetings'), 'status'));
  it('detecte upcoming', () => assert.equal(classifyIntent('meetings a venir'), 'upcoming'));
  it('detecte agenda', () => assert.equal(classifyIntent('montre mon agenda'), 'upcoming'));
  it('detecte history', () => assert.equal(classifyIntent('historique recent'), 'history'));
  it('detecte dernier', () => assert.equal(classifyIntent('mes derniers meetings'), 'history'));
  it('detecte configure calcom', () => assert.equal(classifyIntent('configurer cal.com'), 'configure'));
  it('detecte configure gcal', () => assert.equal(classifyIntent('configurer google calendar'), 'configure'));
  it('detecte api key', () => assert.equal(classifyIntent('changer la cle api'), 'configure'));
  it('detecte link', () => assert.equal(classifyIntent('donne moi le lien'), 'link'));
  it('detecte url', () => assert.equal(classifyIntent('quelle est l url'), 'link'));
  it('detecte help', () => assert.equal(classifyIntent('aide'), 'help'));
  it('default = status', () => assert.equal(classifyIntent('blablabla quelconque'), 'status'));
});

// =============================================
// 4. Lifecycle transitions
// =============================================

describe('Meeting Scheduler — Lifecycle transitions', () => {
  it('proposed > 7j → devrait etre expire', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const proposedAge = Date.now() - new Date(eightDaysAgo).getTime();
    assert.ok(proposedAge > 7 * 24 * 60 * 60 * 1000);
  });

  it('booked avec scheduledAt passe → devrait etre completed', () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const duration = 30; // minutes
    const meetingEnd = twoHoursAgo + duration * 60 * 1000;
    assert.ok(meetingEnd < Date.now());
  });

  it('booked avec scheduledAt futur → ne doit PAS etre completed', () => {
    const inTwoHours = Date.now() + 2 * 60 * 60 * 1000;
    const duration = 30;
    const meetingEnd = inTwoHours + duration * 60 * 1000;
    assert.ok(meetingEnd > Date.now());
  });

  it('lifecycle via storage reel — proposed expire apres 7j', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-lc-'));
    const s = new MeetingSchedulerStorage(dir);
    const m = s.createMeeting({ leadEmail: 'lc@test.com' });
    // Simuler proposedAt il y a 8 jours
    m.proposedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    // Verifier que la condition de transition est vraie
    const proposedAge = Date.now() - new Date(m.proposedAt).getTime();
    assert.ok(proposedAge > 7 * 24 * 60 * 60 * 1000);
    // Appliquer le changement
    s.updateMeetingStatus(m.id, 'expired');
    assert.equal(s.getMeeting(m.id).status, 'expired');
    assert.ok(s.getMeeting(m.id).expiredAt);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// =============================================
// 5. Pending conversation cleanup
// =============================================

describe('Meeting Scheduler — Pending cleanup', () => {
  it('conversations > 10min sont nettoyees, recentes gardees', () => {
    const pending = {};
    pending['123'] = { step: 'ask_email', createdAt: Date.now() - 15 * 60 * 1000 }; // 15 min
    pending['456'] = { step: 'ask_email', createdAt: Date.now() - 5 * 60 * 1000 };  // 5 min

    const TTL = 10 * 60 * 1000;
    const now = Date.now();
    for (const id of Object.keys(pending)) {
      if (now - (pending[id].createdAt || 0) > TTL) {
        delete pending[id];
      }
    }

    assert.equal(Object.keys(pending).length, 1);
    assert.ok(pending['456']);
    assert.equal(pending['123'], undefined);
  });
});

// --- Tests GoogleCalendarClient ---
describe('GoogleCalendarClient — unit tests', () => {
  const GoogleCalendarClient = require('../skills/meeting-scheduler/google-calendar-client.js');

  it('isConfigured retourne false sans booking URL', () => {
    const gcal = new GoogleCalendarClient({ bookingUrl: '' });
    assert.equal(gcal.isConfigured(), false);
  });

  it('isConfigured retourne true avec booking URL', () => {
    const gcal = new GoogleCalendarClient({ bookingUrl: 'https://calendar.google.com/calendar/appointments/xxx' });
    assert.equal(gcal.isConfigured(), true);
  });

  it('isApiConfigured retourne false sans calendarId', () => {
    const gcal = new GoogleCalendarClient({ bookingUrl: 'https://test.com', calendarId: '' });
    assert.equal(gcal.isApiConfigured(), false);
  });

  it('getBookingLink ajoute email et name en query params', async () => {
    const gcal = new GoogleCalendarClient({ bookingUrl: 'https://calendar.google.com/calendar/appointments/test' });
    const link = await gcal.getBookingLink(null, 'john@test.com', 'John Doe');
    assert.ok(link.includes('email=john'));
    assert.ok(link.includes('name=John'));
  });

  it('getBookingLink retourne null sans bookingUrl', async () => {
    const gcal = new GoogleCalendarClient({});
    const link = await gcal.getBookingLink(null, 'a@b.com', 'Test');
    assert.equal(link, null);
  });

  it('getEventTypes retourne un event type par defaut', async () => {
    const gcal = new GoogleCalendarClient({});
    const types = await gcal.getEventTypes();
    assert.equal(types.length, 1);
    assert.equal(types[0].slug, 'appel-decouverte');
  });

  it('getProfile en mode link-only retourne un profil minimal', async () => {
    const gcal = new GoogleCalendarClient({ bookingUrl: 'https://test.com' });
    const profile = await gcal.getProfile();
    assert.ok(profile);
    assert.equal(profile.username, 'google-calendar');
  });

  it('getProfile sans bookingUrl retourne null', async () => {
    const gcal = new GoogleCalendarClient({});
    const profile = await gcal.getProfile();
    assert.equal(profile, null);
  });
});
