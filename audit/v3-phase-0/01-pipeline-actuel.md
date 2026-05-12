# Audit Pipeline Capture Actuel — Phase 0 v3.0

**Date** : 12/05/2026 (après-midi)
**Période analysée** : 12/02/2026 → 12/05/2026 (90 jours)
**Scope** : Client DigiTestLab (DTL) uniquement
**Auteur audit** : Jojo (avec assistant Claude)
**Scripts** : `/opt/moltbot/dashboard-v2/scripts/audit-phase0-*.ts`

---

## 🎯 Synthèse exécutive (3 phrases)

1. **Ce qui marche** : Le Brain V2 Opus filtre correctement (rejet ESN/concurrents/hors-géo), le pool actif compte aujourd'hui **24 leads dont 18 HOT+WARM contactables** — la qualité produit est bien meilleure qu'attendu.

2. **Ce qui ne marche pas** : Fred n'a eu **aucune activité depuis 15 jours** (dernière LeadActivity 28/04), la latence est catastrophique sur 3-4 sources (WTTJ médian 18 jours, p95 51 jours), et le système jette définitivement les leads "ENRICH conf 58-69" au lieu de les watchlister 90j.

3. **Ce qu'on garde pour v3.0** : Brain V2 + dedup + filtres NAF/géo/ICP — tout est solide. À ajouter : capteurs FR-natifs propriétaires, mécanisme watchlist ENRICH, latence garantie <24h (= refonte fréquences pollers).

---

## 📊 Tableau de bord 14 sources actives (90j DTL)

| Source                          | Captés | Soft-deleted | Utiles | NEW | IGNORED | Score≥8 | → Lead | TTTD médian | TTTD p95 | % SIRENE |
|---|---|---|---|---|---|---|---|---|---|---|
| apify.linkedin-jobs             | 472 | 396 (84%) | 76 | 8 | 68 | 7 | 11.7% | 63.5h | 148.8h | 92.2% |
| apify.indeed-jobs ⚠️ desactivé   | 134 | 95 (71%) | 39 | 0 | 39 | 0 | 18.7% | 11.8h | 82.4h | 61.9% |
| theirstack.job-offer            | 58 | 26 (45%) | 32 | 1 | 31 | 1 | 36.2% | 19.4h | 163.9h | 77.6% |
| apify.wttj-jobs 🔴 latence       | 30 | 13 (43%) | 17 | 7 | 10 | 3 | 50.0% | **432.7h (18j)** | **1223.4h (51j)** | 93.3% |
| theirstack.buying-intent        | 20 | 14 (70%) | 6 | 0 | 6 | 0 | 50.0% | n/a | n/a | 85.0% |
| rodz.company-registration       | 18 | 14 (78%) | 4 | 0 | 4 | 0 | 22.2% | n/a | n/a | 77.8% |
| trigger-engine.tech-hiring      | 12 | 4 (33%) | 8 | 0 | 8 | 0 | 100.0% | n/a | n/a | 100.0% |
| trigger-engine.funding-recent   | 9 | 0 (0%) | 9 | 2 | 7 | 2 | 100.0% | n/a | n/a | 100.0% |
| rss-levees                      | 5 | 4 (80%) | 1 | 1 | 0 | 0 | 80.0% | 257.7h (10.7j) | 305.7h | 40.0% |
| rodz.fundraising 🌟              | 5 | 1 (20%) | 4 | 3 | 1 | 4 | 100.0% | 477.8h (20j) | 646.7h | 80.0% |
| rodz.job-offers                 | 5 | 2 (40%) | 3 | 1 | 2 | 0 | 40.0% | n/a | n/a | 40.0% |
| rodz.recruitment-campaign       | 5 | 2 (40%) | 3 | 2 | 1 | 1 | 20.0% | n/a | n/a | 40.0% |
| rodz.mergers-acquisitions       | 4 | 2 (50%) | 2 | 1 | 1 | 1 | 50.0% | 157.6h | 690.5h | 75.0% |
| francetravail.tech              | 2 | 1 (50%) | 1 | 0 | 1 | 0 | 50.0% | 33.2h | 62.3h | 100.0% |
| **TOTAL**                       | **779** | **574 (74%)** | **205** | **26** | **179** | **19** | **21.3%** | — | — | — |

**Lectures clés** :
- **205 triggers utiles** (après dedup massif 74%) sur 90j = ~68/mois
- **Conversion Trigger → Lead = 21.3%** (166 leads créés sur 779 triggers, 205 utiles)
- **19 triggers score ≥8** = ~6/mois Pépites brutes (avant filtre Brain V2)

---

## 🫀 Pipeline vivant — Volume capture par jour 14 derniers jours

```
28/04 : ████████████████████████████ 139 (66 indeed + 54 LI + ...)
29/04 : █████████ 48 (34 indeed + 8 LI + ...)
30/04 : ████████████████ 75 (42 LI + 24 indeed + 6 theirstack)
01/05 : █████████ 49 (40 LI + 9 indeed)
02/05 : ██████████████ 75 (75 LI — Apify only)
03/05 : ██████████████████████ 116 (85 LI + 28 WTTJ + ...)
04/05 : ██████████ 51 (26 LI + 11 theirstack BI + 7 theirstack JO + ...)
05/05 : ████████████ 60 (37 LI + 10 theirstack + 8 funding)
06/05 : ███ 17 (7 LI + 7 theirstack + ...)
07/05 : ████ 20 (12 LI + 5 theirstack + ...)
08/05 : ████████ 42 (35 LI + 2 theirstack + ...)
09/05 : █████ 24 (16 LI + 5 rss-levees + ...)
10/05 : ████ 22 (19 LI + 3 ...)
11/05 : ████ 19 (16 LI + 3 ...)
12/05 : █ 2 (2 rodz.recruitment-campaign)
```

**Observations** :
- Pipeline VIVANT (dernier trigger aujourd'hui 08h05)
- **Volume en chute libre** : -83% entre 03/05 (116) et 12/05 (2 aujourd'hui)
- **apify.indeed-jobs disparu depuis 03/05** (volontaire — abandon mentionné incident-apify-03mai)
- **apify.linkedin-jobs reste dominant** mais ralentit (35 le 08/05 → 16 hier)
- **05-09/05 : explosion theirstack.buying-intent (11+0+0+0+0)** — pic isolé inexpliqué

---

## ⏱️ Latence — La promesse TTTD <24h est aujourd'hui violée à 70%

**Distribution latence `publishedAt → capturedAt` sur apify.wttj-jobs (30 triggers)** :
- <24h ✅ : 1
- 1-3j : 1
- 3-7j : 4
- 7-30j : 13
- **>30j 🔴 : 11**

→ **Sur WTTJ, 80% des triggers ont >7 jours de retard sur l'événement source.** Inacceptable pour v3.0 TTTD <24h.

**Sources actuellement <24h médian** : `apify.indeed-jobs` (11.8h, mais désactivée), `theirstack.job-offer` (19.4h), `francetravail.tech` (33.2h — limite).

**Sources désastreuses** : `apify.wttj-jobs` (432h), `rodz.fundraising` (477h), `rss-levees` (257h), `rodz.mergers-acquisitions` (157h p95 690h).

**Cause probable** : crons d'enrichissement post-capture qui retardent l'ingestion en DB. `publishedAt` est l'horodatage source (annonce WTTJ, dépôt INPI, etc.), pas l'arrivée chez nous. Investigation cron requise Phase 2.

---

## 🎯 Couverture SIRENE par source

| Source | Coverage |
|---|---|
| trigger-engine.* + francetravail | **100%** |
| apify.wttj-jobs | 93% |
| apify.linkedin-jobs | 92% |
| theirstack.buying-intent | 85% |
| rodz.fundraising | 80% |
| theirstack.job-offer | 78% |
| rodz.company-registration | 78% |
| rodz.mergers-acquisitions | 75% |
| **apify.indeed-jobs** | **62%** |
| **rodz.recruitment-campaign / rss-levees / rodz.job-offers** | **40%** |

→ **3 sources avec 40% SIRENE = pollution Pappers downstream.** Quand SIRENE manque, l'enrichissement Pappers ne peut pas qualifier → "NAF non résolu" → soit ENRICH en limbo, soit faux positifs.

---

## 🔥 État du pool actif DTL — 24 leads (NEW + ENRICHED)

| Tier | Count | Description |
|---|---|---|
| **HOT 🔥** (score≥9 + email VALID + LinkedIn) | **7** | Prêts à contacter aujourd'hui |
| **WARM** (score≥7 + email VALID + LinkedIn) | **11** | Très exploitables |
| **TEPID** (score≥6, contact incomplet) | 6 | Besoin de finition |
| Incomplet (score <6) | 0 | — |

### Les 7 Pépites HOT 🔥 — prêtes à contacter maintenant
1. **ViaXoft** (SaaS Marseille NAF 6202A, 50-99p, Eric Barthélémy fondateur — QA match) — apify.linkedin-jobs, age 1j
2. **LegalPlace** (Legaltech Paris NAF 5829A, 22p, Racem Flazi CEO — funding) — trigger-engine.funding-recent, age 7j
3. **OneStock** (SaaS Toulouse NAF 6201Z, 21p, Benoît Baccot CTO — QA match) — apify.wttj-jobs, age 9j, ENRICHED
4. **Sêmeia** (SaaS santé numérique Paris NAF 6201Z, 12p, Mathieu Godart CTO) — apify.wttj-jobs, age 9j
5. **WeWard** (SaaS B2C app mobile NAF 6202A, 12p, Yves Benchimol CEO) — apify.wttj-jobs, age 9j
6. **Dastra** (LegalTech RGPD/IA NAF 70.22Z, Antoine BIDAULT CTO) — apify.linkedin-jobs, age 13j, ENRICHED
7. **SQUAREMIND** (SaaS NAF 5829C, 11p, Tanguy Serrat CTO + levée 15.3M€) — trigger-engine.funding-recent, age 14j, ENRICHED

### Sources qui ont produit ce pool actif (24 leads)
- apify.linkedin-jobs : 8 (33%)
- apify.wttj-jobs : 7 (29%)
- rodz.fundraising : 3 (12.5%)
- trigger-engine.funding-recent : 2 (8%)
- rss-levees : 1 / rodz.mergers-acquisitions : 1 / theirstack.job-offer : 1 / rodz.job-offers : 1

→ **Apify (LinkedIn + WTTJ) produit 62% du pool actif**. Le ratio 1:67 calculé naïvement masquait que ces sources sont les VRAIES productrices de Pépites — la sélectivité Brain V2 fait le job.

---

## 🚨 Découvertes critiques A.0.1 (8 insights)

### #1 — Fred quasi-inactif depuis 15 jours
- 4 LeadActivity au total en 90j (3 EMAIL_SENT manual le 28/04 sur LYNX RH + 1 webhook auto le 28/04 sur Kestra)
- Lead "LYNX RH" final = ARCHIVED → les 3 emails n'ont pas converti
- **Aucune action Fred depuis 16h59 le 28/04/2026.**
- Hypothèses : (a) Fred a abandonné, (b) Fred utilise hors plateforme (export, copier-coller, Outlook manuel), (c) tracking cassé.
- **À résoudre absolument avant Phase 6 outcomes loop** : sans signal de Fred, aucun apprentissage possible.

### #2 — Pool produit 18 Pépites HOT+WARM mais 0 conversion
Le pool actif est **bon** (18 leads contactables qualité top). Donc la qualité capture n'est pas le bloqueur. C'est l'usage côté Fred qui pose problème.

### #3 — Latence catastrophique sur 4 sources critiques
WTTJ médian 18j, Rodz fundraising 20j, RSS levées 11j, Rodz M&A 7j. **Promesse TTTD <24h impossible aujourd'hui** sans refonte des fréquences pollers.

### #4 — Volume en chute libre depuis 03/05
116 triggers/jour → 2 aujourd'hui. Hypothèses :
- Arrêt volontaire apify.indeed-jobs (mémoire 03/05)
- Possible quota Apify épuisé ou cron grippé
- 12/05 ne capture que 2 triggers en 13h = anormalement bas
- À investiguer en parallèle Phase 0

### #5 — 74% triggers soft-deleted = dedup, pas un bug
510/574 deletions ont lieu <1h après capture = dedup automatique cross-source (Apify détecte la même annonce sur Indeed + LinkedIn + WTTJ). Mécanisme intentionnel. **OK.**

### #6 — IGNORED `ignoredReason=null` = bug de logging
Le code `qualify-trigger.ts:651-661` met `status=IGNORED` mais ne renseigne pas `ignoredReason`. La raison réelle est dans `scoreReason`. **À corriger Phase 2** : copier `scoreReason` dans `ignoredReason` lors du passage en IGNORED.

### #7 — Le filtrage Brain est correct (sur les Pépites perdues)
Sur 10 leads score ≥8 IGNORED, 8/10 sont correctement rejetés (ESN pure, concurrent QA interne, hors géo FR, NAF blacklist immo/holding/recrutement). **Le filtre marche.**

### #8 — 2 vrais faux négatifs détectés
- **Collective.work** : verdict V2 = ENRICH conf 58 → poussé en IGNORED par filtre `C3 below_min_score:4<7`. ICP cohérent mais data incomplète. Aurait dû être watchlisté.
- **UNLCK** : "ICP tech FR 37p, signal QA buying-intent direct aligné offre test, NAF non résolu" → IGNORED. **Aurait dû être Pépite.**

→ **Gap produit critique** : pas de mécanisme watchlist 90j pour les ENRICH conf 58-69. Soit on garde, soit on perd définitivement.

---

## 💡 Recommandations pour v3.0 (à intégrer Phase 1+)

### ✅ À GARDER tel quel
- **Brain V2 Opus** (qualifyTriggerV2 + verdict OUI/NON/ENRICH + confidence) — filtrage correct, multi-couches (NAF blacklist + V2 + geo) — pierre angulaire.
- **Dedup automatique** trigger-dedup.ts — résout le bruit cross-source Apify.
- **Filtres NAF blacklist P16** (immo/holding/recrutement/finance) — efficace, automatique.
- **Trigger-engine.* sources** (tech-hiring, funding-recent) — 100% Trigger→Lead, signaux propriétaires DTL.
- **Sources Rodz fundraising / rss-levees / trigger-engine** — petits volumes mais 100% Pépites.

### 🔧 À REFONDRE (Phase 2-4)
- **Crons pollers Apify WTTJ + Rodz fundraising + RSS-levees** : latence 10-20 jours médian. Faire passer en cron court (15min-1h) + refondre dans framework capteurs.
- **`ignoredReason` bug logging** : recopier `scoreReason` dans `ignoredReason` en sortie qualify.
- **Sources 40% SIRENE** (rodz.recruitment-campaign, rss-levees, rodz.job-offers) : améliorer attribution SIRENE en amont (Pappers fallback) plutôt qu'IGNORER sans SIRENE.

### ➕ À AJOUTER (Phase 4-5)
- **Mécanisme watchlist 90j** pour leads ENRICH conf 58-69 : ne pas IGNORE définitivement, garder en limbo. Re-évaluer périodiquement quand data s'enrichit.
- **Capteurs FR-natifs propriétaires** prévus v3.0 : Press Régionale, DNS Sherlock, INPI direct, BODACC, Greffe — pour augmenter densité signaux propriétaires Tier A.

### ⚠️ À ABANDONNER (sans regret)
- **apify.indeed-jobs** : 0 Pépite sur 134 triggers + déjà désactivée 03/05 = définitif.
- **theirstack.buying-intent** : 0 Pépite sur 20 triggers + pas de SIRENE pour 15% des cas. Quota cher ($89/mo) pour résultat nul. À enterrer ou à reformater (peut-être un autre angle ?).

### 🚨 À INVESTIGUER URGEMMENT (avant Phase 1)
- **Pourquoi Fred est inactif 15 jours ?** Sans réponse, le compilateur ICP-as-Code de Phase 5 ne sert à rien.
- **Pourquoi volume capture chute -83% en 9j ?** Bug technique silencieux ou désactivation volontaire ? À diagnostiquer.
- **Apify Indeed + Apify Indeed** : à confirmer désactivation volontaire + libération quota économisé.

---

## 📋 Sources à enterrer / garder / refondre (décision v3.0)

| Action | Sources | Justification |
|---|---|---|
| **ENTERRER** | `apify.indeed-jobs`, `theirstack.buying-intent` | 0 Pépite, coût élevé, déjà désactivé |
| **GARDER** (refondre Phase 4 framework capteurs) | Toutes les autres (12 sources) | Productrices du pool actif |
| **PRIORITÉ REFONTE LATENCE** | `apify.wttj-jobs`, `rodz.fundraising`, `rss-levees`, `rodz.mergers-acquisitions` | Latence médian 7-20j cassée |
| **PRIORITÉ AMÉLIORATION SIRENE** | `rss-levees`, `rodz.recruitment-campaign`, `rodz.job-offers` | 40% coverage |

---

## 📂 Scripts d'audit utilisés (sources data)

| Script | Output couvert |
|---|---|
| `scripts/inspect-source-volumes.ts` (existant) | Volume + NEW/IGNORED/Score≥8 par source 90j |
| `scripts/inspect-outcomes-by-source.ts` (existant) | Outcomes positifs/négatifs par source |
| `scripts/audit-phase0-activities-real.ts` (créé 12/05) | LeadActivity 90j détaillé |
| `scripts/audit-phase0-pipeline-health.ts` (créé 12/05) | Volume/jour + latence + SIRENE + ignoredReason + funnel |
| `scripts/audit-phase0-deep-dive.ts` (créé 12/05) | Soft-deleted timing, WTTJ histogram, IGNORED null pattern, Fred actions |
| `scripts/audit-phase0-lost-pepites.ts` (créé 12/05) | 20 leads score≥8 IGNORED — lecture briefV2Json |
| `scripts/audit-phase0-current-pepites.ts` (créé 12/05) | Pool actif NEW+ENRICHED (24 leads) classifié HOT/WARM/TEPID |

---

## ✅ Critère de sortie A.0.1 — atteint

- [x] Tableau quantifié 14 sources sur 90j
- [x] Latence + couverture SIRENE + funnel Trigger→Lead par source
- [x] Liste des sources à enterrer/garder/refondre
- [x] 8 insights critiques documentés
- [x] Recommandations actionnables pour Phase 1+

→ Prochaine étape : **A.0.2 — Audit qualité 200-300 leads 6 mois (tagging manuel + backtest convergence triple)**

---

## ⚠️ Découvertes inattendues à intégrer dans le cadrage Phase 0

1. **Le diagnostic initial sur la qualité a sous-estimé le pool actuel.** 24 leads dont 18 HOT+WARM en pool actif = base solide.
2. **Le vrai gap n'est pas la capture, c'est l'activation côté Fred** + watchlist manquante.
3. **A.0.2 doit confirmer ou infirmer** que les 200-300 leads livrés cumulés ont la même qualité que le pool actif des 24 derniers jours.
4. **A.0.5 (ICP Fred)** doit absolument inclure une question : *"Pourquoi tu n'as pas touché ces 18 HOT+WARM en 15 jours ?"*
