## Why

项目一期功能已交付（11 测试文件 / 123 tests，build 通过），但生产环境仍依赖 Vercel（`*.vercel.app`）。用户希望在中国大陆自有服务器上正式发布：

- 服务器：阿里云轻量应用服务器，**中国大陆地域**，Ubuntu 24.04，全新未配置
- 代码仓库：GitHub（公开，`github.com/denniscq/TravelPlanAssitant`）
- 发布方式：GitOps——main 分支有代码变更自动触发 CI/CD，发布到服务器
- 对外入口：阿里云购买域名 + 个人 ICP 备案，通过自定义域名访问

当前没有任何生产部署配置落地，需要一份可从头执行的完整部署方案 + 仓库内配置文件。

## What Changes

- **新增完整部署文档** `docs/deployment-aliyun.md`：从买服务器到域名备案到 HTTPS 上线的全流程，可逐步照做。
- **新增 GitHub Actions 流水线** `.github/workflows/deploy.yml`：
  - `push` 到 `main` 触发
  - job 1（CI 门禁）：`npm ci` → `npm test`（123 tests）→ `npx tsc --noEmit` → `npm run build`
  - job 2（部署）：SSH 到服务器 → `git fetch/reset` → `npm ci` → `npm run build` → 补齐 standalone 产物 → `pm2 reload`
  - `concurrency` 防止并发部署互相覆盖
- **新增 PM2 集群配置** `ecosystem.config.js`：`exec_mode: cluster`，2 个实例（匹配 2 vCPU），`next start` 入口，端口 3000，`max_memory_restart: 512M`。
- **新增 Nginx 站点模板** `deploy/nginx-tpa.conf`：HTTP→HTTPS 301、SSL 终止、`upstream 127.0.0.1:3000`、gzip、`/_next/static/` 长缓存、透传 `X-Forwarded-For`（本项目 `extractClientIpAddress` 依赖）、`proxy_read_timeout 90s`（对齐 LLM 90s 超时）。
- **新增服务器初始化脚本** `deploy/setup-server.sh`（幂等）：装 Node.js 20（NodeSource）、PM2、Nginx、Certbot；创建 `deploy` 用户；配置 SSH key 目录。
- **新增部署脚本** `deploy/deploy.sh`：供 GitHub Actions 的 ssh-action 调用，也可本地手动执行（`git fetch/reset` + `npm ci` + build + standalone 产物补齐 + `pm2 reload`）。
- **修改 `.gitignore`**：`logs/` 已在 server-log-rotation 中忽略；本 change 不新增忽略项（docs/ 已忽略，主文档放 docs/ 仅本地）。

## Capabilities

### New Capabilities

- `deployment`: 生产部署与运维契约。覆盖：对外入口（Nginx 反代 + SSL，仅 80/443）、应用进程模型（PM2 cluster 2 实例，监听 127.0.0.1:3000）、发布触发（main push → CI 门禁 → SSH 部署）、域名与备案时序（ICP 备案通过前不得开放 80/443）、证书（Let's Encrypt 自动签发与续期）。

### Modified Capabilities

None. 本 change 不修改任何现有应用行为（`ai-route-planning` / `route-calculation` 等均不变），只新增部署运维层契约。

## Impact

- **Affected files（仓库内新增）**：
  - `.github/workflows/deploy.yml` — GitOps 流水线
  - `ecosystem.config.js` — PM2 集群配置
  - `deploy/nginx-tpa.conf` — Nginx 站点模板（含 `YOUR_DOMAIN` 占位符）
  - `deploy/setup-server.sh` — 服务器初始化脚本
  - `deploy/deploy.sh` — 部署脚本
- **Affected files（本地，不入库）**：
  - `docs/deployment-aliyun.md` — 完整部署文档（docs/ 已被 .gitignore 排除）
- **Affected GitHub Secrets**（用户需在仓库配置）：
  - `ALIYUN_HOST`、`ALIYUN_USER`、`ALIYUN_SSH_KEY`
- **Affected runtime behavior**：
  - 生产环境由 Nginx 统一接收流量，Next.js 仅监听内网
  - `.env.local` 不进 git，服务器端手动维护（`git reset --hard` 不影响）
  - `LOG_DIR`（server-log-rotation 引入）默认 `logs/`，需在服务器创建并赋予 deploy 用户写权限
- **Affected systems**：
  - 阿里云轻量服务器（安全组仅开放 22/80/443）
  - 阿里云 DNS + ICP 备案（7-20 天，与部署并行）
  - Let's Encrypt 证书（certbot 自动续期）
