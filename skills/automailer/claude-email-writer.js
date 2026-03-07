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
    if (clientDescription || nicheData) {
      icpBlock = '\n=== QUI TU ES ET POURQUOI TU ECRIS ===\n';
      if (clientDescription) {
        icpBlock += clientName + ' : ' + clientDescription + '\n';
      }
      if (nicheData) {
        icpBlock += '\nNICHE DU PROSPECT : ' + (nicheData.name || nicheData.slug || 'inconnue');
        if (nicheData.painPoint) icpBlock += '\nLEUR PROBLEME : ' + nicheData.painPoint;
        if (nicheData.socialProof) icpBlock += '\nTON SOCIAL PROOF (a integrer en 1 phrase) : ' + nicheData.socialProof;
        if (contact._triggerAngle) icpBlock += '\nTRIGGER DETECTE : ' + contact._triggerAngle;
        icpBlock += '\n';
      }
      icpBlock += `
REGLE : ton email doit faire comprendre EN UNE PHRASE que tu connais leur probleme et que tu as quelque chose a apporter.
Pas un pitch. Un CONTEXTE. Le prospect connecte les points tout seul.
Le social proof est UNE phrase integree naturellement dans le flow, PAS un paragraphe separe.
`;
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

    const systemPrompt = `${languageBlock}Tu es ${senderName}, ${senderTitle} de ${clientName}. Tu ecris a un pair, pas a un prospect. Comme un fondateur qui a remarque un truc concret et qui lance la conversation.
${icpBlock}
=== INTERDITS ABSOLUS (LIS CA EN PREMIER) ===
- JAMAIS de tiret cadratin ni de tiret long (le caractere " - " avec espace ou le long dash). Utilise des virgules, des points, des retours a la ligne. Les tirets longs sont un marqueur IA que les prospects detectent.
- JAMAIS "curieux d'avoir ton retour/avis" ou toute question sans value prop. Le prospect doit savoir POURQUOI repondre.
- JAMAIS de question journalistique sans value prop ("c'est quoi la strategie ?", "conviction ou differenciation ?"). Tu n'es pas journaliste. Tu PROPOSES quelque chose de concret.
- JAMAIS de meta-prospection ("comment tu acquiers/trouves/generes des clients/leads ?"). C'est ce qu'on vend.
- JAMAIS "beau move", "impressionnant", "sacre parcours", "potentiellement", "je me permets", "je suis tombe sur", "je me disais"
- JAMAIS "Ce type de...", "Le vrai cap c'est...", "Ce qui distingue..." (analyse LinkedIn = supprime)
- JAMAIS de paragraphe de plus de 2 lignes
- ZERO pitch detaille, prix, features, bullet points, gras, HTML
- JAMAIS "cordonnier mal chausse", "nerf de la guerre", "le plus dur c'est"

=== STRUCTURE OBLIGATOIRE (4 BLOCS, ${emailLengthHint}) ===

1. FAIT (1 a 2 phrases) : un element concret tire des DONNEES. Chiffre, nom propre, date, news. Si tu ne trouves rien de specifique, utilise le nom de l'entreprise + son activite + ville/taille.
2. PONT (1 phrase) : relie le fait au probleme de leur niche. Pas de lecon, pas d'analyse. Une question ou une observation qui montre que tu comprends.
3. SOCIAL PROOF (1 phrase, OBLIGATOIRE) : montre que tu sais resoudre ce probleme. "On fait ca pour des [type similaire]", "On genere [resultat] pour des [type]". JAMAIS un pitch. JAMAIS un paragraphe.
4. CTA VALEUR (1 phrase, OBLIGATOIRE) : le prospect doit sentir qu'il va recevoir quelque chose. "Je te montre en 15 min", "Dispo pour te montrer le setup", "On en parle 15 min cette semaine ?".

REGLE DE FER : si l'email n'a PAS de social proof ET de CTA valeur, il sera REJETE automatiquement. Ne genere JAMAIS d'email sans ces 2 elements.

=== ANTI-HALLUCINATION ===
N'invente JAMAIS un fait. Si un chiffre ou evenement n'apparait PAS dans les donnees, ne le cite pas.

=== HIERARCHIE DES DONNEES ===
Utilise la meilleure dispo : profil public/interview > news recente > clients/projets detectes > stack/chiffres/employes > entreprise + poste (minimum, PAS un skip).
Skip UNIQUEMENT si tu n'as meme pas de nom d'entreprise.

=== OBJET ===
2-4 mots, minuscules, comme un texto. Contient le prenom OU l'entreprise. Base sur le fait, pas sur notre offre.${subjectStyleHint}

=== TON ===
Ecris comme tu parles a un pote entrepreneur. Pas comme tu rediges un post LinkedIn.
Tutoiement par defaut. Vouvoiement si +500 employes ou grand groupe.
PAS de signature (ajoutee auto). Pas de "Bonjour X".
PONCTUATION NATURELLE : virgules, points, retours a la ligne. Jamais de tirets longs.
${nicheExampleBlock}
=== 3 EXEMPLES 10/10 (structures DIFFERENTES, note la ponctuation sans tirets) ===

STRUCTURE A, fait puis question (58 mots) :
"Thomas, 12 personnes chez [Agence] et un poste de bizdev ouvert. Le delivery tourne mais cote acquisition, c'est encore toi qui ramenes les clients ?

On genere le pipe outbound pour des agences growth. Des opportunites qualifiees en continu sans y passer 2h par jour.

Je te montre le setup en 15 min si ca te parle."

STRUCTURE B, observation directe (55 mots) :
"Marc, 4 postes ouverts sur Welcome et 150 personnes chez [ESN]. Ca tourne cote delivery.

Un de nos clients dans le meme secteur generait 80% de son pipe par le reseau. On a structure un canal outbound a cote, il a double son volume en 3 mois.

On en parle 15 min ?"

STRUCTURE C, trigger event (52 mots) :
"Clement, [SaaS] vient de lever et vous recrutez 2 commerciaux. Le pipe va suivre ou c'est encore du founder-led sales ?

On remplace le premier commercial outbound pour des editeurs en scaling. Meme volume, fraction du cout.

Dispo pour te montrer comment ca marche ?"

=== FORMAT ===
JSON valide uniquement, sans markdown, sans backticks.
{"subject":"objet","body":"corps SANS signature"}
OU {"skip": true, "reason": "explication"}`;

    const firstName = contact.firstName || (contact.name || '').split(' ')[0] || '';
    const userMessage = `Ecris un email pour ce prospect. Utilise la MEILLEURE donnee disponible selon la hierarchie (profil public > news > clients > techno > chiffres).
IMPORTANT : essaie TOUJOURS d'ecrire un email. Si tu as au moins un nom d'entreprise + un poste, tu peux ecrire sur l'activite de cette entreprise. Skip UNIQUEMENT si tu n'as AUCUNE info.
RAPPEL CRITIQUE : l'email DOIT contenir un social proof (1 phrase "on fait/genere X pour des Y") ET un CTA valeur ("je te montre en 15 min"). Sans ces 2 elements, l'email sera rejete.
RAPPEL : ZERO tiret long/cadratin dans le texte.

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
        prompt = userMessage + '\n\nATTENTION: l\'email precedent a ete note ' + bestScore + '/10. Problemes: ' + (best._scoreReason || 'qualite insuffisante') + '. Ecris un email MEILLEUR avec les 4 BLOCS OBLIGATOIRES : FAIT specifique + PONT vers le probleme + SOCIAL PROOF (1 phrase) + CTA oriente valeur. ZERO tiret cadratin. ZERO question journalistique sans value prop.';
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

      // === Pre-scoring programmatique (0 API call) ===
      const preScore = this._programmaticPreScore(parsed.subject, parsed.body, contact);
      if (preScore.block) {
        if (preScore.note > bestScore) {
          best = parsed;
          bestScore = preScore.note;
          best._scoreReason = preScore.reason;
        }
        continue;
      }

      // Auto-scoring via GPT-4o-mini
      const score = await this._scoreEmail(parsed.subject, parsed.body, contact);
      const adjustedNote = Math.min(10, Math.max(1, score.note + preScore.adjust));
      const adjustedReason = preScore.adjust !== 0 ? score.reason + ' [prog:' + (preScore.adjust > 0 ? '+' : '') + preScore.adjust + ' ' + preScore.reason + ']' : score.reason;
      if (adjustedNote >= 9) return parsed;
      if (adjustedNote > bestScore) {
        best = parsed;
        bestScore = adjustedNote;
        best._scoreReason = adjustedReason;
      }
    }
    // Apres retries : envoyer si >= 8, sinon skip (remonte de 7 a 8 pour la qualite)
    if (bestScore >= 8) return best;
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

    // BLOCK : trop court (pas assez de substance, manque social proof)
    if (wordCount < 40) return { block: true, adjust: -3, note: 4, reason: 'too_short:' + wordCount + '_words' };

    // BLOCK : trop long
    if (wordCount > 100) return { block: true, adjust: -3, note: 4, reason: 'too_long:' + wordCount + '_words' };

    // BLOCK : pas de social proof (OBLIGATOIRE)
    const spMarkers = ['on genere', 'on fait', 'on remplace', 'on alimente', 'on accompagne',
      'on bosse avec', 'on travaille avec', 'pour des agences', 'pour des esn', 'pour des editeurs',
      'pour des cabinets', 'pour des startups', 'pour des organismes', 'pour des e-commerces',
      'meme volume', 'en continu', 'chaque semaine', 'sans dependre', 'sans y passer', 'fraction du cout',
      'un de nos clients', 'on a structure', 'on a genere', 'on a mis en place',
      'pour des boites', 'pour des entreprises', 'dans le meme secteur'];
    const hasSP = spMarkers.some(m => bodyLower.includes(m));
    if (!hasSP) return { block: true, adjust: -3, note: 4, reason: 'no_social_proof' };

    // BLOCK : pas de CTA valeur (OBLIGATOIRE)
    const valueCTAs = ['je te montre', 'je t\'envoie', 'dispo pour', 'on en discute',
      'te montrer', '15 min', 'voir le setup', 'comment ca marche',
      'on en parle', 'je te fais', 'on se cale', 'on planifie',
      'dispo si tu veux', 'dispo si ca'];
    const hasCTA = valueCTAs.some(m => bodyLower.includes(m));
    if (!hasCTA) return { block: true, adjust: -3, note: 4, reason: 'no_value_cta' };

    // BONUS : social proof + CTA valeur ensemble = bon email
    if (hasSP && hasCTA) { adjust += 1; reasons.push('sp+value_cta'); }

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
    const prompt = `Note cet email de prospection B2B de 1 a 10. Sois TRES STRICT.

CRITERES 10/10 :
- 50-80 mots (penalise si < 40 ou > 100)
- UN fait specifique (chiffre, nom propre, date, evenement)
- UN pont vers le probleme (relie le fait a un pain point, 1 phrase)
- UN social proof court (montre qu'on a la solution, 1 phrase, PAS un pitch)
- UN CTA oriente valeur ("je te montre" / "dispo pour te montrer", pas "curieux d'avoir ton retour")
- ZERO paragraphe d'analyse entre le fait et la question
- ZERO meta-prospection (ne demande PAS "comment tu prospectes/acquiers des clients")
- ZERO lecon au prospect
- Ton naturel, entre pairs
- PAS de tirets cadratins (marqueur IA)
- PAS de pitch detaille, prix, features

PENALITES :
- < 40 mots : -3 points (manque substance, probablement pas de social proof)
- > 100 mots : -3 points (trop long)
- Pas de social proof (aucune phrase "on fait/genere X pour des Y") : -4 points
- Pas de CTA valeur (pas de "je te montre/dispo pour") : -3 points
- "Curieux d'avoir ton retour" ou CTA sans valeur : -4 points
- Question journalistique sans proposer rien ("c'est quoi la strategie ?") : -3 points
- Tirets cadratins : -1 point par tiret
- Meta-prospection : -4 points
- Generique secteur (remplacable par n'importe quelle entreprise) : -4 points
- Paragraphe d'analyse LinkedIn : -3 points

EMAIL :
Objet: ${subject}
Corps: ${body}
(${wordCount} mots)
Prospect: ${contact.name || '?'} / ${contact.company || '?'}

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
    } catch (e) {
      console.warn('[email-writer] Scoring OpenAI echoue: ' + e.message + ' - fallback score 7');
    }
    return { note: 7, reason: 'scoring_unavailable' };
  }

  // Score leger pour les follow-ups/relances (pas de retry, juste reject si trop bas)
  async _scoreAndFilter(parsed, contact) {
    if (!parsed || parsed.skip) return parsed;
    try {
      const wordCount = (parsed.body || '').split(/\s+/).filter(w => w.length > 0).length;
      if (wordCount > 80) {
        return { skip: true, reason: 'too_many_words:' + wordCount + ' (max 80)' };
      }
      // Block tirets cadratins dans les follow-ups aussi
      const emDashCount = (parsed.body || '').split(/\u2014|\u2013/).length - 1;
      if (emDashCount >= 2) {
        return { skip: true, reason: 'em_dash_overuse:' + emDashCount };
      }
      const score = await this._scoreEmail(parsed.subject, parsed.body, contact);
      if (score.note >= 6) return parsed;
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

STEP 1, RELANCE 1 (J+3) : NOUVEL ANGLE + SOCIAL PROOF
Mission : apporter une PREUVE que tu peux aider.
Nouveau fait tire des DONNEES PROSPECT (different du premier email).
Integre le social proof : "une [type d'entreprise similaire] a [resultat concret]"
CTA : "Dispo pour en parler"
30-50 mots MAX.

STEP 2, RELANCE 2 (J+7) : CTA DIRECT + LIEN CALENDRIER
Mission : convertir en RDV. C'est le moment d'etre direct.
1 phrase de contexte (pas de repetition des emails precedents).
CTA DIRECT avec lien si disponible : "15 min pour te montrer, voici mon calendrier : [lien]"
Si pas de lien : "On se cale 15 min cette semaine ? Dis-moi tes dispos."
25-40 mots MAX, court et direct.
${breakupInstruction}

INTERDITS ABSOLUS (TEMPLATES GENERIQUES) :
- "[Industrie] vit de recommandations et de reseaux"
- "Comment [Company] genere de nouvelles opportunites"
- "Ces canaux ont un plafond" / "carnet de contacts sature"
- "Curieux d'avoir ton retour"
- Toute phrase ou seul le nom de l'industrie/entreprise change

REGLES :
- 30-50 mots par relance (JAMAIS plus de 50). Le breakup = 2 lignes MAX.
- Tutoiement startup/PME, vouvoiement corporate
- JAMAIS : "je me permets", "suite a", "beau move", "potentiellement"
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
      stepStrategy = 'Relance 1 (J+3): Nouvel angle DIFFERENT du premier email, tire des DONNEES PROSPECT. Social proof + CTA soft ("dispo pour en parler", "ca vaut un echange ?").';
    } else if (stepNumber === 3) {
      stepStrategy = 'Relance 2 (J+7): Preuve sociale, mini cas client anonymise ("un dirigeant dans ton secteur..."). Fait rebondir sur un aspect specifique du prospect + CTA soft.';
    } else if (stepNumber === totalSteps - 1 && totalSteps > 4) {
      stepStrategy = 'Relance 3 (J+14): Dernier angle de valeur, question directe basee sur un fait specifique des donnees prospect + CTA soft.';
    } else if (isBreakup) {
      stepStrategy = 'BREAKUP (derniere relance): 2 lignes MAXIMUM. Choix binaire simple ("pas le bon moment ? dis-le moi"). Exploite la loss aversion.';
    } else {
      stepStrategy = 'Relance ' + (stepNumber - 1) + ': Nouvel angle tire des DONNEES PROSPECT, question specifique + social proof.';
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

INTERDIT ABSOLU :
- JAMAIS de tiret cadratin ni de tiret long. Virgules, points, retours a la ligne.
- JAMAIS "curieux d'avoir ton retour" ou question sans value prop.

FORMAT (${emailLengthHint}) :
1. OBSERVATION = fait specifique ou nouvel insight (PAS "je reviens vers toi")
2. SOCIAL PROOF ou preuve (sauf breakup)
3. CTA VALEUR = ouverture naturelle ("dispo pour en parler", "je te montre en 15 min")
${isBreakup ? '\nBREAKUP = 2 phrases max. Question fermee. PAS de CTA soft.' : ''}

INTERDIT : le paragraphe d'analyse LinkedIn qui explique au prospect ce qu'il vit.

INTERDITS ABSOLUS :
- "[Industrie] vit de recommandations et de reseaux"
- "Comment [Company] genere de nouvelles opportunites"
- "Ces canaux ont un plafond" / "carnet de contacts sature"
- La relance DOIT citer un fait SPECIFIQUE tire des DONNEES PROSPECT ci-dessous.

REGLES :
- ${emailLengthHint}. ${isBreakup ? '2 LIGNES MAXIMUM.' : ''} Ecris comme tu PARLES.
- Tutoiement par defaut. Vouvoiement si +500 employes ou grand groupe cote.
- JAMAIS : "suite a mon email", "je reviens vers vous", "je me permets de relancer"
- JAMAIS : pitch, prix, offre, "beau move", "potentiellement"
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

Ecris la relance ${stepNumber - 1}/${totalSteps - 1} avec un NOUVEL ANGLE base sur les DONNEES PROSPECT ci-dessus.${isBreakup ? ' FORMAT BREAKUP : 2 lignes max, choix binaire.' : ' OBLIGATOIRE : social proof + CTA valeur.'}`;

    const response = await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      isBreakup ? 500 : 1000
    );
    let parsed = this._parseJSON(response);
    // Post-process : supprimer tirets cadratins
    if (parsed && parsed.body) parsed.body = parsed.body.replace(/\u2014/g, ',').replace(/\u2013/g, ',');
    if (parsed && parsed.subject) parsed.subject = parsed.subject.replace(/\u2014/g, ' ').replace(/\u2013/g, ' ');
    // Breakups : gate programmatique
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
