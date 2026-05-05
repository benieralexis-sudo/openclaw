#!/bin/bash
# Bonus D (05/05/2026) — Cron weekly refresh few-shots dynamiques.
# Cadence: lundi 8h05 UTC (5 min après healthcheck-daily pour éviter contention).
# Endpoint: POST /api/internal/refresh-dynamic-few-shots avec x-cron-secret.
set -euo pipefail

source /opt/moltbot/scripts/.run-pollers.env

URL="http://127.0.0.1:3100/api/internal/refresh-dynamic-few-shots"
LOG="/var/log/ifind-refresh-few-shots.log"

START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "[$START] START refresh-few-shots" >> "$LOG"

HTTP_CODE=$(curl -sS -o /tmp/refresh-few-shots.out -w "%{http_code}" \
  --max-time 120 \
  -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "$URL" || echo "curl_error")

END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "[$END] END http=$HTTP_CODE" >> "$LOG"

# Si HTTP error : log la réponse pour debug
if [ "$HTTP_CODE" != "200" ]; then
  echo "[$END] ERROR body:" >> "$LOG"
  cat /tmp/refresh-few-shots.out >> "$LOG"
  echo "" >> "$LOG"
  exit 1
fi

exit 0
