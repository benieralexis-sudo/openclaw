#!/bin/bash
# Healthcheck quotidien iFIND — pingue Healthchecks.io pour confirmer que le
# serveur tourne et que le pipeline est sain.
#
# Cron : 0 8 * * * /opt/moltbot/healthcheck.sh >> /opt/moltbot/backups/healthcheck.log 2>&1
#
# Recréé 01/05/2026 — le script original a été supprimé du serveur ~22/04
# (cleanup manuel après commit untrack 262666039), causant 8j 17h DOWN sur
# Healthchecks.io en avril.

set -euo pipefail

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S %Z')]"

# Charger l'URL Healthchecks.io
if [ -f /opt/moltbot/.env ]; then
  HC_URL=$(grep ^HC_PING_HEALTHCHECK /opt/moltbot/.env | cut -d= -f2)
else
  echo "$LOG_PREFIX ERREUR: /opt/moltbot/.env introuvable"
  exit 1
fi

if [ -z "${HC_URL:-}" ]; then
  echo "$LOG_PREFIX ERREUR: HC_PING_HEALTHCHECK non défini dans .env"
  exit 1
fi

# 1) Vérifier que les containers Docker critiques tournent
DOCKER_OK=true
for container in moltbot-telegram-router-1 ifind-postgres; do
  if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    echo "$LOG_PREFIX KO: container $container DOWN"
    DOCKER_OK=false
  fi
done

# 2) Vérifier que le dashboard-v2 répond
DASHBOARD_OK=true
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://127.0.0.1:3100/api/health/deep 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  echo "$LOG_PREFIX KO: dashboard-v2 HTTP $HTTP_CODE"
  DASHBOARD_OK=false
fi

# 3) Pinger Healthchecks.io selon le résultat
if [ "$DOCKER_OK" = true ] && [ "$DASHBOARD_OK" = true ]; then
  curl -sS --max-time 10 -o /dev/null "$HC_URL"
  echo "$LOG_PREFIX Heartbeat envoye - System OK (containers + dashboard)"
else
  # Ping /fail pour signaler explicitement à Healthchecks
  curl -sS --max-time 10 -o /dev/null "${HC_URL}/fail"
  echo "$LOG_PREFIX Heartbeat FAIL envoye - Docker:$DOCKER_OK Dashboard:$DASHBOARD_OK"
  exit 1
fi
