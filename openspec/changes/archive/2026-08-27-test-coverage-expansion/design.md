# Design: test-coverage-expansion

## 概述

一期交付前补齐未覆盖的核心业务模块的单测，并把 `SimplifiedMap` 内部的纯函数抽取为独立模块以便测试。

## 模块分层与测试边界

```
src/
├── lib/
│   ├── services/
│   │   ├── RoutePlanQueue.ts           ✅ 已测（route-plan-queue）
│   │   ├── RoutePlanQueue.test.ts      ✅
│   │   ├── AmapRouteCalculationService.ts
│   │   ├── AmapRouteCalculationService.test.ts   ✅ 已测
│   │   ├── TransportModeSelector.ts
│   │   ├── TransportModeSelector.test.ts          🆕 10 tests
│   │   ├── RateLimitService.ts
│   │   ├── RateLimitService.test.ts               🆕 5 tests
│   │   ├── LLMService.ts                          ⏭ 不测（编排层）
│   │   ├── llm/AnthropicLLMClient.ts
│   │   ├── llm/AnthropicLLMClient.test.ts         🆕 8 tests
│   │   ├── llm/OpenAICompatibleLLMClient.ts
│   │   ├── llm/OpenAICompatibleLLMClient.test.ts  🆕 9 tests
│   │   ├── llm/LLMClientFactory.ts
│   │   ├── llm/LLMClientFactory.test.ts           🆕 4 tests
│   │   ├── ItineraryPlanningService.ts            ⏭ 不测（编排层）
│   │   ├── TransitAccessibilityService.ts         ⏭ 不测（fetch wrapper）
│   │   └── AmapPoiSearchService.ts                ⏭ 不测（fetch wrapper）
│   └── utils/
│       ├── environment.ts
│       ├── environment.test.ts                     🆕 23 tests
│       ├── request-ip-extractor.ts
│       ├── request-ip-extractor.test.ts           🆕 6 tests
│       └── ...
└── components/
    └── map/
        ├── map-helpers.ts                          🆕 抽取
        ├── map-helpers.test.ts                     🆕 30 tests
        ├── forceLayout.ts
        ├── forceLayout.test.ts                     ✅ 已测
        └── SimplifiedMap.tsx                       ✏️ 改 import
```

## `map-helpers.ts` 抽取原则

**SOLID / DRY 应用**：

- `SimplifiedMap` 是 React 渲染层（view）
- 内部 7 个纯函数是 geometry / text 工具（domain）
- 抽到独立模块后：
  - React 文件不再混入算法逻辑（SRP）
  - 同一份逻辑不在多处重复（DRY）
  - 测试不需要起 React renderer

**API 设计**：

```typescript
// src/components/map/map-helpers.ts
export function formatDistance(meters: number): string;
export function formatDuration(seconds: number): string;
export function deterministicTilt(id: string): number;
export interface LabelRect { x: number; y: number; w: number; h: number; }
export function rectsOverlap(a: LabelRect, b: LabelRect): boolean;
export function clamp(v: number, lo: number, hi: number): number;
export function clampRectToCanvas(rect: LabelRect, w: number, h: number): LabelRect;
export function placeLabel(...): { x: number; y: number } | null;
export function bestEffortLabel(...): { x: number; y: number };
export function labelEdgePoint(...): { x: number; y: number };
export function segmentsIntersect(...): boolean;
export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 600;
```

`SimplifiedMap.tsx` 改为：

```typescript
import { formatDistance, formatDuration, ..., CANVAS_WIDTH } from './map-helpers';
```

**行为不变**：所有函数签名、逻辑、const 数值都与原内联版本一致；唯一的行为差异是 TDD 暴露并修复的 2 个 bug（见 `KNOWN_FAILURES.md`）。

## 测试 mock 策略

### `TransportModeSelector` —— 继承 stub

不依赖 mock 框架，直接继承 `TransitAccessibilityService` 重写 `checkCombinedAccessibility`：

```typescript
class StubTransitService extends TransitAccessibilityService {
  public async checkCombinedAccessibility(
    _origin: TransitAccessibilityInput,
    _destination: TransitAccessibilityInput,
    _thresholdMeters: number,
  ): Promise<CombinedAccessibilityResult> {
    return this.nextResult;
  }
}
```

优点：

- 类型安全（override 必须满足父类签名）
- 无第三方依赖
- 真实测了 `decideForSegments` 的完整流程

### `RateLimitService` —— env 注入

通过 `beforeEach` 临时设置 `LLM_SERVICE_RATE_LIMIT_MAX=3` 和 `LLM_SERVICE_RATE_LIMIT_WINDOW_MS=60000`：

```typescript
beforeEach(() => {
  process.env.LLM_SERVICE_RATE_LIMIT_MAX = '3';
  process.env.LLM_SERVICE_RATE_LIMIT_WINDOW_MS = '60000';
});
afterEach(() => { /* restore */ });
```

注意：`getRateLimitMax()` / `getRateLimitWindowMs()` 是**模块加载时**调用 `getOptionalEnvironmentVariable`，但因为 `RateLimitService` 构造时调用它们，所以 `new RateLimitService()` 必须在 `beforeEach` 之后——这正是 vitest 测试的标准模式。

### LLM 适配器 —— `global.fetch` mock

```typescript
const fetchMock = vi.fn().mockResolvedValueOnce({
  ok: true, status: 200,
  json: () => Promise.resolve({ content: [...] }),
} as unknown as Response);
global.fetch = fetchMock as unknown as typeof fetch;
```

`vi.fn().mockResolvedValueOnce(...)` 一次性消费，每次 `fetch` 调用都精确断言 URL / method / headers / body 字段。

### `environment.ts` —— env 保存/恢复

`beforeEach` 保存所有被覆盖的 env 变量；`afterEach` 还原。这样测试之间不会互相污染。

### `request-ip-extractor` —— 假 `NextRequest`

不需要真 Next.js `NextRequest`，只需提供 `{ headers: { get(name) } }` shape 的对象：

```typescript
function makeRequest(headers: Record<string, string | null>) {
  return { headers: { get: (name) => headers[name.toLowerCase()] ?? null } };
}
```

## 测试中暴露的 bug

| Bug | 文件 | 现象 | 修复 |
|---|---|---|---|
| `deterministicTilt` 范围溢出 | `map-helpers.ts` | `h % 200` 为负 → tilt 落到 `[-1.76, 1]` 之外 | `((h%200)+200)%200` |
| `rectsOverlap` 边缘相切判定反 | `map-helpers.ts` | 边缘相切应判为不重叠，原代码判为重叠 | `<` / `>` 改为 `<=` / `>=` |
| `extractClientIpAddress` 逗号前缀 | `request-ip-extractor.ts` | `,10.0.0.1` 返回空串 | 循环取第一个非空条目 |

三个 bug 都通过 TDD 自然暴露，没有"事先知道 bug 再写测试"。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| `next dev` HMR 看到简化文件多次 reload | `.next` 已 `rm -rf` 后再 `next build` 验证 |
| `vi.fn` 类型断言可能掩盖真实 fetch 类型问题 | 测试用 `as unknown as Response` 双断言，明示是 mock |
| env 测试互相污染 | `beforeEach` / `afterEach` 严格保存恢复 |