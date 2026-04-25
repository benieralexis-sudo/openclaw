# iFIND — Trigger Engine FR (v2.0)

## Identité produit

**iFIND = Trigger Engine FR** : moteur propriétaire de détection de signaux d'achat B2B en temps réel sur les PME françaises. Universel, multi-vertical.

**Différence clé** : pas d'intent data probabiliste (Bombora-like), mais **TRIGGERS = événements publics durs** (levées, hiring ICP, dépôts INPI, changements C-level, ads actives) agrégés via 14+ sources FR-natives, attribués SIRENE, qualifiés par Claude Opus 4.7.

**Moat** : attribution SIRENE (Pappers) + pattern matching combinatoire 13 patterns + Claude Opus 4.7 (cerveau propriétaire) + boosters v1.1 (combo ×2.5, hot <48h, declarative pain).

## 2 offres commerciales (uniquement)

| Offre | Prix/mois | Périmètre |
|---|---|---|
| **Leads Data** | 299€ | Client reçoit leads + 3 canaux Opus pré-rédigés (email + LinkedIn DM + call brief) + briefs RDV. Client envoie/appelle/book/close TOUT SEUL via mailto. Volume 50-120/mois. |
| **Full Service** | 1 490€ | Bot envoie séquence depuis domaines DÉDIÉS CLIENT (Primeforge + Warmforge 2-3 sem warmup). Commercial ami fait LinkedIn DM + cold call + book RDV dans cal client. Client close ses RDV. Setup one-time 1 500-3 000€. |

**Règles non négociables** :
1. LinkedIn actions = **manuel humain** uniquement (Trigify pour détection safe, jamais auto-engage)
2. Volume plafonné : 500 leads/mois/client Founding, max 1 000 Scale
3. Seuil score min : ≥7 MVP, ≥5 Scale jamais en dessous
4. Attribution SIRENE = cœur du moat (Pappers critique)
5. Commission commerciaux : 15% du CA iFIND sur 12 premiers mois (PAS le CA client final)

## Infrastructure

- **VPS** : srv1319748.hstgr.cloud (76.13.137.130)
- **Repo** : /opt/moltbot/ — GitHub: benieralexis-sudo/openclaw
- **Domaines** : ifind.fr (Resend verified), getifind.fr
- **Containers Docker** :
  - `telegram-router` : bot Telegram + Trigger Engine + Inbox + Meeting + webhooks
  - `mission-control` : dashboard HTTPS (port 3000, nginx reverse proxy)
  - `landing-page` : pages rapports prospects
- **Mode** : STANDBY par défaut (bot legacy iFIND v9.5 ne fait plus d'envois auto), Trigger Engine tourne indépendamment

## Architecture v2.0

### Composant principal : Trigger Engine (`skills/trigger-engine/`)

```
skills/trigger-engine/
├── index.js              — Handler principal (TriggerEngineHandler)
├── cron.js               — Schedule des ingestions + processing
├── processor.js          — Pattern matching SIRENE-based
├── router.js             — ClientRouter (multi-tenant ICP filtering)
├── storage.js            — SQLite via node:sqlite (DatabaseSync)
├── schema.sql            — Schema v1 + migrations 002→015
├── contact-enricher.js   — Enrich dirigeants + emails
├── pitch-generator.js    — Génération pitch (legacy v1.0, remplacé par claude-brain)
├── clients-seed.json     — Clients initiaux (ifind, digitestlab, fimmop)
├── sources/              — 9 sources d'ingestion FR
│   ├── bodacc.js         — Annonces légales (3h cron)
│   ├── inpi.js           — Marques déposées (24h cron)
│   ├── joafe.js          — Associations + nominations C-level (6h cron)
│   ├── francetravail.js  — Hiring ICP (2h cron, OAuth)
│   ├── rss-levees.js     — Maddyness/Frenchweb levées (1h cron)
│   ├── news-buzz.js      — Google News RSS (12h cron)
│   ├── google-trends.js  — Tendances mots-clés (24h cron)
│   ├── meta-ad-library.js — Ads Meta concurrents (24h cron)
│   ├── sirene.js         — Attribution gouv gratuite + lookupDirigeants
│   ├── pappers.js        — Enrichissement premium FR (token .env)
│   └── dropcontact.js    — Email finder GDPR-by-design
├── patterns/
│   ├── matcher.js        — Évaluation pattern × events
│   └── definitions/      — 13 patterns JSON (signaux + bonuses + exclusions)
├── lib/
│   ├── telegram-alert.js
│   ├── mx-verify.js      — Vérification DNS MX pre-envoi
│   └── source-health.js  — Monitoring santé sources
└── claude-brain/         — Cerveau IA (Opus 4.7)
    ├── index.js          — ClaudeBrain orchestrator
    ├── pipelines.js      — 7 pipelines (qualify, pitch, linkedin-dm, call-brief, brief, discover, detect-pain)
    ├── anthropic-client.js — SDK wrapper avec prompt caching + retry
    ├── context-builder.js — Construction contexte par lead/pipeline
    ├── budget.js         — Tracker coût Opus par tenant
    ├── circuit-breaker.js
    ├── cache.js          — Prompt caching Anthropic (TTL 5min)
    ├── queue.js + worker.js — Queue async des jobs Opus
    ├── auto-send-gate.js — 8 règles avant envoi auto (Full Service)
    ├── digest-email.js   — Email hebdomadaire opt-in (lundi 8h Paris)
    ├── realtime-alert.js — Alerte temps réel pépites ≥9 (dédup 24h)
    ├── email-sender.js   — Wrapper Resend
    ├── smartlead-client.js — Cold email Full Service (opt-in via SMARTLEAD_API_KEY)
    ├── combo-booster.js   — v1.1: ×2.5 si 3 signaux durs <90j (JACKPOT)
    ├── hot-signal-detector.js — v1.1: +0.5/+1.0 si signal <48h/<24h
    ├── declarative-pain.js — v1.1: détection douleur exprimée (opt-in via flag)
    └── prompts/          — System prompts MD par pipeline
```

### Modèles IA

- **Claude Opus 4.7** (`claude-opus-4-7`) — Trigger Engine pipelines (qualify, pitch, linkedin-dm, call-brief, brief, discover, detect-pain) + Rapports stratégiques. 1M context. Pricing : $15/M input, $75/M output.
- **Claude Sonnet 4.6** (`claude-sonnet-4-6`) — Réponses inbox auto-classifiées. Pricing : $3/M input, $15/M output.
- **GPT-4o-mini** — NLP routeur Telegram (classification rapide). Pricing : $0.15/M input.
- **Coût observé** : ~3.77€ Opus pour 65 actions (qualifications + pitchs + briefs).

### Boosters de scoring v1.1 (actifs en prod)

1. **Combo Booster** (`COMBO_BOOSTER_ENABLED=true` par défaut)
   - 3+ catégories distinctes de signaux durs <90j → multiplier ×2.5 (JACKPOT)
   - 2 catégories → ×1.7 (COMBO)
   - Catégories: funding / exec_hire / hiring_typed / brand_launch / media_buzz / ma_activity / structural / ad_spend
   - Exclusions: procedure_collective, company_cessation
   - Score capé à 10.0

2. **Hot Signal Detector** (`HOT_TRIGGERS_ENABLED=true` par défaut)
   - Signal <24h (FRESH) → boost +1.0
   - Signal <48h (HOT) → boost +0.5
   - Combiné: `final = (raw + freshness) × combo_multiplier`
   - Crons accélérés: RSS levées 1h, BODACC 3h, JOAFE 6h
   - Alerte temps réel HOT seuil ≥7.5 (vs 9.0 standard)

3. **Declarative Pain Detection** (`DECLARATIVE_PAIN_ENABLED=false` par défaut, opt-in)
   - Analyse texte arbitraire (LinkedIn post, Glassdoor, Reddit, HN) via Opus
   - Si match + nom entreprise + intent ≥5 → SIRENE attribution → event `declarative_pain` → boost score à 9.0
   - Pattern dédié `declarative-pain` (min_score 9.0)

### Patterns (13)

| ID | Window | Signal principal |
|---|---|---|
| funding-recent | 90j | Levée Seed/Série A/B/C |
| tech-hiring | 30j | hiring_tech |
| hiring-surge | 30j | 3+ offres typées (hiring_tech/sales/marketing/finance/hr/executive) |
| sales-team-scaling | 60j | hiring_sales/marketing |
| multi-role-scaling | 60j | hiring_executive + hiring_typed |
| new-exec-hire | 30j | hiring_executive (C-level) |
| scale-up-tech | 90j | funding + hiring_tech + media_buzz |
| new-company-hiring | 60j | company_creation + hiring |
| new-brand-launch | 60j | marque_deposee INPI |
| media-buzz | 7j | 3+ articles presse |
| ad-spend-active | 30j | ad_spend_detected (Meta) |
| restructuring-opportunity | 60j | modification_statuts + hiring |
| **declarative-pain** | 30j | declarative_pain (Opus) |

### Multi-tenant

- Table `clients` avec `claude_brain_config` JSON par tenant
- Isolation par `tenant_id` partout (queue, results, usage, leads, alerts)
- Config par tenant : ICP (NAF allow/block, dept, effectif), patterns activés, min_score, monthly_lead_cap, voice_template, pitch_language (tu/vous), seuils alertes, opt-in digest hebdo
- 3 clients seedés : `ifind` (interne), `digitestlab` (Frédéric Flandrin / QA), `fimmop` (Clément / BTP)

## Crons actifs (Trigger Engine)

| Fréquence | Action |
|---|---|
| 1h | RSS Levées Maddyness/Frenchweb (HOT optimisé) |
| 2h | France Travail API (hiring) |
| 3h | BODACC (HOT optimisé) |
| 6h | JOAFE (nominations C-level) |
| 12h | News Buzz Google News |
| 24h | INPI / Google Trends / Meta Ad Library |
| 15min | Pattern processing + alerts pépites + auto-pitch leads ≥8 |
| 2h | Contact enricher (dirigeants + emails) |
| 4h | Stale re-qualify (leads >14j) |
| 1h | Source health monitoring |
| Dim 23h | Claude Brain Discover (proposition nouveaux patterns) |
| Lun 8h Paris | Digest hebdo opt-in |
| 24h (3h00) | Cleanup expired matches |

## API Keys (.env)

### ✅ Branchées et opérationnelles
- `CLAUDE_API_KEY` (Opus 4.7 + Sonnet 4.6)
- `OPENAI_API_KEY` (GPT-4o-mini routing)
- `PAPPERS_API_TOKEN` (enrichissement premium FR)
- `DROPCONTACT_API_KEY` (email finder GDPR)
- `FRANCETRAVAIL_CLIENT_ID/SECRET` (OAuth hiring)
- `INPI_USERNAME/PASSWORD` (marques)
- `META_AD_LIBRARY_TOKEN`
- `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET`
- `HUBSPOT_API_KEY` (CRM read)
- `TELEGRAM_BOT_TOKEN` (admin notif)
- `IMAP_HOST/USER/PASS` (inbox polling)
- `GOOGLE_*` (calendar booking)

### 🟠 À brancher (achats stack lundi 28 avril)
- `SMARTLEAD_API_KEY` — séquenceur cold email Full Service (code prêt dans `claude-brain/smartlead-client.js`)
- `RODZ_API_KEY` — 14 signaux temps réel FR
- `THEIRSTACK_API_KEY` — jobs API global dedup
- `TRIGIFY_API_KEY` — LinkedIn engagement signals
- `DATAGMA_API_KEY` — mobiles décideurs (waterfall avec Dropcontact)
- `MILLIONVERIFIER_API_KEY` — anti-bounce pre-send
- `APIFY_API_TOKEN` — scrapers (Glassdoor/Reddit/HN pour declarative pain)
- `FOLK_API_KEY` — CRM pipeline multi-tenant
- `AIRCALL_API_KEY` — VoIP cold call

## Commandes utiles

```bash
# Restart bot complet
cd /opt/moltbot && docker compose down && docker compose up -d

# Logs router temps réel
docker compose logs -f --tail 50 telegram-router

# Tests Trigger Engine (Node 22 dans container)
docker compose exec telegram-router sh -c "cd /app/skills/trigger-engine && node --test claude-brain/tests/*.test.js tests/*.test.js"

# Health
curl -sf http://localhost:9090/health

# Status containers
docker compose ps

# Backfill re-qualify forcé (active boosters v1.1 sur leads existants)
docker compose exec telegram-router node /app/skills/trigger-engine/scripts/qualify-backfill.js
```

## Règles projet (mémoire utilisateur)

- Toujours répondre en français (Jojo / Alexis Bénier)
- Auto commit + push après modifications (préférence)
- Multi-VPS : toujours demander quel VPS avant intervention SSH
- Les commerciaux amis bookent des RDV, ne closent PAS pour le client
- Volume plafonné, jamais auto-engage LinkedIn, attribution SIRENE jamais skippée

## Versions et tags

- `v1.0-claude-brain` — Phase 1+2 Tier 1 (3 canaux Opus + digest matin + alertes pépites)
- `v1.1-claude-brain-trigger-velocity` — Combo booster + Hot triggers + Declarative pain
- `v2.0-trigger-engine-clean` (en cours) — Drop legacy iFIND v9.5 (-30k lignes), Pappers branché, Opus 4.7 partout
- `pre-v2-cleanup` — Snapshot avant grand nettoyage v2.0 (rollback safety)

## Stack outils prévue (achats lundi 28 avril)

### Socle mutualisé (~722€/mois MVP)
Pappers 75€ · Rodz 50€ · Apify 27€ · Dropcontact 79€ · Datagma 35€ · MillionVerifier 20€ · TheirStack 89€ · Trigify PAYG ~80€ · Smartlead 72€ · Primeforge 46€ · Warmforge 27€ · Folk 22€ · Claude API 80€ · Cal.com 0€ · VPS 20€

### Per-client (168€/mois activé à la signature)
Sales Nav Advanced 138€ · Aircall 30€ partagé

### Sources gratuites FR (toujours actives)
BODACC · INPI Open Data · JOAFE · France Travail API · SIRENE · Maddyness/Sifted/Frenchweb RSS · Meta Ad Library · Google Trends
