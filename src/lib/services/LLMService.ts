import {
  LlmRoutePlanRequest,
  LlmRoutePlanResponse,
  LlmStopDescription,
  CostBreakdown,
} from '../types/itinerary-types';
import { PoiItem, isRestaurantPoi } from '../types/poi-types';
import { ServerLogger } from '../utils/server-logger';
import { ILLMClient } from './llm/ILLMClient';
import { LLMClientFactory } from './llm/LLMClientFactory';

interface LlmFallbackResult {
  orderedPoiIds: string[];
  stopDescriptions: LlmStopDescription[];
  markdownPlan: string;
  costBreakdown: CostBreakdown;
}

export class LLMService {
  /**
   * The orchestration layer no longer hard-codes "Bailian" or any
   * specific provider — it talks to whatever adapter the factory
   * returned. This is the only place the system prompt lives,
   * because the prompt encodes *route-planning* domain knowledge,
   * which is the responsibility of the orchestrator, not the wire
   * adapter.
   */
  private static readonly SYSTEM_PROMPT = `你是一位专业的中国城市一日游行程规划师。你的任务是根据用户提供的出发地、结束地以及选择的景点和餐厅，生成一份详细的、可执行的一日游出行计划。

## 规划原则

1. **路线优化**：按地理邻近性排序，避免走回头路，形成合理的游览路线。从出发地开始，最后回到结束地。

2. **时间安排合理**：
   - 出发时间通常为 09:00
   - 午餐安排在 11:30-13:00 之间
   - 晚餐安排在 17:30-19:00 之间
   - 注意餐厅的营业时间，部分餐厅 14:00-17:00 午休，避免安排在午休时段去用餐
   - 景点游玩时间根据类型合理分配：博物馆/历史建筑类 2-3h，公园/自然景观类 1.5-2h，打卡/观光类 0.5-1h
   - 餐厅用餐时间约 1-1.5h
   - 最终返回结束地的时间建议在 20:00 前

3. **交通方式建议**：你仍然可以在 stopDescriptions.transportMode 字段给出一个建议值（driving / walking / transit / cycling / taxi 中任意一个），但系统会在生成完成后根据客观地理数据（最近公交/地铁站距离、路段直线距离）覆盖你的建议。所以这里**不需要花精力判断交通方式**，重点放在排序和时间安排上即可。

4. **费用预估**：包含门票、餐饮、交通三项，给出总预算。门票从景点信息中获取，餐饮从餐厅人均花费估算，交通根据距离估算。

5. **餐厅推荐**：结合餐厅的推荐菜和营业时间，给出用餐建议，说明推荐菜品。

## 输出格式

你必须返回一个 JSON 对象，包含以下字段：

\`\`\`json
{
  "orderedPoiIds": ["poi-id-1", "poi-id-2", ...],
  "stopDescriptions": [
    {
      "poiId": "poi-id-1",
      "suggestedArrival": "09:00",
      "suggestedDuration": "2h",
      "notes": "游览建议：故宫上午人少，适合拍照游览，建议租用讲解器。门票¥60。",
      "transportMode": "driving",
      "transportDistance": "8km",
      "transportDuration": "30min",
      "recommendedDishes": [],
      "ticketPrice": 60
    }
  ],
  "markdownPlan": "### 出行计划\\n\\n#### 总览\\n...（完整的Markdown格式出行计划，包含所有内容）",
  "costBreakdown": {
    "tickets": 120,
    "meals": 300,
    "transportation": 80,
    "total": 500
  }
}
\`\`\`

## 重要要求

- **orderedPoiIds 数组必须且只能包含用户提供的所有 POI ID，每个恰好一次，绝对不能遗漏任何一个**。如果漏了任何一个 POI，你的输出将被视为无效，整个响应必须重新生成。请在返回前自检：用户给了 N 个 POI ID，你的数组长度也必须是 N，每个 ID 都能在输入列表中找到。
- 在生成 orderedPoiIds 之前，先把输入列表中的所有 POI ID 在你心里**逐个默念一遍**；排序时优先按地理顺序给所有 ID 排位，**不要因为优先级判断而丢掉任何一个**。这是一个 hard constraint，违反它比"为了优化路径丢掉一个站点"代价大得多。
- 如果你只输出了 N-1 个 ID，多半是因为你在排序时被 POI 的吸引力分散注意力，**请回头再数一遍**。
- stopDescriptions 数组的长度必须与 orderedPoiIds 相同，每个条目对应 orderedPoiIds 中的一个 POI（按相同顺序）
- markdownPlan 字段必须包含完整的、格式良好的 Markdown 文本，包含标题、总览、行程详情、费用预估明细等所有内容，直接面向用户展示
- costBreakdown 中的总费用应等于门票+餐饮+交通之和
- 对于餐厅类型的 POI，recommendedDishes 中列出推荐菜名
- 对于景点类型的 POI，ticketPrice 填写门票价格，否则为 0

## 真实路线数据约束（最重要）

当你的 userPrompt 包含 "## 真实路线事实表（来自高德 API，禁止编造）" 一节时（通常在第二轮 LLM 调用中），必须严格遵守以下规则：

1. **距离与时长** —— 真实路线事实表中的 distance / duration 是高德 API 的真实返回值，单位米/秒。你在 markdownPlan 中引用时必须保持数值一致。允许四舍五入到整数（如 8200m → "8.2km" 或 "8km"），但**禁止**编造不同的距离或时长。
2. **公交/地铁路段** —— 真实路线事实表中会列出每段公交的线路名 (lineName) + 上车站 (departureStopName) + 下车站 (arrivalStopName)。markdownPlan 中必须按以下模板输出：
   - 乘坐【线路名】从【上车站】上车 → 【下车站】下车
3. **出租车/驾车段** —— 按 "驾车/打车 约 X.X km / X min" 输出，不要捏造换乘信息。
4. **步行段** —— 按 "步行 约 X 米 / X min" 输出。
5. **交通费** —— 真实路线事实表中会给出 transitFee（如 ¥3）。你必须把这个数字原样写到 markdownPlan 的"费用明细"里，**禁止**自己估算。
6. **每站统一格式** —— 每一站必须包含以下 4 段：
   - 怎么去：上述交通信息
   - 玩什么 / 吃什么：基于 POI 信息自由发挥
   - 花费：景点写门票金额；餐厅写人均消费
   - 建议停留：可选，给出游览/用餐建议时长
7. **禁止字段** —— 不要在 markdownPlan 中添加"全程约 X 公里"、"总行程 X 小时"等没有在真实路线事实表中出现的全局统计字段（除非你能在事实表中找到对应数字）。`;

  private readonly client: ILLMClient;

  public constructor(client?: ILLMClient) {
    this.client = client ?? LLMClientFactory.create();
  }

  public async generateRoutePlan(
    request: LlmRoutePlanRequest,
    logger?: ServerLogger,
  ): Promise<LlmRoutePlanResponse> {
    const MAX_RETRIES = 3;
    const INITIAL_BACKOFF_MS = 1000;
    const userPrompt = this.buildUserPrompt(request);
    logger?.info('--- LLM Service: generateRoutePlan ---');
    logger?.info(`  Provider: ${this.client.providerName}`);
    logger?.info(`  POIs count: ${request.selectedPois.length}`);
    logger?.info(
      `  Start: ${request.startLocation} (${request.startLatitude}, ${request.startLongitude})`,
    );
    logger?.info(
      `  End: ${request.endLocation} (${request.endLatitude}, ${request.endLongitude})`,
    );
    logger?.info(`  User prompt length: ${userPrompt.length} chars`);

    // Retry loop with exponential backoff. We retry the most common
    // transient failure modes: network errors, HTTP 5xx, and validation
    // errors that suggest a re-roll would succeed (e.g. "LLM omitted POI").
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        logger?.info(`  Attempt ${attempt}/${MAX_RETRIES} - Calling LLM client...`);
        const response = await this.client.chat({
          systemPrompt: LLMService.SYSTEM_PROMPT,
          userPrompt,
          forceJson: true,
        });

        logger?.info('  LLM response received:');
        logger?.info(`    JSON length: ${response.jsonText.length} chars`);
        if (response.usage) {
          logger?.info(
            `    Token usage: in=${response.usage.inputTokens}, out=${response.usage.outputTokens}`,
          );
        }

        const parsedResponse = this.parseResponse(response.jsonText);
        logger?.info(`    Ordered POI IDs: ${JSON.stringify(parsedResponse.orderedPoiIds)}`);
        logger?.info(`    Stop descriptions count: ${parsedResponse.stopDescriptions.length}`);
        logger?.info(`    Markdown plan length: ${parsedResponse.markdownPlan.length} chars`);

        this.validateResponse(parsedResponse, request.selectedPois);
        logger?.info('  LLM response validated successfully');
        if (attempt > 1) {
          logger?.info(`  Succeeded after ${attempt} attempts`);
        }
        return parsedResponse;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(errorMessage);
        const isLastAttempt = attempt === MAX_RETRIES;
        // AbortError signals a timeout from the LLM client's 90s AbortSignal.
        // These are transient (slow upstream, queue backlog) and respond best
        // to immediate retries — no backoff. Validation errors (POI omitted,
        // bad JSON) are deterministic and benefit from a backoff in case the
        // LLM provider's state changes between attempts.
        const isTimeout =
          error instanceof Error &&
          (error.name === 'AbortError' ||
            error.name === 'TimeoutError' ||
            /aborted due to timeout/i.test(error.message));
        logger?.warn(
          `  LLM attempt ${attempt}/${MAX_RETRIES} failed - ${errorMessage}` +
            (isLastAttempt
              ? ''
              : isTimeout
                ? ' - retrying immediately'
                : ' - will retry with backoff'),
        );
        if (isLastAttempt) break;
        if (isTimeout) {
          // No backoff — yield to the event loop briefly so the LLM client's
          // sockets can clean up, but don't waste time on a sleep.
          await new Promise<void>((resolve) => setImmediate(resolve));
        } else {
          const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    // All retries exhausted — degrade gracefully to the fallback so the
    // user still gets a route, just not LLM-optimised.
    logger?.warn(
      `  LLM route planning failed after ${MAX_RETRIES} attempts, using fallback - ` +
        (lastError?.message ?? 'unknown'),
    );
    return this.generateFallbackRoute(request);
  }

  /**
   * Build the user prompt for the LLM call. Kept private — itinerary markdown
   * is now built deterministically from stops + segments by
   * `buildItineraryMarkdown` (no second LLM pass).
   */
  private buildUserPrompt(request: LlmRoutePlanRequest): string {
    const poiDescriptions = request.selectedPois.map((poi) => {
      const base: Record<string, unknown> = {
        id: poi.id,
        name: poi.name,
        category: poi.category === 'attraction' ? '景点' : '餐厅',
        address: poi.address,
        latitude: poi.latitude,
        longitude: poi.longitude,
        rating: poi.rating,
        cost: poi.cost,
        tags: poi.tags,
        openingHours: poi.openingTime,
        openingHoursToday: poi.openingTimeToday,
        phone: poi.telephone,
      };

      if (isRestaurantPoi(poi)) {
        base.recommendedDishes = poi.recommendedDishes;
      }

      return base;
    });

    const prompt = `请为以下信息规划一份一日出行计划：

**出发地：** ${request.startLocation}（${request.startLatitude}, ${request.startLongitude}）
**结束地：** ${request.endLocation}（${request.endLatitude}, ${request.endLongitude}）

**用户选择的景点和餐厅列表：**
${JSON.stringify(poiDescriptions, null, 2)}

请根据所有地点的位置、评分、价格、营业时间等信息，生成最优的出行顺序和详细计划。`;

    return prompt;
  }

  private parseResponse(jsonText: string): LlmRoutePlanResponse {
    if (!jsonText || jsonText.length === 0) {
      throw new Error('Empty LLM response content');
    }

    const parsed = JSON.parse(jsonText);

    return {
      orderedPoiIds: parsed.orderedPoiIds,
      stopDescriptions: parsed.stopDescriptions,
      markdownPlan: parsed.markdownPlan,
      costBreakdown: parsed.costBreakdown ?? {
        tickets: 0,
        meals: 0,
        transportation: 0,
        total: 0,
      },
    };
  }

  private validateResponse(
    response: LlmRoutePlanResponse,
    selectedPois: PoiItem[],
  ): void {
    if (!Array.isArray(response.orderedPoiIds)) {
      throw new Error('LLM response missing orderedPoiIds array');
    }

    if (!Array.isArray(response.stopDescriptions)) {
      throw new Error('LLM response missing stopDescriptions array');
    }

    if (typeof response.markdownPlan !== 'string' || response.markdownPlan.length === 0) {
      throw new Error('LLM response missing markdownPlan');
    }

    const selectedPoiIds = new Set(selectedPois.map((poi) => poi.id));

    for (const poiId of response.orderedPoiIds) {
      if (!selectedPoiIds.has(poiId)) {
        throw new Error(`LLM returned unknown POI ID: ${poiId}`);
      }
    }

    for (const poiId of selectedPoiIds) {
      if (!response.orderedPoiIds.includes(poiId)) {
        throw new Error(`LLM omitted POI ID: ${poiId}`);
      }
    }
  }

  private generateFallbackRoute(request: LlmRoutePlanRequest): LlmRoutePlanResponse {
    return this.sortByGeographicProximity(request);
  }

  private sortByGeographicProximity(request: LlmRoutePlanRequest): LlmFallbackResult {
    const selectedPois = request.selectedPois;
    const remainingPois = [...selectedPois];
    const orderedPois: PoiItem[] = [];

    const attractions = remainingPois.filter((poi) => poi.category === 'attraction');
    const restaurants = remainingPois.filter((poi) => poi.category === 'restaurant');

    const sortedAttractions = [...attractions].sort((a, b) => b.rating - a.rating);
    const sortedRestaurants = [...restaurants].sort((a, b) => b.rating - a.rating);

    const attractionCount = sortedAttractions.length;
    const restaurantCount = sortedRestaurants.length;

    let attractionIndex = 0;
    let restaurantIndex = 0;

    const totalSlots = attractionCount + restaurantCount;
    const restaurantInsertionInterval = Math.max(
      2,
      Math.floor(attractionCount / Math.max(1, restaurantCount)),
    );

    for (let slot = 0; slot < totalSlots; slot++) {
      if (
        restaurantIndex < restaurantCount &&
        (slot + 1) % restaurantInsertionInterval === 0 &&
        slot < totalSlots - 1
      ) {
        orderedPois.push(sortedRestaurants[restaurantIndex]);
        restaurantIndex++;
      } else if (attractionIndex < attractionCount) {
        orderedPois.push(sortedAttractions[attractionIndex]);
        attractionIndex++;
      } else if (restaurantIndex < restaurantCount) {
        orderedPois.push(sortedRestaurants[restaurantIndex]);
        restaurantIndex++;
      }
    }

    const orderedPoiIds = orderedPois.map((poi) => poi.id);
    const stopDescriptions: LlmStopDescription[] = orderedPois.map((poi, index) => {
      const hour = 9 + index * 2;
      const formattedHour = hour.toString().padStart(2, '0');
      return {
        poiId: poi.id,
        suggestedArrival: `${formattedHour}:00`,
        suggestedDuration: poi.category === 'restaurant' ? '1h' : '1.5h',
        notes: poi.category === 'restaurant' ? '用餐' : '游览',
        ticketPrice: poi.category === 'attraction' ? poi.cost : 0,
      };
    });

    // Build a simple fallback markdown
    const stopsMarkdown = orderedPois
      .map((poi, index) => {
        const hour = 9 + index * 2;
        const nextHour = hour + (poi.category === 'restaurant' ? 1 : 2);
        return `##### 第${index + 1}站：${hour.toString().padStart(2, '0')}:00 - ${nextHour
          .toString()
          .padStart(2, '0')}:00 ${poi.name}（⏰ ${
          poi.category === 'restaurant' ? '1h' : '1.5h'
        }）\n- ${poi.category === 'restaurant' ? '用餐' : '游览'}\n- 地址：${poi.address}`;
      })
      .join('\n\n');

    const totalCost = request.selectedPois.reduce((sum, p) => sum + (p.cost || 0), 0);

    const markdownPlan = `### 出行计划\n\n#### 总览\n- 出发地：${request.startLocation}\n- 结束地：${request.endLocation}\n- 总行程：${orderedPois.length} 个站点\n- 预计总花费：¥${totalCost}\n\n#### 行程详情\n\n${stopsMarkdown}`;

    return {
      orderedPoiIds,
      stopDescriptions,
      markdownPlan,
      costBreakdown: {
        tickets: attractions.reduce((s, p) => s + (p.cost || 0), 0),
        meals: restaurants.reduce((s, p) => s + (p.cost || 0), 0),
        transportation: 0,
        total: totalCost,
      },
    };
  }
}

export const llmService = new LLMService();