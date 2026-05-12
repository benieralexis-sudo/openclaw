# Trigger Engine v3.0 — Phase 0 : Cadrage Audit Exhaustif

**Version** : 1.0 · **Créé** : 12/05/2026 nuit · **Owner** : Jojo · **Durée Phase 0** : 7-10 jours

---

## 🎯 Objectif Phase 0

**Comprendre exactement** ce qu'on a aujourd'hui avant de construire la v3.0. Aucun build, aucune décision produit, aucun changement prod. Uniquement de l'audit, de la mesure, de la documentation.

À la sortie : tu peux résumer en 3 phrases (1) ce qui marche, (2) ce qui ne marche pas, (3) ce qu'on garde pour v3.0.

## 🧱 Préalables (à faire dimanche 13/05 avant kick-off lundi)

1. **Créer dossier audit** dans le repo iFIND :
   ```bash
   mkdir -p /opt/moltbot/audit/v3-phase-0/{queries,data,screenshots}
   ```

2. **Tag de référence Git** (snapshot avant tout audit, sécurité rollback) :
   ```bash
   cd /opt/moltbot && git tag pre-phase-0-audit-12mai
   git push origin pre-phase-0-audit-12mai
   ```

3. **Activer mode lecture seule mentale** : interdiction de "corriger en passant" un bug ou refactoriser pendant l'audit. Si tu vois quelque chose, tu l'écris dans le doc, tu ne touches pas. Discipline absolue.

4. **Bloquer 1h calendrier quotidien** (matin de préférence) consacrée à l'audit Phase 0. Pas de prospection, pas de Fred, pas d'incident-fixing pendant ce créneau.

---

## 📋 Vue d'ensemble des 6 sous-tâches

| # | Sous-tâche | Durée | Livrable | Critère sortie |
|---|---|---|---|---|
| A.0.1 | Audit pipeline capture actuel | 2 jours | `audit/01-pipeline-actuel.md` | Tableau quantifié 9 sources, 3 mois data |
| A.0.2 | Audit qualité leads livrés 6 mois | 3 jours | `audit/02-qualite-leads-6mois.md` | Matrice 200-300 leads tagués Pépite/OK/hors-ICP |
| A.0.3 | Audit code produit & dette | 1.5 jours | `audit/03-architecture-actuelle.md` | Carte modules réutilisables v3 vs à refondre |
| A.0.4 | Audit infrastructure & coûts | 1 jour | `audit/04-couts-infrastructure.md` | Décomposition coûts mensuels exacts |
| A.0.5 | Audit ICP Fred réel vs déclaré | 1.5 jours | `audit/05-icp-fred-reel-vs-declare.md` | ICP affiné basé sur outcomes |
| A.0.6 | Synthèse + recommandations | 1 jour | `audit/00-synthese.md` | Doc maître résumé exécutif |

Total : **10 jours** (avec marge 30% sur estimation initiale).

---

## A.0.1 — Audit pipeline capture actuel

**Durée** : 2 jours (~14h)  
**Livrable** : `/opt/moltbot/audit/v3-phase-0/01-pipeline-actuel.md`

### Questions précises à répondre

Pour chacune des 9 sources actives (RSS levées / INPI / BODACC / France Travail / Pappers / Apify / TheirStack / Rodz / Kaspr) :

1. **Volume capté /mois** sur les 3 derniers mois (fév-avr 2026) ?
2. **Latence event_timestamp → DB.created_at** : médiane, p95, p99 ?
3. **Taux d'erreur** (timeout, parse fail, HTTP 4xx/5xx) sur 30 derniers jours ?
4. **Taux dédup** : combien d'events captés sont déjà en DB ?
5. **Couverture SIRENE** : % events avec SIRET attribué vs sans ?
6. **Pattern temporel** : capture stable, bursty, intermittent ?
7. **Coût par event capté** (cost source / events captés) ?
8. **Quel pourcentage finit en Lead créé** ? (funnel capture → trigger → lead)

### SQL préparé

À adapter selon nom exact des tables Prisma. Hypothèse de noms basée sur schéma actuel.

**Q1 — Volume par source / mois**
```sql
SELECT 
  source,
  date_trunc('month', "createdAt") AS month,
  COUNT(*) AS events_count,
  COUNT(DISTINCT siret) AS unique_sirets,
  COUNT(*) FILTER (WHERE siret IS NULL) AS without_siret,
  ROUND(100.0 * COUNT(*) FILTER (WHERE siret IS NULL) / COUNT(*), 1) AS pct_without_siret
FROM "Trigger"
WHERE "createdAt" > NOW() - INTERVAL '3 months'
GROUP BY source, month
ORDER BY month DESC, source;
```

**Q2 — Latence event → DB**
```sql
SELECT 
  source,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("createdAt" - "eventTimestamp"))) AS median_latency_sec,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("createdAt" - "eventTimestamp"))) AS p95_latency_sec,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("createdAt" - "eventTimestamp"))) AS p99_latency_sec
FROM "Trigger"
WHERE "createdAt" > NOW() - INTERVAL '30 days'
  AND "eventTimestamp" IS NOT NULL
GROUP BY source
ORDER BY median_latency_sec DESC;
```

**Q3 — Funnel capture → Lead**
```sql
SELECT 
  t.source,
  COUNT(DISTINCT t.id) AS triggers_captured,
  COUNT(DISTINCT t."leadId") FILTER (WHERE t."leadId" IS NOT NULL) AS triggers_linked_to_lead,
  ROUND(100.0 * COUNT(DISTINCT t."leadId") FILTER (WHERE t."leadId" IS NOT NULL) / NULLIF(COUNT(DISTINCT t.id), 0), 1) AS pct_converted_to_lead
FROM "Trigger" t
WHERE t."createdAt" > NOW() - INTERVAL '3 months'
GROUP BY t.source
ORDER BY pct_converted_to_lead DESC;
```

### Méthodologie complémentaire

- **Lecture code de chaque poller** : noter dans le doc (a) fréquence cron réelle, (b) timeout, (c) retry logic, (d) circuit breaker
- **Logs production 7 jours** : grep les sources dans logs systemd/journalctl pour patterns d'erreur
- **Cas spéciaux à creuser** : 
  - TheirStack (76% quota utilisé 10j, gate 6,14 UTC actuel)
  - Apify (plafond $70 atteint historique, circuit breaker 95%)
  - Pappers (cache in-process 1h)

### Template doc à produire

```markdown
# Audit Pipeline Capture Actuel — Phase 0 v3.0
**Date** : 12/05/2026 → 14/05/2026
**Période analysée** : 12/02/2026 → 12/05/2026 (3 mois)

## Synthèse exécutive (3 phrases max)
[à remplir en dernier]

## Tableau de bord 9 sources

| Source | Volume/mois | Latence médiane | Erreurs % | % SIRET | Pattern | Coût/event |
|---|---|---|---|---|---|---|
| RSS Levées | ... | ... | ... | ... | ... | $0 |
| INPI | ... | ... | ... | ... | ... | $0 |
| BODACC | ... | ... | ... | ... | ... | $0 |
| France Travail | ... | ... | ... | ... | ... | $0 |
| Pappers | ... | ... | ... | ... | ... | $0.X |
| Apify | ... | ... | ... | ... | ... | $0.X |
| TheirStack | ... | ... | ... | ... | ... | $0.X |
| Rodz | ... | ... | ... | ... | ... | one-shot |
| Kaspr | ... | ... | ... | ... | ... | $0.X |

## Détails par source
[1 section /source avec données brutes, observations, problèmes identifiés]

## Funnel capture → Trigger → Lead
[Tableau avec taux conversion par source]

## Problèmes identifiés
- [bug 1] : [description] · sévérité haute/moyenne/basse
- [bug 2] : ...
- ...

## Sources à enterrer / garder / refondre (décision v3.0)
- ENTERRER : [...]
- GARDER (universel v3) : [...]
- REFONDRE (framework capteurs) : [...]
```

### Critère de sortie A.0.1

✅ Tu peux dire pour chaque source : volume mensuel, latence, fiabilité, coût, ROI.  
✅ Tu as une liste tangible des sources à enterrer/garder/refondre en Phase 4.

---

## A.0.2 — Audit qualité leads livrés 6 mois

**Durée** : 3 jours (~20h)  
**Livrable** : `/opt/moltbot/audit/v3-phase-0/02-qualite-leads-6mois.md`

C'est l'audit **le plus important** de Phase 0. C'est lui qui dit si la stratégie v3.0 a du sens.

### Questions précises

1. Sur les 200-300 leads livrés à Fred depuis novembre 2025, **combien sont des vraies Pépites** (vraie correspondance ICP + signal d'achat valide) ?
2. **Combien de signaux distincts** chaque lead avait-il en moyenne au moment du livraison ?
3. **Quels signaux** ont réellement converti (Cal.com booking, reply positif IMAP) ?
4. **Quels signaux** n'ont JAMAIS converti (faux positifs systématiques) ?
5. **Quelle latence** signal → livraison (TTTD actuelle) ?
6. **Qu'est-ce qui distingue** une Pépite convertie vs une non-convertie ?

### Méthodologie

**Étape 1 — Export raw (1h)**
```sql
SELECT 
  l.id,
  l.siret,
  l."companyName",
  l."contactName",
  l."contactJobTitle",
  l."qualifyScore",
  l."qualifyV2Verdict",
  l."briefV2Json",
  l."personaSource",
  l."createdAt" AS lead_created_at,
  l."status",
  l."doNotContactReason",
  -- Outcomes
  COUNT(DISTINCT o.id) FILTER (WHERE o.type = 'CAL_BOOKED') AS cal_bookings,
  COUNT(DISTINCT o.id) FILTER (WHERE o.type = 'EMAIL_REPLY_POSITIVE') AS replies_positive,
  COUNT(DISTINCT o.id) FILTER (WHERE o.type = 'EMAIL_REPLY_NEGATIVE') AS replies_negative,
  COUNT(DISTINCT o.id) FILTER (WHERE o.type = 'ARCHIVED') AS archived,
  -- Signaux
  ARRAY_AGG(DISTINCT t.source) AS triggers_sources,
  COUNT(DISTINCT t.source) AS distinct_signal_count,
  MIN(t."eventTimestamp") AS earliest_signal,
  MAX(t."eventTimestamp") AS latest_signal,
  EXTRACT(EPOCH FROM (l."createdAt" - MAX(t."eventTimestamp"))) / 3600 AS tttd_hours
FROM "Lead" l
LEFT JOIN "Outcome" o ON o."leadId" = l.id
LEFT JOIN "Trigger" t ON t."leadId" = l.id
WHERE l."clientId" = 'cl_dtl_id_here'
  AND l."createdAt" > NOW() - INTERVAL '6 months'
GROUP BY l.id
ORDER BY l."createdAt" DESC;
```

Export CSV → `/opt/moltbot/audit/v3-phase-0/data/leads-6mois-dtl.csv`

**Étape 2 — Tagging manuel (12-15h)**

Sur ces ~200-300 leads, tagger manuellement chacun :
- `pepite_vraie` (vraie Pépite, signal valide, ICP match, prospect intéressant)
- `ok` (lead correct, pas exceptionnel mais exploitable)
- `hors_icp` (mauvaise verticale, mauvaise taille, ESN, etc.)
- `inexploitable` (info manquante, contact périmé, etc.)
- `tagging_notes` : 1 phrase justification

**Tip** : tagger par batch de 30 leads × 4 sessions. Pas tout d'un coup, biais de fatigue.

**Étape 3 — Croisement outcomes (3h)**

Pour chaque catégorie tagué :
- Quel % a eu un Cal booking ?
- Quel % a eu un reply positif ?
- Quel % a fini archivé manuellement ?
- Quels signaux étaient présents ?

**Étape 4 — Analyse "qui a converti vs qui non" (4h)**

Tableaux pivot Excel/Sheets :
- Conversion rate par nombre de signaux (1 / 2 / 3 / 4 / 5+)
- Conversion rate par combo de sources (RSS+INPI / Apify+TheirStack / etc.)
- Conversion rate par persona (CTO / CEO / CFO / VP Eng)
- Conversion rate par taille effectif

### Template doc à produire

```markdown
# Audit Qualité Leads 6 mois — Phase 0 v3.0

## Synthèse exécutive
Sur N leads livrés à Fred du 12/11/2025 au 12/05/2026 :
- X% sont de vraies Pépites
- Y% sont OK
- Z% sont hors-ICP
- W% sont inexploitables

Le **signal #1 corrélé à la conversion** est : [...]
La **règle de convergence ≥3 signaux** aurait capté **X%** des leads convertis (vs Y% des hors-ICP).

## Distribution qualité 200-300 leads
[Pie chart + tableau]

## Matrice de confusion : tagging × outcome
| Tag | N | Cal booked | Reply+ | Archived | Net conv % |
|---|---|---|---|---|---|
| pepite_vraie | ... | ... | ... | ... | ... |
| ok | ... | ... | ... | ... | ... |
| hors_icp | ... | ... | ... | ... | ... |
| inexploitable | ... | ... | ... | ... | ... |

## Backtest règle convergence triple
- Sur N leads : ≥3 signaux convergents 90j → M leads filtrés (K convertis)
- Capture rate : K/total convertis = X%
- Specificity : (total non-convertis filtrés) / (total non-convertis) = Y%

→ **VERDICT** : seuil optimal = [2 / 3 / 4 / 5] signaux

## Signaux qui convertissent vs ceux qui ne convertissent jamais
[Tableau : source / volume / taux conversion / commentaire]

## Persona qui convertit le mieux
[Tableau effectif × seniority × verticale]

## Recommandations v3.0
- Capteurs à prioriser construction : [...]
- Capteurs à enterrer : [...]
- Règle convergence à adopter : [...]
- Seuils Brain à recalibrer : [...]
```

### Critère de sortie A.0.2

✅ Tu connais le taux réel de Pépites livrées (probablement entre 15% et 45%, à mesurer).  
✅ Tu sais quels signaux convertissent vraiment.  
✅ Tu sais si la règle convergence triple a du sens (backtest validé ou pas).  
✅ Tu as une baseline chiffrée mesurée pour comparer la v3.0 plus tard.

---

## A.0.3 — Audit code produit & dette technique

**Durée** : 1.5 jours (~10h)  
**Livrable** : `/opt/moltbot/audit/v3-phase-0/03-architecture-actuelle.md`

### Questions précises

1. Quels sont les **modules principaux** du code actuel (par responsabilité) ?
2. Quelle est la **dette technique majeure** identifiée (V1/V2 cohabitation, code mort, modules obsolètes) ?
3. Quels modules sont **réutilisables tels quels** pour v3.0 ?
4. Quels modules sont **à refondre** pour s'intégrer au framework capteurs v3.0 ?
5. Quels modules sont **à supprimer** (Full Service caduc, etc.) ?

### Méthodologie

**Étape 1 — Cartographie modules (3h)**

```bash
cd /opt/moltbot
# Compter lignes par module
find . -name "*.ts" -not -path "./node_modules/*" -not -path "./.next/*" | xargs wc -l | sort -rn | head -50
# Identifier modules sans test
find . -name "*.ts" -not -path "./node_modules/*" -not -path "./.next/*" -not -name "*.test.ts" -not -name "*.spec.ts" | wc -l
find . -name "*.test.ts" -o -name "*.spec.ts" -not -path "./node_modules/*" | wc -l
```

**Étape 2 — Dette V1/V2 (2h)**

Grep pour identifier la cohabitation :
```bash
grep -r "qualifyV2" --include="*.ts" -l | sort -u
grep -r "qualifyV1" --include="*.ts" -l | sort -u
grep -r "briefV1" --include="*.ts" -l | sort -u
grep -r "briefV2" --include="*.ts" -l | sort -u
grep -r "FULL_SERVICE" --include="*.ts" -l | sort -u  # déjà cleané 11/05 selon mémoire
```

**Étape 3 — Couverture tests (1h)**

```bash
cd /opt/moltbot && pnpm vitest --coverage --run 2>&1 | tail -50
```

**Étape 4 — Lecture critique modules critiques (4h)**

Lire avec œil critique :
- `src/lib/brain/qualify.ts` (ou équivalent)
- `src/lib/pollers/*` 
- `src/lib/triggers/*`
- `src/lib/leads/*`
- Schema Prisma `prisma/schema.prisma`

Noter dans un journal de lecture les odeurs : magic numbers, fonctions >200 lignes, cycles d'import, mocks oubliés.

### Template doc à produire

```markdown
# Audit Code & Architecture Actuelle — Phase 0 v3.0

## Synthèse exécutive
N modules totaux, X% sous tests, Y modules à refondre v3.0, Z modules à supprimer.

## Cartographie modules
[Schéma simple ASCII ou Mermaid]
```
┌─────────────┐
│ Pollers     │ → Triggers → Leads → Brain → Brief → Dashboard
└─────────────┘
```

## Inventaire fichiers par responsabilité
| Module | Lignes | Tests | Dette | Status v3.0 |
|---|---|---|---|---|
| `src/lib/brain/qualify.ts` | ... | ✅ | V2-only ok | GARDER (refonte Brain v2) |
| `src/lib/pollers/rss-levees.ts` | ... | ✅ | OK | REFONDRE (framework capteurs) |
| ... | ... | ... | ... | ... |

## Dette technique identifiée (par sévérité)
- 🔴 [critique] : ...
- 🟠 [moyenne] : ...
- 🟡 [basse] : ...

## Modules réutilisables tels quels v3.0
[liste]

## Modules à refondre pour framework v3.0
[liste]

## Modules à supprimer
[liste]

## Recommandations
[5-10 actions concrètes]
```

### Critère de sortie A.0.3

✅ Tu as une carte mentale claire du code actuel.  
✅ Tu sais où sont les zones de dette critique.  
✅ Tu as un plan de migration modules → v3.0.

---

## A.0.4 — Audit infrastructure & coûts

**Durée** : 1 jour (~7h)  
**Livrable** : `/opt/moltbot/audit/v3-phase-0/04-couts-infrastructure.md`

### Questions précises

1. Décomposition coûts mensuels exacts derniers 3 mois (fév-mars-avr 2026) ?
2. Quels outils sont sous-utilisés (ROI faible) ?
3. Quelle est la consommation Anthropic réelle par route (qualify / brief / opener / etc.) ?
4. Quelles sont les ressources VPS sous-utilisées (RAM, CPU, disk) ?

### Méthodologie

**Étape 1 — Factures réelles (1h)**
- Apify : console.apify.com → billing → derniers 3 mois
- Anthropic : console.anthropic.com → usage → par route si possible
- TheirStack, Rodz, Kaspr, FullEnrich, Pappers : portails respectifs
- VPS : facture Hetzner/OVH

**Étape 2 — Anthropic par route (3h)**
```sql
SELECT 
  route,
  date_trunc('month', "createdAt") AS month,
  SUM("inputTokens") AS input_tokens,
  SUM("outputTokens") AS output_tokens,
  SUM("cacheReadInputTokens") AS cache_read,
  COUNT(*) AS api_calls,
  ROUND(SUM("totalCostUsd"), 2) AS cost_usd
FROM "AnthropicUsage"
WHERE "createdAt" > NOW() - INTERVAL '3 months'
GROUP BY route, month
ORDER BY month DESC, cost_usd DESC;
```

**Étape 3 — Ressources VPS (2h)**
```bash
# RAM
free -h
# CPU 24h moyenne
sar -u 1 60 | tail -5
# Disk
df -h
du -h --max-depth=1 /opt/moltbot | sort -rh | head
```

**Étape 4 — Synthèse coût/event (1h)**
Croiser coût total / volume events captés par source = $/event.

### Template doc à produire

```markdown
# Audit Coûts Infrastructure — Phase 0 v3.0

## Synthèse coûts mensuels (Q1 2026)

| Poste | Fév | Mars | Avr | Moyenne |
|---|---|---|---|---|
| Anthropic API | $XX | $XX | $XX | $XX |
| Apify | $XX | $XX | $XX | $XX |
| TheirStack | $89 | $89 | $89 | $89 |
| Pappers | $XX | $XX | $XX | $XX |
| Kaspr | 50€ | 50€ | 50€ | 50€ |
| FullEnrich | $XX | $XX | $XX | $XX |
| Rodz | (one-shot) | - | - | - |
| VPS | $XX | $XX | $XX | $XX |
| Autres | $XX | $XX | $XX | $XX |
| **TOTAL** | **$XXX** | **$XXX** | **$XXX** | **$XXX** |

## Coût par event capté (efficacité)
| Source | Coût mensuel | Events/mois | $/event | $/Pépite |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

## Anthropic par route
[tableau]

## Ressources VPS sous-utilisées
- RAM : X/Y Gi utilisée
- CPU : X% moyenne 30j
- Disk : X/Y Gi utilisé
- → marge pour Phase 2 (TimescaleDB)

## ROI par outil
[ranking outils par $/Pépite livrée]

## Recommandations économies immédiates
- Outil X sous-utilisé : on garde / on résilie
- Anthropic cache à activer sur route Y
- ...

## Projection coût v3.0 (vs $180-280/mo cible)
[breakdown final v3.0]
```

### Critère de sortie A.0.4

✅ Tu connais le coût réel exact par outil/mois.  
✅ Tu sais quel outil a le ROI le pire.  
✅ Tu as une projection chiffrée pour la v3.0.

---

## A.0.5 — Audit ICP Fred réel vs déclaré

**Durée** : 1.5 jours (~10h)  
**Livrable** : `/opt/moltbot/audit/v3-phase-0/05-icp-fred-reel-vs-declare.md`

C'est l'audit qui prépare le **compilateur ICP-as-Code** de Phase 5.

### Questions précises

1. Quel est l'ICP **officiellement déclaré** par Fred (JSON Client.icp actuel) ?
2. Quel est l'ICP **réel** observé via outcomes (qui a converti) ?
3. Y a-t-il des **fuites** (leads ICP-conforme jamais convertis + leads hors-ICP qui ont converti) ?
4. Quels **signaux** Fred valorise vraiment vs ce qui est dans son ICP officiel ?
5. Quelles **questions** manquent dans le questionnaire Tally pour capturer l'ICP réel ?

### Méthodologie

**Étape 1 — Export ICP actuel (30min)**
```sql
SELECT id, name, icp, "createdAt", "updatedAt" 
FROM "Client" 
WHERE name LIKE '%digitestlab%' OR name LIKE '%DTL%' OR name LIKE '%Fred%';
```

**Étape 2 — Profil leads convertis (3h)**

Pour chaque lead avec Cal.com booking ou reply positif :
- NAF code → secteur réel
- Effectif → fourchette réelle
- Géo → région
- Persona converti (rôle exact, seniority)
- Signal présent au moment de la conversion
- Tech stack si détectable

Tabulation Excel.

**Étape 3 — Comparaison ICP officiel vs réel (2h)**

Tableau côte à côte :
- Critère X officiel = [...] vs observé = [...]
- Si écart > 30% → fuite à corriger

**Étape 4 — Interview Fred 45min (2h avec rédaction)**

5-6 questions précises basées sur les écarts observés :
1. "On a observé que 4 leads convertis avaient NAF [X] qui est hors de ton ICP officiel. C'est intentionnel ou tu adapterais ?"
2. "Les leads CTO/VP Eng convertissent à 3× le taux des CEO. Tu confirmes que CTO/VP Eng est la cible #1 (vs ton ICP qui dit CEO/CTO/CFO indifférents) ?"
3. "Quels signaux quand tu reçois un lead te font dire instantanément 'OUI lui je veux le contacter' vs 'bof' ?"
4. "Combien de fois en 6 mois tu as eu envie de me dire 'je veux plus voir de leads X' ? Lesquels ?"
5. "Si je devais te donner 60 leads/mois au lieu de 6, qu'est-ce qui ferait la différence entre 60 leads excellents vs 60 leads médiocres ?"
6. "Tu changerais quoi dans le questionnaire Tally aujourd'hui ?"

**Étape 5 — Synthèse ICP réel (2.5h)**

Réécrire le JSON Client.icp DTL "v2 réelle" basé sur données observées + interview, à confronter à Fred semaine d'après pour validation.

### Template doc à produire

```markdown
# Audit ICP Fred Réel vs Déclaré — Phase 0 v3.0

## Synthèse exécutive
ICP officiel DTL est à X% aligné avec les conversions réelles observées. Fuites principales : [...]

## ICP officiel actuel (JSON Client.icp)
[dump JSON]

## Profil leads convertis (data observée 6 mois)
[tableau pivot NAF × effectif × persona × signal × outcome]

## Écarts ICP officiel vs réel
| Critère | Officiel | Réel observé | Écart | Action |
|---|---|---|---|---|
| NAF cibles | [6201Z, 6202A...] | [+5829C inattendu] | +1 | Ajouter à ICP |
| Effectif | 11-200 | médiane convertis 35-80 | aligné | RAS |
| Persona | CEO/CTO/CFO | CTO/VP Eng prédominent | resserrer | Préciser ICP |
| ... | ... | ... | ... | ... |

## Réponses interview Fred (12/05)
[Q&A]

## ICP v2 proposé (JSON)
[JSON refait avec apprentissages]

## Questions Tally à ajouter (préparation compilateur Phase 5)
1. ...
2. ...
3. ...

## Implications pour compilateur ICP-as-Code (Phase 5)
[notes pour future implémentation]
```

### Critère de sortie A.0.5

✅ Tu as une vue chiffrée des écarts ICP déclaré vs réel.  
✅ Fred a validé un ICP v2 affiné.  
✅ Tu sais quelles questions ajouter au Tally pour le compilateur Phase 5.

---

## A.0.6 — Synthèse + recommandations stratégiques

**Durée** : 1 jour (~7h)  
**Livrable** : `/opt/moltbot/audit/v3-phase-0/00-synthese.md`

C'est le doc maître que tu liras à chaque début de session. Il doit tenir en **5 pages max**, lisible en 10 minutes.

### Structure imposée

```markdown
# Synthèse Audit Phase 0 — Trigger Engine v3.0

**Période audit** : 13/05/2026 → 23/05/2026 (10 jours)
**Auteur** : Jojo

## 🎯 Verdict en 3 phrases
1. **Ce qui marche** : [...]
2. **Ce qui ne marche pas** : [...]
3. **Ce qu'on garde pour v3.0** : [...]

## 📊 Chiffres clés (baseline avant v3.0)
- Volume leads livrés /mois Fred : ...
- % Pépites vraies parmi leads livrés : ...
- Conversion rate Pépite → Cal book : ...
- TTTD médiane actuelle : ...
- Coût ops total /mois : ...
- Coût /lead livré : ...
- Coût /Pépite convertie : ...

## ⚠️ Top 5 problèmes systémiques découverts
1. ...
2. ...
3. ...
4. ...
5. ...

## ✅ Top 5 quick wins identifiés
[Trucs petits à corriger AVANT Phase 1 pour améliorer baseline]

## 🛠️ Décisions stratégiques actées pour v3.0
- Convergence triple : seuil retenu = [2 / 3 / 4 / 5]
- Capteurs à enterrer : [liste]
- Capteurs à garder : [liste]
- Capteurs à refondre : [liste]
- ICP v2 DTL : validé / à reconfronter
- Coût ops cible v3.0 : $XXX/mo

## 🚦 GO/NO-GO 1 : check liste Phase 1
- [ ] Backtest convergence ≥40% capture Pépites passées ?
- [ ] Capteurs cibles tous légaux RGPD ?
- [ ] Pricing 690€ Hunter validé par interviews prospects ?
- [ ] Modélisation économique cohérente ?

→ Décision : GO Phase 1 / RETRAVAIL stratégie / STOP

## 📚 Annexes
- 01-pipeline-actuel.md
- 02-qualite-leads-6mois.md
- 03-architecture-actuelle.md
- 04-couts-infrastructure.md
- 05-icp-fred-reel-vs-declare.md
```

### Critère de sortie A.0.6 (= Critère sortie Phase 0)

✅ Tu peux résumer Phase 0 en 3 phrases à un investisseur ou à Fred.  
✅ Tu as une baseline mesurée pour comparer la v3.0 plus tard.  
✅ Tu as la liste des quick wins pré-Phase 1.  
✅ Tu sais si on passe en Phase 1 ou si on retravaille.

---

## 📅 Calendrier indicatif Phase 0 (semaine du 13 au 23/05)

| Jour | Bloc matin | Bloc après-midi |
|---|---|---|
| Lun 13/05 | A.0.1 (pipeline j1) | A.0.4 (coûts) |
| Mar 14/05 | A.0.1 (pipeline j2) | A.0.4 (coûts) suite |
| Mer 15/05 | A.0.2 (tagging batch 1) | A.0.2 (tagging batch 2) |
| Jeu 16/05 | A.0.2 (tagging batch 3) | A.0.2 (tagging batch 4) |
| Ven 17/05 | A.0.2 (analyse) | A.0.5 (ICP exports) |
| **Sam 18/05** | **OFF** | **OFF** |
| **Dim 19/05** | **OFF** | **OFF** |
| Lun 20/05 | A.0.5 (interview Fred prép) | A.0.5 (interview Fred 45min) |
| Mar 21/05 | A.0.3 (audit code j1) | A.0.3 (audit code j1.5) |
| Mer 22/05 | A.0.3 (audit code j1) | A.0.5 (ICP v2 rédaction) |
| Jeu 23/05 | A.0.6 (synthèse) | A.0.6 (relecture) |

→ Buffer 1-2 jours en cas de slippage. Si tout va bien, **24/05 = GO/NO-GO 1 vers Phase 1**.

---

## 🚫 Règles non-négociables Phase 0

1. **Aucun changement en prod**. Le système v2 actuel tourne comme aujourd'hui pour Fred. Pas de nouveau capteur ajouté. Pas de capteur enlevé.

2. **Aucun "petit refactor en passant"**. Si tu vois un bug, tu l'écris dans le doc audit. Tu le corriges après Phase 0, jamais pendant.

3. **Aucun nouveau commit Git sur prod hors `/audit/`**. Discipline.

4. **Les agents Doctor + Auditor restent en pause**. Pas de réactivation pendant Phase 0.

5. **Pas de discussion sur Phase 1+ tant que Phase 0 pas livrée**. On reste focus.

6. **Tagging des leads (A.0.2) doit être fait par toi seul**, pas délégué. C'est de cet exercice que sortent les vraies insights.

---

## ❓ Si tu bloques pendant l'audit

- Ne demande pas "comment je fais X" en mode général. Pose la question avec contexte précis.
- Tag-moi le doc spécifique où tu bloques.
- Si tu doutes d'un chiffre, mets-le quand même avec note "à vérifier" — l'audit ne doit pas s'arrêter sur 1 chiffre.

---

## 🎯 Promesse de cette Phase 0

Au 23/05/2026, tu auras :
- 6 documents `/audit/v3-phase-0/*.md` lisibles, sourcés, datés
- Une baseline mesurée du système v2 (pas estimée)
- Une vue claire de ce qui marche et ce qui ne marche pas
- Une décision GO/NO-GO 1 fondée sur des données réelles
- Aucun risque ajouté à la prod

Pas de fioritures, pas d'hypothèses non vérifiées. Que des faits.
