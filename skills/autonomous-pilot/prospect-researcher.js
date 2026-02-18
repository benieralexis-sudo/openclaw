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

    // Executer toutes les recherches en parallele
    const linkedinUrl = contact.linkedin_url || contact.linkedin || contact.linkedinUrl || '';
    const [websiteResult, newsResult, apolloData, webIntelArticles, linkedinResult] = await Promise.allSettled([
      this._scrapeCompanyWebsite(domain),
      this._fetchCompanyNews(company),
      Promise.resolve(this._extractApolloOrgData(contact.organization)),
      Promise.resolve(this._checkExistingWebIntelArticles(company)),
      this._fetchLinkedInData(linkedinUrl, contact.nom || contact.name || '', company)
    ]);

    const intel = {
      company: company,
      websiteInsights: websiteResult.status === 'fulfilled' ? websiteResult.value : null,
      recentNews: newsResult.status === 'fulfilled' ? newsResult.value : [],
      apolloData: apolloData.status === 'fulfilled' ? apolloData.value : null,
      existingArticles: webIntelArticles.status === 'fulfilled' ? webIntelArticles.value : [],
      linkedinData: linkedinResult.status === 'fulfilled' ? linkedinResult.value : null,
      leadEnrichData: leadEnrichData,
      researchedAt: new Date().toISOString()
    };

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
      intel.linkedinData ? 'LinkedIn' : null
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
      const result = await fetcher.scrapeWebPage('https://' + domain);
      if (!result) return null;
      return {
        title: (result.title || '').substring(0, 200),
        description: (result.description || '').substring(0, 300),
        textContent: (result.textContent || '').substring(0, 1000)
      };
    } catch (e) {
      log.info('prospect-research', 'Scrape echoue pour ' + domain + ' (non bloquant): ' + e.message);
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
      keywords: (organization.keywords || []).slice(0, 10),
      technologies: (organization.technologies || []).slice(0, 10),
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
        relevance: n.relevance
      }));
    } catch (e) {
      return [];
    }
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

    // Strategie 1 (PRIORITAIRE) : DuckDuckGo HTML — pas de rate limit agressif, le plus fiable
    if (name) {
      try {
        const ddgQuery = encodeURIComponent('"' + name + '"' + (company ? ' "' + company + '"' : '') + ' site:linkedin.com/in/');
        const ddgUrl = 'https://html.duckduckgo.com/html/?q=' + ddgQuery;
        const result = await fetcher.fetchUrl(ddgUrl, { userAgent: this._nextUA() });
        if (result && result.statusCode === 200 && result.body) {
          const parsed = this._parseDDGLinkedInResults(result.body, name);
          if (parsed && parsed.headline) {
            parsed.source = 'duckduckgo';
            log.info('prospect-research', 'LinkedIn via DuckDuckGo OK pour ' + name);
            return parsed;
          }
        }
      } catch (e) {
        log.info('prospect-research', 'DuckDuckGo LinkedIn echoue: ' + e.message);
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

    // DDG HTML: <a class="result__a" href="...linkedin.com/in/...">Title</a>
    const linkMatches = html.match(/<a[^>]*class="result__a"[^>]*href="[^"]*linkedin\.com\/in\/[^"]*"[^>]*>([^<]+)<\/a>/gi);
    if (linkMatches && linkMatches.length > 0) {
      const titleMatch = linkMatches[0].match(/>([^<]+)<\/a>/i);
      if (titleMatch) {
        const raw = titleMatch[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
        const headline = raw.replace(/\s*[-|]?\s*LinkedIn.*$/i, '').trim();
        if (headline.length > 5) return { headline: headline.substring(0, 200) };
      }
    }

    // DDG snippet: <a class="result__snippet" ...>snippet text</a>
    const snippetMatch = html.match(/<a[^>]*class="result__snippet"[^>]*>([^<]+)</i);
    if (snippetMatch) {
      const snippet = snippetMatch[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
      if (snippet.length > 20) {
        return { headline: name, summary: snippet.substring(0, 200) };
      }
    }

    return null;
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
   * Max ~600 chars, pret a injecter dans le prompt de generation d'email.
   */
  _buildProspectBrief(intel, contact) {
    const lines = [];

    // Ligne 1 : entreprise + meta
    let companyLine = 'ENTREPRISE: ' + intel.company;
    const meta = [];
    if (intel.apolloData) {
      if (intel.apolloData.industry) meta.push(intel.apolloData.industry);
      if (intel.apolloData.employeeCount) meta.push(intel.apolloData.employeeCount + ' employes');
      if (intel.apolloData.foundedYear) meta.push('fondee en ' + intel.apolloData.foundedYear);
      if (intel.apolloData.city) meta.push(intel.apolloData.city);
    }
    if (meta.length > 0) companyLine += ' (' + meta.join(', ') + ')';
    lines.push(companyLine);

    // Description depuis Apollo ou site web
    if (intel.apolloData && intel.apolloData.shortDescription) {
      lines.push('DESCRIPTION: ' + intel.apolloData.shortDescription.substring(0, 200));
    } else if (intel.websiteInsights && intel.websiteInsights.description) {
      lines.push('SITE WEB: "' + intel.websiteInsights.description.substring(0, 200) + '"');
    } else if (intel.websiteInsights && intel.websiteInsights.title) {
      lines.push('SITE WEB: "' + intel.websiteInsights.title.substring(0, 150) + '"');
    }

    // Technologies (Apollo)
    if (intel.apolloData && intel.apolloData.technologies && intel.apolloData.technologies.length > 0) {
      lines.push('TECHNOLOGIES: ' + intel.apolloData.technologies.slice(0, 5).join(', '));
    }

    // News recentes (Google News RSS)
    if (intel.recentNews.length > 0) {
      lines.push('NEWS RECENTES:');
      for (const news of intel.recentNews.slice(0, 3)) {
        const dateStr = news.pubDate ? ' (' + new Date(news.pubDate).toLocaleDateString('fr-FR') + ')' : '';
        lines.push('- "' + news.title + '"' + dateStr);
      }
    }

    // Articles Web Intelligence existants
    if (intel.existingArticles.length > 0) {
      lines.push('ARTICLES VEILLE:');
      for (const a of intel.existingArticles.slice(0, 2)) {
        lines.push('- "' + a.headline + '" [pertinence: ' + a.relevance + '/10]');
      }
    }

    // Profil LinkedIn
    if (intel.linkedinData) {
      let liLine = 'LINKEDIN: ';
      if (intel.linkedinData.headline) liLine += intel.linkedinData.headline;
      if (intel.linkedinData.summary) liLine += ' — ' + intel.linkedinData.summary.substring(0, 100);
      lines.push(liLine);
    }

    // Donnees Lead Enrich (si deja enrichi)
    if (intel.leadEnrichData) {
      const le = intel.leadEnrichData;
      const leParts = [];
      if (le.industry) leParts.push('industrie: ' + le.industry);
      if (le.persona) leParts.push('persona: ' + le.persona);
      if (le.score) leParts.push('score: ' + le.score + '/10');
      if (leParts.length > 0) lines.push('ENRICHISSEMENT: ' + leParts.join(', '));
    }

    // Contact info
    if (contact.nom || contact.titre) {
      let contactLine = 'CONTACT: ' + (contact.nom || '');
      if (contact.titre) contactLine += ' (' + contact.titre + ')';
      lines.push(contactLine);
    }

    const brief = lines.join('\n');
    // Tronquer si trop long (garder ~800 chars max pour ne pas exploser le prompt)
    return brief.substring(0, 800);
  }
}

module.exports = ProspectResearcher;
