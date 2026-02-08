---
name: flowfast
description: Automatisation prospection B2B - Recherche Apollo, qualification IA, export HubSpot.
metadata: { "openclaw": { "emoji": "🚀" } }
---

# FlowFast - Automatisation Prospection B2B

Bot de prospection intelligent qui qualifie automatiquement les leads et les ajoute dans HubSpot.

## Execution

Toutes les commandes FlowFast s'executent via le script Node.js handler.
Le repertoire du skill est `/app/skills/flowfast/` (ou `/home/node/.openclaw/skills/flowfast/`).

### Commande generique

Pour toute commande FlowFast, executer :

```bash
node -e "
const H = require('/app/skills/flowfast/telegram-handler.js');
const h = new H(process.env.APOLLO_API_KEY, process.env.HUBSPOT_API_KEY, process.env.OPENAI_API_KEY);
h.handleMessage('COMMANDE_ICI').then(r => { if(r && r.content) console.log(r.content); else console.log('Pas de reponse.'); }).catch(e => console.error('Erreur:', e.message));
"
```

Remplacer `COMMANDE_ICI` par la commande souhaitee.

### Exemples concrets

**Lancer le workflow de prospection :**

```bash
node -e "
const H = require('/app/skills/flowfast/telegram-handler.js');
const h = new H(process.env.APOLLO_API_KEY, process.env.HUBSPOT_API_KEY, process.env.OPENAI_API_KEY);
h.handleMessage('run').then(r => console.log(r.content)).catch(e => console.error(e.message));
"
```

**Voir le score minimum :**

```bash
node -e "
const H = require('/app/skills/flowfast/telegram-handler.js');
const h = new H(process.env.APOLLO_API_KEY, process.env.HUBSPOT_API_KEY, process.env.OPENAI_API_KEY);
h.handleMessage('score').then(r => console.log(r.content));
"
```

**Changer le score minimum a 8 :**

```bash
node -e "
const H = require('/app/skills/flowfast/telegram-handler.js');
const h = new H(process.env.APOLLO_API_KEY, process.env.HUBSPOT_API_KEY, process.env.OPENAI_API_KEY);
h.handleMessage('score 8').then(r => console.log(r.content));
"
```

**Voir les criteres actuels :**

```bash
node -e "
const H = require('/app/skills/flowfast/telegram-handler.js');
const h = new H(process.env.APOLLO_API_KEY, process.env.HUBSPOT_API_KEY, process.env.OPENAI_API_KEY);
h.handleMessage('criteres').then(r => console.log(r.content));
"
```

**Voir les contacts HubSpot :**

```bash
node -e "
const H = require('/app/skills/flowfast/telegram-handler.js');
const h = new H(process.env.APOLLO_API_KEY, process.env.HUBSPOT_API_KEY, process.env.OPENAI_API_KEY);
h.handleMessage('leads').then(r => console.log(r.content));
"
```

## Commandes disponibles

| Commande | Description |
|----------|-------------|
| `run` | Lance le workflow complet (Apollo → IA → HubSpot) |
| `stats` | Derniers resultats du workflow |
| `test` | Verifier la connexion aux APIs |
| `score` | Voir le score minimum actuel |
| `score N` | Changer le score minimum (1-10) |
| `criteres` | Voir la configuration (postes, secteurs, villes) |
| `poste CEO, CTO` | Modifier les postes cibles |
| `secteur SaaS, Tech` | Modifier les secteurs cibles |
| `ville Paris, Lyon` | Modifier les villes cibles |
| `reset` | Reinitialiser la configuration |
| `leads` | Voir les contacts HubSpot |
| `help` | Afficher l'aide |

## Langage naturel

Le handler comprend aussi le francais via OpenAI (classification d'intent) :
- "lance la prospection" → `run`
- "quel est le score ?" → `score`
- "mets le score a 9" → `score 9`
- "ajoute Toulouse aux villes" → `ville ... Toulouse`

## Variables d'environnement requises

- `OPENAI_API_KEY` - Pour la qualification IA des leads
- `HUBSPOT_API_KEY` - Pour l'export vers HubSpot CRM
- `APOLLO_API_KEY` - Pour la recherche de leads (optionnel, donnees demo sinon)
