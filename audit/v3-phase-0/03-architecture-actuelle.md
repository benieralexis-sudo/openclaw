# Audit Architecture & Dette Technique — Phase 0 v3.0

**Date** : 12/05/2026 après-midi  
**Période analysée** : code actuel `main` (HEAD `efab8cf29`)  
**Scope** : dashboard-v2 (Next.js 15 + Prisma 6 + TypeScript)

---

## 🎯 Synthèse exécutive

1. **Codebase de taille raisonnable** (~50k lignes TS/TSX, 264 fichiers) avec architecture en couches claire (lib + app routes + components + scripts).
2. **Dette technique modérée** : pas de catastrophe, mais 4 zones à nettoyer (Clay résiduel déjà dans DEPRECATED.md, FULL_SERVICE résiduel, V1/V2 cohabitation dans qualify-trigger.ts, tests <8% par fichier).
3. **3 mégafichiers >900 lignes** (trigger-brief-board 2045 / qualify-trigger 1170 / theirstack-poller 948) — à découper Phase 4+, pas bloqueurs v3.0.
4. **Pour v3.0** : 80% du code est réutilisable. Pas besoin de refonte massive. Le Brain V2 + dedup + filtres NAF + enrichissement Kaspr/Pappers sont tous solides.

---

## 📊 Inventaire général

| Couche | Fichiers | Lignes | Note |
|---|---|---|---|
| `src/lib` (logique métier) | 117 | 25 815 | Cœur du système |
| `src/app` (Next.js routes + UI) | 103 | 13 293 | API + pages |
| `src/components` (React UI) | 39 | 10 371 | Dashboard + onboarding |
| `scripts` (CLI + admin) | 46 | 6 018 | Migrations, audits, backfills |
| `prisma` (schema + migrations) | 4 | 421 | DB |
| **TOTAL** | **264** | **~56k** | |

**Couverture tests** : 20 fichiers `.test.ts` = **7.6% par fichier**. Faible mais ciblé sur les modules critiques (lead-brief-v2, qualify, scoring, copy-generator, persona, credits-math, validators).

---

## 🏗️ Cartographie modules par responsabilité

### 1. Pollers (capture sources externes) — 7 fichiers
| Fichier | Lignes | Status v3.0 |
|---|---|---|
| `apify-poller.ts` | 759 | 🔧 REFONDRE (framework capteurs Phase 4) |
| `theirstack-poller.ts` | 948 | 🗑️ ENTERRER (Phase 4-5) — coût $89/mo + ROI nul |
| `rss-levees-poller.ts` | 386 | 🔧 REFONDRE (latence 257h médian + 40% SIRENE) |
| `bodacc-poller.ts` | 338 | ✅ GARDER (sera capteur universel v3.0) |
| `inpi-poller.ts` | 311 | ✅ GARDER (capteur universel) |
| `francetravail-poller.ts` | ~280 | 🔧 REFONDRE (sera fusionné dans HiringSignalEngine) |
| `joafe-poller.ts` | ~200 | ✅ GARDER (capteur universel) |

### 2. Brain & Qualification — 4 fichiers clés
| Fichier | Lignes | Status v3.0 |
|---|---|---|
| `qualify-trigger.ts` | **1170** | ✅ GARDER (point d'entrée Opus, mais découper Phase 4) |
| `lead-brief-v2.ts` | ~300 | ✅ GARDER (Zod schema verdict OUI/NON/ENRICH) |
| `lead-brief-v2-validator.ts` | ~250 | ✅ GARDER |
| `priority-scoring.ts` | ~280 | ✅ GARDER (composite score) |
| `score-display.ts` | 313 | ✅ GARDER |
| `lead-dossier.ts` | 437 | ✅ GARDER (dossier complet pour Opus) |

### 3. Enrichissement (cascade) — 7 fichiers
| Fichier | Lignes | Status v3.0 |
|---|---|---|
| `harvestapi-decision-makers.ts` | 674 | ✅ GARDER (LinkedIn search) |
| `enrich-lead-dirigeants.ts` | 508 | ✅ GARDER (Pappers récursif holdings) |
| `pappers.ts` | 470 | 🔧 REFONDRE → remplacer par Greffe direct Phase 5 |
| `linkedin-finder.ts` | 364 | ✅ GARDER (cascade Rodz → HarvestAPI → CSE) |
| `find-tech-leader-cascade.ts` | 334 | ✅ GARDER |
| `enrich-via-kaspr-direct.ts` | 330 | ✅ GARDER (Kaspr exception RGPD) |
| `enrich-via-rodz.ts` | 311 | 🔧 REFONDRE (Rodz pack pro expire ~août, à anticiper) |

### 4. Dedup + Quotas + Credits — 4 fichiers
| Fichier | Lignes | Status v3.0 |
|---|---|---|
| `trigger-dedup.ts` | 355 | ✅ GARDER (mécanique solide) |
| `quota-checker.ts` | ~200 | ✅ GARDER |
| `quota-config.ts` | ~120 | 🔧 Petit cleanup FULL_SERVICE résiduel |
| `credits.ts` | 309 | 🔧 Petit cleanup FULL_SERVICE résiduel |

### 5. Auto-healing / Maintenance — 2 fichiers
| Fichier | Lignes | Status v3.0 |
|---|---|---|
| `audit-heal.ts` | 573 | ✅ GARDER (cleanup automatique pool) |
| `requalify-engine.ts` | ~250 | ✅ GARDER (recovery IGNORED→NEW) |

### 6. API routes critiques
| Route | Lignes | Status v3.0 |
|---|---|---|
| `internal/run-pollers/route.ts` | **701** | 🔴 REFONDRE Phase 2 — mutex global problématique (cause incident 423) |
| `internal/health/route.ts` | 287 | 🔧 ÉTENDRE (ajouter "dernière capture par source") |
| `internal/cost-report/route.ts` | 236 | ✅ GARDER (utile pour suivi quotas) |
| `webhooks/rodz/route.ts` | 417 | ✅ GARDER (HMAC validé) |

### 7. UI Dashboard (composants gros)
| Composant | Lignes | Status v3.0 |
|---|---|---|
| `trigger-brief-board.tsx` | **2045** | 🟠 Refactor Phase 5 (le plus gros) |
| `settings-board.tsx` | 930 | ✅ GARDER, refactor Phase 5 |
| `onboarding-wizard.tsx` | 900 | 🔧 ÉTENDRE Phase 5 (compilateur ICP) |
| `client-profile.tsx` | 780 | ✅ GARDER |
| `system-board.tsx` | 531 | ✅ GARDER |
| `send-email-modal.tsx` | 524 | 🟠 Cleanup post-pivot Data-only (envoi désactivé) |

---

## ⚠️ Dette technique identifiée

### 🔴 Critique (à régler avant v3.0)

#### D1 — Mutex global in-memory route run-pollers (cause incident 423)
- **Fichier** : `src/app/api/internal/run-pollers/route.ts:26`
- **Symptôme** : 41h de panne silencieuse (10-12/05), cron `source=all` toujours 423 LOCKED par collision avec `source=cron` à H:00
- **Fix court terme** : ✅ déjà appliqué (décalage cron à H:05)
- **Fix structurel Phase 2** : passer lock en Redis ou DB + séparer routes source=cron vs source=all
- **Bonus** : ajouter KPI "dernière capture par source" dans `/internal/health`

#### D2 — Bug logging `ignoredReason=null` sur Trigger.update IGNORED
- **Fichier** : `src/lib/qualify-trigger.ts:651-661`
- **Symptôme** : 231/245 IGNORED ont `ignoredReason=null` (raison réelle dans `scoreReason`)
- **Fix simple** : copier scoreReason → ignoredReason quand status passe à IGNORED
- **Effort** : 30 min
- **Priorité** : Phase 2 (rendre l'audit futur plus rapide)

#### D3 — Tracking `recordSpend Apify` cassé (mai 2026 = $0 tracké)
- **Fichier** : `src/lib/apify-poller.ts:521` + `quota-checker.ts:recordSpend`
- **Symptôme** : currentSpendUsd Apify = $0 en mai alors que Apify est censé tourner 2x/jour. Soit (a) les pollers Apify n'ont pas tourné (cohérent avec incident 423), soit (b) recordSpend plante silencieusement
- **À diagnostiquer Phase 2** : reproduire en local + ajouter throw au lieu de catch silencieux

### 🟠 Moyenne (à régler Phase 2-4)

#### D4 — FULL_SERVICE résiduel dans 3 fichiers
- Fichiers : `credits.ts`, `quota-config.ts`, `quota-config.test.ts`
- Restes du pivot Data-only 05/05
- Effort : 1h cleanup
- Risque : null (déjà partiellement traité Sprint 9-11 mai)

#### D5 — Clay résiduel (déjà DEPRECATED.md)
- 11 fichiers Clay archivés `/backups/old-clay-scripts-2026-04/`
- Variables env : `CLAY_API_KEY`, `CLAY_TABLE_ID`, `CLAY_SESSION_COOKIE`
- Webhook `/webhook/clay` accepte encore (HMAC vérifié, stocké)
- Effort : 30 min cleanup
- Priorité : faible (n'impacte pas v3.0)

#### D6 — Mégafichier `trigger-brief-board.tsx` (2045 lignes)
- Tout l'UI dashboard principal dans 1 composant
- Pas un blocker mais difficile à maintenir
- Effort : 3-5 jours refactor (split par feature)
- Priorité : Phase 5

#### D7 — V1/V2 cohabitation résiduelle dans `qualify-trigger.ts`
- 1170 lignes total
- V1 supprimé majoritairement Session 3 10/05 (commit `190ecedde`)
- Reste cohabitation lecteur briefV1/briefV2 dans quelques branches
- Effort : 2-3h cleanup final
- Priorité : Phase 2 (avant refonte Brain)

### 🟡 Faible (cosmétique)

#### D8 — Tests <8% par fichier
- 20 tests pour 264 fichiers
- Ciblés modules critiques (scoring, brief, credits, validators)
- Pas catastrophique mais à étendre
- Effort : continu, 1h/semaine
- Priorité : faible (test value > test quantity)

#### D9 — Send Email Modal résiduel (524 lignes)
- Reliquat pré-pivot Data-only où le bot envoyait des emails
- Aujourd'hui le client copie-colle l'opener, mais le composant est encore là
- Effort : 1h suppression
- Priorité : Phase 4

---

## 🛣️ Migration vers v3.0 — Plan modules

### Modules à GARDER tel quel
- Brain V2 (`qualify-trigger.ts`, `lead-brief-v2.ts`, validators)
- Dedup (`trigger-dedup.ts`)
- Enrichment cascade (Kaspr, HarvestAPI, Pappers, Rodz)
- Quotas (`quota-checker.ts`, `quota-config.ts`)
- Credits (`credits.ts`)
- Audit-heal (`audit-heal.ts`)
- Requalify engine (`requalify-engine.ts`)
- Webhooks Rodz/Resend
- Score display
- Tests Vitest (étendre, pas remplacer)

### Modules à REFONDRE (framework capteurs Phase 4)
- 7 pollers actuels → unifier sous `Sensor` interface (Phase 2 infrastructure)
- Route `run-pollers` → séparer source=cron vs source=all OU lock distribué
- Pappers → remplacer par Greffe + INPI direct Phase 5
- Onboarding wizard → étendre avec questions compilateur ICP Phase 5

### Modules à SUPPRIMER
- Clay résiduel (déjà DEPRECATED.md, supprimable maintenant)
- FULL_SERVICE résiduel (3 fichiers)
- `send-email-modal.tsx` (post-pivot Data-only, plus utilisé)
- `theirstack-poller.ts` (Phase 4-5, remplacé par HiringSignalEngine)
- Variables env Clay + Cal.com + Smartlead + Primeforge (audit secrets Phase 2)

### Modules à AJOUTER (Phase 2-5)
- `Sensor` abstract base class + 9 universal sensors (Phase 4)
- 6 vertical-tech sensors (Phase 5)
- `ScanningPlan` schema + compilateur ICP (Phase 5)
- `signal_events` TimescaleDB hypertable + Pattern Matcher (Phase 2)
- Brain V3 (event-driven, reçoit ScanningPlan + signaux convergents) (Phase 2)
- Watchlist mechanism pour ENRICH conf 58-69 (gap A.0.1)
- Outcomes loop ingest + re-pondérateur mensuel (Phase 6)

---

## 🔍 Architecture cible v3.0 (vue d'oiseau)

```
┌─────────────────────────────────────────────────────────┐
│ EXISTANT v2 (95% réutilisé)                              │
├─────────────────────────────────────────────────────────┤
│ Sources externes (pollers Apify/INPI/BODACC/...) ────┐   │
│ Brain V2 Opus (qualify-trigger.ts) ────────────────┐ │   │
│ Enrichment cascade (Kaspr/Pappers/HarvestAPI) ───┐ │ │   │
│ Dedup + Quotas + Credits + Audit-heal ─────────┐ │ │ │   │
│ Webhooks + Dashboard UI ─────────────────────┐ │ │ │ │   │
└──────────────────────────────────────────────┼─┼─┼─┼─┼───┘
                                               │ │ │ │ │
┌──────────────────────────────────────────────▼─▼─▼─▼─▼───┐
│ AJOUTS v3.0 (Phase 2-6)                                  │
├─────────────────────────────────────────────────────────┤
│ TimescaleDB signal_events (hypertable horodatée)          │
│ Sensor framework (abstract) + 9 universal + 6 vertical    │
│ ScanningPlan JSON par client + compilateur ICP-as-Code    │
│ Pattern Matcher horaire (3-signal convergence rule)       │
│ Brain V3 event-driven (reçoit ScanningPlan + signaux)     │
│ Watchlist ENRICH conf 58-69 (90j)                         │
│ Outcomes Loop + re-pondérateur mensuel                    │
└─────────────────────────────────────────────────────────┘
```

→ **80% du code reste**, on ajoute des couches au-dessus. Pas de big-bang.

---

## 📊 Effort de refonte estimé

| Phase | Tâches code | Jour-homme estimé |
|---|---|---|
| Phase 2 — Infrastructure | TimescaleDB + Sensor base + lock Redis + bug ignoredReason | 14 j |
| Phase 4 — Construction capteurs | 8 capteurs universels + watchlist ENRICH | 60 j |
| Phase 5 — Vertical-tech + compilateur | 6 capteurs tech + compilateur ICP + onboarding wizard | 45 j |
| Phase 6 — Outcomes loop | Webhooks + re-pondérateur + UI | 30 j |
| **TOTAL** | | **~150 j** = 7 mois pleins |

Cohérent avec timeline 7 mois Phase 0-6 du cadrage stratégique.

---

## ✅ Critère de sortie A.0.3 — atteint

- [x] Inventaire structuré code (264 fichiers, ~56k lignes)
- [x] Cartographie modules par responsabilité (7 groupes)
- [x] Dette identifiée par sévérité (D1-D9)
- [x] Plan migration GARDER / REFONDRE / SUPPRIMER / AJOUTER
- [x] Architecture cible v3.0 schématisée
- [x] Effort de refonte estimé par phase

→ Prochaines étapes : **A.0.2** (qualité 200 leads tagging — nécessite Jojo solo) + **A.0.5** (interview Fred + ICP affiné)

---

## 🎯 Découvertes critiques A.0.3

1. **Le code est plus sain qu'attendu** : pas de catastrophe, dette modérée, architecture en couches claire.
2. **80% du code v2 réutilisable en v3.0** — pas besoin de refonte. On AJOUTE des couches.
3. **3 mégafichiers >900 lignes** existent mais ne bloquent pas v3.0 (refactor possible Phase 5).
4. **Le mutex global `runPollersLock` est le point d'achoppement #1** technique : à refondre en Lock distribué Phase 2.
5. **Tests <8% mais ciblés** sur les modules critiques (scoring, brief, credits) — base saine à étendre.
6. **`audit-heal.ts` (573 lignes) est déjà un système de cleanup autonome** — précurseur de l'outcomes loop Phase 6.
