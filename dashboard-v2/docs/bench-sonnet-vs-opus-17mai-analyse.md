# Bench Sonnet 4.6 vs Opus 4.7 — Qualify V2 (17/05/2026)

**Date** : 17/05/2026 16:34 UTC · **Sample** : 50 triggers (17 OUI + 17 NON + 17 ENRICH baselines)
**Coût bench** : $8.11 (Opus $6.90 + Sonnet $1.21)
**Output brut** : `bench-sonnet-vs-opus-17mai-result.json`

---

## TL;DR — Verdict : **GARDER OPUS pour le qualify cerveau V2**

| Critère | Valeur | Seuil GO Sonnet | Verdict |
|---|---|---|---|
| Concordance verdict global | **84.8%** (39/46) | ≥85% | 🟡 borderline |
| Faux positifs critiques | **1** (2.2%) | 0 | 🟡 tolérable |
| Faux négatifs | **3** (6.5%) | ≤5% | 🔴 hors seuil |
| Erreurs parse Sonnet | **4/50 (8%)** | <2% | 🔴 hors seuil |
| Économie projetée | **-82%** ≈ $450/mo | ≥$400 | 🟢 OK |
| Latence moy. | Sonnet **+14%** | ≤Opus | 🟡 contre-intuitif |

**Concordance effective** si on compte les 4 ERR Sonnet comme FN = **78%** → insuffisant.

---

## Pourquoi pas le swap maintenant

1. **3 faux négatifs réels** = 3 Pépites/mois manquées pour DTL (~10% du flux)
   - Bioptimus (baseline OUI, Opus OUI, Sonnet NON)
   - Sêmeia (baseline OUI, Opus OUI, Sonnet NON)
   - Stormshield (baseline OUI, Opus OUI, Sonnet NON)
2. **8% d'erreurs parse Sonnet** (Zod fail / JSON KO) :
   - COSIKA, Decade Energy, Bigblue, X6 INNOVATIONS
3. **1 faux positif** (Shizen, Sonnet OUI vs Opus NON) → risque spam Fred même limité
4. **L'économie ($450/mo) ne vaut pas le risque** sur la promesse "6 Pépites/mois garanties"

---

## Pourquoi Sonnet a échoué cette fois

Hypothèses à confirmer avec analyse fine du JSON :

- **Prompt trop dense pour Sonnet** : V2 SPECIFIC ~3000 tokens + dossier riche → Sonnet capacité de raisonnement moins large saturée
- **Modèle Sonnet plus conservateur** sur les OUI (penche NON par défaut quand zone grise) → explique les 3 FN
- **Format JSON strict + LeadBriefV2Schema rigoureux** : Sonnet écrit parfois en markdown ou ajoute des préambules → parse KO
- **Latence +14%** suspecte : peut-être que Sonnet refait des passes internes face à la complexité

---

## Alternatives à considérer (pas maintenant)

### Option A — Mode hybride (Sonnet + fallback Opus)
- **Logique** : Sonnet par défaut ; si confidence Sonnet < 70% OR parse fail → re-run Opus
- **Économie attendue** : ~60-70% (vs 82% Sonnet pur)
- **Qualité** : équivalente Opus (Opus rattrape les cas dépassés Sonnet)
- **Dev** : ~2h + tests + monitoring 1 semaine
- **Risque** : faible si la détection "Sonnet pas sûr" est robuste

### Option B — Iterer le prompt pour Sonnet
- Simplifier V2 SPECIFIC (focus sur l'essentiel)
- Ajouter exemples explicites de format JSON attendu
- Réduire le dossier en mode Sonnet (filtrer les sections moins critiques)
- Re-bench dans 2-4 semaines
- **Dev** : 1-2 sprints prompt eng

### Option C — Garder Opus tel quel (recommandé court terme)
- Statu quo $22/jour → $660/mo
- Pas de risque
- Continuer à monitorer cost (catalogue limite déjà via hardCap)
- Re-évaluer dans 1-2 mois après Sonnet 4.7 ou v5

---

## Bug technique détecté pendant le bench

`Δscore=?` sur 50/50 résultats + `scoreDiffMean: "?"` dans le rapport JSON.

**Cause probable** : le script bench extrait `verdict` et `score` du parsed `LeadBriefV2`, mais `LeadBriefV2.score` n'existe pas — c'est `confidence` qu'il faut prendre.

**Fix** (1 ligne dans `scripts/bench-sonnet-vs-opus.ts`) :
```diff
-validated = { verdict: v.brief.verdict, score: v.brief.score };
+validated = { verdict: v.brief.verdict, score: v.brief.confidence };
```

---

## 4 cas faux négatifs/positifs à étudier en post-mortem

| Cas | Verdict baseline | Opus 17/05 | Sonnet 17/05 | Hypothèse |
|---|---|---|---|---|
| **Shizen** (FP) | ENRICH | NON | OUI | Sonnet trop optimiste sur signaux faibles |
| **Bioptimus** (FN) | OUI | OUI | NON | Sonnet rate signaux deep tech / biotech ? |
| **Sêmeia** (FN) | OUI | OUI | NON | Sonnet rate santé numérique / éditeur SaaS petit ? |
| **Stormshield** (FN) | OUI | OUI | NON | Sonnet rate cybersécurité / NAF border ? |

À utiliser comme **dataset de calibration** si on tente Option B (re-iterate prompt).

---

## Action immédiate

- ❌ Ne pas changer `QUALIFY_MODEL` dans `src/lib/anthropic.ts:49` (reste `claude-opus-4-7`)
- ✅ Continuer à monitorer coût Anthropic via cost-report
- ✅ Bug Δscore noté pour fix prochain bench
- ⚠️ Si pression économique : prioriser Option A (hybride) sur 1 sprint dédié
