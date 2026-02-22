// Autonomous Pilot - Recherche pre-envoi sur les prospects
// Collecte des informations reelles sur l'entreprise et la personne
// avant la generation d'email pour une personnalisation profonde.
// Cout : 0$ (Google News RSS gratuit + linkedom scraping gratuit + Apollo data deja payee)

const log = require('../../gateway/logger.js');

function _require(relativePath, absolutePath) {
  try { return require(relativePath); }
  catch (e) {
    try { return require(absolutePath); }
    catch (e2) { return null; }
  }
}

function getWebFetcher() {
  return _require('../web-intelligence/web-fetcher.js', '/app/skills/web-intelligence/web-fetcher.js');
}

function getWebIntelStorage() {
  return _require('../web-intelligence/storage.js', '/app/skills/web-intelligence/storage.js');
}

function getAPStorage() {
  return _require('./storage.js', '/app/skills/autonomous-pilot/storage.js');
}

function getLeadEnrichStorage() {
  return _require('../lead-enrich/storage.js', '/app/skills/lead-enrich/storage.js');
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
    this.pappersToken = options.pappersToken || process.env.PAPPERS_API_TOKEN || null;
    this._fetcher = null;
    this._uaIndex = Math.floor(Math.random() * USER_AGENTS.length);
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
   * Helper universel : recherche DDG → Bing fallback.
   * Retourne le HTML brut de la page de resultats, ou null.
   * Resout le probleme DDG 202 (rate-limited) en basculant sur Bing automatiquement.
   */
  async _searchWithFallback(query) {
    const fetcher = this._getFetcher();
    if (!fetcher) return null;

    // Tentative 1 : DDG HTML
    try {
      const ddgUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
      const result = await fetcher.fetchUrl(ddgUrl, { userAgent: this._nextUA() });
      if (result && result.statusCode === 200 && result.body && result.body.length > 500) {
        return { html: result.body, source: 'ddg' };
      }
      // DDG 202 = rate-limited, retry une fois apres 1.5s
      if (result && result.statusCode === 202) {
        await new Promise(r => setTimeout(r, 1500));
        const retry = await fetcher.fetchUrl(ddgUrl, { userAgent: this._nextUA() });
        if (retry && retry.statusCode === 200 && retry.body && retry.body.length > 500) {
          return { html: retry.body, source: 'ddg' };
        }
      }
    } catch (e) {}

    // Tentative 2 : Bing
    try {
      const bingUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&count=8';
      const result = await fetcher.fetchUrl(bingUrl, { userAgent: this._nextUA() });
      if (result && result.statusCode === 200 && result.body && result.body.length > 500) {
        return { html: result.body, source: 'bing' };
      }
    } catch (e) {}

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
        if (cacheAge < 7 * 24 * 60 * 60 * 1000) { // 7 jours TTL
          log.info('prospect-research', 'Cache hit pour ' + email);
          return cached;
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
    } catch (e) {}

    log.info('prospect-research', 'Recherche pour ' + company + ' (' + (contact.nom || email) + ')');

    // Extraire le domaine depuis l'email
    const domain = email ? email.split('@')[1] : null;

    // Executer toutes les recherches en parallele (10 sources)
    const linkedinUrl = contact.linkedin_url || contact.linkedin || contact.linkedinUrl || '';
    const contactName = contact.nom || contact.name || '';
    const [websiteResult, newsResult, apolloData, webIntelArticles, linkedinResult, clientSearchResult, personProfileResult, pappersResult, jobPostingsResult] = await Promise.allSettled([
      this._scrapeCompanyWebsite(domain),
      this._fetchCompanyNews(company),
      Promise.resolve(this._extractApolloOrgData(contact.organization)),
      Promise.resolve(this._checkExistingWebIntelArticles(company)),
      this._fetchLinkedInData(linkedinUrl, contactName, company),
      this._searchCompanyClients(company),
      this._searchPersonProfile(contactName, company),
      this._fetchPappersData(company),
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
    } catch (e) {}

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

    // Chercher les concurrents dans le meme secteur (inter-prospect memory)
    let sectorCompetitors = [];
    try {
      const apStorage2 = getAPStorage();
      if (apStorage2 && apStorage2.getCompetitorsInIndustry) {
        let industry = '';
        if (leadEnrichData && leadEnrichData.industry) industry = leadEnrichData.industry;
        const apolloResolved = apolloData.status === 'fulfilled' ? apolloData.value : null;
        if (!industry && apolloResolved && apolloResolved.industry) industry = apolloResolved.industry;
        if (industry) {
          sectorCompetitors = apStorage2.getCompetitorsInIndustry(industry, 5)
            .filter(c => c.name.toLowerCase() !== company.toLowerCase());
        }
      }
    } catch (e) {}

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
      apolloData: apolloData.status === 'fulfilled' ? apolloData.value : null,
      existingArticles: rawArticles,
      linkedinData: linkedinResult.status === 'fulfilled' ? linkedinResult.value : null,
      clientSearch: clientSearchResult.status === 'fulfilled' ? clientSearchResult.value : null,
      personProfile: personProfile,
      personFromWebsite: personFromWebsite,
      pappersData: pappersResult.status === 'fulfilled' ? pappersResult.value : null,
      jobPostings: jobPostingsResult.status === 'fulfilled' ? jobPostingsResult.value : null,
      intentSignals: personProfile ? (personProfile.intentSignals || []) : [],
      sectorCompetitors: sectorCompetitors,
      leadEnrichData: leadEnrichData,
      marketSignals: marketSignals,
      researchedAt: new Date().toISOString()
    };

    // Auto-intent signal : recrutement massif
    if (intel.jobPostings && intel.jobPostings.totalJobs >= 3) {
      intel.intentSignals.push({
        type: 'active_hiring',
        detail: intel.jobPostings.totalJobs + ' postes ouverts' +
          (intel.jobPostings.categories.sales > 0 ? ' (dont ' + intel.jobPostings.categories.sales + ' commerciaux)' : '')
      });
    }

    // Construire le brief textuel
    intel.brief = this._buildProspectBrief(intel, contact);

    // Sauvegarder dans le cache
    if (apStorage && email && apStorage.saveProspectResearch) {
      try { apStorage.saveProspectResearch(email, intel); } catch (e) {}
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
      intel.pappersData ? 'Pappers' : null,
      intel.jobPostings ? intel.jobPostings.totalJobs + ' offres emploi' : null,
      intel.techStack ? 'tech stack' : null,
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
        } catch (e) {}
      }

      if (!result) return null;

      const insights = {
        title: (result.title || '').substring(0, 200),
        description: (result.description || '').substring(0, 300),
        textContent: ''
      };

      // 2. Pages internes cibles (parallele, timeout 5s)
      const targetPaths = [
        '/clients', '/nos-clients', '/references', '/nos-references',
        '/realisations', '/nos-realisations', '/portfolio', '/cas-clients',
        '/about', '/a-propos', '/qui-sommes-nous',
        '/services', '/nos-services', '/expertises',
        '/temoignages', '/projets', '/equipe', '/team'
      ];
      const internalResults = await Promise.allSettled(
        targetPaths.slice(0, 6).map(p =>
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
      return { path: path, text: result.textContent.substring(0, 500) };
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
      // Garder seulement les 5 premiers, juste titre + snippet (pas d'analyse IA)
      return articles.slice(0, 5).map(a => ({
        title: a.title,
        snippet: (a.snippet || '').substring(0, 150),
        source: a.source,
        pubDate: a.pubDate
      }));
    } catch (e) {
      log.info('prospect-research', 'News echouees pour ' + companyName + ': ' + e.message);
      return [];
    }
  }

  /**
   * Extrait les donnees utiles de l'objet organization Apollo (deja paye)
   */
  _extractApolloOrgData(organization) {
    if (!organization) return null;
    return {
      name: organization.name || null,
      websiteUrl: organization.website_url || null,
      industry: organization.industry || null,
      employeeCount: organization.estimated_num_employees || null,
      foundedYear: organization.founded_year || null,
      shortDescription: (organization.short_description || '').substring(0, 300),
      keywords: (organization.keywords || []).slice(0, 15),
      technologies: (organization.technologies || []).slice(0, 15),
      city: organization.city || null,
      country: organization.country || null,
      linkedinUrl: organization.linkedin_url || null,
      revenue: organization.annual_revenue_printed || null
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

      const parsed = this._parseSearchResults(searchResult.html, searchResult.source, 5);
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
      const query = '"' + name + '"' + (company ? ' ' + company : '') + ' interview podcast conference article';
      const searchResult = await this._searchWithFallback(query);
      if (!searchResult) return this._searchPersonProfileNews(name, company);

      const rawItems = this._parseSearchResults(searchResult.html, searchResult.source, 8);
      // Filtrer reseaux sociaux (deja geres ailleurs)
      const items = rawItems.filter(r => !/linkedin\.com|facebook\.com|twitter\.com|x\.com|instagram\.com/i.test(r.url));

      if (items.length === 0) return this._searchPersonProfileNews(name, company);

      // Classifier chaque resultat
      const classified = items.map(item => {
        const text = (item.title + ' ' + item.snippet + ' ' + item.url).toLowerCase();
        let type = 'mention';
        if (text.includes('podcast') || text.includes('episode') || text.includes('épisode')) type = 'podcast';
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

      const items = articles.slice(0, 5).map(a => {
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
   * Recupere des donnees LinkedIn via 4 strategies (0$ — aucun appel direct linkedin.com).
   * Ordre optimise : DuckDuckGo (+ fiable) > Bing > Google Cache > Google search.
   * Chaque requete utilise un user-agent different pour eviter les 403.
   */
  async _fetchLinkedInData(linkedinUrl, name, company) {
    if ((!linkedinUrl || !linkedinUrl.includes('linkedin.com/in/')) && !name) return null;

    const fetcher = this._getFetcher();
    if (!fetcher) return null;

    // Strategie 1 (PRIORITAIRE) : DuckDuckGo HTML — retry sur 202 (rate-limit)
    if (name) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const ddgQuery = encodeURIComponent('"' + name + '"' + (company ? ' "' + company + '"' : '') + ' site:linkedin.com/in/');
          const ddgUrl = 'https://html.duckduckgo.com/html/?q=' + ddgQuery;
          const result = await fetcher.fetchUrl(ddgUrl, { userAgent: this._nextUA() });

          // 202 = rate limited, retry apres 2s
          if (result && result.statusCode === 202 && attempt === 0) {
            log.info('prospect-research', 'DuckDuckGo LinkedIn 202 — retry dans 2s');
            await new Promise(r => setTimeout(r, 2000));
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
   * Parse les resultats Bing pour extraire les infos LinkedIn.
   */
  _parseBingLinkedInResults(html, name) {
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
  _parseDDGLinkedInResults(html, name) {
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

  /**
   * Recupere les donnees legales et financieres via Pappers.fr API (gratuit 100 req/mois).
   * Recherche par nom d'entreprise. Cache 30 jours (donnees legales = stables).
   */
  async _fetchPappersData(companyName) {
    if (!companyName || !this.pappersToken) return null;

    // Cache 30 jours
    const cacheKey = 'pappers_' + companyName.toLowerCase().trim();
    const apStorage = getAPStorage();
    if (apStorage && apStorage.getProspectResearch) {
      try {
        const cached = apStorage.getProspectResearch(cacheKey);
        if (cached && cached.pappersData && cached.cachedAt) {
          const age = Date.now() - new Date(cached.cachedAt).getTime();
          if (age < 30 * 24 * 60 * 60 * 1000) {
            log.info('prospect-research', 'Pappers cache hit pour ' + companyName);
            return cached.pappersData;
          }
        }
      } catch (e) {}
    }

    const fetcher = this._getFetcher();
    if (!fetcher) return null;

    try {
      const searchUrl = 'https://api.pappers.fr/v2/recherche?api_token=' + this.pappersToken +
        '&q=' + encodeURIComponent(companyName) + '&par_page=3&statut=A';

      const result = await fetcher.fetchUrl(searchUrl);
      if (!result || result.statusCode !== 200 || !result.body) return null;

      let data;
      try { data = JSON.parse(result.body); } catch (e) { return null; }

      if (!data.resultats || data.resultats.length === 0) return null;

      const best = data.resultats[0];
      const pappersData = {
        siren: best.siren || null,
        nom: best.nom_entreprise || best.denomination || companyName,
        formeJuridique: best.forme_juridique || null,
        dateCreation: best.date_creation || null,
        effectif: best.effectifs || best.tranche_effectif || null,
        chiffreAffaires: best.chiffre_affaires || null,
        resultatNet: best.resultat || null,
        codeNAF: best.code_naf || null,
        activite: best.objet_social || best.libelle_code_naf || null,
        dirigeants: (best.representants || []).slice(0, 5).map(d => ({
          nom: ((d.prenom || '') + ' ' + (d.nom || '')).trim(),
          fonction: d.qualite || d.fonction || null
        })),
        siege: best.siege ? {
          ville: best.siege.ville || null,
          codePostal: best.siege.code_postal || null
        } : null,
        capital: best.capital || null
      };

      // Sauvegarder dans le cache (30 jours)
      if (apStorage && apStorage.saveProspectResearch) {
        try { apStorage.saveProspectResearch(cacheKey, { pappersData, cachedAt: new Date().toISOString() }); } catch (e) {}
      }

      log.info('prospect-research', 'Pappers OK pour ' + companyName + ': SIREN ' + (pappersData.siren || '?') + ', ' + (pappersData.effectif || '?') + ' salaries');
      return pappersData;
    } catch (e) {
      log.info('prospect-research', 'Pappers echoue pour ' + companyName + ': ' + e.message);
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
   * Compile toutes les donnees en un brief textuel structure.
   * Ordre par UTILITE pour la personnalisation email :
   * 1. News recentes (observations temporelles specifiques)
   * 2. LinkedIn (angle personnel)
   * 3. Technologies (faits verifiables)
   * 4. Description entreprise
   * 5. Donnees enrichissement
   * Max 2000 chars — surcout negligible (~$0.05/mois)
   */
  _buildProspectBrief(intel, contact) {
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
    // Merger Pappers si Apollo manque des infos
    if (intel.pappersData) {
      if (!intel.apolloData || !intel.apolloData.employeeCount) {
        if (intel.pappersData.effectif) meta.push(intel.pappersData.effectif + (typeof intel.pappersData.effectif === 'number' ? ' salaries' : ''));
      }
      if (!intel.apolloData || !intel.apolloData.foundedYear) {
        if (intel.pappersData.dateCreation) meta.push('fondee ' + intel.pappersData.dateCreation);
      }
      if (!intel.apolloData || !intel.apolloData.city) {
        if (intel.pappersData.siege && intel.pappersData.siege.ville) meta.push(intel.pappersData.siege.ville);
      }
    }
    if (meta.length > 0) companyLine += ' (' + meta.join(', ') + ')';
    lines.push(companyLine);

    if (contact.nom || contact.titre) {
      let contactLine = 'CONTACT: ' + (contact.nom || '');
      if (contact.titre) contactLine += ' — ' + contact.titre;
      lines.push(contactLine);
    }

    // PRIORITE 0 : Donnees legales verifiees (Pappers.fr)
    if (intel.pappersData) {
      const pp = intel.pappersData;
      const legalParts = [];
      if (pp.formeJuridique) legalParts.push(pp.formeJuridique);
      if (pp.dateCreation) legalParts.push('creee le ' + pp.dateCreation);
      if (pp.effectif) legalParts.push(pp.effectif + (typeof pp.effectif === 'number' ? ' salaries' : ''));
      if (pp.chiffreAffaires) legalParts.push('CA: ' + (typeof pp.chiffreAffaires === 'number' ? (pp.chiffreAffaires / 1000000).toFixed(1) + 'M€' : pp.chiffreAffaires));
      if (pp.siege && pp.siege.ville) legalParts.push(pp.siege.ville);
      if (legalParts.length > 0) lines.push('DONNEES LEGALES (Pappers.fr): ' + legalParts.join(', '));
      if (pp.activite) lines.push('ACTIVITE NAF: ' + pp.activite);
      if (pp.dirigeants && pp.dirigeants.length > 0) {
        const dirList = pp.dirigeants.slice(0, 3).map(d => d.nom + (d.fonction ? ' (' + d.fonction + ')' : '')).join(', ');
        lines.push('DIRIGEANTS: ' + dirList);
      }
    }

    // PRIORITE 1 : News recentes — meilleure source d'observations specifiques et temporelles
    if (intel.recentNews.length > 0) {
      lines.push('NEWS RECENTES (pour observations specifiques):');
      for (const news of intel.recentNews.slice(0, 4)) {
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

    // PRIORITE 3 : Technologies — faits verifiables pour observations techniques
    if (intel.apolloData && intel.apolloData.technologies && intel.apolloData.technologies.length > 0) {
      lines.push('STACK TECHNIQUE: ' + intel.apolloData.technologies.slice(0, 10).join(', '));
    }

    // PRIORITE 3a : Tech stack detecte depuis le HTML du site (complement Apollo)
    if (intel.techStack) {
      const ts = intel.techStack;
      const tsParts = [];
      if (ts.cms) tsParts.push('CMS: ' + ts.cms);
      if (ts.frameworks.length > 0) tsParts.push('Front: ' + ts.frameworks.join(', '));
      if (ts.marketing.length > 0) tsParts.push('Marketing: ' + ts.marketing.join(', '));
      if (ts.analytics.length > 0) tsParts.push('Analytics: ' + ts.analytics.join(', '));
      if (ts.ecommerce.length > 0) tsParts.push('Paiement: ' + ts.ecommerce.join(', '));
      if (tsParts.length > 0) lines.push('TECH STACK DETECTE: ' + tsParts.join(' | '));
    }

    // PRIORITE 3b : Keywords Apollo — services/produits proposes
    if (intel.apolloData && intel.apolloData.keywords && intel.apolloData.keywords.length > 0) {
      lines.push('MOTS-CLES: ' + intel.apolloData.keywords.slice(0, 10).join(', '));
    }

    // PRIORITE 3c : Clients/projets trouves via recherche web (noms de marques = tres specifique)
    if (intel.clientSearch) {
      if (intel.clientSearch.clientNames && intel.clientSearch.clientNames.length > 0) {
        lines.push('CLIENTS/MARQUES DETECTES: ' + intel.clientSearch.clientNames.join(', '));
      }
      if (intel.clientSearch.snippets && intel.clientSearch.snippets.length > 0) {
        lines.push('CONTEXTE WEB: ' + intel.clientSearch.snippets[0].substring(0, 200));
      }
    }

    // PRIORITE 4 : Description entreprise (Apollo ou site web, pas les deux)
    if (intel.apolloData && intel.apolloData.shortDescription) {
      lines.push('ACTIVITE: ' + intel.apolloData.shortDescription.substring(0, 250));
    } else if (intel.websiteInsights && intel.websiteInsights.description) {
      lines.push('SITE WEB: "' + intel.websiteInsights.description.substring(0, 250) + '"');
    }

    // Contenu du site web (si pas deja couvert par la description)
    if (intel.websiteInsights && intel.websiteInsights.textContent) {
      const siteText = intel.websiteInsights.textContent.substring(0, 300).replace(/\s+/g, ' ').trim();
      if (siteText.length > 50) lines.push('CONTENU SITE: ' + siteText);
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

    // PRIORITE 6 : Enrichissement Lead Enrich
    if (intel.leadEnrichData) {
      const le = intel.leadEnrichData;
      const leParts = [];
      if (le.industry) leParts.push('industrie: ' + le.industry);
      if (le.persona) leParts.push('persona: ' + le.persona);
      if (le.score) leParts.push('score: ' + le.score + '/10');
      if (le.technologies && le.technologies.length > 0) leParts.push('tech: ' + le.technologies.slice(0, 3).join(', '));
      if (leParts.length > 0) lines.push('ENRICHISSEMENT: ' + leParts.join(', '));
    }

    // PRIORITE 7 : Contexte sectoriel (inter-prospect memory)
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
    return brief.substring(0, 5500);
  }
}

module.exports = ProspectResearcher;
