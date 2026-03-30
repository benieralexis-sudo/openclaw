// AutoMailer - Redaction IA d'emails via Claude API (+ OpenAI GPT-4o-mini pour taches simples)
const https = require('https');

// === LANG_PATTERNS : listes de mots par langue pour le scoring Lavender ===
const LANG_PATTERNS = {
  fr: {
    deadCTAs: ['curieux d\'avoir ton retour', 'curieux d\'avoir ton avis', 'curieux de savoir',
      'qu\'en penses-tu', 'qu\'en pensez-vous', 'ton retour m\'interesse', 'dis-moi ce que tu en penses',
      'curieux d\'avoir votre retour', 'curieux d\'avoir votre avis',
      'curieux d\'en savoir plus', 'ton avis m\'interesse',
      'c\'est quoi la strategie', 'c\'est quoi le plan',
      'conviction ou differenciation', 'choix strategique ou'],
    metaP: ['comment tu prospectes', 'comment vous prospectez', 'comment tu acquiers',
      'comment tu generes', 'comment tu trouves de nouveaux clients', 'acquisition de clients',
      'generer des leads', 'trouver de nouveaux clients'],
    fakeCaseStudy: /\d+\s*(?:nouveaux?\s+)?(?:clients?|contacts?|meetings?|mandats?|dossiers?|missions?|comptes?|rdv|rendez-vous)\s+(?:en|par)\s+\d+\s*(?:mois|semaines?|jours?)/i,
    hesitant: ['peut-etre', 'je me trompe', 'c\'est peut-etre pas', 'je me demandais',
      'pas du tout', 'ou pas', 'c\'est le cas', 'je me permets pas', 'je sais pas si',
      'j\'ignore si', 'c\'est un sujet ou', 'ou c\'est encore', 'ou pas du tout',
      'c\'est le cas chez', 'vous avez quelque chose'],
    casual: ['t\'', 'j\'', 'c\'est', 'y\'a', 'l\'', 'd\'', 'qu\'', 'n\''],
    jePatterns: /\bje\b|\bj'/g,
    nousPatterns: /\bnous\b/g,
    tuPatterns: /\btu\b|\bt'/g,
    vousPatterns: /\bvous\b|\bvotre\b|\bvos\b|\bton\b|\bta\b|\btes\b/g,
    passiveConditional: /\bserait\b|\bpourrait\b|\bdevrait\b|\baurait\b/g,
    complexWords: ['neanmoins', 'toutefois', 'cependant', 'effectivement', 'fondamentalement',
      'potentiellement', 'strategiquement', 'systematiquement', 'problematique', 'optimiser',
      'implementation', 'transformation', 'digitalisation', 'accompagnement'],
    hypothesis: ['ca veut souvent dire', 'ca veut dire', 'ca signifie',
      'depend encore', 'repose encore', 'reposent encore', 'porte encore', 'portent encore',
      'absorbe tout', 'ne suit pas', 'suivent pas',
      'plafonne', 'du mal a', 'le risque', 'le defi', 'la difficulte',
      'souvent ca', 'souvent le', 'souvent les', 'souvent c\'est'],
    numbersPattern: /\d+\s*(?:personnes?|postes?|salaries?|collaborateurs?|%|euros?|millions?|M€)/,
    valueCTAs: ['c\'est un sujet', 'c\'est le cas', 'ou pas', 'pas du tout',
      'ca vous parle', 'ca te parle', 'un sujet chez', 'comment tu', 'comment vous',
      'vous avez', 'tu as', 'structure', 'en interne', 'externalise',
      'je te montre', 'je vous montre', 'on en parle', 'on en discute',
      'dispo si', 'ca t\'interesse', 'ca vous interesse']
  },
  ro: {
    deadCTAs: ['curios sa aflu parerea ta', 'curios sa stiu', 'ce parere ai',
      'ce credeti', 'parerea ta ma intereseaza', 'spune-mi ce crezi',
      'curios sa aflu mai multe', 'alegere strategica sau',
      'ce strategie aveti', 'care e planul'],
    metaP: ['cum prospectezi', 'cum achizitionezi clienti', 'cum generezi',
      'cum gasesti clienti noi', 'achizitie de clienti', 'generare de leaduri',
      'gasirea de clienti noi', 'cum atragi clienti'],
    fakeCaseStudy: /\d+\s*(?:noi\s+)?(?:clienti?|contacte?|intalniri?|mandate?|dosare?|misiuni?|conturi?)\s+(?:in|pe)\s+\d+\s*(?:luni?|saptamani?|zile?)/i,
    hesitant: ['poate', 'ma insel', 'poate nu e cazul', 'ma intrebam',
      'deloc', 'sau nu', 'e cazul', 'nu stiu daca', 'oare',
      's-ar putea', 'sau poate nu', 'e cazul la',
      'aveti ceva', 'sau deloc', 'poate gresesc'],
    casual: ['n-am', 'nu-i', 'ce-i', 'n-ai', 'nu-s', 'mi-e', 'ti-e', 'asa-i', 'e ok', 'da\''],
    jePatterns: /\beu\b/g,
    nousPatterns: /\bnoi\b/g,
    tuPatterns: /\btu\b/g,
    vousPatterns: /\bdumneavoastra\b|\bechipa\s+ta\b|\bechipa\s+voastra\b|\bvoi\b|\bfirma\s+ta\b|\bcompania\s+ta\b/g,
    passiveConditional: /\bar fi\b|\bar putea\b|\bar trebui\b|\bs-ar\b/g,
    complexWords: ['cu toate acestea', 'in mod fundamental', 'in mod sistematic',
      'din punct de vedere strategic', 'problematica', 'implementare',
      'transformare', 'digitalizare', 'acompaniament', 'potentialul',
      'semnificativ', 'substantialmente'],
    hypothesis: ['asta inseamna ca', 'asta inseamna', 'inseamna ca',
      'depinde inca de', 'se bazeaza inca pe', 'absoarbe tot',
      'nu urmareste', 'stagneaza', 'dificultatea', 'riscul', 'provocarea',
      'de obicei asta', 'de obicei', 'adesea', 'in general'],
    numbersPattern: /\d+\s*(?:persoane?|posturi?|angajati?|colaboratori?|%|euro?|lei|milioane?)/,
    valueCTAs: ['e un subiect', 'e cazul', 'sau nu', 'deloc',
      'va vorbeste', 'iti vorbeste', 'un subiect la', 'cum',
      'aveti', 'ai', 'intern', 'externalizat',
      'iti arat', 'va arat', 'discutam', 'vorbim',
      'te intereseaza', 'va intereseaza', 'merita', 'sau deloc']
  }
};

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

  // GPT-4o-mini pour taches simples (edit, subject variant)
  async callOpenAIMini(systemPrompt, userMessage, maxTokens) {
    maxTokens = maxTokens || 500;
    if (!this.openaiKey) return this.callClaude([{ role: 'user', content: userMessage }], systemPrompt, maxTokens);
    const { callOpenAI } = require('../../gateway/shared-nlp.js');
    const result = await callOpenAI(this.openaiKey, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ], { maxTokens, temperature: 0.2 });
    return result.content;
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

      // Fallback 3 : regex robuste pour subject/body
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

  // === STRATEGIC ANALYST : diagnostic business du prospect avant redaction ===
  async analyzeProspect(contact, prospectBrief, nicheData) {
    if (!prospectBrief || prospectBrief.length < 50) return null;

    const senderName = process.env.SENDER_NAME || 'Alexis';
    const clientName = process.env.CLIENT_NAME || 'iFIND';

    let nicheBlock = '';
    if (nicheData) {
      if (nicheData.painPoint) nicheBlock += '\nPROBLEME TYPE DE CETTE NICHE: ' + nicheData.painPoint;
    }

    const systemPrompt = `Tu es un analyste B2B. Tu ne rediges PAS d'email. Tu produis un DIAGNOSTIC BUSINESS.

${clientName} = agent de prospection autonome. Il prospecte seul : analyse qui contacter, personnalise chaque email, relance. L'humain n'a rien a faire.
${nicheBlock}

=== MISSION ===
A partir des donnees prospect, reponds a UNE question :
"Quel PROBLEME BUSINESS ce prospect a probablement, que ${clientName} peut resoudre ?"

Methode :
1. SIGNAL : trouve le fait le plus RECENT et SPECIFIQUE. PRIORITE TIMELINE (×2.3 reply rate) :
   a) Post LinkedIn recent du prospect
   b) Offre d'emploi / recrutement actif
   c) News recente (levee, lancement, partenariat, acquisition)
   d) Changement de poste du prospect
   e) DERNIER RECOURS : fait statique (titre, taille, secteur)
   Privilegie TOUJOURS un event date (a-d) plutot qu'une description generique (e).
2. HYPOTHESE : transforme ce signal en probleme business probable. Ex: "3 postes sales ouverts" → "le pipe depend encore du fondateur et ca ne scale pas"
3. TON : "vouvoiement" par defaut. Tutoiement UNIQUEMENT si le prospect tutoie en premier.

=== REGLES ===
- N'invente JAMAIS un fait sur le prospect. Si aucun signal fort, dis-le.
- Le diagnostic doit etre SPECIFIQUE a CE prospect, pas generique au secteur.
- Annee en cours : 2026.

=== FORMAT ===
JSON valide uniquement :
{"signal":"le fait specifique tire des donnees","hypothesis":"le probleme business probable en 1 phrase","angle":"l'accroche email en 1 phrase (observation, pas pitch)","recommendedTone":"tutoiement|vouvoiement","strength":8,"briefSummary":"pourquoi ce prospect est pertinent en 1 phrase"}`;

    const userMessage = `DONNEES PROSPECT A ANALYSER :

${prospectBrief}

CONTACT :
- Prenom : ${contact.firstName || (contact.name || '').split(' ')[0] || 'inconnu'}
- Nom : ${contact.name || ''}
- Poste : ${contact.title || 'non precise'}
- Entreprise : ${contact.company || 'non precisee'}
- Email : ${contact.email || ''}

Analyse ces donnees et produis ta recommandation strategique.`;

    try {
      const response = await this.callClaude(
        [{ role: 'user', content: userMessage }],
        systemPrompt,
        1000
      );

      const cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      // Extraire le JSON meme si Claude ajoute du texte apres
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (_) {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in Claude response');
        parsed = JSON.parse(jsonMatch[0]);
      }

      // Validation minimale — nouveau format (signal/hypothesis/angle)
      if (!parsed.signal && !parsed.hypothesis && !parsed.angle) {
        // Compat ancien format (topAngles)
        if (parsed.topAngles && Array.isArray(parsed.topAngles) && parsed.topAngles.length > 0) {
          return parsed;
        }
        return null;
      }

      // Normaliser vers le format attendu par le writer
      if (!parsed.topAngles) {
        parsed.topAngles = [{ angle: parsed.angle || '', fact: parsed.signal || '', strength: parsed.strength || 7 }];
        parsed.bestFact = parsed.signal || '';
        parsed.briefSummary = parsed.briefSummary || parsed.hypothesis || '';
      }

      return parsed;
    } catch (e) {
      console.warn('[email-writer] Strategic analysis echoue: ' + e.message);
      return null;
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
      if (siPrefs.maxLength === 'short') emailLengthHint = '50-65 mots (court mais substantiel)';
      else if (siPrefs.maxLength === 'long') emailLengthHint = '65-100 mots';
      if (siPrefs.subjectStyle) subjectStyleHint = '\nSTYLE OBJET RECOMMANDE : ' + siPrefs.subjectStyle;
      if (siPrefs.preferredSubjectLength) subjectStyleHint += ' (' + siPrefs.preferredSubjectLength + ' mots max)';
    }

    const senderName = process.env.SENDER_NAME || 'Alexis';
    const senderTitle = process.env.SENDER_TITLE || 'fondateur';
    const clientName = process.env.CLIENT_NAME || 'iFIND';
    const emailLanguage = process.env.EMAIL_LANGUAGE || 'fr';
    const emailTone = process.env.EMAIL_TONE || 'formal';

    // === A/B TEST OBJET ===
    // Variante A : question courte universelle ("{prénom}, une question")
    // Variante B : signal spécifique ("{signal principal du prospect}")
    const abVariant = Math.random() < 0.5 ? 'A' : 'B';
    let abSubjectInstruction = '';
    if (abVariant === 'A') {
      abSubjectInstruction = '\n=== A/B TEST — VARIANTE A : OBJET QUESTION COURTE ===\nL\'objet DOIT etre une question courte et universelle de 2-3 mots. Exemples : "{prenom}, une question", "{prenom}, rapide question", "question {entreprise}". Ne mentionne PAS le signal dans l\'objet.\n';
    } else {
      abSubjectInstruction = '\n=== A/B TEST — VARIANTE B : OBJET SIGNAL SPECIFIQUE ===\nL\'objet DOIT mentionner le signal specifique du prospect en 2-4 mots minuscules. Exemples : "3 recrutements chez {entreprise}", "votre offre data", "{entreprise} et la levee". L\'objet doit etre unique a ce prospect.\n';
    }

    // --- ICP : charger le contexte niche (value prop, pain point, social proof) ---
    let icpLoader = null;
    try { icpLoader = require('../../gateway/icp-loader.js'); } catch (e) {
      try { icpLoader = require('/app/gateway/icp-loader.js'); } catch (e2) {}
    }
    const clientDescription = (icpLoader && icpLoader.getClientDescription()) || process.env.CLIENT_DESCRIPTION || '';
    const nicheContext = contact._nicheContext || null;
    const nicheSlug = contact._nicheSlug || null;
    let nicheData = nicheContext;
    if (!nicheData && nicheSlug && icpLoader) {
      const ctx = icpLoader.getEmailContext(nicheSlug);
      if (ctx) nicheData = ctx.niche;
    }
    if (!nicheData && icpLoader) {
      nicheData = icpLoader.matchLeadToNiche(contact);
    }

    // --- Construire le bloc ICP pour le prompt ---
    let icpBlock = '';
    if (nicheData) {
      icpBlock = '\n=== CONTEXTE NICHE ===\n';
      icpBlock += 'NICHE : ' + (nicheData.name || nicheData.slug || 'inconnue');
      if (nicheData.painPoint) icpBlock += '\nPROBLEME TYPIQUE : ' + nicheData.painPoint;
      if (contact._triggerAngle) icpBlock += '\nTRIGGER DETECTE : ' + contact._triggerAngle;
      icpBlock += '\nUtilise le probleme typique UNIQUEMENT si les donnees prospect le confirment. Ne force pas.\n';
    }

    // Bloc langue pour clients non-francophones
    let languageBlock = '';
    if (emailLanguage === 'ro') {
      languageBlock = `
=== LIMBA / LANGUAGE ===
SCRIE EMAILUL IN ROMANA. Nu in franceza, nu in engleza.
Ton: ${emailTone === 'informal' ? 'tutuit, relaxat dar profesional' : 'formal, cu dumneavoastra'}.
Subiectul emailului: in romana, 2-4 cuvinte, ca un mesaj intre colegi.
Toate regulile de mai jos se aplica dar emailul TREBUIE sa fie in romana naturala, nu tradusa.
${clientDescription ? 'CE FACE ' + clientName.toUpperCase() + ': ' + clientDescription : ''}

`;
    } else if (emailLanguage !== 'fr') {
      languageBlock = `
=== LANGUAGE ===
Write the email in ${emailLanguage}. All rules below apply but the email MUST be in native ${emailLanguage}.
${clientDescription ? 'WHAT ' + clientName.toUpperCase() + ' DOES: ' + clientDescription : ''}

`;
    }

    // --- Construire l'exemple niche-specific si disponible ---
    let nicheExampleBlock = '';
    if (nicheData && nicheData.exampleEmail) {
      nicheExampleBlock = `
=== EXEMPLE POUR CETTE NICHE (inspire-toi du niveau, pas de la structure exacte) ===
"${nicheData.exampleEmail}"
`;
    }

    // FIX 10 : Injecter les patterns gagnants (emails qui ont recu des reponses)
    let winningPatternsBlock = '';
    try {
      const amStorageWin = require('./storage.js');
      if (amStorageWin && amStorageWin.data && amStorageWin.data.emails) {
        const repliedEmails = amStorageWin.data.emails
          .filter(function(e) { return (e.status === 'replied' || e.hasReplied) && e.body && e.stepNumber <= 1; })
          .slice(-5);
        if (repliedEmails.length >= 2) {
          winningPatternsBlock = '\n=== EMAILS QUI ONT OBTENU DES REPONSES (inspire-toi du style et du pattern) ===\n';
          for (const re of repliedEmails) {
            winningPatternsBlock += '--- Email gagnant (reply recu) ---\nObjet: ' + (re.subject || '') + '\nCorps: ' + (re.body || '').substring(0, 300) + '\n\n';
          }
          winningPatternsBlock += 'ANALYSE: Ces emails ont un point commun — identifie-le et reproduis-le. Fait concret + question business specifique = reponse.\n';
        }
      }
    } catch (winErr) { /* non bloquant */ }

    const systemPrompt = `${languageBlock}Tu es ${senderName}, ${senderTitle} de ${clientName}. Tu ecris un cold email a un pair.

=== CE QUE FAIT ${clientName} ===
Agent de prospection autonome. Il analyse qui contacter et quand, personnalise chaque email, relance. Le client n'a rien a faire.

=== FRAMEWORK (Observation → Hypothese → Question) ===
1. OBSERVATION (1-2 phrases) : un fait CONCRET et RECENT tire des donnees. TIMELINE HOOKS OBLIGATOIRES — utilise en priorite :
   a) Post LinkedIn recent du prospect (si dispo dans les donnees)
   b) Offre d'emploi en cours / recrutement actif
   c) News recente de l'entreprise (levee, lancement, partenariat)
   d) Changement de poste recent du prospect
   e) DERNIER RECOURS : observation sur le profil/entreprise (titre, taille, secteur)
   Les hooks timeline (a-d) generent 2.3x plus de reponses que les observations statiques (e). TOUJOURS privilegier un evenement DATE plutot qu'un fait generique.
2. HYPOTHESE (1 phrase) : transforme ce fait en probleme business probable. C'est la que tu montres que tu COMPRENDS leur situation. Ex: "Ca veut souvent dire que les nouveaux clients reposent encore sur toi."
3. QUESTION OUVERTE (1 phrase) : invite a la conversation. Pas "dispo 15 min ?" mais une vraie question business : "C'est le cas chez vous ?", "Vous avez structure quelque chose ?", "C'est un sujet en ce moment ?"

=== ANALYSE STRATEGIQUE ===
Si les donnees contiennent "=== ANALYSE STRATEGIQUE ===", SUIS ses directives : signal, hypothese, angle. L'analyste a deja identifie le meilleur angle.

=== METHODE LAVENDER (6 SECRETS — +35% REPLY RATE) ===
1. 40-60 MOTS MAX (pas 80, pas 100 — les emails <50 mots ont 65% de reply rate vs 2% pour >125 mots)
2. NIVEAU CM1 : phrases de 5-8 mots. Mots de 2 syllabes max. Pas de jargon. "On t'aide a trouver des clients" > "Nous optimisons le pipeline commercial". ZERO mot anglais business (pipe, outbound, scale, pipeline, lead, CRM, deal flow, funnel, churn).
3. TON HESITANT (+35% replies) : "je me trompe peut-etre", "c'est peut-etre pas le cas", "je me demandais si", "c'est un sujet ou pas du tout ?". Le doute invite a corriger → reponse. L'affirmation invite a ignorer.
4. CTC (Call To Curiosity), PAS CTA : "C'est le cas chez vous ?" > "Dispo 15 min mardi ?". La question ouverte > le calendrier.
5. OBJET ENNUYEUX : 2-3 mots, minuscules, pas de majuscules, pas de ponctuation. Comme un email entre collegues. "${contact.firstName || contact.company || 'question'}" et c'est tout.
6. RATIO JE/TU : parle du prospect 2x plus que de toi. Chaque "je" doit etre precede ou suivi d'un "tu/vous". Si tu comptes plus de "je" que de "tu", reecris.

=== REGLES ===
- 40-60 mots STRICT. Ecris comme tu parles a un pote entrepreneur. Chaque mot doit meriter sa place.
- PAS de social proof invente. PAS de "un client similaire a signe X clients en Y mois". Si tu n'as pas de cas reel, n'en invente pas.
- PAS de pitch, prix, features, bullet points.
- PAS de tirets cadratins. PAS de "Bonjour". PAS de signature.
- PAS de meta-prospection ("comment tu acquiers des clients").
- PAS de phrases creuses : "beau move", "impressionnant", "sacre parcours", "je me permets", "potentiellement", "cordonnier mal chausse".
- PAS de jargon anglais : pipe, pipeline, outbound, inbound, scale, lead, CRM, deal flow, funnel, churn, growth, onboarding. Parle en francais simple.
- N'invente JAMAIS un fait sur le prospect. Annee : 2026.
- Vouvoiement par defaut. Tutoiement uniquement si le prospect tutoie en premier.
${nicheExampleBlock}
${emailLanguage === 'ro' ? `=== EXEMPLE 10/10 (TON EZITANT + SCURT) ===
Exemplu 1 (semnal crestere, 38 cuvinte) :
"Andrei, [Companie] are 25 de oameni pe Google Workspace. Asta inseamna de obicei ca echipa foloseste doar Gmail si Drive, dar Calendar partajat, Spaces, regulile automate — nimeni nu le-a configurat.

E cazul sau ma insel?"

Exemplu 2 (semnal securitate, 35 cuvinte) :
"Maria, [Companie] are 30 de oameni — intrebare rapida: aveti 2FA activat pe toate conturile Google Workspace?

Vedem multe firme unde un singur cont fara 2FA compromite totul. Poate nu e cazul la voi?"

Exemplu 3 (semnal general, 32 cuvinte) :
"Ion, [Companie] foloseste Google Workspace direct de la Google. Fara suport in romana, fara cineva care sa te ajute cand ai o problema.

E un subiect sau deloc?"

=== VARIATIE STRUCTURALA (SPINTAX) ===
Ca emailurile sa nu se asemene structural, foloseste sintaxa {varianta1|varianta2|varianta3} :
- Deschidere : {${contact.firstName || contact.company},|${contact.firstName || contact.company} —|Salut ${contact.firstName || ''},}
- Tranzitii : {Deci|De altfel|De fapt|Concret}
- Intrebare finala : {E cazul?|E un subiect?|Ma insel?|Sau deloc?|Merita o discutie?}
IMPORTANT : foloseste 2-3 spintax pe email (nu mai mult), pe parti NEpersonalizate. Continutul personalizat ramane fix.` : `=== EXEMPLES 10/10 (TON HESITANT + COURT) ===
Exemple 1 (signal recrutement, 38 mots) :
"Thomas, 3 postes commerciaux ouverts chez [Agence]. Ca veut souvent dire que les nouveaux clients reposent encore sur toi.

On aide des boites comme la tienne a trouver des clients sans y penser. C'est le cas ou je me trompe ?"

Exemple 2 (signal news, 42 mots) :
"Sophie, [Cabinet] lance une offre data. Souvent, le fondateur porte seul la recherche des premiers clients sur un nouveau segment.

C'est peut-etre pas votre cas, mais vous avez un moyen structure ou c'est encore du reseau ?"

Exemple 3 (signal croissance, 35 mots) :
"Marc, 40 personnes chez [ESN] et 5 postes ouverts. L'equipe grandit mais les nouvelles missions suivent pas toujours.

C'est un sujet en ce moment ou pas du tout ?"

=== VARIATION STRUCTURELLE (SPINTAX) ===
Pour eviter que les emails se ressemblent structurellement, utilise la syntaxe {variante1|variante2|variante3} dans ton email :
- Accroche : {${contact.firstName || contact.company},|${contact.firstName || contact.company} —|Salut ${contact.firstName || ''},}
- Transitions : {Du coup|Concretement|En fait|D'ailleurs}
- Question finale : {C'est le cas chez vous ?|C'est un sujet en ce moment ?|Vous avez structure quelque chose ?|C'est prevu ou pas du tout ?|Je me trompe ?}
IMPORTANT : utilise 2-3 spintax par email (pas plus), sur des parties NON personnalisees. Le contenu personnalise (fait prospect, hypothese) reste fixe.`}

${abSubjectInstruction}
=== FORMAT ===
JSON valide uniquement, sans markdown, sans backticks.
{"subject":"${emailLanguage === 'ro' ? 'subiect 2-3 cuvinte litere mici' : 'objet 2-3 mots minuscules'}","body":"${emailLanguage === 'ro' ? 'corp FARA semnatura, 40-60 cuvinte, cu 2-3 spintax {var1|var2}' : 'corps SANS signature, 40-60 mots, avec 2-3 spintax {var1|var2}'}"}
OU {"skip": true, "reason": "explication"}`;

    let firstName = contact.firstName || (contact.name || '').split(' ')[0] || '';
    // Anti-hallucination prenom : nettoyer les prenoms invalides
    const invalidFirstNames = ['directeur', 'director', 'contact', 'info', 'admin', 'hello', 'commercial', 'support', 'manager', 'ceo', 'cto', 'cfo'];
    if (!firstName || invalidFirstNames.includes(firstName.toLowerCase()) || contact.email.startsWith('contact@') || contact.email.startsWith('info@') || contact.email.startsWith('hello@')) {
      firstName = '';
    }
    const userMessage = `Ecris un email pour ce prospect en suivant le framework Observation → Hypothese → Question.
${!firstName ? 'Le prenom est INCONNU. Utilise le nom de l\'entreprise.' : ''}
CONTACT : ${firstName || '[entreprise]'} ${contact.name ? '(' + contact.name + ')' : ''} — ${contact.title || '?'} chez ${contact.company || '?'}
${context ? '\nDONNEES :\n' + context : ''}
Skip UNIQUEMENT si tu n'as AUCUNE info exploitable.`;

    // Generation + auto-scoring + retry
    const result = await this._generateAndScore(contact, context, systemPrompt, userMessage);
    // Tag A/B variant for tracking
    if (result && !result.skip) {
      result._abVariant = abVariant;
      const log = require('../../gateway/logger.js');
      log.info('ab-test', 'Email genere variante ' + abVariant + ' pour ' + (contact.email || '?') + ' — objet: ' + (result.subject || '?'));
    }
    return result;
  }

  // Auto-scoring Lavender /100 : grade A (85+) = envoyer, B (75-84) = retry, C (<75) = skip
  async _generateAndScore(contact, context, systemPrompt, userMessage) {
    const log = require('../../gateway/logger.js');
    const maxAttempts = 2;
    let best = null;
    let bestScore = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let prompt = userMessage;
      if (attempt > 0 && best) {
        const d = best._scoreDetails || {};
        const weakPoints = [];
        if ((d.ton || 0) < 14) weakPoints.push('ton hesitant manquant ("je me trompe", "ou pas du tout ?")');
        if ((d.clarte || 0) < 12) weakPoints.push('phrases trop longues ou mots trop complexes');
        if ((d.perso || 0) < 10) weakPoints.push('pas assez personnalise (ajoute un fait specifique du prospect)');
        if ((d.mobile || 0) < 7) weakPoints.push('ajoute un double saut de ligne entre les paragraphes');
        if ((d.mots || 0) < 8) weakPoints.push('vise 35-50 mots');
        prompt = userMessage + '\n\nATTENTION: l\'email precedent a ete note ' + bestScore + '/100 (grade ' + (best._scoreGrade || '?') + '). Points faibles: ' + (weakPoints.join(', ') || best._scoreReason || 'qualite insuffisante') + '. Ecris un email MEILLEUR. Cible 90+/100.';
      }
      const response = await this.callClaude(
        [{ role: 'user', content: prompt }],
        systemPrompt,
        1500
      );
      const parsed = this._parseJSON(response);
      if (!parsed) return parsed;

      // Post-process automatique : supprimer tirets cadratins AVANT scoring
      if (parsed.body) {
        parsed.body = parsed.body.replace(/\u2014/g, ',').replace(/\u2013/g, ',');
      }

      // Si Claude skip au premier essai, retry UNE FOIS
      if (parsed.skip) {
        if (attempt === 0) {
          const retryPrompt = prompt + '\n\nATTENTION : tu as voulu skip mais tu as des donnees exploitables. REGLE : si tu as un nom d\'entreprise + un poste, tu DOIS ecrire un email. Un email 75/100 > un skip.';
          try {
            const retryResponse = await this.callClaude(
              [{ role: 'user', content: retryPrompt }],
              systemPrompt,
              1500
            );
            const retryParsed = this._parseJSON(retryResponse);
            if (retryParsed && !retryParsed.skip) {
              if (retryParsed.body) retryParsed.body = retryParsed.body.replace(/\u2014/g, ',').replace(/\u2013/g, ',');
              const retryLav = this._lavenderScore(retryParsed.subject, retryParsed.body, contact);
              log.info('scoring', retryLav.score + '/100 (grade ' + retryLav.grade + ') retry pour ' + (contact.email || '?') + ' — ton:' + (retryLav.details.ton||0) + ' clarte:' + (retryLav.details.clarte||0) + ' phrases:' + (retryLav.details.phrases||0) + ' perso:' + (retryLav.details.perso||0) + ' mots:' + (retryLav.details.mots||0) + ' mobile:' + (retryLav.details.mobile||0) + ' objet:' + (retryLav.details.objet||0));
              if (!retryLav.block && retryLav.score >= 85) { retryParsed._lavenderScore = retryLav.score; retryParsed._lavenderGrade = retryLav.grade; retryParsed._lavenderDetails = retryLav.details; return retryParsed; }
              if (retryLav.score > bestScore) {
                best = retryParsed;
                bestScore = retryLav.score;
                best._scoreReason = retryLav.reason;
                best._scoreDetails = retryLav.details;
                best._scoreGrade = retryLav.grade;
              }
              continue;
            }
          } catch (e) { /* retry echoue */ }
        }
        return parsed;
      }

      // === Scoring Lavender /100 ===
      const lav = this._lavenderScore(parsed.subject, parsed.body, contact);
      log.info('scoring', lav.score + '/100 (grade ' + lav.grade + ') pour ' + (contact.email || '?') + ' — ton:' + (lav.details.ton||0) + ' clarte:' + (lav.details.clarte||0) + ' phrases:' + (lav.details.phrases||0) + ' perso:' + (lav.details.perso||0) + ' mots:' + (lav.details.mots||0) + ' mobile:' + (lav.details.mobile||0) + ' objet:' + (lav.details.objet||0));

      if (lav.block) {
        if (0 > bestScore) { best = parsed; bestScore = 0; best._scoreReason = lav.reason; best._scoreDetails = {}; best._scoreGrade = 'F'; }
        continue;
      }

      // Grade A (85+) = envoyer direct
      if (lav.score >= 85) {
        parsed._lavenderScore = lav.score;
        parsed._lavenderGrade = lav.grade;
        parsed._lavenderDetails = lav.details;
        return parsed;
      }

      if (lav.score > bestScore) {
        best = parsed;
        bestScore = lav.score;
        best._scoreReason = lav.reason;
        best._scoreDetails = lav.details;
        best._scoreGrade = lav.grade;
      }
    }

    // Apres retries : Grade B (75+) = acceptable, Grade C (<75) = skip
    if (bestScore >= 75) {
      best._lavenderScore = bestScore;
      best._lavenderGrade = best._scoreGrade || 'B';
      best._lavenderDetails = best._scoreDetails || {};
      return best;
    }
    return { skip: true, reason: 'lavender_score_too_low:' + bestScore + '/100 (grade ' + (best && best._scoreGrade || '?') + ') — ' + (best && best._scoreReason || '?') };
  }

  // === SCORING LAVENDER /100 ===
  // Base sur les donnees Lavender (28.3M emails analyses) : impact reply rate par critere
  // Poids proportionnels a l'impact mesure : formality 2.11x > clarity 1.66x > sentences 1.57x > mobile +24% > words +23%
  // 100% programmatique, 0 API call, 0 cout, 0 latence
  _lavenderScore(subject, body, contact) {
    const lang = process.env.EMAIL_LANGUAGE || 'fr';
    const L = LANG_PATTERNS[lang] || LANG_PATTERNS.fr;

    const bodyLower = (body || '').toLowerCase();
    const subjectLower = (subject || '').toLowerCase();
    const words = (body || '').split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    const details = {};

    // === BLOCKS DIRECTS (score 0, skip immediat) ===
    for (const cta of L.deadCTAs) {
      if (bodyLower.includes(cta)) return { block: true, score: 0, grade: 'F', reason: 'dead_cta:' + cta, details: {} };
    }

    if (L.metaP.some(m => bodyLower.includes(m))) return { block: true, score: 0, grade: 'F', reason: 'meta_prospection', details: {} };

    if (L.fakeCaseStudy.test(body || '')) return { block: true, score: 0, grade: 'F', reason: 'fake_case_study', details: {} };

    const jargonWords = ['\\bpipe\\b', '\\bpipeline\\b', '\\boutbound\\b', '\\binbound\\b', '\\bscale\\b', '\\bscaler\\b',
      '\\bleads?\\b', '\\bfunnel\\b', '\\bchurn\\b', '\\bgrowth\\b', '\\bonboarding\\b', '\\bdeal flow\\b', '\\bcrm\\b'];
    const jargonFound = jargonWords.filter(j => new RegExp(j, 'i').test(body || ''));
    if (jargonFound.length >= 2) return { block: true, score: 0, grade: 'F', reason: 'jargon_anglais:' + jargonFound.join('+'), details: {} };

    const emDashCount = (body || '').split(/\u2014|\u2013/).length - 1;
    if (emDashCount >= 2) return { block: true, score: 0, grade: 'F', reason: 'em_dash_overuse:' + emDashCount, details: {} };

    if (wordCount < 15) return { block: true, score: 0, grade: 'F', reason: 'too_short:' + wordCount, details: {} };
    // OPTIM 2 : hard block abaissé de 100 à 80 mots (benchmark: <80 mots = sweet spot cold email)
    if (wordCount > 80) return { block: true, score: 0, grade: 'F', reason: 'too_long:' + wordCount, details: {} };

    // === 1. TON / FORMALITE — /20 (impact 2.11x replies) ===
    let ton = 0;
    // Ton hesitant (+35% replies) — le critere le plus impactant
    const hesitantCount = L.hesitant.filter(m => bodyLower.includes(m)).length;
    if (hesitantCount >= 2) ton += 9;
    else if (hesitantCount === 1) ton += 6;

    // Casual / contractions / fragments (Lavender : "slightly casual" = 2.11x)
    const casualCount = L.casual.filter(m => bodyLower.includes(m)).length;
    if (casualCount >= 3) ton += 5;
    else if (casualCount >= 1) ton += 3;

    // Ratio Je/Tu (parler du prospect 1.5x+ plus que de soi)
    const jeCount = (bodyLower.match(L.jePatterns) || []).length + (bodyLower.match(L.nousPatterns) || []).length;
    const tuCount = (bodyLower.match(L.tuPatterns) || []).length + (bodyLower.match(L.vousPatterns) || []).length;
    if (tuCount > jeCount * 1.5) ton += 7;  // prospect mentionné 1.5x+ plus que soi
    else if (tuCount > jeCount) ton += 4;   // prospect plus que soi
    else ton = Math.max(0, ton - 3);        // trop de je/nous = pénalité

    // Em-dash residuel (1 seul = malus leger)
    if (emDashCount === 1) ton = Math.max(0, ton - 3);
    // Jargon residuel (1 seul = malus)
    if (jargonFound.length === 1) ton = Math.max(0, ton - 3);

    // Voix passive / conditionnels (Lavender penalise)
    const passiveConditional = (bodyLower.match(L.passiveConditional) || []).length;
    if (passiveConditional >= 2) ton = Math.max(0, ton - 3);

    ton = Math.min(20, ton);
    details.ton = ton;

    // === 2. CLARTE / LISIBILITE — /18 (impact 1.66x replies, 3rd-5th grade) ===
    let clarte = 0;
    const sentences = (body || '').split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgSentenceLen = sentences.length > 0 ? wordCount / sentences.length : wordCount;
    if (avgSentenceLen <= 10) clarte += 8;
    else if (avgSentenceLen <= 14) clarte += 6;
    else if (avgSentenceLen <= 18) clarte += 3;

    // Mots courts (< 3 syllabes) — approximation par longueur de mot
    const shortWords = words.filter(w => w.length <= 6).length;
    const shortRatio = wordCount > 0 ? shortWords / wordCount : 0;
    if (shortRatio >= 0.8) clarte += 6;
    else if (shortRatio >= 0.65) clarte += 4;
    else if (shortRatio >= 0.5) clarte += 2;

    // Pas de mots complexes
    const complexFound = L.complexWords.filter(w => bodyLower.includes(w)).length;
    if (complexFound === 0) clarte += 4;
    else if (complexFound === 1) clarte += 2;

    clarte = Math.min(18, clarte);
    details.clarte = clarte;

    // === 3. PHRASES LONGUES — /15 (impact 1.57x replies, cible 0 phrase longue) ===
    let phrases = 0;
    const longSentences = sentences.filter(s => s.trim().split(/\s+/).length > 18).length;
    if (longSentences === 0) phrases = 15;
    else if (longSentences === 1) phrases = 8;
    else if (longSentences === 2) phrases = 3;
    details.phrases = phrases;

    // === 4. PERSONNALISATION — /15 ===
    let perso = 0;
    const fn = ((contact.firstName || contact.name || '').split(' ')[0] || '').toLowerCase();
    const co = (contact.company || '').toLowerCase();
    if (fn && fn.length > 2 && bodyLower.includes(fn)) perso += 4;
    if (co && co.length > 2 && bodyLower.includes(co.substring(0, Math.min(co.length, 15)).toLowerCase())) perso += 4;
    // Fait specifique (hypothese business = personnalisation profonde)
    const hasHypothesis = L.hypothesis.some(m => bodyLower.includes(m));
    if (hasHypothesis) perso += 7;
    else {
      const hasNumbers = L.numbersPattern.test(body || '');
      if (hasNumbers) perso += 4;
    }
    perso = Math.min(20, perso);
    details.perso = perso;

    // === 5. WORD COUNT — /12 (OPTIM 2 : sweet spot resserré 25-50, hard block 80) ===
    let mots = 0;
    if (wordCount >= 25 && wordCount <= 50) mots = 12;
    else if (wordCount >= 20 && wordCount <= 60) mots = 8;
    else if (wordCount >= 15 && wordCount <= 70) mots = 4;
    // >70 mots = 0 points (pénalité naturelle avant le hard block à 80)
    details.mots = mots;

    // === 6. MOBILE OPTIMIZED — /10 (impact +24% replies) ===
    let mobile = 0;
    // Double saut de ligne (espacement entre paragraphes)
    const hasDoubleNewline = (body || '').includes('\n\n');
    if (hasDoubleNewline) mobile += 5;
    else if (wordCount <= 40) mobile += 3; // si tres court, pas besoin de double saut
    // Aucun paragraphe > 4 lignes (sur mobile ~6-8 mots/ligne)
    const paragraphs = (body || '').split(/\n\n+/).filter(p => p.trim().length > 0);
    const longParagraphs = paragraphs.filter(p => p.trim().split(/\s+/).length > 30).length;
    if (longParagraphs === 0) mobile += 5;
    else if (longParagraphs === 1) mobile += 2;
    details.mobile = mobile;

    // === 7. OBJET — /10 ===
    let objet = 0;
    if (subject) {
      const subjectWords = subject.split(/\s+/).filter(w => w.length > 0).length;
      // 2-4 mots
      if (subjectWords >= 2 && subjectWords <= 4) objet += 4;
      else if (subjectWords === 1 || subjectWords === 5) objet += 2;
      // Minuscules (pas de majuscule sauf premiere lettre du prenom)
      const hasUpperCase = /[A-Z]/.test(subject.substring(1));
      const isJustName = fn && subject.toLowerCase() === fn;
      if (!hasUpperCase || isJustName) objet += 3;
      else objet += 1;
      // Pas de ponctuation (! ? : ...)
      if (!/[!?:;]/.test(subject)) objet += 3;
      else objet += 1;
    }
    // Bonus : objet contient prenom ou entreprise
    if (fn && fn.length > 2 && subjectLower.includes(fn)) objet = Math.min(10, objet + 1);
    objet = Math.min(10, objet);
    details.objet = objet;

    // === SCORE FINAL ===
    const score = ton + clarte + phrases + perso + mots + mobile + objet;

    // Question ouverte en fin d'email (CTC) — pas dans le score mais verification
    const endsWithQuestion = (body || '').trim().endsWith('?');
    const hasCTA = L.valueCTAs.some(m => bodyLower.includes(m)) || endsWithQuestion;
    if (!hasCTA) {
      // Pas de question = email mort, malus fort
      details._noCTA = true;
      return { block: false, score: Math.max(0, score - 20), grade: score - 20 >= 75 ? 'B' : 'C', reason: 'no_question_ending', details };
    }

    // Grade
    let grade = 'C';
    if (score >= 85) grade = 'A';
    else if (score >= 75) grade = 'B';

    return { block: false, score, grade, reason: 'ok', details };
  }

  async _scoreEmail(subject, body, contact) {
    const wordCount = (body || '').split(/\s+/).filter(w => w.length > 0).length;
    const prompt = `Note cet email de prospection B2B de 1 a 10. Framework : Observation → Hypothese → Question + Methode Lavender.

CRITERES 10/10 :
- 40-60 mots (zone optimale Lavender). <50 = ideal.
- Ton HESITANT : "peut-etre", "je me trompe", "ou pas du tout ?" (+35% reply rate)
- OBSERVATION : un fait SPECIFIQUE du prospect (chiffre, news, recrutement, projet)
- HYPOTHESE : le fait est TRANSFORME en probleme business ("ca veut dire que...")
- QUESTION OUVERTE (CTC) : invite a la reflexion, pas au calendrier
- Ratio Je/Tu : parle du prospect plus que de soi
- Niveau CM1 : phrases courtes, mots simples
- Objet : 2-3 mots, minuscules, comme un email entre collegues
- PAS de case study invente, pitch, tirets cadratins, "Bonjour", meta-prospection

PENALITES :
- Case study invente ("4 clients en 3 mois") : -4
- Information dumping (faits sans insight) : -3
- Generique (remplacable par n'importe quelle entreprise) : -4
- > 60 mots : -2, > 80 mots : -4
- Ton affirmatif (0 hesitation) : -1
- Trop de "je/nous/on" vs "tu/vous" : -2
- Tirets cadratins : -2
- Meta-prospection : -4

EMAIL :
Objet: ${subject}
Corps: ${body}
(${wordCount} mots)
Prospect: ${contact.name || '?'} / ${contact.company || '?'}

CALIBRAGE :
- "[prenom], j'ai vu que [entreprise] fait [activite]. Un client similaire a signe 4 clients. C'est un sujet ?" → 3/10 (info dump + case study invente + 0 hesitation)
- "[prenom], [fait specifique]. Ca veut souvent dire [hypothese]. C'est le cas ou je me trompe ?" → 9/10 (signal + insight + hesitant + court)

Reponds UNIQUEMENT en JSON : {"note":X,"reason":"explication en 10 mots max"}`;

    try {
      const response = await this.callOpenAIMini(
        'Tu es un evaluateur IMPITOYABLE de cold emails B2B. La moyenne de tes notes doit etre 5-6/10. Un 8+ est exceptionnel. Sois dur.',
        prompt,
        100
      );
      const parsed = this._parseJSON(response);
      if (parsed && typeof parsed.note === 'number') {
        return { note: Math.min(10, Math.max(1, Math.round(parsed.note))), reason: parsed.reason || '' };
      }
    } catch (e) {
      console.warn('[email-writer] Scoring OpenAI echoue: ' + e.message + ' - fallback score 7');
    }
    return { note: 5, reason: 'scoring_unavailable' };
  }

  // Score adapte pour les follow-ups (criteres differents du step 1)
  async _scoreFollowUpEmail(subject, body, contact) {
    const wordCount = (body || '').split(/\s+/).filter(w => w.length > 0).length;
    const prompt = `Note cette RELANCE de prospection B2B de 1 a 10. C'est un FOLLOW-UP, pas un premier email.

CRITERES 10/10 POUR UN FOLLOW-UP :
- 15-35 mots (ultra-court, comme un SMS entre pros)
- 1-2 phrases MAX. Pas de structure en blocs.
- Un nouvel angle ou insight (pas une reformulation)
- Ton naturel, entre pairs, pas de pitch
- PAS de tirets cadratins
- PAS de "je reviens vers toi", "suite a mon email"

PENALITES :
- Reformulation du premier email : -4 points
- "Curieux d'avoir ton retour" ou CTA sans valeur : -4 points
- Meta-prospection ("comment tu prospectes") : -4 points
- Trop long (>40 mots) : -3 points (les meilleurs follow-ups font 15-25 mots)
- Structure en 3+ blocs (un FU est un bump, pas un mini-email) : -3 points
- Trop court (<10 mots sans substance) : -2 points
- Tirets cadratins : -1 point par tiret
- Template generique (remplacable par n'importe quelle entreprise) : -3 points

BONUS :
- Social proof avec chiffre concret : +1
- CTA avec lien calendrier : +1
- Reference specifique au prospect : +1

FOLLOW-UP :
Objet: ${subject}
Corps: ${body}
(${wordCount} mots)
Prospect: ${contact.name || '?'} / ${contact.company || '?'}

CALIBRAGE :
- "Re-[prenom], tu as eu le temps de regarder ?" → 2/10 (vide, pas de valeur)
- "[prenom], un autre client [niche] vient de signer. Dispo 15 min ?" → 7/10 (nouvel angle + SP + CTA)
- "[prenom], [fait nouveau]. [SP chiffre]. Lien calendar." → 9/10 (tout est la)

IMPORTANT : la majorite des follow-ups doivent etre notes 5-6. Un 8+ est rare.

Reponds UNIQUEMENT en JSON : {"note":X,"reason":"explication en 10 mots max"}`;

    try {
      const response = await this.callOpenAIMini(
        'Tu es un evaluateur IMPITOYABLE de follow-ups B2B. Moyenne attendue : 5-6/10. Un 8+ est exceptionnel.',
        prompt,
        100
      );
      const parsed = this._parseJSON(response);
      if (parsed && typeof parsed.note === 'number') {
        return { note: Math.min(10, Math.max(1, Math.round(parsed.note))), reason: parsed.reason || '' };
      }
    } catch (e) {
      console.warn('[email-writer] Follow-up scoring echoue: ' + e.message + ' - fallback 5');
    }
    return { note: 5, reason: 'fu_scoring_unavailable' };
  }

  // Score leger pour les follow-ups/relances (Lavender /100, seuil 65 pour FU)
  async _scoreAndFilter(parsed, contact) {
    if (!parsed || parsed.skip) return parsed;
    try {
      const wordCount = (parsed.body || '').split(/\s+/).filter(w => w.length > 0).length;
      if (wordCount > 50) {
        return { skip: true, reason: 'too_many_words:' + wordCount + ' (max 50 for follow-ups)' };
      }
      // Block tirets cadratins dans les follow-ups aussi
      const emDashCount = (parsed.body || '').split(/\u2014|\u2013/).length - 1;
      if (emDashCount >= 2) {
        return { skip: true, reason: 'em_dash_overuse:' + emDashCount };
      }
      const lav = this._lavenderScore(parsed.subject || '', parsed.body, contact);
      if (lav.block) return { skip: true, reason: 'lavender_block:' + lav.reason };
      // Seuil plus bas pour les follow-ups (65 vs 75 pour les premiers emails)
      if (lav.score >= 65) { parsed._lavenderScore = lav.score; parsed._lavenderGrade = lav.grade; return parsed; }
      return { skip: true, reason: 'lavender_score_too_low:' + lav.score + '/100 (grade ' + lav.grade + ')' };
    } catch (e) {
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
      ? `- Relance ${totalEmails} (J+21) : BREAKUP + LIEN AGENDA, 3 lignes max

Le breakup exploite la loss aversion. Il DOIT se terminer par ce lien EXACT sur sa propre ligne :
${breakupBookingUrl}

Exemple breakup :
"${contactFirstName}, pas le bon moment ? Pas de souci.

Si le sujet revient un jour, 15 min ici :
${breakupBookingUrl}"

Le lien doit etre COPIE TEL QUEL dans le body JSON.`
      : `- Relance ${totalEmails} (J+21) : BREAKUP, 2 lignes max, choix binaire ("pas le bon moment ? dis-le moi, je ne relancerai plus")

Le breakup exploite la loss aversion. Format strict : 2 phrases max, question fermee.`;

    const meetingCTARule = breakupBookingUrl
      ? '- JAMAIS : prix, offre, feature, pitch, CTA de meeting (EXCEPTION : le breakup inclut le lien agenda fourni)'
      : '- JAMAIS : prix, offre, feature, pitch, CTA de meeting';

    const senderName = process.env.SENDER_NAME || 'Alexis';
    const senderTitle = process.env.SENDER_TITLE || 'fondateur';
    const clientName = process.env.CLIENT_NAME || 'iFIND';

    // --- ICP : charger le contexte niche pour les follow-ups ---
    let icpLoaderFU = null;
    try { icpLoaderFU = require('../../gateway/icp-loader.js'); } catch (e) {
      try { icpLoaderFU = require('/app/gateway/icp-loader.js'); } catch (e2) {}
    }
    const clientDescFU = (icpLoaderFU && icpLoaderFU.getClientDescription()) || process.env.CLIENT_DESCRIPTION || '';
    let nicheFU = null;
    if (icpLoaderFU) {
      nicheFU = icpLoaderFU.matchLeadToNiche(contact);
    }

    let nicheFollowUpBlock = '';
    if (nicheFU || clientDescFU) {
      nicheFollowUpBlock = '\n=== CONTEXTE ===\n';
      if (clientDescFU) nicheFollowUpBlock += clientName + ' : ' + clientDescFU + '\n';
      if (nicheFU) {
        if (nicheFU.painPoint) nicheFollowUpBlock += 'PROBLEME DE CETTE NICHE : ' + nicheFU.painPoint + '\n';
        if (nicheFU.socialProof) nicheFollowUpBlock += 'SOCIAL PROOF : ' + nicheFU.socialProof + '\n';
      }
    }

    const systemPrompt = `Tu es ${senderName}, ${senderTitle} de ${clientName}. Tu generes ${totalEmails} relances pour un prospect qui n'a pas repondu a ton premier email.
${nicheFollowUpBlock}
PHILOSOPHIE : Chaque relance a une MISSION DIFFERENTE. On avance vers le RDV.

=== INTERDIT ABSOLU ===
- JAMAIS de tiret cadratin ni de tiret long. Virgules, points, retours a la ligne uniquement.
- JAMAIS "curieux d'avoir ton retour" ou question sans value prop.

=== MISSION DE CHAQUE STEP ===

PHILOSOPHIE FOLLOW-UP : chaque relance = 1-2 phrases MAX. Comme un SMS entre pros. ZERO structure en blocs.

STEP 1, RELANCE 1 (J+4) : BUMP NATUREL
1-2 phrases. Nouvel angle OU fait concret + question business.
PAS de social proof. PAS de pitch. Juste une relance naturelle.
Exemple : "[Prenom], j'ai vu que [fait nouveau]. [Question business courte] ?"
15-30 mots MAX.

STEP 2, RELANCE 2 (J+8) : PREUVE RAPIDE
1-2 phrases. Un mini cas client + CTA direct.
Exemple : "Un [type similaire] a [resultat]. Dispo 15 min si ca te parle."
15-30 mots MAX.
${breakupInstruction}

INTERDITS ABSOLUS (TEMPLATES GENERIQUES) :
- "[Industrie] vit de recommandations et de reseaux"
- "Comment [Company] genere de nouvelles opportunites"
- "Ces canaux ont un plafond" / "carnet de contacts sature"
- "Curieux d'avoir ton retour"
- Toute phrase ou seul le nom de l'industrie/entreprise change
- Structure en 3-4 blocs (fait/pont/SP/CTA) — les FU sont des BUMPS pas des mini-emails

REGLES :
- 15-30 mots par relance (JAMAIS plus de 35). Le breakup = 2 lignes MAX.
- Vouvoiement par defaut
- JAMAIS : "je me permets", "suite a", "beau move", "potentiellement"
${meetingCTARule}
- JAMAIS : "prospection", "gen de leads", "acquisition de clients" dans l'email
- Sujet : 3-5 mots, minuscules, intriguant, contient nom/entreprise
- PAS de signature (ajoutee automatiquement)
- ANNEE EN COURS : 2026. Ne cite JAMAIS "en 2024" ou "en 2023".
- COHERENCE : le social proof de chaque relance doit etre du MEME SECTEUR que le prospect. Chiffres realistes (4-8 contacts, 3-5 clients, jamais miraculeux).
- CHAQUE relance doit etre coherente avec les precedentes (meme univers, nouvel argument).${forbiddenWordsRule}${anglesRule}

JSON valide uniquement : [{"subject":"...","body":"..."},...]`;

    let seqFirstName = contact.firstName || (contact.name || '').split(' ')[0] || '';
    const seqInvalidNames = ['directeur', 'director', 'contact', 'info', 'admin', 'hello', 'commercial', 'support', 'manager', 'ceo', 'cto', 'cfo'];
    if (!seqFirstName || seqInvalidNames.includes(seqFirstName.toLowerCase()) || contact.email.startsWith('contact@') || contact.email.startsWith('info@') || contact.email.startsWith('hello@')) {
      seqFirstName = '';
    }
    const userMessage = `Genere une sequence de ${totalEmails} emails pour :

Nom : ${contact.name || ''}
Prenom : ${seqFirstName || 'INCONNU (utiliser le nom d\'entreprise)'}
Poste : ${contact.title || 'non precise'}
Entreprise : ${contact.company || 'non precisee'}
Email : ${contact.email}
${!seqFirstName ? '\nATTENTION : le prenom du prospect est INCONNU. NE PAS inventer un prenom. Utilise le nom de l\'entreprise.' : ''}
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

      if (emails.length < totalEmails) {
        console.warn('[email-writer] Claude a genere ' + emails.length + '/' + totalEmails + ' emails, padding');
        while (emails.length < totalEmails) {
          const firstName = contact.firstName || (contact.name || '').split(' ')[0] || '';
          emails.push({
            subject: 're: ' + (emails[0] && emails[0].subject || contact.company || ''),
            body: firstName + ', je reviens vers toi sur mon dernier message.\n\nDispo pour en parler 15 min cette semaine ?'
          });
        }
      }
      // Post-processing : garantir que le lien booking est dans step 2 (CTA direct) ET breakup
      if (breakupBookingUrl && emails.length > 0) {
        const bookingDomain = breakupBookingUrl.split('?')[0];
        if (emails.length >= 2 && emails[1].body && !emails[1].body.includes(bookingDomain)) {
          emails[1].body = emails[1].body.trimEnd() + '\n\n' + breakupBookingUrl;
        }
        const last = emails[emails.length - 1];
        if (last.body && !last.body.includes(bookingDomain)) {
          last.body = last.body.trimEnd() + '\n\n' + breakupBookingUrl;
        }
      }

      // Post-processing : supprimer les tirets cadratins de tous les emails
      for (const email of emails) {
        if (email.body) email.body = email.body.replace(/\u2014/g, ',').replace(/\u2013/g, ',');
        if (email.subject) email.subject = email.subject.replace(/\u2014/g, ' ').replace(/\u2013/g, ' ');
      }

      return emails;
    } catch (e) {
      return [this._parseJSON(response)];
    }
  }

  async generateReactiveFollowUp(contact, originalEmail, prospectIntel) {
    let emailLengthHint = '50-80 mots (vise 65, JAMAIS plus de 80)';
    try {
      const selfImproveStorage = require('../self-improve/storage.js');
      const prefs = selfImproveStorage.getEmailPreferences();
      if (prefs && prefs.maxLength) {
        if (prefs.maxLength === 'short') emailLengthHint = '30-50 mots max (JAMAIS plus de 50)';
        else if (prefs.maxLength === 'long') emailLengthHint = '40-60 mots max';
      }
    } catch (e) {
      try {
        const selfImproveStorage = require('/app/skills/self-improve/storage.js');
        const prefs = selfImproveStorage.getEmailPreferences();
        if (prefs && prefs.maxLength) {
          if (prefs.maxLength === 'short') emailLengthHint = '30-50 mots max (JAMAIS plus de 50)';
          else if (prefs.maxLength === 'long') emailLengthHint = '40-60 mots max';
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
- JAMAIS mentionner que tu sais qu'il a ouvert l'email
- JAMAIS "suite a mon email", "je reviens vers vous", "je me permets de relancer"

INTERDIT ABSOLU :
- JAMAIS de tiret cadratin ni de tiret long. Virgules, points, retours a la ligne.
- JAMAIS "curieux d'avoir ton retour" ou question sans value prop.

STRATEGIE :
NOUVEL ANGLE tire des DONNEES PROSPECT. Pas une reformulation du premier email.
L'email DOIT contenir : (1) un fait specifique, (2) un social proof ou une preuve, (3) un CTA valeur.

FORMAT (${emailLengthHint}) :
1. FAIT DIFFERENT du premier email + implication
2. SOCIAL PROOF ou preuve ("on fait ca pour des [type]")
3. CTA VALEUR ("dispo pour en parler", "je te montre en 15 min")

INTERDITS ABSOLUS :
- "[Industrie] vit de recommandations et de reseaux"
- "Comment [Company] genere de nouvelles opportunites"
- "Ces canaux ont un plafond" / "carnet de contacts sature"

REGLES :
- ${emailLengthHint}. Ecris comme tu parles. Vouvoiement par defaut.
- JAMAIS : pitch, prix, offre, "beau move", "potentiellement"
- JAMAIS : "prospection", "gen de leads", "acquisition de clients"
- Sujet : 3-5 mots, minuscules, intriguant, contient nom/entreprise, DIFFERENT du premier
- PAS de "re:", pas de "relance", pas de signature (ajoutee automatiquement)${forbiddenWordsRule}

JSON uniquement : {"subject":"...","body":"..."}`;

    const userMessage = `PREMIER EMAIL ENVOYE :
Objet : ${originalEmail.subject || '(sans objet)'}
Corps : ${(originalEmail.body || '').substring(0, 1000)}

DONNEES PROSPECT (pour trouver un nouvel angle) :
${prospectIntel || 'Aucune donnee supplementaire'}

CONTACT :
- Nom : ${contact.name || ''}
- Prenom : ${contact.firstName || (contact.name || '').split(' ')[0]}
- Poste : ${contact.title || 'non precise'}
- Entreprise : ${contact.company || 'non precisee'}
- Email : ${contact.email}

Ecris une relance avec un NOUVEL ANGLE different du premier email. OBLIGATOIRE : social proof + CTA valeur.`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      1500
    );
    let parsed = this._parseJSON(response);
    // Post-process : supprimer tirets cadratins
    if (parsed && parsed.body) parsed.body = parsed.body.replace(/\u2014/g, ',').replace(/\u2013/g, ',');
    if (parsed && parsed.subject) parsed.subject = parsed.subject.replace(/\u2014/g, ' ').replace(/\u2013/g, ' ');
    return this._scoreAndFilter(parsed, contact);
  }

  async generatePersonalizedFollowUp(contact, stepNumber, totalSteps, prospectIntel, previousEmails, campaignContext) {
    let emailLengthHint = '40-65 mots (vise 50, JAMAIS plus de 65)';
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
      if (siPrefsfu.maxLength === 'short') emailLengthHint = '25-40 mots max (ultra-court)';
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

    // --- ICP : charger le contexte niche pour social proofs varies ---
    let icpLoaderFU = null;
    try { icpLoaderFU = require('../../gateway/icp-loader.js'); } catch (e) {
      try { icpLoaderFU = require('/app/gateway/icp-loader.js'); } catch (e2) {}
    }
    let nicheFU = null;
    if (icpLoaderFU) nicheFU = icpLoaderFU.matchLeadToNiche(contact);
    const clientDescFU = (icpLoaderFU && icpLoaderFU.getClientDescription()) || process.env.CLIENT_DESCRIPTION || '';

    // Selectionner un social proof DIFFERENT de ceux deja utilises
    let socialProofInstruction = '';
    if (nicheFU) {
      const allProofs = nicheFU.socialProofs || [nicheFU.socialProof];
      // Extraire les social proofs deja utilises dans les emails precedents
      const usedProofsText = (previousEmails || []).map(e => (e.body || '').toLowerCase()).join(' ');
      const availableProofs = allProofs.filter(sp => {
        // Un proof est "utilise" si ses 6 premiers mots sont dans un email precedent
        const words = sp.split(/\s+/).slice(0, 6).join(' ').toLowerCase();
        return !usedProofsText.includes(words);
      });
      const selectedProof = availableProofs.length > 0
        ? availableProofs[Math.floor(Math.random() * availableProofs.length)]
        : allProofs[Math.floor(Math.random() * allProofs.length)];
      socialProofInstruction = '\n\n=== SOCIAL PROOF A UTILISER (adapte la formulation, ne copie pas mot pour mot) ===\n"' + selectedProof + '"';
      if (nicheFU.painPoint) socialProofInstruction += '\nPROBLEME DE CETTE NICHE : ' + nicheFU.painPoint;
      if (clientDescFU) socialProofInstruction += '\n' + (process.env.CLIENT_NAME || 'iFIND') + ' : ' + clientDescFU;
    }

    // Construire l'historique des emails precedents (anti-repetition)
    let previousEmailsContext = '';
    if (previousEmails && previousEmails.length > 0) {
      previousEmailsContext = '\n\n=== EMAILS PRECEDENTS ENVOYES (NE PAS REPETER — ni l\'angle, ni le social proof, ni la structure) ===';
      for (const prev of previousEmails) {
        previousEmailsContext += '\n--- Email ' + prev.stepNumber + ' ---';
        previousEmailsContext += '\nObjet: ' + (prev.subject || '');
        previousEmailsContext += '\nCorps: ' + (prev.body || '').substring(0, 1000);
      }
      previousEmailsContext += '\n=== FIN EMAILS PRECEDENTS ===';
      previousEmailsContext += '\nTu DOIS utiliser un angle ET un social proof COMPLETEMENT DIFFERENTS de tous les emails ci-dessus.';
    }

    // Injecter les winning patterns (emails qui ont recu des reponses) — meme logique que step 1
    let winningPatternsBlockFU = '';
    try {
      const amStorageWin = require('./storage.js');
      if (amStorageWin && amStorageWin.data && amStorageWin.data.emails) {
        const repliedEmails = amStorageWin.data.emails
          .filter(function(e) { return (e.status === 'replied' || e.hasReplied) && e.body; })
          .slice(-5);
        if (repliedEmails.length >= 2) {
          winningPatternsBlockFU = '\n\n=== EMAILS GAGNANTS (ont recu des reponses — reproduis le STYLE et le PATTERN, pas le contenu) ===\n';
          for (const re of repliedEmails) {
            winningPatternsBlockFU += '- [Step ' + (re.stepNumber || '?') + '] Objet: ' + (re.subject || '') + ' | Corps: ' + (re.body || '').substring(0, 200) + '\n';
          }
          winningPatternsBlockFU += 'PATTERN COMMUN : fait concret + social proof court + question business = reponse.\n';
        }
      }
    } catch (winErr) { /* non bloquant */ }

    // Construire le lien booking pour step 3 (CTA direct)
    let bookingUrlBlock = '';
    const googleBookingUrl = process.env.GOOGLE_BOOKING_URL || '';
    if (googleBookingUrl && stepNumber === 3) {
      try {
        const bpUrl = new URL(googleBookingUrl);
        if (contact.email) bpUrl.searchParams.set('email', contact.email);
        const firstName = contact.firstName || (contact.name || '').split(' ')[0] || '';
        if (firstName) bpUrl.searchParams.set('name', firstName);
        bookingUrlBlock = '\nLIEN CALENDRIER (a inclure en fin d\'email sur sa propre ligne) : ' + bpUrl.toString();
      } catch (e) {
        bookingUrlBlock = '\nLIEN CALENDRIER : ' + googleBookingUrl;
      }
    }

    // Strategie specifique par step — framework Lavender adapte aux follow-ups
    const isBreakup = stepNumber >= totalSteps;
    let stepStrategy = '';
    let stepExample = '';
    if (stepNumber === 2) {
      stepStrategy = `RELANCE 1 (J+4) — REBOND LEGER + NOUVEL ANGLE
Mission : rebondir avec un angle DIFFERENT du step 1. Ton hesitant, 25-40 mots MAX.
Structure : 1 phrase de rebond (nouveau fait ou nouvel angle) + 1 question ouverte differente.
PAS de social proof invente. Si tu n'as pas de cas reel, n'en mets pas.`;
      stepExample = `EXEMPLE RELANCE 1 :
"Thomas, je repensais a tes recrutements chez [Agence]. Souvent les premiers mois c'est le fondateur qui forme et qui vend en meme temps.

C'est le cas ou vous avez deja quelqu'un dessus ?"`;
    } else if (stepNumber === 3) {
      stepStrategy = `RELANCE 2 (J+8) — ULTRA-COURT + QUESTION SIMPLE
Mission : dernier essai avant breakup. Ultra-court, 15-25 mots MAX. Question fermee ou presque.
Structure : 1 phrase qui rebondit + 1 question simple (oui/non).${bookingUrlBlock}`;
      stepExample = `EXEMPLE RELANCE 2 :
"Thomas, toujours d'actualite les recrutements ?

Si c'est le bon moment je te montre comment on fait, sinon pas de souci."`;
    } else if (isBreakup) {
      stepStrategy = `BREAKUP (derniere relance) — 2 LIGNES MAXIMUM, 10-20 mots
Mission : loss aversion. Question fermee. C'est la derniere, sois humain.
Structure : 1 question ("pas le bon moment ?") + 1 phrase de cloture.`;
      stepExample = `EXEMPLE BREAKUP :
"Thomas, je ne relancerai plus. Si le sujet revient un jour, je suis la."`;
      // Ajouter le lien booking au breakup aussi
      if (googleBookingUrl && !bookingUrlBlock) {
        try {
          const bpUrl = new URL(googleBookingUrl);
          if (contact.email) bpUrl.searchParams.set('email', contact.email);
          const fn = contact.firstName || (contact.name || '').split(' ')[0] || '';
          if (fn) bpUrl.searchParams.set('name', fn);
          bookingUrlBlock = '\nLIEN CALENDRIER (a inclure dans le breakup) : ' + bpUrl.toString();
        } catch (e) {
          bookingUrlBlock = '\nLIEN CALENDRIER : ' + googleBookingUrl;
        }
      }
    } else {
      stepStrategy = `RELANCE ${stepNumber - 1} — NOUVEL ANGLE COURT
Mission : un angle different tire des DONNEES PROSPECT. 25-40 mots. Ton hesitant + question ouverte.`;
      stepExample = '';
    }

    const senderName = process.env.SENDER_NAME || 'Alexis';
    const senderTitle = process.env.SENDER_TITLE || 'fondateur';
    const clientName = process.env.CLIENT_NAME || 'iFIND';
    const fuEmailLanguage = process.env.EMAIL_LANGUAGE || 'fr';

    let fuLanguageBlock = '';
    if (fuEmailLanguage === 'ro') {
      fuLanguageBlock = `LIMBA: SCRIE IN ROMANA. Ton: tutuit, relaxat dar profesional.\n${clientDescFU ? 'CE FACE ' + clientName.toUpperCase() + ': ' + clientDescFU + '\n' : ''}`;
    } else if (fuEmailLanguage !== 'fr') {
      fuLanguageBlock = `LANGUAGE: Write in ${fuEmailLanguage}.\n`;
    }

    // Blocs Lavender et interdits adaptes a la langue
    let lavenderBlockFU, interditsBlockFU, spintaxBlockFU;
    if (fuEmailLanguage === 'ro') {
      lavenderBlockFU = `=== METODA LAVENDER (OBLIGATORIU — chiar si pentru follow-upuri) ===
1. ${isBreakup ? '10-20 CUVINTE' : stepNumber === 3 ? '15-25 CUVINTE' : '25-40 CUVINTE'} MAX. Mai scurt decat emailul initial. Fiecare cuvant trebuie sa merite locul.
2. NIVEL SIMPLU : propozitii scurte, cuvinte simple. Fara jargon englezesc (pipe, outbound, scale, lead, funnel).
3. TON EZITANT : "poate ma insel", "poate nu e cazul", "sau deloc?". Chiar si la follow-upuri.
4. INTREBARE DESCHISA la finalul emailului. Nu "ai 15 min?".
5. SUBIECT : 2-3 cuvinte, litere mici, contine prenume sau companie. DIFERIT de cele anterioare.
6. RAPORT EU/TU : vorbeste despre prospect mai mult decat despre tine.`;
      interditsBlockFU = `=== INTERZIS ===
- FARA linie lunga (em dash). FARA "Buna ziua" formal. FARA semnatura.
- FARA social proof inventat. FARA "un client similar a facut X in Y luni".
- FARA "referitor la emailul meu", "revin catre tine", "imi permit sa revin".
- FARA meta-prospectare, pitch, preturi, bullet points.
- FARA fraze goale : "impresionant", "potential", "frumos".
- FARA jargon : pipe, pipeline, outbound, lead, funnel, scale, growth, CRM.
- DIFERIT de emailul/emailurile anterioare (unghi nou, intrebare noua).
- Nu INVENTA niciodata un fapt. Anul: 2026. Tutuit (PME), cu dumneavoastra (corporate).${forbiddenWordsRule}`;
      spintaxBlockFU = `=== VARIATIE STRUCTURALA (SPINTAX) ===
Foloseste 1-2 spintax {varianta1|varianta2} pe parti nepersonalizate :
- Intrebare : {E cazul?|E un subiect?|Ma insel?|Sau deloc?}
- Tranzitie : {Deci|De altfel|De fapt}
Continutul personalizat ramane fix.`;
    } else {
      lavenderBlockFU = `=== METHODE LAVENDER (OBLIGATOIRE — meme pour les relances) ===
1. ${isBreakup ? '10-20 MOTS' : stepNumber === 3 ? '15-25 MOTS' : '25-40 MOTS'} MAX. Plus court que le step 1. Chaque mot doit meriter sa place.
2. NIVEAU CM1 : phrases courtes, mots simples. Pas de jargon anglais (pipe, outbound, scale, lead, funnel).
3. TON HESITANT : "je me trompe peut-etre", "c'est peut-etre pas le cas", "ou pas du tout ?". Meme sur les relances.
4. QUESTION OUVERTE en fin d'email. Pas "dispo 15 min ?".
5. OBJET : 2-3 mots, minuscules, contient prenom ou entreprise. DIFFERENT des precedents.
6. RATIO JE/TU : parle du prospect plus que de toi.`;
      interditsBlockFU = `=== INTERDITS ===
- PAS de tiret cadratin. PAS de "Bonjour". PAS de signature.
- PAS de social proof invente. PAS de "un client similaire a fait X en Y mois".
- PAS de "suite a mon email", "je reviens vers vous", "je me permets de relancer".
- PAS de meta-prospection, pitch, prix, bullet points.
- PAS de phrases creuses : "beau move", "impressionnant", "potentiellement".
- PAS de jargon : pipe, pipeline, outbound, lead, funnel, scale, growth, CRM.
- DIFFERENT du/des email(s) precedent(s) (nouvel angle, nouvelle question).
- N'invente JAMAIS un fait. Annee : 2026. Vouvoiement par defaut.${forbiddenWordsRule}`;
      spintaxBlockFU = `=== VARIATION STRUCTURELLE (SPINTAX) ===
Utilise 1-2 spintax {variante1|variante2} sur des parties non personnalisees :
- Question : {C'est le cas ?|C'est un sujet ?|Je me trompe ?|Ou pas du tout ?}
- Transition : {Du coup|D'ailleurs|En fait}
Le contenu personnalise reste fixe.`;
    }

    const systemPrompt = `${fuLanguageBlock}Tu es ${senderName}, ${senderTitle} de ${clientName}. Tu ecris une relance.
${winningPatternsBlockFU}
=== STRATEGIE STEP ${stepNumber}/${totalSteps} ===
${stepStrategy}
${stepExample ? '\n' + stepExample : ''}
${bookingUrlBlock}

${lavenderBlockFU}

${interditsBlockFU}

${spintaxBlockFU}

JSON uniquement : {"subject":"...","body":"... avec 1-2 spintax {var1|var2}"}`;

    let firstName = contact.firstName || (contact.name || '').split(' ')[0] || '';
    // Anti-hallucination prenom
    const invalidNames = ['directeur', 'director', 'contact', 'info', 'admin', 'hello', 'commercial', 'support', 'manager', 'ceo', 'cto', 'cfo'];
    if (!firstName || invalidNames.includes(firstName.toLowerCase()) || contact.email.startsWith('contact@') || contact.email.startsWith('info@') || contact.email.startsWith('hello@')) {
      firstName = '';
    }
    const userMessage = `DONNEES PROSPECT (pour personnalisation PROFONDE) :
${prospectIntel || 'Aucune donnee supplementaire'}
${previousEmailsContext}
${!firstName ? '\nATTENTION : le prenom du prospect est INCONNU. NE PAS inventer un prenom. Utilise le nom de l\'entreprise a la place.' : ''}
CONTACT :
- Prenom : ${firstName || 'INCONNU (utiliser le nom d\'entreprise)'}
- Nom complet : ${contact.name || ''}
- Poste : ${contact.title || 'non precise'}
- Entreprise : ${contact.company || 'non precisee'}
- Email : ${contact.email}

Objectif campagne : ${campaignContext || 'prospection B2B'}

Ecris la relance ${stepNumber - 1}/${totalSteps - 1} avec un NOUVEL ANGLE base sur les DONNEES PROSPECT ci-dessus.${isBreakup ? ' FORMAT BREAKUP : 2 lignes max, choix binaire.' : ' OBLIGATOIRE : social proof DIFFERENT du step precedent + CTA valeur.'}`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      isBreakup ? 500 : 1000
    );
    let parsed = this._parseJSON(response);
    // Post-process : supprimer tirets cadratins
    if (parsed && parsed.body) parsed.body = parsed.body.replace(/\u2014/g, ',').replace(/\u2013/g, ',');
    if (parsed && parsed.subject) parsed.subject = parsed.subject.replace(/\u2014/g, ' ').replace(/\u2013/g, ' ');

    // Post-process : garantir le lien booking dans step 3 et breakup
    if (parsed && parsed.body && (stepNumber === 3 || isBreakup) && googleBookingUrl) {
      const bookingDomain = googleBookingUrl.split('?')[0];
      if (!parsed.body.includes(bookingDomain)) {
        try {
          const bpUrl = new URL(googleBookingUrl);
          if (contact.email) bpUrl.searchParams.set('email', contact.email);
          if (firstName) bpUrl.searchParams.set('name', firstName);
          parsed.body = parsed.body.trimEnd() + '\n\n' + bpUrl.toString();
        } catch (e) {
          parsed.body = parsed.body.trimEnd() + '\n\n' + googleBookingUrl;
        }
      }
    }

    // Breakups : gate programmatique
    if (isBreakup) {
      if (!parsed || parsed.skip) return parsed;
      const bwc = (parsed.body || '').split(/\s+/).filter(w => w.length > 0).length;
      if (bwc > 50) return { skip: true, reason: 'breakup_too_long:' + bwc };
      if (bwc < 8) return { skip: true, reason: 'breakup_too_short:' + bwc };
      return parsed;
    }
    // Quality gate stricte pour les follow-ups (meme niveau que step 1)
    return this._scoreAndFilterFollowUp(parsed, contact, previousEmails);
  }

  // Quality gate pour follow-ups — plus stricte que l'ancien _scoreAndFilter
  async _scoreAndFilterFollowUp(parsed, contact, previousEmails) {
    if (!parsed || parsed.skip) return parsed;
    const body = parsed.body || '';
    const subject = parsed.subject || '';
    const bodyLower = body.toLowerCase();
    const wordCount = body.split(/\s+/).filter(w => w.length > 0).length;

    // BLOCK : trop long pour un follow-up
    if (wordCount > 80) return { skip: true, reason: 'fu_too_long:' + wordCount };

    // BLOCK : tirets cadratins
    const emDashCount = body.split(/\u2014|\u2013/).length - 1;
    if (emDashCount >= 2) return { skip: true, reason: 'fu_em_dash:' + emDashCount };

    // BLOCK : dead CTAs
    const deadCTAs = ['curieux d\'avoir ton retour', 'curieux d\'avoir ton avis', 'curieux de savoir',
      'curieux d\'avoir votre retour', 'curieux d\'avoir votre avis', 'curieux d\'en savoir plus',
      'c\'est quoi la strategie', 'c\'est quoi le plan', 'conviction ou differenciation'];
    for (const cta of deadCTAs) {
      if (bodyLower.includes(cta)) return { skip: true, reason: 'fu_dead_cta:' + cta };
    }

    // BLOCK : meta-prospection
    const metaP = ['comment tu prospectes', 'comment vous prospectez', 'comment tu acquiers',
      'comment tu generes', 'comment tu trouves de nouveaux clients', 'acquisition de clients',
      'generer des leads', 'trouver de nouveaux clients'];
    for (const mp of metaP) {
      if (bodyLower.includes(mp)) return { skip: true, reason: 'fu_meta_prospection:' + mp };
    }

    // BLOCK : repetition du social proof du step precedent
    if (previousEmails && previousEmails.length > 0) {
      const lastBody = (previousEmails[previousEmails.length - 1].body || '').toLowerCase();
      // Detecter si >50% des mots significatifs du social proof sont les memes
      const spMarkers = ['on genere', 'on fait', 'on remplace', 'on alimente', 'on accompagne',
        'on bosse avec', 'on travaille avec', 'un de nos clients', 'on a structure', 'on a genere'];
      for (const marker of spMarkers) {
        if (bodyLower.includes(marker) && lastBody.includes(marker)) {
          // Meme marqueur de social proof = repetition probable
          // Extraire la phrase contenant le marqueur dans les deux emails
          const currentSP = bodyLower.split(/[.!?\n]/).find(s => s.includes(marker)) || '';
          const prevSP = lastBody.split(/[.!?\n]/).find(s => s.includes(marker)) || '';
          if (currentSP && prevSP) {
            const currentWords = currentSP.split(/\s+/).filter(w => w.length > 3);
            const prevWords = new Set(prevSP.split(/\s+/).filter(w => w.length > 3));
            const overlap = currentWords.filter(w => prevWords.has(w)).length;
            if (currentWords.length > 0 && overlap / currentWords.length > 0.5) {
              return { skip: true, reason: 'fu_sp_repetition:' + marker };
            }
          }
        }
      }
    }

    // Scoring 100% programmatique — plus fiable que GPT-4o-mini qui sous-note le FR de 1-2 pts
    // Les gates ci-dessus couvrent tous les cas critiques (longueur, em-dash, dead CTA, meta-prospection, SP repetition)
    // Un FU qui passe toutes ces gates est un bon FU — pas besoin de payer GPT pour confirmer
    if (wordCount < 20) return { skip: true, reason: 'fu_too_short:' + wordCount };
    if (wordCount > 65) {
      // Tolerance 65-80 : penalite log mais pas block (deja gate a 80 au-dessus)
      log.info('email-writer', 'FU slightly long: ' + wordCount + ' mots (tolerant 65-80)');
    }
    return parsed;
  }

  async editEmail(currentEmail, instruction) {
    const systemPrompt = `Tu es un expert en redaction d'emails professionnels.
L'utilisateur te donne un email existant et une instruction de modification.
Applique la modification demandee tout en gardant le mail professionnel et percutant.
IMPORTANT : JAMAIS de tiret cadratin dans le texte. Utilise des virgules et des points.

IMPORTANT : Retourne UNIQUEMENT un JSON valide, sans markdown, sans backticks :
{"subject":"Objet du mail","body":"Corps du mail en texte brut"}`;

    const userMessage = `Voici l'email actuel :

Objet : ${currentEmail.subject}

${currentEmail.body}

Instruction de modification : ${instruction}`;

    const response = await this.callOpenAIMini(systemPrompt, userMessage, 1000);
    return this._parseJSON(response);
  }

  async personalizeEmail(subject, body, contactData) {
    const systemPrompt = `Tu es un expert cold email B2B. Voici un template d'email et les donnees du contact. Personnalise subtilement l'email pour ce contact specifique. Garde le meme ton et la meme structure, mais adapte les references au secteur, au poste, a l'entreprise. Ne change PAS le sens du message.
IMPORTANT : JAMAIS de tiret cadratin dans le texte. Utilise des virgules et des points.
Retourne le resultat en JSON {subject, body}.

REGLES :
- Garde la meme longueur approximative
- Ne change pas le call-to-action
- Adapte les references concretes au contexte du contact
- Ton naturel, pas sur-personnalise
- Retourne UNIQUEMENT un JSON valide, sans markdown, sans backticks :
{"subject":"Objet personnalise","body":"Corps personnalise en texte brut"}`;

    const contactInfo = [];
    if (contactData.firstName) contactInfo.push('Prenom : ' + contactData.firstName);
    if (contactData.lastName) contactInfo.push('Nom : ' + contactData.lastName);
    if (contactData.name) contactInfo.push('Nom complet : ' + contactData.name);
    if (contactData.title) contactInfo.push('Poste : ' + contactData.title);
    if (contactData.company) contactInfo.push('Entreprise : ' + contactData.company);
    if (contactData.industry) contactInfo.push('Secteur : ' + contactData.industry);
    if (contactData.companySize) contactInfo.push('Taille entreprise : ' + contactData.companySize);
    if (contactData.city) contactInfo.push('Ville : ' + contactData.city);
    if (contactData.country) contactInfo.push('Pays : ' + contactData.country);
    if (contactData.linkedinUrl) contactInfo.push('LinkedIn : ' + contactData.linkedinUrl);

    const userMessage = `Voici le template d'email a personnaliser :

Objet : ${subject}

Corps :
${body}

Donnees du contact :
${contactInfo.join('\n')}

Personnalise cet email pour ce contact specifique.`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      1500
    );
    return this._parseJSON(response);
  }

  async generateSubjectVariant(originalSubject) {
    const systemPrompt = `Tu es un expert en cold email B2B et A/B testing. On te donne un objet d'email. Genere une variante alternative qui a le meme sens mais une formulation differente. L'objectif est de tester quel objet obtient le meilleur taux d'ouverture.

REGLES :
- Meme sens, meme longueur approximative
- Formulation differente (angle, structure, mots-cles)
- Garde le ton professionnel
- JAMAIS de tiret cadratin
- Retourne UNIQUEMENT le texte de l'objet alternatif, rien d'autre (pas de JSON, pas de guillemets, pas d'explication)`;

    const response = await this.callOpenAIMini(systemPrompt, 'Objet original : ' + originalSubject + '\n\nGenere une variante alternative.', 200);
    return response.trim().replace(/^["']|["']$/g, '');
  }

  async generateBodyVariant(originalBody, originalSubject, prospectContext, contact) {
    const systemPrompt = `Tu es un expert en cold email B2B et A/B testing. On te donne un cold email. Reecris-le avec un ANGLE COMPLETEMENT DIFFERENT tout en ciblant le meme prospect.

REGLES STRICTES :
- Structure : fait + pont + social proof + CTA valeur. 4 blocs.
- 40-60 mots max
- NOUVEL ANGLE : si l'original parle de news, utilise le stack technique. Si l'original cite un client, parle du positionnement. Etc.
- Garde le tutoiement/vouvoiement de l'original
- JAMAIS de tiret cadratin. Virgules, points, retours a la ligne.
- Pas de signature (ajoutee automatiquement)
- Retourne un JSON : {"subject":"nouvel objet","body":"nouveau corps"}
- L'objet doit aussi etre different de l'original`;

    const userMessage = `Email original :
Objet: ${originalSubject}
Corps: ${originalBody}
${prospectContext ? '\nDonnees prospect disponibles:\n' + (prospectContext || '').substring(0, 2000) : ''}

Genere une variante A/B avec un angle different. JSON uniquement.`;

    try {
      const response = await this.callClaude(
        [{ role: 'user', content: userMessage }],
        systemPrompt,
        800
      );
      const parsed = this._parseJSON(response);
      if (parsed && parsed.body && parsed.subject && !parsed.skip) {
        const wc = (parsed.body || '').split(/\s+/).filter(w => w.length > 0).length;
        if (wc > 70) return null;
        // Supprimer tirets cadratins
        if (parsed.body) parsed.body = parsed.body.replace(/\u2014/g, ',').replace(/\u2013/g, ',');
        if (parsed.subject) parsed.subject = parsed.subject.replace(/\u2014/g, ' ').replace(/\u2013/g, ' ');
        if (contact) {
          try {
            const scored = await this._scoreAndFilter(parsed, contact);
            if (scored && scored.skip) return null;
          } catch (scoreErr) { /* scoring indisponible, gate wc suffit */ }
        }
        return { subject: parsed.subject, body: parsed.body };
      }
    } catch (e) { /* fallback : retourne null */ }
    return null;
  }

  async generateFromTemplate(template, contact) {
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
