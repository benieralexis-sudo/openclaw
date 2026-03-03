// Self-Improve - Moteur d'analyse IA + feedback loop
const https = require('https');
const storage = require('./storage.js');
const { retryAsync } = require('../../gateway/utils.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const log = require('../../gateway/logger.js');

// Constantes impact tracking (extraites pour configurabilite)
const IMPACT_REPLY_WEIGHT = 2;            // reply rate compte double vs open rate
const IMPACT_THRESHOLD_SIGNIFICANT = 3;   // % delta requis si stat significatif (was 2)
const IMPACT_THRESHOLD_NOISY = 8;         // % delta requis si pas significatif (was 5)
const MIN_SAMPLE_FOR_IMPACT = 20;         // minimum emails pour mesurer impact (was 10)

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
    // Hard minimum : pas de recommandations si < 100 emails envoyes
    const totalEmails = snapshot && snapshot.email ? (snapshot.email.totalSent || 0) : 0;
    if (totalEmails < 100) {
      return {
        summary: 'Donnees insuffisantes (' + totalEmails + '/100 emails minimum). Accumulation en cours — pas de recommandation pour eviter les decisions sur du bruit statistique.',
        insights: ['Volume actuel: ' + totalEmails + ' emails. Minimum 100 requis pour des recommandations fiables.'],
        recommendations: [],
        dataQuality: 'insufficient'
      };
    }

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
  * "subject_style" : style de sujet (question vs affirmation, court vs long)
  * "follow_up_cadence" : ajuster le nombre et l'espacement des follow-ups
  * "niche_targeting" : pivoter vers les niches les plus performantes
  * "prospect_priority" : prioriser certains profils (titre, taille entreprise)
- Si les donnees sont insuffisantes (< 10 emails), dis-le honnetement

Reponds UNIQUEMENT en JSON strict :
{
  "summary": "Resume en 2-3 phrases",
  "insights": ["insight 1", "insight 2"],
  "recommendations": [
    {
      "type": "scoring_weight|send_timing|email_length|targeting_criteria|industry_focus|subject_style|follow_up_cadence|niche_targeting|prospect_priority",
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

    // Impact des recos precedentes
    const completedImpacts = storage.getCompletedImpactTracking(10);
    const impactContext = completedImpacts.length > 0
      ? '\n\nIMPACT DES RECOMMANDATIONS PRECEDENTES:\n' +
        JSON.stringify(completedImpacts.map(t => ({ type: t.recoType, description: t.recoDescription, verdict: t.verdict, delta: t.delta })), null, 2)
      : '';

    // Performance par type
    const typePerf = storage.getTypePerformance();
    const typePerfContext = Object.keys(typePerf).length > 0
      ? '\n\nPERFORMANCE PAR TYPE DE RECO:\n' + JSON.stringify(typePerf, null, 2) +
        '\nREGLE: Booste la confiance des types avec ratio improved/applied > 60%. Reduis pour < 30%.'
      : '';

    // Funnel complet
    const funnelSnapshots = storage.getFunnelSnapshots(2);
    const funnelContext = funnelSnapshots.length > 0
      ? '\n\nFUNNEL COMPLET:\n' + JSON.stringify(funnelSnapshots[0], null, 2)
      : '';

    // Brain insights
    const brainInsights = storage.getBrainInsights();
    const brainContext = brainInsights.lastCollectedAt
      ? '\n\nINSIGHTS BRAIN ENGINE:\nMeilleure niche: ' + JSON.stringify(brainInsights.bestNiche) +
        '\nPire niche: ' + JSON.stringify(brainInsights.worstNiche) +
        '\nPerformance niches: ' + JSON.stringify(brainInsights.nichePerformance)
      : '';

    // A/B tests
    const abInsights = storage.getABTestInsights();
    const abContext = abInsights.lastCollectedAt && abInsights.campaignResults && abInsights.campaignResults.length > 0
      ? '\n\nRESULTATS A/B TESTS:\n' + JSON.stringify(abInsights.summary) +
        '\nDetails: ' + JSON.stringify(abInsights.campaignResults.slice(0, 5), null, 2)
      : '';

    // Anomalies
    const anomalies = storage.getRecentAnomalies(5);
    const anomalyContext = anomalies.length > 0
      ? '\n\nANOMALIES RECENTES:\n' + anomalies.map(a => '- ' + a.type + ': ' + a.message).join('\n')
      : '';

    // Temporal patterns (meilleurs creneaux jour x heure)
    const temporalPatterns = storage.getTemporalPatterns();
    const temporalContext = temporalPatterns.lastAnalyzedAt && temporalPatterns.bestSlots && temporalPatterns.bestSlots.length > 0
      ? '\n\nPATTERNS TEMPORELS DECOUVERTS (jour x heure):\nMeilleurs creneaux: ' +
        temporalPatterns.bestSlots.slice(0, 3).map(s => s.dayName + ' ' + s.hour + 'h (' + s.openRate + '% open, ' + s.sent + ' emails)').join(', ') +
        (temporalPatterns.worstSlots && temporalPatterns.worstSlots.length > 0 ?
          '\nPires creneaux: ' + temporalPatterns.worstSlots.slice(0, 2).map(s => s.dayName + ' ' + s.hour + 'h (' + s.openRate + '% open)').join(', ') : '') +
        '\nREGLE: Utilise ces patterns pour generer des recommandations send_timing specifiques (jour + heure).'
      : '';

    // Cohort segmentation
    const cohortInsights = storage.getCohortInsights();
    const cohortContext = cohortInsights.lastAnalyzedAt && cohortInsights.topCohorts && cohortInsights.topCohorts.length > 0
      ? '\n\nSEGMENTATION PAR COHORT:\nTop cohorts: ' +
        cohortInsights.topCohorts.slice(0, 3).map(c => c.segment + ':' + c.name + ' (' + c.openRate + '% open, ' + c.replyRate + '% reply, n=' + c.sent + ')').join(', ') +
        (cohortInsights.bottomCohorts && cohortInsights.bottomCohorts.length > 0 ?
          '\nFlop cohorts: ' + cohortInsights.bottomCohorts.slice(0, 2).map(c => c.segment + ':' + c.name + ' (' + c.openRate + '% open, n=' + c.sent + ')').join(', ') : '') +
        '\nREGLE: Genere des recommandations niche_targeting et prospect_priority basees sur ces cohorts.'
      : '';

    const userMessage = 'METRIQUES DE CETTE SEMAINE :\n' +
      JSON.stringify(snapshot, null, 2) +
      historyContext +
      overrideContext +
      impactContext +
      typePerfContext +
      funnelContext +
      brainContext +
      abContext +
      anomalyContext +
      temporalContext +
      cohortContext;

    try {
      const breaker = getBreaker('claude-opus', { failureThreshold: 3, cooldownMs: 120000 });
      const response = await breaker.call(() => retryAsync(() => this.callClaude(systemPrompt, userMessage, 2000), 2, 3000));
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
      log.error('self-improve', 'Erreur analyse Claude:', error.message);
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
          if (data.sent >= 20) { // Seuil minimum pour significativite statistique
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
          if (data.sent >= 20) { // Seuil minimum pour significativite statistique
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
        if (short.sent >= 15 && long.sent >= 15) {
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

  // 4a. Analyse detaillee des performances email — genere des recommandations concretes
  analyzeEmailPerformance() {
    const automailerStorage = getAutomailerStorageSafe();
    if (!automailerStorage || !automailerStorage.data) {
      return { available: false, insights: [], recommendations: [] };
    }

    const emails = automailerStorage.data.emails || [];
    const sentEmails = emails.filter(e => e.sentAt && e.to);

    if (sentEmails.length < 3) {
      return { available: false, insights: ['Pas assez d\'emails envoyes (' + sentEmails.length + ') pour une analyse significative (min 3)'], recommendations: [] };
    }

    const insights = [];
    const recommendations = [];

    // --- Analyse longueur des emails ---
    const shortEmails = sentEmails.filter(e => (e.body || '').split(/\s+/).length < 100);
    const longEmails = sentEmails.filter(e => (e.body || '').split(/\s+/).length >= 100);

    if (shortEmails.length >= 2 && longEmails.length >= 2) {
      const shortOpenRate = shortEmails.length > 0
        ? Math.round((shortEmails.filter(e => !!e.openedAt).length / shortEmails.length) * 100) : 0;
      const longOpenRate = longEmails.length > 0
        ? Math.round((longEmails.filter(e => !!e.openedAt).length / longEmails.length) * 100) : 0;

      if (shortOpenRate > longOpenRate + 10) {
        const diff = shortOpenRate - longOpenRate;
        insights.push('Les emails courts (< 100 mots) ont ' + diff + '% plus d\'ouvertures que les longs (' + shortOpenRate + '% vs ' + longOpenRate + '%)');
        recommendations.push({
          type: 'email_length',
          description: 'Privilegier les emails courts (< 100 mots) — ' + diff + '% de meilleures ouvertures',
          action: 'prefer_short_emails',
          params: { maxWords: 100 },
          confidence: Math.min(0.9, 0.5 + (shortEmails.length + longEmails.length) / 100)
        });
      } else if (longOpenRate > shortOpenRate + 10) {
        insights.push('Les emails longs (100+ mots) performent mieux : ' + longOpenRate + '% vs ' + shortOpenRate + '% pour les courts');
      }
    }

    // --- Analyse sujets avec question ---
    const questionSubjects = sentEmails.filter(e => (e.subject || '').trim().endsWith('?'));
    const statementSubjects = sentEmails.filter(e => !(e.subject || '').trim().endsWith('?'));

    if (questionSubjects.length >= 2 && statementSubjects.length >= 2) {
      const questionRate = Math.round((questionSubjects.filter(e => !!e.openedAt).length / questionSubjects.length) * 100);
      const statementRate = Math.round((statementSubjects.filter(e => !!e.openedAt).length / statementSubjects.length) * 100);

      if (questionRate > statementRate + 5) {
        const diff = questionRate - statementRate;
        insights.push('Les sujets avec question ont ' + diff + '% plus d\'ouvertures (' + questionRate + '% vs ' + statementRate + '%)');
        recommendations.push({
          type: 'email_style',
          description: 'Utiliser des questions dans les sujets d\'email — +' + diff + '% d\'ouvertures',
          action: 'prefer_question_subjects',
          params: { subjectStyle: 'question' },
          confidence: Math.min(0.85, 0.5 + (questionSubjects.length + statementSubjects.length) / 100)
        });
      }
    }

    // --- Analyse heure d'envoi ---
    const byHour = {};
    for (const email of sentEmails) {
      const hour = new Date(email.sentAt).getHours();
      if (!byHour[hour]) byHour[hour] = { sent: 0, opened: 0 };
      byHour[hour].sent++;
      if (email.openedAt) byHour[hour].opened++;
    }

    // Trouver la meilleure plage horaire
    let bestSlot = null;
    let bestSlotRate = 0;
    let worstSlot = null;
    let worstSlotRate = 100;
    const globalOpenRate = sentEmails.length > 0
      ? Math.round((sentEmails.filter(e => !!e.openedAt).length / sentEmails.length) * 100) : 0;

    for (const [hour, data] of Object.entries(byHour)) {
      if (data.sent >= 3) {
        const rate = Math.round((data.opened / data.sent) * 100);
        if (rate > bestSlotRate) { bestSlotRate = rate; bestSlot = parseInt(hour); }
        if (rate < worstSlotRate) { worstSlotRate = rate; worstSlot = parseInt(hour); }
      }
    }

    if (bestSlot !== null && bestSlotRate > globalOpenRate + 10) {
      const multiplier = globalOpenRate > 0 ? (bestSlotRate / globalOpenRate).toFixed(1) : '?';
      insights.push('Les emails envoyes entre ' + bestSlot + 'h-' + (bestSlot + 1) + 'h performent ' + multiplier + 'x mieux (' + bestSlotRate + '% vs ' + globalOpenRate + '% global)');
      recommendations.push({
        type: 'send_timing',
        description: 'Envoyer les emails vers ' + bestSlot + 'h — ' + bestSlotRate + '% open rate (vs ' + globalOpenRate + '% global)',
        action: 'set_preferred_hour',
        params: { hour: bestSlot },
        confidence: Math.min(0.85, 0.5 + (byHour[bestSlot].sent / 20))
      });
    }

    // --- Analyse longueur du sujet ---
    const shortSubjects = sentEmails.filter(e => (e.subject || '').length < 40);
    const longSubjects = sentEmails.filter(e => (e.subject || '').length >= 40);

    if (shortSubjects.length >= 3 && longSubjects.length >= 3) {
      const shortRate = Math.round((shortSubjects.filter(e => !!e.openedAt).length / shortSubjects.length) * 100);
      const longRate = Math.round((longSubjects.filter(e => !!e.openedAt).length / longSubjects.length) * 100);

      if (Math.abs(shortRate - longRate) > 10) {
        const better = shortRate > longRate ? 'courts' : 'longs';
        const betterRate = shortRate > longRate ? shortRate : longRate;
        const worseRate = shortRate > longRate ? longRate : shortRate;
        insights.push('Les sujets ' + better + ' ont ' + (betterRate - worseRate) + '% plus d\'ouvertures (' + betterRate + '% vs ' + worseRate + '%)');
      }
    }

    return {
      available: true,
      totalAnalyzed: sentEmails.length,
      globalOpenRate: globalOpenRate,
      bestSendHour: bestSlot,
      bestSendHourRate: bestSlotRate,
      insights: insights,
      recommendations: recommendations
    };
  }

  // Boucle de feedback : comparer predictions vs resultats
  comparePredictions() {
    const unverified = storage.getUnverifiedPredictions();
    log.info('self-improve', 'ComparePredictions: ' + unverified.length + ' predictions non verifiees');
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
    log.info('self-improve', 'Feedback loop: ' + accuracy + '% accuracy (' + correct + '/' + verified + ')');

    return record;
  }

  // Approximation CDF normale (Abramowitz & Stegun, erreur < 1.5e-7)
  _normalCDF(z) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
  }

  // Z-test pour comparer deux proportions (significativite statistique)
  // Retourne { zScore, pValue, significant } (significant = p < 0.10, soit 90% de confiance)
  _zTestProportions(successes1, n1, successes2, n2) {
    if (n1 < 15 || n2 < 15) return { zScore: 0, pValue: 1, significant: false, reason: 'sample_too_small' };
    const p1 = successes1 / n1;
    const p2 = successes2 / n2;
    const pPool = (successes1 + successes2) / (n1 + n2);
    const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
    if (se === 0) return { zScore: 0, pValue: 1, significant: false, reason: 'zero_variance' };
    const z = (p2 - p1) / se;
    const absZ = Math.abs(z);
    // P-value precise via CDF normale (two-tailed)
    const pValue = Math.round(2 * (1 - this._normalCDF(absZ)) * 10000) / 10000;
    return { zScore: Math.round(z * 100) / 100, pValue, significant: pValue < 0.10, reason: null };
  }

  // Mesurer l'impact des recommandations appliquees il y a 14 jours
  measureAppliedImpact(currentSnapshot) {
    const due = storage.getTrackingDueForMeasurement();
    log.info('self-improve', 'MeasureImpact: ' + due.length + ' tracking(s) dus pour mesure');
    if (due.length === 0) return [];

    const results = [];
    const automailer = getAutomailerStorageSafe();

    for (const tracking of due) {
      const baseline = tracking.baselineSnapshot;
      const impact = {
        openRate: currentSnapshot.email ? (currentSnapshot.email.openRate || 0) : 0,
        bounceRate: currentSnapshot.email ? (currentSnapshot.email.bounceRate || 0) : 0,
        replyRate: 0,
        avgScore: currentSnapshot.leads ? (currentSnapshot.leads.avgScore || 0) : 0,
        totalSent: currentSnapshot.email ? (currentSnapshot.email.totalSent || 0) : 0,
        totalOpened: currentSnapshot.email ? (currentSnapshot.email.totalOpened || 0) : 0,
        totalReplied: 0
      };

      if (automailer && automailer.data) {
        impact.totalReplied = (automailer.data.emails || []).filter(
          e => e.hasReplied || e.status === 'replied'
        ).length;
        if (impact.totalSent > 0) impact.replyRate = Math.round((impact.totalReplied / impact.totalSent) * 100);
      }

      const delta = {
        openRate: impact.openRate - (baseline.openRate || 0),
        bounceRate: impact.bounceRate - (baseline.bounceRate || 0),
        replyRate: impact.replyRate - (baseline.replyRate || 0),
        avgScore: Math.round((impact.avgScore - (baseline.avgScore || 0)) * 10) / 10
      };

      // Test de significativite statistique sur openRate
      const baselineSent = baseline.totalSent || 0;
      const baselineOpened = Math.round((baseline.openRate || 0) * baselineSent / 100);
      const openTest = this._zTestProportions(baselineOpened, baselineSent, impact.totalOpened, impact.totalSent);

      // Test sur replyRate
      const baselineReplied = Math.round((baseline.replyRate || 0) * baselineSent / 100);
      const replyTest = this._zTestProportions(baselineReplied, baselineSent, impact.totalReplied, impact.totalSent);

      // Verdict base sur significativite statistique
      let verdict = 'neutral';
      let statSignificant = false;

      if (baselineSent < MIN_SAMPLE_FOR_IMPACT || impact.totalSent < MIN_SAMPLE_FOR_IMPACT) {
        verdict = 'insufficient_data';
      } else if (openTest.significant || replyTest.significant) {
        statSignificant = true;
        const mainDelta = delta.openRate + delta.replyRate * IMPACT_REPLY_WEIGHT;
        if (mainDelta > IMPACT_THRESHOLD_SIGNIFICANT) verdict = 'positive';
        else if (mainDelta < -IMPACT_THRESHOLD_SIGNIFICANT) verdict = 'negative';
      } else {
        const mainDelta = delta.openRate + delta.replyRate * IMPACT_REPLY_WEIGHT;
        if (mainDelta > IMPACT_THRESHOLD_NOISY) verdict = 'positive';
        else if (mainDelta < -IMPACT_THRESHOLD_NOISY) verdict = 'negative';
      }

      const statDetails = {
        openRateZScore: openTest.zScore,
        openRateSignificant: openTest.significant,
        replyRateZScore: replyTest.zScore,
        replyRateSignificant: replyTest.significant,
        baselineSampleSize: baselineSent,
        currentSampleSize: impact.totalSent,
        statSignificant
      };

      storage.completeImpactTracking(tracking.recoId, impact, delta, verdict);
      storage.updateTypePerformance(tracking.recoType, verdict);

      results.push({
        recoId: tracking.recoId, type: tracking.recoType, description: tracking.recoDescription,
        delta, verdict, statDetails
      });
      log.info('self-improve', 'Impact mesure: ' + tracking.recoType + ' → ' + verdict +
        ' (openRate ' + (delta.openRate > 0 ? '+' : '') + delta.openRate + '%' +
        (statSignificant ? ', STAT SIGNIFICATIF z=' + openTest.zScore : ', non significatif') + ')');
    }

    return results;
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

    // Impact des recommandations precedentes
    const impacts = storage.getCompletedImpactTracking(5);
    if (impacts.length > 0) {
      lines.push('');
      lines.push('📈 *IMPACT RECOS APPLIQUEES*');
      for (const imp of impacts) {
        const icon = imp.verdict === 'positive' ? '✅' : imp.verdict === 'negative' ? '❌' : '➖';
        lines.push('  ' + icon + ' ' + (imp.recoDescription || imp.recoType));
        if (imp.delta) {
          const parts = [];
          if (imp.delta.openRate !== 0) parts.push('Open ' + (imp.delta.openRate > 0 ? '+' : '') + imp.delta.openRate + '%');
          if (imp.delta.replyRate !== 0) parts.push('Reply ' + (imp.delta.replyRate > 0 ? '+' : '') + imp.delta.replyRate + '%');
          if (parts.length > 0) lines.push('      ' + parts.join(' | '));
        }
      }
    }

    // Funnel
    const latestFunnel = storage.getFunnelSnapshots(1);
    if (latestFunnel.length > 0) {
      const f = latestFunnel[0];
      lines.push('');
      lines.push('🔄 *FUNNEL*');
      lines.push('  ' + f.leadsFound + ' leads → ' + f.leadsQualified + ' qualifies → ' + f.emailsSent + ' emails');
      lines.push('  ' + f.emailsOpened + ' ouverts → ' + f.emailsReplied + ' replies → ' + f.meetingsBooked + ' meetings');
      if (f.costPerLead) lines.push('  $' + f.costPerLead + '/lead | $' + (f.costPerReply || '?') + '/reply');
    }

    // Temporal patterns
    const patterns = storage.getTemporalPatterns();
    if (patterns.lastAnalyzedAt && patterns.bestSlots && patterns.bestSlots.length > 0) {
      lines.push('');
      lines.push('⏰ *CRENEAUX OPTIMAUX*');
      for (const slot of patterns.bestSlots.slice(0, 3)) {
        lines.push('  ' + slot.dayName + ' ' + slot.hour + 'h : ' + slot.openRate + '% open (' + slot.sent + ' emails)');
      }
    }

    // Cohort insights
    const cohorts = storage.getCohortInsights();
    if (cohorts.lastAnalyzedAt && cohorts.topCohorts && cohorts.topCohorts.length > 0) {
      lines.push('');
      lines.push('🎯 *TOP COHORTS*');
      for (const c of cohorts.topCohorts.slice(0, 3)) {
        lines.push('  ' + c.name + ' (' + c.segment + ') : ' + c.openRate + '% open, ' + c.replyRate + '% reply (n=' + c.sent + ')');
      }
    }

    return lines.join('\n');
  }
}

// Helper cross-skill via skill-loader centralise
const { getStorage: _getStorage } = require('../../gateway/skill-loader.js');
function getAutomailerStorageSafe() { return _getStorage('automailer'); }

module.exports = Analyzer;
