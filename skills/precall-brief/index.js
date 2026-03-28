// iFIND - Pre-call Brief Generator
// Genere un brief structure avant chaque call client
// Declenche quand : reply interessee (score >= 0.85) OU booking detecte
'use strict';

const fs = require('fs');
const path = require('path');
const log = require('../../gateway/logger.js');

const ENRICHMENT_DIR = '/data/automailer/clay-enrichments';

/**
 * Charge les donnees Clay enrichment pour un email donne
 */
function loadClayEnrichment(email) {
  try {
    const safeEmail = email.toLowerCase().trim().replace(/[^a-z0-9@._-]/g, '_');
    const filePath = path.join(ENRICHMENT_DIR, safeEmail + '.json');
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    log.warn('precall-brief', 'Enrichment load failed for ' + email + ': ' + e.message);
  }
  return null;
}

/**
 * Recupere les emails envoyes a un prospect depuis automailer
 */
function getSentEmails(automailerStorage, email) {
  try {
    const events = automailerStorage.getEmailEventsForRecipient(email.toLowerCase());
    return events
      .filter(e => e.status !== 'bounced')
      .map(e => ({
        subject: e.subject || '',
        body: (e.body || '').substring(0, 500),
        sentAt: e.sentAt || e.createdAt || '',
        status: e.status || '',
        stepNumber: e.stepNumber || 1
      }));
  } catch (e) {
    return [];
  }
}

/**
 * Recupere le contact depuis les listes automailer
 */
function findContact(automailerStorage, email) {
  try {
    const allLists = automailerStorage.getAllContactLists();
    for (const list of allLists) {
      const contact = (list.contacts || []).find(
        c => (c.email || '').toLowerCase() === email.toLowerCase()
      );
      if (contact) return contact;
    }
  } catch (e) {}
  return null;
}

/**
 * Genere le brief pre-call via Claude
 */
async function generateBrief(callClaude, prospectData) {
  const systemPrompt = `Tu es un assistant commercial expert. Tu generes des briefs pre-call concis et actionnables pour preparer des appels de vente.

CONTEXTE IFIND :
- iFIND vend un agent IA de prospection B2B
- Plans : Starter (890€/mois, 500 prospects), Growth (1490€/mois, 1500 prospects + LinkedIn), Scale (2490€/mois, 3000 prospects)
- Engagement 3 mois, tarif fondateur
- Cible : PME France B2B qui n'ont pas de process de prospection structure

REGLES :
- Ecris en francais
- Sois direct et concis
- Pas de blabla — que de l'actionnable
- Recommande un plan et un angle de closing bases sur le profil
- Identifie les objections probables
- Maximum 400 mots`;

  const userMessage = `Genere un brief pre-call pour ce prospect :

NOM : ${prospectData.name || 'Inconnu'}
POSTE : ${prospectData.title || 'Non renseigne'}
ENTREPRISE : ${prospectData.company || 'Non renseignee'}
INDUSTRIE : ${prospectData.industry || 'Non renseignee'}
TAILLE : ${prospectData.employeeCount ? prospectData.employeeCount + ' employes' : 'Non renseignee'}
LOCALISATION : ${prospectData.location || 'Non renseignee'}
SITE WEB : ${prospectData.website || 'Non renseigne'}
LINKEDIN : ${prospectData.linkedin || 'Non renseigne'}

RESUME LINKEDIN :
${prospectData.linkedinBio || 'Non disponible'}

FUNDING : ${prospectData.funding || 'Non renseigne'}
CROISSANCE EFFECTIF : ${prospectData.headcountGrowth ? prospectData.headcountGrowth + '%' : 'Non renseignee'}
TECHNOLOGIES : ${prospectData.builtWith || 'Non renseigne'}

EMAIL ENVOYE :
Sujet : ${prospectData.emailSubject || 'Non disponible'}
Corps : ${prospectData.emailBody || 'Non disponible'}

SA REPONSE :
${prospectData.replySnippet || 'Non disponible'}

Genere le brief avec cette structure exacte :
1. PROFIL (2-3 lignes : qui est-ce, que fait sa boite)
2. CONTEXTE CLE (2-3 bullet points : ce qu'on sait d'important)
3. ANGLE RECOMMANDE (quel argument principal utiliser)
4. PLAN RECOMMANDE (Starter/Growth/Scale et pourquoi)
5. OBJECTIONS PROBABLES (2-3 objections a anticiper avec reponse courte)
6. QUESTION D'OUVERTURE (la premiere question a poser en call)`;

  try {
    const response = await callClaude(systemPrompt, userMessage, 600, 'claude-sonnet-4-6');
    return response;
  } catch (e) {
    log.error('precall-brief', 'Claude generation failed: ' + e.message);
    return null;
  }
}

/**
 * Formate le brief pour Telegram (Markdown v1, comme le reste du bot)
 */
function formatTelegramBrief(prospectData, aiBrief) {
  const lines = [
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '📋 *BRIEF PRE-CALL*',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '👤 *' + (prospectData.name || 'Inconnu') + '*',
    '💼 ' + (prospectData.title || '?') + ' @ ' + (prospectData.company || '?'),
  ];

  if (prospectData.industry) {
    lines.push('🏭 ' + prospectData.industry);
  }
  if (prospectData.employeeCount) {
    lines.push('👥 ' + prospectData.employeeCount + ' employes');
  }
  if (prospectData.location) {
    lines.push('📍 ' + prospectData.location);
  }
  if (prospectData.website) {
    lines.push('🌐 ' + prospectData.website);
  }
  if (prospectData.linkedin) {
    lines.push('🔗 ' + prospectData.linkedin);
  }

  lines.push('');
  lines.push('📤 *Email envoye :*');
  lines.push('_' + (prospectData.emailSubject || '').substring(0, 100) + '_');

  lines.push('');
  lines.push('💬 *Sa reponse :*');
  lines.push('_' + (prospectData.replySnippet || '').substring(0, 300) + '_');

  if (aiBrief) {
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('🧠 *ANALYSE IA*');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');
    lines.push(aiBrief);
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

/**
 * Point d'entree principal — genere et envoie le brief
 * Appele depuis reply-pipeline.js quand reply interessee ou booking
 */
async function sendPrecallBrief(deps, replyData, classification) {
  const { callClaude, automailerStorage, sendMessage, adminChatId } = deps;

  const email = (replyData.from || '').toLowerCase();
  if (!email) return;

  log.info('precall-brief', 'Generation brief pre-call pour ' + email);

  // 1. Charger enrichment Clay
  const enrichment = loadClayEnrichment(email);

  // 2. Charger contact automailer
  const contact = findContact(automailerStorage, email);

  // 3. Charger emails envoyes
  const sentEmails = getSentEmails(automailerStorage, email);
  const lastSent = sentEmails.length > 0 ? sentEmails[sentEmails.length - 1] : null;

  // 4. Assembler les donnees prospect
  const prospectData = {
    name: replyData.fromName || (contact ? contact.name : '') || (enrichment ? (enrichment.firstName + ' ' + enrichment.lastName).trim() : ''),
    email: email,
    title: (enrichment && enrichment.title) || (contact && contact.title) || '',
    company: (enrichment && enrichment.company) || (contact && contact.company) || (replyData.matchedLead && replyData.matchedLead.company) || '',
    industry: (enrichment && enrichment.industry) || '',
    employeeCount: enrichment && enrichment.employeeCount,
    location: (enrichment && enrichment.location) || '',
    website: (enrichment && enrichment.website) || '',
    linkedin: (enrichment && enrichment.linkedin) || '',
    linkedinBio: (enrichment && enrichment.linkedinBio) || '',
    funding: (enrichment && enrichment.funding) || '',
    headcountGrowth: enrichment && enrichment.headcountGrowth,
    builtWith: (enrichment && enrichment.builtWith) || '',
    emailSubject: lastSent ? lastSent.subject : (replyData.subject || '').replace(/^Re:\s*/i, ''),
    emailBody: lastSent ? lastSent.body : '',
    replySnippet: replyData.snippet || replyData.text || ''
  };

  // 5. Generer le brief IA
  let aiBrief = null;
  try {
    aiBrief = await generateBrief(callClaude, prospectData);
  } catch (e) {
    log.warn('precall-brief', 'Brief IA generation echouee: ' + e.message);
  }

  // 6. Formater et envoyer sur Telegram
  const message = formatTelegramBrief(prospectData, aiBrief);

  try {
    await sendMessage(adminChatId, message, 'Markdown');
    log.info('precall-brief', 'Brief pre-call envoye sur Telegram pour ' + email);
  } catch (e) {
    log.error('precall-brief', 'Envoi Telegram echoue: ' + e.message);
  }
}

module.exports = { sendPrecallBrief, loadClayEnrichment, generateBrief };
