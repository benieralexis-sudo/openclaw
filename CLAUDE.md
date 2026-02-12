# MoltBot — Contexte Projet

## Infrastructure
- Serveur : srv1319748.hstgr.cloud (76.13.137.130)
- Repertoire : /opt/moltbot/
- Docker Compose : 3 containers (telegram-router, mission-control, openclaw-gateway) + 11 volumes data
- GitHub : benieralexis-sudo/openclaw

## Bot Telegram
- Bot : @Myironpro_bot (Mr.Krabs / Mister Krabs)
- Token : dans .env (TELEGRAM_BOT_TOKEN)
- Proprietaire : Jojo (chat_id: 1409505520, email: benieralexis@gmail.com)
- Mode : bot conversationnel (NLP GPT-4o-mini + memoire 15 msg/user)

## Architecture
- `gateway/telegram-router.js` — Routeur central Telegram (long polling, NLP routing, conversation IA)
- `gateway/moltbot-config.js` — Config globale persistante (mode standby/production, budget API)
- `gateway/utils.js` — Utilitaires partages (atomic write, retry async, truncate input)

## Skills (10)
| # | Skill | Dossier | Modele IA |
|---|-------|---------|-----------|
| 1 | FlowFast (prospection) | `skills/flowfast/` | GPT-4o-mini |
| 2 | AutoMailer (emails) | `skills/automailer/` | Claude Sonnet 4.5 + GPT-4o-mini |
| 3 | CRM Pilot (HubSpot) | `skills/crm-pilot/` | GPT-4o-mini |
| 4 | Lead Enrich (Apollo) | `skills/lead-enrich/` | GPT-4o-mini |
| 5 | Content Gen (redaction) | `skills/content-gen/` | Claude Sonnet 4.5 + GPT-4o-mini |
| 6 | Invoice Bot (facturation) | `skills/invoice-bot/` | GPT-4o-mini |
| 7 | Proactive Agent (alertes) | `skills/proactive-agent/` | Claude Haiku 4.5 |
| 8 | Self-Improve (optimisation) | `skills/self-improve/` | Claude Sonnet 4.5 + GPT-4o-mini |
| 9 | Web Intelligence (veille) | `skills/web-intelligence/` | Claude Sonnet 4.5 + GPT-4o-mini |
| 10 | System Advisor (monitoring) | `skills/system-advisor/` | Claude Sonnet 4.5 + GPT-4o-mini |

## Dashboard Mission Control
- URL : http://76.13.137.130:3000
- Container : `mission-control` (node:20-alpine)
- Auth : cookie httpOnly (24h), rate limit login (5/min)
- 11 pages : Overview, Prospection, Emails, CRM, Enrichissement, Contenu, Facturation, Proactif, Auto-Amelioration, Web Intelligence, Systeme
- Lecture seule des volumes data de chaque skill

## Architecture multi-modele
- **GPT-4o-mini** : NLP routeur + classification intentions dans chaque handler
- **Claude Sonnet 4.5** : redaction emails, contenu, humanisation, conversation business
- **Claude Opus 4.6** : Self-Improve (analyse hebdo), System Advisor (rapports), Proactive Agent (rapports hebdo/mensuel)

## Robustesse
- Ecriture atomique sur tous les fichiers storage (tmp + rename)
- Retry exponentiel sur appels API (OpenAI, Claude, Telegram)
- TTL 24h sur memoire conversationnelle (nettoyage horaire)
- Rate limiting messages (10 msg/30s par utilisateur)
- Validation/troncature des entrees NLP (max 2000 chars)
- Graceful shutdown avec drain 2s sur SIGTERM/SIGINT
- Budget API journalier avec notification et arret automatique

## API Keys (dans .env)
- TELEGRAM_BOT_TOKEN
- OPENAI_API_KEY
- CLAUDE_API_KEY
- APOLLO_API_KEY
- HUBSPOT_API_KEY
- RESEND_API_KEY
- SENDER_EMAIL (domaine Resend requis pour production)
- DASHBOARD_PASSWORD
- API_DAILY_BUDGET (defaut: 5$)
- ADMIN_CHAT_ID (defaut: 1409505520)

## Commandes utiles
- Redemarrer : cd /opt/moltbot && docker compose down && docker compose up -d
- Logs router : docker compose logs --tail 50 telegram-router
- Logs dashboard : docker compose logs --tail 50 mission-control
- Status : docker compose ps

## Regles
- Toujours repondre en francais
- Le bot comprend le langage naturel (pas de commandes techniques)
- Token Telegram : mettre a jour dans .env ET config/openclaw.json
- docker compose restart ne relit PAS le .env — faire down + up
- ESM vs CommonJS : `"type": "commonjs"` dans chaque skills/*/package.json et gateway/package.json
- Stockage JSON persistant par skill (volumes Docker separes)
