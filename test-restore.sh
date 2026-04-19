#!/bin/bash
# iFIND — Test de restauration automatique hebdomadaire
# Télécharge le backup B2 le plus récent, restaure dans un container sandbox,
# vérifie que les archives sont intègres et que le contenu est cohérent.
set -u

DATE=$(date +%Y-%m-%d_%H%M)
TODAY=$(date +%Y-%m-%d)
B2_REMOTE="b2:ifind-bot-backup"
SANDBOX="/tmp/ifind-restore-test"
LOG="/opt/moltbot/backups/restore-test.log"
GPG_RECIPIENT="backup@ifind.fr"
GPG_PASSPHRASE_FILE="/root/.moltbot-backup-gpg-passphrase"

set -a
source /opt/moltbot/.env 2>/dev/null
set +a

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
  log "❌ RESTORE TEST FAILED — $1"
  notify_telegram "🚨 *Restore Test FAILED* — $TODAY
$1
Les backups ne sont pas fiables — intervention requise.
SSH : ssh root@76.13.137.130
Log : $LOG"
  [ -n "${HC_PING_RESTORE:-}" ] && curl -fsS --retry 2 --max-time 10 "$HC_PING_RESTORE/fail" --data-raw "$1" > /dev/null 2>&1
  rm -rf "$SANDBOX"
  exit 1
}

log "START restore test $DATE"
rm -rf "$SANDBOX"
mkdir -p "$SANDBOX"

# === 1. Trouver le backup le plus récent sur B2 ===
LATEST_DIR=$(rclone lsf "$B2_REMOTE" --dirs-only 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}/$' | sort -r | head -1 | tr -d '/')
if [ -z "$LATEST_DIR" ]; then
  fail "No backup found on B2"
fi
log "Testing backup: $LATEST_DIR"

# === 2. Télécharger les 3 archives depuis B2 ===
rclone copy "$B2_REMOTE/$LATEST_DIR/" "$SANDBOX/" --transfers 2 2>/dev/null \
  || fail "Download from B2 failed"

# Accept both legacy .tar.gz and new encrypted .tar.gz.gpg
ENC_COUNT=$(ls "$SANDBOX"/*.tar.gz.gpg 2>/dev/null | wc -l)
PLAIN_COUNT=$(ls "$SANDBOX"/*.tar.gz 2>/dev/null | grep -v '\.gpg$' | wc -l)
ARCHIVES=$((ENC_COUNT + PLAIN_COUNT))
[ "$ARCHIVES" -lt 2 ] && fail "Expected at least 2 archives, found $ARCHIVES"

# === 3a. Déchiffrer les archives GPG si présentes ===
if [ "$ENC_COUNT" -gt 0 ]; then
  if [ ! -f "$GPG_PASSPHRASE_FILE" ]; then
    fail "GPG passphrase file missing: $GPG_PASSPHRASE_FILE"
  fi
  for enc in "$SANDBOX"/*.tar.gz.gpg; do
    dec="${enc%.gpg}"
    gpg --batch --yes --pinentry-mode loopback \
        --passphrase-file "$GPG_PASSPHRASE_FILE" \
        --decrypt --output "$dec" "$enc" 2>/dev/null \
      || fail "GPG decrypt failed: $(basename "$enc")"
  done
  log "GPG decryption OK ($ENC_COUNT files)"
fi

# === 3b. Vérifier l'intégrité des archives ===
for archive in "$SANDBOX"/*.tar.gz; do
  [ -f "$archive" ] || continue
  gunzip -t "$archive" 2>/dev/null || fail "Corrupt archive: $(basename "$archive")"
done
log "Archives intégrité OK ($ARCHIVES fichiers)"

# === 4. Extraire dans sandbox et vérifier contenu attendu ===
mkdir -p "$SANDBOX/extracted"
for archive in "$SANDBOX"/moltbot-*.tar.gz; do
  [ -f "$archive" ] || continue
  tar xzf "$archive" -C "$SANDBOX/extracted/" 2>/dev/null \
    || fail "Extract failed: $(basename "$archive")"
done

# Checks de sanité (fichiers clés doivent être présents)
# .env is EXCLUDED from backups post-A2 — do not check for it
CHECKS_FAILED=""
[ ! -d "$SANDBOX/extracted/gateway" ] && CHECKS_FAILED="$CHECKS_FAILED no-gateway"
[ ! -f "$SANDBOX/extracted/gateway/telegram-router.js" ] && CHECKS_FAILED="$CHECKS_FAILED no-router"
[ ! -d "$SANDBOX/extracted/skills" ] && CHECKS_FAILED="$CHECKS_FAILED no-skills"
[ ! -d "$SANDBOX/extracted/moltbot_automailer-data" ] && CHECKS_FAILED="$CHECKS_FAILED no-automailer-vol"

# Validate .env is NOT in backup (A2 hardening)
if [ -f "$SANDBOX/extracted/.env" ]; then
  CHECKS_FAILED="$CHECKS_FAILED env-leaked-in-backup"
fi

if [ -n "$CHECKS_FAILED" ]; then
  fail "Missing expected files/dirs:$CHECKS_FAILED"
fi

# Taille extraction
EXTRACTED_SIZE=$(du -sh "$SANDBOX/extracted" | cut -f1)
ARCHIVES_SIZE=$(du -sch "$SANDBOX"/*.tar.gz 2>/dev/null | tail -1 | cut -f1)

log "✅ RESTORE TEST OK — archives=$ARCHIVES ($ARCHIVES_SIZE), extracted=$EXTRACTED_SIZE"

notify_telegram "✅ *Restore Test OK* — $TODAY
📦 Backup testé : \`$LATEST_DIR\`
✓ Archives intègres : $ARCHIVES
✓ Fichiers critiques présents
✓ Taille extraite : $EXTRACTED_SIZE
Les backups B2 sont fonctionnels."

# === 5. Cleanup ===
rm -rf "$SANDBOX"

# Ping Healthchecks.io (success)
[ -n "${HC_PING_RESTORE:-}" ] && curl -fsS --retry 2 --max-time 10 "$HC_PING_RESTORE" > /dev/null 2>&1

exit 0
