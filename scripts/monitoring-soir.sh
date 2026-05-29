#!/bin/bash
# iFIND — Bilan soir + auto-repair
# Usage: bash /opt/moltbot/scripts/monitoring-soir.sh
# Règles: restart containers OK, docker prune OK — jamais de modif code/données/.env

set -uo pipefail

TELEGRAM_BOT_TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" /opt/moltbot/.env 2>/dev/null | head -1 | cut -d= -f2 | tr -d '"')
TELEGRAM_CHAT_ID="1409505520"
CONTAINER="moltbot-telegram-router-1"
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

echo "[1/9] Containers..."
cd /opt/moltbot

BOT_STATUS="❌ down"
if docker compose ps 2>&1 | grep -q "telegram-router.*Up\|telegram-router.*running"; then
  BOT_STATUS="✅ up"
fi

CLIENTS_STATUS=""
if [ -f /opt/moltbot/clients/docker-compose.clients.yml ]; then
  CLIENTS_STATUS=$(docker compose -f clients/docker-compose.clients.yml ps 2>&1 | grep -v "^NAME" | awk '{print $1": "$2}' | head -5 | tr '\n' ' ')
fi

echo "[2/9] Erreurs 12h..."
ERRORS_12H=$(docker compose logs --since 12h telegram-router 2>&1 | grep -ic 'error\|CRITICAL\|FATAL' || echo "0")

echo "[3/9] Disque..."
DISK_PCT=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
DISK_DISPLAY=$(df -h / | awk 'NR==2 {print $5}')

echo "[4/9] Emails envoyés..."
EMAILS_TODAY=$(docker exec "$CONTAINER" node -e "
  const fs=require('fs');
  try {
    const d=JSON.parse(fs.readFileSync('/data/automailer/daily-send-count.json','utf8'));
    const today=new Date().toISOString().split('T')[0];
    console.log(d.date===today ? d.count : 0);
  } catch(e) { console.log(0); }
" 2>/dev/null || echo "0")

echo "[5/9] Brain cycles..."
BRAIN_LAST=$(docker exec "$CONTAINER" node -e "
  const fs=require('fs');
  try {
    const ap=JSON.parse(fs.readFileSync('/data/autonomous-pilot/autonomous-pilot.json','utf8'));
    const ts=ap.stats?.lastBrainCycleAt;
    if (!ts) { console.log('jamais'); process.exit(0); }
    const diff=Math.round((Date.now()-new Date(ts).getTime())/60000);
    console.log(diff+'min ago');
  } catch(e) { console.log('N/A'); }
" 2>/dev/null || echo "N/A")

BRAIN_TOTAL=$(docker exec "$CONTAINER" node -e "
  const fs=require('fs');
  try {
    const ap=JSON.parse(fs.readFileSync('/data/autonomous-pilot/autonomous-pilot.json','utf8'));
    console.log(ap.stats?.totalBrainCycles || 0);
  } catch(e) { console.log(0); }
" 2>/dev/null || echo "0")

echo "[6/9] Leads pool..."
LEADS_POOL=$(docker exec "$CONTAINER" node -e "
  const fs=require('fs');
  try {
    const ap=JSON.parse(fs.readFileSync('/data/autonomous-pilot/autonomous-pilot.json','utf8'));
    console.log((ap.leads||[]).length);
  } catch(e) { console.log(0); }
" 2>/dev/null || echo "0")

echo "[7/9] Replies & bounces..."
REPLIES=$(docker compose logs --since 12h telegram-router 2>&1 | grep -c 'reply\|Reply\|interested' || echo "0")
BOUNCES=$(docker compose logs --since 12h telegram-router 2>&1 | grep -ic 'bounce' || echo "0")

echo "[8/9] RAM..."
RAM_USAGE=$(docker stats --no-stream "$CONTAINER" --format '{{.MemUsage}}' 2>/dev/null || echo "N/A")

echo "[9/9] Campagnes..."
CAMPAIGNS=$(docker exec "$CONTAINER" node -e "
  const fs=require('fs');
  try {
    const am=JSON.parse(fs.readFileSync('/data/automailer/automailer-db.json','utf8'));
    const c=Object.values(am.campaigns||{});
    console.log(c.filter(x=>x.status==='active').length+'/'+c.length);
  } catch(e) { console.log('0/0'); }
" 2>/dev/null || echo "0/0")

TMP_ORPHANS=$(find /var/lib/docker/volumes/ -name '*.tmp' -mmin +60 2>/dev/null | wc -l)

# ─── PHASE 2 : AUTO-REPAIR ───────────────────────────────────────────────────

echo ""
echo "=== AUTO-REPAIR ==="

# Container down → relance
if [ "$BOT_STATUS" = "❌ down" ]; then
  echo "Container down — relance..."
  cd /opt/moltbot && docker compose up -d 2>&1
  sleep 10
  if docker compose ps 2>&1 | grep -q "telegram-router.*Up\|telegram-router.*running"; then
    BOT_STATUS="✅ up (relancé)"
    ACTIONS="${ACTIONS}container relancé; "
  else
    ACTIONS="${ACTIONS}container relancé ÉCHEC; "
  fi
fi

# Container unhealthy → restart
UNHEALTHY=$(docker compose ps 2>&1 | grep -c 'unhealthy' || echo "0")
if [ "$UNHEALTHY" -gt 0 ] && [ "$BOT_STATUS" != "❌ down" ]; then
  echo "Container unhealthy — restart..."
  cd /opt/moltbot && docker compose restart telegram-router 2>&1
  ACTIONS="${ACTIONS}container restart (unhealthy); "
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

# >10 erreurs CRITICAL → alerte uniquement, pas de correction
CRITICAL_HITS=$(docker compose logs --since 12h telegram-router 2>&1 | grep -ic 'CRITICAL\|FATAL' || echo "0")
CRITICAL_WARN=""
if [ "${CRITICAL_HITS:-0}" -gt 10 ]; then
  CRITICAL_WARN="❌ ${CRITICAL_HITS} erreurs CRITICAL — intervention manuelle requise"
fi

[ -z "$ACTIONS" ] && ACTIONS="aucune"

# ─── PHASE 3 : RAPPORT TELEGRAM ──────────────────────────────────────────────

echo ""
echo "=== RAPPORT ==="

# Résumé 1 ligne
if [ "$BOT_STATUS" = "✅ up" ] && [ "${ERRORS_12H:-0}" -lt 10 ]; then
  SUMMARY="Tout nominal. Pipeline actif."
elif [ "$BOT_STATUS" = "❌ down" ]; then
  SUMMARY="Bot down, intervention nécessaire."
else
  SUMMARY="${ERRORS_12H} erreurs détectées, surveiller."
fi

MESSAGE="📊 *Bilan Soir — ${TODAY}*

${BOT_STATUS} Bot: ${BOT_STATUS#* }
💾 Disque: ${DISK_DISPLAY} | RAM: ${RAM_USAGE}
📧 Emails: ${EMAILS_TODAY} envoyés
🧠 Brain: ${BRAIN_LAST} (${BRAIN_TOTAL} cycles total)
👥 Pool: ${LEADS_POOL} leads
📥 Replies: ${REPLIES} | Bounces: ${BOUNCES}
📊 Campagnes: ${CAMPAIGNS}
⚠️ Erreurs 12h: ${ERRORS_12H}
${CRITICAL_WARN}
🔧 Actions: ${ACTIONS}

${SUMMARY}"

echo "$MESSAGE"
echo ""
echo "Envoi Telegram..."
send_telegram "$MESSAGE"
echo "Rapport envoyé ✓"
