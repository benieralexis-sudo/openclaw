# iFIND v7 — Launch Plan (Phase 13 J14)

> Préparé J13 16/05/2026. Actions techniques + actions Alexis.

---

## ✅ Préparé côté code (terminé)

- Site v7 LIVE staging : https://ifind.fr/design/v7/
- 7 sections + Nav + Footer + 404 page
- 3 techniques signature actives (split-text + pinned scroll + live counter)
- Design system locked (Source Serif + Inter + JetBrains Mono + ivoire + ink + orange brûlé)
- SEO + AEO complet : robots.txt + sitemap.xml + llms.txt + schema JSON-LD
- Performance : bundle 51kB gzip, font-display swap, scrollbar custom
- Polish : 404 designé, smart quotes, em-dashes, tabular nums, focus rings
- Mémoire mise à jour pour les futures sessions Claude

---

## 🔴 Actions Alexis avant ship (J14 estimé 2-4h)

### 1. Lighthouse audit (15 min)
- Ouvrir Chrome DevTools sur https://ifind.fr/design/v7/
- Lighthouse → Generate report (Mobile + Desktop)
- Vérifier cibles : Performance ≥ 90 desktop / ≥ 80 mobile, LCP < 2.5s, CLS < 0.1, INP < 200ms
- Si fail : me dire ce qui pèche, on optimise ensemble

### 2. Tests visuels 5 navigateurs (30 min)
- Chrome (desktop) — déjà OK probablement
- Safari (desktop Mac) — vérifier que backdrop-blur marche
- Firefox (desktop) — vérifier que SVG illustrations rendent
- Mobile Safari iPhone — vérifier que pinned scroll fallback (stack vertical) fonctionne bien
- Chrome Android — pareil

Si bug navigateur, screenshot + me l'envoyer.

### 3. Test fresh incognito (5 min)
- Fenêtre incognito → https://ifind.fr/design/v7/
- Vérifier que tout charge sans cache
- Tester les CTAs (Réserver une démo)
- Tester la FAQ accordion

### 4. Test "3 friends" (la règle Classroom 06 L5)
- Envoyer le lien à 3 amis (Sales Ops, fondateur, copywriter)
- Question : "Qu'est-ce qui te paraît bizarre ?"
- Récupérer feedback, fixer les 2-3 issues majeures

---

## 🟡 Production switch DNS (action critique)

Actuellement :
- ifind.fr = site v6 (servi depuis /opt/moltbot/public/v6/)
- ifind.fr/design/v7/ = site v7 staging

Pour ship en prod :
- Soit on **swap intégral** : v7 devient ifind.fr root, v6 archivé
- Soit on **A/B test** : v7 sur ifind.fr et v6 sur old.ifind.fr quelques semaines

Reco senior : **swap intégral** une fois Lighthouse + 5 navigateurs OK. Pas de A/B.

Côté technique :
- Le script `bash /opt/moltbot/ifind-site-v7/deploy.sh` push actuellement vers /design/v7/
- Il faudra un nouveau script `ship-prod.sh` qui :
  1. Backup v6 actuel dans /opt/moltbot/public/v6-archive-$(date)/
  2. Copy dist/ vers /opt/moltbot/public/ (racine ifind.fr)
  3. Conserve /design/v7/ comme miroir staging
- À écrire le jour du ship (j'ai besoin de ton GO).

---

## 🟢 Submit Awwwards / Godly / Land-book

### Awwwards ($35 self-submit)
- URL : https://www.awwwards.com/submit
- Title : "iFIND — Trigger Engine for French B2B SMEs"
- Tagline (description courte) : "9 native French public sources detect real-time buying signals on B2B SMEs. The first sales intelligence that scores by event, not probability."
- Tags : SaaS, B2B, Sales, Data, Lead Generation, France, Editorial
- Voting timeline : 7-14 jours
- Prix : $35 (vaut le coup pour le label "Site of the Day" si gagné)

### Godly (gratuit)
- URL : https://godly.website/submit
- Pas de fee, curation manuelle
- Délai : variable (1-30 jours)

### Land-book (gratuit)
- URL : https://land-book.com/submit
- Curated, free
- Délai : 1-7 jours

### Httpster (gratuit)
- URL : https://www.httpster.net/submit
- Indie focus, free
- Délai : 1-3 jours

### Aussi (free) :
- siteinspire.com
- onepagelove.com (si on simplifie en one-pager)
- bestwebsite.gallery
- minimal.gallery

---

## 📣 Thread X / LinkedIn boss battle (Classroom 06 L6 + 10)

**Format viral** : 10 tweets / 10 posts LinkedIn avec before/after.

### Tweet 1 (hook)
> J'ai refait le site iFIND de zéro en 14 jours.
>
> Méthode : la formation Weblove Academy ($1k bien dépensés).
>
> Direction "Éditorial · Vérifiable · Vivant".
>
> Voici ce que j'ai changé et pourquoi 🧵

(+ screenshot side-by-side v6 vs v7)

### Tweet 2 — Le pourquoi
> Le v6 était à 86/100 sur l'audit design.
>
> Ambition Awwwards SOTD = 96-98/100.
>
> 12 patches identifiés.
>
> Au lieu de fixer, j'ai tout reset. Méthodologie Weblove > sprint debug.

### Tweet 3 — La direction
> Direction visuelle : Hybride Mercury × Clay.
>
> Socle éditorial premium (mercury.com) + hero data-protagonist (clay.com) + accent orange brûlé (#C2410C).
>
> Validé sur mockup HTML live AVANT 1 ligne de code production.

(+ screenshot du comparateur direction)

### Tweet 4 — Le brief 4¶
> Brief Halo Coffee model :
> - WHO : Sales Ops PME FR
> - WHAT : Trigger Engine 9 sources publiques
> - WHY : score par événement, pas probabilité
> - FEEL : Éditorial · Vérifiable · Vivant
>
> 4 paragraphes. Lock. On n'y revient plus.

### Tweet 5 — Le design system
> 3 fonts max : Source Serif 4 (display) + Inter (body) + JetBrains Mono (data).
> 7 couleurs HSL.
> 12-col grid + 8-pt spacing.
> 3 easings × 4 durations.
>
> Locked dans tokens.css. Source de vérité unique.

(+ screenshot du tokens.css)

### Tweet 6 — Le hero
> Hero = grid 2-col :
> - Gauche : headline éditorial italique
> - Droite : data panel live avec 4 triggers réels qui pulsent
>
> "La donnée est le héros." Clay-school.

(+ screenshot hero)

### Tweet 7 — Le moment cinéma
> Section "Comment ça marche" en pinned scroll cinematic.
>
> Tu scrolles → 3 étapes scrubées : Détecter / Attribuer / Personnaliser.
>
> SVG illustrations custom. Stepper indicateur 01/02/03 qui s'illumine.
>
> GSAP ScrollTrigger pin.

(+ GIF du pinned scroll)

### Tweet 8 — Performance & a11y
> Bundle JS : 51 kB gzip.
> Lighthouse 90+/80+ desktop/mobile.
> LCP < 2.5s, CLS < 0.1.
> prefers-reduced-motion respecté.
> 404 designée. Custom scrollbar. Smart quotes. Tabular nums.

### Tweet 9 — AEO 2026
> Pas juste SEO. **AEO** (Answer Engine Optimization).
>
> robots.txt allow GPTBot, ClaudeBot, PerplexityBot.
> llms.txt structuré markdown.
> Schema.org JSON-LD (Organization + Product + FAQPage).
>
> 2026 = 30% des buyer journeys finissent dans un LLM.

### Tweet 10 — CTA
> Live : https://ifind.fr/design/v7/
>
> Stack : Astro 5 + GSAP + Lenis + Source Serif 4 + Inter.
>
> Méthodologie : Weblove Academy.
>
> Je prends 2-3 projets sites premium par mois. DM ouverts.

---

## ⏰ Timing Phase 13 idéal

- **J14 matin (3h)** : Lighthouse audit + 5 navigateurs + 3 friends test + fix issues
- **J14 13h** : Submit Awwwards + Godly + Land-book + Httpster
- **J14 14h** : DNS swap v6 → v7 (le moment de vérité)
- **J14 15h** : Post thread X
- **J14 17h** : Post LinkedIn (différé pour amplifier)
- **J14 soir** : Monitor Plausible / Sentry / mentions / commentaires

---

## 🔄 Post-launch (Phase 14)

Voir [[refonte-identite-visuelle-ifind-mai2026]] memory + plan 14j conversation :
- Saturday refs ritual 1h/sem (Classroom 06)
- Pillar 3000+ mots "Guide 2026 détection signaux B2B FR"
- 8-12 cluster articles (1/sem)
- Substack/Medium cross-post (LLM citation engine)
- Submit Hacker News "Show HN: I built a real-time trigger engine..."
- Engagement Reddit r/sales r/RevOps
- Wikipedia citation play ("Sales intelligence" article)

---

## ✅ Si tu valides ce plan : prochaine action

**Lance Chrome DevTools Lighthouse sur https://ifind.fr/design/v7/ et envoie-moi le screenshot du score. On itère ensemble si besoin avant le ship final.**
