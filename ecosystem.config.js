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
// =============================================================================
const path = require('path');

const APP_DIR = '/var/www/travel-plan-assistant';

module.exports = {
  apps: [
    {
      name: 'tpa',
      // Standalone entry produced by `next build` with output: 'standalone'.
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
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '127.0.0.1',
      },
    },
  ],
};
