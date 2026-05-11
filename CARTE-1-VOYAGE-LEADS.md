# Carte 1 — Voyage end-to-end de 8 leads ambassadeurs

**Date** : 11/05/2026
**Auteur** : Claude (Opus 4.7) en session de cartographie avec Alexis
**Objectif** : Tracer le voyage complet de 8 leads représentatifs pour couvrir ~80% des patterns du système iFIND, et documenter les 20% non couverts via le code

**Document complémentaire** : `ARCHITECTURE-V1.md` (Carte 3 — inventaire code)

---

## TL;DR — Top observations en 1 minute

**Ce qui marche bien** ✅
- 7/7 Leads ont une persona résolue (4 via HarvestAPI strict, 1 via Pappers-RCS, 2 via headline-upgrade)
- 5/7 ont email + phone valides (Kaspr/FullEnrich/Rodz waterfall)
- Briefs V2 riches, traçables, structurés (verdict + thesis + triggers + risks + opener + sources)
- Le pipeline RE-JUDGED 6→7 RECOVERED rattrape les leads borderline

**7 bugs systémiques découverts** 🔴

| # | Bug | Cas observés | Impact |
|---|---|---|---|
| **B1** | **Désynchronisation briefV2 ↔ Lead persona** | DiXiO, DimoMaint, ViaXoft | Brief cite un contact périmé après ré-enrichissement |
| **B2** | **NAF Pappers obsolète déclenche B12 downgrade** | Audion (NAF 74.2A photographie ≠ AdTech) | OUI→ENRICH par sécurité, opener pas finalisé |
| **B3** | **Opener avec `[Prénom]` placeholder** | ViaXoft | Brief généré avant que HarvestAPI résolve persona |
| **B4** | **Holding fallback `(via X Group)` dans jobTitle** | DimoMaint, exposé direct dans display | Devrait être un metadata séparé |
| **B5** | **Lead `doNotContact=true` sans raison documentée immédiate** | DimoMaint | Probablement HEAL 5 mais cause exacte à investiguer |
| **B6** | **MACHINA: briefV2Json NULL malgré status NEW** | MACHINA (RSS-levées capté il y a 30 min) | qualifyTrigger doit re-tourner sur les leads RSS frais |
| **B7** | **`personaSource` valeurs composites non typées** | "none + headline-upgrade", "pappers-holding-fallback + jobtitle-upgrade" | String concat ad-hoc, pas d'enum, doc absente |

**Pattern positif #1 — RE-JUDGED 6→7 RECOVERED** : DiXiO et Audion ont vu leur score passer de 6 (proche IGNORED) à 7 (NEW) après un 2e passage Opus avec contexte enrichi. C'est un mécanisme de **second chance** précieux qu'on veut préserver.

**Pattern positif #2 — Score plancher source fiable** : DimoMaint a un `[Score plancher 8/10 source fiable + secteur ICP]` qui force un score min sur certaines sources (Rodz M&A = fiable). À documenter (où est cette logique ?).

---

## Méthode

### 8 leads ambassadeurs sélectionnés

Critères : 1 par sourceCode majeur + variété verdicts (NEW vs IGNORED, OUI vs ENRICH) + données riches en DB.

| # | Company | sourceCode | type | status | score | NAF | Taille | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | **DiXiO** | theirstack.job-offer | HIRING_KEY | NEW | 7 | 62.01Z | 42 (fix 11/05) | Bug du jour, hors-France, coquille FR |
| 2 | **SQUAREMIND** | trigger-engine.funding-recent | FUNDRAISING | NEW | 9 | 58.29C | 11p | Pépite idéale, dataQuality=90 |
| 3 | **Audion** | rodz.fundraising | FUNDRAISING | NEW | 7 | 74.2A | inconnu | B12 NAF hors whitelist + RE-JUDGED |
| 4 | **WeWard** | apify.wttj-jobs | HIRING_KEY | NEW | 9 | 62.02A | 12 | QA-STUCK 38j, pappers-rcs CEO |
| 5 | **ViaXoft** | apify.linkedin-jobs | HIRING_KEY | NEW | 9 | 62.02A | 50-99 | Opener [Prénom] (bug B3) |
| 6 | **DimoMaint** | rodz.mergers-acquisitions | FUNDRAISING | NEW | 8 | 58.29C | 50-99 | Holding fallback, doNotContact, brief désynchro |
| 7 | **MACHINA** | rss-levees | FUNDRAISING | NEW | 7 | 63.12Z | inconnu | briefV2 NULL pattern |
| 8 | **DigitestLab** | PAPPERS_BODACC | OTHER | IGNORED | 4 | - | TPE | Cas test interne (PAS un vrai BODACC) |

### Couverture des 50 patterns

- ✅ **A1, A3, A4, A6, A8, A14** (TheirStack jobs, Apify WTTJ, Apify LinkedIn, Rodz fundraising, Rodz M&A, RSS levées)
- ✅ **B1-B7** (Attribution SIRENE, récursion holdings, pre-Opus reject, ensureLead, Pappers RCS, tech-hire guard, HarvestAPI)
- ✅ **B9-B10** (Kaspr, FullEnrich)
- ✅ **C1-C8** (verdicts OUI/ENRICH/NON, B12 downgrade, validator)
- ✅ **D1, D2, D5** (coquille FR DiXiO, hors-France, oversize via Audion 15M$/7 villes)
- ✅ **E1, E5, E7** (negative signals via Audion, company-website, linkedin-profile)
- ❌ **A2, A5, A7, A9-A13, A15** (TheirStack buying-intent, Apify declarative-pain, Rodz job-changes, BODACC réel, INPI marque/brevet, JOAFE, France Travail NEW, RSS pseudo-SIRET FT*hash) → **À documenter via code**
- ❌ **D3, D4, D6-D14** (anti-persona, procédure collective, large co, anti-fantôme, race conditions, etc.) → **À documenter via code**

---

## Voyage 1 — DiXiO (le bug du jour, le plus complexe)

### Données chargées

**Trigger** :
- id: `cmovbtzgu000tl6pt0phh9f2h`
- sourceCode: `theirstack.job-offer`
- type: `HIRING_KEY`
- score: **7** (RE-JUDGED v2 6→7 RECOVERED)
- isHot: false
- capturedAt: 2026-05-07 10:11:52
- companyName: "DiXiO"
- companySiret: 821766524
- companyNaf: **62.01Z** (Programmation informatique — ICP tech ✅)
- size: **42** (post-fix 11/05 — était "Entre 1 et 2 salariés" avant)
- title: "Recrutement Dev / QA Lead"
- rawPayload: 8165 chars (payload TheirStack riche)
- briefV2Json: 3524 chars (présent)

**Lead** :
- fullName: **Adrien SICOLI** (résolu après patch 11/05)
- jobTitle: **Co-founder**
- personaSource: `harvestapi-search`
- personaTier: 2
- fitScore: 55
- linkedinUrl: https://linkedin.com/in/adrien-sicoli-82a50b136
- email: adrien@dixio.me
- phone: +33642442836
- kaspr: ✅ email + ✅ phone (kasprAttemptedAt: 2026-05-11 11:37:31)
- harvestapi: ✅ (harvestapiAttemptedAt: 2026-05-11 11:36:44)
- dataQuality: 71
- status: NEW

### Voyage chronologique étape par étape

#### Étape 1 — Capture du signal (TheirStack poller)

📍 `src/lib/theirstack-poller.ts` (lignes ~150-220 estimées, non lu en profondeur)

TheirStack ingère les offres d'emploi via leur API. Le `companyObject.employee_count = 42` est dans le payload (bloc `company_object`) mais le poller AVANT 11/05 ne lisait que `companySize` qui était null → fallback Pappers tranche FR = "01" (1-2 salariés) → **effectif faux**.

**Patch 11/05 commit `66d2fc6a3`** : `theirstack-poller.ts` capture maintenant `job.company_object.employee_count = 42` à la création + protège contre écrasement Pappers tranche basse.

#### Étape 2 — Attribution SIRENE Pappers

SIRENE = 821766524, NAF = 62.01Z (Programmation). C'est OK ICP-fit.

⚠️ **Mais coquille FR** : DiXiO HQ Dubaï avec 200+ clients dans 60+ pays, mais SIREN FR (établissement Nantes) inscrit avec tranche_effectif "01" = 1-2 salariés. C'est un **pattern D1 (coquille FR)** — le SIREN existe mais ne reflète pas la réalité.

#### Étape 3 — Création du Trigger

📍 `theirstack-poller.ts` insert dans table Trigger avec score initial.

#### Étape 4 — Qualification V2 Opus (1er passage — score 6 IGNORED)

📍 `src/lib/qualify-trigger.ts:479-689` (`qualifyTrigger`)

Le V2 a probablement donné OUI conf~60 → score 6 → **IGNORED par défaut** ? Ou peut-être ENRICH suite à NAF/données incomplètes. Le label `RE-JUDGED v2 6→7 RECOVERED` indique qu'il y a eu re-judgment.

#### Étape 5 — RE-JUDGED (2e passage, contexte enrichi)

🔍 **Pattern à investiguer** : où se trouve la logique "re-judgment" ? Probablement dans `requalify-engine.ts` (que je n'ai pas lu).

Le 2e passage a remonté score 6→7 et passé status IGNORED→NEW. Le brief V2 a verdict **OUI conf=86** (cohérent avec score 7).

#### Étape 6 — ensureLeadForTrigger

📍 `src/lib/ensure-lead-for-trigger.ts:27-145` (`ensureLeadsForAllTriggers`)

Score 7 >= 4 → éligible création Lead. Le payload TheirStack contient des `hiring_team`/`decision_makers` ? À vérifier dans le rawPayload. Sinon, Lead créé sans poster.

#### Étape 7 — Enrichissement Pappers dirigeants (le crash initial)

📍 `src/lib/enrich-lead-dirigeants.ts:82-498`

**AVANT le patch du jour** : Pappers RCS a posé `Thierry Miskaoui (Président/CCO)` → personaSource=`pappers-rcs`, tier 3 (CEO). Sur trigger HIRING_KEY tech avec NAF 62.01Z = **mauvais contact** (CEO/CCO ≠ décideur QA).

**Brief V2 généré à ce moment** : cite `[src:#5] Thierry Miskaoui Partner/CCO DiXiO 2y` dans thesis + sources. **Le brief V2 reste avec ce persona figé.**

#### Étape 8 — Patch tech-hire-guard (11/05/2026)

📍 `enrich-lead-dirigeants.ts:319-341`

Nouvelle garde : si `HIRING_KEY` tech (NAF 62/58.29/63) ET best.weight < 9 → skip Pappers-RCS, on laisse HarvestAPI chercher.

#### Étape 9 — HarvestAPI search-by-company avec strict mode

📍 `src/lib/harvestapi-decision-makers.ts:204-375` (`findDecisionMakerByCompany`)

Variantes générées : `["DiXiO"]` (un seul mot, pas de variation possible).
Locations: `["France", "United Arab Emirates"]` (élargi avec HQ Dubaï du payload — patch B7).
maxItems: 20 (forceRefresh car personaSource était pappers-rcs).
bypassCache: true.

Strict mode activé (signalType=qa-hire dérivé de "QA Lead"). Filtre tier 1-2 seulement.

**Résultat** : Adrien SICOLI, Co-founder, tier 2, confidence ~80, harvestapi-search.

#### Étape 10 — Update Lead avec nouveau contact + cache rawProfile

📍 `harvestapi-decision-makers.ts:603-619`

Lead updated avec firstName/lastName/fullName/jobTitle/linkedinUrl/personaTier/personaSource. `linkedinProfileJson` aussi posé (cache rawProfile HarvestAPI Full).

#### Étape 11 — Kaspr enrichment

📍 `src/lib/enrich-via-kaspr-direct.ts:57-329`

Lead a maintenant linkedinUrl + score>=6 → éligible Kaspr. Kaspr enrichit avec email adrien@dixio.me + phone +33642442836. C9 + C1 checks OK (persona match + domain match).

#### Étape 12 — recompute email confidence + data quality

📍 `src/lib/recompute-email-confidence.ts` (non lu)

Final : emailConfidence=80, dataQuality=71.

### Patterns observés / découvertes Carte 1

✅ **Pattern positif** : RE-JUDGED 6→7 RECOVERED — mécanisme de seconde chance
✅ **Pattern positif** : strict mode HarvestAPI + variantes nom société + locations élargies par HQ
🔴 **Bug B1 (Désynchronisation briefV2)** : Le briefV2Json reste figé avec Thierry Miskaoui alors que Lead actuel = Adrien SICOLI. Conséquence : si Fred consulte le brief V2 dans le dashboard, il verra le mauvais contact dans la thesis + opener
🔴 **Bug D1 (Coquille FR)** : Pappers tranche_effectif "01" (1-2 salariés) sur boîte 42p. Sans le patch 11/05, brief V2 disait "1-2 salariés" → discrédit total côté Fred.
🟡 **Question architecturale** : où vit la logique de RE-JUDGED ? (à explorer dans `requalify-engine.ts`)

### Pointeurs code pour cette journey

```
src/lib/theirstack-poller.ts:158         → fix capture employee_count (post-11/05)
src/lib/theirstack.ts:?                  → type JobResult avec company_object
src/lib/qualify-trigger.ts:479           → qualifyTrigger entry
src/lib/qualify-trigger.ts:526           → call V2 sync
src/lib/qualify-trigger.ts:551-575       → B12 NAF hors whitelist (skipped pour DiXiO car 62.01Z OK)
src/lib/qualify-trigger.ts:580-594       → mapVerdictToScore
src/lib/ensure-lead-for-trigger.ts:77    → poster non-tech filter (DiXiO l'a évité car pas de poster)
src/lib/enrich-lead-dirigeants.ts:311    → tech-hire-guard (patch 11/05)
src/lib/harvestapi-decision-makers.ts:294-309 → strict mode (patch 11/05)
src/lib/harvestapi-decision-makers.ts:581-583 → locations élargies HQ (patch 11/05)
src/lib/enrich-via-kaspr-direct.ts:159   → call Kaspr enrichLinkedInProfile
```

---

## Voyage 2 — SQUAREMIND (le cas idéal — pipeline qui marche)

### Données chargées

**Trigger** :
- id: `te-digitestlab-845228303-fundi` (id custom, pas cuid → trigger-engine.* utilise un ID structuré `te-<client>-<siren>-<type>`)
- sourceCode: `trigger-engine.funding-recent`
- type: `FUNDRAISING`
- score: **9** (`[V2 OUI conf=82]`)
- isHot: **true**
- companyName: "SQUAREMIND"
- companySiret: 845228303
- companyNaf: **58.29C** (Édition de logiciels — ICP parfait ✅)
- size: 11-11p
- rawPayload: **NULL** (trigger-engine ne stocke pas de payload brut, signal calculé en interne)
- briefV2Json: 2833 chars

**Lead** :
- fullName: **Tanguy Serrat**
- jobTitle: **Co-Founder & CTO**
- personaSource: **`none + jobtitle-upgrade + headline-upgrade`** 👈 nouveau pattern
- personaTier: 1 (CTO résolu)
- fitScore: 65 + dataQuality: **90** (top !)
- email: tanguy@squaremind.io
- phone: +33 6 61 71 07 97
- kaspr: ✅ email (kasprAttemptedAt: 2026-04-29 13:00:24)
- fullenrich: 2026-05-08 14:55:18
- linkedinProfileJson: ✅ (extrait dans brief : "Tanguy Serrat Co-Founder & CTO SquareMind 7,3y in role")
- status: **ENRICHED** (déjà passé en ENRICHED, pas juste NEW)

### Pattern d'upgrade `none + jobtitle-upgrade + headline-upgrade`

🔍 **Nouvelle découverte** : il existe un mécanisme de "tier upgrade" multi-source que je n'avais pas vu dans `qualify-trigger.ts`. La valeur `personaSource = "none + jobtitle-upgrade + headline-upgrade"` indique :

1. À l'origine, persona avait `personaSource = "none"` (pas trouvée par Pappers ni HarvestAPI initial — peut-être contact arrivé via Rodz enrichContact ?)
2. Puis `compute-tier-from-jobtitle.ts` a remonté le tier en analysant le `jobTitle` (Co-Founder & CTO match tier 1)
3. Puis `compute-tier-from-headline.ts` a confirmé via le `headline` LinkedIn

📍 **Probablement dans** `src/lib/recompute-persona-tier-from-headline-runner.ts` (non lu) + `compute-tier-from-jobtitle.ts` + `compute-tier-from-headline.ts` (testés mais non lus en profondeur).

**Action Carte 4** : lister cette brique parmi celles à extraire/documenter — c'est un **pattern positif** réutilisable.

### Voyage chronologique

#### Étape 1 — Génération du signal trigger-engine

📍 `src/lib/?` (probablement un module trigger-engine non encore exploré)

trigger-engine.funding-recent est un signal SYNTHÉTIQUE généré à partir d'autres signaux (Rodz fundraising + RSS levées + presse). Pas un poller direct.

#### Étape 2 — Création Trigger (id custom)

Le trigger n'a pas un cuid mais `te-digitestlab-845228303-fundi` → généré par trigger-engine pour dedup.

#### Étape 3 — Qualification V2 Opus

Direct OUI conf=82 → score 9 → isHot=true. NAF 58.29C est dans la whitelist ICP → pas de downgrade B12.

#### Étape 4 — ensureLeadForTrigger

Pas de poster dans payload (rawPayload=NULL). Lead minimal créé.

#### Étape 5 — Pappers + récursion holdings

SQUAREMIND 11p → bucket "small", représentants RCS = Tanguy Serrat probablement, mais source = "none" donc soit Pappers n'a pas posé tout de suite, soit Rodz enrichContact a posé `firstName/lastName` sans `personaSource`.

#### Étape 6 — jobtitle-upgrade + headline-upgrade

Le job title "Co-Founder & CTO" est analysé → tier 1. Le headline LinkedIn confirme. Le composite `personaSource = "none + jobtitle-upgrade + headline-upgrade"` est posé pour traçabilité.

#### Étape 7 — Kaspr + FullEnrich waterfall

Kaspr 29/04 → email tanguy@squaremind.io. FullEnrich 08/05 (probablement pour le phone, vu que kasprPhone=NULL mais phone final OK).

#### Étape 8 — Brief V2 généré (parfait)

Cite 3 sources cohérentes (pappers.health, trigger-engine.funding-recent, linkedin-profile). Risks structurés (secteur médical IEC 62304). Opener riche : "Bonjour Tanguy, Félicitations pour les 15,3M€...".

### Patterns observés

✅ **Pipeline qui marche parfaitement de bout en bout** — pas de bug, pas de désynchro
✅ **Pattern `jobtitle-upgrade + headline-upgrade`** réutilisable pour les futurs Lead Hunters
✅ **dataQuality = 90** : possible à atteindre quand toutes les sources convergent
🟡 **rawPayload NULL pour trigger-engine.*** : pas grave mais à noter (les triggers synthétiques n'ont pas de raw)

---

## Voyage 3 — Audion (le cas problématique — NAF hors whitelist + B12 downgrade)

### Données chargées

**Trigger** :
- id: `cmoicpyvf000sl6ej92ko3zjb`
- sourceCode: `rodz.fundraising`
- type: `FUNDRAISING`
- score: **7** (`[RE-JUDGED v2 6→7 RECOVERED]`)
- isHot: false
- companyName: "Audion"
- companySiret: 330727058
- companyNaf: **74.2A** (Activités photographiques !) ❌ pas ICP tech
- size: inconnue
- rawPayload: 1529 chars (Rodz payload riche avec contact + company)
- briefV2Json: 2971 chars

**Lead** :
- fullName: **Alexis Focheux**
- jobTitle: **CTO**
- personaSource: **`none + headline-upgrade`** 👈
- personaTier: 1
- fitScore: 80
- email: alexis@audion.fm (probablement de Rodz directement)
- phone: NULL
- kaspr: ❌ (kasprAttemptedAt: 2026-04-28 22:54:37 — tenté mais rien trouvé)
- fullenrich: 2026-05-08 14:58:00 (tenté)
- harvestapi: NULL (pas tenté car contact déjà résolu par Rodz)
- dataQuality: 47 (médiocre, manque phone)
- status: **ENRICHED**

### Le bug B12 NAF hors whitelist en pratique

**Brief V2 verdict = ENRICH** (pas OUI), avec :
- risk high : "NAF 74.2A (activités photographiques) incohérent avec positionnement AdTech SaaS — soit erreur d'attribution Pappers, soit code historique non mis à jour."
- opener générique : "(Verdict ENRICH — opener à finaliser après enrichissement. Confirmer NAF réel...)"

📍 **`qualify-trigger.ts:551-575`** — le code B12 force OUI→ENRICH si NAF pas dans `client.icp.naf_codes`. Sur Audion :
- V2 brut aurait probablement dit OUI conf~85 (signal levée 15M$ frais + CTO accessible)
- Mais NAF 74.2A pas dans whitelist DTL → downgrade ENRICH conf 60
- → score = 7 (ENRICH conf≥70) ou 6 (ENRICH 50-69)
- → status NEW mais opener pas finalisé

### Voyage chronologique

#### Étape 1 — Webhook Rodz fundraising

Payload Rodz arrive via webhook avec :
- company info (SIREN + name)
- contact info (firstName + lastName + linkedinUrl + email)
- signal details (levée 15M USD)

📍 Endpoint webhook : `src/app/api/webhooks/rodz/` (probablement)

#### Étape 2 — Création Trigger via webhook

Le Trigger est créé directement par le webhook avec rawPayload Rodz. SIRENE attribué via `companySiret` du payload Rodz.

#### Étape 3 — Lead créé via Rodz contact

📍 `src/lib/enrich-via-rodz.ts` (non lu, 311 lignes)

Rodz fournit le contact dans le payload → Lead créé directement avec firstName/lastName/linkedinUrl/email (pas besoin de Pappers RCS ni HarvestAPI). `personaSource = "none"` initial.

#### Étape 4 — compute-tier-from-headline

Analyse le headline LinkedIn d'Alexis Focheux → "CTO Audion" matché tier 1. `personaSource = "none + headline-upgrade"`.

#### Étape 5 — Pappers enrichissement entreprise

NAF récupéré = 74.2A (historique pas mis à jour). Le système ne corrige pas → pas de mécanisme actuel pour signaler "NAF probablement obsolète".

#### Étape 6 — qualifyTrigger V2 (1er passage — score 6)

V2 Opus voit le NAF 74.2A dans le dossier. Probablement verdict ENRICH conf~50 ou OUI conf~55 (incertain).

#### Étape 7 — B12 NAF guard

📍 `qualify-trigger.ts:551-575`

```ts
if (verdict === "OUI") {
  // ...
  if (icpNafCodes && !icpNafCodes.some((c) => triggerNaf.startsWith(c.replace(/\./g, "")))) {
    verdict = "ENRICH";
    conf = Math.min(conf, 60);
  }
}
```

Si V2 avait OUI conf>=70, B12 le downgrade à ENRICH conf 60. Score mappé = 6 (ENRICH conf 50-69) ou 7 (ENRICH conf>=70).

#### Étape 8 — RE-JUDGED 6→7 RECOVERED

Le label dit que le score est passé de 6→7. Donc 1er passage = score 6 (qui devait être IGNORED par défaut ?), 2e passage avec contexte = score 7 ENRICH NEW.

#### Étape 9 — Kaspr tenté (échec)

Kaspr appelé le 28/04 22:54 mais probablement pas trouvé phone (kasprPhone=NULL malgré attempted).

#### Étape 10 — FullEnrich waterfall (08/05)

FullEnrich appelé le 08/05 → probablement même résultat. emailFullenrich=NULL et phoneFullenrich=NULL probablement.

### Patterns observés

🔴 **Bug B2 (NAF Pappers obsolète)** : Audion est AdTech SaaS confirmé mais NAF historique = photographie. B12 le downgrade ENRICH par sécurité. **Idéal** : le système devrait pouvoir détecter le mismatch et soit re-fetcher NAF récent, soit faire confiance au signal Rodz/triggerType=FUNDRAISING qui contextualise.
🟡 **Verdict ENRICH mais status NEW** : ENRICH conf≥70 → score 7 → status NEW. Le commercial voit le lead mais l'opener n'est pas finalisé. Décision design discutable (cohérent avec doctrine = "enrichir d'abord" mais frustrant en UX).
✅ **Pattern positif** : RE-JUDGED a remonté score 6→7, recovered. Sans ce mécanisme, Audion aurait été IGNORED.

---

## Voyage 4 — WeWard (Apify WTTJ, condensé)

### Highlights

- **sourceCode** : `apify.wttj-jobs`
- **score** : 9 OUI (présumé conf>=80, brief riche)
- **`scoreReason`** : "[QA-STUCK 38j] Offre QA toujours ouverte 38 jours après publication — frustration recrutement = bascule signal-d'achat"
- **personaSource** : `pappers-rcs` (PAS de tech-hire guard activée !)
- **persona** : Yves Benchimol, CEO & Co-founder, tier 2, fitScore 55
- **Pattern QA-STUCK** : nouveau (à explorer dans le code — où est cette détection ?)

### Pourquoi pas de tech-hire guard ?

🔍 **Investigation** : sur HIRING_KEY tech (NAF 62.02A) avec Lead via pappers-rcs CEO tier 3, le **tech-hire-guard de `enrich-lead-dirigeants.ts:311-341`** aurait dû kicker.

Hypothèses :
- Soit le guard a été ajouté APRÈS la création du Lead WeWard (timing : Lead créé 03/05, guard codé 11/05)
- Soit le best.weight était >=9 (CEO sur petite boîte 12p valide)
- Soit pappers-rcs a posé directement le CEO (weight=8 selon `PERSONA_PRIORITY` `enrich-lead-dirigeants.ts:22`) — weight 8 < 9 mais guard ne kick que si `requiresTechPersona && best.weight < TECH_TIER1_WEIGHT && !existingLead?.fullName`

**Cas WeWard** : Lead créé 03/05 AVANT le guard 11/05 → pas concerné. C'est cohérent.

### Pattern QA-STUCK

📍 Probablement `src/lib/qa-stuck-scanner.ts` (non lu, dans la liste des 113 modules). Ça scanne probablement les Triggers HIRING_KEY QA avec capturedAt vieux + status NEW pour détecter une douleur recrutement.

À explorer en Carte 4.

### Pointeurs code WeWard

```
src/lib/apify-poller.ts:?                  → ingestion WTTJ jobs format
src/lib/qa-stuck-scanner.ts                → détection QA-STUCK (à lire)
src/lib/enrich-lead-dirigeants.ts          → pappers-rcs CEO posé (pré-patch tech-hire-guard)
```

---

## Voyage 5 — ViaXoft (Apify LinkedIn jobs, condensé)

### Highlights

- **sourceCode** : `apify.linkedin-jobs`
- **score** : 9 OUI conf=82
- **persona** : Eric Barthélémy, fondateur, harvestapi-search tier 2
- **dataQuality** : 76 (correct)
- **Bug B3 — Opener `[Prénom]` placeholder** :

> "Bonjour [Prénom],\n\nJe vois que ViaXoft recrute un QA Senior pour reprendre l'existant..."

Le brief V2 a été généré au moment où le Lead n'avait pas encore de persona résolue (à 11:56 Pappers tenté, à 11:57 Kaspr tenté). Le brief V2 a probablement été généré **avant** que HarvestAPI pose Eric Barthélémy.

### Bug B3 confirmé

🔴 **Le briefV2Json reste figé avec `[Prénom]`** alors que le Lead actuel a Eric Barthélémy. Si Fred consulte le brief, l'opener n'est pas envoyable.

**Solution naturelle** :
- Soit le brief V2 ne doit JAMAIS inclure le prénom (opener avec template `{firstName}` rendu côté UI)
- Soit le brief V2 doit être re-généré après que le persona est résolu (auto-regen)

### Pointeurs code

```
src/lib/apify-poller.ts:?                  → ingestion LinkedIn jobs format
src/lib/harvestapi-decision-makers.ts:204  → findDecisionMakerByCompany (Eric Barthélémy via "ViaXoft" variant)
```

---

## Voyage 6 — DimoMaint (Rodz M&A, condensé, plein de patterns)

### Highlights

- **sourceCode** : `rodz.mergers-acquisitions`
- **score** : 8 (`[Score plancher 8/10 source fiable + secteur ICP]`)
- **scoreReason mentionne "score plancher"** → 🔍 nouvelle découverte : il existe une logique de **score minimum forcé** quand la source est fiable + secteur ICP

📍 **À explorer** : où est codé ce "score plancher" ? Probablement dans `qualify-trigger.ts` ou un helper que je n'ai pas vu en profondeur.

### Pattern holding fallback dans display

- **personaSource** : `pappers-holding-fallback + jobtitle-upgrade`
- **jobTitle** : `Président / Fondateur (via DimoMaint Group)` ← le `(via X)` est dans le jobTitle directement !
- **personaTier** : 2

🔴 **Bug B4** : la mention `(via DimoMaint Group)` est interpolée directement dans `jobTitle`. C'est de la métadata qui devrait être séparée (`holdingPath` champ dédié). Conséquence : si Fred filtre par "CTO" dans le dashboard, ce lead avec `jobTitle = "Président / Fondateur (via DimoMaint Group)"` ne matchera pas le filtre.

📍 `src/lib/enrich-lead-dirigeants.ts:434` : `const jobTitleWithPath = personaLabel + holdingNote + sizeWarning;`

### Pattern doNotContact mystérieux

- **doNotContact** : **true** (avec aucune raison documentée évidente)
- **email** : NULL
- **phone** : NULL

🔍 Probablement HEAL 5 (ex-employer email cleanup) ou H4 (persona mismatch) a flag le Lead. Mais sans email actuel, c'est étrange.

**Hypothèse** : un email précédent a été détecté en mismatch puis vidé + flag doNotContact posé. HEAL 5b devrait reclear si Kaspr/FullEnrich pose un bon email, mais Kaspr/FullEnrich n'ont jamais tourné (kasprAttemptedAt=NULL, fullenrichAttemptedAt=NULL).

📍 `src/lib/audit-heal.ts:303-345` (HEAL 5) → flag posé probablement à l'enrichissement initial.

### Bug B1 confirmé : brief désynchronisé

Le brief V2 mentionne `[src:#4] Persona identifié = Directeur Commercial` mais le Lead actuel a `Thomas Lazare Bourgeois Président/Fondateur (via DimoMaint Group)`. Et l'opener s'adresse à "Bonjour Jean-Luc" → ni Jean-Luc Bourgeois ni Thomas.

🔴 **Désynchro complète** entre brief V2 et Lead. Le commercial qui ouvre la fiche voit 3 contacts différents.

### Pointeurs code

```
src/lib/qualify-trigger.ts:?                → "score plancher source fiable" (à localiser)
src/lib/enrich-lead-dirigeants.ts:434      → jobTitle + holdingNote concat (bug B4)
src/lib/audit-heal.ts:303-345              → HEAL 5 ex-employer (probable cause doNotContact)
```

---

## Voyage 7 — MACHINA (RSS-levées, briefV2 NULL pattern)

### Highlights

- **sourceCode** : `rss-levees`
- **score** : 7 (`RSS-levées frenchweb <14j (funding)`)
- **briefV2Json** : **NULL** ! 🔴
- **scoreReason simple** : "RSS-levées frenchweb <14j (funding)" — pas de format `[V2 XXX]` → V2 n'a JAMAIS tourné
- **persona** : Chiheb Chouchane, Co-founder, harvestapi-search tier 1
- **capturedAt** : 2026-05-11 11:34:40 (il y a 30 min) → lead FRESH
- **fitScore** : 65, dataQuality : 55

### Pattern observé : qualifyTrigger pas encore appelé sur les leads RSS frais

📍 **`src/lib/rss-levees-poller.ts` (386 lignes, non lu)** — probablement, le RSS poller :
1. Crée le Trigger avec score initial via heuristique simple
2. Lance Pappers + HarvestAPI tout de suite (Lead persona résolue)
3. **N'appelle PAS qualifyTrigger V2 dans le même flow**

→ Le V2 Opus tournera plus tard (probablement au prochain cron 6h ou via un sweep `qualifyPendingTriggers`).

🟡 **Bug B6 (mineur)** : Lead visible dashboard avec score 7 mais sans briefV2 = pas de thesis, pas d'opener, pas de risks → Fred ne peut pas attaquer.

### Pointeurs code

```
src/lib/rss-levees-poller.ts:?            → ingestion RSS
src/lib/qualify-trigger.ts:721            → qualifyPendingTriggers batch
```

---

## Voyage 8 — DigitestLab PAPPERS_BODACC (cas test interne — pas un BODACC réel)

### Highlights

- **sourceCode** : `PAPPERS_BODACC`
- **type** : `OTHER`
- **status** : `IGNORED`
- **score** : 4
- **companyName** : DigitestLab (= notre propre client DTL !)
- **briefV2Json** : NULL
- **rawPayload** : NULL
- **title** : "Tally signature contrat 25/04"

→ Ce Trigger n'est PAS un vrai BODACC public détecté par le bot. C'est une entrée test interne créée le jour de la signature DTL (25/04/2026).

### Conclusion pattern A9 (BODACC réel)

🔍 **Aucun vrai BODACC en DB actuellement** — soit le poller BODACC ne tourne plus, soit aucun BODACC capital-increase / création / modification n'a été détecté ces dernières semaines.

📍 **`src/lib/bodacc-poller.ts` (338 lignes, non lu)** — à investiguer en Carte 4 pour comprendre :
- Est-ce que le poller tourne dans le cron `run-pollers` ?
- Quelles requêtes il fait sur l'API BODACC ?
- Quelle attribution SIRENE (BODACC contient le SIRET natif) ?

---

## Patterns NON couverts en pratique — documentation via code

Pour les patterns absents de la DB actuelle, on les documente théoriquement.

### Pattern A2 — TheirStack buying-intent

📍 `src/lib/theirstack-poller.ts` (lignes ~? — non lu)
📍 `src/lib/theirstack.ts` (397 lignes — non lu)

Signal firmographique TheirStack `searchCompanies` (intent technologique). Gate horaire UTC `[6,14]` posée 05/05 (commit 7292c02a6) pour économiser conso TheirStack. 8 leads IGNORED en DB, 0 NEW.

**Pattern probable** : type `BUYING_INTENT`, score initial bas car signal faible, qualifyTrigger Opus le rejette souvent.

### Pattern A5 — Apify declarative-pain

📍 `src/lib/declarative-pain.ts` (non lu)
📍 `src/lib/apify-poller.ts` (759 lignes — non lu)

Scan posts LinkedIn de CTOs/Tech Leads pour détecter des "douleurs" exprimées (frustration testing, recherche d'un QA, etc.). 0 trigger en DB → probablement source désactivée ou peu fertile.

### Pattern A7 — Rodz job-changes (job moves)

Type `JOB_MOVE` (changement de poste C-level <6 mois — signal d'achat fort). 0 trigger en DB actuellement.

### Pattern A10 — BODACC création/modification

📍 `src/lib/bodacc-poller.ts` (338 lignes — non lu)

Détection créations société + modifications statutaires + augmentations de capital. Type `CAPITAL_INCREASE`. 0 en DB → poller probablement actif mais peu fertile.

### Pattern A11 — INPI marque / brevet

📍 `src/lib/inpi-poller.ts` (311 lignes — non lu)

Types `TRADEMARK`, `PATENT`. 0 en DB.

### Pattern A12 — JOAFE (associations)

📍 `src/lib/joafe-poller.ts` (non lu)

Type `OTHER`. 0 en DB.

### Pattern A13 — France Travail

📍 `src/lib/francetravail-poller.ts` (non lu) + `src/lib/francetravail.ts`

20 IGNORED en DB, 0 NEW. Source low-cost qui semble peu fertile en qualif.

### Patterns C5-C8 — Décisions V2 NON / IGNORED / fail-safe

Pas de cas NEW NON IGNORED en DB facilement isolable, mais code clair :
- `qualify-trigger.ts:594` : `else opusScore = 2;` pour verdict NON
- `qualify-trigger.ts:601-605` : status IGNORED si NON OR !shippable
- `qualify-trigger.ts:529-538` : fail-safe IGNORED si V2 fail

### Patterns D3-D14 — bug paths

| Pattern | Pointeur code |
|---|---|
| D3 anti-persona | `qualify-trigger.ts:QUALIFY_V2_SPECIFIC ligne 856` ("Capgemini, Sopra, Atos..." traités par V2 prompt) |
| D4 procédure collective | `enrich-lead-dirigeants.ts:200-216` (exclusion auto + soft-delete Lead + Trigger) |
| D5 Fix M oversized | `enrich-lead-dirigeants.ts:382-389` |
| D6 Q2 large co block | `enrich-lead-dirigeants.ts:368-375` |
| D7 C8 anti-fantôme | `enrich-lead-dirigeants.ts:418-432` |
| D8 B14 race condition | `ensure-lead-for-trigger.ts:92-109` (dedup SIRET pre-create) |
| D9 ex-employer email | `audit-heal.ts:303-345` (HEAL 5) |
| D10 persona mismatch | `audit-heal.ts:317-325` (HEAL 5 + H4) |
| D11 bounce reset | `Lead.bouncedAt` champ + webhook Resend |
| D12 doNotContact RGPD | `Lead.doNotContact` champ + IMAP poller (caduc post-pivot) |
| D13 IGNORED → NEW promote | `qualify-trigger.ts:613` (`promoteToNew`) |
| D14 orphan archive | `audit-heal.ts:419-442` (HEAL 6) |

### Patterns E3-E4 — Combo + cross-tenant

📍 `qualify-trigger.ts:detectComboPatterns` (lignes 148-205) — 3 patterns :
- sprint-hiring (3+ HIRING_KEY <7j)
- post-funding-scaling (FUNDRAISING + HIRING_KEY <14j)
- post-deal-consolidation (M&A + LEADERSHIP_CHANGE <30j)

📍 `qualify-trigger.ts:getCrossTenantSignal` (lignes 282-307) — DB query autres clients sur même SIRET.

**Réalité actuelle** : 2 clients (DTL + iFIND interne) → cross-tenant rare. Combo patterns possibles mais à vérifier en query.

### Pattern F — outputs downstream (copy generation, delivery, credits)

Non tracé dans cette Carte 1 (focus voyage du Lead). À couvrir éventuellement dans une **Carte 1.5** dédiée si nécessaire.

📍 Modules à explorer :
- `brief-builder.ts` (génération brief commercial Opus on-demand)
- `copy-generator.ts` + `copy-runner.ts` (4 types : pitch, LinkedIn DM, call brief, warm mail)
- `delivery-config.ts` + `delivery-sender.ts` + `realtime-alert-sender.ts`
- `weekly-digest-runner.ts`
- `credits.ts` + `credits-math.ts` (déjà tracé Saint Graal)

---

## Synthèse — 7 bugs systémiques + 5 patterns positifs

### 7 bugs systémiques découverts par cette enquête

| # | Bug | Sévérité | Cause root | Solution proposée |
|---|---|---|---|---|
| **B1** | Désynchro briefV2 ↔ Lead persona | 🔴 Haute | Brief V2 généré une fois figé, pas re-généré quand persona change | Auto-regen briefV2 si persona modifié significativement (tier change) |
| **B2** | NAF Pappers obsolète déclenche B12 | 🟡 Moyenne | Pappers NAF historique pas mis à jour | Détecter "Pappers NAF probablement obsolète" via cross-check site web / NAF déclaré dans payload signal |
| **B3** | Opener avec `[Prénom]` placeholder | 🔴 Haute | Brief V2 généré avant persona résolue | Templating côté UI (render `{firstName}` à l'affichage) OR re-gen brief après enrichissement |
| **B4** | `(via X Group)` interpolé dans jobTitle | 🟡 Moyenne | `jobTitleWithPath = personaLabel + holdingNote` | Séparer dans 2 champs : `jobTitle` (clean) + `holdingPath` (metadata) |
| **B5** | `doNotContact=true` sans raison directement lisible | 🟡 Moyenne | HEAL 5 a flagué historiquement, raison textuelle pas reliée à UI | Exposer `doNotContactReason` lisible côté dashboard |
| **B6** | briefV2Json NULL malgré status NEW (RSS-levées) | 🟢 Faible | RSS poller ne déclenche pas qualifyTrigger inline | Soit auto-qualify dans rss-levees-poller, soit qualifyPendingTriggers plus fréquent |
| **B7** | `personaSource` valeurs composites non typées | 🟡 Moyenne | String concat `"none + jobtitle-upgrade + headline-upgrade"` | Enum + array (`personaSources: ["jobtitle-upgrade", "headline-upgrade"]`) ou Zod schema |

### 5 patterns positifs à formaliser/préserver

| # | Pattern | Description | Action |
|---|---|---|---|
| **P1** | RE-JUDGED 6→7 RECOVERED | Mécanisme de seconde chance V2 sur leads borderline | Identifier où c'est codé, documenter, garder |
| **P2** | jobtitle-upgrade + headline-upgrade | Tier remonte via analyse jobTitle/headline LinkedIn | Briques à extraire pour réutilisation Lead Hunter |
| **P3** | Score plancher source fiable + secteur ICP | Score min forcé pour sources fiables (Rodz M&A, ...) | À localiser dans le code + documenter |
| **P4** | QA-STUCK pattern | Détection offre QA ouverte >30j = douleur recrutement | À localiser dans qa-stuck-scanner.ts |
| **P5** | Locations élargies HQ (DiXiO Dubaï) | HarvestAPI cherche aussi dans pays HQ si non FR | Patch 11/05, déjà OK |

---

## Modules à explorer en priorité après cette Carte 1

Sur la base des découvertes ci-dessus, voici les modules à lire EN PRIORITÉ :

1. 🔥 **`qa-stuck-scanner.ts`** — pattern QA-STUCK (P4)
2. 🔥 **`requalify-engine.ts`** — où vit la logique RE-JUDGED 6→7 (P1) ?
3. 🔥 **`compute-tier-from-headline.ts` + `recompute-persona-tier-from-headline-runner.ts`** — jobtitle/headline upgrade (P2)
4. 🟡 **`rodz-provision.ts` + `enrich-via-rodz.ts`** — flow Rodz fundraising/M&A
5. 🟡 **`rss-levees-poller.ts` + `rss-levees-helpers.ts`** — pourquoi pas de qualifyTrigger inline (B6)
6. 🟡 **`enrich-via-fullenrich.ts`** — flow FullEnrich (utilisé sur Audion, SQUAREMIND)
7. 🟢 **`apify-poller.ts` (759L) + `theirstack-poller.ts` (948L)** — gros pollers (rester en survol structurel)
8. 🟢 **`bodacc-poller.ts` + `inpi-poller.ts` + `joafe-poller.ts` + `francetravail-poller.ts`** — pollers peu fertiles (lire pour pattern d'ingestion)

---

## Décision pour la suite

**Option A — Approfondir l'exploration code** (Carte 3 v2)
Lire les 8 modules prioritaires ci-dessus, mettre à jour ARCHITECTURE-V1.md avec les nouveaux patterns découverts (RE-JUDGED, jobtitle-upgrade, QA-STUCK, score plancher).

**Option B — Carte 2 (tes journées Alexis)**
Mettre cette Carte 1 de côté et attaquer la Carte 2 avec toi en binôme (1-2h de session).

**Option C — Attaquer Carte 4 (problématiques atomiques)**
Avec les Cartes 1 (faite) + Carte 3 (partielle), commencer à lister les 30-50 problématiques atomiques que le système doit résoudre.

**Mon avis** : **Option A d'abord (2-3h)**, parce que :
- On a découvert 5 patterns positifs (RE-JUDGED, upgrades, QA-STUCK, score plancher) qu'on doit comprendre AVANT de tirer un plan
- Ces briques sont probablement des candidats forts pour devenir des MCP tools des futurs agents
- Une fois Carte 3 v2 complète, la Carte 4 sera triviale à produire

Puis Carte 2 + Carte 4 en binôme avec toi.

---

**Document v1.0 — 11/05/2026**
Prochaine version après lecture des 8 modules prioritaires.
