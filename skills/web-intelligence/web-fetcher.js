// Web Intelligence - Collecte HTTP + parsing regex RSS/HTML
const https = require('https');
const http = require('http');
const { retryAsync } = require('../../gateway/utils.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const log = require('../../gateway/logger.js');

class WebFetcher {
  constructor() {
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.timeout = 15000;
    this.maxRedirects = 3;
    this.maxResponseSize = 5 * 1024 * 1024; // 5 MB max
  }

  // --- Fetch HTTP generique ---

  // SSRF protection: bloquer les IPs privees/locales
  _isPrivateHost(hostname) {
    // Bloquer localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') return true;
    // Bloquer les plages privees
    const parts = hostname.split('.');
    if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
      const a = parseInt(parts[0]);
      const b = parseInt(parts[1]);
      if (a === 10) return true;                          // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
      if (a === 192 && b === 168) return true;             // 192.168.0.0/16
      if (a === 169 && b === 254) return true;             // 169.254.0.0/16 (link-local)
      if (a === 127) return true;                          // 127.0.0.0/8
    }
    return false;
  }

  fetchUrl(url, redirectCount) {
    redirectCount = redirectCount || 0;
    return new Promise((resolve, reject) => {
      if (redirectCount > this.maxRedirects) {
        return reject(new Error('Trop de redirections'));
      }

      const isHttps = url.startsWith('https');
      const mod = isHttps ? https : http;

      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (e) {
        return reject(new Error('URL invalide: ' + url));
      }

      // SSRF protection
      if (this._isPrivateHost(parsedUrl.hostname)) {
        return reject(new Error('Acces bloque: adresse privee/locale'));
      }

      const isRss = /rss|feed|atom|xml/i.test(parsedUrl.pathname + parsedUrl.search);
      const acceptHeader = isRss
        ? 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          'Accept': acceptHeader,
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5'
        }
      };

      const req = mod.request(options, (res) => {
        // Gerer les redirections
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith('/')) {
            redirectUrl = (isHttps ? 'https' : 'http') + '://' + parsedUrl.hostname + redirectUrl;
          }
          return this.fetchUrl(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
        }

        let data = '';
        let truncated = false;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (truncated) return;
          data += chunk;
          if (data.length > this.maxResponseSize) {
            truncated = true;
            data = data.substring(0, this.maxResponseSize);
            req.destroy();
          }
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      });

      req.on('error', (e) => reject(new Error('Erreur fetch ' + parsedUrl.hostname + ': ' + e.message)));
      req.setTimeout(this.timeout, () => {
        req.destroy();
        reject(new Error('Timeout fetch ' + parsedUrl.hostname));
      });
      req.end();
    });
  }

  // --- Google News RSS ---

  async fetchGoogleNews(keywords) {
    if (!keywords || keywords.length === 0) return [];

    const query = encodeURIComponent(keywords.join(' '));
    const url = 'https://news.google.com/rss/search?q=' + query + '&hl=fr&gl=FR&ceid=FR:fr';

    try {
      const breaker = getBreaker('web-fetch', { failureThreshold: 5, cooldownMs: 30000 });
      const result = await breaker.call(() => retryAsync(() => this.fetchUrl(url), 2, 2000));
      if (result.statusCode === 403) {
        log.warn('web-fetcher', 'Google News 403 — fallback Bing News pour: ' + keywords.join(', '));
        return this._fetchBingNews(keywords);
      }
      if (result.statusCode !== 200) {
        log.warn('web-fetcher', 'Google News HTTP ' + result.statusCode + ' pour: ' + keywords.join(', '));
        return this._fetchBingNews(keywords);
      }
      const articles = this.parseRssXml(result.body);
      if (articles.length === 0) {
        log.warn('web-fetcher', 'Google News 0 articles — fallback Bing News pour: ' + keywords.join(', '));
        return this._fetchBingNews(keywords);
      }
      return articles.map(a => {
        a.source = a.source || 'Google News';
        return a;
      });
    } catch (e) {
      log.error('web-fetcher', 'Erreur Google News:', e.message, '— fallback Bing News');
      return this._fetchBingNews(keywords);
    }
  }

  // Fallback Bing News RSS quand Google News echoue (403 etc.)
  async _fetchBingNews(keywords) {
    if (!keywords || keywords.length === 0) return [];

    const query = encodeURIComponent(keywords.join(' '));
    const bingUrl = 'https://www.bing.com/news/search?q=' + query + '&format=rss';

    try {
      const breaker = getBreaker('web-fetch', { failureThreshold: 5, cooldownMs: 30000 });
      const result = await breaker.call(() => retryAsync(() => this.fetchUrl(bingUrl), 2, 2000));
      if (result.statusCode !== 200) {
        log.warn('web-fetcher', 'Bing News HTTP ' + result.statusCode + ' pour: ' + keywords.join(', '));
        return [];
      }
      const articles = this.parseRssXml(result.body);
      return articles.map(a => {
        a.source = a.source || 'Bing News';
        return a;
      });
    } catch (e) {
      log.error('web-fetcher', 'Erreur Bing News:', e.message);
      return [];
    }
  }

  // --- Flux RSS custom ---

  async fetchRss(url) {
    try {
      const breaker = getBreaker('web-fetch', { failureThreshold: 5, cooldownMs: 30000 });
      const result = await breaker.call(() => retryAsync(() => this.fetchUrl(url), 2, 2000));
      if (result.statusCode !== 200) {
        log.warn('web-fetcher', 'RSS HTTP ' + result.statusCode + ' pour: ' + url);
        return [];
      }
      const articles = this.parseRssXml(result.body);
      const domain = this._extractDomain(url);
      return articles.map(a => {
        if (!a.source) a.source = 'RSS: ' + domain;
        return a;
      });
    } catch (e) {
      log.error('web-fetcher', 'Erreur RSS ' + url + ':', e.message);
      return [];
    }
  }

  // --- Scraping web basique ---

  async scrapeWebPage(url) {
    try {
      const breaker = getBreaker('web-fetch', { failureThreshold: 5, cooldownMs: 30000 });
      const result = await breaker.call(() => retryAsync(() => this.fetchUrl(url), 2, 2000));
      if (result.statusCode !== 200) {
        log.warn('web-fetcher', 'Scrape HTTP ' + result.statusCode + ' pour: ' + url);
        return null;
      }
      const parsed = this.parseHtml(result.body);
      parsed.url = url;
      parsed.source = 'Web: ' + this._extractDomain(url);
      return parsed;
    } catch (e) {
      log.error('web-fetcher', 'Erreur scrape ' + url + ':', e.message);
      return null;
    }
  }

  // --- Parsing RSS XML (regex) ---

  parseRssXml(xml) {
    const articles = [];
    if (!xml) return articles;

    // Extraire chaque <item>...</item>
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const title = this._extractTag(item, 'title');
      const link = this._extractLink(item);
      const pubDate = this._extractTag(item, 'pubDate');
      const source = this._extractTagAttr(item, 'source');
      const description = this._extractTag(item, 'description');

      if (title && link) {
        articles.push({
          title: this._decodeHtmlEntities(title).trim(),
          link: link.trim(),
          pubDate: pubDate || null,
          source: source ? this._decodeHtmlEntities(source) : null,
          snippet: this._cleanHtml(description || '').substring(0, 300)
        });
      }
    }

    // Si pas d'<item>, essayer <entry> (Atom)
    if (articles.length === 0) {
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
      while ((match = entryRegex.exec(xml)) !== null) {
        const entry = match[1];
        const title = this._extractTag(entry, 'title');
        const linkMatch = entry.match(/<link[^>]*href=["']([^"']+)["']/i);
        const link = linkMatch ? linkMatch[1] : this._extractTag(entry, 'link');
        const pubDate = this._extractTag(entry, 'published') || this._extractTag(entry, 'updated');
        const summary = this._extractTag(entry, 'summary') || this._extractTag(entry, 'content');

        if (title && link) {
          articles.push({
            title: this._decodeHtmlEntities(title).trim(),
            link: link.trim(),
            pubDate: pubDate || null,
            source: null,
            snippet: this._cleanHtml(summary || '').substring(0, 300)
          });
        }
      }
    }

    return articles;
  }

  // --- Parsing HTML basique (regex) ---

  parseHtml(html) {
    if (!html) return { title: '', description: '', textContent: '' };

    // Titre
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? this._decodeHtmlEntities(titleMatch[1].trim()) : '';

    // Meta description
    const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i)
      || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["']/i);
    const description = metaMatch ? this._decodeHtmlEntities(metaMatch[1].trim()) : '';

    // OG description si pas de meta
    let ogDesc = '';
    if (!description) {
      const ogMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i);
      ogDesc = ogMatch ? this._decodeHtmlEntities(ogMatch[1].trim()) : '';
    }

    // Corps texte: supprimer scripts, styles, nav, footer, puis strip tags
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      title: title,
      description: description || ogDesc,
      textContent: text.substring(0, 3000)
    };
  }

  // --- Helpers ---

  _extractTag(xml, tag) {
    // Gere <tag>contenu</tag> et <tag><![CDATA[contenu]]></tag>
    const regex = new RegExp('<' + tag + '[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/' + tag + '>', 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
  }

  _extractLink(item) {
    // D'abord essayer <link>URL</link>
    const linkTag = this._extractTag(item, 'link');
    if (linkTag && linkTag.startsWith('http')) return linkTag;

    // Sinon <link>...</link> avec contenu apres tag fermant (RSS quirk)
    const linkMatch = item.match(/<link[^>]*>([^<]*)/i);
    if (linkMatch && linkMatch[1].trim().startsWith('http')) return linkMatch[1].trim();

    // Sinon <guid>
    const guid = this._extractTag(item, 'guid');
    if (guid && guid.startsWith('http')) return guid;

    return linkTag;
  }

  _extractTagAttr(xml, tag) {
    // Extrait le contenu texte d'un tag (ex: <source url="...">Nom</source>)
    const regex = new RegExp('<' + tag + '[^>]*>([^<]*)<\\/' + tag + '>', 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
  }

  _decodeHtmlEntities(str) {
    if (!str) return '';
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&nbsp;/g, ' ');
  }

  _extractDomain(url) {
    try {
      const match = url.match(/https?:\/\/([^\/]+)/);
      return match ? match[1] : url;
    } catch (e) {
      return url;
    }
  }

  _cleanHtml(html) {
    if (!html) return '';
    return this._decodeHtmlEntities(
      html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
  }
}

module.exports = WebFetcher;
