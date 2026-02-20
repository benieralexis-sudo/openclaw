#!/bin/bash
# MoltBot - Healthcheck + Heartbeat Telegram
# Verifie l'etat du gateway et envoie un rapport sur Telegram

set -a
source /opt/moltbot/.env
set +a

CHAT_ID="1409505520"
BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
GATEWAY_URL="http://localhost:9090/health"

# Verification du token
if [ -z "$BOT_TOKEN" ]; then
  echo "[$(date)] ERREUR: TELEGRAM_BOT_TOKEN manquant dans .env"
  exit 1
fi

# Check Docker container (service = telegram-router)
CONTAINER_STATUS=$(docker compose -f /opt/moltbot/docker-compose.yml ps telegram-router --format '{{.Status}}' 2>/dev/null)
CONTAINER_HEALTH=$(echo "$CONTAINER_STATUS" | grep -o '(healthy)\|(unhealthy)\|(starting)' || echo "unknown")

# Check HTTP gateway (fix: eviter double "000" si curl echoue)
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$GATEWAY_URL" 2>/dev/null)
if [ -z "$HTTP_STATUS" ]; then HTTP_STATUS="000"; fi

# Check uptime (service = telegram-router)
UPTIME=$(docker compose -f /opt/moltbot/docker-compose.yml ps telegram-router --format '{{.Status}}' 2>/dev/null | grep -oP 'Up \K[^(]+' | xargs || echo "inconnu")

# Check dernier backup
LAST_BACKUP=$(ls -t /opt/moltbot/backups/moltbot-*.tar.gz 2>/dev/null | head -1)
if [ -n "$LAST_BACKUP" ]; then
  BACKUP_SIZE=$(du -sh "$LAST_BACKUP" | cut -f1)
  BACKUP_DATE=$(basename "$LAST_BACKUP" | grep -oP '\d{4}-\d{2}-\d{2}')
  BACKUP_INFO="$BACKUP_DATE ($BACKUP_SIZE)"
else
  BACKUP_INFO="Aucun backup"
fi

# Check disk usage
DISK_USAGE=$(df -h /opt/moltbot | tail -1 | awk '{print $5}')

# Build status message
if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "301" ] || [ "$HTTP_STATUS" = "302" ]; then
  STATUS_ICON="✅"
  STATUS_TEXT="En ligne"
else
  STATUS_ICON="🔴"
  STATUS_TEXT="Hors ligne (HTTP $HTTP_STATUS)"
fi

MESSAGE="${STATUS_ICON} *MoltBot - Rapport quotidien*

*Gateway:* ${STATUS_TEXT}
*Container:* ${CONTAINER_HEALTH}
*Uptime:* ${UPTIME}
*Dernier backup:* ${BACKUP_INFO}
*Disque:* ${DISK_USAGE} utilise

_$(date '+%d/%m/%Y %H:%M')_"

# Envoyer sur Telegram
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}" \
  -d "text=${MESSAGE}" \
  -d "parse_mode=Markdown" \
  > /dev/null 2>&1

RESULT=$?
if [ $RESULT -eq 0 ]; then
  echo "[$(date)] Heartbeat envoye - Gateway: $STATUS_TEXT"
else
  echo "[$(date)] ERREUR: Envoi Telegram echoue (code $RESULT)"
fi
