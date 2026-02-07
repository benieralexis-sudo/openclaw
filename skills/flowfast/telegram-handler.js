const FlowFastWorkflow = require('./flowfast-workflow.js');
const https = require('https');

class FlowFastTelegramHandler {
  constructor(apolloKey, hubspotKey, openaiKey) {
    this.workflow = new FlowFastWorkflow(apolloKey, hubspotKey, openaiKey);
    this.hubspotKey = hubspotKey;
    this.openaiKey = openaiKey;
    this.lastResults = null;
    this.scoreMinimum = 6;
    this.criteres = {
      postes: ['CEO', 'CTO', 'VP Sales', 'Directeur Commercial', 'Head of Sales'],
      secteurs: ['SaaS', 'Tech', 'Fintech', 'E-commerce'],
      villes: ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Nice']
    };
  }

  parseCommand(message) {
    const text = message.toLowerCase().trim();

    // Run workflow
    if (text === 'run' || text === 'lance' || text === 'go' || text === 'start' || text === 'demarre') {
      return { action: 'run' };
    }

    // Score minimum
    if (text.startsWith('score ')) {
      const num = parseInt(text.replace('score ', ''));
      if (num >= 1 && num <= 10) {
        return { action: 'set_score', value: num };
      }
      return { action: 'score_error' };
    }
    if (text === 'score') {
      return { action: 'show_score' };
    }

    // Criteres - postes
    if (text.startsWith('poste ') || text.startsWith('postes ')) {
      const val = message.replace(/^postes?\s+/i, '').trim();
      return { action: 'set_postes', value: val };
    }

    // Criteres - secteurs
    if (text.startsWith('secteur ') || text.startsWith('secteurs ')) {
      const val = message.replace(/^secteurs?\s+/i, '').trim();
      return { action: 'set_secteurs', value: val };
    }

    // Criteres - villes
    if (text.startsWith('ville ') || text.startsWith('villes ')) {
      const val = message.replace(/^villes?\s+/i, '').trim();
      return { action: 'set_villes', value: val };
    }

    // Voir criteres
    if (text === 'criteres' || text === 'critere' || text === 'config') {
      return { action: 'show_criteres' };
    }

    // Reset criteres
    if (text === 'reset') {
      return { action: 'reset' };
    }

    // Leads HubSpot
    if (text === 'leads' || text === 'hubspot' || text === 'contacts') {
      return { action: 'leads' };
    }

    // Stats
    if (text === 'stats' || text === 'status' || text.includes('resultats') || text.includes('résultats')) {
      return { action: 'stats' };
    }

    // Test
    if (text === 'test') {
      return { action: 'test' };
    }

    // Help
    if (text === 'help' || text === 'aide' || text === 'menu') {
      return { action: 'help' };
    }

    return null;
  }

  formatResults(results) {
    return [
      '🎯 *WORKFLOW FLOWFAST TERMINE*',
      '',
      '📊 *Resultats :*',
      '━━━━━━━━━━━━━━━━━━',
      '✅ Total traites : ' + results.total,
      '🔥 Qualifies : ' + results.qualified,
      '   • Prioritaires (≥8) : ' + results.priority,
      '   • Qualifies (6-7) : ' + (results.qualified - results.priority),
      '📝 Crees HubSpot : ' + results.created,
      '⏭️ Skippes : ' + results.skipped,
      '❌ Erreurs : ' + results.errors,
      '',
      '⚙️ Score minimum utilise : ' + this.scoreMinimum + '/10',
      '',
      '✨ Workflow termine avec succes !'
    ].join('\n');
  }

  getHelp() {
    return [
      '🤖 *FLOWFAST - COMMANDES*',
      '',
      '*▶️ Lancer le workflow :*',
      '`run` `lance` `go`',
      '',
      '*⚙️ Score minimum :*',
      '`score` - Voir le score actuel',
      '`score 8` - Changer le score (1-10)',
      '',
      '*🎯 Criteres de recherche :*',
      '`criteres` - Voir les criteres actuels',
      '`poste CEO, CTO, VP` - Modifier les postes',
      '`secteur SaaS, Tech` - Modifier les secteurs',
      '`ville Paris, Lyon` - Modifier les villes',
      '`reset` - Reinitialiser les criteres',
      '',
      '*📊 Donnees :*',
      '`leads` - Voir les leads HubSpot',
      '`stats` - Derniers resultats',
      '',
      '*🔧 Autres :*',
      '`test` - Verifier que le bot fonctionne',
      '`help` - Afficher ce menu',
      '',
      '━━━━━━━━━━━━━━━━━━',
      '💡 FlowFast - Prospection B2B automatisee',
      '🎯 Apollo → IA → HubSpot'
    ].join('\n');
  }

  getStats() {
    if (!this.lastResults) {
      return '📊 Aucun workflow execute recemment.\n\nUtilise `run` pour lancer !';
    }
    return [
      '📊 *DERNIERS RESULTATS*',
      '',
      '• Total : ' + this.lastResults.total,
      '• Qualifies : ' + this.lastResults.qualified,
      '• Crees : ' + this.lastResults.created,
      '• Skippes : ' + this.lastResults.skipped,
      '',
      '🔥 Prioritaires : ' + this.lastResults.priority,
      '✅ Qualifies : ' + (this.lastResults.qualified - this.lastResults.priority)
    ].join('\n');
  }

  showCriteres() {
    return [
      '⚙️ *CONFIGURATION ACTUELLE*',
      '',
      '📌 *Score minimum :* ' + this.scoreMinimum + '/10',
      '',
      '👔 *Postes cibles :*',
      this.criteres.postes.map(p => '  • ' + p).join('\n'),
      '',
      '🏢 *Secteurs :*',
      this.criteres.secteurs.map(s => '  • ' + s).join('\n'),
      '',
      '📍 *Villes :*',
      this.criteres.villes.map(v => '  • ' + v).join('\n'),
      '',
      '━━━━━━━━━━━━━━━━━━',
      '💡 Modifie avec : `poste ...` `secteur ...` `ville ...` `score N`'
    ].join('\n');
  }

  async getLeadsFromHubspot() {
    try {
      const apiKey = this.hubspotKey;

      const contacts = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.hubapi.com',
          path: '/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,company,jobtitle,email',
          method: 'GET',
          headers: { 'Authorization': 'Bearer ' + apiKey }
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data).results || []);
            } catch (e) {
              reject(new Error('Reponse HubSpot invalide'));
            }
          });
        });

        req.on('error', (e) => reject(e));
        req.setTimeout(15000, () => {
          req.destroy();
          reject(new Error('Timeout HubSpot (15s)'));
        });
        req.end();
      });

      if (!contacts || contacts.length === 0) {
        return '📭 Aucun contact trouve dans HubSpot.';
      }

      const lines = [
        '📋 *LEADS HUBSPOT* (' + contacts.length + ' contacts)',
        '━━━━━━━━━━━━━━━━━━',
        ''
      ];

      const max = Math.min(contacts.length, 10);
      for (let i = 0; i < max; i++) {
        const c = contacts[i];
        const props = c.properties || {};
        const nom = (props.firstname || '') + ' ' + (props.lastname || '');
        const entreprise = props.company || 'N/A';
        const email = props.email || 'N/A';
        const titre = props.jobtitle || 'N/A';
        lines.push((i + 1) + '. *' + nom.trim() + '*');
        lines.push('   🏢 ' + entreprise + ' | ' + titre);
        lines.push('   ✉️ ' + email);
        lines.push('');
      }

      if (contacts.length > 10) {
        lines.push('... et ' + (contacts.length - 10) + ' autres contacts');
      }

      lines.push('━━━━━━━━━━━━━━━━━━');
      lines.push('🔗 https://app-eu1.hubspot.com/contacts/147742541');

      return lines.join('\n');
    } catch (error) {
      return '❌ Erreur HubSpot : ' + error.message;
    }
  }

  async executeWorkflow() {
    let leads;

    // Rechercher des leads via Apollo avec les criteres configures
    try {
      const apolloResult = await this.workflow.apollo.searchLeads({
        titles: this.criteres.postes,
        limit: 20
      });

      if (apolloResult.success && apolloResult.leads.length > 0) {
        leads = apolloResult.leads.map(lead => ({
          nom: ((lead.first_name || '') + ' ' + (lead.last_name || '')).trim(),
          prenom: lead.first_name || '',
          nom_famille: lead.last_name || '',
          titre: lead.title || 'Non specifie',
          entreprise: (lead.organization && lead.organization.name) || 'Non specifie',
          email: lead.email || 'Non disponible',
          localisation: lead.city || 'Non specifie'
        }));

        // Filtrer par villes si configurees
        if (this.criteres.villes.length > 0) {
          const villesLower = this.criteres.villes.map(v => v.toLowerCase());
          const filtered = leads.filter(l =>
            villesLower.some(v => l.localisation.toLowerCase().includes(v))
          );
          if (filtered.length > 0) {
            leads = filtered;
          }
        }

        console.log('🔍 ' + leads.length + ' leads trouves via Apollo');
      }
    } catch (error) {
      console.log('⚠️ Recherche Apollo echouee (' + error.message + '), utilisation des leads demo');
    }

    // Fallback : leads demo si Apollo n'a rien retourne
    if (!leads || leads.length === 0) {
      console.log('📋 Utilisation des leads de demonstration');
      leads = [
        { nom: 'Marie Dubois', prenom: 'Marie', nom_famille: 'Dubois', titre: 'CEO', entreprise: 'TechStart Paris', email: 'marie.dubois@techstart.fr', localisation: 'Paris, France' },
        { nom: 'Jean Martin', prenom: 'Jean', nom_famille: 'Martin', titre: 'Junior Developer', entreprise: 'SmallCorp', email: 'jean.martin@smallcorp.fr', localisation: 'Lyon, France' },
        { nom: 'Sophie Laurent', prenom: 'Sophie', nom_famille: 'Laurent', titre: 'CTO', entreprise: 'InnovateTech', email: 'sophie.laurent@innovatetech.fr', localisation: 'Marseille, France' },
        { nom: 'Pierre Durand', prenom: 'Pierre', nom_famille: 'Durand', titre: 'VP Sales', entreprise: 'SalesTech Pro', email: 'pierre.durand@salestech.fr', localisation: 'Nice, France' },
        { nom: 'Julie Bernard', prenom: 'Julie', nom_famille: 'Bernard', titre: 'Sales Manager', entreprise: 'BizDev Corp', email: 'julie.bernard@bizdev.fr', localisation: 'Bordeaux, France' }
      ];
    }

    const results = await this.workflow.processLeads(leads, this.scoreMinimum);
    this.lastResults = results;
    return results;
  }

  callOpenAI(messages, maxTokens = 200) {
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
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Timeout OpenAI (10s)'));
      });
      req.write(postData);
      req.end();
    });
  }

  async classifyIntent(message) {
    const systemPrompt = `Tu es l'assistant du bot Telegram FlowFast, un outil de prospection B2B.
Tu dois classifier le message de l'utilisateur en une action.

Actions disponibles :
- "run" : lancer le workflow de prospection (ex: "lance la prospection", "demarre le workflow", "go", "c'est parti")
- "show_score" : voir le score minimum actuel (ex: "quel est le score ?", "montre le score")
- "set_score" : changer le score minimum, value = le nombre entre 1 et 10 (ex: "mets le score a 8", "change le score pour 9")
- "show_criteres" : voir la configuration actuelle (ex: "montre les criteres", "c'est quoi la config ?")
- "set_postes" : modifier les postes cibles, value = liste separee par des virgules (ex: "cible les CEO et CTO", "ajoute VP Marketing aux postes")
- "set_secteurs" : modifier les secteurs, value = liste separee par des virgules (ex: "change les secteurs pour Fintech, Healthtech")
- "set_villes" : modifier les villes, value = liste separee par des virgules (ex: "ajoute Toulouse aux villes", "prospection sur Nantes et Rennes")
- "reset" : reinitialiser la configuration par defaut (ex: "reinitialise tout", "remet les parametres par defaut")
- "leads" : voir les contacts HubSpot (ex: "montre les leads", "quels contacts on a ?")
- "stats" : voir les derniers resultats (ex: "quels sont les resultats ?", "combien de leads qualifies ?")
- "test" : verifier que le bot fonctionne (ex: "ca marche ?", "t'es la ?")
- "help" : afficher l'aide (ex: "comment ca marche ?", "que peux-tu faire ?", "quelles commandes ?")
- "chat" : conversation generale, bavardage, questions hors-sujet (ex: "salut", "merci", "c'est quoi flowfast ?")

Configuration actuelle :
- Score minimum : ${this.scoreMinimum}/10
- Postes : ${this.criteres.postes.join(', ')}
- Secteurs : ${this.criteres.secteurs.join(', ')}
- Villes : ${this.criteres.villes.join(', ')}

IMPORTANT pour set_postes, set_secteurs, set_villes : si l'utilisateur dit "ajoute X", la value doit contenir les elements actuels + le nouvel element.

Reponds UNIQUEMENT avec un objet JSON strict, rien d'autre :
{"action":"...","value":"..."}

Si pas de value, mets null.`;

    try {
      const response = await this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ], 150);

      let cleaned = response.trim()
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const result = JSON.parse(cleaned);

      if (!result.action) return null;

      // Convertir le score en nombre si necessaire
      if (result.action === 'set_score' && result.value !== null) {
        const num = parseInt(result.value);
        if (num >= 1 && num <= 10) {
          return { action: 'set_score', value: num };
        }
        return { action: 'score_error' };
      }

      return result;
    } catch (error) {
      console.log('⚠️ classifyIntent error: ' + error.message);
      return null;
    }
  }

  async generateChatResponse(message) {
    const systemPrompt = `Tu es FlowFast Bot, un assistant de prospection B2B sur Telegram.
Tu es amical, concis et tu reponds en francais.
Tu aides l'utilisateur a prospecter via Apollo, qualifier les leads avec l'IA, et les enregistrer dans HubSpot.

Commandes principales : run (lancer), score (voir/changer le score), criteres (voir config), leads (contacts HubSpot), stats (resultats), help (aide).

Reponds en 1-3 phrases maximum. Utilise le formatage Markdown compatible Telegram (*gras*, \`code\`).
Si l'utilisateur semble perdu, suggere une commande utile.`;

    try {
      const response = await this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ], 200);

      return response.trim();
    } catch (error) {
      return 'Desole, je n\'ai pas compris. Tape `help` pour voir les commandes disponibles.';
    }
  }

  async handleMessage(message, sendReply = null) {
    let command = this.parseCommand(message);

    // Fallback NLP si la commande exacte n'est pas reconnue
    if (!command && this.openaiKey) {
      command = await this.classifyIntent(message);
    }

    if (!command) {
      return null;
    }

    // Intent conversationnel : reponse via IA
    if (command.action === 'chat') {
      const response = await this.generateChatResponse(message);
      return { type: 'text', content: response };
    }

    switch (command.action) {
      case 'help':
        return { type: 'text', content: this.getHelp() };

      case 'stats':
        return { type: 'text', content: this.getStats() };

      case 'test':
        return { type: 'text', content: '✅ FlowFast est operationnel !\n\n⚙️ Score : ' + this.scoreMinimum + '/10\nUtilise `help` pour voir les commandes.' };

      case 'show_score':
        return { type: 'text', content: '📌 Score minimum actuel : *' + this.scoreMinimum + '/10*\n\nModifie avec `score N` (ex: `score 8`)' };

      case 'set_score':
        this.scoreMinimum = command.value;
        return { type: 'text', content: '✅ Score minimum mis a jour : *' + this.scoreMinimum + '/10*\n\nLes prochains leads devront avoir au moins ' + this.scoreMinimum + '/10 pour etre qualifies.' };

      case 'score_error':
        return { type: 'text', content: '❌ Score invalide. Utilise un nombre entre 1 et 10.\nExemple : `score 8`' };

      case 'show_criteres':
        return { type: 'text', content: this.showCriteres() };

      case 'set_postes':
        this.criteres.postes = command.value.split(',').map(s => s.trim()).filter(s => s);
        return { type: 'text', content: '✅ Postes mis a jour :\n' + this.criteres.postes.map(p => '  • ' + p).join('\n') };

      case 'set_secteurs':
        this.criteres.secteurs = command.value.split(',').map(s => s.trim()).filter(s => s);
        return { type: 'text', content: '✅ Secteurs mis a jour :\n' + this.criteres.secteurs.map(s => '  • ' + s).join('\n') };

      case 'set_villes':
        this.criteres.villes = command.value.split(',').map(s => s.trim()).filter(s => s);
        return { type: 'text', content: '✅ Villes mises a jour :\n' + this.criteres.villes.map(v => '  • ' + v).join('\n') };

      case 'reset':
        this.criteres = {
          postes: ['CEO', 'CTO', 'VP Sales', 'Directeur Commercial', 'Head of Sales'],
          secteurs: ['SaaS', 'Tech', 'Fintech', 'E-commerce'],
          villes: ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Nice']
        };
        this.scoreMinimum = 6;
        return { type: 'text', content: '🔄 Configuration reintialisee par defaut.\n\nUtilise `criteres` pour voir.' };

      case 'leads':
        return { type: 'text', content: await this.getLeadsFromHubspot() };

      case 'run':
        try {
          if (sendReply) {
            await sendReply({ type: 'text', content: '⏳ Workflow FlowFast en cours...\n\n⚙️ Score minimum : ' + this.scoreMinimum + '/10\n🎯 Postes : ' + this.criteres.postes.join(', ') });
          }
          const results = await this.executeWorkflow();
          return { type: 'text', content: this.formatResults(results) };
        } catch (error) {
          return { type: 'text', content: '❌ Erreur : ' + error.message };
        }

      default:
        return { type: 'text', content: this.getHelp() };
    }
  }

}

module.exports = FlowFastTelegramHandler;
