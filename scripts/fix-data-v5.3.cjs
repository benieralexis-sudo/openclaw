// Script de nettoyage v5.3 — Fix leads _emailSent + pushedToHubspot + chatId automailer
const fs = require('fs');

const FF_DB = '/data/flowfast/flowfast-db.json';
const AM_DB = '/data/automailer/automailer-db.json';

// --- 1. Lire les donnees ---
const ffData = JSON.parse(fs.readFileSync(FF_DB, 'utf8'));
const amData = JSON.parse(fs.readFileSync(AM_DB, 'utf8'));

console.log('=== Fix Data v5.3 ===\n');

// --- 2. Collecter tous les emails envoyes avec succes depuis automailer ---
const sentEmails = new Set();
for (const email of (amData.emails || [])) {
  if (email.to && ['sent', 'delivered', 'opened', 'clicked'].includes(email.status)) {
    sentEmails.add(email.to.toLowerCase().trim());
  }
}
console.log('[1] Emails envoyes avec succes:', sentEmails.size);
for (const e of sentEmails) console.log('   ', e);

// --- 3. Marquer _emailSent sur les leads FlowFast correspondants ---
let markedEmailSent = 0;
for (const [key, lead] of Object.entries(ffData.leads || {})) {
  if (lead.email && sentEmails.has(lead.email.toLowerCase().trim())) {
    if (!lead._emailSent) {
      lead._emailSent = true;
      lead._emailSentAt = new Date().toISOString();
      markedEmailSent++;
      console.log('   [emailSent] ' + lead.email + ' (cle: ' + key + ')');
    }
  }
}
console.log('[2] Leads marques _emailSent:', markedEmailSent);

// --- 4. Fixer le chatId "undefined" dans automailer ---
const ADMIN_CHAT_ID = '1409505520';
let fixedChatId = 0;

// Migrer les emails du user "undefined" vers le user admin
if (amData.users && amData.users['undefined']) {
  const undefinedUser = amData.users['undefined'];
  console.log('\n[3] User "undefined" trouve avec', undefinedUser.emailsSent, 'emails envoyes');

  // Si le user admin n'existe pas, le creer
  if (!amData.users[ADMIN_CHAT_ID]) {
    amData.users[ADMIN_CHAT_ID] = {
      chatId: ADMIN_CHAT_ID,
      name: 'Jojo',
      preferences: undefinedUser.preferences || {},
      campaignCount: 0,
      emailsSent: 0,
      joinedAt: undefinedUser.joinedAt || new Date().toISOString(),
      lastActiveAt: new Date().toISOString()
    };
  }

  // Transferer le compteur
  amData.users[ADMIN_CHAT_ID].emailsSent = (amData.users[ADMIN_CHAT_ID].emailsSent || 0) + (undefinedUser.emailsSent || 0);

  // Supprimer le user undefined
  delete amData.users['undefined'];
  console.log('   User "undefined" supprime, emails transferes vers ' + ADMIN_CHAT_ID);
}

// Fixer le chatId sur chaque email individuel
for (const email of (amData.emails || [])) {
  if (!email.chatId || email.chatId === 'undefined' || email.chatId === '') {
    email.chatId = ADMIN_CHAT_ID;
    fixedChatId++;
  }
}
console.log('[4] Emails avec chatId corrige:', fixedChatId);

// --- 5. Supprimer le doublon Neha (email onboarding@resend.dev) ---
let removedDoublons = 0;
const seenRecipients = new Set();
amData.emails = (amData.emails || []).filter(email => {
  // Supprimer les emails envoyes depuis onboarding@resend.dev (test mode)
  if (email.from === 'onboarding@resend.dev' || (email.from && email.from.includes('onboarding@resend'))) {
    removedDoublons++;
    console.log('   [doublon] Supprime email test ' + email.to + ' (from: ' + email.from + ')');
    return false;
  }
  return true;
});
console.log('[5] Emails doublons test supprimes:', removedDoublons);

// --- 6. Stats recap ---
const leadsTotal = Object.keys(ffData.leads || {}).length;
const leadsWithEmail = Object.values(ffData.leads || {}).filter(l => l.email).length;
const leadsEmailSent = Object.values(ffData.leads || {}).filter(l => l._emailSent).length;
const leadsPushed = Object.values(ffData.leads || {}).filter(l => l.pushedToHubspot).length;

console.log('\n=== Recap ===');
console.log('Leads total:', leadsTotal);
console.log('Leads avec email:', leadsWithEmail);
console.log('Leads _emailSent:', leadsEmailSent);
console.log('Leads pushedToHubspot:', leadsPushed);
console.log('Emails automailer:', amData.emails.length);

// --- 7. Sauvegarder ---
fs.writeFileSync(FF_DB, JSON.stringify(ffData, null, 2));
fs.writeFileSync(AM_DB, JSON.stringify(amData, null, 2));
console.log('\n[OK] Donnees sauvegardees.');
