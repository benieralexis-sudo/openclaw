# Architecture iFIND v1.0 — Cartographie système

**Date** : 11/05/2026
**Auteur** : Claude (Opus 4.7) en session de cartographie avec Alexis
**Objectif** : Comprendre TOUT le système actuel avant de bâtir l'architecture d'agents IA

---

## TL;DR — 3 minutes de lecture

**Le système iFIND est en bonne santé architecturale, mais pas encore prêt pour les agents IA.**

**✅ Ce qui est solide** :
- Multi-tenant rigoureux (clientId partout)
- Schémas Zod sur les modèles critiques (briefV2, delivery, quota)
- Doctor agent déjà en prod avec Agent SDK + 3 MCP tools (commit 1049c75fd)
- Architecture séparée `agents/` ↔ `dashboard-v2/` — bon découplage
- 349 tests Vitest verts sur les briques pures critiques

**🟡 Ce qui marche mais est désordonné** :
- 113 fichiers libs, 25k lignes — pas tout est nécessaire pour les agents
- Quelques gros fichiers (qualify-trigger 1087L, theirstack-poller 948L, audit-heal 573L) avec 11 HEALs / 12 steps inline → à éclater en briques nommées
- 5 duplications structurelles repérées (genCuid, tech NAF regex×3, tier mapping, persona priority)
- Pattern EnrichmentProvider implicite mais pas formalisé (4 enrich-via-* avec même squelette)

**🔴 Ce qui doit être attaqué avant les agents** :
- **`Client.icp` JSON non typé** (~20 champs piochés sans Zod) — bloquant pour Onboarder agent
- **11 HEALs inline dans audit-heal.ts** — à extraire en briques pour qu'un futur Auditor IA les utilise
- **Pas de doc des problématiques atomiques** (Carte 4) — on saura quels outils créer une fois fait

**🟢 Le pattern Doctor est génialement réutilisable** : pour ajouter un agent (Auditor, Lead Hunter, Watchdog, ...) il suffit de copier 4 fichiers + écrire un nouveau prompt système. La machinerie SDK + MCP tools + audit + systemd + Telegram est faite.

**Verdict effort agents V1** :
- 60% du chemin déjà fait
- 30 briques atomiques à extraire (listées en §7)
- ~1-2 semaines de refacto focus
- Premier agent post-Doctor envisageable : **Auditor** (2-3j, utilise HEALs extraits + briques persona déjà testées)

**Reste à faire dans cette analyse** :
- Carte 1 (voyage end-to-end de 3 leads) → BINÔME avec Alexis
- Carte 2 (journées Alexis heure par heure) → BINÔME avec Alexis
- Carte 4 (30-50 problématiques atomiques) → après Cartes 1+2
- Lecture profonde des pollers (5 600 lignes restantes) — peut être déléguée à un agent Explorer si urgent

---

---

## 0. Mission de ce document

Ce document n'est pas un plan. C'est une **carte du territoire**.

Avant de construire les outils atomiques et les agents IA qui feront tourner iFIND
24/7, on doit comprendre PRÉCISÉMENT ce qui existe déjà, dans quel état, et où sont
les zones d'ombre. Cette carte sera la base de toutes les décisions architecturales
qui suivront.

Le document est organisé en 4 cartes (cf. méthode posée le 11/05) :
- **Carte 1** — Voyage d'un lead (end-to-end) → À FAIRE EN BINÔME avec Alexis
- **Carte 2** — Journées d'Alexis → À FAIRE EN BINÔME avec Alexis
- **Carte 3** — Inventaire du code → **CE DOCUMENT (livré 11/05 ~16h CET)**
- **Carte 4** — Problématiques atomiques → À PRODUIRE après Cartes 1+2

---

## 1. Périmètre analysé

### ✅ Lu en profondeur (intégralement) et inventorié

- `prisma/schema.prisma` (660 lignes — schéma DB complet)
- `src/lib/qualify-trigger.ts` (1087 lignes — cerveau qualification Opus V2)
- `src/lib/ensure-lead-for-trigger.ts` (283 lignes — Trigger→Lead)
- `src/lib/enrich-lead-dirigeants.ts` (499 lignes — Pappers + persona)
- `src/lib/harvestapi-decision-makers.ts` (675 lignes — décideur LinkedIn)
- `src/lib/find-tech-leader-cascade.ts` (334 lignes — Google CSE cascade)
- `src/lib/audit-heal.ts` (573 lignes — agent réparation actuel)
- `src/lib/lead-dossier.ts` (extrait — builder contexte judge)
- `agents/doctor/doctor.mjs` + `agents/lib/*` (Agent SDK Doctor complet, 639 lignes)
- `package.json` (deps dashboard-v2 + deps agents)

### 🟡 Scanné rapidement (head + structure)

- Liste exhaustive des 113 fichiers `src/lib/*.ts`
- Inventaire des routes API internes
- Structure `src/app/` (App Router Next.js)

### ❌ NON analysé (zones grises à explorer ensemble)

- **Pollers** (theirstack-poller.ts 948 lignes, apify-poller.ts 759 lignes, rodz-provision.ts 540 lignes, bodacc-poller.ts, inpi-poller.ts, joafe-poller.ts, rss-levees-poller.ts, francetravail-poller.ts) — j'ai juste la taille
- **Modules enrich-via-***  (kaspr-direct, fullenrich, rodz, linkedin-finder) — pas lus
- **Clients API** (pappers.ts 470 lignes, kaspr.ts, fullenrich.ts, apify.ts 419 lignes, rodz.ts 308 lignes, telegram-alert.ts)
- **Génération copy/brief** (brief-builder.ts, copy-generator.ts, copy-runner.ts, auto-generate-briefs.ts)
- **Lead ops detail** (lead-status-sync.ts, lead-activity.ts, lead-enrichment-tagging.ts, lead-cross-source.ts, trigger-dedup.ts)
- **Crédits / Stripe** (credits.ts, credits-math.ts en partie, delivery-config.ts, delivery-sender.ts)
- **Scoring** (priority-scoring.ts en partie, persona-fit-scoring.ts en partie, score-display.ts)
- **Détecteurs** (combo-detector.ts, growth-detector.ts, declarative-pain.ts)
- **Web scrape** (layoffs-news-search.ts, company-website-fetcher.ts)
- **UI** (composants React, brain UI, command-palette, trigger-board)
- **API routes** (toutes — 30+ endpoints)
- **Scripts** (scripts/*.ts — 30+ scripts audit/backfill/recovery)

**Estimation couverture profonde** : ~12 fichiers / 113 = **~10% du code lu intégralement, mais qui couvre le coeur du pipeline**.

---

## 2. Vue d'ensemble — 2 sous-projets

```
/opt/moltbot/
├── dashboard-v2/              # PROJET PRINCIPAL — Next.js 15 + Prisma + 113 libs
│   ├── src/app/               # App Router (pages + API routes)
│   ├── src/lib/               # 113 modules métier (~25 000 lignes)
│   ├── src/components/        # Composants React
│   ├── prisma/                # Schema + migrations + seeds
│   └── scripts/               # ~30 scripts audit/backfill/recovery
│
├── agents/                    # AGENTS IA — séparé, Agent SDK
│   ├── doctor/doctor.mjs      # 1er agent en prod (désactivé ce soir)
│   ├── lib/                   # Briques partagées (mcp-tools, audit, postgres, telegram)
│   ├── prompts/               # Prompts système par agent
│   └── systemd/               # Services Linux dédiés
│
├── landing/ + landing-v2/     # Sites publics (marketing)
├── gateway/                   # Caddy proxy
├── data/                      # Volumes Docker persistants
├── docker-compose.yml         # Stack postgres + dashboards
└── scripts/                   # Scripts shell (backup, monitor, etc.)
```

**Décision architecturale clé** : `agents/` est séparé de `dashboard-v2/` (pas de dep cruisée, pool DB read-only séparé). C'est un bon découplage.

**Conséquence pour la suite** : tout nouvel agent va dans `/opt/moltbot/agents/`. Les outils que l'agent doit utiliser via MCP doivent être implémentés là (pas dans dashboard-v2). Mais l'agent PEUT appeler des routes HTTP de dashboard-v2 si besoin (ex: `/api/internal/audit-heal`).

---

## 3. Schéma de données (Prisma) — résumé

### Modèles centraux

| Modèle | Rôle | Notes |
|---|---|---|
| **Client** | tenant | ICP JSON, quotas, crédits, Stripe |
| **Trigger** | événement détecté (le SIGNAL) | type, score 1-10, briefV2 JSON, status pipeline |
| **Lead** | personne identifiée | ⚠️ **GOD OBJECT (50+ champs)** |
| **LeadCredit** | transactions crédits | rollover, expiry, Pépites |
| **LeadActivity** | timeline multi-canal | email/LinkedIn/appel/RDV (post-pivot Data-only: surtout DASHBOARD_INTERACTION) |
| **RodzSignal** | monitors Rodz par client | config webhook |
| **User** | auth Better Auth | roles ADMIN/COMMERCIAL/CLIENT/EDITOR/VIEWER |
| **AuditLog** | trace actions critiques | userId, clientId, action, metadata |
| **Waitlist** | inscriptions publiques | en attente Stripe FR |

### 🚨 Le Lead est un God Object

Le modèle `Lead` (50+ champs) agrège **6 responsabilités** :

1. **Personne** : firstName, lastName, fullName, jobTitle, linkedinUrl, email, phone, emailStatus
2. **Entreprise dénorm** : companyName, companySiret + financials (revenue, resultNet, etabsCount, recentDepots, hasInsolvency)
3. **Briefs générés (cache)** : briefJson, pitchJson, linkedinDmJson, callBriefJson, warmMailJson + timestamps
4. **Enrichissements waterfall** : kaspr* (5 champs), fullenrich* (3 champs), dropcontact* (1 champ), harvestapi* (1 champ), rodz* (1 champ), linkedinFinder* (1 champ), linkedinProfile* (2 champs)
5. **Persona scoring** : personaTier, personaSource, linkedinSource, fitScore, fitScoreBreakdown, fitScoreComputedAt, dataQuality, emailConfidence, emailSourceCount
6. **RGPD + delivery** : doNotContact, doNotContactReason, doNotContactAt, bouncedAt, bouncedFromEmail, emailHistory

**Conséquence** : impossible de faire évoluer une dimension sans toucher au modèle Lead entier. Le schéma encourage le couplage.

**À considérer pour V2** : split en `Lead`, `LeadContact`, `LeadEnrichmentState`, `LeadCompany`, `LeadBriefs`, `LeadDelivery`. Mais coûteux à migrer en production.

### Champs Json non typés (schémas implicites)

- `Client.icp` (configuration ICP par client — STRUCTURE INCONNUE sans grep)
- `Client.deliveryConfig` (validé par Zod dans `lib/delivery-config.ts`)
- `Client.quotaConfig` (validé par Zod dans `lib/quota-config.ts`)
- `Trigger.briefV2Json` (validé par Zod dans `lib/lead-brief-v2.ts`)
- `Trigger.rawPayload` (multi-format selon sourceCode — Apify/TheirStack/Rodz/RSS/...)
- `Lead.briefJson`, `Lead.pitchJson`, `Lead.linkedinDmJson`, `Lead.callBriefJson`, `Lead.warmMailJson` (schémas Zod via lead-brief-v2-validator ?)
- `Lead.kasprResponseJson` (réponse brute Kaspr)
- `Lead.linkedinProfileJson` (réponse HarvestAPI Profile Full)
- `Lead.fitScoreBreakdown` (détail scoring)
- `Lead.companyRecentDepots` (Pappers RCS dépôts d'actes)

**Risque** : pour qu'un futur agent IA puisse lire/comprendre ces JSON, on doit documenter les schémas (idéalement en Zod). Sinon l'agent devra deviner.

---

## 4. Carte 3 — Inventaire des 113 modules src/lib/

### 4.1. 🌐 Sources externes (clients API)

| Module | Lignes | État | Rôle |
|---|---|---|---|
| `anthropic.ts` | ? | ⚪ non lu | Wrapper SDK Claude (Opus + Sonnet) |
| `anthropic-cost.ts` | ? | ⚪ non lu | Compute coût appel (input/output/cache tokens) |
| `anthropic-prompt.ts` | ? | ⚪ non lu | buildCachedSystem (cache 5min) |
| `apify.ts` | 419 | ⚪ non lu | Apify SDK (runs + items) |
| `pappers.ts` | 470 | ⚪ non lu | getEntreprise + récursion holdings |
| `kaspr.ts` | ? | ⚪ non lu | Kaspr enrichment |
| `fullenrich.ts` | ? | ⚪ non lu | FullEnrich waterfall |
| `rodz.ts` | 308 | ⚪ non lu | Rodz API + enrichContact |
| `theirstack.ts` | 397 | ⚪ non lu | TheirStack API |
| `francetravail.ts` | ? | ⚪ non lu | France Travail API |
| `harvestapi-linkedin.ts` | ? | ⚪ non lu | HarvestAPI client (Profile Full) |
| `mailbox.ts` | ? | ⚪ non lu | IMAP (post-pivot caduc ?) |
| `telegram-alert.ts` | ? | ⚪ non lu | Bot Telegram |
| `email-smtp-verifier.ts` | ? | ⚪ non lu | SMTP verify (DNS MX + RCPT TO) |
| `company-website-fetcher.ts` | ? | ⚪ non lu | Fetch + summary site web |
| `layoffs-news-search.ts` | 338 | ⚪ non lu | Google CSE news (utilise GOOGLE_API_KEY / GOOGLE_CSE_ID) |

**Brique attendue dans cette catégorie** :
- Chaque client API doit avoir une **signature normalisée** : `(input typé) → Promise<output typé | null>` avec gestion erreur/timeout/quota interne.
- À auditer ensemble : chaque module fait-il vraiment QUE l'appel API, ou contient-il aussi de la logique métier (waterfall, dedup, transformation) ?

### 4.2. 📥 Pollers (ingestion signal)

| Module | Lignes | État | Source ingérée |
|---|---|---|---|
| `apify-poller.ts` | 759 | ⚪ non lu | Apify (LinkedIn jobs, WTTJ, declarative pain) |
| `bodacc-poller.ts` | 338 | ⚪ non lu | BODACC (créations, modifications, levées) |
| `francetravail-poller.ts` | ? | ⚪ non lu | Annonces France Travail |
| `inpi-poller.ts` | 311 | ⚪ non lu | INPI (marques, brevets) |
| `joafe-poller.ts` | ? | ⚪ non lu | JOAFE (associations) |
| `rss-levees-poller.ts` | 386 | ⚪ non lu | RSS levées (Les Echos, Maddyness, etc.) |
| `rss-levees-helpers.ts` | ? | ⚪ non lu | Helpers parsing RSS |
| `theirstack-poller.ts` | 948 | ⚪ non lu | TheirStack (jobs + buying-intent) — gros fichier |
| `theirstack-provision.ts` | ? | ⚪ non lu | Provisionnement requêtes TheirStack |
| `rodz-provision.ts` | 540 | ⚪ non lu | Provisionnement signaux Rodz |

**Note** : pollers = 5 600+ lignes au total. Probablement beaucoup de logique partagée à factoriser (parsing payload, dedup trigger, attribution SIRENE Pappers, scoring initial). C'est UN sujet majeur à creuser ensemble.

**Brique attendue dans cette catégorie** :
- `parseAndNormalizeSignal(rawPayload, sourceCode) → NormalizedTrigger`
- `attributeSirene(companyName, ...) → companySiret | null`
- `dedupTrigger(normalizedTrigger) → existingTriggerId | null`
- `createTriggerWithBaselineScore(normalizedTrigger) → Trigger`

### 4.3. 🧠 Pipeline décision (qualification) — ✅ LU EN PROFONDEUR

| Module | Lignes | État | Rôle |
|---|---|---|---|
| `qualify-trigger.ts` | 1087 | 🟡 lu | Cerveau qualif Opus V2 (orchestrateur 12 steps) |
| `lead-brief-v2.ts` | ? | ⚪ scan | Schema Zod LeadBriefV2 |
| `lead-brief-v2-validator.ts` | ? | ⚪ scan | Validator strict V2 |
| `lead-verdict.ts` | 308 | ⚪ scan | Mapping verdict → display |
| `priority-scoring.ts` | ? | ⚪ scan | Freshness + multisource boost |
| `priority-scoring-runner.ts` | ? | ⚪ scan | Runner batch |
| `combo-detector.ts` | ? | ⚪ scan | Détection combos signaux |
| `growth-detector.ts` | ? | ⚪ scan | Détection croissance |
| `naf-whitelist.ts` | ? | ⚪ scan | Whitelist NAF tech |
| `client-icp-matcher.ts` | ? | ⚪ scan | Match lead vs ICP client |
| `score-display.ts` | 313 | ⚪ scan | Affichage score UX |
| `simplify-trigger-title.ts` | ? | ⚪ scan | Simplification titre |

**Briques identifiées dans `qualify-trigger.ts` (à extraire pour réutilisation par futurs agents)** :

| Brique | État | Niveau extraction |
|---|---|---|
| `qualifyTrigger` orchestration (12 steps) | 🟡 | À splitter en sub-fonctions |
| `qualifyTriggerV2` (single Opus call + Zod) | 🟡 | À extraire dans `lib/judge-v2.ts` |
| `qualifyTriggerV2WithValidation` wrapper | ✅ | Propre |
| `qualifyPendingTriggers` batch | ✅ | Propre |
| `getNegativeSignalsForCompany` | ✅ | Pure, helper judge |
| `getPriorSignalsForCompany` | ✅ | DB read pur |
| `getCrossTenantSignal` | ✅ | DB read pur |
| `extractFullDescription` | ✅ | Pure |
| `formatLinkedinProfileForJudge` | ✅ | Pure |
| `preOpusRejectScan` + 7 patterns | 🟡 | À extraire `lib/pre-opus-reject.ts` |
| `detectComboPatterns` interne | ✅ | Pure |
| `triggerImmediateEnrichment` | 🟡 | À extraire `lib/auto-enrich-pipeline.ts` |
| **`mapVerdictToScore` (inline)** | 🔴 | Enfoui ligne 580-594 |
| **`naf-whitelist-guard` B12 (inline)** | 🔴 | Enfoui ligne 551-575 |
| **`QUALIFY_V2_SPECIFIC` system prompt (150 lignes)** | 🟡 | Mérite fichier dédié |

### 4.4. 🔌 Enrichissement (le sujet brûlant DiXiO)

| Module | Lignes | État | Rôle |
|---|---|---|---|
| `enrich-via-kaspr-direct.ts` | 330 | ⚪ non lu | Kaspr enrichment direct |
| `enrich-via-fullenrich.ts` | ? | ⚪ non lu | FullEnrich waterfall (post-Kaspr) |
| `enrich-via-rodz.ts` | 311 | ⚪ non lu | Rodz enrichContact |
| `enrich-via-linkedin-finder.ts` | ? | ⚪ non lu | LinkedIn cascade |
| **`enrich-lead-dirigeants.ts`** | **499** | **🟡 lu** | Pappers + persona priority |
| `enrich-linkedin-profile-runner.ts` | ? | ⚪ non lu | Runner HarvestAPI profile |
| **`harvestapi-decision-makers.ts`** | **675** | **🟡 lu** | Décideurs LinkedIn + cascade Google |
| **`find-tech-leader-cascade.ts`** | **334** | **🟡 lu** | Google CSE cascade (Levier 2) |
| `linkedin-finder.ts` | 364 | ⚪ non lu | Finder cascade |
| `linkedin-profile-extractor.ts` | ? | ⚪ scan | Extracteur LinkedIn profile |
| `recompute-email-confidence.ts` | ? | ⚪ non lu | Email confidence |
| `recompute-data-quality.ts` | ? | ⚪ non lu | Data quality 0-100 |
| `dedup-persona-leads.ts` | ? | ⚪ non lu | Dédoublonnage |
| `verify-persona-coherence.ts` | ? | ⚪ scan | Domain match + persona check |
| `email-history.ts` | ? | ⚪ non lu | Historique emails |

**Briques identifiées dans `enrich-lead-dirigeants.ts`** :

| Brique | État |
|---|---|
| `enrichDirigeantsForClient` orchestrateur | 🟡 400+ lignes inline |
| `matchPersonaPriority` | 🟡 Pure, à extraire |
| `bucketByEffectif` | 🟡 Pure, à extraire `lib/company-size.ts` |
| `isPersonneMorale` (closure inline) | 🔴 Pure logic enfouie |
| `isWrongPersona` (closure inline) | 🔴 Idem |
| **TECH_NAF_RE + isHiringKey logic** | 🔴 **DUPLICATE avec ensure-lead-for-trigger** |
| **`tierFromQualite` (IIFE inline)** | 🔴 **DUPLICATE avec compute-tier-from-jobtitle** |
| Fix M oversized (inline) | 🔴 Pure logic à extraire |
| Q2 blockOutreachOnLargeCo (inline) | 🔴 Logique métier enfouie |
| C8 anti-Lead-fantôme (inline) | 🔴 Logique métier enfouie |

**Briques identifiées dans `harvestapi-decision-makers.ts`** :

| Brique | État |
|---|---|
| `findDecisionMakerByCompany` | ✅ Bien structuré (cache LRU + strict mode) |
| `enrichDecisionMakersForClient` | 🟡 175 lignes inline, à splitter |
| `inferSignalType` | ✅ Pure, exporté |
| `scoreProfile` (interne) | ✅ Pure |
| **NAF detection inline (522-526)** | 🔴 **3e copie des regex tech NAF** |
| RULES_* (5 datasets parallèles) | 🟡 80% duplication entre rules |
| Cache LRU in-process | ✅ Propre |

**Briques identifiées dans `find-tech-leader-cascade.ts`** :

| Brique | État |
|---|---|
| `findTechLeaderByCompany` | ✅ Bien structuré |
| `queryGoogleCSE` interne | ✅ Propre |
| `scoreCandidate` interne | ✅ Pure |
| `parseFullNameFromTitle` interne | ✅ Pure |
| `extractRoleFromTitle` interne | ✅ Pure |
| `normalizeLinkedInUrl` interne | ✅ Pure |
| `isLinkedInProfileUrl` interne | ✅ Pure |
| **BLOQUÉ EN PROD** : Google CSE 403 sur projet `ifind-494914` (cause inconnue, abandon) | ⚠️ |

### 4.5. 🎯 Persona tier / fit

| Module | Lignes | État | Rôle |
|---|---|---|---|
| `compute-tier-from-headline.ts` | ? | 🟡 scan (testé) | Tier depuis headline |
| `compute-tier-from-jobtitle.ts` | ? | 🟡 scan (testé) | Tier depuis job title (**duplicate avec inline enrich-lead-dirigeants**) |
| `persona-fit-scoring.ts` | ? | 🟡 scan (testé) | Fit score 0-100 |
| `persona-fit-runner.ts` | ? | ⚪ non lu | Runner batch |
| `recompute-persona-tier-from-headline-runner.ts` | ? | ⚪ non lu | Runner backfill |

### 4.6. ✍️ Génération copy/brief

| Module | Lignes | État | Rôle |
|---|---|---|---|
| `brief-builder.ts` | ? | ⚪ non lu | Brief builder principal |
| `copy-generator.ts` | ? | 🟡 scan (testé) | Copy generator (4 types) |
| `copy-runner.ts` | ? | ⚪ non lu | Runner copy |
| `auto-generate-briefs.ts` | ? | ⚪ non lu | Auto-gen briefs |
| `requalify-engine.ts` | ? | ⚪ non lu | Re-qualify engine |
| `dynamic-few-shots.ts` | ? | ⚪ scan | Few-shots dynamiques depuis ICP |
| **`lead-dossier.ts`** | **437** | **🟡 lu (extrait)** | Builder LeadDossier pour judge — ✅ propre |

### 4.7. 📊 Lead ops

| Module | Lignes | État | Rôle |
|---|---|---|---|
| **`ensure-lead-for-trigger.ts`** | **283** | **🟡 lu** | Trigger → Lead minimal |
| `lead-activity.ts` | ? | ⚪ non lu | Activities (logs multi-canal) |
| `lead-status-sync.ts` | ? | 🟡 scan | archiveLeadOnTriggerIgnored + unarchiveOnTriggerRevived |
| `lead-cross-source.ts` | ? | ⚪ non lu | Cross-source |
| `lead-enrichment-tagging.ts` | ? | 🟡 scan | markLeadEnrichedFromPappers |
| `lead-digest-builder.ts` | ? | 🟡 scan (testé) | Digest builder |
| `track-lead-interaction.ts` | ? | ⚪ non lu | Track DASHBOARD_INTERACTION |
| `trigger-dedup.ts` | 355 | ⚪ non lu | Déduplication Trigger |
| `declarative-pain.ts` | ? | ⚪ non lu | Detection douleur déclarative |

### 4.8. 🎫 Crédits & business

| Module | Lignes | État | Rôle |
|---|---|---|---|
| `credits.ts` | ? | 🟡 scan | Crédits engine (debit/credit/expiry) |
| `credits-math.ts` | ? | 🟡 scan (testé) | Pure math crédits |
| `delivery-config.ts` | ? | 🟡 scan | Config livraison par client (Zod) |
| `delivery-sender.ts` | ? | ⚪ non lu | Sender |
| `realtime-alert-sender.ts` | ? | ⚪ non lu | Alertes temps réel |
| `weekly-digest-runner.ts` | ? | ⚪ non lu | Digest hebdo |
| `qa-stuck-scanner.ts` | ? | ⚪ non lu | QA stuck scanner |
| `quota-checker.ts` | ? | 🟡 scan | checkQuota + recordSpend |
| `quota-config.ts` | ? | 🟡 scan (testé) | Config quotas Zod |

### 4.9. 🛠️ Utils

| Module | Lignes | État | Rôle |
|---|---|---|---|
| `client-scope.ts` | ? | 🟡 scan (testé) | resolveClientScope (multi-tenant) |
| `db.ts` | ? | ⚪ scan | Prisma client |
| `format-company.ts` | ? | 🟡 scan (testé) | Format entreprise |
| `format-trigger-detail.ts` | ? | ⚪ non lu | Format détail |
| `phone-fr.ts` | ? | ⚪ non lu | Validation phone FR |
| `split-full-name.ts` | ? | 🟡 scan | Split full name (probablement duplicate avec inline) |
| `rate-limit.ts` | ? | ⚪ non lu | Rate limiting |
| `utils.ts` | ? | ⚪ non lu | Utils génériques |
| `auth-client.ts` | ? | ⚪ non lu | Auth client |
| `todo-today.ts` | ? | 🟡 scan (testé) | Todo today |
| `company-variants.ts` (nouveau 11/05) | 70 | ✅ lu | Variantes nom société |

### 4.10. 🧪 Tests (18 fichiers)

```
client-scope.test.ts ✅
company-variants.test.ts ✅ (12 tests)
compute-tier-from-headline.test.ts
compute-tier-from-jobtitle.test.ts
copy-generator.test.ts
credits-math.test.ts
format-company.test.ts
lead-brief-v2-validator.test.ts
lead-brief-v2.test.ts
lead-digest-builder.test.ts
lead-verdict.test.ts
linkedin-profile-extractor.test.ts
persona-fit-scoring.test.ts
priority-scoring.test.ts
quota-config.test.ts
score-display.test.ts
simplify-trigger-title.test.ts
todo-today.test.ts
```

**349 tests Vitest verts** (état au 11/05/2026 ~12h CET).
**Couverture estimée** : ~16% des fichiers de lib ont un test — très inégal.

### 4.11. 🤖 Agents IA (`/opt/moltbot/agents/`)

```
agents/
├── doctor/doctor.mjs (191 lignes)
├── lib/
│   ├── audit.mjs (107 lignes) — hooks + audit JSON
│   ├── env.mjs (22 lignes) — variables env
│   ├── mcp-tools.mjs (123 lignes) — 3 MCP tools
│   ├── postgres.mjs (36 lignes) — pool PG READ-ONLY
│   └── telegram.mjs (25 lignes) — bot
├── prompts/doctor-system.md (98 lignes)
└── systemd/ifind-doctor.{service,timer}
```

**Pattern Doctor — TOTALEMENT RÉUTILISABLE pour les futurs agents** ✅

3 MCP tools déjà prêts à être partagés :
1. `mcp__ifind__query_postgres` (SELECT only, max 50 rows, timeout 15s, regex anti-mutations)
2. `mcp__ifind__send_telegram_alert` (Markdown, severity ok/warning/critical)
3. `mcp__ifind__get_system_snapshot` (Docker, systemd, disk, memory, pg_isready)

Garde-fous :
- `canUseTool` whitelist stricte
- `READ_ONLY_REGEX` + `FORBIDDEN_REGEX` dans query_postgres
- `maxTurns: 25`
- pool DB séparé
- `permissionMode: 'default'`
- Hooks d'audit (toutes les tool_use logées)

**Statut actuel** : Doctor désactivé (systemctl stop+disable ifind-doctor.timer) en attente de l'analyse du jour.

---

## 5. Observations transverses — Anti-patterns repérés

### 5.1. Duplications structurelles ⚠️

| Pattern dupliqué | Localisations |
|---|---|
| **`genCuid()`** function | ensure-lead-for-trigger.ts:21 + enrich-lead-dirigeants.ts:57 |
| **Tech NAF detection regex** | ensure-lead-for-trigger.ts:228 (`TECH_NAF_RE`) + enrich-lead-dirigeants.ts:319 (`TECH_NAF_RE`) + harvestapi-decision-makers.ts:522-526 (inline) |
| **Tier from qualité/title** | compute-tier-from-jobtitle.ts (module testé) + enrich-lead-dirigeants.ts:438-444 (`tierFromQualite` inline IIFE) |
| **Persona priority weights** | enrich-lead-dirigeants.ts:19-27 (`PERSONA_PRIORITY`) + harvestapi-decision-makers.ts:148-187 (`RULES_QA_HIRE`/`RULES_TECH_HIRE`/...) |
| **Company name normalization** | company-variants.ts (extrait 11/05) + probablement dans pollers (à vérifier) |

### 5.2. Briques métier enfouies (closures inline / IIFE)

- `isPersonneMorale` closure inline dans enrich-lead-dirigeants
- `isWrongPersona` closure inline dans enrich-lead-dirigeants
- `tierFromQualite` IIFE inline dans enrich-lead-dirigeants
- `mapVerdictToScore` inline dans qualify-trigger:580-594
- `naf-whitelist-guard B12` inline dans qualify-trigger:551-575
- `isOversized (Fix M)` inline dans enrich-lead-dirigeants:382-389
- `Q2 blockOutreachOnLargeCo` inline dans enrich-lead-dirigeants:368-375
- `C8 anti-Lead-fantôme` inline dans enrich-lead-dirigeants:418-432
- 11 HEALs inline dans audit-heal.ts (SQL + TS)

### 5.3. God Object (Lead model Prisma)

Le `Lead` model agrège 6 responsabilités. Conséquence : tout module qui touche au Lead doit le considérer dans son entier.

### 5.4. Modules de plus de 500 lignes (refacto candidates)

| Fichier | Lignes | Pourquoi gros |
|---|---|---|
| `qualify-trigger.ts` | **1087** | Orchestrateur + helpers + judge V2 + prompt 150 lignes |
| `theirstack-poller.ts` | 948 | À auditer ensemble |
| `apify-poller.ts` | 759 | À auditer ensemble |
| `harvestapi-decision-makers.ts` | 675 | Resolver + pipeline + rules |
| `audit-heal.ts` | 573 | 11 HEALs inline |
| `rodz-provision.ts` | 540 | À auditer ensemble |
| `enrich-lead-dirigeants.ts` | 499 | Orchestrateur + helpers inline |
| `pappers.ts` | 470 | Client API + récursion holdings |
| `lead-dossier.ts` | 437 | Builder + renderer (mais ✅ structuré) |
| `apify.ts` | 419 | À auditer ensemble |
| `theirstack.ts` | 397 | À auditer ensemble |
| `rss-levees-poller.ts` | 386 | À auditer ensemble |

### 5.5. Json non typés sans schéma Zod documenté

- **`Client.icp`** — structure complexe (~20 champs), piochée à 30+ endroits dans le code
- `Trigger.rawPayload` (multi-format selon sourceCode)
- `Lead.kasprResponseJson`, `Lead.linkedinProfileJson`, `Lead.fitScoreBreakdown`

**Détail Client.icp** (champs identifiés en lisant lead-dossier.ts, dynamic-few-shots.ts, client-icp-matcher.ts, qualify-trigger.ts) :

| Champ | Type | Rôle |
|---|---|---|
| `dreamArchetype` | string | Profil idéal du client |
| `signalPrimary` | string | Signal #1 priorité (Q1 onboarding Fred) |
| `signalSecondary` | string | Signal #2 |
| `redFlagsHard` | string[] | Red flags durs (verdict NON systématique) |
| `redFlagsSoft` | string[] | Red flags soft (downgrade ENRICH) |
| `nonRedFlags` | string[] | Pas pénaliser ces dimensions (autorité client) |
| `antiPersonas` | string[] | Concurrents directs (Capgemini, Sopra, ...) |
| `preferredSignals` | ? | Signaux préférés |
| `pitchVerbatim` | string | Pitch utilisé tel quel dans l'opener |
| `fewShotPositives` | Record | Exemples positifs |
| `dynamicFewShots` | DynamicFewShots | Few-shots adaptatifs (générés ?) |
| `dynamicFewShotsEnabled` | boolean | Kill switch few-shots |
| `freshnessByTrigger` | Record | Bornes fraîcheur par type trigger |
| `naf_codes` | string[] | Whitelist NAF tech |
| `industries`, `sizes` | ? | Filtres industrie/taille |
| `personaTitles` | ? | Titres cibles |
| `keywordsHiring` | ? | Mots-clés hiring |
| `minScore` | number | Score plancher visible dashboard |
| `country_codes` | string[] | FR par défaut |
| `company_size_min/max` | number | Bornes effectif ICP |
| `regions`, `cities` | string[] | Régions cibles |

**❌ AUCUN schéma Zod pour ICP**. Chaque module pioche en mode `(icp as Record<string, unknown>).champ` avec garde optionnelle.

**Conséquence critique** :
- Un agent Onboarder qui doit générer un ICP V1 pour un client #2 doit avoir cette structure en tête → impossible sans doc
- Mutations ICP côté API non validées (risque de pousser un champ mal formé)
- Pas d'autocomplete IDE, donc errors silencieuses

**À faire** : créer `lib/icp-schema.ts` avec `ClientIcpSchema` Zod complet — c'est une brique de fondation que tout agent client devra utiliser.

### 5.6. Pattern EnrichmentProvider implicite (à formaliser)

Tous les `enrich-via-*` (Kaspr, FullEnrich, Rodz, LinkedIn finder) suivent le MÊME squelette :

```
1. Query eligible leads (filter + cooldowns + score gate + sort NULLS FIRST)
2. For each lead (throttle external API rate-limit):
   a. Validate input (URL/email/SIRET selon source)
   b. Skip si déjà enrichi (cache TTL)
   c. Call external API
   d. Pose attemptedAt (cooldown long, 30j typique)
   e. Check coherence (persona match + domain match)
   f. Update lead fields + propagate to primary (email/phone)
   g. Track credits used
   h. Recompute confidence/data-quality si changement
```

**Abstraction implicite** :

```ts
interface EnrichmentProvider {
  name: string;
  eligibleQuery(clientId, opts): Prisma.LeadWhereInput;
  enrich(lead: Lead): Promise<EnrichmentResult>;
  validate(result, lead): { ok: boolean; reason?: string };
  applyToLead(lead, result, db): Promise<void>;
  estimatedCost: number;
  rateLimit: { perMin?, perHour? };
}

async function runEnrichmentCascade(
  providers: EnrichmentProvider[],
  clientId: string
): Promise<CascadeReport>
```

**Bénéfice** : 4 fichiers réduits de moitié, 1 orchestrateur central testable, ajouter un provider (Datagma, Lusha, Apollo, ...) sans toucher au reste. À FAIRE quand on attaquera la phase d'extraction.

---

## 5.7. Modèles à suivre (briques exemplaires déjà présentes dans le code)

Avant de tout extraire / refactorer, regardons ce qui est DÉJÀ propre dans le code.
Ces 4 modules sont les **références architecturales** que les nouvelles briques doivent imiter :

### Modèle #1 — `lead-brief-v2.ts` (106 lignes)
**Pourquoi c'est propre** :
- 100% pure, 0 dependency (juste Zod)
- 3 schemas + 1 schéma composé + 3 helpers (parse, isLeadBriefV2 typeguard, parseWithError)
- Bornes Zod précises (min/max length, ranges numériques)
- Documentation inline du POURQUOI (audit traçable, validator strict, fallback)
- Co-localisation des types TS via `z.infer<>`

**À imiter pour** : tous les nouveaux schemas JSON (ClientIcpSchema, KasprResponseSchema, etc.)

### Modèle #2 — `client-icp-matcher.ts` (106 lignes)
**Pourquoi c'est propre** :
- Interfaces TS explicites pour les paramètres (`ClientIcp`, `PappersDataLite`, `IcpMatchResult`)
- Fonction `matchesClientIcp(pappers, name, icp) → result` totalement pure
- Aucune I/O — testable trivialement
- Early-return cascade avec raison textuelle (debug facile)
- Constantes externalisées (`TRANCHE_TO_MIN_EFF`)
- Comment-doc qui explique la séquence des règles

**À imiter pour** : tous les futurs matchers / scorers / classifiers

### Modèle #3 — `lead-dossier.ts` (437 lignes — extrait lu)
**Pourquoi c'est propre** :
- Builder pattern (`buildLeadDossierForJudge` + `formatDossierForOpus`)
- Interfaces composées (`LeadDossier`, `LeadDossierClient`, `LeadDossierTrigger`, `LeadDossierLead`, `LeadDossierBlocks`)
- Sépare clairement "collecte des données" du "formatting pour LLM"
- Réutilise les helpers exportés depuis qualify-trigger.ts (DRY)
- Documentation inline qui explique le pourquoi du refactor (Sprint C.5 — centraliser le contexte judge)

**À imiter pour** : tout ce qui construit du contexte pour un LLM (Auditor, Lead Hunter, ...)

### Modèle #4 — `agents/lib/mcp-tools.mjs` (123 lignes) — Doctor MCP server
**Pourquoi c'est propre** :
- 3 outils bien isolés avec missions claires (query_postgres, send_telegram_alert, get_system_snapshot)
- Validation Zod sur les paramètres
- Guards stricts (READ_ONLY_REGEX, FORBIDDEN_REGEX, timeout 15s, max 50 rows)
- Messages d'erreur structurés (content + isError flag)
- `createSdkMcpServer({ name, version, tools })` propre

**À imiter pour** : tous les MCP tools des futurs agents (Auditor / Lead Hunter / Watchdog)

### Modèle #5 — `company-variants.ts` (70 lignes, nouveau 11/05)
**Pourquoi c'est propre** :
- Extrait d'un gros fichier (harvestapi-decision-makers.ts) pour passer testable Vitest
- Pas de `server-only` → utilisable depuis n'importe où (futur agent inclus)
- Re-exporté depuis le fichier d'origine (rétro-compat)
- 12 tests Vitest dédiés couvrant cas nominaux + edge cases

**À imiter pour** : pour CHAQUE brique pure qu'on va extraire des gros fichiers.

---

## 6. Pattern Doctor — Template officiel pour futurs agents

**Brief en 6 étapes pour créer un nouvel agent** (Auditor, Lead Hunter, Watchdog, etc.) :

1. Écrire `agents/prompts/<agent>-system.md` (mission, ton, contraintes)
2. Définir les MCP tools dans `agents/lib/<agent>-tools.mjs` ou enrichir `mcp-tools.mjs`
3. Définir la whitelist `ALLOWED_TOOLS` (Bash/Read/Grep/Glob + MCP tools)
4. Copier `doctor/doctor.mjs` → `<agent>/<agent>.mjs` avec adaptation :
   - userPrompt (mission spécifique)
   - ALLOWED_TOOLS (whitelist)
   - model (Sonnet 4.5 par défaut, Opus si raisonnement complexe)
   - maxTurns (25 par défaut)
5. Créer `agents/systemd/ifind-<agent>.{service,timer}`
6. Tester en dry-run avant activation : `DRY_RUN=1 node agents/<agent>/<agent>.mjs`

**Briques partagées disponibles** : query_postgres (read-only), send_telegram_alert, get_system_snapshot, canUseTool whitelist, buildHooks audit, pool PG read-only.

---

## 7. Briques candidates pour extraction prioritaire

**Pour préparer les agents Auditor / Lead Hunter / Watchdog, voici les 30 briques atomiques que je propose d'extraire en priorité** (ordonnées par valeur / facilité) :

### Briques pures (extraction facile, gros gain)

1. ✅ `generateCompanyVariants` — déjà extrait 11/05
2. ✅ `isTechHiringTrigger` — déjà extrait 11/05
3. ✅ `isTechPersonaTitle` — déjà extrait 11/05
4. 🟡 `bucketByEffectif` (small/mid/large depuis tranche Pappers)
5. 🟡 `isPersonneMorale` (détection raison sociale)
6. 🟡 `isWrongPersona` (commissaire, expert-comptable, etc.)
7. 🟡 `mapVerdictToScore` (V2 verdict → score 0-10)
8. 🟡 `isOversized` (Fix M : revenue/etabs → boolean)
9. 🟡 `looksAdministrativeFirstName` (déjà extrait dans verify-persona-coherence ?)
10. 🟡 `extractPosterFromPayload` (multi-format Apify/TheirStack/Rodz)
11. 🟡 `extractFullDescription` (déjà dans qualify-trigger, à réexposer)
12. 🟡 `preOpusRejectScan` (5 patterns rédhibitoires)
13. 🟡 `inferSignalType` (déjà exporté harvestapi-decision-makers)

### Briques avec DB read (facile à extraire)

14. 🟡 `getPriorSignalsForCompany` (déjà exporté)
15. 🟡 `getCrossTenantSignal` (déjà exporté)
16. 🟡 `getNegativeSignalsForCompany` (déjà exporté, pure)
17. 🟡 `findExistingLeadBySiret` (logique inline ensure-lead-for-trigger)
18. 🟡 `getHealStats` (extraire de audit-heal)

### Briques d'orchestration (à splitter d'orchestrateurs gros)

19. 🟡 `healLinkedInUrls` (HEAL 1 de audit-heal)
20. 🟡 `healSiretSync` (HEAL 2)
21. 🟡 `healContactBackfill(format: 'rodz'|'apify'|'theirstack'|'generic')` (HEAL 3a-d factorisé)
22. 🟡 `healTrimCompanyName` (HEAL 4)
23. 🟡 `healExEmployerEmails` (HEAL 5)
24. 🟡 `healReclearEmails` (HEAL 5b)
25. 🟡 `healOrphanLeads` (HEAL 6)
26. 🟡 `healSmtpVerify` (HEAL 7)

### Briques d'appel externe (cascade)

27. 🟡 `findDecisionMakerByCompany` (déjà exposé, à wrapper en MCP tool)
28. 🟡 `findTechLeaderByCompany` (déjà exposé, à wrapper en MCP tool quand CSE débloqué)
29. ⚪ `enrichLeadFromPappers(siret)` (extraire de enrich-lead-dirigeants)
30. ⚪ `verifyEmailSMTP` (déjà existant dans email-smtp-verifier)

**Une fois ces 30 briques extraites**, les agents IA pourront les composer librement. C'est la base.

---

## 8. Ce qui reste à cartographier ensemble (Cartes 1, 2, 4)

### Carte 1 — Voyage d'un lead

Pour 3 leads concrets (DiXiO, une levée Rodz récente, un BODACC), tracer :
- Comment le signal est entré (sourceCode, payload reçu)
- Quelle attribution SIRENE a été tentée
- Quel poller a créé le Trigger
- Quel score initial a été posé
- Comment la qualification Opus V2 a tranché
- Quel Lead a été créé (ou pas)
- Quels enrichissements ont tourné (Pappers → Kaspr → FullEnrich → HarvestAPI → cascade)
- Si le Lead est arrivé au dashboard Fred (et dans quel état)

**Besoin** : Alexis disponible pour valider/compléter chaque étape.

### Carte 2 — Tes journées

Pour 2-3 journées concrètes ces 2 dernières semaines :
- Heure par heure : qu'est-ce qu'Alexis a fait ?
- Combien de temps par tâche ?
- Pour chaque action : peut-elle être déléguée à un agent ?

**Besoin** : Alexis disponible pour raconter en détail (1-2h de session).

### Carte 4 — Les problématiques atomiques (le vrai trésor)

Liste des 30-50 questions/problèmes que le système doit résoudre.
Format : { question, brique existante, brique manquante, criticité }

**Besoin** : Cartes 1+2 d'abord, puis 1h de consolidation.

---

## 9. Verdict global sur l'état du code

**Le code est mature, traçable, et bien commenté.** Les commits récents (Saint Graal, Refactor V2-only, audit DiXiO) montrent une discipline d'évolution incrémentale avec tags rollback.

**Les choses qui marchent bien** ✅
- Multi-tenant rigoureux (clientId partout)
- Soft-delete cohérent (deletedAt)
- Validation Zod sur la plupart des JSON typés (brief V2, delivery, quota)
- Tests Vitest sur les briques pures critiques (priority, fitscore, brief V2, credits)
- Doctor agent déjà en prod = pattern building blocks posé
- Architecture séparée `agents/` vs `dashboard-v2/` = bon découplage

**Les choses à attaquer** 🔴
- 113 fichiers, 25k lignes — pas tout est utile pour les agents
- Lead = God Object (à splitter plus tard, pas critique pour V1 agents)
- 5 duplications structurelles identifiées (genCuid, tech NAF regex×3, tier mapping, persona priority)
- 11 HEALs monolithiques dans audit-heal.ts (à éclater)
- Quelques 1000-lignes-files (qualify-trigger, theirstack-poller, apify-poller)
- ICP schema non typé en Zod
- Beaucoup de modules inexplorés (90% des libs)

**Verdict honnête sur l'effort pour passer aux agents IA** :
- Couches déjà solides : 60% du chemin
- Briques à extraire : 30 identifiées (priorité 1-15 faciles, 16-30 moyennes)
- Refactor mineur : ~1-2 semaines de boulot focus
- Refactor majeur (Lead split) : pas nécessaire pour les agents V1

**Premier agent post-Doctor envisageable** : Auditor (utilise HEAL 1-11 + briques persona/tier déjà testées + MCP tools déjà prêts). 2-3j de boulot estimé.

---

## 10. Prochaines étapes proposées

1. **Lecture binôme** des modules NON encore lus, ordonnée par criticité :
   - a) `enrich-via-kaspr-direct.ts` + `enrich-via-fullenrich.ts` (compléter la cascade enrichissement)
   - b) `lead-brief-v2.ts` + `lead-brief-v2-validator.ts` (comprendre le verdict V2)
   - c) Un poller au choix (theirstack OU apify OU rodz-provision) pour comprendre le pattern d'ingestion
   - d) `client-icp-matcher.ts` + `dynamic-few-shots.ts` (comprendre le schéma ICP non typé)

2. **Session Cartes 1+2** avec Alexis (~2-3h) :
   - Tracer 3 leads concrets end-to-end
   - Cartographier 2 journées Alexis

3. **Consolidation Carte 4** : liste des 30-50 problématiques atomiques

4. **Plan d'extraction des 30 briques prioritaires** (1-2 semaines)

5. **Construction agents prioritaires** :
   - Phase 1 ✅ Doctor (déjà en prod)
   - Phase 2 : Auditor (utilise briques existantes + HEALs extraits)
   - Phase 3 : Lead Hunter (utilise findDecisionMaker + findTechLeader + Pappers)
   - Phase 4+ : Watchdog, Onboarder, Refiner, Strategist (cf doctrine 10/05)

---

**Document v1.0 — 11/05/2026 ~16h CET**
Prochaine version après Carte 1 + Carte 2.
