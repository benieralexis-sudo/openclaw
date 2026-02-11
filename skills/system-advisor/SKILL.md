# System Advisor

Monitoring systeme et sante du bot MoltBot.

## Fonctionnalites

- **Status systeme** : RAM, CPU, disque, uptime en temps reel
- **Health checks** : verification automatique de la sante (RAM, disque, heap, CPU, storages)
- **Alertes** : notification Telegram si seuils critiques depasses (RAM/disque)
- **Rapports IA** : rapport quotidien (7h) et hebdomadaire (lundi 8h) via Claude Sonnet 4.5
- **Erreurs** : suivi des erreurs par skill
- **Temps de reponse** : latence par skill
- **Utilisation** : stats d'utilisation par skill (via global.__moltbotMetrics)
- **API monitoring** : test connectivite Telegram, Claude, OpenAI
- **Storage health** : verification des fichiers JSON de toutes les skills

## Crons

| Cron | Description |
|------|-------------|
| `*/5 * * * *` | Snapshot systeme (RAM, CPU, disque) |
| `0 * * * *` | Health check + alertes si critique |
| `0 7 * * *` | Rapport quotidien IA |
| `0 8 * * 1` | Rapport hebdomadaire IA |

## Commandes Telegram

- "status systeme" — vue d'ensemble
- "utilisation memoire" — details RAM/heap
- "espace disque" — stockage par skill
- "erreurs recentes" — bugs recents
- "skills les plus utilisees" — classement
- "temps de reponse" — latence par skill
- "uptime" — duree de fonctionnement
- "rapport systeme" — rapport complet IA
- "check sante" — health check immediat
- "alertes systeme" — alertes en cours
- "configure les seuils" — voir/modifier la config

## Fichiers

- `system-advisor-handler.js` — Handler NLP + crons
- `system-monitor.js` — Collecte metriques (os, process, child_process)
- `report-generator.js` — Rapports IA via Claude Sonnet 4.5
- `storage.js` — Stockage JSON persistant
- `index.js` — Point d'entree
