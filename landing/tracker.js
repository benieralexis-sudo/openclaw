// Visitor Tracking - Detection visiteurs site web
const https = require('https');
const visitorStorage = require('./visitor-storage.js');

const IPINFO_TOKEN = process.env.IPINFO_TOKEN || '';
const TRACKING_ENABLED = process.env.VISITOR_TRACKING_ENABLED !== 'false';

class VisitorTracker {
  constructor(options) {
    this.telegramNotify = options.telegramNotify || null; // function(text)
    this._lookupQueue = [];
    this._processing = false;
  }

  // --- IP Lookup via ipinfo.io (free tier 50k/mois) ---

  lookupIP(ip) {
    return new Promise((resolve, reject) => {
      // Ignorer les IPs privees/locales
      if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
        return resolve({ ip: ip, company: null, city: null, org: null });
      }

      // Check cache
      const cached = visitorStorage.getCachedIP(ip);
      if (cached) {
        return resolve(cached);
      }

      const path = IPINFO_TOKEN
        ? '/' + ip + '?token=' + IPINFO_TOKEN
        : '/' + ip + '/json';

      const hostname = IPINFO_TOKEN ? 'ipinfo.io' : 'ipinfo.io';

      const req = https.request({
        hostname: hostname,
        path: path,
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const result = {
              ip: ip,
              company: parsed.company ? parsed.company.name : null,
              org: parsed.org || null,
              city: parsed.city || null,
              region: parsed.region || null,
              country: parsed.country || null,
              hostname: parsed.hostname || null
            };

            // Extraire le nom de l'entreprise du champ org (format: "AS12345 Company Name")
            if (!result.company && result.org) {
              const orgMatch = result.org.match(/^AS\d+\s+(.+)$/);
              if (orgMatch) {
                const orgName = orgMatch[1].trim();
                // Filtrer les ISP generiques (pas des entreprises)
                const ISP_KEYWORDS = ['telecom', 'mobile', 'hosting', 'cloud', 'datacenter', 'broadband', 'communications',
                  'orange', 'sfr', 'free', 'bouygues', 'iliad', 'ovh', 'amazon', 'google', 'microsoft', 'cloudflare',
                  'digitalocean', 'hetzner', 'linode', 'vultr', 'akamai'];
                const isISP = ISP_KEYWORDS.some(k => orgName.toLowerCase().includes(k));
                if (!isISP) {
                  result.company = orgName;
                }
              }
            }

            visitorStorage.cacheIPLookup(ip, result);
            resolve(result);
          } catch (e) {
            resolve({ ip: ip, company: null, city: null, org: null, error: e.message });
          }
        });
      });

      req.on('error', (e) => {
        resolve({ ip: ip, company: null, city: null, org: null, error: e.message });
      });
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ ip: ip, company: null, city: null, org: null, error: 'timeout' });
      });
      req.end();
    });
  }

  // --- Routes Express ---

  setupRoutes(app) {
    if (!TRACKING_ENABLED) {
      console.log('[tracker] Visitor tracking desactive');
      return;
    }

    // Script de tracking minifie — le client le colle sur son site
    app.get('/t.js', (req, res) => {
      res.set('Content-Type', 'application/javascript');
      res.set('Cache-Control', 'public, max-age=3600');
      // Script leger : envoie URL, referrer, timestamp. Pas de cookies. RGPD-friendly.
      res.send(this._getTrackingScript(req));
    });

    // Rate-limiting pour /api/track (anti-flood)
    const trackRateLimit = new Map();
    setInterval(() => trackRateLimit.clear(), 60000);

    // Reception des page views
    app.post('/api/track', async (req, res) => {
      try {
        const ip = req.ip || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '';
        // Nettoyer l'IP (prendre la premiere si liste)
        const cleanIP = ip.split(',')[0].trim().replace('::ffff:', '');

        // Rate limit: max 30 requetes/min par IP
        const rlCount = trackRateLimit.get(cleanIP) || 0;
        if (rlCount > 30) return res.json({ ok: true });
        trackRateLimit.set(cleanIP, rlCount + 1);

        const { url, referrer, title } = req.body || {};

        // Lookup IP
        const ipInfo = await this.lookupIP(cleanIP);

        // Stocker la visite
        const visit = visitorStorage.addVisit({
          ip: cleanIP,
          url: (url || '').substring(0, 500),
          referrer: (referrer || '').substring(0, 500),
          userAgent: (req.headers['user-agent'] || '').substring(0, 300),
          company: ipInfo.company,
          city: ipInfo.city,
          region: ipInfo.region,
          country: ipInfo.country,
          org: ipInfo.org
        });

        // Alerter si entreprise detectee (et pas un ISP)
        if (ipInfo.company && this.telegramNotify) {
          const companyData = visitorStorage.getCompanyVisits(ipInfo.company);
          // Alerter seulement a la premiere visite ou si pattern notable (3+ pages)
          if (companyData && (companyData.visitCount === 1 || companyData.pages.length >= 3)) {
            const alertMsg = '👁️ *Visiteur detecte — ' + ipInfo.company + '*\n' +
              '📍 ' + (ipInfo.city || '?') + ', ' + (ipInfo.country || '?') + '\n' +
              '📄 ' + (url || '(page inconnue)') + '\n' +
              (companyData.visitCount > 1 ? '📊 ' + companyData.visitCount + ' visites, ' + companyData.pages.length + ' pages\n' : '') +
              (referrer ? '🔗 Referrer: ' + referrer + '\n' : '');

            try {
              await this.telegramNotify(alertMsg);
              visitorStorage.addAlert({
                company: ipInfo.company,
                message: alertMsg,
                type: companyData.visitCount === 1 ? 'first_visit' : 'notable_activity'
              });
            } catch (e) {
              console.error('[tracker] Telegram alert failed:', e.message);
            }
          }
        }

        res.json({ ok: true });
      } catch (e) {
        console.error('[tracker] Track error:', e.message);
        res.json({ ok: true }); // Ne pas exposer les erreurs
      }
    });

    // Pixel de tracking 1x1 (pour emails ou pages passives)
    app.get('/v/:id.gif', async (req, res) => {
      // Pixel GIF 1x1 transparent
      const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      res.set('Content-Type', 'image/gif');
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.send(pixel);

      // Tracker la visite en background
      try {
        const ip = (req.ip || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace('::ffff:', '');
        const safeId = (req.params.id || '').substring(0, 64).replace(/[^a-zA-Z0-9_-]/g, '');
        const ipInfo = await this.lookupIP(ip);
        visitorStorage.addVisit({
          ip: ip,
          url: '/v/' + safeId,
          referrer: (req.headers.referer || '').substring(0, 500),
          userAgent: (req.headers['user-agent'] || '').substring(0, 300),
          company: ipInfo.company,
          city: ipInfo.city,
          region: ipInfo.region,
          country: ipInfo.country,
          org: ipInfo.org
        });
      } catch (e) { console.error('[tracker] Pixel tracking error:', e.message); }
    });

    // API: stats visiteurs (interne seulement)
    app.get('/api/visitors/stats', (req, res) => {
      const ip = req.ip || '';
      const isInternal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' ||
        ip.startsWith('172.') || ip.startsWith('::ffff:172.');
      if (!isInternal) return res.status(403).json({ error: 'Acces refuse' });
      res.json(visitorStorage.getStats());
    });

    // API: digest hebdo (interne seulement)
    app.get('/api/visitors/digest', (req, res) => {
      const ip = req.ip || '';
      const isInternal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' ||
        ip.startsWith('172.') || ip.startsWith('::ffff:172.');
      if (!isInternal) return res.status(403).json({ error: 'Acces refuse' });
      res.json(visitorStorage.getWeeklyDigest());
    });

    console.log('[tracker] Visitor tracking actif (routes: /t.js, /api/track, /v/:id.gif)');
  }

  // Script de tracking minifie
  _getTrackingScript(req) {
    const host = (req.headers.host || process.env.CLIENT_DOMAIN || 'ifind.fr').replace(/[^a-zA-Z0-9.:_-]/g, '');
    const protocol = 'https';
    const endpoint = protocol + '://' + host + '/api/track';

    return '(function(){' +
      'var d={url:location.href,referrer:document.referrer,title:document.title};' +
      'try{var x=new XMLHttpRequest();' +
      'x.open("POST","' + endpoint + '",true);' +
      'x.setRequestHeader("Content-Type","application/json");' +
      'x.send(JSON.stringify(d))}catch(e){}' +
      '})();';
  }
}

module.exports = VisitorTracker;
