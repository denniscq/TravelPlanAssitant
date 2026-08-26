# Tasks: test-coverage-expansion

执行顺序遵循 TDD：先写测试（RED），看到失败后再写/改实现（GREEN），最后验证。

## 1. 抽取 `map-helpers.ts`

- [x] 1.1 新建 [src/components/map/map-helpers.ts](file:///c:/Dennis/TravelPlanAssistant/src/components/map/map-helpers.ts)
- [x] 1.2 把 `formatDistance` / `formatDuration` / `deterministicTilt` 从 `SimplifiedMap.tsx` 抽出
- [x] 1.3 把 `rectsOverlap` / `clamp` / `clampRectToCanvas` / `placeLabel` / `bestEffortLabel` / `labelEdgePoint` / `segmentsIntersect` 抽出
- [x] 1.4 修改 `SimplifiedMap.tsx` 改为从 `./map-helpers` import
- [x] 1.5 删除 `SimplifiedMap.tsx` 里的内联副本
- [x] 1.6 `tsc --noEmit` 验证编译通过

## 2. `map-helpers` 单测（RED → GREEN → 修 bug）

- [x] 2.1 新建 [src/components/map/map-helpers.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/components/map/map-helpers.test.ts)
- [x] 2.2 写 30 个测试，覆盖全部 10 个 export 的函数 / 类型
- [x] 2.3 看到 2 个失败：`deterministicTilt` 溢出、`rectsOverlap` 边缘相切
- [x] 2.4 修复 `deterministicTilt`：用 `((h%200)+200)%200` 强转正
- [x] 2.5 修复 `rectsOverlap`：`<` / `>` 改为 `<=` / `>=`
- [x] 2.6 全部 30/30 通过

## 3. `TransportModeSelector` 单测

- [x] 3.1 新建 [src/lib/services/TransportModeSelector.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/TransportModeSelector.test.ts)
- [x] 3.2 实现 `StubTransitService`（继承 `TransitAccessibilityService`，覆盖 `checkCombinedAccessibility`）
- [x] 3.3 写 10 个测试：4 条规则、阈值覆盖、序列调度、空输入、`haversineMeters` 对称性
- [x] 3.4 全部 10/10 通过

## 4. `RateLimitService` 单测

- [x] 4.1 新建 [src/lib/services/RateLimitService.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/RateLimitService.test.ts)
- [x] 4.2 测试通过临时设置 `LLM_SERVICE_RATE_LIMIT_MAX=3` 和 `LLM_SERVICE_RATE_LIMIT_WINDOW_MS=60000` 来加速
- [x] 4.3 写 5 个测试：上限、超过上限、IP 独立、reset、剩余配额递减
- [x] 4.4 `beforeEach` / `afterEach` 保存并恢复 env
- [x] 4.5 全部 5/5 通过

## 5. LLM 适配器单测

- [x] 5.1 新建 [src/lib/services/llm/AnthropicLLMClient.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/llm/AnthropicLLMClient.test.ts)
  - [x] 8 个测试覆盖 header / tool_choice / text 提取 / 错误
- [x] 5.2 新建 [src/lib/services/llm/OpenAICompatibleLLMClient.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/llm/OpenAICompatibleLLMClient.test.ts)
  - [x] 9 个测试覆盖 Bearer auth / response_format / code fence 剥离 / 401
- [x] 5.3 新建 [src/lib/services/llm/LLMClientFactory.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/llm/LLMClientFactory.test.ts)
  - [x] 4 个测试覆盖 provider 分发、未知值 fallback
- [x] 5.4 用 `vi.fn().mockResolvedValueOnce(...)` mock `global.fetch`
- [x] 5.5 全部 21/21 通过

## 6. `environment.ts` 单测

- [x] 6.1 新建 [src/lib/utils/environment.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/utils/environment.test.ts)
- [x] 6.2 23 个测试覆盖：必需/可选、Anthropic、OpenAI、Rate limit、POI cache TTL、Queue max length（含 fallback 警告）
- [x] 6.3 全部 23/23 通过

## 7. `request-ip-extractor` 单测（RED → GREEN → 修 bug）

- [x] 7.1 新建 [src/lib/utils/request-ip-extractor.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/utils/request-ip-extractor.test.ts)
- [x] 7.2 写 6 个测试覆盖 header 优先级、trimming、空值 fallback、逗号前缀
- [x] 7.3 看到 1 个失败：`,10.0.0.1` 返回空串而非 IP
- [x] 7.4 修复 `extractClientIpAddress`：循环取第一个非空条目
- [x] 7.5 全部 6/6 通过

## 8. 验证

- [x] 8.1 `npx tsc --noEmit` 0 errors
- [x] 8.2 `npx vitest run`： 11 test files / **123 tests** 全通过
- [x] 8.3 `npx next build` 通过