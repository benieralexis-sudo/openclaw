#!/bin/bash
# iFIND — Bilan soir + auto-repair (post-pivot 05/05/2026)
# Usage: bash /opt/moltbot/scripts/monitoring-soir.sh
# Règles: restart containers/service OK, docker prune OK — jamais de modif code/données/.env

set -uo pipefail

TELEGRAM_BOT_TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" /opt/moltbot/.env 2>/dev/null | head -1 | cut -d= -f2 | tr -d '"')
TELEGRAM_CHAT_ID="1409505520"
CONTAINER_ROUTER="moltbot-telegram-router-1"
CONTAINER_POSTGRES="ifind-postgres"
TODAY=$(date '+%d/%m/%Y')
ACTIONS=""

send_telegram() {
  local TEXT="$1"
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "{\"chat_id\": \"${TELEGRAM_CHAT_ID}\", \"text\": $(echo "$TEXT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'), \"parse_mode\": \"Markdown\"}" \
    > /dev/null
}

# ─── PHASE 1 : DIAGNOSTIC ────────────────────────────────────────────────────

echo "[1/9] dashboard-v2 systemd..."
cd /opt/moltbot

DASH_STATUS="❌ down"
if systemctl is-active --quiet dashboard-v2 2>/dev/null; then
  DASH_STATUS="✅ up"
fi

# Check HTTP dashboard
DASH_HTTP="❌"
if curl -sf --max-time 5 http://127.0.0.1:3100/login > /dev/null 2>&1; then
  DASH_HTTP="✅"
fi

echo "[2/9] Containers Docker..."
ROUTER_STATUS="❌ down"
if docker compose ps 2>&1 | grep -q "telegram-router.*Up\|telegram-router.*running"; then
  ROUTER_STATUS="✅ up"
fi

POSTGRES_STATUS="❌ down"
if docker compose ps 2>&1 | grep -q "ifind-postgres.*Up\|ifind-postgres.*running"; then
  POSTGRES_STATUS="✅ up"
fi

CLIENTS_INFO=""
if [ -f /opt/moltbot/clients/docker-compose.clients.yml ]; then
  CLIENTS_INFO=$(docker compose -f clients/docker-compose.clients.yml ps 2>&1 | grep -v "^NAME" | awk '{print $1": "$2}' | head -5 | tr '\n' ', ')
fi

echo "[3/9] Erreurs dashboard-v2 12h..."
ERRORS_DASH=$(journalctl -u dashboard-v2 --since "12 hours ago" 2>/dev/null | grep -ic 'error\|Error\|CRITICAL\|FATAL' || echo "0")
ERRORS_ROUTER=$(docker compose logs --since 12h telegram-router 2>&1 | grep -ic 'error\|CRITICAL\|FATAL' || echo "0")
ERRORS_12H=$(( ERRORS_DASH + ERRORS_ROUTER ))

echo "[4/9] Disque + RAM..."
DISK_PCT=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
DISK_DISPLAY=$(df -h / | awk 'NR==2 {print $5}')
RAM_USAGE=$(docker stats --no-stream "$CONTAINER_ROUTER" --format '{{.MemUsage}}' 2>/dev/null || echo "N/A")

echo "[5/9] Triggers & Leads Postgres..."
DB_URL=$(grep "^DATABASE_URL=" /opt/moltbot/dashboard-v2/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
TRIGGERS_NEW="N/A"
TRIGGERS_TOTAL="N/A"
LEADS_TOTAL="N/A"
LEADS_TODAY="N/A"
if [ -n "${DB_URL:-}" ]; then
  TRIGGERS_NEW=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM \"Trigger\" WHERE status='NEW' AND \"deletedAt\" IS NULL;" 2>/dev/null | tr -d ' \n' || echo "N/A")
  TRIGGERS_TOTAL=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM \"Trigger\" WHERE \"deletedAt\" IS NULL;" 2>/dev/null | tr -d ' \n' || echo "N/A")
  LEADS_TOTAL=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM \"Lead\" WHERE \"deletedAt\" IS NULL;" 2>/dev/null | tr -d ' \n' || echo "N/A")
  LEADS_TODAY=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM \"Lead\" WHERE \"createdAt\" >= NOW() - INTERVAL '24 hours' AND \"deletedAt\" IS NULL;" 2>/dev/null | tr -d ' \n' || echo "N/A")
fi

echo "[6/9] Qualified leads (OUI) 7j..."
LEADS_OUI="N/A"
if [ -n "${DB_URL:-}" ]; then
  LEADS_OUI=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM \"Lead\" WHERE verdict='OUI' AND \"createdAt\" >= NOW() - INTERVAL '7 days' AND \"deletedAt\" IS NULL;" 2>/dev/null | tr -d ' \n' || echo "N/A")
fi

echo "[7/9] Replies & bounces (router logs)..."
REPLIES=$(docker compose logs --since 12h telegram-router 2>&1 | grep -c 'reply\|Reply\|interested' || echo "0")
BOUNCES=$(docker compose logs --since 12h telegram-router 2>&1 | grep -ic 'bounce' || echo "0")

echo "[8/9] Cron pollers santé..."
POLLERS_LOG=$(tail -5 /var/log/run-pollers-cron.log 2>/dev/null || journalctl -u cron --since "6 hours ago" 2>/dev/null | grep -i poller | tail -3 || echo "log absent")

echo "[9/9] Fichiers .tmp orphelins..."
TMP_ORPHANS=$(find /var/lib/docker/volumes/ -name '*.tmp' -mmin +60 2>/dev/null | wc -l)

# ─── PHASE 2 : AUTO-REPAIR ───────────────────────────────────────────────────

echo ""
echo "=== AUTO-REPAIR ==="

# dashboard-v2 down → restart systemd
if [ "$DASH_STATUS" = "❌ down" ]; then
  echo "dashboard-v2 down — systemctl restart..."
  systemctl restart dashboard-v2 2>&1
  sleep 10
  if systemctl is-active --quiet dashboard-v2 2>/dev/null; then
    DASH_STATUS="✅ up (relancé)"
    DASH_HTTP="✅"
    ACTIONS="${ACTIONS}dashboard-v2 relancé; "
  else
    ACTIONS="${ACTIONS}dashboard-v2 restart ÉCHEC; "
  fi
fi

# telegram-router down → docker compose up
if [ "$ROUTER_STATUS" = "❌ down" ]; then
  echo "telegram-router down — docker compose up..."
  cd /opt/moltbot && docker compose up -d 2>&1
  sleep 10
  if docker compose ps 2>&1 | grep -q "telegram-router.*Up\|telegram-router.*running"; then
    ROUTER_STATUS="✅ up (relancé)"
    ACTIONS="${ACTIONS}telegram-router relancé; "
  else
    ACTIONS="${ACTIONS}telegram-router restart ÉCHEC; "
  fi
fi

# postgres down → docker compose up
if [ "$POSTGRES_STATUS" = "❌ down" ]; then
  echo "ifind-postgres down — docker compose up..."
  cd /opt/moltbot && docker compose up -d 2>&1
  sleep 5
  if docker compose ps 2>&1 | grep -q "ifind-postgres.*Up\|ifind-postgres.*running"; then
    POSTGRES_STATUS="✅ up (relancé)"
    ACTIONS="${ACTIONS}postgres relancé; "
  else
    ACTIONS="${ACTIONS}postgres restart ÉCHEC; "
  fi
fi

# Container unhealthy → restart
UNHEALTHY=$(docker compose ps 2>&1 | grep -c 'unhealthy' || echo "0")
if [ "${UNHEALTHY:-0}" -gt 0 ]; then
  echo "Container unhealthy — restart all..."
  cd /opt/moltbot && docker compose restart 2>&1
  ACTIONS="${ACTIONS}containers restart (unhealthy); "
fi

# Disque >85% → prune
if [ "${DISK_PCT:-0}" -gt 85 ]; then
  echo "Disque ${DISK_PCT}% — prune..."
  docker system prune -f 2>&1 | tail -2
  find /var/lib/docker/volumes/ -name '*.tmp' -mmin +60 -delete 2>/dev/null || true
  find /var/lib/docker/volumes/ -name '*.bak-*' -mtime +7 -delete 2>/dev/null || true
  DISK_PCT=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
  DISK_DISPLAY=$(df -h / | awk 'NR==2 {print $5}')
  ACTIONS="${ACTIONS}disque nettoyé (maintenant ${DISK_DISPLAY}); "
fi

# Fichiers .tmp orphelins
if [ "${TMP_ORPHANS:-0}" -gt 0 ]; then
  find /var/lib/docker/volumes/ -name '*.tmp' -mmin +60 -delete 2>/dev/null || true
  ACTIONS="${ACTIONS}${TMP_ORPHANS} .tmp supprimés; "
fi

# >10 erreurs CRITICAL → alerte uniquement
CRITICAL_HITS=$(journalctl -u dashboard-v2 --since "12 hours ago" 2>/dev/null | grep -ic 'CRITICAL\|FATAL' || echo "0")
CRITICAL_WARN=""
if [ "${CRITICAL_HITS:-0}" -gt 10 ]; then
  CRITICAL_WARN="❌ ${CRITICAL_HITS} erreurs CRITICAL dashboard-v2 — intervention manuelle requise"
fi

[ -z "$ACTIONS" ] && ACTIONS="aucune"

# ─── PHASE 3 : RAPPORT TELEGRAM ──────────────────────────────────────────────

echo ""
echo "=== RAPPORT ==="

if [ "$DASH_STATUS" = "✅ up" ] && [ "$DASH_HTTP" = "✅" ] && [ "${ERRORS_12H:-0}" -lt 10 ]; then
  SUMMARY="Tout nominal. Dashboard opérationnel."
elif [ "$DASH_STATUS" = "❌ down" ]; then
  SUMMARY="Dashboard-v2 DOWN — intervention requise."
elif [ "$POSTGRES_STATUS" = "❌ down" ]; then
  SUMMARY="Postgres DOWN — leads inaccessibles."
else
  SUMMARY="${ERRORS_12H} erreurs détectées, surveiller."
fi

MESSAGE="📊 *Bilan Soir — ${TODAY}*

🖥️ Dashboard-v2: ${DASH_STATUS} (HTTP ${DASH_HTTP})
🐘 Postgres: ${POSTGRES_STATUS}
🤖 Router: ${ROUTER_STATUS}
💾 Disque: ${DISK_DISPLAY} | RAM: ${RAM_USAGE}
🎯 Triggers NEW: ${TRIGGERS_NEW} / ${TRIGGERS_TOTAL} total
👥 Leads: ${LEADS_TODAY} aujourd'hui | ${LEADS_OUI} OUI/7j | ${LEADS_TOTAL} total
📥 Replies: ${REPLIES} | Bounces: ${BOUNCES}
⚠️ Erreurs 12h: ${ERRORS_12H} (dash: ${ERRORS_DASH} / router: ${ERRORS_ROUTER})
${CRITICAL_WARN}
🔧 Actions: ${ACTIONS}

${SUMMARY}"

echo "$MESSAGE"
echo ""
echo "Envoi Telegram..."
send_telegram "$MESSAGE"
echo "Rapport envoyé ✓"
