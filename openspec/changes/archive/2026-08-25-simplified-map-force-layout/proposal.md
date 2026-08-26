# Proposal: Simplified Map 力导向布局重构

## Why

当前 `SimplifiedMap` 组件使用 "顺序方位角布局 + 对数距离压缩" 算法，在渲染出的示意图上产生三个用户可见的缺陷：

1. 序号徽章漂移到空白处（`RouteDetailMarkers` 走真实 AMap 坐标系，与简图独立坐标系对不上）。
2. 沿线文字角度错乱（按真实 polyline 方向贴标签，但简图线段是压缩后的直线）。
3. 中间节点处线段视觉上断开（顺序累积方位角导致路径交叉、折返或错位）。

当前算法的根本问题是它本质上是 "地理坐标模拟器"，而不是 "路线示意图生成器"。两者目标冲突，需要从根上替换。

## What Changes

- 新增纯函数 `forceLayout`，实现力导向布局算法（弹簧力 + 排斥力 + 向心力 + 角度约束）。
- 重写 `src/components/map/SimplifiedMap.tsx`，用 SVG 单画布统一渲染节点、线段、标签，消除双坐标系统问题。
- 新增 `src/components/map/SimplifiedMap.test.ts`，对 `forceLayout` 进行单测（确定性、距离排序、钉死锚点、收敛性）。
- 不动真实 AMap 上的 `MarkerWithPopup`、`RouteDetailMarkers`、`RouteLine`（它们各管各的职责）。

## Capabilities

### New Capabilities

- `simplified-map-layout`：简图的视觉布局能力 —— 力导向算法、确定性、手绘铅笔视觉、标签防碰撞。覆盖 `SimplifiedMap` 组件的全部需求行为。

### Modified Capabilities

（无。本次改动是新增能力；`map-visualization` 描述的是真实 AMap 行为，未被触动。）

## Impact

- 受影响的代码：
  - `src/components/map/SimplifiedMap.tsx`：完全重写。
  - `src/components/map/RouteLine.tsx`、`RouteDetailMarkers.tsx`：不变（属于真实地图）。
- 受影响的依赖：无（纯 React/TS 实现，不引入新依赖）。
- 受影响的 API：组件 props 接口保持不变，`StepRoutePlan.tsx` 无需调整。
- 性能：力导向迭代在 useMemo 中执行，最多 300 轮，对单日 POI（通常 ≤ 10 个）足够快。
- 测试：新增 `forceLayout` 单元测试，单测覆盖算法关键不变式。
