// Google Calendar API Client — Remplacement de CalComClient
// Compatible Cal.eu interface (isConfigured, getBookingLink, getBookings, getProfile)
'use strict';

let google = null;
try {
  google = require('googleapis').google;
} catch (e) {
  // googleapis non installe — sera installe au boot via pnpm
}
const log = require('../../gateway/logger.js');

class GoogleCalendarClient {
  constructor(options = {}) {
    this.calendarId = options.calendarId || process.env.GOOGLE_CALENDAR_ID || '';
    this.bookingUrl = options.bookingUrl || process.env.GOOGLE_BOOKING_URL || '';
    this.clientId = options.clientId || process.env.GOOGLE_CLIENT_ID || '';
    this.clientSecret = options.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '';
    this.refreshToken = options.refreshToken || process.env.GOOGLE_REFRESH_TOKEN || '';
    this.serviceAccountKey = options.serviceAccountKey || process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '';

    this._calendar = null;
    this._lastSyncToken = null;
    this._knownEventIds = new Set();
    this._profileCache = null;
    this._profileCacheTime = 0;
  }

  // --- INTERFACE PUBLIQUE (compatible CalComClient) ---

  /** Mode link-only : juste le booking URL suffit */
  isConfigured() {
    return !!(this.bookingUrl);
  }

  /** Mode API : calendarId + credentials requis pour sync */
  isApiConfigured() {
    return !!(google && this.calendarId && (this.refreshToken || this.serviceAccountKey));
  }

  /**
   * Genere un lien de booking avec pre-fill email/name.
   * @param {string} _slug - Ignore (compat CalComClient)
   * @param {string} leadEmail
   * @param {string} leadName
   */
  async getBookingLink(_slug, leadEmail, leadName) {
    if (!this.bookingUrl) return null;
    try {
      const url = new URL(this.bookingUrl);
      if (leadEmail) url.searchParams.set('email', leadEmail);
      if (leadName) url.searchParams.set('name', leadName);
      return url.toString();
    } catch (e) {
      log.warn('gcal', 'URL booking invalide: ' + e.message);
      return this.bookingUrl;
    }
  }

  /**
   * Liste les bookings (events avec attendees externes).
   * Equivalent CalComClient.getBookings()
   */
  async getBookings() {
    if (!this.isApiConfigured()) return [];
    try {
      const cal = this._getCalendarApi();
      const now = new Date();
      const timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const res = await cal.events.list({
        calendarId: this.calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 100
      });

      return (res.data.items || [])
        .filter(e => e.status !== 'cancelled')
        .map(e => this._mapEventToBooking(e));
    } catch (e) {
      log.error('gcal', 'Erreur getBookings: ' + e.message);
      return [];
    }
  }

  /**
   * Detection incrementale de nouveaux bookings via syncToken.
   * Plus efficient que getBookings() pour le polling.
   */
  async getNewBookings() {
    if (!this.isApiConfigured()) return [];
    try {
      const cal = this._getCalendarApi();
      const params = {
        calendarId: this.calendarId,
        singleEvents: true,
        maxResults: 50
      };

      if (this._lastSyncToken) {
        params.syncToken = this._lastSyncToken;
      } else {
        // Premier appel : events des 7 derniers jours + 60 jours
        params.timeMin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        params.timeMax = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      }

      const res = await cal.events.list(params);
      this._lastSyncToken = res.data.nextSyncToken || this._lastSyncToken;

      const events = res.data.items || [];
      const newBookings = [];

      for (const event of events) {
        if (event.status === 'cancelled') continue;
        if (this._knownEventIds.has(event.id)) continue;

        // Ne garder que les events avec des attendees externes
        const attendees = (event.attendees || []).filter(a => !a.self);
        if (attendees.length === 0) continue;

        this._knownEventIds.add(event.id);
        newBookings.push(this._mapEventToBooking(event));
      }

      // Limiter _knownEventIds a 1000 entries
      if (this._knownEventIds.size > 1000) {
        const arr = [...this._knownEventIds];
        this._knownEventIds = new Set(arr.slice(-500));
      }

      return newBookings;
    } catch (e) {
      if (e.code === 410 || (e.response && e.response.status === 410)) {
        log.warn('gcal', 'Sync token invalide, full refresh au prochain poll');
        this._lastSyncToken = null;
        return [];
      }
      log.error('gcal', 'Erreur getNewBookings: ' + e.message);
      return [];
    }
  }

  /**
   * Retourne un event type fixe (concept inexistant dans Google Calendar).
   * Equivalent CalComClient.getEventTypes()
   */
  async getEventTypes() {
    const duration = parseInt(process.env.DEFAULT_MEETING_DURATION || '15', 10);
    return [{
      id: 0,
      title: 'Appel decouverte',
      slug: 'appel-decouverte',
      length: duration,
      description: 'Appel decouverte ' + duration + ' min'
    }];
  }

  /**
   * Retourne le profil du calendrier.
   * Equivalent CalComClient.getProfile()
   */
  async getProfile() {
    if (!this.isApiConfigured()) {
      // Mode link-only : profil minimal
      return this.bookingUrl ? {
        id: 'google',
        username: 'google-calendar',
        name: process.env.SENDER_NAME || '',
        email: process.env.SENDER_EMAIL || '',
        timeZone: 'Europe/Paris'
      } : null;
    }

    const now = Date.now();
    if (this._profileCache && (now - this._profileCacheTime) < 3600000) {
      return this._profileCache;
    }

    try {
      const cal = this._getCalendarApi();
      const res = await cal.calendarList.get({ calendarId: this.calendarId });
      const profile = {
        id: res.data.id,
        username: 'google-calendar',
        name: res.data.summary || '',
        email: res.data.id,
        timeZone: res.data.timeZone || 'Europe/Paris'
      };
      this._profileCache = profile;
      this._profileCacheTime = now;
      return profile;
    } catch (e) {
      log.error('gcal', 'Erreur getProfile: ' + e.message);
      return null;
    }
  }

  // --- METHODES PRIVEES ---

  _getCalendarApi() {
    if (this._calendar) return this._calendar;

    if (!google) throw new Error('googleapis non installe');

    let auth;
    if (this.serviceAccountKey) {
      // Service Account
      const key = typeof this.serviceAccountKey === 'string'
        ? JSON.parse(this.serviceAccountKey)
        : this.serviceAccountKey;
      auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly']
      });
    } else {
      // OAuth2 avec refresh token
      const oauth2 = new google.auth.OAuth2(this.clientId, this.clientSecret);
      oauth2.setCredentials({ refresh_token: this.refreshToken });
      auth = oauth2;
    }

    this._calendar = google.calendar({ version: 'v3', auth });
    return this._calendar;
  }

  _mapEventToBooking(event) {
    const attendees = (event.attendees || [])
      .filter(a => !a.self)
      .map(a => ({ email: a.email || '', name: a.displayName || '' }));

    const startTime = event.start && (event.start.dateTime || event.start.date) || null;
    const endTime = event.end && (event.end.dateTime || event.end.date) || null;

    return {
      id: event.id,
      uid: event.id,
      title: event.summary || '',
      startTime,
      endTime,
      status: event.status === 'confirmed' ? 'accepted' : (event.status || 'pending'),
      attendees,
      meetingUrl: event.hangoutLink ||
        ((event.conferenceData && event.conferenceData.entryPoints) || [])
          .filter(ep => ep.entryPointType === 'video')
          .map(ep => ep.uri)[0] || null
    };
  }
}

module.exports = GoogleCalendarClient;
