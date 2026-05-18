#!/bin/bash
# V1 18/05/2026 — Cron wrapper /api/internal/credits-anniversary-check
# Cadence : tous les jours 00:05 UTC.
# Vérifie pour chaque client si now >= creditsLastResetAt + 30j et reset.
#
# Crontab a poser manuellement (en remplacement du reset mensuel 1er du mois) :
#   5 0 * * * /opt/moltbot/scripts/credits-anniversary-check-cron.sh
set -uo pipefail

source /opt/moltbot/scripts/.run-pollers.env

URL="http://127.0.0.1:3100/api/internal/credits-anniversary-check"
LOG="/var/log/ifind-credits.log"
TMP="/tmp/credits-anniversary.out"

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

START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "[$START] START credits-anniversary-check" >> "$LOG"

HTTP_CODE=$(curl -sS -o "$TMP" -w "%{http_code}" \
  --max-time 60 \
  -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "$URL" || echo "curl_error")

END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

SCANNED=$(python3 -c "
import json
try:
    d = json.load(open('$TMP'))
    print(d.get('scanned', '?'))
except Exception:
    print('?')
" 2>/dev/null || echo "?")
RESET_COUNT=$(python3 -c "
import json
try:
    d = json.load(open('$TMP'))
    print(d.get('resetCount', '?'))
except Exception:
    print('?')
" 2>/dev/null || echo "?")
GUARANTEE=$(python3 -c "
import json
try:
    d = json.load(open('$TMP'))
    print(d.get('guaranteeTriggeredCount', '?'))
except Exception:
    print('?')
" 2>/dev/null || echo "?")

echo "[$END] END http=$HTTP_CODE scanned=$SCANNED reset=$RESET_COUNT guaranteeTriggered=$GUARANTEE" >> "$LOG"

if [ "$HTTP_CODE" != "200" ]; then
  send_telegram "🔴 *iFIND credits-anniversary KO* — http=\`${HTTP_CODE}\`. Verifier logs : \`tail /var/log/ifind-credits.log\`"
fi
