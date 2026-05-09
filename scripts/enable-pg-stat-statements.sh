#!/bin/bash
# P32 (Vague 3 perfection 100%) — Activer pg_stat_statements pour monitoring slow queries.
#
# Operation a faire UNE FOIS sur un container Postgres neuf. Idempotent :
# - check si shared_preload_libraries deja configure
# - check si extension deja installee
#
# Effet :
#   - Modifie postgresql.conf pour shared_preload_libraries='pg_stat_statements'
#   - Restart container (~10s downtime, dashboard-v2 retry auto)
#   - CREATE EXTENSION dans la DB ifind
#
# Usage : ./enable-pg-stat-statements.sh
set -euo pipefail

CONF="/opt/moltbot/data/postgres/postgresql.conf"
CONTAINER="ifind-postgres"
DB_USER="ifind"
DB_NAME="ifind"

# 1. Check etat actuel
CURRENT=$(grep -E "^shared_preload_libraries" "$CONF" 2>/dev/null || echo "(commented)")
echo "Current shared_preload_libraries: $CURRENT"

if grep -q "^shared_preload_libraries.*pg_stat_statements" "$CONF"; then
  echo "[OK] postgresql.conf deja configure — skip edit."
else
  echo "[ACTION] Backup conf + edit..."
  cp "$CONF" "${CONF}.bak.$(date +%Y%m%d-%H%M)"
  sed -i "s|^#shared_preload_libraries = ''|shared_preload_libraries = 'pg_stat_statements'|" "$CONF"
  grep "^shared_preload_libraries" "$CONF"
  echo "[ACTION] Restart container $CONTAINER..."
  docker restart "$CONTAINER"
  sleep 8
  docker exec "$CONTAINER" pg_isready -U "$DB_USER"
fi

# 2. Install extension
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
  -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"

# 3. Test
echo "---"
echo "Top 5 slow queries actuels (rien si pas encore d'activite) :"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT substring(query, 1, 80) AS q, calls, round(mean_exec_time::numeric, 2) AS mean_ms FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 5;"
