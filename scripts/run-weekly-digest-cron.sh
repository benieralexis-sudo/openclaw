#!/bin/bash
# Sprint 3 (10/05/2026) — Cron envoi digests hebdomadaires
#
# Schedule : lundi 6h UTC (= 7h Paris hiver, 8h ete)
# Boucle sur tous les clients ACTIVE avec deliveryConfig.weeklyDigest.enabled=true
# et envoie chacun son digest des leads NEW score >= seuil sur 7j.
#
# Idempotence : check AuditLog 'delivery.weekly_digest_sent' avec metadata.weekKey
# pour eviter doublon si cron retrigger.
#
# Crontab line :
#   0 6 * * 1 /opt/moltbot/scripts/run-weekly-digest-cron.sh
set -uo pipefail

CRON_SECRET="${CRON_SECRET:-$(grep ^CRON_SECRET /opt/moltbot/scripts/.run-pollers.env | cut -d= -f2)}"
LOG=/var/log/ifind-weekly-digest.log
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP=/tmp/run-weekly-digest.out

echo "[$NOW] START" >> "$LOG"

HTTP_CODE=$(curl -sS -o "$TMP" -w "%{http_code}" \
  --max-time 300 \
  -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "http://127.0.0.1:3100/api/internal/run-weekly-digest" || echo "curl_error")

END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SUMMARY=$(python3 -c "
import json
try:
    d = json.load(open('$TMP'))
    print(f\"http=$HTTP_CODE total={d.get('total','?')} sent={d.get('sent','?')} skipped={d.get('skipped','?')} failed={d.get('failed','?')}\")
except Exception as e:
    print(f\"http=$HTTP_CODE parse_error={e}\")
" 2>/dev/null || echo "http=$HTTP_CODE parse_failed")

echo "[$END] END $SUMMARY" >> "$LOG"

# Alerte Telegram si failed > 0
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(grep ^TELEGRAM_BOT_TOKEN /opt/moltbot/.env 2>/dev/null | cut -d= -f2)}"
ADMIN_CHAT_ID="${ADMIN_CHAT_ID:-$(grep ^ADMIN_CHAT_ID /opt/moltbot/.env 2>/dev/null | cut -d= -f2)}"
FAILED=$(echo "$SUMMARY" | grep -oE 'failed=[0-9]+' | cut -d= -f2)
if [ -n "$FAILED" ] && [ "$FAILED" -gt 0 ] && [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  curl -sS --max-time 10 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${ADMIN_CHAT_ID}" \
    -d parse_mode="Markdown" \
    --data-urlencode text="🚨 *iFIND weekly digest* — ${FAILED} envoi(s) ECHOUE(S). Voir \`tail /var/log/ifind-weekly-digest.log\`" \
    >/dev/null 2>&1
fi
