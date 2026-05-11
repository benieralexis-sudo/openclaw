# Carte 2 — Journées d'Alexis

**Date** : 11/05/2026
**Auteur** : Claude (Opus 4.7) en binôme avec Alexis
**Objectif** : Comprendre comment Alexis passe ses journées pour identifier ce qui doit être délégué aux agents IA

**Méthode** : Au lieu d'un journal de bord détaillé (Alexis ne se souvient pas heure par heure), on a procédé par **buckets d'activités** + auto-évaluation du temps/stress.

---

## 12 buckets d'activités identifiés

| # | Bucket | Description | Temps | Stress |
|---|---|---|---|---|
| **A** | Audit qualité leads | Détecter bugs, vérifier chaque lead | 🔴 HIGH | 🔴 HIGH |
| **B** | Optimisation continue | Code, prompts, filtres, waterfall | 🔴 HIGH | 🔴 HIGH |
| **C** | Investigation | "Pourquoi ce lead/contact/source ?" | 🔴 HIGH | 🔴 HIGH |
| D | Vérif waterfall | Tout tourne ? Crédits pas gaspillés ? | ⚪ Implicite dans A+C |
| E | Surveillance coûts | Apify/Anthropic/Kaspr/FullEnrich quotas | ⚪ Implicite dans A+D |
| F | Coordination Fred / client | Briefer Pépites, ajuster ICP | ⚪ Occasionnel |
| G | Tests post-deploy | Vérifier rien cassé | ⚪ Inclus dans optim |
| H | Décisions produit | Pivots, pricing (rare mais critique) | ⚪ Rare mais HIGH stress |
| I | Stratégie marché | Pricing, concurrents, refonte site | ⚪ Occasionnel |
| J | Setup outils | Primeforge, Stripe, Google Cloud | ⚪ One-shot par outil |
| K | Documentation | Mémoire, docs internes | ⚪ Automatique via Claude |
| L | Onboarding client | Tally → ICP → Rodz (futur) | ⚪ Pas encore (1er client signé) |

## Verdict — 2 invariants fondamentaux

Alexis l'a formulé textuellement :

> "Que ça marche et la qualité ! C'est essentiel pour moi, c'est pour ça que j'audit tout le temps et que j'essaye d'améliorer tout le temps."

**Invariant 1 — 🟢 RELIABILITY** : Le système opérationnel tourne sans bug silencieux.

**Invariant 2 — 🟢 QUALITY** : Les leads, contacts, briefs, code sont qualitativement bons.

→ Tout ce qu'Alexis fait quotidiennement (A + B + C + D + E + G) découle de ces 2 invariants.

## Implication pour l'architecture agents

**Alexis ne veut pas d'une checklist figée.** Il a dit :
> "Je n'ai pas d'idée en tête. La plupart du temps je te demande de faire des audits globaux. Tu vérifies toi-même."

→ **L'Auditor doit être INTELLIGENT** (décide chaque jour quoi vérifier selon le contexte), pas un robot qui exécute un script statique.

C'est exactement Doctor en plus large (Doctor fait surtout Reliability via 3 MCP tools, l'Auditor doit faire Quality en plus avec accès aux ~30 briques métier).

## Top 3 priorités agent #1 (Auditor)

| # | Préoccupation Alexis | Bucket | Agent qui résout |
|---|---|---|---|
| 1 | "Est-ce que tout marche ?" | D + E | Auditor (axe Reliability) |
| 2 | "Est-ce que les leads sont bons ?" | A | Auditor (axe Quality) |
| 3 | "Pourquoi ce lead/contact est foireux ?" | C | Auditor (axe Investigation on-demand) |

L'Auditor couvre **3 des 3 buckets HIGH** d'Alexis. C'est l'agent #1 évident.

## Agents post-Auditor (priorités suivantes)

| Agent | Bucket cible | Quand |
|---|---|---|
| **Watchdog** | E (surveillance coûts) — peut être fusionné dans Doctor V2 | Phase 2 (1-2 mois) |
| **Refiner** | B (optimisation prompts/seuils) | Phase 3 (3-4 mois) |
| **Mirror** | F (jugement Fred encodé) | Quand client #2 signé |
| **Validator** | G (smoke tests post-deploy) | Phase 2 |
| **Strategist / Founder's Brain** | H + I (réflexion stratégique) | Phase 4 (6 mois+) |
| **Onboarder** | L (client #2+ setup) | Quand client #2 imminent |

## Conclusion Carte 2

- **3 buckets HIGH** (A + B + C) absorbés par 1 agent (Auditor)
- **2 invariants** définissent la mission de l'Auditor (Reliability + Quality)
- **Pas de checklist figée** — l'Auditor doit raisonner

Carte 4 va décliner ces 2 invariants en problématiques atomiques concrètes.

---

**Document v1.0 — 11/05/2026**
