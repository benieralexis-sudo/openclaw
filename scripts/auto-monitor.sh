#!/bin/bash
# auto-monitor.sh — iFIND Trigger Engine v2.0 Auto-Monitor & Self-Repair
# Déployer sur le serveur : /opt/moltbot/scripts/auto-monitor.sh
# Cron recommandé : 0 20 * * * /opt/moltbot/scripts/auto-monitor.sh >> /var/log/moltbot-monitor.log 2>&1

set -euo pipefail

MOLTBOT_DIR="/opt/moltbot"
DATE=$(date '+%Y-%m-%d %H:%M')
DATE_SHORT=$(date '+%d/%m/%Y')
ACTIONS_TAKEN=()
ERRORS=()
STATUS_OK=true
CONTAINER="moltbot-telegram-router-1"

cd "$MOLTBOT_DIR"

# Charger les variables d'environnement
if [ -f "$MOLTBOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$MOLTBOT_DIR/.env"
  set +a
else
  echo "ERREUR: .env introuvable" >&2
  exit 1
fi

# Fonction d'envoi Telegram (JSON-safe via python3)
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
echo "[1/9] Vérification containers..."
BOT_RUNNING=false
BOT_UNHEALTHY=false

ROUTER_STATE=$(docker compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>&1 | grep telegram-router || echo "")
if echo "$ROUTER_STATE" | grep -q "running"; then
  BOT_RUNNING=true
  if echo "$ROUTER_STATE" | grep -q "unhealthy"; then
    BOT_UNHEALTHY=true
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
echo "[2/9] Comptage erreurs 12h..."
ERROR_COUNT=$(docker compose logs --since 12h telegram-router 2>&1 | grep -ic 'error\|CRITICAL\|FATAL' || echo "0")
ERROR_ICON="✅"
if [ "$ERROR_COUNT" -gt 10 ]; then
  ERROR_ICON="❌"
  ERRORS+=("$ERROR_COUNT erreurs/CRITICAL en 12h — intervention manuelle requise")
  STATUS_OK=false
elif [ "$ERROR_COUNT" -gt 3 ]; then
  ERROR_ICON="⚠️"
fi

## 3. Disque
echo "[3/9] Vérification disque..."
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
echo "[4/9] Vérification fichiers .tmp..."
TMP_COUNT=$(find /var/lib/docker/volumes/ -name '*.tmp' -mmin +60 2>/dev/null | wc -l || echo "0")
if [ "$TMP_COUNT" -gt 0 ] && [ "$DISK_CLEANED" = false ]; then
  echo "[AUTO-REPAIR] $TMP_COUNT fichiers .tmp orphelins → nettoyage..."
  find /var/lib/docker/volumes/ -name '*.tmp' -mmin +60 -delete 2>/dev/null || true
  ACTIONS_TAKEN+=("$TMP_COUNT fichiers .tmp orphelins supprimés")
fi

## 5. RAM
echo "[5/9] Vérification RAM..."
RAM_USAGE=$(docker stats --no-stream "$CONTAINER" --format '{{.MemUsage}}' 2>&1 || echo "N/A")

## 6. Stats Trigger Engine v2.0 (SQLite)
echo "[6/9] Stats Trigger Engine SQLite..."

# Script Node.js écrit en fichier tmp pour éviter problèmes heredoc
TMPNODE=$(mktemp /tmp/ifind-monitor-XXXXXX.mjs)
cat > "$TMPNODE" << 'NODESCRIPT'
import { DatabaseSync } from 'node:sqlite';
const DB = '/app/skills/trigger-engine/data/trigger-engine.db';
try {
  const db = new DatabaseSync(DB, { readOnly: true });
  const today = new Date().toISOString().slice(0, 10);
  const g = (sql, ...p) => db.prepare(sql).get(...p);

  // claude_brain_usage peut ne pas exister encore
  let opus_cost = 0, opus_calls = 0, last_qualify = null;
  try {
    opus_cost    = g("SELECT COALESCE(ROUND(SUM(cost_eur),2),0) as n FROM claude_brain_usage WHERE DATE(created_at)=?", today)?.n ?? 0;
    opus_calls   = g("SELECT COUNT(*) as n FROM claude_brain_usage WHERE DATE(created_at)=?", today)?.n ?? 0;
    last_qualify = g("SELECT MAX(created_at) as v FROM claude_brain_usage WHERE pipeline='qualify'")?.v ?? null;
  } catch(_) {}

  const stats = {
    leads_new:       g("SELECT COUNT(*) as n FROM client_leads WHERE status='new'")?.n ?? 0,
    leads_today:     g("SELECT COUNT(*) as n FROM client_leads WHERE DATE(created_at)=?", today)?.n ?? 0,
    events_today:    g("SELECT COUNT(*) as n FROM events WHERE DATE(created_at)=?", today)?.n ?? 0,
    patterns_active: g("SELECT COUNT(*) as n FROM patterns_matched WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP")?.n ?? 0,
    companies:       g("SELECT COUNT(*) as n FROM companies")?.n ?? 0,
    stale_sources:   db.prepare(`
      SELECT GROUP_CONCAT(source, ', ') as v FROM ingestion_state
      WHERE last_run_at < datetime('now', '-6 hours')
      AND source NOT IN ('google-trends','inpi','meta-ad-library')
    `).get()?.v ?? null,
    opus_cost, opus_calls, last_qualify
  };
  db.close();
  console.log(JSON.stringify(stats));
} catch(e) { console.log('{}'); }
NODESCRIPT

TE_STATS=$(docker exec -i "$CONTAINER" node --input-type=module < "$TMPNODE" 2>/dev/null || echo "{}")
rm -f "$TMPNODE"

# Parser les stats JSON
parse_stat() {
  echo "$TE_STATS" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$1'); print(v if v is not None else 'N/A')" 2>/dev/null || echo "N/A"
}

LEADS_NEW=$(parse_stat leads_new)
LEADS_TODAY=$(parse_stat leads_today)
EVENTS_TODAY=$(parse_stat events_today)
PATTERNS_ACTIVE=$(parse_stat patterns_active)
COMPANIES=$(parse_stat companies)
OPUS_COST=$(parse_stat opus_cost)
OPUS_CALLS=$(parse_stat opus_calls)
STALE_SOURCES=$(parse_stat stale_sources)
LAST_QUALIFY_RAW=$(parse_stat last_qualify)

# Formatage dernière qualification
LAST_QUALIFY="jamais"
BRAIN_ICON="✅"
if [ "$LAST_QUALIFY_RAW" != "N/A" ] && [ "$LAST_QUALIFY_RAW" != "None" ] && [ -n "$LAST_QUALIFY_RAW" ]; then
  LAST_QUALIFY=$(TZ=Europe/Paris date -d "$LAST_QUALIFY_RAW" '+%H:%M' 2>/dev/null || echo "$LAST_QUALIFY_RAW")
  QUALIFY_TS=$(date -d "$LAST_QUALIFY_RAW" +%s 2>/dev/null || echo "0")
  QUALIFY_AGE_H=$(( ($(date +%s) - QUALIFY_TS) / 3600 ))
  DAY_OF_WEEK=$(date +%u)
  if [ "$DAY_OF_WEEK" -le 5 ] && [ "${QUALIFY_AGE_H:-0}" -gt 4 ]; then
    BRAIN_ICON="⚠️"
  fi
fi

SOURCES_ICON="✅"
SOURCES_DISPLAY="OK"
if [ "$STALE_SOURCES" != "N/A" ] && [ "$STALE_SOURCES" != "None" ] && [ -n "$STALE_SOURCES" ]; then
  SOURCES_ICON="⚠️"
  SOURCES_DISPLAY="STALE: $STALE_SOURCES"
  ERRORS+=("Sources en retard: $STALE_SOURCES")
fi

LEADS_ICON="✅"
if [[ "$LEADS_NEW" =~ ^[0-9]+$ ]] && [ "$LEADS_NEW" -lt 5 ]; then
  LEADS_ICON="⚠️"
fi

## 7. Emails envoyés aujourd'hui
echo "[7/9] Comptage emails envoyés..."
EMAIL_COUNT=$(docker exec "$CONTAINER" node -e "
const fs=require('fs');
try {
  const d=JSON.parse(fs.readFileSync('/data/automailer/daily-send-count.json','utf8'));
  const today=new Date().toISOString().split('T')[0];
  console.log(d.date===today ? d.count : 0);
} catch(e) { console.log(0); }
" 2>&1 || echo "0")

## 8. Replies/bounces
echo "[8/9] Replies + bounces 12h..."
REPLIES_COUNT=$(docker compose logs --since 12h telegram-router 2>&1 | grep -ic 'reply\|Reply\|interested' || echo "0")
BOUNCES_COUNT=$(docker compose logs --since 12h telegram-router 2>&1 | grep -ic 'bounce' || echo "0")

## 9. Campagnes actives (legacy automailer)
echo "[9/9] Campagnes actives..."
CAMPAIGNS=$(docker exec "$CONTAINER" node -e "
const fs=require('fs');
try {
  const am=JSON.parse(fs.readFileSync('/data/automailer/automailer-db.json','utf8'));
  const c=Object.values(am.campaigns||{});
  console.log(c.filter(x=>x.status==='active').length + '/' + c.length);
} catch(e) { console.log('N/A'); }
" 2>&1 || echo "N/A")

# ─────────────────────────────────────────────
# PHASE 3 : RAPPORT TELEGRAM
# ─────────────────────────────────────────────

if [ "$STATUS_OK" = true ]; then
  SUMMARY="Tout OK — Trigger Engine nominal"
  if [ ${#ACTIONS_TAKEN[@]} -gt 0 ]; then
    SUMMARY="Corrections appliquées — système stable"
  fi
else
  SUMMARY="⚠️ Problèmes détectés — vérification manuelle requise"
fi

if [ ${#ACTIONS_TAKEN[@]} -eq 0 ]; then
  ACTIONS_LINE="aucune"
else
  ACTIONS_LINE=$(IFS=', '; echo "${ACTIONS_TAKEN[*]}")
fi

MSG="📊 *Bilan Soir — ${DATE_SHORT}*

${BOT_ICON} Bot: ${BOT_LABEL}
💾 Disque: ${DISK_DISPLAY} | RAM: ${RAM_USAGE}
📧 Emails: ${EMAIL_COUNT} envoyés | Replies: ${REPLIES_COUNT} | Bounces: ${BOUNCES_COUNT}
📊 Campagnes: ${CAMPAIGNS}
${BRAIN_ICON} Dernière qualif Opus: ${LAST_QUALIFY} (${OPUS_CALLS} appels / ${OPUS_COST}€ auj.)
${LEADS_ICON} Leads nouveaux: ${LEADS_NEW} (${LEADS_TODAY} générés auj.) | Patterns actifs: ${PATTERNS_ACTIVE}
🗃️ Events capturés auj: ${EVENTS_TODAY} | Sociétés base: ${COMPANIES}
${SOURCES_ICON} Sources: ${SOURCES_DISPLAY}
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
