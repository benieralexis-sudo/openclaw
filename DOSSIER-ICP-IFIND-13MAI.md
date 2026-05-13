# Dossier ICP iFIND — V1 (13/05/2026)

**Auteur** : Claude (audit massif 7 phases) + Alexis (validation en bloc)
**Statut** : prêt à provisionner après GO final
**Test** : multi-tenant grandeur nature (DTL + iFIND en parallèle)

---

## 1. Synthèse des 6 audits

### A1 — Marché outbound FR 2026
- 1 SDR interne = 35-55K€/an + 4-6 mois ramp-up
- Stack outbound complète (data + sequences + dialer + CRM) = 1500-3000€/mo
- Externalisée prospection : ~2000€/mo
- **CAC outbound +60 % en 3 ans en SaaS**
- Production : 6-15 meetings/mo par SDR full-time
- **Positionnement iFIND** : 390€/mo = **remplace 1 SDR junior** (pas un outil pour SDR)

### A2 — 5 signaux d'achat
1. Hire SDR/BDR récent (501 offres LinkedIn FR mai 2026)
2. Hire Head of Growth/CMO récent (653 offres FR)
3. Levée Seed/Series A <12 mois
4. Utilisation Apollo/Lemlist (TheirStack tech detection)
5. Growth-related = top 10 LinkedIn FR Jobs on the Rise 2026

### A3 — Concurrence (vraies faiblesses)
| Concurrent | Faiblesse exploitable par iFIND |
|---|---|
| **Pharow** (FR-direct) | Pas d'envoi, pas d'API, pas de veille push, UX moyen |
| **Apollo** | Data US, bounce 15-35 % FR, customer service catastrophique, credit prédateur |
| **Cognism** | $15-30K/an minimum, no self-serve, pas accessible PME |
| **Clay** | Complexité abrupte, pas sending tool, $185-495 |
| **Lemlist** | List building médiocre, failed lookups burn credits |

### A4 — Template Q&A réutilisable
- 9 questions universelles déjà rédigées (`template-onboarding-9-questions.md`)
- Asset stratégique iFIND — différenciateur vs Apollo (grille rigide)
- Réutilisé pour iFIND, hypothèses Claude validées par Alexis en bloc 13/05

### A5 — Multi-tenant code
- ~80 % prêt pour iFIND (PME tech similar à DTL)
- 3 hardcodes critiques à fixer plus tard pour clients très différents (cyber/fintech/RH) :
  - `naf-whitelist.ts` (TECH_NAF_PREFIXES hardcodé)
  - `francetravail.ts isFTQaOffer` (boost QA hardcodé)
  - `harvestapi-decision-makers.ts` (RULES_QA_HIRE hardcodé)
- **Pour iFIND : pas bloquant**. Les keywords ICP+anti-personas suffisent.

### A6 — Q&A 9 réponses (verbatim Claude validé Alexis)
- Cf. section 3 ci-dessous (synthèse dans l'ICP JSON)

---

## 2. ICP iFIND JSON complet (à insérer en DB)

```json
{
  "notes": "ICP iFIND — PME FR 11-200 tech/SaaS B2B + agences B2B qui hire SDR/BDR/Sales en post-Series A. Cible : remplacer 1 SDR junior à 4500€/mo par un service AI à 390€/mo avec garantie résultat.",
  "sizes": ["11-50", "51-200"],
  "antiSizes": ["1-10", "201-500", "500-1000", "1000+"],
  "company_size_min": 11,
  "company_size_max": 200,
  "regions": [
    "Île-de-France", "Auvergne-Rhône-Alpes", "Nouvelle-Aquitaine",
    "Provence-Alpes-Côte d'Azur", "Occitanie", "Pays de la Loire", "Hauts-de-France"
  ],
  "cities": ["Paris", "Lyon", "Bordeaux", "Marseille", "Toulouse", "Nantes", "Lille"],
  "country_codes": ["FR"],
  "industries": [
    "SaaS B2B", "Édition de logiciels", "Fintech",
    "Agence growth B2B", "Agence marketing B2B", "Conseil tech B2B"
  ],
  "linkedin_industries": [
    "Software", "Information Technology and Services",
    "Computer Software", "Internet", "Marketing and Advertising"
  ],
  "naf_codes": [
    "5829A", "5829B", "5829C", "6201Z", "6202A", "6202B",
    "6311Z", "6312Z", "7022Z", "7311Z", "7312Z"
  ],
  "personas": [
    {"title": "Founder", "weight": 1},
    {"title": "CEO", "weight": 1},
    {"title": "Head of Sales", "weight": 0.95},
    {"title": "VP Sales", "weight": 0.95},
    {"title": "CRO", "weight": 0.95},
    {"title": "Head of Growth", "weight": 0.9},
    {"title": "CMO", "weight": 0.85},
    {"title": "Sales Manager", "weight": 0.8}
  ],
  "personaTitles": [
    "Founder", "Fondateur", "CEO", "Chief Executive Officer",
    "Head of Sales", "VP Sales", "Chief Revenue Officer", "CRO",
    "Sales Director", "Head of Growth", "Growth Manager",
    "CMO", "Chief Marketing Officer", "Sales Manager"
  ],
  "keywordsHiring": [
    "Sales Development Representative", "SDR", "BDR",
    "Business Development Representative", "Account Executive", "AE",
    "Outbound Sales", "Inside Sales", "Sales Manager", "Head of Sales",
    "VP Sales", "Sales Director", "Chief Revenue Officer", "CRO",
    "Head of Growth", "Growth Marketer", "Growth Manager", "Growth Hacker",
    "Chief Marketing Officer", "CMO", "Marketing Manager",
    "Demand Generation", "Business Developer", "Commercial B2B"
  ],
  "antiPersonas": [
    "Pharow", "Apollo", "Apollo.io", "Cognism", "Clay", "Clay.com",
    "Lemlist", "Lusha", "Kaspr", "Dropcontact", "Hunter", "Hunter.io",
    "Sales Navigator", "LinkedIn Sales Solutions", "Société Info",
    "Nomination", "Corporama", "Société.com", "Sparklane", "Derrick",
    "La Growth Machine", "Waalaxy", "Heyreach", "Smartlead",
    "Salesloft", "Outreach.io",
    "Capgemini", "Sopra Steria", "Atos", "Sword Group", "Akkodis",
    "Devoteam", "Onepoint", "Alten", "CGI", "Accenture", "Inetum",
    "Capgemini Engineering", "CGI France", "Akka Technologies",
    "Growth Room", "Magneticway", "Salesforge", "Aimers", "D-Impulse",
    "UnboundB2B", "Skipcall", "Oltega", "Monsieur Lead", "Butterfly Effect"
  ],
  "redFlagsHard": [
    "Concurrent direct iFIND (autre outil de leadgen/prospection B2B FR : Pharow, Apollo, Cognism, Clay, Lemlist, etc.) — NE PAS approcher",
    "Agence GTM concurrente (Growth Room, Magneticway, Salesforge, etc.) — elles vendent du service comparable",
    "ESN PURE (Capgemini, Sopra, Atos, Alten, etc.) — modèle staffing IT, pas prospection",
    "Cabinet de recrutement / staffing (NAF 78.10 / 78.20) — concurrent indirect"
  ],
  "redFlagsSoft": [
    "Effectif > 250 personnes (downgrade — process achat plus long, possiblement déjà équipé)",
    "Boîte B2C uniquement (pas de besoin outbound B2B)",
    "Industrie non-tech sans dimension SaaS/produit"
  ],
  "nonRedFlags": [
    "RH ou Achats comme persona contact — peut fonctionner si pas de CEO/Head of Sales accessible. NE PAS exclure auto.",
    "Boîte avec stack outbound existante (Apollo/Lemlist) — c'est un signal d'UPGRADE potentiel vers iFIND, pas un anti-signal",
    "Effectif > 200p — downgrade only, NE PAS exclure"
  ],
  "signalPrimary": "BOOST FORT (+2 points sur le scoring final, plancher 8 si autres axes OK) si AU MOINS UN signal observable : (1) recrutement SDR/BDR/Account Executive/Business Developer <90j, (2) levée Seed/Series A/Series B <12 mois, (3) recrutement Head of Sales/VP Sales/CRO <180j, (4) effectif doublé en 12 mois. Sweet spot = combo signal (1) + signal (2) (post-funding qui scale outbound = fenêtre d'attaque ouverte). Ce signal est un BONUS (+), JAMAIS un MALUS (-).",
  "signalSecondary": "BONUS si la boîte utilise déjà un outil outbound (Apollo, Lemlist, Lusha, Kaspr — détectable via TheirStack tech stack). Client outbound mature → candidat upgrade vers iFIND. NE PAS rejeter.",
  "preferredSignals": [
    {"type": "HIRING_SDR_BDR", "weight": 1, "keywords": ["Sales Development Representative", "SDR", "BDR", "Business Development Representative", "Account Executive", "Outbound Sales"]},
    {"type": "FUNDRAISING", "stages": ["seed", "series-a", "series-b"], "weight": 0.95, "industries": ["SaaS", "Software", "Fintech"]},
    {"type": "C_LEVEL_HIRE_SALES", "roles": ["Head of Sales", "VP Sales", "CRO", "Chief Revenue Officer", "Sales Director"], "weight": 0.9},
    {"type": "C_LEVEL_HIRE_GROWTH", "roles": ["Head of Growth", "CMO", "Chief Marketing Officer", "Growth Manager"], "weight": 0.85},
    {"type": "TECH_STACK_OUTBOUND", "techs": ["apollo.io", "lemlist", "lusha", "kaspr", "salesloft", "outreach"], "weight": 0.8},
    {"type": "COMPANY_REGISTRATION_TECH", "weight": 0.5, "naf_codes": ["5829A", "5829B", "5829C", "6201Z", "6202A", "6202B"]}
  ],
  "freshnessByTrigger": {
    "note": "Calibration initiale Claude 13/05 — à itérer via boucle outcomes après 2 sem en prod.",
    "levee": {"maxDays": 365, "minDays": 30, "staleAfterDays": 180},
    "hireSDR": {"maxDays": 180, "minDays": 0, "staleAfterDays": 90},
    "hireSales": {"maxDays": 180, "minDays": 30, "staleAfterDays": 180},
    "hireGrowth": {"maxDays": 180, "minDays": 30, "staleAfterDays": 180}
  },
  "pitch_angles": {
    "hire_sdr": "Vous venez de hire un SDR — la première chose qui va manquer c'est une stack outbound efficace. iFIND, c'est tout-en-un (data + AI judge + opener prêt) à 390€/mo. Votre SDR gagne 2j/sem.",
    "fundraising": "Post-levée, le pain commercial #1 c'est : 'on a le cash, mais l'équipe outbound n'est pas encore staffée'. iFIND livre 6 Pépites/mois prêtes à attaquer, sans hire SDR à 50K€/an.",
    "head_of_sales_change": "Nouveau Head of Sales = refonte de la stack. iFIND remplace 3 outils (Pharow + Lemlist + 1 SDR junior) à 390€/mo all-inclusive avec garantie résultat.",
    "growth_hire": "Vous venez de hire un Head of Growth — il va vouloir tester 10 canaux. iFIND lui apporte le canal outbound déjà packagé : 6 Pépites/mois, opener prêt, sans gérer la data ni les emails."
  },
  "pitchKeywords": [
    "remplacer 1 SDR junior",
    "6 Pépites garanties / mois",
    "tout-en-un (data + AI + opener)",
    "390€/mo all-inclusive",
    "AI judge OUI/NON par lead",
    "fini la stack à 3 outils",
    "0 SDR à manager"
  ],
  "pitchVerbatim": "iFIND est un AI qui te trouve chaque mois 6 PME FR avec des signaux d'achat durs (levée, recrutement, croissance équipe) et te rédige le mail d'attaque personnalisé. 390€/mo tout inclus, garantie 6 Pépites/mois ou quota doublé. Tu remplaces 1 SDR junior à 4500€/mo.",
  "proof_points": [
    "DigitestLab (DTL) — éditeur QA externalisé — bot live depuis le 25/04/2026 (use case interne)",
    "Sur DTL : 30 Pépites détectées en 18 jours (fitScore ≥70), dont 9 Pépites V2 OUI confidence ≥75",
    "Marge brute 77 % à 390€/mo (coût variable ~93$/mo/client)"
  ],
  "dreamArchetype": "PME SaaS B2B 15-40 personnes, post-Series A <12 mois, sans SDR encore, Founder/CEO encore en charge du commercial mais sature.",
  "fewShotPositives": {
    "dreamProspects": [],
    "confirmedClients": []
  },
  "successMetric": {
    "alexisInitial": "20 leads/semaine livrés + 6 Pépites/mois + 1 deal iFIND signé en 30j post-launch",
    "interneCibleV1": "0 lead grossièrement hors-cible + raison écrite par lead + ≥90 % accord Alexis sur 50 leads validés Sprint 1",
    "businessCible": "1 client iFIND payant signé en 60j post-launch (autre que dogfood) = preuve product-market fit"
  },
  "senderFirstName": "Alexis",
  "dynamicFewShots": {
    "boosters": [],
    "rejected": [],
    "windowDays": 42,
    "generatedAt": "2026-05-13T18:00:00.000Z"
  },
  "auto_qualify_enabled": true,
  "minScore": 7,
  "tarif_iFIND_mensuel": 390,
  "tarif_iFIND_garantie_pepites": 6
}
```

---

## 3. Plan provisioning (step-by-step)

### Étape 1 — Créer le Client iFIND (SQL direct)
```sql
INSERT INTO "Client" (id, slug, name, "legalName", industry, region, size, status, plan,
                      "contactEmail", icp, "creditsBalance", "creditsMonthlyQuota",
                      "pepitesGuaranteed", "createdAt", "updatedAt", "activatedAt")
VALUES (
  'cmifind00000000000000000',
  'ifind',
  'iFIND',
  'iFIND SAS',
  'SaaS B2B',
  'Île-de-France',
  '1-10',
  'ACTIVE',
  'GROWTH',
  'alexis@ifind.fr',
  '{ ... ICP JSON ci-dessus ... }'::jsonb,
  999999,  -- pas de limite pour dogfood (comme DTL grandfathered)
  60,
  6,
  NOW(), NOW(), NOW()
);
```

### Étape 2 — Lier user Alexis au client iFIND
- Tu as déjà 2 comptes ADMIN (`alexis@ifind.fr` + `benieralexis@gmail.com`)
- Les ADMIN voient tous les clients par défaut → pas besoin de lier
- Si on veut un compte CLIENT dédié iFIND : créer après

### Étape 3 — Provisionner Rodz signals
Script existant : `scripts/provision-digitestlab.ts` adapté en `scripts/provision-ifind.ts` (à créer, ~30 min)
- Signals : `fundraising`, `job-changes`, `recruitment-campaign`
- Filtres : industries iFIND, regions iFIND, keywordsHiring iFIND

### Étape 4 — Provisionner TheirStack signals
Idem : `scripts/provision-ifind.ts` appelle `provisionTheirstackForClient(ifindId)`
- Job offers : keywordsHiring = SDR/BDR/Sales (au lieu de QA)
- Buying intent : techSlugs = `["apollo", "lemlist", "lusha", "kaspr"]` (au lieu de QA tools)

### Étape 5 — Lancer dryrun complet
```bash
curl -X POST "http://127.0.0.1:3100/api/internal/run-pollers?source=all&clientId=<ifindId>&dry-run=true" \
  -H "x-cron-secret: $CRON_SECRET"
```
Verifier :
- Tous les pollers retournent sans erreur
- Volume de triggers raisonnable (50-200 sur 14 jours backfill)
- 0 erreur de hardcode QA

### Étape 6 — Lancer en prod
- Ajouter `--clientId=ifindId` dans le cron `run-pollers-cron.sh` (ou itérer sur tous les clients ACTIVE)
- Activer cron sur 24h glissants pour catch-up initial

### Étape 7 — Vérifier J+24h
- Combien de triggers iFIND générés ?
- Quel verdict V2 dominant ?
- Aucun concurrent direct passé le filtre anti-personas ?

---

## 4. Critères de succès mesurables (30 jours)

| Quoi | Cible J+7 | Cible J+30 |
|---|---|---|
| Triggers générés iFIND | ≥50 | ≥200 |
| Pépites (verdict V2 OUI confidence ≥75) | ≥3 | ≥15 |
| Anti-personas concurrents qui passent | 0 | 0 |
| Multi-tenant : 2 clients en parallèle OK | ✅ DTL + iFIND | ✅ |
| Hardcodes DTL qui plantent iFIND | 0 | 0 |
| Leads "grossièrement hors-cible" identifiés par Alexis | <5 % | <2 % |

---

## 5. Risques + mitigations

| Risque | Probabilité | Mitigation |
|---|---|---|
| Hardcodes "QA" boostent à tort des leads QA | Moyenne | francetravail.ts isFTQaOffer → désactiver si client.icp.signal != QA, ou ignorer (faible volume) |
| keywordsHiring SDR matche des "Senior Developer" (false positives) | Moyenne | Post-filter strict comme QA_TITLE_REGEX, mais pour SDR/BDR |
| Anti-personas concurrents incomplète → on contacte Pharow | Faible | Liste 50+ noms, mais audit hebdo |
| Pollers existants ratent les agences B2B (NAF 73.11/73.12) | Moyenne | NAF whitelist à étendre dans `naf-whitelist.ts` OU laisser le judge V2 décider |
| Le judge V2 ne tourne que sur 12 % des triggers (audit DTL) | Élevée | Investigation séparée — bug à résoudre avant que iFIND livre des leads vrais |

---

## 6. Décision finale

**Prêt à provisionner.** Au prochain GO :
1. INSERT Client iFIND (1 SQL, 5 sec)
2. Création script `provision-ifind.ts` (~30 min)
3. Run dryrun (~5 min)
4. Vérification résultats (~10 min)
5. Activation prod (~5 min)

**Total : ~1h** pour avoir iFIND live en parallèle DTL.
