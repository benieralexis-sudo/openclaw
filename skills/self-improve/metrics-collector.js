// Self-Improve - Collecte cross-skill des metriques
const storage = require('./storage.js');

// CDF normale statique (Abramowitz & Stegun) pour A/B test significativite
function _normalCDFStatic(z) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

// Cross-skill imports (dual-path pour Docker)
function getAutomailerStorage() {
  try { return require('../automailer/storage.js'); }
  catch (e) {
    try { return require('/app/skills/automailer/storage.js'); }
    catch (e2) { return null; }
  }
}

function getLeadEnrichStorage() {
  try { return require('../lead-enrich/storage.js'); }
  catch (e) {
    try { return require('/app/skills/lead-enrich/storage.js'); }
    catch (e2) { return null; }
  }
}

function getFlowfastStorage() {
  try { return require('../flowfast/storage.js'); }
  catch (e) {
    try { return require('/app/skills/flowfast/storage.js'); }
    catch (e2) { return null; }
  }
}

function getProactiveStorage() {
  try { return require('../proactive-agent/storage.js'); }
  catch (e) {
    try { return require('/app/skills/proactive-agent/storage.js'); }
    catch (e2) { return null; }
  }
}

function getAutonomousPilotStorage() {
  try { return require('../autonomous-pilot/storage.js'); }
  catch (e) {
    try { return require('/app/skills/autonomous-pilot/storage.js'); }
    catch (e2) { return null; }
  }
}

function getMeetingSchedulerStorage() {
  try { return require('../meeting-scheduler/storage.js'); }
  catch (e) {
    try { return require('/app/skills/meeting-scheduler/storage.js'); }
    catch (e2) { return null; }
  }
}

function getCrmPilotStorage() {
  try { return require('../crm-pilot/storage.js'); }
  catch (e) {
    try { return require('/app/skills/crm-pilot/storage.js'); }
    catch (e2) { return null; }
  }
}

function getAppConfig() {
  try { return require('../../gateway/app-config.js'); }
  catch (e) {
    try { return require('/app/gateway/app-config.js'); }
    catch (e2) { return null; }
  }
}

function getWebIntelStorage() {
  try { return require('../web-intelligence/storage.js'); }
  catch (e) {
    try { return require('/app/skills/web-intelligence/storage.js'); }
    catch (e2) { return null; }
  }
}

function getCircuitBreakerModule() {
  try { return require('../../gateway/circuit-breaker.js'); }
  catch (e) {
    try { return require('/app/gateway/circuit-breaker.js'); }
    catch (e2) { return null; }
  }
}

class MetricsCollector {
  constructor() {}

  // Collecter les details individuels de chaque email (spec Jojo)
  // Pour chaque email : destinataire, score du lead, secteur, ville, taille entreprise,
  // objet, longueur du message, jour/heure d'envoi, ouvert oui/non, repondu oui/non
  collectDetailedEmailData() {
    const automailerStorage = getAutomailerStorage();
    const leadStorage = getLeadEnrichStorage();
    if (!automailerStorage || !automailerStorage.data) return [];

    const emails = automailerStorage.data.emails || [];
    const enrichedLeads = (leadStorage && leadStorage.data) ? leadStorage.data.enrichedLeads || {} : {};
    const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

    // Recuperer les news WI marquees comme utilisees pour correlation
    let wiNewsUsed = [];
    try {
      const wiStorage = getWebIntelStorage();
      if (wiStorage && wiStorage.getRecentNewsOutreach) {
        wiNewsUsed = wiStorage.getRecentNewsOutreach(100).filter(n => n.usedInEmail);
      }
    } catch (e) {}

    const detailed = [];
    for (const email of emails) {
      if (!email.to || !email.sentAt) continue;

      const sentDate = new Date(email.sentAt);
      const lead = enrichedLeads[email.to.toLowerCase()] || null;
      const cls = (lead && lead.aiClassification) ? lead.aiClassification : {};
      const person = (lead && lead.apolloData && lead.apolloData.person) ? lead.apolloData.person : {};
      const org = (lead && lead.apolloData && lead.apolloData.organization) ? lead.apolloData.organization : {};

      // Calculer delai de reponse (si ouvert)
      let responseDelayHours = null;
      if (email.openedAt && email.sentAt) {
        responseDelayHours = Math.round((new Date(email.openedAt).getTime() - new Date(email.sentAt).getTime()) / (1000 * 60 * 60) * 10) / 10;
      }

      // Verifier si un article WI a ete utilise pour cette entreprise
      let usedWiNews = false;
      if (wiNewsUsed && (email.company || org.name)) {
        const co = (email.company || org.name || '').toLowerCase();
        usedWiNews = co.length >= 2 && wiNewsUsed.some(n => n.company && n.company.toLowerCase().includes(co));
      }

      detailed.push({
        to: email.to,
        subject: (email.subject || '').substring(0, 100),
        bodyLength: (email.body || '').length,
        sentDay: days[sentDate.getDay()],
        sentHour: sentDate.getHours(),
        sentAt: email.sentAt,
        opened: !!email.openedAt,
        openedAt: email.openedAt || null,
        bounced: email.status === 'bounced',
        responseDelayHours: responseDelayHours,
        // Donnees lead (si enrichi)
        leadScore: cls.score || null,
        leadIndustry: cls.industry || null,
        leadPersona: cls.persona || null,
        leadCompanySize: cls.companySize || null,
        leadCity: person.city || null,
        leadCountry: person.country || null,
        leadTitle: person.title || null,
        companyName: org.name || null,
        companyEmployees: org.employeeCount || null,
        // Web Intelligence context
        usedWiNews: usedWiNews
      });
    }

    // Sauvegarder dans storage pour historique
    storage.data.metrics.emailDetails = detailed.slice(-500); // Garder les 500 derniers
    storage._save();

    return detailed;
  }

  // Collecter les metriques email depuis AutoMailer (agreges)
  collectEmailMetrics() {
    const automailerStorage = getAutomailerStorage();
    if (!automailerStorage || !automailerStorage.data) {
      return { available: false, emails: [], campaigns: [], stats: {} };
    }

    const emails = automailerStorage.data.emails || [];
    const campaigns = Object.values(automailerStorage.data.campaigns || {});

    // Analyser les 7 derniers jours
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentEmails = emails.filter(e => {
      const ts = e.sentAt ? new Date(e.sentAt).getTime() : new Date(e.createdAt).getTime();
      return ts >= oneWeekAgo;
    });

    // Stats globales
    const totalSent = recentEmails.filter(e => e.status !== 'queued').length;
    const totalOpened = recentEmails.filter(e => e.openedAt).length;
    const totalBounced = recentEmails.filter(e => e.status === 'bounced').length;

    // Stats par jour de la semaine
    const byDayOfWeek = {};
    const byHourOfDay = {};
    const byBodyLength = { short: { sent: 0, opened: 0 }, medium: { sent: 0, opened: 0 }, long: { sent: 0, opened: 0 } };

    for (const email of recentEmails) {
      const sentDate = new Date(email.sentAt || email.createdAt);
      const day = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][sentDate.getDay()];
      const hour = sentDate.getHours();

      if (!byDayOfWeek[day]) byDayOfWeek[day] = { sent: 0, opened: 0 };
      byDayOfWeek[day].sent++;
      if (email.openedAt) byDayOfWeek[day].opened++;

      const hourKey = String(hour).padStart(2, '0');
      if (!byHourOfDay[hourKey]) byHourOfDay[hourKey] = { sent: 0, opened: 0 };
      byHourOfDay[hourKey].sent++;
      if (email.openedAt) byHourOfDay[hourKey].opened++;

      // Longueur du body
      const bodyLen = (email.body || '').length;
      const bucket = bodyLen < 200 ? 'short' : bodyLen < 500 ? 'medium' : 'long';
      byBodyLength[bucket].sent++;
      if (email.openedAt) byBodyLength[bucket].opened++;
    }

    // Campagnes actives
    const activeCampaigns = campaigns.filter(c => c.status === 'active' || c.status === 'sending');
    const completedCampaigns = campaigns.filter(c => c.status === 'completed');

    // Correlation WI news / performance emails
    let wiCorrelation = null;
    try {
      const wiStorage = getWebIntelStorage();
      if (wiStorage && wiStorage.getRecentNewsOutreach) {
        const usedNews = wiStorage.getRecentNewsOutreach(100).filter(n => n.usedInEmail);
        const usedCompanies = new Set(usedNews.map(n => (n.company || '').toLowerCase()).filter(c => c.length >= 2));
        let wiSent = 0, wiOpened = 0, noWiSent = 0, noWiOpened = 0;
        for (const email of recentEmails) {
          const co = (email.company || '').toLowerCase();
          if (co.length >= 2 && usedCompanies.has(co)) {
            wiSent++;
            if (email.openedAt) wiOpened++;
          } else {
            noWiSent++;
            if (email.openedAt) noWiOpened++;
          }
        }
        wiCorrelation = {
          withWiNews: { sent: wiSent, opened: wiOpened, openRate: wiSent > 0 ? Math.round((wiOpened / wiSent) * 100) : 0 },
          withoutWiNews: { sent: noWiSent, opened: noWiOpened, openRate: noWiSent > 0 ? Math.round((noWiOpened / noWiSent) * 100) : 0 },
          totalNewsUsed: usedNews.length
        };
      }
    } catch (e) {}

    return {
      available: true,
      totalSent: totalSent,
      totalOpened: totalOpened,
      totalBounced: totalBounced,
      openRate: totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0,
      bounceRate: totalSent > 0 ? Math.round((totalBounced / totalSent) * 100) : 0,
      byDayOfWeek: byDayOfWeek,
      byHourOfDay: byHourOfDay,
      byBodyLength: byBodyLength,
      activeCampaigns: activeCampaigns.length,
      completedCampaigns: completedCampaigns.length,
      totalCampaigns: campaigns.length,
      recentEmailCount: recentEmails.length,
      globalStats: automailerStorage.data.stats || {},
      wiCorrelation: wiCorrelation
    };
  }

  // Collecter les metriques leads depuis Lead Enrich
  collectLeadMetrics() {
    const leadStorage = getLeadEnrichStorage();
    if (!leadStorage || !leadStorage.data) {
      return { available: false, leads: [], stats: {} };
    }

    const enrichedLeads = leadStorage.data.enrichedLeads || {};
    const allLeads = Object.values(enrichedLeads);

    // Analyser les 7 derniers jours
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentLeads = allLeads.filter(l => {
      return l.enrichedAt && new Date(l.enrichedAt).getTime() >= oneWeekAgo;
    });

    // Repartition par score
    const byScore = { high: [], medium: [], low: [] };
    const byIndustry = {};
    const byPersona = {};
    const scores = [];

    for (const lead of allLeads) {
      const cls = lead.aiClassification || {};
      const score = cls.score || 0;
      scores.push(score);

      if (score >= 8) byScore.high.push(lead);
      else if (score >= 6) byScore.medium.push(lead);
      else byScore.low.push(lead);

      const industry = cls.industry || 'Inconnu';
      if (!byIndustry[industry]) byIndustry[industry] = { count: 0, avgScore: 0, scores: [] };
      byIndustry[industry].count++;
      byIndustry[industry].scores.push(score);

      const persona = cls.persona || 'Autre';
      if (!byPersona[persona]) byPersona[persona] = { count: 0, avgScore: 0, scores: [] };
      byPersona[persona].count++;
      byPersona[persona].scores.push(score);
    }

    // Calculer les moyennes
    for (const key of Object.keys(byIndustry)) {
      const s = byIndustry[key].scores;
      byIndustry[key].avgScore = s.length > 0 ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 : 0;
      delete byIndustry[key].scores;
    }
    for (const key of Object.keys(byPersona)) {
      const s = byPersona[key].scores;
      byPersona[key].avgScore = s.length > 0 ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 : 0;
      delete byPersona[key].scores;
    }

    const avgScore = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;

    return {
      available: true,
      totalLeads: allLeads.length,
      recentLeads: recentLeads.length,
      avgScore: avgScore,
      byScore: {
        high: byScore.high.length,
        medium: byScore.medium.length,
        low: byScore.low.length
      },
      byIndustry: byIndustry,
      byPersona: byPersona,
      apolloCredits: {
        used: leadStorage.data.apolloUsage ? leadStorage.data.apolloUsage.creditsUsed : 0,
        limit: leadStorage.data.apolloUsage ? leadStorage.data.apolloUsage.creditsLimit : 100
      },
      globalStats: leadStorage.data.stats || {}
    };
  }

  // Croiser emails et leads pour mesurer l'efficacite du scoring
  collectCrossMetrics() {
    const automailerStorage = getAutomailerStorage();
    const leadStorage = getLeadEnrichStorage();

    if (!automailerStorage || !leadStorage) {
      return { available: false };
    }

    const emails = automailerStorage.data.emails || [];
    const enrichedLeads = leadStorage.data.enrichedLeads || {};

    // Pour chaque email envoye, trouver le score du lead
    const emailsWithScores = [];
    for (const email of emails) {
      if (!email.to || !email.sentAt) continue;
      const lead = enrichedLeads[email.to.toLowerCase()];
      if (!lead || !lead.aiClassification) continue;

      emailsWithScores.push({
        email: email.to,
        score: lead.aiClassification.score || 0,
        industry: lead.aiClassification.industry || 'Inconnu',
        persona: lead.aiClassification.persona || 'Autre',
        opened: !!email.openedAt,
        bounced: email.status === 'bounced',
        sentAt: email.sentAt
      });
    }

    // Taux d'ouverture par tranche de score
    const byScoreRange = {};
    for (const item of emailsWithScores) {
      const range = item.score >= 8 ? '8-10' : item.score >= 6 ? '6-7' : '0-5';
      if (!byScoreRange[range]) byScoreRange[range] = { sent: 0, opened: 0 };
      byScoreRange[range].sent++;
      if (item.opened) byScoreRange[range].opened++;
    }

    // Taux d'ouverture par industrie
    const byIndustry = {};
    for (const item of emailsWithScores) {
      if (!byIndustry[item.industry]) byIndustry[item.industry] = { sent: 0, opened: 0 };
      byIndustry[item.industry].sent++;
      if (item.opened) byIndustry[item.industry].opened++;
    }

    // Taux d'ouverture par persona
    const byPersona = {};
    for (const item of emailsWithScores) {
      if (!byPersona[item.persona]) byPersona[item.persona] = { sent: 0, opened: 0 };
      byPersona[item.persona].sent++;
      if (item.opened) byPersona[item.persona].opened++;
    }

    return {
      available: true,
      totalCrossed: emailsWithScores.length,
      byScoreRange: byScoreRange,
      byIndustry: byIndustry,
      byPersona: byPersona
    };
  }

  // Construire le snapshot hebdomadaire complet
  buildWeeklySnapshot() {
    console.log('[metrics-collector] Construction snapshot hebdomadaire...');

    // Collecter les details individuels de chaque email (spec Jojo)
    const emailDetails = this.collectDetailedEmailData();

    const emailMetrics = this.collectEmailMetrics();
    const leadMetrics = this.collectLeadMetrics();
    const crossMetrics = this.collectCrossMetrics();

    // Collectes v3
    const funnelMetrics = this.collectFunnelMetrics();
    const brainMetrics = this.collectBrainMetrics();
    const abTestMetrics = this.collectABTestMetrics();

    // Collectes v3.1
    const temporalPatterns = this.discoverTemporalPatterns();
    const cohortInsights = this.collectCohortAnalysis();

    // Ajouter les top patterns depuis les details individuels
    const detailedInsights = this._extractDetailedInsights(emailDetails);

    const snapshot = {
      date: new Date().toISOString().split('T')[0],
      collectedAt: new Date().toISOString(),
      email: emailMetrics,
      leads: leadMetrics,
      cross: crossMetrics,
      detailedInsights: detailedInsights,
      funnel: funnelMetrics,
      brain: brainMetrics,
      abTests: abTestMetrics,
      temporalPatterns: temporalPatterns,
      cohortInsights: cohortInsights,
      emailDetailsCount: emailDetails.length,
      currentOverrides: {
        scoringWeights: storage.getScoringWeights(),
        emailPreferences: storage.getEmailPreferences(),
        targetingCriteria: storage.getTargetingCriteria()
      }
    };

    // Sauvegarder le snapshot
    storage.saveWeeklySnapshot(snapshot);
    console.log('[metrics-collector] Snapshot sauvegarde (emails: ' +
      (emailMetrics.totalSent || 0) + ' envoyes, leads: ' +
      (leadMetrics.totalLeads || 0) + ' enrichis, details: ' + emailDetails.length + ')');

    return snapshot;
  }

  // Extraire des insights depuis les details individuels
  _extractDetailedInsights(emailDetails) {
    if (emailDetails.length === 0) return { available: false };

    // Taux d'ouverture par secteur
    const byIndustry = {};
    const byCompanySize = {};
    const byCity = {};
    const byTitleLevel = {};
    const bySubjectLength = { court: { sent: 0, opened: 0 }, moyen: { sent: 0, opened: 0 }, long: { sent: 0, opened: 0 } };

    for (const e of emailDetails) {
      // Par secteur
      if (e.leadIndustry) {
        if (!byIndustry[e.leadIndustry]) byIndustry[e.leadIndustry] = { sent: 0, opened: 0 };
        byIndustry[e.leadIndustry].sent++;
        if (e.opened) byIndustry[e.leadIndustry].opened++;
      }

      // Par taille entreprise
      if (e.leadCompanySize) {
        if (!byCompanySize[e.leadCompanySize]) byCompanySize[e.leadCompanySize] = { sent: 0, opened: 0 };
        byCompanySize[e.leadCompanySize].sent++;
        if (e.opened) byCompanySize[e.leadCompanySize].opened++;
      }

      // Par ville
      if (e.leadCity) {
        if (!byCity[e.leadCity]) byCity[e.leadCity] = { sent: 0, opened: 0 };
        byCity[e.leadCity].sent++;
        if (e.opened) byCity[e.leadCity].opened++;
      }

      // Par niveau de titre (CEO, VP, Manager, etc.)
      if (e.leadTitle) {
        const titleLower = e.leadTitle.toLowerCase();
        let level = 'autre';
        if (titleLower.includes('ceo') || titleLower.includes('founder') || titleLower.includes('president')) level = 'CEO/Founder';
        else if (titleLower.includes('cto') || titleLower.includes('cfo') || titleLower.includes('vp') || titleLower.includes('director')) level = 'VP/Director';
        else if (titleLower.includes('head') || titleLower.includes('manager') || titleLower.includes('responsable')) level = 'Manager/Head';
        else if (titleLower.includes('senior') || titleLower.includes('lead')) level = 'Senior/Lead';

        if (!byTitleLevel[level]) byTitleLevel[level] = { sent: 0, opened: 0 };
        byTitleLevel[level].sent++;
        if (e.opened) byTitleLevel[level].opened++;
      }

      // Par longueur d'objet
      const subjLen = (e.subject || '').length;
      const bucket = subjLen < 30 ? 'court' : subjLen < 60 ? 'moyen' : 'long';
      bySubjectLength[bucket].sent++;
      if (e.opened) bySubjectLength[bucket].opened++;
    }

    // Calculer les taux et trier
    const calcRate = (obj) => {
      const result = {};
      for (const [key, data] of Object.entries(obj)) {
        result[key] = {
          sent: data.sent,
          opened: data.opened,
          openRate: data.sent > 0 ? Math.round((data.opened / data.sent) * 100) : 0
        };
      }
      return result;
    };

    // Delai moyen de reponse
    const delays = emailDetails.filter(e => e.responseDelayHours !== null).map(e => e.responseDelayHours);
    const avgDelay = delays.length > 0 ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10 : null;

    return {
      available: true,
      totalEmails: emailDetails.length,
      totalWithLeadData: emailDetails.filter(e => e.leadScore !== null).length,
      byIndustry: calcRate(byIndustry),
      byCompanySize: calcRate(byCompanySize),
      byCity: calcRate(byCity),
      byTitleLevel: calcRate(byTitleLevel),
      bySubjectLength: calcRate(bySubjectLength),
      avgResponseDelayHours: avgDelay
    };
  }
  // --- Funnel complet lead → meeting ---
  collectFunnelMetrics() {
    const flowfast = getFlowfastStorage();
    const automailer = getAutomailerStorage();
    const meetingScheduler = getMeetingSchedulerStorage();
    const crmPilot = getCrmPilotStorage();
    const appConfig = getAppConfig();

    const funnel = {
      date: new Date().toISOString().split('T')[0],
      leadsFound: 0, leadsQualified: 0, leadsEnriched: 0,
      emailsSent: 0, emailsOpened: 0, emailsReplied: 0,
      meetingsBooked: 0, dealsCreated: 0,
      conversionRates: {},
      costPerLead: null, costPerReply: null, costPerMeeting: null,
      totalApiCost: 0
    };

    if (flowfast && flowfast.data && flowfast.data.stats) {
      funnel.leadsFound = flowfast.data.stats.totalLeadsFound || 0;
      funnel.leadsQualified = flowfast.data.stats.totalLeadsQualified || 0;
    }

    const leadStorage = getLeadEnrichStorage();
    if (leadStorage && leadStorage.data) {
      funnel.leadsEnriched = Object.keys(leadStorage.data.enrichedContacts || leadStorage.data.enrichedLeads || {}).length;
    }

    if (automailer && automailer.data) {
      const stats = automailer.data.stats || {};
      funnel.emailsSent = stats.totalEmailsSent || 0;
      funnel.emailsOpened = stats.totalEmailsOpened || 0;
      funnel.emailsReplied = (automailer.data.emails || []).filter(
        e => e.hasReplied || e.status === 'replied'
      ).length;
    }

    if (meetingScheduler && meetingScheduler.data && meetingScheduler.data.stats) {
      funnel.meetingsBooked = meetingScheduler.data.stats.totalBooked || 0;
    }

    if (crmPilot && crmPilot.data && crmPilot.data.stats) {
      funnel.dealsCreated = crmPilot.data.stats.totalDealsCreated || 0;
    }

    if (appConfig) {
      try {
        const budget = appConfig.getBudgetStatus();
        const history = budget.history || [];
        const last7 = history.slice(-7);
        funnel.totalApiCost = last7.reduce((sum, d) => sum + (d.spent || 0), 0) + (budget.todaySpent || 0);
      } catch (e) {}
    }

    // Conversion rates
    if (funnel.leadsFound > 0) funnel.conversionRates.foundToQualified = Math.round((funnel.leadsQualified / funnel.leadsFound) * 100);
    if (funnel.leadsQualified > 0) funnel.conversionRates.qualifiedToEmailed = Math.round((funnel.emailsSent / funnel.leadsQualified) * 100);
    if (funnel.emailsSent > 0) {
      funnel.conversionRates.emailedToOpened = Math.round((funnel.emailsOpened / funnel.emailsSent) * 100);
      funnel.conversionRates.emailedToReplied = Math.round((funnel.emailsReplied / funnel.emailsSent) * 100);
    }
    if (funnel.emailsOpened > 0) funnel.conversionRates.openedToReplied = Math.round((funnel.emailsReplied / funnel.emailsOpened) * 100);
    if (funnel.emailsReplied > 0 && funnel.meetingsBooked > 0) funnel.conversionRates.repliedToMeeting = Math.round((funnel.meetingsBooked / funnel.emailsReplied) * 100);

    // Cost per metric
    if (funnel.totalApiCost > 0) {
      if (funnel.leadsFound > 0) funnel.costPerLead = Math.round((funnel.totalApiCost / funnel.leadsFound) * 100) / 100;
      if (funnel.emailsReplied > 0) funnel.costPerReply = Math.round((funnel.totalApiCost / funnel.emailsReplied) * 100) / 100;
      if (funnel.meetingsBooked > 0) funnel.costPerMeeting = Math.round((funnel.totalApiCost / funnel.meetingsBooked) * 100) / 100;
    }

    storage.saveFunnelSnapshot(funnel);
    return funnel;
  }

  // --- Brain Engine insights ---
  collectBrainMetrics() {
    const apStorage = getAutonomousPilotStorage();
    if (!apStorage) return { available: false };

    try {
      const nichePerf = apStorage.getNichePerformance();
      const learnings = apStorage.getLearnings();
      const progress = apStorage.getProgress();

      const insights = {
        available: true,
        nichePerformance: nichePerf,
        bestNiche: null,
        worstNiche: null,
        learnings: {
          bestSearchCriteria: (learnings.bestSearchCriteria || []).slice(0, 5),
          bestEmailStyles: (learnings.bestEmailStyles || []).slice(0, 5),
          bestSendTimes: (learnings.bestSendTimes || []).slice(0, 5)
        },
        weeklyPerformance: (learnings.weeklyPerformance || []).slice(0, 8),
        currentProgress: progress
      };

      // Meilleure et pire niche
      const niches = Object.entries(nichePerf);
      if (niches.length > 0) {
        const sorted = niches
          .filter(([, np]) => (np.sent || 0) >= 3)
          .map(([name, np]) => ({
            name, ...np,
            openRate: np.sent > 0 ? Math.round((np.opened / np.sent) * 100) : 0,
            replyRate: np.sent > 0 ? Math.round(((np.replied || 0) / np.sent) * 100) : 0
          }))
          .sort((a, b) => b.openRate - a.openRate);
        if (sorted.length > 0) {
          insights.bestNiche = sorted[0];
          insights.worstNiche = sorted[sorted.length - 1];
        }
      }

      storage.saveBrainInsights(insights);
      return insights;
    } catch (e) {
      console.error('[metrics-collector] Erreur brain metrics:', e.message);
      return { available: false };
    }
  }

  // --- A/B Test insights (avec significativite statistique) ---
  collectABTestMetrics() {
    const automailer = getAutomailerStorage();
    if (!automailer || !automailer.data || typeof automailer.getABTestResults !== 'function') {
      return { available: false, reason: 'method_not_available' };
    }

    try {
      const campaigns = Object.values(automailer.data.campaigns || {});
      if (campaigns.length === 0) return { available: false, reason: 'no_campaigns' };

      const campaignResults = [];
      let totalAWins = 0, totalBWins = 0, totalABEmails = 0, significantWins = 0;

      for (const campaign of campaigns) {
        let abResults;
        try { abResults = automailer.getABTestResults(campaign.id); } catch (e) { continue; }
        if (!abResults || abResults.totalEmails === 0) continue;

        totalABEmails += abResults.totalEmails;
        if (abResults.winner === 'A') totalAWins++;
        else if (abResults.winner === 'B') totalBWins++;

        const result = {
          campaignId: campaign.id,
          campaignName: campaign.name || campaign.id,
          totalEmails: abResults.totalEmails,
          winner: abResults.winner,
          aOpenRate: abResults.A ? abResults.A.openRate : 0,
          bOpenRate: abResults.B ? abResults.B.openRate : 0,
          significant: false,
          pValue: null
        };

        // Test de significativite statistique (z-test sur open rates)
        if (abResults.A && abResults.B && (abResults.A.sent || 0) >= 10 && (abResults.B.sent || 0) >= 10) {
          const aSent = abResults.A.sent, bSent = abResults.B.sent;
          const aOpened = Math.round((abResults.A.openRate || 0) * aSent / 100);
          const bOpened = Math.round((abResults.B.openRate || 0) * bSent / 100);
          // Z-test inline (meme logique que analyzer)
          const p1 = aOpened / aSent, p2 = bOpened / bSent;
          const pPool = (aOpened + bOpened) / (aSent + bSent);
          const se = Math.sqrt(pPool * (1 - pPool) * (1 / aSent + 1 / bSent));
          if (se > 0) {
            const z = Math.abs((p2 - p1) / se);
            result.significant = z >= 1.645; // 90% confiance
            result.pValue = Math.round(2 * (1 - _normalCDFStatic(z)) * 10000) / 10000;
            if (result.significant) significantWins++;
          }
        }

        campaignResults.push(result);
      }

      const insights = {
        available: campaignResults.length > 0,
        campaignResults,
        summary: {
          totalCampaignsWithAB: campaignResults.length,
          totalABEmails,
          aWins: totalAWins,
          bWins: totalBWins,
          significantWins,
          totalComparisons: campaignResults.filter(r => r.pValue !== null).length,
          variantWinRate: (totalAWins + totalBWins) > 0 ? Math.round((totalBWins / (totalAWins + totalBWins)) * 100) : null
        }
      };

      storage.saveABTestInsights(insights);
      return insights;
    } catch (e) {
      console.error('[metrics-collector] Erreur AB test metrics:', e.message);
      return { available: false, reason: e.message };
    }
  }

  // --- Temporal Pattern Learning : decouvrir les meilleurs jour x heure ---
  discoverTemporalPatterns() {
    const automailer = getAutomailerStorage();
    if (!automailer || !automailer.data) return { available: false };

    const emails = (automailer.data.emails || []).filter(e => e.sentAt && e.status !== 'queued');
    if (emails.length < 15) return { available: false, reason: 'not_enough_emails', count: emails.length };

    const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    const grid = {};

    for (const email of emails) {
      const d = new Date(email.sentAt);
      const day = d.getDay();
      const hour = d.getHours();
      const key = day + '_' + hour;
      if (!grid[key]) grid[key] = { day, hour, dayName: dayNames[day], sent: 0, opened: 0, replied: 0 };
      grid[key].sent++;
      if (email.openedAt) grid[key].opened++;
      if (email.hasReplied || email.status === 'replied') grid[key].replied++;
    }

    // Calculer les taux et trier
    const slots = Object.values(grid)
      .filter(s => s.sent >= 3)
      .map(s => ({
        ...s,
        openRate: Math.round((s.opened / s.sent) * 100),
        replyRate: Math.round((s.replied / s.sent) * 100),
        score: Math.round(((s.opened / s.sent) * 100 + (s.replied / s.sent) * 200)) // reply pese double
      }))
      .sort((a, b) => b.score - a.score);

    const result = {
      available: slots.length > 0,
      dayHourGrid: grid,
      bestSlots: slots.slice(0, 5),
      worstSlots: slots.length > 3 ? slots.slice(-3).reverse() : [],
      totalAnalyzed: emails.length,
      slotsWithData: slots.length
    };

    storage.saveTemporalPatterns(result);
    return result;
  }

  // --- Cohort Analysis : segmenter performance par industrie/taille/role ---
  collectCohortAnalysis() {
    const automailer = getAutomailerStorage();
    const leadStorage = getLeadEnrichStorage();
    if (!automailer || !automailer.data || !leadStorage || !leadStorage.data) return { available: false };

    const emails = (automailer.data.emails || []).filter(e => e.sentAt && e.to && e.status !== 'queued');
    const leads = leadStorage.data.enrichedContacts || leadStorage.data.enrichedLeads || {};
    if (emails.length < 10) return { available: false };

    const byIndustry = {};
    const byCompanySize = {};
    const byRole = {};

    for (const email of emails) {
      const lead = leads[email.to.toLowerCase()] || leads[email.to];
      if (!lead || !lead.aiClassification) continue;

      const cl = lead.aiClassification;
      const opened = !!email.openedAt;
      const replied = !!(email.hasReplied || email.status === 'replied');

      // Par industrie
      const industry = cl.industry || 'unknown';
      if (!byIndustry[industry]) byIndustry[industry] = { sent: 0, opened: 0, replied: 0 };
      byIndustry[industry].sent++;
      if (opened) byIndustry[industry].opened++;
      if (replied) byIndustry[industry].replied++;

      // Par taille entreprise
      const size = cl.companySize || lead.company_size || 'unknown';
      if (size !== 'unknown') {
        if (!byCompanySize[size]) byCompanySize[size] = { sent: 0, opened: 0, replied: 0 };
        byCompanySize[size].sent++;
        if (opened) byCompanySize[size].opened++;
        if (replied) byCompanySize[size].replied++;
      }

      // Par role/persona
      const role = cl.persona || 'unknown';
      if (role !== 'unknown') {
        if (!byRole[role]) byRole[role] = { sent: 0, opened: 0, replied: 0 };
        byRole[role].sent++;
        if (opened) byRole[role].opened++;
        if (replied) byRole[role].replied++;
      }
    }

    // Calculer les taux
    const calcRates = (obj) => {
      const result = {};
      for (const [key, data] of Object.entries(obj)) {
        if (data.sent >= 2) {
          result[key] = {
            ...data,
            openRate: Math.round((data.opened / data.sent) * 100),
            replyRate: Math.round((data.replied / data.sent) * 100)
          };
        }
      }
      return result;
    };

    const ratedIndustry = calcRates(byIndustry);
    const ratedSize = calcRates(byCompanySize);
    const ratedRole = calcRates(byRole);

    // Top et bottom cohorts (tous segments confondus)
    const allCohorts = [];
    for (const [name, data] of Object.entries(ratedIndustry)) {
      allCohorts.push({ segment: 'industry', name, ...data });
    }
    for (const [name, data] of Object.entries(ratedSize)) {
      allCohorts.push({ segment: 'companySize', name, ...data });
    }
    for (const [name, data] of Object.entries(ratedRole)) {
      allCohorts.push({ segment: 'role', name, ...data });
    }
    allCohorts.sort((a, b) => (b.openRate + b.replyRate * 2) - (a.openRate + a.replyRate * 2));

    const result = {
      available: allCohorts.length > 0,
      byIndustry: ratedIndustry,
      byCompanySize: ratedSize,
      byRole: ratedRole,
      topCohorts: allCohorts.slice(0, 5),
      bottomCohorts: allCohorts.length > 3 ? allCohorts.slice(-3).reverse() : [],
      totalAnalyzed: emails.length,
      totalWithLeadData: emails.filter(e => {
        const l = leads[e.to.toLowerCase()] || leads[e.to];
        return l && l.aiClassification;
      }).length
    };

    storage.saveCohortInsights(result);
    return result;
  }

  // --- Snapshot leger pour anomaly detection (pur JS, pas d'IA) ---
  getRecentMetrics(hours) {
    hours = hours || 24;
    const automailer = getAutomailerStorage();
    if (!automailer || !automailer.data) return null;

    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const recentEmails = (automailer.data.emails || []).filter(e => {
      const ts = e.sentAt ? new Date(e.sentAt).getTime() : 0;
      return ts >= cutoff;
    });

    const sent = recentEmails.filter(e => e.status !== 'queued').length;
    const opened = recentEmails.filter(e => e.openedAt).length;
    const bounced = recentEmails.filter(e => e.status === 'bounced').length;
    const replied = recentEmails.filter(e => e.hasReplied || e.status === 'replied').length;

    const cb = getCircuitBreakerModule();
    let breakerStatus = {};
    if (cb && cb.getAllStatus) {
      try { breakerStatus = cb.getAllStatus(); } catch (e) {}
    }

    const appConfig = getAppConfig();
    let budgetStatus = {};
    if (appConfig) {
      try { budgetStatus = appConfig.getBudgetStatus(); } catch (e) {}
    }

    return {
      period: hours + 'h',
      sent, opened, bounced, replied,
      openRate: sent > 0 ? Math.round((opened / sent) * 100) : 0,
      bounceRate: sent > 0 ? Math.round((bounced / sent) * 100) : 0,
      replyRate: sent > 0 ? Math.round((replied / sent) * 100) : 0,
      breakerStatus,
      budgetStatus,
      collectedAt: new Date().toISOString()
    };
  }
}

module.exports = MetricsCollector;
