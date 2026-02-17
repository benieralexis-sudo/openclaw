// Meeting Scheduler - Client API Cal.com
const https = require('https');
const log = require('../../gateway/logger.js');

class CalComClient {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey || '';
    this.baseUrl = baseUrl || 'https://api.cal.com';
  }

  isConfigured() {
    return !!(this.apiKey);
  }

  _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      url.searchParams.set('apiKey', this.apiKey);

      const postData = body ? JSON.stringify(body) : '';
      const headers = {
        'Content-Type': 'application/json'
      };
      if (postData) headers['Content-Length'] = Buffer.byteLength(postData);

      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: method,
        headers: headers
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ statusCode: res.statusCode, data: parsed });
          } catch (e) {
            resolve({ statusCode: res.statusCode, data: data });
          }
        });
      });

      req.on('error', (e) => {
        log.error('calcom', 'Erreur reseau:', e.message);
        reject(new Error('Cal.com erreur reseau: ' + e.message));
      });
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Cal.com timeout (15s)'));
      });
      if (postData) req.write(postData);
      req.end();
    });
  }

  // Recuperer les event types disponibles
  async getEventTypes() {
    if (!this.isConfigured()) return [];
    try {
      const result = await this._request('GET', '/v1/event-types');
      if (result.statusCode === 200 && result.data.event_types) {
        return result.data.event_types.map(et => ({
          id: et.id,
          title: et.title,
          slug: et.slug,
          length: et.length,
          description: et.description || ''
        }));
      }
      log.warn('calcom', 'getEventTypes HTTP ' + result.statusCode);
      return [];
    } catch (e) {
      log.error('calcom', 'Erreur getEventTypes:', e.message);
      return [];
    }
  }

  // Generer un lien de reservation pour un lead
  async getBookingLink(eventTypeSlug, leadEmail, leadName) {
    if (!this.isConfigured()) return null;

    // Le lien de booking Cal.com est compose du username + slug
    try {
      const result = await this._request('GET', '/v1/me');
      if (result.statusCode === 200 && result.data.user) {
        const username = result.data.user.username;
        const params = new URLSearchParams();
        if (leadEmail) params.set('email', leadEmail);
        if (leadName) params.set('name', leadName);
        const queryStr = params.toString() ? '?' + params.toString() : '';
        return 'https://cal.com/' + username + '/' + eventTypeSlug + queryStr;
      }
    } catch (e) {
      log.error('calcom', 'Erreur getBookingLink:', e.message);
    }

    return null;
  }

  // Recuperer les bookings existants
  async getBookings(status) {
    if (!this.isConfigured()) return [];
    try {
      const path = status ? '/v1/bookings?status=' + status : '/v1/bookings';
      const result = await this._request('GET', path);
      if (result.statusCode === 200 && result.data.bookings) {
        return result.data.bookings.map(b => ({
          id: b.id,
          uid: b.uid,
          title: b.title,
          startTime: b.startTime,
          endTime: b.endTime,
          status: b.status,
          attendees: (b.attendees || []).map(a => ({ email: a.email, name: a.name })),
          meetingUrl: b.metadata?.videoCallUrl || null
        }));
      }
      return [];
    } catch (e) {
      log.error('calcom', 'Erreur getBookings:', e.message);
      return [];
    }
  }

  // Recuperer le profil utilisateur (pour le username)
  async getProfile() {
    if (!this.isConfigured()) return null;
    try {
      const result = await this._request('GET', '/v1/me');
      if (result.statusCode === 200 && result.data.user) {
        return {
          id: result.data.user.id,
          username: result.data.user.username,
          name: result.data.user.name,
          email: result.data.user.email,
          timeZone: result.data.user.timeZone
        };
      }
      return null;
    } catch (e) {
      log.error('calcom', 'Erreur getProfile:', e.message);
      return null;
    }
  }
}

module.exports = CalComClient;
