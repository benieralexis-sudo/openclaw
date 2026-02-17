#!/bin/bash
# ============================================================================
# iFIND Bot — Mise à jour d'une instance client
# Pull les derniers changements et rebuild
#
# Usage:
#   ./update-client.sh --host <IP> [--ssh-user root] [--ssh-port 22] [--ssh-key path]
# ============================================================================
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[iFIND]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC} $*" >&2; }

HOST=""
SSH_USER="root"
SSH_PORT="22"
SSH_KEY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)     HOST="$2"; shift 2 ;;
    --ssh-user) SSH_USER="$2"; shift 2 ;;
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    --ssh-key)  SSH_KEY="$2"; shift 2 ;;
    *)          err "Option inconnue: $1"; exit 1 ;;
  esac
done

if [[ -z "$HOST" ]]; then
  err "Usage: ./update-client.sh --host <IP>"
  exit 1
fi

SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p $SSH_PORT"
[[ -n "$SSH_KEY" ]] && SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
SSH_CMD="ssh $SSH_OPTS ${SSH_USER}@${HOST}"

log "Mise a jour iFIND sur $HOST..."

$SSH_CMD bash <<'REMOTE'
set -euo pipefail
cd /opt/ifind

echo ">>> Pull derniers changements..."
git pull --ff-only

echo ">>> Rebuild image Docker..."
docker build -t openclaw:local .

echo ">>> Restart containers..."
docker compose down
docker compose up -d

echo ">>> Attente healthcheck (30s)..."
sleep 30

HEALTH=$(curl -sf http://127.0.0.1:9090/health 2>/dev/null || echo "FAIL")
if echo "$HEALTH" | grep -q "ok\|healthy\|status"; then
  echo ">>> Healthcheck OK!"
else
  echo ">>> WARN: Healthcheck incertain"
  docker compose logs --tail=20
fi
REMOTE

log "Mise a jour terminee sur $HOST"
