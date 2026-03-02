#!/bin/bash
# Healthcheck externe — verifie que les containers iFIND sont UP
# Installe via cron systeme (pas Docker) : */5 * * * * /opt/moltbot/scripts/healthcheck-external.sh
# Envoie une alerte Telegram directe si un container est DOWN

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(grep ^TELEGRAM_BOT_TOKEN /opt/moltbot/.env 2>/dev/null | cut -d= -f2)}"
ADMIN_CHAT_ID="${ADMIN_CHAT_ID:-$(grep ^ADMIN_CHAT_ID /opt/moltbot/.env 2>/dev/null | cut -d= -f2)}"
STATE_FILE="/tmp/ifind-healthcheck-state"

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$ADMIN_CHAT_ID" ]; then
  echo "ERREUR: TELEGRAM_BOT_TOKEN ou ADMIN_CHAT_ID non configure"
  exit 1
fi

send_telegram() {
  local msg="$1"
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$ADMIN_CHAT_ID" \
    -d text="$msg" \
    -d parse_mode="Markdown" > /dev/null 2>&1
}

# Verifier les 3 containers
CONTAINERS=("moltbot-telegram-router-1" "moltbot-mission-control-1" "moltbot-landing-page-1")
NAMES=("Telegram Router" "Dashboard" "Landing Page")
ALL_OK=true
ALERT_MSG=""

for i in "${!CONTAINERS[@]}"; do
  container="${CONTAINERS[$i]}"
  name="${NAMES[$i]}"

  # Verifier si le container tourne
  status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null)
  health=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null)

  if [ "$status" != "running" ]; then
    ALL_OK=false
    ALERT_MSG="${ALERT_MSG}\n❌ *${name}* — status: ${status:-not_found}"
  elif [ -n "$health" ] && [ "$health" != "healthy" ]; then
    ALL_OK=false
    ALERT_MSG="${ALERT_MSG}\n⚠️ *${name}* — health: ${health}"
  fi
done

# Verifier le endpoint health HTTP
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://127.0.0.1:9090/health 2>/dev/null)
if [ "$HTTP_STATUS" != "200" ]; then
  ALL_OK=false
  ALERT_MSG="${ALERT_MSG}\n❌ *Health HTTP* — status code: ${HTTP_STATUS:-timeout}"
fi

# Gestion d'etat pour eviter le spam d'alertes
PREV_STATE="ok"
if [ -f "$STATE_FILE" ]; then
  PREV_STATE=$(cat "$STATE_FILE")
fi

if [ "$ALL_OK" = true ]; then
  # Si on etait DOWN et qu'on revient UP, notifier la recovery
  if [ "$PREV_STATE" = "down" ]; then
    send_telegram "✅ *iFIND Bot — Recovery*

Tous les services sont de retour en ligne.
$(date '+%Y-%m-%d %H:%M:%S')"
  fi
  echo "ok" > "$STATE_FILE"
else
  # Envoyer l'alerte uniquement si c'est nouveau (evite spam toutes les 5 min)
  if [ "$PREV_STATE" != "down" ]; then
    send_telegram "🚨 *iFIND Bot — ALERTE DOWN*
${ALERT_MSG}

Serveur: $(hostname)
Heure: $(date '+%Y-%m-%d %H:%M:%S')

Commande de recovery:
\`cd /opt/moltbot && docker compose down && docker compose up -d\`"
  fi
  echo "down" > "$STATE_FILE"
fi
