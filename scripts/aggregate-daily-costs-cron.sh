#!/bin/bash
# V1 18/05/2026 — Cron wrapper /api/internal/aggregate-daily-costs
# Cadence : tous les jours 01h05 UTC (après que la journée précédente est figée).
# Calcule pour chaque client × service le volume et coût USD de la veille.
#
# Crontab :
#   5 1 * * * /opt/moltbot/scripts/aggregate-daily-costs-cron.sh
set -uo pipefail

source /opt/moltbot/scripts/.run-pollers.env

URL="http://127.0.0.1:3100/api/internal/aggregate-daily-costs"
LOG="/var/log/ifind-costs.log"
TMP="/tmp/aggregate-costs.out"

START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "[$START] START aggregate-daily-costs" >> "$LOG"

HTTP_CODE=$(curl -sS -o "$TMP" -w "%{http_code}" \
  --max-time 60 \
  -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "$URL" || echo "curl_error")

END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

TOTAL_USD=$(python3 -c "
import json
try:
    d = json.load(open('$TMP'))
    print(d.get('totalUsd', '?'))
except Exception:
    print('?')
" 2>/dev/null || echo "?")
CLIENTS=$(python3 -c "
import json
try:
    d = json.load(open('$TMP'))
    print(d.get('clientsProcessed', '?'))
except Exception:
    print('?')
" 2>/dev/null || echo "?")

echo "[$END] END http=$HTTP_CODE clients=$CLIENTS totalUsd=$TOTAL_USD" >> "$LOG"
