#!/bin/bash
cd /opt/moltbot
export $(grep -v '^#' .env | xargs 2>/dev/null)
COOKIE="$CLAY_SESSION_COOKIE"
TABLE="t_0tcu7swzKxuMiGevHW7"
FIELD="f_0tcxbo4euiaFDjPZQKp"
PUSH="f_0tcvulxhcF78nvzSBRs"

# Run LinkedIn Posts on errored rows
curl -s -b "$COOKIE" -H "Content-Type: application/json" -H "Accept: application/json" -H "Referer: https://app.clay.com/" \
  -X PATCH "https://api.clay.com/v3/tables/$TABLE/run" \
  -d "{\"runRecords\":{\"viewId\":\"gv_0tcu7swAjc83dfgZkx4\"},\"fieldIds\":[\"$FIELD\"]}" > /dev/null 2>&1

# Wait 3 min for processing
sleep 180

# Re-push to capture results
curl -s -b "$COOKIE" -H "Content-Type: application/json" -H "Accept: application/json" -H "Referer: https://app.clay.com/" \
  -X PATCH "https://api.clay.com/v3/tables/$TABLE/run" \
  -d "{\"runRecords\":{\"viewId\":\"gv_0tcu7swjUvi6puoTqGi\"},\"fieldIds\":[\"$PUSH\"]}" > /dev/null 2>&1

echo "$(date) - LinkedIn Posts retry done" >> /opt/moltbot/logs/linkedin-posts-retry.log
