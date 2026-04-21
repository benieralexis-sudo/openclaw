#!/bin/bash
# iFIND — Poll UptimeRobot API → alerte Telegram si monitor DOWN
# À lancer en cron toutes les 5 min
set -u

set -a
source /opt/moltbot/.env 2>/dev/null
set +a

: "${UPTIMEROBOT_API_KEY:?UPTIMEROBOT_API_KEY missing in .env}"
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN missing}"
: "${ADMIN_CHAT_ID:?ADMIN_CHAT_ID missing}"

STATE_FILE="/tmp/uptimerobot-last-state.json"
CURRENT_STATE=$(mktemp)

# UptimeRobot status codes:
#   0 = paused, 1 = not checked yet, 2 = up, 8 = seems down, 9 = down
curl -sS --max-time 15 -X POST "https://api.uptimerobot.com/v2/getMonitors" \
  -d "api_key=$UPTIMEROBOT_API_KEY&format=json" > "$CURRENT_STATE" 2>/dev/null

if ! python3 -c "import json,sys;json.load(open('$CURRENT_STATE'))" 2>/dev/null; then
  rm -f "$CURRENT_STATE"
  exit 0
fi

# Extraire les monitors DOWN (status 8 ou 9)
DOWN_MONITORS=$(python3 -c "
import json
data = json.load(open('$CURRENT_STATE'))
for m in data.get('monitors', []):
    if m['status'] in (8, 9):
        status_txt = 'SEEMS DOWN' if m['status'] == 8 else 'DOWN'
        print(f\"{m['id']}|{m['friendly_name']}|{m['url']}|{status_txt}\")
")

# Extraire les monitors UP (status 2)
UP_MONITORS=$(python3 -c "
import json
data = json.load(open('$CURRENT_STATE'))
for m in data.get('monitors', []):
    if m['status'] == 2:
        print(m['id'])
")

# Comparer avec état précédent pour ne notifier que les CHANGEMENTS
if [ -f "$STATE_FILE" ]; then
  PREV_DOWN=$(cat "$STATE_FILE" 2>/dev/null | grep -E '^\d+\|' | cut -d'|' -f1 | sort -u)
else
  PREV_DOWN=""
fi

CURRENT_DOWN_IDS=$(echo "$DOWN_MONITORS" | grep -E '^[0-9]+\|' | cut -d'|' -f1 | sort -u)

# Nouveaux DOWN (présents maintenant, pas avant)
NEW_DOWN=$(comm -23 <(echo "$CURRENT_DOWN_IDS") <(echo "$PREV_DOWN") 2>/dev/null)

# Nouveaux UP (étaient DOWN avant, UP maintenant)
RECOVERED=$(comm -13 <(echo "$CURRENT_DOWN_IDS") <(echo "$PREV_DOWN") 2>/dev/null)

notify() {
  curl -sS --max-time 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${ADMIN_CHAT_ID}" \
    -d parse_mode="Markdown" \
    --data-urlencode text="$1" > /dev/null 2>&1
}

# Alerter les nouveaux DOWN
if [ -n "$NEW_DOWN" ]; then
  for mid in $NEW_DOWN; do
    info=$(echo "$DOWN_MONITORS" | grep "^$mid|")
    if [ -n "$info" ]; then
      name=$(echo "$info" | cut -d'|' -f2)
      url=$(echo "$info" | cut -d'|' -f3)
      status=$(echo "$info" | cut -d'|' -f4)
      notify "🚨 *iFIND MONITOR $status*
📡 \`$name\`
🔗 $url
⏰ $(date '+%Y-%m-%d %H:%M:%S')
Vérifier UptimeRobot dashboard."
    fi
  done
fi

# Notifier les recovered
if [ -n "$RECOVERED" ]; then
  for mid in $RECOVERED; do
    notify "✅ *iFIND MONITOR RECOVERED*
Monitor ID: \`$mid\` est de nouveau UP
⏰ $(date '+%Y-%m-%d %H:%M:%S')"
  done
fi

# Sauver l'état pour le prochain run
echo "$DOWN_MONITORS" > "$STATE_FILE"
rm -f "$CURRENT_STATE"

# Ping Healthchecks.io (success)
[ -n "${HC_PING_UPTIMEROBOT:-}" ] && curl -fsS --retry 2 --max-time 10 "$HC_PING_UPTIMEROBOT" > /dev/null 2>&1

exit 0
