// Autonomous Pilot - Handler conversationnel intelligent
// Philosophie : TOUT passe par Claude. Zero commande a retenir.
// Le client parle naturellement, le bot comprend et agit.
const https = require('https');
const storage = require('./storage.js');
const diagnostic = require('./diagnostic.js');
const { retryAsync } = require('../../gateway/utils.js');
const { getBreaker } = require('../../gateway/circuit-breaker.js');
const appConfig = require('../../gateway/app-config.js');
const log = require('../../gateway/logger.js');

// Limite d'actions par message (evite un emballement si Claude retourne trop d'actions)
const MAX_ACTIONS_PER_MESSAGE = 5;

class AutonomousHandler {
  constructor(openaiKey, claudeKey) {
    this.openaiKey = openaiKey;
    this.claudeKey = claudeKey;
  }

  async handleMessage(text, chatId, sendReply) {
    // TOUT passe par Claude — zero classification rigide
    if (!this.claudeKey) {
      return { type: 'text', content: '⚠️ Configuration en cours. Reessaie dans un instant.' };
    }

    try {
      const systemPrompt = this._buildSystemPrompt();
      const breaker = getBreaker('claude-sonnet', { failureThreshold: 3, cooldownMs: 60000 });
      const response = await breaker.call(() => retryAsync(() => this._callClaude(systemPrompt, text, 2000), 2, 3000));
      const parsed = this._parseResponse(response);

      // Executer les actions en backstage (max MAX_ACTIONS_PER_MESSAGE)
      let triggerBrain = false;
      const failedActions = [];
      const actionsToRun = parsed.actions.slice(0, MAX_ACTIONS_PER_MESSAGE);
      if (parsed.actions.length > MAX_ACTIONS_PER_MESSAGE) {
        log.warn('autonomous', 'Actions tronquees: ' + parsed.actions.length + ' -> ' + MAX_ACTIONS_PER_MESSAGE + ' (limite de securite)');
      }
      for (const action of actionsToRun) {
        try {
          await this._executeAction(action);
          if (action.type === 'force_brain_cycle') triggerBrain = true;
        } catch (e) {
          log.error('autonomous', 'Action echouee:', action.type, e.message);
          failedActions.push(action.type);
        }
      }

      // Si des actions ont echoue, ajouter une note discrete a la reponse
      let reply = parsed.reply;
      if (failedActions.length > 0) {
        reply += '\n\n_⚠️ Actions echouees en backstage : ' + failedActions.join(', ') + ' — je retenterai au prochain cycle._';
      }

      return {
        type: 'text',
        content: reply,
        _triggerBrainCycle: triggerBrain
      };
    } catch (e) {
      log.error('autonomous', 'Erreur chat:', e.message);
      // Fallback : reponse simple si Claude est indisponible
      return {
        type: 'text',
        content: '⚠️ Petit souci technique, reessaie dans quelques secondes.\n_(' + e.message + ')_'
      };
    }
  }

  // --- Construire le prompt systeme avec TOUT le contexte ---
  _buildSystemPrompt() {
    const config = storage.getConfig();
    const goals = storage.getGoals();
    const progress = storage.getProgress();
    const stats = storage.getStats();
    const learnings = storage.getLearnings();
    const recentActions = storage.getRecentActions(10);
    const experiments = storage.getActiveExperiments();
    const diagItems = storage.getOpenDiagnostics();
    const queued = storage.getQueuedActions();
    const g = goals.weekly;
    const sc = goals.searchCriteria;

    return `Tu es un assistant business IA sur Telegram. Tu t'appelles iFIND et tu geres la prospection commerciale de ton client.

TON STYLE:
- Tu parles naturellement, comme un collegue/associe
- Tu es direct, concret, oriente resultats
- Francais uniquement, ton decontracte mais pro
- Reponses courtes et percutantes (max 250 mots sauf si on te demande un plan detaille)
- Tu utilises le formatage Telegram: *gras*, _italique_
- Tu ne dis JAMAIS "en tant qu'IA" ou "je suis un bot" — tu parles comme un humain
- Si on te demande quelque chose que tu peux faire (changer un parametre, lancer une recherche...), tu le fais ET tu confirmes naturellement
- Si tu ne sais pas, tu le dis franchement

BUSINESS DU CLIENT:
${config.businessContext || 'Pas encore defini. Demande-lui ce qu il fait.'}

OFFRE:${config.offer?.description ? '\n' + config.offer.description : ''}${config.offer?.setup ? '\nSetup: ' + config.offer.setup + ' EUR' : ''}${config.offer?.monthly ? ' | Mensuel: ' + config.offer.monthly + ' EUR/mois' : ''}${config.offer?.commitment ? ' | Engagement: ' + config.offer.commitment : ''}${config.offer?.trial ? ' | Essai: ' + config.offer.trial : ''}

PREFERENCES EMAIL:${config.emailPreferences?.maxLines ? '\n- Max ' + config.emailPreferences.maxLines + ' lignes' : ''}${config.emailPreferences?.language ? ' | Langue: ' + config.emailPreferences.language : ''}${config.emailPreferences?.tone ? ' | Ton: ' + config.emailPreferences.tone : ''}${config.emailPreferences?.forbiddenWords?.length ? '\n- Mots interdits: ' + config.emailPreferences.forbiddenWords.join(', ') : ''}${config.emailPreferences?.hookStyle ? '\n- Accroche: ' + config.emailPreferences.hookStyle : ''}

CONFIGURATION SYSTEME:
- Email d'envoi: ${process.env.SENDER_EMAIL || 'non configure'}
- Resend: ${process.env.RESEND_API_KEY ? 'OK (cle configuree)' : 'non configure'}
- HubSpot: ${process.env.HUBSPOT_API_KEY ? 'OK' : 'non configure'}
- Apollo: ${process.env.APOLLO_API_KEY ? 'OK' : 'non configure'}
- FullEnrich: ${process.env.FULLENRICH_API_KEY ? 'OK' : 'non configure'}
- IMAP: ${process.env.IMAP_HOST ? 'OK (' + process.env.IMAP_HOST + ')' : 'non configure (optionnel)'}
- Cal.com: ${process.env.CALCOM_API_KEY ? 'OK' : 'non configure (optionnel)'}

ETAT ACTUEL:
- Mode: ${config.enabled ? 'Actif' : 'En pause'} | Autonomie: ${config.autonomyLevel}
- Leads: ${progress.leadsFoundThisWeek}/${g.leadsToFind} | Emails: ${progress.emailsSentThisWeek}/${g.emailsToSend}
- Reponses: ${progress.responsesThisWeek || 0}/${g.responsesTarget} | RDV: ${progress.rdvBookedThisWeek || 0}/${g.rdvTarget}
- Enrichis: ${progress.leadsEnrichedThisWeek} | CRM: ${progress.contactsPushedThisWeek}
- Brain cycles: ${stats.totalBrainCycles} | Actions: ${stats.totalActionsExecuted}
${stats.lastBrainCycleAt ? '- Dernier cycle: ' + new Date(stats.lastBrainCycleAt).toLocaleString('fr-FR') : ''}

PLANNING AUTOMATIQUE (les emails sont envoyes par le brain, PAS par les campagnes):
- Brain Cycle AM : tous les jours a 9h (recherche leads + envoi emails + push CRM)
- Brain Cycle PM : tous les jours a 18h (idem)
- Mini-cycles : 12h et 15h (check signaux marche, 0 cout)
- Le brain decide automatiquement quels leads contacter et quand

OBJECTIFS HEBDO:
- ${g.leadsToFind} leads (score >= ${g.minLeadScore}) | ${g.emailsToSend} emails | ${g.responsesTarget} reponses | ${g.rdvTarget} RDV
- Open rate min: ${g.minOpenRate}% | Push CRM si score >= ${g.pushToCrmAboveScore}

CRITERES DE RECHERCHE:
- Postes: ${(sc.titles || []).join(', ')}
- Villes: ${(sc.locations || []).join(', ')}
- Secteurs: ${(sc.industries || []).join(', ') || 'aucun'}
- Taille: ${(sc.companySize || []).join(', ')}
- Seniorites: ${(sc.seniorities || []).join(', ')}
${recentActions.length > 0 ? '\nDERNIERES ACTIONS:\n' + recentActions.slice(0, 5).map(a => '- ' + a.type + ': ' + (a.preview || '').substring(0, 80)).join('\n') : ''}
${experiments.length > 0 ? '\nEXPERIENCES A/B EN COURS:\n' + experiments.map(e => '- ' + (e.description || e.type)).join('\n') : ''}
${diagItems.length > 0 ? '\nPROBLEMES:\n' + diagItems.map(d => '- [' + d.priority + '] ' + d.message).join('\n') : ''}
${queued.length > 0 ? '\n' + queued.length + ' action(s) en attente de confirmation du client' : ''}
${learnings.bestSearchCriteria.length > 0 ? '\nMEILLEURS CRITERES: ' + learnings.bestSearchCriteria.slice(0, 2).map(c => c.summary).join(' | ') : ''}
${learnings.bestEmailStyles.length > 0 ? '\nMEILLEURS EMAILS: ' + learnings.bestEmailStyles.slice(0, 2).map(s => s.summary).join(' | ') : ''}
${learnings.weeklyPerformance.length > 0 ? '\nHISTORIQUE:\n' + learnings.weeklyPerformance.slice(0, 3).map(w => '- Sem ' + w.weekStart + ': ' + w.leadsFoundThisWeek + ' leads, ' + w.emailsSentThisWeek + ' emails, ' + (w.responsesThisWeek || 0) + ' rep').join('\n') : ''}

ACTIONS QUE TU PEUX DECLENCHER:
Si le client te demande de faire quelque chose (modifier un parametre, lancer une recherche, etc.), tu peux declencher des actions.
Pour ca, ajoute un bloc a la FIN de ta reponse (apres ta reponse naturelle) avec ce format exact :

<actions>
[{"type": "action_type", "params": {...}}]
</actions>

Actions disponibles:
- update_goals : modifier objectifs → params: {leadsToFind?, emailsToSend?, responsesTarget?, rdvTarget?, minLeadScore?}
- update_criteria : modifier recherche → params: {titles?, locations?, industries?, seniorities?, companySize?, keywords?}
- update_email_prefs : modifier emails → params: {maxLines?, language?, tone?, forbiddenWords?, hookStyle?}
- update_business : modifier contexte → params: {businessContext: "texte"}
- update_offer : modifier offre → params: {setup?, monthly?, commitment?, trial?, description?}
- update_autonomy : modifier autonomie → params: {level: "full|semi|manual"}
- pause : mettre en pause
- resume : reprendre
- force_brain_cycle : lancer un cycle brain immediatement
- run_diagnostic : lancer un diagnostic

REGLES ACTIONS:
- N'ajoute le bloc <actions> QUE si le client demande explicitement un changement ou une action
- Pour une simple question ou discussion, reponds naturellement SANS bloc actions
- Tu peux combiner plusieurs actions dans un seul bloc
- Le client ne voit JAMAIS le bloc actions — il est traite en backstage

EXEMPLES:
Client: "mets 30 leads par semaine" → Tu reponds "C'est fait, objectif passe a 30 leads/semaine !" + <actions>[{"type":"update_goals","params":{"leadsToFind":30}}]</actions>
Client: "ajoute Marseille" → Tu reponds "Marseille ajoutee ! On couvre maintenant 7 villes." + <actions>[{"type":"update_criteria","params":{"locations":${JSON.stringify([...(sc.locations || []), 'Marseille, FR'])}}}]</actions>
Client: "c'est quoi mon taux d'ouverture ?" → Tu reponds avec les stats SANS bloc actions
Client: "lance une recherche" → Tu reponds "C'est parti !" + <actions>[{"type":"force_brain_cycle","params":{}}]</actions>
Client: "pause" → "Ok c'est en pause." + <actions>[{"type":"pause","params":{}}]</actions>`;
  }

  // Actions autorisees (whitelist)
  static ALLOWED_ACTIONS = new Set([
    'update_goals', 'update_criteria', 'update_email_prefs',
    'update_business', 'update_offer', 'update_autonomy',
    'pause', 'resume', 'force_brain_cycle', 'run_diagnostic'
  ]);

  // --- Parser la reponse Claude : texte + actions ---
  _parseResponse(response) {
    let reply = response;
    let actions = [];

    // Extraire le bloc <actions> si present
    const actionsMatch = response.match(/<actions>\s*([\s\S]*?)\s*<\/actions>/);
    if (actionsMatch) {
      // Retirer le bloc actions de la reponse visible
      reply = response.replace(/<actions>[\s\S]*?<\/actions>/, '').trim();
      try {
        const rawParsed = JSON.parse(actionsMatch[1]);
        actions = Array.isArray(rawParsed) ? rawParsed : [rawParsed];
        // Valider chaque action : type obligatoire + whitelist + params object
        actions = actions.filter(a => {
          if (!a || typeof a !== 'object') {
            log.warn('autonomous', 'Action ignoree (pas un objet)');
            return false;
          }
          if (!a.type || typeof a.type !== 'string') {
            log.warn('autonomous', 'Action ignoree (type manquant ou invalide):', JSON.stringify(a).substring(0, 100));
            return false;
          }
          if (!AutonomousHandler.ALLOWED_ACTIONS.has(a.type)) {
            log.warn('autonomous', 'Action refusee (hors whitelist):', a.type);
            return false;
          }
          if (a.params && typeof a.params !== 'object') {
            log.warn('autonomous', 'Params invalides pour:', a.type);
            return false;
          }
          return true;
        });
      } catch (e) {
        log.warn('autonomous', 'Erreur parse actions JSON, continue sans actions:', e.message);
        actions = [];
      }
    }

    return { reply, actions };
  }

  // --- Executer une action en backstage ---
  async _executeAction(action) {
    const type = action.type;
    const params = action.params || {};

    log.info('autonomous', 'Action backstage:', type, JSON.stringify(params).substring(0, 150));

    switch (type) {
      case 'update_goals':
        storage.updateWeeklyGoals(params);
        break;

      case 'update_criteria':
        storage.updateSearchCriteria(params);
        break;

      case 'update_email_prefs':
        storage.updateEmailPreferences(params);
        break;

      case 'update_business':
        if (params.businessContext) {
          storage.updateConfig({ businessContext: params.businessContext });
        }
        break;

      case 'update_offer':
        storage.updateOffer(params);
        break;

      case 'update_autonomy':
        if (params.level) {
          storage.updateConfig({ autonomyLevel: params.level });
        }
        break;

      case 'pause':
        storage.updateConfig({ enabled: false });
        break;

      case 'resume':
        storage.updateConfig({ enabled: true });
        break;

      case 'force_brain_cycle':
        // Le flag _triggerBrainCycle est gere dans handleMessage
        break;

      case 'run_diagnostic':
        diagnostic.runFullDiagnostic();
        break;

      default:
        log.warn('autonomous', 'Action inconnue:', type);
    }
  }

  // --- Appel Claude API ---
  _callClaude(systemPrompt, userMessage, maxTokens) {
    // Budget guard
    appConfig.assertBudgetAvailable();

    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: maxTokens || 2000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userMessage }
        ]
      });

      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.claudeKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.content && json.content[0]) {
              // Budget tracking — input/output separes
              if (json.usage) {
                appConfig.recordApiSpend('claude-sonnet-4-5-20250929', json.usage.input_tokens || 0, json.usage.output_tokens || 0);
              }
              resolve(json.content[0].text);
            } else {
              reject(new Error('Reponse Claude invalide: ' + data.substring(0, 200)));
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout Claude')); });
      req.write(body);
      req.end();
    });
  }

  // Lifecycle
  start() {}
  stop() {}
}

module.exports = AutonomousHandler;
