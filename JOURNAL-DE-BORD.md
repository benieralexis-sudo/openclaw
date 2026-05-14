# 📓 Journal de bord — iFIND / DigiTestLab

> **Carnet de bord quotidien** : ce qu'on a fait, ce qu'on a appris, ce qu'il reste à faire.
> Format simple — à mettre à jour chaque session. Une entrée par jour (max 20 lignes).
> Au-delà de 30 jours, archiver les entrées anciennes dans `_archive-journal/`.

---

## 📝 Comment alimenter ce journal

À la fin de chaque session, ajouter une entrée en HAUT du fichier (chronologie inverse, plus récent en premier). Template :

```markdown
## YYYY-MM-DD — Titre court

**Résumé** : 1-2 phrases.

**Commits** : `hash1` titre · `hash2` titre · …

**Décisions / apprentissages** :
- Point clé 1
- Point clé 2

**Action user en attente** : (si rien, écrire "—")

**Prochain pas** : 1 phrase.
```

---

## 2026-05-14 (fin de journée) — Audit massif + 4 anomalies fixées

**Résumé** : Audit massif systématique tous les axes (infra, DB, pipeline, budgets, persona, combos, agents, code, business). Trouvé 4 anomalies réelles (sur 6 candidates). Fix structurel + backfill pour les 4. Système propre à 100%.

**Commits** :
- `ff999f985` Fix #1 — ensureLead status filter (10 Leads polluants archivés)
- `7b2414d82` Fix #2 — Anthropic burn marker (était $0, maintenant $24/jour visible)
- `6df7a157e` Fix #3 — Force-requalify 3 triggers limbo (GitGuardian/Koralplay/StrangeBee → 3 Pépites OUI 78-88)
- `99e25cec5` Fix #4 — Auto-archive doNotContact (6 Leads polluants archivés)

**Apprentissages clés** :
- Le marker Anthropic était cassé depuis 4 jours (refactor V2-only 10/05 a renommé). Si on n'avait pas audité on continuait à piloter à l'aveugle.
- Le bug `ensureLead` ne filtrait pas status : structurellement dangereux car contredisait l'esprit du judge V2 (un IGNORED ne devrait jamais devenir un Lead actif).
- 5 anomalies "candidates" étaient en fait des SELECT pas SET (faux positif grep) — toujours valider avec contexte avant de coder.
- Audit massif = 10× plus efficace que les rapports Auditor qui restent superficiels (Auditor avait raté toutes ces 4 anomalies).

**Action user en attente** :
- 🔴 Plafond Apify $100 → $150 (toujours)
- 🔴 Appel Fred (toujours)

**Prochain pas** : Observer 24-48h les premiers leads des nouveaux types Rodz (sprint 2.0). Si volume cohérent → augmenter dailyLeadLimit. Surveiller le burn Anthropic maintenant visible ($24/j = $720/mois projeté).

---

## 2026-05-14 (suite, après-midi) — Sprint Rodz 2.0 + audit DTL multi-signal

**Résumé** : Audit DTL → diagnostic 84% des triggers sont HIRING_KEY (mono-angle). Identifié 7 types Rodz inexploités. Sprint Rodz 2.0 : ajout 4 nouveaux types (republished-job-offers, public-tenders DTL, social-mentions iFIND, competitor-relationships iFIND).

**Commits** :
- `2a51a3502` Gates WTTJ + INPI alignées cron 08h UTC
- `6070ad652` npm audit fix kysely
- `21ef6f3e1` Activation 7 angles multi-signal iFIND (6 Rodz + 3 TheirStack)
- `10acf837c` Pattern SCALE-UP-SALES + alertes Telegram
- `d78e424a4` 42 tests vitest regex TECH vs SALES
- `9f6715263` Création JOURNAL-DE-BORD.md
- `65a8dc1f5` Sprint Rodz 2.0 — 4 nouveaux types (LOW_VALUE retiré, buildSignals étendu, ICP DTL/iFIND étendus)

**Décisions / apprentissages** :
- Audit DTL réel : 84% triggers HIRING_KEY, 8.1% FUNDRAISING, le reste anecdotique. Seulement **2 boîtes** ont 2+ angles différents en 90j (Sêmeia SCALE-UP-TECH + Collective.work 3 sources mais même type).
- Bug critique trouvé : `LOW_VALUE_SIGNAL_TYPES` du webhook bloquait social-mentions et competitor-relationships **à l'entrée** — même si on les provisionnait côté Rodz, on les ignorait.
- Rodz signal `job-changes` DTL = 0 leads en 18j même avec config active (problème côté Rodz, volume FR faible).
- 17 signaux Rodz actifs au total (8 DTL + 9 iFIND). Runway estimée ~26j avant épuisement crédits Pack Pro 200€/4mo.
- **Mine d'or** : 5 autres types Rodz toujours inexploités (public-contract-award, social-reactions, influencer-engagement, etc.) — à explorer si volume montre du potentiel.

**Action user en attente** :
- 🔴 Plafond Apify $100 → $150 (toujours)
- 🔴 Appel Fred (toujours)
- 🟡 Observer 7j le volume des nouveaux signaux Rodz, ajuster dailyLeadLimit si besoin

**Prochain pas** : Observer 24-48h les premiers leads des nouveaux types. Si volume cohérent → ajuster dailyLeadLimit à 3 (vs 2 actuel). Si bruit → désactiver. Étape suivante : explorer les 5 types Rodz toujours inexploités si on en a besoin.

---

## 2026-05-14 (matinée) — Sprint multi-signal iFIND + 6 bug fixes système

**Résumé** : Sprint majeur. Démarré sur audit des rapports Doctor/Auditor (5/8 étaient faux positifs), puis fix de 6 bugs racines persona/cron/gates, puis activation 7 angles iFIND (de 1 à 7+) avec pattern combo `SCALE-UP-SALES` symétrique et alertes Telegram.

**Commits (matin uniquement)** :
- `466523087` Cron multi-tenant (iFIND tourne automatiquement)
- `0e08c0903` Tech-hire-guard CEO+Co-founder rejected (12 Leads backfill)
- `07e823007` Opener Opus halluciné bloqué (Salvia/Yoni)
- `9f964c203` clearStaleBriefs reset scoreReason aussi (ViaXoft/happn)
- `57d01e14b` Re-qualify trigger principal sur nouveau signal (Sêmeia)
- `674562094` Auditor V0.3 — 2 faux positifs deep_dive_lead corrigés

**Décisions / apprentissages** :
- Doctor est fiable à 7/7. Auditor a tendance à exagérer (5/8 faux positifs aujourd'hui). Toujours vérifier soi-même la source DB+code avant d'agir.
- Le moat iFIND n'est pas le nombre de capteurs (Pharow a déjà tout) mais **N capteurs sur N angles différents**. Combo de 2+ angles convergents = HOT.
- `multiSourceBoost` + `isCombo` étaient déjà codés mais alimentés par un seul angle (84% HIRING_KEY). En diversifiant, les combos émergent naturellement.
- iFIND est maintenant en dogfood multi-tenant : si on signe d'autres clients SDR-as-a-service, le moteur est prêt.

**Action user en attente** :
- 🔴 Plafond Apify $100 → $150 sur console.apify.com (breaker à 95% dans ~3j)
- 🔴 Appel Fred — combien de RDV ? Pourquoi il ne clique pas sur le dashboard ?

**Prochain pas** : Passer à DTL (même approche multi-signal, mais DTL a déjà 7 angles configurés côté Rodz — vérifier la diversité réelle des captures DTL).

---

## 2026-05-13 — Audit massif + iFIND activé en dogfood

**Résumé** : Audit massif 10 phases sur DTL → 22 problèmes priorisés. iFIND activé comme 2e client dogfood. 3 patches multi-tenant + 3 patches anti-burn Apify (TTL 90j, bypass NON, cap 30/j).

**Commits** : `aff8c2646` anti-burn · `00f6313fd` multi-tenant config-driven · `088fa1955` fix Doctor

**Décisions / apprentissages** :
- Le bot marche techniquement, le business est à zéro (0 RDV trackés en 30j, Fred clique pas).
- 6 P0 critiques identifiés : briefs IA cachés, Pépites archivées, 51% triggers sans verdict V2, Doctor/Auditor inactifs, Apify burn critique. → Plusieurs sont en fait des faux positifs (cf. 14/05).
- iFIND ICP : PME SaaS B2B 11-200p post-Series A sans SDR, sweet spot 15-40p. NAF tech + agences.

**Action user en attente** : Augmenter plafond Apify (toujours).

**Prochain pas** (du 13/05) : Investiguer les 6 P0. → Fait le 14/05.

---

## 2026-05-12 (soir) — Cleanup structurel + nouvelle stratégie multi-signal

**Résumé** : Session 17h-21h UTC, 10 commits. 5 bugs structurels racines fixés. CI iFIND activé. Doc stratégique `STRATEGIE-MULTI-SIGNAL-12MAI-SOIR.md` qui supersede les docs matin (principe N capteurs N angles → combo = HOT, roadmap 8 semaines).

**Décisions / apprentissages** :
- Multi-tenant by design formalisé : Client.icp lit tout, jamais hardcoder.
- Cleanup Full Service code prod COMPLET (FULL_SERVICE retiré 13 fichiers).
- Cartes stratégiques foireuses archivées (`_archive-bullshit-11-12mai/`).

---

## 2026-05-11 — Doctrine agents 12 + Carte 5 + Phase 1 agents prod

**Résumé** : Marathon 9h cartographie + doctrine + construction. 6 docs stratégiques (~3550 lignes) dans `/opt/moltbot/`. 50 agents évalués → 12 retenus sur 6 mois. Doctor V1.1 (Sonnet 4.6) + Auditor V0.2 (Opus 4.7) prêts.

**Décisions / apprentissages** :
- Pattern collaboration Anthropic : Hybride Cron Solo + Event-Driven + Orchestrator.
- Sweet spot 8-12 agents confirmé par recherche ICLR 2025.
- 7 bugs systémiques iFIND identifiés en avance, fixés progressivement.

---

## 2026-05-10 — Refactor V2-only complet + cost-report

**Résumé** : V2 (Opus judge OUI/NON/ENRICH) devient source de vérité, V1 Opus rules-based supprimé. Session 3 finale livrée. Nouveau endpoint `/api/internal/cost-report` pour budget temps réel.

**Décisions** :
- V2-only économie ~$0.16/call vs V1+V2 ~$0.24/call = -33% Anthropic.
- Pipeline 6/9 sources rétablies via cron `0 8,18 * * *`.

---

## 2026-05-09 — Sprint Saint Graal 1 (site marketing + crédits)

**Résumé** : Site marketing production-ready (homepage v4 + tarifs v3 + 5 pages légales). Backend mécanique crédits + garantie Pépite COMPLET. Pricing FINAL validé : 390€/mo annuel + 6 Pépites garanties + rollover 4 mois.

**Décisions stratégiques** :
- 1 SEULE offre publique (iFIND Growth 390€/mo). Pas de tier confus.
- DTL/Fred grandfathered 199€/mo jusqu'à fin contrat puis switch 390€.
- DTL ne convertit pas → priorité signer client #2 via outbound iFIND.

---

## 📚 Sessions antérieures (résumé condensé)

- **2026-05-08** : Marathon enrichissement + SWITCH V1→V2 (Dashboard DTL 21/23 NELT).
- **2026-05-07** : Sprint D livré (D.0+D.1+D.2+D.3+D.4+D.6).
- **2026-05-06** : Sprint C + Sprint B livrés. 16 leads score 7-8 dans le pool DTL.
- **2026-05-05** : Pivot Data-only. Plan maître 8 sprints. Sprint A complet.
- **2026-05-04** : Recovery Pépites + score unifié 0-100. 26 Pépites cachées récupérées.
- **2026-05-03** : Incident Apify résolu + split pipeline 1h léger / 6h coûteux.
- **2026-05-01** : Marathon 17 vagues v3.6 → v4.12 (193 tests Vitest verts).
- **2026-04-28 à 30** : Pipeline rebuild + FullEnrich branché. Bot production-ready.
- **2026-04-27** : Machine de guerre — briefs Opus on-demand + Kaspr intégré.
- **2026-04-25 à 26** : Cleanup v2.0 + 5 outils achetés. Boosters v1.1.

Pour les détails précis, voir `~/.claude/projects/-root/memory/` (fichiers `session-*.md`).
