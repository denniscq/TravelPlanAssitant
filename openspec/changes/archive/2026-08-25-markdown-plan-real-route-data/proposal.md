# Proposal: 出行计划 Markdown 基于真实高德路线数据

## Why

用户反馈：当前生成路线后展示在 `StepRoutePlan.tsx` 的 Markdown 出行计划里，关于**怎么去**、**距离多远**、**要多久**、**公交坐哪条线从哪个站到哪个站**等交通信息几乎全是 LLM 凭 POI 名字瞎编的，不是来自真实的高德 API 数据。

根因有两处：

1. **`LLMService.buildUserPrompt()` 没有把 `routeSegments` 传进 prompt**（[LLMService.ts:167-202](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/LLMService.ts#L167-L202)）。
   prompt 里只包含 POI 列表（id、name、category、address、coordinates、rating、cost、tags、openingHours、recommendedDishes）。LLM 没有真实距离/时长/站点信息，所以它在 `markdownPlan` 字段里写的 "8.2km · 25min"、"地铁1号线从天安门东站到王府井站" 都是凭 POI 名字编的。

2. **`AmapRouteCalculationService.parseTransitPolyline()` 把公交/地铁段里的关键信息全丢了**（[AmapRouteCalculationService.ts:572-640](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/AmapRouteCalculationService.ts#L572-L640)）。
   高德 `/v3/direction/transit/integrated` 响应里 `segments[i].bus.buslines[j]` 本来就包含 `name`（线路名，如 "1号线"）、`type`（地铁/公交）、`departure_stop.name`（上车站）、`arrival_stop.name`（下车站）、`via_stops[].name`（途径站列表）、`cost`（票价）、`start_time`/`end_time`（首末班车）—— 但当前代码只取了 `polyline` 坐标，其余字段被丢弃。

用户已经确认地图上的 `segments` 距离/时长是真的高德数据，但 **Markdown 文字描述里没用到这些真实数据**。

## What Changes

### 真实交通详情结构化提取

- 在 [AmapRouteCalculationService.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/AmapRouteCalculationService.ts) 新增 `parseTransitLegDetails()` 函数，返回结构化的公交/地铁路段详情（线路名、上车站、下车站、票价、首末班车、距离/时长）。
- 扩展 `RouteSegment` 类型（[itinerary-types.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/types/itinerary-types.ts)），新增 `transitLegs?: TransitLegDetail[]` 和 `transitFee?: number` 字段。
- `calculateRouteSegments()` 把这些字段填充到返回的 `RouteSegment` 里。

### 把真实交通数据传给 LLM

- 调整 [ItineraryPlanningService.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/ItineraryPlanningService.ts) 的调用顺序：先调 `amapRouteCalculationService.calculateRouteSegments()` 拿到真实 segments，**再**带着这些数据调 `llmService.generateRoutePlan()`。
- 在 [LLMService.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/LLMService.ts) 的 `buildUserPrompt()` 里新增 "真实路线事实表" 一节，把每个 segment 的真实 distance/duration/transitLegs/tranistFee 整理成结构化文本传给 LLM。
- 在 SYSTEM_PROMPT 中强化约束：
  - 明确告诉 LLM 距离/时长/站点都是真实高德数据，禁止编造或四舍五入。
  - 公交段必须按模板 "地铁/公交X号线【上车站】上车 → 【下车站】下车" 输出。
  - 交通费直接从 `transitFee` 取。

### 成本细分中的交通费

- 当至少有一个 segment 的 `transportMode === 'transit'` 且 `transitFee > 0` 时，`costBreakdown.transportation` 直接累加 `transitFee`。
- 驾车/打车段按当前规则继续估算（不打表，按 0.6 元/km 估算油费）。
- 步行/骑行段交通费 = 0。

## Capabilities

### Modified Capabilities

- `ai-route-planning`：扩 `Structured JSON output` 要求——`markdownPlan` 必须包含真实交通细节（按 segment 模板输出），LLM 不能编造距离/时长/站点。
- `route-calculation`：扩 `Route polyline data` 要求——transit 段必须额外返回 `transitLegs[]`（每段含 lineName、departureStop、arrivalStop、viaStops、startTime、endTime）和 `transitFee`。

### New Capabilities

（无。本次改动只是把现有 capability 强化。）

## Impact

- 受影响的代码：
  - `src/lib/services/AmapRouteCalculationService.ts`：新增 `parseTransitLegDetails()`，扩展 `RouteSegment` 返回值。
  - `src/lib/types/itinerary-types.ts`：扩展 `RouteSegment` 接口。
  - `src/lib/services/ItineraryPlanningService.ts`：调整调用顺序，把真实 segments 传给 LLM。
  - `src/lib/services/LLMService.ts`：扩展 `buildUserPrompt()` 和 SYSTEM_PROMPT。
  - `src/components/steps/StepRoutePlan.tsx`：不变（继续渲染 `itineraryPlan.markdownPlan`）。
- 受影响的依赖：无（纯后端逻辑增强）。
- 受影响的 API：`/api/llm/route-plan` 入参/出参结构不变。
- 性能：transit 段解析只增加少量字段提取（< 1ms/段），prompt 文本长度增加约 200-500 字符/段，token 消耗小幅上升但在 8k max_tokens 内可承受。
- 测试：新增 `parseTransitLegDetails()` 单元测试覆盖字段映射；LLM prompt 增强靠端到端验证。

## Out of Scope

- 不改 `SimplifiedMap.tsx`（地图上 distance/duration 已经是真实数据）。
- 不改 `transportModeSelector`（交通方式选择逻辑不变）。
- 不改 `/v3/direction/transit/integrated` 之外的其他 AMAP API。
- 不引入新依赖。
- 不实现 `markdownPlan` 的代码模板生成（用户明确选择 "传给 LLM 重写" 方案）。
- 公交段呈现详细程度：只显示 "上车站 → 下车站 + 线路名"，不显示完整途径站列表。
