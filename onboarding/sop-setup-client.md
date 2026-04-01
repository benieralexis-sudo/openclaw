# SOP — Setup Technique Nouveau Client iFIND

## Pré-requis
- [ ] Contrat signé
- [ ] Paiement Stripe reçu
- [ ] Questionnaire onboarding complété
- [ ] Kickoff call fait

## J+0 — Jour de la signature
- [ ] Envoyer email bienvenue (template 1)
- [ ] Envoyer message perso WhatsApp/Telegram
- [ ] Rédiger 5 emails personnalisés (Popsicle Moment)
- [ ] Envoyer email Popsicle (template 2) avec screenshots des 5 emails

## J+1 — Questionnaire
- [ ] Envoyer email questionnaire + Calendly (template 3)

## J+2-3 — Setup domaines
- [ ] Acheter 2-3 domaines secondaires pour le client
  - Convention : [nom-client]-solutions.fr, [nom-client]-consulting.fr, etc.
  - Registrar : OVH ou Namecheap
  - Coût : ~10-15€/domaine/an
- [ ] Créer boîtes email sur chaque domaine (Google Workspace ou Zoho)
  - Convention : prenom@domaine1.fr, prenom@domaine2.fr
  - 1 boîte par domaine
- [ ] Configurer DNS : SPF + DKIM + DMARC sur chaque domaine
- [ ] Ajouter les comptes dans Instantly
  - Convention label : [CLIENT]-01-COLD, [CLIENT]-02-COLD, etc.
  - Activer warmup : 40/jour, reply rate 30%, weekdays only, read emulation ON
- [ ] Attendre warmup 21 jours minimum (45 jours = idéal)

## J+3 — Setup Clay + Bot
- [ ] Cloner la table Clay template pour le client
- [ ] Configurer les filtres Sales Nav selon ICP du questionnaire
- [ ] Importer premiers 50-100 leads dans Clay
- [ ] Activer les 7 enrichments auto (email waterfall, Google News, LinkedIn Posts, etc.)
- [ ] Configurer le bot : créer profil client (ICP, KB, ton, exclusions)
- [ ] Tester : générer 3 emails tests et vérifier qualité

## J+3 — Setup LinkedIn (Plan Multicanal uniquement)
- [ ] Envoyer invitation Expandi au client par email
- [ ] Client connecte son LinkedIn (ses identifiants, on ne voit rien)
- [ ] Vérifier IP résidentielle dédiée assignée (pays du client)
- [ ] Configurer limites safe : 20-30 connexions/jour, 50 messages/semaine
- [ ] Créer séquence LinkedIn : visite profil → connexion → message J+1 → follow-up J+5

## J+7 — Update #1
- [ ] Envoyer update client : "Domaines en warmup, voici vos 50 premiers prospects enrichis"
- [ ] Partager accès dashboard client

## J+14 — Update #2
- [ ] Envoyer update client : "Warmup à 80%, lancement dans 7 jours"

## J+21 — LANCEMENT
- [ ] Vérifier warmup score > 90% sur tous les domaines
- [ ] Envoyer première cohorte de 50 prospects
- [ ] Notifier le client : "Vos premiers emails sont partis !"
- [ ] Activer les follow-ups automatiques (J+3, J+10)
- [ ] Si Multicanal : lancer séquence LinkedIn en parallèle

## J+30 — Review mensuelle
- [ ] Préparer rapport mensuel (emails envoyés, opens, replies, RDV)
- [ ] Call review 30 min avec le client
- [ ] Ajuster ICP/ton/séquences si nécessaire
- [ ] Proposer upsell Multicanal si plan Pipeline

## Récurrent (chaque semaine)
- [ ] Vérifier délivrabilité (spam rate < 1%)
- [ ] Vérifier bounce rate < 3%
- [ ] Importer nouveaux leads dans Clay (50/semaine)
- [ ] Monitorer replies et transférer les intéressés au client

## Notes
- JAMAIS utiliser le domaine principal du client pour l'envoi
- TOUJOURS cohortes de 50 max (×2.76 reply rate)
- TOUJOURS < 80 mots par email
- Tracking pixels OFF
- Spread 30-90 secondes entre chaque envoi
- Tableur maître Google Sheet : Domaines / Clients / Campagnes
