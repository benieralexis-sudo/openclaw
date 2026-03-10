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
1. SIGNAL : trouve le fait le plus SPECIFIQUE (chiffre, news, recrutement, changement, event). Pas une description de site web.
2. HYPOTHESE : transforme ce signal en probleme business probable. Ex: "3 postes sales ouverts" → "le pipe depend encore du fondateur et ca ne scale pas"
3. TON : "tutoiement" (startup/PME) ou "vouvoiement" (corporate)

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
    const emailTone = process.env.EMAIL_TONE || 'informal';

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
1. OBSERVATION (1-2 phrases) : un fait CONCRET tire des donnees. Pas "j'ai vu que vous faites du marketing", mais un signal precis (recrutement, news, chiffre, projet).
2. HYPOTHESE (1 phrase) : transforme ce fait en probleme business probable. C'est la que tu montres que tu COMPRENDS leur situation. Ex: "Ca veut souvent dire que le pipe depend encore du fondateur."
3. QUESTION OUVERTE (1 phrase) : invite a la conversation. Pas "dispo 15 min ?" mais une vraie question business : "C'est le cas chez vous ?", "Vous avez structure quelque chose ?", "C'est un sujet en ce moment ?"

=== ANALYSE STRATEGIQUE ===
Si les donnees contiennent "=== ANALYSE STRATEGIQUE ===", SUIS ses directives : signal, hypothese, angle. L'analyste a deja identifie le meilleur angle.

=== METHODE LAVENDER (6 SECRETS — +35% REPLY RATE) ===
1. 40-60 MOTS MAX (pas 80, pas 100 — les emails <50 mots ont 65% de reply rate vs 2% pour >125 mots)
2. NIVEAU CM1 : phrases de 5-8 mots. Mots de 2 syllabes max. Pas de jargon. "On fait tourner le pipe" > "Nous optimisons le pipeline commercial".
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
- N'invente JAMAIS un fait sur le prospect. Annee : 2026.
- Tutoiement (PME <100 pers), vouvoiement (corporate).
${nicheExampleBlock}
=== EXEMPLES 10/10 (TON HESITANT + COURT) ===
Exemple 1 (signal recrutement, 38 mots) :
"Thomas, 3 postes commerciaux ouverts chez [Agence]. Ca veut souvent dire que le pipe depend encore du fondateur.

On structure l'outbound pour des boites comme la tienne. C'est le cas ou je me trompe ?"

Exemple 2 (signal news, 42 mots) :
"Sophie, [Cabinet] lance une offre data. Souvent, le fondateur porte seul l'acquisition des premiers clients sur un nouveau segment.

C'est peut-etre pas votre cas, mais vous avez structure un canal ou c'est encore du reseau ?"

Exemple 3 (signal croissance, 35 mots) :
"Marc, 40 personnes chez [ESN] et 5 postes ouverts. L'equipe grandit mais le pipe de missions suit pas toujours.

C'est un sujet en ce moment ou pas du tout ?"

=== FORMAT ===
JSON valide uniquement, sans markdown, sans backticks.
{"subject":"objet 2-3 mots minuscules","body":"corps SANS signature, 40-60 mots"}
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
        prompt = userMessage + '\n\nATTENTION: l\'email precedent a ete note ' + bestScore + '/10. Problemes: ' + (best._scoreReason || 'qualite insuffisante') + '. Ecris un email MEILLEUR : 40-60 mots MAX. Ton HESITANT ("je me trompe peut-etre", "c\'est le cas ou pas ?"). OBSERVATION + HYPOTHESE + QUESTION. PAS de case study invente. ZERO tiret cadratin.';
      }
      const response = await this.callClaude(
        [{ role: 'user', content: prompt }],
        systemPrompt,
        1500
      );
      const parsed = this._parseJSON(response);
      if (!parsed) return parsed;

      // Post-process automatique : supprimer tirets cadratins AVANT scoring (Claude les ajoute malgre les instructions)
      if (parsed.body) {
        parsed.body = parsed.body.replace(/\u2014/g, ',').replace(/\u2013/g, ',');
      }

      // Si Claude skip au premier essai, retry UNE FOIS avec un prompt plus insistant
      if (parsed.skip) {
        if (attempt === 0) {
          const retryPrompt = prompt + '\n\nATTENTION : tu as voulu skip mais tu as des donnees exploitables. REGLE : si tu as un nom d\'entreprise + un poste, tu DOIS ecrire un email avec social proof + CTA valeur. Un email 7/10 > un skip.';
          try {
            const retryResponse = await this.callClaude(
              [{ role: 'user', content: retryPrompt }],
              systemPrompt,
              1500
            );
            const retryParsed = this._parseJSON(retryResponse);
            if (retryParsed && !retryParsed.skip) {
              const retryScore = await this._scoreEmail(retryParsed.subject, retryParsed.body, contact);
              if (retryScore.note >= 9) return retryParsed;
              if (retryScore.note > bestScore) {
                best = retryParsed;
                bestScore = retryScore.note;
                best._scoreReason = retryScore.reason;
              }
              continue;
            }
          } catch (e) { /* retry echoue, on garde le skip original */ }
        }
        return parsed;
      }

      // === Scoring 100% programmatique (0 API call, 0 latence, 0 tokens) ===
      // Le pre-score couvre : dead CTA, em-dash, longueur, social proof, value CTA, meta-prospection, sujet generique
      // GPT-4o-mini supprime : sous-notait de 1-2 pts en FR, ajoutait 2-5s latence, coutait ~2000 tokens/email
      const preScore = this._programmaticPreScore(parsed.subject, parsed.body, contact);
      if (preScore.block) {
        if (preScore.note > bestScore) {
          best = parsed;
          bestScore = preScore.note;
          best._scoreReason = preScore.reason;
        }
        continue;
      }

      // Pre-score non-block = email structurellement bon (SP + CTA + longueur OK)
      // Note programmatique >= 7 (base 7 + adjust) = envoyer
      if (preScore.note >= 7) return parsed;
      if (preScore.note > bestScore) {
        best = parsed;
        bestScore = preScore.note;
        best._scoreReason = preScore.reason;
      }
    }
    // Apres retries : seuil strict — chaque email doit etre excellent
    if (bestScore >= 7) return best;
    return { skip: true, reason: 'auto_score_too_low:' + bestScore + '/10 (' + (best && best._scoreReason || '?') + ')' };
  }

  // Checks programmatiques rapides - detecte problemes structurels sans API call
  _programmaticPreScore(subject, body, contact) {
    const bodyLower = (body || '').toLowerCase();
    const subjectLower = (subject || '').toLowerCase();
    const wordCount = (body || '').split(/\s+/).filter(w => w.length > 0).length;
    let adjust = 0;
    const reasons = [];

    // BLOCK : CTA sans valeur
    const deadCTAs = ['curieux d\'avoir ton retour', 'curieux d\'avoir ton avis', 'curieux de savoir',
      'qu\'en penses-tu', 'qu\'en pensez-vous', 'ton retour m\'interesse', 'dis-moi ce que tu en penses',
      'curieux d\'avoir votre retour', 'curieux d\'avoir votre avis',
      'curieux d\'en savoir plus', 'ton avis m\'interesse',
      'c\'est quoi la strategie', 'c\'est quoi le plan',
      'conviction ou differenciation', 'choix strategique ou'];
    for (const cta of deadCTAs) {
      if (bodyLower.includes(cta)) return { block: true, adjust: -4, note: 3, reason: 'dead_cta:' + cta };
    }

    // BLOCK : tirets cadratins (marqueur IA)
    const emDashCount = (body || '').split(/\u2014|\u2013/).length - 1;
    if (emDashCount >= 2) return { block: true, adjust: -3, note: 4, reason: 'em_dash_overuse:' + emDashCount };
    if (emDashCount === 1) { adjust -= 1; reasons.push('em_dash'); }

    // BLOCK : trop court (les meilleurs emails font 35-45 mots)
    if (wordCount < 25) return { block: true, adjust: -3, note: 4, reason: 'too_short:' + wordCount + '_words' };

    // BLOCK : trop long (Lavender : <50 mots = 65% reply rate, >125 mots = 2%)
    if (wordCount > 80) return { block: true, adjust: -3, note: 4, reason: 'too_long:' + wordCount + '_words' };
    // Penalite si > 60 mots (objectif Lavender : 40-60)
    if (wordCount > 60) { adjust -= 1; reasons.push('slightly_long:' + wordCount); }
    // Bonus si dans la zone optimale Lavender (35-50 mots)
    if (wordCount >= 35 && wordCount <= 50) { adjust += 1; reasons.push('optimal_length'); }

    // CHECK : ratio Je/Tu (Lavender secret #6 — parler du prospect 2x plus que de soi)
    const jeCount = (bodyLower.match(/\bje\b|\bj'/g) || []).length + (bodyLower.match(/\bnous\b|\bon\b/g) || []).length;
    const tuCount = (bodyLower.match(/\btu\b|\bt'/g) || []).length + (bodyLower.match(/\bvous\b|\bvotre\b|\bvos\b|\bton\b|\bta\b|\btes\b/g) || []).length;
    if (jeCount > 0 && tuCount > 0 && jeCount > tuCount * 1.5) { adjust -= 1; reasons.push('je_tu_ratio:' + jeCount + '/' + tuCount); }

    // BONUS : ton hesitant (Lavender secret #3 — +35% reply rate)
    const hesitantMarkers = ['peut-etre', 'je me trompe', 'c\'est peut-etre pas', 'je me demandais',
      'pas du tout', 'ou pas', 'c\'est le cas', 'je me permets pas'];
    const hasHesitantTone = hesitantMarkers.some(m => bodyLower.includes(m));
    if (hasHesitantTone) { adjust += 1; reasons.push('hesitant_tone'); }

    // NOTE: social proof n'est PLUS penalise. Un email sans SP avec un bon insight vaut mieux qu'un SP invente.
    const spMarkers = ['on genere', 'on fait', 'on remplace', 'on alimente', 'on accompagne',
      'on bosse avec', 'on travaille avec', 'on structure', 'on a structure',
      'pour des agences', 'pour des esn', 'pour des editeurs', 'pour des cabinets',
      'pour des boites', 'pour des entreprises'];
    const hasSP = spMarkers.some(m => bodyLower.includes(m));
    // Pas de penalite si absent, mais bonus si present et naturel
    // (le SP invente est penalise plus bas via fake_case_study)

    // BLOCK : pas de CTA valeur (OBLIGATOIRE)
    const valueCTAs = ['je te montre', 'je t\'envoie', 'dispo pour', 'on en discute',
      'te montrer', '15 min', 'voir le setup', 'comment ca marche',
      'on en parle', 'je te fais', 'on se cale', 'on planifie',
      'dispo si tu veux', 'dispo si ca',
      // Variantes vouvoiement
      'je vous montre', 'je vous envoie', 'vous montrer',
      // Questions ouvertes (CTA valeur)
      'en interne', 'externalise', 'prioritaire pour vous', 'prioritaire pour toi',
      'structure ca', 'c\'est un sujet', 'comment vous', 'comment tu geres',
      'ca vous parle', 'ca te parle', 'un sujet chez vous', 'un sujet chez toi',
      'ca t\'interesse', 'ca vous interesse'];
    const hasCTA = valueCTAs.some(m => bodyLower.includes(m));
    // Fallback : toute question en fin d'email = CTA acceptable
    const endsWithQuestion = bodyLower.trim().endsWith('?');
    if (!hasCTA && !endsWithQuestion) return { block: true, adjust: -3, note: 4, reason: 'no_value_cta' };

    // BONUS : hypothese business presente (transformation du signal en probleme) = bon email
    const hypothesisMarkers = ['ca veut souvent dire', 'ca veut dire', 'ca signifie', 'le probleme',
      'le risque', 'le defi', 'la difficulte', 'depend encore', 'repose encore', 'porte encore',
      'absorbe tout', 'ne scale pas', 'plafonne', 'impossible a', 'du mal a'];
    const hasHypothesis = hypothesisMarkers.some(m => bodyLower.includes(m));
    if (hasHypothesis && hasCTA) { adjust += 1; reasons.push('insight+question'); }

    // BLOCK : case study invente (pattern "X clients/contacts/meetings en Y mois/semaines")
    const fakeCaseStudy = /\d+\s*(?:nouveaux?\s+)?(?:clients?|contacts?|meetings?|mandats?|dossiers?|missions?|comptes?|rdv|rendez-vous)\s+(?:en|par)\s+\d+\s*(?:mois|semaines?|jours?)/i;
    if (fakeCaseStudy.test(body || '')) {
      adjust -= 3; reasons.push('fake_case_study');
    }

    // MALUS : meta-prospection
    const metaP = ['comment tu prospectes', 'comment vous prospectez', 'comment tu acquiers',
      'comment tu generes', 'comment tu trouves de nouveaux clients', 'acquisition de clients',
      'generer des leads', 'trouver de nouveaux clients'];
    if (metaP.some(m => bodyLower.includes(m))) return { block: true, adjust: -3, note: 3, reason: 'meta_prospection' };

    // MALUS : question journalistique sans value prop (termine par ? sans social proof apres)
    const sentences = (body || '').split(/[.!?]\s+/);
    const lastSentence = sentences[sentences.length - 1] || '';
    if (lastSentence.includes('?') && !hasCTA) { adjust -= 2; reasons.push('ends_with_question_no_cta'); }

    // MALUS : sujet generique (ni prenom ni entreprise)
    const fn = ((contact.firstName || contact.name || '').split(' ')[0] || '').toLowerCase();
    const co = (contact.company || '').toLowerCase();
    if (fn && fn.length > 2 && !subjectLower.includes(fn) && co && co.length > 2 && !subjectLower.includes(co.substring(0, Math.min(co.length, 15)))) {
      adjust -= 1; reasons.push('generic_subject');
    }

    return { block: false, adjust, note: 7 + adjust, reason: reasons.join('+') || 'ok' };
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

  // Score leger pour les follow-ups/relances (pas de retry, juste reject si trop bas)
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
      const score = await this._scoreEmail(parsed.subject, parsed.body, contact);
      if (score.note >= 7) return parsed;
      return { skip: true, reason: 'auto_score_too_low:' + score.note + '/10 (' + (score.reason || '?') + ')' };
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

STEP 1, RELANCE 1 (J+3) : BUMP NATUREL
1-2 phrases. Nouvel angle OU fait concret + question business.
PAS de social proof. PAS de pitch. Juste une relance naturelle.
Exemple : "[Prenom], j'ai vu que [fait nouveau]. [Question business courte] ?"
15-30 mots MAX.

STEP 2, RELANCE 2 (J+7) : PREUVE RAPIDE
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
- Tutoiement startup/PME, vouvoiement corporate
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
- ${emailLengthHint}. Ecris comme tu parles. Tutoiement par defaut, vouvoiement si +500 employes.
- JAMAIS : pitch, prix, offre, "beau move", "potentiellement"
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
        previousEmailsContext += '\nCorps: ' + (prev.body || '').substring(0, 400);
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

    // Strategie specifique par step — beaucoup plus concrete
    const isBreakup = stepNumber >= totalSteps;
    let stepStrategy = '';
    let stepExample = '';
    if (stepNumber === 2) {
      stepStrategy = `RELANCE 1 (J+3) — NOUVEL ANGLE + PREUVE CONCRETE
Mission : apporter une PREUVE que tu peux aider. Un fait DIFFERENT du step 1.
Structure : 1 fait prospect (different du step 1) + 1 social proof concret (cas client, chiffre, resultat) + 1 CTA soft.`;
      stepExample = `EXEMPLE RELANCE 1 (note la structure differente du step 1) :
"Thomas, 3 postes ouverts chez [Agence] sur Welcome — ca recrute mais le pipe client suit ?

Une agence growth de 15 personnes a double son volume de leads en 3 mois avec nous, sans recruter de commercial.

Dispo pour en parler si ca te dit."`;
    } else if (stepNumber === 3) {
      stepStrategy = `RELANCE 2 (J+7) — CTA DIRECT + LIEN CALENDRIER
Mission : convertir en RDV. Sois DIRECT. Pas de longue intro.
Structure : 1 phrase de contexte (rebondir sur un aspect specifique) + CTA DIRECT avec lien calendrier.
COURT : 25-40 mots MAX.${bookingUrlBlock}`;
      stepExample = `EXEMPLE RELANCE 2 :
"Thomas, on accompagne des agences comme la tienne sur exactement ce sujet.

15 min pour te montrer le setup, voici mon calendrier :
[lien]"`;
    } else if (isBreakup) {
      stepStrategy = `BREAKUP (derniere relance) — 2 LIGNES MAXIMUM
Mission : exploiter la loss aversion. Question fermee. Pas de pitch.
Structure : 1 phrase ("pas le bon moment ?") + 1 phrase (lien calendrier ou "dis-le moi").`;
      stepExample = `EXEMPLE BREAKUP :
"Thomas, pas le bon moment ? Pas de souci, je ne relancerai plus.

Si le sujet revient : [lien calendrier]"`;
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
      stepStrategy = `RELANCE ${stepNumber - 1} — NOUVEL ANGLE + SOCIAL PROOF DIFFERENT
Mission : un angle encore different tire des DONNEES PROSPECT. Social proof + CTA soft.`;
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

    const systemPrompt = `${fuLanguageBlock}Tu es ${senderName}, ${senderTitle} de ${clientName}. Tu ecris une relance UNIQUE et PERSONNALISEE.
${winningPatternsBlockFU}
=== ANALYSE STRATEGIQUE (PRIORITAIRE) ===
Si les donnees contiennent un bloc "=== ANALYSE STRATEGIQUE ===", SUIS SES DIRECTIVES pour l'angle et le social proof. Adapte au format relance (plus court, plus direct).

=== STRATEGIE STEP ${stepNumber}/${totalSteps} ===
${stepStrategy}
${stepExample ? '\n' + stepExample : ''}
${socialProofInstruction}${bookingUrlBlock}

=== INTERDITS ABSOLUS ===
- JAMAIS de tiret cadratin ni de tiret long. Virgules, points, retours a la ligne.
- JAMAIS "curieux d'avoir ton retour/avis" ou question sans value prop.
- JAMAIS de paragraphe d'analyse LinkedIn qui explique au prospect ce qu'il vit.
- JAMAIS "[Industrie] vit de recommandations et de reseaux"
- JAMAIS "Comment [Company] genere de nouvelles opportunites"
- JAMAIS "Ces canaux ont un plafond" / "carnet de contacts sature"
- JAMAIS "suite a mon email", "je reviens vers vous", "je me permets de relancer"
- JAMAIS : pitch, prix, offre, "beau move", "potentiellement", "prospection", "gen de leads", "acquisition de clients"
- JAMAIS la meme structure que l'email precedent (si step 1 = fait+question, step 2 DOIT etre different)

=== QUALITE ===
- ${emailLengthHint}. ${isBreakup ? '2 LIGNES MAXIMUM.' : ''} Ecris comme tu PARLES.
- La relance DOIT citer un fait SPECIFIQUE tire des DONNEES PROSPECT.
- Le social proof DOIT etre DIFFERENT de celui du/des email(s) precedent(s).
- COHERENCE SECTORIELLE OBLIGATOIRE : le social proof DOIT etre du MEME SECTEUR/TYPE que le prospect. Jamais de fintech pour une medtech, jamais d'agence pour un cabinet.
- CHIFFRES REALISTES : max "4-8 contacts", "3-5 clients", "X% d'amelioration". Pas de chiffres miraculeux.
- ANNEE EN COURS : 2026. Ne cite JAMAIS "en 2024" ou "en 2023". Dis "ces derniers mois" ou "recemment".
- Le follow-up DOIT etre coherent avec l'email precedent (meme univers, meme angle general, nouvel argument).
- Tutoiement par defaut. Vouvoiement si +500 employes ou grand groupe.
- Sujet : 2-4 mots, minuscules, comme un texto, contient nom/entreprise, DIFFERENT des precedents
- PAS de "re:", pas de "relance", pas de signature (ajoutee auto)${forbiddenWordsRule}

JSON uniquement : {"subject":"...","body":"..."}`;

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
