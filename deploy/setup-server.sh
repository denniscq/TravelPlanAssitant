#!/usr/bin/env bash
# =============================================================================
# setup-server.sh - Idempotent bootstrap for the Aliyun lightweight server.
#
# What it installs / configures:
#   - Node.js 20 LTS (NodeSource) + npm
#   - PM2 (global) with systemd startup integration for the `deploy` user
#   - Nginx (systemd enabled)
#   - Certbot (Let's Encrypt client)
#   - `deploy` user with an empty SSH authorized_keys (paste your pubkey after)
#   - /var/www/travel-plan-assistant owned by `deploy`
#   - /var/www/travel-plan-assistant/logs (LOG_DIR contract, writable by deploy)
#
# Usage:
#   sudo bash deploy/setup-server.sh
#
# Idempotent: safe to run multiple times.
# =============================================================================
set -euo pipefail

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${APP_DIR:-/var/www/travel-plan-assistant}"
REPO_URL="${REPO_URL:-https://github.com/denniscq/TravelPlanAssitant.git}"
NODE_MAJOR="20"

log() {
  printf '\033[1;34m[setup]\033[0m %s\n' "$*"
}

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Please run as root: sudo bash $0" >&2
    exit 1
  fi
}

# -----------------------------------------------------------------------------
# 1. System packages + Node.js 20 LTS
# -----------------------------------------------------------------------------
install_node() {
  log "Installing Node.js ${NODE_MAJOR} LTS (NodeSource)..."

  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  fi

  apt-get install -y nodejs

  log "node: $(node --version), npm: $(npm --version)"
}

install_system_packages() {
  log "Updating apt and installing base packages..."

  apt-get update
  apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    build-essential \
    nginx \
    certbot \
    python3-certbot-nginx
}

# -----------------------------------------------------------------------------
# 2. PM2 (global)
# -----------------------------------------------------------------------------
install_pm2() {
  log "Installing PM2 globally..."

  if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2
  else
    log "PM2 already present: $(pm2 --version)"
  fi
}

# -----------------------------------------------------------------------------
# 3. `deploy` user
# -----------------------------------------------------------------------------
create_deploy_user() {
  log "Ensuring user '${DEPLOY_USER}' exists..."

  if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
    log "Created user '${DEPLOY_USER}'"
  fi

  mkdir -p "/home/${DEPLOY_USER}/.ssh"
  touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  chmod 700 "/home/${DEPLOY_USER}/.ssh"
  chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"

  log "SSH authorized_keys ready at /home/${DEPLOY_USER}/.ssh/authorized_keys"
  log "  -> Paste your public key there (then: chown deploy: /home/deploy/.ssh/*)"
}

# -----------------------------------------------------------------------------
# 4. App directory + logs
# -----------------------------------------------------------------------------
prepare_app_dir() {
  log "Preparing ${APP_DIR} ..."

  mkdir -p "${APP_DIR}"
  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}"

  # LOG_DIR contract (server-logging): default logs/ writable by deploy
  mkdir -p "${APP_DIR}/logs"
  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}/logs"

  # First-time clone (subsequent updates happen via GitOps / deploy.sh)
  if [[ ! -d "${APP_DIR}/.git" ]]; then
    log "Cloning repository into ${APP_DIR} ..."
    sudo -u "${DEPLOY_USER}" git clone "${REPO_URL}" "${APP_DIR}"
  else
    log "Repository already present; skipping clone"
  fi
}

# -----------------------------------------------------------------------------
# 5. Nginx service enabled
# -----------------------------------------------------------------------------
enable_nginx() {
  log "Enabling Nginx service..."

  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl restart nginx || true
}

# -----------------------------------------------------------------------------
# 6. Summary
# -----------------------------------------------------------------------------
print_summary() {
  cat <<EOF

========================================================
  Server bootstrap complete.
========================================================
  1. Paste your SSH public key:
       nano /home/${DEPLOY_USER}/.ssh/authorized_keys

  2. From your local machine, verify SSH:
       ssh -i <your-private-key> ${DEPLOY_USER}@<SERVER_PUBLIC_IP>

  3. Configure environment on the server:
       cd ${APP_DIR}
       cp .env.example .env.local
       nano .env.local        # fill AMAP / LLM keys

  4. First manual deploy:
       sudo -u ${DEPLOY_USER} bash ${APP_DIR}/deploy/deploy.sh

  5. Then configure Nginx (template: deploy/nginx-tpa.conf):
       cp ${APP_DIR}/deploy/nginx-tpa.conf /etc/nginx/sites-available/tpa
       sed -i 's/YOUR_DOMAIN/your-domain.com/g' /etc/nginx/sites-available/tpa
       ln -s /etc/nginx/sites-available/tpa /etc/nginx/sites-enabled/
       nginx -t && systemctl reload nginx

  6. NOTE: Do NOT open ports 80/443 until ICP filing is approved.
========================================================
EOF
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
  need_root
  install_system_packages
  install_node
  install_pm2
  create_deploy_user
  prepare_app_dir
  enable_nginx
  print_summary
}

main "$@"
