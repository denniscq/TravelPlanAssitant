# Design: route-plan-queue

## 概述

为 `/api/llm/route-plan` 端点引入进程内请求队列，保证同一时刻最多只有 1 个昂贵的 itinerary 生成任务在执行，其余最多 4 个请求排队等待。超出上限立即返回 HTTP 429 + `Retry-After: 10`。

完整背景与方案选择见 [docs/superpowers/specs/2026-08-26-route-plan-queue-design.md](file:///c:/Dennis/TravelPlanAssistant/docs/superpowers/specs/2026-08-26-route-plan-queue-design.md)。

## 数据结构

```typescript
interface QueueTask {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class QueueFullError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'QueueFullError';
  }
}

class RoutePlanQueue {
  private waiting: QueueTask[] = [];
  private activeCount = 0;
  private readonly maxLength: number;

  public constructor(maxLength: number) {
    if (!Number.isInteger(maxLength) || maxLength < 1) {
      throw new Error(
        `RoutePlanQueue: maxLength must be a positive integer, got ${maxLength}`
      );
    }
    this.maxLength = maxLength;
  }

  public enqueue<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.waiting.length >= this.maxLength) {
        reject(new QueueFullError(
          `RoutePlanQueue is full (${this.waiting.length}/${this.maxLength})`
        ));
        return;
      }
      this.waiting.push({
        run: work as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.drain();
    });
  }

  public getStats(): { active: number; waiting: number; maxLength: number } {
    return {
      active: this.activeCount,
      waiting: this.waiting.length,
      maxLength: this.maxLength,
    };
  }

  private drain(): void {
    if (this.activeCount > 0 || this.waiting.length === 0) {
      return;
    }
    const task = this.waiting.shift()!;
    this.activeCount++;
    Promise.resolve()
      .then(() => task.run())
      .then(
        (value) => {
          this.activeCount--;
          task.resolve(value);
          this.drain();
        },
        (reason) => {
          this.activeCount--;
          task.reject(reason);
          this.drain();
        },
      );
  }
}

export const routePlanQueue = new RoutePlanQueue(
  getRoutePlanQueueMaxLength()
);
```

### 关键设计决策

1. **`waiting.length` 而非 `waiting.length + activeCount` 检查上限**
   - 因为 `activeCount` 永远是 0 或 1（串行调度）
   - 上限 5 = 1 active + 4 waiting 中的 **waiting = 4**

2. **`Promise.resolve().then(run)` 而非直接调用**
   - 让 `run` 在 microtask 中执行
   - 确保调用 `enqueue` 的栈先展开，避免 `activeCount` 自增期间出现竞争

3. **错误传播到调用方**
   - `run` 抛错 → 调用方拿到的 Promise 也 reject
   - 队列本身不 catch（让上层路由统一处理）

4. **错误后继续调度下一个**
   - 即使 task 失败，`drain()` 仍被调用
   - 这就是"原子完成（不论成功失败）"的实现

5. **构造时正整数校验**
   - `maxLength` 必须为 `Number.isInteger` 且 `≥ 1`，否则构造抛错
   - 避免运行时出现"0 上限"导致所有 enqueue 都立即 reject 的状态

## 集成策略

[src/app/api/llm/route-plan/route.ts](file:///c:/Dennis/TravelPlanAssistant/src/app/api/llm/route-plan/route.ts) 的改动范围：

```diff
 import { rateLimitService } from '...';
 import { itineraryPlanningService } from '...';
+import { routePlanQueue, QueueFullError } from '...';
 import { createServerLogger } from '...';

 export async function POST(request: NextRequest): Promise<NextResponse> {
   const logger = createServerLogger(request);
   try {
     const clientIp = extractClientIpAddress(request);
     const rateLimitResult = await rateLimitService.checkRateLimit(clientIp);
     if (!rateLimitResult.isAllowed) { /* 429 + Retry-After */ }

     let requestBody: unknown;
     try { requestBody = await request.json(); }
     catch { return NextResponse.json({ aborted: true }); }
     const validatedRequest = validateRoutePlanRequest(requestBody);

     let result;
     try {
       result = await routePlanQueue.enqueue(() =>
         itineraryPlanningService.generateItinerary(
           validatedRequest.startLocation,
           // ...
           logger,
         )
       );
     } catch (queueErr) {
       if (queueErr instanceof QueueFullError) {
         const stats = routePlanQueue.getStats();
         logger.warn(`Route plan queue is full - rejecting. stats=${JSON.stringify(stats)}`);
         return NextResponse.json(
           { success: false, error: 'Server is busy. Please retry shortly.' },
           { status: 429, headers: { 'Retry-After': '10' } }
         );
       }
       throw queueErr;
     }
     // ...
   }
 }
```

**关键顺序**：

1. IP 提取（已有）
2. Rate limit 检查（已有）
3. Body 解析 + 校验（已有）
4. **Queue enqueue**（新增）— 在调用 `itineraryPlanningService` 之前
5. Itinerary 生成（已有，包在 queue 内）
6. 返回响应（已有）

**为什么 enqueue 在 rate limit 之后？**

- 无效请求（被 rate limit 拦截）不应该占队列位置
- 队列只保护"已经通过 rate limit 的合法请求"之间的并发

## 测试设计

[src/lib/services/RoutePlanQueue.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/RoutePlanQueue.test.ts) 必须覆盖（共 8 tests）：

| # | 测试名 | 断言 |
|---|---|---|
| 1 | `空队列入队立即执行` | enqueue 后 active=1, waiting=0 |
| 2 | `enqueue 不阻塞调用` | enqueue 同步返回 Promise，调用方不用 await 调度 |
| 3 | `串行执行第二个任务` | 第一个 await 时第二个 waiting=1；第一个 resolve 后第二个执行 |
| 4 | `错误传播到调用方` | run 抛错 → enqueue 返回的 Promise reject 同样的 error |
| 5 | `错误后继续调度下一个` | 第一个抛错后 waiting[0] 仍执行 |
| 6 | `超过 maxLength 立即拒绝` | 第 6 个 enqueue 立即 reject QueueFullError |
| 7 | `getStats 准确反映状态` | 不同时刻的 active/waiting 数字精确 |
| 8 | `大量并发入队只前 N 个成功` | enqueue 10 个任务，前 5 个 resolve、后 5 个 reject |

注意测试 #8：实测结果为"1 active + 4 waiting 共 5 个成功，2 个立即 reject QueueFullError"——`waiting.length` 是**只有等待者**，active 不计入。

## 配置

[src/lib/utils/environment.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/utils/environment.ts)：

```typescript
export function getRoutePlanQueueMaxLength(): number {
  const raw = getOptionalEnvironmentVariable(
    'ROUTE_PLAN_QUEUE_MAX_LENGTH',
    '5',
  );
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    console.warn(
      `[environment] Invalid ROUTE_PLAN_QUEUE_MAX_LENGTH="${raw}", falling back to default 5`
    );
    return 5;
  }
  return parsed;
}
```

`.env.local`（用户可选）：

```bash
ROUTE_PLAN_QUEUE_MAX_LENGTH=5
```

## 文件改动清单

| 操作 | 文件 | 内容 |
|---|---|---|
| 新建 | `src/lib/services/RoutePlanQueue.ts` | `QueueFullError` + `RoutePlanQueue` + 单例 `routePlanQueue` |
| 新建 | `src/lib/services/RoutePlanQueue.test.ts` | Vitest 单测（8 tests） |
| 修改 | `src/app/api/llm/route-plan/route.ts` | 集成 enqueue + 处理 QueueFullError |
| 修改 | `src/lib/utils/environment.ts` | 新增 `getRoutePlanQueueMaxLength` |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 队列过长占内存 | `maxLength=5` 是硬限制 |
| 长任务阻塞后续 | LLM 已有 90s `AbortSignal.timeout` |
| HMR 状态丢失 | 开发期可接受，生产无影响 |
| 客户端重试风暴 | HTTP 429 + `Retry-After: 10` 让客户端主动退避 |
| 单进程假设 | Next.js 默认单进程 Node runtime；如未来部署到 edge 需重新评估 |