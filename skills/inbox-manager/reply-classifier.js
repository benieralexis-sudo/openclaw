// Inbox Manager - Classification IA des reponses prospects
'use strict';
const { callOpenAI } = require('../../gateway/shared-nlp.js');
const log = require('../../gateway/logger.js');
let _appConfig = null;
try { _appConfig = require('../../gateway/app-config.js'); } catch (e) {}

const CLASSIFICATION_SYSTEM_PROMPT = `Tu es un analyseur de reponses email B2B. Tu recois un email de reponse d'un prospect a qui on a envoye un email de prospection.

Analyse le SENTIMENT et l'INTENTION du prospect.

Categories :
- "interested" : le prospect exprime de l'interet, veut en savoir plus, demande des infos, accepte un echange
  Ex: "Oui ca m'interesse", "On peut en discuter", "Envoyez-moi plus d'infos", "Pourquoi pas", "Dites-moi en plus"
  Score: 0.7 a 1.0

- "question" : le prospect pose une question precise sans engagement clair (prix, fonctionnement, cas d'usage)
  Ex: "Combien ca coute ?", "Ca marche comment ?", "Vous faites du X ?"
  Score: 0.4 a 0.7

- "not_interested" : le prospect refuse clairement ou poliment
  Ex: "Non merci", "Pas interesse", "On a deja un prestataire", "Ne me recontactez pas", "Desabonnement"
  Score: 0.0 a 0.3

- "out_of_office" : reponse automatique d'absence
  Ex: "Je suis absent jusqu'au...", "Out of office", "En conge", "Auto-reply"
  Score: 0.5

- "bounce" : erreur de delivrabilite, adresse invalide
  Ex: "Undeliverable", "Mailbox not found", "Address rejected", "Delivery failed"
  Score: 0.0

Reponds UNIQUEMENT en JSON strict :
{"sentiment":"interested|question|not_interested|out_of_office|bounce","score":0.0,"reason":"explication courte en francais","key_phrases":["phrase 1"]}

IMPORTANT :
- "pourquoi pas" ou "dites-moi en plus" = interested, pas question
- "Non merci" ou "pas pour le moment" = not_interested
- En cas de doute entre interested et question, choisis question
- Les reponses tres courtes sans contexte ("ok", "bien recu") = question`;

const VALID_SENTIMENTS = ['interested', 'question', 'not_interested', 'out_of_office', 'bounce'];

/**
 * Classifie le sentiment d'une reponse prospect via GPT-4o-mini.
 * @param {string} openaiKey
 * @param {Object} replyData - {from, fromName, subject, snippet, originalEmailSubject}
 * @returns {Promise<{sentiment: string, score: number, reason: string, key_phrases: string[]}>}
 */
async function classifyReply(openaiKey, replyData) {
  const { from, fromName, subject, snippet, originalEmailSubject } = replyData;
  const subjectStr = subject || '';

  // --- Guard : pas d'API key ---
  if (!openaiKey) {
    log.warn('reply-classifier', 'OPENAI_KEY manquante — fallback question');
    return { sentiment: 'question', score: 0.5, reason: 'Pas de cle API', key_phrases: [] };
  }

  // --- Guard : email forwarded → pas de classification auto ---
  if (/^Fwd:|^Fw:|^TR:|-----\s*Forwarded|Transferred message/i.test(subjectStr + ' ' + (snippet || ''))) {
    log.info('reply-classifier', 'Email forwarde detecte de ' + from + ' — fallback question');
    return { sentiment: 'question', score: 0.4, reason: 'Email forwarde detecte', key_phrases: [] };
  }

  // --- Guard : snippet trop court ou vide ---
  const cleanSnippet = (snippet || '').trim();
  if (cleanSnippet.length < 3) {
    log.info('reply-classifier', 'Email vide/trop court de ' + from + ' — fallback question');
    return { sentiment: 'question', score: 0.3, reason: 'Email trop court ou vide', key_phrases: [] };
  }

  // --- Guard : detection bounce par sujet (avant appel IA) ---
  if (/undeliverable|delivery.*fail|mailbox.*not found|address.*rejected|mail delivery.*subsystem/i.test(subjectStr)) {
    log.info('reply-classifier', 'Bounce detecte par sujet pour ' + from);
    return { sentiment: 'bounce', score: 0.0, reason: 'Bounce detecte par sujet', key_phrases: [] };
  }

  // --- Guard : detection OOO par sujet (avant appel IA) ---
  if (/out of office|absence.*auto|auto.*reply|automatique.*absence|en conge|actuellement absent/i.test(subjectStr + ' ' + cleanSnippet.substring(0, 100))) {
    log.info('reply-classifier', 'OOO detecte par sujet pour ' + from);
    return { sentiment: 'out_of_office', score: 0.5, reason: 'Absence auto detectee par sujet', key_phrases: [] };
  }

  const userPrompt = [
    'Email de reponse a analyser :',
    'De : ' + (fromName || from),
    'Sujet : ' + (subjectStr || '(sans sujet)'),
    originalEmailSubject ? 'Sujet original : ' + originalEmailSubject : '',
    '',
    'Contenu :',
    cleanSnippet.substring(0, 500)
  ].filter(Boolean).join('\n');

  try {
    const result = await callOpenAI(openaiKey, [
      { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ], { maxTokens: 150, temperature: 0.1, model: 'gpt-4o-mini' });

    if (_appConfig && _appConfig.recordApiSpend && result.usage) {
      _appConfig.recordApiSpend('gpt-4o-mini', result.usage.prompt_tokens || 0, result.usage.completion_tokens || 0);
    }

    const cleaned = result.content.trim()
      .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      log.warn('reply-classifier', 'JSON invalide de GPT pour ' + from + ': ' + cleaned.substring(0, 100));
      return { sentiment: 'question', score: 0.5, reason: 'JSON invalide — fallback', key_phrases: [] };
    }

    if (!parsed.sentiment || !VALID_SENTIMENTS.includes(parsed.sentiment)) parsed.sentiment = 'question';
    parsed.score = Math.max(0, Math.min(1, parseFloat(parsed.score) || 0.5));
    parsed.key_phrases = Array.isArray(parsed.key_phrases) ? parsed.key_phrases : [];
    parsed.reason = parsed.reason || '';

    log.info('reply-classifier', 'Classification: ' + parsed.sentiment +
      ' (score=' + parsed.score + ') pour ' + from + ' — ' + parsed.reason);

    return parsed;
  } catch (e) {
    log.error('reply-classifier', 'Erreur classification pour ' + from + ':', e.message);
    return {
      sentiment: 'question',
      score: 0.5,
      reason: 'Classification echouee — fallback',
      key_phrases: [],
      error: e.message
    };
  }
}

/**
 * Sous-classifie une objection "not_interested" pour determiner si c'est une objection douce (geree par le bot)
 * ou dure (blacklist permanente).
 * @returns {Promise<{type: string, objectionType: string, confidence: number, reason: string}>}
 */
async function subClassifyObjection(openaiKey, replyData, classification) {
  const snippet = (replyData.snippet || '').substring(0, 500);

  // Guards rapides sans appel IA
  const hardPatterns = /desabonn|unsubscri|ne me contactez|ne me recontactez|spam|rgpd|donnees personnelles|stop|supprim/i;
  if (hardPatterns.test(snippet)) {
    return { type: 'hard_objection', objectionType: 'permanent_block', confidence: 0.95, reason: 'Desabonnement/blocage explicite detecte' };
  }

  if (!openaiKey) {
    return { type: 'soft_objection', objectionType: 'unknown', confidence: 0.5, reason: 'Pas de cle API — fallback soft' };
  }

  const prompt = `Analyse cette reponse de prospection B2B et classifie le TYPE D'OBJECTION.

Categories :
- "timing" : pas le temps, pas le bon moment, trop occupe, revenez plus tard (DOUX)
- "info_request" : envoyez des infos, envoyez un doc, dites-moi en plus (DOUX)
- "competitor" : on a deja un prestataire, on travaille avec X (DOUX)
- "budget" : trop cher, pas de budget, on n'a pas les moyens (DOUX)
- "not_relevant" : ca ne nous concerne pas, pas notre domaine (DOUX)
- "permanent_block" : desabonnez-moi, ne me contactez plus, spam, RGPD (DUR)

Reponds UNIQUEMENT en JSON strict :
{"objectionType":"timing|info_request|competitor|budget|not_relevant|permanent_block","confidence":0.0,"reason":"explication courte"}`;

  try {
    const result = await callOpenAI(openaiKey, [
      { role: 'system', content: prompt },
      { role: 'user', content: 'Reponse du prospect : ' + snippet }
    ], { maxTokens: 100, temperature: 0.1, model: 'gpt-4o-mini' });

    if (_appConfig && _appConfig.recordApiSpend && result.usage) {
      _appConfig.recordApiSpend('gpt-4o-mini', result.usage.prompt_tokens || 0, result.usage.completion_tokens || 0);
    }

    const cleaned = result.content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const objType = parsed.objectionType || 'unknown';
    const isDur = objType === 'permanent_block';
    return {
      type: isDur ? 'hard_objection' : 'soft_objection',
      objectionType: objType,
      confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.5)),
      reason: parsed.reason || ''
    };
  } catch (e) {
    log.warn('reply-classifier', 'Sub-classification echouee:', e.message);
    return { type: 'soft_objection', objectionType: 'unknown', confidence: 0.4, reason: 'Classification echouee — fallback soft' };
  }
}

/**
 * Parse la date de retour d'un email OOO.
 * @returns {string|null} Date au format YYYY-MM-DD ou null si non trouvee
 */
function parseOOOReturnDate(snippet) {
  if (!snippet) return null;
  const text = snippet.toLowerCase();

  // Patterns francais : "de retour le 15 mars", "absent jusqu'au 20/03", "disponible a partir du 1er avril"
  const patterns = [
    /(?:retour|disponible|joignable|present).*?(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/i,
    /(?:retour|disponible|joignable|present).*?(\d{1,2})\s+(janv|fevr|mars|avri|mai|juin|juil|aout|sept|octo|nove|dece)\w*/i,
    /(?:jusqu.{0,3}au|until)\s+(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/i,
    /(?:jusqu.{0,3}au|until)\s+(\d{1,2})\s+(janv|fevr|mars|avri|mai|juin|juil|aout|sept|octo|nove|dece)\w*/i,
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/  // Fallback: premiere date trouvee
  ];

  const monthMap = { janv: '01', fevr: '02', mars: '03', avri: '04', mai: '05', juin: '06', juil: '07', aout: '08', sept: '09', octo: '10', nove: '11', dece: '12' };

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    let day, month, year;
    if (match[2] && monthMap[match[2].substring(0, 4)]) {
      day = match[1].padStart(2, '0');
      month = monthMap[match[2].substring(0, 4)];
      year = new Date().getFullYear().toString();
    } else if (match[3]) {
      day = match[1].padStart(2, '0');
      month = match[2].padStart(2, '0');
      year = match[3].length === 2 ? '20' + match[3] : match[3];
    } else {
      continue;
    }

    const dateStr = year + '-' + month + '-' + day;
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
      return dateStr;
    }
  }

  // Fallback: si pas de date trouvee, assumer retour dans 7 jours
  return null;
}

/**
 * Genere une contre-objection via Claude Sonnet.
 * @param {Function} callClaude - callClaude(systemPrompt, userMessage, maxTokens)
 * @param {Object} replyData - {from, fromName, subject, snippet}
 * @param {Object} classification - {sentiment, score, reason, key_phrases}
 * @param {Object} subClass - {type, objectionType, confidence, reason}
 * @param {Object} originalEmail - {subject, body, company}
 * @param {Object} clientContext - {senderName, senderTitle, clientDomain, bookingUrl}
 * @returns {Promise<{body: string, subject: string, confidence: number}>}
 */
async function generateObjectionReply(callClaude, replyData, classification, subClass, originalEmail, clientContext) {
  const firstName = (replyData.fromName || '').trim().split(' ')[0] || '';
  const senderName = clientContext.senderName || process.env.SENDER_NAME || 'Alexis';
  const bookingUrl = clientContext.bookingUrl || '';

  const OBJECTION_STRATEGIES = {
    timing: 'Le prospect dit ne pas avoir le temps. Propose de revenir dans 2-3 semaines. Court, respectueux, pas insistant.',
    info_request: 'Le prospect demande des infos. Donne 2-3 points cles concrets (pas de blabla) et propose un call de 15 min pour approfondir.',
    competitor: 'Le prospect a deja un prestataire. Respecte son choix, mentionne un avantage differentiant unique, propose de comparer sans engagement.',
    budget: 'Le prospect mentionne le budget. Rassure sur le ROI, mentionne un exemple concret, propose un call pour evaluer ensemble.',
    not_relevant: 'Le prospect dit que ce n\'est pas pertinent. Demande poliment quel serait le bon interlocuteur dans son entreprise, ou excuse-toi brievement.'
  };

  const strategy = OBJECTION_STRATEGIES[subClass.objectionType] || OBJECTION_STRATEGIES.timing;

  const systemPrompt = `Tu es ${senderName}, professionnel B2B. Tu reponds a un prospect qui a fait une objection a ton email de prospection.

STRATEGIE: ${strategy}

REGLES ABSOLUES:
- 3-5 lignes MAX, ton naturel pair-a-pair
- Tutoie si le prospect tutoie, vouvoie si il vouvoie
- NE MENTIONNE JAMAIS: IA, bot, automatisation, SDR, pipeline, solution, outil, plateforme
- Pas de signature, pas de "Cordialement"
- Si tu proposes un call, termine par un lien de booking si disponible
- Reponds en francais
- Sois HUMAIN, pas commercial. Tu es une vraie personne qui discute.

${bookingUrl ? 'Lien de booking si pertinent: ' + bookingUrl : ''}`;

  const userPrompt = `Email original envoye:
Sujet: ${(originalEmail && originalEmail.subject) || '(inconnu)'}
Contenu: ${(originalEmail && originalEmail.body || '').substring(0, 300)}

Reponse du prospect ${firstName || replyData.from}:
"${(replyData.snippet || '').substring(0, 500)}"

Type d'objection: ${subClass.objectionType} (${subClass.reason})

Redige ta reponse (3-5 lignes):`;

  try {
    const result = await callClaude(systemPrompt, userPrompt, 300);
    if (!result || result.trim().length < 10) {
      return { body: null, subject: null, confidence: 0 };
    }
    return {
      body: result.trim(),
      subject: 'Re: ' + (originalEmail && originalEmail.subject || replyData.subject || 'notre echange'),
      confidence: subClass.confidence
    };
  } catch (e) {
    log.error('reply-classifier', 'Erreur generation contre-objection:', e.message);
    return { body: null, subject: null, confidence: 0 };
  }
}

/**
 * Genere une reponse a une question simple via Claude Sonnet.
 * @param {Function} callClaude - callClaude(systemPrompt, userMessage, maxTokens)
 */
async function generateQuestionReplyViaClaude(callClaude, replyData, classification, originalEmail, clientContext) {
  const firstName = (replyData.fromName || '').trim().split(' ')[0] || '';
  const senderName = clientContext.senderName || process.env.SENDER_NAME || 'Alexis';
  const bookingUrl = clientContext.bookingUrl || '';

  const systemPrompt = `Tu es ${senderName}, professionnel B2B. Un prospect a pose une question en reponse a ton email de prospection.

REGLES ABSOLUES:
- Reponds a sa question en 3-5 lignes MAX, concret et utile
- Termine TOUJOURS par une proposition de call de 15 min
- Tutoie si le prospect tutoie, vouvoie si il vouvoie
- NE MENTIONNE JAMAIS: IA, bot, automatisation, SDR, pipeline, solution, outil, plateforme
- Pas de signature, pas de "Cordialement"
- Reponds en francais
- Sois concret: chiffres, exemples, pas de blabla

${bookingUrl ? 'Lien de booking pour le call: ' + bookingUrl : ''}`;

  const userPrompt = `Email original envoye:
Sujet: ${(originalEmail && originalEmail.subject) || '(inconnu)'}
Contenu: ${(originalEmail && originalEmail.body || '').substring(0, 300)}

Question du prospect ${firstName || replyData.from}:
"${(replyData.snippet || '').substring(0, 500)}"

Mots-cles: ${(classification.key_phrases || []).join(', ')}

Redige ta reponse (3-5 lignes + proposition call):`;

  try {
    const result = await callClaude(systemPrompt, userPrompt, 300);
    if (!result || result.trim().length < 10) {
      return { body: null, subject: null, confidence: 0 };
    }
    return {
      body: result.trim(),
      subject: 'Re: ' + (originalEmail && originalEmail.subject || replyData.subject || 'notre echange'),
      confidence: 0.85
    };
  } catch (e) {
    log.error('reply-classifier', 'Erreur generation reponse question:', e.message);
    return { body: null, subject: null, confidence: 0 };
  }
}

/**
 * Legacy: Genere une reponse IA contextuelle pour les prospects qui posent une question.
 * @deprecated Utiliser generateQuestionReplyViaClaude a la place
 */
async function generateQuestionReply(openaiKey, replyData, classification) {
  const { from, fromName, snippet } = replyData;
  const firstName = (fromName || '').trim().split(' ')[0] || '';

  const systemPrompt = `Tu es Alexis, fondateur de iFIND, service de prospection B2B automatisee.
Un prospect a pose une question dans sa reponse a ton email de prospection.
Redige une reponse courte (3-5 lignes max), naturelle, ton pair-a-pair (tu tutoies sauf si le prospect vouvoie).
Termine TOUJOURS par une proposition de call de 15 min.
NE MENTIONNE JAMAIS : SDR, pipeline, automatisation, solution, outil, IA, robot.
Reponds en francais. Pas de signature, pas de formule de politesse longue.`;

  const userPrompt = 'Question du prospect ' + (firstName || from) + ' :\n' +
    'Message : ' + (snippet || '').substring(0, 500) + '\n\n' +
    'Mots-cles detectes : ' + (classification.key_phrases || []).join(', ');

  try {
    const result = await callOpenAI(openaiKey, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { maxTokens: 250, temperature: 0.5, model: 'gpt-4o-mini' });

    if (_appConfig && _appConfig.recordApiSpend && result.usage) {
      _appConfig.recordApiSpend('gpt-4o-mini', result.usage.prompt_tokens || 0, result.usage.completion_tokens || 0);
    }

    return result.content.trim();
  } catch (e) {
    log.error('reply-classifier', 'Erreur generation reponse question:', e.message);
    return (firstName ? 'Merci ' + firstName : 'Merci pour ta question') + ' !\n\n' +
      'Bonne question. Le plus simple, on en parle de vive voix ?\n' +
      'Dis-moi tes dispos cette semaine, je cale un call de 15 min.\n\n' +
      'A bientot !';
  }
}

const REPLY_TEMPLATES = {
  interested: {
    withMeeting: (firstName, bookingUrl) =>
      (firstName ? 'Super ' + firstName : 'Super') + ' !\n\n' +
      'Ravi que le sujet t\'interesse. Le plus simple, on se cale un call de 15 min ?\n\n' +
      'Voici mon lien pour choisir un creneau : ' + bookingUrl + '\n\n' +
      'A tres vite !',
    withoutMeeting: (firstName) =>
      (firstName ? 'Merci ' + firstName : 'Merci pour ton retour') + ' !\n\n' +
      'Ravi que le sujet t\'interesse. Je te propose qu\'on s\'appelle cette semaine pour en discuter ?\n' +
      'Dis-moi tes dispos et je cale ca.\n\n' +
      'A bientot !'
  },
  not_interested: (firstName) =>
    (firstName ? 'Merci ' + firstName : 'Merci pour ton retour') + ' !\n\n' +
    'Pas de souci, je comprends tout a fait.\n' +
    'Si jamais le sujet redevient pertinent un jour, n\'hesite pas.\n\n' +
    'Bonne continuation !'
};

module.exports = {
  classifyReply,
  generateQuestionReply,
  subClassifyObjection,
  generateObjectionReply,
  generateQuestionReplyViaClaude,
  parseOOOReturnDate,
  REPLY_TEMPLATES
};
