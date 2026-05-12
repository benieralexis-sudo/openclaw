# iFIND v3.0 — Architecture technique complète

**Document de référence système** · Version 1.0 · 12/05/2026  
**Scope** : système iFIND uniquement, hors commercial / pricing / Fred  
**Auteur** : Jojo (avec assistant Claude)

> ⚠️ **Ce document ne parle pas de prix, de clients, ni de Fred.**  
> Il documente uniquement **l'architecture technique du système iFIND v3.0**.

---

## Table des matières

1. [Vision système (1 page)](#1-vision-système)
2. [Architecture en 5 couches](#2-architecture-en-5-couches)
3. [Catalogue complet des 17 capteurs](#3-catalogue-complet-des-17-capteurs)
4. [Composants techniques détaillés](#4-composants-techniques-détaillés)
5. [Le scoring composite — règle de calcul](#5-le-scoring-composite)
6. [Watchlist 90 jours](#6-watchlist-90-jours)
7. [Outcomes Loop (apprentissage)](#7-outcomes-loop-apprentissage)
8. [Flux de données end-to-end](#8-flux-de-données-end-to-end)
9. [Aspects opérationnels](#9-aspects-opérationnels)
10. [Conformité RGPD / CNIL](#10-conformité-rgpd--cnil)
11. [Risques techniques identifiés](#11-risques-techniques-identifiés)
12. [Trous à combler (honnêteté)](#12-trous-à-combler)
13. [Plan de construction par phase](#13-plan-de-construction-par-phase)
14. [Métriques techniques de succès](#14-métriques-techniques-de-succès)
15. [Annexes](#15-annexes)

---

## 1. Vision système

iFIND v3.0 est un **système de détection multi-capteurs** qui surveille en continu le tissu PME française pour identifier les boîtes qui ont **un besoin d'achat dans les 30-90 jours**.

### Principe fondateur

**Une boîte qui va acheter émet 3-10 signaux publics dans les 60 jours qui précèdent.** Personne ne capte ces signaux ensemble parce que c'est coûteux à construire et à maintenir. C'est exactement le moat d'iFIND.

### 4 piliers techniques

1. **Brain LLM Expert** (Claude Opus) — juge chaque lead comme un commercial senior
2. **17 capteurs** (9 sources externes + 8 propriétaires) — vue panoramique du tissu PME FR
3. **Watchlist intelligente 90 jours** — aucun lead borderline ne se perd
4. **Apprentissage par client** — le système devient plus précis à chaque conversion

### Promesse système

Le système est :
- **Évolutif** : on peut ajouter un capteur sans casser les autres
- **Résilient** : si un capteur tombe, le score composite tient
- **Transparent** : chaque score est explicable (pas de boîte noire)
- **Auto-correcteur** : audit-heal + watchlist + outcomes loop

---

## 2. Architecture en 5 couches

### Vue d'oiseau

```
┌────────────────────────────────────────────────────────────┐
│ LAYER 1 — ACQUISITION                                       │
│ 17 capteurs (9 externes + 8 propriétaires)                  │
│ → événements bruts (job posting, levée, INPI dépôt, etc.)   │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ LAYER 2 — NORMALISATION                                     │
│ Attribution SIRENE + Dedup + Validation Zod                  │
│ → signal_event (horodaté, structuré, attribué SIREN)        │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ LAYER 3 — STOCKAGE TEMPOREL                                 │
│ PostgreSQL + TimescaleDB hypertable                          │
│ → signal_events table (timeseries) + Lead/Trigger/Client    │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ LAYER 4 — INTELLIGENCE                                      │
│ Brain V2 Opus + Pattern Matcher + Outcomes Loop              │
│ → score composite 0-100 par lead par client                  │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ LAYER 5 — PRÉSENTATION                                      │
│ Dashboard + API + Notifications                              │
│ → Lead avec breakdown score visible au client                │
└────────────────────────────────────────────────────────────┘
```

### Détail par couche

#### Layer 1 — Acquisition
**Rôle** : capter en continu les événements publics qui concernent des PME FR.

**Implémentation** :
- Framework abstrait `Sensor` (interface commune)
- 17 implémentations concrètes (1 par source)
- Cron + queues (BullMQ ou systemd timers)
- Lock distribué (Redis ou DB) pour anti-collision

**Contrats** :
- Chaque capteur produit des `RawSignalEvent` avec : `source`, `eventTimestamp`, `companyHint`, `payload`, `confidence`

#### Layer 2 — Normalisation
**Rôle** : transformer un `RawSignalEvent` en `signal_event` exploitable.

**Étapes** :
1. **Attribution SIRENE** : résoudre le nom de la boîte vers un SIREN (via Pappers fallback + INSEE)
2. **Dédup cross-source** : si Apify LinkedIn + Apify WTTJ captent la même annonce → 1 seul event
3. **Validation Zod** : schema strict pour rejeter les events malformés
4. **Enrichment métadonnées** : NAF, taille, région ajoutés via SIRENE

#### Layer 3 — Stockage temporel
**Rôle** : conserver l'historique de tous les signaux dans le temps.

**Choix technique** : **PostgreSQL + extension TimescaleDB**
- Pas Redis (volatile, pas requêtes temporelles complexes)
- Pas ClickHouse (overkill pour notre volume)
- Pas NoSQL (on a besoin de joins avec Lead/Client)
- TimescaleDB = extension Postgres = on garde notre stack actuelle + on gagne les hypertables

**Schéma** :
```sql
CREATE TABLE signal_events (
  id           UUID PRIMARY KEY,
  source       VARCHAR(50),     -- 'press_regionale_whisperer', 'dns_sherlock', etc.
  siren        VARCHAR(9),
  event_type   VARCHAR(50),     -- 'c_level_change', 'stack_migration', 'patent_filing', etc.
  event_ts     TIMESTAMPTZ,     -- quand l'événement a eu lieu (publié)
  captured_ts  TIMESTAMPTZ,     -- quand iFIND l'a vu
  payload      JSONB,
  confidence   FLOAT,           -- 0.0 - 1.0
  raw_data     JSONB
);

SELECT create_hypertable('signal_events', 'event_ts');
CREATE INDEX idx_signal_events_siren_ts ON signal_events (siren, event_ts DESC);
CREATE INDEX idx_signal_events_source_ts ON signal_events (source, event_ts DESC);
```

#### Layer 4 — Intelligence
**Rôle** : transformer un graphe d'événements + un dossier boîte en **score composite** + **verdict**.

**3 composants** :
1. **Brain V2 Opus** (existant) — verdict OUI/NON/ENRICH + confidence + thesis + risks
2. **Pattern Matcher** (nouveau, cron horaire) — calcule le score composite 0-100 pour chaque lead candidat
3. **Outcomes Loop** (Phase 6) — re-pondère les poids du scoring selon les actions du client

#### Layer 5 — Présentation
**Rôle** : exposer les leads + leur score décomposé au client.

**Composants** :
- Dashboard Next.js (existant, à étendre)
- API REST (existant)
- Notifications (Resend pour digest, Telegram pour alertes admin)

---

## 3. Catalogue complet des 17 capteurs

### Capteurs EXISTANTS (9) — gardés tels quels en v3.0

| # | Nom | Source | Fréquence | Type signal | Coût |
|---|---|---|---|---|---|
| 1 | apify.linkedin-jobs | LinkedIn jobs | 1×/jour | Job posting QA | $$$ |
| 2 | apify.wttj-jobs | Welcome to the Jungle | 1×/jour | Job posting | $$ |
| 3 | apify.indeed-jobs | Indeed | 1×/jour | Job posting (à enterrer) | $$$ |
| 4 | theirstack.job-offer | TheirStack | 2×/jour | Job posting cross-platform | $$$ |
| 5 | theirstack.buying-intent | TheirStack | 1×/jour | Intent topics | $$$ |
| 6 | rodz.fundraising | Rodz | webhook | Levée fonds FR | $ |
| 7 | rodz.mergers-acquisitions | Rodz | webhook | M&A FR | $ |
| 8 | trigger-engine.funding-recent | RSS (Maddyness, Frenchweb) | 1×/heure | Levée fonds | $0 |
| 9 | bodacc | BODACC API | 1×/jour | Annonces légales | $0 |

→ La majorité de ces capteurs sont à **refondre dans le framework Sensor** (Phase 2-4), pas à jeter.

### Capteurs PROPRIÉTAIRES (8) — nouveaux, construits par iFIND

#### Capteur P1 — Press Régionale Whisperer
- **Sources** : 15 titres FR (Sud Ouest, Ouest France, La Provence, Le Progrès, La Tribune Lyon, Les Échos régions, La Voix du Nord, Le Télégramme, Capital, BFM Business régions, Le Parisien Eco, La Croix Eco, L'Est Républicain, Midi Libre, La Dépêche)
- **Fréquence** : RSS toutes les heures + scraping HTML diff toutes les 6h
- **Pipeline** : RSS feed → Haiku (filtre articles mentionnant boîtes) → Sonnet (extract person + role + event_type) → SIRENE attribution → event emit
- **Output** : événements `c_level_change`, `local_funding`, `expansion`, `acquisition`
- **Avantage moat** : 80% des nominations C-level PME FR sont annoncées QUE en presse régionale, jamais Apollo/Pharow/Cognism
- **Coût construction** : 7-10 jours
- **Coût mensuel** : ~$5 (Anthropic Haiku/Sonnet)

#### Capteur P2 — DNS Sherlock
- **Sources** : DNS publique (dig, doh.opendns.com, crt.sh Certificate Transparency)
- **Fréquence** : 1×/semaine par boîte (snapshot des records)
- **Pipeline** : pour chaque boîte ICP éligible → resolve SPF / DKIM / CNAME / MX → compare avec semaine d'avant → diff → event emit
- **Output** : événements `stack_change`, `email_provider_migration`, `crm_change`, `new_subdomain`
- **Signaux détectables** :
  - `CNAME → intercom.help` → utilise Intercom
  - `SPF include:sendgrid.net` → Sendgrid
  - `CNAME → hubspot.com` → HubSpot CRM
  - `MX → outlook.com` vs `google.com` → MS365 vs Workspace
  - Nouveau subdomain `app.X.com` → nouveau produit en pipeline
- **Coût construction** : 5-7 jours
- **Coût mensuel** : $0 (DNS public)

#### Capteur P3 — INPI Marques & Brevets
- **Source** : API INPI publique (https://data.inpi.fr)
- **Fréquence** : 1×/jour
- **Pipeline** : récupère dépôts marques + brevets des derniers 30 jours → filtre PME FR → SIRENE attribution → event emit
- **Output** : événements `trademark_filing`, `patent_filing`, `trademark_opposition`
- **Avantage moat** : dépôt marque = annonce produit dans 6-12 mois. iFIND alerte 6 mois avant la presse.
- **Coût construction** : 5 jours
- **Coût mensuel** : $0 (API publique gratuite)

#### Capteur P4 — Founder Voice Radar
- **Sources** : 50 podcasts FR (GDIY, Vlan, Outils du Manager, La Martingale, GDIY, Inside, Sismique, etc.) + 20 chaînes YouTube founders
- **Fréquence** : check nouveaux épisodes 1×/jour, transcription dans 24h
- **Pipeline** : RSS feed podcast → download MP3 → Whisper (transcription) → Sonnet (extract pain points, hiring intent, fundraising hints) → SIRENE attribution si boîte mentionnée → event emit
- **Output** : événements `founder_pain_point`, `hiring_intent_signal`, `expansion_signal`, `funding_hint`
- **Avantage moat** : founders parlent **2-6 mois AVANT** que ça arrive dans la presse. Avance détection énorme.
- **Coût construction** : 15-20 jours (le plus complexe)
- **Coût mensuel** : ~$20-40 (Whisper local CPU + Anthropic extract)
- **Risques** : maintenance flux RSS podcasts qui changent, qualité transcription audio variable

#### Capteur P5 — Wappalyzer Stack Diff
- **Sources** : Wappalyzer (lib open-source) + headers HTTP + bundles JS
- **Fréquence** : 1×/semaine par boîte
- **Pipeline** : pour chaque boîte ICP → fetch homepage → run Wappalyzer detection → compare avec snapshot précédent → diff → event emit
- **Output** : événements `tech_stack_add`, `tech_stack_remove`, `framework_migration`
- **Exemples** :
  - "React 17 → Next.js 15" = migration frontend
  - "Auth0 disparu, Clerk apparu" = migration auth
  - "Pinecone ajouté" = boîte fait de l'AI vector search
- **Coût construction** : 7-10 jours
- **Coût mensuel** : ~$5-10 (compute + storage hypertable)

#### Capteur P6 — BOAMP / Marchés Publics
- **Sources** : BOAMP (Bulletin Officiel des Annonces de Marchés Publics), achatpublic.com, marches-publics.gouv.fr, plateformes ministères
- **Fréquence** : 1×/jour
- **Pipeline** : scrape derniers appels d'offres → filter PME FR (acheteur public bénéficie PME) → SIRENE attribution → event emit
- **Output** : événements `public_tender`, `budget_voted`
- **Avantage** : signal d'intent le plus pur (budget voté + montant + deadline explicites)
- **Coût construction** : 5-7 jours
- **Coût mensuel** : $0

#### Capteur P7 — Public Money Tracker
- **Sources** : BPI France (api.bpifrance.fr), France 2030 (gouv.fr), FEDER (DGOM), CIR (data.gouv.fr)
- **Fréquence** : 1×/semaine
- **Pipeline** : scrape attributions récentes → filtre PME FR → SIRENE attribution → event emit
- **Output** : événements `bpi_funding`, `france2030_grant`, `feder_subsidy`, `cir_eligible`
- **Avantage** : 54 milliards € France 2030 = 80% PME bénéficiaires jamais vu un commercial pour les outils qu'elles vont devoir acheter
- **Coût construction** : 5 jours
- **Coût mensuel** : $0

#### Capteur P8 — GitHub Org Velocity
- **Sources** : API GitHub publique (rest.github.com)
- **Fréquence** : 1×/semaine par boîte tech
- **Pipeline** : pour chaque boîte avec org GitHub publique → fetch orgs/repos/contributors stats → compare avec snapshot précédent → diff → event emit
- **Output** : événements `engineering_growth`, `new_repo`, `oss_traction`, `commits_velocity`
- **Coût construction** : 5-7 jours
- **Coût mensuel** : $0 (API GitHub gratuite 5000 req/h)

### Tableau récapitulatif des 17 capteurs

| Capteur | Type | Construction | Coût mois | ROI attendu | Priorité v3.0 |
|---|---|---|---|---|---|
| Apify LinkedIn | Externe | Existant | $$$ | Haut | Garder, refondre |
| Apify WTTJ | Externe | Existant | $$$ | Très haut (80% utile) | Garder, refondre, **fix latence URGENT** |
| Apify Indeed | Externe | Existant | $$$ | Nul | **Enterrer** |
| TheirStack JO | Externe | Existant | $$$ | Moyen | Garder, à reformer |
| TheirStack BI | Externe | Existant | $$$ | Faible | À enterrer Phase 4 |
| Rodz fundraising | Externe | Existant | $ (one-shot) | Haut | Garder |
| Rodz M&A | Externe | Existant | $ | Moyen | Garder |
| RSS Levées | Externe | Existant | $0 | Haut | Garder, fix latence |
| BODACC | Externe | Existant | $0 | Moyen | Garder |
| **P1 Press Régionale** | **Propriétaire** | 7-10 j | $5 | **Très haut** | **#1 priorité** |
| **P2 DNS Sherlock** | **Propriétaire** | 5-7 j | $0 | Haut | #2 priorité |
| **P3 INPI Marques/Brevets** | **Propriétaire** | 5 j | $0 | Haut | #3 priorité |
| **P4 Founder Voice** | **Propriétaire** | 15-20 j | $30 | **Énorme** (moat ultime) | #8 (dernier — complexe) |
| **P5 Wappalyzer Diff** | **Propriétaire** | 7-10 j | $10 | Moyen-haut | #5 |
| **P6 BOAMP** | **Propriétaire** | 5-7 j | $0 | Haut | #4 priorité |
| **P7 BPI/France 2030** | **Propriétaire** | 5 j | $0 | Moyen-haut | #6 |
| **P8 GitHub Velocity** | **Propriétaire** | 5-7 j | $0 | Moyen | #7 |

---

## 4. Composants techniques détaillés

### 4.1 Sensor Framework (abstract)

Tous les capteurs implémentent la même interface :

```typescript
abstract class Sensor {
  abstract id: string;
  abstract version: string;
  abstract frequencyMs: number;
  
  abstract async fetch(): Promise<RawEvent[]>;
  abstract async normalize(raw: RawEvent): Promise<SignalEvent | null>;
  
  // Méthodes communes (héritées)
  async run(): Promise<void> {
    const raws = await this.fetch();
    for (const raw of raws) {
      const event = await this.normalize(raw);
      if (event) await this.emit(event);
    }
  }
  
  async emit(event: SignalEvent): Promise<void> {
    // 1. Validation Zod
    // 2. Dedup check
    // 3. Insert signal_events
    // 4. Trigger Brain V2 si pertinence haute
  }
}
```

Avantage : ajouter un capteur = créer 1 fichier qui hérite de `Sensor`. Plug-and-play.

### 4.2 Stockage temporel TimescaleDB

**Pourquoi TimescaleDB plutôt qu'une table Postgres classique ?**

- **Compression** automatique des données anciennes (signal_events de >30 jours compressés à 90% en moins)
- **Retention policies** : auto-purge des events >12 mois (sauf si liés à un Lead actif)
- **Hypertables** : partition automatique par mois → requêtes "derniers 90j" 10× plus rapides
- **Continuous aggregates** : pré-calcul des stats par boîte (nb_signals_90d) pour le Pattern Matcher

**Migration depuis schéma actuel** :
- La table `Trigger` reste (compatibilité v2)
- Nouvelle table `signal_events` (timeseries pure)
- Migration progressive : les nouveaux capteurs émettent dans `signal_events`, les anciens écrivent dans `Trigger` ET `signal_events` pendant 30j puis bascule

### 4.3 Brain V2 Opus (existant, gardé)

Voir A.0.3 — module solide à 1170 lignes, à conserver. Refacto possible Phase 4+ (découpage en sous-modules) mais pas urgent.

### 4.4 Pattern Matcher (nouveau, cron horaire)

**Rôle** : pour chaque Lead candidat, calculer le score composite 0-100.

**Pseudo-code** :
```
toutes les heures :
  POUR chaque Lead actif (status NEW/ENRICHED/WATCHLIST) :
    1. Récupérer tous les signal_events de son SIREN sur 90j glissants
    2. Calculer chaque dimension du score (voir section 5)
    3. Sommer pondéré → score composite 0-120
    4. Décider seuil (HOT/WARM/WATCHLIST/IGNORED)
    5. Mettre à jour Lead.scoreComposite + Lead.scoreBreakdown
    6. Si transition HOT/WARM → trigger digest client
    7. Si descend à <50 → archive avec raison
```

**Performance** : avec 24 leads × 200 events/lead = 4800 ops/heure. Trivial.

### 4.5 Watchlist Engine (nouveau)

Voir section 6 ci-dessous.

### 4.6 Outcomes Loop (Phase 6)

Voir section 7 ci-dessous.

---

## 5. Le scoring composite

**Règle** : chaque Lead reçoit un score 0-120 (oui, peut dépasser 100 si tous les signaux alignés).

**Décomposition** :

| Dimension | Points max | Calcul |
|---|---|---|
| **Brain V2 confidence** | 30 | (V2 confidence × 0.30). Verdict NON → 0. ENRICH → max 15. |
| **Persona tier** | 20 | Tier 1 (CTO/Co-founder/CEO décideur) = 20, Tier 2 = 12, Tier 3 = 5 |
| **Contact completeness** | 15 | Email VALID + LinkedIn + phone = 15. Email + LI = 10. Email seul = 5. |
| **Signal freshness** | 15 | event ts <7j = 15. 7-30j = 10. 30-90j = 5. >90j = 0. |
| **Multi-source convergence** | 30 | 1 source = 10. 2 sources = 20. ≥3 sources distinctes = 30 (bonus +10) |
| **Outcomes-derived (Phase 6)** | ±10 | Si profil ressemble à conversion passée du client = +10. Si proche d'archivage = -10. |

**Total max théorique** : 120  
**Total min** : 0

**Seuils** :
- ≥80 → **HOT 🔥** (livrer immédiat + notif)
- ≥65 → **WARM ☀️** (livrer normal)
- ≥50 → **WATCHLIST 👀** (surveiller 90j)
- <50 → **IGNORED ⚫** (avec raison documentée)

**Exemple ViaXoft (capteurs propriétaires construits) :**
- V2 OUI confiance 82 → 25 pts
- Eric Barthélémy fondateur tier 1 → 20 pts
- Email + LI + phone → 15 pts
- Signal capturé hier (1j) → 15 pts
- 3 sources convergentes (Apify WTTJ + Press Régionale CTO + INPI dépôt marque) → 30 pts
- Outcomes Phase 6 : profil match conversion antérieure → +5 pts
- **Total : 110/120 → 🔥 HOT ULTRA**

---

## 6. Watchlist 90 jours

### Problème résolu

L'audit A.0.2 a montré que le Brain V2 actuel jette définitivement les leads "ENRICH confiance 58-69" — des leads qui ont **ICP cohérent + signal valide mais data incomplète**. Exemples : Collective.work (Paul Vidal CTO), UNLCK (37p tech FR signal QA explicite). Perdus à jamais.

### Solution

Tout Lead avec score composite [50-65] passe en status **WATCHLIST** au lieu d'IGNORED. Stocké en DB avec TTL 90 jours.

### Mécanique

```
Quand nouveau signal_event arrive pour un SIREN en WATCHLIST :
  → Pattern Matcher re-calcule le score
  → Si score monte ≥65 → promotion WARM (livraison client)
  → Si score reste 50-65 → reset TTL 90j (lead "en attente")
  → Si TTL expire sans nouvelle data → IGNORED avec raison "watchlist_expired_no_new_signal"
```

### Coût additionnel

- Stockage : marginal (centaines de leads en watchlist max par client)
- Compute : Pattern Matcher tourne déjà horaire, juste plus de leads à scanner
- UI : 1 tab supplémentaire dans dashboard

### Valeur estimée

Selon audit, ~12 leads/6mois auraient bénéficié. Soit ~2/mois en plus livrés. Sur 6 mois mature : possiblement 10-20% de leads supplémentaires.

---

## 7. Outcomes Loop (apprentissage)

### Principe

Chaque action client est un signal d'apprentissage :

| Action client | Signal | Impact |
|---|---|---|
| Cal.com RDV bookée | +1 (gold) | "Profil très bon" |
| Email reply positif | +0.5 | "Profil exploitable" |
| Email envoyé manual | +0.3 | "Profil tenté" |
| Lead archivé manuellement | -0.5 | "Profil rejeté commercial" |
| Lead "no_show" Cal.com | -0.3 | "Profil mauvais qualif" |
| Bounce email | -0.2 | "Contact périmé" |
| Reply négatif ("pas intéressé") | -0.5 | "Pitch mauvais" |
| 14 jours sans action sur HOT | -0.1 | "Profil pas prioritaire ?" |

### Re-pondération

Chaque mois, pour chaque client :
1. Récupérer tous les outcomes des 90 derniers jours
2. Pour chaque dimension du score (Brain V2, Persona, Contact, etc.) → mesurer la corrélation avec outcomes positifs
3. Proposer un ajustement des poids (max ±20% par mois pour éviter overfitting)
4. Validation humaine (toi + éventuellement client si engagement fort)
5. Application progressive sur le mois suivant

### Apprentissage des combinaisons

Au-delà des poids dimensionnels, on apprend les **combos qui convertissent** :
- "Levée fundraising + dépôt INPI dans la même fenêtre 60j" → +5 pts bonus
- "Nouveau CTO + DNS Sherlock change de stack 30j après" → +10 pts bonus

### Garde-fous (anti-overfit)

- Minimum 50 outcomes / client avant activation du loop (sinon bruit)
- Bornes max ±20% par mois (pas de changement violent)
- Sauvegarde versionnée du ScanningPlan (rollback possible)

---

## 8. Flux de données end-to-end

### Exemple : "ViaXoft entre dans le système"

```
J0 - 11:55:00 UTC
─────────────────
Capteur P1 (Press Régionale Whisperer) lit Sud Ouest.
Article : "ViaXoft, l'éditeur Marseillais qui révolutionne le tourisme...
          ...recrute son premier VP Engineering, Pierre Durand."
→ Sonnet extract: { person: "Pierre Durand", role: "VP Engineering",
                     company: "ViaXoft", event_type: "c_level_change" }
→ SIRENE attribution: SIREN 49056789
→ Insert signal_events:
  source="press_regionale_whisperer"
  siren="49056789"
  event_type="c_level_change"
  event_ts="J0 - 11:55:00"
  captured_ts="J0 - 11:55:15"
  confidence=0.92
  payload={person, role, source_article_url}

J0 - 11:55:30 UTC
─────────────────
Sensor.emit déclenche le pipeline :
1. Validation Zod ✓
2. Dedup check (pas de doublon dans signal_events 30j) ✓
3. Insert OK
4. Check si SIREN a un Lead actif → OUI (ViaXoft est en pool HOT depuis 1j)
5. Notify Pattern Matcher → ajout à la queue

J0 - 12:00:00 UTC (cron horaire)
─────────────────
Pattern Matcher tourne :
1. Récupère tous les signal_events ViaXoft 90j:
   - J-1 (Apify WTTJ): "QA Engineer Marseille"
   - J0 (Press Régionale): "VP Engineering Pierre Durand"
   = 2 sources distinctes
2. Calcule score composite:
   + Brain V2 OUI conf 82 → 25
   + Persona Eric Barthélémy tier 1 → 20
   + Email VALID + LI + phone → 15
   + Signal freshness 0j → 15
   + Multi-source 2 → 20 (était 10 avant)
   + Outcomes : 0 (pas encore)
   = 95/120 → HOT (était 88 avant Press Régionale)
3. Update Lead.scoreComposite = 95
4. Update Lead.scoreBreakdown = {...}
5. Trigger digest_notification au client (le score a monté)

J0 - 12:05:00 UTC
─────────────────
Dashboard client refresh :
ViaXoft monte en haut de la liste HOT 🔥
Badge "↑ Score monté de 88 à 95 — nouveau signal Press Régionale"
Click → affiche breakdown détaillé.
```

---

## 9. Aspects opérationnels

### 9.1 Crons et fréquences

| Capteur | Fréquence | Pourquoi |
|---|---|---|
| Press Régionale | 1×/heure (RSS) + 1×/6h (scrape diff) | Articles publiés en continu |
| DNS Sherlock | 1×/semaine par boîte | DNS change lentement |
| INPI Marques/Brevets | 1×/jour | Dépôts publiés batch quotidiens |
| Founder Voice | 1×/jour check + 24h transcription | Nouveaux épisodes batch |
| Wappalyzer Diff | 1×/semaine | Stack tech change lentement |
| BOAMP | 1×/jour | Appels d'offres batch |
| BPI / France 2030 | 1×/semaine | Attributions batch |
| GitHub Velocity | 1×/semaine par boîte tech | Activité change lentement |
| Apify (LinkedIn, WTTJ) | 1×/heure (vs 1×/jour actuel) | FIX URGENT latence |
| RSS Levées | 1×/heure | Articles en continu |
| Pattern Matcher | 1×/heure | Re-scoring incrémental |
| Watchlist re-eval | 1×/jour | Pas critique de scanner en continu |
| Outcomes re-weight | 1×/mois | Stabilité statistique |

### 9.2 Lock distribué (vs lock in-memory actuel cassé)

**Problème actuel** : `runPollersLock` est in-memory dans le process Next.js. Si 2 crons tapent en même seconde → collision → 423 LOCKED (vu l'incident 12/05).

**Solution v3.0** : Redis (ou pg_advisory_lock comme alternative no-Redis) pour locks distribués entre crons :
- Lock par capteur (pas global)
- TTL fin (10 min max, auto-release)
- Re-entrant : un cron qui crash libère le lock automatiquement

### 9.3 Monitoring & observabilité

**Tableaux de bord à ajouter** (`/api/internal/health` étendu) :
- **Capteur health** : dernière capture par source (alerte si >freq×2)
- **Volume capture** : events/jour/source (alerte si baisse 50% vs moyenne 7j)
- **Latence p50/p95** : event_ts → captured_ts par source
- **Brain V2** : appels/heure, latence, taux erreur
- **Pattern Matcher** : leads scorés/heure, score moyen
- **Watchlist size** : par client, par mois
- **Outcomes loop** : poids actuels par client

**Alertes Telegram** :
- Capteur silencieux >2× fréquence normale
- Volume capture chute >50%
- Lock cassé / non-libéré
- Erreur Brain V2 >10/heure
- Disk >85%

### 9.4 Tests

**Couverture cible v3.0** : 30% par fichier (vs 7.6% actuel) sur les modules critiques.

**Types** :
- Unit tests : modules lib (priority-scoring, brief-v2, persona, etc.)
- Integration tests : Sensor → normalize → DB
- E2E tests : événement Press Régionale → score updated → dashboard mis à jour

### 9.5 Backup & disaster recovery

**À ajouter Phase 2** :
- pg_dump quotidien chiffré → S3-compatible backup
- Restore tested mensuellement (déjà partiellement via test-restore.sh)
- Snapshots TimescaleDB en cas de migration majeure
- Code repo Git mirrors

---

## 10. Conformité RGPD / CNIL

**Principe directeur** : iFIND ne capte que des **événements publics non-personnels**. Les données personnelles (email, phone, LinkedIn) viennent uniquement de tiers compliant (Kaspr fait sa propre conformité, FullEnrich aussi).

### Ce que iFIND collecte et stocke

| Donnée | Origine | Base légale | Statut |
|---|---|---|---|
| SIREN entreprise | INSEE | Donnée publique entreprise | OK |
| Nom dirigeant (depuis INPI) | INPI | Registre public légal | OK |
| Nom journaliste/article presse | Presse régionale | Article public | OK |
| Nom founder/CEO mention podcast | Audio public | Œuvre publique | OK |
| DNS records | DNS public | Donnée technique publique | OK |
| Email professionnel | Kaspr (responsabilité Kaspr) | Kaspr base légale (à vérifier) | À surveiller |
| Phone professionnel | Kaspr | idem | À surveiller |
| LinkedIn URL profil | Kaspr / HarvestAPI | idem | À surveiller |

### Précédent CNIL Kaspr (240k€ amende déc 2024)

iFIND **ne scrape pas LinkedIn directement**. On utilise Kaspr comme tiers (qui a sa propre conformité — sanctionnée mais existante). Si Kaspr disparaît, on devra trouver une alternative compliant (FullEnrich, Dropcontact).

**Ce qu'iFIND ne fait JAMAIS** :
- Scraper LinkedIn directement (risque CNIL identique Kaspr)
- Collecter données restreintes (visibilité limitée)
- Profiler les individus
- Stocker données personnelles sans base légale

### Droits des personnes

- Email droit-de-suppression@ifind.fr → suppression données dans 30j
- Politique de confidentialité publique
- DPO désigné (à formaliser si plus de 250 employés ou activité régulière à grande échelle)

---

## 11. Risques techniques identifiés

### R1 — Maintenance scrapers fragiles
**Risque** : les sites web (presse régionale, BOAMP, etc.) changent leur HTML toutes les semaines. Nos scrapers cassent.
**Mitigation** :
- Préférer RSS feeds quand disponibles (Press Régionale = la plupart ont RSS)
- Monitor chaque capteur (alerte si 0 capture 2h)
- Fallback graceful : si scraper plante → log + continue avec autres capteurs
- Refresh régulier des sélecteurs CSS (~1h/semaine de maintenance prévue)

### R2 — Founder Voice Radar = compute intensif
**Risque** : transcription Whisper de 200 épisodes × 60min × 5min CPU = 1000 min = 17h CPU/mois.
**Mitigation** :
- Whisper.cpp avec quantization 4-bit (3-5× plus rapide)
- Limiter aux 30-50 podcasts les plus pertinents PME tech FR
- Cron nocturne (charge basse)
- Si charge VPS critique → upgrade Hetzner (+$30/mo)

### R3 — Volume signal_events explose
**Risque** : 17 capteurs × 5000 boîtes × 90j = potentiellement 10M+ events stockés.
**Mitigation** :
- TimescaleDB compression auto (events >30j compressés 90%)
- Retention policy : purge events >12 mois sauf si liés à Lead actif
- Partitioning par mois pour requêtes rapides

### R4 — Disk saturation (audit A.0.4)
**Risque** : disk actuel 77% utilisé, `/opt/lutoya-dev` squatte 27 Gi.
**Mitigation** : cleanup /opt/lutoya-dev avant Phase 2 (libère 27 Gi sur 96). Si insuffisant → upgrade VPS (+30€/mo pour +160 Gi).

### R5 — TimescaleDB lock-in
**Risque** : si on veut migrer DB plus tard, hypertables propriétaires TimescaleDB.
**Mitigation** : TimescaleDB est extension Postgres open source. Migrationable vers Postgres pur si besoin (perte de perf mais data préservée).

### R6 — Anthropic API outage
**Risque** : Brain V2 et capteurs nécessitent Anthropic. Si outage → pas de qualification.
**Mitigation** :
- Queue les leads candidats → traités à la reprise
- Fallback Sonnet si Opus down
- Cache prompt activé (réduit dépendance)

### R7 — Apify quota épuisé (déjà arrivé 03/05)
**Risque** : Apify Starter $29 + usage. Dépassement plafond = capture coupée.
**Mitigation** :
- Circuit breaker à 95% (déjà en place)
- Alerte Telegram à 80%
- Augmenter plafond manuel jusqu'au remplacement par scraper self-hosted Phase 5

### R8 — Anti-bot detection (LinkedIn, Glassdoor)
**Risque** : si on développe nos propres scrapers, LinkedIn nous bannit.
**Mitigation** : on NE scrape PAS LinkedIn directement (cf section RGPD). Pour Glassdoor (si capteur futur) → Smartproxy résidentiel + rotation.

### R9 — Bug Brain V2 = produit cassé
**Risque** : Brain V2 est central. Un bug Opus = tout filtrage compromis.
**Mitigation** :
- Tests régression sur 50 leads passés (re-jouer brief avec nouveau prompt)
- Versioning prompt système (Git)
- Rollback rapide en cas de dérive (audit-heal détecte si nb verdicts NON explose)

### R10 — Données outdated (mémoire A.0.4)
**Risque** : 25-30% data B2B obsolète par an. Email valid → INVALID en 12 mois.
**Mitigation** :
- Refresh email valid avec MillionVerifier $5/mo
- Bounce tracking (déjà en place — bouncedAt + bouncedFromEmail)
- Re-enrichment trigger sur leads watchlist >30j

---

## 12. Trous à combler (honnêteté)

Je liste ici **tout ce que je n'ai pas pensé en détail** dans cette première version. Pas pour décourager, mais pour éviter les angles morts.

### T1 — Migration de schema DB v2 → v3
- Comment migrer `Trigger` vers `signal_events` sans casser ?
- Stratégie blue/green ? Dual-write 30j ?
- Tests de non-régression nécessaires sur DTL en parallèle

### T2 — Backfill historique
- Pour démarrer le système avec 90j de signal_events, il faut backfill toutes les sources sur 90j passés.
- Effort : 5-7 jours dev backfill scripts.
- Coût Anthropic important sur backfill (re-qualify 800+ triggers).

### T3 — Anti-flakiness scrapers
- Comment garantir qu'un scraper cassé ne fait pas planter tout le système ?
- Circuit breaker individuel par capteur (kill switch automatique).
- Maintenance hebdo dédiée sélecteurs CSS.
- Tests de smoke quotidien.

### T4 — Replay/rejeu signaux
- Si bug Brain V2 → comment rejouer des signal_events ?
- Idempotency keys sur emit.
- Script `replay-signal-events.ts` pour rejouer une période.

### T5 — Multi-tenancy à grande échelle
- Aujourd'hui : 1 client réel (DTL). Architecture testée pour ça.
- À 10 clients : Pattern Matcher tourne 10× plus de scorings/heure → OK.
- À 50 clients : monte à 5000 leads × 17 capteurs scorés/h → peut nécessiter sharding ou scoring incrémental smart.

### T6 — Feature flags
- Pour activer/désactiver des règles de scoring sans déploiement.
- LaunchDarkly $$$ ou simple table `feature_flags` en DB.

### T7 — A/B testing du scoring
- Tester en parallèle plusieurs versions du scoring sur un même client.
- Demande infrastructure de comparaison.
- À implémenter Phase 6+.

### T8 — API publique
- Si un client veut intégrer iFIND avec son CRM (HubSpot, Pipedrive, Salesforce).
- API REST documentée OpenAPI.
- Webhooks pour push leads → CRM client.
- Phase 7+ (nice to have).

### T9 — Tests E2E
- Comment tester "événement Press Régionale → score updated → dashboard rafraîchi" automatiquement ?
- Playwright pour le UI.
- Mocks signal_events pour le pipeline backend.

### T10 — Disaster recovery
- Si VPS détruit, combien de temps pour remettre en service ?
- Aujourd'hui : ~4-6h (backup pg_dump + redéploiement code).
- Cible v3.0 : <2h avec scripts automatisés.

---

## 13. Plan de construction par phase

### Phase 2 — Fondations (3 semaines)
- TimescaleDB installation + extension
- Schema `signal_events` + migration progressive depuis Trigger
- Sensor framework abstract class
- Lock distribué (Redis ou pg_advisory_lock)
- Bug fixes Phase 0 : ignoredReason, latence WTTJ, tracking Apify
- Cleanup /opt/lutoya-dev (libérer disk)
- Monitoring étendu /api/internal/health
- Tests unitaires de base

### Phase 3 — Watchlist + Score composite (2 semaines)
- Pattern Matcher cron horaire
- Calcul score composite 0-120 (6 dimensions)
- Watchlist Engine (90j re-évaluation)
- UI Dashboard : breakdown score + tab Watchlist
- Tests E2E

### Phase 4 — Capteurs propriétaires (8 semaines, 1/semaine)
Ordre de construction (par ROI immédiat) :
1. **Semaine 1** : P1 Press Régionale Whisperer
2. **Semaine 2** : P3 INPI Marques/Brevets
3. **Semaine 3** : P6 BOAMP / Marchés Publics
4. **Semaine 4** : P7 BPI / Public Money
5. **Semaine 5** : P2 DNS Sherlock
6. **Semaine 6** : P5 Wappalyzer Stack Diff
7. **Semaine 7** : P8 GitHub Org Velocity
8. **Semaines 8-9** : P4 Founder Voice Radar (le plus complexe, 2 semaines)

Chaque capteur : 5-10 jours dev + 7j shadow + bascule prod.

### Phase 5 — Sources existantes refondues + suppression dead code (3 semaines)
- Refondre 9 capteurs existants dans framework Sensor
- Enterrer apify.indeed-jobs définitivement
- Enterrer theirstack.buying-intent (ROI nul)
- Cleanup Clay residue + FULL_SERVICE
- Migration finale Trigger → signal_events (suppression dual-write)
- Cleanup mégafichier trigger-brief-board.tsx (split par feature)

### Phase 6 — Outcomes Loop (4 semaines)
- Webhooks Cal.com + IMAP replies (existants à activer)
- Schema `client_outcomes` enrichi
- Ingest pipeline (Claude tag automatique)
- Re-pondérateur mensuel
- UI client : tab Apprentissages (montre poids actuels)
- Tests garde-fous anti-overfit

### Phase 7 — Polish & scalabilité (continu)
- Sharding Pattern Matcher si >10 clients
- API publique REST
- Feature flags
- A/B testing scoring
- Disaster recovery <2h
- Tests E2E complets

---

## 14. Métriques techniques de succès

### Métriques opérationnelles
- **TTTD (Time-to-Trigger Delivery)** : médian <24h, p95 <72h sur tous capteurs
- **Disponibilité capteurs** : 99%+ uptime par capteur (mesuré /api/internal/health)
- **Latence Pattern Matcher** : <5min entre nouveau signal et score updated
- **Lock conflicts** : 0% par mois (vs 100% incident actuel)

### Métriques qualité
- **Recall Pépite** : ≥70% des Pépites Brain V2=OUI conf>=80 livrées au client
- **Précision** : ≥85% des leads livrés HOT/WARM sont effectivement exploitables (validation tagging)
- **Faux négatifs Watchlist** : <5% Pépites en watchlist >60j sans promotion (le watchlist doit promouvoir vraiment)

### Métriques économiques
- **Coût par lead livré** : <$30 (vs $46 actuel)
- **Coût Anthropic / lead qualifié** : <$0.50
- **Couverture sources propriétaires** : ≥3 sources distinctes par Pépite HOT (Strike tier)

### Métriques techniques
- **Couverture tests** : 30%+ sur modules critiques
- **Couverture monitoring** : 100% capteurs alertes configurées
- **Disk utilization** : <70% en régime stable
- **CPU load average** : <2.0 (1min) sur VPS

---

## 15. Annexes

### A.15.1 Schema DB v3.0 (extrait)

```sql
-- Nouveau : signal_events (hypertable TimescaleDB)
CREATE TABLE signal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(60) NOT NULL,
  source_version VARCHAR(20) NOT NULL,
  siren VARCHAR(9) NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  event_ts TIMESTAMPTZ NOT NULL,
  captured_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL,
  raw_data JSONB,
  confidence FLOAT NOT NULL DEFAULT 1.0,
  client_id VARCHAR(30),  -- nullable, défini lors du matching avec Lead
  hash VARCHAR(64) NOT NULL  -- pour dedup
);
SELECT create_hypertable('signal_events', 'event_ts', chunk_time_interval => INTERVAL '7 days');
CREATE UNIQUE INDEX idx_signal_events_hash ON signal_events (hash, event_ts);
CREATE INDEX idx_signal_events_siren_ts ON signal_events (siren, event_ts DESC);
CREATE INDEX idx_signal_events_source_ts ON signal_events (source, event_ts DESC);

-- Étendu : Lead (ajout colonnes scoring composite)
ALTER TABLE "Lead" ADD COLUMN score_composite SMALLINT;
ALTER TABLE "Lead" ADD COLUMN score_breakdown JSONB;
ALTER TABLE "Lead" ADD COLUMN watchlist_expires_at TIMESTAMPTZ;
ALTER TABLE "Lead" ADD COLUMN last_signal_at TIMESTAMPTZ;

-- Nouveau : sensor_health (monitoring)
CREATE TABLE sensor_health (
  id SERIAL PRIMARY KEY,
  sensor VARCHAR(60) NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  events_captured_count INT,
  errors_count INT,
  status VARCHAR(20)  -- 'healthy', 'degraded', 'down'
);

-- Étendu : Client (ajout poids scoring dynamiques)
ALTER TABLE "Client" ADD COLUMN scoring_weights JSONB;  -- {brain: 0.30, persona: 0.20, ...}
```

### A.15.2 Formule scoring composite (Python-style pseudocode)

```python
def compute_composite_score(lead, signal_events_90d, client_weights, outcomes_history):
    score = 0
    breakdown = {}
    
    # Dimension 1: Brain V2
    if lead.briefV2.verdict == "OUI":
        score_brain = lead.briefV2.confidence * 0.30
    elif lead.briefV2.verdict == "ENRICH":
        score_brain = min(lead.briefV2.confidence * 0.20, 15)
    else:
        score_brain = 0
    score += score_brain * client_weights.get("brain", 1.0)
    breakdown["brain_v2"] = score_brain
    
    # Dimension 2: Persona tier
    persona_map = {1: 20, 2: 12, 3: 5, None: 0}
    score_persona = persona_map.get(lead.personaTier, 0)
    score += score_persona * client_weights.get("persona", 1.0)
    breakdown["persona"] = score_persona
    
    # Dimension 3: Contact completeness
    score_contact = 0
    if lead.email_valid: score_contact += 5
    if lead.linkedin: score_contact += 5
    if lead.phone: score_contact += 5
    score += score_contact * client_weights.get("contact", 1.0)
    breakdown["contact"] = score_contact
    
    # Dimension 4: Signal freshness
    most_recent = max(e.event_ts for e in signal_events_90d) if signal_events_90d else None
    if most_recent:
        days_old = (now - most_recent).days
        if days_old < 7: score_fresh = 15
        elif days_old < 30: score_fresh = 10
        elif days_old < 90: score_fresh = 5
        else: score_fresh = 0
    else:
        score_fresh = 0
    score += score_fresh * client_weights.get("freshness", 1.0)
    breakdown["freshness"] = score_fresh
    
    # Dimension 5: Multi-source convergence
    distinct_sources = len(set(e.source for e in signal_events_90d))
    if distinct_sources >= 3: score_conv = 30
    elif distinct_sources == 2: score_conv = 20
    elif distinct_sources == 1: score_conv = 10
    else: score_conv = 0
    score += score_conv * client_weights.get("convergence", 1.0)
    breakdown["convergence"] = score_conv
    
    # Dimension 6: Outcomes-derived (Phase 6)
    similarity = compute_similarity_to_conversions(lead, outcomes_history)
    score_outcomes = similarity * 10  # range -10 to +10
    score += score_outcomes * client_weights.get("outcomes", 1.0)
    breakdown["outcomes"] = score_outcomes
    
    return {
        "score": round(score),
        "breakdown": breakdown,
        "tier": classify_tier(score)
    }

def classify_tier(score):
    if score >= 80: return "HOT"
    if score >= 65: return "WARM"
    if score >= 50: return "WATCHLIST"
    return "IGNORED"
```

### A.15.3 Liste exhaustive des `event_type` (signal_events)

| event_type | Capteur producteur | Description |
|---|---|---|
| `job_posting_qa` | Apify, WTTJ, FT, TheirStack | Annonce de recrutement QA |
| `job_posting_dev` | idem | Annonce dev |
| `c_level_change` | Press Régionale, INPI Dirigeants | Nouveau dirigeant |
| `funding_round` | Rodz, RSS Levées | Levée de fonds |
| `merger_acquisition` | Rodz, BODACC | M&A |
| `company_creation` | BODACC, Rodz, INSEE | Nouvelle société |
| `tender_published` | BOAMP | Appel d'offres public |
| `public_funding_received` | BPI, France 2030, FEDER | Argent public attribué |
| `trademark_filing` | INPI | Dépôt de marque |
| `patent_filing` | INPI | Dépôt de brevet |
| `trademark_opposition` | INPI | Opposition marque |
| `tech_stack_add` | Wappalyzer Diff | Ajout techno (ex: Pinecone) |
| `tech_stack_remove` | Wappalyzer Diff | Retrait techno (ex: Auth0) |
| `email_provider_migration` | DNS Sherlock | Migration MX records |
| `crm_change` | DNS Sherlock | Changement CRM (CNAME) |
| `new_subdomain` | TLS CT logs | Nouveau certificat = nouveau produit |
| `founder_pain_point` | Founder Voice | Founder évoque douleur |
| `hiring_intent_signal` | Founder Voice | Founder évoque recrutement |
| `expansion_signal` | Founder Voice | Founder évoque expansion |
| `engineering_growth` | GitHub Velocity | Nouveaux contributors |
| `new_repo` | GitHub Velocity | Nouveau dépôt public |

### A.15.4 Glossaire technique

- **TTTD** : Time-to-Trigger Delivery — délai entre événement publié et livraison au client
- **Hypertable** : table TimescaleDB partitionnée automatiquement par temps
- **Signal event** : événement public horodaté capturé par un capteur
- **ICP** : Ideal Customer Profile — profil client idéal
- **SIREN** : identifiant entreprise française unique 9 chiffres
- **NAF** : nomenclature d'activité française (code secteur)
- **Brain V2** : module Claude Opus qui produit verdict OUI/NON/ENRICH par Trigger
- **Pattern Matcher** : module qui calcule le score composite par Lead
- **Watchlist** : leads en surveillance 90j (score 50-65)
- **Outcomes Loop** : boucle d'apprentissage à partir des actions client

---

## 16. Conclusion

Ce document décrit l'architecture **uniquement technique** d'iFIND v3.0. Il ne dit rien sur les clients, le pricing, ou la stratégie commerciale — ces sujets seront traités dans des documents séparés.

**Points clés à retenir** :

1. **5 couches d'architecture** : Acquisition → Normalisation → Stockage temporel → Intelligence → Présentation
2. **17 capteurs au total** : 9 existants + 8 propriétaires (le moat profond)
3. **Score composite 6-dimensionnel transparent** (vs règle binaire rigide)
4. **Watchlist 90j** : aucun lead borderline n'est perdu
5. **Outcomes Loop** : le système apprend par client (data flywheel)
6. **80% du code v2 réutilisable** : pas de big-bang, ajout progressif
7. **20-22 semaines de construction** (Phase 2 à 6) pour le système complet
8. **Risques techniques identifiés et mitigations** documentés

**Ce que ce document NE résout PAS** (pour transparence) :
- Validation marché du système (qui acheterait ça, à quel prix)
- Cas concret Fred (état de la relation client actuelle)
- Capacité d'exécution réelle (1 personne pour 22 semaines de code)
- Tests de bout en bout avant prod

**Prochaines actions** (pas dans ce doc) :
- A.0.5 Audit ICP réel (séparé)
- A.0.6 Synthèse + GO/NO-GO 1 (séparé)
- Validation pricing (séparé)
- Interview clients potentiels (séparé)
