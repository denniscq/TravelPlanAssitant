# Design: 出行计划 Markdown 基于真实高德路线数据

## Context

当前 `ItineraryPlanningService.generateItinerary()` 调用顺序是：

1. LLM 生成 `orderedPoiIds` + `stopDescriptions` + `markdownPlan` + `costBreakdown`（含瞎猜的距离/时长/站点）
2. `TransportModeSelector` 决定每段交通方式
3. `AmapRouteCalculationService` 调高德 API 拿真实 `segments`（含真 distance/duration/polyline）
4. 把 `stops` + `segments` 一起返回给前端

问题：**LLM 在第 1 步就被调用，那时真实路线还没算出来**。所以 `markdownPlan` 里所有距离/时长/公交站点都是瞎填的，前端也只是把这段 markdown 原样渲染。

约束：

- 不引入新依赖。
- `StepRoutePlan.tsx` 调用方式不变。
- `/api/llm/route-plan` 入参/出参结构不变。
- `RouteSegment` 接口扩展必须向后兼容（旧字段全部保留，新增字段都是 optional）。
- 项目文档用中文（team preference）。
- 代码注释用英文（user rule）。

## Goals / Non-Goals

**Goals:**

- 把真实的高德路线数据（距离、时长、公交站点、票价）提取为结构化字段。
- 让 LLM 生成的 `markdownPlan` 引用这些真数据，禁止瞎填。
- 公交段在 markdown 中显示 "线路名【上车站】→【下车站】"。
- 交通费用直接用高德返回的 `transitFee`，不再瞎估。

**Non-Goals:**

- 不改 `SimplifiedMap.tsx`（地图已经是真数据）。
- 不改 `TransportModeSelector`。
- 不实现 markdownPlan 的代码模板生成（用户选择"传给 LLM 重写"）。
- 不显示完整途径站列表（用户选择"起止站"）。
- 不支持非中国大陆城市的公交换乘细节。
- 不优化 LLM token 消耗。
- 不实现 `markdownPlan` 的缓存或重试机制。

## Decisions

### 1. 调整 `ItineraryPlanningService` 调用顺序：先调 AMAP，再调 LLM

**理由**：让 LLM 在 prompt 中看到真数据。要避免循环依赖（LLM 排序需要 POI 列表 → AMAP 需要排序后的坐标对）。

实际流程：

1. 先调 LLM 拿 `orderedPoiIds`（只需要排序，不需要距离/时长）。
2. `TransportModeSelector` 决定交通方式（基于坐标对）。
3. `AmapRouteCalculationService` 调高德拿真 `segments`（含 `transitLegs`、`transitFee`）。
4. **第二次调 LLM**，这次带着真 `segments` 让它生成 `markdownPlan` 和 `stopDescriptions`。

**替代方案**：

- 让 `AmapRouteCalculationService` 自己计算初始顺序：实现简单但牺牲了 LLM 的"避免回头路"优化能力。
- 在前端把真实 segments 注入到 markdownPlan：用户会看到 LLM 文本和真实数据不一致，体验割裂。

### 2. 第二次 LLM 调用的 prompt 结构

SYSTEM_PROMPT 增加新规则：

```
## 真实路线数据约束（最重要）

你会在 userPrompt 中看到 "## 真实路线事实表"，其中每个路段的 distance/duration 都是高德 API 真实返回值。
- 你必须在 markdownPlan 中引用这些真实数据，距离/时长禁止编造或四舍五入到不一致的数值。
- 公交段：必须按模板 "X号线【上车站名】上车 → 【下车站名】下车"。
- 交通费直接从 transitFee 取，禁估算。
- 格式参考（每站必须包含 4 段）：
  - 怎么去：从【起点】驾车/步行/乘坐 X 号线【上车站】到【下车站】，约 X.X km / X min
  - 玩什么/吃什么：（自由发挥）
  - 花费：门票 ¥X（景点）/ 人均 ¥X（餐厅）
```

userPrompt 增加新节：

```
## 真实路线事实表（来自高德 API，禁止编造）

段[0]: 出发地 → 故宫 | driving | 8.2km | 25min
段[1]: 故宫 → 王府井 | transit | 5.6km | 32min
  - 公交段 1: 地铁1号线【天安门东站】→【王府井站】(B口出) | 4.1km | 18min
  - 接驳步行: 出发地 → 天安门东站 800m / 12min; 王府井站 → 王府井 300m / 5min
  - 票价: ¥3
```

### 3. `RouteSegment` 扩展字段

[itinerary-types.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/types/itinerary-types.ts) 新增：

```ts
export interface TransitLegDetail {
  transportType: 'bus' | 'subway' | 'railway';
  lineName: string;             // "1号线" 或 "445路"
  departureStopName: string;    // "中关村"
  arrivalStopName: string;      // "王府井"
  viaStopCount: number;         // 8
  startTime: string;            // "0600"
  endTime: string;              // "2300"
  distanceMeters: number;
  durationSeconds: number;
}

export interface WalkingLegDetail {
  distanceMeters: number;
  durationSeconds: number;
  instruction: string;
}

export interface RouteSegment {
  // ... 现有字段全部保留
  transitLegs?: TransitLegDetail[];
  transitFee?: number;
  walkingLegs?: WalkingLegDetail[];
}
```

**理由**：扩展而非替换，避免破坏现有调用方。`AmapRouteCalculationService.calculateRouteSegments()` 的所有现有调用方（`ItineraryPlanningService`、`SimplifiedMap`）不读新字段也没关系。

### 4. `AmapRouteCalculationService` 新增 `parseTransitLegDetails()`

从 `data.route.transits[].segments[].bus.buslines[]` / `segments[].subway.buslines[]` 提取：

- `name` → `TransitLegDetail.lineName`
- `type` → `TransitLegDetail.transportType`（映射 "地铁线路" → subway，"公交线路" → bus，其他 → bus）
- `departure_stop.name` → `departureStopName`
- `arrival_stop.name` → `arrivalStopName`
- `via_num` → `viaStopCount`（parseInt）
- `start_time` → `startTime`
- `end_time` → `endTime`
- `distance` → `distanceMeters`（parseInt）
- `duration` → `durationSeconds`（parseInt）

从 `data.route.transits[].cost` 提取 `transitFee`（parseFloat）。

`walking.steps[]` 提取首尾两条腿作为 `walkingLegs[]`（含 origin/destination stop 名字、距离、时长）。

**理由**：用户选择"起止站"详细程度，不显示完整途径站列表，所以 `via_stops[]` 不需要写入字段。但 `via_num` 是单值，提示用户"经过 N 站"很有用，所以保留。

### 5. 成本拆分中的交通费

[ItineraryPlanningService](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/ItineraryPlanningService.ts) 在调用 LLM 之前，先用真实 segments 计算 `costBreakdown.transportation`：

- 累加所有 `transit` 段的 `transitFee`（如有）。
- 累加所有 `driving`/`taxi` 段的估算油费（按 0.6 元/km）。
- 步行/骑行段费用 = 0。

把这个 `transportation` 数字作为 prompt 上下文传给 LLM（"## 真实费用估算：交通约 ¥X"），让 LLM 在 `markdownPlan` 的"费用明细"里引用。

**理由**：避免 LLM 二次估算交通费导致不一致。

### 6. LLM 第二次调用 vs. 第一次调用的关系

**重要**：第一次 LLM 调用的产物（`orderedPoiIds`）保持不变；第二次 LLM 调用只重新生成 `markdownPlan` 和 `stopDescriptions`。

实现方式：

- 提取 `LLMService.generateRoutePlan()` 中的 markdownPlan 生成逻辑到新方法 `LLMService.regenerateMarkdownPlan()`。
- 第二次调用跳过排序，只传：POI 列表 + 真实 segments + 已有的 `stopDescriptions`（含 LLM 第一轮生成的景点/菜品描述）+ LLM 第一轮的 `costBreakdown`。
- 输出只覆盖 `markdownPlan`，其他字段保留。

**理由**：避免重复排序和重复 POI 描述生成，节省 token。

### 7. 错误处理

- 如果第二次 LLM 调用失败：fallback 到第一次 LLM 调用的 `markdownPlan`（即瞎填的版本），但在后端日志中 warn 提示"使用了未基于真数据的 markdown"。
- 如果 `parseTransitLegDetails()` 因 API 响应缺字段抛出：不抛错，`transitLegs` 留空数组，markdownPlan 中提示"公交段详情不可用"。
- 如果 `transitFee` 为 undefined 或 0：交通费按 0 显示，不影响 costBreakdown 计算。

### 8. 不变的前端逻辑

`StepRoutePlan.tsx` 继续渲染 `itineraryPlan.markdownPlan`，无任何改动。

`SimplifiedMap.tsx` 继续从 `itineraryPlan.segments` 拿 polyline 渲染路线，无任何改动。

## Risks / Trade-offs

- **[风险]** 第二次 LLM 调用增加约 2-5 秒延迟（受 prompt 长度影响）。
  - **缓解**：用户已经在等"生成路线"按钮，转圈 loading 已经存在，2-5 秒可接受。如果性能成为问题，未来可以缓存 `(poiHash, segmentsHash) → markdownPlan`。
- **[风险]** LLM 仍可能在 markdownPlan 中改写数字（比如把 "8.2km" 写成 "约 8 公里"）。
  - **缓解**：在 prompt 中强调"禁止四舍五入到不一致的数值"，并要求"8.2km → 必须输出 '8.2km' 或 '8km'（允许到整数）"。
- **[风险]** 公交 `transit/integrated` 在某些城市可能不返回 `buslines`（响应 `cost` 字段缺失）。
  - **缓解**：`parseTransitLegDetails()` 对每个字段单独 try/catch，缺字段时填默认值（`lineName = "公交"`），不让单个缺失字段导致整个解析失败。
- **[风险]** `transitLegs[]` 数组可能很长（多换乘线路），prompt 长度增加。
  - **缓解**：每个公交 leg 限制在 200 字符以内（trim instruction/road 等长字段），整体 prompt 增加不超过 1k 字符。
- **[风险]** `LLMService.regenerateMarkdownPlan()` 复用 LLM client 时与第一次调用并发：可能导致 stopDescriptions 不一致。
  - **缓解**：严格串行调用（await），不并发。
- **[风险]** 第二次 LLM 调用失败时 fallback 到第一次的瞎填 markdown：用户体验仍能看，但仍然不真实。
  - **缓解**：日志 warn；如果想强制真实，可以把 fallback 改成代码模板生成（但超出本次 scope）。

## Migration Plan

代码层面：

1. 扩展 [itinerary-types.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/types/itinerary-types.ts) 加 `TransitLegDetail` / `WalkingLegDetail`，扩展 `RouteSegment`。
2. 扩展 [AmapRouteCalculationService.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/AmapRouteCalculationService.ts)：
   - 新增 `parseTransitLegDetails()` 私有方法。
   - 在 `calculateRouteSegments()` 中填充 `transitLegs`、`transitFee`、`walkingLegs` 到每个 `RouteSegment`。
3. 扩展 [LLMService.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/LLMService.ts)：
   - 扩展 SYSTEM_PROMPT 增加"真实路线数据约束"节。
   - 新增 `buildSegmentsContext()` 私有方法，把 segments 转成结构化 prompt 文本。
   - 扩展 `buildUserPrompt()` 接受 segments 上下文参数。
   - 新增 `regenerateMarkdownPlan()` 公共方法。
4. 调整 [ItineraryPlanningService.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/ItineraryPlanningService.ts)：
   - 计算 segments 后，基于真 segments 累加 `transportation` 成本。
   - 调用 `llmService.regenerateMarkdownPlan()` 替换第一次的 markdownPlan。
   - 错误时 fallback 到第一次的版本并 warn。

回滚策略：所有改动都是增量扩展，旧字段保留、旧方法保留；如出现严重问题可以 git revert 整个 commit。

## Open Questions

- **Q**: LLM 第二次调用失败时，是否要 fallback 到代码模板生成的 markdown（而非第一次瞎填的版本）？
  - **A**: 否。本次 scope 限定"传给 LLM 重写"方案；fallback 退化到第一次版本即可。代码模板是未来优化项。
- **Q**: 是否要为 `markdownPlan` 加 E2E 测试（断言语义正确性）？
  - **A**: 否。LLM 输出不稳定，加 E2E 会脆。本次只手动验证（启动 dev server，看输出是否真实）。
