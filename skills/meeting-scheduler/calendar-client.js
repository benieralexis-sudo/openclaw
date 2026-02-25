// Meeting Scheduler - Client API Cal.com (compatible cal.eu v2)
const https = require('https');
const log = require('../../gateway/logger.js');
const { retryAsync } = require('../../gateway/utils.js');

class CalComClient {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey || '';
    this.baseUrl = baseUrl || 'https://api.cal.eu';
    // Cal.eu profile cache
    this._profileCache = null;
    this._profileCacheTime = 0;
    // Compteur 401 consecutifs pour alerte
    this._consecutive401 = 0;
    // Fallback event type (hardcoded from cal.eu account)
    this._fallbackEventType = {
      id: 0,
      title: 'Appel téléphonique',
      slug: 'appel-telephonique',
      length: 15,
      description: 'Appel découverte 15 min'
    };
  }

  isConfigured() {
    return !!(this.apiKey);
  }

  _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);

      const postData = body ? JSON.stringify(body) : '';
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.apiKey,
        'cal-api-version': '2024-08-13'
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

  // Appel API avec retry (3 tentatives, backoff 2s/4s/8s)
  async _requestWithRetry(method, path, body) {
    return retryAsync(() => this._request(method, path, body), 3, 2000);
  }

  // Recuperer les event types — Cal.eu n'expose PAS /v2/event-types,
  // on utilise le slug configure en env ou le fallback hardcode
  async getEventTypes() {
    if (!this.isConfigured()) return [];

    // Lire slug depuis env si disponible
    const envSlug = process.env.CALCOM_EVENT_SLUG;
    if (envSlug) {
      return [{
        id: 0,
        title: 'Appel téléphonique',
        slug: envSlug,
        length: 15,
        description: 'Appel découverte 15 min'
      }];
    }

    return [this._fallbackEventType];
  }

  // Generer un lien de reservation pour un lead
  async getBookingLink(eventTypeSlug, leadEmail, leadName) {
    if (!this.isConfigured()) return null;

    try {
      const profile = await this.getProfile();
      if (profile && profile.username) {
        const params = new URLSearchParams();
        if (leadEmail) params.set('email', leadEmail);
        if (leadName) params.set('name', leadName);
        const queryStr = params.toString() ? '?' + params.toString() : '';
        return 'https://cal.eu/' + profile.username + '/' + eventTypeSlug + queryStr;
      }
    } catch (e) {
      log.error('calcom', 'Erreur getBookingLink:', e.message);
    }

    // Fallback direct avec username configurable (env ou hardcoded)
    const fallbackUser = process.env.CALCOM_USERNAME || 'alexis-benier-sarxqi';
    const params = new URLSearchParams();
    if (leadEmail) params.set('email', leadEmail);
    if (leadName) params.set('name', leadName);
    const queryStr = params.toString() ? '?' + params.toString() : '';
    return 'https://cal.eu/' + fallbackUser + '/' + eventTypeSlug + queryStr;
  }

  // Recuperer les bookings existants
  async getBookings(status) {
    if (!this.isConfigured()) return [];
    try {
      const reqPath = status ? '/v2/bookings?status=' + status : '/v2/bookings';
      const result = await this._requestWithRetry('GET', reqPath);
      if (result.statusCode === 200 && result.data.data) {
        this._consecutive401 = 0; // Reset sur succes
        const bookings = Array.isArray(result.data.data) ? result.data.data : [];
        return bookings.map(b => ({
          id: b.id,
          uid: b.uid,
          title: b.title,
          startTime: b.startTime || b.start,
          endTime: b.endTime || b.end,
          status: b.status,
          attendees: (b.attendees || []).map(a => ({ email: a.email, name: a.name })),
          meetingUrl: b.meetingUrl || (b.metadata && b.metadata.videoCallUrl) || null
        }));
      }
      if (result.statusCode === 401) {
        this._consecutive401++;
        if (this._consecutive401 >= 3) {
          log.error('calcom', 'ALERTE: API key invalide depuis ' + this._consecutive401 + ' syncs consecutifs — verifier CALCOM_API_KEY');
        } else {
          log.error('calcom', 'getBookings: API key invalide (401) — tentative ' + this._consecutive401 + '/3');
        }
      } else {
        log.warn('calcom', 'getBookings HTTP ' + result.statusCode);
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

    // Cache profil 1h
    const now = Date.now();
    if (this._profileCache && (now - this._profileCacheTime) < 3600000) {
      return this._profileCache;
    }

    try {
      const result = await this._requestWithRetry('GET', '/v2/me');
      // v2 API: data is at result.data.data (not result.data.user)
      const user = result.data.data || result.data.user || result.data;
      if (result.statusCode === 200 && user && user.username) {
        const profile = {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          timeZone: user.timeZone
        };
        this._profileCache = profile;
        this._profileCacheTime = now;
        return profile;
      }
      log.warn('calcom', 'getProfile HTTP ' + result.statusCode);
      return null;
    } catch (e) {
      log.error('calcom', 'Erreur getProfile:', e.message);
      return null;
    }
  }
}

module.exports = CalComClient;
