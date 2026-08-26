## 1. 项目初始化

- [ ] 1.1 使用 `create-next-app` 初始化 Next.js 14+ 项目，配置 TypeScript、Tailwind CSS、App Router
- [ ] 1.2 安装依赖：`@amap/amap-jsapi-loader`、`rate-limiter-flexible`
- [ ] 1.3 配置 `.env.local` 模板文件（高德 Key、百炼 API Key、DeepSeek 模型名、限流参数）
- [ ] 1.4 配置 `next.config.js`（允许的高德脚本域名等）
- [ ] 1.5 创建 `lib/types/`、`lib/services/`、`lib/utils/` 目录结构
- [ ] 1.6 配置全局 CSS 样式基础（Tailwind + design-taste-frontend 风格基调）

## 2. 类型定义层 (lib/types/)

- [ ] 2.1 创建 `amap-service-types.ts`：高德 POI 搜索响应、路径规划请求/响应类型
- [ ] 2.2 创建 `poi-types.ts`：POI（景点/餐厅）通用类型，含 AttractionPoi 和 RestaurantPoi 区分
- [ ] 2.3 创建 `itinerary-types.ts`：行程路线类型，含 ItineraryStop、ItineraryRoute、TransportMode、ItineraryPlan

## 3. 工具函数层 (lib/utils/)

- [ ] 3.1 创建 `environment.ts`：安全读取环境变量的工具函数，含类型校验和默认值
- [ ] 3.2 创建 `request-ip-extractor.ts`：从 Next.js Request 对象中提取客户端 IP 地址
- [ ] 3.3 创建 `amap-js-api-loader.ts`：封装高德 JS API 加载逻辑，支持安全密钥注入（JSAPI 2.0 安全密钥方式）

## 4. 服务层 — AmapPoiSearchService (lib/services/)

- [ ] 4.1 实现 `AmapPoiSearchService`：封装高德 POI Search 2.0 API 调用，支持按城市和类型搜索
- [ ] 4.2 实现搜索结果按 `rating` 字段降序排列
- [ ] 4.3 实现 Top-N 截取逻辑（根据传入的 limit 参数返回前 N 条）
- [ ] 4.4 实现服务端 POI 搜索缓存（内存 Map 缓存，TTL 30 分钟，通过环境变量可配置）

## 5. 服务层 — AmapRouteCalculationService (lib/services/)

- [ ] 5.1 实现 `AmapRouteCalculationService`：封装高德 Direction API（驾车/步行/公交/骑行）
- [ ] 5.2 实现基于距离的出行方式推荐逻辑（<2km 步行，2-20km 驾车，>20km 驾车）
- [ ] 5.3 实现途经点路线计算（支持最多 16 个途经点的驾车路线）
- [ ] 5.4 返回结果包含距离、耗时、折线坐标数据、推荐出行方式

## 6. 服务层 — LLMService (lib/services/)

- [ ] 6.1 实现 `LLMService`：封装阿里云百炼 DeepSeek-V4-Flash API 调用（OpenAI 兼容接口）
- [ ] 6.2 设计路线规划 Prompt：包含 POI 列表、起点终点、约束条件（不走回头路、饭点插餐厅）
- [ ] 6.3 实现结构化 JSON 输出解析和校验
- [ ] 6.4 实现 LLM 调用失败时的降级策略（按距离排序的兜底方案）

## 7. 服务层 — RateLimitService (lib/services/)

- [ ] 7.1 实现 `RateLimitService`：基于 `rate-limiter-flexible` 的 MemoryStore + IP 滑动窗口
- [ ] 7.2 限流配置：每小时 10 次/IP，通过环境变量 LLM_SERVICE_RATE_LIMIT_MAX 和 LLM_SERVICE_RATE_LIMIT_WINDOW_MS 可配置
- [ ] 7.3 超限时返回标准错误响应（含 Retry-After 头信息）

## 8. 服务层 — ItineraryPlanningService (lib/services/)

- [ ] 8.1 实现 `ItineraryPlanningService`：编排 LLM 路线规划 + 高德路径规划的完整流程
- [ ] 8.2 调用 LLMService 获取优化后的 POI 顺序
- [ ] 8.3 遍历有序 POI 列表，调用 AmapRouteCalculationService 计算每段路线
- [ ] 8.4 组装最终行程数据（含总距离、总时间、逐站明细）

## 9. API 路由层 (app/api/)

- [ ] 9.1 实现 `app/api/amap/place/route.ts`：POI 搜索 API 代理，调用 AmapPoiSearchService
- [ ] 9.2 实现 `app/api/amap/route/route.ts`：路径规划 API 代理，调用 AmapRouteCalculationService
- [ ] 9.3 实现 `app/api/llm/route-plan/route.ts`：LLM 路线规划 API，集成 RateLimitService + ItineraryPlanningService
- [ ] 9.4 所有 API 路由统一错误处理（高德 API 错误、限流拒绝、LLM 错误等）

## 10. 地图组件 (components/map/)

- [ ] 10.1 实现 `MapContainer.tsx`：封装高德地图实例，支持地图初始化、中心点控制、缩放控制
- [ ] 10.2 实现 `MarkerWithPopup.tsx`：POI 标记组件，含点击弹出信息窗口、"+ 加入行程"按钮
- [ ] 10.3 实现 `RouteLine.tsx`：路线折线渲染组件，支持不同出行方式的不同颜色区分

## 11. 步骤组件 (components/steps/)

- [ ] 11.1 实现 `StepStartEnd.tsx`：第一步 — 起终点输入，含高德地理编码自动补全、地图标记
- [ ] 11.2 实现 `StepAttractions.tsx`：第二步 — 景点选择，含城市输入、Top-N 滑块、地图标记、InfoCard 弹窗
- [ ] 11.3 实现 `StepRestaurants.tsx`：第三步 — 餐厅选择，同景点选择模式，展示人均消费
- [ ] 11.4 实现 `StepRoutePlan.tsx`：第四步 — AI 路线规划，含"生成路线"按钮、路线渲染、汇总面板

## 12. UI 通用组件 (components/ui/)

- [ ] 12.1 实现 `StepBar.tsx`：步骤进度指示器，展示当前步骤（1/4、2/4、3/4、4/4）
- [ ] 12.2 实现 `TopNCountSlider.tsx`：Top-N 数量滑块控制组件（1-20 范围）
- [ ] 12.3 实现 `PoiInfoCard.tsx`：POI 信息卡片，显示名称、评分、地址、类型、费用、营业时间
- [ ] 12.4 实现 `RouteSummaryPanel.tsx`：路线汇总面板，显示总距离、总时间、逐站明细

## 13. 主页面与布局 (app/)

- [ ] 13.1 实现 `app/layout.tsx`：根布局，含 Metadata、JSON-LD 结构化数据、全局样式
- [ ] 13.2 实现 `app/page.tsx`：主页面，集成四步向导流程和状态管理
- [ ] 13.3 实现 SEO 元数据：动态标题模板（`"城市名 + 旅游路线规划 | TravelPlanAssistant"`）、描述、关键词
- [ ] 13.4 实现 `app/globals.css`：全局样式配置（design-taste-frontend 风格：暖色调、极简排版、充足留白）

## 14. 集成与验证

- [ ] 14.1 端到端流程验证：起终点输入 → 景点搜索选择 → 餐厅搜索选择 → AI 路线生成
- [ ] 14.2 限流功能验证：10 次/小时/IP 限制，429 响应正确返回
- [ ] 14.3 响应式布局验证：Web 和 H5 双端展示正常
- [ ] 14.4 SEO 元数据验证：页面标题、描述、JSON-LD 正确输出