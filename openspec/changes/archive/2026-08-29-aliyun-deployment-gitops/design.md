# Design: aliyun-deployment-gitops

## Context

完整背景与目标见 proposal.md - Why，以及已确认的 Superpowers 设计文档 [docs/superpowers/specs/2026-08-29-aliyun-deployment-gitops-design.md](file:///c:/Dennis/TravelPlanAssistant/docs/superpowers/specs/2026-08-29-aliyun-deployment-gitops-design.md)。

当前状态：项目 `output: 'standalone'`，无任何生产部署配置。服务器（阿里云轻量、中国大陆地域、Ubuntu 24.04）全新未配置。仓库公开，地址 `github.com/denniscq/TravelPlanAssitant`（注意拼写 Assitant）。

## Goals / Non-Goals

### Goals

- 落地可执行的 GitOps 流水线：main push → CI 门禁 → SSH 部署。
- 落地 PM2 集群（2 实例）+ Nginx 反代的进程与流量模型。
- 提供从零到上线的完整中文部署文档（含 ICP 备案时序）。
- 提供幂等的服务器初始化脚本与部署脚本。

### Non-Goals

- 不搭建数据库/缓存外部服务（本项目 session-only，POI 缓存为进程内存）。
- 不引入 Docker 容器化（单机单应用，PM2 足够；避免额外抽象）。
- 不实现多机水平扩展 / 负载均衡集群（单机场景，Nginx upstream 仅 1 个后端）。
- 不处理 Vercel 迁移的回滚（文档仅记录"从 Vercel 迁移"说明，不提供迁移工具）。

## Decisions

### D1: PM2 集群入口用 `next start` 的二进制，而非 `npm start`

```js
script: 'node_modules/next/dist/bin/next',
args: 'start',
exec_mode: 'cluster',
instances: 2,
```

- 为什么：PM2 cluster 模式要求入口是 Node.js 脚本；`script: 'npm'` 是 shell 包装，cluster 无法 fork（Node cluster 需要真正的 Node worker）。
- 替代方案 A：直接跑 `.next/standalone/server.js`。可行，但需额外 `cp -r .next/static`、`cp -r public` 到 standalone 目录（产物补齐），且 standalone 模式下 `next start` 仍可用。**选择 next start**：官方 PM2 文档路径，构建产物直接由 `npm run build` 产生，无需手动补齐。
- 替代方案 B：`script: 'npm'` + `exec_mode: 'fork'`。牺牲负载均衡，不符用户"集群"诉求。

### D2: `instances: 2` 与 2 vCPU 匹配

- 为什么：PM2 cluster 每实例一个 worker；2 vCPU 上跑 2 个 worker 是 CPU 绑定（CPU-bound）的合理配比。本项目实际是 I/O-bound（LLM/高德等待），2 worker 已够。
- 风险：`max_memory_restart: '512M'` 兜底 Node 内存增长。

### D3: Nginx 只监听 80/443，Next.js 绑定 127.0.0.1:3000

- 为什么：单一对外入口，安全组只需开放 3 个端口；Next.js 不暴露公网，减少攻击面。
- 关键透传：`X-Forwarded-For` 必须透传——本项目 `extractClientIpAddress`（rate limit 的 IP 维度）依赖它。缺失会导致所有请求共享一个 IP 桶。

### D4: CI 在 GitHub 上跑，构建在服务器上跑（不传构建产物）

- 为什么：CI 门禁（test/tsc/build）在 runner 上验证代码质量；服务器上再 build 一次产出真实产物。不采用"CI 构建 + rsync .next"方案，避免 standalone 路径与服务器 Node 版本不一致的兼容风险。
- 代价：服务器每次部署多一次 `npm ci` + build（约 1-2 分钟），可接受。

### D5: 部署用户用专用 `deploy`，禁用 root + 密码登录

- 为什么：个人服务器上 root 直连 + 密码登录是最大安全隐患；SSH key + 专用用户是 GitOps 的标准姿态。
- 权限模型：`deploy` 拥有 `/var/www/travel-plan-assistant`；PM2 以 deploy 运行（`pm2 startup` 生成 systemd 单元）；Nginx/Certbot 以 root 运行（读应用文件，world-readable 即可）。

### D6: 备案通过前不得开放 80/443

- 为什么：ICP 备案要求网站处于不可访问状态（管局会抽查）；且未备案域名解析到境内服务器会被拦截/封禁。
- 时序：Phase 0（服务器初始化 + IP 直连验证）可先做；80/443 端口在备案通过后再开放；Let's Encrypt 证书也必须在域名可解析后签发。

### D7: `.env.local` 服务器端手工维护，不进 git

- 为什么：GitHub 公开仓库不能存密钥；且部署脚本 `git reset --hard` 不会删除被 gitignore 的 `.env.local`。
- 落地：首次部署时 `cp .env.example .env.local` + 手工填真实 Key；后续 GitOps 只更新代码不触碰 env。

## Risks / Trade-offs

- [按量流量费被恶意刷] → 安全组仅开放 22/80/443；Nginx 限速（`limit_req`）可选；后续可套 CDN 隐藏源 IP。
- [备案不通过（工具类网站各省尺度不同）] → 网站简介如实填写；提前咨询阿里云备案客服；这是外部审批风险，文档标注。
- [`git reset --hard` 误伤本地未提交改动] → 服务器目录是纯部署位（只从 origin 拉取），本地不做任何手工修改；env 文件受 gitignore 保护。
- [PM2 cluster 与 Next.js standalone 兼容性] → 用 `next start` 而非 standalone server.js，规避补齐产物问题；如未来切 standalone，文档给出补齐命令。
- [SSH key 泄露（公开仓库 + workflow 可见）] → key 存 GitHub Secret（仅 maintainer 可设置，fork 不可读）；部署用专用 key，不用个人主 key。

## Migration Plan

1. **Phase 0**（可立即，不依赖域名）：跑 `deploy/setup-server.sh` 初始化服务器 → 手工 clone + 首次部署 → IP + 3000 端口验证（临时用 `curl http://IP:3000` 经 Nginx 或直连）。
2. **Phase 1**（并行 7-20 天）：购买域名 + 实名 → 提交个人 ICP 备案 → 等待管局审核。
3. **Phase 2**（备案通过后）：DNS A 记录指向服务器 → 打开 80/443 → certbot 签发 SSL → 域名验证 → 公安备案。
4. **Phase 3**（可提前）：配置 GitHub Secrets → push main 触发完整流水线 → 验证自动部署生效。

回滚策略：`git push` 前在本地确认 CI 绿；服务器出问题时 `git checkout <上一tag>` + `pm2 reload` 手动回滚；必要时 `pm2 stop tpa` 停机排查。

## Open Questions

- 无阻塞性问题。域名具体值、备案网站名称由用户备案时填写（文档用 `YOUR_DOMAIN` 占位符），不影响本 change 的 specs/tasks。
