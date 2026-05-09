#!/bin/bash
# Healthcheck unifie (P17 Vague 3) — appel sequentiel des 3 healthchecks
# Remplace 3 lignes crontab */5 par 1, evite les overlaps simultanes.
#
# Ordre :
#   1. healthcheck-external (containers UP + endpoint /health Telegram router)
#   2. healthcheck-deep (DB + FullEnrich + Pappers + last cron run)
#   3. uptimerobot-to-telegram (alertes UptimeRobot DOWN)
#
# Si l'un echoue, les autres tournent quand meme (pas de set -e).

LOG="/var/log/ifind-healthcheck-unified.log"
NOW=$(date '+%Y-%m-%d %H:%M:%S')

run_step() {
  local name="$1"
  local cmd="$2"
  local start=$(date +%s)
  bash -c "$cmd" >> "$LOG" 2>&1
  local rc=$?
  local dur=$(($(date +%s) - start))
  echo "[$NOW] step=$name rc=$rc dur=${dur}s" >> "$LOG"
}

run_step "external" "/opt/moltbot/scripts/healthcheck-external.sh"
run_step "deep" "/opt/moltbot/scripts/healthcheck-deep.sh"
run_step "uptimerobot" "/opt/moltbot/scripts/uptimerobot-to-telegram.sh"

exit 0
