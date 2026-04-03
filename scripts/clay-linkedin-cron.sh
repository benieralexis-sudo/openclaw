#!/bin/bash
cd /opt/moltbot
export $(grep -v '^#' .env | xargs 2>/dev/null)
COOKIE="$CLAY_SESSION_COOKIE"
TABLE="t_0tcu7swzKxuMiGevHW7"
FIELD="f_0tcxbo4euiaFDjPZQKp"
PUSH="f_0tcvulxhcF78nvzSBRs"
ERRORED_VIEW="gv_0tcu7swAjc83dfgZkx4"
ALL_VIEW="gv_0tcu7swjUvi6puoTqGi"

# Run LinkedIn Posts on errored rows (batch 1)
curl -s -b "$COOKIE" -H "Content-Type: application/json" -H "Accept: application/json" -H "Referer: https://app.clay.com/" \
  -X PATCH "https://api.clay.com/v3/tables/$TABLE/run" \
  -d "{\"runRecords\":{\"viewId\":\"$ERRORED_VIEW\"},\"fieldIds\":[\"$FIELD\"]}" > /dev/null 2>&1

# Wait 3 min for LinkedIn rate limit to cool down and Clay to process
sleep 180

# Run batch 2 (if still errored)
curl -s -b "$COOKIE" -H "Content-Type: application/json" -H "Accept: application/json" -H "Referer: https://app.clay.com/" \
  -X PATCH "https://api.clay.com/v3/tables/$TABLE/run" \
  -d "{\"runRecords\":{\"viewId\":\"$ERRORED_VIEW\"},\"fieldIds\":[\"$FIELD\"]}" > /dev/null 2>&1

# Wait 3 min
sleep 180

# Re-push ALL rows to capture new LinkedIn Posts data
curl -s -b "$COOKIE" -H "Content-Type: application/json" -H "Accept: application/json" -H "Referer: https://app.clay.com/" \
  -X PATCH "https://api.clay.com/v3/tables/$TABLE/run" \
  -d "{\"runRecords\":{\"viewId\":\"$ALL_VIEW\"},\"fieldIds\":[\"$PUSH\"]}" > /dev/null 2>&1

echo "$(date) - LinkedIn Posts retry done (2 batches + re-push)" >> /opt/moltbot/logs/linkedin-posts-retry.log
