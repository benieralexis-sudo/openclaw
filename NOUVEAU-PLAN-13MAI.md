# Nouveau plan iFIND — 13/05/2026

**Auteur** : Alexis + Claude (deep dive code+DB+concurrence, 13/05 matin)
**Remplace** : tous les docs strat archivés dans `_archive-bullshit-11-12mai/`
**Statut** : à valider, **pas exécuter avant validation**

---

## 1. Vérité terrain (chiffres mesurés, pas estimés)

### Le funnel DTL (toute la vie du compte, 25/04 → 13/05)
- **833 Triggers** générés, dont 219 alive (614 soft-deleted / 74 %)
- **158 Leads** créés, dont 125 ARCHIVED auto (79 %)
- **33 Leads actionable** (NEW + ENRICHED) — ~13/sem vs cible Fred 20/sem (-35 %)
- **30 Pépites** fitScore ≥70, dont **10 fitScore ≥80 sont en ARCHIVED auto** (bug structurel)
- **0 EMAIL_REPLY, 0 MEETING_BOOKED, 0 CONVERSION** — Fred n'utilise pas le dashboard
- **4 EMAIL_SENT** au total (28/04, vestige Full Service)
- **9 Pépites V2 OUI confirmées** (fulll, OneStock, Alteia, LegalPlace, Collective.work, Audion, Stormshield, Shift Technology, OpsMill)

### Verdict V2 par source (sur 90j)
| Source | OUI | NON | ENRICH | Pas jugé | Taux OUI |
|---|---:|---:|---:|---:|---:|
| rodz.fundraising | 3 | 0 | 1 | 1 | **60 %** |
| rss-levees | 2 | 1 | 0 | 4 | 29 % |
| trigger-engine.funding-recent | 2 | 4 | 0 | 3 | 22 % |
| apify.wttj-jobs | 4 | 3 | 3 | 17 | 13 % |
| trigger-engine.tech-hiring | 1 | 1 | 0 | 10 | 8 % |
| rodz.job-offers | 1 | 4 | 1 | 1 | 14 % |
| apify.linkedin-jobs | 12 | 19 | 1 | 481 | **2.3 %** |
| theirstack.job-offer | 1 | 14 | 1 | 42 | 1.7 % |
| theirstack.buying-intent | 0 | 2 | 1 | 17 | **0 %** |
| apify.indeed-jobs | 0 | 3 | 0 | 131 | **0 %** (déjà coupé) |
| bodacc.capital_increase | 0 | 1 | 5 | 0 | 0 % (ENRICH dominant) |

**Pattern** : les sources **FUNDING** (rodz.fundraising, rss-levees, funding-recent, bodacc) ont le meilleur taux OUI/qualité mais **volume minuscule** (5-7 triggers/90j). Les sources **HIRING_KEY** (LinkedIn/WTTJ/Indeed/TheirStack jobs) ont du volume mais 2-13 % de taux OUI.

**88 % des Triggers ne reçoivent AUCUN verdict V2** (judge V2 en mode shadow + rejet pre-Opus + dedup).

---

## 2. Ce qu'on a déjà sous le capot (souvent oublié)

- ✅ **9 capteurs codés et live** : apify (LinkedIn/WTTJ), theirstack (jobs + buying-intent), francetravail.tech, rodz (5 signaux), inpi.trademark, bodacc (6 types reconnus mais 2 exposés), rss-levees, trigger-engine (funding-recent, tech-hiring)
- ✅ **Judge V2 Opus** sophistiqué : verdict OUI/NON/ENRICH + confidence + thesis + triggers + risks + opener + sources, anti-hedging, anti-placeholder, NAF obsolète intelligent
- ✅ **Combo-detector** : fenêtre dynamique 14-60j selon type-pair, pattern SCALE-UP-TECH (funding+hiring tech → score 10 forcé)
- ✅ **Priority scoring** : score × freshness/100 + multiSourceBoost (0/15/30)
- ✅ **Enrichissement waterfall** : Pappers récursif holdings (1 niveau), Kaspr → FullEnrich, HarvestAPI search-by-company, LinkedIn finder cascade
- ✅ **Multi-tenant by design** : `Client.icp` JSON, anti-personas, signal #1, freshnessByTrigger, etc.
- ✅ **Système crédits + garantie Pépite** codé (Sprint Saint Graal, mécanique + Stripe schéma)
- ✅ **Outcomes loop architecturale** : table LeadActivity (DASHBOARD_INTERACTION × 8 kinds, EMAIL_SENT/REPLY, MEETING_*, STATUS_CHANGE), dynamic-few-shots qui injecte boosters/rejected dans le judge
- ✅ **Site marketing public** (homepage + tarifs + 5 pages légales)
- ✅ **Doctor V1.1 + Auditor V0.2** : 2 agents monitoring en prod

**Ce qu'on n'a pas besoin de construire** : capteurs supplémentaires (on en a déjà 9 dans 4 angles), brief builder, scoring composite, table outcomes, garantie crédits.

---

## 3. Les 4 vrais problèmes (par ordre de gravité)

### P1 — On vend à l'aveugle (priorité absolue)
- **0 RDV trackés depuis le 25/04.** On ne sait pas si Fred a converti 1 ou 0 Pépite.
- Sans cette donnée : on ne peut pas itérer la qualité, prouver la valeur, calibrer le pricing, ni passer la garantie 6 Pépites en mode prod.
- **Cause technique** : Fred travaille hors-dashboard (copy-paste vers son outil perso). Le bot ne peut pas voir ce qu'il en fait.

### P2 — 10 Pépites fitScore ≥80 ARCHIVED auto
- Le bot archive automatiquement les Leads quand le Trigger devient IGNORED (qualify-trigger.ts:553/578/596/780, requalify-engine.ts:200/239).
- **Mais la logique IGNORED inclut des cas borderline** : verdict V2 NON avec confidence moyenne, NAF non résolu pénalisé, taille frontière, etc.
- Résultat : 33 % des top Pépites jetées sans que Fred ne les voie.

### P3 — Mono-angle malgré la diversité de sources
- 82 % des Triggers (sur 14j) sont sur l'angle "hire QA/tech".
- Mais les **vraies meilleures sources** (rodz.fundraising 60 % OUI, rss-levees 29 %, funding-recent 22 %) ont un volume riquiqui (5-9 triggers/90j).
- Le combo SCALE-UP-TECH (funding × hiring) est codé et puissant, mais ne se déclenche presque jamais faute de signaux funding suffisants.

### P4 — On vend de la data, pas un résultat
- À 390€/mo Growth + garantie 6 Pépites/mois, la promesse est "résultat".
- Mais la "Pépite" est un proxy (score≥8 dans la DB), pas un RDV pris ni un deal signé.
- Si on ne mesure pas le résultat aval, on découvrira en production que la garantie est mal calibrée (sous- ou sur-promise).

---

## 4. Stratégie (le moat réel)

### Ce qui n'est PAS le moat
- ❌ **Le nombre de capteurs** : Pharow (99-699€) source déjà INPI + BODACC + LinkedIn + INSEE + offres d'emploi + sites web. Ajouter INPI/BPI/GitHub ne nous différencie pas.
- ❌ **La data brute** : Pharow a 1M sociétés FR + 5M décideurs. iFIND a 158 Leads DTL. On perd ce match.
- ❌ **L'enrichissement** : Apollo/Cognism/Clay ont des stacks d'enrichissement supérieures.

### Ce qui EST le moat (defendable 12+ mois)
1. **AI Judge Opus par lead** : OUI/NON/ENRICH + brief raisonné + opener prêt-à-coller. Pharow vend une DB filtrée, l'utilisateur fait le tri. iFIND fait le tri.
2. **Garantie 6 Pépites/mois ou quota doublé** : aucun concurrent n'ose cette promesse de résultat. C'est un pari business, pas une feature data.
3. **Niche FR PME 11-200 tech** : trop fin pour Apollo/Clay (qui visent enterprise/SMB US), pas assez profitable pour Pharow seul (qui vise volume).
4. **Multi-tenant par config JSON** : 30 min pour onboarder un nouveau vertical (cyber, RH, fintech...). C'est défendable sous réserve qu'on prouve avec 1 client #2.

**Position défendable** : on n'est PAS un Apollo français. On est **un AI SDR product qui livre 6 RDV qualifiés/mois pour 390€**. La data est une commodité, **l'arbitrage IA + la garantie de résultat sont le produit**.

---

## 5. Plan d'action — 3 propositions classées par valeur business

### 🥇 Proposition A — "Mesurer le résultat" (2 semaines, ROI maximal)

**Objectif** : passer de "on vend une Pépite-proxy" à "on vend un RDV qualifié confirmé". Sans ça, rien d'autre ne peut s'améliorer.

| Semaine | Livrable | Impact |
|---|---|---|
| S1 | **Appel Fred 30 min** : combien de RDV concrets depuis le 25/04 ? Combien de signés ? Quel outil il utilise pour envoyer ? Workflow réel. | Vérité terrain. |
| S1 | **Couper apify.indeed-jobs** (déjà désactivé) + **theirstack.buying-intent** (0 OUI / 20 triggers). Économie ~$30/mo. | Coupure bruit. |
| S1 | **Outcomes Loop minimale UI** : 3 boutons dans le dashboard sur chaque Lead — "👍 Pépite confirmée" / "👎 Hors-ICP" / "📞 RDV pris". POST `/api/leads/[id]/activities` avec types FEEDBACK_POSITIVE/NEGATIVE/MEETING_BOOKED. | Capture feedback Fred. |
| S1 | **Tuto Fred 5 min** : "Cliquez ici quand vous avez un RDV". Suivi Telegram quotidien sur 7j. | Adoption. |
| S2 | **Webhook n8n/Zapier** : si Fred utilise un outil tiers (Lemlist/Smartlead/Gmail), brancher webhook EMAIL_SENT vers `/api/internal/lead-activity-webhook`. | Tracking outbound auto. |
| S2 | **Dashboard "Resultats Fred"** : compteur live "Ce mois : X Pépites livrées / Y validées / Z RDV pris". Visible par Fred (motivation) et nous (mesure). | Boucle d'apprentissage. |
| S2 | **Audit `archiveLeadOnTriggerIgnored`** : 10 Pépites fitScore ≥80 ARCHIVED auto. Whitelist : si fitScore ≥80 OR verdict V2 OUI confidence ≥75 → NE PAS archiver auto. Recovery script unarchive les 10 cas existants. | Récupération 10 Pépites. |

**Coût** : 6-8 jours dev. **Risque** : Fred ne joue pas le jeu malgré le tuto.
**Critère succès** : ≥10 events outcomes captés en 14j (vs 0 aujourd'hui). ≥1 MEETING_BOOKED enregistré.

### 🥈 Proposition B — "Densifier les sources VRAIMENT bonnes" (3-4 semaines, ROI réel)

**Objectif** : amplifier les sources qui produisent 22-60 % OUI au lieu d'ajouter des capteurs marginaux.

| Semaine | Action | Impact attendu |
|---|---|---|
| S1 | **Débloquer INPI** : API HTTP 500 depuis 12/05. Switch vers bulk FTP hebdo (data.inpi.fr open data) ou retry auth 24h. Code déjà écrit. | +30-100 triggers TRADEMARK/mois. |
| S2 | **BODACC élargi** : actuellement on capte `capital_increase` (6/90j, 5 ENRICH/1 NON). Ajouter `company_merger` + `modification_statuts` filtré sur NAF whitelist tech. Code déjà 80 % en place (`bodacc-poller.ts:159-181`). | +15-30 triggers/mois. |
| S2 | **Rodz fundraising — booster volume** : 5 triggers/90j alors que c'est notre top conv (60 % OUI). Vérifier config Rodz signal `fundraising` (lookback days, stages filter, NAF filter trop strict ?). | ×3-5 si bien configuré → 15-25/mois. |
| S3 | **Layoffs/PSE inverse** : déjà capté dans `Lead.negativeSignals`. Mais pas exposé comme Trigger positif. Une boîte qui licencie des seniors + lève en parallèle = signal pivot ultra-fort. **Combo signal.** | +5-10 combos/mois potentiels. |
| S3 | **BPI/France 2030** capteur léger : RSS press releases bpifrance.fr + dataset data.gouv (~3 jours dev). Source 0€. | +5-15 triggers FUNDING/mois → renforce combo SCALE-UP-TECH. |
| S4 | **Re-judge V2 sur les 736 triggers sans verdict** : faire passer en batch via judge V2 (coût Anthropic ~$8 one-shot, cache prompt actif). Récupère possiblement 30-50 Pépites cachées. | Récupération latente. |

**Coût** : 12-16 jours dev. **Coût marg** : ~$10-20/mo. **Risque** : INPI reste down (switch bulk FTP plus complexe).
**Critère succès** : +50 % de triggers FUNDING/M&A en 30j, combo rate × 2 (de 17 % à 34 %), volume Pépites actionnables × 1.5.

### 🥉 Proposition C — "Doubler la nicheabilité = client #2" (4-6 semaines, ROI long terme)

**Objectif** : prouver le multi-tenant en signant 1 client #2 → débloque le récit produit "iFIND scale".

| Semaine | Action |
|---|---|
| S1-2 | **Définir 1 vertical pilote** (proposition : Cyber FR PME 50-500, persona CISO/RSSI). 1 prospect tiède identifié à appeler. |
| S2-3 | **Onboarding template** : config JSON `Client.icp` complète pour le nouveau vertical, avec ses NAF, anti-personas, signal #1 propre, keywordsHiring spécifiques. |
| S3-4 | **Re-tester chaque capteur** sur le nouveau ICP (1 dryRun par source). Identifier ce qui se casse (anti-personas hardcodés QA, etc.). |
| S4-5 | **Signer client #2 à 390€/mo** ou commit verbal. |
| S6 | **Adapter dashboard pour 2 clients** + tester isolation tenancy. |

**Coût** : 12-20 jours dev + temps commercial. **Risque** : impossible à valider tant que Prop A n'a pas prouvé la valeur sur client #1.
**Critère succès** : 1 client #2 signé OU 1 prospect en pilote 30 jours.

---

## 6. Recommandation

**Faire A → B → C dans l'ordre. Ne pas mélanger.**

- **Sans A, B est aveugle** : on ajouterait des Triggers sans pouvoir mesurer s'ils convertissent.
- **Sans A+B, C est prématuré** : on vendrait à un client #2 une promesse qu'on ne sait pas tenir.
- **A seul (2 sem) = découverte vérité business**. Possible pivot complet selon ce que Fred dit en S1.

### Go/no-go avant exécution

4 questions binaires à trancher AVEC ALEXIS :

1. **Es-tu OK avec un appel direct Fred S1 (30 min, semaine du 13/05)** pour mesurer son résultat business réel et tracer le workflow ?
2. **Es-tu OK pour couper definitivement apify.indeed-jobs et theirstack.buying-intent** ? Économie ~$30/mo, 0 perte signal mesurée.
3. **Es-tu OK avec la whitelist fitScore≥80 anti-auto-archive** ? Récupération de 10 Pépites cachées, risque = un peu de bruit dans le dashboard.
4. **Es-tu OK pour ajouter 3 boutons UI feedback (👍/👎/📞) sur chaque Lead** ? Le bot apprend dès J+7 si Fred clique.

Si OUI sur les 4 → on lance Proposition A lundi prochain.
Si NON sur l'une → on creuse pourquoi avant d'avancer.

---

## 7. Ce qu'on ne sait pas (honnêteté)

- **Combien de RDV Fred a obtenu** depuis le 25/04 (= la donnée la plus importante).
- **Si Fred lit le dashboard** quotidiennement, hebdo, ou jamais.
- **Pourquoi le judge V2 ne tourne que sur 12 % des Triggers** (à creuser pendant Prop A).
- **Quel est le coût d'acquisition** d'un client iFIND #2 — pas de signal commercial mesuré encore.
- **Si Pharow/Apollo vont brancher un Judge IA** sur leur data en 2026 — risque concurrentiel à 12+ mois.

Ces inconnues sont les questions à poser à Fred S1 + à mesurer S2.

---

**Fin du plan. 1 page tight, sans bullshit, sans roadmap 21 semaines.**
