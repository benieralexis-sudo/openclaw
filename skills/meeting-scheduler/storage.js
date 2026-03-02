// Meeting Scheduler - Stockage persistant JSON
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../../gateway/utils.js');

const DEFAULT_DATA_DIR = process.env.MEETING_SCHEDULER_DATA_DIR || '/data/meeting-scheduler';

class MeetingSchedulerStorage {
  constructor(customDataDir) {
    this._dataDir = customDataDir || DEFAULT_DATA_DIR;
    this._dbFile = path.join(this._dataDir, 'meeting-scheduler-db.json');
    this.data = {
      config: {
        enabled: false,
        googleCalendarId: '',
        googleBookingUrl: '',
        defaultEventTypeId: null,
        defaultDurationMinutes: 30,
        autoPropose: false  // Proposer auto un rdv quand lead hot
      },
      meetings: [],     // [{id, leadEmail, leadName, status, bookingUrl, scheduledAt, googleCalendarEventId}]
      eventTypes: [],   // Cached event types
      stats: {
        totalProposed: 0,
        totalBooked: 0,
        totalCancelled: 0,
        totalNoShow: 0,
        totalCompleted: 0,
        totalExpired: 0,
        createdAt: new Date().toISOString()
      }
    };
    this._ensureDir();
    this._load();
  }

  _ensureDir() {
    try { fs.mkdirSync(this._dataDir, { recursive: true }); } catch (e) {}
  }

  _load() {
    try {
      if (fs.existsSync(this._dbFile)) {
        const raw = fs.readFileSync(this._dbFile, 'utf-8');
        const loaded = JSON.parse(raw);
        this.data = { ...this.data, ...loaded };
        if (!this.data.meetings) this.data.meetings = [];
        if (!this.data.eventTypes) this.data.eventTypes = [];
        // Migration Cal.eu → Google Calendar
        let migrated = false;
        for (const m of this.data.meetings) {
          if (m.calcomBookingId && !m.googleCalendarEventId) {
            m.googleCalendarEventId = m.calcomBookingId;
            delete m.calcomBookingId;
            migrated = true;
          }
        }
        if (this.data.config.calcomApiKey) {
          delete this.data.config.calcomApiKey;
          delete this.data.config.calcomBaseUrl;
          migrated = true;
        }
        if (migrated) this._save();
        console.log('[meeting-scheduler-storage] Base chargee (' + this.data.meetings.length + ' meetings)');
      } else {
        console.log('[meeting-scheduler-storage] Nouvelle base creee');
        this._save();
      }
    } catch (e) {
      console.error('[meeting-scheduler-storage] Erreur chargement:', e.message);
    }
  }

  _save() {
    try {
      atomicWriteSync(this._dbFile, this.data);
    } catch (e) {
      console.error('[meeting-scheduler-storage] Erreur sauvegarde:', e.message);
    }
  }

  getConfig() {
    return { ...this.data.config };
  }

  updateConfig(updates) {
    Object.assign(this.data.config, updates);
    this._save();
    return this.data.config;
  }

  // Creer un meeting propose
  createMeeting(meetingData) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const entry = {
      id,
      leadEmail: meetingData.leadEmail || '',
      leadName: meetingData.leadName || '',
      company: meetingData.company || '',
      status: 'proposed',  // proposed, booked, cancelled, completed, no_show
      bookingUrl: meetingData.bookingUrl || '',
      googleCalendarEventId: meetingData.googleCalendarEventId || null,
      scheduledAt: meetingData.scheduledAt || null,
      duration: meetingData.duration || 30,
      notes: meetingData.notes || '',
      proposedAt: new Date().toISOString(),
      bookedAt: null,
      completedAt: null,
      reminderSent: false
    };

    this.data.meetings.push(entry);
    this.data.stats.totalProposed++;
    if (this.data.meetings.length > 500) this._pruneOldMeetings();
    this._save();
    return entry;
  }

  updateMeetingStatus(meetingId, status, extra) {
    const meeting = this.data.meetings.find(m => m.id === meetingId);
    if (!meeting) return null;

    const prevStatus = meeting.status;
    meeting.status = status;
    if (extra) Object.assign(meeting, extra);

    // Only increment stats on actual status transition (avoid double-counting)
    if (prevStatus !== status) {
      if (status === 'booked') {
        meeting.bookedAt = new Date().toISOString();
        this.data.stats.totalBooked++;
      } else if (status === 'cancelled') {
        this.data.stats.totalCancelled++;
      } else if (status === 'no_show') {
        this.data.stats.totalNoShow++;
      } else if (status === 'completed') {
        meeting.completedAt = new Date().toISOString();
        if (!this.data.stats.totalCompleted) this.data.stats.totalCompleted = 0;
        this.data.stats.totalCompleted++;
      } else if (status === 'expired') {
        meeting.expiredAt = new Date().toISOString();
        if (!this.data.stats.totalExpired) this.data.stats.totalExpired = 0;
        this.data.stats.totalExpired++;
      }
    }

    this._save();
    return meeting;
  }

  getMeeting(meetingId) {
    return this.data.meetings.find(m => m.id === meetingId) || null;
  }

  getMeetingByEmail(email) {
    return this.data.meetings
      .filter(m => m.leadEmail.toLowerCase() === email.toLowerCase())
      .sort((a, b) => (b.proposedAt || '').localeCompare(a.proposedAt || ''));
  }

  getUpcomingMeetings() {
    const now = new Date().toISOString();
    return this.data.meetings
      .filter(m => m.status === 'booked' && m.scheduledAt && m.scheduledAt > now)
      .sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));
  }

  getRecentMeetings(limit) {
    limit = limit || 10;
    return this.data.meetings.slice(-limit).reverse();
  }

  setEventTypes(types) {
    this.data.eventTypes = types;
    this._save();
  }

  getEventTypes() {
    return this.data.eventTypes || [];
  }

  getStats() {
    const totalProposed = this.data.stats.totalProposed || 0;
    const totalBooked = this.data.stats.totalBooked || 0;
    const conversionRate = totalProposed > 0 ? Math.round((totalBooked / totalProposed) * 100) : 0;
    return {
      ...this.data.stats,
      totalCompleted: this.data.stats.totalCompleted || 0,
      totalExpired: this.data.stats.totalExpired || 0,
      upcoming: this.getUpcomingMeetings().length,
      totalMeetings: this.data.meetings.length,
      conversionRate
    };
  }

  // Archiver les meetings termines au-dela de 500 entries
  _pruneOldMeetings() {
    if (this.data.meetings.length <= 500) return;
    const active = this.data.meetings.filter(m => m.status === 'proposed' || m.status === 'booked');
    const terminated = this.data.meetings.filter(m => m.status !== 'proposed' && m.status !== 'booked');
    terminated.sort((a, b) => (a.proposedAt || '').localeCompare(b.proposedAt || ''));
    const keepCount = 500 - active.length;
    const kept = keepCount > 0 ? terminated.slice(-keepCount) : [];
    const pruned = this.data.meetings.length - active.length - kept.length;
    if (pruned > 0) {
      this.data.meetings = [...active, ...kept];
      this._save();
      console.log('[meeting-scheduler-storage] Prune: ' + pruned + ' meetings archives');
    }
  }
}

const instance = new MeetingSchedulerStorage();
module.exports = instance;
module.exports.MeetingSchedulerStorage = MeetingSchedulerStorage;
