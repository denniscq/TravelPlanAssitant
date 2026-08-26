# Proposal: SimplifiedMap Label 全局反重叠 + 统一 Max Size

## Why

用户反馈（2026-08-25）：当前大连 8 站点行程的 SVG 简图中，**多个 label 仍然相互遮挡**。典型重叠场景：
- 东港音乐喷泉广场 ↔ 大连中山广场亚朵酒店 ↔ 大连老虎滩海洋公园 三者挤在同一区域
- 大嘴自助餐厅 ↔ 日月昇渔家菜(星海广场店) 在星海广场附近重叠
- 渔人码头 ↔ 听浪鱼生饭 在老虎滩附近重叠

根因（[SimplifiedMap.tsx:443-465](file:///c:/Dennis/TravelPlanAssistant/src/components/map/SimplifiedMap.tsx#L443-L465)）：

1. **Label size 不统一**：每个 label 按 POI 名实际长度算 `w` / `h`。POI 名越长，label rect 越大，与邻居更容易相撞。重叠距离短的 POI 名（如"东港音乐喷泉广场"7字 = 14 行 char）vs "日月昇渔家菜(星海广场店)" 13字 = 26 行 char，size 差异巨大。
2. **避让只沿 segment 方向**：[SimplifiedMap.tsx:587-612](file:///c:/Dennis/TravelPlanAssistant/src/components/map/SimplifiedMap.tsx#L587-L612) 的 12 轮迭代只检查**有序相邻的两个 POI** 之间沿连线方向的 `gap`，**不检查不相邻的 POI label**（如星海广场 ↔ 日月昇渔家菜 路径上没有 segment）。
3. **起/终点未钉死**：当前用 `placeLabel` + 4 方向候选 + bestEffort fallback，候选位置可能挪很远，导致起/终点偏离真坐标。

用户已经接受了之前的 SimplifiedMap 力导向替换、badge 起点侧偏移等修复，但 POI 群过密时仍需**全局反重叠**。

## What Changes

### Label size 统一 Max

把 [SimplifiedMap.tsx:443-453](file:///c:/Dennis/TravelPlanAssistant/src/components/map/SimplifiedMap.tsx#L443-L453) 的 `computeLabelSize()` 改为返回**固定 max size**：

- Width = `MAX_LABEL_CHARS_PER_LINE × CHAR_WIDTH_PX + 2 × LABEL_PAD_X` = `6 × 14 + 20 = 104px`
- Height = `MAX_LABEL_LINES × LABEL_LINE_HEIGHT + subtitleLineHeight + 2 × LABEL_PAD_Y` = `3 × 18 + 18 + 12 = 84px` (含一行时间副标题)
- POI 名超过 6×3 = 18 字时，截断为 "前N字..."（N=17，留 1 个字给省略号）
- 所有 POI（起点、终点、景点、餐厅）一律相同 max size → 重叠计算简洁

### 全局 POI Label 反重叠 Pass

新增独立的"全局反重叠"步骤（在现有 segment 12 轮迭代**之前**），因为：

- 全局 pass 需要同时考虑**所有 POI 对**（O(N²)），不是 O(N) 邻居对
- 全局 pass 用 AABB 重叠检测，比 `rectProjectionsAlong` 简单
- 起/终点钉死后无法推开，所以先做全局 pass 把内部 POI 推开，再做 segment pass 把 segments 推开

算法（5-8 轮迭代收敛）：

1. 计算每对 POI label rect 的 AABB 重叠量 + center-to-center 距离
2. 如果 AABB 重叠 OR 中心距 < `MIN_LABEL_GAP`（= `SEGMENT_BADGE_RADIUS × 2 + 8 = 30px`），需要推开
3. 推开方向：从 A 到 B 的单位向量（指向对方中心）
4. 推开权重：起/终点 weight = ∞（不挪），景点 weight = 1.0，餐厅 weight = 0.7（餐厅更易挪）
5. 分配偏移：`da = (overlap / (wa + wb)) × ux`, `db = -overlap × wb/(wa+wb) × ux`（按 weight 比例反推）
6. 边界钳制：label 距画布边缘至少 4px
7. 收敛条件：5 轮迭代后重叠量 < 1px

### 起/终点钉死

- 把当前 `placeLabel` / `bestEffortLabel` 对**起/终点**的处理改为：直接用真实投影位置，**不调用 4 方向候选**
- 起点 label 在锚点的**下方**，终点 label 在锚点的**上方**（避免与起点 label 在一条线上重叠）
- 如果起/终点 label 真的与其他 POI 重叠（不可能但兜底），全局 pass 时 weight = ∞ 强制其他 POI 躲开

### Segment Badge 起点侧固定偏移（保留之前的改动）

当前已有的 [SimplifiedMap.tsx:645-680](file:///c:/Dennis/TravelPlanAssistant/src/components/map/SimplifiedMap.tsx#L645-L680) `FROM_SIDE_BADGE_OFFSET = 45px` 已经把 badge 移到起点侧。**全局 pass 用的最小间距 = `SEGMENT_BADGE_RADIUS × 2 + 8 = 30px`** 比 badge 直径 (22px) 大 8px buffer，刚好容纳 badge + 一道边距。

### 改动文件清单

- `src/components/map/SimplifiedMap.tsx`：
  - 加常量 `MAX_LABEL_CHARS_PER_LINE = 6`、`MAX_LABEL_LINES = 3`、`MIN_LABEL_GAP = 30`
  - 改 `computeLabelSize()` 返回固定 max size + 截断长名
  - 起/终点跳过 4 方向候选，直接用真坐标 + 固定偏移（下/上）
  - 新增 `enforceGlobalLabelSeparation(result)` 函数（5-8 轮迭代 AABB 反重叠）
  - 在现有 segment 迭代之前调用 `enforceGlobalLabelSeparation`
  - 保留 segment 沿连线方向推开逻辑（与全局 pass 互补）

## Capabilities

### Modified Capabilities

- `simplified-map-layout`：扩"POI label 放置"要求——
  - label rect 必须统一 max size（6 字 × 3 行）
  - 任意两个 label 之间最小间距 = `SEGMENT_BADGE_RADIUS × 2 + 8 = 30px`
  - 起/终点钉死在真实投影位置（weight = ∞）
  - 全局反重叠 pass 必须先于 segment 沿连线方向 pass

## Impact

- 受影响的代码：仅 `src/components/map/SimplifiedMap.tsx`（单文件改动）
- 受影响的 API：无
- 性能：8 POI × 7 对 × 5 轮迭代 ≈ 280 次 AABB 检查（< 1ms）
- 风险：当 POI 群过密（如大连老虎滩区域 4 POI 真实坐标半径 < 1km）时，全局 pass 可能无法在 5 轮内收敛 → fallback 到按实坐标原样显示（保留用户当前观察）
- 视觉：起/终点位置严格保持真坐标，内部 POI 沿径向推开 → 仍可看出真实相对位置

## Out of Scope

- 不改 `AmapRouteCalculationService`、`LLMService`、`ItineraryPlanningService`
- 不改 segment 沿连线方向 12 轮迭代逻辑（保留，与全局 pass 互补）
- 不实现"按 POI 群聚"自动 zoom（先解决 overlap，zoom 是后续优化）
- 不改 badge 样式 / 颜色 / 位置逻辑
- 不引入新依赖
- 不动 layout 的 SVG viewport / canvas size
