# Self-Improve

Boucle d'amelioration continue du bot. Analyse les performances chaque semaine,
genere des recommandations concretes via IA, et applique les optimisations apres validation.

## Fonctionnalites

- Analyse hebdomadaire automatique (dimanche 21h)
- Collecte cross-skill : emails, leads, scoring, pipeline
- Recommandations IA : timing, longueur email, scoring, ciblage
- Feedback loop : prediction vs realite (accuracy du scoring)
- Backup automatique + rollback avant chaque modification
- Override pattern : pas de modification des fichiers source

## Commandes (langage naturel)

- "tes recommandations" : voir les suggestions d'amelioration
- "applique" : valider toutes les recommandations
- "applique 1 3" : valider des recommandations specifiques
- "ignore 2" : rejeter une recommandation
- "metriques" : stats de performance de la semaine
- "historique" : modifications appliquees
- "rollback" : annuler la derniere modification
- "analyse maintenant" : forcer une analyse immediate
- "status self-improve" : etat du systeme

## Stack

- Claude Sonnet 4.5 : analyse et recommandations
- OpenAI gpt-4o-mini : classification NLP
- Croner : cron hebdomadaire
- Cross-skill : AutoMailer, Lead Enrich, CRM Pilot (lecture seule)

## Architecture

- `self-improve-handler.js` : handler Telegram NLP + cron
- `metrics-collector.js` : collecte cross-skill
- `analyzer.js` : analyse IA + feedback loop
- `optimizer.js` : backup + application + rollback
- `storage.js` : persistance JSON
