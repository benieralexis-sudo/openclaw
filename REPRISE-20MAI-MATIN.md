# 🌅 Reprise matin 20/05/2026 — Digidemat débloqué, 5 Pépites prêtes

> **Point d'arrêt soir 19/05 minuit (passage au 20/05).**
> 16 commits Jour 14 livrés. Pipeline 100% propre. 5 Pépites Digidemat identifiées prêtes à exploitation.

---

## ⚡ TL;DR ce qu'on a accompli pendant le marathon 19-20/05

- **16 commits Bombora FR** (du `7ed20b751` au `0071067f8`)
- **1014 tests verts** (+50 ce soir), TypeScript clean
- **Deploy** BUILD_ID `Nq_YKfcpYT7EowL99FOVE`
- **5 Pépites Opus OUI 82-88%** Digidemat identifiées avec opener prêt
- Pacte 120j : J+2 / 120, **avance** ~10j sur le plan Bombora FR

---

## 🎯 Les 5 Pépites Digidemat (priorité demain matin)

| # | Cible | SIREN | NAF | Verdict | Date limite | État Lead | Persona à trouver |
|---|---|---|---|---|---|---|---|
| 1 | **UCANSS** (Sécurité Sociale) | 784621435 | 84.30A | OUI 88% | **15 juin** | NEW | DSI / DPO UCANSS |
| 2 | **CNFPT** (Fonction Publique Territoriale) | 180014045 | 85.59A | OUI 88% | **18 mai** ⚠️ | INCOMPLETE | Direction Achats CNFPT |
| 3 | **CD Calvados** | 517974432 | 94.12Z | OUI 82% | — | INCOMPLETE | DSI Département 14 |
| 4 | **CH Lens** (Hôpitaux Artois) | 266209329 | 86.10Z | OUI 82% | — | INCOMPLETE | DSI / DPO CH Lens |
| 5 | **SICIO** (94) | 259400117 | 84.11Z | OUI 82% | **11 juin** | INCOMPLETE | DSI SICIO |

**Action priorité 1 matin** : enrichir personas LinkedIn pour les 4 INCOMPLETE (via HarvestAPI ou recherche manuelle Sales Navigator).

**Action priorité urgent CNFPT** : date limite **18 mai** = potentiellement déjà passée. Vérifier si AO encore ouvert avant outbound.

**Openers Opus déjà rédigés** pour chacun (référencent l'AO précis + date limite + valeur Digidemat). Visibles dans Trigger.briefV2Json sur chaque pépite.

---

## 📊 Récap technique 16 commits Jour 14

```
7ed20b751 PROSPECT cron+pollers (BOAMP+GitHub+cron-all accept PROSPECT)
7cc10e1d1 GitHub FR_HINTS étendus (RGPD/CNIL/SIRET + email @*.fr)
ef399574f INPI + JOAFE désactivés (HTTP 500 INPI + stub JOAFE)
3a2d8fe3c capReached désactivé (économie débloquée Bombora FR)
ba9ef15bf 2e passe audit-heal post-enrichissements
31d262c0f BOAMP cleanBuyerName (suffixes administratifs)
badfc7565 TED Europa cleanBuyerName (symétrie BOAMP)
72971a05c 2e passe qualifyPendingTriggers + auto-briefs ENRICHED + tests guard
41f043dfc TheirStack tech slugs stricts par client (bug Kicklox)
6ee9d5911 BOAMP filtre Node sur champ objet (88% bruit éliminé)
050c7daa1 Apify vendor-only match skip (bug SOFTEAM/Docaposte)
a566a2c67 Module signature-vendor-names commun + 4 pollers
ff444ba5f GitHub owner.type=User skip (repos perso)
1f418c715 BOAMP stemming-aware (Sujets 12-13) — UCANSS débloqué
9ebc88e8f Module signature-matching commun (Sujet 14) + lookback BOAMP 30j (15)
0071067f8 Préfixe commun ≥6 chars pour formes verbales FR (Sujet 16) — 4 Pépites de plus
```

---

## 🐛 Bugs racines découverts (cascade)

1. **Sujet 12** — `attributeSirene` rate sigles internes (BRL DJRSE → 0 SIRET). Fix : retry sur 1er mot (`extractFirstSignificantWord`). 5/5 SIRET résolus.

2. **Sujet 13** — `filterRecordsByObjetKeyword` strict `includes()` rate :
   - Pluriels (certificats vs certificat)
   - Accents perdus (electroniques vs électroniques)
   - Mots séparés ("CERTIFICATS DE SIGNATURES ET DE CACHETS ELECTRONIQUES")
   → 80% des vrais positifs droppés.
   Fix : stemming-aware avec décomposition mots significatifs.

3. **Sujet 14** — Bug Sujet 13 répliqué dans 4 pollers signature (apify-linkedin, rss-medias, francetravail, ted-europa). Refactor en module commun `signature-matching.ts`.

4. **Sujet 15** — Lookback BOAMP 14j ratait CNFPT/CH Lens/Nantes (publiés J-25 à J-30). Étendu 14→30j.

5. **Sujet 16** — Formes verbales non matchées ("dématérialisation" ↔ "dématérialisé/e/s"). Fix : préfixe commun ≥6 chars normalisés. 22 vrais positifs supplémentaires débloqués.

---

## 🎯 Action items DEMAIN MATIN (priorité décroissante)

### P0 — Enrichir personas des 5 Pépites
1. **CNFPT** (urgent date limite 18/05) — chercher Direction Achats Public sur LinkedIn
2. **UCANSS** — DSI / DPO Sécurité Sociale
3. **SICIO** (DL 11 juin) — DSI Syndicat Informatique Communes du Val-de-Marne
4. **CH Lens** — DSI Centre Hospitalier
5. **CD Calvados** — DSI Département 14

Outils : HarvestAPI search (ai-jobs LinkedIn par companyName) OU recherche manuelle Sales Nav.

### P1 — Présentation à Frédéric / Andreea
- Envoyer les 5 Pépites + opener Opus à Andreea Nicoara (`andreea@digidemat.com`) pour validation et envoi outbound
- Commission 20% par close potentielle

### P2 — Validation autonome cron 8h05 UTC
- Observer le cron 8h05 UTC autonome de demain matin
- Mesurer combien de nouveaux triggers + Pépites le pipeline détecte sans intervention manuelle
- Cible : 1-3 nouveaux Pépites/jour cumulé toutes sources

### P3 — Audit iFIND/DTL (le module commun signature-matching s'applique à eux aussi)
- Re-fetcher iFIND et DTL pour vérifier si le bug stemming filtrait aussi leurs vrais positifs
- Probable gain modeste (iFIND/DTL n'utilisent pas BOAMP, mais peut-être Apify/RSS pour DTL)

### P4 — Backlog secondaire
- Bug `Key (clientId, companySiret)=(450994074) already exists` dans audit-heal (SID Atlantique sur 2 triggers via fallback firstWord → contrainte unique violée). Patch à voir.
- Lookback étendu côté autres pollers (RSS/FT actuellement 14j) ?
- Filtre exclusion "titres restaurant" / "chèques déjeuner" côté Opus prompt (bruit 80% sur "dématérialisation")

---

## 🔒 État pacte 120j Bombora FR

- Signé : 18/05/2026
- Échéance : **15/09/2026** (118j restants)
- **J+2 du pacte** — avance ~10j sur la roadmap technique Bombora FR
- Stop-loss J+20 : **08/06/2026** (19j restants)
- Audit qualité J+30 : **18/06/2026** (29j restants)
- Kill-switches : M2 / M4 / M6 (cf. [[feedback-pacte-120j-bombora-fr]])

**Statut commercial actuel** : **5 Pépites prêtes à l'envoi**. 0€ MRR Bombora — mais 1ère possibilité de signer un deal via Frédéric/Andreea sur ces 5 Pépites avant J+20.

---

## 📁 Fichiers clés à relire si reprise difficile

- `/root/.claude/projects/-root/memory/MEMORY.md` (index global)
- `/root/.claude/projects/-root/memory/session-19mai-jour14-bombora-fr.md` (détail Sujets 1-16)
- `/root/.claude/projects/-root/memory/strategie-bombora-fr-locked-18mai.md` (stratégie verrouillée)
- `/root/.claude/projects/-root/memory/feedback-pacte-120j-bombora-fr.md` (anti-pivot)
- `/opt/moltbot/DRAFT-ICP-DIGIDEMAT-19MAI.md` (draft workshop ICP — partiellement obsolète depuis qu'on a poussé l'ICP en autonomie)
- Ce fichier : `/opt/moltbot/REPRISE-20MAI-MATIN.md`

---

**Bonne pause Alexis. Tu as eu raison de me pousser à investiguer à fond ce soir — sans ça on aurait raté UCANSS / CNFPT / CD Calvados / CH Lens / SICIO. À demain.**
