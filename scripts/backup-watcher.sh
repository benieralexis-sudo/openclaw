#!/bin/bash
# P23 (Vague 3 perfection 100%) — Alerte Telegram si backup absent depuis >25h.
#
# Le cron backup-external.sh tourne 0 3 * * * (3h UTC). On verifie que le
# dernier .tar.gz.gpg dans /opt/moltbot/backups date de moins de 25h.
# Cron dedie : 0 5 * * * (1h apres backup attendu).
set -uo pipefail

BACKUP_DIR="/opt/moltbot/backups"
LOG="/var/log/ifind-backup-watcher.log"
STATE="/tmp/ifind-backup-watcher-state"

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(grep ^TELEGRAM_BOT_TOKEN /opt/moltbot/.env 2>/dev/null | cut -d= -f2)}"
ADMIN_CHAT_ID="${ADMIN_CHAT_ID:-$(grep ^ADMIN_CHAT_ID /opt/moltbot/.env 2>/dev/null | cut -d= -f2)}"

send_telegram() {
  local msg="$1"
  [ -z "$TELEGRAM_BOT_TOKEN" ] && return 0
  curl -sS --max-time 10 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${ADMIN_CHAT_ID}" \
    -d parse_mode="Markdown" \
    --data-urlencode text="${msg}" >/dev/null 2>&1
}

NOW=$(date '+%Y-%m-%d %H:%M:%S')

# Cherche un fichier *.tar.gz.gpg modifie dans les dernieres 25h (1500 min)
LATEST=$(find "$BACKUP_DIR" -name "*.tar.gz.gpg" -mmin -1500 2>/dev/null | head -1)

PREV_STATE="ok"
[ -f "$STATE" ] && PREV_STATE=$(cat "$STATE")

if [ -z "$LATEST" ]; then
  echo "[$NOW] BACKUP MISSING — aucun .tar.gz.gpg <25h dans $BACKUP_DIR" >> "$LOG"
  if [ "$PREV_STATE" != "missing" ]; then
    LATEST_OLD=$(find "$BACKUP_DIR" -name "*.tar.gz.gpg" -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2)
    AGE_INFO="(aucun fichier trouve)"
    if [ -n "$LATEST_OLD" ]; then
      AGE_HOURS=$(( ($(date +%s) - $(stat -c %Y "$LATEST_OLD")) / 3600 ))
      AGE_INFO="dernier : \`$(basename $LATEST_OLD)\` (${AGE_HOURS}h)"
    fi
    send_telegram "🚨 *iFIND backup absent* depuis >25h. ${AGE_INFO}. Verifier cron 3h UTC : \`tail /opt/moltbot/backups/backup.log\`"
  fi
  echo "missing" > "$STATE"
else
  echo "[$NOW] OK — backup recent : $(basename $LATEST)" >> "$LOG"
  if [ "$PREV_STATE" = "missing" ]; then
    send_telegram "✅ *iFIND backup recovery* — \`$(basename $LATEST)\` present."
  fi
  echo "ok" > "$STATE"
fi
