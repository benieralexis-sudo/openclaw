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

    const intel = {
      company: company,
      websiteInsights: websiteResult.status === 'fulfilled' ? websiteResult.value : null,
      recentNews: newsResult.status === 'fulfilled' ? newsResult.value : [],
      apolloData: apolloData.status === 'fulfilled' ? apolloData.value : null,
      existingArticles: rawArticles,
      linkedinData: linkedinResult.status === 'fulfilled' ? linkedinResult.value : null,
      leadEnrichData: leadEnrichData,
      marketSignals: marketSignals,
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
      // 1. Homepage
      const result = await fetcher.scrapeWebPage('https://' + domain);
      if (!result) return null;

      const insights = {
        title: (result.title || '').substring(0, 200),
        description: (result.description || '').substring(0, 300),
        textContent: ''
      };

      // 2. Pages internes cibles (parallele, timeout 5s) — clients, about, services
      const targetPaths = ['/clients', '/nos-clients', '/references', '/nos-references', '/about', '/a-propos', '/qui-sommes-nous', '/services', '/nos-services'];
      const internalResults = await Promise.allSettled(
        targetPaths.slice(0, 4).map(p =>
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
      insights.textContent = texts.join('\n').substring(0, 2500);
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
    if (meta.length > 0) companyLine += ' (' + meta.join(', ') + ')';
    lines.push(companyLine);

    if (contact.nom || contact.titre) {
      let contactLine = 'CONTACT: ' + (contact.nom || '');
      if (contact.titre) contactLine += ' — ' + contact.titre;
      lines.push(contactLine);
    }

    // PRIORITE 1 : News recentes — meilleure source d'observations specifiques et temporelles
    if (intel.recentNews.length > 0) {
      lines.push('NEWS RECENTES (pour observations specifiques):');
      for (const news of intel.recentNews.slice(0, 4)) {
        const dateStr = news.pubDate ? ' (' + new Date(news.pubDate).toLocaleDateString('fr-FR') + ')' : '';
        let newsLine = '- "' + news.title + '"' + dateStr;
        if (news.snippet) newsLine += ' → ' + news.snippet.substring(0, 100);
        lines.push(newsLine);
      }
    }

    // PRIORITE 1b : Signaux marche (funding, hiring, expansion, acquisition)
    if (intel.marketSignals && intel.marketSignals.length > 0) {
      lines.push('SIGNAUX MARCHE:');
      for (const s of intel.marketSignals.slice(0, 2)) {
        lines.push('- [' + (s.type || '?').toUpperCase() + '] ' + (s.article && s.article.title || '').substring(0, 80) + (s.suggestedAction ? ' → ' + s.suggestedAction.substring(0, 60) : ''));
      }
    }

    // PRIORITE 2 : LinkedIn — angle personnel sur le decideur
    if (intel.linkedinData) {
      let liLine = 'LINKEDIN ' + (contact.nom || '') + ': ';
      if (intel.linkedinData.headline) liLine += intel.linkedinData.headline;
      if (intel.linkedinData.summary) liLine += ' — ' + intel.linkedinData.summary.substring(0, 350);
      lines.push(liLine);
    }

    // PRIORITE 3 : Technologies — faits verifiables pour observations techniques
    if (intel.apolloData && intel.apolloData.technologies && intel.apolloData.technologies.length > 0) {
      lines.push('STACK TECHNIQUE: ' + intel.apolloData.technologies.slice(0, 10).join(', '));
    }

    // PRIORITE 3b : Keywords Apollo — services/produits proposes
    if (intel.apolloData && intel.apolloData.keywords && intel.apolloData.keywords.length > 0) {
      lines.push('MOTS-CLES: ' + intel.apolloData.keywords.slice(0, 10).join(', '));
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

    const brief = lines.join('\n');
    return brief.substring(0, 5500);
  }
}

module.exports = ProspectResearcher;
