# Proposal: `/api/llm/route-plan` 请求队列（route-plan-queue）

## Why

`/api/llm/route-plan` 是整个系统的"昂贵端点"。一次成功响应会触发：

- 1 次 LLM 调用（30-90s）
- 多次高德 place-around / place / direction 查询（POI ×250ms 串行 + 段 ×4 模式）

### 现状问题

两个客户端同时点击"生成路线"时：

1. 各自进入 `itineraryPlanningService.generateItinerary`
2. 内部虽然已按 step 串行调用，但**两个请求并行**触发
3. 高德 transit / direction API 触发 `CUQPS_HAS_EXCEEDED_THE_LIMIT` → 多个 segment 失败
4. LLM 端也可能触发速率限制
6. **两个请求都失败**，用户两边都看不到结果

### 约束（来自用户）

- 不引入第三方组件（无 Redis / BullMQ / 数据库 queue）
- 程序代码级别实现
- 默认 5 个并发上限（active ≤ 1 + waiting ≤ 4），可通过环境变量覆盖
- 超出上限直接 HTTP 429 + `Retry-After: 10`
- 客户端透明等待（不暴露 queue 状态给前端）

## What Changes

### 新增 `RoutePlanQueue` class

独立、可单测的内存队列服务。位置：[src/lib/services/RoutePlanQueue.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/RoutePlanQueue.ts)（实测 134 行）。

```typescript
class QueueFullError extends Error {}

class RoutePlanQueue {
  private waiting: Array<Task> = [];
  private activeCount = 0;
  private readonly maxLength: number;

  constructor(maxLength: number) {
    if (!Number.isInteger(maxLength) || maxLength < 1) {
      throw new Error(`RoutePlanQueue: maxLength must be a positive integer, got ${maxLength}`);
    }
    this.maxLength = maxLength;
  }

  enqueue<T>(work: () => Promise<T>): Promise<T>;
  getStats(): { active: number; waiting: number; maxLength: number };
}
```

行为契约：

1. **构造校验**：`maxLength` 必须为正整数，构造函数会抛 `Error`。
2. **enqueue 返回的 Promise**：
   - `waiting.length < maxLength` → 入队，调度
   - `waiting.length >= maxLength` → 立即 reject `QueueFullError`
3. **调度规则**：
   - `activeCount === 0 && waiting.length > 0` → 取出队首，`activeCount++`，在 `Promise.resolve().then(run)` 微任务中执行
   - 任务完成（成功或失败）→ `activeCount--`，再次 `drain()`
4. **错误传播**：`run` 抛错 → 调用方的 Promise 也 reject；不 catch（让上层路由统一处理）
5. **单例**：模块作用域实例 `routePlanQueue`，Next.js dev 模式 HMR 会重置模块，状态清空（可接受）

### 集成到 `/api/llm/route-plan` 路由

修改 [src/app/api/llm/route-plan/route.ts](file:///c:/Dennis/TravelPlanAssistant/src/app/api/llm/route-plan/route.ts)：

```typescript
// 执行顺序：
//  1. extractClientIpAddress
//  2. rateLimitService.checkRateLimit
//  3. request.json() + validate
//  4. routePlanQueue.enqueue(() => itineraryPlanningService.generateItinerary(...))
//  5. QueueFullError -> 429 + Retry-After: 10
```

**关键顺序**：`enqueue` 在 `rateLimitService.checkRateLimit` **之后**、在调用 `itineraryPlanningService` **之前**。这样：

- 无效请求（被 rate limit 拦截）不占队列位置
- 队列只保护"已经通过 rate limit 的合法请求"之间的并发

`QueueFullError` 分支返回：

```json
HTTP/1.1 429 Too Many Requests
Retry-After: 10

{
  "success": false,
  "error": "Server is busy. Please retry shortly."
}
```

### 新增环境变量配置

[src/lib/utils/environment.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/utils/environment.ts) 新增 `getRoutePlanQueueMaxLength()`：

```typescript
export function getRoutePlanQueueMaxLength(): number {
  const raw = getOptionalEnvironmentVariable('ROUTE_PLAN_QUEUE_MAX_LENGTH', '5');
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    console.warn(`[environment] Invalid ROUTE_PLAN_QUEUE_MAX_LENGTH="${raw}", falling back to default 5`);
    return 5;
  }
  return parsed;
}
```

`.env.local`（用户自行配置，可选）：

```bash
ROUTE_PLAN_QUEUE_MAX_LENGTH=5
```

## Capabilities

### Modified Capabilities

- `ai-route-planning`：扩展 `/api/llm/route-plan` 的并发行为要求
  - 请求必须串行执行（最多 1 active）
  - 默认上限 5（1 active + 4 waiting）
  - 超出立即返回 HTTP 429 + `Retry-After: 10`
  - 错误传播到调用方，错误不阻塞队列

## Impact

- 受影响的代码：
  - **新增** [src/lib/services/RoutePlanQueue.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/RoutePlanQueue.ts)（134 行）
  - **新增** [src/lib/services/RoutePlanQueue.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/RoutePlanQueue.test.ts)（8 tests）
  - **修改** [src/app/api/llm/route-plan/route.ts](file:///c:/Dennis/TravelPlanAssistant/src/app/api/llm/route-plan/route.ts)（包 enqueue + QueueFullError 处理）
  - **修改** [src/lib/utils/environment.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/utils/environment.ts)（新增 `getRoutePlanQueueMaxLength`）
- 受影响的 API：`/api/llm/route-plan` 的语义不变，仅增加 429 + Retry-After 行为
- 性能：enqueue 调度是 O(1)，无额外开销
- 风险：
  - 客户端轮询 / 重试风暴可能加剧排队压力——429 + Retry-After 让客户端主动退避
  - 长任务（LLM 90s）会阻塞最多 4 个等待者——但 LLM 已有 90s AbortSignal.timeout

## Out of Scope

- 不引入分布式锁（Next.js 单进程足够）
- 不做超时（已有 AbortSignal.timeout）
- 不做优先级（FIFO）
- 不做持久化队列（崩溃后清空可接受）
- 不暴露队列状态给前端（透明等待）
- 不改 LLMService / ItineraryPlanningService 内部串行行为
- 不改 rateLimitService 行为