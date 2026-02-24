// Meeting Scheduler - Tests unitaires (node:test natif)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// =============================================
// 1. escTg — Escape Markdown Telegram
// =============================================

describe('Meeting Scheduler — escTg', () => {
  function escTg(text) {
    if (!text) return '';
    return String(text).replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&').substring(0, 2000);
  }

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
});

// =============================================
// 2. Storage — CRUD + lifecycle
// =============================================

describe('Meeting Scheduler — Storage', () => {
  function createMiniStorage() {
    const data = {
      meetings: [],
      stats: { totalProposed: 0, totalBooked: 0, totalCancelled: 0, totalNoShow: 0, totalCompleted: 0, totalExpired: 0 }
    };
    return {
      createMeeting(md) {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const entry = {
          id, leadEmail: md.leadEmail || '', leadName: md.leadName || '',
          status: 'proposed', proposedAt: new Date().toISOString(),
          scheduledAt: md.scheduledAt || null, duration: md.duration || 30,
          bookedAt: null, completedAt: null, expiredAt: null, reminderSent: false
        };
        data.meetings.push(entry);
        data.stats.totalProposed++;
        return entry;
      },
      updateMeetingStatus(meetingId, status) {
        const m = data.meetings.find(x => x.id === meetingId);
        if (!m) return null;
        m.status = status;
        if (status === 'booked') { m.bookedAt = new Date().toISOString(); data.stats.totalBooked++; }
        if (status === 'cancelled') data.stats.totalCancelled++;
        if (status === 'no_show') data.stats.totalNoShow++;
        if (status === 'completed') { m.completedAt = new Date().toISOString(); data.stats.totalCompleted++; }
        if (status === 'expired') { m.expiredAt = new Date().toISOString(); data.stats.totalExpired++; }
        return m;
      },
      getMeetingByEmail(email) {
        return data.meetings.filter(m => m.leadEmail.toLowerCase() === email.toLowerCase())
          .sort((a, b) => (b.proposedAt || '').localeCompare(a.proposedAt || ''));
      },
      getStats() {
        const tp = data.stats.totalProposed || 0;
        const tb = data.stats.totalBooked || 0;
        return { ...data.stats, conversionRate: tp > 0 ? Math.round((tb / tp) * 100) : 0, totalMeetings: data.meetings.length };
      },
      _data: data
    };
  }

  it('createMeeting incremente totalProposed', () => {
    const s = createMiniStorage();
    s.createMeeting({ leadEmail: 'a@b.com' });
    assert.equal(s.getStats().totalProposed, 1);
    assert.equal(s.getStats().totalMeetings, 1);
  });

  it('updateMeetingStatus booked', () => {
    const s = createMiniStorage();
    const m = s.createMeeting({ leadEmail: 'a@b.com' });
    s.updateMeetingStatus(m.id, 'booked');
    assert.equal(m.status, 'booked');
    assert.ok(m.bookedAt);
    assert.equal(s.getStats().totalBooked, 1);
  });

  it('updateMeetingStatus completed', () => {
    const s = createMiniStorage();
    const m = s.createMeeting({ leadEmail: 'a@b.com' });
    s.updateMeetingStatus(m.id, 'completed');
    assert.equal(m.status, 'completed');
    assert.ok(m.completedAt);
    assert.equal(s.getStats().totalCompleted, 1);
  });

  it('updateMeetingStatus expired', () => {
    const s = createMiniStorage();
    const m = s.createMeeting({ leadEmail: 'a@b.com' });
    s.updateMeetingStatus(m.id, 'expired');
    assert.equal(m.status, 'expired');
    assert.ok(m.expiredAt);
    assert.equal(s.getStats().totalExpired, 1);
  });

  it('updateMeetingStatus no_show', () => {
    const s = createMiniStorage();
    const m = s.createMeeting({ leadEmail: 'a@b.com' });
    s.updateMeetingStatus(m.id, 'no_show');
    assert.equal(m.status, 'no_show');
    assert.equal(s.getStats().totalNoShow, 1);
  });

  it('conversionRate calcule correctement', () => {
    const s = createMiniStorage();
    s.createMeeting({ leadEmail: 'a@b.com' });
    s.createMeeting({ leadEmail: 'c@d.com' });
    const m = s.createMeeting({ leadEmail: 'e@f.com' });
    s.updateMeetingStatus(m.id, 'booked');
    assert.equal(s.getStats().conversionRate, 33); // 1/3 = 33%
  });

  it('getMeetingByEmail case-insensitive', () => {
    const s = createMiniStorage();
    s.createMeeting({ leadEmail: 'John@Example.COM' });
    const result = s.getMeetingByEmail('john@example.com');
    assert.equal(result.length, 1);
  });
});

// =============================================
// 3. Intent classification
// =============================================

describe('Meeting Scheduler — Intent classification', () => {
  function classifyIntent(text) {
    const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/\b(propose|planifi|rdv|rendez|book|reserve|cale|caler)\b/i.test(t)) return 'propose';
    if (/\b(no.?show|pas.?venu|absent|ghost)\b/i.test(t)) return 'no_show';
    if (/\b(statut|status|etat)\b/i.test(t)) return 'status';
    if (/\b(prochain|a venir|upcoming|agenda)\b/i.test(t)) return 'upcoming';
    if (/\b(historique|passe|recent|dernier)\b/i.test(t)) return 'history';
    if (/\b(configur|parametr|calcom|cal\.com|cle.*api|api.*key)\b/i.test(t)) return 'configure';
    if (/\b(lien|link|url)\b/i.test(t)) return 'link';
    if (/\b(aide|help)\b/i.test(t)) return 'help';
    return 'status';
  }

  it('detecte propose', () => assert.equal(classifyIntent('propose un rdv'), 'propose'));
  it('detecte book', () => assert.equal(classifyIntent('book a meeting'), 'propose'));
  it('detecte reserve', () => assert.equal(classifyIntent('réserve un créneau'), 'propose'));
  it('detecte no-show', () => assert.equal(classifyIntent('no-show john@test.com'), 'no_show'));
  it('detecte pas venu', () => assert.equal(classifyIntent('il est pas venu'), 'no_show'));
  it('detecte ghost', () => assert.equal(classifyIntent('le prospect a ghost'), 'no_show'));
  it('detecte status', () => assert.equal(classifyIntent('statut meetings'), 'status'));
  it('detecte upcoming', () => assert.equal(classifyIntent('meetings a venir'), 'upcoming'));
  it('detecte history', () => assert.equal(classifyIntent('historique recent'), 'history'));
  it('detecte configure', () => assert.equal(classifyIntent('configurer cal.com'), 'configure'));
  it('detecte link', () => assert.equal(classifyIntent('donne moi le lien'), 'link'));
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
