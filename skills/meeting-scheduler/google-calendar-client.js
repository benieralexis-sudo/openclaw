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

  /**
   * Cree un meeting Google Calendar avec un prospect.
   * @param {string} leadEmail
   * @param {string} leadName
   * @param {Date|string} startTime - Date de debut du meeting
   * @param {number} durationMinutes - Duree en minutes (default 15)
   * @returns {Promise<{success: boolean, eventId: string, meetingUrl: string, startTime: string, endTime: string}|null>}
   */
  async createMeeting(leadEmail, leadName, startTime, durationMinutes = 15) {
    if (!this.isApiConfigured()) {
      log.warn('gcal', 'API non configuree — impossible de creer un meeting');
      return null;
    }

    try {
      const cal = this._getCalendarApi();
      const start = new Date(startTime);
      if (isNaN(start.getTime())) {
        log.warn('gcal', 'Date invalide pour createMeeting: ' + startTime);
        return null;
      }
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      const senderName = process.env.SENDER_NAME || 'Alexis';
      const senderEmail = process.env.SENDER_EMAIL || process.env.EMAIL || '';

      const event = {
        summary: 'Appel decouverte — ' + (leadName || leadEmail),
        description: 'Appel decouverte ' + durationMinutes + ' min avec ' + (leadName || leadEmail) + '\nOrganise automatiquement suite a l\'interet du prospect.',
        start: { dateTime: start.toISOString(), timeZone: 'Europe/Paris' },
        end: { dateTime: end.toISOString(), timeZone: 'Europe/Paris' },
        attendees: [
          { email: leadEmail, displayName: leadName || '' },
          ...(senderEmail ? [{ email: senderEmail, displayName: senderName }] : [])
        ],
        conferenceData: {
          createRequest: {
            requestId: 'ifind-' + Date.now(),
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 30 },
            { method: 'popup', minutes: 10 }
          ]
        }
      };

      const res = await cal.events.insert({
        calendarId: this.calendarId,
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all' // Envoie invitation par email au prospect
      });

      const meetingUrl = res.data.hangoutLink ||
        ((res.data.conferenceData && res.data.conferenceData.entryPoints) || [])
          .filter(ep => ep.entryPointType === 'video')
          .map(ep => ep.uri)[0] || null;

      log.info('gcal', 'Meeting cree: ' + res.data.id + ' avec ' + leadEmail + ' le ' + start.toISOString());

      return {
        success: true,
        eventId: res.data.id,
        meetingUrl,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        htmlLink: res.data.htmlLink
      };
    } catch (e) {
      log.error('gcal', 'Erreur createMeeting: ' + e.message);
      return null;
    }
  }

  /**
   * Resout un texte de disponibilite ("mardi 15h", "demain 10h") en Date.
   * @param {string} dayText - ex: "mardi", "demain", "jeudi"
   * @param {string} timeText - ex: "15h", "10h30", "14:00"
   * @returns {Date|null}
   */
  static resolveAvailability(dayText, timeText) {
    if (!dayText) return null;

    const now = new Date();
    let targetDate = null;
    const dayLower = (dayText || '').toLowerCase().trim();

    // Jours de la semaine
    const dayMap = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0 };
    if (dayMap[dayLower] !== undefined) {
      const targetDay = dayMap[dayLower];
      const currentDay = now.getDay();
      let daysAhead = targetDay - currentDay;
      if (daysAhead <= 0) daysAhead += 7; // Prochain occurrence
      targetDate = new Date(now);
      targetDate.setDate(now.getDate() + daysAhead);
    } else if (dayLower === 'demain') {
      targetDate = new Date(now);
      targetDate.setDate(now.getDate() + 1);
    } else if (dayLower.includes('apres-demain') || dayLower.includes('apres demain')) {
      targetDate = new Date(now);
      targetDate.setDate(now.getDate() + 2);
    } else if (dayLower.includes('semaine prochaine') || dayLower.includes('debut de semaine')) {
      targetDate = new Date(now);
      const daysToMonday = (8 - now.getDay()) % 7 || 7;
      targetDate.setDate(now.getDate() + daysToMonday);
    } else {
      // Essai date DD/MM
      const dateMatch = dayText.match(/(\d{1,2})[\/\-](\d{1,2})/);
      if (dateMatch) {
        targetDate = new Date(now.getFullYear(), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[1]));
        if (targetDate < now) targetDate.setFullYear(now.getFullYear() + 1);
      }
    }

    if (!targetDate) return null;

    // Parser l'heure
    let hours = 10, minutes = 0; // Default 10h
    if (timeText) {
      const timeLower = (timeText || '').toLowerCase();
      const hMatch = timeLower.match(/(\d{1,2})\s*[hH:]\s*(\d{0,2})/);
      if (hMatch) {
        hours = parseInt(hMatch[1]);
        minutes = hMatch[2] ? parseInt(hMatch[2]) : 0;
      } else if (timeLower.includes('matin')) {
        hours = 10; minutes = 0;
      } else if (timeLower.includes('apres') || timeLower.includes('aprem')) {
        hours = 14; minutes = 30;
      } else if (timeLower.includes('fin de journee')) {
        hours = 17; minutes = 0;
      }
    }

    targetDate.setHours(hours, minutes, 0, 0);

    // Verifier que c'est dans le futur et heures business (8h-18h)
    if (targetDate <= now) return null;
    if (hours < 8 || hours >= 19) return null;

    return targetDate;
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
        scopes: ['https://www.googleapis.com/auth/calendar']
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
