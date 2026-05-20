#!/bin/bash
# Cron wrapper for /api/internal/run-pollers
# Cadence: hourly. Enrichit triggers entrants → leads (pipeline léger).
#
# Multi-tenant (14/05/2026) — Si appelé SANS argument, itère sur tous les
# clients Client.status=ACTIVE en DB. Si appelé AVEC un clientId, comportement
# legacy (1 seul client). Lock + TMP par client.
#
# P18 (Vague 3 perfection 100%) — durci :
#   - Lock fichier per-client : skip si run precedent encore actif
#   - Detection zombi global : 24 cycles consecutifs opusQ=0 → ping Telegram
#   - Budget guard Anthropic : burn 24h projete > $5 → ping Telegram
set -uo pipefail

source /opt/moltbot/scripts/.run-pollers.env

LOG="/var/log/ifind-pollers.log"
ZOMBI_THRESHOLD=24  # cycles consecutifs opusQ=0 = bot vraiment inactif (24h)
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

# ---- Liste des clients à traiter ---------------------------------------
if [ "${1:-}" != "" ]; then
  CLIENTS=("${1}|adhoc")
else
  PG_PWD=$(grep ^DATABASE_URL /opt/moltbot/dashboard-v2/.env | sed -E 's|.*ifind:([^@]+)@.*|\1|')
  CLIENTS_RAW=$(docker exec -e PGPASSWORD="$PG_PWD" ifind-postgres \
    psql -U ifind -d ifind -t -A -F'|' \
    -c "SELECT id, slug FROM \"Client\" WHERE status IN ('ACTIVE', 'PROSPECT') AND \"deletedAt\" IS NULL ORDER BY \"createdAt\";" 2>/dev/null)
  if [ -z "$CLIENTS_RAW" ]; then
    NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "[$NOW] ERROR — DB query failed, no clients to process" >> "$LOG"
    send_telegram "🔴 *iFIND run-pollers* — DB query Client ACTIVE échouée, run skipped"
    exit 1
  fi
  mapfile -t CLIENTS <<< "$CLIENTS_RAW"
fi

# ---- Boucle clients ----------------------------------------------------
OVERALL_EXIT=0
for entry in "${CLIENTS[@]}"; do
  CLIENT_ID="${entry%%|*}"
  CLIENT_SLUG="${entry##*|}"
  [ -z "$CLIENT_ID" ] && continue

  URL="http://127.0.0.1:3100/api/internal/run-pollers?source=cron&clientId=${CLIENT_ID}"
  TMP="/tmp/run-pollers.${CLIENT_ID}.out"
  LOCK="/var/run/run-pollers.${CLIENT_ID}.lock"

  # ---- Lock anti-overlap (per-client) ---------------------------------
  if [ -f "$LOCK" ]; then
    PREV_PID=$(cat "$LOCK" 2>/dev/null || echo "")
    if [ -n "$PREV_PID" ] && kill -0 "$PREV_PID" 2>/dev/null; then
      NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      echo "[$NOW] [client=$CLIENT_SLUG] SKIP — run precedent PID=$PREV_PID encore actif" >> "$LOG"
      send_telegram "⏭️ *iFIND run-pollers* (\`${CLIENT_SLUG}\`) — skip cycle, run PID=\`${PREV_PID}\` encore actif"
      continue
    fi
    rm -f "$LOCK"
  fi
  echo $$ > "$LOCK"

  # ---- Cycle pour ce client -------------------------------------------
  START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$START] [client=$CLIENT_SLUG] START client=$CLIENT_ID" >> "$LOG"

  HTTP_CODE=$(curl -sS -o "$TMP" -w "%{http_code}" \
    --max-time 900 \
    -X POST \
    -H "x-cron-secret: $CRON_SECRET" \
    "$URL" || echo "curl_error")

  END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Parsing résumé lisible
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

  echo "[$END] [client=$CLIENT_SLUG] END $SUMMARY" >> "$LOG"

  if [ "$HTTP_CODE" != "200" ]; then
    OVERALL_EXIT=1
  fi

  rm -f "$LOCK"
done

# ---- P21 — Detection zombi (global, post-boucle) -------------------------
ZOMBI_STATE="/tmp/run-pollers-zombi-state"
RECENT_OPUS_Q=$(tail -n 100 "$LOG" | grep -E '^\[.*\] \[client=[^]]+\] END ' | tail -n "$ZOMBI_THRESHOLD" | grep -oE 'opusQ=[0-9]+' | cut -d= -f2)
RECENT_COUNT=$(echo "$RECENT_OPUS_Q" | grep -c .)
ALL_ZERO=true
if [ "$RECENT_COUNT" -lt "$ZOMBI_THRESHOLD" ]; then
  ALL_ZERO=false
else
  for v in $RECENT_OPUS_Q; do
    [ "$v" != "0" ] && ALL_ZERO=false
  done
fi

PREV_ZOMBI_NOTIF=0
[ -f "$ZOMBI_STATE" ] && PREV_ZOMBI_NOTIF=$(cat "$ZOMBI_STATE")
NOW_EPOCH=$(date +%s)
ZOMBI_RENOTIF=$((6 * 3600))

if [ "$ALL_ZERO" = true ]; then
  AGE=$((NOW_EPOCH - PREV_ZOMBI_NOTIF))
  if [ "$AGE" -gt "$ZOMBI_RENOTIF" ]; then
    send_telegram "🧟 *iFIND zombi* — ${ZOMBI_THRESHOLD} cycles run-pollers consecutifs avec opusQ=0 (tous clients). Bot inactif ? Verifier logs : \`tail /var/log/ifind-pollers.log\`"
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

if (( $(echo "$BURN_24H > $BUDGET_THRESHOLD" | bc -l 2>/dev/null || echo 0) )) && [ "$DELTA_SEC" -ge 3600 ]; then
  AGE=$((NOW_EPOCH - PREV_BUDGET_NOTIF))
  if [ "$AGE" -gt "$BUDGET_RENOTIF" ]; then
    send_telegram "🔥 *Anthropic burn 24h projete = \$${BURN_24H}* (seuil \$${BUDGET_THRESHOLD}). Verifier fuite : \`grep qualify-trigger.usage /var/log/dashboard-v2.log | tail -100\`"
    echo "$NOW_EPOCH" > "$BUDGET_STATE"
  fi
fi

exit $OVERALL_EXIT
