#!/bin/bash
# =====================================================
# iFIND — Mettre a jour TOUS les VPS clients
# Ajoute les IPs de tes clients ci-dessous
# Usage : ./update-all-clients.sh
# =====================================================

set -e

# --- Liste des VPS clients (ajoute les IPs ici) ---
CLIENTS=(
  # "95.xxx.xxx.xxx"    # Digidemat
  # "95.xxx.xxx.xxx"    # Client 2
  # "95.xxx.xxx.xxx"    # Client 3
)

if [ ${#CLIENTS[@]} -eq 0 ]; then
  echo "Aucun client configure. Edite update-all-clients.sh et ajoute les IPs."
  exit 1
fi

echo "Mise a jour de ${#CLIENTS[@]} client(s)..."
echo ""

for IP in "${CLIENTS[@]}"; do
  echo "========== $IP =========="
  ./update-client.sh "$IP" || echo "ERREUR sur $IP — on continue"
  echo ""
done

echo "Termine. ${#CLIENTS[@]} client(s) mis a jour."
