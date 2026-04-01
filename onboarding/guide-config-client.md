# Guide de configuration client — iFIND Bot

> **Temps estimé : 10 minutes** (une fois le questionnaire Tally rempli)
>
> Ce guide permet de configurer un nouveau client de A à Z dans le bot iFIND.

---

## Pré-requis

- [ ] Le client a rempli le questionnaire Tally (onboarding complet)
- [ ] Les réponses Tally sont ouvertes dans un onglet
- [ ] Le bot Docker est UP (`docker ps` pour vérifier)
- [ ] Les domaines d'envoi sont configurés dans Instantly (warmup 100%)

---

## Étape 1 — Créer le client dans le dashboard

```bash
curl -X POST https://srv1319748.hstgr.cloud/api/clients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer IFIND123!abc" \
  -d '{
    "name": "NOM_CLIENT",
    "email": "email@domaine-client.com",
    "status": "active"
  }'
```

Noter le `clientId` retourné (ex: `digidemat`, `digitestlab`).

---

## Étape 2 — Créer l'arborescence client

```bash
CLIENT_ID="nom-client"  # Remplacer par le clientId

mkdir -p /opt/moltbot/clients/${CLIENT_ID}/data/autonomous-pilot
mkdir -p /opt/moltbot/clients/${CLIENT_ID}/data/inbox-manager
```

---

## Étape 3 — Copier les templates

```bash
cp /opt/moltbot/onboarding/icp-template.json \
   /opt/moltbot/clients/${CLIENT_ID}/data/autonomous-pilot/icp.json

cp /opt/moltbot/onboarding/kb-template.json \
   /opt/moltbot/clients/${CLIENT_ID}/data/inbox-manager/knowledge-base.json
```

---

## Étape 4 — Remplir l'ICP (icp.json)

Ouvrir le fichier :
```bash
nano /opt/moltbot/clients/${CLIENT_ID}/data/autonomous-pilot/icp.json
```

### Mapping Tally → ICP

| Champ ICP | Question Tally | Notes |
|---|---|---|
| `_template_instructions` | — | **Supprimer toute la section** |
| `clientDescription` | Q7 (offre prospection) | 2-3 phrases, style naturel |
| `bookingUrl` | Lien Calendly/Cal.com | Demander au client si absent |
| `intentConfig.hiringKeywords` | Q13 (postes ciblés) | Convertir en mots-clés courts |
| `intentConfig.hiringAngle` | Q18 (trigger) + Q13 | Formuler l'angle recrutement |
| `niches[0]` (poids 50) | Q15 + Q19 (client idéal cloné) | Niche principale |
| `niches[1]` (poids 30) | Q15 (industrie secondaire) | Niche secondaire |
| `niches[2]` (poids 20) | Q15 (industrie tertiaire) | Niche tertiaire |
| `niche.painPoint` | Q6 (problème #1) | Adapter par niche |
| `niche.socialProof` | Q21 (avant/après) + Q22 (verbatim) | Preuve concrète |
| `niche.triggers` | Q18 (trigger achat) | 2-3 signaux par niche |
| `niche.exampleEmail` | Q25 (pitch) + Q26 (ton) + Q29 (CTA) | Email modèle <80 mots |

### Checklist ICP

- [ ] Supprimer `_template_instructions`
- [ ] Supprimer tous les commentaires `//` dans les valeurs
- [ ] `clientDescription` est naturel et précis
- [ ] `bookingUrl` est un lien valide
- [ ] `hiringKeywords` contient 5-8 titres de postes
- [ ] Chaque niche a un `painPoint` différent (pas copier-coller)
- [ ] Chaque `exampleEmail` fait <80 mots
- [ ] Le ton (tu/vous) correspond à Q26
- [ ] Les `weight` totalisent 100
- [ ] JSON valide (tester avec `jq . icp.json`)

---

## Étape 5 — Remplir la Knowledge Base (knowledge-base.json)

Ouvrir le fichier :
```bash
nano /opt/moltbot/clients/${CLIENT_ID}/data/inbox-manager/knowledge-base.json
```

### Mapping Tally → KB

| Champ KB | Question Tally | Notes |
|---|---|---|
| `_template_instructions` | — | **Supprimer toute la section** |
| `_meta.description` | — | Adapter langue et nom du contact fallback |
| `company.name` | Q1 (nom entreprise) | — |
| `company.tagline` | Q25 (pitch 15 sec) | 1 phrase courte |
| `company.description` | Q7 (offre prospection) | 2-3 phrases |
| `company.accountManager` | Q31 (qui prend les appels) | Nom complet |
| `services.main` | Q7 (offre) | 1 phrase résumé |
| `services.includes` | Q8 (3 arguments) + Q11 (lead magnet) | Liste des inclusions |
| `services.does_not_include` | — | Adapter au métier du client |
| `target.geography` | Q17 (zone géo) | — |
| `target.company_size` | Q14 (taille entreprise) | — |
| `target.decision_maker` | Q13 (postes ciblés) | — |
| `target.sectors` | Q15 (industries) | — |
| `process.steps` | Q29 (CTA) | Adapter les 3-4 étapes |
| `differentiators` | Q8 (arguments) + Q9 (vs concurrents) | 4-5 éléments |
| `pricing.range` | Q10 (fourchette prix) | Jamais de prix exact |
| `faq` | Q33 (objections + réponses) | 3 objections + 2 FAQ standard |
| `forbidden_claims` | Q27 (mots à éviter) | Ajouter aux 5 règles de base |
| `qualification.questions` | Q28 (aha moment) | 2-3 questions de qualification |
| `booking_url` | Lien Calendly/Cal.com | Même que dans icp.json |

### Checklist KB

- [ ] Supprimer `_template_instructions`
- [ ] Supprimer tous les commentaires `//` dans les valeurs
- [ ] `company.name` et `company.email` sont corrects
- [ ] `accountManager` est rempli (nom + disponibilités)
- [ ] `forbidden_claims` contient les mots à éviter de Q27
- [ ] Les FAQ couvrent les 3 objections principales (Q33)
- [ ] `fallback_phrase` est naturelle et dans la bonne langue
- [ ] `booking_url` est identique à celui de l'ICP
- [ ] JSON valide (tester avec `jq . knowledge-base.json`)

---

## Étape 6 — Validation JSON

```bash
# Vérifier que les deux fichiers sont du JSON valide
jq . /opt/moltbot/clients/${CLIENT_ID}/data/autonomous-pilot/icp.json > /dev/null && echo "ICP OK" || echo "ICP INVALIDE"
jq . /opt/moltbot/clients/${CLIENT_ID}/data/inbox-manager/knowledge-base.json > /dev/null && echo "KB OK" || echo "KB INVALIDE"
```

---

## Étape 7 — Redémarrer le container client

```bash
cd /opt/moltbot && docker compose restart
```

Vérifier les logs :
```bash
docker compose logs --tail=50 | grep -i "error\|loaded\|client"
```

---

## Étape 8 — Tester la génération d'emails

Générer 3 emails de test pour vérifier la qualité :

```bash
# Via l'API du bot (adapter le endpoint si nécessaire)
curl -X POST https://srv1319748.hstgr.cloud/api/test-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer IFIND123!abc" \
  -d '{
    "clientId": "CLIENT_ID",
    "count": 3
  }'
```

### Points à vérifier sur chaque email

- [ ] Le ton correspond à Q26 (tu/vous)
- [ ] Aucun mot interdit de Q27 n'apparaît
- [ ] Le pain point est pertinent pour la niche
- [ ] Le CTA correspond à Q29
- [ ] L'email fait <80 mots
- [ ] Aucune mention de bot/IA/automatisation
- [ ] Le social proof est factuel (pas inventé)
- [ ] L'email sonne naturel (pas template)

---

## Récapitulatif rapide (aide-mémoire)

```
1. POST /api/clients          → créer le client
2. mkdir -p clients/{id}/...  → arborescence
3. cp templates → client/     → copier ICP + KB
4. Ouvrir réponses Tally      → remplacer les [TALLY_QX]
5. Adapter niches/weights     → selon le marché du client
6. jq . *.json                → valider le JSON
7. docker compose restart     → redémarrer
8. Tester 3 emails            → vérifier qualité
```

**Temps total : ~10 minutes** si le questionnaire est bien rempli.

---

## Dépannage

| Problème | Solution |
|---|---|
| JSON invalide | `jq . fichier.json` montre l'erreur exacte |
| Emails trop longs | Raccourcir `painPoint` et `exampleEmail` (<80 mots) |
| Ton incorrect | Vérifier Q26 et adapter vouvoiement/tutoiement partout |
| Niche mal ciblée | Revoir Q15/Q19 et ajuster `matchPatterns` |
| Bot ne charge pas le client | Vérifier le chemin : `clients/{id}/data/...` |
| Emails mentionnent l'IA | Ajouter dans `forbidden_claims` de la KB |
