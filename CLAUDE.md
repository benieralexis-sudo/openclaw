# MoltBot — Contexte Projet

## Infrastructure
- Serveur : srv1319748.hstgr.cloud (76.13.137.130)
- Repertoire : /opt/moltbot/
- Docker Compose : 3 services actifs (gateway, flowfast-bot, flowfast-dashboard)
- GitHub : benieralexis-sudo/openclaw

## Bot Telegram
- Bot : @Myironpro_bot (Mr.Krabs / Mister Krabs)
- Token : dans .env (TELEGRAM_BOT_TOKEN)
- Proprietaire : Jojo (chat_id: 1409505520)
- Mode : standalone (bypass OpenClaw agent routing)

## Architecture FlowFast
- `skills/flowfast/telegram-bot.js` — Bot Telegram standalone (long polling)
- `skills/flowfast/telegram-handler.js` — NLP + logique metier (OpenAI gpt-4o-mini)
- `skills/flowfast/apollo-connector.js` — Recherche leads Apollo
- `skills/flowfast/flowfast-workflow.js` — Scoring IA + push HubSpot
- `skills/flowfast/storage.js` — Stockage persistant JSON (volume Docker)
- `skills/flowfast/dashboard.js` — Dashboard web securise (port 3000)

## API Keys (dans .env)
- TELEGRAM_BOT_TOKEN
- OPENAI_API_KEY
- APOLLO_API_KEY (plan gratuit = recherche bloquee)
- HUBSPOT_API_KEY
- DASHBOARD_PASSWORD

## Commandes utiles
- Redemarrer : cd /opt/moltbot && docker compose down && docker compose up -d
- Logs bot : docker logs --tail 50 moltbot-flowfast-bot-1
- Logs dashboard : docker logs --tail 50 moltbot-flowfast-dashboard-1
- Status : docker compose ps

## Regles
- Toujours repondre en francais
- Le bot doit comprendre le langage naturel (pas de commandes techniques)
- Token Telegram : mettre a jour dans .env ET config/openclaw.json
- docker compose restart ne relit PAS le .env — faire down + up
