# iFIND Bot — Contexte Projet

## Infrastructure
- Serveur : srv1319748.hstgr.cloud (76.13.137.130)
- Repertoire : /opt/moltbot/
- Docker Compose : 3 containers (telegram-router, mission-control, landing-page) + 15 volumes data
- GitHub : benieralexis-sudo/openclaw

## Bot Telegram
- Bot : @Myironpro_bot (Mr.Krabs / Mister Krabs)
- Token : dans .env (TELEGRAM_BOT_TOKEN)
- Proprietaire : Jojo (chat_id: 1409505520, email: benieralexis@gmail.com)
- Mode : bot conversationnel (NLP GPT-4o-mini + memoire 15 msg/user)

## Architecture
- `gateway/telegram-router.js` — Routeur central Telegram (long polling, NLP routing, conversation IA)
- `gateway/app-config.js` — Config globale persistante (mode standby/production, budget API)
- `gateway/skill-loader.js` — Chargeur de modules cross-skill centralise
- `gateway/utils.js` — Utilitaires partages (atomic write, retry async, truncate input)
- `gateway/shared-nlp.js` — Module NLP partage (callOpenAI)
- `gateway/circuit-breaker.js` — Circuit breaker pour API externes
- `gateway/logger.js` — Logger structure

## Skills (13)
| # | Skill | Dossier | Modele IA |
|---|-------|---------|-----------|
| 1 | AutoMailer (campagnes emails) | `skills/automailer/` | Claude Sonnet 4.5 + GPT-4o-mini |
| 2 | CRM Pilot (HubSpot) | `skills/crm-pilot/` | GPT-4o-mini |
| 3 | Lead Enrich (FullEnrich waterfall) | `skills/lead-enrich/` | GPT-4o-mini |
| 4 | Content Gen (redaction multi-format) | `skills/content-gen/` | Claude Sonnet 4.5 + GPT-4o-mini |
| 5 | Invoice Bot (facturation chiffree) | `skills/invoice-bot/` | GPT-4o-mini |
| 6 | Proactive Agent (rapports + alertes) | `skills/proactive-agent/` | Claude Sonnet 4.5 |
| 7 | Self-Improve (optimisation hebdo) | `skills/self-improve/` | Claude Opus 4.6 + GPT-4o-mini |
| 8 | Web Intelligence (veille marche) | `skills/web-intelligence/` | Claude Sonnet 4.5 + GPT-4o-mini |
| 9 | System Advisor (monitoring systeme) | `skills/system-advisor/` | Claude Sonnet 4.5 + GPT-4o-mini |
| 10 | Autonomous Pilot (orchestration IA) | `skills/autonomous-pilot/` | Claude Opus 4.6 |
| 11 | Inbox Manager (surveillance IMAP) | `skills/inbox-manager/` | GPT-4o-mini |
| 12 | Meeting Scheduler (prise de RDV) | `skills/meeting-scheduler/` | GPT-4o-mini |
| 13 | Routeur central | `gateway/telegram-router.js` | GPT-4o-mini |

*Note : `skills/flowfast/apollo-connector.js` et `skills/flowfast/storage.js` sont conserves — utilises par Autonomous Pilot pour Apollo et le stockage leads.*

## Intelligence Reelle v5
- **ProspectResearcher** : recherche pre-envoi (scrape site, Google News, Apollo org, Lead Enrich, Web Intel articles)
- **Brain + Web Intelligence** : brain prompt enrichi avec articles, tendances, signaux marche
- **Signaux marche** : detection regex (funding, hiring, product_launch, leadership_change, expansion, acquisition)
- **Mini-cycles** : 12h/15h, 0$ cout (pas d'appel Claude), check signaux × leads existants
- **Auto-sync watches** : creation automatique de watches Web Intel pour chaque industrie dans les criteres

## Dashboard Mission Control
- URL : https://srv1319748.hstgr.cloud (HTTPS, nginx reverse proxy)
- Container : `mission-control` (node:20-alpine), port 127.0.0.1:3000
- Auth : cookie httpOnly+secure (24h), bcrypt hash, rate limit login (5/min Express + 5/min nginx)
- Securite : helmet.js (CSP strict), HSTS, fail2ban, certificat Let's Encrypt
- 13 pages : Overview, Prospection, Emails, CRM, Enrichissement, Contenu, Facturation, Proactif, Auto-Amelioration, Web Intelligence, Systeme, Inbox, Meetings
- Lecture seule des volumes data de chaque skill

## Architecture multi-modele
- **GPT-4o-mini** : NLP routeur + classification intentions dans chaque handler
- **Claude Sonnet 4.5** : redaction emails, contenu, humanisation, conversation business, rapports
- **Claude Opus 4.6** : Self-Improve (analyse hebdo), Brain cycles (decisions autonomes), Proactive (rapports hebdo/mensuel)

## Crons (planning optimise — anti-spam)
| Heure | Skill | Action |
|-------|-------|--------|
| 6h30 | System Advisor | Rapport quotidien systeme |
| 8h00 | Proactive Agent | Rapport matinal unifie (PA + AP) |
| 9h00 | Autonomous Pilot | Brain Cycle AM |
| 9h30 | Proactive Agent | Alertes pipeline |
| 10h00 | Web Intelligence | Digest quotidien |
| 12h00 | Autonomous Pilot | Mini-cycle (0$ — pas d'appel IA) |
| 15h00 | Autonomous Pilot | Mini-cycle (0$ — pas d'appel IA) |
| 18h00 | Autonomous Pilot | Brain Cycle PM |
| */6h | Web Intelligence | Scan automatique des veilles |
| */30min | Proactive Agent | Check statuts emails Resend |
| */1h | Proactive Agent | Smart alerts |
| */5min | System Advisor | Snapshot systeme |
| */1h | System Advisor | Health check |
| Dim 21h | Self-Improve | Analyse hebdomadaire |
| Lun 0h | Autonomous Pilot | Weekly reset |
| Lun 10h30 | System Advisor | Rapport hebdo systeme |
| Lun 11h | Proactive Agent | Rapport hebdomadaire |
| Lun 14h | Web Intelligence | Digest hebdomadaire |
| 1er du mois 9h | Proactive Agent | Rapport mensuel |

## Robustesse
- Ecriture atomique sur tous les fichiers storage (tmp + rename)
- Retry exponentiel sur appels API (OpenAI, Claude, Telegram)
- Circuit breaker sur API externes (Resend, HubSpot, Apollo)
- TTL 24h sur memoire conversationnelle (nettoyage horaire)
- Rate limiting messages (10 msg/30s par utilisateur)
- Validation/troncature des entrees NLP (max 2000 chars)
- Graceful shutdown avec drain 2s sur SIGTERM/SIGINT
- Budget API journalier avec notification et arret automatique
- Metriques persistees sur disque (/data/app-config/ifind-metrics.json)
- Chiffrement AES-256-GCM sur donnees sensibles (Invoice Bot)

## API Keys (dans .env)
- TELEGRAM_BOT_TOKEN
- OPENAI_API_KEY
- CLAUDE_API_KEY
- APOLLO_API_KEY
- FULLENRICH_API_KEY
- HUBSPOT_API_KEY
- RESEND_API_KEY
- SENDER_EMAIL (domaine Resend requis pour production)
- RESEND_WEBHOOK_SECRET
- DASHBOARD_PASSWORD
- API_DAILY_BUDGET (defaut: 5$)
- ADMIN_CHAT_ID (defaut: 1409505520)
- IMAP_HOST, IMAP_USER, IMAP_PASS (optionnel — Inbox Manager)
- CALCOM_API_KEY (optionnel — Meeting Scheduler)

## Commandes utiles
- Redemarrer : cd /opt/moltbot && docker compose down && docker compose up -d
- Logs router : docker compose logs --tail 50 telegram-router
- Logs dashboard : docker compose logs --tail 50 mission-control
- Status : docker compose ps

## Regles
- Toujours repondre en francais
- Le bot comprend le langage naturel (pas de commandes techniques)
- docker compose restart ne relit PAS le .env — faire down + up
- ESM vs CommonJS : `"type": "commonjs"` dans chaque skills/*/package.json et gateway/package.json
- Stockage JSON persistant par skill (volumes Docker separes)
- skills/ est dans .gitignore — utiliser `git add -f skills/` pour commit
