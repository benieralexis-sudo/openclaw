# iFIND v7 — Design System

> **Locked J3 16/05/2026.** Source : `src/styles/tokens.css` + `src/styles/global.css`.
> Direction : Hybride A+B (Mercury socle + Clay hero) · Vibe : Éditorial · Vérifiable · Vivant.

## Couleurs (3 familles HSL)

```
IVOIRE WARM (backgrounds)        INK COOL (text)              ACCENT ORANGE BRÛLÉ
─────────────────────────        ─────────────────────        ────────────────────
--color-bg          #FAFAF7      --color-ink       #1A1A2E    --color-accent       #C2410C
--color-bg-elevated #FFFFFF      --color-ink-soft  #2A2A40    --color-accent-hover #9A340A
--color-bg-soft     #F5F2EA      --color-ink-mute  #6B6B7B    --color-accent-soft  #FFEDD5
--color-line        #E8E5DC      --color-ink-faint #94949E
--color-line-strong #D4D0C4

SIGNAUX (data overlay)
──────────────────────
--color-signal-hot   #B91C1C
--color-signal-warm  = accent
--color-signal-cold  = ink-mute
--color-signal-ok    #00875A
```

**Règle d'or** (Classroom 06 L2) :
- L'ivoire `#FAFAF7` est le **fond dominant** (95% du temps)
- Le blanc `#FFFFFF` est réservé aux **cards, data panels, surfaces élevées**
- L'orange `#C2410C` est l'**italique d'emphasis** + CTA underline + signal warm
- JAMAIS de pure black (`#000`) ni pure white background sauf cards

## Typographie (3 fonts, 5 sizes)

| Token | Font | Usage |
|-------|------|-------|
| `--font-display` | **Source Serif 4** | H1, H2, italique emphasis, logo |
| `--font-sans` | **Inter** | Body, navigation, boutons, UI |
| `--font-mono` | **JetBrains Mono** | Data, timestamps, scores, eyebrows |

**Scale fluid clamp() (1.333 perfect fourth)** :
```
--txt-4xl  48-76px   → H1 hero
--txt-3xl  40-64px   → display rare
--txt-2xl  32-48px   → H2 sections
--txt-xl   26-36px   → H3
--txt-lg   20-24px   → manifeste éditorial, large body
--txt-md   17-20px   → body emphasis
--txt-base 15-18px   → body standard
--txt-sm   13-14px   → labels, captions
--txt-xs   11-12px   → eyebrow, mono micro
```

**Italique emphasis** (signature direction C) :
```html
<h1>La prospection ne se devine pas. <em>Elle se prouve.</em></h1>
```
→ `<em>` automatique = `font-style: italic + color: var(--color-accent)` (défini dans global.css)

## Grid & spacing (8-pt)

```
Container max-width: 1280px (--container-max)
Container narrow:    1100px (--container-narrow) — éditorial reading
Edge gutters:        24-64px clamp (--container-pad)
Grid columns:        12
Grid gap:            24px (--grid-gap)

Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128 / 160
Section rhythm: 96px desktop / 48px mobile (--sp-section-*)
```

**Radius** : JAMAIS 4px sur composants visibles (dated · Classroom 06 L5). Utilise 8/12/16.

## Motion (3 easings, 4 durations)

```
EASINGS                                          DURATIONS
──────────────────────────────────────────       ─────────────────────────
--ease-smooth  cubic-bezier(0.16, 1, 0.3, 1)     --t-fast       140ms  hover
--ease-snap    cubic-bezier(0.32, 0.72, 0, 1)    --t-base       240ms  UI
--ease-bounce  cubic-bezier(0.34, 1.56, 0.64, 1) --t-slow       420ms  modals
                                                  --t-deliberate 680ms  hero
```

**Règle taste** (Classroom 06 L4) :
- Chaque animation doit servir status / continuity / hierarchy / personality
- Si décorative → coupe-la
- Passe finale cut -30% obligatoire J10
- `prefers-reduced-motion` respecté partout (déjà dans tokens.css)

## Composants pattern (Direction C signature)

### Eyebrow live
```html
<div class="eyebrow eyebrow--accent">
  <span class="pulse-dot"></span>
  Trigger Engine · Live FR
</div>
```

### Hero structure
```
.hero
├── .hero-text (col 1, 1.15fr)
│   ├── .eyebrow (orange + pulse dot)
│   ├── h1 (Source Serif + <em> italic accent)
│   ├── p.hero-sub (Inter ink-mute)
│   └── .hero-ctas (primary ink + secondary underline)
└── .data-panel (col 2, 1fr)
    ├── .data-panel-header (mono uppercase + LIVE pulse)
    └── .trigger-list
        └── .trigger × 4 (icon + body + score, hot/warm/cold)
```

### Manifeste section
```
.manifeste (container--narrow)
├── .manifeste-label (sans uppercase tracking-eyebrow, col auto)
└── .manifeste-content (Source Serif 22px + <em> italic accent)
```

### Sources strip
```
.sources-strip (container--narrow, border-top + border-bottom)
├── .sources-label (eyebrow uppercase mono)
└── .sources-list (mono items, dot accent before each)
```

## Refs pivots (à étudier en cas de doute)

- **mercury.com** → socle éditorial, white + orange CTA, hierarchy 5-levels
- **clay.com** → hero data overlay, trigger list, scores
- **anthropic.com** → austerity sérieuse, type display confident
- **stripe.com** → pricing structure si pertinent

## Mockup de référence (à comparer pendant build)

Live : https://ifind.fr/design/v7-preview/direction-c-hybrid.html

Si une nouvelle section doit être construite et qu'on hésite : ouvrir ce mockup, regarder le pattern hero/manifeste/sources et le reproduire à l'identique en cohérence.

## Anti-patterns explicites (NE PAS faire)

- ❌ Dark backgrounds (Direction Sismographe abandonnée, Linear out of scope)
- ❌ Pure black/white (`#000` / `#FFF` direct) — utiliser ink + ivoire
- ❌ Plus de 3 fonts (Source Serif + Inter + JetBrains Mono = locked 3)
- ❌ Plus de 5 sizes (`--txt-2xl` à `--txt-xs` = locked 5)
- ❌ Border radius 4px sur composants visibles
- ❌ Animation sur layout properties (width/height/top/left/padding) — uniquement transform/opacity/filter
- ❌ Plus de 1 anim/page sans réduction (cut -30% J10)
- ❌ Custom cursor effects décoratifs (trend mort depuis 2024 · Classroom 06 L4)
- ❌ Gradient mesh sans raison (Stripe-school sans personnalité)

## Phase suivante (J4)

Définir le sitemap 7 sections + choisir 2-3 techniques signature pour ce site (parmi : page transitions, magnetic buttons, split-text reveals, scroll-pinned, WebGL hero subtle, image sequence). Voir `PLAN.md` (dans la conversation Claude) et la doc Classroom 01 Level 5.
