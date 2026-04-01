# Workflow Make.com — Onboarding automatisé iFIND

## Vue d'ensemble
Automatiser les emails d'onboarding après paiement Stripe.

## Trigger
- Module : Stripe — Watch Events
- Événement : `checkout.session.completed`
- Données récupérées : email client, nom, montant (pour identifier le plan)

## Scénario 1 : Email de bienvenue (T+0)
- Module : Email (Gmail ou SMTP)
- Template : Email 1 (bienvenue)
- Variables : prénom (depuis Stripe), lien dashboard
- Délai : immédiat

## Scénario 2 : Notification interne (T+0)
- Module : Telegram Bot — Send Message
- Chat ID : 1409505520 (Alexis)
- Message : "🎉 Nouveau client : [nom] — Plan [Pipeline/Multicanal] — [montant]€/mois"

## Scénario 3 : Email Popsicle (T+2h)
- Module : Sleep 2h
- Module : Email
- Template : Email 2 (popsicle)
- Note : les 5 emails doivent être rédigés manuellement AVANT et insérés dans le template

## Scénario 4 : Email questionnaire (T+24h)
- Module : Sleep 24h (ou Router + Schedule)
- Module : Email
- Template : Email 3 (questionnaire)
- Variables : lien Tally, lien Calendly

## Scénario 5 : Reminder conditionnel (T+72h)
- Module : Sleep 72h
- Module : HTTP — Check si questionnaire rempli (webhook Tally ou vérif manuelle)
- Module : Router — Si pas rempli → Email reminder (template 4)

## Scénario 6 : Questionnaire complété
- Trigger séparé : Webhook Tally (form submitted)
- Module : Telegram Bot — Notification "Questionnaire reçu pour [client]"
- Module : Google Sheets — Ajouter les réponses au tableur maître (optionnel)

## Configuration pas-à-pas

### 1. Créer un compte Make.com (gratuit)
- make.com → Sign up
- Plan gratuit = 1000 opérations/mois (largement suffisant pour 5-8 clients)

### 2. Connecter Stripe
- Ajouter module Stripe → Authorize → Entrer la clé API (Restricted Key, PAS la clé secrète live)
- Dans Stripe Dashboard → Developers → API Keys → Create Restricted Key
  - Permissions : Checkout Sessions (Read), Customers (Read)
  - Rien d'autre

### 3. Connecter Gmail/SMTP
- Ajouter module Email → Authorize avec benieralexis@gmail.com
- Ou utiliser SMTP Resend si déjà configuré

### 4. Connecter Telegram
- Ajouter module Telegram Bot
- Bot token : [à configurer]
- Chat ID : 1409505520

### 5. Tester le workflow
- Créer un payment link de test (1€) dans Stripe
- Payer avec une carte test (4242 4242 4242 4242)
- Vérifier que les emails partent dans l'ordre

## Schéma visuel

```
Stripe (checkout.session.completed)
  ├→ Email bienvenue (immédiat)
  ├→ Telegram notification (immédiat)
  ├→ Sleep 2h → Email Popsicle
  ├→ Sleep 24h → Email questionnaire
  └→ Sleep 72h → Check Tally → Si pas rempli → Email reminder

Tally (form submitted)
  ├→ Telegram notification
  └→ Google Sheets (optionnel)
```
