// iFIND - Workflow de generation de rapport de prospection personnalise
// Chaine : parse cible → search Apollo → score IA → generate emails → HTML report → send/fallback
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ApolloConnector = require('../skills/flowfast/apollo-connector.js');
const AIClassifier = require('../skills/lead-enrich/ai-classifier.js');
const ClaudeEmailWriter = require('../skills/automailer/claude-email-writer.js');
const ResendClient = require('../skills/automailer/resend-client.js');

// --- Echappement HTML pour prevenir les injections XSS ---
function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class ReportWorkflow {
  constructor(options) {
    this.apolloKey = options.apolloKey;
    this.openaiKey = options.openaiKey;
    this.claudeKey = options.claudeKey;
    this.resendKey = options.resendKey;
    this.senderEmail = options.senderEmail;
    this.sendTelegram = options.sendTelegram; // async (chatId, text) => {}
    this.adminChatId = options.adminChatId;
  }

  async generateReport(prospect) {
    // prospect = { id, prenom, email, activite, cible }
    const chatId = this.adminChatId;
    const steps = [];

    try {
      // Etape 1 : Parser la cible en criteres Apollo
      await this.sendTelegram(chatId, '🔍 _Analyse de la cible..._');
      const criteria = await this._parseCriteria(prospect.cible, prospect.activite);
      steps.push('criteria_ok');

      // Etape 2 : Recherche leads via Apollo
      await this.sendTelegram(chatId, '📡 _Recherche de leads sur Apollo..._');
      const leads = await this._searchLeads(criteria);
      if (leads.length === 0) {
        await this.sendTelegram(chatId, '⚠️ Aucun lead trouve pour cette cible. Essayez des criteres plus larges.');
        return { success: false, error: 'no_leads' };
      }
      steps.push('search_ok');
      await this.sendTelegram(chatId, `✅ _${leads.length} leads trouves_`);

      // Etape 3 : Scorer chaque lead via IA
      await this.sendTelegram(chatId, '🧠 _Scoring des leads..._');
      const scoredLeads = await this._scoreLeads(leads);
      steps.push('scoring_ok');

      // Etape 4 : Generer un email personnalise par lead
      await this.sendTelegram(chatId, '✍️ _Redaction des emails personnalises..._');
      const leadsWithEmails = await this._generateEmails(scoredLeads, prospect);
      steps.push('emails_ok');
      await this.sendTelegram(chatId, `✅ _${leadsWithEmails.length} emails rediges_`);

      // Etape 5 : Compiler le rapport HTML
      const htmlReport = this._buildHtmlReport(leadsWithEmails, prospect);
      steps.push('html_ok');

      // Etape 6 : Envoyer par email ou fallback fichier
      const sendResult = await this._sendReport(htmlReport, prospect);
      steps.push('send_ok');

      return { success: true, leads: leadsWithEmails, html: htmlReport, sent: sendResult, steps };

    } catch (error) {
      console.error('[report-workflow] Erreur:', error.message);
      await this.sendTelegram(chatId, '❌ Erreur generation rapport: ' + error.message);
      return { success: false, error: error.message, steps };
    }
  }

  // --- Etape 1 : Parser la cible en criteres Apollo ---
  async _parseCriteria(cible, activite) {
    const prompt = `Transforme cette description de cible commerciale en criteres de recherche Apollo.io.

Description de la cible : "${cible}"
Activite du client : "${activite}"

Retourne UNIQUEMENT un JSON valide :
{
  "titles": ["CEO", "Directeur General"],
  "locations": ["Paris, FR"],
  "seniorities": ["executive", "director"],
  "keywords": "mot cle optionnel",
  "companySize": ["11-50", "51-200"]
}

Regles :
- titles : postes en anglais ET francais, max 5
- locations : format "Ville, CC" (code pays 2 lettres), max 5. Si pas de ville precis, mettre les grandes villes francaises
- seniorities : parmi executive, director, manager, senior, entry
- companySize : parmi "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000"
- keywords : mots-cles du secteur d'activite de la cible (pas du client), en anglais, separes par espaces

Reponds UNIQUEMENT le JSON, rien d'autre.`;

    try {
      const response = await this._callOpenAI(prompt);
      const cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const criteria = JSON.parse(cleaned);
      console.log('[report-workflow] Criteres parses:', JSON.stringify(criteria));
      return criteria;
    } catch (error) {
      console.log('[report-workflow] Fallback criteres pour:', cible);
      // Fallback basique
      return {
        titles: ['CEO', 'Directeur General', 'Founder', 'Gerant', 'President'],
        locations: ['Paris, FR', 'Lyon, FR', 'Marseille, FR'],
        seniorities: ['executive', 'director'],
        companySize: ['11-50', '51-200', '201-500']
      };
    }
  }

  // --- Etape 2 : Recherche leads ---
  async _searchLeads(criteria) {
    if (!this.apolloKey) {
      throw new Error('APOLLO_API_KEY non configuree — impossible de rechercher des leads');
    }

    const apollo = new ApolloConnector(this.apolloKey);
    const result = await apollo.searchLeads({
      limit: 10,
      titles: criteria.titles,
      locations: criteria.locations,
      seniorities: criteria.seniorities,
      keywords: criteria.keywords,
      companySize: criteria.companySize,
      verifiedEmails: true
    });

    if (!result.success) {
      throw new Error('Erreur Apollo: ' + (result.error || 'recherche echouee'));
    }

    // Formater les leads
    return (result.leads || []).map(lead => ({
      firstName: lead.first_name || '',
      lastName: lead.last_name || '',
      fullName: ((lead.first_name || '') + ' ' + (lead.last_name || '')).trim(),
      title: lead.title || 'Non precise',
      email: lead.email || '',
      linkedinUrl: lead.linkedin_url || '',
      city: lead.city || '',
      country: lead.country || '',
      organization: {
        name: (lead.organization && lead.organization.name) || '',
        industry: (lead.organization && lead.organization.industry) || '',
        website: (lead.organization && lead.organization.website_url) || '',
        employeeCount: (lead.organization && lead.organization.estimated_num_employees) || 0,
        foundedYear: (lead.organization && lead.organization.founded_year) || null,
        city: (lead.organization && lead.organization.city) || '',
        country: (lead.organization && lead.organization.country) || ''
      }
    })).filter(lead => lead.email); // Garder uniquement les leads avec email
  }

  // --- Etape 3 : Scoring IA ---
  async _scoreLeads(leads) {
    const classifier = new AIClassifier(this.openaiKey);
    const scored = [];

    for (const lead of leads) {
      try {
        const classification = await classifier.classifyLead({
          person: lead,
          organization: lead.organization
        });
        scored.push({ ...lead, classification });
      } catch (e) {
        console.log('[report-workflow] Scoring echoue pour', lead.fullName, ':', e.message);
        scored.push({
          ...lead,
          classification: {
            industry: lead.organization.industry || 'Non determine',
            companySize: 'Non determine',
            persona: 'Non determine',
            score: 5,
            scoreExplanation: 'Score par defaut (classification echouee)'
          }
        });
      }
    }

    // Trier par score decroissant
    scored.sort((a, b) => (b.classification.score || 0) - (a.classification.score || 0));
    return scored;
  }

  // --- Etape 4 : Generation d'emails ---
  async _generateEmails(scoredLeads, prospect) {
    const writer = new ClaudeEmailWriter(this.claudeKey);
    const context = `Je suis ${prospect.prenom}, je dirige une activite de ${prospect.activite}. ` +
      `Je contacte des ${prospect.cible}. Mon objectif est de proposer mes services et obtenir un rendez-vous.`;

    const results = [];

    for (const lead of scoredLeads) {
      try {
        const email = await writer.generateSingleEmail({
          name: lead.fullName,
          firstName: lead.firstName,
          title: lead.title,
          company: lead.organization.name,
          email: lead.email
        }, context);
        results.push({ ...lead, generatedEmail: email });
      } catch (e) {
        console.log('[report-workflow] Email echoue pour', lead.fullName, ':', e.message);
        results.push({
          ...lead,
          generatedEmail: {
            subject: 'Echange professionnel — ' + prospect.activite,
            body: 'Bonjour ' + lead.firstName + ',\n\n' +
              'Je me permets de vous contacter car votre profil de ' + lead.title + ' chez ' + lead.organization.name + ' a retenu mon attention.\n\n' +
              'Seriez-vous disponible pour un bref echange ?\n\n' +
              'Cordialement,\n' + prospect.prenom
          }
        });
      }
    }

    return results;
  }

  // --- Etape 5 : Construction du rapport HTML ---
  _buildHtmlReport(leads, prospect) {
    const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

    const leadsHtml = leads.map((lead, i) => {
      const score = lead.classification ? lead.classification.score : 5;
      const scoreColor = score >= 7 ? '#16A34A' : score >= 5 ? '#D97706' : '#DC2626';
      const industry = lead.classification ? escapeHtml(lead.classification.industry) : '';
      const companySize = lead.classification ? escapeHtml(lead.classification.companySize) : '';
      const safeName = escapeHtml(lead.fullName);
      const safeTitle = escapeHtml(lead.title);
      const safeOrg = escapeHtml(lead.organization.name);
      const safeEmail = escapeHtml(lead.email);
      const safeCity = escapeHtml(lead.city);
      const safeSubject = escapeHtml(lead.generatedEmail.subject);
      const safeBody = escapeHtml(lead.generatedEmail.body);

      return `
    <tr><td style="padding:0 32px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E7E5E4;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:18px;font-weight:700;color:#1C1917;">${safeName}</span><br>
                <span style="font-size:14px;color:#57534E;">${safeTitle} chez ${safeOrg}</span><br>
                <span style="font-size:13px;color:#A8A29E;">${safeEmail}${safeCity ? ' &bull; ' + safeCity : ''}${industry ? ' &bull; ' + industry : ''}</span>
              </td>
              <td style="text-align:right;vertical-align:top;">
                <span style="display:inline-block;padding:4px 12px;background:${scoreColor}15;color:${scoreColor};font-size:14px;font-weight:700;border-radius:20px;">${score}/10</span>
              </td>
            </tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;background:#F5F5F4;border-radius:8px;">
            <tr><td style="padding:20px;">
              <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:13px;font-weight:600;color:#57534E;text-transform:uppercase;letter-spacing:0.05em;">Email pret a envoyer</span>
              <p style="margin:8px 0 4px;font-size:14px;font-weight:600;color:#1C1917;">Objet : ${safeSubject}</p>
              <p style="margin:0;font-size:14px;color:#57534E;line-height:1.7;white-space:pre-line;">${safeBody}</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>`;
    }).join('\n');

    const safeProspectPrenom = escapeHtml(prospect.prenom);
    const safeProspectCible = escapeHtml(prospect.cible);
    const safeProspectActivite = escapeHtml(prospect.activite);

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rapport iFIND — ${safeProspectPrenom}</title>
</head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:'Outfit',Arial,Helvetica,sans-serif;color:#1C1917;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F4;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

  <!-- Header -->
  <tr><td style="padding:40px 32px;background:#1D4ED8;text-align:center;">
    <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:28px;font-weight:800;color:#FFFFFF;letter-spacing:-0.03em;">iFIND</span>
    <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:15px;">Votre rapport de prospection personnalise</p>
  </td></tr>

  <!-- Intro -->
  <tr><td style="padding:40px 32px 32px;">
    <p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#1C1917;">Bonjour ${safeProspectPrenom},</p>
    <p style="margin:0 0 12px;font-size:15px;color:#57534E;line-height:1.75;">Nous avons identifie <strong style="color:#1C1917;">${leads.length} prospects</strong> qui correspondent a votre cible :</p>
    <p style="margin:0 0 12px;padding:12px 16px;background:#F5F5F4;border-radius:8px;font-size:14px;color:#57534E;font-style:italic;">&laquo; ${safeProspectCible} &raquo;</p>
    <p style="margin:0;font-size:15px;color:#57534E;line-height:1.75;">Pour chacun, nous avons redige un email de prospection personnalise, pret a envoyer. Il vous suffit de copier-coller.</p>
  </td></tr>

  <!-- Separator -->
  <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #E7E5E4;margin:0;"></td></tr>

  <!-- Leads title -->
  <tr><td style="padding:32px 32px 24px;">
    <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:20px;font-weight:700;color:#1C1917;">Vos ${leads.length} prospects</span>
  </td></tr>

  <!-- Lead cards -->
${leadsHtml}

  <!-- CTA -->
  <tr><td style="padding:32px;text-align:center;border-top:1px solid #E7E5E4;">
    <p style="margin:0 0 8px;font-family:'Space Grotesk',Arial,sans-serif;font-size:20px;font-weight:700;color:#1C1917;">Interesse(e) ?</p>
    <p style="margin:0 0 24px;font-size:15px;color:#57534E;">Nous pouvons automatiser l'envoi de ces emails et la gestion des reponses.</p>
    <a href="mailto:hello@ifind.fr?subject=iFIND — Interesse par l'offre&body=Bonjour Alexis,%0A%0AJ'ai recu mon rapport de prospection et je suis interesse(e).%0A%0AMerci de me recontacter.%0A%0A${encodeURIComponent(prospect.prenom)}" style="display:inline-block;padding:16px 32px;background:#1D4ED8;color:#FFFFFF;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;">Discutons de vos objectifs</a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:24px 32px;text-align:center;background:#FAFAF9;border-top:1px solid #E7E5E4;">
    <p style="margin:0;font-size:12px;color:#A8A29E;">iFIND &mdash; Prospection B2B intelligente &bull; ${date}</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
  }

  // --- Etape 6 : Envoi ou fallback ---
  async _sendReport(htmlReport, prospect) {
    const chatId = this.adminChatId;

    // Verifier si un vrai domaine email est configure
    const hasRealSender = this.senderEmail &&
      this.senderEmail !== 'onboarding@resend.dev' &&
      this.senderEmail !== '';

    if (hasRealSender && this.resendKey) {
      try {
        const resend = new ResendClient(this.resendKey, this.senderEmail);
        const result = await resend.sendEmail(
          prospect.email,
          'Votre rapport de prospection iFIND — ' + prospect.prenom,
          htmlReport,
          { fromName: 'iFIND', replyTo: 'hello@ifind.fr' }
        );
        if (result.success) {
          await this.sendTelegram(chatId, '📧 *Rapport envoye par email a ' + prospect.email + '*');
          return { success: true, method: 'email', id: result.id };
        }
        console.log('[report-workflow] Erreur Resend, fallback fichier:', result.error);
      } catch (e) {
        console.log('[report-workflow] Erreur envoi email, fallback fichier:', e.message);
      }
    }

    // Fallback : sauvegarder le HTML en fichier
    const reportsDir = '/data/flowfast/reports';
    try {
      if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    } catch (e) {
      console.log('[report-workflow] Impossible de creer', reportsDir, ':', e.message);
    }

    const filename = 'rapport-' + prospect.id + '.html';
    const filepath = path.join(reportsDir, filename);

    try {
      fs.writeFileSync(filepath, htmlReport);
      await this.sendTelegram(chatId,
        '💾 *Rapport genere pour ' + prospect.prenom + '*\n\n' +
        '📁 Fichier : `' + filepath + '`\n' +
        '⚠️ _Email non envoye (domaine email non configure)_\n\n' +
        'Pour envoyer manuellement, copiez le contenu du fichier HTML.'
      );
      return { success: true, method: 'file', path: filepath };
    } catch (e) {
      await this.sendTelegram(chatId, '❌ Erreur sauvegarde rapport: ' + e.message);
      return { success: false, error: e.message };
    }
  }

  // --- Utilitaire : appel OpenAI ---
  _callOpenAI(prompt) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Tu es un assistant qui transforme des descriptions de cibles commerciales en criteres de recherche structures. Reponds uniquement en JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 500
      });
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.openaiKey,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (response.choices && response.choices[0]) {
              resolve(response.choices[0].message.content);
            } else {
              reject(new Error('Reponse OpenAI invalide'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout OpenAI')); });
      req.write(postData);
      req.end();
    });
  }
}

// --- Utilitaire : fetch prospect depuis le landing container ---
function fetchProspectData(prospectId) {
  return new Promise((resolve, reject) => {
    const req = http.get('http://landing-page:3080/api/prospect/' + prospectId, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error('Prospect non trouve (HTTP ' + res.statusCode + ')'));
          }
        } catch (e) { reject(new Error('Reponse invalide du landing server')); }
      });
    });
    req.on('error', (e) => reject(new Error('Landing server inaccessible: ' + e.message)));
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout landing server')); });
  });
}

module.exports = { ReportWorkflow, fetchProspectData };
