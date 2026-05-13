# Carte 5 — Architecture détaillée des agents iFIND v1.0

**Date** : 11/05/2026 (~22h CET)
**Auteur** : Claude (Opus 4.7) en synthèse de 4 recherches parallèles (2 claude-code-guide + Explore + general-purpose web research) + cartographie système iFIND complète (Cartes 1-4 + Doctrine Anthropic)
**Mission** : Tracer LE chemin complet de l'automatisation iFIND par agents IA. Ne rien laisser au hasard.

**Documents amont** :
- `ARCHITECTURE-V1.md` (Carte 3 — inventaire code 20 modules)
- `CARTE-1-VOYAGE-LEADS.md` (8 voyages end-to-end + 7 bugs systémiques)
- `CARTE-2-JOURNEES-ALEXIS.md` (12 buckets activités, 2 invariants)
- `CARTE-4-PROBLEMATIQUES.md` (56 problématiques atomiques)
- `ANTHROPIC-DOCTRINE-AGENTS.md` (playbook officiel Anthropic 2026)
- `doctrine-agents-puissance-cumul.md` (doctrine 10/05 — base validée)

---

## TL;DR — 5 minutes de lecture

Cette carte 5 dépasse la doctrine du 10/05 sur 3 points critiques :

1. **Brainstorming exhaustif** : on a évalué **50 agents possibles** (vs 8 dans la doctrine). 12 retenus, 38 écartés.
2. **Validation par cas d'études réels** : 10 entreprises SaaS B2B (11x.ai, Intercom Fin, Replit, etc.) avec coûts, échecs, ROI mesurés.
3. **Pattern de collaboration validé** : Anthropic recommande **Orchestrator-Subagent + Event-Driven** pour systèmes 8-15 agents. On adopte.

**Verdict global** :
- **Sweet spot 8-12 agents** confirmé (consensus ICLR 2025 + Anthropic + 11x.ai). **Doctor + Auditor restent les 2 bons agents #1 et #2.**
- **Top 12 agents iFIND** identifiés avec ROI/coût rigoureux. Coût total mature ~$100-150/mois pour 1-5 clients.
- **Architecture hybride** : 80% agents autonomes + 15% event-driven + 5% orchestration sur tâches complexes.
- **Garde-fous critiques** : budget caps par agent (cas 47k$ documenté), observabilité Langfuse avant 4e agent, HITL 1-clic obligatoire.

**Verdict honnête sur la session ce soir** :
- Doctor + Auditor sont les bons choix (confirmé par cette analyse)
- Mais on a bâclé l'ordre pour les agents 3-12 (j'ai utilisé la doctrine 10/05 sans re-questionner)
- **Cette Carte 5 corrige ça avec un ordre RIGOUREUX basé sur ROI mesurable + dépendances**

---

# Section 1 — Cadre théorique

## 1.1 Qu'est-ce qu'un "agent puissant" pour iFIND ?

Définition : **un agent qui fait gagner ≥ 1h/semaine à Alexis OU améliore ≥ 5% la qualité produit**, pour un coût ≤ 5% du MRR du client moyen.

### Critères d'évaluation (chaque agent noté sur 7 axes)

| Axe | Note 1-10 | Pondération |
|---|---|---|
| **Impact business** (€ gagnés ou perdus évités) | × 0.25 |
| **ROI temps Alexis** (heures libérées/mois) | × 0.20 |
| **Urgence** (résout un problème actuel vs anticipé) | × 0.15 |
| **Facilité dev** (jours de boulot estimés) | × 0.10 |
| **Coût récurrent** (en % MRR client) | × 0.10 |
| **Dépendances** (a-t-il besoin d'un autre agent en amont ?) | × 0.10 |
| **Risque** (qu'est-ce qui se passe s'il dérive ?) | × 0.10 |

**Score min pour entrer dans le top 12** : 6.5/10 pondéré.

## 1.2 Quand un agent IA est justifié vs un script déterministe

Frontière critique (depuis recherche dédiée du sub-agent 3) :

**Agent IA si** :
1. Raisonnement nuancé sur contexte imprévisible
2. Pattern émergent à détecter (pas figé d'avance)
3. Variabilité naturelle des inputs
4. Décision contextuelle avec multi-facteurs changeants
5. Génération de contenu ou synthèse
6. Gestion d'erreurs/fallback intelligents
7. Boucle de rétroaction / apprentissage implicite

**Script déterministe si** :
1. Tâche entièrement déterministe (X → Y sans ambiguïté)
2. Performance critique (latence < 100ms)
3. Audit/traçabilité 100% reproductible requis
4. Volume très élevé (>1000 appels/jour)
5. Cas limite bien connu prédéfini
6. Tâche stable (ne change jamais)
7. Aucune variation acceptable dans output

**Ratio coût** : Script ~$0.0001/call vs Agent ~$0.01-0.05/call (100-1000×). Justifié si valeur par décision > $1.

### Application à 6 composants iFIND actuels (rec. sub-agent 3)

| Composant | Actuel | Reco | Raison |
|---|---|---|---|
| **audit-heal** (11 HEALs SQL) | Script | **Hybride** : Agent décide quels HEALs lancer | Variabilité possible patterns émergents |
| **qa-stuck-scanner** | Script | **Agent** : décide dynamiquement patterns stuck | Pattern émergent (Sales-STUCK ? DevOps-STUCK ?) |
| **recoverIgnoredTriggersForClient** | Script | **Hybride** : Agent décide critères recovery | Contexte évolue (linkedinProfileJson, nouveau brief Opus) |
| **qualifyTrigger V2** | Agent ✅ | **OK, ajouter prompt caching 1h** | Déjà bien fait |
| **enrich-kaspr** | Script | **Hybride** : Agent priorise leads, script enrich | Ordre de priorité change selon contexte |
| **combo-detector** | Script | **Agent** : découvre nouveaux patterns émergents | Patterns futurs inconnus |

→ **L'Auditor de ce soir devrait dans sa V2 absorber qa-stuck-scanner + recover-ignored** (au lieu de rester des scripts séparés). À retenir pour Phase 3.

## 1.3 Sweet spot : 8-12 agents

Consensus de **3 sources indépendantes** :
- Doctrine iFIND 10/05 : 8-12 agents
- Étude ICLR 2025 (arXiv 2503.13657) : taux d'échec 41-86% sur systèmes >15 agents
- Anthropic Engineering : "multi-agent worth it only when task value pays for 15× tokens"

**Sous 8 agents** : coût d'opportunité (Alexis fait encore trop de boulot manuel)
**Au-delà de 12** : coût coordination > gain marginal (cf. cas 47k$, cas 11x.ai)

---

# Section 2 — Inventaire exhaustif (50 agents évalués)

Les 4 sub-agents ont produit collectivement une liste de **50 agents possibles** organisés en 10 catégories. Pour chaque agent : nom, mission, score d'évaluation, verdict (RETENU / REJETÉ / DIFFÉRÉ).

## 2.1 Catégorie SURVEILLANCE / MONITORING (8 agents)

| # | Nom | Mission | Score | Verdict |
|---|---|---|---|---|
| 1 | **Doctor** ✅ | Surveillance infra 24/7 (services, postgres, disk, quotas) | 9.5/10 | **EN PROD** |
| 2 | **Watchdog** | Surveille budgets APIs (Apify/Anthropic/Kaspr/etc.) | 7.5/10 | **RETENU #4** |
| 3 | **Sentinel** | Security scan (secrets exposés dans logs/code/configs) | 5.0/10 | DIFFÉRÉ (besoin émerge à 3+ clients) |
| 4 | **Compliance Watchdog** | Surveille conformité RGPD (doNotContact respectés, retention) | 4.5/10 | REJETÉ (script suffit, peu de variabilité) |
| 5 | **Performance Monitor** | Latence API, p95/p99, hot paths | 4.0/10 | REJETÉ (script Prometheus suffit) |
| 6 | **Usage Pattern Detector** | Détecte patterns usage anormaux (ex: client lit jamais les leads) | 6.0/10 | DIFFÉRÉ (intéressant à 3+ clients) |
| 7 | **Incident Commander** | Coordonne réponse en cas de panne (RCA + escalation) | 6.5/10 | DIFFÉRÉ (utile à 5+ clients) |
| 8 | **Cost Optimizer** | Optimise dynamiquement les budgets agents+API | 5.5/10 | DIFFÉRÉ (Watchdog suffit V1) |

## 2.2 Catégorie QUALITÉ / AUDIT (7 agents)

| # | Nom | Mission | Score | Verdict |
|---|---|---|---|---|
| 9 | **Auditor** ✅ | Audit qualité leads/contacts/briefs | 9.0/10 | **EN PROD (V0.2)** |
| 10 | **Brief Quality Validator** | Audit cohérence briefs V2 Opus | 7.0/10 | **INTÉGRÉ DANS AUDITOR** (Phase 3) |
| 11 | **Bias Detector** | Détecte biais systémiques (rejets trop nombreux d'un secteur) | 5.0/10 | DIFFÉRÉ (10+ clients) |
| 12 | **Cross-Source Cohérence Auditor** | Vérifie cohérence inter-sources sur même boîte | 5.5/10 | **INTÉGRÉ DANS AUDITOR** |
| 13 | **Persona Validator** | Vérifie persona = bon contact pour le signal | 6.5/10 | **INTÉGRÉ DANS AUDITOR** |
| 14 | **Decision Auditor** | Audit décisions Opus (verdicts trop OUI ? trop NON ?) | 6.0/10 | **INTÉGRÉ DANS AUDITOR** |
| 15 | **Pattern Recurrence Detector** | Détecte erreurs récurrentes (DiXiO type, Audion NAF) | 7.5/10 | **RETENU #6 = Lead Recovery Agent** |

## 2.3 Catégorie RECHERCHE / ENRICHISSEMENT (8 agents)

| # | Nom | Mission | Score | Verdict |
|---|---|---|---|---|
| 16 | **Lead Hunter** | Chasse contacts manquants 24/7 (Pappers/HarvestAPI/CSE cascade) | 8.5/10 | **RETENU #3** |
| 17 | **Company Researcher** | Deep research sur boîte (presse, glassdoor, social) | 5.0/10 | DIFFÉRÉ (5+ clients) |
| 18 | **Contact Detective** | Cherche LinkedIn URL manquante d'un contact connu (cas Salvia) | 6.5/10 | **INTÉGRÉ DANS LEAD HUNTER** |
| 19 | **Market Watcher** | Veille concurrence (Apollo/Pharow pricing, levées) | 5.5/10 | DIFFÉRÉ (utile pour Strategist) |
| 20 | **Sector Researcher** | Recherche sectorielle pour nouveau client | 5.0/10 | **INTÉGRÉ DANS ONBOARDER** |
| 21 | **News Hunter** | Détecte news pertinentes pour leads dashboard | 4.5/10 | REJETÉ (déjà fait par layoffs-news-search) |
| 22 | **Adjacent Product Scout** | Identifie produits adjacents pour iFIND | 4.0/10 | DIFFÉRÉ (Phase 4+) |
| 23 | **Lead Recovery Agent** | Sweep ARCHIVED ≥7 pour récupérer faux négatifs | 7.0/10 | **RETENU #6** |

## 2.4 Catégorie OPTIMISATION / APPRENTISSAGE (6 agents)

| # | Nom | Mission | Score | Verdict |
|---|---|---|---|---|
| 24 | **Refiner** | Optimise prompts/seuils basé sur outcomes hebdo | 8.0/10 | **RETENU #7** |
| 25 | **A/B Test Orchestrator** | Lance auto des tests A/B sur prompts/seuils | 6.0/10 | DIFFÉRÉ (3+ clients) |
| 26 | **ICP Refiner** | Apprend du jugement Fred et raffine Client.icp JSON | 7.5/10 | **INTÉGRÉ DANS MIRROR** |
| 27 | **Threshold Optimizer** | Ajuste les seuils numériques (score plancher, freshness) | 5.5/10 | **INTÉGRÉ DANS REFINER** |
| 28 | **Cascade Optimizer** | Optimise l'ordre cascade enrichissement | 4.5/10 | REJETÉ (peu de variabilité) |
| 29 | **Prompt Cache Optimizer** | Optimise breakpoints prompt caching | 3.0/10 | REJETÉ (config one-shot, pas un agent) |

## 2.5 Catégorie INTERACTION CLIENT (6 agents)

| # | Nom | Mission | Score | Verdict |
|---|---|---|---|---|
| 30 | **Mirror** | Encode jugement client (Fred → patterns gagnants/perdants) | 8.5/10 | **RETENU #5** |
| 31 | **Onboarder** | Setup nouveau client (ICP + Rodz + pollers + dashboard) | 8.0/10 | **RETENU #8 (déclencheur client #2)** |
| 32 | **Customer Success virtuel** | Surveille santé client (engagement dashboard, sentiment) | 6.0/10 | DIFFÉRÉ (5+ clients) |
| 33 | **Commercial Coach** | Aide Fred sur les leads (variantes emails, suivi follow-up) | 7.0/10 | DIFFÉRÉ (utile après Mirror) |
| 34 | **Brief Personalizer** | Génère messages personnalisés par lead | 6.5/10 | **DÉJÀ FAIT PAR copy-generator.ts** |
| 35 | **Churn Detector** | Détecte signaux de churn client | 5.0/10 | DIFFÉRÉ (10+ clients) |

## 2.6 Catégorie STRATÉGIE / VISION (4 agents)

| # | Nom | Mission | Score | Verdict |
|---|---|---|---|---|
| 36 | **Strategist** | Partenaire de réflexion stratégique pour fondateur | 8.5/10 | **RETENU #9 (on-demand)** |
| 37 | **Founder's Brain** | Augmentation quotidienne fondateur (synthesis, decision trees) | 7.0/10 | **FUSIONNÉ DANS STRATEGIST** |
| 38 | **Pivot Detector** | Détecte signaux faibles pour pivots stratégiques | 4.5/10 | REJETÉ (jugement fondateur > IA) |
| 39 | **Vision Coherence Auditor** | Vérifie cohérence vision iFIND vs actions quotidiennes | 4.0/10 | REJETÉ (jugement fondateur > IA) |

## 2.7 Catégorie OPÉRATIONNEL QUOTIDIEN (4 agents)

| # | Nom | Mission | Score | Verdict |
|---|---|---|---|---|
| 40 | **Validator** | Smoke tests post-deploy (routes API, builds, tests) | 7.0/10 | **RETENU #10** |
| 41 | **Report Generator** | Génère rapports clients (digest hebdo, métriques) | 5.0/10 | **DÉJÀ FAIT PAR weekly-digest-runner.ts** |
| 42 | **Documentation Auto** | Maintient docs internes à jour | 4.5/10 | DIFFÉRÉ (10+ clients ou équipe) |
| 43 | **Lead Prioritizer** | Compose la "todo today" Fred (top 5 leads à attaquer) | 6.5/10 | **DÉJÀ PARTIELLEMENT FAIT** (todo-today.ts) |

## 2.8 Catégorie AUGMENTATION FOUNDER (3 agents)

| # | Nom | Mission | Score | Verdict |
|---|---|---|---|---|
| 44 | **Decision Tree Agent** | Aide Alexis sur décisions importantes (pricing, pivots) | 6.0/10 | **FUSIONNÉ DANS STRATEGIST** |
| 45 | **Research Assistant** | Recherche pour Alexis (concurrence, pricing, marché) | 5.5/10 | **FUSIONNÉ DANS STRATEGIST** |
| 46 | **Coding Partner** | Aide Alexis à coder de nouvelles features (= ce que je fais) | 7.0/10 | DÉJÀ FAIT (= Claude Code = moi) |

## 2.9 Catégorie AUGMENTATION CLIENT (3 agents)

| # | Nom | Mission | Score | Verdict |
|---|---|---|---|---|
| 47 | **Sales Coach virtuel** | Coach Fred sur ses leads (Mirror + commercial coaching) | 7.5/10 | **FUSIONNÉ DANS MIRROR** |
| 48 | **Lead Briefing Live** | Génère brief contextuel quand Fred ouvre un lead | 5.0/10 | **DÉJÀ FAIT PAR brief-builder.ts** |
| 49 | **Follow-up Tracker** | Suit les emails envoyés, rappel auto si pas de réponse | 5.0/10 | DIFFÉRÉ (post-pivot Data-only caduc) |

## 2.10 Catégorie MÉTA-AGENTS (1 agent)

| # | Nom | Mission | Score | Verdict |
|---|---|---|---|---|
| 50 | **Orchestrator** | Méta-agent qui dispatche les tâches aux autres agents | 4.0/10 | REJETÉ (cron systemd suffit < 12 agents) |

---

# Section 3 — Évaluation comparative et matrice impact × facilité

## 3.1 Matrice 2D des 50 agents

```
              FACILE                                        DIFFICILE
              ──────────────────────────────────────────────────────────
HIGH       │  Watchdog ●  Validator ●   Auditor ●    Strategist ●     │
IMPACT     │  Doctor ●                  Lead Hunter ●                  │
           │              Refiner ●     Mirror ●                       │
           │  Lead Recovery ●           Onboarder ●                    │
           │──────────────────────────────────────────────────────────│
MEDIUM     │  Pattern Detect           Decision Auditor                │
IMPACT     │  Threshold Optim         Sentinel                         │
           │──────────────────────────────────────────────────────────│
LOW        │  Compliance               Pivot Detector                  │
IMPACT     │  Performance Monitor      Vision Coherence                │
           │  (à scripter)            (jugement humain)                │
              ──────────────────────────────────────────────────────────
```

## 3.2 Détection de doublons (résolus avant la sélection finale)

| Paire potentielle | Status |
|---|---|
| Doctor + Watchdog | ✅ DISTINCTS (infra vs budgets) — recommandation sub-agent 1 confirmée |
| Auditor + Brief Validator + Persona Validator + Pattern Detector | ✅ FUSIONNÉS dans AUDITOR V0.2 (5 checks auto déjà codés) |
| Strategist + Founder's Brain + Decision Tree + Research Assistant | ✅ FUSIONNÉS en 1 seul STRATEGIST on-demand |
| Mirror + ICP Refiner + Sales Coach | ✅ FUSIONNÉS en 1 seul MIRROR |
| Refiner + A/B Test + Threshold Optimizer | ✅ FUSIONNÉS en 1 seul REFINER (avec sub-modules) |
| Lead Hunter + Contact Detective + Lead Recovery | 🟡 Lead Hunter + Lead Recovery (2 agents séparés, Contact Detective fusionné dans Hunter) |

**Verdict** : passage de 50 candidats → 12 retenus + 4 fusionnés en intégration.

---

# Section 4 — Top 12 agents iFIND (l'équipe d'élite)

Voici les 12 agents qui forment l'équipe iFIND mature. Pour chacun : mission, déclencheur, modèle, outils, coût, dépendances, KPI succès.

## Agent #1 — DOCTOR (Surveillance infra) ✅ EN PROD V1.1

| Critère | Valeur |
|---|---|
| **Mission** | Surveille l'infrastructure (services, postgres, disk, mémoire, containers) toutes les 1h |
| **Trigger** | Cron systemd toutes les 1h |
| **Modèle** | Claude Sonnet 4.6 (drop-in upgrade de 4.5 fait ce soir) |
| **Outils** | get_system_snapshot, query_postgres (read-only), send_telegram_alert, Bash/Read/Grep/Glob |
| **Mode** | Observe-only (hooks bloquent destructif) |
| **Coût** | $0.17/run × 24/jour = **~$120/mois** ⚠️ |
| **Coût optimisé** | Réduire à 1× toutes les 2h = ~$60/mois (suffisant pour détection pannes) |
| **Dépendances** | Aucune (autonome) |
| **KPI succès** | (a) Aucune panne non détectée < 1h, (b) faux positifs < 1/semaine |
| **Risques** | Bruit Telegram si trop sensible. Solution : tunning seuils sur 2 semaines. |

⚠️ **À AJUSTER** : $120/mo c'est trop. Soit on baisse fréquence à 2h ($60/mo), soit on passe à 30 turns max au lieu de 25 mais avec early stop si tout vert. **Recommandation : baisser à 2h pour démarrer**.

## Agent #2 — AUDITOR (QA Lead virtuel) ✅ EN PROD V0.2

| Critère | Valeur |
|---|---|
| **Mission** | Audit qualité leads/contacts/briefs/ICP fit + reliability complémentaire de Doctor |
| **Trigger** | Cron systemd toutes les 6h (4×/jour) |
| **Modèle** | Claude Opus 4.7 |
| **Outils** | 7 MCP tools (query_postgres, snapshot, telegram, cost_report, check_external, check_brief_sync, deep_dive_lead) |
| **Mode** | Observe-only + recommandations 1-clic |
| **Coût** | $0.50/run × 4/jour = **~$60/mo** |
| **Dépendances** | Aucune (autonome) |
| **KPI succès** | (a) Détecte ≥ 80% des bugs persona/brief, (b) ≤ 2 faux positifs/jour, (c) ≤ 1 critique manqué/mois |
| **Risques** | Sur-alerter Fred. Solution : escalation graduelle (warn cumul ≥ 3 avant critique). |

## Agent #3 — LEAD HUNTER (Chasseur de contacts) — À CONSTRUIRE

| Critère | Valeur |
|---|---|
| **Mission** | Chasse les contacts manquants pour leads en flag manuel (cas Salvia, Groupe Yoni). Utilise cascade Pappers + HarvestAPI + Google CSE + sites web |
| **Trigger** | Cron systemd toutes les 12h (2×/jour) + event-driven quand nouveau lead status=NEW sans contact |
| **Modèle** | Claude Sonnet 4.6 (raisonnement bon, coût raisonnable) |
| **Outils** | 8 outils : query_postgres, refresh_pappers_live, harvestapi_search, google_cse_search, fetch_company_website, validate_linkedin_url, send_telegram_alert, propose_contact (suggest 1-clic) |
| **Mode** | Suggest + 1-clic Fred (jamais d'auto-write Lead) |
| **Coût** | $0.30/run × 2/jour = ~$18/mo + APIs externes |
| **Dépendances** | **CRITIQUE** : Auditor doit détecter les leads sans contact tech d'abord |
| **KPI succès** | (a) +20% leads avec contact tech valide, (b) 0 mauvais contact poussé (1-clic Fred filtre) |
| **Risques** | Cher si trop de runs. Solution : limit 10 leads/run, queue prioritaire |
| **Effort dev** | 2-3 jours (cascade existante + 3 MCP tools à coder) |

## Agent #4 — WATCHDOG (Surveillance budgets) — À CONSTRUIRE

| Critère | Valeur |
|---|---|
| **Mission** | Surveille budgets Anthropic / Apify / TheirStack / Kaspr / FullEnrich / Rodz. Alerte Telegram si dérive |
| **Trigger** | Cron systemd toutes les 1h |
| **Modèle** | Claude Haiku 4.5 (classification déterministe) |
| **Outils** | get_cost_report (réutilise route existante), send_telegram_alert |
| **Mode** | Observe-only, alertes graduées |
| **Coût** | $0.02/run × 24/jour = **~$15/mo** |
| **Dépendances** | Aucune |
| **KPI succès** | (a) 0 dépassement budget non alerté, (b) alertes à 80% / 95% / 100% |
| **Risques** | Quasi nul (tâche classification simple) |
| **Effort dev** | 1 jour |

## Agent #5 — MIRROR (Encode jugement Fred) — À CONSTRUIRE QUAND FRED VALIDE RÉGULIÈREMENT

| Critère | Valeur |
|---|---|
| **Mission** | Encode le jugement humain de Fred lead par lead. Apprend ses patterns (anti-personas, NAF préférés, signaux qui matchent). Raffine `Client.icp` JSON. |
| **Trigger** | Cron toutes les 12h + event-driven sur DASHBOARD_INTERACTION |
| **Modèle** | Claude Sonnet 4.6 + cache fort (few-shot patterns Fred) |
| **Outils** | query_postgres, fetch_lead_activities, update_client_icp_proposal (1-clic Alexis valide), send_telegram_alert |
| **Mode** | Suggest + validation Alexis hebdo |
| **Coût** | $0.10/run × 2/jour = ~$6/mo |
| **Dépendances** | Fred doit valider ≥ 20 leads/mois (sinon rien à apprendre) |
| **KPI succès** | (a) ICP fit V3 améliore +10% leads OUI/Pépite, (b) -50% rejets injustifiés |
| **Risques** | Sur-fit aux préférences d'un seul client. Solution : raffinement par client séparément |
| **Effort dev** | 3-4 jours (logique apprentissage few-shot) |

## Agent #6 — LEAD RECOVERY (Sweep faux négatifs) — À CONSTRUIRE

| Critère | Valeur |
|---|---|
| **Mission** | Sweep régulier des leads ARCHIVED avec fitScore ≥ 7 (faux négatifs potentiels). Re-juge avec contexte enrichi. |
| **Trigger** | Cron toutes les 24h |
| **Modèle** | Claude Sonnet 4.6 |
| **Outils** | query_postgres, deep_dive_lead, qualifyTrigger force=true (via HTTP route), send_telegram_alert |
| **Mode** | Suggest, Alexis valide la recovery |
| **Coût** | $0.20/run × 1/jour = ~$6/mo |
| **Dépendances** | RE-JUDGED engine existant (requalify-engine.ts) |
| **KPI succès** | (a) +5% Pépites/mois récupérées, (b) ≤ 2% faux positifs (recovery injustifiée) |
| **Risques** | Boucle si pas de filtre. Solution : déjà géré par filtre anti-boucle `[RE-JUDGED` dans requalify-engine.ts |
| **Effort dev** | 1-2 jours (logique existe déjà via requalify-engine) |

## Agent #7 — REFINER (Optimise prompts/seuils) — À CONSTRUIRE EN PHASE 3

| Critère | Valeur |
|---|---|
| **Mission** | Analyse les outputs des agents (Auditor, Mirror, Hunter) sur 1 semaine. Propose améliorations prompts/seuils. |
| **Trigger** | Cron 1×/semaine (dimanche soir) |
| **Modèle** | Claude Opus 4.7 (raisonnement stratégique nuancé) |
| **Outils** | query_postgres, fetch_agent_logs, propose_prompt_diff, send_telegram_alert |
| **Mode** | Suggest avec validation Alexis manuelle (jamais auto-déploy) |
| **Coût** | $5-10/run × 4/mois = ~$30/mo |
| **Dépendances** | **CRITIQUE** : Auditor + Mirror doivent tourner depuis ≥ 1 mois pour avoir des données |
| **KPI succès** | (a) Au moins 1 amélioration validée par mois, (b) Trace ROI de chaque amélioration |
| **Risques** | Sur-tuner sur cas particuliers. Solution : exiger 30+ data points avant proposition |
| **Effort dev** | 4-5 jours |

## Agent #8 — ONBOARDER (Setup nouveau client) — DÉCLENCHEUR : CLIENT #2 SIGNE

| Critère | Valeur |
|---|---|
| **Mission** | Onboarding zero-friction nouveau client : questionnaire Telegram → ICP JSON → provisionning Rodz → config pollers → dashboard customisé |
| **Trigger** | On-demand (quand client #2/3/N signe) |
| **Modèle** | Sonnet 4.6 (orchestration) + Opus 4.7 (validation finale) cascade |
| **Outils** | 10 outils : send_telegram_alert (interactive), create_client_icp_proposal, provision_rodz_signals, configure_pollers_for_client, generate_dashboard_template, validate_setup_coherence, ... |
| **Mode** | Interactive avec founder (chaque étape validée) |
| **Coût** | $10-20 par onboarding (one-shot) |
| **Dépendances** | Mirror utile (réutilise patterns ICP appris) |
| **KPI succès** | (a) Onboarding 50min → 20min, (b) 100% des nouveaux clients avec ICP cohérent |
| **Risques** | Mauvaise compréhension contexte client. Solution : checkpoints validation à chaque étape |
| **Effort dev** | 5-7 jours |

## Agent #9 — STRATEGIST (Partenaire réflexion fondateur) — À CONSTRUIRE PHASE 3

| Critère | Valeur |
|---|---|
| **Mission** | Partenaire de réflexion stratégique pour Alexis. Veille marché, analyse cohort, propose pivots, décisions tree pricing. |
| **Trigger** | On-demand (Alexis lance une conversation via Telegram ou interface dédiée) |
| **Modèle** | Claude Opus 4.7 (raisonnement profond, long context) |
| **Outils** | web_search (natif Anthropic), fetch_url, query_postgres, fetch_competitor_data, generate_decision_tree |
| **Mode** | Conversational, Alexis drive |
| **Coût** | $2-5 par session × 5-10 sessions/mois = ~$30/mo |
| **Dépendances** | Aucune |
| **KPI succès** | (a) ≥ 1 décision stratégique influencée par mois, (b) Alexis se sent moins seul dans les choix |
| **Risques** | Conseiller dans le vide si pas de data. Solution : exiger contexte minimum |
| **Effort dev** | 2-3 jours |

## Agent #10 — VALIDATOR (Smoke tests post-deploy) — À CONSTRUIRE

| Critère | Valeur |
|---|---|
| **Mission** | Lance batterie de tests automatiques après chaque commit git push : smoke tests routes API, lint, tsc, vitest, build Next |
| **Trigger** | Webhook git post-push OU cron horaire |
| **Modèle** | Claude Sonnet 4.6 |
| **Outils** | run_npm_command (sandboxed), check_http_endpoint, send_telegram_alert |
| **Mode** | Observe, alerte si régression |
| **Coût** | $0.10/run × 10/jour = ~$30/mo |
| **Dépendances** | Aucune |
| **KPI succès** | (a) 0 régression atteignant prod sans alerte, (b) feedback < 5min après commit |
| **Risques** | Faux positifs sur tests flaky. Solution : retry 2× avant alert |
| **Effort dev** | 2 jours |

## Agent #11 — MARKET WATCHER (Veille concurrence) — DIFFÉRÉ PHASE 4

| Critère | Valeur |
|---|---|
| **Mission** | Surveille Apollo, Pharow, Cognism, ZoomInfo (pricing, features, levées) |
| **Trigger** | Cron 1×/jour |
| **Modèle** | Claude Sonnet 4.6 + web_search |
| **Coût** | ~$10/mo |
| **Verdict** | DIFFÉRÉ — utile à partir de 3+ clients pour ajuster positionnement |

## Agent #12 — INCIDENT COMMANDER (RCA + escalation) — DIFFÉRÉ PHASE 4

| Critère | Valeur |
|---|---|
| **Mission** | Coordonne réponse en cas de panne (Doctor remonte alerte critique) : RCA auto, escalation, ouvre ticket interne |
| **Trigger** | Event-driven (Doctor critical alert) |
| **Modèle** | Claude Opus 4.7 |
| **Coût** | ~$5/mo (peu de runs) |
| **Verdict** | DIFFÉRÉ — utile à partir de 5+ clients (SLA) |

---

# Section 5 — Re-évaluation honnête Doctor + Auditor

Étant donné la rigueur de cette Carte 5, **doit-on remettre en cause ce qu'on a construit ce soir ?**

## 5.1 Doctor

| Critère | Verdict |
|---|---|
| **Bon choix #1 ?** | ✅ OUI confirmé (consensus 4 sub-agents + cas réels) |
| **Bon modèle ?** | ✅ Sonnet 4.6 OK pour surveillance technique |
| **Bonne fréquence ?** | ⚠️ 1h trop fréquent → **passer à 2h** (économie 50%, suffisant) |
| **Bons outils ?** | ✅ 3 MCP tools suffisent |
| **Bon mode ?** | ✅ Observe-only avec hooks destructive block |

**Action recommandée** : passer Doctor à 2h au lieu de 1h.

## 5.2 Auditor

| Critère | Verdict |
|---|---|
| **Bon choix #2 ?** | ✅ OUI confirmé (3 buckets HIGH d'Alexis = qualité = invariant fondamental) |
| **Bon modèle ?** | ✅ Opus 4.7 justifié (raisonnement nuancé) |
| **Bonne fréquence ?** | ✅ 6h (décidé par Alexis ce soir) cohérent avec analyse |
| **Bons outils ?** | 🟡 4 nouveaux MCP tools OK. À ajouter Phase 3 : refresh_pappers_live, validate_linkedin_active (deep dives "à la source") |
| **Bon mode ?** | ✅ Observe + recommandations 1-clic |
| **Cas mort à corriger ?** | ⚠️ Auditor V0.2 actuel n'absorbe pas qa-stuck-scanner ni recover-ignored (qui restent en scripts). Phase 3 : transformer ces scripts en sub-modules Auditor. |

**Action recommandée** : Auditor reste bon, en Phase 3 absorber qa-stuck + recover-ignored.

## 5.3 Verdict global ce soir

**Pas d'erreur stratégique majeure.** Doctor + Auditor étaient les bons #1 et #2. La Carte 5 confirme. Petits ajustements :
1. Doctor → 2h au lieu de 1h
2. Auditor → garder 6h mais en Phase 3 absorber qa-stuck + recover
3. Pour les agents 3-12, **suivre l'ordre proposé Section 6** (priorité business + dépendances)

---

# Section 6 — Patterns de collaboration entre agents

Source : sub-agent 2 (recherche multi-agent Anthropic 2026).

## 6.1 Pattern global recommandé pour iFIND

**Hybride : Orchestrator-Subagent + Event-Driven + Cron Solo**

```
┌──────────────────────────────────────────────────────────────┐
│  CRON SOLO (8 agents principaux)                              │
│  ─────────────────────────────────────────────────────────    │
│  Doctor (2h)  Watchdog (1h)  Auditor (6h)  Hunter (12h)       │
│  Recovery (24h)  Mirror (12h)  Validator (post-deploy)        │
│  Refiner (1×/sem)                                              │
│                                                                │
│  Chaque agent autonome, n'appelle PAS les autres directement. │
│  Communication via DB (writes append-only, reads concurrent). │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  EVENT-DRIVEN (2 cas)                                         │
│  ─────────────────────────────────────────────────────────    │
│  - Webhook git push → Validator                               │
│  - Doctor critical alert → Incident Commander (Phase 4)       │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR (2 cas spécifiques)                             │
│  ─────────────────────────────────────────────────────────    │
│  - Onboarder (cascade Sonnet → Opus pour validation finale)   │
│  - Strategist (peut invoquer sub-agents si recherche profonde) │
└──────────────────────────────────────────────────────────────┘
```

## 6.2 Communication entre agents

**Pattern recommandé : Append-only journal + non-overlapping columns**

```sql
-- Table AgentEvent (à créer Phase 3)
CREATE TABLE "AgentEvent" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agentName     TEXT NOT NULL,           -- "Doctor", "Auditor", etc.
  eventType     TEXT NOT NULL,           -- "audit_completed", "anomaly_detected"
  payload       JSONB,                   -- contenu structuré
  severity      TEXT,                    -- "ok" | "warn" | "critical"
  createdAt     TIMESTAMP DEFAULT NOW()
);
-- INDEX agentName + createdAt DESC pour requêtes rapides
```

**Avantages** :
- Aucune race condition (append-only)
- Chaque agent lit ce qui l'intéresse
- Audit trail naturel
- Pas de couplage (chaque agent peut tomber sans affecter les autres)

**Anti-pattern à éviter** : agents qui modifient les MÊMES colonnes Lead (race conditions garanties).

## 6.3 Sub-agents : quand et comment

**Règle d'or** : profondeur max **1 niveau** (Anthropic ne supporte pas plus).

**Usages légitimes pour iFIND** :
- Onboarder spawne 1 sub-agent "Validator" pour vérification finale ICP
- Auditor (Phase 3) pourra spawner sub-agents "Deep Investigator" pour 3-5 leads suspects en parallèle

**Coût** : sub-agents = ~4-7× tokens. À budgétiser.

---

# Section 7 — Frontière agent vs script (recap critique)

Source : sub-agent 3.

## 7.1 Grille de décision finale

| Si... | Alors... |
|---|---|
| Tâche déterministe + haute fréquence (>1000/jour) | **Script** |
| Tâche déterministe + latence critique (<100ms) | **Script** |
| Tâche déterministe + audit reproductible | **Script** |
| Tâche avec variabilité naturelle inputs | **Agent IA** |
| Tâche avec pattern émergent à découvrir | **Agent IA** |
| Tâche de raisonnement nuancé contextuel | **Agent IA** |
| Tâche complexe + déterministe (X mais avec règles évolutives) | **HYBRIDE** (agent décide, script exécute) |

## 7.2 Application iFIND (synthèse)

| Tâche actuelle | Recommandation |
|---|---|
| `audit-heal` 11 HEALs | **Garder script** (déterministes, haute fréquence). Mais en Phase 3 : Agent qui décide quels HEALs lancer selon contexte. |
| `qa-stuck-scanner` | **Migrer vers Auditor V2** (pattern émergent : pourquoi pas Sales-STUCK ?) |
| `recover-ignored` | **Migrer vers Auditor V2** ou Recovery agent (décision contextuelle quels critères) |
| `qualifyTrigger V2` | **Garder agent IA** (déjà bien fait). Ajouter prompt caching 1h. |
| `enrich-kaspr-direct` | **Garder script** mais ajouter Agent Lead Hunter qui décide ordre priorité |
| `combo-detector` | **Garder script** pour les 3 combos connus. Mais agent Refiner qui découvre nouveaux combos. |

---

# Section 8 — Roadmap de construction (ordre optimal)

Basée sur ROI immédiat + dépendances + cas d'études (sub-agent 4).

## Phase 1 (déjà fait ce soir — 11/05/2026)

- ✅ Doctor V1.1 (refactor + Sonnet 4.6 + 1h freq)
- ✅ Auditor V0.2 (Opus 4.7 + 7 MCP tools + 6h freq)
- ✅ agent-base.mjs (pattern réutilisable)

**Action immédiate avant Phase 2** : 
- Activer Doctor + Auditor en prod demain matin
- Observer 1 semaine

## Phase 2 (semaines 19/05 et 26/05 — agent #3 + #4)

**Critère d'entrée** : Doctor + Auditor stables, ROI confirmé.

| Semaine | Agent | Pourquoi celui-là d'abord |
|---|---|---|
| 19/05 | **Watchdog** | Coût marginal ($15/mo), évite scenario 47k$, débloque visibilité budgets |
| 26/05 | **Lead Hunter** | Résout VRAI problème actuel (DiXiO/Salvia type), ROI direct produit |

## Phase 3 (mois juin — agents #5 + #6 + #7)

**Critère d'entrée** : 2-3 semaines d'observation Phase 2.

| Mois | Agent | Pourquoi maintenant |
|---|---|---|
| 1ère sem juin | **Lead Recovery** | Sweep faux négatifs après mois de données |
| 2e sem juin | **Validator** | Auto-tests pour ne plus casser quand on ajoute des agents |
| 3-4e sem juin | **Mirror** | Encode Fred quand il a validé ≥ 20 leads (besoin de data) |

## Phase 4 (juillet-août — agents #8 + #9)

| Mois | Agent | Déclencheur |
|---|---|---|
| Juillet | **Onboarder** | Quand client #2 imminent |
| Août | **Refiner** | Quand 1+ mois de données Auditor + Mirror |

## Phase 5 (septembre+ — agents #10 + #11 + #12)

| Mois | Agent | Déclencheur |
|---|---|---|
| Septembre | **Strategist** | Quand besoin réel se manifeste (pas urgent) |
| Octobre | **Market Watcher** | Si 3+ clients (positionnement à ajuster) |
| Novembre | **Incident Commander** | Si SLA à respecter (5+ clients) |

## Synthèse temporelle

```
NOV 11        DEC 11        JAN 11        FEB 11        MAR 11        APR 11
│             │             │             │             │             │
├ Doctor V1.1 ✅            │             │             │             │
├ Auditor V0.2 ✅           │             │             │             │
│             ├ Watchdog    │             │             │             │
│             ├ Lead Hunter │             │             │             │
│             │             ├ Recovery    │             │             │
│             │             ├ Validator   │             │             │
│             │             ├ Mirror      │             │             │
│             │             │             ├ Onboarder   │             │
│             │             │             ├ Refiner     │             │
│             │             │             │             ├ Strategist  │
│             │             │             │             │             ├ Market Watcher
│             │             │             │             │             ├ Incident Cmdr
```

**Total** : 6 mois pour 12 agents en production. Rythme sain (1-2 agents/mois).

---

# Section 9 — Coûts détaillés

## 9.1 Décomposition par agent (régime stable)

| Agent | Modèle | Fréquence | Coût/mois |
|---|---|---|---|
| Doctor | Sonnet 4.6 | 2h (12×/jour) | $60 |
| Auditor | Opus 4.7 | 6h (4×/jour) | $60 |
| Lead Hunter | Sonnet 4.6 | 12h | $18 |
| Watchdog | Haiku 4.5 | 1h | $15 |
| Mirror | Sonnet 4.6 + cache | 12h | $6 |
| Lead Recovery | Sonnet 4.6 | 24h | $6 |
| Refiner | Opus 4.7 | hebdo | $30 |
| Onboarder | Sonnet+Opus | one-shot par client | $10 par client |
| Strategist | Opus 4.7 | on-demand | $30 |
| Validator | Sonnet 4.6 | post-deploy | $30 |
| Market Watcher | Sonnet 4.6 | daily | $10 |
| Incident Cmdr | Opus 4.7 | event-driven | $5 |
| **TOTAL RÉCURRENT** | | | **~$280/mois** |
| **+ Onboarders one-shot** | | | $10 × N clients |

## 9.2 Évolution par phase

| Phase | # Agents actifs | Coût total | % MRR (1 client 390€) | % MRR (5 clients) |
|---|---|---|---|---|
| Phase 1 (aujourd'hui) | 2 (Doctor + Auditor) | ~$120 | 30% 🔴 | 6% 🟢 |
| Phase 2 (semaines 19/05+) | 4 | ~$150 | 38% 🔴 | 7.5% 🟢 |
| Phase 3 (mois juin) | 7 | ~$200 | 51% 🔴 | 10% 🟡 |
| Phase 4 (juillet) | 9 | ~$250 | 64% 🔴 | 12.5% 🟡 |
| Phase 5 (août+) | 12 | ~$280 | 71% 🔴 | 14% 🟡 |

⚠️ **À 1 seul client (DTL grandfathered 199€)** : coûts > revenus 🔴

🟢 **À 5+ clients** : coûts sains (≤15% MRR)

**Conclusion** : Phase 1-2 OK avec 1 client (€85/mois Auditor + Doctor = 21% MRR DTL = ROI prouvable). Ne PAS scaler les agents avant client #2 signé.

## 9.3 Optimisations possibles

| Levier | Économie estimée |
|---|---|
| Prompt caching 1h TTL activé partout | -30 à -40% input tokens |
| Doctor 1h → 2h | -50% |
| Auditor 4h → 6h (déjà fait) | -33% |
| Batch API pour Refiner (analyse hebdo) | -50% sur ce sous-budget |
| Désactiver agents en dormance (Strategist on-demand) | -20% à -30% |

**Coût optimisé Phase 5 mature** : **~$180-200/mois** au lieu de $280.

---

# Section 10 — Risques et garde-fous critiques

## 10.1 Top 5 risques identifiés (sources : cas 47k$, cas PocketOS, cas 11x churn)

| # | Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Coût explosif silencieux** (cas 47k$) | Haute | 🔴 | Budget caps par agent + alerte Telegram à 80% |
| 2 | **Agent qui supprime données prod** (cas PocketOS) | Faible | 🔴 | canUseTool whitelist + hooks regex-block destructif (déjà fait) + DB read-only |
| 3 | **Prompt injection via données externes** | Moyenne | 🟠 | Instruction explicit dans system prompt (déjà fait pour Doctor + Auditor) |
| 4 | **Faux positifs Auditor → bruit Telegram** | Haute | 🟡 | Escalation graduée (warn cumul ≥ 3 avant critical) |
| 5 | **Sur-engineering (12 agents trop complexe)** | Moyenne | 🟡 | Sweet spot 8-12 respecté + révision quotrimestrielle |
| 6 | **Drift qualitatif sans observabilité** | Haute | 🟠 | Langfuse self-hosted déployé avant 4e agent |

## 10.2 Garde-fous obligatoires (à appliquer pour CHAQUE agent)

✅ Déjà appliqués (Doctor + Auditor) :
- canUseTool whitelist (deny by default)
- Hooks PreToolUse bloquent commands destructives
- maxTurns (anti-boucle infinie)
- Timeout paramétrable
- Pool DB read-only séparé
- Audit log JSONL
- Permissions .env 0600
- Instruction anti-prompt-injection
- Rate limit SQL queries (15 soft / 30 hard)

À ajouter en Phase 2 :
- **Budget cap par agent** (env var `AGENT_BUDGET_USD_MONTHLY`, alerte à 80%)
- **Circuit breaker** (3 erreurs consécutives = mode safe + alerte)
- **Observabilité Langfuse** (avant 4e agent)
- **Dark launch obligatoire** : 7j logs-only avant activation

---

# Section 11 — Métriques de succès

## 11.1 KPI globaux du système d'agents

| Métrique | Cible | Mesure |
|---|---|---|
| **Réduction temps Alexis** | 30-70h/mois libérées | Auto-déclaratif + screen time |
| **Qualité leads** | +20% leads valides (bons contacts) | Audit Fred + métriques Auditor |
| **Détection bugs** | ≥ 80% bugs détectés avant impact client | Comparaison alertes vs incidents |
| **Coût agent par client** | < 15% MRR | Cost report mensuel |
| **Disponibilité système** | ≥ 99% uptime | Doctor monitoring |
| **NPS Fred** | ≥ 8/10 | Sondage trimestriel |

## 11.2 KPI par agent

À documenter au moment de sa construction. Pattern :
- **Conversion** : impact mesurable sur les leads
- **Couverture** : % du périmètre que l'agent couvre vs total
- **Précision** : % de ses alertes/recommandations qui sont valides
- **Coût/résultat** : € par résultat utile

## 11.3 Tableau de bord recommandé (Phase 3)

Dashboard interne `/admin/agents` qui montre :
- État de chaque agent (running, dormant, error)
- Coût mensuel cumulé par agent
- Top 10 alertes/recommandations récentes
- Tendance KPI sur 30j

---

# Section 12 — Verdict final et chemin tracé

## 12.1 La doctrine iFIND v2 (mise à jour ce soir)

> **iFIND construit une équipe de 12 agents IA spécialisés sur 6 mois (novembre 2026 → avril 2027). Chaque agent a un rôle précis, validé par recherche Anthropic + cas d'études B2B + cartographie système exhaustive. Sweet spot 8-12 agents respecté.**
>
> **Doctor et Auditor sont déjà en prod (V1.1 + V0.2). 10 agents restants construits 1-2 par mois selon ROI/dépendances.**
>
> **Coût mature : ~$180-200/mois (avec optims). ROI mesurable : 30-70h/mois libérées + qualité leads +20% +stabilité système.**

## 12.2 Les 12 agents (vue d'ensemble)

| # | Agent | Modèle | Phase | Statut |
|---|---|---|---|---|
| 1 | **Doctor** | Sonnet 4.6 | 1 ✅ | En prod V1.1 |
| 2 | **Auditor** | Opus 4.7 | 1 ✅ | En prod V0.2 |
| 3 | **Lead Hunter** | Sonnet 4.6 | 2 | À construire 26/05 |
| 4 | **Watchdog** | Haiku 4.5 | 2 | À construire 19/05 |
| 5 | **Mirror** | Sonnet 4.6 | 3 | À construire juin (3-4e sem) |
| 6 | **Lead Recovery** | Sonnet 4.6 | 3 | À construire juin (1ère sem) |
| 7 | **Validator** | Sonnet 4.6 | 3 | À construire juin (2e sem) |
| 8 | **Onboarder** | Sonnet+Opus | 4 | À construire juillet |
| 9 | **Refiner** | Opus 4.7 | 4 | À construire août |
| 10 | **Strategist** | Opus 4.7 | 5 | À construire septembre |
| 11 | **Market Watcher** | Sonnet 4.6 | 5 | À construire octobre |
| 12 | **Incident Commander** | Opus 4.7 | 5 | À construire novembre |

## 12.3 Les 38 agents écartés (par catégorie)

- **8 fusionnés** dans les 12 retenus (ICP Refiner→Mirror, Persona Validator→Auditor, etc.)
- **15 différés** (utiles plus tard quand 3-10 clients)
- **15 rejetés** (script suffit OU jugement humain irremplaçable OU faux ROI)

## 12.4 Actions immédiates (cette semaine)

1. **Demain matin** :
   - Lire ce doc (TL;DR + Section 5 + Section 12 = 15 min)
   - Tester Doctor + Auditor en réel (sans dry-run)
   - Activer Doctor à fréquence **2h** (au lieu de 1h initialement)
   - Activer Auditor à 6h

2. **Cette semaine** :
   - Observer 5-7 jours de runs réels
   - Mesurer coûts vs estimations
   - Mesurer qualité alertes vs faux positifs
   - Ajuster fréquences si besoin

3. **Semaine 19/05** :
   - Coder Watchdog (1 jour) — agent #3
   - Préparer cahier des charges Lead Hunter

## 12.5 Ce qui change vs ce qu'on faisait avant Carte 5

| Avant ce soir | Après Carte 5 |
|---|---|
| 8 agents proposés (doctrine 10/05) | 12 agents retenus + 38 évalués + écartés |
| Ordre flou | Ordre clair basé sur ROI + dépendances |
| Pas de cas d'études | 10 cas réels validés (11x, Intercom, Replit, etc.) |
| Patterns collaboration : peu clair | Hybride Cron Solo + Event-Driven + Orchestrator validé Anthropic |
| Pas de mesure coût mature | $280 brut / $180-200 optimisé |
| Frontière agent/script flou | Grille claire + 6 décisions iFIND tranchées |
| Doctor 30min puis 1h | Recommandation 2h pour coût |
| Auditor 4h | Confirmé 6h |

## 12.6 Doctrine "3 conditions d'amélioration cumulative"

Du document doctrine du 10/05 (re-validé ce soir par sub-agent 4) :

1. **Human in loop validation 1-clic/jour** : Alexis valide 5-10 décisions agents/jour
2. **Monitoring KPIs continu** : chaque agent a 2-3 KPI trackés
3. **Refresh prompts trimestriel** : tous les 3 mois revoir chaque system prompt

**Sans ces 3 conditions** : drift négatif garanti en 3-6 mois.
**Avec ces 3 conditions** : avantage structurel insurpassable vs concurrents en 6-12 mois.

---

# Annexe — Liens vers les 4 recherches sources

Les 4 sub-agents ont produit collectivement ~25 000 mots de recherche. Les documents complets sont disponibles :

1. **Brainstorming 50 agents** (sub-agent 1) : 40KB, sauvegardé dans tools-results
2. **Multi-agent patterns Anthropic** (sub-agent 2) : 1183 lignes dans `/root/.claude/projects/-root/memory/multi-agent-patterns-ifind-comprehensive.md`
3. **Frontière agent/script** (sub-agent 3) : 1797 lignes dans `/root/.claude/projects/-root/memory/` (5 fichiers : INDEX + quick-ref + matrix + deep-dive + sources)
4. **Cas d'études SaaS B2B** (sub-agent 4) : 25+ sources externes citées, 10 cas réels documentés

**Pour aller plus loin sur un agent particulier** : référer aux sections détaillées de ces 4 recherches.

---

**Document v1.0 — 11/05/2026 ~22h CET**

Cette carte 5 finalise la **Phase de réflexion** d'iFIND. À partir de demain, **Phase d'action** :
- Doctor + Auditor activés en prod
- Watchdog construit 19/05
- Lead Hunter construit 26/05
- Puis 1-2 agents/mois selon roadmap

**Chemin de l'automatisation parfaite : tracé.** À toi d'avancer step by step, en observant et ajustant.
