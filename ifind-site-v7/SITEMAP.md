# iFIND v7 — Sitemap (Locked J4 16/05/2026)

> 7 sections max · Modèle Halo Coffee (Classroom 01 L4 Weblove) adapté iFIND.
> Anti-pattern : V6 avait 12+ sections → cluttered. On lock à 7.

---

## 1. HERO

**Goal** : Promesse claire en 5 secondes + preuve immédiate (data live).

**Layout** : Grid 2-col (1.15fr / 1fr). Texte gauche éditorial + data panel droite.

**Content** :
- **Eyebrow** (mono uppercase + dot pulse accent) : `Trigger Engine · Live FR`
- **H1** (Source Serif italic emphasis) : "La prospection ne se devine pas. *Elle se prouve.*"
- **Sub** (Inter ink-mute) : "9 sources publiques françaises natives détectent en temps réel les signaux d'achat datés des PME et ETI. Levées, hires Sales, dépôts INPI — chaque événement est vérifiable, attribuable, livré sous 24h."
- **CTA primary** : `Réserver une démo` (btn ink, hover→accent)
- **CTA secondary** : `Voir la méthode` (underline ink)
- **Data panel** (droite) : 4 triggers récents anonymisés avec scores hot/warm

**Techniques signature appliquées** :
- ✓ Split-text reveal sur H1 (mot par mot, italic accent pop sur "Elle se prouve")
- ✓ Live counter data overlay (déjà dans mockup C)

**Refs** : direction-c-hybrid.html (mockup live validé)

---

## 2. TRUST STRIP (Sources + Logos)

**Goal** : Crédibilité immédiate (avant qu'ils décrochent).

**Layout** : Grid 2-col (auto / 1fr) container-narrow, border-top + border-bottom.

**Content** :
- **Label** (eyebrow mono uppercase) : "Les 9 sources natives FR"
- **Sources list** (mono small avec dot accent) : INPI · Pappers · France Travail · RNE · Kaspr · TheirStack · FullEnrich · Rodz · Apify
- **(Optionnel J9-J11)** Logos clients existants en dessous (DTL Studio, Collective.Work, autres) — anonymisés ou pas selon accord

**Techniques signature appliquées** :
- Aucune (intentionnel — section sobre, on laisse le contenu parler)

---

## 3. MANIFESTE (Positioning vs intent data US)

**Goal** : Dire pourquoi on est différent en 1 phrase quotable.

**Layout** : Grid 2-col container-narrow. Label gauche (eyebrow) + quote droite (Source Serif large).

**Content** :
- **Label** : "Manifeste · § 01"
- **Quote** (Source Serif 22px italic emphasis) :
  > "Les outils américains scorent par *probabilité*. iFIND score par *événement*. Une levée annoncée hier. Un Head of Sales recruté la semaine dernière. Un dépôt INPI hier matin. Des faits publics, datés, attribuables au SIREN. Pas du peut-être. Du vérifiable."

**Techniques signature appliquées** :
- ✓ Split-text reveal sur quote (mot par mot, italic accent pop sur "probabilité" et "événement")

**Refs** : direction-c-hybrid.html section manifeste

---

## 4. COMMENT ÇA MARCHE (Pinned scroll cinematic — 3 étapes Trigger Engine)

**Goal** : Prouver la méthode visuellement. C'est LE moment cinéma du site.

**Layout** : Section pinned 180vh (scroll-pin scrub). Scène visuelle fixe à gauche, 3 étapes qui s'enchainent à droite au scroll.

**Content** — 3 étapes scrubées :

### Étape 01 — Détecter
- **Sous-titre** : "9 sources scannent 24h/24"
- **Visuel** : flow visuel (svg ou data live) qui montre les 9 sources qui pulsent en parallèle
- **Body** : "INPI, Pappers, France Travail, RNE… 9 sources publiques françaises natives. Sans intent data agrégée. Sans navigation web anonyme. Que des événements publics datés."

### Étape 02 — Attribuer
- **Sous-titre** : "SIRENE + 13 patterns + Opus 4.7"
- **Visuel** : flow matching SIREN → patterns → Pépite identifiée
- **Body** : "Chaque signal est attribué au bon SIREN via Pappers, croisé avec 13 patterns d'achat connus (Series A, hire Sales, M&A…), et qualifié par Claude Opus 4.7."

### Étape 03 — Personnaliser
- **Sous-titre** : "Brief Pépite + opener IA contextualisé"
- **Visuel** : flow Pépite → brief → email opener exemple
- **Body** : "Tu reçois 60 leads/mois dont 6 Pépites minimum garanties (sinon quota doublé). Chacune avec brief structuré + email opener prêt à envoyer."

**Indicateur visuel** : Stepper `01 / 02 / 03` qui s'illumine selon scroll progress.

**Techniques signature appliquées** :
- ✓ Pinned scroll cinematic (GSAP ScrollTrigger pin + scrub)
- ✓ Split-text reveal sur sous-titres + body au moment du switch

**Refs** : linear.app/method (le pattern source)

---

## 5. PREUVE (Case study + Pépites + Testimonials)

**Goal** : Montrer le résultat concret. La preuve par les chiffres.

**Layout** : Container max-width. Bloc case study large + grid 3-col testimonials.

**Content** :
- **Eyebrow** : "Preuve · § 02"
- **Headline** : "24K€ closé en 9 jours sur une levée détectée 2h après."
- **Case story** (Source Serif éditorial) :
  > "Société #421 a annoncé sa Series B de 18M€ le 12 mars 2026 à 14h. iFIND a détecté le trigger à 16h. Notre client a envoyé son opener IA personnalisé à 17h32, obtenu un call le 14, démo le 19. Deal closé 24K€ le 21 mars. **9 jours.**"
- **Metrics row** (3 chiffres mono large) : `9 sources` · `60 leads/mois` · `6+ Pépites garanties`
- **Testimonials** (3-col grid) :
  - DTL Studio (Fred — quote sur ROI mesurable)
  - Collective.Work (quote sur qualité Pépites)
  - [3ème client à recruter J5]

**Techniques signature appliquées** :
- ✓ Split-text reveal sur headline + case story
- Animation chiffres tabular-nums au viewport (count-up)

---

## 6. PRICING (iFIND Growth 390€/mo)

**Goal** : Transparence totale. 1 plan, pas de "Contact us".

**Layout** : Container-narrow. Card centrée large.

**Content** :
- **Eyebrow** : "Tarif · § 03"
- **Headline** (Source Serif) : "1 seul plan. *Pas de fluff.*"
- **Card pricing** :
  - **iFIND Growth** — `390 € / mois` (annuel)
  - **Inclus** : 60 leads qualifiés/mois · **6 Pépites minimum garanties** · Rollover crédits 4 mois · Setup gratuit · ICP custom inclus
  - **Garantie** : "Si moins de 6 Pépites un mois → ton quota est doublé le mois suivant"
  - **Overage** : 8€/lead supplémentaire
  - **CTA** : `Réserver une démo` (large btn ink)
- **Note légale petit** : DTL grandfathered 199€ jusqu'à fin contrat (mentionné discrètement ou en FAQ)

**Techniques signature appliquées** :
- Aucune motion forte (intentionnel — pricing = lisibilité avant tout)

---

## 7. FAQ + FINAL CTA

**Goal** : Lever les 5 dernières objections puis commit.

**Layout** : Container-narrow. Accordion FAQ + final CTA grande section.

**Content FAQ** (5 questions Q-A accordion) :
1. **"Qu'est-ce qu'une Pépite exactement ?"** → Définition signal multi-source HOT
2. **"En quoi vous différenciez d'Apollo / Cognism / ZoomInfo ?"** → Score par événement vs probabilité
3. **"Conforme RGPD ?"** → 100% sources publiques, attribution SIREN, pas de scraping privé
4. **"Combien de temps pour le setup ?"** → 48-72h ICP custom + 1ʳᵉ Pépite J3
5. **"Engagement / annulation ?"** → Annuel, préavis 30j, pas de surprise

**Final CTA** (large section) :
- **Headline** (Source Serif large) : "Prêt à voir une Pépite qui vous correspond ?"
- **Sub** : "On vous montre 3 Pépites alignées à votre ICP dans la démo. 30 min. Pas de pitch."
- **CTA** large : `Réserver une démo` (btn ink huge)
- **Footer note** (mono small) : "Démo livrée par Alexis Bénier · CEO iFIND"

**Techniques signature appliquées** :
- ✓ Split-text reveal sur headline final

---

## Footer (transverse, pas une section content)

- Logo + tagline ("Trigger Engine pour PME françaises")
- Nav : Produit · Méthode · Tarifs · Journal · Contact
- Légal : Mentions · CGV · Confidentialité · Cookies
- Réseaux : LinkedIn · Twitter
- © 2026 iFIND · Made in France

---

## Techniques signature LOCKED (2-3 max — Classroom 01 L5)

| # | Technique | Où | Lib | Effort estimé J9-J10 |
|---|-----------|-----|-----|---------------------|
| 1 | **Split-text reveals** | H1, H2, manifeste quote, headlines preuve + final | GSAP + SplitText | 2-3h |
| 2 | **Pinned scroll cinematic** | Section 4 "Comment ça marche" 3 étapes | GSAP + ScrollTrigger pin | 4-5h |
| 3 | **Live counter data hero** | Hero data panel (déjà mockup C) | Vanilla JS + setInterval | 1-2h |

**Total estimé** : ~7-10h sur 2 jours (J9 hero/3D, J10 UI motion).

**Ce qu'on N'AJOUTE PAS** (cut volontaire pour pas surcharger) :
- ❌ Custom cursor (trend déclining 2024)
- ❌ Magnetic CTAs (gimmick possible)
- ❌ Page transitions élaborées (Astro view-transitions suffit par défaut)
- ❌ WebGL hero (1 hero scene max — apprentissage 14/05)
- ❌ Audio-reactive (overkill pour B2B FR)
- ❌ Image sequence canvas (pas alignée avec brief)

---

## Validation J4 ✅

- [x] 7 sections max (vs 12+ V6)
- [x] Chaque section a un Goal explicite
- [x] Hierarchy 5-levels par section (anchor / support / context / meta / background)
- [x] 2-3 techniques signature lockées (3 = bon compte)
- [x] Anti-patterns documentés (ce qu'on ne fait PAS)
- [x] Réf mockup live pour rappel direction

**Phase 4 J4 LOCKED. Passage Phase 5 (Copy & Brand Voice).**
