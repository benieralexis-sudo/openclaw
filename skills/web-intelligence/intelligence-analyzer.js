// Web Intelligence - Analyse IA des articles via Claude Sonnet 4.5
const https = require('https');
const { retryAsync } = require('../../gateway/utils.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const log = require('../../gateway/logger.js');

class IntelligenceAnalyzer {
  constructor(claudeKey) {
    this.claudeKey = claudeKey;
  }

  callClaude(messages, systemPrompt, maxTokens) {
    maxTokens = maxTokens || 1500;
    return new Promise((resolve, reject) => {
      const body = {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: maxTokens,
        messages: messages
      };
      if (systemPrompt) body.system = systemPrompt;

      const postData = JSON.stringify(body);
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.claudeKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.content && response.content[0]) {
              resolve(response.content[0].text);
            } else if (response.error) {
              reject(new Error('Claude API: ' + (response.error.message || JSON.stringify(response.error))));
            } else {
              reject(new Error('Reponse Claude invalide'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(45000, () => { req.destroy(); reject(new Error('Timeout Claude API')); });
      req.write(postData);
      req.end();
    });
  }

  // --- Analyse d'articles ---

  async analyzeArticles(articles, watch) {
    if (!articles || articles.length === 0) return [];
    if (!this.claudeKey) return this._fallbackAnalysis(articles, watch);

    // Limiter a 15 articles par appel pour eviter de depasser les tokens
    const batch = articles.slice(0, 15);
    const articlesList = batch.map((a, i) => {
      return (i + 1) + '. TITRE: ' + a.title + '\n   SOURCE: ' + (a.source || 'Inconnu') + '\n   EXTRAIT: ' + (a.snippet || '').substring(0, 150);
    }).join('\n\n');

    const systemPrompt = `Tu es un analyste de veille strategique B2B. On te donne des articles collectes pour une veille.

VEILLE: "${watch.name}" (type: ${watch.type})
MOTS-CLES: ${watch.keywords.join(', ')}

Pour CHAQUE article, attribue :
- relevanceScore (0-10) : pertinence par rapport a la veille
- summary : resume en 1 phrase en francais
- isUrgent : true si c'est une info critique (acquisition, levee de fonds, faillite, nouveau produit majeur, changement de direction)
- matchedKeywords : quels mots-cles de la veille correspondent

Reponds UNIQUEMENT en JSON valide, sans markdown :
[{"index":1,"relevanceScore":7,"summary":"...","isUrgent":false,"matchedKeywords":["mot"]}]`;

    try {
      const breaker = getBreaker('claude-sonnet', { failureThreshold: 3, cooldownMs: 60000 });
      const response = await breaker.call(() => retryAsync(() => this.callClaude(
        [{ role: 'user', content: 'Articles a analyser :\n\n' + articlesList }],
        systemPrompt,
        2000
      ), 2, 3000));

      const cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const results = JSON.parse(cleaned);

      if (!Array.isArray(results)) throw new Error('Format invalide');

      // Enrichir les articles avec les resultats
      for (const r of results) {
        const idx = (r.index || 1) - 1;
        if (idx >= 0 && idx < batch.length) {
          batch[idx].relevanceScore = r.relevanceScore || 5;
          batch[idx].summary = r.summary || batch[idx].snippet;
          batch[idx].isUrgent = r.isUrgent || false;
          batch[idx].matchedKeywords = r.matchedKeywords || [];
        }
      }

      // Articles non analyses dans le batch : fallback
      for (const a of batch) {
        if (!a.summary) a.summary = a.snippet;
        if (a.relevanceScore === undefined) a.relevanceScore = 5;
      }

      return batch;
    } catch (e) {
      log.error('web-intel', 'Erreur analyse Claude, fallback:', e.message);
      return this._fallbackAnalysis(batch, watch);
    }
  }

  _fallbackAnalysis(articles, watch) {
    const keywordsLower = (watch.keywords || []).map(k => k.toLowerCase());
    return articles.map(a => {
      const textLower = ((a.title || '') + ' ' + (a.snippet || '')).toLowerCase();
      const matched = keywordsLower.filter(k => textLower.includes(k));
      a.relevanceScore = Math.min(10, 3 + matched.length * 2);
      a.summary = a.snippet || a.title;
      a.isUrgent = false;
      a.matchedKeywords = matched;
      return a;
    });
  }

  // --- Cross-reference CRM ---

  crossReferenceWithCRM(articles, contacts, deals) {
    if (!articles || articles.length === 0) return articles;

    const contactNames = (contacts || []).map(c => ({
      id: c.id || c.hs_object_id,
      name: ((c.firstname || '') + ' ' + (c.lastname || '')).trim().toLowerCase(),
      company: (c.company || '').toLowerCase()
    })).filter(c => c.name.length > 2 || c.company.length > 2);

    const dealNames = (deals || []).map(d => ({
      id: d.id || d.hs_object_id,
      name: (d.dealname || '').toLowerCase()
    })).filter(d => d.name.length > 2);

    for (const article of articles) {
      const textLower = ((article.title || '') + ' ' + (article.snippet || '')).toLowerCase();

      // Chercher des contacts
      for (const c of contactNames) {
        if ((c.name.length > 4 && textLower.includes(c.name)) ||
            (c.company.length > 3 && textLower.includes(c.company))) {
          article.crmMatch = {
            type: 'contact',
            contactId: c.id,
            contactName: c.name,
            company: c.company
          };
          article.relevanceScore = Math.min(10, (article.relevanceScore || 5) + 2);
          break;
        }
      }

      // Chercher des deals
      if (!article.crmMatch) {
        for (const d of dealNames) {
          if (d.name.length > 4 && textLower.includes(d.name)) {
            article.crmMatch = {
              type: 'deal',
              dealId: d.id,
              dealName: d.name
            };
            article.relevanceScore = Math.min(10, (article.relevanceScore || 5) + 2);
            break;
          }
        }
      }
    }

    return articles;
  }

  // --- Digests et rapports ---

  async generateDigest(articles, watchName, watchType) {
    if (!articles || articles.length === 0) {
      return 'Aucun nouvel article pour la veille *' + watchName + '*.';
    }

    if (!this.claudeKey) return this._fallbackDigest(articles, watchName);

    const articlesList = articles.slice(0, 10).map((a, i) => {
      return (i + 1) + '. ' + a.title + ' (score: ' + (a.relevanceScore || '?') + '/10)\n   ' + (a.summary || a.snippet || '');
    }).join('\n');

    const systemPrompt = `Tu es un assistant de veille strategique pour un entrepreneur B2B francais.
Genere un resume concis et actionnable des articles ci-dessous.

REGLES :
- Ecris en francais, ton professionnel mais accessible
- Identifie les tendances cles, opportunites et menaces
- Mets en avant les infos les plus pertinentes
- Format Telegram Markdown : *gras*, _italique_
- Maximum 15 lignes
- Commence par un titre avec emoji adapte au type de veille
- Termine par 1-2 recommandations concretes`;

    try {
      const breaker = getBreaker('claude-sonnet', { failureThreshold: 3, cooldownMs: 60000 });
      const response = await breaker.call(() => retryAsync(() => this.callClaude(
        [{ role: 'user', content: 'Veille "' + watchName + '" (type: ' + watchType + ')\n\nArticles :\n' + articlesList }],
        systemPrompt,
        1500
      ), 2, 3000));
      return response;
    } catch (e) {
      log.error('web-intel', 'Erreur digest Claude:', e.message);
      return this._fallbackDigest(articles, watchName);
    }
  }

  _fallbackDigest(articles, watchName) {
    const lines = ['*Veille ' + watchName + '* — ' + articles.length + ' article(s)', ''];
    const top = articles
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, 5);
    for (const a of top) {
      const score = a.relevanceScore ? ' (' + a.relevanceScore + '/10)' : '';
      lines.push('- *' + a.title + '*' + score);
      if (a.summary) lines.push('  ' + a.summary.substring(0, 100));
    }
    if (articles.length > 5) {
      lines.push('');
      lines.push('_+ ' + (articles.length - 5) + ' autre(s) article(s)_');
    }
    return lines.join('\n');
  }

  async generateWeeklyReport(articlesByWatch, stats) {
    if (!this.claudeKey) return this._fallbackWeeklyReport(articlesByWatch, stats);

    let watchSummaries = '';
    for (const watchName of Object.keys(articlesByWatch)) {
      const articles = articlesByWatch[watchName];
      const topArticles = articles
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, 5)
        .map(a => '- ' + a.title + ' (score: ' + (a.relevanceScore || '?') + ')')
        .join('\n');
      watchSummaries += '\nVEILLE "' + watchName + '" (' + articles.length + ' articles) :\n' + topArticles + '\n';
    }

    const systemPrompt = `Tu es un analyste de veille strategique B2B.
Genere un rapport hebdomadaire synthetique.

REGLES :
- Ecris en francais, ton professionnel et concis
- Identifie les grandes tendances de la semaine
- Croise les informations entre les differentes veilles
- Mets en avant les opportunites business
- Format Telegram Markdown
- Maximum 20 lignes
- Commence par un titre avec un emoji calendrier`;

    try {
      const breaker = getBreaker('claude-sonnet', { failureThreshold: 3, cooldownMs: 60000 });
      const response = await breaker.call(() => retryAsync(() => this.callClaude(
        [{ role: 'user', content: 'Stats semaine : ' + (stats.totalArticlesFetched || 0) + ' articles collectes\n\n' + watchSummaries }],
        systemPrompt,
        2000
      ), 2, 3000));
      return response;
    } catch (e) {
      log.error('web-intel', 'Erreur rapport hebdo:', e.message);
      return this._fallbackWeeklyReport(articlesByWatch, stats);
    }
  }

  _fallbackWeeklyReport(articlesByWatch, stats) {
    const lines = ['*Rapport hebdo Web Intelligence*', ''];
    const watchNames = Object.keys(articlesByWatch);
    lines.push('Veilles actives : ' + watchNames.length);
    lines.push('Articles collectes : ' + (stats.totalArticlesFetched || 0));
    lines.push('');
    for (const name of watchNames) {
      const count = articlesByWatch[name].length;
      lines.push('- *' + name + '* : ' + count + ' article(s)');
    }
    return lines.join('\n');
  }

  // --- 8b. Competitive Intelligence Digest ---

  async generateCompetitiveDigest(competitorArticles, watchNames) {
    if (!competitorArticles || competitorArticles.length === 0) {
      return { text: 'Aucune news concurrente cette semaine.', articles: 0, opportunities: [], threats: [] };
    }

    if (!this.claudeKey) return this._fallbackCompetitiveDigest(competitorArticles, watchNames);

    const articlesList = competitorArticles.slice(0, 15).map((a, i) => {
      const watch = watchNames[a.watchId] || 'Inconnu';
      return (i + 1) + '. [' + watch + '] ' + a.title + '\n   ' + (a.summary || a.snippet || '').substring(0, 150);
    }).join('\n\n');

    const systemPrompt = `Tu es un analyste de veille concurrentielle pour une agence de prospection B2B.

REGLES :
- Analyse les articles sur les concurrents et genere un digest actionnable
- Identifie clairement : mouvements concurrents, opportunites business, menaces
- Reponds en JSON valide UNIQUEMENT, sans markdown :
{
  "text": "Resume en francais (max 15 lignes, markdown Telegram *gras* _italique_)",
  "opportunities": ["opportunite 1", "opportunite 2"],
  "threats": ["menace 1"],
  "keyMoves": ["mouvement 1", "mouvement 2"]
}`;

    try {
      const breaker = getBreaker('claude-sonnet', { failureThreshold: 3, cooldownMs: 60000 });
      const response = await breaker.call(() => retryAsync(() => this.callClaude(
        [{ role: 'user', content: 'Articles concurrents des 7 derniers jours :\n\n' + articlesList }],
        systemPrompt,
        2000
      ), 2, 3000));

      const cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      result.articles = competitorArticles.length;
      return result;
    } catch (e) {
      log.error('web-intel', 'Erreur competitive digest Claude:', e.message);
      return this._fallbackCompetitiveDigest(competitorArticles, watchNames);
    }
  }

  _fallbackCompetitiveDigest(articles, watchNames) {
    const text = '*Veille concurrentielle* — ' + articles.length + ' article(s)\n\n' +
      articles.slice(0, 5).map(a => {
        const watch = watchNames[a.watchId] || '';
        return '- *' + a.title + '*' + (watch ? ' (' + watch + ')' : '') + '\n  ' + (a.summary || a.snippet || '').substring(0, 100);
      }).join('\n');
    return { text, articles: articles.length, opportunities: [], threats: [], keyMoves: [] };
  }

  // --- 8c. Trend Detection ---

  detectTrends(articles) {
    if (!articles || articles.length === 0) {
      return { rising: [], falling: [], stable: [] };
    }

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const fifteenDaysAgo = now - 15 * 24 * 60 * 60 * 1000;

    // Filtrer les articles des 30 derniers jours
    const recentArticles = articles.filter(a => {
      const t = a.fetchedAt ? new Date(a.fetchedAt).getTime() : (a.pubDate ? new Date(a.pubDate).getTime() : 0);
      return t > thirtyDaysAgo;
    });

    if (recentArticles.length < 3) {
      return { rising: [], falling: [], stable: [] };
    }

    // Extraire les mots-cles significatifs de chaque article
    const stopWords = new Set([
      'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'en', 'est', 'a', 'au', 'aux',
      'pour', 'par', 'sur', 'dans', 'avec', 'son', 'ses', 'ce', 'cette', 'qui', 'que', 'ne',
      'pas', 'plus', 'se', 'sa', 'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'ou', 'mais',
      'the', 'of', 'and', 'to', 'in', 'is', 'for', 'on', 'with', 'at', 'by', 'from', 'an',
      'has', 'its', 'was', 'are', 'been', 'will', 'can', 'all', 'new', 'more', 'also', 'their',
      'this', 'that', 'how', 'what', 'which', 'when', 'where', 'who', 'why', 'not', 'been',
      'comme', 'avoir', 'etre', 'faire', 'dit', 'selon', 'entre', 'apres', 'avant', 'aussi',
      'peut', 'tout', 'tous', 'bien', 'tres', 'dont', 'deja', 'encore', 'cet', 'ces', 'autre'
    ]);

    function extractKeywords(text) {
      if (!text) return [];
      return text
        .toLowerCase()
        .replace(/[^a-z0-9\u00C0-\u024Fà-ÿ\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !stopWords.has(w));
    }

    // Compter les mots-cles par periode (premiere moitie vs deuxieme moitie du mois)
    const firstHalf = {}; // 30j a 15j
    const secondHalf = {}; // 15j a maintenant
    let firstHalfCount = 0;
    let secondHalfCount = 0;

    for (const article of recentArticles) {
      const t = article.fetchedAt ? new Date(article.fetchedAt).getTime() : (article.pubDate ? new Date(article.pubDate).getTime() : 0);
      const text = (article.title || '') + ' ' + (article.snippet || '') + ' ' + (article.summary || '');
      const keywords = extractKeywords(text);
      const uniqueKw = [...new Set(keywords)];

      if (t < fifteenDaysAgo) {
        firstHalfCount++;
        for (const kw of uniqueKw) firstHalf[kw] = (firstHalf[kw] || 0) + 1;
      } else {
        secondHalfCount++;
        for (const kw of uniqueKw) secondHalf[kw] = (secondHalf[kw] || 0) + 1;
      }
    }

    // Normaliser les frequences
    const allKeywords = new Set([...Object.keys(firstHalf), ...Object.keys(secondHalf)]);
    const trends = { rising: [], falling: [], stable: [] };

    for (const kw of allKeywords) {
      const fFreq = firstHalfCount > 0 ? (firstHalf[kw] || 0) / firstHalfCount : 0;
      const sFreq = secondHalfCount > 0 ? (secondHalf[kw] || 0) / secondHalfCount : 0;
      const totalMentions = (firstHalf[kw] || 0) + (secondHalf[kw] || 0);

      // Ignorer les mots-cles rares (moins de 2 mentions au total)
      if (totalMentions < 2) continue;

      const change = fFreq > 0 ? (sFreq - fFreq) / fFreq : (sFreq > 0 ? 1 : 0);

      if (change > 0.3) {
        trends.rising.push({ keyword: kw, change: Math.round(change * 100), mentions: totalMentions, recentMentions: secondHalf[kw] || 0 });
      } else if (change < -0.3) {
        trends.falling.push({ keyword: kw, change: Math.round(change * 100), mentions: totalMentions, recentMentions: secondHalf[kw] || 0 });
      } else {
        trends.stable.push({ keyword: kw, mentions: totalMentions });
      }
    }

    // Trier par intensite du changement
    trends.rising.sort((a, b) => b.change - a.change);
    trends.falling.sort((a, b) => a.change - b.change);
    trends.stable.sort((a, b) => b.mentions - a.mentions);

    // Limiter les resultats
    trends.rising = trends.rising.slice(0, 10);
    trends.falling = trends.falling.slice(0, 10);
    trends.stable = trends.stable.slice(0, 10);

    return trends;
  }

  // --- Detection d'urgence ---

  detectUrgency(article) {
    if (!article) return false;

    const urgentKeywords = [
      'acquisition', 'acquiert', 'rachete', 'rachat',
      'levee de fonds', 'levée de fonds', 'leve des fonds', 'serie a', 'serie b', 'serie c',
      'faillite', 'liquidation', 'redressement judiciaire',
      'licenciement', 'plan social', 'restructuration',
      'partenariat strategique', 'partenariat stratégique',
      'lancement', 'nouveau produit', 'nouvelle offre',
      'changement de direction', 'nouveau ceo', 'nouveau pdg', 'nomme',
      'introduction en bourse', 'ipo',
      'fusion', 'merge'
    ];

    const textLower = ((article.title || '') + ' ' + (article.snippet || '')).toLowerCase();

    for (const kw of urgentKeywords) {
      if (textLower.includes(kw)) {
        return true;
      }
    }

    // Score tres eleve = potentiellement urgent
    if (article.relevanceScore >= 9) return true;

    return false;
  }
}

module.exports = IntelligenceAnalyzer;
