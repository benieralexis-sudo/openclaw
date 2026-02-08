---
name: flowfast
description: Prospection B2B - Recherche de leads par langage naturel via Apollo, qualification IA, export HubSpot.
metadata: { "openclaw": { "emoji": "🚀" } }
---

# FlowFast - Prospection B2B

Recherche de leads B2B en langage naturel. L'utilisateur dit ce qu'il cherche et le bot execute.

## IMPORTANT - Execution directe

**Ne jamais expliquer les commandes a l'utilisateur.** Toujours executer directement le handler avec le message EXACT de l'utilisateur.

Pour TOUT message de l'utilisateur lie a FlowFast (recherche de leads, prospection, score, stats, leads, help), executer :

```bash
node -e "
const H = require('/app/skills/flowfast/telegram-handler.js');
const h = new H(process.env.APOLLO_API_KEY, process.env.HUBSPOT_API_KEY, process.env.OPENAI_API_KEY);
h.handleMessage(process.argv[1]).then(r => { if(r && r.content) console.log(r.content); else console.log('Pas de reponse.'); }).catch(e => console.error('Erreur:', e.message));
" "MESSAGE_UTILISATEUR_ICI"
```

Remplacer `MESSAGE_UTILISATEUR_ICI` par le message exact de l'utilisateur, tel quel.

## Exemples

Si l'utilisateur dit : "cherche 5 agents immobiliers a Amsterdam"
→ Executer avec `"cherche 5 agents immobiliers a Amsterdam"`

Si l'utilisateur dit : "trouve 20 CEO fintech a Paris"
→ Executer avec `"trouve 20 CEO fintech a Paris"`

Si l'utilisateur dit : "score 8"
→ Executer avec `"score 8"`

Si l'utilisateur dit : "leads"
→ Executer avec `"leads"`

## Ce que le handler comprend

- **Recherche en langage naturel** : "cherche 10 developpeurs Java a Berlin", "trouve des CEO dans la tech a Paris", "20 agents immobiliers a Londres"
- **Score** : `score` (voir), `score 8` (changer)
- **Donnees** : `leads` (contacts HubSpot), `stats` (derniers resultats)
- **Autres** : `test`, `help`

Le handler utilise OpenAI pour extraire automatiquement les parametres de recherche (postes, ville, nombre, secteur) depuis le message en langage naturel, puis interroge Apollo et qualifie les leads par IA.

## Variables d'environnement requises

- `OPENAI_API_KEY` - Extraction de parametres NLP + qualification IA
- `HUBSPOT_API_KEY` - Export vers HubSpot CRM
- `APOLLO_API_KEY` - Recherche de leads
