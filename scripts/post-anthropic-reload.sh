#!/bin/bash
# Auto-relance du bot iFIND apres recharge Anthropic.
#
# A LANCER UNE FOIS apres avoir mis 30-50 EUR sur :
#   https://console.anthropic.com/settings/billing
#
# Usage : sudo /opt/moltbot/scripts/post-anthropic-reload.sh
#
# 5 etapes automatiques :
#   1. Smoke test API Anthropic (haiku-4-5 ping)
#   2. Reactive cron run-pollers dans crontab (decommente)
#   3. Lance 1 cycle run-pollers manuellement
#   4. Curl /api/internal/health pour valider tous composants
#   5. Recap Telegram avec KPIs
#
# Si une etape KO : exit + ping Telegram avec l'erreur.
set -uo pipefail

# Charge .env via python (robuste aux parentheses)
load_env() {
  local file="$1"
  [ -f "$file" ] || return 0
  while IFS='=' read -r key val; do
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$key" ]] && continue
    key="${key// /}"; val="${val#\"}"; val="${val%\"}"
    [[ -z "$key" || -z "$val" ]] && continue
    export "$key=$val"
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' "$file")
}
load_env /opt/moltbot/dashboard-v2/.env
load_env /opt/moltbot/.env

CRON_SECRET="${CRON_SECRET:-$(grep ^CRON_SECRET /opt/moltbot/scripts/.run-pollers.env | cut -d= -f2)}"

send_telegram() {
  local msg="$1"
  [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && return 0
  curl -sS --max-time 10 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${ADMIN_CHAT_ID}" \
    -d parse_mode="Markdown" \
    --data-urlencode text="${msg}" >/dev/null 2>&1
}

fail() {
  local step="$1"
  local detail="$2"
  echo
  echo "❌ ECHEC etape : $step"
  echo "Detail : $detail"
  send_telegram "🚨 *post-anthropic-reload ECHOUE* a l'etape *${step}* :
\`\`\`
${detail}
\`\`\`"
  exit 1
}

echo "════════════════════════════════════════════════════════════"
echo "  iFIND auto-relance post-recharge Anthropic"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════════"

# ─────────────────────────────────────────────────────────────
# Etape 1 — Smoke test API Anthropic
# ─────────────────────────────────────────────────────────────
echo
echo "[1/5] Smoke test API Anthropic..."
ANTH_HTTP=$(curl -sS -o /tmp/_anth_test.json -w "%{http_code}" \
  --max-time 15 \
  https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":5,"messages":[{"role":"user","content":"ping"}]}' 2>/dev/null)

if [ "$ANTH_HTTP" != "200" ]; then
  BODY=$(head -c 200 /tmp/_anth_test.json)
  fail "Anthropic API" "HTTP=$ANTH_HTTP body=$BODY (recharge incomplete ou cle revoque ?)"
fi
echo "  ✅ Anthropic OK (HTTP 200)"

# ─────────────────────────────────────────────────────────────
# Etape 2 — Reactive cron run-pollers
# ─────────────────────────────────────────────────────────────
echo
echo "[2/5] Reactivation cron run-pollers..."
CRON_BEFORE=$(crontab -l 2>/dev/null)
if echo "$CRON_BEFORE" | grep -qE "^[^#].*run-pollers-cron\.sh"; then
  echo "  ✅ Deja actif (skip)"
elif echo "$CRON_BEFORE" | grep -q "DISABLED.*run-pollers-cron"; then
  CRON_AFTER=$(echo "$CRON_BEFORE" | sed -E 's|^# DISABLED [^—]+— (0 \* \* \* \* /opt/moltbot/scripts/run-pollers-cron\.sh)|\1|')
  if [ "$CRON_AFTER" = "$CRON_BEFORE" ]; then
    fail "Crontab edit" "Pattern DISABLED non matche, edition manuelle requise"
  fi
  echo "$CRON_AFTER" | crontab -
  echo "  ✅ Decommente"
else
  fail "Crontab" "Ni ligne active ni ligne DISABLED trouvee — verifier manuellement"
fi
crontab -l | grep run-pollers-cron || true

# ─────────────────────────────────────────────────────────────
# Etape 3 — Lance 1 cycle manuel
# ─────────────────────────────────────────────────────────────
echo
echo "[3/5] Lance 1 cycle run-pollers (peut prendre 1-5 min)..."
START=$(date +%s)
/opt/moltbot/scripts/run-pollers-cron.sh > /tmp/_post_reload_pollers.out 2>&1
RC=$?
DUR=$(($(date +%s) - START))
LAST_END=$(tail -n 5 /var/log/ifind-pollers.log | grep "END" | tail -1)
echo "  duree: ${DUR}s, rc=$RC"
echo "  $LAST_END"

if [ $RC -ne 0 ] || ! echo "$LAST_END" | grep -q "http=200"; then
  fail "Cycle run-pollers" "rc=$RC last=$LAST_END (voir /tmp/_post_reload_pollers.out)"
fi
echo "  ✅ Cycle OK"

# ─────────────────────────────────────────────────────────────
# Etape 4 — Curl /api/internal/health
# ─────────────────────────────────────────────────────────────
echo
echo "[4/5] Validation /api/internal/health..."
HEALTH=$(curl -sS -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3100/api/internal/health 2>/dev/null)
if [ -z "$HEALTH" ]; then
  fail "Healthcheck" "endpoint injoignable"
fi
OVERALL=$(echo "$HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('overall','?'))" 2>/dev/null)
echo "  overall: $OVERALL"

# Format checks compactement
SUMMARY=$(echo "$HEALTH" | python3 -c "
import json,sys
d=json.load(sys.stdin)
checks=d.get('checks',{})
red=[]; yellow=[]; green=[]
for k,v in checks.items():
    s=v.get('status','?')
    msg=v.get('message','')
    line=f'{k}'+(f' ({msg})' if msg else '')
    if s=='down': red.append(line)
    elif s=='degraded': yellow.append(line)
    else: green.append(k)
print(f'  green: {len(green)}/{len(checks)} — {\", \".join(green)}')
if yellow: print(f'  yellow: {len(yellow)} — {\"; \".join(yellow)}')
if red: print(f'  red: {len(red)} — {\"; \".join(red)}')
")
echo "$SUMMARY"

# ─────────────────────────────────────────────────────────────
# Etape 5 — Recap Telegram
# ─────────────────────────────────────────────────────────────
echo
echo "[5/5] Recap Telegram..."
EMOJI="✅"
[ "$OVERALL" = "yellow" ] && EMOJI="🟡"
[ "$OVERALL" = "red" ] && EMOJI="🔴"

OPUSQ=$(echo "$LAST_END" | grep -oE 'opusQ=[0-9]+' | cut -d= -f2)
CREATED=$(echo "$LAST_END" | grep -oE 'created=[0-9]+' | cut -d= -f2)
EXISTED=$(echo "$LAST_END" | grep -oE 'existed=[0-9]+' | cut -d= -f2)

send_telegram "${EMOJI} *iFIND relance OK*

⚙️ Cycle: opusQ=${OPUSQ:-?} created=${CREATED:-?} existed=${EXISTED:-?} en ${DUR}s
🔍 Health: overall=*${OVERALL}*
🤖 Cron run-pollers: REACTIVE (toutes les heures)

Le bot est de nouveau en marche. Surveiller les pings zombi/budget Telegram pour anomalies."

echo "  ✅ Ping envoye"
echo
echo "════════════════════════════════════════════════════════════"
echo "  ✅ RELANCE COMPLETE"
echo "════════════════════════════════════════════════════════════"
echo "  Suivi : tail -f /var/log/ifind-pollers.log"
echo "  Health : curl -H 'x-cron-secret: \$CRON_SECRET' http://127.0.0.1:3100/api/internal/health"
echo "════════════════════════════════════════════════════════════"
