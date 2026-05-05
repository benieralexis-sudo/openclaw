#!/bin/bash
# Sprint 10 (05/05/2026) — Cron daily Telegram digest 24h.
# Cadence: 7h UTC quotidien.
# Endpoint: POST /api/internal/health-digest avec x-cron-secret.
set -euo pipefail

source /opt/moltbot/scripts/.run-pollers.env

URL="http://127.0.0.1:3100/api/internal/health-digest"
LOG="/var/log/ifind-health-digest.log"

START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "[$START] START health-digest" >> "$LOG"

HTTP_CODE=$(curl -sS -o /tmp/health-digest.out -w "%{http_code}" \
  --max-time 60 \
  -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "$URL" || echo "curl_error")

END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "[$END] END http=$HTTP_CODE" >> "$LOG"

# Si HTTP error : log la réponse pour debug
if [ "$HTTP_CODE" != "200" ]; then
  echo "[$END] ERROR body:" >> "$LOG"
  cat /tmp/health-digest.out >> "$LOG"
  echo "" >> "$LOG"
  exit 1
fi

exit 0
