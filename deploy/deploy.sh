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

# ---- Nginx config ---------------------------------------------------------
NGINX_TARGET="${NGINX_TARGET:-/etc/nginx/sites-available/tpa}"
NGINX_ENABLED="${NGINX_ENABLED:-/etc/nginx/sites-enabled/tpa}"

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

# Copy the standalone runtime files Next.js does not auto-bundle.
# All three directories are required for a working standalone deployment:
#   .next/static  -> pre-built JS/CSS chunks (served as immutable assets)
#   .next/server  -> server-side API routes and dynamic page bundles
#   public/       -> user-uploaded static files (favicon, images, etc.)
# Without .next/static: every asset 404s.
# Without .next/server: every API route returns "Cannot find module ... route.js".
# Without public/: /favicon.ico and similar static files 404.
if [[ -d ".next/static" ]]; then
  log "Copying .next/static into standalone bundle ..."
  mkdir -p .next/standalone/.next
  cp -r .next/static .next/standalone/.next/static
fi
if [[ -d ".next/server" ]]; then
  log "Copying .next/server into standalone bundle ..."
  mkdir -p .next/standalone/.next
  cp -r .next/server .next/standalone/.next/server
fi
if [[ -d "public" ]]; then
  log "Copying public/ into standalone bundle ..."
  cp -r public .next/standalone/public
fi

# -----------------------------------------------------------------------------
# 4. Start or reload the PM2 cluster
# -----------------------------------------------------------------------------
log "Ensuring PM2 app '${PM2_APP_NAME}' is running ..."

# PM2 reload semantics:
#   - `pm2 reload` re-runs the app process (zero-downtime) but keeps the
#     daemon's cached parse of ecosystem.config.js. Changes to the JS file
#     itself (new functions, new fields) won't take effect.
#   - `pm2 kill` followed by `pm2 start` reloads everything from scratch.
# We always do a fresh start here to guarantee the new ecosystem.config.js
# is parsed. This costs ~1 second of downtime, which is acceptable for the
# deploy cadence we have.
pm2 kill >/dev/null 2>&1 || true
pm2 start ecosystem.config.js
pm2 save

# -----------------------------------------------------------------------------
# 5. Post-deploy health check
# -----------------------------------------------------------------------------
# `pm2 start` returns as soon as the process is forked; the Next.js standalone
# server still needs a few seconds to bind the port. Poll until it answers,
# up to HEALTH_TIMEOUT seconds, before declaring failure.
# Use explicit comparison (avoid `(( ... ))` arithmetic which can interact
# badly with `set -euo pipefail` on some bash versions).
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
log "Health check (http://127.0.0.1:3000), waiting up to ${HEALTH_TIMEOUT}s ..."

ELAPSED=0
HTTP_CODE="000"
while [[ "${ELAPSED}" -lt "${HEALTH_TIMEOUT}" ]]; do
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 || true)
  if [[ "${HTTP_CODE}" =~ ^[23] ]]; then
    break
  fi
  sleep "${HEALTH_INTERVAL}"
  ELAPSED=$(( ELAPSED + HEALTH_INTERVAL ))
done

if [[ "${HTTP_CODE}" =~ ^[23] ]]; then
  log "OK - application responded with HTTP ${HTTP_CODE} after ${ELAPSED}s"
else
  fail "Health check failed: HTTP ${HTTP_CODE} after ${HEALTH_TIMEOUT}s. Check: pm2 logs ${PM2_APP_NAME}"
fi

# -----------------------------------------------------------------------------
# 6. Sync Nginx configuration (if deploy user has passwordless sudo)
# -----------------------------------------------------------------------------
# The template in the repo uses YOUR_DOMAIN as placeholder. We extract the
# actual domain from the current active config and re-apply the template.
#
# This ensures static files are always served from disk (avoiding 403 on
# stale chunk hashes) and keeps certbot-managed SSL paths intact.
#
# NOTE: This step requires passwordless sudo for nginx/systemctl.
# Run once on the server to enable:
#   sudo bash "${APP_DIR}/deploy/setup-server.sh"
if [[ -f "${NGINX_TARGET}" ]]; then
  if sudo -n true 2>/dev/null; then
    # Extract the primary domain from the existing config
    CURRENT_DOMAIN=$(grep -m1 'server_name' "${NGINX_TARGET}" | sed 's/.*server_name *//;s/ .*//;s/;//')
    if [[ -n "${CURRENT_DOMAIN}" ]]; then
      # Check if the template has changed compared to the active config
      TEMPLATE_HASH=$(sed "s/YOUR_DOMAIN/${CURRENT_DOMAIN}/g" "${APP_DIR}/deploy/nginx-tpa.conf" | md5sum | cut -d' ' -f1)
      ACTIVE_HASH=$(md5sum "${NGINX_TARGET}" | cut -d' ' -f1)

      if [[ "${TEMPLATE_HASH}" != "${ACTIVE_HASH}" ]]; then
        log "Nginx config changed — applying update ..."
        sed "s/YOUR_DOMAIN/${CURRENT_DOMAIN}/g" "${APP_DIR}/deploy/nginx-tpa.conf" | sudo tee "${NGINX_TARGET}" >/dev/null
        if sudo nginx -t 2>&1; then
          sudo systemctl reload nginx
          log "Nginx config applied and reloaded."
        else
          log "WARNING: nginx config test FAILED — restoring previous config."
          # Restore from git: checkout the old template and re-apply
          sudo git -C "${APP_DIR}" checkout HEAD~1 -- deploy/nginx-tpa.conf 2>/dev/null || true
          sed "s/YOUR_DOMAIN/${CURRENT_DOMAIN}/g" "${APP_DIR}/deploy/nginx-tpa.conf" | sudo tee "${NGINX_TARGET}" >/dev/null
          sudo nginx -t && sudo systemctl reload nginx && log "Previous config restored."
        fi
      else
        log "Nginx config unchanged — skipping reload."
      fi
    else
      log "WARNING: Could not extract domain from ${NGINX_TARGET} — skipping nginx sync."
    fi
  else
    log "WARNING: passwordless sudo not available — skipping Nginx config sync."
    log "  To enable, run once on the server: sudo bash ${APP_DIR}/deploy/setup-server.sh"
  fi
fi

log "Deploy complete."
