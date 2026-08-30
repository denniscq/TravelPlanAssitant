// =============================================================================
// PM2 cluster configuration for TravelPlanAssistant (Next.js 14 standalone).
//
// Start / reload:
//   pm2 start ecosystem.config.js        (first start)
//   pm2 reload tpa --update-env          (zero-downtime reload, used by deploy.sh)
//   pm2 status
//
// Design notes:
//   - exec_mode: 'cluster' requires a real Node.js entry script; `npm` is a
//     shell wrapper and cannot be forked by Node's cluster module. We point
//     directly at the `next` binary (official Next.js PM2 approach).
//   - instances: 2 matches the 2 vCPU lightweight server.
//   - HOSTNAME: 127.0.0.1 keeps Next.js off the public interface; Nginx is
//     the only ingress (see deploy/nginx-tpa.conf).
// =============================================================================
module.exports = {
  apps: [
    {
      name: 'tpa',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: '/var/www/travel-plan-assistant',
      instances: 1,
      exec_mode: 'cluster',
      max_memory_restart: '1024M',
      autorestart: true,
      listen_timeout: 30000,
      kill_timeout: 10000,
      out_file: '/var/www/travel-plan-assistant/logs/tpa-out.log',
      error_file: '/var/www/travel-plan-assistant/logs/tpa-err.log',
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
