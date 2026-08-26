# Tasks: SimplifiedMap Label 全局反重叠 + 统一 Max Size

## 1. 类型与常量

- [ ] 1.1 在 [SimplifiedMap.tsx](file:///c:/Dennis/TravelPlanAssistant/src/components/map/SimplifiedMap.tsx) 新增常量 `MAX_LABEL_CHARS_PER_LINE = 6`、`MAX_LABEL_LINES = 3`、`MIN_LABEL_GAP = SEGMENT_BADGE_RADIUS * 2 + 8 = 30`
- [ ] 1.2 在 `RenderableNode` 接口新增 `pinned?: boolean` 字段（起/终点为 true）
- [ ] 1.3 在 `RenderableNode` 接口新增 `anchorX?: number` / `anchorY?: number` 字段（保留 projected 锚点，供 fallback 用）

## 2. Label 尺寸统一

- [ ] 2.1 改 `computeLabelSize(text, hasSubtitle)` 函数：
  - width 固定 `MAX_LABEL_CHARS_PER_LINE * CHAR_WIDTH_PX + 2 * LABEL_PAD_X = 104px`
  - height 固定 `3 * LABEL_LINE_HEIGHT + subtitleLineHeight + 2 * LABEL_PAD_Y = 84px` (含副标题)
  - POI 名按 6 字/行换行，最多 3 行；超过 18 字截断为 "前 17 字 + …"

## 3. 起/终点钉死

- [ ] 3.1 在放置循环中检测 `spec.isStart` / `spec.isEnd`
- [ ] 3.2 起/终点 label 直接用 projected anchor：起点 (anchorX - w/2, anchorY + 4)，终点 (anchorX - w/2, anchorY - h - 4)
- [ ] 3.3 其他 POI 仍走 `placeLabel` + `bestEffortLabel` fallback
- [ ] 3.4 起/终点的 `RenderableNode.pinned = true`

## 4. 全局反重叠 Pass

- [ ] 4.1 新增私有函数 `enforceGlobalLabelSeparation(nodes: RenderableNode[], maxIter = 8)`
- [ ] 4.2 函数实现：
  - 5-8 轮迭代，对所有 `(i, j)` 对检查 AABB 重叠 OR 中心距 < `MIN_LABEL_GAP`
  - 计算推开方向（从 a 中心到 b 中心的单位向量）和推开距离
  - 按 weight（pinned=Infinity, restaurant=0.7, attraction=1.0）分配偏移
  - 边界钳制到 `[4, CANVAS_WIDTH - w - 4]` × `[4, CANVAS_HEIGHT - h - 4]`
  - 收敛条件：total overlap < 1px
- [ ] 4.2 收敛失败 fallback：所有 `!pinned` 的节点重置到 anchor 位置
- [ ] 4.3 在 segment 沿连线 pass **之前**调用 `enforceGlobalLabelSeparation(nodes)`
- [ ] 4.4 每次迭代后更新 `cx` = `labelRect.x + w/2`、`cy` = `labelRect.y + h/2`

## 5. 验证

- [ ] 5.1 启动 `npm run dev`，手工触发一次大连 8 站点行程（包含东港音乐喷泉广场、中山广场亚朵酒店、老虎滩、星海广场、日月昇渔家菜等已知重叠场景）
- [ ] 5.2 检查：
  - 起/终点位置严格保持真坐标
  - 所有 label rect 尺寸一致（104 × 84px）
  - 任意两个 label 矩形之间至少 30px 间距
  - 极端密集场景（如 4 POI 同区域）能 fallback 到原样显示
- [ ] 5.3 跑 `npm test` 确认现有 20 个测试全部通过
- [ ] 5.4 跑 `npx tsc --noEmit` 确认 0 错误

## 6. 文档与收尾

- [ ] 6.1 更新 `.superpowers-memory/CURRENT_STATE.md`：记录 label 全局反重叠完成
- [ ] 6.2 新增 session journal 条目：本次会话要点（关键决策：label size 统一 max + 起/终点钉死 + 全局 AABB 反重叠 pass）
- [ ] 6.3 把 design.md / tasks.md 复制到 `docs/superpowers/specs/` 作为长期文档
- [ ] 6.4 归档 OpenSpec change：移动 `openspec/changes/simplified-map-label-overlap/` 到 `openspec/changes/archive/2026-08-25-simplified-map-label-overlap/`
