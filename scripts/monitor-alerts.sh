#!/bin/bash
# iFIND Monitor Alerts — Verification toutes les 30 min
# Envoie une alerte Telegram si probleme detecte

set -euo pipefail

TELEGRAM_BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN /opt/moltbot/.env | head -1 | cut -d= -f2 | tr -d '"')
TELEGRAM_CHAT_ID="1409505520"
CONTAINER="moltbot-telegram-router-1"
ALERTS=""

send_alert() {
  local MESSAGE="$1"
  curl -s -o /dev/null "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=${MESSAGE}" \
    -d "parse_mode=HTML"
}

# 1. Credits API bas (dernières 2h)
CREDIT_HITS=$(docker logs --since 2h "$CONTAINER" 2>&1 | grep -ci "credit balance is too low" || true)
if [ "$CREDIT_HITS" -gt 0 ]; then
  ALERTS="${ALERTS}\n- Credits API bas : ${CREDIT_HITS} erreur(s) 'credit balance too low' (2h)"
fi

# 2. 0 brain cycles (dernières 24h)
BRAIN_HITS=$(docker logs --since 24h "$CONTAINER" 2>&1 | grep -ci "brain.*cycle\|cycle.*brain\|Brain Cycle" || true)
if [ "$BRAIN_HITS" -eq 0 ]; then
  ALERTS="${ALERTS}\n- 0 brain cycles detectes dans les dernieres 24h"
fi

# 3. IMAP timeout (3+ occurrences en 2h)
IMAP_HITS=$(docker logs --since 2h "$CONTAINER" 2>&1 | grep -ci "imap.*timeout\|timeout.*imap" || true)
if [ "$IMAP_HITS" -ge 3 ]; then
  ALERTS="${ALERTS}\n- IMAP timeout : ${IMAP_HITS} occurrences en 2h"
fi

# 4. Disque >85%
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 85 ]; then
  ALERTS="${ALERTS}\n- Disque : ${DISK_USAGE}% utilise (seuil 85%)"
fi

# 5. RAM container >80%
MEM_PERC=$(docker stats --no-stream --format '{{.MemPerc}}' "$CONTAINER" 2>/dev/null | tr -d '%' || echo "0")
# Arrondir en entier pour la comparaison
MEM_INT=$(echo "$MEM_PERC" | cut -d. -f1)
if [ "${MEM_INT:-0}" -gt 80 ]; then
  ALERTS="${ALERTS}\n- RAM container : ${MEM_PERC}% (seuil 80%)"
fi

# Envoyer l'alerte si au moins un probleme detecte
if [ -n "$ALERTS" ]; then
  MESSAGE="<b>iFIND Monitor Alert</b>$(echo -e "$ALERTS")"
  send_alert "$MESSAGE"
  echo "[$(date -Iseconds)] ALERTE envoyee :$ALERTS"
else
  echo "[$(date -Iseconds)] OK — aucune alerte"
fi
