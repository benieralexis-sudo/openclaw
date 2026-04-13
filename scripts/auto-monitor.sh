#!/bin/bash
# auto-monitor.sh — iFIND Bot v5.3 Auto-Monitor & Self-Repair
# Déployer sur le serveur : /opt/moltbot/scripts/auto-monitor.sh
# Cron recommandé : 0 8 * * * /opt/moltbot/scripts/auto-monitor.sh >> /var/log/moltbot-monitor.log 2>&1

set -euo pipefail

MOLTBOT_DIR="/opt/moltbot"
DATE=$(date '+%Y-%m-%d %H:%M')
DATE_SHORT=$(date '+%d/%m/%Y')
ACTIONS_TAKEN=()
ERRORS=()
STATUS_OK=true

cd "$MOLTBOT_DIR"

# Charger les variables d'environnement
if [ -f "$MOLTBOT_DIR/.env" ]; then
  set -a
  source "$MOLTBOT_DIR/.env"
  set +a
else
  echo "ERREUR: .env introuvable" >&2
  exit 1
fi

# Fonction d'envoi Telegram
send_telegram() {
  local msg="$1"
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "{\"chat_id\": \"1409505520\", \"text\": $(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'), \"parse_mode\": \"Markdown\"}" \
    > /dev/null 2>&1
}

echo "=== Auto-Monitor démarré: $DATE ==="

# ─────────────────────────────────────────────
# PHASE 1 : DIAGNOSTIC
# ─────────────────────────────────────────────

## 1. Containers
echo "[1/8] Vérification containers..."
CONTAINERS_STATUS=$(docker compose ps --format json 2>&1 || echo "ERROR")
BOT_RUNNING=false
BOT_UNHEALTHY=false

if echo "$CONTAINERS_STATUS" | grep -q '"telegram-router"'; then
  ROUTER_STATE=$(docker compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>&1 | grep telegram-router || echo "")
  if echo "$ROUTER_STATE" | grep -q "running"; then
    BOT_RUNNING=true
    if echo "$ROUTER_STATE" | grep -q "unhealthy"; then
      BOT_UNHEALTHY=true
    fi
  fi
fi

if [ "$BOT_RUNNING" = false ]; then
  echo "[AUTO-REPAIR] Container down → relancement..."
  docker compose up -d 2>&1
  sleep 15
  ROUTER_STATE_AFTER=$(docker compose ps --format '{{.Service}} {{.State}}' 2>&1 | grep telegram-router || echo "")
  if echo "$ROUTER_STATE_AFTER" | grep -q "running"; then
    BOT_RUNNING=true
    ACTIONS_TAKEN+=("container relancé ✅")
    echo "[AUTO-REPAIR] Container relancé avec succès"
  else
    ACTIONS_TAKEN+=("container relancé ÉCHEC ❌")
    ERRORS+=("Container telegram-router toujours down après relancement")
    STATUS_OK=false
    echo "[AUTO-REPAIR] Échec relancement container"
  fi
fi

if [ "$BOT_UNHEALTHY" = true ]; then
  echo "[AUTO-REPAIR] Container unhealthy → restart..."
  docker compose restart telegram-router 2>&1
  sleep 10
  ACTIONS_TAKEN+=("restart telegram-router (unhealthy)")
fi

BOT_ICON="✅"
BOT_LABEL="running"
if [ "$BOT_RUNNING" = false ]; then
  BOT_ICON="❌"
  BOT_LABEL="DOWN"
  STATUS_OK=false
elif [ "$BOT_UNHEALTHY" = true ]; then
  BOT_ICON="⚠️"
  BOT_LABEL="unhealthy → restarted"
fi

## 2. Erreurs dernières 12h
echo "[2/8] Comptage erreurs 12h..."
ERROR_COUNT=$(docker compose logs --since 12h telegram-router 2>&1 | grep -ic 'error\|CRITICAL\|FATAL' || echo "0")
ERROR_ICON="✅"
if [ "$ERROR_COUNT" -gt 10 ]; then
  ERROR_ICON="❌"
  ERRORS+=("$ERROR_COUNT erreurs/CRITICAL détectées en 12h — intervention manuelle requise")
  STATUS_OK=false
elif [ "$ERROR_COUNT" -gt 3 ]; then
  ERROR_ICON="⚠️"
fi

## 3. Disque
echo "[3/8] Vérification disque..."
DISK_USAGE=$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')
DISK_DISPLAY=$(df -h / | tail -1 | awk '{print $5}')
DISK_ICON="✅"
DISK_CLEANED=false

if [ "$DISK_USAGE" -gt 85 ]; then
  echo "[AUTO-REPAIR] Disque > 85% → nettoyage..."
  DISK_ICON="⚠️"
  docker system prune -f 2>&1 | tail -3
  find /var/lib/docker/volumes/ -name '*.tmp' -mmin +60 -delete 2>/dev/null || true
  find /var/lib/docker/volumes/ -name '*.bak-*' -mtime +7 -delete 2>/dev/null || true
  DISK_USAGE_AFTER=$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')
  DISK_DISPLAY="${DISK_USAGE}% → ${DISK_USAGE_AFTER}%"
  ACTIONS_TAKEN+=("disque nettoyé: ${DISK_USAGE}% → ${DISK_USAGE_AFTER}%")
  DISK_CLEANED=true
  if [ "$DISK_USAGE_AFTER" -gt 90 ]; then
    DISK_ICON="❌"
    ERRORS+=("Disque critique: ${DISK_USAGE_AFTER}% même après nettoyage")
    STATUS_OK=false
  fi
fi

## 4. Fichiers .tmp orphelins
echo "[4/8] Vérification fichiers .tmp..."
TMP_COUNT=$(find /var/lib/docker/volumes/ -name '*.tmp' -mmin +60 2>/dev/null | wc -l || echo "0")
if [ "$TMP_COUNT" -gt 0 ] && [ "$DISK_CLEANED" = false ]; then
  echo "[AUTO-REPAIR] $TMP_COUNT fichiers .tmp orphelins → nettoyage..."
  find /var/lib/docker/volumes/ -name '*.tmp' -mmin +60 -delete 2>/dev/null || true
  ACTIONS_TAKEN+=("$TMP_COUNT fichiers .tmp orphelins supprimés")
fi

## 5. RAM
echo "[5/8] Vérification RAM..."
RAM_USAGE=$(docker stats --no-stream moltbot-telegram-router-1 --format '{{.MemUsage}}' 2>&1 || echo "N/A")

## 6. Emails aujourd'hui
echo "[6/8] Comptage emails..."
EMAIL_COUNT=$(docker exec moltbot-telegram-router-1 node -e "
const fs=require('fs');
try {
  const d=JSON.parse(fs.readFileSync('/data/automailer/daily-send-count.json','utf8'));
  const today=new Date().toISOString().split('T')[0];
  if(d.date===today) console.log(d.count);
  else console.log(0);
} catch(e) { console.log(0); }
" 2>&1 || echo "N/A")

## 7. Dernier brain cycle
echo "[7/8] Vérification brain cycle..."
LAST_BRAIN=$(docker exec moltbot-telegram-router-1 node -e "
const fs=require('fs');
try {
  const ap=JSON.parse(fs.readFileSync('/data/autonomous-pilot/autonomous-pilot.json','utf8'));
  const ts=ap.stats?.lastBrainCycleAt;
  if(!ts) { console.log('jamais'); return; }
  const diff=Math.round((Date.now()-new Date(ts).getTime())/3600000);
  console.log(diff+'h ago ('+new Date(ts).toLocaleString('fr-FR',{timeZone:'Europe/Paris'})+')');
} catch(e) { console.log('erreur lecture: '+e.message); }
" 2>&1 || echo "N/A")

BRAIN_ICON="✅"
if echo "$LAST_BRAIN" | grep -qE '^([2-9][0-9]|[3-9][0-9])h ago'; then
  BRAIN_ICON="⚠️"
fi

## 8. Pool leads
echo "[8/8] Comptage leads pool..."
LEADS_COUNT=$(docker exec moltbot-telegram-router-1 node -e "
const fs=require('fs');
try {
  const ap=JSON.parse(fs.readFileSync('/data/autonomous-pilot/autonomous-pilot.json','utf8'));
  console.log((ap.leads||[]).length);
} catch(e) { console.log('N/A'); }
" 2>&1 || echo "N/A")

LEADS_ICON="✅"
if [[ "$LEADS_COUNT" =~ ^[0-9]+$ ]] && [ "$LEADS_COUNT" -lt 10 ]; then
  LEADS_ICON="⚠️"
fi

# ─────────────────────────────────────────────
# PHASE 3 : RAPPORT TELEGRAM
# ─────────────────────────────────────────────

# Construire résumé
if [ "$STATUS_OK" = true ]; then
  SUMMARY="Tout OK — système nominal"
  if [ ${#ACTIONS_TAKEN[@]} -gt 0 ]; then
    SUMMARY="Corrections appliquées — système stable"
  fi
else
  SUMMARY="⚠️ Problèmes détectés — vérification manuelle requise"
fi

# Actions
if [ ${#ACTIONS_TAKEN[@]} -eq 0 ]; then
  ACTIONS_LINE="aucune"
else
  ACTIONS_LINE=$(IFS=', '; echo "${ACTIONS_TAKEN[*]}")
fi

MSG="🔍 *Auto-Monitor — ${DATE_SHORT}*

${BOT_ICON} Bot: ${BOT_LABEL}
${DISK_ICON} Disque: ${DISK_DISPLAY}
💾 RAM: ${RAM_USAGE}
📧 Emails aujourd'hui: ${EMAIL_COUNT}
${BRAIN_ICON} Brain: ${LAST_BRAIN}
${LEADS_ICON} Pool: ${LEADS_COUNT} leads
${ERROR_ICON} Erreurs 12h: ${ERROR_COUNT}

🔧 Actions: ${ACTIONS_LINE}

${SUMMARY}"

echo ""
echo "=== RAPPORT ==="
echo "$MSG"
echo ""

echo "[Telegram] Envoi rapport..."
send_telegram "$MSG"
echo "[Telegram] Rapport envoyé."
echo "=== Auto-Monitor terminé: $(date '+%Y-%m-%d %H:%M') ==="
