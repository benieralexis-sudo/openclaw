#!/bin/bash
# =====================================================================
# backup-offsite.sh — Backup off-site iFIND via rclone → Backblaze B2
# =====================================================================
# Usage : ./scripts/backup-offsite.sh
# Prerequis : rclone configure avec un remote "b2" (voir ci-dessous)
#
# COMMENT CONFIGURER RCLONE AVEC BACKBLAZE B2 :
# -----------------------------------------------
# 1. Installer rclone :
#    curl https://rclone.org/install.sh | sudo bash
#
# 2. Creer un bucket sur Backblaze B2 :
#    - Aller sur https://www.backblaze.com/b2/cloud-storage.html
#    - Creer un compte + un bucket (ex: ifind-backups)
#    - Creer une Application Key (keyID + applicationKey)
#
# 3. Configurer rclone :
#    rclone config
#    → New remote → nom: b2 → type: b2 → account: <keyID>
#    → key: <applicationKey> → laisser le reste par defaut
#
# 4. Tester :
#    rclone ls b2:ifind-backups
#
# 5. Activer ce script :
#    - Decommenter les lignes rclone ci-dessous
#    - Ajouter en cron : 0 3 * * * /opt/moltbot/scripts/backup-offsite.sh >> /var/log/ifind-backup-offsite.log 2>&1
# =====================================================================

set -euo pipefail

BACKUP_DIR="/opt/moltbot/backups"
MOLTBOT_DIR="/opt/moltbot"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="ifind-backup-${TIMESTAMP}.tar.gz"
B2_BUCKET="ifind-backups"
B2_REMOTE="b2"
RETENTION_DAYS=30

echo "[$(date)] === Debut backup off-site ==="

# --- Etape 1 : Backup local ---
mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Creation archive locale..."
tar czf "${BACKUP_DIR}/${BACKUP_FILE}" \
  --exclude='node_modules' \
  --exclude='*.log' \
  --exclude='.git' \
  -C "${MOLTBOT_DIR}" \
  clients/ \
  skills/automailer/storage.js \
  skills/autonomous-pilot/data/ \
  skills/inbox-manager/knowledge-base.json \
  gateway/telegram-router.js \
  gateway/app-config.js \
  .env \
  2>/dev/null || true

# Sauvegarder aussi les volumes Docker data
for client_dir in "${MOLTBOT_DIR}"/clients/*/; do
  client_name=$(basename "${client_dir}")
  if [ -d "${client_dir}data" ]; then
    echo "[$(date)] Archive data client: ${client_name}"
    tar czf "${BACKUP_DIR}/data-${client_name}-${TIMESTAMP}.tar.gz" \
      -C "${client_dir}" data/ \
      2>/dev/null || true
  fi
done

# Sauvegarder les volumes Docker principaux
DOCKER_VOLUMES_DIR="/var/lib/docker/volumes"
if [ -d "${DOCKER_VOLUMES_DIR}" ]; then
  echo "[$(date)] Archive volumes Docker principaux..."
  for vol in moltbot_automailer-data moltbot_inbox-manager-data moltbot_autonomous-pilot-data moltbot_app-config-data; do
    if [ -d "${DOCKER_VOLUMES_DIR}/${vol}/_data" ]; then
      tar czf "${BACKUP_DIR}/vol-${vol}-${TIMESTAMP}.tar.gz" \
        -C "${DOCKER_VOLUMES_DIR}/${vol}" _data/ \
        2>/dev/null || true
    fi
  done
fi

echo "[$(date)] Archive locale creee: ${BACKUP_DIR}/${BACKUP_FILE}"

# --- Etape 2 : Sync vers Backblaze B2 via rclone ---
# DECOMMENTER les lignes ci-dessous une fois rclone configure

# if ! command -v rclone &> /dev/null; then
#   echo "[$(date)] ERREUR: rclone non installe. Installer avec: curl https://rclone.org/install.sh | sudo bash"
#   exit 1
# fi
#
# echo "[$(date)] Upload vers ${B2_REMOTE}:${B2_BUCKET}..."
# rclone copy "${BACKUP_DIR}/${BACKUP_FILE}" "${B2_REMOTE}:${B2_BUCKET}/daily/" --progress
#
# # Upload les archives data clients
# for f in "${BACKUP_DIR}"/data-*-${TIMESTAMP}.tar.gz; do
#   [ -f "$f" ] && rclone copy "$f" "${B2_REMOTE}:${B2_BUCKET}/daily/" --progress
# done
#
# # Upload les archives volumes Docker
# for f in "${BACKUP_DIR}"/vol-*-${TIMESTAMP}.tar.gz; do
#   [ -f "$f" ] && rclone copy "$f" "${B2_REMOTE}:${B2_BUCKET}/daily/" --progress
# done
#
# echo "[$(date)] Upload termine."
#
# # --- Etape 3 : Nettoyage des vieux backups (local + distant) ---
# echo "[$(date)] Nettoyage backups > ${RETENTION_DAYS} jours..."
# find "${BACKUP_DIR}" -name "ifind-backup-*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
# find "${BACKUP_DIR}" -name "data-*-*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
# find "${BACKUP_DIR}" -name "vol-*-*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
#
# # Nettoyage distant (supprimer les fichiers > RETENTION_DAYS jours sur B2)
# rclone delete "${B2_REMOTE}:${B2_BUCKET}/daily/" --min-age "${RETENTION_DAYS}d" 2>/dev/null || true
#
# echo "[$(date)] Nettoyage termine."

# --- Etape 3 (local seulement) : Nettoyage vieux backups locaux ---
echo "[$(date)] Nettoyage backups locaux > ${RETENTION_DAYS} jours..."
find "${BACKUP_DIR}" -name "ifind-backup-*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
find "${BACKUP_DIR}" -name "data-*-*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
find "${BACKUP_DIR}" -name "vol-*-*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true

echo "[$(date)] === Backup off-site termine (mode local — rclone desactive) ==="
