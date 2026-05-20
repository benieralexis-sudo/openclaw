# 5 Pépites Digidemat — détection automatique BOAMP 19-20/05/2026

> Exporté le 2026-05-20T10:39:51.980Z après restauration post-fix bug regex.
> Toutes les Pépites ci-dessous ont été validées par Opus 4.7 avec un verdict OUI/ENRICH (confidence ≥82%).
> **Persona décideur** : non enrichie (Apify quota cap). À identifier via Sales Navigator OU recharge Apify $120→$200.

---

## ⭐⭐⭐ Pépite #1 — UCANSS

| Champ | Valeur |
|---|---|
| SIRET | 784621435 |
| NAF | 84.30A |
| Verdict Opus | **OUI** (confidence **88%**) |
| AO BOAMP | [26-47359](https://www.boamp.fr/pages/avis/?q=idweb:26-47359) |
| Date parution | 2026-05-13 |
| Date limite réponse | **2026-06-15** |
| Statut DL | ✅ ouvert |

**Objet AO** : FOURNITURE DE CERTIFICATS DE SIGNATURES ET DE CACHETS ELECTRONIQUES POUR LES ORGANISMES DE SECURITE SOCIALE
Date limite réponse : 2026-06-15T12:00:00+00:00
Département : 93
URL : https://www.boamp.fr/pages/avis/?q=idweb:26-47359

### Thèse Opus

> UCANSS (Union des Caisses Nationales de Sécurité Sociale, NAF 84.30A [src:#1]) publie un appel d'offres BOAMP explicite pour 'fourniture de certificats de signatures et de cachets électroniques pour les organismes de sécurité sociale' [src:#2]. Signal d'achat dur, daté, public, parfaitement ICP (établissement public, NAF whitelist Digidemat). Date limite 2026-06-15, fenêtre d'action serrée mais exploitable.

### Opener prêt à envoyer

```
Bonjour,

J'ai vu votre publication BOAMP du 13 mai concernant la fourniture de certificats de signature et de cachets électroniques pour les organismes de sécurité sociale (date limite 15 juin).

Chez Digidemat, nous accompagnons spécifiquement les établissements publics et administrations sur ce type de déploiement signature électronique multi-entités. Nous avons l'expérience des contraintes RGS / eIDAS et de l'intégration aux SI métiers du secteur social.

Avant la date limite de réponse, seriez-vous disponible pour un échange de 30 min ? L'idée : comprendre vos enjeux d'usage (volume, périmètre organismes, intégration Chorus / SI métier) pour calibrer une réponse pertinente.

Bien cordialement,
```

### Risques identifiés Opus

- **high** — Marché public formel BOAMP [src:#2] : la décision passera par un cahier des charges et une procédure d'appel d'offres (réponse formelle requise avant 2026-06-15). Approche commerciale ≠ vente directe, c'est un dépôt d'offre. Le commercial doit aligner avec son équipe avant-vente / réponse AO.
- **medium** — Persona décideur non identifié [src:#3] : impossible de cibler DSI/DPO/Responsable Achats UCANSS sans enrichissement LinkedIn. Risque d'envoyer l'opener à un contact périphérique. Recommandation : finder LinkedIn sur 'DSI UCANSS' ou 'Responsable Achats UCANSS' avant outreach personnalisé.
- **low** — AO porte sur 'organismes de sécurité sociale' au pluriel — UCANSS centralise pour le réseau CNAM/CNAV/CAF/URSSAF. Volume potentiel important mais complexité multi-entités à anticiper.

### Persona à identifier (titres ICP Digidemat)

- DSI / Responsable SI / CIO de l'organisation
- DPO / Délégué Protection Données
- Directeur/Responsable Achats / Acheteur Public
- Chef de Projet Dématérialisation / Responsable Transformation Numérique

---

## ⭐⭐⭐ Pépite #2 — CNFPT - Direction de l'achat public

| Champ | Valeur |
|---|---|
| SIRET | 180014045 |
| NAF | 85.59A |
| Verdict Opus | **OUI** (confidence **88%**) |
| AO BOAMP | [26-40611](https://www.boamp.fr/pages/avis/?q=idweb:26-40611) |
| Date parution | 2026-04-23 |
| Date limite réponse | **2026-05-18** |
| Statut DL | ❌ dépassé |

**Objet AO** : FOURNITURE, MISE EN OEUVRE ET MAINTENANCE D'UNE SOLUTION DE GESTION ELECTRONIQUE DES DOCUMENTS (GED) TRANSVERSE POUR LE CNFPT
Date limite réponse : 2026-05-18T14:00:00+00:00
Département : 75
URL : https://www.boamp.fr/pages/avis/?q=idweb:26-40611

### Thèse Opus

> CNFPT (Centre National de la Fonction Publique Territoriale) publie un appel d'offres BOAMP pour une solution GED transverse [src:#1] — signal d'achat dur et public, fenêtre de réponse jusqu'au 18/05/2026. Établissement public de formation des agents territoriaux, NAF 85.59A (enseignement) en marge whitelist mais ICP fonctionnel (administration/établissement public) [src:#2]. GED transverse = adjacence directe dématérialisation, opportunité de positionner Digidemat sur le volet signature/workflow documentaire.

### Opener prêt à envoyer

```
Bonjour,

J'ai vu la publication BOAMP du 23/04 concernant votre projet de GED transverse pour le CNFPT. Au-delà du périmètre GED, ce type de chantier s'accompagne souvent d'enjeux signature électronique et workflow de validation documentaire — sujets sur lesquels Digidemat accompagne plusieurs établissements publics et collectivités.

La date limite de réponse au marché étant passée, je voulais surtout prendre contact en amont des prochaines étapes (déploiement, marchés satellites signature/parapheur).

Seriez-vous disponible 20 min pour échanger sur votre roadmap dématérialisation 2026 ?
```

### Risques identifiés Opus

- **medium** — Marché public formel via BOAMP [src:#1] = cycle de vente long (3-9 mois), réponse via dossier de candidature DCE, pas d'approche commerciale directe possible avant attribution. Le commercial doit vérifier si Digidemat peut répondre seul ou en groupement.
- **medium** — NAF 85.59A (autres enseignements) hors whitelist stricte (84.* + 85.42Z attendus pour établissements publics formation) [src:#2] — à confirmer mais CNFPT est un EPA national reconnu, le NAF ne traduit pas un hors-ICP réel.
- **low** — Date limite 18/05/2026 [src:#1] — captation 20/05, donc fenêtre de réponse formelle déjà fermée. Reste l'opportunité d'identifier les futurs marchés satellites (signature, workflow) ou de suivre l'attribution pour se positionner en sous-traitance.

### Persona à identifier (titres ICP Digidemat)

- DSI / Responsable SI / CIO de l'organisation
- DPO / Délégué Protection Données
- Directeur/Responsable Achats / Acheteur Public
- Chef de Projet Dématérialisation / Responsable Transformation Numérique

---

## ⭐⭐ Pépite #3 — CONSEIL DEPARTEMENTAL DU CALVADOS (CD 14)

| Champ | Valeur |
|---|---|
| SIRET | 517974432 |
| NAF | 94.12Z |
| Verdict Opus | **OUI** (confidence **82%**) |
| AO BOAMP | [26-42728](https://www.boamp.fr/pages/avis/?q=idweb:26-42728) |
| Date parution | 2026-04-29 |
| Date limite réponse | — |
| Statut DL | ⚠️ inconnu (à vérifier site BOAMP) |

**Objet AO** : Acquisition, déploiement, maintenance et prestations complémentaires d'un logiciel de gestion électronique de documents (GED)
Département : 14
URL : https://www.boamp.fr/pages/avis/?q=idweb:26-42728

### Thèse Opus

> Conseil Départemental du Calvados (NAF 94.12Z, collectivité territoriale ICP-fit) publie un appel d'offres BOAMP pour acquisition, déploiement et maintenance d'une GED [src:#1]. Signal d'achat dur, daté (publié 2026-04-29, 21j) dans la fenêtre fraîcheur boamp_tender (J+0→J+120) [src:#1]. GED = brique amont directe de la dématérialisation documentaire et adjacente à la signature électronique : sujet stratégique pour Digidemat.

### Opener prêt à envoyer

```
Bonjour,

J'ai vu la publication BOAMP du 29 avril du Conseil Départemental du Calvados pour l'acquisition d'une GED — projet structurant qui touche directement aux flux documentaires entrants/sortants de vos directions.

Chez Digidemat, nous accompagnons plusieurs conseils départementaux sur la brique signature électronique en aval de leur GED : circuits de validation, parapheur dématérialisé, conformité eIDAS. L'enjeu classique post-déploiement GED, c'est l'orchestration des signatures sans recréer une couche d'outils silotés.

Si le sujet est dans votre périmètre (DSI / DGS / Chef de projet dématérialisation), 30 min pour échanger sur les retours d'expérience d'autres collectivités sur ce couplage GED + signature ?
```

### Risques identifiés Opus

- **medium** — Cycle marché public formel BOAMP : décision longue (3-9 mois), procédure encadrée. Approche directe utile pour positionner Digidemat en amont, mais le deal réel passera par réponse formelle à l'AO ou marché subséquent [src:#1].
- **medium** — Objet du marché = GED (gestion documentaire), pas signature électronique stricto sensu. Risque que le décideur priorise l'éditeur GED et traite la signature comme module secondaire. Angle d'attaque : se positionner comme complément interopérable au futur outil GED.
- **low** — Taille effectif CD14 inconnue dans le dossier mais conseils départementaux français sont typiquement 1500-3000 agents (dans ICP 1001-5000). Pas un département XXL >20000 agents (redFlagSoft non déclenché).

### Persona à identifier (titres ICP Digidemat)

- DSI / Responsable SI / CIO de l'organisation
- DPO / Délégué Protection Données
- Directeur/Responsable Achats / Acheteur Public
- Chef de Projet Dématérialisation / Responsable Transformation Numérique

---

## ⭐⭐ Pépite #4 — Centre Hospitalier de Lens

| Champ | Valeur |
|---|---|
| SIRET | 266209329 |
| NAF | 86.10Z |
| Verdict Opus | **OUI** (confidence **82%**) |
| AO BOAMP | [26-42860](https://www.boamp.fr/pages/avis/?q=idweb:26-42860) |
| Date parution | 2026-04-28 |
| Date limite réponse | — |
| Statut DL | ⚠️ inconnu (à vérifier site BOAMP) |

**Objet AO** : Affaire 2026-014 - Ght - Externalisation de la gestion des dossiers chômage et dématérialisation des attestations employeurs pour les Hôpitaux Publics de l'Artois
Département : 62
URL : https://www.boamp.fr/pages/avis/?q=idweb:26-42860

### Thèse Opus

> Centre Hospitalier de Lens (NAF 86.10Z [src:#1], ICP santé/établissement public parfait) publie un avis BOAMP 2026-014 pour 'externalisation gestion dossiers chômage et **dématérialisation des attestations employeurs**' pour les Hôpitaux Publics de l'Artois [src:#2]. Signal d'achat dur : besoin dématérialisation explicitement formulé dans marché public frais (publié J-22, capté J+0), avec dimension GHT donc volumétrie multi-établissements.

### Opener prêt à envoyer

```
Bonjour,

J'ai vu votre avis BOAMP 2026-014 publié fin avril concernant l'externalisation de la gestion des dossiers chômage et la dématérialisation des attestations employeurs pour les Hôpitaux Publics de l'Artois.

Le volet démat attestations est exactement notre cœur de métier chez Digidemat : nous accompagnons plusieurs CH et GHT sur la dématérialisation des flux RH (attestations employeurs, certificats de travail, soldes de tout compte) avec signature électronique conforme eIDAS et archivage à valeur probante.

Avant le lancement formel de la consultation, seriez-vous disponible pour un échange de cadrage 30 min ? L'idée : partager nos retours d'expérience sur des projets similaires en milieu hospitalier public et vous aider à structurer le cahier des charges côté démat.

Bien cordialement,
```

### Risques identifiés Opus

- **medium** — Marché public hospitalier GHT [src:#2] : cycle vente formel via procédure (DUME/PLACE probable), délai contractuel 3-6 mois minimum. Le commercial doit se positionner vite côté sourcing avant la phase de candidature formelle, idéalement obtenir une réunion de cadrage avec la DSI ou DAF AVANT publication DCE.
- **medium** — Persona décideur non identifié dans le dossier : un CH de cette taille peut avoir DSI, DAF, DRH (sujet attestations employeurs = RH), Secrétaire Général GHT — risque d'adresser le mauvais interlocuteur. Cibler en priorité le DRH (sponsor métier attestations employeurs) avec copie DSI.
- **low** — Périmètre dominant de l'avis = externalisation gestion dossiers chômage (prestation RH/BPO) ; la dématérialisation est un composant. Vérifier que Digidemat peut entrer en sous-traitance ou en lot séparé démat, sinon risque d'arriver après l'attribution du marché global.

### Persona à identifier (titres ICP Digidemat)

- DSI / Responsable SI / CIO de l'organisation
- DPO / Délégué Protection Données
- Directeur/Responsable Achats / Acheteur Public
- Chef de Projet Dématérialisation / Responsable Transformation Numérique

---

## ⭐ Pépite #5 — SICIO

| Champ | Valeur |
|---|---|
| SIRET | 259400117 |
| NAF | 84.11Z |
| Verdict Opus | **OUI** (confidence **82%**) |
| AO BOAMP | [26-43311](https://www.boamp.fr/pages/avis/?q=idweb:26-43311) |
| Date parution | 2026-04-29 |
| Date limite réponse | **2026-06-11** |
| Statut DL | ✅ ouvert |

**Objet AO** : Acquisition, mise en oeuvre et maintenance d'un logiciel de gestion de courriers dématérialisés.
Date limite réponse : 2026-06-11T12:00:00+00:00
Département : 94
URL : https://www.boamp.fr/pages/avis/?q=idweb:26-43311

### Thèse Opus

> SICIO (SIREN 259400117, NAF 84.11Z administration publique générale, département 94) publie un appel d'offres BOAMP frais (publié 2026-04-29, capté J+0) [src:#1] pour l'acquisition, mise en œuvre et maintenance d'un logiciel de gestion de courriers dématérialisés. Cible cœur ICP Digidemat (collectivité/administration FR + projet dématérialisation actif avec budget identifié). Date limite réponse 2026-06-11 → fenêtre d'action serrée mais exploitable.

### Opener prêt à envoyer

```
Bonjour,

J'ai vu votre avis BOAMP publié fin avril concernant l'acquisition d'un logiciel de gestion de courriers dématérialisés (réponse attendue d'ici le 11 juin).

Chez Digidemat, nous accompagnons des collectivités et administrations sur exactement ce périmètre : dématérialisation entrante/sortante, workflows de validation, archivage légal, intégration parapheur. Plusieurs de nos clients dans le 94 et alentours ont structuré leur appel d'offres avec notre support amont.

Si pertinent dans votre calendrier, 30 min pour échanger sur vos critères techniques et voir si nous pouvons répondre au DCE ?
```

### Risques identifiés Opus

- **medium** — Procédure marché public formelle [src:#1] : cycle de vente cadré par le code de la commande publique, concurrence ouverte, critères d'attribution figés dans le DCE. Vérifier si Digidemat peut répondre dans les délais (réponse avant 2026-06-11, soit ~3 semaines) et si l'offre standard matche le cahier des charges.
- **medium** — NAF 84.11Z (administration publique générale) + département 94 mais taille effectif inconnue [src:#2] : si >20 000 agents → redFlagSoft client (cycle 12-24 mois, plomberie marché public lourde). Identifier SICIO précisément (commune ? syndicat intercommunal ? établissement public ?) pour calibrer l'approche.
- **low** — Persona décideur non identifié : DSI / Responsable Achats / Chef de Projet Dématérialisation à trouver côté SICIO avant l'opener nominatif. LinkedIn finder ou annuaire service-public.fr recommandé.

### Persona à identifier (titres ICP Digidemat)

- DSI / Responsable SI / CIO de l'organisation
- DPO / Délégué Protection Données
- Directeur/Responsable Achats / Acheteur Public
- Chef de Projet Dématérialisation / Responsable Transformation Numérique

---

## Synthèse exec

- **5 Pépites** verdict Opus OUI 82-88%, ICP-fit (collectivités/établissements publics FR, NAF 84-94)
- **2 AO encore ouverts** : UCANSS (DL 15/06) + SICIO (DL 11/06) — priorité absolue outbound
- **1 AO dépassé** : CNFPT (DL 18/05) — garder la persona pour prochain AO CNFPT
- **2 AO sans DL en raw** : CD Calvados + CH Lens — vérifier statut sur site BOAMP
- **Personas non enrichies** : Apify à 95% du quota ($114/$120). Options : recharge $120→$200 (~30 minutes setup) OU recherche manuelle Sales Navigator (~15 min/cible).

## Bug fixé pendant la session (20/05 matin)

Les 4 Pépites BOAMP collectivités étaient soft-deletées chaque matin par un bug regex.
Détail : `theirstack-poller.ts:956` utilisait `/it/i` sans word boundaries → matchait
substring "it" dans "Collectivités territoriales" → ICP Digidemat marquée à tort tech →
pruning NAF non-tech supprimait tous les triggers collectivités récents. Patch poussé
(`38527614f`) + déployé. Tests 1017/1017 verts. Voir commit pour détails.