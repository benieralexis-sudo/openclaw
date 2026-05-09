# Disaster Recovery Plan — iFIND

**Sprint 5 (10/05/2026)** — Procédures de restauration en cas d'incident.

---

## 🎯 Objectifs (RTO / RPO)

| Métrique | Cible | Mesuré actuellement |
|---|---|---|
| **RTO** (Recovery Time Objective) | 4 h | ~30 min restaure DB, ~15 min restaure code |
| **RPO** (Recovery Point Objective) | 24 h | Backup quotidien 03h00 UTC |
| **MTBF** (Mean Time Between Failures) | > 30 j | N/A (à mesurer en prod) |

---

## 📦 Inventaire backups

### Quotidien automatique (03:00 UTC)
- `/opt/moltbot/backup-external.sh` → `/opt/moltbot/backups/`
- Format : `moltbot-data-YYYY-MM-DD_HHMM.tar.gz.gpg` (~38 MB/jour)
- Chiffrement : GPG passphrase (clé dans `/opt/moltbot/backups/secret.key`)
- Rétention locale : 7 jours
- **Offsite : Backblaze B2** (push automatique, voir `B2_*` env)

### Hebdomadaire (dimanche 04h00)
- `/opt/moltbot/test-restore.sh` → test que les backups sont décryptables
- Cron : `0 4 * * 0`
- Logs : `/opt/moltbot/backups/test-restore.log`

### Backups Sprint 0 / Sprint 2 (ponctuels)
- `/opt/moltbot/backups/trigger-engine-FINAL-shutdown-20260509-1750.db` (198 MB SQLite)
- `/opt/moltbot/backups/trigger-engine-pre-cleanup-20260509-1727.db` (198 MB)
- `/opt/moltbot/backups/moltbot-env-20260509-1750.bak` (.env complet)

### Tags git rollback
```
pre-grand-cleanup-10mai     ← état avant Sprint 0
pre-sprint-2-shutdown       ← avant désactivation bot trigger-engine
pre-sprint-3-delivery       ← avant infrastructure delivery
pre-sprint-4-onboarding     ← avant POST /api/clients
pre-sprint-5-prod-grade     ← avant CI/logrotate/team UI
```

---

## 🚨 Scénarios + procédures

### 1. PostgreSQL corrompu / drop accidentel

**Symptômes** : queries retournent erreur, dashboard 503, `/api/internal/health` → `down`

**Restauration** (~15 min) :
```bash
# 1. Stop service Next.js (évite reads pendant restore)
sudo systemctl stop dashboard-v2

# 2. Backup actuel (par sécurité avant restore)
docker exec ifind-postgres pg_dump -U ifind ifind > /opt/moltbot/backups/emergency-$(date +%Y%m%d-%H%M).sql

# 3. Identifier le dernier backup décryptable
ls -lt /opt/moltbot/backups/moltbot-data-*.tar.gz.gpg | head -3

# 4. Décrypter + extraire
LATEST=/opt/moltbot/backups/moltbot-data-2026-05-XX_0300.tar.gz.gpg
PASSPHRASE=$(cat /opt/moltbot/backups/secret.key)
gpg --batch --yes --passphrase "$PASSPHRASE" -d "$LATEST" | tar xzf - -C /tmp/restore/

# 5. Restore Postgres (drop + create + import)
docker exec -i ifind-postgres psql -U ifind -d postgres -c "DROP DATABASE IF EXISTS ifind;"
docker exec -i ifind-postgres psql -U ifind -d postgres -c "CREATE DATABASE ifind;"
docker exec -i ifind-postgres psql -U ifind -d ifind < /tmp/restore/ifind.sql

# 6. Vérifier
docker exec ifind-postgres psql -U ifind -d ifind -c "SELECT COUNT(*) FROM \"Trigger\";"

# 7. Restart service
sudo systemctl start dashboard-v2 && sleep 5 && systemctl is-active dashboard-v2
```

**Validation post-restore** :
- `curl /api/internal/health` → `overall: green` ou `yellow`
- Login dashboard fonctionne
- Triggers récents visibles

---

### 2. Container Docker corrompu (postgres, telegram-router)

**Symptômes** : `docker ps` montre container restart loop, healthcheck KO

**Restauration** :
```bash
# Postgres : recréer container avec data préservée (volume bind)
docker stop ifind-postgres
docker rm ifind-postgres
cd /opt/moltbot && docker compose up -d ifind-postgres
sleep 8
docker exec ifind-postgres pg_isready -U ifind

# Telegram-router : cleanup complet + restart
cd /opt/moltbot && docker compose down telegram-router
docker compose up -d telegram-router
sleep 6
docker logs moltbot-telegram-router-1 --tail 20
```

---

### 3. Service Next.js (dashboard-v2) crashed / port 3100 down

**Symptômes** : `curl http://127.0.0.1:3100` → connection refused

**Restauration** :
```bash
sudo systemctl status dashboard-v2 --no-pager
sudo journalctl -u dashboard-v2 -n 50 --no-pager  # voir l'erreur

# Restart simple
sudo systemctl restart dashboard-v2 && sleep 4

# Si build corrupted, rebuild
cd /opt/moltbot/dashboard-v2 && npm run build && sudo systemctl restart dashboard-v2
```

---

### 4. Anthropic OFF / fuite budget

**Symptômes** : alertes Telegram budget burn 24h > $5, ou cron run-pollers logs `credit_balance_too_low`

**Réponses** :
- **OFF temporaire** : recharger https://console.anthropic.com/settings/billing puis lancer
  `/opt/moltbot/scripts/post-anthropic-reload.sh` (smoke test API + réactive cron + 1 cycle).
- **Fuite budget** : couper le cron (`crontab -e` → commenter ligne `run-pollers-cron.sh`),
  identifier la cause (logs `qualify-trigger.usage` parsés par `calc-anthropic-burn-24h.py`),
  fix le bug, restart.

---

### 5. VPS Hostinger HS (incident infrastructure)

**Symptômes** : tout down (SSH, dashboard, monitoring), pings perdus

**Procédure** (si VPS irrécupérable) :
1. Provisionner nouveau VPS Ubuntu 24.04 (Hostinger ou autre)
2. Installer Docker + Docker Compose + Node.js 20 + Postgres client
3. Récupérer dernier backup B2 :
   ```bash
   # Auth B2 + download dernier backup
   b2-cli sync b2://moltbot-backups /opt/moltbot/backups/ --maxAge 2d
   ```
4. Cloner repo : `git clone https://github.com/benieralexis-sudo/openclaw.git /opt/moltbot`
5. Restorer .env : `cp /backup/moltbot-env-XXX.bak /opt/moltbot/.env`
6. Lancer compose : `cd /opt/moltbot && docker compose up -d`
7. Restorer DB depuis backup (voir scénario 1)
8. Update DNS si IP changée (ifind.fr A record + app-v2.ifind.fr)

**Estimé** : 2-4h selon vitesse provisioning + DNS propagation.

---

### 6. Régression code suite à push sur main

**Symptômes** : nouveau commit casse le service après deploy

**Restauration** :
```bash
# Identifier le commit problématique
git -C /opt/moltbot log --oneline -10

# Rollback rapide via tag
git -C /opt/moltbot reset --hard pre-sprint-X-description

# Ou rollback au commit précédent
git -C /opt/moltbot reset --hard HEAD~1

# Rebuild + restart
cd /opt/moltbot/dashboard-v2 && npm run build && sudo systemctl restart dashboard-v2
```

**Prévention Sprint 5** : CI GitHub Actions (`.github/workflows/ifind-ci.yml`) tourne tsc + tests + build sur chaque PR. Bloque le merge si KO.

---

## 🔁 Test mensuel (à faire le 1er du mois)

Test complet de la procédure de restore en sandbox isolé :

```bash
# 1. Preparer sandbox
mkdir -p /tmp/dr-test && cd /tmp/dr-test

# 2. Recuperer backup le plus recent
LATEST=$(ls -t /opt/moltbot/backups/moltbot-data-*.tar.gz.gpg | head -1)
PASSPHRASE=$(cat /opt/moltbot/backups/secret.key)

# 3. Decrypt + extract
gpg --batch --yes --passphrase "$PASSPHRASE" -d "$LATEST" | tar xzf -

# 4. Verifier integrite SQL
head -20 ifind.sql
grep -c "INSERT" ifind.sql
grep -c "CREATE TABLE" ifind.sql

# 5. Cleanup
cd / && rm -rf /tmp/dr-test
```

**Critère succès** :
- Décryptage OK
- SQL contient `CREATE TABLE` pour Trigger, Lead, Client, User (>= 4 tables)
- SQL contient `INSERT` pour ces tables (volumes cohérents avec prod)

**Documentation du test** : ajouter ligne dans `/opt/moltbot/backups/dr-test-history.log`
```
2026-MM-01 : OK | last_backup=YYYY-MM-DD | tables=17 | inserts=~1200
```

---

## 📞 Escalade (qui appeler en cas d'incident majeur)

| Sévérité | Définition | Action |
|---|---|---|
| **P0** | iFIND complètement down > 1h | Alerte immédiate Telegram admin + SSH VPS |
| **P1** | Fonction critique cassée (ex: digest non envoyé) | Email admin sous 4h |
| **P2** | Bug visible mais workaround existe | Issue GitHub, fix sous 1 semaine |
| **P3** | Amélioration / dette technique | Backlog |

**Contact admin** : alexis@ifind.fr / benieralexis@gmail.com / Telegram ADMIN_CHAT_ID configuré dans .env

---

## 🛡️ Préventif (ce qu'on a déjà)

- ✅ Backups quotidiens chiffrés GPG + offsite Backblaze B2
- ✅ Test-restore hebdomadaire automatique (`test-restore.sh` cron dimanche 4h)
- ✅ Healthchecks toutes les 5 min (`healthcheck-unified.sh`) avec ping Telegram si DOWN
- ✅ Backup-watcher quotidien (alerte si backup absent > 25h)
- ✅ Burn Anthropic monitoring (alerte si > $5/jour projeté)
- ✅ Zombi detector (alerte si 4 cycles consecutifs opusQ=0)
- ✅ Logrotate config étendue Sprint 5 (12 logs couverts)
- ✅ pg_stat_statements activé (slow queries audit)
- ✅ Rate limit middleware (60 req/min/IP)
- ✅ CI GitHub Actions : tsc + tests + build sur chaque PR (Sprint 5)
- ✅ 292 tests Vitest verts (Sprint 4)
- ✅ Tags git à chaque sprint pour rollback rapide

## ⚠️ À améliorer (Sprint 6+)

- ❌ Backups Postgres en WAL streaming (point-in-time recovery <1h)
- ❌ Staging environment (port 3101 + DB séparée)
- ❌ Quotas par client en DB (Anthropic/Apify/TheirStack)
- ❌ Externalisation secrets vers Doppler/Vault (vs .env root-readable)
- ❌ Cleanup 5 tables DB caduques (Reply/EmailEvent/EmailActivity/Opportunity/etc.)
- ❌ Refactor `gateway/telegram-router.js` 2372 → ~500 lignes
- ❌ Magic link email pour reset password user (vs mdp temp manuel)
- ❌ Monitoring V2 spécifique (alerte si shadow-v2 KO sur > 10 triggers consécutifs)

---

## Voir aussi

- `ONBOARDING-CLIENT-V2.md` (Sprint 4) — procédure créer un nouveau client
- `playbook-perfection-100.md` — manuel exécution 33 points (memory)
- `reprise-session-09mai-vague3-livree.md` — état Sprint Vague 3 (memory)
