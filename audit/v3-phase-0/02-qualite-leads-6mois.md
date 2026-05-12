# Audit Qualité Leads 6 mois — Phase 0 v3.0

**Date** : 12/05/2026  
**Période** : 167 leads DTL livrés des 6 derniers mois  
**Méthode** : tagging automatique règles + backtest convergence  
**Scripts** : `audit-phase0-tag-leads.ts` + `audit-phase0-backtest-convergence.ts`

---

## 🎯 Synthèse exécutive (3 phrases)

1. **La qualité réelle des leads livrés est 40.7% exploitable** (16 Pépites + 52 OK sur 167) — meilleur que rien, mais 60% n'auraient pas dû être livrés.

2. **La règle "≥3 signaux convergents" — pilier de la v3.0 — ne fonctionne PAS sur les données actuelles** : 0 lead aurait été gardé (84% des leads ne sont vus que par 1 source). La convergence triple est **mathématiquement infaisable** sans construire les capteurs propriétaires orthogonaux.

3. **La meilleure source actuelle est `apify.wttj-jobs` (80% utile)** — mais elle a aussi la pire latence (18j médian). Le système a un paradoxe qualité/fraîcheur.

---

## 📊 Tagging automatique 167 leads (6 derniers mois)

### Distribution couleurs

| Tag | Count | % | Définition |
|---|---|---|---|
| 🟢 PÉPITE | 16 | **9.6%** | ICP match + V2 OUI conf≥75 + contact OK + persona décideur |
| 🟡 OK | 52 | **31.1%** | ICP match partiel ou contact incomplet ou V2 ENRICH |
| 🔴 HORS CIBLE | 71 | **42.5%** | ESN pure / NAF blacklist / hors France / V2 NON conf≥85 |
| ⚫ INUTILISABLE | 28 | **16.8%** | Pas de contact + pas de persona + pas de SIREN |

→ **Taux exploitable réel (Pépite + OK) = 40.7%**  
→ **Taux à jeter (Hors + Junk) = 59.3%**

### Distribution confiance auto-tagging

- HIGH : 78 (47%) — règles claires, sûr
- MEDIUM : 18 (11%) — cas avec V2 ENRICH conf 58
- LOW : 71 (42%) — données manquantes (NAF/effectif/V2 absents)

→ **89 cas borderline** à reviewer humainement pour validation finale (samedi prochain si possible).

---

## 📊 ROI réel par source (qualité observée)

| Source | Total | 🟢 | 🟡 | 🔴 | ⚫ | **% Utile** | Note |
|---|---|---|---|---|---|---|---|
| **apify.wttj-jobs** | 15 | 6 | 6 | 2 | 1 | **80%** 🏆 | Meilleure source qualité — mais latence catastrophique 18j |
| theirstack.buying-intent | 10 | 0 | 6 | 2 | 2 | 60% | Petit volume mais ROI correct |
| theirstack.job-offer | 21 | 1 | 10 | 8 | 2 | 52% | Acceptable |
| rodz.mergers-acquisitions | 2 | 1 | 0 | 1 | 0 | 50% | Trop petit pour conclure |
| rodz.job-offers | 2 | 0 | 1 | 1 | 0 | 50% | Idem |
| rodz.fundraising | 5 | 0 | 2 | 3 | 0 | 40% | Décevant vs A.0.1 (100% Lead→Brain) |
| apify.linkedin-jobs | 55 | 6 | 15 | 21 | 13 | 38% | Gros volume, ROI moyen |
| apify.indeed-jobs | 25 | 0 | 7 | 12 | 6 | 28% | 0 Pépite — confirme désactivation |
| trigger-engine.tech-hiring | 12 | 0 | 3 | 8 | 1 | **25%** | 🚨 Faible ROI alors qu'A.0.1 disait 100% Trigger→Lead |
| trigger-engine.funding-recent | 9 | 2 | 0 | 7 | 0 | 22% | 🚨 Idem, faible utilité |
| rss-levees | 4 | 0 | 0 | 1 | 3 | 0% | Tous junk (SIRENE incomplet probablement) |
| rodz.company-registration | 4 | 0 | 0 | 4 | 0 | 0% | Tous hors cible |
| rodz.recruitment-campaign | 2 | 0 | 2 | 0 | 0 | 100% | Trop petit |
| francetravail.tech | 1 | 0 | 0 | 1 | 0 | 0% | Trop petit |

### 🔍 Contradiction avec A.0.1

A.0.1 disait : `trigger-engine.tech-hiring` (100% Trigger→Lead) et `trigger-engine.funding-recent` (100% Trigger→Lead) = "vraies productrices de Pépites".

A.0.2 dit : ces 2 sources sont **25% et 22% utiles** au tagging final.

→ **Insight critique** : "Trigger créé en Lead" ≠ "Lead utile". Le Brain V2 laisse passer en Lead mais quand on regarde la qualité commerciale, beaucoup ne valent pas la peine d'être contactés.

→ Les **vrais producteurs de Pépites haute qualité** sont en fait `apify.wttj-jobs` et `theirstack.buying-intent` — pas les trigger-engine.* internes.

---

## 🎯 BACKTEST CRITIQUE — Règle "≥3 signaux convergents"

### Distribution sources distinctes par lead (fenêtre 90j glissante avant capturedAt)

| Nb sources distinctes | Total | 🟢 | 🟡 | 🔴 | ⚫ |
|---|---|---|---|---|---|
| **0** (aucun SIRET) | 14 | 0 | 3 | 3 | 8 |
| **1** | **141** | 12 | 43 | 62 | 18 |
| **2** | 12 | 4 | 2 | 4 | 2 |
| **≥3** | **0** | — | — | — | — |

→ **84% des leads (141/167) ne sont vus que par 1 seule source** sur 90j glissants.

### Simulation par seuil

| Seuil | Leads gardés | Recall Pépite 🟢 | Recall Pépite+OK 🟢🟡 | Faux positifs filtrés 🔴⚫ | Précision |
|---|---|---|---|---|---|
| ≥1 source | 153 | 100% | 95% | 11% | 40% |
| ≥2 sources | 12 | 25% | 9% | 94% | 50% |
| **≥3 sources** | **0** | **0%** | **0%** | **100%** | **0%** |
| ≥4 sources | 0 | 0% | 0% | 100% | 0% |

### Verdict

**La règle "≥3 signaux convergents" promise commercialement v3.0 = TECHNIQUEMENT INFAISABLE** sur l'architecture actuelle.

Pourquoi :
1. **Sources non orthogonales** : 5 sources actuelles (Apify LinkedIn/Indeed/WTTJ + TheirStack + FT) captent toutes le **même signal** (annonce d'emploi QA). Après dedup → 1 source distincte.
2. **Volume insuffisant** : 200 leads / 6 mois × 1-2 sources/lead = convergence rare statistiquement.
3. **Pas de signaux orthogonaux** : on n'a pas de capteur "INPI marque" + "Press régionale" + "DNS Sherlock" + "Founder Voice Radar" pour ajouter des dimensions différentes.

### Implication stratégique majeure

**La promesse commerciale Hunter 690€ "≥3 signaux convergents" NE PEUT PAS être tenue aujourd'hui.** Pour la rendre faisable il faut **d'abord construire les capteurs propriétaires orthogonaux** (Phase 4-5) AVANT de vendre cette promesse.

Alternatives à considérer :
- **A** : Adoucir la promesse → "≥2 signaux convergents" → recall 25% Pépites + précision 50% → marketing honnête mais moins percutant
- **B** : Reporter le lancement Hunter 690€ après Phase 4-5 (capteurs propriétaires en prod) → promesse tenable dans 4-6 mois
- **C** : Lancer Hunter dès Phase 3 avec seuil ≥2 + plan de migration vers ≥3 en mois 4-5 (honest)
- **D** : Repenser la métrique — au lieu de "≥3 signaux", utiliser une métrique combinée (score V2 ≥85 + persona tier 1 + contact full + age <30j)

→ **À trancher avec l'audit A.0.6 + interview Fred + décision pricing**.

---

## 🔍 Cas borderline (89 leads à valider humainement)

Top 30 borderline résumé dans la sortie du script. Patterns récurrents :

1. **Taille mal parsée** (~25 cas) : effectif "01", "03", "0 salarié" qui sont en fait du bruit Pappers (effectif vraiment 11+ mais source mal extraite). La regex de classification trop stricte les classe "size_too_small" alors qu'ils pourraient être Pépites.

2. **V2 ENRICH conf 58** (~12 cas) : leads que Brain V2 dit "à creuser, data incomplète" mais filtre downstream a poussé en IGNORED. **Watchlist manquante = gap produit critique** déjà identifié A.0.1.

3. **Données absentes** (~30 cas) : NAF unknown + V2 brief absent → impossible de juger automatiquement. Sont probablement des leads "demain" avec briefV2 non encore généré.

4. **NAF non whitelist mais industrie OK** (~22 cas) : NAF 70.22Z, 62.02A — borderline qui mériteraient revue humaine cas par cas.

→ Sur ces 89 borderline, Jojo pourrait probablement reclasser ~30-40 en Pépite/OK et ~50-60 confirmés en Hors/Junk. Effort : 1h30 ciblé.

---

## 🎯 Croisement signaux convertis ↔ outcomes

**Problème : pas d'outcomes trackés.**

A.0.1 a montré que sur 90j Fred n'a eu que 4 LeadActivity (3 EMAIL_SENT manual sur LYNX RH + 1 webhook auto sur Kestra) — donc impossible de mesurer "quels signaux ont converti".

→ Cette partie de A.0.2 prévue dans le cadrage n'est **pas réalisable** tant que Fred ne tracke pas ses actions ou que le pivot Data-Only ne sera pas instrumenté.

→ Décision : croisement outcomes ↔ tagging reporté Phase 5-6 (avec outcomes loop + interview Fred).

---

## 📋 Recommandations actionnables Phase 1+

### Quick wins immédiats (gain qualité sans construire)

1. **Ajouter watchlist 90j** pour V2 verdict = ENRICH conf 50-69 → ne pas IGNORE définitivement. **Effort : 1 jour.** Récupère ~12 leads borderline.

2. **Corriger le parse effectif Pappers** dans le scoring (regex trop stricte) → récupère ~25 cas size_too_small mal classifiés. **Effort : 0.5 jour.**

3. **Désactiver `apify.indeed-jobs` définitivement** (déjà 0 Pépite/25, déjà coupé depuis 03/05) + retirer du cron. Économie 30% volume bruit.

### Décisions stratégiques v3.0

4. **Réviser la promesse commerciale Hunter** : la "convergence triple" doit attendre Phase 4-5 (capteurs orthogonaux). Soit Hunter à ≥2 + migration ≥3, soit Hunter lancement reporté.

5. **Reconnaître que apify.wttj-jobs est la pépite source** mais latence 18j la sabote. Investiguer fréquence Apify WTTJ → si on capture plus fréquemment (1×/heure au lieu de 1×/jour), latence pourrait passer <24h.

6. **Documenter le paradoxe** : qualité 40% est meilleure que ce qu'on annonce (mémoire dit 7/15 hors-ICP = 47% mauvais). Donc on était corrects. Mais 60% à jeter reste élevé.

### Pour A.0.5 (interview Fred)

7. **Demander à Fred** : sur les 16 leads taggés 🟢 PÉPITE par cet audit, combien il aurait effectivement contacté avec enthousiasme ?
8. **Lui montrer les top 5** : ViaXoft, LegalPlace, OneStock, Sêmeia, WeWard, Dastra, SQUAREMIND — sa réaction ?
9. **Confronter le diagnostic "60% à jeter"** : est-ce qu'il avait cette impression aussi en regardant son dashboard ?

---

## ✅ Critère de sortie A.0.2 — partiellement atteint

- [x] Tagging automatique des 167 leads 6 mois
- [x] Distribution Pépite/OK/Hors/Junk mesurée
- [x] ROI par source mesuré
- [x] Backtest règle convergence triple effectué
- [ ] Croisement outcomes ↔ tagging (impossible — pas d'outcomes)
- [ ] Validation humaine 89 borderline (à faire si Jojo a 1h30 dispo)

→ Prochaines étapes : **A.0.5** (interview Fred + ICP affiné) + **A.0.6** (synthèse + GO/NO-GO 1)

---

## ⚠️ 5 découvertes critiques A.0.2

1. **Qualité réelle 40.7% exploitable** — meilleur que craint (60% jugement Fred) mais loin de "tous Pépite".

2. **🚨 RÈGLE CONVERGENCE TRIPLE INFAISABLE AUJOURD'HUI** — 0 lead aurait 3 sources orthogonales. La promesse v3.0 dépend strictement de la construction des capteurs propriétaires.

3. **apify.wttj-jobs = source #1 qualité (80%)** mais sabotée par latence 18j. Fix latence Phase 2 = quick win énorme.

4. **trigger-engine.* a moins de valeur que pensé** — A.0.1 disait 100% Trigger→Lead mais A.0.2 montre 22-25% utile au final. Le "Trigger→Lead" n'est pas synonyme de "Lead bon".

5. **89 cas borderline = potentiel sous-estimé** — beaucoup de leads ENRICH conf 58 sont des Pépites en attente, soufflées par filtre trop strict. Watchlist gap critique.
