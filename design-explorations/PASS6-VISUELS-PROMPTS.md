# Pass 6 — Prompts Midjourney V7/V8 pour iFIND

Sortir du look "tutoriel Three.js générique" en injectant 8-10 visuels signatures custom. Tous les prompts ci-dessous sont taillés pour ton univers **Sismographe Souverain · Vélin & Ambre INPI**.

## Conventions communes

À ajouter à TOUS les prompts (style cohérent) :

```
--style raw --ar 16:9 --v 7 --quality 2 --stylize 250
```

Ou en **vertical** pour les cards :
```
--style raw --ar 4:5 --v 7 --quality 2 --stylize 250
```

**Palette imposée à mentionner explicitement** : `cream paper #F5F1EA, ink black #0F0D0A, INPI amber #E89F2C`. MJ tire bien vers ces tons quand on les nomme.

---

## VISUEL 01 — Hero loop video alternative

**Usage** : optionnel, derrière le canvas Three.js, opacity 0.10, mode plus-lighter. Ajoute une "matière" texturée quand le scroll s'arrête.

**Prompt** :
```
extreme close-up macro photograph of vintage seismograph paper rolling slowly,
hand-drawn ink lines tracing earthquake patterns, warm cream paper #F5F1EA
with ink black #0F0D0A traces, single amber #E89F2C accent line emerging,
shallow depth of field, soft directional warm light from the left, subtle
paper grain texture, archival document aesthetic, no people, no text, slow
contemplative motion, 35mm film grain, --style raw --ar 16:9 --v 7
```

**Variante Runway Gen-4** (loop 8 sec) :
```
A vintage seismograph paper roll slowly advancing left-to-right, ink stylus
drawing soft horizontal lines, occasional sharp amber spike emerging from
the center, cream paper texture, warm directional light, slow contemplative
pace, no cuts, seamless loop, 8 seconds
```

---

## VISUEL 02 — Section Manifesto (background)

**Usage** : background section ink/dark "manifesto", subtle, opacity 0.18, mix-blend-mode lighten.

**Prompt** :
```
abstract topographic map of France rendered as concentric ink contour lines
on cream paper, subtle amber #E89F2C glow at three precise points (Paris,
Lyon, Marseille), institutional cartography aesthetic, hand-drafted compass
rose detail in corner, archival INPI document patina, very fine line work,
no labels, no text, monochrome cream + ink + single amber accent
--style raw --ar 16:9 --v 7 --stylize 200
```

---

## VISUEL 03 — Section Carte FR (overlay décoratif)

**Usage** : overlay 25% opacity sur la carte 3D existante, donne de la matière en background.

**Prompt** :
```
microscopic view of an INPI patent stamp ink texture, deep ink black #0F0D0A
ink imperfections on cream cotton paper #F5F1EA, single amber #E89F2C ink
droplet bleeding into fibers, archival photography, raking light to expose
texture, grain visible, no logo, no text, abstract texture only
--style raw --ar 21:9 --v 7
```

---

## VISUEL 04 — Card "Capter" méthode

**Usage** : illustration card 1 (CAPTER : 9 sources). Remplace ou renforce le SVG existant.

**Prompt** :
```
nine antennae receivers arranged in radial composition around central hub,
brutalist industrial aesthetic, brushed steel and ink black components,
single amber #E89F2C signal beam connecting all nine to the center, cream
#F5F1EA paper background, isometric perspective, technical schematic style,
fine ink linework, no text labels --style raw --ar 4:5 --v 7
```

---

## VISUEL 05 — Card "Qualifier" méthode

**Usage** : illustration card 2 (QUALIFIER : Claude Opus + 13 patterns).

**Prompt** :
```
abstract neural network diagram, thirteen ink black nodes connected by fine
amber #E89F2C threads to central larger node, organic geometric composition,
cream paper background with subtle grid, hand-drafted scientific paper
aesthetic, equations in margin (illegible), thin ink linework, vintage
academic publication style --style raw --ar 4:5 --v 7
```

---

## VISUEL 06 — Card "Délivrer" méthode

**Usage** : illustration card 3 (DELIVRER : briefs).

**Prompt** :
```
elegant typewritten letter on cream paper #F5F1EA being slid across a desk,
folded paper crease, single amber #E89F2C wax seal stamp in corner, ink
black manuscript writing in left margin, warm overhead lighting, archival
correspondence aesthetic, top-down perspective, no readable text, mood
contemplative --style raw --ar 4:5 --v 7
```

---

## VISUEL 07 — Hero side panel "trigger feed" texture

**Usage** : background subtle dans le panel `.hero-panel` (10% opacity).

**Prompt** :
```
extreme macro of vintage telex paper printout, fine perforation holes on
edges, dot matrix printer impression, cream #F5F1EA paper aged at edges,
single amber #E89F2C ink stamp partially visible, archival institutional
document texture, no readable text, abstract industrial aesthetic
--style raw --ar 3:4 --v 7
```

---

## VISUEL 08 — Open Graph / share preview

**Usage** : `og:image` 1200×630 pour les partages Twitter/LinkedIn/Slack.

**Prompt** :
```
elegant editorial composition: large display text "iFIND" in thin serif
display typeface, on cream paper #F5F1EA, single amber #E89F2C horizontal
seismograph trace below the wordmark, ink black tagline space below, French
institutional design aesthetic, INPI stamp watermark in bottom right,
generous whitespace, magazine cover quality, --style raw --ar 1200:630 --v 7
```

> Après génération : laisse l'espace tagline vide, je rajouterai en post le
> texte "Le sismographe de la donnée commerciale française" en CSS overlay.

---

## VISUEL 09 — Section Tarifs background subtil

**Usage** : derrière la pricing card, opacity 0.06, mix-blend multiply.

**Prompt** :
```
abstract financial ledger paper texture, hand-drawn columns and rules in
ink black on cream #F5F1EA, single amber #E89F2C totaling line, vintage
French accountancy book pages, fine grid lines, no readable numbers, no
text, archival texture only --style raw --ar 16:9 --v 7
```

---

## VISUEL 10 — Footer / signature

**Usage** : petit visuel signature dans le footer (style cachet).

**Prompt** :
```
official-looking circular wax seal stamp imprint, INPI institutional
aesthetic, amber wax #E89F2C with embossed lines, on cream paper, single
seal centered, archival photograph, top-down perspective, raking light,
photoreal but stylized --style raw --ar 1:1 --v 7
```

---

## Workflow recommandé

1. **Lance les 10 prompts en batch sur Midjourney V7** (~30 min de génération + sélection)
2. Pour CHAQUE image gardée :
   - Upscale 2× max (pas plus, on veut du léger pour le web)
   - Convertis en **AVIF** + **WebP** + **JPG fallback** via `cavif`/`squoosh-cli` :
     ```bash
     squoosh-cli --avif '{"quality":55}' visuel-01.png
     squoosh-cli --webp '{"quality":75}' visuel-01.png
     squoosh-cli --mozjpeg '{"quality":80}' visuel-01.png
     ```
   - Pose dans `/opt/moltbot/design-explorations/assets/visuels/`
3. **LQIP** (Low Quality Image Placeholder) : génère un blur 24×14 base64 inline pour `background-image` du loading state.

## Une fois les fichiers en place

Je m'occupe de brancher les `<picture>` tags dans le HTML avec srcset + lazy loading + LQIP — c'est 15 min de plus.

Pour MJ V8 alpha si dispo : ajouter `--v 8` à la place de `--v 7`. Sinon V7 est très bien.
