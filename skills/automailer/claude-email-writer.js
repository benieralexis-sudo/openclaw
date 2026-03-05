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
    if (!response || typeof response !== 'string') throw new Error('Reponse Claude vide ou invalide');

    try {
      const cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.skip) return { skip: true, reason: parsed.reason || 'donnees insuffisantes' };
      return parsed;
    } catch (e) {
      // Fallback 1 : extraire le JSON imbrique dans du texte
      const jsonMatch = response.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.subject && parsed.body) return parsed;
        } catch (e2) { /* continue aux regex */ }
      }

      // Fallback 2 : detecter skip dans la reponse brute
      if (response.includes('"skip"') && response.includes('true')) {
        const reasonMatch = response.match(/"reason"\s*:\s*"([^"]+)"/);
        return { skip: true, reason: reasonMatch ? reasonMatch[1] : 'donnees insuffisantes' };
      }

      // Fallback 3 : regex robuste pour subject/body (gere les cas ou body contient des guillemets echappes)
      const subjectMatch = response.match(/"subject"\s*:\s*"([^"]+)"/);
      const bodyMatch = response.match(/"body"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (subjectMatch && bodyMatch) {
        return { subject: subjectMatch[1], body: bodyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') };
      }

      // Fallback 4 : regex ultra-permissive (body multi-ligne)
      const bodyLoose = response.match(/"body"\s*:\s*"([\s\S]+?)"\s*[,}]/);
      if (subjectMatch && bodyLoose) {
        return { subject: subjectMatch[1], body: bodyLoose[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') };
      }

      throw new Error('Impossible de parser la reponse Claude (len=' + response.length + ', debut: ' + response.substring(0, 100) + ')');
    }
  }

  async generateSingleEmail(contact, context) {
    // Lire les preferences depuis Self-Improve (si disponible)
    let emailLengthHint = '50-80 mots (vise 65, JAMAIS plus de 80)';
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
      if (siPrefs.maxLength === 'short') emailLengthHint = '50-65 mots (court mais substantiel)';
      else if (siPrefs.maxLength === 'long') emailLengthHint = '65-100 mots';
      // subjectStyle : directive pour le style d'objet
      if (siPrefs.subjectStyle) subjectStyleHint = '\nSTYLE OBJET RECOMMANDE : ' + siPrefs.subjectStyle;
      if (siPrefs.preferredSubjectLength) subjectStyleHint += ' (' + siPrefs.preferredSubjectLength + ' mots max)';
    }

    const senderName = process.env.SENDER_NAME || 'Alexis';
    const senderTitle = process.env.SENDER_TITLE || 'fondateur';
    const clientName = process.env.CLIENT_NAME || 'iFIND';
    const clientDescription = process.env.CLIENT_DESCRIPTION || '';
    const emailLanguage = process.env.EMAIL_LANGUAGE || 'fr';
    const emailTone = process.env.EMAIL_TONE || 'informal';

    // Bloc langue pour clients non-francophones
    let languageBlock = '';
    if (emailLanguage === 'ro') {
      languageBlock = `
=== LIMBA / LANGUAGE ===
SCRIE EMAILUL IN ROMANA. Nu in franceza, nu in engleza — in ROMANA.
Ton: ${emailTone === 'informal' ? 'tutuit, relaxat dar profesional' : 'formal, cu dumneavoastra'}.
Subiectul emailului: in romana, 2-4 cuvinte, ca un mesaj intre colegi.
Toate regulile de mai jos se aplica — dar emailul TREBUIE sa fie in romana naturala, nu tradusa.
${clientDescription ? 'CE FACE ' + clientName.toUpperCase() + ': ' + clientDescription : ''}

`;
    } else if (emailLanguage !== 'fr') {
      languageBlock = `
=== LANGUAGE ===
Write the email in ${emailLanguage}. All rules below apply but the email MUST be in native ${emailLanguage}.
${clientDescription ? 'WHAT ' + clientName.toUpperCase() + ' DOES: ' + clientDescription : ''}

`;
    }

    const systemPrompt = `${languageBlock}Tu es ${senderName}, ${senderTitle} de ${clientName}. Tu ecris a un pair — pas a un "prospect", pas a une "cible". Comme quelqu'un du meme monde qui a remarque un truc et qui lance la conversation en 30 secondes.

BUT UNIQUE : une REPONSE. Pas une ouverture, pas un clic — une reponse.

=== CE QUI FAIT UN 10/10 ===

Un cold email parfait = 3 ELEMENTS :
1. UN FAIT SPECIFIQUE (chiffre, nom, date, evenement — tire des donnees)
2. UNE QUESTION IRRESISTIBLE (le prospect pense "tiens, bonne question")
3. UN CTA SOFT (une ouverture naturelle, pas un pitch)

50-80 mots. Pas 30 (trop sec), pas 120 (trop long). CINQUANTE A QUATRE-VINGTS.
ZERO analyse. ZERO lecon. ZERO explication. Tu CONSTATES un fait, tu POSES une question, tu OUVRES la porte. POINT.
ANTI-HALLUCINATION : N'invente JAMAIS un fait. Si un chiffre, un client, un evenement n'apparait PAS dans les donnees prospect, tu ne le cites PAS. Tu ne devines pas. Tu ne brodes pas. Chaque fait doit etre tracable dans les DONNEES PROSPECT ci-dessous.
Si entre le fait et la question tu as envie d'ecrire un paragraphe qui commence par "Ce type de...", "Le vrai cap...", "Ce qui distingue..." → SUPPRIME-LE. Le prospect n'a pas besoin de ton analyse de son business.

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

PRIORITE 4.5 — DONNEES MINIMALES (entreprise + poste seulement) :
Si tu n'as PAS de news, profil public, clients ou techno — mais tu as le NOM DE L'ENTREPRISE + le POSTE :
→ Ecris un email court (25-35 mots) sur un DEFI CONCRET de ce type de poste dans ce type d'entreprise.
→ Utilise le nom de l'entreprise + la ville/taille si disponible.
Exemples :
"Marc, diriger la tech chez Acti-Immo a Toulouse — entre la conformite reglementaire et la digitalisation des mandats, tu priorises comment ?" (20 mots)
"Sophie, DG d'un cabinet de 15 personnes — scaler sans perdre le cote boutique, c'est le dilemme permanent non ?" (18 mots)
CE N'EST PAS un skip. C'est un email 7/10 et c'est SUFFISANT.

PRIORITE 5 — SKIP (DERNIER RECOURS ABSOLU) :
Skip si tu n'as AUCUN de ces elements : nom d'entreprise, poste, ville, industrie, description.
Si tu as AU MOINS entreprise + poste → tu DOIS ecrire (priorite 4.5 ci-dessus).
→ {"skip": true, "reason": "donnees insuffisantes"} UNIQUEMENT si l'email ne contient meme pas un nom d'entreprise.

=== FORMAT STRICT : 3 BLOCS, ${emailLengthHint} ===

BLOC 1 — FAIT (1-3 lignes)
UN fait tire des donnees. Chiffre, nom propre, date, evenement. Developpe JUSTE ASSEZ pour montrer que tu as fait tes devoirs.
INTERDIT : "Ce type de...", "Ce qui distingue...", "Le vrai cap c'est...", "Ca veut dire que..."
Tu ne COMMENTES pas le fait. Tu le POSES. Le prospect comprend tout seul.

BLOC 2 — QUESTION (1 ligne)
UNE question courte qui donne envie de repondre. Formats :
- Frontale : "C'est quoi le plan cote US ?"
- Provocatrice : "C'etait strategique ou c'est arrive comme ca ?"
- Binaire : "Timing choisi ou impose ?"
- Contextuelle : "Ca donne quoi depuis ?"

BLOC 3 — CTA SOFT (1 ligne, APRES la question)
UNE ouverture naturelle et decontractee. PAS de lien, PAS de "je te propose un call", PAS de pitch.
Formats :
- "Si le sujet te parle, je suis dispo pour en discuter."
- "Dispo pour en parler si ca t'interesse."
- "Curieux d'avoir ton retour la-dessus."
- "Ca vaut un echange rapide ?"
JAMAIS : "je te propose un RDV", "15 min pour en discuter ?", "voici mon calendrier"

REGLE ABSOLUE : 50-80 mots. Vise 65 mots. Si tu depasses 80, COUPE le paragraphe d'analyse. Si tu es sous 50, developpe le fait avec un detail supplementaire.

TEST MENTAL : si tu retires les phrases du milieu et que l'email est MEILLEUR → elles n'auraient jamais du etre la.

=== MICRO-VARIATIONS ANTI-REPETITION ===
Chaque email DOIT avoir une structure unique. Varie subtilement :
- Salutation : parfois prenom + virgule, parfois juste prenom, parfois zero salutation (attaque directe)
- Connecteur entre observation et question : saut de ligne seul, "Du coup —", "Bref,", rien (enchaine direct)
- Ponctuation question : ? seul, ?! (rare), reformulation en affirmation interrogative
- Structure : parfois observation PUIS question, parfois question EN PREMIER puis observation
Ne JAMAIS utiliser la meme ouverture deux emails de suite.

=== EXEMPLES 10/10 (COPIE CE NIVEAU — 50-80 mots) ===

Avec NEWS + CTA (65 mots) :
"Damien, 22M leves et depart aux US — les boites de vision francaises qui ont fait le move avant se sont toutes cassees les dents au meme endroit : zero notoriete la-bas. Le playbook classique (salons + partnerships) met 18 mois a produire du pipeline.

Tu construis la presence comment ?

Si le sujet te parle, dispo pour en discuter."

Avec CLIENTS + CTA (55 mots) :
"Clement, Kiliba genere les campagnes pour 1000+ PME — belle traction sur le mid-market. L'ironie c'est que pour trouver ces PME, la plupart des SaaS a votre stade font encore du manuel ou du LinkedIn un par un.

C'est le cas chez vous ?

Curieux d'avoir ton retour."

Avec PROFIL PUBLIC + CTA (62 mots) :
"Damien, dans ton interview Son-Video tu parles du choix local vs cloud pour Audirvana. Le positionnement lecteur reseau haut de gamme, c'est un vrai pivot — les fabricants de DAC qui vous integrent, c'est un canal de distribution a part entiere ou du co-branding ?

Dispo pour en parler si ca t'interesse."

Avec TECHNO + CTA (58 mots) :
"Sophie, Shopify Plus avec Klaviyo et Gorgias — stack e-commerce mature, c'est rare pour une marque de cette taille. Le fait que vous ayez pousse aussi loin cote outils, ca veut dire que l'acquisition client est aussi structuree ?

Ou c'est encore le point de friction ?

Ca vaut un echange rapide ?"

=== ERREURS FATALES — EXEMPLES REELS CORRIGES ===

AVANT (6/10 — trop long, donneur de lecon) :
"La reprise des actifs de HCS Pharma — c'est un move qui fait sens sur le papier : vous absorbez une bibliotheque de modeles cellulaires 3D [...] Ce type d'acquisition accelere la credibilite scientifique, mais elle cree aussi une pression immediate sur le developpement commercial — les labos pharma et les agences reglementaires ne viennent pas tout seuls frapper a la porte." (108 mots)
→ POURQUOI C'EST NUL : paragraphe d'analyse LinkedIn + lecon sur son propre business

APRES (10/10) :
"Thibault, rachat HCS Pharma + nouvelle usine + partenariat Anses — trois chantiers en parallele. Le timing est serre et la pression pipeline ne va pas se regler toute seule.

C'est un timing choisi ou le marche a impose le rythme ?

Dispo si tu veux en parler." (55 mots)

AVANT (6/10 — lecon au prospect) :
"Ton site s'adresse aux promoteurs et aux commercialisateurs — deux profils avec des temporalites tres differentes. Le promoteur a besoin de visibilite tot. Le commercialisateur a besoin de contacts chauds."
→ POURQUOI C'EST NUL : tu expliques au mec son propre metier

APRES (10/10) :
"Emmanuel, promoteurs et commercialisateurs sur la meme plateforme — deux timings completement differents. Le promoteur veut de la visibilite tot, le commercialisateur veut des contacts chauds.

C'est toi qui absorbes le decalage ou chaque partenaire gere ?

Curieux d'avoir ton retour." (52 mots)

GENERIQUES A NE JAMAIS REPRODUIRE :
- "Diriger une agence marketing, le plus dur c'est..." → CLICHE SECTORIEL
- "Tu geres la visibilite de tes clients mais toi, tu acquiers des clients comment ?" → META-PROSPECTION
- "En agence, le pipe passe apres les projets en cours" → BANALITE
- "Le cordonnier mal chausse" → METAPHORE USEE
- "[Industrie] vit de recommandations et de reseaux — mais ces canaux ont un plafond" → TEMPLATE GENERIQUE (pas un fait sur EUX)
- "Comment [Company] genere de nouvelles opportunites ?" → META-PROSPECTION (on VEND ca)
- "Quand le carnet de contacts est sature..." → TEMPLATE GENERIQUE
- "Le cercle de prescripteurs est sature..." → TEMPLATE GENERIQUE
- Toute structure repetable ou le seul changement est le nom de l'industrie/entreprise → C'EST UN TEMPLATE, PAS UN EMAIL PERSONNALISE

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
    const userMessage = `Ecris un email pour ce prospect. Utilise la MEILLEURE donnee disponible selon la hierarchie (profil public > news > clients > techno > chiffres).
IMPORTANT : essaie TOUJOURS d'ecrire un email. Si tu as au moins un nom d'entreprise + un poste, tu peux ecrire sur l'activite de cette entreprise. Skip UNIQUEMENT si tu n'as AUCUNE info (pas de nom d'entreprise, pas de description d'activite, rien). Un email 7/10 vaut mieux qu'un skip.

CONTACT :
- Prenom : ${firstName}
- Nom complet : ${contact.name || ''}
- Poste : ${contact.title || 'non precise'}
- Entreprise : ${contact.company || 'non precisee'}
- Email : ${contact.email}
${context ? '\nDONNEES PROSPECT :\n' + context : ''}`;

    // Generation + auto-scoring + retry
    const result = await this._generateAndScore(contact, context, systemPrompt, userMessage);
    return result;
  }

  // Auto-scoring : note l'email 1-10, retry si < 9, skip si < 8 apres retry
  async _generateAndScore(contact, context, systemPrompt, userMessage) {
    const maxAttempts = 2;
    let best = null;
    let bestScore = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let prompt = userMessage;
      if (attempt > 0 && best) {
        prompt = userMessage + '\n\nATTENTION: l\'email precedent a ete note ' + bestScore + '/10. Problemes: ' + (best._scoreReason || 'qualite insuffisante') + '. Ecris un email MEILLEUR — plus court (30-50 mots max), un FAIT specifique, UNE question, ZERO analyse, ZERO meta-prospection.';
      }
      const response = await this.callClaude(
        [{ role: 'user', content: prompt }],
        systemPrompt,
        1500
      );
      const parsed = this._parseJSON(response);
      if (!parsed) return parsed;

      // Si Claude skip au premier essai, retry UNE FOIS avec un prompt plus insistant
      if (parsed.skip) {
        if (attempt === 0) {
          // Retry : Claude est stochastique, parfois il skip alors que les donnees suffisent
          const retryPrompt = prompt + '\n\nATTENTION : tu as voulu skip mais tu as des donnees exploitables. REGLE : si tu as un nom d\'entreprise + un poste → tu DOIS ecrire un email. Utilise la PRIORITE 4.5 : ecris 25-35 mots sur un defi concret de ce type de poste dans cette entreprise. Exemple : "Marc, diriger la tech chez [Entreprise] a [Ville] — entre [defi 1] et [defi 2], tu priorises comment ?". Skip UNIQUEMENT si tu n\'as meme pas de nom d\'entreprise. Un email 7/10 > un skip.';
          try {
            const retryResponse = await this.callClaude(
              [{ role: 'user', content: retryPrompt }],
              systemPrompt,
              1500
            );
            const retryParsed = this._parseJSON(retryResponse);
            if (retryParsed && !retryParsed.skip) {
              // Le retry a produit un email — continuer vers le scoring
              const retryScore = await this._scoreEmail(retryParsed.subject, retryParsed.body, contact);
              if (retryScore.note >= 9) return retryParsed;
              if (retryScore.note > bestScore) {
                best = retryParsed;
                bestScore = retryScore.note;
                best._scoreReason = retryScore.reason;
              }
              continue; // passer a l'iteration suivante du for loop
            }
          } catch (e) { /* retry echoue, on garde le skip original */ }
        }
        return parsed; // skip confirme apres retry (ou 2e attempt)
      }

      // Auto-scoring via GPT-4o-mini (cout: ~0.001$/email)
      const score = await this._scoreEmail(parsed.subject, parsed.body, contact);
      if (score.note >= 9) return parsed; // 9-10/10 → envoyer direct
      if (score.note > bestScore) {
        best = parsed;
        bestScore = score.note;
        best._scoreReason = score.reason;
      }
    }
    // Apres retries : envoyer si >= 7, sinon skip (abaisse de 8 a 7 — un 7/10 vaut mieux qu'un skip)
    if (bestScore >= 7) return best;
    return { skip: true, reason: 'auto_score_too_low:' + bestScore + '/10 (' + (best && best._scoreReason || '?') + ')' };
  }

  async _scoreEmail(subject, body, contact) {
    const wordCount = (body || '').split(/\s+/).filter(w => w.length > 0).length;
    const prompt = `Note cet email de prospection B2B de 1 a 10. Sois TRES STRICT.

CRITERES 10/10 :
- 50-80 mots (penalise si < 40 ou > 100)
- UN fait specifique (chiffre, nom propre, date, evenement)
- UNE question irresistible
- UN CTA soft naturel (pas de lien, pas de pitch)
- ZERO paragraphe d'analyse entre le fait et la question
- ZERO meta-prospection (ne demande PAS "comment tu prospectes/acquiers des clients/generes des leads")
- ZERO lecon au prospect (pas de "Ce type de...", "Le vrai cap c'est...")
- Ton naturel, entre pairs, comme un SMS entre collegues
- PAS de pitch, prix, feature, lien

PENALITES :
- < 40 mots : -2 points (trop sec, pas assez de substance)
- > 100 mots : -3 points (trop long)
- > 120 mots : -5 points
- Paragraphe d'analyse (plus de 2 phrases entre fait et question) : -3 points
- Meta-prospection (question sur la prospection/acquisition du prospect) : -3 points
- Generique secteur (remplacable par n'importe quelle entreprise du secteur) : -4 points
- Pitch/prix/CTA : -5 points

EMAIL :
Objet: ${subject}
Corps: ${body}
(${wordCount} mots)
Prospect: ${contact.name || '?'} — ${contact.company || '?'}

Reponds UNIQUEMENT en JSON : {"note":X,"reason":"explication en 10 mots max"}`;

    try {
      const response = await this.callOpenAIMini(
        'Tu es un evaluateur strict de cold emails B2B. Note de 1 a 10.',
        prompt,
        100
      );
      const parsed = this._parseJSON(response);
      if (parsed && typeof parsed.note === 'number') {
        return { note: Math.min(10, Math.max(1, Math.round(parsed.note))), reason: parsed.reason || '' };
      }
    } catch (e) { /* scoring echoue → score bas pour forcer prudence */ }
    return { note: 5, reason: 'scoring_unavailable' }; // default prudent si scoring echoue
  }

  // Score leger pour les follow-ups/relances (pas de retry, juste reject si trop bas)
  // Seuil 6/10 pour les follow-ups (vs 8/10 step 1) — un 6/10 Claude est mieux qu'un template generique
  async _scoreAndFilter(parsed, contact) {
    if (!parsed || parsed.skip) return parsed;
    try {
      // Gate programmatique rapide : rejet automatique si > 60 mots (sans appeler le scorer)
      const wordCount = (parsed.body || '').split(/\s+/).filter(w => w.length > 0).length;
      if (wordCount > 60) {
        return { skip: true, reason: 'too_many_words:' + wordCount + ' (max 60)' };
      }
      const score = await this._scoreEmail(parsed.subject, parsed.body, contact);
      if (score.note >= 6) return parsed;
      return { skip: true, reason: 'auto_score_too_low:' + score.note + '/10 (' + (score.reason || '?') + ')' };
    } catch (e) {
      // Scoring indisponible — appliquer gates programmatiques strictes
      const wc = (parsed.body || '').split(/\s+/).filter(w => w.length > 0).length;
      if (wc > 55) {
        return { skip: true, reason: 'scoring_unavailable_words:' + wc };
      }
      const contactRef = ((contact.firstName || contact.name || '').split(' ')[0] || '').toLowerCase();
      const companyRef = (contact.company || '').toLowerCase();
      const subjectLower = (parsed.subject || '').toLowerCase();
      if (contactRef && contactRef.length > 2 && !subjectLower.includes(contactRef) &&
          companyRef && companyRef.length > 2 && !subjectLower.includes(companyRef)) {
        return { skip: true, reason: 'scoring_unavailable_generic_subject' };
      }
      return parsed;
    }
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

    // Construire le lien Google Calendar pour le breakup (si configure)
    let breakupBookingUrl = '';
    const googleBookingUrl = process.env.GOOGLE_BOOKING_URL || '';
    const contactFirstName = contact.firstName || (contact.name || '').split(' ')[0] || '';
    if (googleBookingUrl && contact.email) {
      try {
        const bpUrl = new URL(googleBookingUrl);
        bpUrl.searchParams.set('email', contact.email);
        if (contactFirstName) bpUrl.searchParams.set('name', contactFirstName);
        breakupBookingUrl = bpUrl.toString();
      } catch (e) {
        breakupBookingUrl = googleBookingUrl;
      }
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

FORMAT DE CHAQUE RELANCE (sauf breakup) — 30-50 mots max (JAMAIS plus de 50) :
1. OBSERVATION = fait specifique ou nouvel insight + implication en UNE phrase (PAS "je reviens vers toi")
2. QUESTION = variee (frontale, provocatrice, binaire, contextuelle). PAS toujours "X ou Y ?"

INTERDIT : le paragraphe d'analyse qui explique au prospect son propre business. Il SAIT. Coupe.

INTERDITS ABSOLUS (TEMPLATES GENERIQUES) :
- "[Industrie] vit de recommandations et de reseaux" → TEMPLATE
- "Comment [Company] genere de nouvelles opportunites" → META-PROSPECTION
- "Ces canaux ont un plafond" / "carnet de contacts sature" → TEMPLATE
- Toute phrase ou seul le nom de l'industrie/entreprise change entre deux emails → C'EST UN TEMPLATE, PAS UNE RELANCE.
- Chaque relance DOIT citer un fait SPECIFIQUE du prospect (news, chiffre, client, techno, produit, interview).

REGLES :
- 30-50 mots par relance (JAMAIS plus de 50). Le breakup = 2 lignes MAX. ZERO paragraphe analytique.
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

      // Post-processing : garantir que le breakup (dernier email) contient le lien booking
      if (breakupBookingUrl && emails.length > 0) {
        const last = emails[emails.length - 1];
        if (last.body && !last.body.includes(breakupBookingUrl.split('?')[0])) {
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
    let emailLengthHint = '50-80 mots (vise 65, JAMAIS plus de 80)';
    try {
      const selfImproveStorage = require('../self-improve/storage.js');
      const prefs = selfImproveStorage.getEmailPreferences();
      if (prefs && prefs.maxLength) {
        const chars = prefs.maxLength;
        emailLengthHint = chars < 200 ? '20-35 mots max (ultra-court)' : chars < 400 ? '30-50 mots max (JAMAIS plus de 50)' : '40-60 mots max';
      }
    } catch (e) {
      try {
        const selfImproveStorage = require('/app/skills/self-improve/storage.js');
        const prefs = selfImproveStorage.getEmailPreferences();
        if (prefs && prefs.maxLength) {
          const chars = prefs.maxLength;
          emailLengthHint = chars < 200 ? '20-35 mots max (ultra-court)' : chars < 400 ? '30-50 mots max (JAMAIS plus de 50)' : '40-60 mots max';
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

INTERDITS ABSOLUS (TEMPLATES GENERIQUES) :
- "[Industrie] vit de recommandations et de reseaux" → TEMPLATE
- "Comment [Company] genere de nouvelles opportunites" → META-PROSPECTION
- "Ces canaux ont un plafond" / "carnet de contacts sature" → TEMPLATE
- La relance DOIT citer un fait SPECIFIQUE du prospect (news, chiffre, client, techno, produit).

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
    const parsed = this._parseJSON(response);
    return this._scoreAndFilter(parsed, contact);
  }

  /**
   * Genere une relance de campagne individuellement personnalisee pour un prospect.
   * Contrairement a generateSequenceEmails() qui genere des templates,
   * cette methode genere un email unique base sur le brief complet du prospect.
   */
  async generatePersonalizedFollowUp(contact, stepNumber, totalSteps, prospectIntel, previousEmails, campaignContext) {
    let emailLengthHint = '50-80 mots (vise 65, JAMAIS plus de 80)';
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
      if (siPrefsfu.maxLength === 'short') emailLengthHint = '20-35 mots max (ultra-court)';
      else if (siPrefsfu.maxLength === 'long') emailLengthHint = '40-60 mots max';
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
      stepStrategy = 'Relance 1 (J+3): Nouvel angle DIFFERENT du premier email, tire des DONNEES PROSPECT. Question ouverte + CTA soft ("dispo pour en parler", "ca vaut un echange ?").';
    } else if (stepNumber === 3) {
      stepStrategy = 'Relance 2 (J+7): Preuve sociale — mini cas client anonymise ("un dirigeant dans ton secteur..."). Fait rebondir sur un aspect specifique du prospect + CTA soft.';
    } else if (stepNumber === totalSteps - 1 && totalSteps > 4) {
      stepStrategy = 'Relance 3 (J+14): Dernier angle de valeur, question directe basee sur un fait specifique des donnees prospect + CTA soft.';
    } else if (isBreakup) {
      stepStrategy = 'BREAKUP (derniere relance): 2 lignes MAXIMUM. Choix binaire simple ("pas le bon moment ? dis-le moi"). Exploite la loss aversion.';
    } else {
      stepStrategy = 'Relance ' + (stepNumber - 1) + ': Nouvel angle tire des DONNEES PROSPECT, question specifique.';
    }

    const senderName = process.env.SENDER_NAME || 'Alexis';
    const senderTitle = process.env.SENDER_TITLE || 'fondateur';
    const clientName = process.env.CLIENT_NAME || 'iFIND';
    const fuEmailLanguage = process.env.EMAIL_LANGUAGE || 'fr';
    const fuClientDescription = process.env.CLIENT_DESCRIPTION || '';

    let fuLanguageBlock = '';
    if (fuEmailLanguage === 'ro') {
      fuLanguageBlock = `LIMBA: SCRIE IN ROMANA. Ton: tutuit, relaxat dar profesional.\n${fuClientDescription ? 'CE FACE ' + clientName.toUpperCase() + ': ' + fuClientDescription + '\n' : ''}`;
    } else if (fuEmailLanguage !== 'fr') {
      fuLanguageBlock = `LANGUAGE: Write in ${fuEmailLanguage}.\n`;
    }

    const systemPrompt = `${fuLanguageBlock}Tu es ${senderName}, ${senderTitle} de ${clientName}. Tu ecris une relance personnalisee a un prospect specifique.

CONTEXTE : Relance ${stepNumber - 1} sur ${totalSteps - 1} (step ${stepNumber}/${totalSteps}).
STRATEGIE : ${stepStrategy}

FORMAT (${emailLengthHint}) :
1. OBSERVATION = fait specifique ou nouvel insight + implication (PAS "je reviens vers toi", PAS de paragraphe d'analyse)
2. QUESTION = variee (frontale, provocatrice, binaire, contextuelle)
3. CTA SOFT = ouverture naturelle ("dispo pour en parler", "ca vaut un echange ?", "curieux d'avoir ton retour")
${isBreakup ? '\nBREAKUP = 2 phrases max. Question fermee. Exploite la loss aversion. PAS de CTA soft.' : ''}

INTERDIT : le paragraphe d'analyse LinkedIn qui explique au prospect ce qu'il vit. Il SAIT. Coupe.

INTERDITS ABSOLUS (TEMPLATES GENERIQUES) :
- "[Industrie] vit de recommandations et de reseaux" → TEMPLATE
- "Comment [Company] genere de nouvelles opportunites" → META-PROSPECTION
- "Ces canaux ont un plafond" / "carnet de contacts sature" → TEMPLATE
- La relance DOIT citer un fait SPECIFIQUE tire des DONNEES PROSPECT ci-dessous.

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
    const parsed = this._parseJSON(response);
    // Breakups : gate programmatique (trop courts pour le scorer IA)
    if (isBreakup) {
      if (!parsed || parsed.skip) return parsed;
      const bwc = (parsed.body || '').split(/\s+/).filter(w => w.length > 0).length;
      if (bwc > 50) return { skip: true, reason: 'breakup_too_long:' + bwc };
      if (bwc < 8) return { skip: true, reason: 'breakup_too_short:' + bwc };
      return parsed;
    }
    return this._scoreAndFilter(parsed, contact);
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

  async generateBodyVariant(originalBody, originalSubject, prospectContext, contact) {
    const systemPrompt = `Tu es un expert en cold email B2B et A/B testing. On te donne un cold email. Reecris-le avec un ANGLE COMPLETEMENT DIFFERENT tout en ciblant le meme prospect.

REGLES STRICTES :
- Meme structure : 2 blocs (observation + question). Pas plus.
- 30-50 mots max (JAMAIS plus de 50)
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
      // Claude Sonnet pour la qualite (meme modele que l'email original — A/B equitable)
      const response = await this.callClaude(
        [{ role: 'user', content: userMessage }],
        systemPrompt,
        800
      );
      const parsed = this._parseJSON(response);
      if (parsed && parsed.body && parsed.subject && !parsed.skip) {
        // Gate programmatique : rejet si > 60 mots
        const wc = (parsed.body || '').split(/\s+/).filter(w => w.length > 0).length;
        if (wc > 60) return null;
        // Scoring GPT-4o-mini (seuil 6/10, comme les follow-ups)
        if (contact) {
          try {
            const scored = await this._scoreAndFilter(parsed, contact);
            if (scored && scored.skip) {
              log.info('claude-email-writer', 'A/B variant B scored LOW: ' + (scored.reason || 'score<6'));
              return null;
            }
          } catch (scoreErr) { /* scoring indisponible, gate wc suffit */ }
        }
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
