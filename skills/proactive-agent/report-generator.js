// Proactive Agent - Generateur de rapports
// Collecte cross-skill + generation de texte via Claude

const storage = require('./storage.js');

// --- Cross-skill imports (dual-path pattern) ---

function getStorage(skillName) {
  const paths = {
    'flowfast': ['../flowfast/storage.js', '/app/skills/flowfast/storage.js'],
    'automailer': ['../automailer/storage.js', '/app/skills/automailer/storage.js'],
    'crm-pilot': ['../crm-pilot/storage.js', '/app/skills/crm-pilot/storage.js'],
    'lead-enrich': ['../lead-enrich/storage.js', '/app/skills/lead-enrich/storage.js'],
    'content-gen': ['../content-gen/storage.js', '/app/skills/content-gen/storage.js'],
    'invoice-bot': ['../invoice-bot/storage.js', '/app/skills/invoice-bot/storage.js']
  };
  const p = paths[skillName];
  if (!p) return null;
  try { return require(p[0]); }
  catch (e) {
    try { return require(p[1]); }
    catch (e2) { return null; }
  }
}

function getHubSpotClient() {
  try { return require('../crm-pilot/hubspot-client.js'); }
  catch (e) {
    try { return require('/app/skills/crm-pilot/hubspot-client.js'); }
    catch (e2) { return null; }
  }
}

function getResendClient() {
  try { return require('../automailer/resend-client.js'); }
  catch (e) {
    try { return require('/app/skills/automailer/resend-client.js'); }
    catch (e2) { return null; }
  }
}

class ReportGenerator {
  constructor(options) {
    this.callClaude = options.callClaude;
    this.callClaudeOpus = options.callClaudeOpus || options.callClaude;
    this.hubspotKey = options.hubspotKey;
    this.resendKey = options.resendKey;
    this.senderEmail = options.senderEmail;
  }

  // --- Collecte de donnees cross-skill ---

  async collectDailyData() {
    const data = {
      date: new Date().toISOString().split('T')[0],
      hubspot: { contacts: 0, deals: [], pipeline: 0, stagnantDeals: [], urgentDeals: [] },
      emails: { sent: 0, delivered: 0, opened: 0, campaigns: 0, activeCampaigns: 0 },
      leads: { total: 0, enriched: 0, topScore: 0, recentSearches: 0 },
      content: { generated: 0 },
      invoices: { total: 0, draft: 0, sent: 0, paid: 0, overdue: 0, totalBilled: 0 }
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

        for (const deal of data.hubspot.deals) {
          const amount = parseFloat(deal.amount) || 0;
          if (deal.stage !== 'closedwon' && deal.stage !== 'closedlost') {
            data.hubspot.pipeline += amount;
          }

          // Deals stagnants
          const updatedAt = deal.updatedAt ? new Date(deal.updatedAt).getTime() : 0;
          const daysSinceUpdate = (now - updatedAt) / (1000 * 60 * 60 * 24);
          if (daysSinceUpdate > thresholds.stagnantDealDays && deal.stage !== 'closedwon' && deal.stage !== 'closedlost') {
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
            if (daysUntilClose > 0 && daysUntilClose <= thresholds.dealCloseWarningDays && deal.stage !== 'closedwon' && deal.stage !== 'closedlost') {
              data.hubspot.urgentDeals.push({
                name: deal.name,
                amount: amount,
                closeDate: deal.closeDate,
                daysLeft: Math.round(daysUntilClose)
              });
            }
          }
        }
      }
    } catch (e) {
      console.log('[report-gen] Erreur HubSpot:', e.message);
    }

    // AutoMailer
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
      }
    } catch (e) {
      console.log('[report-gen] Erreur AutoMailer:', e.message);
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
      console.log('[report-gen] Erreur FlowFast:', e.message);
    }

    // Lead Enrich
    try {
      const leStorage = getStorage('lead-enrich');
      if (leStorage && leStorage.data) {
        const leads = leStorage.data.leads || {};
        data.leads.enriched = Object.keys(leads).length;
      }
    } catch (e) {
      console.log('[report-gen] Erreur Lead Enrich:', e.message);
    }

    // Content Gen
    try {
      const cgStorage = getStorage('content-gen');
      if (cgStorage && cgStorage.data) {
        const contents = cgStorage.data.contents || [];
        data.content.generated = contents.length;
      }
    } catch (e) {
      console.log('[report-gen] Erreur Content Gen:', e.message);
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
      console.log('[report-gen] Erreur Invoice Bot:', e.message);
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

    const prompt = `DONNEES DU JOUR :
- Contacts HubSpot : ${data.hubspot.contacts}
- Pipeline actif : ${data.hubspot.pipeline} EUR (${data.hubspot.deals.filter(d => d.stage !== 'closedwon' && d.stage !== 'closedlost').length} deals)
- Emails envoyes : ${data.emails.sent}, ouverts : ${data.emails.opened}
- Campagnes actives : ${data.emails.activeCampaigns}
- Leads trouves : ${data.leads.total}, enrichis : ${data.leads.enriched}
- Contenus generes : ${data.content.generated}
- Factures : ${data.invoices.total} (${data.invoices.paid} payees, ${data.invoices.overdue} en retard)
${hotLeadList}
${briefingText}`;

    const systemPrompt = `Tu es MoltBot, l'assistant IA de Jojo. Tu envoies un rapport matinal.

REGLES :
- Parle comme un assistant pro mais decontracte. Tutoie Jojo.
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
      console.log('[report-gen] Erreur generation morning report:', e.message);
      return this._fallbackMorningReport(data);
    }
  }

  async generatePipelineAlerts(stagnantDeals, urgentDeals) {
    if (stagnantDeals.length === 0 && urgentDeals.length === 0) return null;

    const prompt = `DEALS STAGNANTS (pas d'activite depuis ${storage.getConfig().thresholds.stagnantDealDays}+ jours) :
${stagnantDeals.length > 0 ? stagnantDeals.map(d => '- ' + d.name + ' (' + d.amount + ' EUR) — ' + d.daysSinceUpdate + ' jours sans activite').join('\n') : 'Aucun'}

DEALS URGENTS (date de cloture proche) :
${urgentDeals.length > 0 ? urgentDeals.map(d => '- ' + d.name + ' (' + d.amount + ' EUR) — cloture dans ' + d.daysLeft + ' jour(s)').join('\n') : 'Aucun'}`;

    const systemPrompt = `Tu es MoltBot. Tu alertes Jojo sur les deals qui necessitent son attention.

REGLES :
- Sois direct et actionnable. Pas de blabla.
- Pour chaque deal, dis clairement le probleme et propose une action
- Tutoie, ton decontracte mais serieux
- Format Telegram Markdown : *gras*, _italique_
- Maximum 10 lignes
- Propose de creer une tache ou de relancer
- JAMAIS mentionner Claude, OpenAI, GPT ou IA`;

    try {
      return await this.callClaude(systemPrompt, prompt, 500);
    } catch (e) {
      console.log('[report-gen] Erreur generation pipeline alerts:', e.message);
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

    const prompt = `BILAN HEBDOMADAIRE :
- Contacts HubSpot : ${data.hubspot.contacts}
- Pipeline actif : ${data.hubspot.pipeline} EUR (${data.hubspot.deals.filter(d => d.stage !== 'closedwon' && d.stage !== 'closedlost').length} deals)
- Deals stagnants : ${data.hubspot.stagnantDeals.length}
- Emails envoyes : ${data.emails.sent}, ouverts : ${data.emails.opened}
- Campagnes : ${data.emails.campaigns} (${data.emails.activeCampaigns} actives)
- Leads trouves : ${data.leads.total}, enrichis : ${data.leads.enriched}
- Contenus generes : ${data.content.generated}
- Factures : ${data.invoices.total} (CA facture : ${data.invoices.totalBilled} EUR)
${deltaInfo}`;

    const systemPrompt = `Tu es MoltBot. Tu envoies le rapport hebdomadaire du lundi matin a Jojo.

REGLES :
- Structure par categories mais de facon naturelle et conversationnelle
- Compare avec la semaine precedente si dispo
- Mets en avant les points positifs ET les points d'attention
- Termine par 2-3 priorites pour la semaine
- Tutoie, ton motive et pro
- Format Telegram Markdown : *gras*, _italique_
- Maximum 25 lignes
- JAMAIS mentionner Claude, OpenAI, GPT ou IA`;

    try {
      return await this.callClaudeOpus(systemPrompt, prompt, 1500);
    } catch (e) {
      console.log('[report-gen] Erreur generation weekly report:', e.message);
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

    const prompt = `BILAN MENSUEL :
- Contacts HubSpot : ${data.hubspot.contacts}
- Pipeline actif : ${data.hubspot.pipeline} EUR
- Deals stagnants : ${data.hubspot.stagnantDeals.length}
- Emails envoyes : ${data.emails.sent}, ouverts : ${data.emails.opened}
- Taux ouverture : ${data.emails.sent > 0 ? Math.round(data.emails.opened / data.emails.sent * 100) : 0}%
- Leads trouves : ${data.leads.total}, enrichis : ${data.leads.enriched}
- Contenus generes : ${data.content.generated}
- Factures : ${data.invoices.total}, CA facture : ${data.invoices.totalBilled} EUR
- Factures payees : ${data.invoices.paid}, en retard : ${data.invoices.overdue}
${deltaInfo}`;

    const systemPrompt = `Tu es MoltBot. Tu envoies le bilan mensuel a Jojo.

REGLES :
- Fais un vrai bilan : points forts, points faibles, tendances
- Compare avec le mois precedent si dispo
- Propose 3-5 objectifs pour le mois prochain
- Ton pro et motive, comme un associe
- Tutoie Jojo
- Format Telegram Markdown : *gras*, _italique_
- Maximum 30 lignes
- JAMAIS mentionner Claude, OpenAI, GPT ou IA`;

    try {
      return await this.callClaudeOpus(systemPrompt, prompt, 2000);
    } catch (e) {
      console.log('[report-gen] Erreur generation monthly report:', e.message);
      return this._fallbackMonthlyReport(data);
    }
  }

  async generateHotLeadAlert(email, opens, leadInfo) {
    const prompt = `HOT LEAD DETECTE :
- Email : ${email}
- Ouvertures : ${opens} fois
- Info lead : ${leadInfo || 'Pas de details supplementaires'}`;

    const systemPrompt = `Tu es MoltBot. Tu alertes Jojo qu'un lead est tres actif (a ouvert son email plusieurs fois).

REGLES :
- Sois direct et enthousiaste mais pas exagere
- Donne le contexte du lead si dispo
- Propose une action concrete (relancer, proposer un RDV)
- Tutoie, ton decontracte
- Format Telegram Markdown : *gras*, _italique_
- Maximum 5 lignes
- JAMAIS mentionner Claude, OpenAI, GPT ou IA`;

    try {
      return await this.callClaude(systemPrompt, prompt, 300);
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
      return await this.callClaude(systemPrompt, prompt, 500);
    } catch (e) {
      console.log('[report-gen] Erreur generation nightly briefing:', e.message);
      return null;
    }
  }

  // --- Fallbacks (si Claude echoue) ---

  _fallbackMorningReport(data) {
    const lines = [
      'Bonjour ! Voici le point du matin.',
      '',
      'Pipeline actif : *' + data.hubspot.pipeline + ' EUR* (' + data.hubspot.deals.filter(d => d.stage !== 'closedwon' && d.stage !== 'closedlost').length + ' deals)',
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
