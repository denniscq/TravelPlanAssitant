# Tasks: 出行计划 Markdown 基于真实高德路线数据

## 1. 类型扩展

- [ ] 1.1 在 [itinerary-types.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/types/itinerary-types.ts) 新增 `TransitLegDetail` 接口（lineName、transportType、departureStopName、arrivalStopName、viaStopCount、startTime、endTime、distanceMeters、durationSeconds）
- [ ] 1.2 在 [itinerary-types.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/types/itinerary-types.ts) 新增 `WalkingLegDetail` 接口（distanceMeters、durationSeconds、instruction）
- [ ] 1.3 在 `RouteSegment` 接口新增 `transitLegs?: TransitLegDetail[]`、`transitFee?: number`、`walkingLegs?: WalkingLegDetail[]` 三个可选字段

## 2. AMAP 公交段结构化解析

- [ ] 2.1 在 [AmapRouteCalculationService.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/AmapRouteCalculationService.ts) 新增私有方法 `parseTransitLegDetails(transits: AmapTransitItinerary[], logger?)`，返回 `{ transitLegs: TransitLegDetail[]; transitFee?: number; walkingLegs: WalkingLegDetail[] }`
- [ ] 2.2 在 `parseTransitLegDetails()` 中遍历 `transits[].segments[]`，对每个 `bus.buslines[]` / `subway.buslines[]` 提取字段并映射 `type`（"地铁线路" → 'subway'，"公交线路" → 'bus'，其他 → 'bus'）
- [ ] 2.3 从 `transits[].cost` 提取 `transitFee`（parseFloat，无值则 undefined）
- [ ] 2.4 从每段首尾的 `walking.steps[]` 提取首尾两条腿作为 `walkingLegs[]`（含 origin/destination + distance/duration + instruction）
- [ ] 2.5 在 `calculateRouteSegments()` 的 transit 分支中，调 `parseTransitLegDetails()` 并填充到 `RouteSegment` 的三个新字段
- [ ] 2.6 单元测试：新建 `AmapRouteCalculationService.test.ts`，用 mock transit 响应验证字段映射、type 映射、cost 解析、缺失字段默认值

## 3. LLM Service 扩展

- [ ] 3.1 在 [LLMService.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/LLMService.ts) 的 SYSTEM_PROMPT 中新增 "## 真实路线数据约束（最重要）" 节，包含：
  - 距离/时长禁止编造或四舍五入到不一致数值
  - 公交段模板 "X号线【上车站名】上车 → 【下车站名】下车"
  - 交通费直接用 transitFee
  - 每站 4 段式格式（怎么去 / 玩什么吃什么 / 花费）
- [ ] 3.2 在 `LLMService` 中新增私有方法 `buildSegmentsContext(segments: RouteSegment[]): string`，把 segments 数组格式化为 "段[i]: 起点 → 终点 | mode | Xkm | Xmin" + 子项（公交 leg、接驳步行、票价）的结构化文本
- [ ] 3.3 在 `buildUserPrompt()` 签名增加 `segmentsContext: string` 参数，把它拼到 userPrompt 末尾 "## 真实路线事实表（来自高德 API，禁止编造）" 节
- [ ] 3.4 在 `LLMService` 中新增公共方法 `regenerateMarkdownPlan(request, firstLlmResponse, segments, logger)`：
  - 复用现有 client + SYSTEM_PROMPT
  - userPrompt 由 `buildUserPrompt()` 生成 + `buildSegmentsContext()` 追加
  - 只解析 markdownPlan 字段（其他字段从 firstLlmResponse 复制）
  - 出错时 throw，不 fallback（由 ItineraryPlanningService 决定 fallback 策略）

## 4. ItineraryPlanningService 调用顺序调整

- [ ] 4.1 在 [ItineraryPlanningService.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/ItineraryPlanningService.ts) 的 `generateItinerary()` 中，第一次 LLM 调用后保留 `orderedPoiIds` 和 `firstLlmResponse` 的引用
- [ ] 4.2 在 segments 计算之后、最终返回前，根据真实 segments 重新计算 `costBreakdown.transportation`：
  - 累加所有 `transit` 段的 `transitFee`（如 > 0）
  - 累加所有 `driving`/`taxi` 段按 0.6 元/km 的估算
  - 步行/骑行段费用 = 0
- [ ] 4.3 调 `llmService.regenerateMarkdownPlan()` 替换 `markdownPlan` 字段
- [ ] 4.4 在 try/catch 中包住第二次 LLM 调用，失败时 fallback 到 firstLlmResponse.markdownPlan 并 logger.warn
- [ ] 4.5 更新 log：在 "--- Step 6 ---" 后增加 "--- Step 7: Regenerating markdownPlan with real route data ---" 日志段

## 5. 验证

- [ ] 5.1 启动 `npm run dev`，手工触发一次包含公交段的行程（大连老虎滩海洋公园 → 渔人码头）
- [ ] 5.2 检查 markdownPlan：
  - 公交段是否出现真实站名（如"渔人码头站"）
  - 距离/时长是否与地图上 segments 显示一致（误差 ≤ 10%）
  - 票价是否等于 ¥3 左右（大连公交基础票价）
- [ ] 5.3 检查 costBreakdown.transportation 是否包含 transitFee
- [ ] 5.4 跑 `npm run build` 确认编译通过
- [ ] 5.5 跑 `npm test` 确认新增的 `AmapRouteCalculationService.test.ts` 全部通过
- [ ] 5.6 跑 `npm run lint` 确认无新警告

## 6. 文档与收尾

- [ ] 6.1 更新 `.superpowers-memory/CURRENT_STATE.md`：记录本次 markdownPlan 增强完成
- [ ] 6.2 新增 session journal 条目：本次会话要点（关键决策：先 AMAP 后 LLM；prompt 增强"真实路线事实表"）
- [ ] 6.3 把现有 `docs/superpowers/specs/` 下相关的 design 文档同步更新（如有）
- [ ] 6.4 归档 OpenSpec change：移动 `openspec/changes/markdown-plan-real-route-data/` 到 `openspec/changes/archive/2026-08-25-markdown-plan-real-route-data/`
