#!/bin/bash
# Cron wrapper for /api/internal/run-pollers (DigitestLab)
# Cadence: hourly. Enrichit triggers entrants → leads.
#
# P18 (Vague 3 perfection 100%) — durci :
#   - Lock fichier : skip si run precedent encore actif (anti-overlap)
#   - Detection zombi : 4 cycles consecutifs opusQ=0 → ping Telegram
#   - Budget guard Anthropic : burn 24h projete > $5 → ping Telegram
set -uo pipefail

source /opt/moltbot/scripts/.run-pollers.env

CLIENT_ID="${1:-cmoevcce00001l6uuklcp13wx}"
URL="http://127.0.0.1:3100/api/internal/run-pollers?source=cron&clientId=${CLIENT_ID}"
LOG="/var/log/ifind-pollers.log"
TMP="/tmp/run-pollers.out"
LOCK="/var/run/run-pollers.lock"
ZOMBI_THRESHOLD=4   # cycles consecutifs opusQ=0 = bot inactif
BUDGET_THRESHOLD=5  # USD/jour seuil alerte burn

# ---- Telegram helper -----------------------------------------------------
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

# ---- Lock anti-overlap ---------------------------------------------------
if [ -f "$LOCK" ]; then
  PREV_PID=$(cat "$LOCK" 2>/dev/null || echo "")
  if [ -n "$PREV_PID" ] && kill -0 "$PREV_PID" 2>/dev/null; then
    NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "[$NOW] SKIP — run precedent PID=$PREV_PID encore actif" >> "$LOG"
    send_telegram "⏭️ *iFIND run-pollers* — skip cycle, run PID=\`${PREV_PID}\` encore actif (lock)"
    exit 0
  fi
  # PID stale, on nettoie
  rm -f "$LOCK"
fi
echo $$ > "$LOCK"
trap "rm -f $LOCK" EXIT

# ---- Cycle principal -----------------------------------------------------
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

# ---- P21 — Detection zombi (4 cycles consecutifs opusQ=0) ----------------
ZOMBI_STATE="/tmp/run-pollers-zombi-state"
RECENT_OPUS_Q=$(tail -n 50 "$LOG" | grep -E '^\[.*\] END ' | tail -n "$ZOMBI_THRESHOLD" | grep -oE 'opusQ=[0-9]+' | cut -d= -f2)
RECENT_COUNT=$(echo "$RECENT_OPUS_Q" | grep -c .)
ALL_ZERO=true
if [ "$RECENT_COUNT" -lt "$ZOMBI_THRESHOLD" ]; then
  ALL_ZERO=false  # pas assez d'historique
else
  for v in $RECENT_OPUS_Q; do
    [ "$v" != "0" ] && ALL_ZERO=false
  done
fi

PREV_ZOMBI_NOTIF=0
[ -f "$ZOMBI_STATE" ] && PREV_ZOMBI_NOTIF=$(cat "$ZOMBI_STATE")
NOW_EPOCH=$(date +%s)
ZOMBI_RENOTIF=$((6 * 3600))  # re-ping max 1×/6h pour eviter spam

if [ "$ALL_ZERO" = true ]; then
  AGE=$((NOW_EPOCH - PREV_ZOMBI_NOTIF))
  if [ "$AGE" -gt "$ZOMBI_RENOTIF" ]; then
    send_telegram "🧟 *iFIND zombi* — ${ZOMBI_THRESHOLD} cycles run-pollers consecutifs avec opusQ=0. Bot inactif sur DTL ? Verifier logs : \`tail /var/log/ifind-pollers.log\`"
    echo "$NOW_EPOCH" > "$ZOMBI_STATE"
  fi
fi

# ---- P22 — Budget guard Anthropic (burn 24h > seuil) ---------------------
BURN_OUT=$(python3 /opt/moltbot/scripts/calc-anthropic-burn-24h.py --update-state 2>/dev/null)
BURN_24H=$(echo "$BURN_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('burn_24h_usd',0))" 2>/dev/null || echo "0")
DELTA_SEC=$(echo "$BURN_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('delta_seconds',0))" 2>/dev/null || echo "0")

BUDGET_STATE="/tmp/run-pollers-budget-state"
PREV_BUDGET_NOTIF=0
[ -f "$BUDGET_STATE" ] && PREV_BUDGET_NOTIF=$(cat "$BUDGET_STATE")
BUDGET_RENOTIF=$((6 * 3600))

# Seuil declanche si burn > seuil ET fenetre >= 1h (sinon trop volatile)
if (( $(echo "$BURN_24H > $BUDGET_THRESHOLD" | bc -l 2>/dev/null || echo 0) )) && [ "$DELTA_SEC" -ge 3600 ]; then
  AGE=$((NOW_EPOCH - PREV_BUDGET_NOTIF))
  if [ "$AGE" -gt "$BUDGET_RENOTIF" ]; then
    send_telegram "🔥 *Anthropic burn 24h projete = \$${BURN_24H}* (seuil \$${BUDGET_THRESHOLD}). Verifier fuite : \`grep qualify-trigger.usage /var/log/dashboard-v2.log | tail -100\`"
    echo "$NOW_EPOCH" > "$BUDGET_STATE"
  fi
fi
