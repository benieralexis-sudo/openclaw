#!/bin/bash
# =====================================================
# iFIND — Mettre a jour un VPS client
# Usage : ./update-client.sh <IP> [user]
# =====================================================

set -e

VPS_IP=$1
SSH_USER=${2:-root}

if [ -z "$VPS_IP" ]; then
  echo "Usage : ./update-client.sh <IP> [user]"
  echo "Exemple : ./update-client.sh 95.123.456.789"
  exit 1
fi

echo "Mise a jour du client sur $VPS_IP..."

ssh ${SSH_USER}@${VPS_IP} << 'EOF'
cd /opt/moltbot
echo "[1/3] Pull du code..."
git pull origin main

echo "[2/3] Rebuild + restart..."
docker compose up -d --build --force-recreate

echo "[3/3] Attente demarrage (30s)..."
sleep 30
docker compose ps
echo ""
docker compose logs --tail 5 telegram-router | tail -3
echo ""
echo "OK — Client mis a jour."
EOF
