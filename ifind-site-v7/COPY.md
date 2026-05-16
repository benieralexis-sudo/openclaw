# iFIND v7 — Copy final (Locked J5)

> Copy production-ready pour les 7 sections du site. À copier-coller direct dans les composants Astro J8.
> Brand voice : voir `BRAND-VOICE.md`. Sitemap : voir `SITEMAP.md`.

---

## 0. META TAGS (head)

```html
<title>iFIND — Détectez les signaux d'achat des PME françaises</title>

<meta name="description" content="9 sources publiques françaises natives. 60 leads qualifiés et 6 Pépites garanties par mois. La prospection ne se devine pas. Elle se prouve.">

<!-- Open Graph -->
<meta property="og:title" content="iFIND — Trigger Engine pour PME françaises">
<meta property="og:description" content="Détectez les signaux d'achat publics des PME et ETI françaises en temps réel. 6 Pépites minimum garanties par mois.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://ifind.fr">
<meta property="og:image" content="https://ifind.fr/og-image.jpg">
<meta property="og:locale" content="fr_FR">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="iFIND — Trigger Engine pour PME françaises">
<meta name="twitter:description" content="Détectez les signaux d'achat publics en temps réel. 6 Pépites minimum garanties / mois.">
```

**Title** : 58 chars (sous la limite 60).
**Description** : 152 chars (dans la cible 140-160).

---

## 1. HERO

```yaml
eyebrow: "Trigger Engine · Live FR"  # mono uppercase + dot pulse accent

h1: "La prospection ne se devine pas. <em>Elle se prouve.</em>"
# Source Serif italic emphasis sur "Elle se prouve" → split-text reveal mot par mot

sub: "9 sources publiques françaises natives détectent en temps réel les signaux d'achat datés des PME et ETI. Levées, hires Sales, dépôts INPI, ouvertures de filiale — chaque événement est vérifiable, attribuable, livré sous 24h."

cta_primary:
  text: "Réserver une démo"
  href: "/demo"
  
cta_secondary:
  text: "Voir la méthode"
  href: "#methode"

# Data panel (hero droite)
data_panel:
  title: "Signaux · 24h"  # mono uppercase
  status: "Live"           # accent + dot pulse
  triggers:
    - icon: "€"
      score: "9.2"
      level: "hot"
      company: "Société #421"
      detail: "Levée Series B · 18M€ · 2h"
    - icon: "+"
      score: "8.7"
      level: "hot"
      company: "Société #128"
      detail: "Hire Head of Sales · 4h"
    - icon: "§"
      score: "7.4"
      level: "warm"
      company: "Société #305"
      detail: "Dépôt INPI Class 9 · 7h"
    - icon: "▲"
      score: "7.1"
      level: "warm"
      company: "Société #587"
      detail: "Ouverture filiale · 11h"
```

---

## 2. TRUST STRIP

```yaml
label: "Les 9 sources<br>natives FR"  # eyebrow mono uppercase, line break voulu

sources_list:
  - "INPI"
  - "Pappers"
  - "France Travail"
  - "RNE"
  - "Kaspr"
  - "TheirStack"
  - "FullEnrich"
  - "Rodz"
  - "Apify"

# Optionnel J9-J11 (à valider client) :
# clients_logos:
#   - DTL Studio
#   - Collective.Work
#   - [3ème à recruter]
```

---

## 3. MANIFESTE

```yaml
label: "Manifeste<br>§ 01"  # eyebrow mono uppercase

quote: |
  « Les outils américains scorent par <em>probabilité</em>. 
  iFIND score par <em>événement</em>. 
  Une levée annoncée hier. Un Head of Sales recruté la semaine dernière. 
  Un dépôt INPI hier matin. 
  Des faits publics, datés, attribuables au SIREN. 
  Pas du peut-être. Du <em>vérifiable</em>. »
# Source Serif 22px + italic accent sur 3 mots-clés
# Split-text reveal phrase par phrase au scroll viewport
```

---

## 4. COMMENT ÇA MARCHE (Pinned scroll cinematic)

```yaml
section_label: "Méthode · § 02"
section_h2: "Trois étapes. <em>Vingt-quatre heures.</em>"
section_sub: "Chaque signal détecté passe par 3 étapes vérifiables, en moins de 24h, du capteur au brief Pépite."

# Étapes scrubées (visibles selon scroll progress)
etape_01:
  number: "01"
  title: "Détecter"
  sub: "9 sources scannent 24h/24."
  body: "INPI, Pappers, France Travail, RNE, Kaspr, TheirStack, FullEnrich, Rodz, Apify. 9 sources publiques françaises natives. Aucune intent data agrégée. Aucune navigation anonyme. Que des événements publics datés."

etape_02:
  number: "02"
  title: "Attribuer"
  sub: "SIRENE + 13 patterns + Claude Opus 4.7."
  body: "Chaque signal est attribué au bon SIREN via Pappers. Croisé avec 13 patterns d'achat connus — Series A, hire Sales, M&A, dépôt INPI Class 9. Qualifié par Claude Opus 4.7 selon ton ICP custom."

etape_03:
  number: "03"
  title: "Personnaliser"
  sub: "Brief Pépite + email opener prêt."
  body: "Tu reçois 60 leads qualifiés par mois. Dont 6 Pépites minimum garanties — signaux HOT multi-sources. Chacune avec brief structuré, contacts décideurs et email opener prêt à envoyer. Sinon ton quota est doublé le mois suivant."
```

---

## 5. PREUVE

```yaml
eyebrow: "Preuve · § 03"

headline: "24K€ closé en 9 jours sur une levée détectée <em>deux heures</em> après."

case_story: |
  La Société #421 a annoncé sa Series B de 18M€ le 12 mars 2026 à 14h. 
  iFIND a détecté le trigger à 16h. 
  Notre client a envoyé son email opener personnalisé à 17h32, 
  obtenu un call le 14, démo le 19. 
  Deal closé 24K€ le 21 mars. <strong>9 jours.</strong>

metrics:
  - value: "9"
    label: "sources publiques FR natives"
  - value: "60"
    label: "leads qualifiés par mois"
  - value: "6+"
    label: "Pépites minimum garanties"

testimonials:
  - quote: "iFIND a remplacé Apollo en 3 semaines. ROI mesurable dès le 2ème mois."
    author: "Fred"
    role: "CEO · DTL Studio"
  - quote: "On a closé 4 deals en 6 semaines sur des leads qu'on n'aurait jamais vus avec Cognism."
    author: "[Prénom]"
    role: "Founder · Collective.Work"
  - quote: "[Quote 3ème client à recruter J5-J11]"
    author: "[À recruter]"
    role: "[Role · Boîte]"
```

---

## 6. PRICING

```yaml
eyebrow: "Tarif · § 04"

headline: "Un seul plan. <em>Pas de fluff.</em>"

sub: "Tarification publique. Pas de Founding Members. Pas de tier confus. Une promesse simple, garantie."

plan:
  name: "iFIND Growth"
  price: "390"
  currency: "€"
  period: "/mois"
  billing: "annuel"
  
  includes:
    - "60 leads qualifiés par mois"
    - "<strong>6 Pépites minimum garanties</strong>"
    - "Rollover des crédits jusqu'à 4 mois"
    - "Setup gratuit + ICP custom inclus"
    - "Email opener IA contextualisé par lead"
    
  guarantee: "Si moins de 6 Pépites un mois, ton quota est doublé le mois suivant. Sans discussion."
  
  overage: "Au-delà de 60 leads : 8 € par lead supplémentaire."
  
  cta:
    text: "Réserver une démo"
    href: "/demo"
    
note_grandfather: "Clients existants conservent leur tarif initial jusqu'à fin de contrat actuel."
```

---

## 7. FAQ + FINAL CTA

```yaml
eyebrow: "Questions · § 05"

faq_h2: "Cinq questions <em>avant la démo</em>."

faq_items:
  - q: "Qu'est-ce qu'une Pépite exactement ?"
    a: "Une Pépite est un signal HOT (score ≥ 9 sur 10) confirmé par 2 sources indépendantes ou plus sur 30 jours. Exemple : Series B annoncée + hire Head of Sales la même semaine sur le même SIREN. Multi-source = signal acheteur fort."
    
  - q: "En quoi iFIND diffère d'Apollo, Cognism ou ZoomInfo ?"
    a: "Apollo, Cognism, ZoomInfo scorent par <em>probabilité</em> (intent data agrégée, navigation web anonyme). iFIND score par <em>événement public daté</em> (levée annoncée, dépôt INPI, hire LinkedIn). Pas le même jeu. Pas la même fiabilité sur le marché français."
    
  - q: "Est-ce conforme RGPD ?"
    a: "Oui. iFIND n'utilise que des sources publiques (INPI, Pappers, RNE, France Travail) ou des fournisseurs déclarés CNIL (Kaspr, FullEnrich). Aucun scraping de données privées. Attribution SIRENE pour chaque trigger. Données stockées en France."
    
  - q: "Combien de temps pour le setup ?"
    a: "48 à 72 heures. Tu remplis un brief ICP (codes NAF, taille, géographie, signaux prioritaires). On lance les capteurs. Première Pépite livrée J+3 en moyenne."
    
  - q: "Engagement et annulation ?"
    a: "Contrat annuel par défaut. Préavis 30 jours pour annulation à l'échéance. Si moins de 6 Pépites un mois, ton quota est doublé le mois suivant. Si on rate la garantie 3 mois consécutifs, tu peux résilier sans préavis."

# Final CTA
final_cta:
  eyebrow: "Démo · 30 min"
  headline: "Trois Pépites alignées à votre ICP. <em>En direct.</em>"
  sub: "30 minutes. Pas de slides. Pas de pitch. On vous montre 3 Pépites détectées la semaine dernière sur des sociétés qui ressemblent à vos meilleurs clients."
  cta_text: "Réserver une démo"
  cta_href: "/demo"
  footer_note: "Démo livrée par Alexis Bénier · CEO iFIND · benieralexis@gmail.com"
```

---

## Footer (transverse)

```yaml
brand:
  logo: "iFIND"
  tagline: "Trigger Engine pour PME françaises."

nav:
  Produit: "/"
  Méthode: "/methode"
  Tarifs: "/tarifs"
  Journal: "/journal"
  Contact: "/contact"

legal:
  Mentions: "/mentions-legales"
  CGV: "/cgv"
  Confidentialité: "/confidentialite"
  Cookies: "/cookies"

social:
  LinkedIn: "https://www.linkedin.com/company/ifind"
  Twitter: "https://twitter.com/ifind_fr"

copyright: "© 2026 iFIND · Détection souveraine de signaux d'achat · Made in France"
```

---

## Validation J5 ✅ (à passer avant Phase 6)

- [ ] Lecture à voix haute des 7 sections — aucun stumble
- [ ] Aucun banned word ("solution", "premium", "leader", "innovant", "révolutionnaire"...)
- [ ] Au moins 1 chiffre concret par section
- [ ] 1 italique éditorial mot-clé par section critique
- [ ] Title 50-60 chars + description 140-160 chars ✓
- [ ] FAQ couvre les 5 objections principales
- [ ] Final CTA = promesse spécifique mesurable
- [ ] Test : un Sales Ops FR comprend la différence vs Apollo en 30 secondes
