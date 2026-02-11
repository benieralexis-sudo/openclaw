// Content Gen - Handler NLP Telegram
const ClaudeContentWriter = require('./claude-content-writer.js');
const storage = require('./storage.js');
const https = require('https');

class ContentHandler {
  constructor(openaiKey, claudeKey) {
    this.openaiKey = openaiKey;
    this.writer = claudeKey ? new ClaudeContentWriter(claudeKey) : null;

    // Etats conversationnels
    this.pendingConversations = {};
    this.lastGenerated = {};
  }

  start() {}
  stop() {}

  // --- NLP via OpenAI ---

  callOpenAI(messages, maxTokens) {
    maxTokens = maxTokens || 200;
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.3,
        max_tokens: maxTokens
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

  async classifyIntent(message, chatId) {
    const id = String(chatId);
    const hasLast = !!this.lastGenerated[id];
    const hasPending = !!this.pendingConversations[id];

    const systemPrompt = `Tu es le cerveau du skill Content Gen. L'utilisateur veut generer du contenu B2B. Comprends son INTENTION meme si le langage est familier ou imprecis.

ACTIONS (choisis la plus logique) :
- "generate_linkedin" : TOUT ce qui concerne un post LinkedIn, un post pour les reseaux sociaux pro, du contenu LinkedIn.
  Params: {"topic":"sujet du post", "tone":"expert/inspirant/storytelling/decontracte"}
  Exemples naturels : "ecris un truc pour LinkedIn", "fais-moi un post sur l'IA", "genere un post LinkedIn", "j'ai besoin d'un post pro"
- "generate_pitch" : pitch commercial, argumentaire de vente, presentation produit pour vendre
  Params: {"product":"produit/service", "target":"cible"}
- "generate_description" : description de produit/service
  Params: {"product":"produit/service"}
- "generate_script" : script d'appel telephonique, script de prospection, guide d'appel
  Params: {"target":"cible", "product":"produit/service"}
- "generate_email" : email marketing, newsletter, email commercial
  Params: {"subject":"sujet de l'email"}
- "generate_bio" : bio professionnelle, headline, tagline, presentation de profil
  Params: {"profile":"profil a decrire"}
- "refine_content" : reformuler, reecrire, ameliorer un texte existant
  Params: {"instruction":"ce qu'il faut changer", "text":"texte si fourni"}
${hasLast ? '- "adjust" : modifier le DERNIER contenu genere (plus court, plus long, plus formel, etc.)\n  Params: {"instruction":"la modification demandee"}' : ''}
- "list_contents" : voir historique des contenus
- "help" : UNIQUEMENT si le message est "aide" tout seul ou demande explicitement ce que le skill sait faire
- "chat" : UNIQUEMENT du bavardage SANS rapport avec la creation de contenu
${hasPending ? '\nIMPORTANT: Workflow en cours. Classe en "continue_conversation" sauf si c\'est clairement une AUTRE action.' : ''}

REGLE CRITIQUE : Si l'utilisateur demande de generer/creer/ecrire/rediger N'IMPORTE QUEL contenu, c'est une action generate_*, PAS "help". En cas de doute, choisis generate_linkedin.

JSON strict. Reponds UNIQUEMENT par le JSON.`;

    try {
      const response = await this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ], 400);

      let cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      if (!result.action) return null;
      return result;
    } catch (error) {
      console.log('[content-gen-NLP] Erreur classifyIntent:', error.message);
      return null;
    }
  }

  // --- Handler principal ---

  async handleMessage(message, chatId, sendReply) {
    const user = storage.getUser(chatId);
    const text = message.trim();
    const textLower = text.toLowerCase();

    // Conversation en cours
    if (this.pendingConversations[String(chatId)]) {
      const cancelKeywords = ['annule', 'stop'];
      if (cancelKeywords.some(kw => textLower === kw)) {
        delete this.pendingConversations[String(chatId)];
        return { type: 'text', content: '👌 Annule.' };
      }
      return await this._continueConversation(chatId, text, sendReply);
    }

    // Classification NLP (comprend le langage naturel)
    let command = await this.classifyIntent(text, chatId);

    // Filet de securite : si NLP echoue, essayer detection par mots-cles
    if (!command || command.action === 'help' || command.action === 'chat') {
      const quick = this._quickClassify(textLower, text);
      if (quick) {
        if (quick.action === 'adjust') return await this._handleAdjust(chatId, quick.params, sendReply);
        if (quick.action === 'refine') return await this._handleRefine(chatId, quick.params, sendReply);
        if (quick.action === 'list') return this._handleListContents(chatId);
        if (quick.type) return await this._handleGenerate(chatId, quick.type, quick.params, sendReply);
      }
    }
    if (!command) {
      return { type: 'text', content: 'Je n\'ai pas compris. Dis _"aide contenu"_ pour voir ce que je sais faire !' };
    }

    const params = command.params || {};

    switch (command.action) {
      case 'generate_linkedin':
        return await this._handleGenerate(chatId, 'linkedin', params, sendReply);

      case 'generate_pitch':
        return await this._handleGenerate(chatId, 'pitch', params, sendReply);

      case 'generate_description':
        return await this._handleGenerate(chatId, 'description', params, sendReply);

      case 'generate_script':
        return await this._handleGenerate(chatId, 'script', params, sendReply);

      case 'generate_email':
        return await this._handleGenerate(chatId, 'email', params, sendReply);

      case 'generate_bio':
        return await this._handleGenerate(chatId, 'bio', params, sendReply);

      case 'refine_content':
        return await this._handleRefine(chatId, params, sendReply);

      case 'adjust':
        return await this._handleAdjust(chatId, params, sendReply);

      case 'list_contents':
        return this._handleListContents(chatId);

      case 'continue_conversation':
        return await this._continueConversation(chatId, text, sendReply);

      case 'help':
        return { type: 'text', content: this.getHelp() };

      case 'chat': {
        try {
          const response = await this.callOpenAI([
            { role: 'system', content: 'Tu es l\'assistant Content Gen du bot Telegram. Tu aides a generer du contenu B2B. Reponds en francais, 1-3 phrases max.' },
            { role: 'user', content: text }
          ], 200);
          return { type: 'text', content: response.trim() };
        } catch (e) {
          return { type: 'text', content: this.getHelp() };
        }
      }

      default:
        return { type: 'text', content: this.getHelp() };
    }
  }

  // ============================================================
  // GENERATION DE CONTENU
  // ============================================================

  async _handleGenerate(chatId, type, params, sendReply) {
    if (!this.writer) {
      return { type: 'text', content: '❌ La cle API de redaction n\'est pas configuree.' };
    }

    // Verifier qu'on a assez d'info pour generer
    const topicField = this._getTopicField(type, params);
    if (!topicField) {
      return this._askForTopic(chatId, type);
    }

    // Labels
    const typeLabels = {
      linkedin: 'post LinkedIn',
      pitch: 'pitch commercial',
      description: 'description produit',
      script: 'script de prospection',
      email: 'email marketing',
      bio: 'bio/tagline'
    };
    const label = typeLabels[type] || type;

    if (sendReply) await sendReply({ type: 'text', content: '✍️ _Redaction du ' + label + '..._' });

    try {
      let content = null;

      switch (type) {
        case 'linkedin':
          content = await this.writer.generateLinkedInPost(topicField, params.tone, params.context);
          break;
        case 'pitch':
          content = await this.writer.generatePitch(topicField, params.target, params.context);
          break;
        case 'description':
          content = await this.writer.generateProductDescription(topicField, params.context);
          break;
        case 'script':
          content = await this.writer.generateProspectionScript(params.target, topicField, params.context);
          break;
        case 'email':
          content = await this.writer.generateMarketingEmail(topicField, params.context);
          break;
        case 'bio':
          content = await this.writer.generateBio(topicField, params.context);
          break;
      }

      if (!content) {
        return { type: 'text', content: '❌ Erreur lors de la generation.' };
      }

      // Sauvegarder
      storage.saveContent(chatId, type, topicField, content, params.tone);
      storage.logActivity(chatId, 'generate_' + type, { topic: topicField });

      // Garder pour ajustements
      this.lastGenerated[String(chatId)] = { type: type, topic: topicField, content: content, tone: params.tone };

      const typeEmojis = {
        linkedin: '💼',
        pitch: '🎯',
        description: '📦',
        script: '📞',
        email: '📧',
        bio: '👤'
      };

      return { type: 'text', content: [
        (typeEmojis[type] || '📝') + ' *' + label.toUpperCase() + '*',
        '━━━━━━━━━━━━━━━━━━',
        '',
        content,
        '',
        '━━━━━━━━━━━━━━━━━━',
        '💡 _Tu peux dire "plus court", "plus long", "plus formel" ou "reformule..." pour ajuster._'
      ].join('\n') };

    } catch (error) {
      console.log('[content-gen] Erreur generation ' + type + ':', error.message);
      return { type: 'text', content: '❌ Erreur : ' + error.message };
    }
  }

  // Detection rapide par mots-cles (bypass NLP pour les cas evidents)
  _quickClassify(textLower, textOriginal) {
    // Ajustements
    if (textLower.includes('plus court') || textLower.includes('plus long') || textLower.includes('plus formel') || textLower.includes('plus decontracte')) {
      return { action: 'adjust', params: { instruction: textOriginal } };
    }
    // Reformulation
    if (textLower.startsWith('reformule')) {
      const t = textOriginal.replace(/^reformule\s*:?\s*/i, '').trim();
      return { action: 'refine', params: { instruction: 'reformule', text: t || null } };
    }
    // Historique
    if (textLower === 'mes contenus' || textLower === 'historique contenus') {
      return { action: 'list' };
    }
    // Post LinkedIn
    if (textLower.includes('linkedin') || textLower.includes('linkdin') || textLower.includes('lindkedin')) {
      const topic = textOriginal.replace(/.*?(post\s+)?(linkedin|linkdin|lindkedin)\s*/i, '').replace(/^(sur|about|de|du)\s+/i, '').trim();
      return { type: 'linkedin', params: { topic: topic || null } };
    }
    // Pitch
    if (textLower.includes('pitch')) {
      const product = textOriginal.replace(/.*?pitch\s*(commercial\s*)?/i, '').replace(/^(pour|de|du)\s+/i, '').trim();
      return { type: 'pitch', params: { product: product || null } };
    }
    // Script
    if (textLower.includes('script') && (textLower.includes('prospection') || textLower.includes('appel') || textLower.includes('vente'))) {
      const product = textOriginal.replace(/.*?script\s*(de\s+)?(prospection|appel|vente)\s*/i, '').replace(/^(pour|de)\s+/i, '').trim();
      return { type: 'script', params: { product: product || null } };
    }
    // Email marketing
    if (textLower.includes('email marketing') || (textLower.includes('email') && textLower.includes('marketing'))) {
      const subject = textOriginal.replace(/.*?email\s+marketing\s*/i, '').replace(/^(pour|sur|de)\s+/i, '').trim();
      return { type: 'email', params: { subject: subject || null } };
    }
    // Bio / Tagline
    if (textLower.includes('bio') || textLower.includes('tagline')) {
      const profile = textOriginal.replace(/.*?(bio|tagline)\s*(linkedin\s*)?/i, '').replace(/^(pour|de|du)\s+/i, '').trim();
      return { type: 'bio', params: { profile: profile || null } };
    }
    // Description produit
    if (textLower.includes('description produit') || textLower.match(/\bdecris\b/) || textLower.match(/\bdécris\b/)) {
      const product = textOriginal.replace(/.*?(description\s+produit|decris|décris)\s*/i, '').replace(/^(de|du|le|la|mon|ma)\s+/i, '').trim();
      return { type: 'description', params: { product: product || null } };
    }
    // Redige
    if (textLower.match(/\bredige\b/) || textLower.match(/\brédige\b/) || textLower.match(/\bgenere\b/) || textLower.match(/\bgénère\b/) || textLower.match(/\bgenère\b/) || textLower.match(/\bgenre\b/)) {
      // Essayer de detecter le type dans le reste du message
      if (textLower.includes('email')) {
        const subject = textOriginal.replace(/.*?(email|mail)\s*/i, '').replace(/^(pour|sur|de)\s+/i, '').trim();
        return { type: 'email', params: { subject: subject || null } };
      }
      if (textLower.includes('script')) {
        const product = textOriginal.replace(/.*?script\s*/i, '').replace(/^(de|pour)\s+/i, '').trim();
        return { type: 'script', params: { product: product || null } };
      }
      // Par defaut : post LinkedIn (le plus demande)
      const topic = textOriginal.replace(/.*?(redige|rédige|genere|génère|genère|genre)\s*(moi\s+)?(un\s+)?(post\s+)?/i, '').replace(/^(sur|de|du)\s+/i, '').trim();
      return { type: 'linkedin', params: { topic: topic || null } };
    }
    return null;
  }

  _getTopicField(type, params) {
    switch (type) {
      case 'linkedin': return params.topic || null;
      case 'pitch': return params.product || null;
      case 'description': return params.product || null;
      case 'script': return params.product || params.target || null;
      case 'email': return params.subject || null;
      case 'bio': return params.profile || null;
      default: return null;
    }
  }

  _askForTopic(chatId, type) {
    const questions = {
      linkedin: 'Sur quel sujet veux-tu le post LinkedIn ?\n\n_Exemples : "l\'IA en entreprise", "le leadership", "la productivite"_\n\nTu peux aussi preciser le ton : _expert, inspirant, storytelling, decontracte_',
      pitch: 'Pour quel produit/service veux-tu le pitch ?\n\n_Exemple : "notre CRM pour PME", "solution de gestion de stock"_',
      description: 'Quel produit/service veux-tu decrire ?\n\n_Exemple : "logiciel de comptabilite cloud", "service de consulting RH"_',
      script: 'Pour vendre quoi et a qui ?\n\n_Exemple : "SaaS RH aux DRH de PME", "formation management aux dirigeants"_',
      email: 'Quel est le sujet de l\'email marketing ?\n\n_Exemple : "lancement de notre nouvelle feature", "invitation webinaire", "offre speciale"_',
      bio: 'Pour quel profil veux-tu la bio ?\n\n_Exemple : "CEO d\'une fintech", "consultante en strategie digitale", "freelance dev"_'
    };

    this.pendingConversations[String(chatId)] = {
      action: 'generate',
      step: 'awaiting_topic',
      data: { type: type }
    };

    return { type: 'text', content: '❓ ' + (questions[type] || 'Quel est le sujet ?') };
  }

  // ============================================================
  // AJUSTEMENTS
  // ============================================================

  async _handleAdjust(chatId, params, sendReply) {
    const last = this.lastGenerated[String(chatId)];
    if (!last) {
      return { type: 'text', content: '📭 Aucun contenu recent a ajuster.\n👉 Genere d\'abord un contenu !' };
    }

    if (!this.writer) {
      return { type: 'text', content: '❌ La cle API de redaction n\'est pas configuree.' };
    }

    const instruction = params.instruction || 'ameliore ce texte';
    if (sendReply) await sendReply({ type: 'text', content: '✍️ _Ajustement en cours..._' });

    try {
      const refined = await this.writer.refineContent(last.content, instruction);

      // Mettre a jour le dernier contenu
      this.lastGenerated[String(chatId)].content = refined;
      storage.saveContent(chatId, 'refine', last.topic, refined, last.tone);
      storage.logActivity(chatId, 'adjust', { instruction: instruction });

      return { type: 'text', content: [
        '✏️ *CONTENU AJUSTE*',
        '━━━━━━━━━━━━━━━━━━',
        '',
        refined,
        '',
        '━━━━━━━━━━━━━━━━━━',
        '💡 _Tu peux continuer a ajuster ou generer un nouveau contenu._'
      ].join('\n') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur : ' + error.message };
    }
  }

  // ============================================================
  // REFORMULATION
  // ============================================================

  async _handleRefine(chatId, params, sendReply) {
    if (!this.writer) {
      return { type: 'text', content: '❌ La cle API de redaction n\'est pas configuree.' };
    }

    // Si un texte est fourni, reformuler celui-la
    let textToRefine = params.text || null;
    const instruction = params.instruction || 'ameliore et rends plus professionnel';

    // Sinon, utiliser le dernier contenu genere
    if (!textToRefine) {
      const last = this.lastGenerated[String(chatId)];
      if (last) {
        textToRefine = last.content;
      } else {
        return { type: 'text', content: '❓ Quel texte veux-tu reformuler ?\n\n_Envoie "reformule : [ton texte]"_' };
      }
    }

    if (sendReply) await sendReply({ type: 'text', content: '✍️ _Reformulation en cours..._' });

    try {
      const refined = await this.writer.refineContent(textToRefine, instruction);

      this.lastGenerated[String(chatId)] = { type: 'refine', topic: 'reformulation', content: refined, tone: '' };
      storage.saveContent(chatId, 'refine', 'reformulation', refined);
      storage.logActivity(chatId, 'refine', { instruction: instruction });

      return { type: 'text', content: [
        '✏️ *TEXTE REFORMULE*',
        '━━━━━━━━━━━━━━━━━━',
        '',
        refined,
        '',
        '━━━━━━━━━━━━━━━━━━',
        '💡 _Tu peux continuer a ajuster._'
      ].join('\n') };
    } catch (error) {
      return { type: 'text', content: '❌ Erreur : ' + error.message };
    }
  }

  // ============================================================
  // HISTORIQUE
  // ============================================================

  _handleListContents(chatId) {
    const contents = storage.getContents(chatId, 10);
    if (contents.length === 0) {
      return { type: 'text', content: '📭 Aucun contenu genere.\n👉 _"post LinkedIn sur l\'IA"_ pour commencer !' };
    }

    const typeEmojis = {
      linkedin: '💼',
      pitch: '🎯',
      description: '📦',
      script: '📞',
      email: '📧',
      bio: '👤',
      refine: '✏️'
    };

    const typeLabels = {
      linkedin: 'Post LinkedIn',
      pitch: 'Pitch',
      description: 'Description',
      script: 'Script',
      email: 'Email',
      bio: 'Bio',
      refine: 'Reformulation'
    };

    const lines = ['📋 *MES CONTENUS*', '━━━━━━━━━━━━━━━━━━', ''];

    contents.reverse().forEach((c, i) => {
      const emoji = typeEmojis[c.type] || '📝';
      const label = typeLabels[c.type] || c.type;
      const date = new Date(c.createdAt).toLocaleDateString('fr-FR');
      const preview = c.content.substring(0, 60).replace(/\n/g, ' ') + '...';
      lines.push(emoji + ' *' + (i + 1) + '. ' + label + '* — ' + date);
      lines.push('   _' + preview + '_');
      lines.push('');
    });

    const stats = storage.getGlobalStats();
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('📊 Total : ' + stats.totalGenerated + ' contenus generes');

    return { type: 'text', content: lines.join('\n') };
  }

  // ============================================================
  // CONVERSATIONS MULTI-ETAPES
  // ============================================================

  async _continueConversation(chatId, text, sendReply) {
    const conv = this.pendingConversations[String(chatId)];
    if (!conv) return null;

    if (conv.action === 'generate' && conv.step === 'awaiting_topic') {
      delete this.pendingConversations[String(chatId)];

      // Extraire un eventuel ton
      const toneMatch = text.match(/\b(expert|inspirant|storytelling|decontracte|formel|humoristique)\b/i);
      const tone = toneMatch ? toneMatch[1].toLowerCase() : 'professionnel';
      const topic = text.replace(/\b(ton|style)\s*:?\s*(expert|inspirant|storytelling|decontracte|formel|humoristique)\b/gi, '').trim();

      const params = { tone: tone };

      // Remplir le bon champ selon le type
      switch (conv.data.type) {
        case 'linkedin': params.topic = topic; break;
        case 'pitch': params.product = topic; break;
        case 'description': params.product = topic; break;
        case 'script': params.product = topic; break;
        case 'email': params.subject = topic; break;
        case 'bio': params.profile = topic; break;
      }

      return await this._handleGenerate(chatId, conv.data.type, params, sendReply);
    }

    delete this.pendingConversations[String(chatId)];
    return null;
  }

  // ============================================================
  // AIDE
  // ============================================================

  getHelp() {
    return [
      '✍️ *CONTENT GEN*',
      '',
      '💼 *Post LinkedIn :*',
      '  _"post LinkedIn sur [sujet]"_',
      '',
      '🎯 *Pitch commercial :*',
      '  _"pitch pour [produit/service]"_',
      '',
      '📦 *Description produit :*',
      '  _"decris [produit]"_',
      '',
      '📞 *Script de prospection :*',
      '  _"script d\'appel pour [cible]"_',
      '',
      '📧 *Email marketing :*',
      '  _"email marketing pour [sujet]"_',
      '',
      '👤 *Bio / Tagline :*',
      '  _"bio LinkedIn pour [profil]"_',
      '',
      '✏️ *Ajuster :*',
      '  _"plus court"_ / _"plus long"_ / _"plus formel"_',
      '  _"reformule : [texte]"_',
      '',
      '📋 _"mes contenus"_ — historique',
      '',
      '━━━━━━━━━━━━━━━━━━',
      '✍️ Content Gen | IA'
    ].join('\n');
  }
}

module.exports = ContentHandler;
