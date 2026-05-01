#!/bin/bash
# Cron wrapper for /api/internal/run-pollers (DigitestLab)
# Cadence: hourly. Enrichit triggers entrants → leads.
set -euo pipefail

source /opt/moltbot/scripts/.run-pollers.env

CLIENT_ID="${1:-cmoevcce00001l6uuklcp13wx}"
URL="http://127.0.0.1:3100/api/internal/run-pollers?source=cron&clientId=${CLIENT_ID}"
LOG="/var/log/ifind-pollers.log"
TMP="/tmp/run-pollers.out"

START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "[$START] START client=$CLIENT_ID" >> "$LOG"

HTTP_CODE=$(curl -sS -o "$TMP" -w "%{http_code}" \
  --max-time 900 \
  -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "$URL" || echo "curl_error")

END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Parsing résumé lisible (jq fallback python si absent)
SUMMARY=$(python3 -c "
import json, sys
try:
    d = json.load(open('$TMP'))
    s = d.get('summary', [{}])[0]
    parts = [
        f\"http=$HTTP_CODE\",
        f\"runId={d.get('runId','?')}\",
        f\"opusQ={s.get('opusQualified',0)}\",
        f\"created={s.get('ensuredLeads',{}).get('created',0)}\",
        f\"existed={s.get('ensuredLeads',{}).get('alreadyExisted',0)}\",
        f\"merged={s.get('dedup',{}).get('leadsMerged',0)}\",
        f\"liFound={s.get('linkedinFinder',{}).get('found',0)}/{s.get('linkedinFinder',{}).get('attempted',0)}\",
        f\"kasprEmail={s.get('kasprDirect',{}).get('workEmailFound',0)}\",
        f\"kasprPhone={s.get('kasprDirect',{}).get('mobileFound',0)}\",
        f\"feMail={s.get('fullEnrich',{}).get('emailFound',0)}\",
        f\"fePhone={s.get('fullEnrich',{}).get('phoneFound',0)}\",
        f\"feCr={s.get('fullEnrich',{}).get('creditsUsed',0)}\",
        f\"errors={sum(s.get(k,{}).get('errors',0) if isinstance(s.get(k,{}).get('errors',0), int) else len(s.get(k,{}).get('errors',[])) for k in ['rodzEnrich','linkedinFinder','dirigeants','kasprDirect','fullEnrich','growthAlerts','harvestapiDM','declarativePain'])}\",
    ]
    print(' | '.join(parts))
except Exception as e:
    print(f\"http=$HTTP_CODE parse_error={e}\")
" 2>/dev/null || echo "http=$HTTP_CODE parse_failed")

echo "[$END] END $SUMMARY" >> "$LOG"
