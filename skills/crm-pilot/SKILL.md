# CRM Pilot

Skill de pilotage CRM HubSpot depuis Telegram pour MoltBot.

## Fonctionnalites
- Gestion des contacts (lister, chercher, creer, modifier)
- Gestion des offres/deals (creer, modifier, suivre)
- Vue pipeline visuelle par etape
- Notes sur contacts et deals
- Taches et rappels avec dates
- Rapports hebdomadaires et stats

## Commandes (langage naturel)
- "mes contacts hubspot" — lister les contacts
- "cherche jean@example.com" — rechercher un contact
- "ajoute un contact" — creer un contact
- "mon pipeline" — resume visuel du pipeline
- "cree une offre" — nouveau deal
- "mes offres" — lister les deals
- "ajoute une note au contact..." — note sur un contact
- "cree une tache pour rappeler..." — tache avec date
- "rapport hebdo" — resume de la semaine
- "stats crm" — statistiques globales

## Stack
- HubSpot API v3/v4 (contacts, deals, pipeline, notes, taches, associations)
- OpenAI gpt-4o-mini (NLP / classification intent)
- Node.js pur (zero dependance)
