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

class ProspectResearcher {
  constructor(options) {
    this.claudeKey = options.claudeKey;
    this._fetcher = null;
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
    const [websiteResult, newsResult, apolloData, webIntelArticles] = await Promise.allSettled([
      this._scrapeCompanyWebsite(domain),
      this._fetchCompanyNews(company),
      Promise.resolve(this._extractApolloOrgData(contact.organization)),
      Promise.resolve(this._checkExistingWebIntelArticles(company))
    ]);

    const intel = {
      company: company,
      websiteInsights: websiteResult.status === 'fulfilled' ? websiteResult.value : null,
      recentNews: newsResult.status === 'fulfilled' ? newsResult.value : [],
      apolloData: apolloData.status === 'fulfilled' ? apolloData.value : null,
      existingArticles: webIntelArticles.status === 'fulfilled' ? webIntelArticles.value : [],
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
      intel.existingArticles.length > 0 ? intel.existingArticles.length + ' articles WI' : null
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
   * Compile toutes les donnees en un brief textuel structure.
   * Max ~500 chars, pret a injecter dans le prompt de generation d'email.
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
    // Tronquer si trop long (garder ~600 chars max pour ne pas exploser le prompt)
    return brief.substring(0, 600);
  }
}

module.exports = ProspectResearcher;
