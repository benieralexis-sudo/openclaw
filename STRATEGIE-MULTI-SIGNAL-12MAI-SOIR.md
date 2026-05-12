# Stratégie iFIND — Multi-Signal Convergence (v1)

**Date** : 12/05/2026 (soir)
**Auteur** : Alexis + Claude
**Remplace** : `project-sovereign-sensor-network.md` (12/05 matin, 1028 lignes, trop théorique)
**Statut** : DRAFT — à valider par Alexis avant exécution

---

## 1. Principe directeur (3 lignes)

> **N capteurs, chacun cherchant un angle DIFFÉRENT.**
> **Quand 2+ angles convergent sur la même boîte = signal d'achat réel.**
> **Volume × Convergence = qualité par construction.**

Pas plus compliqué que ça.

---

## 1.bis Principe #0 fondateur — Multi-tenant by design

> **Code des capteurs = commun à tous les clients.**
> **Règles métier = stockées par client dans `Client.icp`.**
> **Onboarder un nouveau client = remplir un JSON, pas modifier le code.**

### Concrètement

Chaque capteur lit ses paramètres depuis `Client.icp.<captorName>` au runtime. Aucun code hardcodé "QA" ou "Fred" — tout est paramétrable.

Exemple — même capteur Team-Gap-Detector, 3 clients différents :

```json
// Client DTL (testing/QA)
"teamGapDetection": {
  "missingRoles": ["QA", "Test Engineer", "SDET"],
  "minDevTeamSize": 3
}

// Client cyber hypothétique
"teamGapDetection": {
  "missingRoles": ["CISO", "Security Engineer", "SOC Analyst"],
  "minITTeamSize": 10
}

// Client RH SaaS hypothétique
"teamGapDetection": {
  "missingRoles": ["Head of People", "HR Business Partner"],
  "minTeamSize": 20
}
```

→ Même code Java/Node tourne, 3 résultats complètement différents par client.

### Champs à ajouter à `Client.icp` pour chaque nouveau capteur

| Capteur | Champ icp |
|---------|-----------|
| Team-Gap-Detector | `teamGapDetection: { missingRoles, minDevTeamSize }` |
| INPI Marques/Brevets | `inpiMarques: { enabled, relevantClasses }` |
| BPI/France 2030 | `bpi: { relevantSectors, minGrantAmount }` |
| GitHub Velocity | `githubVelocity: { enabled, minStars, minContributors }` |
| BOAMP | `boamp: { enabled, relevantCategories }` |
| Wappalyzer Diff | `wappalyzer: { trackedTech, ignoreStable }` |
| DNS Sherlock | `dnsSherlock: { keywords }` |
| Press Régionale | `pressRegionale: { keywords }` |
| Founder Voice | `founderVoice: { keywords }` |

### Garde-fous architecture

- ❌ **JAMAIS** : `if (client === 'DTL')` ou `companyName.includes('Capgemini')` hardcodé dans le code capteur
- ✅ **TOUJOURS** : `if (client.icp.teamGapDetection?.missingRoles.includes(role))`
- ❌ **JAMAIS** : un capteur qui ne tourne pas pour un nouveau client par défaut
- ✅ **TOUJOURS** : un capteur skip proprement si `client.icp.<captor>.enabled === false` ou champ absent
- ❌ **JAMAIS** : un capteur qui crée des Triggers d'angle hardcodé "QA"
- ✅ **TOUJOURS** : sourceCode du Trigger reflète l'angle générique (`team-gap.<role>` où `<role>` vient de l'icp)

### Bénéfice business

- **Onboarder client #2** : 30 min de config JSON vs 1 semaine de re-développement
- **Réutiliser 100% du dev iFIND** sur tous les clients suivants
- **Moat défendable** : Apollo/Pharow font 1 produit fixe → iFIND adapte le produit à chaque client

---

## 2. État actuel — Photo honnête (12/05)

### Combo actuel : **16.7%** des leads pool DTL (5/30)

Le système combo est **déjà codé** depuis le 01/05 :
- `priorityScore` += 15 si 2 sources convergent (fenêtre 14j)
- `priorityScore` += 30 si 3+ sources convergent
- Champ `isCombo` sur chaque Trigger

**Mais 94% des sociétés DTL ont 1 seul trigger** (audit code, ligne `priority-scoring.ts:14`).

### Pourquoi ?

Tous les 9 capteurs actuels cherchent **le même angle** :

| Capteur actuel | Angle | Type signal |
|----------------|-------|-------------|
| Apify WTTJ | hire QA | Recrutement |
| Apify LinkedIn-jobs | hire QA | Recrutement |
| Apify declarative-pain | hire QA | Recrutement |
| Rodz | hire QA / fundraising | Recrutement + Levée |
| TheirStack job-offer | hire QA | Recrutement |
| TheirStack buying-intent | hire QA tools | Achat outil |
| France Travail | hire QA | Recrutement |
| INPI dépôts (existant) | activité corporate | Légal |
| BODACC/JOAFE | défaillance | Légal négatif |

→ 7/9 capteurs sur la **même odeur** (hiring QA). Pas étonnant que les combos soient rares.

### Conséquence business

- **Volume** : OK (28-30 leads actionable / pool DTL)
- **Qualité** : moyenne. Beaucoup de "boîtes qui hire QA déjà" = Fred trouve hors-ICP
- **Moat** : faible. Apollo/Pharow font la même chose

---

## 3. La cible — 9 capteurs sur 9 angles différents

| Capteur | Angle détecté | Source | Cost | Effort | Priorité |
|---------|---------------|--------|------|--------|----------|
| 🥇 **INPI Marques/Brevets** | "Cette boîte dépose marque/brevet" = elle investit en IP, scale | INPI Open Data (gratuit) | 0€ | 2j | **CRITIQUE** |
| 🥇 **BPI / France 2030** | "Cette boîte gagne une subvention" = scale-up validée par BPI | BPI website + France 2030 annonces | 0€ | 2j | **CRITIQUE** |
| 🥈 **GitHub Velocity** | "Le GitHub org de cette boîte explose" = équipe tech active | GitHub Public API | 0€ | 3j | **HAUTE** |
| 🥈 **Team-Gap-Detector** | "Équipe 100% devs sans QA/CISO/etc." = signal #1 DTL | HarvestAPI (LinkedIn) | 30€/mo | 6j | **HAUTE** (le moat DTL) |
| 🥉 **BOAMP** | "Cette boîte répond à un appel d'offre public" = phase commerciale | BOAMP Open Data | 0€ | 2j | **MOYENNE** |
| 🥉 **Wappalyzer Diff** | "Cette boîte change de stack tech" = migration en cours | Wappalyzer API | 40€/mo | 3j | **MOYENNE** |
| **DNS Sherlock** | "Cette boîte achète un domaine techy" = projet nouveau | Certificate Transparency Logs | 10€/mo | 4j | **MOYENNE** |
| **Press Régionale** | "Médias régionaux parlent d'eux" = momentum local | Google CSE étendu | 20€/mo | 5j | **BASSE** |
| **Founder Voice Radar** | "Founder parle sur LinkedIn/podcasts" = boîte visible | HarvestAPI + scraping | 20€/mo | 5j | **BASSE** |

**Total effort dev** : ~32 jours (8 semaines à 4j/semaine soutenables)
**Coût mensuel max** : +120€/mo (vs 0€ aujourd'hui pour ces capteurs)
**Coût initial scan** : ~80€ (seed Team-Gap-Detector sur 500 SIRETs DTL)

---

## 4. Pourquoi ce mix d'angles génère du combo réel

Exemples concrets de **vrais combos** que ce mix détectera :

### Pépite type "scale-up tech post-levée"
- 🥇 BPI : "Vient de gagner 500K€ France 2030"
- 🥈 GitHub Velocity : "+5 contributors en 3 mois"
- 🥈 Team-Gap-Detector : "0 QA dans l'équipe"
- → **3 angles convergents = 🔥 HOT garanti**

### Pépite type "boîte qui change de phase"
- 🥇 INPI : "Vient de déposer une marque"
- 🥉 Wappalyzer : "Vient de migrer Node → Rust"
- 🥉 BOAMP : "A répondu à un appel d'offre public"
- → **3 angles convergents = 🔥 HOT garanti**

### Lead mono-angle (situation actuelle pour 84% du pool)
- Apify WTTJ : "Hire QA"
- → **1 angle seul = WARM/borderline** (peut-être trop tard, peut-être ESN)

→ La force de la convergence **rend le score COMPOSITE intelligent automatiquement**.

---

## 5. Roadmap 8 semaines (priorité business)

| Semaine | Capteur(s) | Livrable | Combo attendu |
|---------|-----------|----------|---------------|
| **S1** | INPI Marques/Brevets | Capteur live, scan rétroactif 90j DTL | 16.7% → ~22% |
| **S2** | BPI / France 2030 | Capteur live, scan rétroactif 90j DTL | ~22% → ~28% |
| **S3** | GitHub Velocity | Capteur live | ~28% → ~33% |
| **S4-5** | Team-Gap-Detector (DTL signal #1) | Capteur live, scan 500 SIRETs DTL | ~33% → ~42% |
| **S6** | BOAMP | Capteur live | ~42% → ~45% |
| **S7** | Wappalyzer Diff | Capteur live | ~45% → ~48% |
| **S8** | DNS Sherlock + ajustements scoring | Capteur live, retune `multiSourceBoost` | ~48% → 50%+ |

**Stretch (si temps reste)** :
- Press Régionale (5j)
- Founder Voice Radar (5j)

**Critère de succès final** : **≥ 50% du pool DTL en combo** (vs 16.7% aujourd'hui).
→ Ça veut dire 1 lead sur 2 a au moins 2 angles convergents. **Qualité ×3 sans toucher au volume.**

---

## 6. Coût total — Avant / Pendant / Après

### Aujourd'hui (12/05)
- 9 capteurs actifs
- Coût récurrent : ~$370-450/mo (per MEMORY)
- Combo rate : 16.7%

### Pendant la construction (S1 → S8)
- Coût récurrent : +20€ en S4 (Team-Gap-Detector HarvestAPI live)
- Coût récurrent : +40€ en S7 (Wappalyzer live)
- Coût initial S4 : 80€ scan rétroactif DTL Team-Gap

### Après (S8+)
- 9 capteurs sur 9 angles différents
- Coût récurrent ajouté : **+120€/mo max** (donc total ~$490-570/mo)
- Combo rate : 50%+
- **Coût par lead qualifié** : devrait BAISSER (plus de combos = plus de Pépites = ROI/lead meilleur)

---

## 7. Critères de validation (par capteur, avant merge)

Pour CHAQUE capteur, avant de mettre en prod :

1. **Tests vitest** verts avec ≥10 cas réels prod
2. **Backtest** sur 90j historiques DTL : combien de Pépites Fred aurait détectées ?
3. **Faux positifs** : <10% de leads taggés combo qui sont en fait hors-ICP
4. **Anti-collision** : aucun capteur ne re-crée des Triggers déjà capturés par les 9 existants (dédup HIRING_KEY étendu si besoin)
5. **Cost tracking** : `cost-report` enrichi avec stats du nouveau capteur
6. **Observabilité Auditor** : Auditor V0.2 prompt mis à jour pour vérifier que le capteur tourne (run par jour, erreurs <5%)

---

## 8. Gouvernance — Décisions ouvertes

À trancher AVEC ALEXIS avant exécution S1 :

### Q1 — Ordre des 2 premiers capteurs ?
- Option A : INPI puis BPI (mon recommandé : INPI plus rapide à coder)
- Option B : BPI puis INPI (BPI signal plus fort business)
- Option C : Les 2 en parallèle si tu es chaud

### Q2 — Capteurs payants : on attend client #2 pour les financer ?
- Wappalyzer 40€/mo + Press Régionale 20€/mo + Founder Voice 20€/mo = 80€/mo
- Si on les coupe → +40€/mo seulement (juste Team-Gap-Detector HarvestAPI)
- → Option pragmatique : démarrer S1-S5 gratuit, payer S6-S7 à la signature client #2

### Q3 — Le Team-Gap-Detector reste-t-il en S4-5 (le moat DTL) ou on le décale ?
- Pour : c'est ton vrai moat business, prioritaire
- Contre : il prend 2 semaines complètes, plus complexe que les autres
- → Recommandé : garder S4-5 comme planifié

### Q4 — Quel client cible ?
- DTL est notre seul client payant aujourd'hui
- Les 8 capteurs propriétaires construits sont génériques (réutilisables pour client #2)
- Le Team-Gap-Detector est paramétré via `Client.icp.teamGapDetection` (déjà multi-tenant by design)

---

## 9. Ce qui reste valide du doc du matin (à conserver mentalement)

- ✅ **Outcomes Loop** : Fred clique → bot apprend (à brancher en parallèle, hors scope ce doc)
- ✅ **Watchlist 90j** : leads borderline ENRICH ne se perdent pas (existe déjà partiellement)
- ✅ **Co-existence transitoire outils payants** : on ne casse rien tant que la nouvelle archi n'est pas mature

Ce qui est obsolète :
- ❌ Le scoring composite 0-120 sur 6 dimensions (trop complexe — le `priorityScore` existant + `multiSourceBoost` suffit)
- ❌ Les seuils HOT≥80/WARM≥65/WATCHLIST≥50 (on garde `isHot` actuel basé sur score≥9)
- ❌ Le plan 21 semaines (trop long — 8 semaines est réaliste)

---

## 10. Next step après validation

Si Alexis valide ce doc → **commencer S1 immédiatement** :
1. Sprint INPI Marques/Brevets en module pur testé
2. Scan rétroactif 90j DTL pour mesurer le bump combo
3. Validation Fred sur les nouvelles Pépites trouvées
4. → S2 (BPI)

---

**Fin du doc.** Tight, opérationnel, ~200 lignes (vs 1028 du matin).
