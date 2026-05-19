#!/bin/bash
# Cron wrapper for /api/internal/run-pollers?source=all
# Cadence: 2x/jour (8h + 18h UTC) — pipeline complet.
#
# Multi-tenant (14/05/2026) — Si appelé SANS argument, itère sur tous les
# clients Client.status=ACTIVE en DB. Si appelé AVEC un clientId, comportement
# legacy (1 seul client). Lock + log + TMP par client pour ne pas qu'un client
# bloque les autres.
#
# Diff vs run-pollers-cron.sh (cron horaire light) :
#   - source=all (vs source=cron)
#   - déclenche TOUS les pollers (Apify, TheirStack, FT, RSS-levees, BODACC, INPI, JOAFE)
#   - déclenche TOUS les enrichissements coûteux (HarvestAPI DM, Pappers dirigeants,
#     Rodz enrichContact, LinkedIn finder, Kaspr, FullEnrich)
#   - lock séparé pour pouvoir tourner en parallèle du cron horaire light
#
# Quotas surveillés :
#   - Apify $100/mois plafond — 2x/j × $0.5/run = $1/j × 30 = $30/mois (safe sur 1 client)
#   - TheirStack 5200 cr/mois — gate UTC=18 dans route.ts
set -uo pipefail

source /opt/moltbot/scripts/.run-pollers.env

LOG="/var/log/ifind-pollers-all.log"
TIMEOUT_S=1200  # 20min max — source=all peut prendre 5-15min.
                # Pivot Bombora FR 18/05 : brief auto réactivé maxPerRun=15
                # ajoute ~80-120s par client. Garde marge pour backlogs.

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
# Si arg 1 fourni → 1 seul client (legacy). Sinon → query DB tous ACTIVE.
if [ "${1:-}" != "" ]; then
  CLIENTS=("${1}|adhoc")
else
  # Query DB via docker (postgres-pwd lue depuis .env du dashboard)
  PG_PWD=$(grep ^DATABASE_URL /opt/moltbot/dashboard-v2/.env | sed -E 's|.*ifind:([^@]+)@.*|\1|')
  # Bombora FR 19/05/2026 (Jour 14) — inclure PROSPECT en plus de ACTIVE.
  # Sinon les clients en phase d'évaluation (ex: Digidemat) ne reçoivent
  # jamais le moindre trigger via le cron. Les pollers payants (Apify,
  # TheirStack) sont gated indépendamment via creditsBalance / capReached.
  CLIENTS_RAW=$(docker exec -e PGPASSWORD="$PG_PWD" ifind-postgres \
    psql -U ifind -d ifind -t -A -F'|' \
    -c "SELECT id, slug FROM \"Client\" WHERE status IN ('ACTIVE', 'PROSPECT') AND \"deletedAt\" IS NULL ORDER BY \"createdAt\";" 2>/dev/null)
  if [ -z "$CLIENTS_RAW" ]; then
    NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "[$NOW] ERROR — DB query failed, no clients to process" >> "$LOG"
    send_telegram "🔴 *iFIND run-pollers-all* — DB query Client ACTIVE échouée, run skipped"
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

  URL="http://127.0.0.1:3100/api/internal/run-pollers?source=all&clientId=${CLIENT_ID}"
  TMP="/tmp/run-pollers-all.${CLIENT_ID}.out"
  LOCK="/var/run/run-pollers-all.${CLIENT_ID}.lock"

  # ---- Lock anti-overlap (per-client) ---------------------------------
  if [ -f "$LOCK" ]; then
    PREV_PID=$(cat "$LOCK" 2>/dev/null || echo "")
    if [ -n "$PREV_PID" ] && kill -0 "$PREV_PID" 2>/dev/null; then
      NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      echo "[$NOW] [client=$CLIENT_SLUG] SKIP — run precedent PID=$PREV_PID encore actif" >> "$LOG"
      send_telegram "⏭️ *iFIND run-pollers-all* (\`${CLIENT_SLUG}\`) — skip cycle, run PID=\`${PREV_PID}\` encore actif"
      continue
    fi
    rm -f "$LOCK"
  fi
  echo $$ > "$LOCK"

  # ---- Cycle pour ce client -------------------------------------------
  START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$START] [client=$CLIENT_SLUG] START source=all client=$CLIENT_ID" >> "$LOG"

  # Retry HTTP 423 (audit 12/05 soir — 38h de lock orphelin causé par conflit
  # de timing avec le cron horaire light). Retry 2x avec backoff 60s = 3 min.
  ATTEMPT=0
  MAX_ATTEMPTS=3
  HTTP_CODE="?"
  while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))
    HTTP_CODE=$(curl -sS -o "$TMP" -w "%{http_code}" \
      --max-time "$TIMEOUT_S" \
      -X POST \
      -H "x-cron-secret: $CRON_SECRET" \
      "$URL" || echo "curl_error")
    if [ "$HTTP_CODE" != "423" ]; then
      break
    fi
    if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
      RETRY_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      echo "[$RETRY_AT] [client=$CLIENT_SLUG] RETRY $ATTEMPT/$MAX_ATTEMPTS — HTTP 423, sleep 60s" >> "$LOG"
      sleep 60
    fi
  done

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

  echo "[$END] [client=$CLIENT_SLUG] END $SUMMARY" >> "$LOG"

  # ---- Alerte si HTTP non-200 -----------------------------------------
  if [ "$HTTP_CODE" != "200" ]; then
    OVERALL_EXIT=1
    if [ "$HTTP_CODE" = "423" ]; then
      send_telegram "🔴 *iFIND run-pollers-all BLOQUÉ* (\`${CLIENT_SLUG}\`) — HTTP=\`423\` après ${MAX_ATTEMPTS} tentatives sur ${TIMEOUT_S}s. Action : \`curl -X POST -H \"x-cron-secret: \$CRON_SECRET\" 'http://127.0.0.1:3100/api/internal/run-pollers?source=all&clientId=${CLIENT_ID}&force=true'\` pour bypass."
    else
      send_telegram "🔴 *iFIND run-pollers-all KO* (\`${CLIENT_SLUG}\`) — HTTP=\`${HTTP_CODE}\`, voir \`$LOG\`"
    fi
  fi

  rm -f "$LOCK"
done

exit $OVERALL_EXIT
