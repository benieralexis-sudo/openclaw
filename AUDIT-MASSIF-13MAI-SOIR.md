# Audit massif iFIND — 13/05/2026 soir

**Méthode** : 10 phases d'investigation (système, DB, pipeline, code, coûts, config, UI, sources, archi, sécurité)
**Durée** : ~1h45 de creusement direct
**Verdict global** : produit **techniquement fonctionnel**, **commercialement à zéro**, **8 bugs critiques** identifiés

---

## 🚨 P0 — Critiques (perte business directe)

### P0-1. Fred ne convertit rien — ROI 0 %
- 220 Triggers générés en 30j
- 4 EMAIL_SENT TOTAL toute la vie du compte (tous le 28/04)
- **0 EMAIL_REPLY, 0 MEETING_BOOKED, 0 deal**
- On facture 199€/mois à DTL sans aucune preuve de valeur business
- **Cause racine** : pas d'outcomes loop branchée + Fred travaille hors dashboard

### P0-2. 60 briefs IA générés mais cachés au commercial
- 60 Leads ont un `Trigger.briefV2Json` (brief IA Claude Opus généré) **mais leur `Lead.briefJson` est NULL**
- Inclus **Alteia (fitScore 80, V2 OUI 86)**, **Stormshield (75, OUI 78)**, ViaXoft, Shift Technology
- L'utilisateur voit "Lead sans brief" → ne sait pas qu'on a déjà rédigé le mail
- **Coût gaspillé** : $0.05-0.10 par brief Opus × 60 = ~$5 mais surtout valeur business perdue

### P0-3. 10 Pépites fitScore≥80 archivées auto
- Le bot archive automatiquement quand `Trigger.status=IGNORED`
- 10 leads d'excellence (top 33 %) jetés sans qu'Alexis/Fred ne les voient
- Liste : SQLI (100), Matawan (95), Degetel (90), B-HIVE (90), Hivebrite (80), Smile (80), SOLUTEC (80), Alithya (80), eXalt (75), engIT (75)

### P0-4. Le judge V2 ne juge que 49 % des Triggers
- 122 sur 239 Triggers en 30j sans verdict V2 (51 %)
- L'IA Opus n'a pas tourné dessus → pas de qualification, pas de brief, pas de Pépite détectée
- **Cause probable** : queue Anthropic qui n'aspire pas tout, ou pre-Opus reject scan rejette à 51 %
- Sur 7 jours récents = 97 % (le retard est sur backlog ancien)

### P0-5. Doctor + Auditor INACTIFS
- Les 2 agents surveillance promis "actifs en prod ~$74/mo" (MEMORY) sont `inactive`/`not-found`
- Aucune alerte en cas d'incident
- Aucun audit qualité automatique

### P0-6. APIFY budget CRITICAL — breaker imminent
- 82.6 % used (~$82/$100), burn $4.86/jour
- **Projection $141 fin de cycle** (dépassement +41 %)
- **Breaker à $95 dans ~2-3 jours** → bot Apify coupé pour DTL
- MEMORY note "augmenter $100→$150" → action user en attente

---

## 🔴 P1 — Majeurs (perte volume / qualité)

### P1-1. Cron clientId hardcodé DTL
- `scripts/run-pollers-cron.sh:13` et `run-pollers-all-cron.sh:22` ont `CLIENT_ID="${1:-cmoevcce00001l6uuklcp13wx}"`
- iFIND (créé ce soir) ne tournera pas automatiquement
- Fix : 1 ligne (retirer `&clientId=...` de l'URL) pour que la route itère sur tous les ACTIVE

### P1-2. 12 désynchros Trigger=IGNORED + Lead actif
- 12 Triggers status=IGNORED mais leur Lead reste status=NEW
- Cas concrets : IGENESIS, ADAPT1SOLUTION, AB7 HOLDING, SAS LE GUIDE ULTIME (anciens iFIND triggers)
- Bug B1 documenté mais non résolu pour les nouveaux triggers

### P1-3. AuditLog VIDE — 0 traçabilité
- La table existe (schema OK) mais aucun INSERT dans 30 derniers jours
- Aucune trace des modifications ICP, créations user, login, edits sensibles
- Impossible de débugger un incident a posteriori

### P1-4. Kaspr + Rodz + Anthropic tracking DB cassé
- `Lead.kasprCreditsUsed` jamais incrémenté
- `RodzSignal.creditsUsed` reste à 0
- `anthropicBurn.totalCumulatedUsd = 0` (alors qu'on facture vraiment)
- **Conséquence** : on consomme à l'aveugle, impossible d'auditer ROI par client/source

### P1-5. INPI API auth en panne (au moins 401)
- Test gateway répond 401 (avant c'était 500)
- L'auth nécessite peut-être un nouveau token ou redémarrage session XSRF
- 0 trigger TRADEMARK en 30j → on rate un signal

### P1-6. Vulnerabilité kysely high severity
- CVE GHSA-pv5w-4p9q-p3v2 (JSON-path traversal injection)
- Fix dispo : `npm audit fix`
- Pas exploitable directement sans une attaque très spécifique, mais à patcher

### P1-7. 0 client #2 payant
- iFIND repose sur DTL seul → si Fred churn, plus rien
- Aucun pilote en cours d'identification
- C'est pour ça qu'on s'est dogfood ce soir (iFIND comme 2e client)

### P1-8. Personne n'utilise vraiment le dashboard
- Alexis : dernière session 30/04 (13j)
- Fred : 1 session le 26/04 puis plus rien
- 2 commerciaux amis (Théo-Paul, Alex) : **jamais connectés**
- 0 LeadActivity DASHBOARD_INTERACTION en 90 jours
- Le produit est un fantôme

---

## 🟡 P2 — Moyens (dette technique / hygiène)

### P2-1. 5 god files (>800 lignes)
- `components/brief/trigger-brief-board.tsx` : **2045 lignes**
- `lib/qualify-trigger.ts` : 1285
- `lib/theirstack-poller.ts` : 948
- `components/settings/settings-board.tsx` : 930
- `components/onboarding/onboarding-wizard.tsx` : 900

### P2-2. 2 hardcodes restants (multi-tenant universel non terminé)
- `lib/naf-whitelist.ts` : TECH_NAF_PREFIXES hardcodé (OK pour clients tech, KO pour cyber/fintech/RH)
- `lib/francetravail.ts:154 isFTTechOffer` : hardcode large pour tech (workaround fait via `francetravailRequireTechFilter=false` mais pas idéal)

### P2-3. Dropcontact env key obsolète
- Service coupé 30/04 mais `DROPCONTACT_API_KEY` toujours dans .env
- Aucun risque mais propreté à faire

### P2-4. Google CSE sunset janvier 2027
- Configuré actuellement mais migration obligatoire avant la date
- Layoffs news + Press régionale dépendent dessus
- Alternatives : Serper ($1-3/1000), Brave Search API

### P2-5. 3 Leads orphelins sans Trigger
- Probablement des leads pré-bot ou créés manuellement
- À nettoyer

### P2-6. Disk 77 % + Swap 924Mi
- Pas critique mais à surveiller (build Next + Postgres + Docker prennent du volume)
- Swap utilisé = RAM tight quand 2 instances Claude tournent

### P2-7. Dépendances obsolètes
- Anthropic SDK 0.91 → 0.96 (manque cache prompt v2, citations, files API)
- Prisma 6 → 7 (major)
- Next 15 → 16 (major)
- Pas urgent mais à planifier

### P2-8. 6 TODO/FIXME dans le code prod
- Tous mineurs (commentaires, pas du code mort)

---

## 🟢 P3 — Mineurs / informatifs

### P3-1. iFIND multi-tenant validé
- 19 triggers iFIND captés en quelques minutes (BODACC 11 + Apify Sales 5 + RSS-levées 3)
- Bioptimus score 9 isHot (1ère Pépite iFIND)
- 422/422 tests vitest verts

### P3-2. Tous les services externes répondent
- Pappers, Apify, Anthropic, BODACC, Maddyness, Frenchweb = 200 OK
- INPI = 401 (avant 500, possible retour)

### P3-3. 7 tables scopées par clientId correctement

### P3-4. Backup quotidien OK (16h ago dernier)

---

## 📊 Récap chiffré

| Métrique | Valeur |
|---|---|
| Bugs P0 critiques | **6** |
| Bugs P1 majeurs | **8** |
| Bugs P2 moyens | **8** |
| Bugs P3 mineurs | 4 (positifs) |
| **TOTAL bugs identifiés** | **22** |
| Triggers générés 30j (DTL) | 220 |
| Pépites identifiées | 17 |
| Pépites accessibles à Fred | 7 |
| Emails envoyés depuis 25/04 | 4 (tous le 28/04) |
| RDV obtenus via iFIND | **0** |
| Deals signés via iFIND | **0** |
| Clients payants actifs | 1 (DTL grandfathered 199€) |
| Burn Apify projection | **$141 vs $100 plafond** |

---

## 🎯 Si tu ne devais corriger QUE 5 choses

1. **Brancher l'outcomes loop minimale** : 3 boutons UI (👍/👎/📞) + tracking webhook outil envoi → P0-1
2. **Fixer le copy `Trigger.briefV2Json` → `Lead.briefJson`** → P0-2 (60 briefs rendus visibles immédiatement)
3. **Whitelist `fitScore≥80` anti-auto-archive** → P0-3 (10 Pépites récupérées + ne plus jamais perdre)
4. **Augmenter plafond Apify $100→$150** côté console.apify.com → P0-6 (sinon bot coupé dans 3j)
5. **Activer Doctor + Auditor agents** (`systemctl enable doctor auditor`) → P0-5 (surveillance active)

Coût total fix #1-5 : ~6-8 jours dev, ~10 min config user.
Impact : passe d'un produit qui **fait du volume sans valeur** à un produit qui **mesure sa valeur business réelle**.

---

## 🚨 Si tu ne devais corriger QU'UNE chose

**Appeler Fred 30 min** et lui demander :
1. Combien de leads iFIND il a vraiment regardés depuis 3 semaines ?
2. Combien il a contactés ? Comment (mail, tel, LinkedIn) ?
3. Combien de RDV obtenus ?
4. Pourquoi il ne clique pas sur le dashboard ?

Cette conversation peut **invalider 80 % du backlog tech** (si Fred dit "j'aime pas le dashboard, je veux un export Excel quotidien", on rebuild différemment).

---

**Fin de l'audit. 22 problèmes identifiés, 6 critiques, plan d'action 1 page.**
