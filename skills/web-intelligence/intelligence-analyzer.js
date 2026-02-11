// Web Intelligence - Analyse IA des articles via Claude Sonnet 4.5
const https = require('https');

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
      const response = await this.callClaude(
        [{ role: 'user', content: 'Articles a analyser :\n\n' + articlesList }],
        systemPrompt,
        2000
      );

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
      console.log('[intelligence-analyzer] Erreur analyse Claude, fallback:', e.message);
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
      const response = await this.callClaude(
        [{ role: 'user', content: 'Veille "' + watchName + '" (type: ' + watchType + ')\n\nArticles :\n' + articlesList }],
        systemPrompt,
        1500
      );
      return response;
    } catch (e) {
      console.log('[intelligence-analyzer] Erreur digest Claude:', e.message);
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
      const response = await this.callClaude(
        [{ role: 'user', content: 'Stats semaine : ' + (stats.totalArticlesFetched || 0) + ' articles collectes\n\n' + watchSummaries }],
        systemPrompt,
        2000
      );
      return response;
    } catch (e) {
      console.log('[intelligence-analyzer] Erreur rapport hebdo:', e.message);
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
