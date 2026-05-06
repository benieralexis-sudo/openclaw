#!/bin/bash
# iFIND — Monitoring proactif des quotas outils outbound
# Audit 03/05/2026 : suite incident plafond Apify $57.50/$60 brûlé en 8j
# Cron daily 8h. Alerte Telegram si quota >75% utilisé en milieu de cycle.
#
# Outils mesurés via API :
#   - Apify       : /v2/users/me/limits
#   - FullEnrich  : /api/v1/account/credits
#   - Rodz        : /api/v1/account/credits
#
# Outils non mesurables côté API (pas d'endpoint public) :
#   - Anthropic, Kaspr, TheirStack, Pappers — instrumentation locale via logs
#
# Charge .env via python (robuste aux lignes avec parenthèses/accents qui
# cassent `source` bash ; ex: MAILBOX_1_LABEL=Frédéric (get-digitestlab)).
load_env() {
  local file="$1"
  [ -f "$file" ] || return 0
  while IFS='=' read -r key val; do
    # Skip commentaires et lignes vides
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$key" ]] && continue
    # Trim whitespace, strip quotes
    key="${key// /}"
    val="${val#\"}"; val="${val%\"}"
    [[ -z "$key" || -z "$val" ]] && continue
    export "$key=$val"
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' "$file")
}
load_env /opt/moltbot/dashboard-v2/.env
load_env /opt/moltbot/.env

: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN missing}"
: "${ADMIN_CHAT_ID:?ADMIN_CHAT_ID missing}"

LOG_FILE="/var/log/ifind-quota-monitor.log"
ALERT_THRESHOLD=75  # %

log() { echo "[$(date '+%Y-%m-%dT%H:%M:%SZ')] $1" >> "$LOG_FILE"; }

# Envoie un message Markdown Telegram (à un seul ADMIN_CHAT_ID).
send_telegram() {
  local msg="$1"
  curl -sS --max-time 10 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${ADMIN_CHAT_ID}" \
    -d "parse_mode=Markdown" \
    --data-urlencode "text=${msg}" >/dev/null 2>&1
}

ALERTS=()

# ──────────────────────────────────────────────────────────────────
# 1. APIFY
# ──────────────────────────────────────────────────────────────────
APIFY_DATA=$(curl -sS --max-time 15 -H "Authorization: Bearer ${APIFY_API_TOKEN}" \
  "https://api.apify.com/v2/users/me/limits" 2>/dev/null)
if [ -n "$APIFY_DATA" ]; then
  APIFY=$(echo "$APIFY_DATA" | python3 -c "
import json, sys, datetime
try:
    d = json.load(sys.stdin)
    data = d.get('data', d)
    used = data.get('current',{}).get('monthlyUsageUsd', 0)
    limit = data.get('limits',{}).get('maxMonthlyUsageUsd', 0)
    cycle_end = data.get('monthlyUsageCycle',{}).get('endAt','')
    cycle_start = data.get('monthlyUsageCycle',{}).get('startAt','')
    pct = round(100 * used / limit, 1) if limit else 0
    # Calcul ratio temps écoulé du cycle
    if cycle_start and cycle_end:
        s = datetime.datetime.fromisoformat(cycle_start.replace('Z','+00:00'))
        e = datetime.datetime.fromisoformat(cycle_end.replace('Z','+00:00'))
        n = datetime.datetime.now(datetime.timezone.utc)
        time_pct = round(100 * (n - s).total_seconds() / (e - s).total_seconds(), 1)
    else:
        time_pct = 0
    print(f'{pct}|{used:.2f}|{limit}|{time_pct}')
except: print('||||')
")
  IFS='|' read -r APIFY_PCT APIFY_USED APIFY_LIMIT APIFY_TIME_PCT <<< "$APIFY"
  log "APIFY: ${APIFY_USED}/${APIFY_LIMIT} (${APIFY_PCT}%, time elapsed ${APIFY_TIME_PCT}%)"
  if [ -n "$APIFY_PCT" ] && (( $(echo "$APIFY_PCT > $ALERT_THRESHOLD" | bc -l 2>/dev/null || echo 0) )); then
    # Alerte uniquement si conso% dépasse temps écoulé% + 10pts (sinon trajectoire OK)
    if (( $(echo "$APIFY_PCT > $APIFY_TIME_PCT + 10" | bc -l 2>/dev/null || echo 0) )); then
      ALERTS+=("⚠️ *Apify* ${APIFY_PCT}% utilisé (\$${APIFY_USED}/\$${APIFY_LIMIT}), cycle à ${APIFY_TIME_PCT}%")
    fi
  fi

  # 1.bis Burn 24h — détection précoce d'un actor qui dérape (audit 06/05 :
  # plafond $70/$70 atteint suite wire-up Sprint 2 B.2 + restart-spam bot).
  # Somme usageTotalUsd des runs des dernières 24h. Seuil $3 = trajectoire
  # cible <$70/mois (~$2.30/j), au-dessus on veut un coup d'œil rapide.
  APIFY_24H=$(curl -sS --max-time 15 -H "Authorization: Bearer ${APIFY_API_TOKEN}" \
    "https://api.apify.com/v2/actor-runs?limit=200&desc=true" 2>/dev/null | python3 -c "
import json, sys, datetime
try:
    d = json.load(sys.stdin)
    items = d.get('data', {}).get('items', [])
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=24)
    total = 0.0
    by_actor = {}
    for r in items:
        s = r.get('startedAt','')
        if not s: continue
        t = datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
        if t < cutoff: continue
        usd = r.get('usageTotalUsd', 0) or 0
        total += usd
        a = r.get('actId','?')[:6]
        by_actor[a] = by_actor.get(a, 0) + usd
    top = sorted(by_actor.items(), key=lambda x: -x[1])[:2]
    top_str = ', '.join(f'{a}=\${u:.2f}' for a, u in top)
    print(f'{total:.2f}|{top_str}')
except: print('|')
")
  IFS='|' read -r BURN_24H BURN_TOP <<< "$APIFY_24H"
  log "APIFY_24H: \$${BURN_24H} (top: ${BURN_TOP})"
  if [ -n "$BURN_24H" ] && (( $(echo "$BURN_24H > 3.0" | bc -l 2>/dev/null || echo 0) )); then
    ALERTS+=("🔥 *Apify burn 24h* \$${BURN_24H} (seuil \$3.00) — top: ${BURN_TOP}")
  fi
fi

# ──────────────────────────────────────────────────────────────────
# 2. FULLENRICH
# ──────────────────────────────────────────────────────────────────
FE_DATA=$(curl -sS --max-time 15 -H "Authorization: Bearer ${FULLENRICH_API_KEY}" \
  "https://app.fullenrich.com/api/v1/account/credits" 2>/dev/null)
if [ -n "$FE_DATA" ]; then
  # FullEnrich endpoint retourne juste {balance: N} (= cr restants).
  # Plan Yearly Start = 1000 cr/mois selon mémoire 30/04 (souscrit ce jour).
  # Alerte si < 100 cr restants (10% du quota mensuel).
  FE_BALANCE=$(echo "$FE_DATA" | python3 -c "
import json, sys
try: print(json.load(sys.stdin).get('balance', 'err'))
except: print('err')
")
  log "FULLENRICH: ${FE_BALANCE} cr restants"
  if [ "$FE_BALANCE" != "err" ] && [ -n "$FE_BALANCE" ] && (( $(echo "$FE_BALANCE < 100" | bc -l 2>/dev/null || echo 0) )); then
    ALERTS+=("⚠️ *FullEnrich* seulement ${FE_BALANCE} crédits restants (seuil 100)")
  fi
fi

# ──────────────────────────────────────────────────────────────────
# 3. RODZ
# ──────────────────────────────────────────────────────────────────
RODZ_DATA=$(curl -sS --max-time 15 -H "Authorization: Bearer ${RODZ_API_KEY}" \
  "${RODZ_API_BASE:-https://api.rodz.io}/api/v1/account/credits" 2>/dev/null)
if [ -n "$RODZ_DATA" ]; then
  RODZ=$(echo "$RODZ_DATA" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    credits = d.get('credits', 0)
    print(f'{credits}')
except: print('err')
")
  log "RODZ: ${RODZ} crédits restants"
  # Pour Rodz on n'a que les crédits restants (pas le total). Alerte si < 200.
  if [ "$RODZ" != "err" ] && [ -n "$RODZ" ] && (( $(echo "$RODZ < 200" | bc -l 2>/dev/null || echo 0) )); then
    ALERTS+=("⚠️ *Rodz* seulement ${RODZ} crédits restants (seuil 200)")
  fi
fi

# ──────────────────────────────────────────────────────────────────
# 4. ENVOI TELEGRAM si alertes
# ──────────────────────────────────────────────────────────────────
if [ ${#ALERTS[@]} -gt 0 ]; then
  MSG="🚨 *iFIND Quota Watch* — $(date +%H:%M)"$'\n\n'
  for a in "${ALERTS[@]}"; do MSG+="$a"$'\n'; done
  MSG+=$'\n''Action : vérifier console outil concerné, augmenter plafond ou auditer pipeline.'
  send_telegram "$MSG"
  log "ALERT sent: ${#ALERTS[@]} alerts"
else
  log "OK — pas d'alerte ($(date '+%Y-%m-%d %H:%M'))"
fi
