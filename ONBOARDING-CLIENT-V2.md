# Onboarding nouveau client iFIND v2

**Sprint 4 (10/05/2026)** — Procédure complète pour onboarder un client en
production.

Effort total : **~10-15 minutes** (vs 1-2h en SQL direct avant).

---

## ⚡ Vue d'ensemble (TL;DR)

```
1. Connecte-toi en ADMIN sur https://app-v2.ifind.fr
2. /clients → bouton "+ Nouveau client" → wizard 3 étapes (~5 min)
3. /clients/[id] → Tab "Profil ICP" → enrichis (industries, NAF, anti-personas)
4. /clients/[id] → Tab "Delivery" → toggle digest hebdo + email client
5. SQL : crée user EDITOR (Frédéric-style) → INSERT INTO "User" ...
6. Brief le client : "Ton premier digest arrivera lundi prochain à 7h"
```

---

## Étape 1 — Créer le client (wizard UI)

1. Connecte-toi en **ADMIN** (`alexis@ifind.fr` ou `benieralexis@gmail.com`)
2. Va sur `/clients` → bouton **"+ Nouveau client"** en haut à droite (visible
   uniquement pour ADMIN)
3. **Wizard 3 étapes** :

   **Étape 1 — Informations entreprise**
   - **Nom** (obligatoire) : ex "Acme Corp"
   - **Slug** (auto-généré si vide) : `acme-corp`
   - **Raison sociale** : "ACME SAS" (optionnel)
   - **Industrie** : "SaaS B2B"
   - **Région** : "Île-de-France"
   - **Taille** : "PME"
   - **Email contact** : ex "alex@acmecorp.fr"
   - **Téléphone** : "+33 1 23 45 67 89"
   - **Plan** : `LEADS_DATA` (199€/mois) | `FULL_SERVICE` (890€/mois) | `CUSTOM`
   - **Statut initial** : `PROSPECT` (pour tester) ou `ACTIVE` (en prod direct)

   **Étape 2 — ICP de base**
   - **Industries cibles** (chips) : ex "SaaS B2B, ESN, FinTech"
   - **Tailles cibles** (chips, suggestions cliquables) : "11-50, 51-200"
   - **Régions cibles** (chips) : "Île-de-France, Auvergne-Rhône-Alpes"
   - **Codes NAF whitelist** (sans point) : "5829A, 6201Z, 6202A"
     - Préfixe accepté : "5829" matche "5829A/B/C"
   - **Anti-personas** (entreprises à exclure) : "Capgemini, Sopra, Atos"
     - Match partiel sur nom (ex: "Capgemini" exclut "Capgemini Engineering")
   - **Score minimum** (1-10) : 7 par défaut (Brûlants + Très chauds)

   **Étape 3 — Vérification + Création**
   - Récap visuel
   - Bouton "Créer le client"
   - Redirect automatique vers `/clients/[id]?welcome=1`

---

## Étape 2 — Enrichir l'ICP (optionnel mais recommandé)

Sur la fiche client `/clients/[id]` → Tab **"Profil ICP"** :
- Personas (titres + weights)
- Anti-personas étendus
- redFlagsHard / redFlagsSoft / nonRedFlags
- signalPrimary / signalSecondary
- pitchKeywords / pitchVerbatim
- dreamArchetype + proof_points
- fewShotPositives (dreamProspects + confirmedClients)

Ces champs sont utilisés par le judge V1+V2 pour scorer les triggers.

---

## Étape 3 — Configurer le delivery

Sur la fiche client → Tab **"Delivery"** (Sprint 3) :

### Section "Digest hebdomadaire"
- **Toggle ON**
- **Email destinataire** : email client final (ex `frederic@digitestlab.fr`)
- **Score minimum** : 7 par défaut
- **Nombre max de leads** : 15 par défaut
- Le digest sera envoyé **chaque lundi à 6h UTC** (~7-8h Paris)

### Section "Alertes Pépites en temps réel"
- **Toggle ON** (optionnel)
- **Email destinataire** : idem
- **Telegram chat ID** : optionnel (pour notification Telegram aussi)
- **Score Pépite** : 9 par défaut
- **Cap quotidien** : 10 alertes/jour max

### Section "Branding email"
- **Nom expéditeur** : "iFIND" ou "iFIND × DigitestLab"
- **Email expéditeur custom** : optionnel (sinon SENDER_EMAIL global)
- **Couleur primaire** : hex (#5B7CFA par défaut)

Sauvegarde — config persistée immédiatement.

---

## Étape 4 — Créer un user pour le client (EDITOR ou VIEWER)

⚠️ **Sprint 4 ne couvre PAS encore l'invitation user via UI**. À faire en SQL pour
l'instant (Sprint 5/6 fera l'UI invite-by-email).

```sql
-- Crée un user EDITOR rattaché au nouveau client
-- ⚠️ ne fonctionne que si le user n'existe pas déjà
INSERT INTO "User" (
  id, email, name, "emailVerified", role, "clientId",
  "scopeClientIds", "onboardingDone", "createdAt", "updatedAt"
) VALUES (
  'cuid-' || md5(random()::text),                -- ID auto
  'frederic@acmecorp.fr',                        -- email client
  'Frederic Smith',                              -- nom
  true,                                          -- pre-verified par admin
  'EDITOR',                                      -- ou 'VIEWER' si lecture seule
  'cmoxxxxxxxxxxxxx',                            -- ⚠️ remplacer par l'ID du client
  '{}',                                          -- scopeClientIds vide (pas commercial)
  false,                                         -- onboarding pas encore fait
  NOW(), NOW()
);
```

Pour l'authentification : 2 options :
1. **L'admin crée un mot de passe initial via Better Auth admin API** (à coder)
2. **Le user fait "Mot de passe oublié"** : pas encore implémenté → Sprint 5

**Workaround temporaire** : partager l'accès admin avec le client (comme Frédéric
fait actuellement avec ton compte Alexis).

---

## Étape 5 — Lancer le 1er cycle de capture

Le cron `run-pollers` tourne toutes les heures. Mais pour tester immédiatement :

```bash
# Trigger manuel pour le nouveau client
CRON_SECRET=$(grep ^CRON_SECRET /opt/moltbot/scripts/.run-pollers.env | cut -d= -f2)
NEW_CLIENT_ID="cmoxxxxxxxxxxxxx"  # remplacer
curl -sS -X POST -H "x-cron-secret: $CRON_SECRET" \
  "http://127.0.0.1:3100/api/internal/run-pollers?source=all&clientId=$NEW_CLIENT_ID" \
  --max-time 600 | jq
```

Sources captées :
- `apify.linkedin-jobs`, `apify.wttj-jobs`
- `theirstack.job-offer`, `theirstack.buying-intent`
- `francetravail.tech`
- `rss-levees`, `bodacc.*`, `inpi.trademark`
- `rodz.fundraising` (via webhook, automatique)

Coût indicatif :
- Quotas API mutualisés (Apify, TheirStack, Kaspr) — voir audit Sprint 1
- Anthropic ~$0.04/qualify Opus

---

## Étape 6 — Test du digest avant d'envoyer en réel

Pour vérifier que ton digest sera bien généré (sans envoi réel) :

```bash
CRON_SECRET=$(...)
NEW_CLIENT_ID=$(...)
curl -sS -X POST -H "x-cron-secret: $CRON_SECRET" \
  "http://127.0.0.1:3100/api/internal/run-weekly-digest?dryRun=true&clientId=$NEW_CLIENT_ID" \
  | jq
```

Réponse attendue :
- `status: "sent"` + `reason: "dry-run"` + `leadsCount`
- Si `status: "no-config"` → tu dois configurer Tab Delivery d'abord
- Si `status: "no-leads-no-mail"` → pas assez de leads sur 7j (normal pour
  client neuf, attendre 24-48h après lancer 1er cycle)

---

## Brief commercial à envoyer au client

Template de message à envoyer au client après onboarding :

```
Bonjour [Prénom],

Bienvenue chez iFIND. Voici comment ça va se passer :

1. Tu vas recevoir un email **chaque lundi à 7h** avec tes leads chauds de la
   semaine (max 15 leads, score Opus ≥ 7).

2. Si une "pépite" exceptionnelle est détectée (score ≥ 9), tu recevras une
   alerte instantanée par email.

3. Tu as accès au dashboard : https://app-v2.ifind.fr
   Login : ton email | Demande mot de passe à [admin@ifind.fr]

4. Sur le dashboard, tu peux :
   - Voir tous les briefs détaillés (verdict OUI/NON/ENRICH + opener prêt)
   - Ajuster ton ICP si tu veux affiner le ciblage
   - Marquer des leads "ignorés" si tu vois passer des hors-cible

Le moteur tourne en continu. Premier digest dans X jours.

Pour toute question : [admin@ifind.fr]
```

---

## Rollback en cas de problème

### Supprimer un client créé par erreur (avant prod)
```sql
-- Soft-delete (recommandé, conserve les données)
UPDATE "Client" SET "deletedAt" = NOW(), status = 'CHURNED'
WHERE id = 'cmoxxxxxxxxxxxxx';

-- Hard-delete (irréversible — uniquement si vraiment 0 lead/trigger lié)
DELETE FROM "Client" WHERE id = 'cmoxxxxxxxxxxxxx';
```

### Désactiver temporairement (sans perdre data)
```sql
UPDATE "Client" SET status = 'PAUSED' WHERE id = '...';
```

Le client devient invisible pour les pollers (filter `status = 'ACTIVE'`).

---

## Points d'attention

1. **Slug unique requis** : si "acme-corp" existe déjà, le wizard auto-suffixe
   "acme-corp-2".

2. **Country code par défaut "FR"** : le wizard ajoute automatiquement
   `country_codes: ["FR"]` dans l'ICP. Modifier en SQL si client international.

3. **Quotas mutualisés Anthropic/Apify/TheirStack** : si plus de 3 clients,
   surveiller les budgets. Voir audit complet Sprint 0/1 pour gates par client.

4. **Pas encore d'invite user UI** : voir Étape 4. Sprint 5+ ajoutera
   `POST /api/users` admin + email magic link.

5. **Anthropic doit être chargé** : sans ça, V1+V2 ne tournent pas → digest
   contiendra les triggers bruts sans brief raisonné. Rechargement = 30€-50€
   sur https://console.anthropic.com/settings/billing.

---

## Voir aussi

- `Sprint 0` : signup public bloqué + cleanup tenants fantômes
- `Sprint 1` : 4 nouveaux pollers (rss-levees, bodacc, inpi, joafe-stub)
- `Sprint 2` : shutdown bot trigger-engine (-21€/mois Anthropic)
- `Sprint 3` : infrastructure delivery (digest + alertes + UI)
- `Sprint 4` : POST /api/clients + wizard + tests multi-tenant (vous êtes ici)
- `Sprint 5` (à venir) : invite user UI + secrets Doppler + CI/CD
