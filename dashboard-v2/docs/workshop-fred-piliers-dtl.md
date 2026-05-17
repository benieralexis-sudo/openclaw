# Workshop Fred — Validation des 3 piliers DTL

**Date proposée** : à caler · **Durée** : 30 min · **Format** : appel téléphonique ou visio

---

## Pourquoi ce workshop ?

iFIND a basculé son architecture sur un **Catalogue Universel Paramétrable** le 16/05/2026. Chaque client doit désormais désigner **3 piliers** parmi 5 signaux universels, qui définissent ce qui devient un "lead chaud" pour lui :

- **P1** : Hire role X (la boîte recrute le métier qu'on cible)
- **P2** : Team sans rôle X (la boîte a une équipe mais pas le rôle = douleur cachée)
- **P3** : Stack tech contient outil X (la boîte utilise tel ou tel outil)
- **P4** : AI tool adoption (la boîte adopte des outils IA — corrélation +46% conversion B2B)
- **P5** : Effectif +X% en 90 jours (croissance rapide — corrélation +38%)

**Question business** : ces 3 piliers définissent ta stratégie de chasse. Si on se trompe, tu rates des Pépites ou tu reçois du bruit.

---

## Config DTL actuelle (par défaut)

| Pilier | Implémentation | Réalité |
|---|---|---|
| ⭐ **P1 Hire QA** | ✅ ACTIVÉ — keywords : QA Engineer, Test Engineer, SDET, Tester, Automation, Validation Engineer (24 variants). **Patché 17/05** : + codes ROME M1805+M1802+M1803 (Pôle Emploi) + filtre titre incl QA/Test/Quality/SDET, excl junior/stagiaire | Très large filet, on capte tout hire QA |
| ⭐ **P2 Team sans QA** | ✅ ACTIVÉ — détecte boîtes >10 personnes sans aucun rôle QA Engineer / Test Engineer / SDET / Quality Engineer dans LinkedIn | Douleur cachée : "vous avez 20 devs, 0 QA → vous testez en prod" |
| ⭐ **B1 Levée Series A/B/C** | ✅ ACTIVÉ comme booster | Le hire QA + une levée récente = HOT |
| ⚠️ P3 Stack tech | ❌ DÉSACTIVÉ (0 Pépite en 60j, économie TheirStack) | À réactiver si stratégie tools-fit |
| ⚠️ P4 AI tool adoption | ✅ ACTIVÉ (booster background) | Pas pilier — pas priorité QA |
| ⚠️ P5 Effectif +X%/90j | ✅ ACTIVÉ (booster background) | Pas pilier |

---

## 5 questions pour toi, Fred

### Q1 — Tes 3 piliers t'imitent bien ta vraie chasse ?
P1 (hire QA) + P2 (team sans QA) + B1 (levée) c'est ce que je devine de tes meilleurs deals 2025. **Vrai ?**
- Si NON : quels signaux te font dire "oh là, je veux celle-là" ?
- Si OUI : super, on garde.

### Q2 — P4 (AI tool adoption) en booster suffit, ou tu veux en pilier ?
Statistiquement c'est le signal #1 le plus prédictif (+46% conversion). Une boîte qui adopte ChatGPT/Cursor/Copilot **a probablement besoin de testing automatisé renforcé**. Hypothèse : si une boîte annonce "on adopte Cursor pour 50 devs", c'est un signal QA fort.
- Tu en penses quoi ? Le mettre pilier (à la place de B1 ou P2) ?
- Ou laisser en booster background ?

### Q3 — P3 (stack tech) — désactivé, on rate quoi ?
On l'a coupé car 0 Pépite en 60j. Mais on pourrait le faire bien : cibler les boîtes avec Jenkins/Selenium/Postman/Cypress = équipes QA déjà actives = budget tools = mature pour upsell.
- **Y a-t-il des stacks tech qui te font dire "ils ont besoin de moi" ?**
- Si oui on le reconfigure proprement et on le réactive.

### Q4 — Tes red flags (NON automatique)
Aujourd'hui le brain rejette : ESN, holding patrimoniale, hôtel/restauration, stage/alternance, freelance, < 10 personnes, hors France. **Y a-t-il d'autres patterns qui te font dire "jamais" en regardant un lead ?**

### Q5 — Tes "sweet spot" idéaux (3-5 critères de la boîte parfaite)
Pour calibrer le brain, j'ai besoin de ton profil idéal en 3-5 phrases. Ex :
- "SaaS B2B 30-100 personnes en France"
- "Avec une équipe dev mais pas encore d'équipe QA dédiée"
- "Qui vient de lever ou de hire des seniors"
- "Avec un CTO accessible (pas une grosse boîte avec 5 niveaux hiérarchiques)"

---

## Plan post-workshop

1. **Update DB** : on patche ta config catalogue selon tes réponses (~10 min de moi)
2. **Run 7 jours** : on lance le système avec ta nouvelle config
3. **Review** : on regarde ensemble les leads générés + tes 👍/👎, on ajuste

---

## Annexe — Performance derrière (chiffres bruts 30 jours)

| Métrique DTL | Valeur |
|---|---|
| Triggers ingérés / 30j | 338 |
| Triggers qualifiés Opus | 104 |
| Verdict OUI | 29 (28%) |
| Verdict ENRICH | 16 (15%) |
| Verdict NON | 59 (57%) |
| Sources actives | bodacc (capital + merger), apify linkedin-jobs, rodz, francetravail, RSS-levees |

À comparer avec ce qui s'est concrétisé dans ton Pipedrive.

---

## À préparer côté Fred

- Liste de tes **3 meilleurs deals 2025** : comment tu les as trouvés ? Quel signal t'avais-tu vu en premier ?
- Liste de tes **2-3 pires faux positifs** récents (leads iFIND qui t'ont fait perdre du temps) — pour renforcer les anti-personas
- 5 minutes pour relire ce doc avant l'appel
