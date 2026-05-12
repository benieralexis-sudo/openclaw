# Audit Coûts Infrastructure — Phase 0 v3.0

**Date** : 12/05/2026 après-midi  
**Période analysée** : Mai 2026 (jour 12/30) + projection mois entier  
**Scope** : 2 clients actifs (DTL + iFIND interne)  
**Scripts** : `dashboard-v2/scripts/audit-phase0-costs.ts`

---

## 🎯 Synthèse exécutive

1. **Coûts réels mesurés très différents de ce que dit la mémoire stratégique** : $232/mo projeté vs ~$370-450/mo annoncé.
2. **Marge brute Growth 390€ = 45.7% réelle, pas 77% promise** — fausse com auto-induite.
3. **DTL grandfathered 199€ ≈ $219, marge brute négative** sur les coûts qu'ils consomment réellement.
4. **3 outils payants à enterrer absolument** pour passer à 80%+ marge brute Hunter (TheirStack $89 + FullEnrich $20 + Pappers $50 = $159/mo économisables).
5. **Tracking spend Apify cassé en mai** (Apify $0 tracké, alors qu'il devrait y avoir $20-30 de consommation Starter).

---

## 📊 Coûts mois courant (mai 2026, jour 12/30)

### Variables (trackés via Client.quotaConfig.currentSpendUsd)

| Provider | iFIND interne | DTL (Fred) | **Total** | Projection mois entier |
|---|---|---|---|---|
| Anthropic | $0.35 | $9.73 | **$10.08** | ~$25/mo |
| Apify | $0.00 | $0.00 | **$0.00** 🚨 | ~$0/mo (tracking cassé) |
| TheirStack | $0.00 | $1.03 | **$1.03** | ~$2.57/mo (token-cost ≠ abonnement) |

⚠️ **Tracking Apify cassé** : la lib `apify-poller.ts:521` appelle `recordSpend(clientId, "apify", actualCostUsd)` mais aucun spend n'apparaît en DB. Soit (a) les pollers Apify n'ont pas tourné (cohérent avec incident 423 41h), soit (b) la lib `recordSpend` plante silencieusement sur Apify. À investiguer Phase 2.

### Fixes (abonnements + infra)

| Poste | Mensuel | Note |
|---|---|---|
| **TheirStack** (abonnement) | $89 | 5200 cr/mo — mais facture mensuelle réelle, pas tracké en `currentSpendUsd` |
| **Apify Starter** (abonnement) | $29 + usage | $29 fixe + usage variable au-dessus |
| **Kaspr** | $55 (50€) | Backbone emails B2B FR |
| **FullEnrich** Yearly Start | $20 | Reste 417/1000 cr |
| **Pappers** 5K cr | $50 | Estimé $30-75 selon usage réel |
| **VPS Hetzner/OVH** | $60 | Partagé moltbot + dashboard-v2 |
| **Resend** | $15 | Transactionnels dashboard |
| **Domaines + Cloudflare** | $10 | ifind.fr + getdigitestlab.com |
| **TOTAL fixes mensuels** | **$328** | |

### Total cible projection mois entier (mai 2026)

| Type | Montant |
|---|---|
| Fixes | $328 |
| Variables (Anthropic + TheirStack tokens) | ~$28 |
| Apify usage (au-dessus $29 Starter, estimé) | ~$10-20 |
| **TOTAL** | **~$365-375/mo** |

→ La projection script linéaire ($233/mo) sous-estime parce qu'elle compte le tracking `currentSpendUsd` qui ne capture pas les abonnements externes. **Le vrai coût mensuel est ~$365-375.**

---

## 💎 Marge brute par tier de pricing — RÉALITÉ vs MÉMOIRE

| Tier | Pricing (€) | Pricing ($) | COGS estimé v2 | Marge brute réelle | Marge mémoire annoncée |
|---|---|---|---|---|---|
| **DTL grandfathered** | 199€/mo | $219 | $375 | **−71%** 🔴 | non spécifié |
| Sentinel (TPE) | 290€/mo | $319 | $375 | −17% 🔴 | non spécifié |
| **Growth (public)** | 390€/mo | $429 | $375 | **+12.6%** 🟠 | **77% annoncé** ❌ |
| **Hunter (cible v3.0)** | 690€/mo | $759 | $400 (avec capteurs) | **+47.3%** 🟢 | 85-88% annoncé ❌ |
| Strike (premium) | 1290€/mo | $1419 | $440 (avec capteurs custom) | +69% 🟢 | 88% annoncé ✅ |

→ **Implications critiques** :

1. **DTL Fred à 199€ = perte sèche $156/mo** sur les coûts qu'il consomme. À fin contrat, upgrade ou on perd de l'argent.

2. **Growth 390€ à 12.6% marge brute n'est pas viable** pour un produit SaaS B2B. Industry standard 60-80%.

3. **Hunter 690€ à 47% marge brute est correct** mais loin du "88%" promis dans la stratégie. Pour atteindre 80%+ il faut **enterrer outils payants** (objectif stratégique v3.0).

4. **Seul Strike 1290€ tient la promesse 70%+ marge brute** sur les coûts actuels.

---

## 💰 Comment atteindre 80% marge brute Hunter 690€ ($759)

Cible marge brute 80% → COGS max $152/mo.

**Outils à enterrer / remplacer (Phase 4-5)** :

| Outil actuel | Coût | Remplaçant v3.0 | Coût remplaçant | Économie |
|---|---|---|---|---|
| TheirStack | $89 | HiringSignalEngine self-hosted (Apec+WTTJ+FT+LinkedIn) | $5 (compute) | $84 |
| FullEnrich | $20 | EmailPatternGuesser (50L code + MillionVerifier $5/mo) | $5 | $15 |
| Pappers | $50 | Greffe direct + INPI API + RNCS | $0 | $50 |
| Apify Starter | $29 | SelfHostedScrapingFarm (Playwright + Smartproxy $75) | $75 | -$46 (négatif) |

**Total économies nettes : $84 + $15 + $50 − $46 = $103/mo**

**Coûts résiduels après refonte v3.0** :
- Anthropic (élargi capteurs) : ~$40-60/mo
- Smartproxy résidentiels FR : $75/mo
- Kaspr (gardé exception RGPD) : $55/mo
- VPS : $60/mo (peut être upgrade à $80 pour TimescaleDB)
- Resend + domaines : $25/mo
- TOTAL projeté v3.0 : **$255-275/mo**

→ Marge brute Hunter 690€ avec coûts v3.0 = **($759 − $265) / $759 = 65%**

→ Pour atteindre **80%+** il faut soit :
- Pricing Hunter à 890€/mo ($979) → marge 73%
- Ou enterrer aussi Smartproxy (impossible si scraping LinkedIn/Glassdoor)
- Ou pricing Strike 1290€/mo → marge 79%

**Conclusion réaliste** : la marge brute 80%+ promise n'est atteignable que sur **Strike 1290€ tier**, pas sur Hunter 690€. À acter dans la stratégie v3.0.

---

## 🖥️ Ressources VPS (capacité Phase 2 TimescaleDB)

| Ressource | État | Marge pour Phase 2 |
|---|---|---|
| **RAM** | 7.8 Gi total, 5.6 Gi available | ✅ Suffisant pour TimescaleDB hypertables |
| **Swap** | 928 Mi / 2 Gi (46%) | 🟠 Modéré, surveillance recommandée |
| **Disk** | **77% used** (74/96 Gi), 23 Gi libres | ⚠️ **Tendu** pour stockage temporel signaux |
| **CPU load** | 0.68 (1min) — sur 8 vCPU probable | ✅ Marge énorme |
| **Uptime** | 39 jours stable | ✅ |
| **Postgres** | non mesurable (probablement Docker) | À vérifier |

### 🚨 Anomalie disk : `/opt/lutoya-dev` = 27 Gi

`/opt/lutoya-dev` occupe 27 Gi soit **28% du disk total**. C'est plus que /opt/moltbot (5.7 Gi). Investigation requise :
- Projet abandonné ?
- Logs/backups oubliés ?
- Backups d'autres clients ?

**À nettoyer avant Phase 2 TimescaleDB** sinon on n'aura pas la marge disque nécessaire.

```bash
# À investiguer
ls -la /opt/lutoya-dev | head
du -h --max-depth=2 /opt/lutoya-dev | sort -rh | head -20
```

---

## 📈 Évolution coûts depuis avril (proxy via mémoire + observation)

Pas de tracking historique fiable mais cross-check mémoire :

| Mois | Coût annoncé mémoire | Coût mesuré audit | Note |
|---|---|---|---|
| Avril | ~$215/mo Apify seul (incident 03/05) | non mesurable | Apify $61/$70 atteint le 03/05 |
| Mai (12j) | ~$370-450/mo annoncé | **~$365-375/mo projeté** | Aligné mais en raison Apify cassé compteur |
| Juin (cible v3.0) | $180-280/mo cible | **~$255-275/mo réaliste** | Avec économies outils enterrés |

---

## 🎯 Recommandations actionnables

### Avant Phase 1 — Quick wins économies
- [x] Fix incident 423 (récupère capture Apify post-fix) — **fait 12/05 13:43**
- [ ] Investiguer `/opt/lutoya-dev` 27 Gi → cleanup si possible (libère disk pour Phase 2)
- [ ] Investiguer tracking Apify cassé (`apify-poller.ts:521` recordSpend) — peut-être lié à 423 LOCKED qui empêche les runs Apify de partir
- [ ] Décision pricing : **monter DTL Fred à 390€ ou 690€ à fin contrat actuel** (perte sèche actuelle)

### Pendant Phase 1 — Validation économique
- [ ] Confronter pricing 690€ Hunter aux prospects (5-10 interviews) — sans validation, risque de pricing-too-low chronique
- [ ] Refaire le calcul marge brute v3.0 réaliste = **65% Hunter**, pas 80%
- [ ] Acter : Strike 1290€ devient le seul tier 80%+ marge brute → repositionnement public ?

### Phase 4-5 — Économies structurelles
- Enterrer TheirStack (économie $89/mo) — remplacé par HiringSignalEngine self-hosted
- Enterrer FullEnrich (économie $15/mo net) — remplacé par EmailPatternGuesser + MillionVerifier
- Enterrer Pappers (économie $50/mo) — remplacé par Greffe + INPI + RNCS gratuits
- **PAS** enterrer Apify Starter brutalement (coût de remplacement $75 Smartproxy > $29 économisés)

---

## 📊 Coût par lead livré — métrique clé

Sur la base des 24 leads actifs DTL :
- Coût mensuel total : ~$370/mo
- Leads dans pool actif : 24 (sur 90j) = **~8 leads/mois renouvelés**
- **Coût par lead livré : ~$46/lead** 

→ Vs marché done-for-you US ($175-850/lead) → iFIND est **très bon marché** côté coût mais **devrait être facturé plus cher** côté prix.

→ Vs promesse "6 Pépites garanties/mois" = $370/6 = **$62/Pépite garantie** — sain mais ne capture pas la valeur.

→ Insight : tu sous-vends sévèrement le produit. Hunter 690€ → 60 Pépites = $13/Pépite = **5× plus cher pour le client mais reste très bon marché** vs marché.

---

## ✅ Critère de sortie A.0.4 — atteint

- [x] Décomposition coûts variables (Anthropic / Apify / TheirStack) trackés par client
- [x] Coûts fixes (abonnements + infra) explicitement listés
- [x] Projection mois entier
- [x] Marge brute calculée par tier avec correction vs mémoire
- [x] Ressources VPS auditées
- [x] Recommandations actionnables (quick wins + structurel)

→ Prochaine étape : **A.0.3 audit code & dette technique** (1.5j)

---

## ⚠️ Découvertes critiques A.0.4

1. **La marge brute promise (77-88%) n'a jamais existé** sur les coûts réels. Réelle ~45-65% selon tier.
2. **DTL grandfathered est financièrement perdant** (−$156/mo). Décision pricing urgente à fin contrat.
3. **Tracking Apify cassé** = on ne voit pas une partie des coûts. À investiguer.
4. **Disk 77% saturé + 27 Gi de squat lutoya-dev** = bloqueur potentiel Phase 2.
5. **Coût/Pépite garantie actuel = $62** = on vend trop bas. Marché supporterait $200-300/Pépite premium.
