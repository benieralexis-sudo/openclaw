#!/bin/bash
# MoltBot - Backup quotidien
# Sauvegarde code + config + donnees des volumes Docker

BACKUP_DIR="/opt/moltbot/backups"
DATE=$(date +%Y-%m-%d_%H%M)
RETENTION_DAYS=7
COMPOSE_FILE="/opt/moltbot/docker-compose.yml"
CONTAINER="moltbot-telegram-router-1"

# --- 1. Backup du code (skills + gateway + config) ---
tar czf "$BACKUP_DIR/moltbot-code-$DATE.tar.gz" \
  -C /opt/moltbot \
  config/ \
  workspace/ \
  gateway/ \
  skills/flowfast/ \
  skills/automailer/ \
  skills/crm-pilot/ \
  skills/lead-enrich/ \
  skills/content-gen/ \
  skills/invoice-bot/ \
  skills/proactive-agent/ \
  skills/self-improve/ \
  skills/web-intelligence/ \
  skills/system-advisor/ \
  dashboard/ \
  .env \
  docker-compose.yml \
  backup.sh \
  healthcheck.sh \
  2>/dev/null

# --- 2. Backup des donnees (volumes Docker) ---
# Copie les JSON depuis le container telegram-router qui monte tous les volumes
docker exec "$CONTAINER" tar czf /tmp/moltbot-data.tar.gz -C /data \
  flowfast/ \
  automailer/ \
  crm-pilot/ \
  lead-enrich/ \
  content-gen/ \
  invoice-bot/ \
  proactive-agent/ \
  self-improve/ \
  web-intelligence/ \
  system-advisor/ \
  moltbot-config/ \
  2>/dev/null

docker cp "$CONTAINER":/tmp/moltbot-data.tar.gz "$BACKUP_DIR/moltbot-data-$DATE.tar.gz" 2>/dev/null
docker exec "$CONTAINER" rm -f /tmp/moltbot-data.tar.gz 2>/dev/null

# Supprimer les backups de plus de 7 jours
find "$BACKUP_DIR" -name "moltbot-*.tar.gz" -mtime +$RETENTION_DAYS -delete

# Log
CODE_SIZE=$(du -sh "$BACKUP_DIR/moltbot-code-$DATE.tar.gz" 2>/dev/null | cut -f1)
DATA_SIZE=$(du -sh "$BACKUP_DIR/moltbot-data-$DATE.tar.gz" 2>/dev/null | cut -f1)
echo "[$(date)] Backup OK: code=$CODE_SIZE data=$DATA_SIZE" >> "$BACKUP_DIR/backup.log"
