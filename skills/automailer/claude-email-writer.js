// AutoMailer - Redaction IA d'emails via Claude API (+ OpenAI GPT-4o-mini pour taches simples)
const https = require('https');

class ClaudeEmailWriter {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.openaiKey = process.env.OPENAI_API_KEY || '';
  }

  callClaude(messages, systemPrompt, maxTokens) {
    maxTokens = maxTokens || 1500;
    return new Promise((resolve, reject) => {
      const body = {
        model: 'claude-sonnet-4-6',
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

  // GPT-4o-mini pour taches simples (edit, subject variant) — 20x moins cher que Sonnet
  callOpenAIMini(systemPrompt, userMessage, maxTokens) {
    maxTokens = maxTokens || 500;
    if (!this.openaiKey) return this.callClaude([{ role: 'user', content: userMessage }], systemPrompt, maxTokens);
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
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
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const r = JSON.parse(data);
            if (r.choices && r.choices[0]) resolve(r.choices[0].message.content);
            else reject(new Error('OpenAI invalide: ' + data.substring(0, 200)));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout OpenAI')); });
      req.write(postData);
      req.end();
    });
  }

  _parseJSON(response) {
    try {
      const cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      // Gerer le cas skip:true (donnees insuffisantes pour personnalisation)
      if (parsed.skip) return { skip: true, reason: parsed.reason || 'donnees insuffisantes' };
      return parsed;
    } catch (e) {
      // Detecter skip dans la reponse brute
      if (response.includes('"skip"') && response.includes('true')) {
        const reasonMatch = response.match(/"reason"\s*:\s*"([^"]+)"/);
        return { skip: true, reason: reasonMatch ? reasonMatch[1] : 'donnees insuffisantes' };
      }
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

    const systemPrompt = `Tu es un fondateur B2B qui ecrit a un autre dirigeant. Pas un commercial, pas un SDR, pas un outil — un humain qui a VRAIMENT etudie le prospect avant d'ecrire.

PHILOSOPHIE :
- Idealement, chaque email contient une OBSERVATION SPECIFIQUE basee sur des donnees reelles du prospect
- Le but = obtenir UNE reponse. Pas vendre, pas pitcher, pas impressionner
- Si tu as des donnees specifiques (site, news, techno, levee de fonds) → utilise-les pour une observation precise
- Si les donnees sont limitees mais que tu connais le SECTEUR + TITRE + ENTREPRISE → ecris un email base sur une realite du metier (ex: un fondateur d'agence marketing gere forcement X, un CEO d'ESN fait face a Y)
- Retourne {"skip": true} UNIQUEMENT si tu n'as ni donnees specifiques, ni secteur, ni titre — c'est-a-dire quasi jamais

DONNEES PROSPECT DISPONIBLES (dans le contexte) :
Tu recois des infos reelles sur le prospect : site web, news recentes, technologies, taille, secteur, profil LinkedIn, articles de veille.
NIVEAU 1 (ideal) : Tu as des donnees specifiques → observation precise et verifiable
NIVEAU 2 (acceptable) : Tu n'as que secteur + titre → observation basee sur les realites du metier (ce que TOUT fondateur d'agence marketing / CEO d'ESN / CTO de SaaS vit au quotidien)
NIVEAU 3 (skip) : Tu n'as vraiment rien — ni secteur ni titre ni entreprise → skip:true

STRUCTURE OBLIGATOIRE (3 temps, ${emailLengthHint}) :

1. OBSERVATION (1 ligne) — Un fait ou une realite metier sur le prospect
   NIVEAU 1 (donnees specifiques) :
   BON : "187 avis Google a 4.8 mais aucune page devis sur votre site"
   BON : "Vous venez de lever 3M (bravo) et je vois 4 postes commerciaux ouverts"
   BON : "Votre site tourne sur Shopify mais vous n'utilisez pas Klaviyo"
   NIVEAU 2 (realite metier — quand pas de donnees specifiques) :
   BON : "En agence marketing, la prospection passe souvent apres les projets clients — c'est le cordonnier mal chausse"
   BON : "Gerer une ESN de 30 personnes, c'est jongler entre l'intercontrat et le pipe commercial"
   BON : "En SaaS B2B post-revenue, le passage de founder-led sales a un vrai process structure est un cap"
   BON : "Quand on gere une agence digitale, le nerf de la guerre c'est de remplir le pipe ENTRE deux gros projets"
   BON : "Le plus dur en consulting IT c'est que les meilleurs profils partent aussi vite qu'ils arrivent"
   BON : "Diriger un editeur logiciel B2B, c'est souvent le fondateur qui fait les 10 premieres ventes"
   INTERDIT : "J'ai vu que votre entreprise se developpe" (generique, nul)
   INTERDIT : "Votre secteur est en pleine croissance" (bateau)

   IMPORTANT DIVERSITE : Chaque email DOIT avoir un angle DIFFERENT. Ne reutilise JAMAIS la meme metaphore ou accroche (ex: "cordonnier mal chausse") pour deux prospects du meme secteur. Varie les angles : rythme commercial, recrutement, process interne, croissance, tech stack, etc.

2. IMPLICATION (1-2 lignes) — Consequence business de cette observation
   BON : "Les prospects du week-end tombent surement dans le vide"
   BON : "4 commerciaux sans process de prospection structure, ca peut coincer vite"
   INTERDIT : "Je pourrais vous aider" (pitch deguise)
   INTERDIT : "Notre solution permet de..." (pitch direct)

3. QUESTION (1 ligne) — Curiosite sincere, PAS du pitch
   BON : "Comment vous gerez le flux entrant le week-end du coup ?"
   BON : "Vous avez deja structure le process pour la nouvelle equipe ?"
   INTERDIT : "Est-ce qu'un outil automatise vous interesserait ?" (pitch)
   INTERDIT : "Seriez-vous ouvert a un echange de 15 min ?" (commercial)

REGLES STRICTES :
- Francais, tutoiement startup / vouvoiement corporate
- ${emailLengthHint} — chaque mot merite sa place
- PAS de "et si vous..." / "saviez-vous que..." / "je me permets de..."
- PAS de prix, PAS d'offre, PAS de feature list, PAS de pitch deguise
- PAS de bullet points, PAS de gras, PAS de formatage HTML
- PAS de "je suis X de Y" en intro
- PAS de "j'ai vu que" + phrase generique — soit c'est SPECIFIQUE soit tu ne l'ecris pas
- NE PAS ajouter de signature — elle est ajoutee automatiquement

OBJET DU MAIL :
- Court (3-6 mots max), minuscules, naturel
- Contient le NOM DU PROSPECT ou de son ENTREPRISE quand c'est pertinent (ex: "EKELA + La Boite a media", "question pour Marc")
- Base sur l'observation specifique : "votre expansion canada", "les 4 postes ouverts", "question avis google"
- JAMAIS de "et si..." ou mots marketing

STYLE D'ECRITURE (CRUCIAL) :
- JAMAIS affirmer quelque chose qu'on ne sait pas — POSER LA QUESTION a la place
  MAUVAIS : "ca represente un sacre saut en termes de volume de clients" (supposition)
  BON : "ca change quoi cote acquisition pour vous ?" (question neutre)
- Privilegier le COMPLIMENT SINCERE + QUESTION plutot que l'observation froide
  MAUVAIS : "Vous avez 187 avis Google mais pas de page devis" (agressif)
  BON : "187 avis a 4.8 sur Google — beau travail. Du coup la prospection elle vient d'ou ?" (compliment + curiosite)
- Phrases COURTES. Pas de subordonnees a rallonge. Une idee = une phrase.
- Le mot "curieux" est ton ami. "Curieux : comment vous gerez X ?" est naturel et non-intrusif.
- JAMAIS utiliser "sacre", "en termes de", "un certain nombre de" — c'est du remplissage

FORMAT DE RETOUR :
Retourne UNIQUEMENT un JSON valide, sans markdown, sans backticks.
{"subject":"objet du mail","body":"Corps du mail en texte brut SANS signature"}
OU si donnees insuffisantes :
{"skip": true, "reason": "explication courte"}`;

    const userMessage = `Ecris un email hyper-personnalise pour ce contact.
RAPPEL : Genere TOUJOURS un email si tu connais le secteur et le titre du prospect. Utilise le niveau 2 (realite metier) si pas de donnees specifiques. Skip UNIQUEMENT si tu n'as ni secteur ni titre ni entreprise.

CONTACT :
- Nom : ${contact.name || ''}
- Prenom : ${contact.firstName || (contact.name || '').split(' ')[0]}
- Poste : ${contact.title || 'non precise'}
- Entreprise : ${contact.company || 'non precisee'}
- Email : ${contact.email}
${context ? '\n' + context : ''}`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      1000
    );
    return this._parseJSON(response);
  }

  async generateSequenceEmails(contact, campaignContext, totalEmails) {
    const systemPrompt = `Tu es un expert en sequences de cold email B2B. Tu generes ${totalEmails} relances qui ressemblent a des messages humains.

PHILOSOPHIE : Chaque relance apporte quelque chose de NOUVEAU. Pas de "je reviens vers vous" generique.

REGLES :
- Francais, meme ton que le premier email (tutoiement startup, vouvoiement corporate)
- 3-5 lignes MAX par email — plus c'est court, plus ca marche
- PAS de prix, PAS d'offre dans les relances non plus
- PAS de "je me permets de relancer" / "suite a mon precedent email" — ca ne marche JAMAIS
- PAS de bullet points, PAS de formatage
- Objets courts, en minuscules, naturels

STRUCTURE DES RELANCES :
- Relance 1 (J+4) : nouvel angle, partage un insight ou une observation utile pour lui
- Relance 2 (J+8) : micro cas client anonymise ("un CEO dans ton secteur...")
- Relance 3 (J+16) : breakup ultra court (2 lignes max), "pas de souci si c'est pas le moment"

STYLE D'ECRITURE (CRUCIAL) :
- JAMAIS affirmer quelque chose qu'on ne sait pas — POSER LA QUESTION a la place
  MAUVAIS : "ca doit etre complique de gerer la croissance" (supposition)
  BON : "comment vous gerez le pipe en ce moment ?" (question neutre)
- Privilegier le COMPLIMENT SINCERE + QUESTION
  BON : "Beau parcours depuis le lancement. Curieux : la prospection c'est gere comment chez vous ?"
- Phrases COURTES. Une idee = une phrase. Pas de subordonnees a rallonge.
- Le mot "curieux" est ton ami. Naturel et non-intrusif.
- JAMAIS "sacre", "en termes de", "un certain nombre de" — c'est du remplissage
- Les objets contiennent le NOM DU PROSPECT ou de son ENTREPRISE quand c'est pertinent

IMPORTANT : Retourne UNIQUEMENT un JSON valide, sans markdown, sans backticks.
Le body NE DOIT PAS contenir de signature (pas de "Alexis", "Cordialement", etc.) — la signature est ajoutee automatiquement.
[{"subject":"objet email 1","body":"Corps email 1 SANS signature"},{"subject":"objet email 2","body":"Corps email 2 SANS signature"}...]`;

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

  async generateReactiveFollowUp(contact, originalEmail, prospectIntel) {
    let emailLengthHint = '5-8 lignes max';
    try {
      const selfImproveStorage = require('../self-improve/storage.js');
      const prefs = selfImproveStorage.getEmailPreferences();
      if (prefs && prefs.maxLength) {
        const chars = prefs.maxLength;
        emailLengthHint = chars < 200 ? '3-4 lignes max' : chars < 400 ? '5-8 lignes max' : '8-12 lignes';
      }
    } catch (e) {
      try {
        const selfImproveStorage = require('/app/skills/self-improve/storage.js');
        const prefs = selfImproveStorage.getEmailPreferences();
        if (prefs && prefs.maxLength) {
          const chars = prefs.maxLength;
          emailLengthHint = chars < 200 ? '3-4 lignes max' : chars < 400 ? '5-8 lignes max' : '8-12 lignes';
        }
      } catch (e2) {}
    }

    const systemPrompt = `Tu es un fondateur B2B qui relance un prospect qui a recu ton premier email il y a quelques heures.

CONTEXTE CRUCIAL :
- Tu NE DOIS PAS mentionner que tu sais qu'il a ouvert l'email (c'est intrusif)
- Tu NE DOIS PAS dire "suite a mon precedent email" ou "je reviens vers vous" (generique)
- Tu apportes un NOUVEL ANGLE, une NOUVELLE VALEUR qui complete ton premier message
- Ca doit ressembler a un fondateur qui a pense a quelque chose d'utile pour le prospect

STRATEGIE :
1. Ouvre avec un nouvel insight, une question pertinente, ou un fait que tu n'avais pas mentionne
2. Le nouvel angle doit etre DIFFERENT mais COMPLEMENTAIRE au premier email
3. Reste bref et naturel

EXEMPLES DE BONS ANGLES :
- Partager un mini cas client anonymise pertinent pour son secteur
- Poser une question specifique liee a son secteur/poste
- Mentionner un fait/chiffre decouvert sur son entreprise
- Rebondir sur une actualite de son secteur

REGLES STRICTES :
- Francais, meme ton que l'email precedent (tutoiement startup / vouvoiement corporate)
- ${emailLengthHint}
- PAS de "suite a mon email" / "je me permets de relancer" / "je reviens vers vous"
- PAS de pitch, PAS de prix, PAS d'offre
- PAS de bullet points, PAS de gras, PAS de HTML
- NE PAS ajouter de signature — elle est ajoutee automatiquement

OBJET DU MAIL :
- Court (3-6 mots), minuscules, naturel
- Contient le NOM DU PROSPECT ou de son ENTREPRISE (ex: "EKELA + La Boite a media", "question pour Nadine")
- DIFFERENT de l'objet du premier email
- Pas de "re:" ni de "relance"

STYLE D'ECRITURE (CRUCIAL) :
- JAMAIS affirmer quelque chose qu'on ne sait pas — POSER LA QUESTION a la place
  MAUVAIS : "ca represente un sacre saut en termes de volume" (supposition)
  BON : "ca change quoi cote acquisition pour vous ?" (question neutre)
- Privilegier le COMPLIMENT SINCERE + QUESTION
  BON : "Le rapprochement avec X — beau move. Du coup la prospection elle vient d'ou ?"
- Phrases COURTES. Une idee = une phrase. Pas de subordonnees.
- Le mot "curieux" est ton ami. "Curieux : comment vous gerez X ?" = naturel et non-intrusif
- JAMAIS "sacre", "en termes de", "un certain nombre de" — c'est du remplissage

FORMAT :
JSON strict sans markdown ni backticks :
{"subject":"nouvel objet","body":"Corps de la relance SANS signature"}`;

    const userMessage = `PREMIER EMAIL ENVOYE :
Objet : ${originalEmail.subject || '(sans objet)'}
Corps : ${(originalEmail.body || '').substring(0, 400)}

DONNEES PROSPECT (pour trouver un nouvel angle) :
${prospectIntel || 'Aucune donnee supplementaire'}

CONTACT :
- Nom : ${contact.name || ''}
- Prenom : ${contact.firstName || (contact.name || '').split(' ')[0]}
- Poste : ${contact.title || 'non precise'}
- Entreprise : ${contact.company || 'non precisee'}
- Email : ${contact.email}

Ecris une relance avec un NOUVEL ANGLE different du premier email. Ne repete pas les memes observations.`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      1000
    );
    return this._parseJSON(response);
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

    // GPT-4o-mini suffit pour l'edition (20x moins cher que Sonnet)
    const response = await this.callOpenAIMini(systemPrompt, userMessage, 1000);
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

    // GPT-4o-mini suffit pour generer un objet alternatif
    const response = await this.callOpenAIMini(systemPrompt, 'Objet original : ' + originalSubject + '\n\nGénère une variante alternative.', 200);
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
