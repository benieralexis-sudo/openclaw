# Invoice Bot

Skill de facturation pour MoltBot. Cree, envoie et suit les factures via Telegram.

## Commandes

### Factures
- "cree une facture" — workflow multi-etapes
- "mes factures" — lister toutes les factures
- "FAC-001" — voir le detail
- "envoie la facture FAC-001" — envoyer par email (Resend)
- "FAC-001 payee" — marquer comme payee
- "factures impayees" — voir les retards

### Clients
- "nouveau client" — ajouter un client
- "mes clients" — voir la liste

### Entreprise
- "mes infos" — voir/modifier infos entreprise
- "modifier rib" — coordonnees bancaires

### Stats
- "stats facturation" — statistiques globales

## Architecture
- invoice-handler.js — NLP + logique metier
- invoice-generator.js — Generation HTML factures
- storage.js — Stockage persistant JSON
- Email via Resend API (meme cle que AutoMailer)
