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
    // Lire les preferences depuis Self-Improve (si disponible)
    let emailLengthHint = '60-80 mots max';
    let subjectStyleHint = '';
    let siPrefs = null;
    try {
      const selfImproveStorage = require('../self-improve/storage.js');
      siPrefs = selfImproveStorage.getEmailPreferences();
    } catch (e) {
      try {
        const selfImproveStorage = require('/app/skills/self-improve/storage.js');
        siPrefs = selfImproveStorage.getEmailPreferences();
      } catch (e2) {}
    }
    if (siPrefs) {
      // maxLength est un string "short"/"medium"/"long"
      if (siPrefs.maxLength === 'short') emailLengthHint = '40-60 mots max';
      else if (siPrefs.maxLength === 'long') emailLengthHint = '80-100 mots max';
      // subjectStyle : directive pour le style d'objet
      if (siPrefs.subjectStyle) subjectStyleHint = '\nSTYLE OBJET RECOMMANDE : ' + siPrefs.subjectStyle;
      if (siPrefs.preferredSubjectLength) subjectStyleHint += ' (' + siPrefs.preferredSubjectLength + ' mots max)';
    }

    const senderName = process.env.SENDER_NAME || 'Alexis';
    const senderTitle = process.env.SENDER_TITLE || 'fondateur';
    const clientName = process.env.CLIENT_NAME || 'iFIND';
    const systemPrompt = `Tu es ${senderName}, ${senderTitle} de ${clientName}. Tu ecris a un pair — pas a un "prospect", pas a une "cible". Comme quelqu'un du meme monde qui a remarque un truc et qui lance la conversation en 30 secondes.

BUT UNIQUE : une REPONSE. Pas une ouverture, pas un clic — une reponse.

=== CE QUI FAIT UN 10/10 ===

Un cold email parfait = un message entre pairs. 50-80 mots. UN fait malin. UNE question irresistible. ZERO analyse. ZERO lecon. Le prospect pense "tiens, bonne question" — pas "encore un mec qui me pitch".

=== HIERARCHIE DES DONNEES (UTILISE LA MEILLEURE DISPO) ===

PRIORITE 1 — PROFIL PUBLIC / INTERVIEW / PODCAST :
Si le contexte contient "PROFIL PUBLIC" → ton accroche DOIT rebondir dessus.
C'est la meilleure personnalisation possible. Exemple :
"Ton passage dans [nom du podcast] sur [sujet] — tu dis que [citation/idee]. Ca m'a fait penser a un truc..."

PRIORITE 2 — NEWS RECENTE DE L'ENTREPRISE :
Si le contexte contient "NEWS RECENTES" → utilise l'actualite la plus specifique.
Exemple : "Audirvana Studio teste par ON-mag ce mois-ci — le positionnement lecteur reseau haut de gamme, c'est un pivot ou c'etait prevu depuis le debut ?"

PRIORITE 3 — CLIENTS / PROJETS / MARQUES DETECTES :
Si le contexte contient des noms de clients ou projets → cite-les.
Exemple : "Zembula, Calabrio, ServiceTrade — tous des SaaS avec des cycles de vente longs."

PRIORITE 4 — STACK TECHNIQUE / CHIFFRES / DETAILS CONCRETS :
Technologies, nombre d'employes, annee de fondation, ville, levee de fonds.
Exemple : "150 personnes a Nantes, 4 postes commerciaux ouverts sur Welcome — ca sent le passage a l'echelle."

PRIORITE 5 — SKIP :
Si AUCUNE donnee exploitable → {"skip": true, "reason": "donnees insuffisantes"}

=== FORMAT STRICT : 2 BLOCS, ${emailLengthHint} ===

BLOC 1 — OBSERVATION (2-3 lignes max)
Un FAIT tire des donnees + son implication EN UNE PHRASE.
Tu CONSTATES, point. Le prospect SAIT — c'est son business.
Pas 2 paragraphes. Pas une analyse. Pas une lecon.

BLOC 2 — QUESTION (1-2 lignes)
UNE question qui donne envie de repondre. VARIE les formats :
- Frontale : "C'est quoi le plan cote US ?"
- Provocatrice : "C'etait strategique ou c'est arrive comme ca ?"
- Binaire courte : "Inbound ou outbound ?"
- Contextuelle : "Ca donne quoi depuis ?"
- Choix implicite : "Le timing c'est vous ou le marche ?"

REGLE D'OR : si ton email depasse 80 mots, COUPE. Encore. Chaque mot qui n'apporte rien = un mot qui dilue l'impact.

=== MICRO-VARIATIONS ANTI-REPETITION ===
Chaque email DOIT avoir une structure unique. Varie subtilement :
- Salutation : parfois prenom + virgule, parfois juste prenom, parfois zero salutation (attaque directe)
- Connecteur entre observation et question : saut de ligne seul, "Du coup —", "Bref,", rien (enchaine direct)
- Ponctuation question : ? seul, ?! (rare), reformulation en affirmation interrogative
- Structure : parfois observation PUIS question, parfois question EN PREMIER puis observation
Ne JAMAIS utiliser la meme ouverture deux emails de suite.

=== EXEMPLES 10/10 (COPIE CE NIVEAU) ===

Avec NEWS (34 mots) :
"Damien, 22M leves et depart aux US — les boites de vision francaises qui ont fait le move avant se sont toutes cassees les dents au meme endroit : zero notoriete la-bas.

Tu construis la presence comment ?"

Avec CLIENTS (25 mots) :
"Clement, Kiliba genere les campagnes pour 1000+ PME. L'ironie c'est que pour trouver ces PME, c'est probablement encore du manuel.

C'est le cas ?"

Avec PROFIL PUBLIC (30 mots) :
"Damien, dans ton interview Son-Video tu parles du choix local vs cloud pour Audirvana. Les fabricants de DAC qui vous integrent — canal de distrib a part entiere ou co-branding ?"

Avec TECHNO (22 mots) :
"Sophie, Shopify Plus avec Klaviyo et Gorgias — stack e-commerce mature. L'acquisition c'est aussi carre ou c'est du bricolage ?"

=== ERREURS FATALES — EXEMPLES REELS CORRIGES ===

AVANT (6/10 — trop long, donneur de lecon) :
"La reprise des actifs de HCS Pharma — c'est un move qui fait sens sur le papier : vous absorbez une bibliotheque de modeles cellulaires 3D [...] Ce type d'acquisition accelere la credibilite scientifique, mais elle cree aussi une pression immediate sur le developpement commercial — les labos pharma et les agences reglementaires ne viennent pas tout seuls frapper a la porte." (108 mots)
→ POURQUOI C'EST NUL : paragraphe d'analyse LinkedIn + lecon sur son propre business

APRES (10/10) :
"Thibault, rachat HCS Pharma + nouvelle usine + partenariat Anses — trois chantiers en parallele. C'est un timing choisi ou le marche a impose le rythme ?" (25 mots)

AVANT (6/10 — lecon au prospect) :
"Ton site s'adresse aux promoteurs et aux commercialisateurs — deux profils avec des temporalites tres differentes. Le promoteur a besoin de visibilite tot. Le commercialisateur a besoin de contacts chauds."
→ POURQUOI C'EST NUL : tu expliques au mec son propre metier

APRES (10/10) :
"Emmanuel, promoteurs et commercialisateurs sur la meme plateforme — deux timings completement differents. C'est toi qui absorbes le decalage ou chaque partenaire gere ?" (22 mots)

GENERIQUES A NE JAMAIS REPRODUIRE :
- "Diriger une agence marketing, le plus dur c'est..." → CLICHE SECTORIEL
- "Tu geres la visibilite de tes clients mais toi, tu acquiers des clients comment ?" → META-PROSPECTION
- "En agence, le pipe passe apres les projets en cours" → BANALITE
- "Le cordonnier mal chausse" → METAPHORE USEE

=== MOTS ET PATTERNS INTERDITS ===

INTERDITS dans l'accroche :
- Toute phrase qui parle de "prospection", "acquisition de clients", "gen de leads", "pipe commercial" → C'EST CE QU'ON VEND. Demander "comment tu prospectes ?" dans un email de prospection = absurde.
- "comment tu acquiers/generes/trouves de nouveaux clients/leads ?" → INTERDIT (meta-ironie)
- Generalites de secteur ("en agence...", "en SaaS...", "en ESN...") → pas un fait sur EUX

INTERDITS partout :
- "beau move", "impressionnant", "beau travail", "sacre parcours" (compliments vagues)
- "potentiellement", "peut-etre", "sans doute", "eventuellement" (ton mou)
- "je me permets", "je me disais", "je suis tombe sur", "j'ai vu que" + generique
- "et si vous...", "saviez-vous que...", "est-ce qu'un outil/solution..."
- "cordonnier", "nerf de la guerre", "le plus dur c'est"
- "curieux" : max 1 email sur 5
- tout pitch, prix, offre, feature, CTA de meeting
- "en tant que [titre] de [entreprise]" → template SDR detecte, supprime
- tout paragraphe de plus de 3 lignes → COUPE immediatement

=== DIVERSITE ===
Si le contexte contient "ANGLES DEJA UTILISES" → angle COMPLETEMENT DIFFERENT.
Axes possibles : produit, clients, expansion geo, recrutement, techno, partenariats, concurrence, news, personne.

=== CONTEXTE SECTORIEL ===
Si fourni : mentionne que d'autres acteurs du secteur s'y interessent — JAMAIS les nommer.
Subtil, pas en argument principal : "on echange avec pas mal d'acteurs de [secteur] en ce moment".

=== OBJET ===
- 2-4 mots, minuscules, comme un texto entre collegues
- Contient le prenom OU l'entreprise
- Base sur le fait cite — pas sur notre offre
- BON : "damien et l'US", "rachat hcs pharma", "benzema 2023", "kiliba et les PME"
- MAUVAIS : "question rapide", "decouverte activite", "paillette et la gen de leads"
- JAMAIS : "prospection", "leads", "acquisition" dans le sujet${subjectStyleHint}

=== TON ===
- Ecris comme tu PARLES, pas comme tu REDIGES
- Tutoiement par defaut. Vouvoiement uniquement si +500 employes ou grand groupe cote
- Prenom + virgule pour ouvrir. JAMAIS "Bonjour X"
- ${emailLengthHint}. Chaque mot merite sa place.
- PAS de signature (ajoutee auto)
- PAS de bullet points, pas de gras, pas de HTML

=== FORMAT ===
JSON valide uniquement, sans markdown, sans backticks.
{"subject":"objet","body":"corps SANS signature"}
OU {"skip": true, "reason": "explication"}`;

    const firstName = contact.firstName || (contact.name || '').split(' ')[0] || '';
    const userMessage = `Ecris un email pour ce prospect. Utilise la MEILLEURE donnee disponible selon la hierarchie (profil public > news > clients > techno > chiffres). Skip si ZERO fait exploitable.

CONTACT :
- Prenom : ${firstName}
- Nom complet : ${contact.name || ''}
- Poste : ${contact.title || 'non precise'}
- Entreprise : ${contact.company || 'non precisee'}
- Email : ${contact.email}
${context ? '\nDONNEES PROSPECT :\n' + context : ''}`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      1500
    );
    return this._parseJSON(response);
  }

  async generateSequenceEmails(contact, campaignContext, totalEmails, options) {
    options = options || {};
    // Injecter les mots interdits depuis la config AP
    let forbiddenWordsRule = '';
    try {
      const apStorage = require('../autonomous-pilot/storage.js');
      const apConfig = apStorage.getConfig ? apStorage.getConfig() : {};
      const ep = apConfig.emailPreferences || {};
      if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
        forbiddenWordsRule = '\nMOTS ABSOLUMENT INTERDITS: ' + ep.forbiddenWords.join(', ');
      }
    } catch (e) {
      try {
        const apStorage = require('/app/skills/autonomous-pilot/storage.js');
        const apConfig = apStorage.getConfig ? apStorage.getConfig() : {};
        const ep = apConfig.emailPreferences || {};
        if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
          forbiddenWordsRule = '\nMOTS ABSOLUMENT INTERDITS: ' + ep.forbiddenWords.join(', ');
        }
      } catch (e2) {}
    }

    // Angles deja utilises (eviter repetitions)
    let anglesRule = '';
    if (options.usedAngles && options.usedAngles.length > 0) {
      anglesRule = '\n\nANGLES DEJA UTILISES (NE PAS REPETER) :\n' + options.usedAngles.map(a => '- "' + a + '"').join('\n');
    }

    // Construire le lien Cal.eu pour le breakup (si configure)
    let breakupBookingUrl = '';
    const calcomUser = process.env.CALCOM_USERNAME;
    const calcomSlug = process.env.CALCOM_EVENT_SLUG || 'appel-telephonique';
    const contactFirstName = contact.firstName || (contact.name || '').split(' ')[0] || '';
    if (calcomUser && contact.email) {
      const bp = new URLSearchParams();
      bp.set('email', contact.email);
      if (contactFirstName) bp.set('name', contactFirstName);
      breakupBookingUrl = 'https://cal.eu/' + calcomUser + '/' + calcomSlug + '?' + bp.toString();
    }

    const breakupInstruction = breakupBookingUrl
      ? `- Relance ${totalEmails} (J+21) : BREAKUP + LIEN AGENDA — 3 lignes max

Le breakup exploite la loss aversion. Il DOIT se terminer par ce lien EXACT sur sa propre ligne :
${breakupBookingUrl}

Exemple breakup :
"${contactFirstName}, pas le bon moment ? Pas de souci.

Si le sujet revient un jour, 15 min ici :
${breakupBookingUrl}"

Le lien doit etre COPIE TEL QUEL dans le body JSON — ne JAMAIS le modifier ni l'inventer.`
      : `- Relance ${totalEmails} (J+21) : BREAKUP — 2 lignes max, choix binaire ("pas le bon moment ? dis-le moi, je ne relancerai plus")

Le breakup exploite la loss aversion. Format strict : 2 phrases max, question fermee.`;

    const meetingCTARule = breakupBookingUrl
      ? '- JAMAIS : prix, offre, feature, pitch, CTA de meeting (EXCEPTION : le breakup inclut le lien agenda fourni)'
      : '- JAMAIS : prix, offre, feature, pitch, CTA de meeting';

    const senderName = process.env.SENDER_NAME || 'Alexis';
    const senderTitle = process.env.SENDER_TITLE || 'fondateur';
    const systemPrompt = `Tu es ${senderName}, ${senderTitle}. Tu generes ${totalEmails} relances pour un prospect qui n'a pas repondu a ton premier email.

PHILOSOPHIE : Chaque relance apporte un NOUVEL ANGLE. Jamais "je reviens vers vous".

STRUCTURE :
- Relance 1 (J+3) : nouvel angle tire des DONNEES PROSPECT (fait DIFFERENT du premier email)
- Relance 2 (J+7) : preuve sociale — mini cas client anonymise ("un dirigeant dans ton secteur...")
- Relance 3 (J+14) : dernier angle de valeur, question directe
${breakupInstruction}

FORMAT DE CHAQUE RELANCE (sauf breakup) — 50-80 mots max :
1. OBSERVATION = fait specifique ou nouvel insight + implication en UNE phrase (PAS "je reviens vers toi")
2. QUESTION = variee (frontale, provocatrice, binaire, contextuelle). PAS toujours "X ou Y ?"

INTERDIT : le paragraphe d'analyse qui explique au prospect son propre business. Il SAIT. Coupe.

REGLES :
- 50-80 mots par relance. Le breakup = 2 lignes MAX. ZERO paragraphe analytique.
- Tutoiement startup/PME, vouvoiement corporate
- JAMAIS : "je me permets", "suite a", "beau move", "potentiellement", "curieux" (max 1x sur 4)
${meetingCTARule}
- JAMAIS : "prospection", "gen de leads", "acquisition de clients" dans l'email
- Sujet : 3-5 mots, minuscules, intriguant, contient nom/entreprise
- PAS de signature (ajoutee automatiquement)${forbiddenWordsRule}${anglesRule}

JSON valide uniquement : [{"subject":"...","body":"..."},...]`;

    const userMessage = `Genere une sequence de ${totalEmails} emails pour :

Nom : ${contact.name || ''}
Prenom : ${contact.firstName || (contact.name || '').split(' ')[0]}
Poste : ${contact.title || 'non precise'}
Entreprise : ${contact.company || 'non precisee'}
Email : ${contact.email}
${options.prospectIntel ? '\nDONNEES PROSPECT :\n' + options.prospectIntel : ''}
Objectif de la campagne : ${campaignContext || 'prospection B2B generique'}`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      3000
    );

    try {
      const cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      let emails = JSON.parse(cleaned);
      if (!Array.isArray(emails)) throw new Error('Format invalide');

      // Post-processing : garantir que le breakup (dernier email) contient le lien Cal.eu
      if (breakupBookingUrl && emails.length > 0) {
        const last = emails[emails.length - 1];
        if (last.body && !last.body.includes('cal.eu/')) {
          last.body = last.body.trimEnd() + '\n\n' + breakupBookingUrl;
        }
      }

      return emails;
    } catch (e) {
      // Fallback : essayer de parser comme objet unique
      return [this._parseJSON(response)];
    }
  }

  async generateReactiveFollowUp(contact, originalEmail, prospectIntel) {
    let emailLengthHint = '60-80 mots max';
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

    // Injecter les mots interdits depuis la config AP
    let forbiddenWordsRule = '';
    try {
      const apStorage = require('../autonomous-pilot/storage.js');
      const apConfig = apStorage.getConfig ? apStorage.getConfig() : {};
      const ep = apConfig.emailPreferences || {};
      if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
        forbiddenWordsRule = '\nMOTS ABSOLUMENT INTERDITS: ' + ep.forbiddenWords.join(', ');
      }
    } catch (e) {
      try {
        const apStorage = require('/app/skills/autonomous-pilot/storage.js');
        const apConfig = apStorage.getConfig ? apStorage.getConfig() : {};
        const ep = apConfig.emailPreferences || {};
        if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
          forbiddenWordsRule = '\nMOTS ABSOLUMENT INTERDITS: ' + ep.forbiddenWords.join(', ');
        }
      } catch (e2) {}
    }

    const senderName = process.env.SENDER_NAME || 'Alexis';
    const senderTitle = process.env.SENDER_TITLE || 'fondateur';
    const systemPrompt = `Tu es ${senderName}, ${senderTitle}. Tu relances un prospect qui a recu ton premier email.

REGLES ANTI-TRACKING :
- JAMAIS mentionner que tu sais qu'il a ouvert l'email (intrusif et illegal)
- JAMAIS "suite a mon email", "je reviens vers vous", "je me permets de relancer"

STRATEGIE :
NOUVEL ANGLE tire des DONNEES PROSPECT. Pas une reformulation du premier email.
Angles : news, clients, question metier, mini cas anonymise.

FORMAT (${emailLengthHint}) :
1. OBSERVATION = fait DIFFERENT du premier email + implication en UNE phrase
2. QUESTION = variee (frontale, provocatrice, binaire, contextuelle)

INTERDIT : paragraphe d'analyse LinkedIn, lecons sur le business du prospect, plus de 80 mots.

REGLES :
- ${emailLengthHint}. Ecris comme tu parles. Tutoiement par defaut, vouvoiement si +500 employes.
- JAMAIS : pitch, prix, offre, "beau move", "potentiellement", "curieux" (max 1/5)
- JAMAIS : "prospection", "gen de leads", "acquisition de clients"
- Sujet : 3-5 mots, minuscules, intriguant, contient nom/entreprise, DIFFERENT du premier
- PAS de "re:", pas de "relance", pas de signature (ajoutee automatiquement)${forbiddenWordsRule}

JSON uniquement : {"subject":"...","body":"..."}`;

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
      1500
    );
    return this._parseJSON(response);
  }

  /**
   * Genere une relance de campagne individuellement personnalisee pour un prospect.
   * Contrairement a generateSequenceEmails() qui genere des templates,
   * cette methode genere un email unique base sur le brief complet du prospect.
   */
  async generatePersonalizedFollowUp(contact, stepNumber, totalSteps, prospectIntel, previousEmails, campaignContext) {
    let emailLengthHint = '5-8 lignes max';
    let siPrefsfu = null;
    try {
      const selfImproveStorage = require('../self-improve/storage.js');
      siPrefsfu = selfImproveStorage.getEmailPreferences();
    } catch (e) {
      try {
        const selfImproveStorage = require('/app/skills/self-improve/storage.js');
        siPrefsfu = selfImproveStorage.getEmailPreferences();
      } catch (e2) {}
    }
    if (siPrefsfu) {
      if (siPrefsfu.maxLength === 'short') emailLengthHint = '3-4 lignes max';
      else if (siPrefsfu.maxLength === 'long') emailLengthHint = '8-12 lignes';
    }

    // Injecter les mots interdits depuis la config AP
    let forbiddenWordsRule = '';
    try {
      const apStorage = require('../autonomous-pilot/storage.js');
      const apConfig = apStorage.getConfig ? apStorage.getConfig() : {};
      const ep = apConfig.emailPreferences || {};
      if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
        forbiddenWordsRule = '\nMOTS ABSOLUMENT INTERDITS: ' + ep.forbiddenWords.join(', ');
      }
    } catch (e) {
      try {
        const apStorage = require('/app/skills/autonomous-pilot/storage.js');
        const apConfig = apStorage.getConfig ? apStorage.getConfig() : {};
        const ep = apConfig.emailPreferences || {};
        if (ep.forbiddenWords && ep.forbiddenWords.length > 0) {
          forbiddenWordsRule = '\nMOTS ABSOLUMENT INTERDITS: ' + ep.forbiddenWords.join(', ');
        }
      } catch (e2) {}
    }

    // Construire l'historique des emails precedents (anti-repetition)
    let previousEmailsContext = '';
    if (previousEmails && previousEmails.length > 0) {
      previousEmailsContext = '\n\n=== EMAILS PRECEDENTS ENVOYES A CE PROSPECT (NE PAS REPETER CES ANGLES) ===';
      for (const prev of previousEmails) {
        previousEmailsContext += '\n--- Email ' + prev.stepNumber + ' ---';
        previousEmailsContext += '\nObjet: ' + (prev.subject || '');
        previousEmailsContext += '\nCorps: ' + (prev.body || '').substring(0, 400);
      }
      previousEmailsContext += '\n=== FIN EMAILS PRECEDENTS ===';
      previousEmailsContext += '\nTu DOIS utiliser un angle COMPLETEMENT DIFFERENT de tous les emails ci-dessus.';
    }

    // Strategie specifique par step
    const isBreakup = stepNumber >= totalSteps;
    let stepStrategy = '';
    if (stepNumber === 2) {
      stepStrategy = 'Relance 1 (J+3): Nouvel angle DIFFERENT du premier email, tire des DONNEES PROSPECT. Question ouverte.';
    } else if (stepNumber === 3) {
      stepStrategy = 'Relance 2 (J+7): Preuve sociale — mini cas client anonymise ("un dirigeant dans ton secteur..."). Fait rebondir sur un aspect specifique du prospect.';
    } else if (stepNumber === totalSteps - 1 && totalSteps > 4) {
      stepStrategy = 'Relance 3 (J+14): Dernier angle de valeur, question directe basee sur un fait specifique des donnees prospect.';
    } else if (isBreakup) {
      stepStrategy = 'BREAKUP (derniere relance): 2 lignes MAXIMUM. Choix binaire simple ("pas le bon moment ? dis-le moi"). Exploite la loss aversion.';
    } else {
      stepStrategy = 'Relance ' + (stepNumber - 1) + ': Nouvel angle tire des DONNEES PROSPECT, question specifique.';
    }

    const senderName = process.env.SENDER_NAME || 'Alexis';
    const senderTitle = process.env.SENDER_TITLE || 'fondateur';
    const clientName = process.env.CLIENT_NAME || 'iFIND';
    const systemPrompt = `Tu es ${senderName}, ${senderTitle} de ${clientName}. Tu ecris une relance personnalisee a un prospect specifique.

CONTEXTE : Relance ${stepNumber - 1} sur ${totalSteps - 1} (step ${stepNumber}/${totalSteps}).
STRATEGIE : ${stepStrategy}

FORMAT (${emailLengthHint}) :
1. OBSERVATION = fait specifique ou nouvel insight + implication en UNE phrase (PAS "je reviens vers toi", PAS de paragraphe d'analyse)
2. QUESTION = variee (frontale, provocatrice, binaire, contextuelle)
${isBreakup ? '\nBREAKUP = 2 phrases max. Question fermee. Exploite la loss aversion.' : ''}

INTERDIT : le paragraphe d'analyse LinkedIn qui explique au prospect ce qu'il vit. Il SAIT. Coupe.

REGLES :
- ${emailLengthHint}. ${isBreakup ? '2 LIGNES MAXIMUM.' : ''} Ecris comme tu PARLES.
- Tutoiement par defaut. Vouvoiement si +500 employes ou grand groupe cote.
- JAMAIS : "suite a mon email", "je reviens vers vous", "je me permets de relancer"
- JAMAIS : pitch, prix, offre, "beau move", "potentiellement", "curieux" (max 1/5)
- JAMAIS : "prospection", "gen de leads", "acquisition de clients"
- Sujet : 2-4 mots, minuscules, comme un texto, contient nom/entreprise, DIFFERENT des precedents
- PAS de "re:", pas de "relance", pas de signature${forbiddenWordsRule}

JSON uniquement : {"subject":"...","body":"..."}`;

    const firstName = contact.firstName || (contact.name || '').split(' ')[0] || '';
    const userMessage = `DONNEES PROSPECT (pour personnalisation PROFONDE) :
${prospectIntel || 'Aucune donnee supplementaire'}
${previousEmailsContext}

CONTACT :
- Prenom : ${firstName}
- Nom complet : ${contact.name || ''}
- Poste : ${contact.title || 'non precise'}
- Entreprise : ${contact.company || 'non precisee'}
- Email : ${contact.email}

Objectif campagne : ${campaignContext || 'prospection B2B'}

Ecris la relance ${stepNumber - 1}/${totalSteps - 1} avec un NOUVEL ANGLE base sur les DONNEES PROSPECT ci-dessus.${isBreakup ? ' FORMAT BREAKUP : 2 lignes max, choix binaire.' : ''}`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      isBreakup ? 500 : 1000
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

  async generateBodyVariant(originalBody, originalSubject, prospectContext) {
    const systemPrompt = `Tu es un expert en cold email B2B et A/B testing. On te donne un cold email. Reecris-le avec un ANGLE COMPLETEMENT DIFFERENT tout en ciblant le meme prospect.

REGLES STRICTES :
- Meme structure : 2 blocs (observation + question). Pas plus.
- Meme longueur approximative (50-80 mots)
- NOUVEL ANGLE : si l'original parle de news, utilise le stack technique. Si l'original cite un client, parle du positionnement. Etc.
- Garde le tutoiement/vouvoiement de l'original
- Pas de signature (ajoutee automatiquement)
- Pas de formule de politesse
- Retourne un JSON : {"subject":"nouvel objet","body":"nouveau corps"}
- L'objet doit aussi etre different de l'original`;

    const userMessage = `Email original :
Objet: ${originalSubject}
Corps: ${originalBody}
${prospectContext ? '\nDonnees prospect disponibles:\n' + (prospectContext || '').substring(0, 2000) : ''}

Genere une variante A/B avec un angle different. JSON uniquement.`;

    try {
      const response = await this.callOpenAIMini(systemPrompt, userMessage, 800);
      const parsed = this._parseJSON(response);
      if (parsed && parsed.body && parsed.subject && !parsed.skip) {
        return { subject: parsed.subject, body: parsed.body };
      }
    } catch (e) { /* fallback : retourne null */ }
    return null;
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
