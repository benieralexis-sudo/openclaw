// Self-Improve - Collecte cross-skill des metriques
const storage = require('./storage.js');

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
        companyEmployees: org.employeeCount || null
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
      globalStats: automailerStorage.data.stats || {}
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

    // Ajouter les top patterns depuis les details individuels
    const detailedInsights = this._extractDetailedInsights(emailDetails);

    const snapshot = {
      date: new Date().toISOString().split('T')[0],
      collectedAt: new Date().toISOString(),
      email: emailMetrics,
      leads: leadMetrics,
      cross: crossMetrics,
      detailedInsights: detailedInsights,
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
}

module.exports = MetricsCollector;
