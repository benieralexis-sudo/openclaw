// Proactive Agent - Generateur de rapports
// Collecte cross-skill + generation de texte via Claude

const storage = require('./storage.js');
const { getStorage, getModule } = require('../../gateway/skill-loader.js');
const { callOpenAI } = require('../../gateway/shared-nlp.js');
const appConfig = require('../../gateway/app-config.js');
const log = require('../../gateway/logger.js');

function getHubSpotClient() { return getModule('hubspot-client'); }
function getResendClient() { return getModule('resend-client'); }

class ReportGenerator {
  constructor(options) {
    this.callClaude = options.callClaude;
    this.callClaudeOpus = options.callClaudeOpus || options.callClaude;
    this.openaiKey = process.env.OPENAI_API_KEY || '';
    this.hubspotKey = options.hubspotKey;
    this.resendKey = options.resendKey;
    this.senderEmail = options.senderEmail;
    this.ownerName = process.env.DASHBOARD_OWNER || 'le client';
  }

  // GPT-4o-mini pour taches simples (alertes courtes, briefings internes)
  async _callMini(systemPrompt, userMessage, maxTokens) {
    if (!this.openaiKey) return this.callClaude(systemPrompt, userMessage, maxTokens);
    try {
      const result = await callOpenAI(this.openaiKey, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ], { maxTokens: maxTokens || 500, temperature: 0.7 });
      if (result.usage) {
        appConfig.recordApiSpend('gpt-4o-mini', result.usage.prompt_tokens || 0, result.usage.completion_tokens || 0);
      }
      return result.content;
    } catch (e) {
      log.warn('proactive-report', 'GPT-4o-mini echec, fallback Sonnet:', e.message);
      return this.callClaude(systemPrompt, userMessage, maxTokens);
    }
  }

  // --- Collecte de donnees cross-skill ---

  async collectDailyData() {
    const data = {
      date: new Date().toISOString().split('T')[0],
      hubspot: { contacts: 0, deals: [], pipeline: 0, stagnantDeals: [], urgentDeals: [], dealsAdvanced: [], coldDeals: [], engagedDeals: [], deadDeals: [] },
      emails: { sent: 0, delivered: 0, opened: 0, campaigns: 0, activeCampaigns: 0, opensByDay: {}, bestHour: null, topOpened: [], bounced: 0 },
      leads: { total: 0, enriched: 0, topScore: 0, recentSearches: 0, enrichedThisWeek: 0, topLeads: [], coldLeads: [] },
      content: { generated: 0, thisWeek: 0, byType: {} },
      invoices: { total: 0, draft: 0, sent: 0, paid: 0, overdue: 0, totalBilled: 0 },
      webIntel: { articlesThisWeek: 0, competitorAlerts: 0, relevantArticles: [] },
      budget: { todaySpent: 0, weekSpent: 0, dailyLimit: 5, projection: 0 }
    };

    // HubSpot
    try {
      const HubSpotClient = getHubSpotClient();
      if (HubSpotClient && this.hubspotKey) {
        const hubspot = new HubSpotClient(this.hubspotKey);
        const contactsResult = await hubspot.listContacts(100);
        data.hubspot.contacts = contactsResult.total || contactsResult.contacts.length;

        const dealsResult = await hubspot.listDeals(100);
        data.hubspot.deals = dealsResult.deals || [];
        const now = Date.now();
        const thresholds = storage.getConfig().thresholds;

        // Categoriser les deals par engagement
        data.hubspot.coldDeals = [];
        data.hubspot.engagedDeals = [];
        data.hubspot.deadDeals = [];

        // Charger les emails pour croiser avec les deals
        const amStorage = getStorage('automailer');
        const adminChatId = storage.getConfig().adminChatId;
        const allEmails = amStorage ? (amStorage.getEmails ? amStorage.getEmails(adminChatId) : []) : [];
        const repliedEmails = new Set();
        const openedEmails = new Set();
        for (const em of allEmails) {
          if (em.status === 'replied') repliedEmails.add((em.to || '').toLowerCase());
          if (em.status === 'opened') openedEmails.add((em.to || '').toLowerCase());
        }

        for (const deal of data.hubspot.deals) {
          const amount = parseFloat(deal.amount) || 0;
          const isClosed = deal.stage === 'closedwon' || deal.stage === 'closedlost';

          // Determiner l'engagement via emails et stage
          const updatedAt = deal.updatedAt ? new Date(deal.updatedAt).getTime() : 0;
          const daysSinceUpdate = (now - updatedAt) / (1000 * 60 * 60 * 24);
          const dealNameLower = (deal.name || '').toLowerCase();
          const hasAdvancedStage = deal.stage !== 'appointmentscheduled';

          // Chercher si un email a ete ouvert/repondu pour ce deal (match par nom d'entreprise dans l'email)
          const hasReply = [...repliedEmails].some(e => dealNameLower.includes(e.split('@')[1]?.split('.')[0] || '___'));
          const hasOpen = [...openedEmails].some(e => dealNameLower.includes(e.split('@')[1]?.split('.')[0] || '___'));

          const dealInfo = { name: deal.name, amount: amount, stage: deal.stage, daysSinceUpdate: Math.round(daysSinceUpdate) };

          // Pipeline = uniquement les deals avec reponse (conversation reelle)
          const hasRealConversation = hasReply || deal.stage === 'presentationscheduled' || deal.stage === 'decisionmakerboughtin' || deal.stage === 'contractsent';

          if (isClosed) {
            // Ignore
          } else if (hasRealConversation) {
            data.hubspot.engagedDeals.push(dealInfo);
            data.hubspot.pipeline += amount;
          } else if (daysSinceUpdate > 14) {
            data.hubspot.deadDeals.push(dealInfo);
          } else {
            data.hubspot.coldDeals.push(dealInfo);
          }

          // Deals stagnants
          if (daysSinceUpdate > thresholds.stagnantDealDays && !isClosed) {
            data.hubspot.stagnantDeals.push({
              name: deal.name,
              amount: amount,
              stage: deal.stage,
              daysSinceUpdate: Math.round(daysSinceUpdate)
            });
          }

          // Deals urgents (date de cloture proche)
          if (deal.closeDate) {
            const closeDate = new Date(deal.closeDate).getTime();
            const daysUntilClose = (closeDate - now) / (1000 * 60 * 60 * 24);
            if (daysUntilClose > 0 && daysUntilClose <= thresholds.dealCloseWarningDays && !isClosed) {
              data.hubspot.urgentDeals.push({
                name: deal.name,
                amount: amount,
                closeDate: deal.closeDate,
                daysLeft: Math.round(daysUntilClose)
              });
            }
          }
        }
        // Auto-clean : fermer les deals morts (14j+ sans activite, aucune reponse)
        if (data.hubspot.deadDeals.length > 0) {
          for (const dead of data.hubspot.deadDeals) {
            try {
              const dealToClose = data.hubspot.deals.find(d => d.name === dead.name);
              if (dealToClose && dealToClose.id) {
                await hubspot.updateDeal(dealToClose.id, { dealstage: 'closedlost' });
                log.info('proactive-report', 'Deal mort ferme automatiquement: ' + dead.name + ' (' + dead.daysSinceUpdate + 'j inactif)');
              }
            } catch (cleanErr) {
              log.info('proactive-report', 'Erreur fermeture deal mort ' + dead.name + ':', cleanErr.message);
            }
          }
        }
      }
    } catch (e) {
      log.info('proactive-report', 'Erreur HubSpot:', e.message);
    }

    // AutoMailer — Email Intelligence enrichie
    try {
      const automailerStorage = getStorage('automailer');
      if (automailerStorage) {
        const chatId = storage.getConfig().adminChatId;
        const campaigns = automailerStorage.getCampaigns ? automailerStorage.getCampaigns(chatId) : [];
        data.emails.campaigns = campaigns.length;
        data.emails.activeCampaigns = campaigns.filter(c => c.status === 'active').length;

        const allEmails = automailerStorage.data ? automailerStorage.data.emails || [] : [];
        data.emails.sent = allEmails.length;
        data.emails.delivered = allEmails.filter(e => e.status === 'delivered' || e.status === 'opened').length;
        data.emails.opened = allEmails.filter(e => e.status === 'opened').length;
        data.emails.bounced = allEmails.filter(e => e.status === 'bounced').length;

        // Taux d'ouverture par jour de la semaine
        const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
        const opensByDay = {};
        const sentByDay = {};
        for (const email of allEmails) {
          if (email.sentAt) {
            const day = dayNames[new Date(email.sentAt).getDay()];
            sentByDay[day] = (sentByDay[day] || 0) + 1;
            if (email.status === 'opened' || email.openedAt) {
              opensByDay[day] = (opensByDay[day] || 0) + 1;
            }
          }
        }
        for (const day of dayNames) {
          if (sentByDay[day]) {
            data.emails.opensByDay[day] = {
              sent: sentByDay[day] || 0,
              opened: opensByDay[day] || 0,
              rate: sentByDay[day] > 0 ? Math.round(((opensByDay[day] || 0) / sentByDay[day]) * 100) : 0
            };
          }
        }

        // Meilleure heure d'envoi (basee sur les ouvertures)
        const opensByHour = {};
        for (const email of allEmails) {
          if ((email.status === 'opened' || email.openedAt) && email.sentAt) {
            const hour = new Date(email.sentAt).getHours();
            opensByHour[hour] = (opensByHour[hour] || 0) + 1;
          }
        }
        let bestHour = null;
        let bestHourCount = 0;
        for (const [hour, count] of Object.entries(opensByHour)) {
          if (count > bestHourCount) {
            bestHour = parseInt(hour);
            bestHourCount = count;
          }
        }
        data.emails.bestHour = bestHour;

        // Emails les plus ouverts (par destinataire)
        const recipientOpens = {};
        for (const email of allEmails) {
          if (email.status === 'opened' || email.openedAt) {
            const to = (email.to || '').toLowerCase();
            if (!recipientOpens[to]) recipientOpens[to] = { email: to, subject: email.subject, opens: 0 };
            recipientOpens[to].opens++;
          }
        }
        data.emails.topOpened = Object.values(recipientOpens)
          .sort((a, b) => b.opens - a.opens)
          .slice(0, 5);
      }
    } catch (e) {
      log.info('proactive-report', 'Erreur AutoMailer:', e.message);
    }

    // FlowFast
    try {
      const ffStorage = getStorage('flowfast');
      if (ffStorage) {
        const allLeads = ffStorage.getAllLeads ? ffStorage.getAllLeads() : {};
        data.leads.total = Object.keys(allLeads).length;
        const searches = ffStorage.data ? ffStorage.data.searches || [] : [];
        data.leads.recentSearches = searches.length;
        const scores = Object.values(allLeads).map(l => l.score || 0);
        data.leads.topScore = scores.length > 0 ? Math.max(...scores) : 0;
      }
    } catch (e) {
      log.info('proactive-report', 'Erreur FlowFast:', e.message);
    }

    // Lead Enrich — Lead Intelligence enrichie
    try {
      const leStorage = getStorage('lead-enrich');
      if (leStorage && leStorage.data) {
        const leads = leStorage.data.enrichedLeads || leStorage.data.leads || {};
        data.leads.enriched = Object.keys(leads).length;

        // Leads enrichis cette semaine
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const enrichedThisWeek = Object.values(leads).filter(l => {
          const enrichedAt = l.enrichedAt ? new Date(l.enrichedAt).getTime() : 0;
          return enrichedAt > weekAgo;
        });
        data.leads.enrichedThisWeek = enrichedThisWeek.length;

        // Top 5 leads par score
        const scoredLeads = Object.values(leads)
          .filter(l => l.aiClassification && l.aiClassification.score)
          .sort((a, b) => (b.combinedScore || b.aiClassification.score || 0) - (a.combinedScore || a.aiClassification.score || 0))
          .slice(0, 5);
        data.leads.topLeads = scoredLeads.map(l => {
          const p = (l.enrichData && l.enrichData.person) || (l.apolloData && l.apolloData.person) || {};
          const o = (l.enrichData && l.enrichData.organization) || (l.apolloData && l.apolloData.organization) || {};
          return {
            email: l.email,
            name: p.fullName || p.name || l.email,
            company: o.name || '',
            score: l.combinedScore || (l.aiClassification && l.aiClassification.score) || 0,
            hotLead: l.hotLead || false
          };
        });

        // Leads "refroidis" : pas d'ouverture email depuis 7j
        try {
          const automailerStorage = getStorage('automailer');
          if (automailerStorage && automailerStorage.data) {
            const allEmails = automailerStorage.data.emails || [];
            const now = Date.now();
            for (const lead of Object.values(leads)) {
              if (!lead.aiClassification || (lead.aiClassification.score || 0) < 5) continue;
              const recipientEmails = allEmails.filter(e => (e.to || '').toLowerCase() === lead.email);
              if (recipientEmails.length === 0) continue;
              const lastOpen = recipientEmails
                .filter(e => e.openedAt)
                .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt))[0];
              const lastSent = recipientEmails.sort((a, b) => new Date(b.sentAt || b.createdAt) - new Date(a.sentAt || a.createdAt))[0];
              const lastActivity = lastOpen ? new Date(lastOpen.openedAt).getTime() : (lastSent ? new Date(lastSent.sentAt || lastSent.createdAt).getTime() : 0);
              if (lastActivity > 0 && (now - lastActivity) > 7 * 24 * 60 * 60 * 1000) {
                const p = (lead.enrichData && lead.enrichData.person) || (lead.apolloData && lead.apolloData.person) || {};
                data.leads.coldLeads.push({
                  email: lead.email,
                  name: p.fullName || p.name || lead.email,
                  score: (lead.aiClassification && lead.aiClassification.score) || 0,
                  daysSinceActivity: Math.round((now - lastActivity) / (1000 * 60 * 60 * 24))
                });
              }
            }
            data.leads.coldLeads = data.leads.coldLeads.slice(0, 10);
          }
        } catch (coldErr) {
          log.info('proactive-report', 'Cold leads check skip:', coldErr.message);
        }
      }
    } catch (e) {
      log.info('proactive-report', 'Erreur Lead Enrich:', e.message);
    }

    // Content Gen — Content Intelligence enrichie
    try {
      const cgStorage = getStorage('content-gen');
      if (cgStorage && cgStorage.data) {
        // generatedContents est un objet { chatId: [contents] }
        const allContents = [];
        const contentsMap = cgStorage.data.generatedContents || {};
        for (const chatContents of Object.values(contentsMap)) {
          if (Array.isArray(chatContents)) allContents.push(...chatContents);
        }
        data.content.generated = allContents.length;

        // Contenus generes cette semaine
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const thisWeek = allContents.filter(c => c.createdAt && new Date(c.createdAt).getTime() > weekAgo);
        data.content.thisWeek = thisWeek.length;

        // Types les plus demandes
        const byType = {};
        for (const c of allContents) {
          byType[c.type] = (byType[c.type] || 0) + 1;
        }
        data.content.byType = byType;
      }
    } catch (e) {
      log.info('proactive-report', 'Erreur Content Gen:', e.message);
    }

    // Invoice Bot
    try {
      const ibStorage = getStorage('invoice-bot');
      if (ibStorage && ibStorage.data) {
        const invoices = Object.values(ibStorage.data.invoices || {});
        data.invoices.total = invoices.length;
        data.invoices.draft = invoices.filter(i => i.status === 'draft').length;
        data.invoices.sent = invoices.filter(i => i.status === 'sent').length;
        data.invoices.paid = invoices.filter(i => i.status === 'paid').length;
        data.invoices.overdue = invoices.filter(i => i.status === 'overdue').length;
        data.invoices.totalBilled = invoices.reduce((sum, i) => sum + (i.total || 0), 0);
      }
    } catch (e) {
      log.info('proactive-report', 'Erreur Invoice Bot:', e.message);
    }

    // Web Intelligence — Articles pertinents et alertes concurrents
    try {
      const wiStorage = getStorage('web-intelligence');
      if (wiStorage) {
        const weekArticles = wiStorage.getArticlesLastWeek ? wiStorage.getArticlesLastWeek() : [];
        data.webIntel.articlesThisWeek = weekArticles.length;

        // Alertes concurrents
        const watches = wiStorage.getWatches ? wiStorage.getWatches() : {};
        const competitorWatchIds = Object.keys(watches).filter(id => watches[id].type === 'competitor');
        const competitorArticles = weekArticles.filter(a => competitorWatchIds.includes(a.watchId));
        data.webIntel.competitorAlerts = competitorArticles.length;

        // Articles les plus pertinents (score >= 7)
        data.webIntel.relevantArticles = weekArticles
          .filter(a => (a.relevanceScore || 0) >= 7)
          .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
          .slice(0, 5)
          .map(a => ({ title: a.title, score: a.relevanceScore, source: a.source, isUrgent: a.isUrgent, crmMatch: !!a.crmMatch }));
      }
    } catch (e) {
      log.info('proactive-report', 'Erreur Web Intelligence:', e.message);
    }

    // Budget Intelligence — Depenses API
    try {
      const appConfig = require('../../gateway/app-config.js');
      const budgetStatus = appConfig.getBudgetStatus();
      data.budget.todaySpent = Math.round((budgetStatus.todaySpent || 0) * 100) / 100;
      data.budget.dailyLimit = budgetStatus.dailyLimit || 5;

      // Depense semaine (historique)
      const history = budgetStatus.history || [];
      const weekHistory = history.slice(-7);
      data.budget.weekSpent = Math.round(weekHistory.reduce((sum, d) => sum + (d.spent || 0), 0) * 100) / 100;

      // Projection mensuelle basee sur la moyenne des 7 derniers jours
      const avgDailySpend = weekHistory.length > 0 ? weekHistory.reduce((sum, d) => sum + (d.spent || 0), 0) / weekHistory.length : data.budget.todaySpent;
      data.budget.projection = Math.round(avgDailySpend * 30 * 100) / 100;
    } catch (e) {
      log.info('proactive-report', 'Erreur Budget:', e.message);
    }

    return data;
  }

  async collectWeeklyData() {
    const data = await this.collectDailyData();
    const previousSnapshots = storage.getDailySnapshots(7);
    data.weekHistory = previousSnapshots;
    data.previousWeek = storage.getWeeklySnapshots(1)[0] || null;
    return data;
  }

  async collectMonthlyData() {
    const data = await this.collectDailyData();
    const previousSnapshots = storage.getDailySnapshots(30);
    data.monthHistory = previousSnapshots;
    data.previousMonth = storage.getMonthlySnapshots(1)[0] || null;
    data.weeklySnapshots = storage.getWeeklySnapshots(4);
    return data;
  }

  // --- Generation de rapports via Claude ---

  async generateMorningReport(data, nightlyBriefing) {
    const briefingText = nightlyBriefing && nightlyBriefing.text
      ? '\nBRIEFING NOCTURNE :\n' + nightlyBriefing.text
      : '\nPas de briefing nocturne disponible.';

    const hotLeads = storage.getHotLeads();
    const hotLeadList = Object.keys(hotLeads).length > 0
      ? '\nHOT LEADS (3+ ouvertures) : ' + Object.entries(hotLeads).map(([email, d]) => email + ' (' + d.opens + ' ouvertures)').join(', ')
      : '';

    // Email Intelligence — HTML minimal active depuis v5.3.1 (tracking ouvertures OK)
    const isPlainTextMode = false; // v5.3.1 : HTML minimal pour tracking ouvertures
    const emailOpenRate = data.emails.sent > 0 ? Math.round(data.emails.opened / data.emails.sent * 100) : 0;
    const bestDayEntry = Object.entries(data.emails.opensByDay || {}).sort((a, b) => (b[1].rate || 0) - (a[1].rate || 0))[0];
    const bestDayStr = bestDayEntry ? bestDayEntry[0] + ' (' + bestDayEntry[1].rate + '% ouverture)' : 'N/A';
    const bestHourStr = data.emails.bestHour !== null ? data.emails.bestHour + 'h' : 'N/A';
    const topOpenedStr = (data.emails.topOpened || []).slice(0, 3).map(t => t.email + ' (' + t.opens + ' ouvertures)').join(', ') || 'Aucun';

    // Lead Intelligence
    const topLeadsStr = (data.leads.topLeads || []).slice(0, 3).map(l => l.name + ' (' + l.company + ', score ' + l.score + ')').join(', ') || 'Aucun';
    const coldLeadsStr = (data.leads.coldLeads || []).slice(0, 3).map(l => l.name + ' (' + l.daysSinceActivity + 'j sans activite)').join(', ') || 'Aucun';

    // Content Intelligence
    const contentTypes = Object.entries(data.content.byType || {}).sort((a, b) => b[1] - a[1]).map(([t, c]) => t + ': ' + c).join(', ') || 'Aucun';

    // Web Intelligence
    const webArticlesStr = (data.webIntel.relevantArticles || []).slice(0, 3).map(a => a.title + ' (score ' + a.score + ')').join(', ') || 'Aucun';

    const plainTextNote = isPlainTextMode
      ? '\n⚠️ IMPORTANT : Les emails sont envoyes en PLAIN TEXT (pas de HTML). Le taux d\'ouverture est NON MESURABLE car il n\'y a pas de pixel de tracking. Ne commente PAS le taux d\'ouverture et ne dis pas que c\'est un probleme. Concentre-toi sur les deliveries et les bounces.'
      : '';

    const prompt = `DONNEES DU JOUR :
- Contacts HubSpot : ${data.hubspot.contacts}
- Pipeline engage : ${data.hubspot.pipeline} EUR (${data.hubspot.engagedDeals.length} deals engages) | ${data.hubspot.coldDeals.length} prospects froids en attente${data.hubspot.deadDeals.length > 0 ? ' | ' + data.hubspot.deadDeals.length + ' morts (14j+ sans activite)' : ''}
- Emails envoyes : ${data.emails.sent}, delivered : ${data.emails.delivered}, bounced : ${data.emails.bounced}${isPlainTextMode ? '' : ', ouverts : ' + data.emails.opened + ' (taux: ' + emailOpenRate + '%)'}
- Campagnes actives : ${data.emails.activeCampaigns}${isPlainTextMode ? '' : '\n- Meilleur jour d\'envoi : ' + bestDayStr + ' | Meilleure heure : ' + bestHourStr}
- Leads trouves : ${data.leads.total}, enrichis : ${data.leads.enriched} (+${data.leads.enrichedThisWeek} cette semaine)
- Top leads : ${topLeadsStr}
- Leads refroidis (7j+ sans activite) : ${coldLeadsStr}
- Contenus generes : ${data.content.generated} (cette semaine: ${data.content.thisWeek}) — Types: ${contentTypes}
- Factures : ${data.invoices.total} (${data.invoices.paid} payees, ${data.invoices.overdue} en retard)
- Veille web : ${data.webIntel.articlesThisWeek} articles cette semaine, ${data.webIntel.competitorAlerts} alertes concurrents
- Articles pertinents : ${webArticlesStr}
- Budget API : ${data.budget.todaySpent}$ aujourd'hui / ${data.budget.dailyLimit}$ limite | Semaine: ${data.budget.weekSpent}$ | Projection mois: ${data.budget.projection}$
${hotLeadList}${plainTextNote}
${briefingText}`;

    const systemPrompt = `Tu es iFIND, l'assistant IA de ${this.ownerName}. Tu envoies un rapport matinal.

REGLES :
- Parle comme un assistant pro mais decontracte. Tutoie ${this.ownerName}.
- Commence par un "Bonjour" ou "Salut" naturel et varie
- Donne les chiffres importants de facon conversationnelle, pas en tableau
- Si hot leads ou deals urgents, mets-les en avant
- Si rien de special, sois bref et propose une action
- Format Telegram Markdown : *gras*, _italique_
- Maximum 15 lignes
- Termine par une suggestion ou une motivation
- JAMAIS mentionner Claude, OpenAI, GPT ou IA`;

    try {
      return await this.callClaude(systemPrompt, prompt, 800);
    } catch (e) {
      log.info('proactive-report', 'Erreur generation morning report:', e.message);
      return this._fallbackMorningReport(data);
    }
  }

  async generatePipelineAlerts(stagnantDeals, urgentDeals) {
    if (stagnantDeals.length === 0 && urgentDeals.length === 0) return null;

    const prompt = `DEALS STAGNANTS (pas d'activite depuis ${storage.getConfig().thresholds.stagnantDealDays}+ jours) :
${stagnantDeals.length > 0 ? stagnantDeals.map(d => '- ' + d.name + ' (' + d.amount + ' EUR) — ' + d.daysSinceUpdate + ' jours sans activite').join('\n') : 'Aucun'}

DEALS URGENTS (date de cloture proche) :
${urgentDeals.length > 0 ? urgentDeals.map(d => '- ' + d.name + ' (' + d.amount + ' EUR) — cloture dans ' + d.daysLeft + ' jour(s)').join('\n') : 'Aucun'}`;

    const systemPrompt = `Tu es iFIND. Tu alertes ${this.ownerName} sur les deals qui necessitent son attention.

REGLES :
- Sois direct et actionnable. Pas de blabla.
- Pour chaque deal, dis clairement le probleme et propose une action
- Tutoie, ton decontracte mais serieux
- Format Telegram Markdown : *gras*, _italique_
- Maximum 10 lignes
- Propose de creer une tache ou de relancer
- JAMAIS mentionner Claude, OpenAI, GPT ou IA`;

    try {
      return await this._callMini(systemPrompt, prompt, 500);
    } catch (e) {
      log.info('proactive-report', 'Erreur generation pipeline alerts:', e.message);
      return null;
    }
  }

  async generateWeeklyReport(data) {
    const prev = data.previousWeek;
    const deltaInfo = prev
      ? `\nVS SEMAINE PRECEDENTE :
- Contacts : ${prev.hubspot ? (data.hubspot.contacts - (prev.hubspot.contacts || 0)) : '?'} nouveau(x)
- Pipeline : ${prev.hubspot ? (data.hubspot.pipeline - (prev.hubspot.pipeline || 0)) : '?'} EUR
- Emails ouverts : ${prev.emails ? (data.emails.opened - (prev.emails.opened || 0)) : '?'}`
      : '\nPas de donnees de la semaine precedente.';

    // Enrichissements hebdo
    const weekOpenRate = data.emails.sent > 0 ? Math.round(data.emails.opened / data.emails.sent * 100) : 0;
    const weekBestDay = Object.entries(data.emails.opensByDay || {}).sort((a, b) => (b[1].rate || 0) - (a[1].rate || 0))[0];
    const weekTopLeads = (data.leads.topLeads || []).slice(0, 5).map(l => '  - ' + l.name + ' (' + l.company + ', score ' + l.score + (l.hotLead ? ', HOT' : '') + ')').join('\n') || '  Aucun';
    const weekColdLeads = (data.leads.coldLeads || []).slice(0, 5).map(l => '  - ' + l.name + ' (' + l.daysSinceActivity + 'j inactif)').join('\n') || '  Aucun';
    const weekContentTypes = Object.entries(data.content.byType || {}).sort((a, b) => b[1] - a[1]).map(([t, c]) => t + ': ' + c).join(', ') || 'Aucun';
    const weekArticles = (data.webIntel.relevantArticles || []).slice(0, 3).map(a => '  - ' + a.title + ' (score ' + a.score + (a.isUrgent ? ' URGENT' : '') + ')').join('\n') || '  Aucun';

    const prompt = `BILAN HEBDOMADAIRE :
- Contacts HubSpot : ${data.hubspot.contacts}
- Pipeline engage : ${data.hubspot.pipeline} EUR (${data.hubspot.engagedDeals.length} deals engages) | ${data.hubspot.coldDeals.length} prospects froids${data.hubspot.deadDeals.length > 0 ? ' | ' + data.hubspot.deadDeals.length + ' morts' : ''}
- Deals stagnants : ${data.hubspot.stagnantDeals.length}
- Emails envoyes : ${data.emails.sent}, ouverts : ${data.emails.opened} (taux: ${weekOpenRate}%), bounced : ${data.emails.bounced}
- Meilleur jour d'envoi : ${weekBestDay ? weekBestDay[0] + ' (' + weekBestDay[1].rate + '%)' : 'N/A'}
- Campagnes : ${data.emails.campaigns} (${data.emails.activeCampaigns} actives)
- Leads trouves : ${data.leads.total}, enrichis : ${data.leads.enriched} (+${data.leads.enrichedThisWeek} cette semaine)
- TOP 5 LEADS :
${weekTopLeads}
- LEADS REFROIDIS (7j+ sans activite) :
${weekColdLeads}
- Contenus generes : ${data.content.generated} (cette semaine: ${data.content.thisWeek}) — ${weekContentTypes}
- Factures : ${data.invoices.total} (CA facture : ${data.invoices.totalBilled} EUR)
- VEILLE WEB : ${data.webIntel.articlesThisWeek} articles, ${data.webIntel.competitorAlerts} alertes concurrents
- ARTICLES PERTINENTS :
${weekArticles}
- BUDGET API : ${data.budget.weekSpent}$ cette semaine | Projection mois: ${data.budget.projection}$
${deltaInfo}`;

    const systemPrompt = `Tu es iFIND. Tu envoies le rapport hebdomadaire du lundi matin a ${this.ownerName}.

REGLES :
- Structure par categories mais de facon naturelle et conversationnelle
- Compare avec la semaine precedente si dispo
- Mets en avant les points positifs ET les points d'attention
- Termine par 2-3 priorites pour la semaine
- Tutoie ${this.ownerName}, ton motive et pro
- Format Telegram Markdown : *gras*, _italique_
- Maximum 25 lignes
- JAMAIS mentionner Claude, OpenAI, GPT ou IA`;

    try {
      return await this.callClaudeOpus(systemPrompt, prompt, 1500);
    } catch (e) {
      log.info('proactive-report', 'Erreur generation weekly report:', e.message);
      return this._fallbackWeeklyReport(data);
    }
  }

  async generateMonthlyReport(data) {
    const prev = data.previousMonth;
    const deltaInfo = prev
      ? `\nVS MOIS PRECEDENT :
- Contacts : ${prev.hubspot ? '+' + (data.hubspot.contacts - (prev.hubspot.contacts || 0)) : '?'}
- Pipeline : ${prev.hubspot ? (data.hubspot.pipeline - (prev.hubspot.pipeline || 0)) + ' EUR' : '?'}
- Emails : ${prev.emails ? '+' + (data.emails.sent - (prev.emails.sent || 0)) + ' envoyes' : '?'}`
      : '\nPas de donnees du mois precedent.';

    const monthOpenRate = data.emails.sent > 0 ? Math.round(data.emails.opened / data.emails.sent * 100) : 0;
    const monthBestDay = Object.entries(data.emails.opensByDay || {}).sort((a, b) => (b[1].rate || 0) - (a[1].rate || 0))[0];
    const monthTopLeads = (data.leads.topLeads || []).slice(0, 5).map(l => '  - ' + l.name + ' (' + l.company + ', score ' + l.score + ')').join('\n') || '  Aucun';
    const monthContentTypes = Object.entries(data.content.byType || {}).sort((a, b) => b[1] - a[1]).map(([t, c]) => t + ': ' + c).join(', ') || 'Aucun';

    const prompt = `BILAN MENSUEL :
- Contacts HubSpot : ${data.hubspot.contacts}
- Pipeline engage : ${data.hubspot.pipeline} EUR (${data.hubspot.engagedDeals.length} deals engages) | ${data.hubspot.coldDeals.length} froids${data.hubspot.deadDeals.length > 0 ? ' | ' + data.hubspot.deadDeals.length + ' morts' : ''}
- Deals stagnants : ${data.hubspot.stagnantDeals.length}
- Emails envoyes : ${data.emails.sent}, ouverts : ${data.emails.opened} (taux: ${monthOpenRate}%)
- Bounced : ${data.emails.bounced}
- Meilleur jour : ${monthBestDay ? monthBestDay[0] + ' (' + monthBestDay[1].rate + '%)' : 'N/A'} | Meilleure heure : ${data.emails.bestHour !== null ? data.emails.bestHour + 'h' : 'N/A'}
- Leads trouves : ${data.leads.total}, enrichis : ${data.leads.enriched}
- TOP LEADS :
${monthTopLeads}
- Leads refroidis : ${(data.leads.coldLeads || []).length}
- Contenus generes : ${data.content.generated} — ${monthContentTypes}
- Factures : ${data.invoices.total}, CA facture : ${data.invoices.totalBilled} EUR
- Factures payees : ${data.invoices.paid}, en retard : ${data.invoices.overdue}
- Veille web : ${data.webIntel.articlesThisWeek} articles pertinents, ${data.webIntel.competitorAlerts} alertes concurrents
- Budget API : ${data.budget.weekSpent}$ semaine | Projection mois: ${data.budget.projection}$
${deltaInfo}`;

    const systemPrompt = `Tu es iFIND. Tu envoies le bilan mensuel a ${this.ownerName}.

REGLES :
- Fais un vrai bilan : points forts, points faibles, tendances
- Compare avec le mois precedent si dispo
- Propose 3-5 objectifs pour le mois prochain
- Ton pro et motive, comme un associe
- Tutoie ${this.ownerName}
- Format Telegram Markdown : *gras*, _italique_
- Maximum 30 lignes
- JAMAIS mentionner Claude, OpenAI, GPT ou IA`;

    try {
      return await this.callClaudeOpus(systemPrompt, prompt, 2000);
    } catch (e) {
      log.info('proactive-report', 'Erreur generation monthly report:', e.message);
      return this._fallbackMonthlyReport(data);
    }
  }

  async generateHotLeadAlert(email, opens, leadInfo) {
    const prompt = `HOT LEAD DETECTE :
- Email : ${email}
- Ouvertures : ${opens} fois
- Info lead : ${leadInfo || 'Pas de details supplementaires'}`;

    const systemPrompt = `Tu es iFIND. Tu alertes ${this.ownerName} qu'un lead est tres actif (a ouvert son email plusieurs fois).

REGLES :
- Sois direct et enthousiaste mais pas exagere
- Donne le contexte du lead si dispo
- Propose une action concrete (relancer, proposer un RDV)
- Tutoie, ton decontracte
- Format Telegram Markdown : *gras*, _italique_
- Maximum 5 lignes
- JAMAIS mentionner Claude, OpenAI, GPT ou IA`;

    try {
      return await this._callMini(systemPrompt, prompt, 300);
    } catch (e) {
      return 'Un lead vient d\'ouvrir ton email ' + opens + ' fois : *' + email + '*. Ca vaut le coup de le relancer !';
    }
  }

  async generateNightlyBriefing(data) {
    const prompt = `DONNEES POUR BRIEFING NOCTURNE :
- Contacts HubSpot : ${data.hubspot.contacts}
- Pipeline : ${data.hubspot.pipeline} EUR
- Deals ouverts : ${data.hubspot.deals.filter(d => d.stage !== 'closedwon' && d.stage !== 'closedlost').length}
- Deals stagnants : ${data.hubspot.stagnantDeals.length}
- Emails : ${data.emails.sent} envoyes, ${data.emails.opened} ouverts
- Leads enrichis : ${data.leads.enriched}`;

    const systemPrompt = `Analyse ces donnees et redige un briefing concis (5-8 lignes) pour un rapport matinal.

REGLES :
- Resume les points cles
- Identifie les opportunites et les risques
- Sois factuel et concis
- Pas de salutations ni de formules de politesse (ce n'est qu'un briefing interne)
- JAMAIS mentionner Claude, OpenAI, GPT ou IA`;

    try {
      return await this._callMini(systemPrompt, prompt, 500);
    } catch (e) {
      log.info('proactive-report', 'Erreur generation nightly briefing:', e.message);
      return null;
    }
  }

  // --- Fallbacks (si Claude echoue) ---

  _fallbackMorningReport(data) {
    const lines = [
      'Bonjour ! Voici le point du matin.',
      '',
      'Pipeline engage : *' + data.hubspot.pipeline + ' EUR* (' + data.hubspot.engagedDeals.length + ' deals engages) | ' + data.hubspot.coldDeals.length + ' prospects froids',
      'Emails : ' + data.emails.sent + ' envoyes, ' + data.emails.opened + ' ouverts',
      'Leads : ' + data.leads.total + ' trouves, ' + data.leads.enriched + ' enrichis',
    ];
    if (data.invoices.overdue > 0) lines.push('Factures en retard : ' + data.invoices.overdue);
    lines.push('', 'Bonne journee !');
    return lines.join('\n');
  }

  _fallbackWeeklyReport(data) {
    return [
      'Bilan de la semaine :',
      '',
      'Pipeline : *' + data.hubspot.pipeline + ' EUR*',
      'Emails : ' + data.emails.sent + ' envoyes, ' + data.emails.opened + ' ouverts',
      'Leads : ' + data.leads.total + ' / Enrichis : ' + data.leads.enriched,
      'Factures : ' + data.invoices.total + ' (CA: ' + data.invoices.totalBilled + ' EUR)',
      '',
      'Bonne semaine !'
    ].join('\n');
  }

  _fallbackMonthlyReport(data) {
    return [
      'Bilan du mois :',
      '',
      'Pipeline : *' + data.hubspot.pipeline + ' EUR*',
      'Emails : ' + data.emails.sent + ' / Ouverts : ' + data.emails.opened,
      'Leads : ' + data.leads.total + ' / Enrichis : ' + data.leads.enriched,
      'CA facture : *' + data.invoices.totalBilled + ' EUR*',
      '',
      'Go pour le mois prochain !'
    ].join('\n');
  }
}

module.exports = ReportGenerator;
