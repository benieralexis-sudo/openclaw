// iFIND - Workflow de generation de rapport de prospection personnalise
// V2 : utilise les prospects fournis par le client (pas Apollo) + emails killer Claude
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const log = require('./logger.js');
const { getBreaker } = require('./circuit-breaker.js');

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

// --- Parser les prospects depuis le textarea (1 par ligne) ---
function parseProspects(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  return rawText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 3)
    .slice(0, 5) // Max 5
    .map(line => {
      // Formats acceptes : "Nom, Poste, Entreprise" ou "Nom - Poste - Entreprise" ou "Nom / Poste / Entreprise"
      const parts = line.split(/[,\-\/]/).map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length >= 3) {
        return { fullName: parts[0], title: parts[1], company: parts.slice(2).join(', ') };
      } else if (parts.length === 2) {
        return { fullName: parts[0], title: '', company: parts[1] };
      } else {
        return { fullName: parts[0] || line, title: '', company: '' };
      }
    })
    .filter(p => p.fullName.length > 1);
}

class ReportWorkflow {
  constructor(options) {
    this.claudeKey = options.claudeKey;
    this.resendKey = options.resendKey;
    this.senderEmail = options.senderEmail;
    this.sendTelegram = options.sendTelegram;
    this.adminChatId = options.adminChatId;
    this.bookingUrl = options.bookingUrl || process.env.BOOKING_URL || '';
  }

  async generateReport(prospect) {
    const chatId = this.adminChatId;
    const steps = [];

    try {
      // Etape 1 : Parser les prospects
      await this.sendTelegram(chatId, '🔍 _Analyse des prospects..._');
      const prospects = parseProspects(prospect.prospects || prospect.cible || '');
      if (prospects.length === 0) {
        await this.sendTelegram(chatId, '⚠️ Aucun prospect valide trouve dans la demande.');
        return { success: false, error: 'no_prospects' };
      }
      steps.push('parse_ok');
      await this.sendTelegram(chatId, `✅ _${prospects.length} prospect(s) identifie(s)_`);

      // Etape 2 : Generer un email personnalise par prospect via Claude
      await this.sendTelegram(chatId, '✍️ _Redaction des emails personnalises par Claude..._');
      const prospectsWithEmails = await this._generateAuditEmails(prospects, prospect);
      steps.push('emails_ok');
      await this.sendTelegram(chatId, `✅ _${prospectsWithEmails.length} email(s) redige(s)_`);

      // Etape 3 : Compiler le rapport HTML premium
      const htmlReport = this._buildPremiumReport(prospectsWithEmails, prospect);
      steps.push('html_ok');

      // Etape 4 : Envoyer par email
      const sendResult = await this._sendReport(htmlReport, prospect);
      steps.push('send_ok');

      return { success: true, prospects: prospectsWithEmails, html: htmlReport, sent: sendResult, steps };

    } catch (error) {
      log.error('report-workflow', 'Erreur:', error.message);
      await this.sendTelegram(chatId, '❌ Erreur generation rapport: ' + error.message);
      return { success: false, error: error.message, steps };
    }
  }

  // --- Generation d'emails via Claude (le coeur du systeme) ---
  async _generateAuditEmails(prospects, clientInfo) {
    const breaker = getBreaker('report-claude', { failureThreshold: 3, cooldownMs: 60000 });
    const senderName = process.env.SENDER_NAME || 'Alexis';
    const clientName = process.env.CLIENT_NAME || 'iFIND';
    const clientEntreprise = clientInfo.entreprise || '';

    const results = [];

    for (const target of prospects) {
      try {
        const email = await breaker.call(() => this._callClaude(target, clientInfo, senderName, clientName, clientEntreprise));
        results.push({ ...target, generatedEmail: email });
      } catch (e) {
        log.warn('report-workflow', 'Email echoue pour ' + target.fullName + ':', e.message);
        // Fallback : email generique mais propre
        const firstName = target.fullName.split(' ')[0];
        results.push({
          ...target,
          generatedEmail: {
            subject: firstName + ', rapide question',
            body: 'Bonjour ' + firstName + ',\n\n' +
              (target.title ? 'En tant que ' + target.title + (target.company ? ' chez ' + target.company : '') + ', ' : '') +
              'vous gerez probablement la croissance commerciale au quotidien.\n\n' +
              'Une question : comment vous generez vos nouveaux clients aujourd\'hui ?\n\n' +
              'Bonne journee,\n' + senderName,
            whyItWorks: 'Email de fallback — question ouverte sur l\'acquisition client.'
          }
        });
      }
    }

    return results;
  }

  // --- Appel Claude pour un email individuel ---
  async _callClaude(target, clientInfo, senderName, clientName, clientEntreprise) {
    const firstName = target.fullName.split(' ')[0];

    const prompt = `Tu es ${senderName}, fondateur de ${clientName} (prospection B2B automatisee par IA).
${clientEntreprise ? 'Le client qui demande cet audit dirige : ' + clientEntreprise + '.' : ''}

CONTEXTE : Un prospect potentiel a demande un audit gratuit pour voir la qualite de nos emails. Tu dois rediger UN email de prospection EXCEPTIONNEL pour cette cible. Cet email est une DEMO de notre savoir-faire — il doit etre tellement bon que le prospect veut signer.

CIBLE :
- Nom : ${target.fullName}
- Poste : ${target.title || 'Non precise'}
- Entreprise : ${target.company || 'Non precisee'}

REGLES STRICTES (style cold email top 1%) :
1. OBJET : 2-4 mots minuscules, specifique a la cible. Exemples : "${firstName.toLowerCase()}, une question", "recrutement ${target.company ? target.company.toLowerCase() : 'equipe'}", "${target.title ? target.title.toLowerCase().split(' ')[0] : 'question'} + croissance"
2. CORPS : Maximum 60 mots. Structure = Observation factuelle specifique (1 phrase) → Hypothese business (1 phrase) → Question ouverte (1 phrase).
3. TUTOIEMENT si le poste est startup/tech, VOUVOIEMENT sinon.
4. ZERO formule bateau : pas de "je me permets", "n'hesitez pas", "je serais ravi", "j'ai vu que", "en parcourant votre profil".
5. Signe juste : "${senderName}" (pas de titre, pas de lien, pas de PS).

AJOUTE aussi un champ "whyItWorks" (2-3 phrases en francais) qui explique POURQUOI cet email est efficace — c'est la partie pedagogique qui impressionne le prospect de l'audit.

Reponds UNIQUEMENT en JSON valide :
{
  "subject": "objet de l'email",
  "body": "corps de l'email",
  "whyItWorks": "explication de pourquoi cet email fonctionne"
}`;

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: 'claude-sonnet-4-6-20250514',
        max_tokens: 600,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }]
      });

      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.claudeKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (response.content && response.content[0]) {
              const text = response.content[0].text.trim();
              const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
              const email = JSON.parse(cleaned);
              if (!email.subject || !email.body) throw new Error('Email incomplet');
              resolve(email);
            } else {
              reject(new Error('Reponse Claude invalide: ' + (response.error ? response.error.message : 'pas de contenu')));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout Claude API')); });
      req.write(postData);
      req.end();
    });
  }

  // --- Rapport HTML premium (design qui vend) ---
  _buildPremiumReport(prospects, clientInfo) {
    const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
    const clientName = process.env.CLIENT_NAME || 'iFIND';
    const safePrenom = escapeHtml(clientInfo.prenom);
    const safeEntreprise = escapeHtml(clientInfo.entreprise || '');
    const bookingUrl = this.bookingUrl;

    const prospectsHtml = prospects.map((p, i) => {
      const safeName = escapeHtml(p.fullName);
      const safeTitle = escapeHtml(p.title || 'Poste non precise');
      const safeCompany = escapeHtml(p.company || 'Entreprise non precisee');
      const safeSubject = escapeHtml(p.generatedEmail.subject);
      const safeBody = escapeHtml(p.generatedEmail.body);
      const safeWhy = escapeHtml(p.generatedEmail.whyItWorks || '');

      return `
    <tr><td style="padding:0 32px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
        <!-- Prospect header -->
        <tr><td style="padding:24px 24px 16px;border-bottom:1px solid #F1F5F9;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:top;">
                <span style="display:inline-block;width:32px;height:32px;background:#1D4ED8;color:#fff;border-radius:50%;text-align:center;line-height:32px;font-weight:700;font-size:14px;margin-right:12px;vertical-align:middle;">${i + 1}</span>
                <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:18px;font-weight:700;color:#0F172A;vertical-align:middle;">${safeName}</span>
                <br><span style="font-size:14px;color:#64748B;margin-left:44px;">${safeTitle}${safeCompany !== 'Entreprise non precisee' ? ' chez <strong style="color:#334155;">' + safeCompany + '</strong>' : ''}</span>
              </td>
            </tr>
          </table>
        </td></tr>
        <!-- Email pret a envoyer -->
        <tr><td style="padding:20px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border-radius:12px;border:1px solid #E2E8F0;">
            <tr><td style="padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding-bottom:4px;">
                  <span style="font-size:11px;font-weight:700;color:#1D4ED8;text-transform:uppercase;letter-spacing:0.08em;">Email pret a copier-coller</span>
                </td></tr>
                <tr><td style="padding-bottom:12px;border-bottom:1px solid #E2E8F0;">
                  <span style="font-size:13px;color:#64748B;">Objet :</span>
                  <span style="font-size:15px;font-weight:700;color:#0F172A;"> ${safeSubject}</span>
                </td></tr>
                <tr><td style="padding-top:16px;">
                  <p style="margin:0;font-size:15px;color:#334155;line-height:1.8;white-space:pre-line;">${safeBody}</p>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
        ${safeWhy ? `<!-- Pourquoi ca marche -->
        <tr><td style="padding:0 24px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFBEB;border-radius:10px;border:1px solid #FDE68A;">
            <tr><td style="padding:14px 18px;">
              <span style="font-size:12px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.05em;">Pourquoi cet email fonctionne</span>
              <p style="margin:6px 0 0;font-size:13px;color:#78350F;line-height:1.6;">${safeWhy}</p>
            </td></tr>
          </table>
        </td></tr>` : ''}
      </table>
    </td></tr>`;
    }).join('\n');

    // CTA : booking link ou mailto fallback
    const ctaHref = bookingUrl
      ? bookingUrl
      : 'mailto:' + (process.env.REPLY_TO_EMAIL || process.env.SENDER_EMAIL || 'alexis@getifind.fr') + '?subject=' + encodeURIComponent(clientName + ' — Je veux automatiser ca') + '&body=' + encodeURIComponent('Bonjour, j\'ai recu mon audit et je suis interesse(e).\n\n' + (clientInfo.prenom || ''));
    const ctaText = bookingUrl ? 'Reserver un appel de 15 min' : 'Discutons de vos objectifs';

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Votre Audit Pipeline — ${clientName}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:'Outfit',Arial,Helvetica,sans-serif;color:#0F172A;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.08);">

  <!-- Header gradient -->
  <tr><td style="padding:48px 32px 40px;background:linear-gradient(135deg,#1D4ED8 0%,#3B82F6 50%,#1E40AF 100%);text-align:center;">
    <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:32px;font-weight:800;color:#FFFFFF;letter-spacing:-0.03em;">${clientName}</span>
    <p style="margin:12px 0 0;color:rgba(255,255,255,0.85);font-size:16px;font-weight:500;">Votre audit pipeline personnalise</p>
  </td></tr>

  <!-- Intro -->
  <tr><td style="padding:40px 32px 32px;">
    <p style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0F172A;font-family:'Space Grotesk',Arial,sans-serif;">Bonjour ${safePrenom},</p>
    <p style="margin:0 0 16px;font-size:16px;color:#475569;line-height:1.75;">Comme promis, voici votre audit gratuit. Nous avons redige <strong style="color:#0F172A;">${prospects.length} email${prospects.length > 1 ? 's' : ''} de prospection personnalise${prospects.length > 1 ? 's' : ''}</strong> pour vos vrais prospects.</p>
    <p style="margin:0 0 16px;font-size:16px;color:#475569;line-height:1.75;">Chaque email est <strong>pret a copier-coller</strong>. Vous pouvez les envoyer tel quel ou les adapter.</p>
    ${safeEntreprise ? '<p style="margin:0;padding:14px 20px;background:#F8FAFC;border-radius:10px;border-left:4px solid #1D4ED8;font-size:14px;color:#475569;">Contexte : <strong style="color:#0F172A;">' + safeEntreprise + '</strong></p>' : ''}
  </td></tr>

  <!-- Separator -->
  <tr><td style="padding:0 32px;"><hr style="border:none;border-top:2px solid #F1F5F9;margin:0;"></td></tr>

  <!-- Prospects title -->
  <tr><td style="padding:32px 32px 24px;">
    <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:22px;font-weight:700;color:#0F172A;">Vos ${prospects.length} email${prospects.length > 1 ? 's' : ''} personnalise${prospects.length > 1 ? 's' : ''}</span>
    <p style="margin:8px 0 0;font-size:14px;color:#94A3B8;">Rediges par notre IA de prospection — style cold email top 1%</p>
  </td></tr>

  <!-- Prospect cards -->
${prospectsHtml}

  <!-- Section "Ce qu'on ferait pour vous" -->
  <tr><td style="padding:16px 32px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#EFF6FF;border-radius:16px;border:1px solid #BFDBFE;">
      <tr><td style="padding:28px;">
        <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:18px;font-weight:700;color:#1E40AF;">Imaginez ca x500 chaque mois.</span>
        <p style="margin:12px 0 0;font-size:15px;color:#1E40AF;line-height:1.75;">
          Ce que vous venez de voir sur ${prospects.length} prospect${prospects.length > 1 ? 's' : ''}, on le fait <strong>automatiquement</strong> sur des centaines de prospects chaque mois :
        </p>
        <table cellpadding="0" cellspacing="0" style="margin:16px 0 0;">
          <tr><td style="padding:6px 0;font-size:14px;color:#1E3A8A;">&#10003; Identification de vos prospects ideaux (signaux d'achat en temps reel)</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#1E3A8A;">&#10003; Redaction IA personnalisee pour chaque prospect (comme cet audit)</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#1E3A8A;">&#10003; Envoi automatique + relances intelligentes (3 touchpoints)</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#1E3A8A;">&#10003; Gestion des reponses et booking de RDV automatise</td></tr>
        </table>
        <p style="margin:16px 0 0;font-size:15px;color:#1E40AF;line-height:1.75;"><strong>Resultat moyen : 5 a 15 RDV qualifies par mois.</strong></p>
      </td></tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:8px 32px 40px;text-align:center;">
    <p style="margin:0 0 8px;font-family:'Space Grotesk',Arial,sans-serif;font-size:22px;font-weight:700;color:#0F172A;">On en discute ?</p>
    <p style="margin:0 0 24px;font-size:15px;color:#64748B;">15 minutes pour voir comment adapter ca a votre business.</p>
    <a href="${ctaHref}" style="display:inline-block;padding:18px 40px;background:#1D4ED8;color:#FFFFFF;text-decoration:none;border-radius:12px;font-weight:700;font-size:16px;box-shadow:0 4px 16px rgba(29,78,216,0.3);">${ctaText}</a>
    <p style="margin:16px 0 0;font-size:13px;color:#94A3B8;">Gratuit, sans engagement. On repond en moins de 24h.</p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:24px 32px;text-align:center;background:#F8FAFC;border-top:1px solid #E2E8F0;">
    <p style="margin:0 0 4px;font-family:'Space Grotesk',Arial,sans-serif;font-size:14px;font-weight:600;color:#64748B;">${clientName}</p>
    <p style="margin:0;font-size:12px;color:#94A3B8;">Prospection B2B intelligente &bull; ${date}</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
  }

  // --- Envoi rapport ou fallback fichier ---
  async _sendReport(htmlReport, prospect) {
    const chatId = this.adminChatId;

    const hasRealSender = this.senderEmail &&
      this.senderEmail !== 'onboarding@resend.dev' &&
      this.senderEmail !== '';

    if (hasRealSender && this.resendKey) {
      try {
        const result = await this._sendViaResend(
          prospect.email,
          'Votre audit pipeline ' + (process.env.CLIENT_NAME || 'iFIND') + ' — ' + prospect.prenom,
          htmlReport
        );
        if (result.success) {
          await this.sendTelegram(chatId, '📧 *Rapport envoye par email a ' + prospect.email + '*');
          return { success: true, method: 'email', id: result.id };
        }
        log.warn('report-workflow', 'Erreur Resend, fallback fichier:', result.error);
      } catch (e) {
        log.warn('report-workflow', 'Erreur envoi email, fallback fichier:', e.message);
      }
    }

    // Fallback fichier
    const reportsDir = '/data/flowfast/reports';
    try { if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true }); } catch (e) {}

    const filename = 'rapport-' + prospect.id + '.html';
    const filepath = path.join(reportsDir, filename);

    try {
      fs.writeFileSync(filepath, htmlReport);
      await this.sendTelegram(chatId,
        '💾 *Rapport genere pour ' + prospect.prenom + '*\n\n' +
        '📁 Fichier : `' + filepath + '`\n' +
        '⚠️ _Email non envoye (domaine email non configure)_'
      );
      return { success: true, method: 'file', path: filepath };
    } catch (e) {
      await this.sendTelegram(chatId, '❌ Erreur sauvegarde rapport: ' + e.message);
      return { success: false, error: e.message };
    }
  }

  // --- Envoi via Resend API ---
  _sendViaResend(to, subject, html) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        from: (process.env.CLIENT_NAME || 'iFIND') + ' <' + this.senderEmail + '>',
        to: [to],
        subject: subject,
        html: html,
        reply_to: process.env.REPLY_TO_EMAIL || this.senderEmail
      });

      const req = https.request({
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.resendKey,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300 && response.id) {
              resolve({ success: true, id: response.id });
            } else {
              resolve({ success: false, error: response.message || 'Erreur Resend HTTP ' + res.statusCode });
            }
          } catch (e) { resolve({ success: false, error: 'Reponse Resend invalide' }); }
        });
      });
      req.on('error', e => reject(e));
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout Resend')); });
      req.write(postData);
      req.end();
    });
  }
}

// --- Envoi email de confirmation immediat ---
async function sendConfirmationEmail(resendKey, senderEmail, prospect) {
  if (!resendKey || !senderEmail || senderEmail === 'onboarding@resend.dev') return { success: false, error: 'Resend non configure' };

  const clientName = process.env.CLIENT_NAME || 'iFIND';
  const safePrenom = escapeHtml(prospect.prenom);
  const nbProspects = parseProspects(prospect.prospects || '').length;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:'Outfit',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
  <tr><td style="padding:36px 32px 28px;background:#1D4ED8;text-align:center;">
    <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:24px;font-weight:800;color:#fff;">${clientName}</span>
  </td></tr>
  <tr><td style="padding:36px 32px;">
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#0F172A;">Bonjour ${safePrenom} !</p>
    <p style="margin:0 0 16px;font-size:16px;color:#475569;line-height:1.75;">Votre demande d'audit est bien recue. Notre equipe prepare <strong style="color:#0F172A;">${nbProspects} email${nbProspects > 1 ? 's' : ''} personnalise${nbProspects > 1 ? 's' : ''}</strong> pour vos prospects.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0FDF4;border-radius:12px;border:1px solid #BBF7D0;margin:20px 0;">
      <tr><td style="padding:20px;">
        <span style="font-size:14px;font-weight:700;color:#166534;">Ce qui se passe maintenant :</span>
        <table cellpadding="0" cellspacing="0" style="margin:12px 0 0;">
          <tr><td style="padding:4px 0;font-size:14px;color:#15803D;">&#9201; Notre IA analyse chacun de vos prospects</td></tr>
          <tr><td style="padding:4px 0;font-size:14px;color:#15803D;">&#9998; Un email unique est redige pour chacun</td></tr>
          <tr><td style="padding:4px 0;font-size:14px;color:#15803D;">&#128232; Vous recevez votre rapport sous 48h</td></tr>
        </table>
      </td></tr>
    </table>
    <p style="margin:0;font-size:15px;color:#475569;line-height:1.75;">En attendant, si vous avez des questions, repondez directement a cet email.</p>
  </td></tr>
  <tr><td style="padding:20px 32px;text-align:center;background:#F8FAFC;border-top:1px solid #E2E8F0;">
    <p style="margin:0;font-size:12px;color:#94A3B8;">${clientName} — Prospection B2B intelligente</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      from: clientName + ' <' + senderEmail + '>',
      to: [prospect.email],
      subject: safePrenom + ', votre audit pipeline est en preparation',
      html: html,
      reply_to: process.env.REPLY_TO_EMAIL || senderEmail
    });

    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + resendKey,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve(res.statusCode < 300 && response.id ? { success: true, id: response.id } : { success: false, error: response.message || 'HTTP ' + res.statusCode });
        } catch (e) { resolve({ success: false, error: 'Parse error' }); }
      });
    });
    req.on('error', e => resolve({ success: false, error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
    req.write(postData);
    req.end();
  });
}

// --- Fetch prospect depuis le landing container ---
function fetchProspectData(prospectId) {
  return new Promise((resolve, reject) => {
    const req = http.get('http://landing-page:3080/api/prospect/' + prospectId, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode === 200) resolve(JSON.parse(body));
          else reject(new Error('Prospect non trouve (HTTP ' + res.statusCode + ')'));
        } catch (e) { reject(new Error('Reponse invalide du landing server')); }
      });
    });
    req.on('error', (e) => reject(new Error('Landing server inaccessible: ' + e.message)));
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout landing server')); });
  });
}

module.exports = { ReportWorkflow, fetchProspectData, sendConfirmationEmail, parseProspects };
