#!/bin/bash
# =====================================================
# iFIND — Script de deploiement nouveau client
# Usage : ./deploy-client.sh
# Deploie une instance complete sur un VPS Hetzner
# =====================================================

set -e

echo "========================================="
echo "  iFIND — Deploiement nouveau client"
echo "========================================="
echo ""

# --- 1. Infos client ---
read -p "Nom du client (ex: digidemat) : " CLIENT_NAME
read -p "Domaine client (ex: digidemat.fr) : " CLIENT_DOMAIN
read -p "Nom expediteur (ex: Jean Dupont) : " SENDER_FULL_NAME
read -p "Prenom expediteur (ex: Jean) : " SENDER_NAME
read -p "Titre expediteur (ex: CEO) : " SENDER_TITLE
read -p "Email d'envoi (ex: jean@digidemat.fr) : " SENDER_EMAIL
read -p "Email reply-to (ex: jean@digidemat.fr) : " REPLY_TO_EMAIL
read -p "Description activite (ex: solutions de dematerialisation) : " CLIENT_DESCRIPTION
echo ""

# --- 2. Mailboxes ---
echo "Mailboxes Gmail (SMTP) :"
read -p "  Email 1 : " GMAIL_USER_1
read -s -p "  Mot de passe app 1 : " GMAIL_PASS_1
echo ""
read -p "  Email 2 (vide si 1 seule) : " GMAIL_USER_2
if [ -n "$GMAIL_USER_2" ]; then
  read -s -p "  Mot de passe app 2 : " GMAIL_PASS_2
  echo ""
  GMAIL_MAILBOXES="${GMAIL_USER_1}:${GMAIL_PASS_1},${GMAIL_USER_2}:${GMAIL_PASS_2}"
else
  GMAIL_MAILBOXES="${GMAIL_USER_1}:${GMAIL_PASS_1}"
fi

# --- 3. Telegram ---
read -p "Telegram Bot Token (nouveau bot via @BotFather) : " TG_BOT_TOKEN
read -p "Telegram Chat ID du client : " TG_CHAT_ID

# --- 4. CRM ---
read -p "HubSpot API Key (vide si pas de HubSpot) : " HUBSPOT_KEY

# --- 5. Calendrier ---
read -p "Cal.com/Cal.eu API Key (vide si pas de calendrier) : " CALCOM_KEY
read -p "Cal.com username (ex: jean-dupont) : " CALCOM_USER
read -p "Cal.com event slug (ex: 30min) : " CALCOM_SLUG

# --- 6. IMAP ---
read -p "IMAP Host (ex: imap.gmail.com) : " IMAP_HOST_VAL
read -p "IMAP User (ex: jean@digidemat.fr) : " IMAP_USER_VAL
read -s -p "IMAP Password : " IMAP_PASS_VAL
echo ""

# --- 7. API Keys (tes cles partagees) ---
echo ""
echo "--- API Keys (tes cles, deja pre-remplies) ---"
read -p "OpenAI API Key : " OPENAI_KEY
read -p "Claude API Key : " CLAUDE_KEY
read -p "Apollo API Key : " APOLLO_KEY
read -p "FullEnrich API Key (vide si pas utilise) : " FULLENRICH_KEY
read -p "Resend API Key (vide si Gmail SMTP) : " RESEND_KEY

# --- 8. Limites ---
read -p "Budget API quotidien en $ (defaut: 2) : " API_BUDGET
API_BUDGET=${API_BUDGET:-2}

# --- 9. Dashboard ---
DASHBOARD_PASS=$(openssl rand -base64 16)
echo ""
echo "Mot de passe dashboard genere : $DASHBOARD_PASS"

# --- 10. IP du VPS ---
read -p "IP du VPS Hetzner : " VPS_IP
read -p "User SSH (defaut: root) : " SSH_USER
SSH_USER=${SSH_USER:-root}

echo ""
echo "========================================="
echo "  Deploiement sur $VPS_IP..."
echo "========================================="

# --- Generer le .env ---
ENV_FILE="/tmp/.env.${CLIENT_NAME}"
cat > "$ENV_FILE" << ENVEOF
# iFIND — Instance ${CLIENT_NAME}
# Genere le $(date +%Y-%m-%d)

# Telegram
TELEGRAM_BOT_TOKEN=${TG_BOT_TOKEN}
ADMIN_CHAT_ID=${TG_CHAT_ID}

# API Keys
OPENAI_API_KEY=${OPENAI_KEY}
CLAUDE_API_KEY=${CLAUDE_KEY}
APOLLO_API_KEY=${APOLLO_KEY}
FULLENRICH_API_KEY=${FULLENRICH_KEY}
RESEND_API_KEY=${RESEND_KEY}

# Email
SENDER_EMAIL=${SENDER_EMAIL}
REPLY_TO_EMAIL=${REPLY_TO_EMAIL}
SENDER_NAME=${SENDER_NAME}
SENDER_FULL_NAME=${SENDER_FULL_NAME}
SENDER_TITLE=${SENDER_TITLE}
CLIENT_NAME=${CLIENT_NAME}
CLIENT_DOMAIN=${CLIENT_DOMAIN}
CLIENT_DESCRIPTION=${CLIENT_DESCRIPTION}

# Gmail SMTP
GMAIL_SMTP_ENABLED=true
GMAIL_SMTP_USER=${GMAIL_USER_1}
GMAIL_SMTP_PASS=${GMAIL_PASS_1}
GMAIL_MAILBOXES=${GMAIL_MAILBOXES}

# IMAP
IMAP_HOST=${IMAP_HOST_VAL}
IMAP_PORT=993
IMAP_USER=${IMAP_USER_VAL}
IMAP_PASS=${IMAP_PASS_VAL}

# CRM
HUBSPOT_API_KEY=${HUBSPOT_KEY}

# Calendrier
CALCOM_API_KEY=${CALCOM_KEY}
CALCOM_USERNAME=${CALCOM_USER}
CALCOM_EVENT_SLUG=${CALCOM_SLUG}

# Dashboard
DASHBOARD_PASSWORD=${DASHBOARD_PASS}
DASHBOARD_OWNER=${SENDER_FULL_NAME}

# Limites
API_DAILY_BUDGET=${API_BUDGET}
ENVEOF

echo "[1/5] .env genere"

# --- Deployer sur le VPS ---
ssh ${SSH_USER}@${VPS_IP} << 'SSHEOF'
# Installer Docker si pas present
if ! command -v docker &> /dev/null; then
  echo "[2/5] Installation Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  echo "[2/5] Docker deja installe"
fi

# Installer git si pas present
apt-get update -qq && apt-get install -y -qq git > /dev/null 2>&1

# Cloner le repo
echo "[3/5] Clone du repo..."
mkdir -p /opt/moltbot
cd /opt/moltbot
if [ -d ".git" ]; then
  git pull origin main
else
  git clone https://github.com/benieralexis-sudo/openclaw.git .
fi

# Creer le volume externe
docker volume create moltbot_app-config-data 2>/dev/null || true

echo "[3/5] Repo pret"
SSHEOF

# Copier le .env
echo "[4/5] Copie du .env..."
scp "$ENV_FILE" ${SSH_USER}@${VPS_IP}:/opt/moltbot/.env

# Lancer le bot
echo "[5/5] Lancement du bot..."
ssh ${SSH_USER}@${VPS_IP} << 'SSHEOF'
cd /opt/moltbot
docker compose up -d --build
echo ""
echo "Attente demarrage (30s)..."
sleep 30
docker compose ps
docker compose logs --tail 5 telegram-router
SSHEOF

# Nettoyage
rm -f "$ENV_FILE"

echo ""
echo "========================================="
echo "  DEPLOIEMENT TERMINE"
echo "========================================="
echo ""
echo "  Client     : ${CLIENT_NAME}"
echo "  VPS        : ${VPS_IP}"
echo "  Dashboard  : http://${VPS_IP}:3000"
echo "  Mdp dash   : ${DASHBOARD_PASS}"
echo "  Telegram   : Bot actif"
echo "  Budget API : ${API_BUDGET}$/jour"
echo ""
echo "  Prochaine etape :"
echo "  1. Configurer nginx + HTTPS sur le VPS"
echo "  2. Configurer le ciblage Apollo (industries, titres, geo)"
echo "  3. Envoyer les 5-10 emails de test"
echo ""
echo "========================================="
