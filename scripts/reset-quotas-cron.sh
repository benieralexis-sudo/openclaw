#!/bin/bash
# Sprint 8 (10/05/2026) — Cron wrapper /api/internal/reset-quotas
# Cadence : 1er du mois 00:01 UTC (mensuel).
# Reset Client.quotaConfig.{anthropic,apify,theirstack}.currentSpendUsd = 0
# pour tous les clients ACTIVE.
#
# Crontab a poser manuellement :
#   1 0 1 * * /opt/moltbot/scripts/reset-quotas-cron.sh
set -uo pipefail

source /opt/moltbot/scripts/.run-pollers.env

URL="http://127.0.0.1:3100/api/internal/reset-quotas"
LOG="/var/log/ifind-quotas.log"
TMP="/tmp/reset-quotas.out"

# Telegram helper
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
echo "[$START] START reset-quotas" >> "$LOG"

HTTP_CODE=$(curl -sS -o "$TMP" -w "%{http_code}" \
  --max-time 60 \
  -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "$URL" || echo "curl_error")

END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

RESET_COUNT=$(python3 -c "
import json
try:
    d = json.load(open('$TMP'))
    print(d.get('resetCount', '?'))
except Exception:
    print('?')
" 2>/dev/null || echo "?")

echo "[$END] END http=$HTTP_CODE resetCount=$RESET_COUNT" >> "$LOG"

if [ "$HTTP_CODE" = "200" ]; then
  send_telegram "💰 *iFIND quotas reset* — \`${RESET_COUNT}\` clients ACTIVE re-init le 1er du mois (anthropic+apify+theirstack)."
else
  send_telegram "🔴 *iFIND reset-quotas KO* — http=\`${HTTP_CODE}\`. Verifier logs : \`tail /var/log/ifind-quotas.log\`"
fi
