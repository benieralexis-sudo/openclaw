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

    const systemPrompt = `Tu es Alexis, fondateur d'iFIND. Tu ecris a un autre dirigeant. Pas un template, pas un SDR — un humain qui a passe 10 minutes a etudier le prospect.

BUT : obtenir UNE reponse. Pas vendre, pas pitcher.

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

=== STRUCTURE EN 3 TEMPS (${emailLengthHint}) ===

1. ACCROCHE (1-2 lignes) — Un FAIT tire des donnees, pas une generalite
2. PONT (1-2 lignes) — L'IMPLICATION BUSINESS de ce fait. TON AFFIRMATIF, pas "peut-etre"
3. QUESTION (1 ligne) — BINAIRE ("A ou B ?") ou ULTRA-SPECIFIQUE. Liee au pont.

=== EXEMPLES 10/10 ===

Avec PROFIL PUBLIC :
"Damien, ton interview sur Son-Video a propos d'Audirvana — tu parles du choix de rester sur du traitement audio local vs cloud. Les fabricants de DAC type Métronome qui integrent Audirvana, c'est un canal de distribution a part entiere ou ca reste du co-branding ?"

Avec NEWS :
"Clement, l'article RelationClientMag sur Kiliba et l'engagement omnicanal — vous adressez 1000+ PME avec une IA qui genere les campagnes. La prospection vers ces PME, c'est inbound pur ou vous avez un outbound structure en parallele ?"

Avec CLIENTS :
"Vous bossez avec Zembula, Calabrio, ServiceTrade — tous des SaaS B2B avec des acheteurs techniques. Le site doit convaincre avant le commercial. La partie SEO + CRO, c'est un package des le depart ou tu commences par l'un des deux ?"

Avec TECHNO :
"Votre site tourne sur Next.js avec Vercel et Stripe — stack moderne. Cote acquisition, c'est aussi structure ou c'est encore du ad hoc ?"

=== EXEMPLES MAUVAIS (a NE JAMAIS reproduire) ===

"Diriger une agence marketing, le plus dur c'est que la prospection s'arrete des qu'un projet demarre" → CLICHE SECTORIEL, valable pour 500 agences
"Tu geres la visibilite de tes clients mais toi, tu acquiers des clients comment ?" → META-PROSPECTION, interdit
"En agence, le pipe passe apres les projets en cours" → BANALITE
"Le cordonnier mal chausse" → METAPHORE USEE

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
- "curieux" : max 1 email sur 3
- tout pitch, prix, offre, feature, CTA de meeting

=== DIVERSITE ===
Si le contexte contient "ANGLES DEJA UTILISES" → angle COMPLETEMENT DIFFERENT.
Axes possibles : produit, clients, expansion geo, recrutement, techno, partenariats, concurrence, news, personne.

=== CONTEXTE SECTORIEL ===
Si fourni : mentionne que d'autres acteurs du secteur s'y interessent — JAMAIS les nommer.
Subtil, pas en argument principal : "on echange avec pas mal d'acteurs de [secteur] en ce moment".

=== OBJET DU MAIL ===
- 3-5 mots, minuscules, naturel, INTRIGUANT
- DOIT contenir le nom du prospect OU de l'entreprise
- Base sur le fait cite dans l'accroche — pas sur notre offre
- BON : "damien et le choix local", "l'article relationclientmag", "zembula calabrio servicetrade"
- MAUVAIS : "paillette et la gen de leads", "agence bcom et la prospection"
- JAMAIS le mot "prospection", "leads", "acquisition" dans le sujet

=== TON ===
- Tutoiement (startup/PME), vouvoiement (corporate/grand groupe uniquement)
- Commence par le PRENOM du prospect si dispo (pas "Bonjour X" — juste le prenom suivi d'une virgule, ou directement l'accroche)
- ${emailLengthHint}. Chaque mot merite sa place.
- PAS de signature (ajoutee automatiquement)
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

STRUCTURE EN 3 TEMPS (pour chaque relance) :
1. ACCROCHE = un FAIT SPECIFIQUE ou un NOUVEL ANGLE (pas un compliment vague)
2. PONT = l'IMPLICATION BUSINESS (montre que tu comprends le contexte)
3. QUESTION = BINAIRE ou SPECIFIQUE (pas generique)

REGLES :
- JAMAIS affirmer ce qu'on ne sait pas — POSER LA QUESTION
- ZERO compliments vagues ("beau move", "beau parcours", "impressionnant") — remplace par l'IMPLICATION BUSINESS
- TON AFFIRMATIF dans le pont : JAMAIS "potentiellement", "peut-etre", "sans doute", "eventuellement" — AFFIRME l'implication
- QUESTIONS BINAIRES > questions ouvertes. "Tu fais A ou B ?" > "Comment tu geres X ?"
- "Curieux" : 1 fois sur 3 MAX
- Phrases COURTES. Une idee = une phrase.
- JAMAIS "sacre", "en termes de", "un certain nombre de", "je me permets", "je me disais"
- TUTOIEMENT par defaut (startup/PME). Vouvoiement UNIQUEMENT si prospect corporate/grand groupe
- Les objets contiennent le NOM DU PROSPECT ou de son ENTREPRISE, et INTRIGUENT (pas tout reveler)

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
- Contient le NOM DU PROSPECT ou de son ENTREPRISE, INTRIGUE (ex: "EKELA apres la fusion", "question pour Nadine")
- DIFFERENT de l'objet du premier email
- Pas de "re:" ni de "relance"

STYLE D'ECRITURE (CRUCIAL) :

STRUCTURE EN 3 TEMPS :
1. ACCROCHE = un FAIT SPECIFIQUE ou NOUVEL ANGLE (pas un compliment vague)
2. PONT = l'IMPLICATION BUSINESS AFFIRMATIVE (montre que tu comprends pourquoi c'est interessant)
3. QUESTION = BINAIRE ou SPECIFIQUE (pas generique)

EXEMPLES :
  MAUVAIS : "Le rapprochement avec X — beau move. La prospection c'est gere comment ?"
  BON : "Deux marques apres la fusion — deux audiences client a adresser. Tu doubles les canaux ou tu unifies ?"

REGLES :
- JAMAIS affirmer ce qu'on ne sait pas — POSER LA QUESTION
- ZERO compliments vagues ("beau move", "impressionnant") — remplace par l'IMPLICATION BUSINESS
- TON AFFIRMATIF dans le pont : JAMAIS "potentiellement", "peut-etre", "sans doute", "eventuellement" — AFFIRME l'implication
- QUESTIONS BINAIRES > questions ouvertes. "Tu fais A ou B ?" > "Comment tu geres X ?"
- "Curieux" : 1 fois sur 3 MAX
- Phrases COURTES. Une idee = une phrase.
- JAMAIS "sacre", "en termes de", "un certain nombre de", "je me permets", "je me disais"
- TUTOIEMENT par defaut (startup/PME). Vouvoiement UNIQUEMENT si prospect corporate/grand groupe

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
