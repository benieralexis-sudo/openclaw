#!/bin/bash
# Sprint Saint Graal (10/05/2026) — Cron wrapper /api/internal/reset-monthly-credits
# Cadence : 1er du mois 00:05 UTC (apres reset-quotas a 00:01).
# Reset Client.creditsBalance + check garantie Pepite + double quota si ratee.
#
# Crontab a poser manuellement :
#   5 0 1 * * /opt/moltbot/scripts/reset-monthly-credits-cron.sh
set -uo pipefail

source /opt/moltbot/scripts/.run-pollers.env

URL="http://127.0.0.1:3100/api/internal/reset-monthly-credits"
LOG="/var/log/ifind-credits.log"
TMP="/tmp/reset-credits.out"

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
echo "[$START] START reset-monthly-credits" >> "$LOG"

HTTP_CODE=$(curl -sS -o "$TMP" -w "%{http_code}" \
  --max-time 60 \
  -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "$URL" || echo "curl_error")

END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

PROCESSED=$(python3 -c "
import json
try:
    d = json.load(open('$TMP'))
    print(d.get('processedCount', '?'))
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

echo "[$END] END http=$HTTP_CODE processed=$PROCESSED guaranteeTriggered=$GUARANTEE" >> "$LOG"

if [ "$HTTP_CODE" != "200" ]; then
  send_telegram "🔴 *iFIND reset-credits KO* — http=\`${HTTP_CODE}\`. Verifier logs : \`tail /var/log/ifind-credits.log\`"
fi
