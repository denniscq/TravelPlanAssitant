# Proposal: 单测覆盖扩展（test-coverage-expansion）

## Why

一期交付前需要补齐之前未覆盖的关键业务模块的单元测试。已有的测试覆盖（route-plan-queue 之前的基线）：

- `RoutePlanQueue`（8 tests）
- `AmapRouteCalculationService`（13 tests）
- `forceLayout`（7 tests）

合计 28 tests。但这远不够覆盖一期代码的关键决策点：

- 没有任何 `TransportModeSelector` 测试（核心业务规则：4 种交通方式的判定阈值）
- 没有任何 `RateLimitService` 测试（429 行为、IP 隔离、reset）
- 没有任何 LLM 适配器测试（Anthropic tool_choice、OpenAI response_format、错误传播）
- 没有任何 `environment.ts` 测试（env fallback、provider 校验、queue 上限）
- 没有任何 `request-ip-extractor` 测试（header 优先级、空值 fallback）
- 没有 `SimplifiedMap` 内部纯函数测试（label 放置、矩形重叠、线段相交）

补这些测试有三个目的：

1. **回归安全网**：route-plan-queue / 多 provider / transport selector 都是易被破坏的核心逻辑，回归保护缺失
2. **回归已发现的 bug**：测试驱动修复了 3 个真实 bug（见 `KNOWN_FAILURES.md`）
3. **一期交付前**：release-quality 基线

## What Changes

### 新增 8 个 test 文件

| 新文件 | tests 数 | 覆盖模块 |
|---|---:|---|
| [src/components/map/map-helpers.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/components/map/map-helpers.test.ts) | 30 | `formatDistance` / `formatDuration` / `deterministicTilt` / `rectsOverlap` / `clamp` / `clampRectToCanvas` / `placeLabel` / `bestEffortLabel` / `labelEdgePoint` / `segmentsIntersect` |
| [src/lib/services/TransportModeSelector.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/TransportModeSelector.test.ts) | 10 | 4 条规则、阈值覆盖、序列调度、`haversineMeters` 对称性 |
| [src/lib/services/RateLimitService.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/RateLimitService.test.ts) | 5 | 上限、IP 隔离、reset、`remainingPoints` 递减 |
| [src/lib/services/llm/AnthropicLLMClient.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/llm/AnthropicLLMClient.test.ts) | 8 | header / tool_choice 注入、tool_use 提取、text 提取、500 抛错、缺内容抛错 |
| [src/lib/services/llm/OpenAICompatibleLLMClient.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/llm/OpenAICompatibleLLMClient.test.ts) | 9 | Bearer auth、`/chat/completions`、response_format、message 角色、code fence 剥离、token usage、401 抛错、缺内容抛错 |
| [src/lib/services/llm/LLMClientFactory.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/llm/LLMClientFactory.test.ts) | 4 | provider 分发、未知值 fallback、缺省 |
| [src/lib/utils/environment.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/utils/environment.test.ts) | 23 | 全部 env helper（Anthropic / OpenAI / Rate limit / POI cache / Queue / Provider） |
| [src/lib/utils/request-ip-extractor.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/utils/request-ip-extractor.test.ts) | 6 | header 优先级、trimming、空值 fallback、逗号前缀修复 |

合计 **95 个新 tests**，全数通过。

### 重构：抽取 `map-helpers.ts`

把 `SimplifiedMap.tsx` 里 7 个纯函数抽出到独立的 [src/components/map/map-helpers.ts](file:///c:/Dennis/TravelPlanAssistant/src/components/map/map-helpers.ts)：

- `formatDistance` / `formatDuration` / `deterministicTilt`
- `rectsOverlap` / `clamp` / `clampRectToCanvas`
- `placeLabel` / `bestEffortLabel` / `labelEdgePoint` / `segmentsIntersect`

**理由**：原文件 190+ 行纯函数与 React 渲染逻辑混在一起，无法在不动 React renderer 的前提下覆盖。DRY + SRP 重构后：

- React 文件减少 ~190 行重复代码
- 纯函数可单独 import、单测覆盖
- 不影响生产行为（API 一致，import 路径替换为本地模块）

### 测试驱动修复 3 个 bug

| Bug | 文件 | 根因 | 修复 |
|---|---|---|---|
| `deterministicTilt` 范围溢出 | [src/components/map/map-helpers.ts](file:///c:/Dennis/TravelPlanAssistant/src/components/map/map-helpers.ts) | `h % 200` 在 JS 中可为负 → tilt 落到 `[-1.76, 1]` 之外 | `((h%200)+200)%200` 强转正 |
| `rectsOverlap` 边缘相切判定反了 | 同上 | 严格 `<` / `>` 应为 `<=` / `>=`，原代码实际把"边缘相切"判定为重叠 | 改为 `<=` / `>=` |
| `extractClientIpAddress` 逗号前缀 | [src/lib/utils/request-ip-extractor.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/utils/request-ip-extractor.ts) | 直接 `split(',')[0].trim()`，开头逗号导致空串 fallback | 循环取第一个非空条目 |

## Capabilities

### Modified Capabilities

- `ai-route-planning`：覆盖 transport selector 规则和 LLM 适配器分支
- `rate-limiting`：覆盖 IP 隔离、reset、剩余配额递减

## Out of Scope

- 不为 `ItineraryPlanningService` 写测试（编排层，依赖过多 mock，性价比低；行为已被各 adapter / selector 间接覆盖）
- 不为 API route handlers 写测试（thin proxy，行为已被 service 层覆盖）
- 不为 `AmapPoiSearchService` / `TransitAccessibilityService` 写测试（fetch wrapper，业务逻辑在 AMap 那边）
- 不为 `LLMService` 编排层写测试（client adapter 已被覆盖，retry 逻辑需端到端）