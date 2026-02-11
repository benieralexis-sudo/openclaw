# Web Intelligence

Veille web automatisee. Surveillance de prospects, concurrents et secteur
via Google News RSS, flux RSS custom et scraping web.

## Fonctionnalites

- Veilles configurables (prospect, concurrent, secteur)
- Google News RSS automatique par mots-cles
- Flux RSS custom
- Scraping web basique (regex, pas de headless browser)
- Analyse IA des articles (pertinence, resume, urgence)
- Croisement avec CRM HubSpot (detection mentions prospects)
- Digest quotidien + hebdomadaire
- Alertes instantanees pour mentions critiques

## Commandes (langage naturel)

- "surveille Salesforce" : creer une veille prospect
- "mes veilles" : lister les veilles actives
- "ajoute ce flux RSS https://..." : ajouter une source
- "quoi de neuf ?" : scan immediat
- "articles Salesforce" : derniers articles
- "tendances" : analyse IA des tendances
- "stats veille" : statistiques

## Stack

- Claude Sonnet 4.5 : analyse articles, tendances, digests
- OpenAI gpt-4o-mini : classification NLP
- Croner : crons (scan 6h, digest 9h, hebdo lundi 9h)
- Cross-skill : HubSpot (CRM Pilot) pour croisement contacts

## Architecture

- `web-intelligence-handler.js` : handler Telegram NLP + crons
- `web-fetcher.js` : collecte HTTP + parsing regex XML/HTML
- `intelligence-analyzer.js` : analyse IA Claude Sonnet
- `storage.js` : persistance JSON
