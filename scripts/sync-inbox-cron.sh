#!/bin/bash
# Cron wrapper pour /api/internal/sync-inbox (poll IMAP toutes les 5 min).
# Détecte les replies sur les mailboxes Primeforge → table Reply.
set -euo pipefail

source /opt/moltbot/scripts/.run-pollers.env  # CRON_SECRET partagé

URL="http://127.0.0.1:3100/api/internal/sync-inbox"
LOG="/var/log/ifind-sync-inbox.log"
TMP="/tmp/sync-inbox.out"

START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "[$START] START" >> "$LOG"

HTTP_CODE=$(curl -sS -o "$TMP" -w "%{http_code}" \
  --max-time 90 \
  -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "$URL" || echo "curl_error")

END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

SUMMARY=$(python3 -c "
import json
try:
    d = json.load(open('$TMP'))
    parts = [
        f\"http=$HTTP_CODE\",
        f\"scanned={d.get('scanned',0)}\",
        f\"matched={d.get('matched',0)}\",
        f\"created={d.get('created',0)}\",
        f\"dup={d.get('skippedDuplicate',0)}\",
        f\"noReply={d.get('skippedNoReply',0)}\",
        f\"noMatch={d.get('skippedNoMatch',0)}\",
        f\"err={len(d.get('errors',[]))}\",
    ]
    print(' | '.join(parts))
except Exception as e:
    print(f\"http=$HTTP_CODE parse_error={e}\")
" 2>/dev/null || echo "http=$HTTP_CODE parse_failed")

echo "[$END] END $SUMMARY" >> "$LOG"
