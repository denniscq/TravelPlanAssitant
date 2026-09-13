// =============================================================================
// PM2 process configuration for TravelPlanAssistant (Next.js 14 standalone).
//
// Start / reload:
//   pm2 start ecosystem.config.js        (first start)
//   pm2 reload tpa --update-env          (zero-downtime reload, used by deploy.sh)
//   pm2 status
//
// Design notes:
//   - next.config.js enables `output: 'standalone'`, which produces a
//     self-contained `.next/standalone/server.js` that bundles only the runtime
//     files needed (smaller image, faster cold start).
//   - `next start` is incompatible with `output: standalone` (Next.js will
//     warn and exit). We must launch the standalone entry instead.
//   - PM2 `cluster` mode forks worker processes via Node's `cluster` module,
//     which conflicts with the standalone server's built-in HTTP listener
//     (single-port binding). We use `fork` mode with `instances: 1`.
//   - For multi-core utilization on a 2 vCPU machine, scale horizontally
//     later via PM2 load balancing or run a second instance on another port.
//   - HOSTNAME: 127.0.0.1 keeps Next.js off the public interface; Nginx is
//     the only ingress (see deploy/nginx-tpa.conf).
//   - .env.local is parsed manually here (KEY=VALUE per line) and merged into
//     `env` because PM2's built-in `env_file` field has been observed to be
//     silently ignored in some configurations (env vars not appearing in
//     `pm2 env <id>` despite the field being present). Reading + spreading
//     here removes that ambiguity and works on every PM2 version.
// =============================================================================
const path = require('path');
const fs = require('fs');

const APP_DIR = '/var/www/travel-plan-assistant';

/**
 * Minimal .env parser: KEY=VALUE per line, ignoring blanks and # comments.
 * Strips surrounding quotes from values. Does NOT support multi-line values.
 *
 * @param {string} filePath absolute path to the env file
 * @returns {Record<string, string>}
 */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    // Surface this loudly so deploy.sh doesn't silently start with empty env.
    throw new Error(`parseEnvFile: file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding single or double quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

// Load .env.local at config-load time so the values are baked into PM2 env.
const envFromFile = parseEnvFile(path.join(APP_DIR, '.env.local'));

module.exports = {
  apps: [
    {
      name: 'tpa',
      // Standalone entry produced by `next build` with `output: 'standalone'`.
      // This file already inlines a minimal HTTP server on PORT/HOSTNAME.
      script: path.join(APP_DIR, '.next/standalone/server.js'),
      cwd: APP_DIR,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1024M',
      autorestart: true,
      listen_timeout: 30000,
      kill_timeout: 10000,
      out_file: path.join(APP_DIR, 'logs/tpa-out.log'),
      error_file: path.join(APP_DIR, 'logs/tpa-err.log'),
      merge_logs: true,
      time: true,
      env: {
        // Spread first, so explicit production overrides take precedence.
        ...envFromFile,
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '127.0.0.1',
      },
    },
  ],
};
