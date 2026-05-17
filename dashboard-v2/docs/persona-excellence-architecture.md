# Sprint Persona Excellence — Architecture (17/05/2026)

**Objectif** : passer de 32% leads complets+bonne persona à 75-85%+ via 6 phases.

## Métriques de départ (mesurées DB live 17/05)

- 60% leads résolus (40% INCOMPLETE jamais résolus)
- 22% Tier 1 (parfait) + 33% Tier 2 (OK) = 55% utilisables sur le total
- Google CSE cassé (0 lead via google-cse-tech-search en 30 jours, code conditionné qa/tech-hire only)
- 64% des leads sans email VALID

## 6 phases (~7-9j dev total)

### Phase 1 — Dropcontact RGPD strict
**Fichier** : `src/lib/enrich-via-dropcontact.ts`
**API** : `POST https://api.dropcontact.com/v1/enrich/all` (async, polling 5s × 12)
**Auth** : `X-Access-Token`
**Input min** : `{ first_name, last_name, company, website }`
**Output** : email + qualification (verified/catchall/invalid)
**Pay-on-success** : crédit consommé seulement si email trouvé
**Cache** : 30j (les emails ne bougent pas vite)
**Position** : AVANT Kaspr dans `enrich-lead-dirigeants.ts`

### Phase 2 — HarvestAPI multi-candidats
**Fichier** : refactor `src/lib/harvestapi-decision-makers.ts`
**Avant** : retourne top-1 (le meilleur match)
**Après** : retourne TOP-8 triés par pertinence brute (le scoring se fait Phase 3)

### Phase 3 — Scoring multi-critères persona
**Fichier** : `src/lib/persona-candidate-scorer.ts` (pure functions)
**Formule** : `titleMatch(40) + tenure(15) + multiSource(15) + postsContext(20) + buyer(10)`

### Phase 4 — Fallback IA Claude Haiku universel
**Fichier** : `src/lib/persona-ai-fallback.ts`
**Remplace** : Google CSE cassé
**Trigger** : si HarvestAPI 0 candidat OU top-1 score < 50
**Étendu** : tous signaux (pas juste qa-hire/tech-hire)
**Output** : suggestions de profil cible (title + firstNamesHints + searchTermsLinkedIn)
**Re-recherche** : seconde passe HarvestAPI ciblée sur ces termes

### Phase 5 — Posts LinkedIn récents au cerveau
**Fichiers** : `src/lib/harvestapi-recent-posts.ts` + modif `lead-dossier.ts`
**Output** : 10 derniers posts du décideur sur 90j, cache 7j
**Bloc dossier** : `RECENT POSTS` cité dans `QUALIFY_V2_SPECIFIC`

### Phase 6 — Transparence Opus + Feedback Fred
**Modif** : `lead-dossier.ts` — bloc `personaSelection` (choisi + alternatives + raison)
**Nouveau** : table `LeadFeedback` + API `POST /api/leads/[id]/feedback` + UI 2 boutons
**Apprentissage** : script mensuel analyse feedback → ajuste pondérations

### Phase 7 — Backfill pilote 20 leads puis extension
**Étape 7.1** : pilote 20 INCOMPLETE random → validation manuelle
**Étape 7.2** : si ≥80% bons, extension aux 101 autres

### Phase 8 — Tests E2E + commits + monitoring

## Cibles mesurables post-sprint

| KPI | Avant | Cible |
|---|---|---|
| INCOMPLETE | 40% | <10% |
| Tier 1 (parfait) | 22% | >50% |
| Tier 1+2 (utilisable) | 55% | >85% |
| Leads complets (nom+LinkedIn+email VALID) | 32% | >75% |

## Coût opérationnel additionnel : ~42€/mois
