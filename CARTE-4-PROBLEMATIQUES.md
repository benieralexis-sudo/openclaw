# Carte 4 — Problématiques atomiques du système iFIND

**Date** : 11/05/2026
**Auteur** : Claude (Opus 4.7) en synthèse des Cartes 1+2+3
**Objectif** : Lister les ~50 questions/problèmes que le système doit pouvoir résoudre en autonomie. Chaque problématique = candidate à devenir un outil (brique) qu'un agent IA invoquera.

**Lien avec Carte 2** : ces problématiques se déclinent en 2 axes correspondant aux 2 invariants d'Alexis :
- **Axe R — RELIABILITY** : Le système opérationnel tourne sans bug silencieux
- **Axe Q — QUALITY** : Les leads, contacts, briefs, code sont qualitativement bons

---

## TL;DR

**56 problématiques atomiques identifiées** :
- 28 sur axe R (Reliability)
- 24 sur axe Q (Quality)
- 4 sur axe Cohérence (transverse)

**Mapping vers MCP tools de l'Auditor** :
- 3 MCP tools existants (Doctor) réutilisables : `query_postgres`, `get_system_snapshot`, `send_telegram_alert`
- 5 nouveaux MCP tools à créer pour l'Auditor
- 30 briques métier (dans dashboard-v2/src/lib) à exposer comme MCP tools

**Verdict** : avec 3 MCP tools existants + 5 nouveaux + 30 briques métier exposées, l'Auditor peut couvrir 90% des problématiques. Reste 10% qui nécessiteront du jugement IA (cas tordus, patterns nouveaux).

---

## Axe R — RELIABILITY (28 problématiques)

### R1. Cron + Services (5 problématiques)

| # | Question | Brique | Criticité | Existe ? |
|---|---|---|---|---|
| R1.1 | Le cron run-pollers a-t-il tourné dans la dernière heure ? | `query_postgres` sur AuditLog OR `Bash systemctl status` | 🔴 HIGH | OUI (snapshot Doctor) |
| R1.2 | Les services systemd sont-ils up (dashboard-v2, ifind-doctor) ? | `get_system_snapshot` | 🔴 HIGH | OUI (Doctor) |
| R1.3 | Postgres répond ? (pg_isready) | `get_system_snapshot` | 🔴 HIGH | OUI |
| R1.4 | Les container Docker sont-ils tous healthy ? | `get_system_snapshot` | 🔴 HIGH | OUI |
| R1.5 | Backups récents OK ? (last successful <24h) | NEW `get_backup_status` | 🟡 MED | ❌ À créer |

### R2. Pollers / Ingestion (8 problématiques)

| # | Question | Brique | Criticité | Existe ? |
|---|---|---|---|---|
| R2.1 | Combien de Triggers ont été capturés dans les 24 dernières heures, par sourceCode ? | `query_postgres` | 🔴 HIGH | OUI |
| R2.2 | Quels sourceCode ont remonté 0 trigger sur 24h alors qu'ils devraient (Apify/TheirStack actifs) ? | `query_postgres` + heuristique | 🔴 HIGH | OUI |
| R2.3 | RSS feeds (Maddyness, Frenchweb) répondent-ils ? (HTTP 200) | NEW `check_external_endpoint` | 🟡 MED | ❌ À créer |
| R2.4 | Webhook Rodz a-t-il reçu un payload dans les 24h ? | `query_postgres` sur AuditLog | 🟡 MED | OUI |
| R2.5 | France Travail poller a-t-il tourné aujourd'hui ? | `query_postgres` Trigger count francetravail.* | 🟡 MED | OUI |
| R2.6 | BODACC poller tourne mais 0 capital_increase capturé : normal ou bug ? | `query_postgres` + analyse | 🟡 MED | OUI |
| R2.7 | INPI poller : credentials valides ? Dernière session OK ? | NEW `check_inpi_auth` ou logs | 🟢 LOW | ❌ À créer |
| R2.8 | Apify : 0 erreur HTTP 504 (incident 03/05 pattern) ? | `query_postgres` sur Trigger.rawPayload + monitor-quotas.sh | 🟡 MED | OUI partiel |

### R3. Enrichissement / Waterfall (5 problématiques)

| # | Question | Brique | Criticité | Existe ? |
|---|---|---|---|---|
| R3.1 | Combien de leads enrichis Kaspr/FullEnrich/HarvestAPI aujourd'hui ? | `query_postgres` Lead.*AttemptedAt | 🟡 MED | OUI |
| R3.2 | Quel % des leads NEW ont email + phone + linkedinUrl ? | `query_postgres` aggrégat | 🟡 MED | OUI |
| R3.3 | Quel % des leads HIRING_KEY tech ont un contact tier 1-2 (pas CEO Tier 3) ? | `query_postgres` + analyse | 🔴 HIGH | OUI |
| R3.4 | Pappers récursion holdings tourne-t-elle ? (% leads pappers-holding-fallback) | `query_postgres` Lead.personaSource | 🟢 LOW | OUI |
| R3.5 | Combien de leads "flag manuel" (Salvia, Groupe Yoni type) — sans contact tech après tous étages | `query_postgres` + critères | 🟡 MED | OUI |

### R4. Qualification V2 (5 problématiques)

| # | Question | Brique | Criticité | Existe ? |
|---|---|---|---|---|
| R4.1 | qualifyPendingTriggers a-t-il tourné dans la dernière heure ? Combien qualifiés ? | `query_postgres` Trigger.scoreReason | 🔴 HIGH | OUI |
| R4.2 | Combien de briefV2Json NULL malgré status NEW (RSS-levées fresh + scoreReason existant) ? | `query_postgres` | 🟡 MED | OUI |
| R4.3 | RE-JUDGED sweep a-t-il tourné aujourd'hui ? Combien RECOVERED vs still-IGNORED ? | `query_postgres` scoreReason LIKE '[RE-JUDGED%' | 🟡 MED | OUI |
| R4.4 | Combien de triggers en limbo (NEW + scoreReason null + créés >2h) ? | `query_postgres` | 🟡 MED | OUI |
| R4.5 | Validator strict V2 — quel taux de fail (briefs non-shippable) ? | `query_postgres` scoreReason LIKE '%non-shippable%' | 🟢 LOW | OUI |

### R5. Quotas / Coûts (5 problématiques)

| # | Question | Brique | Criticité | Existe ? |
|---|---|---|---|---|
| R5.1 | Burn Anthropic 24h en $ (cost-report) | `query_postgres` + route `/api/internal/cost-report` | 🔴 HIGH | OUI |
| R5.2 | Apify usage : à quel % du plafond on est ? | NEW `get_apify_quota` OR scrape console | 🔴 HIGH | ❌ À créer (monitor-quotas.sh partiel) |
| R5.3 | Kaspr crédits restants (workEmail/directEmail/phone/export) | Réponse Kaspr API last enrichResult | 🟡 MED | OUI partiel |
| R5.4 | FullEnrich crédits restants | NEW `get_fullenrich_credits` | 🟡 MED | ❌ À créer |
| R5.5 | TheirStack quota (% utilisé sur reset mensuel) | NEW `get_theirstack_quota` | 🟡 MED | ❌ À créer |

---

## Axe Q — QUALITY (24 problématiques)

### Q1. Qualité contact lead (8 problématiques) — Le bug DiXiO du jour

| # | Question | Brique | Criticité | Existe ? |
|---|---|---|---|---|
| Q1.1 | Combien de leads NEW avec `personaSource=pappers-rcs` SUR trigger `HIRING_KEY` tech (NAF 62/58.29/63) ? | `query_postgres` | 🔴 HIGH | OUI |
| Q1.2 | Combien de leads NEW avec `personaTier=3` (CEO/Président) sur signal tech ? | `query_postgres` | 🔴 HIGH | OUI |
| Q1.3 | Combien de leads NEW sans `firstName` (= flag manuel pour Fred) ? | `query_postgres` | 🟡 MED | OUI |
| Q1.4 | Combien avec `linkedinUrl` invalide (mauvais format ou 404 récent) ? | `query_postgres` + check optional | 🟢 LOW | OUI partiel |
| Q1.5 | Combien avec email `persona mismatch` (HEAL 5 candidates) ? | `verifyPersonaCoherence` brique | 🟡 MED | OUI (audit-heal HEAL 5) |
| Q1.6 | Combien avec `domain mismatch` (email vs companyName, HEAL 5 + C1) ? | `domainMatchesCompany` brique | 🟡 MED | OUI |
| Q1.7 | Combien de leads avec `personaSource` composite weird (ex: "rodz-payload + headline-upgrade" sans cohérence) ? | `query_postgres` GROUP BY personaSource | 🟢 LOW | OUI |
| Q1.8 | Cas DiXiO type : combien de leads `tech-hire-guard` skip (pas de Lead créé Pappers car hiring tech) ? | logs grep `[enrich-dirigeants.tech-hire-guard]` | 🟡 MED | OUI (logs) |

### Q2. Qualité briefs V2 (5 problématiques)

| # | Question | Brique | Criticité | Existe ? |
|---|---|---|---|---|
| Q2.1 | Combien de briefs V2 avec opener placeholder `[Prénom]` (bug B3) ? | `query_postgres` LIKE '%[Prénom]%' | 🔴 HIGH | OUI |
| Q2.2 | Combien de briefs V2 désynchronisés du Lead actuel (persona dans brief ≠ Lead.fullName) — bug B1 | NEW `check_brief_persona_sync` | 🔴 HIGH | ❌ À créer |
| Q2.3 | Combien de briefs validator strict KO (non-shippable) ? | scoreReason LIKE '%non-shippable%' | 🟡 MED | OUI |
| Q2.4 | Distribution des verdicts OUI/NON/ENRICH sur 7j | `query_postgres` JSON briefV2Json | 🟢 LOW | OUI |
| Q2.5 | Distribution des confidence (P50, P90) sur 7j | `query_postgres` JSON briefV2Json | 🟢 LOW | OUI |

### Q3. Qualité ICP fit (4 problématiques)

| # | Question | Brique | Criticité | Existe ? |
|---|---|---|---|---|
| Q3.1 | Combien de leads NEW avec NAF hors whitelist ICP du client (B12 mal déclenché) ? | `query_postgres` + Client.icp.naf_codes | 🔴 HIGH | OUI |
| Q3.2 | Combien de leads NEW avec taille >5× max ICP (oversize mal capté) ? | `query_postgres` + ICP company_size_max | 🟡 MED | OUI |
| Q3.3 | Combien de leads NEW avec anti-persona dans companyName (Capgemini, Sopra...) ? | `query_postgres` + ICP antiPersonas | 🔴 HIGH | OUI |
| Q3.4 | Combien d'ESN régie passés à travers preOpusRejectScan ? | log analysis + scoreReason | 🟡 MED | OUI partiel |

### Q4. Qualité enrichissement (4 problématiques)

| # | Question | Brique | Criticité | Existe ? |
|---|---|---|---|---|
| Q4.1 | Distribution `dataQuality` Lead (P50, P90) | `query_postgres` aggrégat | 🟢 LOW | OUI |
| Q4.2 | % leads `emailConfidence` >= 80 (haute confiance) | `query_postgres` aggrégat | 🟢 LOW | OUI |
| Q4.3 | % leads avec `linkedinProfileJson` rempli (post-HarvestAPI Profile Full) | `query_postgres` | 🟢 LOW | OUI |
| Q4.4 | Leads avec `doNotContact=true` sans raison documentée immédiate (bug B5) — DimoMaint type | `query_postgres` + analyse `doNotContactReason` | 🟡 MED | OUI |

### Q5. Qualité décisions historiques (3 problématiques)

| # | Question | Brique | Criticité | Existe ? |
|---|---|---|---|---|
| Q5.1 | Sweep ARCHIVED >=7 — y a-t-il des leads à recover injustement archivés ? | `query_postgres` + analyse | 🟡 MED | OUI |
| Q5.2 | Leads CONTACTED avec `bouncedAt` (Fred a envoyé sur un email cassé) | `query_postgres` | 🟡 MED | OUI |
| Q5.3 | Leads stagnants en NEW depuis 60+j (= probablement à archiver ou re-enrichir) | `query_postgres` | 🟢 LOW | OUI |

---

## Axe C — COHÉRENCE (4 problématiques transverses)

| # | Question | Brique | Criticité | Existe ? |
|---|---|---|---|---|
| C1.1 | Briefs V2 désynchronisés du Lead persona (bug B1) | NEW `check_brief_persona_sync` | 🔴 HIGH | ❌ À créer (= Q2.2) |
| C1.2 | `personaSource` valeurs composites non typées (audit nettoyage, bug B7) | `query_postgres` GROUP BY personaSource | 🟢 LOW | OUI |
| C1.3 | Leads orphelins (Trigger soft-deleted, Lead actif) — HEAL 6 le fait, mais audit fail count | `query_postgres` Lead.deletedAt NULL + Trigger.deletedAt NOT NULL | 🟢 LOW | OUI |
| C1.4 | Leads en doublon SIRET actif (dedup raté ou race condition B14) | `query_postgres` GROUP BY (clientId, companySiret) HAVING count>1 | 🟡 MED | OUI |

---

## Synthèse — MCP tools pour l'Auditor

### Outils existants Doctor (3) — réutilisables directement

| MCP tool | Usage Auditor |
|---|---|
| `mcp__ifind__query_postgres` | 80% des problématiques (toutes les R*.* / Q*.* / C* basées sur DB) |
| `mcp__ifind__get_system_snapshot` | R1.* (services, disk, memory, postgres health) |
| `mcp__ifind__send_telegram_alert` | Reporting final à Alexis (1 message Markdown structuré par run) |

### Nouveaux MCP tools à créer (5)

| MCP tool | Usage | Problématiques résolues |
|---|---|---|
| `mcp__ifind__get_api_quotas` | Récupère quotas Apify/Anthropic/Kaspr/FullEnrich/TheirStack en 1 call | R5.2, R5.3, R5.4, R5.5 |
| `mcp__ifind__check_external_endpoint` | HTTP health check (RSS feeds, INPI, Pappers, Apify console) | R2.3, R2.7 |
| `mcp__ifind__run_dashboard_health_check` | Call `/api/internal/health` route + parse 11 composants | R1.* synthèse |
| `mcp__ifind__check_brief_persona_sync` | Pour chaque Trigger récent, compare briefV2Json.persona ↔ Lead.fullName | Q2.2 (= C1.1) — bug B1 |
| `mcp__ifind__get_cost_report` | Call `/api/internal/cost-report` + parse + format | R5.1 |

### Briques métier à exposer (via `query_postgres` SQL parameter OR via HTTP `/api/internal/*`)

Il y a plus de 30 briques dans `dashboard-v2/src/lib/` que l'Auditor peut invoquer. La plupart par SQL directe (l'Auditor lit les flags Lead/Trigger). Quelques-unes par HTTP si la logique métier est complexe :

| Brique métier | Accès Auditor |
|---|---|
| `isTechHiringTrigger` (ensure-lead-for-trigger.ts) | Inline SQL (NAF + type + title match) |
| `verifyPersonaCoherence` (verify-persona-coherence.ts) | HTTP `/api/internal/check-persona` (à créer) |
| `domainMatchesCompany` | idem |
| `getNegativeSignalsForCompany` (qualify-trigger.ts) | SQL sur companyRecentDepots |
| `isOversized` (enrich-lead-dirigeants.ts) | SQL sur companyRevenue / companyEtabsCount |
| `parseLeadBriefV2WithError` (lead-brief-v2.ts) | HTTP `/api/internal/validate-brief` |
| `recoverIgnoredTriggersForClient` (requalify-engine.ts) | HTTP `/api/internal/requalify-recover` |
| `auditAndHeal` (audit-heal.ts) | HTTP `/api/internal/audit-heal` (déjà existe) |
| `scanQaStuckForClient` (qa-stuck-scanner.ts) | HTTP à créer |
| ... (30+ autres) | mix SQL + HTTP |

---

## Cahier des charges Auditor — version courte

**Mission** : à chaque run (cron 4h ou 6h proposé), l'Auditor :
1. Snapshot Reliability (R1-R5, ~10 vérifs structurelles)
2. Analyse Quality (Q1-Q5, sample de 20-50 leads récents)
3. Cohérence transverse (C1, audit synchro brief↔Lead, dedup)
4. Rapport Telegram structuré avec :
   - ✅ "Tout va bien" OR ⚠️ "X anomalies détectées" OR 🔴 "Y critiques"
   - Détail par axe (R / Q / C)
   - Top 3 anomalies prioritaires avec lead IDs concrets
   - Recommendation 1-clic ("Fred doit voir ces 5 leads", "À investiguer", etc.)

**Modèle** : Sonnet 4.6 (raisonnement Quality nécessite du jugement nuancé)
**maxTurns** : 30-40 (vs 25 pour Doctor)
**Fréquence** : 1× toutes les 4h en cron, OR on-demand via Telegram "@ifindbot audit"
**Coût estimé** : ~$0.05-0.15 par run → ~$1-3/mo en cron 4h

**Garde-fous (canUseTool whitelist)** :
```
Tool whitelist = Bash + Read + Grep + Glob + les 8 MCP tools (3 Doctor + 5 nouveaux)
```

Comme Doctor : pas de mutation DB, pas d'écriture fichiers, read-only par défaut.

---

## Conclusion

Avec ces 56 problématiques :
- 51 résolubles par 3 MCP tools existants + 5 nouveaux à créer + 30 briques métier
- 5 nécessitent du jugement IA (cas tordus, patterns nouveaux que seul Sonnet 4.6 captera)

L'Auditor est **clairement faisable** en 2-3j de dev (5 MCP tools à coder + le orchestrateur + le prompt système + tests).

Première version probablement minimale (juste R1+R5+Q1+Q2 = ~15 problématiques) en 1j, puis enrichissement progressif.

---

**Document v1.0 — 11/05/2026**
Prochaine étape : décision de l'agent à construire en premier + plan d'extraction des briques.
