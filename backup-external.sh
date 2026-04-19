#!/bin/bash
# iFIND — Backup externe quotidien (local + Backblaze B2)
# Remplace /opt/moltbot/backup.sh — garde backup local 7j + pousse copie chiffrée B2 30j
set -u

# === Config ===
BACKUP_DIR="/opt/moltbot/backups"
DATE=$(date +%Y-%m-%d_%H%M)
TODAY=$(date +%Y-%m-%d)
LOCAL_RETENTION_DAYS=7
B2_RETENTION_DAYS=30
CONTAINER="moltbot-telegram-router-1"
B2_REMOTE="b2:ifind-bot-backup"
LOG="$BACKUP_DIR/backup.log"

# === GPG encryption (Phase A2 hardening) ===
GPG_RECIPIENT="backup@ifind.fr"
GPG_PASSPHRASE_FILE="/root/.moltbot-backup-gpg-passphrase"
# Abort if GPG key missing — no plaintext backups to B2
if ! gpg --list-keys "$GPG_RECIPIENT" > /dev/null 2>&1; then
  echo "FATAL: GPG key $GPG_RECIPIENT missing. Aborting (would leak plaintext to B2)." >&2
  exit 2
fi

# Charger .env pour TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID
set -a
source /opt/moltbot/.env 2>/dev/null
set +a

mkdir -p "$BACKUP_DIR"

notify_telegram() {
  local msg="$1"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ADMIN_CHAT_ID:-}" ]; then
    curl -sS --max-time 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="${ADMIN_CHAT_ID}" \
      -d parse_mode="Markdown" \
      --data-urlencode text="$msg" > /dev/null 2>&1
  fi
}

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

fail() {
  log "❌ $1"
  notify_telegram "🚨 *Backup iFIND FAILED* — $DATE
$1
Serveur : srv1319748
Action requise : SSH + check /opt/moltbot/backups/backup.log"
  [ -n "${HC_PING_BACKUP:-}" ] && curl -fsS --retry 2 --max-time 10 "$HC_PING_BACKUP/fail" --data-raw "$1" > /dev/null 2>&1
  exit 1
}

# === 1. Backup code + config ===
log "START backup $DATE"

CODE_ARCHIVE="$BACKUP_DIR/moltbot-code-$DATE.tar.gz"
tar czf "$CODE_ARCHIVE" \
  --exclude='node_modules' \
  --exclude='*.log' \
  --exclude='backups/*.tar.gz' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='clients/*/.env' \
  --exclude='*.gpg' \
  -C /opt/moltbot \
  gateway/ \
  skills/ \
  dashboard/ \
  landing/ 2>/dev/null \
  docker-compose.yml \
  docker-compose.clients.yml \
  backup-external.sh \
  2>/dev/null || fail "Code archive failed"

CODE_SIZE=$(du -sh "$CODE_ARCHIVE" | cut -f1)

# === 2. Backup volumes Docker (depuis host, root peut tout lire) ===
DATA_ARCHIVE="$BACKUP_DIR/moltbot-data-$DATE.tar.gz"
VOLUMES_ROOT="/var/lib/docker/volumes"

# Liste des dossiers volumes moltbot_* à inclure
VOLUMES_TO_BACKUP=$(docker volume ls --format '{{.Name}}' | grep -E '^moltbot_' || true)
if [ -z "$VOLUMES_TO_BACKUP" ]; then
  fail "No moltbot_* volumes found"
fi

# Tar direct depuis /var/lib/docker/volumes en filtrant sur les dossiers moltbot_*
(
  cd "$VOLUMES_ROOT" && tar czf "$DATA_ARCHIVE" $VOLUMES_TO_BACKUP
) 2>/dev/null || fail "Docker volumes backup failed (host-side tar)"

DATA_SIZE=$(du -sh "$DATA_ARCHIVE" | cut -f1)

# === 3. Backup clients/ si présent (exclude .env per-client) ===
CLIENTS_ARCHIVE=""
if [ -d "/opt/moltbot/clients" ] && [ -n "$(ls -A /opt/moltbot/clients 2>/dev/null)" ]; then
  CLIENTS_ARCHIVE="$BACKUP_DIR/moltbot-clients-$DATE.tar.gz"
  tar czf "$CLIENTS_ARCHIVE" \
    --exclude='clients/*/.env' \
    --exclude='clients/*/.env.*' \
    -C /opt/moltbot clients/ 2>/dev/null || fail "Clients archive failed"
  CLIENTS_SIZE=$(du -sh "$CLIENTS_ARCHIVE" | cut -f1)
fi

# === 4. Chiffrement GPG avant upload B2 ===
encrypt_archive() {
  local src="$1"
  local dest="${src}.gpg"
  gpg --batch --yes --trust-model always \
      --encrypt --recipient "$GPG_RECIPIENT" \
      --output "$dest" "$src" 2>/dev/null || return 1
  # Remove plaintext source after successful encryption
  rm -f "$src"
  echo "$dest"
}

log "Encrypting archives with GPG ($GPG_RECIPIENT)"
CODE_ARCHIVE_ENC=$(encrypt_archive "$CODE_ARCHIVE") || fail "GPG encrypt code failed"
DATA_ARCHIVE_ENC=$(encrypt_archive "$DATA_ARCHIVE") || fail "GPG encrypt data failed"
CLIENTS_ARCHIVE_ENC=""
if [ -n "$CLIENTS_ARCHIVE" ]; then
  CLIENTS_ARCHIVE_ENC=$(encrypt_archive "$CLIENTS_ARCHIVE") || fail "GPG encrypt clients failed"
fi

# === 5. Upload Backblaze B2 (dossier du jour, fichiers chiffrés uniquement) ===
B2_PATH="$B2_REMOTE/$TODAY"

UPLOAD_LOG=$(mktemp)
rclone copy "$CODE_ARCHIVE_ENC" "$B2_PATH/" --transfers 2 --retries 3 2>"$UPLOAD_LOG" \
  || fail "B2 upload code failed: $(tail -3 "$UPLOAD_LOG")"

rclone copy "$DATA_ARCHIVE_ENC" "$B2_PATH/" --transfers 2 --retries 3 2>"$UPLOAD_LOG" \
  || fail "B2 upload data failed: $(tail -3 "$UPLOAD_LOG")"

if [ -n "$CLIENTS_ARCHIVE_ENC" ]; then
  rclone copy "$CLIENTS_ARCHIVE_ENC" "$B2_PATH/" --transfers 2 --retries 3 2>"$UPLOAD_LOG" \
    || fail "B2 upload clients failed"
fi
rm -f "$UPLOAD_LOG"

# === 6. Retention locale (7j, encrypted only) ===
find "$BACKUP_DIR" -name "moltbot-*.tar.gz.gpg" -mtime +$LOCAL_RETENTION_DAYS -delete 2>/dev/null
# Cleanup any leftover plaintext archives from interrupted runs
find "$BACKUP_DIR" -name "moltbot-*.tar.gz" -mtime +$LOCAL_RETENTION_DAYS -delete 2>/dev/null

# === 7. Retention B2 (30j) ===
CUTOFF_DATE=$(date -d "$B2_RETENTION_DAYS days ago" +%Y-%m-%d)
rclone lsf "$B2_REMOTE" --dirs-only 2>/dev/null | while read -r dir; do
  dir_clean="${dir%/}"
  if [[ "$dir_clean" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    if [[ "$dir_clean" < "$CUTOFF_DATE" ]]; then
      rclone purge "$B2_REMOTE/$dir_clean" 2>/dev/null && log "🗑️  Purged old B2 backup $dir_clean"
    fi
  fi
done

# === 8. Succès ===
TOTAL_SIZE=$(du -sh "$BACKUP_DIR"/moltbot-*-$DATE.tar.gz.gpg 2>/dev/null | tail -1 | cut -f1)
B2_OBJECTS=$(rclone lsf "$B2_PATH" 2>/dev/null | wc -l)

log "✅ Backup OK — code=$CODE_SIZE data=$DATA_SIZE clients=${CLIENTS_SIZE:-N/A} | GPG encrypted | B2=$B2_OBJECTS objects uploaded"

notify_telegram "✅ *Backup iFIND OK* — $TODAY
📦 Code : $CODE_SIZE
💾 Data : $DATA_SIZE
👥 Clients : ${CLIENTS_SIZE:-N/A}
🔐 Chiffrement : GPG ($GPG_RECIPIENT)
☁️  B2 : $B2_OBJECTS fichiers → \`$TODAY/\`
🗓️ Retention locale : ${LOCAL_RETENTION_DAYS}j
☁️ Retention B2 : ${B2_RETENTION_DAYS}j"

# Ping Healthchecks.io (success)
[ -n "${HC_PING_BACKUP:-}" ] && curl -fsS --retry 2 --max-time 10 "$HC_PING_BACKUP" > /dev/null 2>&1

exit 0
