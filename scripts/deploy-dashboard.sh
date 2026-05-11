#!/bin/bash
# Deploy dashboard-v2 proprement (build atomique + restart synchronisé).
#
# Pourquoi ce script ?
# ────────────────────
# `systemctl restart dashboard-v2.service` IMMÉDIATEMENT après `npm run build`
# crée une race condition : si on restart pendant que le build n'a pas fini
# d'écrire .next/, le `next start` échoue avec "Could not find a production
# build" jusqu'à ce que Restart=always retente assez de fois. Log pollué et
# downtime inutile (jusqu'à 30-50s d'erreurs avant le succès).
#
# Ce script résout ça en faisant le build EN PREMIER (avec le service qui
# tourne toujours sur l'ancien build), puis seulement quand le build est
# 100% écrit on déclenche le restart.
#
# Usage :
#   /opt/moltbot/scripts/deploy-dashboard.sh
#
# Convention : ne PLUS appeler `systemctl restart dashboard-v2.service`
# directement. Toujours passer par ce script.

set -euo pipefail

DASHBOARD_DIR="/opt/moltbot/dashboard-v2"
SERVICE="dashboard-v2.service"
HEALTH_URL="http://127.0.0.1:3100/api/health/deep"

cd "$DASHBOARD_DIR"

echo "[deploy] 1/4 — Build Next.js (le service tourne toujours sur l'ancien build)..."
START=$(date +%s)
npm run build > /tmp/deploy-build.log 2>&1
BUILD_DUR=$(($(date +%s) - START))
echo "[deploy] ✓ Build terminé en ${BUILD_DUR}s"

# Sanity check : le build a-t-il bien produit les artefacts nécessaires ?
if [ ! -f "$DASHBOARD_DIR/.next/prerender-manifest.json" ]; then
  echo "[deploy] ✗ ERREUR : prerender-manifest.json manquant après build."
  echo "[deploy]   Log build : /tmp/deploy-build.log"
  tail -20 /tmp/deploy-build.log
  exit 1
fi
if [ ! -f "$DASHBOARD_DIR/.next/BUILD_ID" ]; then
  echo "[deploy] ✗ ERREUR : BUILD_ID manquant après build."
  exit 1
fi
BUILD_ID=$(cat "$DASHBOARD_DIR/.next/BUILD_ID")
echo "[deploy] 2/4 — Build artifacts vérifiés (BUILD_ID=$BUILD_ID)"

echo "[deploy] 3/4 — Restart service (downtime <5s, prochain start trouve un build complet)..."
systemctl restart "$SERVICE"

# Wait for service ready (max 30s)
echo "[deploy] 4/4 — Attente health check..."
for i in {1..30}; do
  sleep 1
  CODE=$(curl -sko /dev/null -w "%{http_code}" --max-time 3 "$HEALTH_URL" 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then
    echo "[deploy] ✓ Service UP après ${i}s (health 200). Déploiement terminé."
    exit 0
  fi
done

echo "[deploy] ⚠️  Service n'a pas répondu 200 après 30s. À investiguer :"
echo "[deploy]   systemctl status $SERVICE"
echo "[deploy]   tail /var/log/dashboard-v2.log"
exit 2
