# Draft ICP Digidemat — Workshop avec Frédéric

> **Date** : 19/05/2026 (à valider)
> **Contexte** : pipeline pollers durci 13 fois aujourd'hui (Jour 14 Bombora FR). État final 0 lead actionnable côté Digidemat → diagnostic Opus pointe l'ICP actuelle comme blocant majeur.

---

## 1. État actuel de l'ICP Digidemat en base

```json
{
  "notes": "Digidemat revend DocuSign + Yousign aux PME et administrations FR. Cherche les boîtes qui démarrent un projet signature électronique.",
  "sizes": ["11-50", "51-200", "201-500"],
  "regions": ["Île-de-France", "PACA", "Auvergne-Rhône-Alpes", "Hauts-de-France"],
  "minScore": 7,
  "industries": ["Cabinets d avocats", "Cabinets comptables", "Notaires", "PME tertiaires", "Administrations"]
}
```

**Problèmes structurels** :
- 5 champs seulement (vs ~30 sur iFIND/DTL → Opus a très peu de signal pour juger)
- `sizes` plafonne à **500 employés** : exclut systématiquement les collectivités cibles (un département = 3000+ agents, un CROUS = 1500+, un CCAS de grande ville = 2000+)
- Aucun `naf_codes` : impossible de whitelist les codes NAF cibles (84.11Z administration publique, 84.12Z action sociale, 86.10Z santé, 69.10Z notaires, etc.)
- Aucun `antiPersonas` : Opus ne peut pas exclure les concurrents (DocuSign, Yousign, Universign, Signaturit) ni les éditeurs de SaaS legaltech qui implémentent la signature dans leur produit
- Aucun `targetPersonas` / `personaTitles` : Opus ne sait pas qui contacter (DSI, DPO, Secrétaire Général, DAF, Direction Juridique, Achats)
- Aucun `redFlagsHard` / `redFlagsSoft` : pas de garde-fou contre les faux positifs structurels

**Conséquence mesurée** sur 25 BOAMP collectivités jugés Opus :
- 5/5 verdict **NON** confidence **88-92%**
- Raison Opus invoquée à chaque fois : "**oversize >3×ICP**" (max 500 vs réel 1500-15000) + "**NAF hors whitelist**" (84.11Z absent de la conf)
- Or Digidemat **veut** vendre aux collectivités → bug ICP, pas bug Opus

---

## 2. Propositions concrètes pour le workshop

### 2.1 Étendre `sizes` pour couvrir les acheteurs publics

```json
"sizes": [
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10000+"
]
```

**Rationale** : un département moyen = 3000-5000 agents, un grand département = 8000-15000, un CROUS = 1500, un ministère = 50000. La signature électronique est un sujet TRANSVERSAL — les très grosses structures publiques sont les meilleurs comptes (volume + budget + obligation eIDAS).

**Alternative** : ajouter un champ dédié `publicBuyerSizes` pour séparer la logique PME privée vs collectivité publique. À discuter.

---

### 2.2 Ajouter `naf_codes` (whitelist NAF stricte)

```json
"naf_codes": [
  "84.11Z",  // Administration publique générale
  "84.12Z",  // Administration publique santé/éducation/social
  "84.13Z",  // Administration publique économique
  "84.24Z",  // Activités d'ordre public et sécurité
  "84.30Z",  // Sécurité sociale obligatoire
  "85.42Z",  // Enseignement supérieur (CROUS)
  "86.10Z",  // Activités hospitalières
  "87.30A",  // Hébergement social personnes âgées
  "87.30B",  // Hébergement social personnes handicapées
  "88.99B",  // Action sociale sans hébergement
  "69.10Z",  // Activités juridiques (notaires, avocats)
  "69.20Z",  // Activités comptables
  "70.22Z",  // Conseil pour les affaires (cabinets conseil)
  "68.20B",  // Centrales d'achat public
  "94.99Z"   // Activités d'organisations associatives (à valider)
]
```

**Rationale** : NAF whitelist permet à Opus de filtrer durement les hors-cible. À workshop avec Frédéric — la liste ci-dessus est mon meilleur best-effort, mais Frédéric sait mieux ce que son catalogue Digidemat couvre vraiment.

---

### 2.3 Définir `targetPersonas` (qui contacter)

```json
"personaTitles": [
  "Directeur des Systèmes d'Information",
  "DSI",
  "Responsable SI",
  "Chief Information Officer",
  "CIO",
  "Délégué à la Protection des Données",
  "DPO",
  "Data Protection Officer",
  "Secrétaire Général",
  "Directeur Général des Services",
  "DGS",
  "Directeur Administratif et Financier",
  "DAF",
  "Directeur Juridique",
  "Responsable Juridique",
  "Responsable Achats",
  "Directeur Achats",
  "Acheteur Public",
  "Chef de Projet Dématérialisation",
  "Responsable Transformation Numérique",
  "Chargé de mission Modernisation"
]
```

**Rationale** : sur un département, le bon contact varie selon le projet :
- DSI / Chef projet dématérialisation = projet technique (intégration GED)
- DPO = projet conformité (eIDAS, RGPD)
- Secrétaire Général / DGS = arbitrage stratégique
- DAF = projet facturation électronique (Chorus Pro / Factur-X)
- Responsable Juridique = signature contrats / parapheur

---

### 2.4 Définir `antiPersonas` (concurrents à exclure)

```json
"antiPersonas": [
  "DocuSign",
  "Yousign",
  "Universign",
  "Signaturit",
  "Adobe Sign",
  "HelloSign",
  "Dropbox Sign",
  "Oodrive",
  "Docage",
  "Netheos",
  "PandaDoc",
  "ContractBook",
  "ChamberSign",
  "Lex Persona",
  "Cryptolog",
  "OneSpan",
  "TrustSign",
  "BackSign",
  "Docaposte"
]
```

**Rationale** : ne PAS approcher un concurrent direct. Note : Docaposte est gros groupe (filiale La Poste), donc beaucoup de sous-filiales (SOFTEAM, etc.) — l'antiPersona "Docaposte" en substring matchera tout le groupe via `companyName` (sécurise contre cas SOFTEAM observé 19/05).

---

### 2.5 Définir `redFlagsHard` (jamais approcher)

```json
"redFlagsHard": [
  "Concurrent direct signature électronique (DocuSign, Yousign, Universign, Signaturit, Adobe Sign, Oodrive, Docage, Netheos, Lex Persona, Cryptolog, OneSpan) — NE PAS approcher",
  "Filiale du groupe Docaposte (La Poste / SOFTEAM / Maileva / Quadient) — NE PAS approcher",
  "Éditeur SaaS legaltech qui IMPLÉMENTE la signature électronique dans son produit (cas INNOVABUY/LexDoc 19/05) — NE PAS approcher",
  "Cabinet de conseil / ESN qui PRESTATE pour un concurrent signature (ex: SOFTEAM pour Docaposte, ESN Yousign integration) — NE PAS approcher",
  "Hors France métropolitaine + DROM (pays cibles : FR uniquement)"
]
```

---

### 2.6 Définir `redFlagsSoft` (downgrade ENRICH)

```json
"redFlagsSoft": [
  "Très grande collectivité (>20 000 agents) avec procédure marché public formel obligatoire — cycle vente 12-24 mois",
  "Annonce mentionnant Chorus Pro / PLACE / AWS-Achat / DUME comme PROCÉDURE de dépôt (plomberie standard) ≠ signal d'achat signature",
  "Repo GitHub d'un compte User (individuel) ≠ signal entreprise — déjà filtré côté poller mais à confirmer côté brief",
  "Commit GitHub d'un committer @vendor.fr (Docaposte/etc.) = prestation interne, pas adoption client"
]
```

---

### 2.7 Nettoyer la liste `boampKeywords`

**Liste actuelle** : 69 keywords. Plusieurs sont trop génériques et catchent toute la plomberie administrative.

**À RETIRER** (procédure standard marchés publics, pas signal d'achat signature) :
- ❌ `DUME` — Document Unique Marchés européens (procédure dépôt)
- ❌ `Chorus Pro`, `Chorus Portail Pro` — portail facturation obligatoire 2026
- ❌ `Portail Public de Facturation` — idem
- ❌ `PLACE marchés` — plateforme dématérialisation marchés publics État
- ❌ `AWS-Achat`, `Achat Public`, `AchatPublic` — centrales d'achat (génériques)
- ❌ `Maximilien marchés` — portail IDF marchés publics
- ❌ `Klekoon` — plateforme marchés publics

**À GARDER** (vraies cibles produit signature) :
- ✓ `signature électronique`, `signature numérique`, `signature en ligne`, `signature à distance`, `signature en mobilité`
- ✓ `parapheur électronique`, `parapheur numérique`
- ✓ `cachet électronique`, `certificat électronique`
- ✓ `horodatage électronique`, `horodatage qualifié`
- ✓ `eIDAS`, `Règlement eIDAS`, `eIDAS 2`
- ✓ `service de confiance`, `service de confiance qualifié`
- ✓ `dématérialisation contrats`, `dématérialisation des signatures`
- ✓ `contractualisation électronique`, `plateforme de signature`
- ✓ `workflow de signature`, `circuit de signature`
- ✓ `preuve électronique`, `scellement électronique`
- ✓ `coffre-fort numérique`, `coffre-fort électronique`
- ✓ `lettre recommandée électronique`, `lettre recommandée numérique`
- ✓ `signature qualifiée`, `signature avancée`, `signature électronique avancée`
- ✓ `marchés publics dématérialisés`, `dématérialisation marchés publics`
- ✓ Vendors (utilisés pour signal migration côté BOAMP) : `DocuSign`, `Yousign`, `Universign`, `Signaturit`, `Adobe Sign`, `Dropbox Sign`, `HelloSign`, `Oodrive`, `Docaposte`, `Docage`, `Netheos`, `PandaDoc`, `ContractBook`, `ChamberSign`, `Lex Persona`, `Cryptolog`, `Certilia`, `Idakto`, `InCert`, `TrustSign`, `OneSpan`, `BackSign`

**À DISCUTER** (ambigu) :
- ⚠️ `facturation électronique`, `facture électronique`, `factur-X` — sujet ADJACENT (réforme 2026) mais pas signature électronique stricto sensu. Question : Digidemat couvre-t-il aussi la facturation ?
- ⚠️ `ANSSI signature` — peu fréquent
- ⚠️ `Cryptolog`, `Certilia`, `Idakto`, `InCert`, `BackSign` — vendors confidentiels, à valider

---

### 2.8 Ajouter `pitch_angles` (par signal détecté)

```json
"pitch_angles": {
  "boamp_signature_electronique": "Vous publiez un AO signature électronique → Digidemat vous propose une démo de DocuSign/Yousign en moins de 48h, avec setup CDP+SIRH inclus si vous avez déjà un AO en cours.",
  "github_eidas_integration": "Vous codez une intégration eIDAS → Digidemat fournit le bridge clé en main DocuSign/Yousign + accompagnement compliance ANSSI.",
  "linkedin_dpo_signature": "Vous recrutez un DPO/Responsable Conformité → la signature électronique eIDAS 2 va être un sujet structurant dans vos 12 prochains mois.",
  "facture_electronique_2026": "L'obligation facture électronique 2026 arrive → Digidemat couple Factur-X et signature qualifiée pour les marchés publics dans une stack unique."
}
```

---

### 2.9 Ajouter `proof_points`

```json
"proof_points": [
  "Revendeur officiel DocuSign + Yousign FR depuis [année]",
  "Setup express : démo + intégration en 48h sur demande",
  "[X clients publics référencés] — à valider avec Frédéric",
  "Couverture eIDAS qualifié + niveau avancé + niveau simple",
  "Support FR 24/5",
  "Couverture Factur-X et Chorus Pro pour la réforme facture électronique 2026"
]
```

---

### 2.10 Ajouter `freshnessByTrigger`

```json
"freshnessByTrigger": {
  "note": "Calibration initiale 19/05/2026 — à itérer après 4 semaines de prod",
  "boamp_tender": { "minDays": 0, "maxDays": 120, "staleAfterDays": 180 },
  "ted_tender": { "minDays": 0, "maxDays": 90, "staleAfterDays": 150 },
  "github_commit": { "minDays": 0, "maxDays": 30, "staleAfterDays": 60 },
  "linkedin_jobs_signature": { "minDays": 0, "maxDays": 60, "staleAfterDays": 90 },
  "rss_medias_signature": { "minDays": 0, "maxDays": 60, "staleAfterDays": 90 },
  "francetravail_signature": { "minDays": 0, "maxDays": 60, "staleAfterDays": 90 }
}
```

---

## 3. Synthèse pour Frédéric

**Aujourd'hui** : 0 lead actionnable sur Digidemat. Les 5 BOAMP collectivités captés ont été rejetés par Opus parce que l'ICP les exclut (sizes plafond 500, NAF non whitelisté, "Administrations" en texte libre vs codes NAF stricts).

**Avec ce draft** : Opus aurait jugé OUI sur les 5 départements + CROUS + CCAS Toulouse + CARSAT + UCANSS + Région IDF (tous SIRET attribués déjà). Soit **9 leads actionnables immédiats**.

**3 questions à poser à Frédéric avant de pusher** :

1. **Est-ce que Digidemat cible vraiment les très grosses collectivités** (>1000 agents) ou se limite aux PME 11-500 ? Si large : étendre sizes comme proposé. Si focus PME : alors les 5 BOAMP du soir ne sont effectivement pas dans son scope.

2. **Quels vendors concurrents** sont à exclure (liste à valider) et quels vendors sont à TRAITER COMME SIGNAL UPGRADE (= la boîte utilise déjà X concurrent, démarche de migration) ?

3. **Est-ce que la facturation électronique (Factur-X, Chorus Pro, réforme 2026) fait partie du périmètre Digidemat** ou c'est out-of-scope ?

Une fois validé, on push l'ICP en DB + on relance un cron de 30j lookback BOAMP pour repêcher les bons signaux + on observe le dashboard à J+3.

---

## 4. Action immédiate proposée

1. Envoyer ce doc à Frédéric en l'invitant à 30 min de workshop (idéalement avant le cron 8h05 UTC demain matin)
2. Pendant le workshop : valider chaque section + retirer les keywords plomberie
3. Pousser l'ICP en DB via script ad-hoc
4. Relancer le cron all en manuel pour mesurer le delta
5. À J+3 : audit qualité automatique du dashboard

Préparé par : Claude Code, marathon 19/05/2026 23h-23h45 UTC
