#!/bin/bash
# Cron wrapper for /api/internal/run-pollers?source=all (DigitestLab)
# Cadence: 2x/jour (8h + 18h UTC) — pipeline complet.
#
# Diff vs run-pollers-cron.sh (cron horaire light) :
#   - source=all (vs source=cron)
#   - déclenche TOUS les pollers (Apify, TheirStack, FT, RSS-levees, BODACC, INPI, JOAFE)
#   - déclenche TOUS les enrichissements coûteux (HarvestAPI DM, Pappers dirigeants,
#     Rodz enrichContact, LinkedIn finder, Kaspr, FullEnrich)
#   - lock séparé pour pouvoir tourner en parallèle du cron horaire light
#
# Audit 10/05 : creation après shutdown bot (qui auparavant lancait source=all
# via ses crons internes). Sans ce script, 6/9 sources iFIND étaient muettes.
#
# Quotas surveillés :
#   - Apify $100/mois plafond — 2x/j × $0.5/run = $1/j × 30 = $30/mois (safe)
#   - TheirStack 5200 cr/mois — gate UTC=18 dans route.ts (1x/j job-offer + 1x/j buying-intent)
set -uo pipefail

source /opt/moltbot/scripts/.run-pollers.env

CLIENT_ID="${1:-cmoevcce00001l6uuklcp13wx}"
URL="http://127.0.0.1:3100/api/internal/run-pollers?source=all&clientId=${CLIENT_ID}"
LOG="/var/log/ifind-pollers-all.log"
TMP="/tmp/run-pollers-all.out"
LOCK="/var/run/run-pollers-all.lock"
TIMEOUT_S=600   # 10min max — source=all peut prendre 2-5min selon enrich

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
    send_telegram "⏭️ *iFIND run-pollers-all* — skip cycle, run PID=\`${PREV_PID}\` encore actif (lock)"
    exit 0
  fi
  rm -f "$LOCK"
fi
echo $$ > "$LOCK"
trap "rm -f $LOCK" EXIT

# ---- Cycle principal -----------------------------------------------------
START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "[$START] START source=all client=$CLIENT_ID" >> "$LOG"

HTTP_CODE=$(curl -sS -o "$TMP" -w "%{http_code}" \
  --max-time "$TIMEOUT_S" \
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
        f\"apify={s.get('apify',{}).get('totalTriggersCreated',0)}\",
        f\"theirstack={s.get('theirstack',{}).get('jobsCreated','skip')}\",
        f\"rssLevees={s.get('rssLevees',{}).get('triggersCreated','skip')}\",
        f\"recovery={s.get('recovery',{}).get('revived',0)}/{s.get('recovery',{}).get('candidates',0)}\",
        f\"liFound={s.get('linkedinFinder',{}).get('found',0)}/{s.get('linkedinFinder',{}).get('attempted',0)}\",
        f\"kasprEmail={s.get('kasprDirect',{}).get('workEmailFound',0)}\",
        f\"kasprPhone={s.get('kasprDirect',{}).get('mobileFound',0)}\",
        f\"feMail={s.get('fullEnrich',{}).get('emailFound',0)}\",
        f\"fePhone={s.get('fullEnrich',{}).get('phoneFound',0)}\",
        f\"feCr={s.get('fullEnrich',{}).get('creditsUsed',0)}\",
        f\"briefs={s.get('autoBriefs',{}).get('generated',0)}\",
    ]
    print(' | '.join(parts))
except Exception as e:
    print(f\"http=$HTTP_CODE parse_error={e}\")
" 2>/dev/null || echo "http=$HTTP_CODE parse_failed")

echo "[$END] END $SUMMARY" >> "$LOG"

# ---- Alerte si HTTP non-200 ----------------------------------------------
if [ "$HTTP_CODE" != "200" ]; then
  send_telegram "🔴 *iFIND run-pollers-all KO* — HTTP=\`${HTTP_CODE}\`, voir \`$LOG\`"
fi
