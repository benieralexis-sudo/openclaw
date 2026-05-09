#!/bin/bash
# P19 (Vague 3 perfection 100%) — Audit pollers Rodz et France Travail.
#
# Verifie en 1 commande :
#   1. Connectivite Rodz API + nb signaux configures (peu importe les credits)
#   2. Connectivite FT OAuth (bug detecte 09/05 : invalid_client)
#   3. Comptage triggers en DB par sourceCode (preuve d'activite)
#
# Usage : ./audit-pollers-rodz-ft.sh
set -uo pipefail

# Charge .env via python (robuste aux parentheses qui cassent `source`).
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

CLIENT_ID="${1:-cmoevcce00001l6uuklcp13wx}"

echo "=== 1. Rodz ==="
echo -n "  account credits : "
curl -sS --max-time 10 -H "Authorization: Bearer $RODZ_API_KEY" \
  "${RODZ_API_BASE:-https://api.rodz.io}/api/v1/account/credits" 2>/dev/null \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"{d.get('credits','?')} cr\")"
echo -n "  signaux DTL configures : "
curl -sS --max-time 10 -H "Authorization: Bearer $RODZ_API_KEY" \
  "${RODZ_API_BASE:-https://api.rodz.io}/api/v1/signals?limit=20" 2>/dev/null \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
sigs=d.get('signals',[])
active=[s for s in sigs if s.get('status')=='active']
print(f'{len(active)} actifs / {d.get(\"total\",0)} total')
for s in active[:5]:
    print(f'    - {s.get(\"name\",\"?\")[:60]}')"

echo
echo "=== 2. France Travail OAuth ==="
FT_BODY=$(curl -sS --max-time 10 -X POST \
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${FRANCETRAVAIL_CLIENT_ID}&client_secret=${FRANCETRAVAIL_CLIENT_SECRET}&scope=api_offresdemploiv2 o2dsoffre" 2>/dev/null)
echo -n "  status : "
echo "$FT_BODY" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    if d.get('access_token'): print('OK token recu')
    else: print(f\"KO error={d.get('error','?')} desc={d.get('error_description','?')}\")
except: print('KO non-JSON response')"

echo
echo "=== 3. Triggers DB Rodz/FT toutes sources (clientId=$CLIENT_ID) ==="
docker exec ifind-postgres psql -U ifind -d ifind -t -c "
SELECT '  ' || \"sourceCode\" || ' : ' || COUNT(*) || ' triggers, last=' || COALESCE(MAX(\"capturedAt\")::TEXT, 'never')
FROM \"Trigger\"
WHERE \"clientId\"='$CLIENT_ID'
  AND \"deletedAt\" IS NULL
  AND (\"sourceCode\" LIKE 'rodz%' OR \"sourceCode\" LIKE 'francetravail%')
GROUP BY \"sourceCode\"
ORDER BY MAX(\"capturedAt\") DESC;
" 2>/dev/null
