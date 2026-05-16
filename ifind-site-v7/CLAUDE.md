# iFIND site v7 — Refonte selon méthodologie Weblove

## What this is
Site marketing produit pour **iFIND** — Trigger Engine FR (détection signaux d'achat publics 9 sources FR). Refonte complète post-reset du 16/05/2026. Ambition : Awwwards SOTD / Godly / Land-book.

## Stack
- **Astro 5.1** (statique SEO-first, supérieur à Next.js pour site marketing pur)
- TypeScript
- **Three.js** + GSAP + Lenis (déjà installés)
- Tone.js (audio-reactive, optionnel)
- Vercel deploy
- À ajouter J8 : Tailwind + shadcn-vue/svelte ou vanilla CSS tokens

## Méthodologie (référence : formation Weblove Academy)
Le sprint suit le plan 14 jours documenté dans la conversation Claude (voir `BRIEF.md` pour le brief produit et `REFS.md` pour la library).

**Garde-fous anti-erreur 15/05** :
1. Refs library AVANT design (J1)
2. Direction lockée J2, on revient JAMAIS dessus après J3
3. Finir laid J8 avant joli J9 (skeleton complet AVANT 1ʳᵉ anim)
4. Cut -30% motion J10 brutal
5. 1 hero scene MAX (erreur 14/05 : 3 scènes Three.js)
6. Lighthouse CI dans le repo pour bloquer régressions

## Folders
```
src/
  components/
    sections/        # Hero, Problem, HowItWorks, Proof, Pricing, FAQ, CTA
    ui/              # Button, Eyebrow, etc.
    effects/         # 3D scenes, shaders (1 max après J9)
  layouts/           # Base.astro
  pages/             # index.astro + routes
  styles/            # tokens.css + global.css
  animations/        # GSAP timelines, hooks
public/              # images optimisées (AVIF/WebP), fonts self-hosted
```

## Performance budget (non-négociable)
- Lighthouse Performance ≥ 90 desktop, ≥ 80 mobile
- LCP < 2.5s, CLS < 0.1, INP < 200ms
- Reduced-motion respecté partout
- Pas d'animation sur layout properties (width/height/top/left/padding)
- Seulement transform / opacity / filter / clip-path

## Conventions
- Named exports
- Animation hooks dans `/src/animations`
- Pas de inline keyframes (utiliser tokens motion)
- 8-pt spacing (8/16/24/32/48/64/96/128)
- 12-col grid, max-width 1280-1440px desktop
- Type scale 5 sizes max, 1 display + 1 body font

## Definition of done (J14)
- [ ] Lighthouse 90+ desktop / 80+ mobile prouvé
- [ ] Polish 20-points 100% coché (voir Classroom 06 L5)
- [ ] llms.txt + schema JSON-LD + sitemap.xml live
- [ ] Awwwards/Godly/Land-book submitted
- [ ] 1 hero scene + 2-3 techniques signature seulement
- [ ] Test fresh incognito mobile + desktop OK
- [ ] 3 friends test "rien de bizarre" OK

## Commands
```bash
npm run dev       # astro dev --host 0.0.0.0 --port 4321
npm run build     # astro build
npm run preview   # astro preview
```

## Historique
- 15/05/2026 01h — scaffold initial Astro + direction Sismographe (commit local non-versionné)
- 15/05/2026 22h — sprint Awwwards v6 sur HTML monolithique (10 commits) → rollback
- 16/05/2026 matin — reset complet demandé, audit 86/100, plan 14j Weblove cadré
- 16/05/2026 — backup Sismographe en tar.gz, démarrage v7 selon méthodologie Weblove
