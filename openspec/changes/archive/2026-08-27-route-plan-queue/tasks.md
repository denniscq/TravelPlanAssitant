# Tasks: route-plan-queue

执行顺序遵循 TDD：先写测试，再写实现，再集成，最后回归验证。

## 1. 测试基础设施

- [x] 1.1 确认 `vitest` 已配置（已在 `package.json` 与 `vitest.config.ts` 中就位，无需额外安装）

## 2. 编写 `RoutePlanQueue` 单元测试（RED → GREEN）

- [x] 2.1 新建 [src/lib/services/RoutePlanQueue.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/RoutePlanQueue.test.ts)
- [x] 2.2 测试：空队列入队立即执行（active=1, waiting=0）
- [x] 2.3 测试：enqueue 同步返回 Promise，不阻塞调用
- [x] 2.4 测试：串行执行第二个任务（第一个未完成时第二个 waiting）
- [x] 2.5 测试：错误传播到调用方
- [x] 2.6 测试：错误后继续调度下一个（原子语义）
- [x] 2.7 测试：超过 maxLength 立即 reject `QueueFullError`
- [x] 2.8 测试：`getStats` 准确反映 active/waiting
- [x] 2.9 测试：大量并发入队只前 N 个成功
- [x] 2.10 测试运行结果：8/8 全通过（vitest run `src/lib/services/RoutePlanQueue.test.ts`）

## 3. 实现 `RoutePlanQueue`（GREEN）

- [x] 3.1 新建 [src/lib/services/RoutePlanQueue.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/services/RoutePlanQueue.ts)（134 行）
- [x] 3.2 实现 `QueueFullError` 类（继承自 `Error`，`name = 'QueueFullError'`）
- [x] 3.3 实现 `RoutePlanQueue` class（含 `enqueue<T>`、`getStats`、私有 `drain`、构造时正整数校验）
- [x] 3.4 模块作用域单例 `routePlanQueue`，构造时调用 `getRoutePlanQueueMaxLength()`
- [x] 3.5 测试 8/8 全通过（GREEN）

## 4. 集成环境变量配置

- [x] 4.1 修改 [src/lib/utils/environment.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/utils/environment.ts)，新增 `getRoutePlanQueueMaxLength()`
- [x] 4.2 处理无效值（非数字、< 1、0）回退到默认 5 并 `console.warn`
- [x] 4.3 编写 `environment.ts` 中 `getRoutePlanQueueMaxLength` 的单测（含在 [src/lib/utils/environment.test.ts](file:///c:/Dennis/TravelPlanAssistant/src/lib/utils/environment.test.ts) 中，共 23 tests）

## 5. 集成到 `/api/llm/route-plan` 路由

- [x] 5.1 修改 [src/app/api/llm/route-plan/route.ts](file:///c:/Dennis/TravelPlanAssistant/src/app/api/llm/route-plan/route.ts)，import `routePlanQueue` 与 `QueueFullError`
- [x] 5.2 在 `itineraryPlanningService.generateItinerary` 调用外层包 `routePlanQueue.enqueue`
- [x] 5.3 在 rate limit 检查**之后**调用 enqueue（无效请求不占队列位置）
- [x] 5.4 catch `QueueFullError` → 返回 HTTP 429 + `Retry-After: 10` + 错误消息
- [x] 5.5 添加 `logger.warn` 记录队列满事件（含 `getStats()`）

## 6. 验证

- [x] 6.1 `npx tsc --noEmit` 通过（0 errors）
- [x] 6.2 `npm test` 全部通过（11 test files / 123 tests）
- [x] 6.3 `npx next build` 通过（Compiled successfully，13/13 静态页面生成）
- [x] 6.4 队列单元测试覆盖大量并发场景（test #8：10 并发入队，5 成功 + 2 立即 reject）

## 7. 更新 memory 文件

- [x] 7.1 更新 `.superpowers-memory/CURRENT_STATE.md`：记录队列实现完成 + 测试覆盖完成
- [x] 7.2 更新 `.superpowers-memory/DECISIONS.md`：新增 "route-plan-queue" 决策条目 + "test-coverage-expansion" 决策条目
- [x] 7.3 更新 `.superpowers-memory/KNOWN_FAILURES.md`：标记此前的并发 QPS 问题为已缓解
- [x] 7.4 在 `.superpowers-memory/session-journal/` 添加本次会话日志
- [x] 7.5 不适用 `scripts/validate-superpowers-memory.ps1`（脚本未在仓库中创建）