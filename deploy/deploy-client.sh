#!/bin/bash
# ============================================================================
# iFIND Bot — Script de déploiement client
# Clone une instance iFIND sur un nouveau VPS Hostinger en ~5 minutes
#
# Usage:
#   ./deploy-client.sh --host <IP> --domain <client.ifind.fr> --bot-token <TOKEN> \
#     --client-name "Nom Client" --admin-chat-id <CHAT_ID>
#
# Pre-requis sur le VPS cible:
#   - Ubuntu 22.04+ ou Debian 12+
#   - Acces root SSH (cle ou mot de passe)
#   - Port 80 et 443 ouverts
# ============================================================================
set -euo pipefail

# === Couleurs ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[iFIND]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC} $*" >&2; }

# === Arguments ===
HOST=""
DOMAIN=""
BOT_TOKEN=""
CLIENT_NAME=""
ADMIN_CHAT_ID=""
SSH_USER="root"
SSH_PORT="22"
SSH_KEY=""
OPENAI_KEY=""
CLAUDE_KEY=""
HUBSPOT_KEY=""
APOLLO_KEY=""
FULLENRICH_KEY=""
RESEND_KEY=""
SENDER_EMAIL=""
DASHBOARD_PASS=""
DAILY_BUDGET="5"
SKIP_SSL="false"

print_usage() {
  cat <<'USAGE'
Usage: ./deploy-client.sh [OPTIONS]

Options obligatoires:
  --host <IP>              IP du VPS cible
  --domain <DOMAIN>        Domaine du client (ex: client1.ifind.fr)
  --bot-token <TOKEN>      Token du bot Telegram du client
  --client-name <NOM>      Nom du client
  --admin-chat-id <ID>     Chat ID Telegram de l'admin client

Options SSH:
  --ssh-user <USER>        Utilisateur SSH (defaut: root)
  --ssh-port <PORT>        Port SSH (defaut: 22)
  --ssh-key <PATH>         Chemin vers la cle SSH privee

Options API (si vides, seront demandees interactivement):
  --openai-key <KEY>       Cle API OpenAI
  --claude-key <KEY>       Cle API Anthropic/Claude
  --hubspot-key <KEY>      Cle API HubSpot
  --apollo-key <KEY>       Cle API Apollo
  --fullenrich-key <KEY>   Cle API FullEnrich
  --resend-key <KEY>       Cle API Resend
  --sender-email <EMAIL>   Email d'envoi (defaut: hello@<DOMAIN>)
  --dashboard-pass <PASS>  Mot de passe dashboard
  --daily-budget <N>       Budget API quotidien en $ (defaut: 5)
  --skip-ssl               Ne pas configurer SSL/Let's Encrypt

Exemple:
  ./deploy-client.sh \
    --host 203.0.113.10 \
    --domain prospection.client1.com \
    --bot-token "7254945306:AAG..." \
    --client-name "Client1 SAS" \
    --admin-chat-id "123456789" \
    --openai-key "sk-proj-..." \
    --claude-key "sk-ant-..." \
    --resend-key "re_..." \
    --dashboard-pass "MonPass2026!"
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)           HOST="$2"; shift 2 ;;
    --domain)         DOMAIN="$2"; shift 2 ;;
    --bot-token)      BOT_TOKEN="$2"; shift 2 ;;
    --client-name)    CLIENT_NAME="$2"; shift 2 ;;
    --admin-chat-id)  ADMIN_CHAT_ID="$2"; shift 2 ;;
    --ssh-user)       SSH_USER="$2"; shift 2 ;;
    --ssh-port)       SSH_PORT="$2"; shift 2 ;;
    --ssh-key)        SSH_KEY="$2"; shift 2 ;;
    --openai-key)     OPENAI_KEY="$2"; shift 2 ;;
    --claude-key)     CLAUDE_KEY="$2"; shift 2 ;;
    --hubspot-key)    HUBSPOT_KEY="$2"; shift 2 ;;
    --apollo-key)     APOLLO_KEY="$2"; shift 2 ;;
    --fullenrich-key) FULLENRICH_KEY="$2"; shift 2 ;;
    --resend-key)     RESEND_KEY="$2"; shift 2 ;;
    --sender-email)   SENDER_EMAIL="$2"; shift 2 ;;
    --dashboard-pass) DASHBOARD_PASS="$2"; shift 2 ;;
    --daily-budget)   DAILY_BUDGET="$2"; shift 2 ;;
    --skip-ssl)       SKIP_SSL="true"; shift ;;
    --help|-h)        print_usage; exit 0 ;;
    *)                err "Option inconnue: $1"; print_usage; exit 1 ;;
  esac
done

# === Validation ===
MISSING=""
[[ -z "$HOST" ]]         && MISSING="$MISSING --host"
[[ -z "$DOMAIN" ]]       && MISSING="$MISSING --domain"
[[ -z "$BOT_TOKEN" ]]    && MISSING="$MISSING --bot-token"
[[ -z "$CLIENT_NAME" ]]  && MISSING="$MISSING --client-name"
[[ -z "$ADMIN_CHAT_ID" ]] && MISSING="$MISSING --admin-chat-id"

if [[ -n "$MISSING" ]]; then
  err "Parametres obligatoires manquants:$MISSING"
  echo ""
  print_usage
  exit 1
fi

# Defaults
[[ -z "$SENDER_EMAIL" ]] && SENDER_EMAIL="hello@${DOMAIN}"
[[ -z "$DASHBOARD_PASS" ]] && DASHBOARD_PASS="iFIND$(openssl rand -hex 4)!"

# Demander les cles manquantes interactivement
ask_if_empty() {
  local varname="$1"
  local prompt="$2"
  local current="${!varname}"
  if [[ -z "$current" ]]; then
    read -rp "$(echo -e "${BLUE}[?]${NC} $prompt: ")" value
    eval "$varname=\"\$value\""
  fi
}

ask_if_empty OPENAI_KEY   "Cle API OpenAI (GPT-4o-mini pour le routeur)"
ask_if_empty CLAUDE_KEY   "Cle API Claude/Anthropic (redaction + IA)"
ask_if_empty RESEND_KEY   "Cle API Resend (envoi email)"

# Les autres sont optionnelles
if [[ -z "$HUBSPOT_KEY" ]]; then
  warn "Pas de cle HubSpot — CRM Pilot sera limite"
fi
if [[ -z "$APOLLO_KEY" ]]; then
  warn "Pas de cle Apollo — FlowFast sera limite"
fi

# === Construire la commande SSH ===
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p $SSH_PORT"
[[ -n "$SSH_KEY" ]] && SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
SSH_CMD="ssh $SSH_OPTS ${SSH_USER}@${HOST}"

log "=== Deploiement iFIND pour: $CLIENT_NAME ==="
log "VPS: ${SSH_USER}@${HOST}:${SSH_PORT}"
log "Domaine: $DOMAIN"
log "Bot Token: ${BOT_TOKEN:0:10}..."
log "Admin Chat ID: $ADMIN_CHAT_ID"
echo ""

# === Test connexion SSH ===
log "Test connexion SSH..."
if ! $SSH_CMD "echo OK" >/dev/null 2>&1; then
  err "Impossible de se connecter a ${SSH_USER}@${HOST}:${SSH_PORT}"
  err "Verifiez l'IP, le port et les identifiants SSH"
  exit 1
fi
log "Connexion SSH OK"

# === Generer le .env ===
GATEWAY_TOKEN=$(openssl rand -hex 24)
WEBHOOK_SECRET=$(openssl rand -hex 24)

ENV_CONTENT="# --- iFIND Bot - Instance: $CLIENT_NAME ---
# Genere le $(date -u '+%Y-%m-%d %H:%M UTC')

# --- Chemins ---
OPENCLAW_CONFIG_DIR=/opt/ifind/config
OPENCLAW_WORKSPACE_DIR=/opt/ifind/workspace

# --- OpenClaw ---
OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}

# --- Telegram ---
TELEGRAM_BOT_TOKEN=${BOT_TOKEN}

# --- API Keys ---
OPENAI_API_KEY=${OPENAI_KEY}
APOLLO_API_KEY=${APOLLO_KEY}
FULLENRICH_API_KEY=${FULLENRICH_KEY}
HUBSPOT_API_KEY=${HUBSPOT_KEY}

# --- AutoMailer ---
CLAUDE_API_KEY=${CLAUDE_KEY}
SENDGRID_API_KEY=
RESEND_API_KEY=${RESEND_KEY}
SENDER_EMAIL=${SENDER_EMAIL}

# --- Budget API ---
API_DAILY_BUDGET=${DAILY_BUDGET}

# --- Webhook ---
RESEND_WEBHOOK_SECRET=${WEBHOOK_SECRET}

# --- Dashboard ---
DASHBOARD_PASSWORD=${DASHBOARD_PASS}
DASHBOARD_OWNER=${CLIENT_NAME}

# --- Admin ---
ADMIN_CHAT_ID=${ADMIN_CHAT_ID}

# --- IMAP (optionnel) ---
IMAP_HOST=
IMAP_PORT=993
IMAP_USER=
IMAP_PASS=

# --- Cal.com (optionnel) ---
CALCOM_API_KEY=
"

# === Script d'installation remote ===
REMOTE_SCRIPT='#!/bin/bash
set -euo pipefail

echo ">>> [1/7] Mise a jour systeme..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo ">>> [2/7] Installation Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  echo "Docker deja installe"
fi

echo ">>> [3/7] Installation Docker Compose plugin..."
if ! docker compose version &>/dev/null; then
  apt-get install -y -qq docker-compose-plugin
fi

echo ">>> [4/7] Installation Nginx + Certbot + fail2ban..."
apt-get install -y -qq nginx certbot python3-certbot-nginx fail2ban git

echo ">>> [5/7] Clone du repo iFIND..."
REPO_DIR="/opt/ifind"
if [[ -d "$REPO_DIR" ]]; then
  echo "Repo deja present, mise a jour..."
  cd "$REPO_DIR" && git pull --ff-only
else
  git clone https://github.com/benieralexis-sudo/openclaw.git "$REPO_DIR"
fi

echo ">>> [6/7] Build Docker image..."
cd "$REPO_DIR"
docker build -t openclaw:local .

echo ">>> [7/7] Creation du volume app-config..."
docker volume create moltbot_app-config-data 2>/dev/null || true

echo ">>> Installation terminee!"
'

# === Nginx config ===
NGINX_CONF="server {
    server_name ${DOMAIN};

    server_tokens off;
    client_max_body_size 1m;

    # Security headers
    add_header X-Frame-Options \"DENY\" always;
    add_header X-Content-Type-Options \"nosniff\" always;
    add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;
    add_header Permissions-Policy \"camera=(), microphone=(), geolocation=()\" always;
    add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;

    # Resend webhook
    location /webhook/resend {
        limit_except POST { deny all; }
        proxy_pass http://127.0.0.1:9090/webhook/resend;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_set_header Content-Type \\\$content_type;
    }

    # Dashboard
    location /dashboard/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }

    # Landing page API
    location /api/ {
        proxy_pass http://127.0.0.1:3080/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }

    # Block internal API
    location /api/prospect/ {
        return 403;
    }

    # Landing page
    location / {
        proxy_pass http://127.0.0.1:3080/;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }

    listen 80;
}"

# === Fail2ban config ===
FAIL2BAN_CONF='[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600
findtime = 600
'

# =============================================
# EXECUTION REMOTE
# =============================================

log "=== Phase 1: Installation systeme ==="
echo "$REMOTE_SCRIPT" | $SSH_CMD "bash"

log "=== Phase 2: Envoi .env ==="
echo "$ENV_CONTENT" | $SSH_CMD "cat > /opt/ifind/.env && chmod 600 /opt/ifind/.env"
log ".env configure"

log "=== Phase 3: Configuration Nginx ==="
echo "$NGINX_CONF" | $SSH_CMD "cat > /etc/nginx/sites-available/ifind-client"
$SSH_CMD "ln -sf /etc/nginx/sites-available/ifind-client /etc/nginx/sites-enabled/ && rm -f /etc/nginx/sites-enabled/default && nginx -t && systemctl reload nginx"
log "Nginx configure pour $DOMAIN"

if [[ "$SKIP_SSL" != "true" ]]; then
  log "=== Phase 4: SSL/Let's Encrypt ==="
  $SSH_CMD "certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --email ${SENDER_EMAIL} --redirect" || {
    warn "Certbot a echoue — le DNS de $DOMAIN pointe-t-il vers $HOST ?"
    warn "Vous pouvez relancer plus tard: certbot --nginx -d $DOMAIN"
  }
fi

log "=== Phase 5: Fail2ban ==="
echo "$FAIL2BAN_CONF" | $SSH_CMD "cat > /etc/fail2ban/jail.local && systemctl enable fail2ban && systemctl restart fail2ban"

log "=== Phase 6: Demarrage containers ==="
$SSH_CMD "cd /opt/ifind && docker compose down 2>/dev/null; docker compose up -d"
log "Containers demarre"

# Attendre le healthcheck
log "Attente healthcheck (30s)..."
sleep 30

HEALTH=$($SSH_CMD "curl -sf http://127.0.0.1:9090/health 2>/dev/null || echo FAIL")
if echo "$HEALTH" | grep -q "ok\|healthy\|status"; then
  log "Healthcheck OK!"
else
  warn "Healthcheck incertain — verifiez avec: ssh ${SSH_USER}@${HOST} 'docker compose -f /opt/ifind/docker-compose.yml logs --tail=50'"
fi

# === Recapitulatif ===
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   DEPLOIEMENT TERMINE !${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "Client:       ${BLUE}$CLIENT_NAME${NC}"
echo -e "VPS:          ${BLUE}$HOST${NC}"
echo -e "Domaine:      ${BLUE}https://$DOMAIN${NC}"
echo -e "Dashboard:    ${BLUE}https://$DOMAIN/dashboard/${NC}"
echo -e "Mot de passe: ${BLUE}$DASHBOARD_PASS${NC}"
echo -e "Bot Telegram: ${BLUE}${BOT_TOKEN:0:10}...${NC}"
echo -e "Email envoi:  ${BLUE}$SENDER_EMAIL${NC}"
echo -e "Budget/jour:  ${BLUE}${DAILY_BUDGET}\$${NC}"
echo ""
echo -e "${YELLOW}Actions restantes:${NC}"
echo "  1. Verifier que le DNS de $DOMAIN pointe vers $HOST"
echo "  2. Configurer le domaine Resend pour $DOMAIN"
echo "  3. Configurer le webhook Resend: https://$DOMAIN/webhook/resend"
echo "  4. Tester le bot Telegram en envoyant /start"
echo "  5. (Optionnel) Configurer IMAP dans le .env pour l'Inbox Manager"
echo "  6. (Optionnel) Configurer Cal.com dans le .env pour le Meeting Scheduler"
echo ""

# Sauvegarder les infos client dans un log local
DEPLOY_LOG="/opt/moltbot/deploy/clients.log"
echo "[$(date -u '+%Y-%m-%d %H:%M UTC')] $CLIENT_NAME | $HOST | $DOMAIN | chat:$ADMIN_CHAT_ID | email:$SENDER_EMAIL" >> "$DEPLOY_LOG"
log "Info client sauvegardee dans $DEPLOY_LOG"
