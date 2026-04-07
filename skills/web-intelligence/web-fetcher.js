// Web Intelligence - Collecte HTTP + parsing linkedom RSS/HTML
const https = require('https');
const http = require('http');
const { parseHTML } = require('linkedom');
const { retryAsync } = require('../../gateway/utils.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const log = require('../../gateway/logger.js');

class WebFetcher {
  static USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
  ];

  constructor() {
    this.userAgent = WebFetcher.USER_AGENTS[0];
    this.timeout = 20000;
    this.maxRedirects = 3;
    this.maxResponseSize = 5 * 1024 * 1024;
    this._uaIndex = Math.floor(Math.random() * WebFetcher.USER_AGENTS.length);
    this._sourceHealth = {};
    this._fetchCache = {};
  }

  _nextUA() {
    this._uaIndex = (this._uaIndex + 1) % WebFetcher.USER_AGENTS.length;
    return WebFetcher.USER_AGENTS[this._uaIndex];
  }

  _trackSourceHealth(name, success) {
    if (!this._sourceHealth[name]) this._sourceHealth[name] = { failures: 0, successes: 0, lastFail: 0, lastSuccess: 0 };
    const h = this._sourceHealth[name];
    if (success) { h.successes++; h.lastSuccess = Date.now(); h.failures = Math.max(0, h.failures - 1); }
    else { h.failures++; h.lastFail = Date.now(); }
  }

  isSourceHealthy(name) {
    const h = this._sourceHealth[name];
    if (!h) return true;
    return !(h.failures > 5 && (Date.now() - h.lastFail) < 30 * 60 * 1000);
  }

  getSourceHealth() { return { ...this._sourceHealth }; }

  _getCached(key, ttlMs) {
    const cached = this._fetchCache[key];
    if (cached && (Date.now() - cached.ts) < (ttlMs || 7200000)) return cached.data;
    return null;
  }

  _setCache(key, data) {
    this._fetchCache[key] = { data, ts: Date.now() };
    const keys = Object.keys(this._fetchCache);
    if (keys.length > 100) {
      keys.sort((a, b) => this._fetchCache[a].ts - this._fetchCache[b].ts);
      for (let i = 0; i < 20; i++) delete this._fetchCache[keys[i]];
    }
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

  fetchUrl(url, optionsOrRedirectCount) {
    // Support ancien format (redirectCount number) et nouveau format ({userAgent, redirectCount})
    let redirectCount = 0;
    let customUA = null;
    if (typeof optionsOrRedirectCount === 'number') {
      redirectCount = optionsOrRedirectCount;
    } else if (optionsOrRedirectCount && typeof optionsOrRedirectCount === 'object') {
      redirectCount = optionsOrRedirectCount.redirectCount || 0;
      customUA = optionsOrRedirectCount.userAgent || null;
    }
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
          'User-Agent': customUA || this.userAgent,
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
          return this.fetchUrl(redirectUrl, { redirectCount: redirectCount + 1, userAgent: customUA }).then(resolve).catch(reject);
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
        // 404 = page inexistante, log info (pas warn) pour eviter le bruit
        if (result.statusCode === 404) {
          log.info('web-fetcher', 'Scrape 404 (page inexistante): ' + url);
        } else {
          log.warn('web-fetcher', 'Scrape HTTP ' + result.statusCode + ' pour: ' + url);
        }
        return null;
      }
      const parsed = this.parseHtml(result.body);
      parsed.rawHtml = result.body; // Conserver le HTML brut pour detection tech stack
      parsed.url = url;
      parsed.source = 'Web: ' + this._extractDomain(url);
      return parsed;
    } catch (e) {
      log.error('web-fetcher', 'Erreur scrape ' + url + ':', e.message);
      return null;
    }
  }

  // --- DuckDuckGo News ---

  async fetchDuckDuckGoNews(keywords) {
    if (!keywords || keywords.length === 0) return [];
    const query = keywords.join(' ') + ' news';
    const ddgUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    try {
      const result = await this.fetchUrl(ddgUrl, { userAgent: this._nextUA() });
      if (result.statusCode === 202) {
        await new Promise(r => setTimeout(r, 1500));
        const retry = await this.fetchUrl(ddgUrl, { userAgent: this._nextUA() });
        if (retry.statusCode === 200) return this._parseDDGResults(retry.body);
        return [];
      }
      if (result.statusCode !== 200) return [];
      return this._parseDDGResults(result.body);
    } catch (e) {
      log.error('web-fetcher', 'Erreur DDG News:', e.message);
      return [];
    }
  }

  _parseDDGResults(html) {
    const articles = [];
    if (!html) return articles;
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null && articles.length < 15) {
      let url = m[1];
      if (url.includes('uddg=')) {
        const uddg = url.split('uddg=')[1];
        if (uddg) url = decodeURIComponent(uddg.split('&')[0]);
      }
      const title = this._decodeHtmlEntities(m[2].replace(/<[^>]+>/g, '').trim());
      if (title.length > 5) articles.push({ title, link: url, source: 'DuckDuckGo News', snippet: '', pubDate: null });
    }
    let si = 0;
    while ((m = snippetRegex.exec(html)) !== null) {
      const snippet = this._cleanHtml(m[1]).substring(0, 600);
      if (snippet.length > 20 && si < articles.length) articles[si].snippet = snippet;
      si++;
    }
    return articles;
  }

  // --- Hacker News RSS ---

  async fetchHackerNews(keywords) {
    try {
      const articles = await this.fetchRss('https://news.ycombinator.com/rss');
      if (keywords && keywords.length > 0) {
        const kwLower = keywords.map(k => k.toLowerCase());
        return articles.filter(a => {
          const text = ((a.title || '') + ' ' + (a.snippet || '')).toLowerCase();
          return kwLower.some(k => text.includes(k));
        }).map(a => { a.source = 'Hacker News'; return a; });
      }
      return articles.map(a => { a.source = 'Hacker News'; return a; });
    } catch (e) {
      log.error('web-fetcher', 'Erreur HackerNews:', e.message);
      return [];
    }
  }

  // --- Reddit RSS ---

  async fetchRedditRss(subreddits, keywords) {
    const subs = subreddits && subreddits.length > 0 ? subreddits : ['startups', 'SaaS', 'entrepreneur'];
    let allArticles = [];
    for (const sub of subs) {
      try {
        const articles = await this.fetchRss('https://www.reddit.com/r/' + sub + '/top/.rss?t=day');
        allArticles = allArticles.concat(articles.map(a => { a.source = 'Reddit r/' + sub; return a; }));
      } catch (e) {
        log.warn('web-fetcher', 'Reddit r/' + sub + ' erreur:', e.message);
      }
    }
    if (keywords && keywords.length > 0) {
      const kwLower = keywords.map(k => k.toLowerCase());
      allArticles = allArticles.filter(a => {
        const text = ((a.title || '') + ' ' + (a.snippet || '')).toLowerCase();
        return kwLower.some(k => text.includes(k));
      });
    }
    return allArticles;
  }

  // --- Product Hunt RSS ---

  async fetchProductHunt(keywords) {
    try {
      const articles = await this.fetchRss('https://www.producthunt.com/feed.rss');
      if (keywords && keywords.length > 0) {
        const kwLower = keywords.map(k => k.toLowerCase());
        return articles.filter(a => {
          const text = ((a.title || '') + ' ' + (a.snippet || '')).toLowerCase();
          return kwLower.some(k => text.includes(k));
        }).map(a => { a.source = 'Product Hunt'; return a; });
      }
      return articles.map(a => { a.source = 'Product Hunt'; return a; });
    } catch (e) {
      log.error('web-fetcher', 'Erreur Product Hunt:', e.message);
      return [];
    }
  }

  // --- GitHub Trending ---

  async fetchGitHubTrending(language) {
    const url = 'https://github.com/trending' + (language ? '/' + language : '') + '?since=daily';
    try {
      const result = await this.fetchUrl(url, { userAgent: this._nextUA() });
      if (result.statusCode !== 200) return [];
      const articles = [];
      const repoRegex = /<article class="Box-row">([\s\S]*?)<\/article>/gi;
      let m;
      while ((m = repoRegex.exec(result.body)) !== null && articles.length < 10) {
        const block = m[1];
        const nameMatch = block.match(/<a[^>]*href="\/([^"]+)"[^>]*>/);
        const descMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
        if (nameMatch) {
          articles.push({
            title: nameMatch[1].replace(/\//g, ' / '),
            link: 'https://github.com/' + nameMatch[1],
            source: 'GitHub Trending',
            snippet: descMatch ? this._cleanHtml(descMatch[1]).substring(0, 300) : '',
            pubDate: new Date().toISOString()
          });
        }
      }
      return articles;
    } catch (e) {
      log.error('web-fetcher', 'Erreur GitHub Trending:', e.message);
      return [];
    }
  }

  // --- Fallback chain: Google → DDG → Bing ---

  async fetchNewsWithFallback(keywords) {
    const cacheKey = 'news:' + keywords.join(',');
    const cached = this._getCached(cacheKey);
    if (cached) return cached;

    const sources = [
      { name: 'Google News', fn: () => this.fetchGoogleNews(keywords) },
      { name: 'DuckDuckGo', fn: () => this.fetchDuckDuckGoNews(keywords) },
      { name: 'Bing News', fn: () => this._fetchBingNews(keywords) }
    ];
    let articles = [];
    for (const source of sources) {
      if (!this.isSourceHealthy(source.name)) {
        log.info('web-fetcher', 'Skip ' + source.name + ' (unhealthy)');
        continue;
      }
      try {
        const result = await source.fn();
        this._trackSourceHealth(source.name, result.length > 0);
        if (result.length > 0) { articles = result; break; }
      } catch (e) {
        this._trackSourceHealth(source.name, false);
      }
    }
    if (articles.length > 0) this._setCache(cacheKey, articles);
    return articles;
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
          snippet: this._cleanHtml(description || '').substring(0, 600)
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
            snippet: this._cleanHtml(summary || '').substring(0, 600)
          });
        }
      }
    }

    return articles;
  }

  // --- Parsing HTML avec linkedom (DOM robuste) ---

  parseHtml(html) {
    if (!html) return { title: '', description: '', textContent: '' };

    try {
      const { document } = parseHTML(html);

      // Titre
      const titleEl = document.querySelector('title');
      const title = titleEl ? titleEl.textContent.trim() : '';

      // Meta description
      const metaDesc = document.querySelector('meta[name="description"]');
      const description = metaDesc ? (metaDesc.getAttribute('content') || '').trim() : '';

      // OG description si pas de meta
      let ogDesc = '';
      if (!description) {
        const ogMeta = document.querySelector('meta[property="og:description"]');
        ogDesc = ogMeta ? (ogMeta.getAttribute('content') || '').trim() : '';
      }

      // Supprimer script, style, nav, footer, header, aside
      const removeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'aside'];
      for (const sel of removeSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) el.remove();
      }

      // Extraire le texte du body
      const body = document.querySelector('body');
      const text = (body ? body.textContent : document.documentElement.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        title: title,
        description: description || ogDesc,
        textContent: text.substring(0, 3000)
      };
    } catch (e) {
      log.warn('web-fetcher', 'linkedom parseHtml fallback regex:', e.message);
      // Fallback regex si linkedom echoue
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? this._decodeHtmlEntities(titleMatch[1].trim()) : '';
      let text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { title: title, description: '', textContent: text.substring(0, 3000) };
    }
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
