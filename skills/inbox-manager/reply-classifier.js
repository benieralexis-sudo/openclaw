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
 * Genere une reponse IA contextuelle pour les prospects qui posent une question.
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

module.exports = { classifyReply, generateQuestionReply, REPLY_TEMPLATES };
