# AutoMailer

Skill d'emailing automatise pour MoltBot.

## Fonctionnalites
- Envoi d'emails ponctuels et campagnes/sequences
- Redaction IA via Claude (personnalisation par contact)
- Gestion de listes de contacts (import CSV, copier-coller)
- Templates d'emails reutilisables
- Scheduling automatique des sequences
- Dashboard web de suivi (port 3001)

## Commandes (langage naturel)
- "envoie un email a X" — email ponctuel
- "cree une campagne" — nouvelle sequence
- "mes campagnes" — liste des campagnes
- "mes contacts" / "mes listes" — gestion contacts
- "importe des contacts" — import CSV ou texte
- "cree un template" — nouveau modele
- "stats" — statistiques globales

## Stack
- Resend API (envoi)
- Claude API (redaction IA)
- OpenAI gpt-4o-mini (NLP / classification intent)
- Node.js pur (zero dependance)
