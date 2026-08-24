# Travel Plan Assistant — 设计文档

## 概述

一个基于 Web 的旅行路线规划工具，帮助用户发现城市景点和餐厅，并通过 AI 生成优化的游玩路线。基于 Next.js App Router 构建，使用高德地图 API 和阿里云百炼（DeepSeek-V4-Flash）大模型。

## 项目目标

1. 用户输入起点和终点，在地图上标记
2. 基于 IP 自动定位城市，支持三级行政区划选择（省/市/区县）+ 模糊搜索切换城市
3. 浏览城市的高评分景点，通过滑块控制展示数量
4. 浏览城市的高评分餐厅，展示人均消费等信息
5. AI 生成最优路线（不走回头路），在饭点插入餐厅
6. 在地图上渲染路线，标记距离、时间和推荐出行方式

## 明确排除的范围

- 无用户登录 / 认证系统
- 无数据库（会话间不持久化）
- 无 mock 数据
- 无实时路况集成（使用高德路径规划估算）
- 无用户评价 / 评论
- 无多日行程规划（仅单日路线）

## 技术栈

| 层级 | 技术 |
|-------|-----------|
| 框架 | Next.js 14+ (App Router) |
| 语言 | TypeScript |
| 样式 | Tailwind CSS + design-taste-frontend 规范 |
| 地图前端 | 高德 JS API 2.0 (via @amap/amap-jsapi-loader) |
| 地图服务端 | 高德 Web 服务 API (POI Search 2.0, Direction 2.0, IP Location, District, Inputtip) |
| 大模型 | 阿里云百炼 — DeepSeek-V4-Flash (路线规划) |
| 限流 | rate-limiter-flexible (MemoryStore, IP 滑动窗口) |
| 部署 | 独立部署 (next build + next start) |

## 架构（方案 C — 分层服务架构）

```
TravelPlanAssistant/
├── app/                                # Next.js App Router
│   ├── page.tsx                        # 主页面（动态导入，骨架屏）
│   ├── page.client.tsx                 # 主页面客户端逻辑（四步向导 + 城市选择器）
│   ├── layout.tsx                      # 根布局
│   ├── api/
│   │   ├── amap/
│   │   │   ├── place/route.ts          # POI 搜索代理
│   │   │   ├── route/route.ts          # 路径规划代理
│   │   │   ├── ip-location/route.ts    # IP 定位城市
│   │   │   ├── district/route.ts       # 行政区划三级树
│   │   │   └── inputtip/route.ts       # 地点输入联想
│   │   └── llm/
│   │       └── route-plan/route.ts     # LLM 路线规划 + 限流
│   └── globals.css
├── components/                         # UI 组件
│   ├── map/
│   │   ├── MapContainer.tsx            # 高德地图实例封装（单次初始化，原地更新）
│   │   ├── MarkerWithPopup.tsx         # POI 标记 + 信息弹窗
│   │   └── RouteLine.tsx               # 路线折线渲染
│   ├── steps/
│   │   ├── StepStartEnd.tsx            # 第一步：起终点（含地点输入联想）
│   │   ├── StepAttractions.tsx         # 第二步：景点选择（自动加载）
│   │   ├── StepRestaurants.tsx         # 第三步：餐厅选择（自动加载）
│   │   └── StepRoutePlan.tsx           # 第四步：AI 路线规划
│   ├── ui/
│   │   ├── StepBar.tsx                 # 步骤进度指示器
│   │   ├── TopNCountSlider.tsx         # Top-N 数量滑块
│   │   ├── PoiInfoCard.tsx             # POI 信息卡片
│   │   ├── RouteSummaryPanel.tsx       # 路线汇总面板
│   │   ├── CitySelector.tsx            # 城市选择器（三级联动 + 模糊搜索 + IP 定位）
│   │   ├── PlaceAutocomplete.tsx       # 地点输入联想组件
│   │   └── PageSkeleton.tsx            # 页面骨架屏（加载动画）
│   └── shared/
│       └── LoadingOverlay.tsx
├── lib/
│   ├── types/                          # 共享类型定义
│   │   ├── amap-service-types.ts       # 高德 API 响应类型（含 IP/District/Inputtip）
│   │   ├── poi-types.ts                # POI（景点/餐厅）类型
│   │   └── itinerary-types.ts          # 路线 & 行程类型
│   ├── services/                       # 服务层（业务逻辑）
│   │   ├── AmapPoiSearchService.ts     # POI 搜索逻辑
│   │   ├── AmapRouteCalculationService.ts # 路径计算逻辑
│   │   ├── LLMService.ts               # 百炼 DeepSeek-V4-Flash LLM 调用
│   │   ├── RateLimitService.ts         # IP 限流器
│   │   └── ItineraryPlanningService.ts # 路线规划编排
│   └── utils/
│       ├── amap-js-api-loader.ts       # 高德 JS API 加载器
│       ├── request-ip-extractor.ts     # 从请求中提取 IP
│       ├── environment.ts              # 环境变量访问
│       ├── logger.ts                   # 日志格式化核心（北京时间、等级、RequestId）
│       ├── client-logger.ts            # 前端日志单例（页面级别 UUID）
│       └── server-logger.ts            # 后端日志工厂（x-request-id 透传）
├── components/
│   └── shared/
│       ├── LoadingOverlay.tsx
│       └── LoggerInitializer.tsx       # 页面加载时初始化前端日志
├── .env.local                          # API 密钥（不提交）
└── next.config.js
```

## 数据流

### 第零步：城市定位与选择
```
页面加载 → PageSkeleton（骨架屏）
  → 并行请求：
    1. /api/amap/ip-location → IP 定位 → 自动设置当前城市
    2. /api/amap/district → 加载三级行政区划树
  → 初始化完成 → 页面内容显示
用户可随时：
  · 模糊搜索城市（输入 >= 2 字符触发联想）
  · 三级联动选择：省 → 市 → 区/县
  · 点击"定位"按钮重新 IP 定位
切换城市 → 重置已选 POI → 后续步骤自动使用新城市
```

### 第一步：设置起点和终点
```
用户输入（出发地点/结束地点）
  → PlaceAutocomplete 组件实时请求 /api/amap/inputtip
  → 用户从下拉列表选择 → 获取坐标
  → 提交 → 地图标记 → 进入下一步
```

### 第二步：浏览和选择景点（自动加载）
```
城市选定后自动触发（无需手动搜索）：
  → /api/amap/place?city=X&type=scenic&limit=N
  → AmapPoiSearchService → 高德 POI Search 2.0
  → 响应: POI[] 含 name, location, rating, cost, tag, opentime
  → 地图标记 + PoiInfoCard 弹窗
  → 用户点击 "+" 加入行程
滑块调整 TopN → 自动重新加载
```

### 第三步：浏览和选择餐厅（自动加载）
```
城市选定后自动触发：
  → /api/amap/place?city=X&type=restaurant&limit=N
  → AmapPoiSearchService → 高德 POI Search 2.0
  → 响应: POI[] 含 name, location, rating, cost, type, tag
  → 地图标记 + PoiInfoCard 弹窗
  → 用户点击 "+" 加入行程
滑块调整 TopN → 自动重新加载
```

### 第四步：AI 路线规划
```
用户确认已选 POI → /api/llm/route-plan
  → RateLimitService.check(ip) → 超限则拒绝
  → LLMService.generateRoute(pois, start, end)
      → Prompt: "根据这些景点和餐厅，优化游览顺序，
                 尽量减少走回头路，在饭点插入餐厅。
                 返回有序列表及时间安排。"
  → AmapRouteCalculationService.calculateRoute(orderedPOIs, start, end)
      → 高德 Direction API → 距离、耗时、出行方式
  → 响应: 行程含有序停靠点、路线、距离、时间
  → 地图渲染 RouteLine + RouteSummaryPanel
```

## 高德 API 集成

### POI Search 2.0 (v5/place/text)
- 端点: `https://restapi.amap.com/v5/place/text`
- 关键参数: `keywords`, `types`（景点=风景名胜, 餐厅=餐饮服务）, `city`, `offset`, `page`
- 用途: 景点和餐厅发现
- 限制: 无排名功能 — 使用 `rating` 字段降序排列作为 Top-N 替代

### Direction API 2.0 (v5/direction/*)
- 端点:
  - `v5/direction/driving` — 支持最多 16 个途经点
  - `v5/direction/walking` — 100 公里以内
  - `v5/direction/transit` — 公共交通
  - `v5/direction/cycling` — 骑行路线
- 用途: 计算停靠点之间的路线距离、耗时和折线
- 策略: 默认 `strategy=0`（最快路线），提供备选策略选项

### IP Location API (v3/ip)
- 端点: `https://restapi.amap.com/v3/ip`
- 用途: 根据用户 IP 自动定位城市
- 缺点: 精度仅到城市级别，无法获取区县

### District API (v3/config/district)
- 端点: `https://restapi.amap.com/v3/config/district`
- 参数: `keywords=adcode`, `subdistrict=3`
- 用途: 获取省/市/区三级行政区划树，用于城市选择器
- 返回: 树形结构，每个节点包含 name, adcode, center(经纬度), level

### Inputtip API (v3/assistant/input/tips)
- 端点: `https://restapi.amap.com/v3/assistant/input/tips`
- 参数: `keywords`, `city`, `city_limit=true`
- 用途: 地点输入联想，用于起终点输入和城市模糊搜索
- 返回: 建议列表，含 name, address, location, district

### 高德 JS API 2.0
- 用途: 前端地图渲染、标记、信息窗口、折线
- 关键类: `AMap.Map`, `AMap.Marker`, `AMap.InfoWindow`, `AMap.Polyline`
- 初始化策略: 组件挂载时创建一次，props 变化时通过 `setCenter()/setZoom()` 原地更新，不销毁重建

## LLM 集成（百炼 DeepSeek-V4-Flash）

### 模型: deepseek-v4-flash
- 通过阿里云百炼平台调用，OpenAI 兼容接口
- 输入: ¥1/百万tokens，输出: ¥2/百万tokens
- 支持结构化输出（JSON mode）和 Function Calling
- 百万级上下文，路线规划任务绰绰有余

### Prompt 设计（概念）
```
You are a travel route planner. Given:
- Start point: {location}
- End point: {location}
- Selected attractions: [{name, location, type, rating}]
- Selected restaurants: [{name, location, type, cost}]
- Constraints: minimize backtracking, insert restaurant stops at meal times

Return an ordered itinerary in JSON format:
[
  { "poiId": "...", "order": 1, "suggestedArrival": "09:00", "suggestedDuration": "2h" },
  ...
]
```

### 限流策略
- 策略: 每个 IP 的滑动窗口
- 限制: 10 次/小时/IP
- 实现: `rate-limiter-flexible` 配合 `MemoryStore`
- 响应: 超限时返回 HTTP 429

## 用户界面（四步向导）

### 第零步：城市选择器（全局可见）
- 页面加载时显示骨架屏动画
- 骨架屏包含标题、步骤条、内容区的占位动画
- 所有元素在骨架屏中同步显示，消除异步加载的视觉不同步
- IP 定位完成后自动切换为实际内容
- 城市选择器在所有步骤中可见（固定在步骤条上方）
- 两种选择方式：
  - 模糊搜索输入框（>= 2 字符触发联想）
  - 三级联动下拉菜单：省份 → 城市 → 区/县
- "定位"按钮重新 IP 定位

### 第一步：起点和终点
- 出发地点和结束地点文本输入框（带输入联想 PlaceAutocomplete）
- Placeholder 示例："出发的位置，例如：北京站" / "回到的位置，例如：北京首都机场"
- 自动从下拉列表获取坐标
- 地图上放置标记

### 第二步：景点选择（自动加载）
- 城市选定后自动加载景点列表，无需手动搜索
- Top-N 滑块（5-30）控制展示数量
- 每个景点在地图上标记
- 点击标记 → PoiInfoCard 弹窗（名称、评分、标签、营业时间、费用）
- 每个标记上的 "+" 按钮加入行程
- 已选景点在卡片网格中展示

### 第三步：餐厅选择（自动加载）
- 与第二步相同模式，自动加载
- PoiInfoCard 展示：名称、评分、类型、人均消费、标签
- 附加：按需调用 LLM 生成简短的"推荐菜"描述

### 第四步：路线规划
- "生成路线"按钮 → 触发 LLM + 高德路径规划
- 地图渲染完整路线（折线）
- 每个停靠点：带序号标记、距离标签、时间标签
- 每段路线显示出行方式
- 路线汇总面板：总距离、总时间、逐站明细

## 设计规范

遵循 `design-taste-frontend` 技能标准：
- 无通用 AI 模板
- 极简、编辑风格、暖色调
- 排版驱动、充足留白
- 无重阴影或渐变
- 干净的信息卡片栅格布局
- 移动优先的响应式设计

## SEO 策略

工具页面需要 SEO 支持以便推广：

### 技术实现
- 元数据（Metadata API）：每个页面通过 `generateMetadata` 生成动态标题、描述、关键词
- 结构化数据（JSON-LD）：标记为 `WebApplication` 类型，注入搜索引擎结构化信息
- 语义化 HTML：使用 `<article>`、`<section>`、`<nav>` 等语义标签
- 页面标题模板：`"城市名 + 旅游路线规划 | TravelPlanAssistant"` 格式，利于长尾搜索
- Open Graph / Twitter Card：确保分享时展示丰富摘要

### 目标关键词方向
- 城市 + 旅游路线规划（如"大连旅游路线规划"）
- 景点推荐 + 路线优化
- 自由行路线生成

## 日志系统

### 设计目标
- 用户操作可追踪：所有日志可关联到同一用户会话
- 前后端统一格式：`[北京时间][DEBUG|INFO|WARN|ERROR][requestId] message`
- 链路追踪：前端请求 ID 通过 `x-request-id` 请求头传递到后端

### 核心组件

| 文件 | 角色 | 说明 |
|------|------|------|
| `logger.ts` | 格式化引擎 | `formatLogMessage(level, requestId, msg)` 生成统一格式日志；`generateRequestId()` 使用 `crypto.randomUUID()`，含 Math.random fallback |
| `client-logger.ts` | 前端单例 | 页面加载时生成 UUID，所有操作日志携带同一 requestId；对外暴露 `getClientLogger()` 函数 |
| `server-logger.ts` | 后端工厂 | 每请求实例化，优先读取 `x-request-id` 请求头以保证链路一致；对外暴露 `createServerLogger(request)` 函数 |

### 日志覆盖范围

**前端（客户端）：**
- 页面加载 → 步骤切换 → 城市切换 → 起终点提交 → POI 自动加载 → 加入/移除 POI → 路线生成

**API 路由（服务端）：**
- 请求入参 → 服务调用 → 结果 / 错误
- IP 定位 → 行政区划查询 → 地点输入联想

**服务层：**
- 缓存命中 / 未命中 → LLM 调用 → 路线片段计算 → 降级策略

### 链路追踪机制
1. 客户端页面加载时，`LoggerInitializer` 组件在 `useEffect` 中触发 `getClientLogger().info('Page loaded')`，生成 UUID
2. 前端调用 API 时，在 `fetch` 请求头中添加 `x-request-id: logger.getRequestId()`
3. 后端 `ServerLogger` 优先读取该请求头，保持一致 ID，否则新生成
4. 服务层通过 `logger?: ServerLogger` 可选参数透传，不强制修改现有接口签名

## 代码规范

- 遵循 SOLID 原则和 DRY 原则
- 分层架构：types → services → utils → components → app
- 命名完整表达含义，不惧名称过长
- 代码注释和日志输出使用英文

## 未来考虑（不在当前范围）

- 多日行程规划
- 持久化路线历史（数据库）
- 用户账户保存收藏
- 实时路况集成
- 第三方评论数据集成
- PWA / 离线支持