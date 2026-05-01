#!/bin/bash
# Healthcheck DEEP — vérifie l'état approfondi du pipeline iFIND
# Installe via cron : */5 * * * * /opt/moltbot/scripts/healthcheck-deep.sh
# Envoie alerte Telegram SYSTÈME si pipeline degraded/down (pas pour les leads).
#
# Vérifications (via /api/health/deep) :
#   - Database (Postgres) latency + reachability
#   - FullEnrich balance (alerte si <50 cr)
#   - Pappers error rate (alerte si >20%)
#   - Last run-pollers age (alerte si >90 min — cron 1h tourne mal)

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(grep ^TELEGRAM_BOT_TOKEN /opt/moltbot/.env 2>/dev/null | cut -d= -f2)}"
ADMIN_CHAT_ID="${ADMIN_CHAT_ID:-$(grep ^ADMIN_CHAT_ID /opt/moltbot/.env 2>/dev/null | cut -d= -f2)}"
STATE_FILE="/tmp/ifind-deep-health-state"
LOG_FILE="/var/log/ifind-deep-health.log"
HEALTH_URL="http://127.0.0.1:3100/api/health/deep"

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$ADMIN_CHAT_ID" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERREUR: TELEGRAM_BOT_TOKEN ou ADMIN_CHAT_ID non configure" >> "$LOG_FILE"
  exit 1
fi

send_telegram() {
  local msg="$1"
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$ADMIN_CHAT_ID" \
    -d text="$msg" \
    -d parse_mode="Markdown" > /dev/null 2>&1
}

# Appel de l'endpoint deep health
RESPONSE=$(curl -s --connect-timeout 5 --max-time 15 "$HEALTH_URL" 2>/dev/null)
if [ -z "$RESPONSE" ]; then
  STATUS="down"
  ALERT_MSG="❌ Endpoint /api/health/deep injoignable (timeout/connexion)"
else
  STATUS=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null)
  if [ -z "$STATUS" ] || [ "$STATUS" = "unknown" ]; then
    STATUS="down"
    ALERT_MSG="❌ /api/health/deep retourne une réponse invalide"
  else
    # Extraire les composants en degraded/down
    ALERT_MSG=$(echo "$RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
issues = []
for name, c in d.get('components', {}).items():
    if c.get('status') in ('degraded', 'down'):
        emoji = '🔴' if c['status'] == 'down' else '🟡'
        msg = c.get('message', '')
        issues.append(f\"{emoji} *{name}* — {msg}\")
print('\\n'.join(issues))
" 2>/dev/null)
  fi
fi

# Log toujours
echo "[$(date '+%Y-%m-%d %H:%M:%S')] status=$STATUS" >> "$LOG_FILE"

# State management pour anti-spam.
# Format state file : "STATUS|EPOCH_DERNIERE_NOTIF"
# - Notif au changement d'état (toujours)
# - Re-notif si même état degraded/down depuis > 12h (rappel quotidien)
PREV_STATE="up"
PREV_NOTIF_EPOCH=0
if [ -f "$STATE_FILE" ]; then
  RAW=$(cat "$STATE_FILE")
  PREV_STATE=$(echo "$RAW" | cut -d'|' -f1)
  PREV_NOTIF_EPOCH=$(echo "$RAW" | cut -d'|' -f2)
  [ -z "$PREV_NOTIF_EPOCH" ] && PREV_NOTIF_EPOCH=0
fi
NOW_EPOCH=$(date +%s)
RENOTIF_AFTER=$((12 * 3600))  # 12h

if [ "$STATUS" = "up" ]; then
  if [ "$PREV_STATE" != "up" ]; then
    send_telegram "✅ *iFIND Pipeline — Recovery*

Tous les composants sont de retour en ligne.
$(date '+%Y-%m-%d %H:%M:%S')"
  fi
  echo "up|$NOW_EPOCH" > "$STATE_FILE"
else
  # Alerter au changement d'état OU si même état degraded/down depuis >12h
  AGE=$((NOW_EPOCH - PREV_NOTIF_EPOCH))
  if [ "$PREV_STATE" != "$STATUS" ] || [ "$AGE" -gt "$RENOTIF_AFTER" ]; then
    EMOJI="⚠️"
    [ "$STATUS" = "down" ] && EMOJI="🚨"
    REMINDER=""
    if [ "$PREV_STATE" = "$STATUS" ] && [ "$AGE" -gt "$RENOTIF_AFTER" ]; then
      HOURS=$((AGE / 3600))
      REMINDER=" (toujours dégradé depuis ${HOURS}h)"
    fi
    send_telegram "${EMOJI} *iFIND Pipeline — ${STATUS^^}*${REMINDER}

${ALERT_MSG}

Heure: $(date '+%Y-%m-%d %H:%M:%S')

Détails: \`curl http://127.0.0.1:3100/api/health/deep | jq\`"
    echo "$STATUS|$NOW_EPOCH" > "$STATE_FILE"
  else
    # même état dégradé mais <12h : on garde l'epoch précédent (pas re-notif)
    echo "$STATUS|$PREV_NOTIF_EPOCH" > "$STATE_FILE"
  fi
fi
