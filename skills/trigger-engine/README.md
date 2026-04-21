# Trigger Engine FR

Moteur propriétaire de détection de signaux d'achat en temps réel sur PME françaises.

## Vue d'ensemble

Le Trigger Engine surveille 8+ sources publiques FR (BODACC, INPI, JOAFE, France Travail, Rodz, Apify, TheirStack, Trigify), attribue chaque événement à un SIREN via Pappers, et applique un pattern matching combinatoire pour détecter les entreprises en moment d'achat.

```
Sources FR → Ingestion → Attribution SIRENE → Pattern Matching → Scoring → Leads livrés
```

## Architecture

```
skills/trigger-engine/
├── index.js                 # Handler principal (appelé par telegram-router)
├── storage.js               # SQLite storage (events, companies, patterns, leads)
├── schema.sql               # Schema SQLite
├── migrations/              # Migrations de schéma
├── sources/                 # Ingesteurs par source
│   ├── bodacc.js            # BODACC RSS + API
│   ├── inpi.js              # INPI Open Data
│   ├── joafe.js             # JOAFE RSS
│   ├── francetravail.js     # France Travail API (OAuth)
│   ├── sirene.js            # Base SIRENE (téléchargement complet)
│   ├── pappers.js           # Attribution + enrichment (PAYANT)
│   ├── rodz.js              # Signals FR (webhook handler)
│   ├── theirstack.js        # Tech + intent signals (PAYANT)
│   └── trigify.js           # Social listening webhook handler
├── patterns/                # Patterns définis + moteur matching
│   ├── matcher.js           # Engine de pattern matching
│   ├── scoring.js           # Scoring combinatoire
│   └── definitions/         # Patterns catalog
│       ├── scale-up-tech.yaml
│       ├── post-levee.yaml
│       ├── nouveau-c-level.yaml
│       └── ... (12+ patterns universels)
├── tests/                   # Tests unitaires
└── data/                    # Storage runtime (.gitignored)
    └── trigger-engine.db    # SQLite database
```

## Phases de développement

**Phase 1 (en cours, gratuit)** :
- SQLite schema + storage
- Ingestion BODACC / INPI / JOAFE / France Travail (sources gratuites)
- Base SIRENE complete download
- Pattern matching core
- Dashboard basique

**Phase 2 (après souscription outils)** :
- Pappers API (attribution + enrichment, 75-240€/mois)
- Rodz webhook (signals FR, 50-500€/mois)
- TheirStack API (tech signals, 89-349€/mois)
- Trigify webhook (social, 137-504€/mois)
- Apify scrapers (WTTJ, LinkedIn)

**Phase 3 (intégration outreach)** :
- Push vers Smartlead (cold email cadence)
- Intégration Trigify → Smartlead workflow
- Folk CRM sync
- Cal.com booking

## Stack technique

- **SQLite** (better-sqlite3) : stockage events + attributions + patterns matched
- **Node.js 22** : runtime cohérent avec le reste du bot
- **YAML** : config des patterns (lisibilité, versionnable)
- **IA** : OpenAI/Anthropic API (via clés user) pour génération emails personnalisés par trigger

## Documentation complète

- `memory/trigger-engine-offre-unique.md` — offre Enterprise 3 990€/mois
- `memory/trigger-engine-stack-definitive.md` — stack complet pricing
- `memory/trigger-engine-roadmap-dev.md` — plan build 2-3 mois

## Status

🚧 **Phase 1 en construction** — avril 2026
