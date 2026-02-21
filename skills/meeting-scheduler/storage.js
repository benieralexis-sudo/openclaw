// Meeting Scheduler - Stockage persistant JSON
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../../gateway/utils.js');

const DATA_DIR = process.env.MEETING_SCHEDULER_DATA_DIR || '/data/meeting-scheduler';
const DB_FILE = path.join(DATA_DIR, 'meeting-scheduler-db.json');

class MeetingSchedulerStorage {
  constructor() {
    this.data = {
      config: {
        enabled: false,
        calcomApiKey: '',
        calcomBaseUrl: 'https://api.cal.eu',
        defaultEventTypeId: null,
        defaultDurationMinutes: 30,
        autoPropose: false  // Proposer auto un rdv quand lead hot
      },
      meetings: [],     // [{id, leadEmail, leadName, status, bookingUrl, scheduledAt, calcomBookingId}]
      eventTypes: [],   // Cached from Cal.com API
      stats: {
        totalProposed: 0,
        totalBooked: 0,
        totalCancelled: 0,
        totalNoShow: 0,
        createdAt: new Date().toISOString()
      }
    };
    this._ensureDir();
    this._load();
  }

  _ensureDir() {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  }

  _load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const loaded = JSON.parse(raw);
        this.data = { ...this.data, ...loaded };
        if (!this.data.meetings) this.data.meetings = [];
        if (!this.data.eventTypes) this.data.eventTypes = [];
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
      atomicWriteSync(DB_FILE, this.data);
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
      calcomBookingId: meetingData.calcomBookingId || null,
      scheduledAt: meetingData.scheduledAt || null,
      duration: meetingData.duration || 30,
      notes: meetingData.notes || '',
      proposedAt: new Date().toISOString(),
      bookedAt: null,
      completedAt: null
    };

    this.data.meetings.push(entry);
    this.data.stats.totalProposed++;
    this._save();
    return entry;
  }

  updateMeetingStatus(meetingId, status, extra) {
    const meeting = this.data.meetings.find(m => m.id === meetingId);
    if (!meeting) return null;

    meeting.status = status;
    if (extra) Object.assign(meeting, extra);

    if (status === 'booked') {
      meeting.bookedAt = new Date().toISOString();
      this.data.stats.totalBooked++;
    } else if (status === 'cancelled') {
      this.data.stats.totalCancelled++;
    } else if (status === 'no_show') {
      this.data.stats.totalNoShow++;
    } else if (status === 'completed') {
      meeting.completedAt = new Date().toISOString();
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
    return {
      ...this.data.stats,
      upcoming: this.getUpcomingMeetings().length,
      totalMeetings: this.data.meetings.length
    };
  }
}

module.exports = new MeetingSchedulerStorage();
