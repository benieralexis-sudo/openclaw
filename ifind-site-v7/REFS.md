# Bibliothèque de références — J1

> **Source : Classroom 06 Level 0 (Design Taste).**
> Objectif : 50 references taggées en 1 journée. Steal **structure**, not style.
> Outil unique recommandé : **Mymind** ou **Are.na** ou **Notion gallery** (1 seul, pas splitter).

## Les 12 sources à browser (cours)

| Source | URL | Quoi y chercher pour iFIND | Quota |
|--------|-----|----------------------------|-------|
| Awwwards SOTD | awwwards.com | Standard cible. 7 derniers jours. | 5 |
| Godly | godly.website | Curated, tasteful. Niche-strong. | 10 |
| Land-book | land-book.com | SaaS landings mainstream-quality. **Le + proche d'iFIND.** | 10 |
| Httpster | httpster.net | Indie + experimental. | 5 |
| Mobbin | mobbin.com | Mobile UI patterns (responsive). | 5 |
| SaveeApp | savee.it | Pinterest-style aesthetic. | 3 |
| Cosmos.so | cosmos.so | Visual aesthetic. | 3 |
| Are.na | are.na | Knowledge-graph collections. | 3 |
| Refero | refero.design | UI patterns détaillés. | 3 |
| Lapa Ninja | lapa.ninja | Landing-page library. | 2 |
| UI Garage | uigarage.net | UI patterns catégorisés. | 1 |
| **TOTAL** | | | **50** |

## Template de tag (chaque save)

```yaml
- url: https://...
  type: [hero | section | footer | cta | pricing | testimonials | nav | 404]
  industry: [saas-b2b | dev-tools | fintech | data | agency | other]
  vibe: [cinematic | brutalist | minimal | editorial | playful | technical]
  tech: [gsap | scroll-driven | 3d | shader | video-loop | spline | none]
  note: "Ce que je volerais en 1 ligne — ex. 'sticky type scrub + dot grid backdrop'"
```

## Prompt synthesis (à lancer J2 dans Claude Chat)

Une fois les 50 refs taggées, paste les lignes dans Claude (modèle Opus 4.7 recommandé) avec ce prompt :

```
Below are notes on 50 reference sites for iFIND, a French B2B SaaS that detects
public buying signals on SMEs via 9 native French sources.

Synthesise into:
1) Dominant structural pattern across references (5-7 lines)
2) 3 most interesting outliers (with what makes them stand out)
3) Recommended structure for new site section by section (max 7 sections)
4) What I should specifically AVOID copying stylistically
5) Top 3 references closest to the iFIND brief (Trigger Engine FR, sniper-precise,
   data-grounded, premium B2B)

References:
<paste 50 tagged lines>
```

## Garde-fous J1

- [ ] **Tag chaque save** (pas de save sans tag — sinon library inutile à la synthesis)
- [ ] **1-line note "ce que je volerais"** — la note force le cerveau à analyser, pas juste sauver
- [ ] **Steal structure, not style** — ne pas copier visuellement, comprendre le pattern
- [ ] Quota 50 (pas 100, pas 30) — calibré pour 1 journée focus
- [ ] **Pas d'over-collection** — fermer les onglets après save

## Quest XP (cours)

- 🥉 100 XP : 50 refs taggées en 7 jours (target ici J1 = 1 journée, ambitieux)
- 🥈 250 XP : Saturday ritual 8 weeks (1h/sem = continu post-J14)
- 🥇 500 XP : 500-ref library en 90j + 3 synthesis briefs

---

## Refs collectées (à remplir J1)

<!-- Format : 1 entrée = 1 bloc yaml ci-dessous -->

```yaml
# Exemple
- url: https://linear.app
  type: hero
  industry: saas-b2b
  vibe: cinematic
  tech: scroll-driven
  note: "Hero pinned + gradient mesh subtil + headline split-reveal — pattern reproductible facilement"
```

<!-- 49 entrées suivantes ↓ -->
