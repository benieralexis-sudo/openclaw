// Autonomous Pilot - Recherche pre-envoi sur les prospects
// Collecte des informations reelles sur l'entreprise et la personne
// avant la generation d'email pour une personnalisation profonde.
// Cout : 0$ (Google News RSS gratuit + linkedom scraping gratuit + Apollo data deja payee)

const log = require('../../gateway/logger.js');

// Cross-skill imports via skill-loader centralise
const { getStorage, getModule } = require('../../gateway/skill-loader.js');

function getWebFetcher() { return getModule('web-fetcher'); }
function getWebIntelStorage() { return getStorage('web-intelligence'); }
function getAPStorage() { return getStorage('autonomous-pilot'); }
function getLeadEnrichStorage() { return getStorage('lead-enrich'); }
function getFlowFastStorage() { return getStorage('flowfast'); }

// Intent scorer pour calcul de score unifie
function getIntentScorer() {
  try { return require('../lead-enrich/intent-scorer.js'); }
  catch (e) {
    try { return require('/app/skills/lead-enrich/intent-scorer.js'); }
    catch (e2) { return null; }
  }
}

// User-agents rotatifs pour eviter les 403 Google Cache
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

class ProspectResearcher {
  constructor(options) {
    this.claudeKey = options.claudeKey;
    this.openaiKey = options.openaiKey || process.env.OPENAI_API_KEY || null;
    this.braveKey = options.braveKey || process.env.BRAVE_SEARCH_API_KEY || null;
    this._fetcher = null;
    this._uaIndex = Math.floor(Math.random() * USER_AGENTS.length);
  }

  // --- Enrichment quality assessment (v9.3) ---

  /**
   * Evalue la qualite des donnees d'enrichissement Clay pour un prospect.
   * Utilise pour bloquer l'envoi d'emails sous-personnalises.
   * @param {Object|null} clayData — donnees Clay chargees
   * @returns {{ score: number, missing: string[], ready: boolean, fields: Object }}
   */
  _assessEnrichmentQuality(clayData) {
    if (!clayData) return { score: 0, missing: ['all'], ready: false, fields: {} };
    const enr = clayData.enrichment || {};
    const fields = {
      linkedinBio: !!(clayData.linkedinBio || enr.linkedinBio),
      companyDescription: !!(clayData.companyDescription || enr.shortDescription || enr.description),
      googleNews: !!(clayData.googleNews && clayData.googleNews.news_results && clayData.googleNews.news_results.length > 0),
      employeeCount: !!(clayData.employeeCount || enr.employeeCount),
      linkedinPosts: !!(clayData.linkedinPosts && ((Array.isArray(clayData.linkedinPosts) && clayData.linkedinPosts.length > 0) || (clayData.linkedinPosts.posts && clayData.linkedinPosts.posts.length > 0))),
      positionStartDate: !!(clayData.positionStartDate)
    };
    const weights = { linkedinBio: 25, companyDescription: 20, googleNews: 20, linkedinPosts: 15, employeeCount: 10, positionStartDate: 10 };
    let score = 0;
    const missing = [];
    for (const [k, present] of Object.entries(fields)) {
      if (present) score += weights[k];
      else missing.push(k);
    }
    // Minimum pour email 10/10 : linkedinBio + (companyDescription OU googleNews)
    const ready = fields.linkedinBio && (fields.companyDescription || fields.googleNews);
    return { score, missing, ready, fields };
  }

  // --- Clay enrichment loader (v9.0) ---

  /**
   * Charge les donnees d'enrichissement Clay depuis le fichier JSON genere par le webhook.
   * @param {string} email — email du prospect
   * @returns {Object|null} — donnees Clay parsees ou null
   */
  _loadClayEnrichment(email) {
    if (!email) return null;
    const filePath = (process.env.AUTOMAILER_DATA_DIR || '/data/automailer') + '/clay-enrichments/' + email.toLowerCase().replace(/[^a-z0-9@._-]/g, '_') + '.json';
    try {
      const fs = require('fs');
      if (!fs.existsSync(filePath)) {
        log.info('prospect-research', 'Clay enrichment non trouve pour ' + email);
        return null;
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      log.info('prospect-research', 'Clay enrichment charge pour ' + email + ' (source: ' + (data.source || 'clay') + ')');
      return data;
    } catch (e) {
      log.info('prospect-research', 'Clay enrichment erreur lecture pour ' + email + ': ' + e.message);
      return null;
    }
  }

  // --- Filtres anti-bruit pour sources de donnees ---

  /**
   * Verifie si un texte contient des blocs significatifs de caracteres non-latins
   * (CJK, arabe, devanagari, etc.). Retourne true si le texte est "pollue".
   */
  _hasSignificantNonLatinChars(text) {
    if (!text) return false;
    // CJK Unified Ideographs, Arabic, Devanagari, Thai, Japanese Hiragana/Katakana
    const nonLatinMatch = text.match(/[\u4e00-\u9fff\u3040-\u30ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\uac00-\ud7af]/g);
    if (!nonLatinMatch) return false;
    // "Significatif" = 5+ caracteres non-latins OU > 15% du texte
    return nonLatinMatch.length >= 5 || (nonLatinMatch.length / text.length) > 0.15;
  }

  /**
   * Filtre les news Google News RSS : ne garde que celles VRAIMENT pertinentes.
   * 3 niveaux de filtrage :
   * 1. Le titre/snippet DOIT mentionner l'entreprise (au moins un mot significatif)
   * 2. Anti-homonyme : exclure les faux positifs (ex: "Let it be" Beatles, "Impact" generic)
   * 3. Fraicheur : priorite aux news < 90 jours
   */
  _filterRelevantNews(newsItems, companyName) {
    if (!newsItems || newsItems.length === 0 || !companyName) return newsItems;

    // Extraire les mots significatifs du nom d'entreprise (> 3 chars, pas les stop words)
    const stopWords = new Set(['sarl', 'sas', 'eurl', 'the', 'and', 'les', 'des', 'group', 'groupe',
      'france', 'paris', 'consulting', 'conseil', 'international', 'digital', 'agency', 'agence',
      'studio', 'solutions', 'services', 'tech', 'company', 'corp', 'ltd', 'gmbh']);
    const companyWords = companyName.toLowerCase()
      .split(/[\s\-_&.,;:'"()]+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    // Si le nom complet est court (ex: "IFFP"), aussi matcher en entier
    const companyLower = companyName.toLowerCase().trim();

    // Mots communs qui generent des homonymes (noms d'entreprises qui sont aussi des mots courants)
    const ambiguousNames = new Set(['impact', 'vision', 'alpha', 'beta', 'delta', 'omega', 'zen',
      'boost', 'pulse', 'spark', 'flow', 'smart', 'pixel', 'open', 'next', 'first', 'prime',
      'core', 'edge', 'link', 'base', 'rise', 'peak', 'wave', 'shift', 'cloud', 'data']);
    const isAmbiguous = ambiguousNames.has(companyLower) ||
      (companyWords.length === 1 && ambiguousNames.has(companyWords[0]));

    // Domaines/contextes qui sont des faux positifs frequents
    const noiseContexts = [
      /\b(?:cinema|film|serie|album|chanson|concert|festival|exposition|musee|sport|match|ligue|championnat)\b/i,
      /\b(?:meteo|horoscope|recette|cuisine|mode|beaute|voyage|tourisme|vacances)\b/i
    ];

    return newsItems.filter(item => {
      const title = (item.title || '').toLowerCase();
      const snippet = (item.snippet || '').toLowerCase();
      const titleAndSnippet = title + ' ' + snippet;

      // --- FILTRE 1 : mention entreprise ---
      let nameMatch = false;
      // Match exact du nom complet
      if (titleAndSnippet.includes(companyLower)) nameMatch = true;
      // Match d'au moins un mot significatif du nom
      if (!nameMatch && companyWords.length > 0 && companyWords.some(w => titleAndSnippet.includes(w))) nameMatch = true;
      if (!nameMatch) return false;

      // --- FILTRE 2 : anti-homonyme pour noms ambigus ---
      if (isAmbiguous) {
        // Pour les noms ambigus, exiger un contexte business (pas culturel/sport/etc)
        const hasBusinessContext = /\b(?:entreprise|startup|saas|lev[ée]e|recrutement|croissance|chiffre|employ|client|partenaire|fondateur|directeur|ceo|cto|nomm[ée]|rejoint|bureau|siege)\b/i.test(titleAndSnippet);
        if (!hasBusinessContext) {
          // Verifier aussi si c'est un contexte bruit
          if (noiseContexts.some(rx => rx.test(titleAndSnippet))) return false;
        }
      }

      // --- FILTRE 3 : fraicheur (< 90 jours prioritaire, > 180 jours exclus) ---
      if (item.pubDate) {
        const pubDate = new Date(item.pubDate);
        if (!isNaN(pubDate.getTime())) {
          const ageMs = Date.now() - pubDate.getTime();
          const ageDays = ageMs / (24 * 60 * 60 * 1000);
          if (ageDays > 180) return false; // news > 6 mois = pas pertinente
        }
      }

      return true;
    });
  }

  /**
   * Filtre les resultats de recherche personne : exclut domaines garbage et scripts non-latins.
   */
  _filterPersonProfileResults(items) {
    if (!items || items.length === 0) return items;

    const GARBAGE_DOMAINS = [
      'zhihu.com', 'baidu.com', 'bilibili.com', 'weibo.com', 'qq.com', 'csdn.net',
      'levi.com', 'levis.com', 'heidisql.com',
      'spotify.com', 'deezer.com', 'apple.com/music', 'soundcloud.com',
      'amazon.com', 'ebay.com', 'aliexpress.com', 'alibaba.com',
      'pinterest.com', 'tiktok.com',
      'imdb.com', 'rottentomatoes.com',
      'genius.com', 'lyrics.com',
      'booking.com', 'tripadvisor.com'
    ];

    return items.filter(item => {
      const url = (item.url || '').toLowerCase();
      const text = (item.title || '') + ' ' + (item.snippet || '');

      // Exclure les domaines garbage
      if (GARBAGE_DOMAINS.some(d => url.includes(d))) return false;

      // Exclure les resultats avec caracteres non-latins significatifs
      if (this._hasSignificantNonLatinChars(text)) return false;

      return true;
    });
  }

  /**
   * Filtre les resultats de recherche clients : exclut les snippets en scripts non-latins.
   */
  _filterClientSearchResults(results) {
    if (!results || results.length === 0) return results;

    return results.filter(item => {
      const text = (item.title || '') + ' ' + (item.snippet || '');
      return !this._hasSignificantNonLatinChars(text);
    });
  }

  // Pre-analyse IA du site web : texte brut → insights structures (GPT-4o-mini, ~0.001$/call)
  async _summarizeWebsite(rawText, companyName) {
    if (!rawText || rawText.length < 100 || !this.openaiKey) return null;
    const { callOpenAI } = require('../../gateway/shared-nlp.js');
    const prompt = `Analyse ce site web de "${companyName || 'entreprise'}". Extrais en bullets courts et CONCRETS :\n- Proposition de valeur principale (1 phrase)\n- Clients cibles (B2B/B2C, secteur, taille)\n- Produit/service phare\n- Element differenciateur vs concurrents\n- CLIENTS NOTABLES ou marques citees sur le site (liste)\n- CHIFFRES CLES : CA, nombre employes, annees d'existence, nombre de clients, projets realises\n- Signaux de croissance (recrutement actif, nouveaux produits, expansion geo)\n- PROBLEME PROBABLE que cette entreprise cherche a resoudre\n\nSite web:\n${rawText.substring(0, 4000)}`;
    try {
      const result = await callOpenAI(this.openaiKey, [{ role: 'user', content: prompt }], { maxTokens: 600, temperature: 0.2 });
      return result.content || null;
    } catch (e) {
      log.warn('prospect-research', '_summarizeWebsite error: ' + e.message);
      return null;
    }
  }

  _nextUA() {
    this._uaIndex = (this._uaIndex + 1) % USER_AGENTS.length;
    return USER_AGENTS[this._uaIndex];
  }

  _getFetcher() {
    if (!this._fetcher) {
      const WebFetcher = getWebFetcher();
      if (WebFetcher) this._fetcher = new WebFetcher();
    }
    return this._fetcher;
  }

  /**
   * Recherche Brave Search API (JSON) → convertit en pseudo-HTML pour compatibilite.
   * Gratuit : 2000 req/mois. Pas de rate-limit agressif comme DDG.
   */
  async _searchBrave(query) {
    if (!this.braveKey) return null;
    const https = require('https');
    return new Promise((resolve) => {
      const url = '/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=8&search_lang=fr';
      const req = https.request({
        hostname: 'api.search.brave.com',
        path: url,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': this.braveKey
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.web && json.web.results && json.web.results.length > 0) {
              // Convertir en pseudo-HTML pour compatibilite avec les parsers existants
              let html = '<html><body>';
              for (const r of json.web.results) {
                html += '<div class="result"><a href="' + (r.url || '') + '">' + (r.title || '') + '</a>';
                html += '<span class="snippet">' + (r.description || '') + '</span></div>';
              }
              html += '</body></html>';
              resolve({ html, source: 'brave' });
            } else {
              resolve(null);
            }
          } catch (e) {
            log.info('prospect-research', 'Brave parse error: ' + e.message);
            resolve(null);
          }
        });
      });
      req.on('error', (e) => { log.info('prospect-research', 'Brave search error: ' + e.message); resolve(null); });
      req.setTimeout(10000, () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  /**
   * Helper universel : Brave → DDG → Bing → DDG Lite fallback.
   * Retourne le HTML brut de la page de resultats, ou null.
   */
  async _searchWithFallback(query) {
    const fetcher = this._getFetcher();
    if (!fetcher) return null;

    // Tentative 0 : Brave Search API (gratuit, 2000 req/mois, pas de rate-limit agressif)
    if (this.braveKey) {
      try {
        const braveResult = await this._searchBrave(query);
        if (braveResult) return braveResult;
      } catch (e) {
        log.info('prospect-research', 'Brave search echoue: ' + e.message);
      }
    }

    // Tentative 1 : DDG HTML avec retry ameliore (backoff exponentiel sur 202)
    try {
      const ddgUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await fetcher.fetchUrl(ddgUrl, { userAgent: this._nextUA() });
        if (result && result.statusCode === 200 && result.body && result.body.length > 500) {
          return { html: result.body, source: 'ddg' };
        }
        // DDG 202 = rate-limited, retry avec backoff exponentiel
        if (result && result.statusCode === 202 && attempt < 2) {
          const delay = (attempt + 1) * 2000; // 2s, 4s
          log.info('prospect-research', 'DDG 202 rate-limit — retry ' + (attempt + 1) + '/2 dans ' + (delay / 1000) + 's');
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        break;
      }
    } catch (e) {
      log.info('prospect-research', 'DDG search echoue: ' + e.message);
    }

    // Tentative 2 : Bing
    try {
      const bingUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&count=8';
      const result = await fetcher.fetchUrl(bingUrl, { userAgent: this._nextUA() });
      if (result && result.statusCode === 200 && result.body && result.body.length > 500) {
        return { html: result.body, source: 'bing' };
      }
    } catch (e) {
      log.info('prospect-research', 'Bing search echoue: ' + e.message);
    }

    // Tentative 3 : DDG Lite (version legere, moins rate-limitee)
    try {
      const liteUrl = 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query);
      const result = await fetcher.fetchUrl(liteUrl, { userAgent: this._nextUA() });
      if (result && result.statusCode === 200 && result.body && result.body.length > 200) {
        return { html: result.body, source: 'ddg_lite' };
      }
    } catch (e) {
      log.info('prospect-research', 'DDG Lite search echoue: ' + e.message);
    }

    return null;
  }

  /**
   * Parse les snippets depuis du HTML de resultats (DDG ou Bing).
   * Retourne un array de { title, snippet, url }.
   */
  _parseSearchResults(html, source, maxResults) {
    const results = [];
    if (!html) return results;
    const max = maxResults || 8;

    if (source === 'ddg') {
      // Parse DDG HTML
      const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = linkRegex.exec(html)) !== null && results.length < max) {
        let url = m[1];
        if (url.includes('uddg=')) {
          const uddg = url.split('uddg=')[1];
          if (uddg) url = decodeURIComponent(uddg.split('&')[0]);
        }
        const title = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
        if (title.length > 5) results.push({ title: title.substring(0, 150), snippet: '', url });
      }
      let si = 0;
      while ((m = snippetRegex.exec(html)) !== null) {
        const snippet = m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
        if (snippet.length > 20 && si < results.length) {
          results[si].snippet = snippet.substring(0, 250);
        }
        si++;
      }
    } else {
      // Parse Bing HTML
      const bingRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
      let m;
      while ((m = bingRegex.exec(html)) !== null && results.length < max) {
        const block = m[1];
        const linkMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || block.match(/<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/i);
        if (linkMatch) {
          const url = linkMatch[1];
          const title = linkMatch[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
          const snippet = snippetMatch ? (snippetMatch[1] || snippetMatch[2] || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim() : '';
          if (title.length > 5) results.push({ title: title.substring(0, 150), snippet: snippet.substring(0, 250), url });
        }
      }
    }

    return results;
  }

  /**
   * Recherche complete sur un prospect avant envoi d'email.
   * Execute en parallele : scrape site web, Google News, extraction Apollo, articles Web Intel.
   * Retourne un objet ProspectIntel avec un brief textuel pret a injecter dans le prompt email.
   */
  async researchProspect(contact) {
    if (!contact || !contact.entreprise) {
      return { brief: null, error: 'Pas d\'entreprise fournie' };
    }

    const email = contact.email || '';
    const company = contact.entreprise || '';

    // Verifier le cache (evite re-recherche du meme prospect)
    const apStorage = getAPStorage();
    if (apStorage && email) {
      const cached = apStorage.getProspectResearch ? apStorage.getProspectResearch(email) : null;
      if (cached && cached.cachedAt) {
        const cacheAge = Date.now() - new Date(cached.cachedAt).getTime();
        // Si le lead est dans la data-poor queue, forcer la re-recherche (cache expire)
        let isDataPoor = false;
        try {
          const dpReady = apStorage.getDataPoorLeadsReady ? apStorage.getDataPoorLeadsReady() : [];
          isDataPoor = dpReady.some(dp => dp.email && dp.email.toLowerCase() === email.toLowerCase());
        } catch (e) { log.warn('prospect-research', 'data-poor check echoue: ' + e.message); }
        if (!isDataPoor && cacheAge < 7 * 24 * 60 * 60 * 1000) { // 7 jours TTL
          log.info('prospect-research', 'Cache hit pour ' + email);
          return cached;
        }
        if (isDataPoor) {
          log.info('prospect-research', 'Cache ignore pour ' + email + ' (data-poor lead, re-recherche forcee)');
        }
      }
    }

    // Verifier si Lead Enrich a deja des donnees sur ce prospect (evite double enrichissement)
    let leadEnrichData = null;
    try {
      const leStorage = getLeadEnrichStorage();
      if (leStorage && email) {
        const enriched = leStorage.getEnrichedLead ? leStorage.getEnrichedLead(email) : null;
        if (enriched) {
          leadEnrichData = {
            industry: enriched.aiClassification?.industry || null,
            persona: enriched.aiClassification?.persona || null,
            score: enriched.aiClassification?.score || null,
            technologies: enriched.apolloData?.organization?.technologies || [],
            description: enriched.apolloData?.organization?.short_description || ''
          };
          log.info('prospect-research', 'Donnees Lead Enrich trouvees pour ' + email);
        }
      }
    } catch (e) { log.warn('prospect-research', 'Lead Enrich lookup echoue: ' + e.message); }

    log.info('prospect-research', 'Recherche pour ' + company + ' (' + (contact.nom || email) + ')');

    // Extraire le domaine depuis l'email
    const domain = email ? email.split('@')[1] : null;

    // === Clay enrichment (v9.0) — charger AVANT les sources web ===
    const clayData = this._loadClayEnrichment(email);

    // Executer les 6 sources web en parallele (v9.0 — Apollo, Dropcontact, LinkedIn DDG retires)
    const linkedinUrl = contact.linkedin_url || contact.linkedin || contact.linkedinUrl || '';
    const contactName = contact.nom || contact.name || '';
    const [websiteResult, newsResult, webIntelArticles, clientSearchResult, personProfileResult, jobPostingsResult] = await Promise.allSettled([
      this._scrapeCompanyWebsite(domain),
      this._fetchCompanyNews(company),
      Promise.resolve(this._checkExistingWebIntelArticles(company)),
      this._searchCompanyClients(company),
      this._searchPersonProfile(contactName, company),
      this._searchJobPostings(company)
    ]);

    // Chercher market signals Web Intelligence pour cette entreprise
    let marketSignals = [];
    try {
      const wiStorage = getWebIntelStorage();
      if (wiStorage && wiStorage.getRecentMarketSignals) {
        const allSignals = wiStorage.getRecentMarketSignals(20);
        const companyLower = company.toLowerCase();
        marketSignals = allSignals.filter(s => {
          const title = (s.article && s.article.title || '').toLowerCase();
          const signalCo = (s.article && s.article.company || '').toLowerCase();
          return title.includes(companyLower) || signalCo.includes(companyLower);
        }).slice(0, 3);
      }
    } catch (e) { log.warn('prospect-research', 'Market signals echoue: ' + e.message); }

    const rawArticles = webIntelArticles.status === 'fulfilled' ? webIntelArticles.value : [];

    // Fetch contenu complet des 1-2 articles WI les plus pertinents (score >= 7)
    const topArticles = rawArticles.filter(a => a.relevance >= 7 && a.url).slice(0, 2);
    if (topArticles.length > 0) {
      const fetcher = this._getFetcher();
      if (fetcher) {
        const articleFetches = await Promise.allSettled(
          topArticles.map(a => this._fetchInternalPage(fetcher, a.url, 'article'))
        );
        for (let i = 0; i < topArticles.length; i++) {
          if (articleFetches[i].status === 'fulfilled' && articleFetches[i].value) {
            // Retrouver l'article dans rawArticles et ajouter le contenu
            const idx = rawArticles.indexOf(topArticles[i]);
            if (idx !== -1) rawArticles[idx].fullText = articleFetches[i].value.text;
          }
        }
      }
    }

    // === Clay org data (v9.0) — compatible avec format apolloData pour retrocompat ===
    let clayOrgData = null;
    let clayLinkedinData = null;
    if (clayData) {
      const enr = clayData.enrichment || {};
      clayOrgData = {
        name: clayData.company || null,
        websiteUrl: clayData.website || null,
        industry: clayData.industry || (enr.industry || null),
        employeeCount: clayData.employeeCount || (enr.employeeCount || null),
        foundedYear: enr.foundedYear || null,
        shortDescription: (clayData.companyDescription || enr.shortDescription || enr.description || '').substring(0, 300),
        keywords: enr.keywords || [],
        technologies: enr.technologies || [],
        city: clayData.location || (enr.city || null),
        country: enr.country || null,
        linkedinUrl: enr.linkedinUrl || (clayData.linkedin || null),
        revenue: enr.revenue || enr.annualRevenue || null,
        lastFundingDate: enr.lastFundingDate || (enr.funding && enr.funding.lastDate) || null,
        lastFundingType: enr.lastFundingType || (enr.funding && enr.funding.type) || null,
        lastFundingAmount: enr.lastFundingAmount || (enr.funding && enr.funding.amount) || null
      };
      log.info('prospect-research', 'Clay org data construite pour ' + (clayData.company || email));

      // LinkedIn data depuis Clay
      // FIX v9.3: linkedinBio est stocke au top-level par le webhook, pas dans enrichment
      const rawBio = clayData.linkedinBio || enr.linkedinBio || null;
      const rawHeadline = enr.linkedinHeadline || clayData.title || null;
      if (clayData.linkedin || rawBio || rawHeadline) {
        // Unwrap JSON format de Clay Summarize: {response: "..."} → string
        let bioText = '';
        if (rawBio) {
          if (typeof rawBio === 'object' && rawBio.response) {
            bioText = String(rawBio.response);
          } else if (typeof rawBio === 'object') {
            try { bioText = JSON.stringify(rawBio); } catch (e) { bioText = ''; }
          } else {
            bioText = String(rawBio);
          }
        }
        clayLinkedinData = {
          headline: rawHeadline,
          summary: bioText.substring(0, 400),
          linkedinUrl: clayData.linkedin || enr.linkedinUrl || '',
          source: 'clay'
        };
        if (bioText) log.info('prospect-research', 'Clay LinkedIn bio chargee (' + bioText.length + ' chars) pour ' + (contactName || email));
        else log.info('prospect-research', 'Clay LinkedIn data construite (sans bio) pour ' + (contactName || email));
      }
    }

    // Chercher les concurrents dans le meme secteur (inter-prospect memory)
    let sectorCompetitors = [];
    try {
      const apStorage2 = getAPStorage();
      if (apStorage2 && apStorage2.getCompetitorsInIndustry) {
        let industry = '';
        if (leadEnrichData && leadEnrichData.industry) industry = leadEnrichData.industry;
        if (!industry && clayOrgData && clayOrgData.industry) industry = clayOrgData.industry;
        if (industry) {
          sectorCompetitors = apStorage2.getCompetitorsInIndustry(industry, 5)
            .filter(c => c.name.toLowerCase() !== company.toLowerCase());
        }
      }
    } catch (e) { log.warn('prospect-research', 'Competitors lookup echoue: ' + e.message); }

    const personProfile = personProfileResult.status === 'fulfilled' ? personProfileResult.value : null;

    // Extraire les mentions de la personne depuis le site web scrape (gratuit, toujours disponible)
    let personFromWebsite = null;
    if (contactName && contactName.length >= 3) {
      const ws = websiteResult.status === 'fulfilled' ? websiteResult.value : null;
      if (ws && ws.textContent) {
        personFromWebsite = this._extractPersonMentions(contactName, ws.textContent);
      }
    }

    const intel = {
      company: company,
      websiteInsights: websiteResult.status === 'fulfilled' ? websiteResult.value : null,
      techStack: (websiteResult.status === 'fulfilled' && websiteResult.value) ? websiteResult.value.techStack || null : null,
      recentNews: newsResult.status === 'fulfilled' ? newsResult.value : [],
      apolloData: clayOrgData, // v9.0: Clay remplace Apollo (retrocompat)
      existingArticles: rawArticles,
      linkedinData: clayLinkedinData, // v9.0: Clay remplace LinkedIn DDG
      clientSearch: clientSearchResult.status === 'fulfilled' ? clientSearchResult.value : null,
      personProfile: personProfile,
      personFromWebsite: personFromWebsite,
      jobPostings: jobPostingsResult.status === 'fulfilled' ? jobPostingsResult.value : null,
      intentSignals: personProfile ? (personProfile.intentSignals || []) : [],
      sectorCompetitors: sectorCompetitors,
      clayData: clayData, // v9.0: donnees Clay brutes
      leadEnrichData: leadEnrichData,
      marketSignals: marketSignals,
      researchedAt: new Date().toISOString()
    };

    // === Clay intent signals (v9.0) ===
    if (clayData) {
      const enr = clayData.enrichment || {};

      // BuiltWith / tech stack
      const builtWith = clayData.builtWith || enr.builtWith || enr.technologies || null;
      if (builtWith && Array.isArray(builtWith) && builtWith.length > 0) {
        if (!intel.intentSignals.some(s => s.type === 'tech_stack_clay')) {
          intel.intentSignals.push({ type: 'tech_stack_clay', detail: 'Tech stack Clay: ' + builtWith.slice(0, 5).join(', '), detectedAt: clayData.importedAt });
        }
      }

      // Headcount growth
      const hcGrowth = clayData.headcountGrowth || enr.headcountGrowth || enr.headcount_growth || null;
      if (hcGrowth && !intel.intentSignals.some(s => s.type === 'headcount_growth')) {
        const growthDetail = typeof hcGrowth === 'number' ? (hcGrowth > 0 ? '+' : '') + hcGrowth + '% croissance effectif' : String(hcGrowth);
        intel.intentSignals.push({ type: 'headcount_growth', detail: growthDetail, detectedAt: clayData.importedAt });
      }

      // Funding
      const funding = clayData.funding || enr.funding || null;
      if (funding && !intel.intentSignals.some(s => s.type === 'recent_funding')) {
        const fundingDetail = typeof funding === 'object' ? ('Levee ' + (funding.type || '') + ' ' + (funding.amount || '')).trim() : String(funding);
        intel.intentSignals.push({ type: 'recent_funding', detail: 'Funding Clay: ' + fundingDetail, detectedAt: clayData.importedAt });
      }

      // LinkedIn posts — Clay format: {numberOfPosts: N, posts: [{date, post, ...}]} or Array
      const postsRaw = clayData.linkedinPosts || enr.linkedinPosts || null;
      const postsArr = postsRaw && Array.isArray(postsRaw) ? postsRaw : (postsRaw && postsRaw.posts && Array.isArray(postsRaw.posts) ? postsRaw.posts : null);
      if (postsArr && postsArr.length > 0 && !intel.intentSignals.some(s => s.type === 'content_creator')) {
        intel.intentSignals.push({ type: 'content_creator', detail: postsArr.length + ' posts LinkedIn recents', detectedAt: clayData.importedAt });
      }

      log.info('prospect-research', 'Clay intent signals injectes pour ' + (company || email) + ': ' + intel.intentSignals.filter(s => s.detail && s.detail.includes('Clay')).length + ' signaux');
    }

    // Auto-intent signals enrichis
    if (intel.jobPostings && intel.jobPostings.totalJobs >= 3) {
      // Recrutement massif — categoriser par signification business
      let hiringDetail = intel.jobPostings.totalJobs + ' postes ouverts';
      const cats = intel.jobPostings.categories;
      if (cats.sales > 0 && cats.sales >= cats.tech) {
        hiringDetail += ' (dont ' + cats.sales + ' commerciaux — signal de croissance revenue)';
        intel.intentSignals.push({ type: 'scaling_sales', detail: hiringDetail });
      } else if (cats.tech > 0 && cats.tech >= cats.sales) {
        hiringDetail += ' (dont ' + cats.tech + ' tech — signal de build produit)';
        intel.intentSignals.push({ type: 'building_product', detail: hiringDetail });
      } else {
        intel.intentSignals.push({ type: 'active_hiring', detail: hiringDetail });
      }
    }

    // Signaux dans les news recentes
    if (intel.recentNews && intel.recentNews.length > 0) {
      const newsSignalPatterns = [
        { pattern: /lev[ée]e?\s+de\s+fonds?|funding|s[ée]rie\s+[A-D]|lève\s+\d/i, type: 'recent_funding', label: 'Levee de fonds' },
        { pattern: /lance|lancement|nouveau\s+produit|nouvelle\s+offre|v2|version\s+\d/i, type: 'new_product', label: 'Nouveau produit/offre' },
        { pattern: /s['']?implante|ouvre\s+un\s+bureau|expansion|s['']?installe\s+[àa]/i, type: 'geo_expansion', label: 'Expansion geographique' },
        { pattern: /acquisition|rach[èe]te|rachat|absorbe/i, type: 'acquisition', label: 'Acquisition' },
        { pattern: /partenariat|s['']?associe|collaboration\s+avec/i, type: 'partnership', label: 'Nouveau partenariat' },
        { pattern: /nomm[ée]|rejoint|nouveau\s+directeur|nouvelle?\s+DG|prend\s+la\s+t[êe]te/i, type: 'leadership_change', label: 'Changement de direction' }
      ];
      for (const news of intel.recentNews.slice(0, 5)) {
        const newsText = (news.title || '') + ' ' + (news.snippet || '');
        for (const sp of newsSignalPatterns) {
          if (sp.pattern.test(newsText) && !intel.intentSignals.some(s => s.type === sp.type)) {
            intel.intentSignals.push({ type: sp.type, detail: sp.label + ': ' + (news.title || '').substring(0, 80) });
            break; // un signal par news max
          }
        }
      }
    }

    // === GATE 2 : Coherence Niche / Site Web ===
    if (contact.niche && intel.websiteInsights && intel.websiteInsights.textContent) {
      const nicheCheck = this._validateNicheCoherence(intel.websiteInsights.textContent, contact.niche);
      intel.nicheCoherent = nicheCheck.coherent;
      if (!nicheCheck.coherent) {
        intel.nicheWarning = nicheCheck.reason;
        log.warn('prospect-research', 'GATE 2 — Niche mismatch pour ' + (contact.entreprise || contact.email) +
          ' [niche: ' + contact.niche + '] — ' + nicheCheck.reason);
      } else {
        log.info('prospect-research', 'GATE 2 OK — Niche coherente pour ' + (contact.entreprise || contact.email) +
          ' [niche: ' + contact.niche + ']');
      }
    }

    // Construire le brief textuel (avec pre-analyse IA du site web si disponible)
    intel.brief = await this._buildProspectBrief(intel, contact);

    // === INTENT SCORE : calcul unifie de tous les signaux ===
    const intentScorer = getIntentScorer();
    if (intentScorer) {
      try {
        intel.intentScore = intentScorer.calculateIntentScore(intel);
        if (intel.intentScore.score > 0) {
          log.info('prospect-research', 'Intent score pour ' + (contact.entreprise || email) + ': ' +
            intel.intentScore.score + '/10 (' + intel.intentScore.summary + ')');
        }
        // Persister dans Lead Enrich storage
        if (email) {
          try {
            const leStorage = getLeadEnrichStorage();
            if (leStorage && leStorage.updateIntentData) {
              leStorage.updateIntentData(email, intel.intentScore);
            }
          } catch (e) { log.warn('prospect-research', 'Intent persist echoue: ' + e.message); }
        }
        // Aussi mettre a jour le score FlowFast si intent significatif
        if (intel.intentScore.score >= 4 && email) {
          try {
            const ffStorage = getFlowFastStorage();
            if (ffStorage && ffStorage.data && ffStorage.data.leads) {
              const leadKey = Object.keys(ffStorage.data.leads).find(k => k.toLowerCase() === email.toLowerCase());
              if (leadKey) {
                const lead = ffStorage.data.leads[leadKey];
                const intentBoost = Math.min(2, Math.round(intel.intentScore.score / 4));
                const oldScore = lead.score || 0;
                const newScore = Math.min(10, oldScore + intentBoost);
                if (newScore > oldScore) {
                  lead.score = newScore;
                  if (!lead.scoreHistory) lead.scoreHistory = [];
                  lead.scoreHistory.push({ from: oldScore, to: newScore, reason: 'intent:' + intel.intentScore.summary, at: new Date().toISOString() });
                  ffStorage._save ? ffStorage._save() : null;
                  log.info('prospect-research', 'FlowFast score boost ' + email + ': ' + oldScore + ' → ' + newScore + ' (intent: ' + intel.intentScore.summary + ')');
                }
              }
            }
          } catch (e) { log.warn('prospect-research', 'FlowFast intent boost echoue: ' + e.message); }
        }
      } catch (e) {
        log.warn('prospect-research', 'Intent scoring echoue: ' + e.message);
        intel.intentScore = { score: 0, signals: [], topSignal: null, summary: 'erreur' };
      }
    }

    // Sauvegarder dans le cache
    if (apStorage && email && apStorage.saveProspectResearch) {
      try { apStorage.saveProspectResearch(email, intel); } catch (e) { log.warn('prospect-research', 'Cache save echoue: ' + e.message); }
    }

    const sources = [
      intel.websiteInsights ? 'site web' : null,
      intel.recentNews.length > 0 ? intel.recentNews.length + ' news' : null,
      intel.apolloData ? 'Apollo' : null,
      intel.existingArticles.length > 0 ? intel.existingArticles.length + ' articles WI' : null,
      intel.linkedinData ? 'LinkedIn' : null,
      intel.clientSearch ? 'DDG clients' : null,
      intel.personProfile ? intel.personProfile.items.length + ' profil' : null,
      intel.personFromWebsite ? intel.personFromWebsite.mentions.length + ' mentions site' : null,
      intel.jobPostings ? intel.jobPostings.totalJobs + ' offres emploi' : null,
      intel.techStack ? 'tech stack' : null,
      intel.sireneData ? 'SIRENE' : null,
      intel.sectorCompetitors.length > 0 ? intel.sectorCompetitors.length + ' concurrents' : null
    ].filter(Boolean);

    log.info('prospect-research', 'Recherche terminee pour ' + company + ': ' + sources.join(', '));

    return intel;
  }

  /**
   * Scrape le site web de l'entreprise via linkedom (gratuit)
   */
  async _scrapeCompanyWebsite(domain) {
    if (!domain) return null;
    // Ignorer les domaines generiques (gmail, yahoo, hotmail, etc.)
    const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'protonmail.com', 'free.fr', 'orange.fr', 'wanadoo.fr', 'sfr.fr', 'laposte.net'];
    if (genericDomains.includes(domain.toLowerCase())) return null;

    const fetcher = this._getFetcher();
    if (!fetcher) return null;

    try {
      // 1. Homepage
      let result = await fetcher.scrapeWebPage('https://' + domain);

      // 1b. SPA fallback : si linkedom retourne du contenu trop court (SPA React/Vue/Angular),
      // essayer Google Cache qui a souvent la version rendue
      if (result && (!result.textContent || result.textContent.length < 80)) {
        try {
          const cacheUrl = 'https://webcache.googleusercontent.com/search?q=cache:https://' + domain;
          const cacheResult = await fetcher.scrapeWebPage(cacheUrl);
          if (cacheResult && cacheResult.textContent && cacheResult.textContent.length > (result.textContent || '').length) {
            log.info('prospect-research', 'SPA fallback Google Cache pour ' + domain + ' (' + cacheResult.textContent.length + ' chars vs ' + (result.textContent || '').length + ')');
            result = cacheResult;
          }
        } catch (e) { log.warn('prospect-research', 'Google Cache fallback echoue: ' + e.message); }
      }

      if (!result) return null;

      const insights = {
        title: (result.title || '').substring(0, 200),
        description: (result.description || '').substring(0, 300),
        textContent: ''
      };

      // 2. Extraire les liens internes depuis la homepage (trouve les vraies pages au lieu de deviner)
      let discoveredPaths = [];
      if (result.rawHtml) {
        const linkRegex = /href=["'](\/[a-z0-9\-\/]+)["']/gi;
        const seen = new Set();
        let lm;
        const relevantKeywords = /about|a-propos|qui-sommes|equipe|team|services|nos-services|expertises|clients|nos-clients|references|realisations|portfolio|cas-clients|temoignages|projets|offres|solutions|partenaires|histoire|mission/i;
        while ((lm = linkRegex.exec(result.rawHtml)) !== null) {
          const path = lm[1].replace(/\/+$/, '').toLowerCase();
          if (path && path.length > 1 && path.length < 50 && !seen.has(path) && relevantKeywords.test(path) && !path.includes('.') && path.split('/').length <= 3) {
            seen.add(path);
            discoveredPaths.push(path);
          }
        }
      }

      // Fallback : si peu de liens decouverts, ajouter les pages haute probabilite
      const fallbackPaths = ['/about', '/a-propos', '/qui-sommes-nous', '/services', '/nos-services'];
      for (const fp of fallbackPaths) {
        if (!discoveredPaths.some(p => p === fp)) discoveredPaths.push(fp);
      }
      // Limiter a 8 pages max pour eviter trop de requetes
      discoveredPaths = discoveredPaths.slice(0, 8);

      const internalResults = await Promise.allSettled(
        discoveredPaths.map(p =>
          this._fetchInternalPage(fetcher, 'https://' + domain + p, p)
        )
      );

      // 3. Combiner les textes (homepage + pages internes)
      const texts = [];
      if (result.textContent) texts.push(result.textContent.substring(0, 600));
      for (const r of internalResults) {
        if (r.status === 'fulfilled' && r.value) {
          texts.push('[PAGE ' + r.value.path.toUpperCase() + '] ' + r.value.text);
        }
      }

      // 4. Extraire les noms propres (clients, marques, partenaires) du texte complet
      const allText = texts.join(' ');
      const properNouns = this._extractProperNouns(allText);
      if (properNouns.length > 0) {
        texts.push('[NOMS DETECTES] ' + properNouns.join(', '));
      }

      insights.textContent = texts.join('\n').substring(0, 3000);

      // 5. Detecter le tech stack depuis le HTML brut (0 requete supplementaire)
      if (result.rawHtml) {
        insights.techStack = this._detectTechStack(result.rawHtml);
      }

      return insights;
    } catch (e) {
      log.info('prospect-research', 'Scrape echoue pour ' + domain + ' (non bloquant): ' + e.message);
      return null;
    }
  }

  /**
   * Fetch une page interne avec timeout court (5s).
   */
  async _fetchInternalPage(fetcher, url, path) {
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
      const fetch = fetcher.scrapeWebPage(url);
      const result = await Promise.race([fetch, timeout]);
      if (!result || !result.textContent || result.textContent.length < 50) return null;
      return { path: path, text: result.textContent.substring(0, 800) };
    } catch (e) {
      return null;
    }
  }

  /**
   * Cherche les news recentes sur Google News RSS (gratuit)
   */
  async _fetchCompanyNews(companyName) {
    if (!companyName) return [];
    const fetcher = this._getFetcher();
    if (!fetcher) return [];

    try {
      const articles = await fetcher.fetchGoogleNews([companyName]);
      // Mapper les resultats bruts
      const mapped = articles.slice(0, 10).map(a => ({
        title: a.title,
        snippet: (a.snippet || '').substring(0, 150),
        source: a.source,
        pubDate: a.pubDate
      }));
      // Filtrer les news non pertinentes (ex: "colibri rare" pour IFFP, "GNL russe" pour Let it be Consulting)
      const filtered = this._filterRelevantNews(mapped, companyName);
      if (mapped.length > 0 && filtered.length === 0) {
        log.info('prospect-research', 'News filtre: ' + mapped.length + ' resultats Google News supprimes (aucun ne mentionne "' + companyName + '")');
      } else if (filtered.length < mapped.length) {
        log.info('prospect-research', 'News filtre: ' + (mapped.length - filtered.length) + '/' + mapped.length + ' news non pertinentes supprimees pour ' + companyName);
      }
      return filtered.slice(0, 5);
    } catch (e) {
      log.info('prospect-research', 'News echouees pour ' + companyName + ': ' + e.message);
      return [];
    }
  }

  /**
   * Extrait les donnees utiles de l'objet organization Apollo (deja paye)
   */
  /* DEPRECATED v9.0 — Clay replaces */
  _extractApolloOrgData(organization, contact) {
    return null;
    // Fusionner l'objet organization direct + organizationData stringifie + donnees contact + FlowFast
    let org = organization || {};

    // Si pas d'org directe, essayer de parser organizationData (stocke en JSON string dans FlowFast)
    if ((!org.name || Object.keys(org).length <= 2) && contact) {
      const rawOrgData = contact.organizationData;
      if (rawOrgData) {
        try {
          const parsed = typeof rawOrgData === 'string' ? JSON.parse(rawOrgData) : rawOrgData;
          // Filtrer les champs "has_*" booleens (Apollo search lite) — ne garder que les vraies valeurs
          const filtered = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (!k.startsWith('has_') && v !== true && v !== false) filtered[k] = v;
          }
          org = { ...org, ...filtered };
        } catch (e) { /* ignore parse errors */ }
      }
    }

    // Fallback : chercher dans FlowFast si organization est quasi-vide
    if ((!org.industry && !org.short_description) && contact) {
      try {
        const ffStorage = require('../flowfast/storage.js');
        const email = (contact.email || '').toLowerCase();
        if (email && ffStorage.data && ffStorage.data.leads) {
          for (const lid of Object.keys(ffStorage.data.leads)) {
            const fl = ffStorage.data.leads[lid];
            if ((fl.email || '').toLowerCase() === email) {
              // Enrichir avec les donnees FlowFast disponibles
              if (fl.industry && !org.industry) org.industry = fl.industry;
              if (fl.headline && !org.headline) org.headline = fl.headline;
              if (fl.localisation && !org.city) org.city = fl.localisation;
              if (fl.entreprise && !org.name) org.name = fl.entreprise;
              if (fl.tailleEstimee && !org.estimated_num_employees) org.estimated_num_employees = fl.tailleEstimee;
              break;
            }
          }
        }
      } catch (e) { /* FlowFast indisponible */ }
    }

    if (!org || (!org.name && !contact)) return null;

    return {
      name: org.name || (contact && contact.entreprise) || null,
      websiteUrl: org.website_url || null,
      industry: org.industry || (contact && contact.industry) || null,
      employeeCount: org.estimated_num_employees || null,
      foundedYear: org.founded_year || null,
      shortDescription: (org.short_description || '').substring(0, 300),
      keywords: (org.keywords || []).slice(0, 15),
      technologies: (org.technologies || []).slice(0, 15),
      city: org.city || (contact && contact.localisation) || null,
      country: org.country || null,
      linkedinUrl: org.linkedin_url || null,
      revenue: org.annual_revenue_printed || null,
      lastFundingDate: org.last_funding_date || org.lastFundingDate || null,
      lastFundingType: org.last_funding_type || null,
      lastFundingAmount: org.total_funding_printed || org.total_funding || null
    };
  }

  /**
   * Verifie si Web Intelligence a deja des articles sur cette entreprise
   */
  _checkExistingWebIntelArticles(companyName) {
    if (!companyName) return [];
    const wiStorage = getWebIntelStorage();
    if (!wiStorage || !wiStorage.getRelevantNewsForContact) return [];

    try {
      return wiStorage.getRelevantNewsForContact(companyName).map(n => ({
        id: n.id || null,
        headline: n.headline,
        date: n.date,
        relevance: n.relevance,
        url: n.url || n.link || null
      }));
    } catch (e) {
      return [];
    }
  }

  /**
   * Recherche DDG "entreprise + clients/projets/realisations" pour trouver des noms de clients.
   * Gratuit, ajoute une 6eme source de donnees specifiques.
   */
  async _searchCompanyClients(companyName) {
    if (!companyName) return null;

    try {
      const query = '"' + companyName + '" clients OR projets OR réalisations OR témoignages';
      const searchResult = await this._searchWithFallback(query);
      if (!searchResult) return null;

      let parsed = this._parseSearchResults(searchResult.html, searchResult.source, 5);
      // Filtrer les resultats en scripts non-latins (arabe, chinois, japonais)
      const beforeFilter = parsed.length;
      parsed = this._filterClientSearchResults(parsed);
      if (parsed.length < beforeFilter) {
        log.info('prospect-research', 'Client search filtre: ' + (beforeFilter - parsed.length) + '/' + beforeFilter + ' resultats non-latins supprimes pour ' + companyName);
      }
      const snippets = parsed.map(r => r.snippet).filter(s => s.length > 20);

      if (snippets.length === 0) return null;

      const allText = snippets.join(' ');
      const clientNames = this._extractProperNouns(allText);

      log.info('prospect-research', 'Clients ' + searchResult.source + ' pour ' + companyName + ': ' + snippets.length + ' snippets, ' + clientNames.length + ' noms');
      return {
        snippets: snippets.slice(0, 3).map(s => s.substring(0, 200)),
        clientNames: clientNames.slice(0, 10)
      };
    } catch (e) {
      log.info('prospect-research', 'Client search echoue pour ' + companyName + ': ' + e.message);
      return null;
    }
  }

  /**
   * Recherche DDG/Bing le profil public de la personne (interviews, podcasts, conferences, articles).
   * 7eme source de donnees — centree sur la PERSONNE, pas l'entreprise.
   * Cout : 0$ (DDG + Bing gratuits)
   */
  async _searchPersonProfile(name, company) {
    if (!name || name.length < 3) return null;

    try {
      const query = '"' + name + '"' + (company ? ' ' + company : '') + ' interview podcast conference article youtube';
      const searchResult = await this._searchWithFallback(query);
      if (!searchResult) return this._searchPersonProfileNews(name, company);

      const rawItems = this._parseSearchResults(searchResult.html, searchResult.source, 10);
      // Filtrer reseaux sociaux SAUF YouTube (interviews/talks) et Twitter/X (prises de position)
      let items = rawItems.filter(r => !/linkedin\.com|facebook\.com|instagram\.com/i.test(r.url));
      // Filtrer domaines garbage et scripts non-latins (ex: zhihu.com, heidisql.com, contenu chinois/arabe)
      const beforeFilter = items.length;
      items = this._filterPersonProfileResults(items);
      if (items.length < beforeFilter) {
        log.info('prospect-research', 'Person profile filtre: ' + (beforeFilter - items.length) + '/' + beforeFilter + ' resultats garbage supprimes pour ' + name);
      }

      if (items.length === 0) return this._searchPersonProfileNews(name, company);

      // Classifier chaque resultat
      const classified = items.map(item => {
        const text = (item.title + ' ' + item.snippet + ' ' + item.url).toLowerCase();
        let type = 'mention';
        if (text.includes('podcast') || text.includes('episode') || text.includes('épisode')) type = 'podcast';
        else if (/youtube\.com|youtu\.be/i.test(text)) type = 'video';
        else if (/twitter\.com|x\.com/i.test(text)) type = 'social';
        else if (text.includes('interview') || text.includes('entretien') || text.includes('portrait') || text.includes('rencontre avec')) type = 'interview';
        else if (/conf[ée]rence|talk|keynote|speaker|sommet|salon/i.test(text)) type = 'conference';
        else if (text.includes('article') || text.includes('tribune') || text.includes('blog') || text.includes('publie') || text.includes('écrit par')) type = 'article';
        return { type, title: item.title, snippet: item.snippet, url: item.url };
      });

      const intentSignals = this._extractPersonIntentSignals(classified);

      log.info('prospect-research', 'Person profile pour ' + name + ': ' + classified.length + ' resultats, ' + intentSignals.length + ' intent signals');
      return { items: classified.slice(0, 5), intentSignals: intentSignals };
    } catch (e) {
      log.info('prospect-research', 'Person profile echoue pour ' + name + ': ' + e.message);
      return this._searchPersonProfileNews(name, company);
    }
  }

  /**
   * Fallback Google News RSS pour Person Profile (meme moteur que _fetchCompanyNews).
   */
  async _searchPersonProfileNews(name, company) {
    const fetcher = this._getFetcher();
    if (!fetcher) return null;
    try {
      // Google News RSS — gratuit, fiable, meme endpoint que _fetchCompanyNews
      // Essai 1 : nom + entreprise, Essai 2 : nom seul (si le premier ne donne rien)
      let articles = await fetcher.fetchGoogleNews([name + (company ? ' ' + company : '')]);
      if ((!articles || articles.length === 0) && company) {
        articles = await fetcher.fetchGoogleNews(['"' + name + '"']);
      }
      if (!articles || articles.length === 0) return null;

      // Filtrer les news non pertinentes (meme probleme que _fetchCompanyNews : Google News RSS retourne du bruit)
      const nameLower = name.toLowerCase();
      const nameWords = nameLower.split(/\s+/).filter(w => w.length > 3);
      const companyLower = company ? company.toLowerCase() : '';
      const relevantArticles = articles.filter(a => {
        const titleAndSnippet = ((a.title || '') + ' ' + (a.snippet || '')).toLowerCase();
        // Match le nom complet ou partiel de la personne
        if (titleAndSnippet.includes(nameLower)) return true;
        if (nameWords.length > 0 && nameWords.some(w => titleAndSnippet.includes(w))) return true;
        // Match le nom d'entreprise
        if (companyLower && titleAndSnippet.includes(companyLower)) return true;
        return false;
      });
      if (relevantArticles.length === 0) return null;

      const items = relevantArticles.slice(0, 5).map(a => {
        const text = ((a.title || '') + ' ' + (a.snippet || '') + ' ' + (a.source || '')).toLowerCase();
        let type = 'mention';
        if (text.includes('podcast') || text.includes('episode')) type = 'podcast';
        else if (text.includes('interview') || text.includes('entretien') || text.includes('portrait')) type = 'interview';
        else if (/conf[ée]rence|conference|keynote|speaker|salon|sommet/.test(text)) type = 'conference';
        else if (text.includes('tribune') || text.includes('blog') || text.includes('opinion')) type = 'article';
        return {
          type,
          title: (a.title || '').substring(0, 150),
          snippet: (a.snippet || '').substring(0, 250),
          url: a.link || ''
        };
      });

      log.info('prospect-research', 'Person profile News pour ' + name + ': ' + items.length + ' articles');
      return { items: items, intentSignals: this._extractPersonIntentSignals(items) };
    } catch (e) { return null; }
  }

  /**
   * Detecte des signaux d'intent dans les resultats de recherche personne.
   */
  _extractPersonIntentSignals(items) {
    const signals = [];
    for (const item of items) {
      const text = (item.title + ' ' + (item.snippet || '')).toLowerCase();
      if (text.includes('recrute') || text.includes('hiring') || text.includes('recrutement') || text.includes('embauche')) {
        signals.push({ type: 'hiring_activity', detail: item.title.substring(0, 80) });
      }
      if (/conf[ée]rence|speaker|keynote|sommet|salon/.test(text)) {
        signals.push({ type: 'thought_leader', detail: item.title.substring(0, 80) });
      }
      if (text.includes('lève') || text.includes('leve') || text.includes('funding') || text.includes('levée') || text.includes('série')) {
        signals.push({ type: 'recent_funding', detail: item.title.substring(0, 80) });
      }
      if (item.type === 'article' || item.type === 'podcast') {
        signals.push({ type: 'content_creator', detail: item.title.substring(0, 80) });
      }
    }
    return signals.slice(0, 5);
  }

  /**
   * Extrait les mentions d'une personne dans le texte du site web scrape.
   * Cherche le nom/prenom et retourne les phrases environnantes.
   */
  _extractPersonMentions(fullName, siteText) {
    if (!fullName || !siteText) return null;

    const parts = fullName.toLowerCase().split(/\s+/).filter(p => p.length >= 3);
    if (parts.length === 0) return null;

    // Chercher le nom complet d'abord, puis le nom de famille
    const textLower = siteText.toLowerCase();
    const lastName = parts[parts.length - 1];
    const firstName = parts[0];

    // Decouper le texte en phrases (approximatif)
    const sentences = siteText.split(/(?<=[.!?\n])\s+/).filter(s => s.length > 10);
    const matches = [];

    for (const sentence of sentences) {
      const sl = sentence.toLowerCase();
      // Match nom complet ou (prenom + nom de famille dans la meme phrase)
      if (sl.includes(fullName.toLowerCase()) ||
          (sl.includes(firstName) && sl.includes(lastName))) {
        const clean = sentence.replace(/\s+/g, ' ').trim().substring(0, 250);
        if (clean.length > 20 && !matches.includes(clean)) {
          matches.push(clean);
        }
      }
    }

    // Aussi chercher dans les sections [PAGE /equipe] ou [PAGE /team]
    const sectionRegex = /\[PAGE\s+(\/equipe|\/team|\/a-propos|\/about|\/qui-sommes-nous)\]\s*([\s\S]*?)(?=\[PAGE|\[NOMS|$)/gi;
    let m;
    while ((m = sectionRegex.exec(siteText)) !== null) {
      const sectionText = m[2] || '';
      if (sectionText.toLowerCase().includes(lastName)) {
        // Extraire les 300 chars autour de la mention
        const idx = sectionText.toLowerCase().indexOf(lastName);
        const start = Math.max(0, idx - 100);
        const end = Math.min(sectionText.length, idx + 200);
        const excerpt = sectionText.substring(start, end).replace(/\s+/g, ' ').trim();
        if (excerpt.length > 20 && !matches.some(m => m.includes(excerpt.substring(0, 50)))) {
          matches.push(excerpt);
        }
      }
    }

    if (matches.length === 0) return null;

    log.info('prospect-research', 'Person mentions site web pour ' + fullName + ': ' + matches.length);
    return { mentions: matches.slice(0, 3), source: 'company_website' };
  }

  /**
   * Recupere des donnees LinkedIn via 5 strategies (0$ — aucun appel direct linkedin.com).
   * Ordre optimise : Brave Search (pas de rate-limit) > DuckDuckGo > Bing > Google Cache > Google search.
   * Chaque requete utilise un user-agent different pour eviter les 403.
   */
  /* DEPRECATED v9.0 — Clay replaces */
  async _fetchLinkedInData(linkedinUrl, name, company, apolloPerson) {
    return null;
    if ((!linkedinUrl || !linkedinUrl.includes('linkedin.com/in/')) && !name) return null;

    // Strategie -1 (IMMEDIAT) : Extraire headline depuis donnees contact existantes (0 requete HTTP)
    // FlowFast stocke le titre Apollo dans 'titre' ou 'title', et l'URL LinkedIn dans 'linkedin'
    if (apolloPerson) {
      const apHeadline = apolloPerson.headline || apolloPerson.titre || apolloPerson.title || '';
      const apLinkedin = apolloPerson.linkedin_url || apolloPerson.linkedin || apolloPerson.linkedinUrl || '';
      if (apHeadline && apHeadline.length > 5) {
        log.info('prospect-research', 'LinkedIn via donnees contact pour ' + name + ': ' + apHeadline.substring(0, 60));
        return {
          headline: apHeadline.substring(0, 200),
          linkedinUrl: apLinkedin || linkedinUrl || '',
          source: 'contact_data'
        };
      }
      // Mettre a jour linkedinUrl si disponible
      if (apLinkedin && !linkedinUrl) linkedinUrl = apLinkedin;
    }

    const fetcher = this._getFetcher();
    if (!fetcher) return null;

    // Strategie 0 (PRIORITAIRE) : Brave Search API — pas de rate-limit agressif, 2000 req/mois
    if (name && this.braveKey) {
      try {
        const braveQuery = '"' + name + '"' + (company ? ' "' + company + '"' : '') + ' site:linkedin.com/in/';
        const braveResult = await this._searchBrave(braveQuery);
        if (braveResult && braveResult.html) {
          // Parser le pseudo-HTML Brave comme DDG (meme format de sortie)
          const parsed = this._parseBraveLinkedInResults(braveResult.html, name);
          if (parsed && parsed.headline) {
            parsed.source = 'brave_search';
            log.info('prospect-research', 'LinkedIn via Brave Search OK pour ' + name);
            return parsed;
          }
        }
      } catch (e) {
        log.info('prospect-research', 'Brave LinkedIn echoue: ' + e.message);
      }
    }

    // Strategie 1 : DuckDuckGo HTML — retry sur 202 (rate-limit)
    if (name) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const ddgQuery = encodeURIComponent('"' + name + '"' + (company ? ' "' + company + '"' : '') + ' site:linkedin.com/in/');
          const ddgUrl = 'https://html.duckduckgo.com/html/?q=' + ddgQuery;
          const result = await fetcher.fetchUrl(ddgUrl, { userAgent: this._nextUA() });

          // 202 = rate limited, retry avec backoff exponentiel
          if (result && result.statusCode === 202 && attempt < 2) {
            const delay = (attempt + 1) * 2000; // 2s, 4s
            log.info('prospect-research', 'DuckDuckGo LinkedIn 202 — retry ' + (attempt + 1) + '/2 dans ' + (delay / 1000) + 's');
            await new Promise(r => setTimeout(r, delay));
            continue;
          }

          if (result && result.statusCode === 200 && result.body) {
            const parsed = this._parseDDGLinkedInResults(result.body, name);
            if (parsed && parsed.headline) {
              parsed.source = 'duckduckgo';
              log.info('prospect-research', 'LinkedIn via DuckDuckGo OK pour ' + name);
              return parsed;
            }
          }
          break;
        } catch (e) {
          log.info('prospect-research', 'DuckDuckGo LinkedIn echoue: ' + e.message);
          break;
        }
      }
    }

    // Strategie 2 : Bing search
    if (name) {
      try {
        const bingQuery = encodeURIComponent('site:linkedin.com/in/ "' + name + '"' + (company ? ' "' + company + '"' : ''));
        const bingUrl = 'https://www.bing.com/search?q=' + bingQuery + '&count=3';
        const result = await fetcher.fetchUrl(bingUrl, { userAgent: this._nextUA() });
        if (result && result.statusCode === 200 && result.body) {
          const parsed = this._parseBingLinkedInResults(result.body, name);
          if (parsed && parsed.headline) {
            parsed.source = 'bing_search';
            log.info('prospect-research', 'LinkedIn via Bing OK pour ' + name);
            return parsed;
          }
        }
      } catch (e) {
        log.info('prospect-research', 'Bing LinkedIn echoue: ' + e.message);
      }
    }

    // Strategie 2.5 : DDG alt-query (sans site: filter, format different)
    if (name && company) {
      try {
        const altQuery = encodeURIComponent(name + ' ' + company + ' linkedin.com/in');
        const altUrl = 'https://html.duckduckgo.com/html/?q=' + altQuery;
        const result = await fetcher.fetchUrl(altUrl, { userAgent: this._nextUA() });
        if (result && result.statusCode === 200 && result.body) {
          const linkedinLinkMatch = result.body.match(/href="[^"]*uddg=([^"&]+)[^"]*"[^>]*>[^<]*linkedin[^<]*<\/a>/i)
            || result.body.match(/linkedin\.com\/in\/[^"<\s]+/i);
          if (linkedinLinkMatch) {
            // Chercher le snippet/titre associe au lien LinkedIn
            const parsed = this._parseDDGLinkedInResults(result.body, name);
            if (parsed && parsed.headline) {
              parsed.source = 'ddg_alt_query';
              log.info('prospect-research', 'LinkedIn via DDG alt-query OK pour ' + name);
              return parsed;
            }
          }
        }
      } catch (e) {
        log.info('prospect-research', 'DDG alt-query LinkedIn echoue: ' + e.message);
      }
    }

    // Strategie 3 : Google Cache de l'URL LinkedIn directe (souvent 403 mais on essaie)
    if (linkedinUrl && linkedinUrl.includes('linkedin.com/in/')) {
      try {
        const cacheUrl = 'https://webcache.googleusercontent.com/search?q=cache:' + encodeURIComponent(linkedinUrl);
        const result = await fetcher.fetchUrl(cacheUrl, { userAgent: this._nextUA() });
        if (result && result.statusCode === 200 && result.body) {
          const parsed = this._parseLinkedInPage(result.body);
          if (parsed && parsed.headline) {
            parsed.source = 'google_cache';
            log.info('prospect-research', 'LinkedIn via Google Cache OK pour ' + name);
            return parsed;
          }
        }
      } catch (e) {
        log.info('prospect-research', 'Google Cache LinkedIn echoue: ' + e.message);
      }
    }

    // Strategie 4 : Google search direct (pas News, search normal via DDG lite)
    if (name && company) {
      try {
        const gQuery = encodeURIComponent(name + ' ' + company + ' linkedin');
        const gUrl = 'https://lite.duckduckgo.com/lite/?q=' + gQuery;
        const result = await fetcher.fetchUrl(gUrl, { userAgent: this._nextUA() });
        if (result && result.statusCode === 200 && result.body) {
          // Chercher un snippet qui ressemble a un profil LinkedIn
          const snippetMatch = result.body.match(/([^<]*linkedin\.com\/in\/[^<]*)/i);
          const titleMatch = result.body.match(/<a[^>]*href="[^"]*linkedin\.com\/in\/[^"]*"[^>]*>([^<]+)<\/a>/i);
          if (titleMatch) {
            const headline = titleMatch[1].replace(/\s*[-|]?\s*LinkedIn.*$/i, '').trim();
            if (headline.length > 5) {
              log.info('prospect-research', 'LinkedIn via DDG Lite OK pour ' + name);
              return { headline: headline.substring(0, 200), source: 'ddg_lite' };
            }
          }
        }
      } catch (e) {
        log.info('prospect-research', 'DDG Lite LinkedIn echoue: ' + e.message);
      }
    }

    return null;
  }

  /**
   * Parse les resultats Brave Search (pseudo-HTML) pour extraire les infos LinkedIn.
   */
  /* DEPRECATED v9.0 — Clay replaces */
  _parseBraveLinkedInResults(html, name) {
    return null;
    if (!html || html.length < 50) return null;

    // Brave pseudo-HTML: <a href="...linkedin.com/in/...">Title</a><span class="snippet">...</span>
    const linkMatch = html.match(/<a[^>]*href="[^"]*linkedin\.com\/in\/[^"]*"[^>]*>([^<]+)<\/a>/i);
    if (linkMatch) {
      const raw = linkMatch[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      const headline = raw.replace(/\s*[-|]?\s*LinkedIn.*$/i, '').trim();
      if (headline.length > 5) {
        const result = { headline: headline.substring(0, 200) };
        // Extraire le snippet associe
        const snippetMatch = html.match(/<span class="snippet">([^<]+)<\/span>/i);
        if (snippetMatch && snippetMatch[1].length > 20) {
          result.summary = snippetMatch[1].substring(0, 300);
        }
        return result;
      }
    }

    return null;
  }

  /**
   * Parse les resultats Bing pour extraire les infos LinkedIn.
   */
  /* DEPRECATED v9.0 — Clay replaces */
  _parseBingLinkedInResults(html, name) {
    return null;
    if (!html || html.length < 200) return null;

    // Bing met le titre dans <h2><a ...>Title</a></h2> ou <li class="b_algo"><h2><a>
    const titleMatches = html.match(/<h2[^>]*><a[^>]*href="[^"]*linkedin\.com\/in\/[^"]*"[^>]*>([^<]+)<\/a>/gi);
    if (titleMatches && titleMatches.length > 0) {
      const titleMatch = titleMatches[0].match(/>([^<]+)<\/a>/i);
      if (titleMatch) {
        const raw = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
        const headline = raw.replace(/\s*[-|]?\s*LinkedIn.*$/i, '').trim();
        if (headline.length > 5) return { headline: headline.substring(0, 200) };
      }
    }

    // Fallback : chercher dans les snippets <p class="b_lineclamp...">
    const snippetMatch = html.match(/<p[^>]*>([^<]*linkedin[^<]*)<\/p>/i)
      || html.match(/<span[^>]*class="b_caption"[^>]*>[^<]*<p>([^<]+)<\/p>/i);
    if (snippetMatch) {
      const snippet = snippetMatch[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
      if (snippet.length > 20 && snippet.length < 300) {
        return { headline: name, summary: snippet.substring(0, 200) };
      }
    }

    return null;
  }

  /**
   * Parse les resultats DuckDuckGo HTML pour extraire les infos LinkedIn.
   */
  /* DEPRECATED v9.0 — Clay replaces */
  _parseDDGLinkedInResults(html, name) {
    return null;
    if (!html || html.length < 200) return null;

    const result = { headline: null, summary: '' };

    // DDG HTML: <a class="result__a" href="...linkedin.com/in/...">Title</a>
    const linkMatches = html.match(/<a[^>]*class="result__a"[^>]*href="[^"]*linkedin\.com\/in\/[^"]*"[^>]*>([^<]+)<\/a>/gi);
    if (linkMatches && linkMatches.length > 0) {
      const titleMatch = linkMatches[0].match(/>([^<]+)<\/a>/i);
      if (titleMatch) {
        const raw = titleMatch[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
        result.headline = raw.replace(/\s*[-|]?\s*LinkedIn.*$/i, '').trim().substring(0, 200);
      }
    }

    // DDG snippets: collecter TOUS les snippets (pas juste le 1er) pour enrichir le profil
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const allSnippets = [];
    let match;
    while ((match = snippetRegex.exec(html)) !== null) {
      const snippet = match[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
      if (snippet.length > 15) allSnippets.push(snippet);
    }
    if (allSnippets.length > 0) {
      result.summary = allSnippets.join(' | ').substring(0, 400);
    }

    if (!result.headline && !result.summary) {
      // Dernier fallback avec le nom
      if (allSnippets.length > 0) return { headline: name, summary: allSnippets.join(' | ').substring(0, 400) };
      return null;
    }
    if (!result.headline) result.headline = name;
    return result;
  }

  /**
   * Extrait les noms propres (clients, marques, partenaires) du texte scrape.
   * Heuristique : mots capitalises qui ne sont pas des mots francais courants.
   */
  _extractProperNouns(text) {
    if (!text || text.length < 50) return [];

    // Mots francais courants a ignorer (stop words capitalises en debut de phrase)
    const stopWords = new Set([
      'Le', 'La', 'Les', 'Un', 'Une', 'Des', 'De', 'Du', 'Au', 'Aux',
      'Et', 'Ou', 'Mais', 'Donc', 'Or', 'Ni', 'Car', 'Si', 'En', 'Dans',
      'Sur', 'Sous', 'Avec', 'Pour', 'Par', 'Sans', 'Chez', 'Vers',
      'Notre', 'Nos', 'Votre', 'Vos', 'Leur', 'Leurs', 'Mon', 'Ma', 'Mes',
      'Ce', 'Cette', 'Ces', 'Son', 'Sa', 'Ses', 'Tout', 'Tous', 'Toute',
      'Qui', 'Que', 'Quoi', 'Dont', 'Nous', 'Vous', 'Ils', 'Elles',
      'Est', 'Sont', 'Fait', 'Plus', 'Bien', 'Aussi', 'Comme', 'Depuis',
      'Alors', 'Ainsi', 'Encore', 'Mieux', 'Moins', 'Tres', 'Tant',
      'Accueil', 'Contact', 'Services', 'Equipe', 'Expertise', 'Expertises',
      'Agence', 'Page', 'Menu', 'Navigation', 'Recherche', 'Voir',
      'Projet', 'Projets', 'Client', 'Clients', 'Partenaire', 'Partenaires',
      'Accompagnement', 'Solutions', 'Conseil', 'Formation', 'Groupe',
      'France', 'Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Toulouse', 'Nantes',
      'Lille', 'Strasbourg', 'Nice', 'Montpellier', 'Rennes',
      'Copyright', 'Mentions', 'Conditions', 'Politique', 'Confidentialite',
      'SARL', 'SAS', 'EURL', 'SA', 'PME', 'ETI', 'TPE', 'RCS',
      'Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'
    ]);

    const found = new Map(); // nom -> count

    // Pattern 1 : Mots capitalises (2+ chars) non en debut de phrase
    // On cherche au milieu d'une phrase (apres minuscule + espace)
    const midSentence = text.match(/[a-zéèêëàâùûôîïç,;:]\s+([A-ZÉÈÊËÀÂÙÛÔÎÏÇ][a-zéèêëàâùûôîïç]+(?:\s+[A-ZÉÈÊËÀÂÙÛÔÎÏÇ][a-zéèêëàâùûôîïç]+){0,2})/g);
    if (midSentence) {
      for (const m of midSentence) {
        const name = m.replace(/^[a-zéèêëàâùûôîïç,;:]\s+/, '').trim();
        if (name.length >= 3 && !stopWords.has(name.split(' ')[0])) {
          found.set(name, (found.get(name) || 0) + 1);
        }
      }
    }

    // Pattern 2 : Mots tout en majuscules (acronymes/marques : LVMH, EDF, SNCF)
    const acronyms = text.match(/\b[A-ZÉÈÊËÀÂ]{2,15}\b/g);
    if (acronyms) {
      for (const a of acronyms) {
        if (a.length >= 2 && !stopWords.has(a) && !['PAGE', 'NOMS', 'DETECTES', 'NEWS', 'SITE', 'WEB', 'CONTACT', 'ENTREPRISE', 'LINKEDIN', 'HTTP', 'HTTPS', 'HTML', 'CSS', 'SEO', 'SEA', 'CRM', 'ERP', 'API', 'ROI', 'URL', 'PHP', 'SQL'].includes(a)) {
          found.set(a, (found.get(a) || 0) + 1);
        }
      }
    }

    // Pattern 3 : Apres "client", "partenaire", "reference", "ils nous font confiance"
    const contextPatterns = [
      /(?:clients?|partenaires?|r[eé]f[eé]rences?|font confiance|accompagn[eé])\s*[:\-]?\s*([A-ZÉÈÊË][^.]{10,200})/gi,
    ];
    for (const pat of contextPatterns) {
      let cm;
      while ((cm = pat.exec(text)) !== null) {
        // Extraire les mots capitalises de la liste
        const chunk = cm[1];
        const names = chunk.match(/[A-ZÉÈÊËÀÂ][a-zéèêëàâùûôîïç]*(?:\s+[A-ZÉÈÊËÀÂ][a-zéèêëàâùûôîïç]*)*/g);
        if (names) {
          for (const n of names) {
            if (n.length >= 3 && !stopWords.has(n.split(' ')[0])) {
              found.set(n, (found.get(n) || 0) + 2); // bonus poids contexte
            }
          }
        }
      }
    }

    // Trier par frequence, garder les top 15
    return Array.from(found.entries())
      .filter(([name, count]) => count >= 1 && name.length >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name]) => name);
  }

  /**
   * Recherche les offres d'emploi actives pour cette entreprise (hiring = buying signal).
   * Source 1 : DDG site:welcometothejungle.com (WTTJ = #1 France)
   * Source 2 (fallback) : DDG generique recrutement
   * Cout : 0$
   */
  async _searchJobPostings(companyName) {
    if (!companyName || companyName.length < 3) return null;

    try {
      let jobSnippets = [];
      let wttjSlug = null;

      // Strategie 1 : WTTJ via DDG/Bing (fallback auto)
      const wttjSearch = await this._searchWithFallback('site:welcometothejungle.com "' + companyName + '"');
      if (wttjSearch) {
        const parsed = this._parseSearchResults(wttjSearch.html, wttjSearch.source, 8);
        for (const r of parsed) {
          if (!wttjSlug && r.url && r.url.includes('welcometothejungle.com/fr/companies/')) {
            const slugMatch = r.url.match(/companies\/([^\/]+)/);
            if (slugMatch) wttjSlug = slugMatch[1];
          }
          if (r.title.length > 5 && r.url && r.url.includes('welcometothejungle.com')) {
            jobSnippets.push(r.title);
          }
          if (r.snippet.length > 20) jobSnippets.push(r.snippet);
        }
      }

      // Strategie 2 (fallback) : recherche generique recrutement via DDG/Bing
      if (jobSnippets.length === 0) {
        const fallbackSearch = await this._searchWithFallback('"' + companyName + '" recrutement OR recrute OR "postes ouverts" OR "rejoint notre equipe"');
        if (fallbackSearch) {
          const parsed = this._parseSearchResults(fallbackSearch.html, fallbackSearch.source, 5);
          for (const r of parsed) {
            if (r.snippet.length > 20 && /recrut|embauche|poste|cdi|cdd|stage|alternance|talent/i.test(r.snippet)) {
              jobSnippets.push(r.snippet);
            }
          }
        }
      }

      if (jobSnippets.length === 0) return null;

      // Classifier les postes par categorie
      const allText = jobSnippets.join(' ').toLowerCase();
      const categories = { tech: 0, sales: 0, marketing: 0, product: 0, other: 0 };

      const TECH_KW = ['developer', 'developpeur', 'ingenieur', 'engineer', 'devops', 'data', 'backend', 'frontend', 'fullstack', 'sre', 'tech lead', 'qa', 'software'];
      const SALES_KW = ['commercial', 'sales', 'business development', 'account', 'sdr', 'bdr', 'responsable commercial'];
      const MKT_KW = ['marketing', 'communication', 'content', 'seo', 'growth', 'acquisition', 'brand', 'social media'];
      const PROD_KW = ['product', 'produit', 'chef de projet', 'project manager', 'ux', 'ui', 'design'];

      for (const kw of TECH_KW) { if (allText.includes(kw)) categories.tech++; }
      for (const kw of SALES_KW) { if (allText.includes(kw)) categories.sales++; }
      for (const kw of MKT_KW) { if (allText.includes(kw)) categories.marketing++; }
      for (const kw of PROD_KW) { if (allText.includes(kw)) categories.product++; }

      const totalJobs = Math.min(jobSnippets.length, 20);
      const highlights = jobSnippets.filter(s => s.length > 10 && s.length < 100).slice(0, 5).map(s => s.substring(0, 80));

      log.info('prospect-research', 'Job postings pour ' + companyName + ': ~' + totalJobs + ' postes (tech=' + categories.tech + ', sales=' + categories.sales + ', mkt=' + categories.marketing + ')');

      return {
        totalJobs: totalJobs,
        categories: categories,
        highlights: highlights,
        wttjSlug: wttjSlug,
        source: wttjSlug ? 'welcometothejungle' : 'web_search'
      };
    } catch (e) {
      log.info('prospect-research', 'Job postings echoue pour ' + companyName + ': ' + e.message);
      return null;
    }
  }

  // Source 10 : Dropcontact — enrichissement complet personne + entreprise
  // Double strategie : enrichByEmail (si email connu) + enrichByNameAndCompany (fallback)
  // Retourne les donnees meme sans email (tel, SIREN, LinkedIn, ville = precieux pour le brief)
  /* DEPRECATED v9.0 — Clay replaces */
  async _fetchDropcontactData(contact) {
    return null;
    const apiKey = process.env.DROPCONTACT_API_KEY;
    if (!apiKey) return null;

    const firstName = (contact.nom || contact.name || '').split(' ')[0];
    const lastName = (contact.nom || contact.name || '').split(' ').slice(1).join(' ');
    const company = contact.entreprise || '';
    const email = contact.email || '';
    const website = email ? email.split('@')[1] : '';

    try {
      const DropcontactEnricher = require('../lead-enrich/dropcontact-enricher.js');
      const dc = new DropcontactEnricher(apiKey);
      let result = null;

      // Strategie 1 : enrichByEmail si on a deja l'email (reverse lookup = telephone, SIREN, poste, LinkedIn)
      if (email && email.includes('@')) {
        result = await dc.enrichByEmail(email);
        if (result && (result.success || (result.person && (result.person.phone || result.person.city || result.person.linkedinUrl || result.person.title)))) {
          log.info('prospect-research', 'Dropcontact enrichByEmail OK pour ' + email + ' (tel:' + (result.person.phone ? 'oui' : 'non') + ', city:' + (result.person.city || 'non') + ')');
          return result;
        }
      }

      // Strategie 2 : enrichByNameAndCompany avec website (meilleur taux de match)
      if (firstName && company) {
        result = await dc.enrichByNameAndCompany(firstName, lastName, company, website);
        if (result) {
          // Retourner meme si success=false — les donnees partielles (ville, SIREN) sont utiles
          const hasAnyData = result.person && (result.person.title || result.person.phone || result.person.city || result.person.linkedinUrl) ||
            result.organization && (result.organization.siren || result.organization.website);
          if (result.success || hasAnyData) {
            log.info('prospect-research', 'Dropcontact enrichByName OK pour ' + firstName + ' ' + lastName + ' @ ' + company + ' (email:' + (result.person && result.person.email ? 'oui' : 'non') + ', data:' + (hasAnyData ? 'oui' : 'non') + ')');
            return result;
          }
        }
      }

      log.info('prospect-research', 'Dropcontact: aucune donnee pour ' + (contact.nom || email || company));
      return null;
    } catch (e) {
      log.info('prospect-research', 'Dropcontact enrichment skip: ' + e.message);
      return null;
    }
  }

  /**
   * Detecte le stack technique depuis le HTML brut du site web (0 requete HTTP supplementaire).
   * Scan meta tags, script src, link href, class names, framework fingerprints.
   * Retourne { cms, frameworks[], analytics[], marketing[], ecommerce[], other[] } ou null.
   */
  _detectTechStack(html) {
    if (!html || html.length < 200) return null;

    const detected = { cms: null, frameworks: [], analytics: [], marketing: [], ecommerce: [], other: [] };
    const h = html.toLowerCase();

    // CMS
    const CMS = [
      { name: 'WordPress', p: ['wp-content/', 'wp-includes/', 'generator" content="wordpress'] },
      { name: 'Shopify', p: ['cdn.shopify.com', 'shopify.com/s/', 'shopify-section'] },
      { name: 'Wix', p: ['static.wixstatic.com', '_wix_browser_sess'] },
      { name: 'Webflow', p: ['webflow.com', 'w-webflow-badge', 'data-wf-'] },
      { name: 'Squarespace', p: ['static1.squarespace.com', 'squarespace-cdn'] },
      { name: 'HubSpot CMS', p: ['hs-scripts.com', 'hubspot.net/hub/'] },
      { name: 'Drupal', p: ['drupal.js', 'sites/default/files'] },
      { name: 'PrestaShop', p: ['prestashop', '/modules/ps_'] },
      { name: 'Ghost', p: ['ghost.io', 'content="ghost'] },
      { name: 'Strapi', p: ['strapi.io'] },
      { name: 'Contentful', p: ['contentful.com'] }
    ];
    for (const c of CMS) { if (c.p.some(p => h.includes(p))) { detected.cms = c.name; break; } }

    // Frameworks
    const FW = [
      { name: 'React', p: ['react.production.min', 'data-reactroot', 'react-dom'] },
      { name: 'Next.js', p: ['_next/static', '__next', '_buildmanifest.js'] },
      { name: 'Vue.js', p: ['vue.min.js', 'vue.runtime', 'data-v-'] },
      { name: 'Nuxt', p: ['__nuxt', '_nuxt/'] },
      { name: 'Angular', p: ['ng-version', 'ng-app', 'ng-controller'] },
      { name: 'Gatsby', p: ['gatsby-', '/static/d/'] },
      { name: 'Svelte', p: ['__svelte', 'svelte-'] },
      { name: 'jQuery', p: ['jquery.min.js', 'jquery/'] },
      { name: 'Tailwind CSS', p: ['tailwindcss'] }
    ];
    for (const f of FW) { if (f.p.some(p => h.includes(p))) detected.frameworks.push(f.name); }

    // Analytics
    const AN = [
      { name: 'Google Analytics', p: ['google-analytics.com', 'gtag(', 'analytics.js'] },
      { name: 'Google Tag Manager', p: ['googletagmanager.com/gtm.js'] },
      { name: 'Matomo', p: ['matomo.js', 'piwik.js', 'matomo.cloud'] },
      { name: 'Hotjar', p: ['hotjar.com', 'hjid'] },
      { name: 'Mixpanel', p: ['cdn.mxpnl.com', 'mixpanel'] },
      { name: 'Segment', p: ['cdn.segment.com', 'analytics.js/v1/'] },
      { name: 'Plausible', p: ['plausible.io'] },
      { name: 'Amplitude', p: ['cdn.amplitude.com'] }
    ];
    for (const a of AN) { if (a.p.some(p => h.includes(p))) detected.analytics.push(a.name); }

    // Marketing / CRM
    const MK = [
      { name: 'HubSpot', p: ['js.hs-scripts.com', 'hbspt.'] },
      { name: 'Salesforce', p: ['salesforce.com', 'pardot.com'] },
      { name: 'Intercom', p: ['widget.intercom.io', 'intercomcdn.com'] },
      { name: 'Drift', p: ['js.driftt.com'] },
      { name: 'Zendesk', p: ['zopim.com', 'zendesk.com', 'zdassets.com'] },
      { name: 'Crisp', p: ['client.crisp.chat'] },
      { name: 'Brevo', p: ['sibautomation.com', 'sendinblue.com', 'brevo.com'] },
      { name: 'ActiveCampaign', p: ['trackcmp.net', 'activecampaign.com'] },
      { name: 'Mailchimp', p: ['list-manage.com', 'mailchimp.com'] },
      { name: 'Typeform', p: ['typeform.com'] },
      { name: 'Calendly', p: ['calendly.com'] },
      { name: 'Freshdesk', p: ['freshdesk.com', 'freshchat.com'] },
      { name: 'Pipedrive', p: ['pipedrive.com'] },
      { name: 'LiveChat', p: ['cdn.livechatinc.com'] }
    ];
    for (const m of MK) { if (m.p.some(p => h.includes(p))) detected.marketing.push(m.name); }

    // E-commerce
    const EC = [
      { name: 'Stripe', p: ['js.stripe.com'] },
      { name: 'PayPal', p: ['paypal.com/sdk', 'paypalobjects.com'] },
      { name: 'WooCommerce', p: ['woocommerce', 'wc-ajax'] },
      { name: 'Magento', p: ['magento', 'mage/'] }
    ];
    for (const e of EC) { if (e.p.some(p => h.includes(p))) detected.ecommerce.push(e.name); }

    // Infra / Other
    const OT = [
      { name: 'Cloudflare', p: ['cdnjs.cloudflare.com', '__cf_bm'] },
      { name: 'Vercel', p: ['vercel.app', '_vercel'] },
      { name: 'Netlify', p: ['netlify.app'] },
      { name: 'AWS', p: ['amazonaws.com'] },
      { name: 'Sentry', p: ['sentry.io', 'sentry-cdn'] },
      { name: 'reCAPTCHA', p: ['google.com/recaptcha'] },
      { name: 'Axeptio', p: ['axept.io'] },
      { name: 'Didomi', p: ['didomi.io', 'sdk.privacy-center'] },
      { name: 'Tarteaucitron', p: ['tarteaucitron'] }
    ];
    for (const o of OT) { if (o.p.some(p => h.includes(p))) detected.other.push(o.name); }

    const total = (detected.cms ? 1 : 0) + detected.frameworks.length + detected.analytics.length + detected.marketing.length + detected.ecommerce.length;
    return total === 0 ? null : detected;
  }

  /**
   * Parse le HTML d'une page LinkedIn (depuis le cache Google).
   */
  _parseLinkedInPage(html) {
    if (!html || html.length < 100) return null;
    const result = {};

    // Meta description (souvent "Name - Title at Company | LinkedIn")
    const metaMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)
      || html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i);
    if (metaMatch) {
      const desc = metaMatch[1].trim();
      // Format typique: "Name - Title at Company. Location. Connections"
      const parts = desc.split(/\s*[-·]\s*/);
      if (parts.length >= 2) {
        result.headline = parts.slice(0, 3).join(' - ').substring(0, 200);
      } else {
        result.headline = desc.substring(0, 200);
      }
    }

    // Titre de page (fallback)
    if (!result.headline) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1].includes('LinkedIn')) {
        result.headline = titleMatch[1].replace(/\s*[-|]?\s*LinkedIn.*$/i, '').trim().substring(0, 200);
      }
    }

    // OG description
    const ogMatch = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
    if (ogMatch) {
      result.summary = ogMatch[1].trim().substring(0, 200);
    }

    return (result.headline) ? result : null;
  }

  /**
   * API SIRENE (INSEE) — Donnees legales FR gratuites.
   * Recherche par nom d'entreprise → retourne SIREN, date creation, effectif, NAF, siege.
   * Endpoint : https://api.insee.fr/entreprises/sirene/V3.11/siren (ouvert sans cle)
   * Fallback : https://recherche-entreprises.api.gouv.fr/search (Data.gouv, 100% gratuit)
   */
  async _fetchSireneData(companyName) {
    if (!companyName || companyName.length < 3) return null;
    const https = require('https');

    // Utiliser l'API recherche-entreprises (data.gouv.fr) — gratuite, sans cle, sans rate limit agressif
    return new Promise((resolve) => {
      const query = encodeURIComponent(companyName.trim());
      const url = '/search?q=' + query + '&page=1&per_page=1';
      const req = https.request({
        hostname: 'recherche-entreprises.api.gouv.fr',
        path: url,
        method: 'GET',
        headers: { 'Accept': 'application/json', 'User-Agent': 'iFIND-Bot/1.0' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.results || json.results.length === 0) { resolve(null); return; }
            const r = json.results[0];
            const siege = r.siege || {};

            // Mapper les tranches effectifs INSEE vers des labels lisibles
            const trancheMap = {
              '00': '0 salarie', '01': '1-2', '02': '3-5', '03': '6-9',
              '11': '10-19', '12': '20-49', '21': '50-99', '22': '100-199',
              '31': '200-249', '32': '250-499', '41': '500-999', '42': '1000-1999',
              '51': '2000-4999', '52': '5000-9999', '53': '10000+'
            };

            // Mapper les categories juridiques courantes
            const catJurMap = {
              '1000': 'Entrepreneur individuel', '5498': 'EURL', '5499': 'SAS',
              '5710': 'SAS', '5720': 'SASU', '5599': 'SA', '5710': 'SAS',
              '5485': 'SARL', '5498': 'EURL unipersonnelle'
            };

            const result = {
              siren: r.siren || null,
              nom: r.nom_complet || r.nom_raison_sociale || null,
              dateCreation: r.date_creation || null,
              trancheEffectifs: trancheMap[r.tranche_effectif_salarie] || (r.tranche_effectif_salarie ? 'tranche ' + r.tranche_effectif_salarie : null),
              activitePrincipale: (siege.activite_principale ? siege.activite_principale + (siege.libelle_activite_principale ? ' — ' + siege.libelle_activite_principale : '') : null),
              categorieJuridique: catJurMap[r.nature_juridique] || (r.nature_juridique || null),
              adresse: siege.commune ? (siege.commune + (siege.code_postal ? ' (' + siege.code_postal + ')' : '')) : null,
              nombreEtablissements: r.nombre_etablissements || null,
              dirigeants: (r.dirigeants || []).slice(0, 2).map(d => (d.prenom || '') + ' ' + (d.nom || '') + (d.qualite ? ' (' + d.qualite + ')' : '')).filter(Boolean)
            };

            // Verifier que le resultat correspond bien a l'entreprise (anti-faux positif)
            const resultName = (result.nom || '').toLowerCase();
            const searchName = companyName.toLowerCase().trim();
            // Si le nom retourne ne contient aucun mot significatif du nom recherche, ignorer
            const searchWords = searchName.split(/[\s\-_&.,;:'"()]+/).filter(w => w.length > 2);
            const matchCount = searchWords.filter(w => resultName.includes(w)).length;
            if (searchWords.length > 0 && matchCount === 0) {
              log.info('prospect-research', 'SIRENE faux positif: recherche "' + companyName + '" → "' + result.nom + '" (aucun mot commun)');
              resolve(null);
              return;
            }

            log.info('prospect-research', 'SIRENE OK pour "' + companyName + '": SIREN=' + result.siren + ', effectif=' + (result.trancheEffectifs || '?') + ', creation=' + (result.dateCreation || '?'));
            resolve(result);
          } catch (e) {
            log.info('prospect-research', 'SIRENE parse error: ' + e.message);
            resolve(null);
          }
        });
      });
      req.on('error', (e) => { log.info('prospect-research', 'SIRENE error: ' + e.message); resolve(null); });
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  /**
   * Compile toutes les donnees en un brief textuel structure.
   * Ordre par UTILITE pour la personnalisation email :
   * 1. News recentes (observations temporelles specifiques)
   * 2. LinkedIn (angle personnel)
   * 3. Technologies (faits verifiables)
   * 4. Description entreprise
   * 5. Donnees enrichissement
   * Max 2000 chars — surcout negligible (~$0.05/mois)
   */
  _validateNicheCoherence(websiteText, niche) {
    const NICHE_ANTI_KEYWORDS = {
      'esn-ssii': ['immobilier', 'promoteur', 'programme immobilier', 'commercialisateur', 'foncier', 'residence', 'appartement', 'construction'],
      'agences-marketing': ['immobilier', 'promoteur', 'notaire', 'avocat', 'cabinet medical', 'pharmacie', 'chirurgien'],
      'saas-b2b': ['immobilier', 'promoteur', 'restaurant', 'coiffeur', 'boulangerie', 'artisan']
    };

    const NICHE_EXPECTED_KEYWORDS = {
      'esn-ssii': ['informatique', 'numerique', 'developpement', 'infrastructure', 'cloud', 'devops', 'logiciel', 'it', 'digital', 'tech'],
      'agences-marketing': ['marketing', 'communication', 'digitale', 'campagne', 'strategie', 'seo', 'social', 'branding', 'creation', 'web'],
      'saas-b2b': ['saas', 'logiciel', 'plateforme', 'api', 'abonnement', 'pricing', 'solution', 'integration', 'automatisation', 'dashboard']
    };

    const text = websiteText.toLowerCase();
    const antiKw = NICHE_ANTI_KEYWORDS[niche] || [];
    const expectedKw = NICHE_EXPECTED_KEYWORDS[niche] || [];

    // Detecter les anti-keywords (signal fort de mismatch)
    const foundAnti = antiKw.filter(kw => text.includes(kw));
    if (foundAnti.length >= 3) {
      return { coherent: false, reason: 'Site contient ' + foundAnti.length + ' anti-keywords [' + foundAnti.slice(0, 3).join(', ') + '] pour niche ' + niche };
    }

    // Compter les keywords attendus
    const foundExpected = expectedKw.filter(kw => text.includes(kw));
    const matchRatio = expectedKw.length > 0 ? foundExpected.length / expectedKw.length : 1;

    // Si anti-keyword detecte ET peu de keywords attendus → mismatch
    if (foundAnti.length >= 1 && matchRatio < 0.1) {
      return { coherent: false, reason: 'Anti-keyword [' + foundAnti[0] + '] + seulement ' + Math.round(matchRatio * 100) + '% keywords attendus pour niche ' + niche };
    }

    return { coherent: true, matchRatio: matchRatio, foundExpected: foundExpected.length };
  }

  async _buildProspectBrief(intel, contact) {
    const lines = [];

    // Contact + entreprise (toujours en premier pour le contexte)
    let companyLine = 'ENTREPRISE: ' + intel.company;
    const meta = [];
    if (intel.apolloData) {
      if (intel.apolloData.industry) meta.push(intel.apolloData.industry);
      if (intel.apolloData.employeeCount) meta.push(intel.apolloData.employeeCount + ' employes');
      if (intel.apolloData.foundedYear) meta.push('fondee en ' + intel.apolloData.foundedYear);
      if (intel.apolloData.city) meta.push(intel.apolloData.city);
      if (intel.apolloData.revenue) meta.push('CA: ' + intel.apolloData.revenue);
    }
    if (meta.length > 0) companyLine += ' (' + meta.join(', ') + ')';
    lines.push(companyLine);
    // Label source explicite pour le comptage de sources (v9.0: CLAY remplace APOLLO)
    if (intel.apolloData && meta.length > 0) {
      lines.push(intel.clayData ? 'CLAY: donnees organisation confirmees' : 'APOLLO: donnees organisation confirmees');
    }

    if (contact.nom || contact.titre) {
      let contactLine = 'CONTACT: ' + (contact.nom || '');
      if (contact.titre) contactLine += ' — ' + contact.titre;
      // Enrichir avec Clay si disponible (v9.0)
      if (intel.clayData) {
        const cd = intel.clayData;
        if (cd.title && cd.title.length > 3 && !contactLine.includes(cd.title)) contactLine += ' (' + cd.title + ')';
        if (cd.linkedin && !contact.linkedin_url) contactLine += ' | LinkedIn: ' + cd.linkedin;
        if (cd.phone) contactLine += ' | Tel: ' + cd.phone;
        if (cd.location) contactLine += ' | ' + cd.location;
      }
      lines.push(contactLine);
    }

    // Localisation Clay (utile pour personnalisation geographique)
    if (intel.clayData && intel.clayData.location && !meta.some(m => m.includes(intel.clayData.location))) {
      lines.push('LOCALISATION: ' + intel.clayData.location);
    }

    // PRIORITE 1 : News recentes — meilleure source d'observations specifiques et temporelles
    if (intel.recentNews.length > 0) {
      lines.push('NEWS RECENTES (pour observations specifiques):');
      for (const news of intel.recentNews.slice(0, 2)) {
        const dateStr = news.pubDate ? ' (' + new Date(news.pubDate).toLocaleDateString('fr-FR') + ')' : '';
        // Nettoyer le titre (enlever "- Source" en fin si deja dans news.source)
        let cleanTitle = news.title || '';
        if (news.source && cleanTitle.endsWith(' - ' + news.source)) {
          cleanTitle = cleanTitle.slice(0, -((' - ' + news.source).length));
        }
        let newsLine = '- "' + cleanTitle + '"' + dateStr;
        if (news.source) newsLine += ' [' + news.source + ']';
        // Snippet seulement si c'est du vrai texte (pas une URL Google News)
        if (news.snippet && !news.snippet.includes('news.google.com') && !news.snippet.includes('<a href')) {
          newsLine += ' → ' + news.snippet.substring(0, 100);
        }
        lines.push(newsLine);
      }
    }

    // PRIORITE 1b : Signaux marche (funding, hiring, expansion, acquisition)
    if (intel.marketSignals && intel.marketSignals.length > 0) {
      lines.push('SIGNAUX MARCHE:');
      for (const s of intel.marketSignals.slice(0, 2)) {
        const signalAge = s.detectedAt ? Math.round((Date.now() - new Date(s.detectedAt).getTime()) / (60 * 60 * 1000)) : null;
        const ageLabel = signalAge !== null ? (signalAge < 48 ? ' (il y a ' + signalAge + 'h)' : ' (il y a ' + Math.round(signalAge / 24) + 'j)') : '';
        lines.push('- [' + (s.type || '?').toUpperCase() + '] ' + (s.article && s.article.title || '').substring(0, 80) + ageLabel + (s.suggestedAction ? ' → ' + s.suggestedAction.substring(0, 60) : ''));
      }
    }

    // PRIORITE 1c : Offres d'emploi (hiring = signal de croissance)
    if (intel.jobPostings) {
      const jp = intel.jobPostings;
      let jobLine = 'RECRUTEMENT ACTIF: ~' + jp.totalJobs + ' postes ouverts';
      const catParts = [];
      if (jp.categories.tech > 0) catParts.push(jp.categories.tech + ' tech');
      if (jp.categories.sales > 0) catParts.push(jp.categories.sales + ' commercial');
      if (jp.categories.marketing > 0) catParts.push(jp.categories.marketing + ' marketing');
      if (jp.categories.product > 0) catParts.push(jp.categories.product + ' produit');
      if (catParts.length > 0) jobLine += ' (' + catParts.join(', ') + ')';
      if (jp.source === 'welcometothejungle') jobLine += ' [WTTJ]';
      lines.push(jobLine);
    }

    // PRIORITE 2 : LinkedIn — angle personnel sur le decideur
    if (intel.linkedinData) {
      let liLine = 'LINKEDIN ' + (contact.nom || '') + ': ';
      if (intel.linkedinData.headline) liLine += intel.linkedinData.headline;
      if (intel.linkedinData.summary) liLine += ' — ' + intel.linkedinData.summary.substring(0, 350);
      lines.push(liLine);
    }

    // PRIORITE 2a-bis : Posts LinkedIn recents (Clay v9.0)
    if (intel.clayData) {
      const postsRaw2 = intel.clayData.linkedinPosts || (intel.clayData.enrichment && intel.clayData.enrichment.linkedinPosts) || null;
      const postsArr2 = postsRaw2 && Array.isArray(postsRaw2) ? postsRaw2 : (postsRaw2 && postsRaw2.posts && Array.isArray(postsRaw2.posts) ? postsRaw2.posts : null);
      if (postsArr2 && postsArr2.length > 0) {
        lines.push('POSTS LINKEDIN RECENTS:');
        for (const post of postsArr2.slice(0, 2)) {
          const postText = typeof post === 'string' ? post : (post.post || post.text || post.content || JSON.stringify(post));
          lines.push('- "' + postText.substring(0, 200) + '"');
        }
      }
    }

    // PRIORITE 2a-ter : Tech Stack BuiltWith (Clay v9.0)
    if (intel.clayData) {
      const builtWith = intel.clayData.builtWith || (intel.clayData.enrichment && (intel.clayData.enrichment.builtWith || intel.clayData.enrichment.technologies)) || null;
      if (builtWith && Array.isArray(builtWith) && builtWith.length > 0) {
        lines.push('TECH STACK (BuiltWith): ' + builtWith.slice(0, 10).join(', '));
      }
    }

    // PRIORITE 2b : Profil public — interviews, podcasts, conferences (PERSONNE, pas entreprise)
    if (intel.personProfile && intel.personProfile.items && intel.personProfile.items.length > 0) {
      lines.push('PROFIL PUBLIC ' + (contact.nom || '') + ':');
      for (const item of intel.personProfile.items.slice(0, 3)) {
        // Nettoyer le titre (enlever "- Source" en fin)
        let cleanTitle = item.title || '';
        const dashSource = cleanTitle.match(/\s-\s[^-]+$/);
        const source = dashSource ? dashSource[0].replace(/^\s-\s/, '') : '';
        if (dashSource) cleanTitle = cleanTitle.slice(0, dashSource.index);
        let itemLine = '- [' + item.type.toUpperCase() + '] "' + cleanTitle + '"';
        if (source) itemLine += ' [' + source + ']';
        // Snippet seulement si texte reel (pas URL)
        if (item.snippet && !item.snippet.includes('news.google.com') && !item.snippet.includes('<a href')) {
          itemLine += ' — ' + item.snippet.substring(0, 120);
        }
        lines.push(itemLine);
      }
    }

    // PRIORITE 2b-bis : Mentions personne sur le site web (fallback quand pas de profil public)
    if (intel.personFromWebsite && intel.personFromWebsite.mentions && intel.personFromWebsite.mentions.length > 0) {
      lines.push('PERSONNE SUR LE SITE (' + (contact.nom || '') + '):');
      for (const mention of intel.personFromWebsite.mentions.slice(0, 2)) {
        lines.push('- "' + mention + '"');
      }
    }

    // PRIORITE 2c : Signaux intent personne (recrutement, conference, funding, contenu)
    if (intel.intentSignals && intel.intentSignals.length > 0) {
      lines.push('SIGNAUX INTENT:');
      for (const sig of intel.intentSignals.slice(0, 3)) {
        lines.push('- [' + sig.type.toUpperCase() + '] ' + sig.detail);
      }
    }

    // Clients/projets trouves via recherche web (noms de marques = tres specifique pour personnalisation)
    if (intel.clientSearch) {
      if (intel.clientSearch.clientNames && intel.clientSearch.clientNames.length > 0) {
        lines.push('CLIENTS/MARQUES DETECTES: ' + intel.clientSearch.clientNames.join(', '));
      }
      if (intel.clientSearch.snippets && intel.clientSearch.snippets.length > 0) {
        lines.push('CONTEXTE WEB: ' + intel.clientSearch.snippets[0].substring(0, 200));
      }
    }

    // PRIORITE 4 : Description entreprise (Clay > Apollo > site web)
    if (intel.clayData && intel.clayData.companyDescription) {
      lines.push('ACTIVITE: ' + intel.clayData.companyDescription.substring(0, 250));
    } else if (intel.apolloData && intel.apolloData.shortDescription) {
      lines.push('ACTIVITE: ' + intel.apolloData.shortDescription.substring(0, 250));
    } else if (intel.websiteInsights && intel.websiteInsights.description) {
      lines.push('SITE WEB: "' + intel.websiteInsights.description.substring(0, 250) + '"');
    }

    // Contenu site web : uniquement resume IA court (pas de dump brut)
    if (intel.websiteInsights && intel.websiteInsights.textContent) {
      const rawSiteText = intel.websiteInsights.textContent.replace(/\s+/g, ' ').trim();
      if (rawSiteText.length > 500) {
        try {
          const companyName = contact.company || contact.entreprise || '';
          const summary = await this._summarizeWebsite(rawSiteText, companyName);
          if (summary && summary.length > 30) {
            lines.push('ANALYSE SITE WEB: ' + summary.substring(0, 300));
          }
        } catch (e) { /* pas de fallback brut */ }
      }
    }

    // PRIORITE 5 : Articles Web Intelligence (avec contenu si disponible)
    if (intel.existingArticles.length > 0) {
      lines.push('ARTICLES VEILLE:');
      for (const a of intel.existingArticles.slice(0, 3)) {
        let artLine = '- "' + a.headline + '" [pertinence: ' + a.relevance + '/10]';
        if (a.fullText) artLine += '\n  EXTRAIT: ' + a.fullText.substring(0, 300);
        lines.push(artLine);
      }
    }

    // Contexte sectoriel (inter-prospect memory)
    if (intel.sectorCompetitors && intel.sectorCompetitors.length > 0) {
      const industryLabel = (intel.leadEnrichData && intel.leadEnrichData.industry) || (intel.apolloData && intel.apolloData.industry) || 'meme secteur';
      lines.push('CONTEXTE SECTORIEL (' + industryLabel + '): ' + intel.sectorCompetitors.length + ' autres entreprises contactees');
      for (const comp of intel.sectorCompetitors.slice(0, 3)) {
        const meta = [];
        if (comp.employees) meta.push(comp.employees + ' emp');
        if (comp.city) meta.push(comp.city);
        lines.push('- ' + comp.name + (meta.length > 0 ? ' (' + meta.join(', ') + ')' : ''));
      }
      lines.push('REGLE: Tu peux mentionner que d\'autres acteurs du secteur s\'interessent a la meme problematique. NE JAMAIS nommer les prospects — reste anonyme ("d\'autres ' + industryLabel + '", "un acteur de ta taille").');
    }

    const brief = lines.join('\n');
    return brief.substring(0, 8000);
  }
}

module.exports = ProspectResearcher;
