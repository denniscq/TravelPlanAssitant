# Design: SimplifiedMap Label 全局反重叠 + 统一 Max Size

## Context

当前 [SimplifiedMap.tsx:443-465](file:///c:/Dennis/TravelPlanAssistant/src/components/map/SimplifiedMap.tsx#L443-L465) 的 label 放置流程：

1. `computeLabelSize(text)` 按 POI 名实际长度算 width/height（不统一）
2. `placeLabel(anchorX, anchorY, w, h, placed)` 尝试 4 方向候选（找不到完美位 → fallback）
3. 若仍重叠 → `bestEffortLabel` 找"最不重叠"的位置
4. 按 `orderedPoiIds` 顺序做相邻对沿连线方向的 de-overlap（12 轮迭代）

**缺失**：
- Label size 随 POI 名长度变化 → 重叠计算复杂
- 全局反重叠（只处理 segment 相邻对）
- 起/终点未钉死（会被候选位置推走）

约束：
- 不引入新依赖
- 单文件改动（`SimplifiedMap.tsx`）
- 代码注释用英文（用户规则）

## Goals / Non-Goals

**Goals:**

- 所有 POI label 矩形尺寸统一 max size（6 字 × 3 行 = 104 × 84px）
- 任意两个 label 之间最小间距 = `SEGMENT_BADGE_RADIUS × 2 + 8 = 30px`
- 起/终点钉死在真坐标（不动）
- 全局反重叠 pass 先于 segment 沿连线 pass
- 重叠无法收敛时 fallback 到真坐标（保留当前行为）

**Non-Goals:**

- 不改 `AmapRouteCalculationService`、`LLMService`、`ItineraryPlanningService`
- 不实现自动 zoom / 自适应 viewport
- 不改 SVG viewport / canvas size
- 不改 segment 沿连线方向 pass（与全局 pass 互补）
- 不改 badge 起点侧 45px 偏移逻辑

## Decisions

### 1. Label max size 计算

```ts
const MAX_LABEL_CHARS_PER_LINE = 6;
const MAX_LABEL_LINES = 3;
const MIN_LABEL_GAP = 30; // = 11 * 2 + 8

const computeLabelSize = (name: string, hasSubtitle: boolean) => {
  // Wrap and truncate to MAX_LABEL_LINES lines of MAX_LABEL_CHARS_PER_LINE chars
  const lines: string[] = [];
  for (let i = 0; i < name.length && lines.length < MAX_LABEL_LINES; i += MAX_LABEL_CHARS_PER_LINE) {
    const remaining = name.length - i;
    const chunk = name.slice(i, i + MAX_LABEL_CHARS_PER_LINE);
    if (lines.length === MAX_LABEL_LINES - 1 && remaining > MAX_LABEL_CHARS_PER_LINE) {
      // Last allowed line: truncate to (MAX_CHARS - 1) chars + ellipsis
      lines.push(chunk.slice(0, MAX_LABEL_CHARS_PER_LINE - 1) + '…');
    } else {
      lines.push(chunk);
    }
  }
  // Width = full max (regardless of actual content length)
  const w = MAX_LABEL_CHARS_PER_LINE * CHAR_WIDTH_PX + 2 * LABEL_PAD_X;
  const h = MAX_LABEL_LINES * LABEL_LINE_HEIGHT +
            (hasSubtitle ? LABEL_LINE_HEIGHT : 0) +
            2 * LABEL_PAD_Y;
  return { w, h, lines };
};
```

**理由**：所有 POI 同样 size → AABB 检测简洁 → 用户能预期。

### 2. 起/终点钉死

```ts
// Inside the placement loop:
const isStart = spec.isStart;
const isEnd = spec.isEnd;
let placedPos: { x: number; y: number };
if (isStart) {
  // Directly below the projected anchor
  placedPos = { x: spec.x - w / 2, y: spec.y + 4 };
} else if (isEnd) {
  // Directly above the projected anchor
  placedPos = { x: spec.x - w / 2, y: spec.y - h - 4 };
} else {
  placedPos = placeLabel(spec.x, spec.y, w, h, placed) ??
              bestEffortLabel(spec.x, spec.y, w, h, placed);
}
```

**理由**：起/终点是行程的"锚点"，必须出现在真坐标附近，否则地图失去"地理正确"的视觉特征。

### 3. 全局反重叠 Pass

新增独立函数 `enforceGlobalLabelSeparation(nodes, maxIter = 8)`：

```ts
function enforceGlobalLabelSeparation(nodes: NodeWithLabel[], maxIter = 8) {
  for (let iter = 0; iter < maxIter; iter++) {
    let totalOverlap = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const aRect = a.labelRect;
        const bRect = b.labelRect;
        const aCenter = { x: aRect.x + aRect.w / 2, y: aRect.y + aRect.h / 2 };
        const bCenter = { x: bRect.x + bRect.w / 2, y: bRect.y + bRect.h / 2 };
        const dx = bCenter.x - aCenter.x;
        const dy = bCenter.y - aCenter.y;
        const dist = Math.hypot(dx, dy);

        // Compute AABB overlap
        const overlapX = Math.max(0, Math.min(aRect.x + aRect.w, bRect.x + bRect.w) - Math.max(aRect.x, bRect.x));
        const overlapY = Math.max(0, Math.min(aRect.y + aRect.h, bRect.y + bRect.h) - Math.max(aRect.y, bRect.y));
        const aabbOverlap = overlapX > 0 && overlapY > 0;

        const minDist = MIN_LABEL_GAP;
        const needsMove = aabbOverlap || (dist < minDist && dist > 1e-3);
        if (!needsMove) continue;

        // Compute unit vector from a to b
        const ux = dist > 1e-3 ? dx / dist : 1;
        const uy = dist > 1e-3 ? dy / dist : 0;

        // Required displacement
        const required = aabbOverlap
          ? Math.max(overlapX, overlapY)
          : (minDist - dist);

        totalOverlap += required;

        // Weights: pinned = Infinity, restaurant = 0.7, attraction = 1.0
        const wA = a.pinned ? Infinity : (a.isRestaurant ? 0.7 : 1.0);
        const wB = b.pinned ? Infinity : (b.isRestaurant ? 0.7 : 1.0);
        const totalW = wA + wB;
        if (totalW === Infinity) continue; // both pinned, skip

        const shareA = wB / totalW; // smaller weight → larger share
        const shareB = wA / totalW;

        // a moves AWAY from b (negative ux/uy), b moves AWAY from a (positive)
        a.labelRect.x -= ux * required * shareA;
        a.labelRect.y -= uy * required * shareA;
        b.labelRect.x += ux * required * shareB;
        b.labelRect.y += uy * required * shareB;
      }
    }
    if (totalOverlap < 1) return; // converged
  }
  // Fallback: not converged, snap to anchor
  for (const n of nodes) {
    if (!n.pinned) {
      n.labelRect = { x: n.anchorX - n.labelRect.w / 2, y: n.anchorY - n.labelRect.h / 2 };
    }
  }
}
```

**理由**：
- 5-8 轮对 8 POI × 7 对 ≈ 280 次检查足够收敛
- AABB + center distance 双重检测：AABB 重叠 OR 距离过近
- weight 让起/终点不动，餐厅更易挪（POI 群过密时餐厅被挪开更不显眼）

### 4. 边界钳制

```ts
const clampToCanvas = (rect: LabelRect) => ({
  x: Math.max(4, Math.min(CANVAS_WIDTH - rect.w - 4, rect.x)),
  y: Math.max(4, Math.min(CANVAS_HEIGHT - rect.h - 4, rect.y)),
});
```

每轮迭代后调用。

### 5. Pin 重置 cx/cy

由于 label 位置变化，`cx`/`cy` 也要跟着移到 label rect 中心（这样 segment 起点/终点对齐到 label 边缘）：

```ts
for (const n of nodes) {
  n.cx = n.labelRect.x + n.labelRect.w / 2;
  n.cy = n.labelRect.y + n.labelRect.h / 2;
}
```

### 6. 调用顺序

```ts
// 1. Compute initial positions (existing 4-direction pass for non-pinned)
for (spec of allSpecs) {
  placedPos = pinned logic OR placeLabel OR bestEffortLabel;
  nodes.push({ labelRect: placedPos, ... });
}

// 2. NEW: Global de-overlap pass
enforceGlobalLabelSeparation(nodes);

// 3. Existing segment de-overlap (12 iter along line direction)
for (iter in 12) {
  for (i in orderedPairs) {
    // rectProjectionsAlong + push along unit vector
  }
}

// 4. Existing fromEdge/toEdge + badge positioning
```

**理由**：先全局推开（处理 non-segment 相邻），再 segment 沿连线推开（处理 segment 邻居）。两者互补。

## Risks / Trade-offs

- **[风险]** POI 群过密（如大连老虎滩 4 个 POI 真坐标半径 < 1km）时，5-8 轮迭代可能无法收敛 → 所有内部 POI 重置到真坐标（fallback），用户看到 POI 群挤在一起但 badge 起点侧偏移仍可见。
  - **缓解**：fallback 后用户至少看到真实 POI 分布，bug 不算严重。
- **[风险]** 起/终点钉死后，如果它们真坐标在画布边缘，label 可能出界。
  - **缓解**：边界钳制（4px buffer）+ 起点放锚点下方、终点放上方，避免两个标签同时出界。
- **[风险]** 推开后内部 POI 与起终点的连线呈现奇怪的"穿越"视觉（如某个 POI 被推到起终点对面）。
  - **缓解**：weight = 1.0 让 POI 平均推开，方向由冲突对决定（不是全局径向）。距离大冲突大 → 推开多。
- **[风险]** MIN_LABEL_GAP = 30px 比 badge 直径 (22px) 大 8px。如果未来改 badge 半径，这个常量要联动改。
  - **缓解**：用常量表达式 `const MIN_LABEL_GAP = SEGMENT_BADGE_RADIUS * 2 + 8;`，自动联动。

## Migration Plan

代码层面：仅改 `src/components/map/SimplifiedMap.tsx`。

回滚：单文件改动，git revert 即可。

## Open Questions

- **Q**: 推开时是否要保留 POI 与真实锚点的连线（暗线），让用户能看到"这个 POI 实际在哪儿"？
  - **A**: 否。增加视觉噪声。当前文字时间副标题已经传达"约 11:30"等真实信息。如果以后需要再加。
- **Q**: 全局 pass 是否要给权重（如起/终点 weight 100、景点 1.0、餐厅 0.5）？
  - **A**: 用相对权重（Infinity / 0.7 / 1.0）足够。绝对值不重要，关键是"起/终点不动"。
