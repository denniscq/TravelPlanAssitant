#!/usr/bin/env bash
# =============================================================================
# deploy.sh - Pull latest main and hot-reload the PM2 cluster.
#
# Used by:
#   - GitHub Actions (via appleboy/ssh-action)  -> CI/CD GitOps
#   - Manual first deploy on the server          -> `bash deploy/deploy.sh`
#
# Design notes:
#   - Runs as the `deploy` user (owns /var/www/travel-plan-assistant).
#   - `git reset --hard origin/main` is safe here: the server directory is a
#     pure deployment target and .env.local is gitignored, so it survives.
#   - `pm2 reload` is zero-downtime (starts new workers before killing old).
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/travel-plan-assistant}"
BRANCH="${BRANCH:-main}"
PM2_APP_NAME="${PM2_APP_NAME:-tpa}"

log() {
  printf '\033[1;32m[deploy]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[deploy]\033[0m ERROR: %s\n' "$*" >&2
  exit 1
}

# -----------------------------------------------------------------------------
# 0. Sanity checks
# -----------------------------------------------------------------------------
if [[ ! -d "${APP_DIR}/.git" ]]; then
  fail "No git repository at ${APP_DIR}. Run setup-server.sh first (or clone the repo)."
fi

if ! command -v pm2 >/dev/null 2>&1; then
  fail "pm2 not found in PATH. Install it globally: npm install -g pm2"
fi

# -----------------------------------------------------------------------------
# 1. Pull latest code
# -----------------------------------------------------------------------------
log "Pulling origin/${BRANCH} into ${APP_DIR} ..."
cd "${APP_DIR}"
git fetch origin "${BRANCH}"
git reset --hard "origin/${BRANCH}"

# -----------------------------------------------------------------------------
# 2. Install dependencies
# -----------------------------------------------------------------------------
log "Installing dependencies (npm ci) ..."
npm ci

# -----------------------------------------------------------------------------
# 3. Build
# -----------------------------------------------------------------------------
log "Building production bundle (next build) ..."
npm run build

# -----------------------------------------------------------------------------
# 4. Start or reload the PM2 cluster
# -----------------------------------------------------------------------------
log "Ensuring PM2 app '${PM2_APP_NAME}' is running ..."
# `pm2 id <name>` prints "[]" when the app does not exist, yet exits 0.
# Compare the trimmed output to detect absence reliably.
PM2_ID=$(pm2 id "${PM2_APP_NAME}" 2>/dev/null | tr -d '[:space:]')
if [[ "${PM2_ID}" != "[]" && -n "${PM2_ID}" ]]; then
  log "Reloading PM2 app '${PM2_APP_NAME}' (zero downtime) ..."
  pm2 reload "${PM2_APP_NAME}" --update-env
else
  log "Starting PM2 app '${PM2_APP_NAME}' from ecosystem.config.js ..."
  pm2 start ecosystem.config.js
fi
pm2 save

# -----------------------------------------------------------------------------
# 5. Post-deploy health check
# -----------------------------------------------------------------------------
log "Health check (http://127.0.0.1:3000) ..."
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 || true)
if [[ "${HTTP_CODE}" =~ ^[23] ]]; then
  log "OK - application responded with HTTP ${HTTP_CODE}"
else
  fail "Health check failed: HTTP ${HTTP_CODE}. Check: pm2 logs ${PM2_APP_NAME}"
fi

log "Deploy complete."
