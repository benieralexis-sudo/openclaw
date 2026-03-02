// iFIND - Skill Router (classification des intentions)
// Extrait de telegram-router.js — fastClassify, classifySkill, checkStickiness

const log = require('./logger.js');

// --- Conversation stickiness : reste sur le meme skill si message de continuation ---
const STICKINESS_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const CONTINUATION_PATTERN = /^(oui|non|ok|go|envoie|fais|lance|montre|ajuste|modifie|change|parfait|super|merci|nice|top|cool|ca marche|d'accord|valide|confirme|annule|stop|attends|pas encore|plutot|exactement|voila|c'est bon|on y va|balance|envoyer|programme|planifie|demain|ce soir|a \d+h|lui|elle|leur|les|le|la|ca|c'est|je pense|tu peux|s'il te plait)/i;
// Mots-cles qui forcent un reset de stickiness (changement de sujet explicite)
const STICKINESS_RESET_PATTERN = /^(bonjour|salut|hello|hey|hi|bonsoir|aide|help|menu|accueil|quoi de neuf|c'est quoi|que sais-tu faire|commandes?)\b/i;

/**
 * Pre-filtre par mots-cles (zero token).
 * @param {string} text - message utilisateur brut
 * @returns {string|null} skill name ou null si fallback NLP necessaire
 */
function fastClassify(text) {
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Patterns exacts — zero ambiguite
  // ORDRE IMPORTANT : autonomous-pilot AVANT automailer
  // "redige un email pour Nadine" = prospect (autonomous-pilot), PAS email marketing
  const patterns = {
    'autonomous-pilot': /\b(pilot|autonome?|brain|objectif|critere|checklist|diagnostic|cycle|prochain.*email|quand.*envoi|prochaine?.*prospection|avancement|ou.*en.*es|lead.*trouve|resultat.*prospection|relance[rs]?|follow.?up|message.*personnalise?|mail.*prospect)\b|(?:redige|ecri[st]|prepare|envoie|draft).*(?:email|mail|message).*pour\b/,
    'automailer': /\b(campagne|template|newsletter|liste.*contact|import.*csv|stats.*email|taux.*ouverture|creer?.*campagne|lance.*campagne)\b/,
    'crm-pilot': /\b(crm|hubspot|pipeline|deal|offre|fiche.*contact|note|tache|rappel|commercial)\b/,
    'inbox-manager': /\b(inbox|boite.*reception|reponse.*email|email.*recu|imap|reponse.*lead|mail.*entrant)\b/,
    'meeting-scheduler': /\b(rdv|rendez.?vous|meeting|booking|cale[rz]?|reserve[rz]?|planifi|cal\.?com|creneau)\b/,
    'invoice-bot': /\b(factur|devis|paiement|rib|siret|client.*factur)\b/,
    'proactive-agent': /\b(rapport|resume|recap|hebdo|mensuel|alertes?.*pipeline|mode.*proactif)\b/,
    'self-improve': /\b(amelior|optimis|recommandation|performance|metriques?|rollback|auto.?apply)\b/,
    'web-intelligence': /\b(veille|surveill|concurrent|news|article|tendance|rss|scan.*web|google.*news)\b/,
    'system-advisor': /\b(systeme|memoire|ram|cpu|disque|uptime|health|sante.*bot|erreurs?.*recente)\b/
  };

  for (const [skill, regex] of Object.entries(patterns)) {
    if (regex.test(t)) return skill;
  }
  return null; // null = fallback vers NLP
}

/**
 * Classification NLP complete avec contexte conversationnel.
 * @param {string} message - message utilisateur
 * @param {string} chatId
 * @param {object} deps - { callOpenAINLP, getHistoryContext, userActiveSkill, handlers }
 *   handlers: map { skillName: handler } pour detecter les workflows multi-etapes
 * @returns {Promise<string>} skill name
 */
async function classifySkill(message, chatId, deps) {
  const { callOpenAINLP, getHistoryContext, userActiveSkill, handlers } = deps;
  const id = String(chatId);
  const text = message.toLowerCase().trim();

  // Commande /start uniquement
  if (text === '/start') return 'general';

  // Workflows multi-etapes en cours : garder le skill actif (indispensable)
  const h = handlers;
  if (h.automailerHandler && (h.automailerHandler.pendingImports[id] || h.automailerHandler.pendingConversations[id] || h.automailerHandler.pendingEmails[id])) return 'automailer';
  if (h.crmPilotHandler && (h.crmPilotHandler.pendingConversations[id] || h.crmPilotHandler.pendingConfirmations[id])) return 'crm-pilot';
  if (h.invoiceBotHandler && (h.invoiceBotHandler.pendingConversations[id] || h.invoiceBotHandler.pendingConfirmations[id])) return 'invoice-bot';
  if (h.proactiveHandler && (h.proactiveHandler.pendingConversations[id] || h.proactiveHandler.pendingConfirmations[id])) return 'proactive-agent';
  if (h.selfImproveHandler && (h.selfImproveHandler.pendingConversations[id] || h.selfImproveHandler.pendingConfirmations[id])) return 'self-improve';
  if (h.webIntelHandler && (h.webIntelHandler.pendingConversations[id] || h.webIntelHandler.pendingConfirmations[id])) return 'web-intelligence';
  if (h.systemAdvisorHandler && (h.systemAdvisorHandler.pendingConversations[id] || h.systemAdvisorHandler.pendingConfirmations[id])) return 'system-advisor';
  if (h.inboxHandler && (h.inboxHandler.pendingConversations[id] || h.inboxHandler.pendingConfirmations[id])) return 'inbox-manager';
  if (h.meetingHandler && (h.meetingHandler.pendingConversations[id] || h.meetingHandler.pendingConfirmations[id])) return 'meeting-scheduler';

  // Classification NLP avec contexte conversationnel
  const historyContext = getHistoryContext(chatId);
  const lastSkill = userActiveSkill[id] || 'aucun';

  const systemPrompt = `Tu es le cerveau d'un bot Telegram appele ${process.env.CLIENT_NAME || 'iFIND'}. Tu dois comprendre l'INTENTION de l'utilisateur pour router son message vers le bon skill.

SKILLS DISPONIBLES :
- "automailer" : campagnes email automatisees — creer/gerer des campagnes, envoyer des emails, gerer des listes de contacts email, voir les stats d'envoi, templates email. "comment vont mes campagnes ?" = automailer.
- "crm-pilot" : gestion CRM (HubSpot) — pipeline commercial, offres/deals, fiches contacts, notes, taches, rappels, rapports hebdo, suivi commercial.
- "invoice-bot" : facturation — creer/envoyer des factures, gerer des clients (facturation), suivi des paiements, coordonnees bancaires/RIB, devis.
- "proactive-agent" : mode proactif, rapports automatiques, alertes pipeline, monitoring — "rapport maintenant", "rapport de la semaine", "rapport du mois", "mes alertes", "mode proactif status", "active le mode proactif", "historique des alertes". Tout ce qui concerne des rapports recapitulatifs cross-skills ou le monitoring automatique.
- "self-improve" : amelioration automatique du bot, optimisation des performances, recommandations IA, feedback loop — "tes recommandations", "analyse maintenant", "applique les ameliorations", "metriques", "historique des ameliorations", "rollback", "status self-improve", "comment ca performe ?". Tout ce qui concerne l'optimisation du bot, l'amelioration continue, et les suggestions d'amelioration.
- "web-intelligence" : veille web, surveillance de prospects/concurrents/secteur, news, articles, tendances, RSS, Google News — "surveille un concurrent", "mes veilles", "quoi de neuf ?", "articles", "tendances", "stats veille", "ajoute un flux RSS", "scan maintenant", "des nouvelles ?". Tout ce qui concerne la surveillance web, les actualites, la veille concurrentielle ou sectorielle.
- "system-advisor" : monitoring technique du bot, sante du systeme, RAM, CPU, disque, uptime, erreurs, health check, alertes systeme, performances, temps de reponse des skills — "status systeme", "comment va le bot ?", "utilisation memoire", "espace disque", "erreurs recentes", "check sante", "rapport systeme", "uptime", "alertes systeme", "temps de reponse", "performances". ATTENTION : distinct de proactive-agent qui gere les rapports BUSINESS (pipeline, campagnes). System-advisor gere le monitoring TECHNIQUE (serveur, memoire, CPU).
- "autonomous-pilot" : pilotage autonome du bot, objectifs hebdomadaires de prospection, criteres de recherche automatique, checklist diagnostic, historique des actions automatiques, forcer un cycle brain, pause/reprise du pilot, apprentissages, RELANCES de prospects, messages personnalises pour un prospect specifique — "statut pilot", "objectifs", "criteres", "mon business c'est...", "checklist", "historique pilot", "lance le brain", "pause pilot", "reprends pilot", "apprentissages", "qu'est-ce que t'as fait ?", "relance Nadine", "message pour ce prospect", "montre moi le message", "follow-up". Tout ce qui concerne l'autonomie du bot, ses objectifs, ses actions automatiques, ET les relances/messages personnalises pour des prospects. ATTENTION : distinct de proactive-agent qui gere les rapports et alertes. Distinct de automailer qui gere les CAMPAGNES (mass mailing). Autonomous-pilot gere la STRATEGIE, les ACTIONS autonomes, et les RELANCES individuelles.
- "inbox-manager" : surveillance de la boite email, detection des reponses de prospects, emails recus, emails entrants, IMAP, inbox — "reponses recues", "emails entrants", "inbox", "boite de reception", "qui a repondu ?", "statut inbox". Tout ce qui concerne les emails RECUS (pas les envoyes, ca c'est automailer).
- "meeting-scheduler" : prise de RDV, rendez-vous, meetings, calendrier, Cal.com, creneaux, booking — "propose un rdv", "planifie un meeting", "rdv a venir", "lien de reservation", "cale un creneau". Tout ce qui concerne la planification de rendez-vous avec des prospects.
- "general" : salutations, aide globale, bavardage sans rapport avec les skills ci-dessus.

REGLES CRITIQUES :
1. Comprends le SENS, pas les mots exacts. "comment vont mes envois ?" = automailer. "ou en est mon business ?" = crm-pilot.
2. Le CONTEXTE compte. Si la conversation recente parle de prospection et que l'utilisateur dit "et a Lyon ?", c'est autonomous-pilot (prospection automatique).
3. TRES IMPORTANT : Si le bot vient d'envoyer des messages automatiques (alertes veille, rapports, alertes systeme, etc.) et que l'utilisateur REAGIT a ces messages (demande un resume, commente, critique le format, dit "trop de messages", "fais un resume", "regroupe", etc.), route vers le skill qui a envoye ces messages. Par exemple : le bot envoie des alertes veille -> l'utilisateur dit "fais-moi un resume" -> c'est web-intelligence. Le bot envoie un rapport proactif -> l'utilisateur dit "c'est quoi ce truc ?" -> c'est proactive-agent.
4. "aide" ou "help" SEUL = general. Mais "aide sur mes factures" = invoice-bot.
5. En cas de doute entre deux skills, choisis celui qui correspond le mieux au contexte recent.
6. Reponds UNIQUEMENT par un seul mot : automailer, crm-pilot, invoice-bot, proactive-agent, self-improve, web-intelligence, system-advisor, autonomous-pilot, inbox-manager, meeting-scheduler ou general.`;

  const userContent = (historyContext
    ? 'HISTORIQUE RECENT :\n' + historyContext + '\n\nDernier skill utilise : ' + lastSkill + '\n\nNOUVEAU MESSAGE : '
    : 'Pas d\'historique.\n\nNOUVEAU MESSAGE : ')
    + message;

  try {
    const raw = await callOpenAINLP(systemPrompt, userContent, 15);
    const skill = raw.toLowerCase().trim().replace(/[^a-z-]/g, '');

    // Exact matches d'abord (prioritaire)
    const exactSkills = [
      'autonomous-pilot', 'system-advisor', 'web-intelligence', 'self-improve',
      'proactive-agent', 'inbox-manager', 'meeting-scheduler',
      'invoice-bot',
      'crm-pilot', 'automailer', 'general'
    ];
    for (const s of exactSkills) {
      if (skill === s) return s;
    }

    // Fallback : partial matching (du plus specifique au plus generique)
    if (skill.includes('autonomous-pilot') || skill.includes('autonomous')) return 'autonomous-pilot';
    if (skill.includes('inbox-manager') || skill.includes('inbox')) return 'inbox-manager';
    if (skill.includes('meeting-scheduler') || skill.includes('meeting') || skill.includes('rdv')) return 'meeting-scheduler';
    if (skill.includes('system-advisor') || skill.includes('monitoring') || skill.includes('sante')) return 'system-advisor';
    if (skill.includes('web-intelligence') || skill.includes('web-intel') || skill.includes('veille')) return 'web-intelligence';
    if (skill.includes('self-improve') || skill.includes('amelior')) return 'self-improve';
    if (skill.includes('proactive-agent') || skill.includes('proactive') || skill.includes('proactif')) return 'proactive-agent';
    if (skill.includes('invoice-bot') || skill.includes('invoice')) return 'invoice-bot';
    if (skill.includes('crm-pilot') || skill.includes('crm')) return 'crm-pilot';
    if (skill.includes('automailer') || skill.includes('mailer')) return 'automailer';
    return 'general';
  } catch (e) {
    log.warn('router', 'Erreur classification NLP:', e.message);
    return 'general';
  }
}

/**
 * Verifie la stickiness conversationnelle — reste sur le meme skill si le message
 * est une continuation courte (< 100 chars).
 * @param {string} chatId
 * @param {string} text - message utilisateur
 * @param {object} deps - { userActiveSkill, userActiveSkillTime }
 * @returns {string|null} skill name si sticky, null sinon
 */
function checkStickiness(chatId, text, deps) {
  const { userActiveSkill, userActiveSkillTime } = deps;
  const id = String(chatId);
  const lastSkill = userActiveSkill[id];
  const lastTime = userActiveSkillTime[id];
  if (!lastSkill || !lastTime) return null;
  if (Date.now() - lastTime > STICKINESS_TIMEOUT_MS) return null;
  // Reset explicite : salutations ou demande d'aide → forcer reclassification
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (STICKINESS_RESET_PATTERN.test(t)) return null;
  // Message court (< 100 chars) qui ressemble a une continuation
  if (t.length < 100 && CONTINUATION_PATTERN.test(t)) {
    // Verifier qu'aucun autre skill n'a un match fort (fast classify)
    const forceSkill = fastClassify(text);
    if (forceSkill && forceSkill !== lastSkill) return null; // mot-cle explicite pour un AUTRE skill
    return lastSkill;
  }
  return null;
}

module.exports = { fastClassify, classifySkill, checkStickiness };
