# Lead Enrich

Skill d'enrichissement et scoring de leads B2B pour MoltBot.

## Fonctionnalites
- Enrichir un lead par email, nom+entreprise ou LinkedIn (Apollo API)
- Scoring IA : secteur, taille entreprise, persona, score 1-10
- Enrichissement en masse des contacts HubSpot incomplets
- Enrichissement des listes AutoMailer
- Suivi des credits Apollo (free plan ~100/mois)
- Rapports et classement des leads prioritaires

## Commandes (langage naturel)
- "enrichis jean@example.com" — enrichir un lead
- "enrichis Jean Dupont chez Acme" — enrichir par nom
- "score de jean@example.com" — voir le scoring
- "enrichis mes contacts hubspot" — batch HubSpot
- "enrichis la liste Prospects" — batch AutoMailer
- "leads prioritaires" — top leads par score
- "rapport enrichissement" — statistiques
- "credits apollo" — credits restants

## Stack
- Apollo API (enrichissement /v1/people/match)
- OpenAI gpt-4o-mini (classification IA / scoring)
- HubSpot API (lecture/mise a jour contacts)
- Node.js pur (zero dependance)
