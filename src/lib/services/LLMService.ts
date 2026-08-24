import { getBailianApiKey, getBailianBaseUrl, getBailianModelName } from '../utils/environment';
import { LlmRoutePlanRequest, LlmRoutePlanResponse, LlmStopDescription, CostBreakdown } from '../types/itinerary-types';
import { PoiItem, isRestaurantPoi } from '../types/poi-types';
import { ServerLogger } from '../utils/server-logger';

interface BailianChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface BailianChatRequest {
  model: string;
  messages: BailianChatMessage[];
  response_format: {
    type: 'json_object';
  };
}

interface BailianChatResponse {
  id: string;
  choices: {
    finish_reason: string;
    message: {
      role: string;
      content: string;
    };
  }[];
  error?: {
    message: string;
    type: string;
    code: string;
  };
}

interface LlmFallbackResult {
  orderedPoiIds: string[];
  stopDescriptions: LlmStopDescription[];
  markdownPlan: string;
  costBreakdown: CostBreakdown;
}

export class LLMService {
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

3. **交通方式建议**：根据两点之间的距离给出合理建议：
   - <1km：步行
   - 1-5km：建议打车或公交
   - >5km：建议驾车

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

- orderedPoiIds 数组必须包含所有提供的 POI ID，每个恰好一次
- stopDescriptions 中的每个条目必须对应一个 POI
- markdownPlan 字段必须包含完整的、格式良好的 Markdown 文本，包含标题、总览、行程详情、费用预估明细等所有内容，直接面向用户展示
- costBreakdown 中的总费用应等于门票+餐饮+交通之和
- 对于餐厅类型的 POI，recommendedDishes 中列出推荐菜名
- 对于景点类型的 POI，ticketPrice 填写门票价格，否则为 0`;

  public async generateRoutePlan(request: LlmRoutePlanRequest, logger?: ServerLogger): Promise<LlmRoutePlanResponse> {
    try {
      const userPrompt = this.buildUserPrompt(request);
      logger?.info('--- LLM Service: generateRoutePlan ---');
      logger?.info(`  Model: ${getBailianModelName()}`);
      logger?.info(`  POIs count: ${request.selectedPois.length}`);
      logger?.info(`  Start: ${request.startLocation} (${request.startLatitude}, ${request.startLongitude})`);
      logger?.info(`  End: ${request.endLocation} (${request.endLatitude}, ${request.endLongitude})`);
      logger?.info(`  User prompt length: ${userPrompt.length} chars`);
      logger?.info('  Calling Bailian API...');

      const response = await this.callBailianApi(userPrompt);

      logger?.info('  Bailian API response received:');
      logger?.info(`    Response ID: ${response.id}`);
      logger?.info(`    Choices count: ${response.choices?.length ?? 0}`);
      if (response.choices?.[0]) {
        logger?.info(`    Finish reason: ${response.choices[0].finish_reason}`);
        logger?.info(`    Content length: ${response.choices[0].message?.content?.length ?? 0} chars`);
      }
      if (response.error) {
        logger?.error(`    API error: ${response.error.message} (type=${response.error.type}, code=${response.error.code})`);
      }

      const parsedResponse = this.parseResponse(response);
      logger?.info('  LLM response parsed successfully:');
      logger?.info(`    Ordered POI IDs: ${JSON.stringify(parsedResponse.orderedPoiIds)}`);
      logger?.info(`    Stop descriptions count: ${parsedResponse.stopDescriptions.length}`);
      logger?.info(`    Markdown plan length: ${parsedResponse.markdownPlan.length} chars`);
      logger?.info(`    Cost breakdown: ${JSON.stringify(parsedResponse.costBreakdown)}`);

      this.validateResponse(parsedResponse, request.selectedPois);
      logger?.info('  LLM response validated successfully');
      logger?.info('  LLM route plan generated successfully');
      return parsedResponse;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger?.warn('  LLM route planning failed, using fallback - ' + errorMessage);
      return this.generateFallbackRoute(request);
    }
  }

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

  private async callBailianApi(userPrompt: string): Promise<BailianChatResponse> {
    const requestBody: BailianChatRequest = {
      model: getBailianModelName(),
      messages: [
        { role: 'system', content: LLMService.SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    };

    const response = await fetch(getBailianBaseUrl() + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getBailianApiKey()}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Bailian API returned status ${response.status}`);
    }

    const data: BailianChatResponse = await response.json();

    if (data.error !== undefined) {
      throw new Error(`Bailian API error: ${data.error.message}`);
    }

    return data;
  }

  private parseResponse(response: BailianChatResponse): LlmRoutePlanResponse {
    const content = response.choices[0]?.message?.content;

    if (content === undefined || content.length === 0) {
      throw new Error('Empty LLM response content');
    }

    const parsed = JSON.parse(content);

    return {
      orderedPoiIds: parsed.orderedPoiIds,
      stopDescriptions: parsed.stopDescriptions,
      markdownPlan: parsed.markdownPlan,
      costBreakdown: parsed.costBreakdown ?? { tickets: 0, meals: 0, transportation: 0, total: 0 },
    };
  }

  private validateResponse(
    response: LlmRoutePlanResponse,
    selectedPois: PoiItem[]
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
    const restaurantInsertionInterval = Math.max(2, Math.floor(attractionCount / Math.max(1, restaurantCount)));

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
    const stopsMarkdown = orderedPois.map((poi, index) => {
      const hour = 9 + index * 2;
      const nextHour = hour + (poi.category === 'restaurant' ? 1 : 2);
      return `##### 第${index + 1}站：${hour.toString().padStart(2, '0')}:00 - ${nextHour.toString().padStart(2, '0')}:00 ${poi.name}（⏰ ${poi.category === 'restaurant' ? '1h' : '1.5h'}）\n- ${poi.category === 'restaurant' ? '用餐' : '游览'}\n- 地址：${poi.address}`;
    }).join('\n\n');

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