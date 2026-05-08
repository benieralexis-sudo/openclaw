# iFIND — Trigger Engine FR (v2.0)

> Document à jour au 08/05/2026 — post-pivot Data-only (05/05) + Sprints A-D + Vague 1 + Vague 2 perfection 100%.

## Identité produit

**iFIND = Trigger Engine FR** : moteur propriétaire de détection de signaux d'achat B2B en temps réel sur les PME françaises. Universel, multi-vertical.

**Différence clé** : pas d'intent data probabiliste (Bombora-like), mais **TRIGGERS = événements publics durs** (levées, hiring ICP, dépôts INPI, changements C-level, jobs) agrégés via 9 sources FR-natives, attribués SIRENE, qualifiés par Claude Opus 4.7.

**Moat** : attribution SIRENE (Pappers) + 13 patterns combinatoires + Claude Opus 4.7 (judge OUI/NON/ENRICH avec citations [src:#X]) + boosters v1.1 (combo ×2.5, hot <48h, declarative pain).

## Offre unique (depuis pivot 05/05/2026)

| Offre | Prix/mois | Périmètre |
|---|---|---|
| **Leads Data** | 199€ | Client reçoit dashboard avec leads qualifiés + 3 canaux Opus pré-rédigés (cold email + LinkedIn DM + call brief) + briefs raisonnés OUI/NON/ENRICH avec opener prêt-à-coller. **Le client gère 100% de l'outreach** (envoi, calls, booking, closing). |

**Full Service ABANDONNÉ 05/05** — le bot n'envoie plus d'emails, ne book plus de RDV automatiques. Implication : Cal.com webhook + IMAP reply scraping = caducs. La boucle outcomes Tier 4 est repensée sur signaux dashboard implicites uniquement.

**Règles non négociables** :
1. LinkedIn actions = **manuel humain** uniquement (Trigify pour détection safe, jamais auto-engage)
2. Volume plafonné : 500 leads/mois Founding, max 1 000 Scale
3. Seuil score min : ≥7 MVP, ≥5 Scale jamais en dessous
4. Attribution SIRENE = cœur du moat (Pappers critique)

## Infrastructure

- **VPS** : srv1319748.hstgr.cloud (76.13.137.130)
- **Repo** : /opt/moltbot/ — GitHub: benieralexis-sudo/openclaw, branche `main`
- **Domaines** : ifind.fr, getifind.fr
- **Containers Docker actifs (3)** :
  - `moltbot-telegram-router-1` : bot Telegram + skills legacy
  - `moltbot-landing-page-1` : pages rapports prospects
  - `ifind-postgres` : DB Postgres principale
- **Containers supprimés** : `moltbot-mission-control-1` (P10 du 08/05 — remplacé par dashboard-v2 sur port 3100)
- **Systemd units** :
  - `dashboard-v2` (port 3100) — Next.js 15 + Better Auth, prod actuelle
  - `digitestlab-frontend` (port 3333) — landing client DigitestLab

## Architecture

### Composant principal : dashboard-v2 (`/opt/moltbot/dashboard-v2/`)

Stack : Next.js 15 App Router + Prisma + PostgreSQL + Better Auth + Vitest + Tailwind.

```
dashboard-v2/
├── src/
│   ├── middleware.ts            — Auth redirect + rate-limit /api/triggers + /api/leads
│   ├── lib/
│   │   ├── qualify-trigger.ts   — Judge V1 (score 1-10 + reason) + shadow V2 fire-and-forget
│   │   ├── lead-brief-v2.ts     — Schéma Zod LeadBriefV2 (verdict OUI/NON/ENRICH + citations)
│   │   ├── lead-brief-v2-validator.ts — Validator strict 8 règles métier (Sprint D.3)
│   │   ├── requalify-engine.ts  — Re-qualify engine + recover IGNORED (anti-boucle)
│   │   ├── lead-enrichment-tagging.ts — Helper markLeadEnrichedFromPappers (P1 Vague 1)
│   │   ├── trigger-dedup.ts     — findOrFuseExistingTrigger cross-source (P3 Vague 1)
│   │   ├── rate-limit.ts        — Token bucket in-memory 60 req/min/IP (P12)
│   │   ├── pappers.ts           — Cache Pappers in-process 1h
│   │   ├── kaspr.ts             — Email + phone enrichment
│   │   └── ...
│   ├── app/api/
│   │   ├── triggers/[id]/qualify — Qualify Opus + parallel V2 shadow
│   │   ├── leads/[id]/{call-brief,pitch,linkedin-dm} — Génération copy 4 contextes
│   │   ├── webhooks/rodz        — Webhook Rodz (HMAC validé)
│   │   ├── replies/             — UI Unibox (lecture historique post-pivot)
│   │   └── internal/             — Cron secrets (poll-apify, poll-theirstack, run-pollers)
│   └── components/brief/        — UI brief raisonné LeadBriefV2 + TriggerBriefBoard
└── prisma/schema.prisma         — Lead + Trigger + Client + Reply + EmailEvent + ...
```

### Composant secondaire : skills/ (bot legacy)

Conservés pour compatibilité avec d'anciens flows :
- `skills/trigger-engine/` — bot legacy iFIND v9.5 (drop-in remplacé par dashboard-v2 pour qualif/brief)
- `skills/inbox-manager/`, `skills/meeting-scheduler/`, `skills/automailer/`

### Modèles IA

- **Claude Opus 4.7** (`claude-opus-4-7`) — Qualify trigger + briefs (V1 + V2 shadow). 1M context. $15/M input, $75/M output. Cache prompt activé sur qualify (Sprint B.3).
- **Claude Sonnet 4.6** (`claude-sonnet-4-6`) — Replies inbox + declarative-pain. $3/M input, $15/M output.

### Boosters de scoring v1.1 (actifs en prod)
- `COMBO_BOOSTER_ENABLED=true` — 3+ catégories signaux durs <90j → ×2.5 JACKPOT
- `HOT_TRIGGERS_ENABLED=true` — Signal <24h → +1.0, <48h → +0.5

### Patterns (13)

funding-recent · tech-hiring · hiring-surge · sales-team-scaling · multi-role-scaling · new-exec-hire · scale-up-tech · new-company-hiring · new-brand-launch · media-buzz · ad-spend-active · restructuring-opportunity · declarative-pain

## État actuel (08/05/2026)

### Sprints A-D (05-07/05) — livrés
- **Sprint A** (05/05) : 4 patches Opus qualify + parser RSS durci + fallback SIRENE contraint
- **Sprint B** (06/05) : prompt qualify v0.5 (réponses Fred) + cache Anthropic ACTIVÉ + sweep IGNORED→NEW
- **Sprint C** (06/05 soir) : homepage scrap + Google CSE news 30j + module LeadDossier
- **Sprint D** (07/05) : Schéma LeadBriefV2 + validator strict + UI brief raisonné + V2 shadow mode

### Vague 1 perfection 100% (08/05 nuit) — livrée (6 commits)
- **P1** (`c3249943a`) : Helper `markLeadEnrichedFromPappers()` central
- **P2** (`b9dde290b`) : Sweep size/industry étendu 7j + take 50
- **P3** (`7cfeb3c6c`) : Dédup intelligent cross-source + cleanup 6 doublons
- **P4** (`0b64a5340`) : TTL purge soft-deleted >90j (cron 04h00)
- **P6** (`71e18a045`) : V2 fire-and-forget après V1 (shadow parallel-write)

### Vague 2 perfection 100% (08/05) — livrée (6 commits)
- **P8** (`6e9eb83ca`) : Cleanup calcomSlug branches mortes (-29 L)
- **P9** (`3bb1a7de3`) : Cleanup IMAP/sync-inbox (write-side, -244 L)
- **P10** (`00ff2517c`) : Suppression container mission-control zombie
- **P11** (`4428845ae`) : Suppression route /api/webhooks/cal (-198 L)
- **P11bis** (`c615928e3`) : Suppression route /api/webhooks/resend (-160 L)
- **P12** (`d37de9a0e`) : Rate limiting middleware /api/triggers + /api/leads
- **P14** (`bebf67647`) : Tests Vitest brief-v2 + validator (+24 tests, 272/272 verts)

**Bilan Vague 2 : -589 lignes mortes + protection rate-limit + tests strict +24.**

## Crons actifs (post-Vague 2)

```
0 * * * * /opt/moltbot/scripts/run-pollers-cron.sh                        # ⏸️ DISABLED 07/05 (Anthropic à recharger)
0 4 * * * cd /opt/moltbot/dashboard-v2 && npx tsx scripts/purge-old-soft-deleted.ts --apply  # P4 Vague 1
0 4 * * * /opt/moltbot/scripts/healthcheck-daily.sh
*/5 * * * * /opt/moltbot/scripts/healthcheck-external.sh
*/5 * * * * /opt/moltbot/scripts/healthcheck-deep.sh
*/5 * * * * /opt/moltbot/scripts/uptimerobot-to-telegram.sh
*/30 * * * * /opt/moltbot/scripts/monitor-alerts.sh
0 7 * * * /opt/moltbot/scripts/health-digest-cron.sh
0 8 * * * /opt/moltbot/scripts/monitor-quotas.sh
5 8 * * 1 /opt/moltbot/scripts/refresh-few-shots-cron.sh
```

**Crons supprimés Vague 2** : `*/5 sync-inbox-cron.sh` (P9, IMAP write-side mort post-pivot).

## API Keys (.env dashboard-v2)

### ✅ Branchées et opérationnelles
- `ANTHROPIC_API_KEY` (Opus 4.7 + Sonnet 4.6) — **⏸️ balance à 0 le 08/05, recharger avant test live**
- `PAPPERS_API_TOKEN` (enrichissement premium FR) — cache 1h
- `KASPR_API_KEY` (email + phone) — backbone emails
- `FULLENRICH_API_KEY` (email finder)
- `RODZ_API_KEY` (4 sources actives : funding/M&A/job-changes/recruitment)
- `THEIRSTACK_API_KEY` (jobs API, gate 12h+18h UTC)
- `APIFY_API_TOKEN` (LinkedIn-jobs + WTTJ + declarative pain)
- `FRANCETRAVAIL_CLIENT_ID/SECRET` (OAuth)
- `INPI_USERNAME/PASSWORD`
- `GOOGLE_API_KEY` + `GOOGLE_CSE_ID` (Custom Search news 30j)
- `TELEGRAM_BOT_TOKEN`

### 🟠 Caducs post-pivot 05/05 (à supprimer du `.env` lors d'un cleanup futur)
- `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET` (route webhook supprimée P11bis)
- Smartlead, MillionVerifier, Primeforge, Warmforge, Folk, Aircall, Sales Nav (le bot n'envoie plus, ne book plus, le client gère)

## Tags rollback récents

- `pre-perfection-100-08mai` — avant Vague 1 (08/05)
- `pre-vague2-perfection-08mai` — avant Vague 2 (08/05)
- Commit `cdf664207` — état post-fix recover anti-boucle (07/05)

## Commandes utiles

```bash
# Service dashboard-v2 (Next.js prod)
sudo systemctl status dashboard-v2
sudo systemctl restart dashboard-v2
journalctl -u dashboard-v2 -n 50

# Build + restart workflow standard
cd /opt/moltbot/dashboard-v2 && npx tsc --noEmit && npm run build && sudo systemctl restart dashboard-v2

# Tests Vitest
cd /opt/moltbot/dashboard-v2 && npm test -- --run

# Containers Docker
docker compose -f /opt/moltbot/docker-compose.yml ps
docker compose logs -f --tail 50 telegram-router

# Crons
sudo crontab -l

# Health
curl -sf http://127.0.0.1:3100/login

# DB Prisma
cd /opt/moltbot/dashboard-v2 && npx prisma studio  # UI lecture
psql "$DATABASE_URL" -c 'SELECT COUNT(*) FROM "Trigger" WHERE "deletedAt" IS NULL'
```

## Règles projet

- Toujours répondre en français (Jojo / Alexis Bénier)
- Auto commit + push après modifications (préférence durable)
- Multi-VPS : toujours demander quel VPS avant intervention SSH
- Vérification exhaustive après chaque point (méthode validée 07/05)
- Volume plafonné, jamais auto-engage LinkedIn, attribution SIRENE jamais skippée
