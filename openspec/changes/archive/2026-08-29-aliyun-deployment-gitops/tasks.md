# Tasks: aliyun-deployment-gitops

执行顺序按依赖：先服务器初始化脚本，再 PM2/Nginx 配置，再 GitOps 流水线，再完整部署文档，最后验证。

## 1. 服务器初始化脚本

- [ ] 1.1 创建 `deploy/setup-server.sh`（幂等）：
  - [ ] 1.2 安装 Node.js 20 LTS（NodeSource 源，含 `curl -fsSL ... | sudo bash` + `apt install nodejs`）
  - [ ] 1.3 全局安装 PM2（`npm i -g pm2`）
  - [ ] 1.4 安装 Nginx（`apt install nginx`）+ 启用 nginx 服务
  - [ ] 1.5 安装 Certbot（`apt install certbot python3-certbot-nginx`）
  - [ ] 1.6 创建 `deploy` 用户（若不存在）+ 建 `~/.ssh/authorized_keys`
  - [ ] 1.7 创建应用目录 `/var/www/travel-plan-assistant` 并 `chown deploy:`
  - [ ] 1.8 创建 `logs/` 目录并赋予 deploy 用户写权限（`LOG_DIR` 契约，见 server-logging）
  - [ ] 1.9 脚本通过 `bash -n deploy/setup-server.sh` 语法校验

## 2. PM2 集群配置

- [ ] 2.1 创建仓库根 `ecosystem.config.js`：
  - [ ] 2.2 `name: 'tpa'`，`script: 'node_modules/next/dist/bin/next'`，`args: 'start'`
  - [ ] 2.3 `exec_mode: 'cluster'`，`instances: 2`，`max_memory_restart: '512M'`
  - [ ] 2.4 `env: { NODE_ENV: 'production', PORT: 3000, HOSTNAME: '127.0.0.1' }`
- [ ] 2.5 验证：`node -e "require('./ecosystem.config.js')"` 无报错且 `apps[0].instances === 2`

## 3. Nginx 站点模板

- [ ] 3.1 创建 `deploy/nginx-tpa.conf`：
  - [ ] 3.2 `upstream nextjs_upstream { server 127.0.0.1:3000; keepalive 64; }`
  - [ ] 3.3 port 80 server：`server_name YOUR_DOMAIN www.YOUR_DOMAIN` + 301 → https
  - [ ] 3.4 port 443 server：SSL 证书路径（`/etc/letsencrypt/live/YOUR_DOMAIN/...`）
  - [ ] 3.5 gzip on + types
  - [ ] 3.6 `location /_next/static/`：`expires 1y` + immutable
  - [ ] 3.7 `location /`：透传 `X-Forwarded-For`/`X-Real-IP`/`Host`/`X-Forwarded-Proto`，`proxy_read_timeout 90s`，`proxy_buffering off`
  - [ ] 3.8 含占位符 `YOUR_DOMAIN`，文档中说明替换为真实域名

## 4. GitOps 流水线

- [ ] 4.1 创建 `.github/workflows/deploy.yml`：
  - [ ] 4.2 `on: push: branches: [main]`
  - [ ] 4.3 `concurrency` group + `cancel-in-progress: false`
  - [ ] 4.4 `permissions: contents: read`
  - [ ] 4.5 job `test-and-build`：checkout → setup-node(20, cache) → `npm ci` → `npm test` → `npx tsc --noEmit` → `npm run build`
  - [ ] 4.6 job `deploy`：`needs: test-and-build`，用 `appleboy/ssh-action` 调 `deploy/deploy.sh`
- [ ] 4.7 创建 `deploy/deploy.sh`：
  - [ ] 4.8 `set -e`；`cd /var/www/travel-plan-assistant`
  - [ ] 4.9 `git fetch origin main` + `git reset --hard origin/main`
  - [ ] 4.10 `npm ci` + `npm run build`
  - [ ] 4.11 `pm2 reload tpa --update-env || pm2 start ecosystem.config.js` + `pm2 save`
  - [ ] 4.12 支持手动执行（不依赖 GitHub 环境）
- [ ] 4.13 校验：`bash -n deploy/deploy.sh` + workflow YAML 语法校验（`npx actionlint` 或等价）

## 5. 完整部署文档

- [ ] 5.1 创建 `docs/deployment-aliyun.md`（主交付物，中文，可从头照做）：
  - [ ] 5.2 前置：费用清单、所需账号/Key 清单、整体架构图
  - [ ] 5.3 Phase 0：服务器初始化（跑 setup-server.sh）+ 手工首次部署 + `curl http://IP:3000` 验证（IP 直连）
  - [ ] 5.4 Phase 1：域名购买 + 实名 + 个人 ICP 备案全流程（阿里云备案系统步骤、管局审核 7-20 天、短信核验、公安备案 30 天内）
  - [ ] 5.5 Phase 2：备案通过后 DNS A/CNAME 配置、打开 80/443、certbot 签发 SSL、备案号展示
  - [ ] 5.6 Phase 3：GitHub Secrets 配置（ALIYUN_HOST/ALIYUN_USER/ALIYUN_SSH_KEY 生成步骤）、push main 触发验证
  - [ ] 5.7 附录：Nginx 配置替换占位符说明、`logs/` 目录说明、故障排查表（备案不通过 / 流量被刷 / 证书续期 / PM2 状态检查）

## 6. 验证

- [ ] 6.1 `bash -n deploy/setup-server.sh`、`bash -n deploy/deploy.sh` 均通过
- [ ] 6.2 `node -e "require('./ecosystem.config.js')"` 通过
- [ ] 6.3 workflow YAML 可被 GitHub Actions 解析（`npx actionlint` 0 errors）
- [ ] 6.4 本地 `npm test`（123 tests）+ `npx tsc --noEmit` + `npm run build` 全绿（确认 CI 门禁脚本在本地等价可复现）
- [ ] 6.5 文档步骤与落地文件交叉核对：每个脚本/配置都在文档对应章节有出处

## 7. Memory + 归档

- [ ] 7.1 更新 `.superpowers-memory/DECISIONS.md`：新增 `decision-2026-08-29-aliyun-deployment-gitops`（PM2 cluster 入口选择、deploy 用户、备案门禁时序、env 不进 git）
- [ ] 7.2 更新 `.superpowers-memory/CURRENT_STATE.md`：记录部署配置落地完成
- [ ] 7.3 更新 `.superpowers-memory/PROJECT_CONTEXT.md`：新增 durable fact（生产拓扑：Nginx + PM2 cluster + GitOps）
- [ ] 7.4 在 `.superpowers-memory/session-journal/` 添加本次会话日志
- [ ] 7.5 运行 `npx openspec validate --change 2026-08-29-aliyun-deployment-gitops` 通过
- [ ] 7.6 归档：`npx openspec archive 2026-08-29-aliyun-deployment-gitops`
