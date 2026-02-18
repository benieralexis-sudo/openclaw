# iFIND Bot v5.3 "Machine de Guerre" — Contexte Projet

## Infrastructure
- Serveur : srv1319748.hstgr.cloud (76.13.137.130)
- Repertoire : /opt/moltbot/
- Docker Compose : 3 containers (telegram-router, mission-control, landing-page) + 16 volumes data
- GitHub : benieralexis-sudo/openclaw
- Domaine : ifind.fr — Resend domain VERIFIED
- Mode : FULL AUTO (Brain envoie emails sans confirmation humaine)

## Bot Telegram
- Bot : @Myironpro_bot (Mr.Krabs / Mister Krabs)
- Token : dans .env (TELEGRAM_BOT_TOKEN)
- Proprietaire : Jojo / Alexis (chat_id: 1409505520, email: benieralexis@gmail.com)
- Mode : bot conversationnel (NLP GPT-4o-mini + memoire 15 msg/user)

## Architecture
- `gateway/telegram-router.js` — Routeur central Telegram (1 581 lignes — long polling, NLP routing, webhook Resend, conversation IA)
- `gateway/app-config.js` — Config globale persistante (mode standby/production, budget API 5$/jour)
- `gateway/skill-loader.js` — Chargeur de modules cross-skill centralise
- `gateway/utils.js` — Utilitaires partages (atomic write, retry async, truncate input)
- `gateway/shared-nlp.js` — Module NLP partage (callOpenAI)
- `gateway/circuit-breaker.js` — Circuit breaker pour API externes
- `gateway/logger.js` — Logger structure
- `gateway/report-workflow.js` — Workflow rapport prospect (landing page)

## Metriques codebase
- **75 fichiers source** (JS + HTML/CSS)
- **~27 000 lignes** de code JS applicatif
- **~2 580 lignes** infra (docker-compose, dashboard, landing)
- **16 volumes Docker** persistants
- **19 crons** actifs
- **Score global : 8.4/10**

## Skills (13)
| # | Skill | Dossier | Modele IA | Score | Lignes |
|---|-------|---------|-----------|-------|--------|
| 1 | AutoMailer (campagnes emails) | `skills/automailer/` | Claude Sonnet 4.6 + GPT-4o-mini | 9/10 | 2 649 |
| 2 | CRM Pilot (HubSpot) | `skills/crm-pilot/` | GPT-4o-mini | 7/10 | 2 053 |
| 3 | Lead Enrich (FullEnrich waterfall) | `skills/lead-enrich/` | GPT-4o-mini | 8/10 | 2 092 |
| 4 | Content Gen (redaction multi-format) | `skills/content-gen/` | Claude Sonnet 4.6 + GPT-4o-mini | 7/10 | 1 020 |
| 5 | Invoice Bot (facturation chiffree) | `skills/invoice-bot/` | GPT-4o-mini | 7.5/10 | 1 596 |
| 6 | Proactive Agent (rapports + alertes) | `skills/proactive-agent/` | Claude Sonnet 4.6 | 8/10 | 2 003 |
| 7 | Self-Improve (optimisation bi-hebdo) | `skills/self-improve/` | Claude Opus 4.6 + GPT-4o-mini | 6/10 | 2 424 |
| 8 | Web Intelligence (veille marche) | `skills/web-intelligence/` | Claude Sonnet 4.6 + GPT-4o-mini | 9/10 | 2 663 |
| 9 | System Advisor (monitoring systeme) | `skills/system-advisor/` | Claude Sonnet 4.6 + GPT-4o-mini | 8/10 | 1 713 |
| 10 | Autonomous Pilot (cerveau autonome) | `skills/autonomous-pilot/` | Claude Opus 4.6 | 9.5/10 | 4 293 |
| 11 | Inbox Manager (surveillance IMAP) | `skills/inbox-manager/` | GPT-4o-mini | 3/10 | 627 |
| 12 | Meeting Scheduler (prise de RDV) | `skills/meeting-scheduler/` | GPT-4o-mini | 3/10 | 704 |
| 13 | Routeur central | `gateway/telegram-router.js` | GPT-4o-mini | 9.5/10 | 2 573 |

*Note : `skills/flowfast/apollo-connector.js` et `skills/flowfast/storage.js` sont conserves (596 lignes) — utilises par Autonomous Pilot pour Apollo et le stockage leads.*

## Machine de Guerre v5.3 (18 fev 2026)
- **Full auto** : send_email en autoExecute=true, 3-5 emails/cycle, _generateFirst obligatoire
- **Plain text** : plus de HTML branding, emails ressemblent a du Gmail humain
- **Sender** : "Alexis <hello@ifind.fr>" (pas "ifind")
- **Reply-To** : hello@ifind.fr sur tous les emails
- **30 mots interdits** : SDR, pipeline, pilote, 690, automatisation, solution, offre, etc.
- **Tone pair-a-pair** : un fondateur ecrit a un autre fondateur
- **ProspectResearcher ameliore** : DuckDuckGo first, UA rotation (5 UAs), DDG Lite fallback
- **Self-Improve bi-hebdo** : dimanche + mercredi 21h, autoApply confiance >= 50%
- **Modeles upgrades** : Opus 4.6 (brain/SI), Sonnet 4.6 (emails), GPT-4o-mini (routage)

## Intelligence Reelle v5
- **ProspectResearcher** : recherche pre-envoi 5 sources (scrape site, Google News RSS, Apollo org, Lead Enrich, LinkedIn via DuckDuckGo/cache)
- **Brain + Web Intelligence** : brain prompt enrichi avec articles, tendances, signaux marche
- **Signaux marche** : detection regex (funding, hiring, product_launch, leadership_change, expansion, acquisition)
- **Score Boost** : signaux marche boostent auto le score des leads (+0.5 a +2)
- **Mini-cycles** : 12h/15h, 0$ cout (pas d'appel Claude), check signaux × leads existants
- **Auto-sync watches** : creation automatique de watches Web Intel pour chaque industrie
- **Veilles CRM** : watches auto pour deals HubSpot (max 10/cycle)

## Dashboard Mission Control
- URL : https://srv1319748.hstgr.cloud (HTTPS, nginx reverse proxy)
- Container : `mission-control` (node:20-alpine), port 127.0.0.1:3000
- Auth : cookie httpOnly+secure (24h), bcrypt hash, rate limit login (5/min Express + 5/min nginx)
- Securite : helmet.js (CSP strict), HSTS, fail2ban, certificat Let's Encrypt
- 13 pages : Overview, Prospection, Emails, CRM, Enrichissement, Contenu, Facturation, Proactif, Auto-Amelioration, Web Intelligence, Systeme, Inbox, Meetings
- Lecture seule des volumes data de chaque skill

## Architecture multi-modele
- **GPT-4o-mini** : NLP routeur + classification intentions dans chaque handler + scoring leads
- **Claude Sonnet 4.6** : redaction emails + follow-up sequences + humanisation + conversation business + rapports
- **Claude Opus 4.6** : Brain cycles (decisions autonomes 2x/jour), Self-Improve (analyse bi-hebdo), Proactive (rapports hebdo/mensuel)
- **Cout estime** : ~0.60$/jour = ~18$/mois en API

## Crons (planning optimise — 19 crons)
| Heure | Skill | Action |
|-------|-------|--------|
| 6h30 | System Advisor | Rapport quotidien systeme |
| 8h00 | Proactive Agent | Rapport matinal unifie (PA + AP) |
| 9h00 | Autonomous Pilot | Brain Cycle AM (FULL AUTO) |
| 9h30 | Proactive Agent | Alertes pipeline |
| 10h00 | Web Intelligence | Digest quotidien |
| 12h00 | Autonomous Pilot | Mini-cycle (0$ — pas d'appel IA) |
| 15h00 | Autonomous Pilot | Mini-cycle (0$ — pas d'appel IA) |
| 18h00 | Autonomous Pilot | Brain Cycle PM (FULL AUTO) |
| */6h | Web Intelligence | Scan automatique des veilles |
| */30min | Proactive Agent | Check statuts emails Resend |
| */1h | Proactive Agent | Smart alerts |
| */5min | System Advisor | Snapshot systeme |
| */1h | System Advisor | Health check |
| Dim 21h | Self-Improve | Analyse bi-hebdomadaire |
| Mer 21h | Self-Improve | Analyse bi-hebdomadaire |
| Lun 0h | Autonomous Pilot | Weekly reset |
| Lun 10h30 | System Advisor | Rapport hebdo systeme |
| Lun 11h | Proactive Agent | Rapport hebdomadaire |
| Lun 14h | Web Intelligence | Digest hebdomadaire |
| 1er du mois 9h | Proactive Agent | Rapport mensuel |

## Tarification
| Plan | Prix/mois | Setup | Leads/mois | Emails | RDV estimes | Engagement |
|------|-----------|-------|------------|--------|-------------|------------|
| Pilot | 690€ | 990€ | 100 | 500 | 5-10 | 3 mois |
| Growth | 1 290€ | 990€ | 300 | 1 500 | 15-25 | 6 mois |
| Scale | 2 490€ | Offert | 600+ | 3 000+ | 30-50 | 12 mois |
- Essai pilote : 490€ / 2 semaines (tous plans)
- Cout infra : ~150€/mois → marge brute 78-94%

## Robustesse
- Ecriture atomique sur tous les fichiers storage (tmp + rename)
- Retry exponentiel sur appels API (OpenAI, Claude, Telegram)
- Circuit breaker sur API externes (Resend, HubSpot, Apollo)
- TTL 24h sur memoire conversationnelle (nettoyage horaire)
- Rate limiting messages (10 msg/30s par utilisateur)
- Validation/troncature des entrees NLP (max 2000 chars)
- Graceful shutdown avec drain 2s sur SIGTERM/SIGINT
- Budget API journalier avec notification et arret automatique (5$/jour)
- Metriques persistees sur disque (/data/app-config/ifind-metrics.json)
- Chiffrement AES-256-GCM sur donnees sensibles (Invoice Bot)
- Deduplication emails (automailer storage + blacklist avant envoi)
- Warmup progressif (5→10→20→50 emails/jour)

## API Keys (dans .env)
- TELEGRAM_BOT_TOKEN
- OPENAI_API_KEY
- CLAUDE_API_KEY (= ANTHROPIC_API_KEY dans le code)
- APOLLO_API_KEY
- FULLENRICH_API_KEY
- HUBSPOT_API_KEY
- RESEND_API_KEY (full-access, re_d7oRpcaR...)
- SENDER_EMAIL=hello@ifind.fr
- RESEND_WEBHOOK_SECRET
- DASHBOARD_PASSWORD
- API_DAILY_BUDGET (defaut: 5$)
- ADMIN_CHAT_ID (defaut: 1409505520)
- IMAP_HOST, IMAP_USER, IMAP_PASS (optionnel — Inbox Manager, non configure)
- CALCOM_API_KEY (optionnel — Meeting Scheduler, non configure)

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
- Toujours commit + push automatiquement apres modifications (preference Jojo)
