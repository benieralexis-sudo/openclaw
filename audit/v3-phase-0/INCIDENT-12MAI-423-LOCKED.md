# Incident 12/05/2026 — Run-Pollers HTTP 423 LOCKED (41h silence)

**Détecté** : 12/05/2026 13:30 UTC (pendant audit A.0.1)  
**Résolu** : 12/05/2026 13:45 UTC  
**Impact** : 41h sans capture Apify / TheirStack / RSS-levees pour DTL  
**Sévérité** : 🔴 Haute (perte estimée 30-50 triggers / 5-10 leads potentiels)

---

## 🎯 Résumé en 3 phrases

1. Le cron `run-pollers-all-cron.sh` (8h/18h UTC, source=all) et le cron `run-pollers-cron.sh` (toutes les heures, source=cron) **partaient à la même seconde** à H:00 et tapaient la même route `/api/internal/run-pollers` protégée par un mutex global in-memory.

2. À 8h et 18h UTC, source=cron acquérait le lock en premier (≈8-12s d'exécution) et source=all recevait systématiquement **HTTP 423 LOCKED** — silencieusement, sans alerte produit (alerte Telegram envoyée mais non vue).

3. Dernier succès source=all : 10/05/2026 17:48 (déclenchement manuel à timestamp non-rond). Tous les crons à H:00 suivants ont échoué : **6/9 sources iFIND muettes pendant 41h**.

---

## 🔬 Diagnostic technique

### Symptômes observés (pendant audit A.0.1)

- Volume capture DTL : 116/jour (03/05) → 22/jour (10/05) → 2/jour (12/05) = **-83% en 9j**
- Log `/var/log/ifind-pollers-all.log` :
  ```
  [2026-05-10T17:48:33Z] END http=200 ← dernier succès (manuel)
  [2026-05-10T18:00:02Z] END http=423 ← LOCKED
  [2026-05-11T08:00:01Z] END http=423 ← LOCKED
  [2026-05-11T18:00:01Z] END http=423 ← LOCKED
  [2026-05-12T08:00:01Z] END http=423 ← LOCKED
  ```

### Root cause

**Collision systématique de deux crons sur la même route protégée par mutex** :

```cron
0 * * * * /opt/moltbot/scripts/run-pollers-cron.sh        # source=cron, toutes les heures
0 8,18 * * * /opt/moltbot/scripts/run-pollers-all-cron.sh # source=all, 2x/jour
```

Le code `dashboard-v2/src/app/api/internal/run-pollers/route.ts` ligne 26 :
```typescript
let runPollersLock: { acquiredAt: number; runId: string } | null = null;
const LOCK_TTL_MS = 90 * 60 * 1000;
```

→ Lock in-memory partagé entre tous les appels source=*. Le premier qui acquiert bloque les autres pendant 90 min OU jusqu'à `releaseLock(runId)`.

À H:00, les deux crons partent à la même seconde :
- `run-pollers-cron.sh` lance curl avant `run-pollers-all-cron.sh` (ordre crontab)
- Acquiert le lock → exécute 8-58s → release OK
- `run-pollers-all-cron.sh` arrive 100-500ms plus tard → trouve le lock → 423

### Pourquoi ce n'a pas été détecté avant ?

1. Le script `run-pollers-all-cron.sh` a été créé le **10/05** (mémoire incident-apify-03mai) pour rattraper 6/9 sources muettes après shutdown bot
2. Avant, source=all était lancé par le bot trigger-engine via ses propres crons (qui ne tapaient pas H:00)
3. L'auteur du script crontab a posé `0 8,18 * * *` sans vérifier la collision avec le cron horaire H:00
4. Le script envoie une **alerte Telegram en cas HTTP non-200** (ligne 108), mais visiblement pas lue/vue par Jojo
5. Aucun monitoring dashboard ne tracke "dernière capture Apify réussie"

---

## 🛠️ Fix appliqué (12/05 13:43 UTC)

### 1. Décalage cron source=all à H:05

```diff
- 0 8,18 * * * /opt/moltbot/scripts/run-pollers-all-cron.sh
+ 5 8,18 * * * /opt/moltbot/scripts/run-pollers-all-cron.sh
```

Buffer 5 min suffit largement (source=cron prend 8-58s max).

Backup ancien crontab : `/opt/moltbot/audit/v3-phase-0/data/crontab-backup-12mai-fix-pollers.txt`

### 2. Run manuel de rattrapage

Lancé à 13:43:14 UTC, terminé à 13:45:00 UTC (1m46s).

Résultat :
```
http=200 | runId=run-1778593394691-kut5zo
opusQ=2 | created=1 | existed=56
apify=10 | rssLevees=1
recovery=0/0 | kasprPhone=1
```

= **10 triggers Apify + 1 RSS-levée** capturés instantanément. Validation : Sêmeia levée score 10 détectée (la boîte est déjà HOT dans le pool, on capte maintenant sa convergence levée+QA match).

### 3. Vérification post-fix (13:50 UTC)

Top des nouveaux triggers NEW post-fix :
- **Sêmeia** score 10 (levée) — convergence avec QA match existant
- **NEXTON** score 8 (QA Testeur Cypress)
- **Ateme** score 8 (vidéo broadcast)
- **Médiane Système** score 8
- **LYNRED** score 8 (semicond)
- **WEENEO Consulting** score 8
- **L'Usine Nouvelle** score 8
- **Training Orchestra** score 8 (QA match) + rodz.recruitment-campaign (convergence!)

Filtres IGNORE corrects : Consort Group (NAF blacklist), AIS (ESN), LEAP To Success (placement), France Travail (= la boîte elle-même).

---

## ⚠️ Recommandations Phase 4-5 (refonte capteurs)

### À corriger durablement

1. **Lock in-memory ne survit pas aux redémarrages process** : passer à un lock Redis ou DB pour vraie durabilité multi-replica.

2. **Aucune alerte Telegram vue côté Jojo** : déplacer alerte vers dashboard pin (visible en permanence) OU monitor-quotas.sh ajouter check "dernière capture <6h".

3. **`run-pollers-cron.sh` (source=cron) et `run-pollers-all-cron.sh` (source=all) tapent la même route** : à séparer en 2 routes distinctes ou unifier dans 1 cron unique.

4. **Pas de KPI "dernière capture réussie / source"** : à ajouter dans `/api/internal/health` Phase 2 (observabilité capteurs framework).

### Quick wins immédiats (pas dans Phase 0)

- Ajouter `tail -1 /var/log/ifind-pollers-all.log` au dashboard `/api/internal/health` (5 lignes de code).
- Crontab : ajouter ligne `*/15 * * * * grep -q "http=423" /var/log/ifind-pollers-all.log | tail -1 && send_telegram "423 detected"` ou équivalent.

---

## 📊 Estimation impact de l'incident

Sur la période 10/05 18:00 → 12/05 13:43 (43h45) :
- Cycles source=all attendus : 4 (10/05 18h, 11/05 8h+18h, 12/05 8h)
- Triggers Apify attendus par cycle : ~10-15 (basé sur le rattrapage = 10 en 1m46s)
- **Triggers manqués estimés : 40-60**
- **Leads créés manqués estimés : 5-12** (taux conversion ~20%)
- **Pépites HOT manquées estimées : 1-3** (taux score≥9 ~10-15%)
- **RSS-levées manquées : 2-4** (basé sur cycle normal)

Coût opportunité : 1-3 Pépites HOT non livrées à Fred sur 43h. Modéré mais significatif vu le pool actif actuel (24 leads).

---

## ✅ Statut final

- [x] Cause identifiée (collision cron H:00 + mutex global)
- [x] Crontab fixé (8:05 / 18:05 au lieu de 8:00 / 18:00)
- [x] Run manuel de rattrapage exécuté (10 triggers Apify + 1 RSS-levée + Sêmeia levée score 10)
- [x] Vérification post-fix validée
- [x] Incident documenté

**Prochain cron automatique** : 12/05 18:05 UTC → si HTTP 200, fix validé en conditions réelles.

---

## 🔗 Liens audit

- `/audit/v3-phase-0/01-pipeline-actuel.md` — audit complet A.0.1 (référence #4 sur le volume en chute)
- `/audit/v3-phase-0/data/crontab-backup-12mai-fix-pollers.txt` — backup avant modif
- `/var/log/ifind-pollers-all.log` — log live
