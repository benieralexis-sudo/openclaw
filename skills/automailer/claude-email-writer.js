// AutoMailer - Redaction IA d'emails via Claude API
const https = require('https');

class ClaudeEmailWriter {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  callClaude(messages, systemPrompt, maxTokens) {
    maxTokens = maxTokens || 1500;
    return new Promise((resolve, reject) => {
      const body = {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: maxTokens,
        messages: messages
      };
      if (systemPrompt) body.system = systemPrompt;

      const postData = JSON.stringify(body);
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.content && response.content[0]) {
              resolve(response.content[0].text);
            } else if (response.error) {
              reject(new Error('Claude API: ' + (response.error.message || JSON.stringify(response.error))));
            } else {
              reject(new Error('Reponse Claude invalide'));
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

  _parseJSON(response) {
    try {
      const cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      const subjectMatch = response.match(/"subject"\s*:\s*"([^"]+)"/);
      const bodyMatch = response.match(/"body"\s*:\s*"([\s\S]+?)"\s*\}/);
      if (subjectMatch && bodyMatch) {
        return { subject: subjectMatch[1], body: bodyMatch[1].replace(/\\n/g, '\n') };
      }
      throw new Error('Impossible de parser la reponse Claude');
    }
  }

  async generateSingleEmail(contact, context) {
    // Lire les preferences de longueur depuis Self-Improve (si disponible)
    let emailLengthHint = '5-8 lignes max';
    try {
      const selfImproveStorage = require('../self-improve/storage.js');
      const prefs = selfImproveStorage.getEmailPreferences();
      if (prefs && prefs.maxLength) {
        const chars = prefs.maxLength;
        emailLengthHint = chars < 200 ? '3-4 lignes max (court et percutant)' : chars < 400 ? '5-8 lignes max' : '8-12 lignes';
      }
    } catch (e) {
      try {
        const selfImproveStorage = require('/app/skills/self-improve/storage.js');
        const prefs = selfImproveStorage.getEmailPreferences();
        if (prefs && prefs.maxLength) {
          const chars = prefs.maxLength;
          emailLengthHint = chars < 200 ? '3-4 lignes max (court et percutant)' : chars < 400 ? '5-8 lignes max' : '8-12 lignes';
        }
      } catch (e2) {}
    }

    const systemPrompt = `Tu es un expert en redaction d'emails professionnels et de prospection B2B.
Tu ecris des emails personnalises, professionnels et percutants.

REGLES :
- Ecris en francais sauf si le contact est dans un pays anglophone
- Le mail doit etre court (${emailLengthHint})
- Commence par une accroche personnalisee (reference au poste, a l'entreprise)
- Propose une valeur concrete, pas du blabla generique
- Termine par un call-to-action clair (appel, visio, reponse)
- Ton : professionnel mais humain, pas robotique
- NE mets PAS de placeholders comme [votre entreprise] — ecris un mail pret a envoyer
- Genere aussi un objet (subject) accrocheur et court

IMPORTANT : Retourne UNIQUEMENT un JSON valide, sans markdown, sans backticks :
{"subject":"Objet du mail","body":"Corps du mail en texte brut"}`;

    const userMessage = `Ecris un email pour ce contact :

Nom : ${contact.name || ''}
Prenom : ${contact.firstName || (contact.name || '').split(' ')[0]}
Poste : ${contact.title || 'non precise'}
Entreprise : ${contact.company || 'non precisee'}
Email : ${contact.email}
${context ? '\nContexte / objectif : ' + context : ''}`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      1000
    );
    return this._parseJSON(response);
  }

  async generateSequenceEmails(contact, campaignContext, totalEmails) {
    const systemPrompt = `Tu es un expert en sequences d'emails de prospection B2B.
Tu dois generer une sequence de ${totalEmails} emails qui se suivent logiquement.

REGLES :
- Ecris en francais sauf si le contact est dans un pays anglophone
- Chaque email : 5-8 lignes max
- Email 1 : premier contact, accroche personnalisee, proposition de valeur
- Email 2 : relance douce, apport de valeur supplementaire (etude de cas, chiffre cle)
- Email 3+ : derniere tentative, ton plus direct, urgence douce
- Chaque email doit pouvoir etre lu independamment
- Ton : professionnel mais humain, evolutif (de curieux a direct)
- NE mets PAS de placeholders — ecris des mails prets a envoyer
- Chaque email a son propre objet (subject)

IMPORTANT : Retourne UNIQUEMENT un JSON valide, sans markdown, sans backticks :
[{"subject":"Objet email 1","body":"Corps email 1"},{"subject":"Objet email 2","body":"Corps email 2"}...]`;

    const userMessage = `Genere une sequence de ${totalEmails} emails pour :

Nom : ${contact.name || ''}
Prenom : ${contact.firstName || (contact.name || '').split(' ')[0]}
Poste : ${contact.title || 'non precise'}
Entreprise : ${contact.company || 'non precisee'}
Email : ${contact.email}

Objectif de la campagne : ${campaignContext || 'prospection B2B generique'}`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      3000
    );

    try {
      const cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const emails = JSON.parse(cleaned);
      if (Array.isArray(emails)) return emails;
      throw new Error('Format invalide');
    } catch (e) {
      // Fallback : essayer de parser comme objet unique
      return [this._parseJSON(response)];
    }
  }

  async editEmail(currentEmail, instruction) {
    const systemPrompt = `Tu es un expert en redaction d'emails professionnels.
L'utilisateur te donne un email existant et une instruction de modification.
Applique la modification demandee tout en gardant le mail professionnel et percutant.

IMPORTANT : Retourne UNIQUEMENT un JSON valide, sans markdown, sans backticks :
{"subject":"Objet du mail","body":"Corps du mail en texte brut"}`;

    const userMessage = `Voici l'email actuel :

Objet : ${currentEmail.subject}

${currentEmail.body}

Instruction de modification : ${instruction}`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      1000
    );
    return this._parseJSON(response);
  }

  async personalizeEmail(subject, body, contactData) {
    const systemPrompt = `Tu es un expert cold email B2B. Voici un template d'email et les données du contact. Personnalise subtilement l'email pour ce contact spécifique. Garde le même ton et la même structure, mais adapte les références au secteur, au poste, à l'entreprise. Ne change PAS le sens du message. Retourne le résultat en JSON {subject, body}.

REGLES :
- Garde la même longueur approximative
- Ne change pas le call-to-action
- Adapte les références concrètes au contexte du contact (secteur, taille, défis typiques du poste)
- Ton naturel, pas sur-personnalisé
- Retourne UNIQUEMENT un JSON valide, sans markdown, sans backticks :
{"subject":"Objet personnalisé","body":"Corps personnalisé en texte brut"}`;

    const contactInfo = [];
    if (contactData.firstName) contactInfo.push('Prénom : ' + contactData.firstName);
    if (contactData.lastName) contactInfo.push('Nom : ' + contactData.lastName);
    if (contactData.name) contactInfo.push('Nom complet : ' + contactData.name);
    if (contactData.title) contactInfo.push('Poste : ' + contactData.title);
    if (contactData.company) contactInfo.push('Entreprise : ' + contactData.company);
    if (contactData.industry) contactInfo.push('Secteur : ' + contactData.industry);
    if (contactData.companySize) contactInfo.push('Taille entreprise : ' + contactData.companySize);
    if (contactData.city) contactInfo.push('Ville : ' + contactData.city);
    if (contactData.country) contactInfo.push('Pays : ' + contactData.country);
    if (contactData.linkedinUrl) contactInfo.push('LinkedIn : ' + contactData.linkedinUrl);

    const userMessage = `Voici le template d'email à personnaliser :

Objet : ${subject}

Corps :
${body}

Données du contact :
${contactInfo.join('\n')}

Personnalise cet email pour ce contact spécifique.`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      1500
    );
    return this._parseJSON(response);
  }

  async generateSubjectVariant(originalSubject) {
    const systemPrompt = `Tu es un expert en cold email B2B et A/B testing. On te donne un objet d'email. Génère une variante alternative qui a le même sens mais une formulation différente. L'objectif est de tester quel objet obtient le meilleur taux d'ouverture.

REGLES :
- Même sens, même longueur approximative
- Formulation différente (angle, structure, mots-clés)
- Garde le ton professionnel
- Retourne UNIQUEMENT le texte de l'objet alternatif, rien d'autre (pas de JSON, pas de guillemets, pas d'explication)`;

    const response = await this.callClaude(
      [{ role: 'user', content: 'Objet original : ' + originalSubject + '\n\nGénère une variante alternative.' }],
      systemPrompt,
      200
    );
    return response.trim().replace(/^["']|["']$/g, '');
  }

  async generateFromTemplate(template, contact) {
    // Remplace les variables {{...}} par les valeurs du contact
    let subject = template.subject;
    let body = template.body;
    const vars = {
      firstName: contact.firstName || (contact.name || '').split(' ')[0] || '',
      lastName: contact.lastName || '',
      name: contact.name || '',
      email: contact.email || '',
      company: contact.company || '',
      title: contact.title || ''
    };
    for (const key of Object.keys(vars)) {
      const regex = new RegExp('\\{\\{' + key + '\\}\\}', 'g');
      subject = subject.replace(regex, vars[key]);
      body = body.replace(regex, vars[key]);
    }
    return { subject, body };
  }
}

module.exports = ClaudeEmailWriter;
