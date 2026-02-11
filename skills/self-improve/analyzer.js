// Self-Improve - Moteur d'analyse IA + feedback loop
const https = require('https');
const storage = require('./storage.js');

class Analyzer {
  constructor(claudeKey) {
    this.claudeKey = claudeKey;
  }

  callClaude(systemPrompt, userMessage, maxTokens) {
    maxTokens = maxTokens || 2000;
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      });
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
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (response.content && response.content[0]) {
              resolve(response.content[0].text.trim());
            } else {
              reject(new Error('Reponse Claude invalide: ' + JSON.stringify(response).substring(0, 200)));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout Claude')); });
      req.write(postData);
      req.end();
    });
  }

  // Analyser les performances de la semaine et generer des recommandations
  async analyzePerformance(snapshot, historicalSnapshots) {
    const systemPrompt = `Tu es un expert en optimisation de prospection B2B. On te donne les metriques d'une semaine d'un bot commercial.
Analyse les donnees et genere des recommandations concretes et actionnables.

REGLES :
- Maximum 5 recommandations, classees par impact estime
- Chaque recommandation doit etre SPECIFIQUE et MESURABLE
- Inclus l'impact attendu en pourcentage
- Score de confiance entre 0 et 1
- Types de recommandations possibles :
  * "scoring_weight" : modifier les poids du scoring IA des leads
  * "send_timing" : optimiser jour/heure d'envoi des emails
  * "email_length" : ajuster la longueur des emails
  * "targeting_criteria" : ajuster les criteres de ciblage (score minimum)
  * "industry_focus" : se concentrer sur certains secteurs
- Si les donnees sont insuffisantes (< 10 emails), dis-le honnetement

Reponds UNIQUEMENT en JSON strict :
{
  "summary": "Resume en 2-3 phrases",
  "insights": ["insight 1", "insight 2"],
  "recommendations": [
    {
      "type": "scoring_weight|send_timing|email_length|targeting_criteria|industry_focus",
      "description": "Description claire en francais",
      "action": "nom_action",
      "params": {},
      "expectedImpact": "+X% description",
      "confidence": 0.8
    }
  ],
  "dataQuality": "good|limited|insufficient"
}`;

    const historyContext = historicalSnapshots.length > 0
      ? '\n\nHISTORIQUE DES SEMAINES PRECEDENTES :\n' + JSON.stringify(historicalSnapshots.slice(0, 4), null, 2)
      : '';

    const currentOverrides = storage.getScoringWeights();
    const overrideContext = currentOverrides
      ? '\n\nOVERRIDES ACTUELS (deja appliques) :\n' + JSON.stringify(currentOverrides)
      : '';

    const userMessage = 'METRIQUES DE CETTE SEMAINE :\n' +
      JSON.stringify(snapshot, null, 2) +
      historyContext +
      overrideContext;

    try {
      const response = await this.callClaude(systemPrompt, userMessage, 2000);
      const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const analysis = JSON.parse(cleaned);

      if (!analysis.recommendations) analysis.recommendations = [];
      if (!analysis.summary) analysis.summary = 'Analyse terminee';

      // Ajouter des IDs aux recommandations
      analysis.recommendations = analysis.recommendations.map(r => ({
        ...r,
        id: storage._generateId()
      }));

      return analysis;
    } catch (error) {
      console.error('[analyzer] Erreur analyse Claude:', error.message);
      return this._fallbackAnalysis(snapshot);
    }
  }

  // Analyse fallback si Claude echoue
  _fallbackAnalysis(snapshot) {
    const recommendations = [];
    const insights = [];

    if (snapshot.email && snapshot.email.available) {
      const email = snapshot.email;

      // Detecter le meilleur jour
      if (email.byDayOfWeek) {
        let bestDay = null;
        let bestRate = 0;
        for (const [day, data] of Object.entries(email.byDayOfWeek)) {
          if (data.sent >= 3) {
            const rate = data.opened / data.sent;
            if (rate > bestRate) { bestRate = rate; bestDay = day; }
          }
        }
        if (bestDay && bestRate > 0) {
          insights.push('Meilleur jour d\'envoi : ' + bestDay + ' (' + Math.round(bestRate * 100) + '% ouverture)');
          if (bestRate > 0.3) {
            recommendations.push({
              id: storage._generateId(),
              type: 'send_timing',
              description: 'Privilegier les envois le ' + bestDay + ' pour un meilleur taux d\'ouverture',
              action: 'set_preferred_day',
              params: { day: bestDay },
              expectedImpact: '+' + Math.round(bestRate * 100 - (email.openRate || 0)) + '% ouvertures estimees',
              confidence: 0.6
            });
          }
        }
      }

      // Detecter la meilleure heure
      if (email.byHourOfDay) {
        let bestHour = null;
        let bestRate = 0;
        for (const [hour, data] of Object.entries(email.byHourOfDay)) {
          if (data.sent >= 2) {
            const rate = data.opened / data.sent;
            if (rate > bestRate) { bestRate = rate; bestHour = hour; }
          }
        }
        if (bestHour) {
          insights.push('Meilleure heure d\'envoi : ' + bestHour + 'h (' + Math.round(bestRate * 100) + '% ouverture)');
          if (bestRate > 0.3) {
            recommendations.push({
              id: storage._generateId(),
              type: 'send_timing',
              description: 'Envoyer les emails vers ' + bestHour + 'h pour maximiser les ouvertures',
              action: 'set_preferred_hour',
              params: { hour: parseInt(bestHour) },
              expectedImpact: '+' + Math.round(bestRate * 100 - (email.openRate || 0)) + '% ouvertures estimees',
              confidence: 0.55
            });
          }
        }
      }

      // Longueur email
      if (email.byBodyLength) {
        const short = email.byBodyLength.short || { sent: 0, opened: 0 };
        const long = email.byBodyLength.long || { sent: 0, opened: 0 };
        if (short.sent >= 3 && long.sent >= 3) {
          const shortRate = short.opened / short.sent;
          const longRate = long.opened / long.sent;
          if (shortRate > longRate + 0.1) {
            insights.push('Emails courts : ' + Math.round(shortRate * 100) + '% ouverture vs ' + Math.round(longRate * 100) + '% pour les longs');
            recommendations.push({
              id: storage._generateId(),
              type: 'email_length',
              description: 'Reduire la longueur des emails (les courts performent mieux)',
              action: 'set_max_length',
              params: { maxLength: 200 },
              expectedImpact: '+' + Math.round((shortRate - longRate) * 100) + '% ouvertures estimees',
              confidence: 0.65
            });
          }
        }
      }
    }

    // Cross-metrics
    if (snapshot.cross && snapshot.cross.available && snapshot.cross.byScoreRange) {
      const ranges = snapshot.cross.byScoreRange;
      const high = ranges['8-10'] || { sent: 0, opened: 0 };
      const low = ranges['0-5'] || { sent: 0, opened: 0 };
      if (high.sent >= 2 && low.sent >= 2) {
        const highRate = high.opened / high.sent;
        const lowRate = low.opened / low.sent;
        if (highRate > lowRate + 0.15) {
          insights.push('Leads score 8+ : ' + Math.round(highRate * 100) + '% ouverture vs ' + Math.round(lowRate * 100) + '% pour score < 6');
          recommendations.push({
            id: storage._generateId(),
            type: 'targeting_criteria',
            description: 'Augmenter le score minimum de ciblage a 6 pour envoyer aux leads les plus qualifies',
            action: 'set_min_score',
            params: { minScore: 6 },
            expectedImpact: '+' + Math.round((highRate - lowRate) * 100) + '% qualite des envois',
            confidence: 0.6
          });
        }
      }
    }

    return {
      summary: 'Analyse automatique basee sur les donnees brutes (Claude indisponible).',
      insights: insights.length > 0 ? insights : ['Donnees insuffisantes pour des insights significatifs'],
      recommendations: recommendations,
      dataQuality: recommendations.length > 0 ? 'limited' : 'insufficient'
    };
  }

  // Boucle de feedback : comparer predictions vs resultats
  comparePredictions() {
    const unverified = storage.getUnverifiedPredictions();
    if (unverified.length === 0) return null;

    const automailerStorage = getAutomailerStorageSafe();
    if (!automailerStorage) return null;

    const emails = automailerStorage.data.emails || [];
    let verified = 0;
    let correct = 0;

    for (const pred of unverified) {
      // Verifier si l'email a ete ouvert (7 jours apres envoi)
      const predDate = new Date(pred.createdAt);
      const daysSince = (Date.now() - predDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) continue; // Pas assez de temps

      const email = emails.find(e => e.to && e.to.toLowerCase() === pred.email.toLowerCase());
      if (!email) continue;

      const wasOpened = !!email.openedAt;
      const predicted = pred.predictedOpen;
      const isCorrect = wasOpened === predicted;

      storage.verifyPrediction(pred.email, isCorrect);
      verified++;
      if (isCorrect) correct++;
    }

    if (verified === 0) return null;

    const accuracy = Math.round((correct / verified) * 100);
    const record = {
      accuracy: accuracy,
      verified: verified,
      correct: correct,
      weekDate: new Date().toISOString().split('T')[0]
    };

    storage.saveAccuracyRecord(record);
    console.log('[analyzer] Feedback loop: ' + accuracy + '% accuracy (' + correct + '/' + verified + ')');

    return record;
  }

  // Generer le rapport texte pour Telegram (format lisible avec emojis)
  generateReport(snapshot, analysis, accuracyRecord) {
    const lines = [];
    const date = snapshot.date || new Date().toISOString().split('T')[0];
    lines.push('📊 *Self-Improve — Semaine du ' + date + '*');
    lines.push('');

    // Emails
    if (snapshot.email && snapshot.email.available && snapshot.email.totalSent > 0) {
      lines.push('📧 *EMAILS*');
      lines.push('   ' + snapshot.email.totalSent + ' envoyes | ' + snapshot.email.openRate + '% ouverts | ' + snapshot.email.bounceRate + '% bounced');

      // Meilleur jour
      if (snapshot.email.byDayOfWeek) {
        let bestDay = null;
        let bestRate = 0;
        for (const [day, data] of Object.entries(snapshot.email.byDayOfWeek)) {
          if (data.sent >= 2) {
            const rate = data.opened / data.sent;
            if (rate > bestRate) { bestRate = rate; bestDay = day; }
          }
        }
        if (bestDay) lines.push('   ⏰ Meilleur jour : ' + bestDay + ' (' + Math.round(bestRate * 100) + '% ouverture)');
      }

      // Meilleure heure
      if (snapshot.email.byHourOfDay) {
        let bestHour = null;
        let bestRate = 0;
        for (const [hour, data] of Object.entries(snapshot.email.byHourOfDay)) {
          if (data.sent >= 2) {
            const rate = data.opened / data.sent;
            if (rate > bestRate) { bestRate = rate; bestHour = hour; }
          }
        }
        if (bestHour) lines.push('   ⏰ Meilleure heure : ' + bestHour + 'h (' + Math.round(bestRate * 100) + '% ouverture)');
      }

      // Longueur
      if (snapshot.email.byBodyLength) {
        const short = snapshot.email.byBodyLength.short || { sent: 0, opened: 0 };
        const long = snapshot.email.byBodyLength.long || { sent: 0, opened: 0 };
        if (short.sent > 0 && long.sent > 0) {
          const shortRate = Math.round((short.opened / short.sent) * 100);
          const longRate = Math.round((long.opened / long.sent) * 100);
          lines.push('   📏 Courts : ' + shortRate + '% ouverture vs longs : ' + longRate + '%');
        }
      }
      lines.push('');
    } else {
      lines.push('📧 Pas d\'envoi cette semaine');
      lines.push('');
    }

    // Detailed insights
    if (snapshot.detailedInsights && snapshot.detailedInsights.available) {
      const di = snapshot.detailedInsights;

      // Meilleur secteur
      if (di.byIndustry && Object.keys(di.byIndustry).length > 0) {
        let bestIndustry = null;
        let bestRate = 0;
        for (const [ind, data] of Object.entries(di.byIndustry)) {
          if (data.sent >= 2 && data.openRate > bestRate) {
            bestRate = data.openRate;
            bestIndustry = ind;
          }
        }
        if (bestIndustry) lines.push('🏆 Meilleur secteur : ' + bestIndustry + ' (' + bestRate + '% ouverture)');
      }

      // Meilleur niveau de titre
      if (di.byTitleLevel && Object.keys(di.byTitleLevel).length > 0) {
        let bestTitle = null;
        let bestRate = 0;
        for (const [title, data] of Object.entries(di.byTitleLevel)) {
          if (data.sent >= 2 && data.openRate > bestRate) {
            bestRate = data.openRate;
            bestTitle = title;
          }
        }
        if (bestTitle) lines.push('👤 Meilleur profil : ' + bestTitle + ' (' + bestRate + '% ouverture)');
      }

      // Delai moyen
      if (di.avgResponseDelayHours !== null) {
        lines.push('⚡ Delai moyen d\'ouverture : ' + di.avgResponseDelayHours + 'h');
      }

      lines.push('');
    }

    // Leads
    if (snapshot.leads && snapshot.leads.available) {
      lines.push('🎯 *LEADS*');
      lines.push('   ' + snapshot.leads.totalLeads + ' enrichis | Score moyen : ' + snapshot.leads.avgScore + '/10');
      if (snapshot.leads.recentLeads > 0) {
        lines.push('   ' + snapshot.leads.recentLeads + ' nouveaux cette semaine');
      }
      const bs = snapshot.leads.byScore || {};
      lines.push('   Score 8+ : ' + (bs.high || 0) + ' | 6-7 : ' + (bs.medium || 0) + ' | <6 : ' + (bs.low || 0));
      lines.push('');
    }

    // Accuracy
    if (accuracyRecord) {
      lines.push('🎯 *SCORING*');
      lines.push('   Precision : ' + accuracyRecord.accuracy + '% (' + accuracyRecord.correct + '/' + accuracyRecord.verified + ' predictions correctes)');
      lines.push('');
    }

    // Analyse
    if (analysis && analysis.summary) {
      lines.push('🧠 *ANALYSE*');
      lines.push('   ' + analysis.summary);
      lines.push('');
    }

    // Recommandations
    if (analysis && analysis.recommendations && analysis.recommendations.length > 0) {
      lines.push('💡 *RECOMMANDATIONS*');
      analysis.recommendations.forEach((r, i) => {
        lines.push((i + 1) + '. ' + r.description);
        if (r.expectedImpact) lines.push('   → ' + r.expectedImpact);
      });
      lines.push('');
      lines.push('🔧 _"applique"_ = tout valider | _"applique 1"_ = une seule | _"ignore 2"_ = rejeter');
    } else {
      lines.push('✅ Pas de recommandation (donnees insuffisantes ou tout va bien)');
    }

    return lines.join('\n');
  }
}

// Helper cross-skill
function getAutomailerStorageSafe() {
  try { return require('../automailer/storage.js'); }
  catch (e) {
    try { return require('/app/skills/automailer/storage.js'); }
    catch (e2) { return null; }
  }
}

module.exports = Analyzer;
