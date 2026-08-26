# TravelPlanAssistant

一款面向独立旅行者的 AI 一日游助手。输入起终点 + 选景点 + 选餐厅，自动生成不走回头路的最优一日路线，输出可读行程 + 可视化路线图。

## 主要功能

- 🧠 AI 路径优化：按地理 + 评分 + 营业时间智能排序，最小化回头路
- 🚶 智能交通方式：按真实出行场景推荐步行 / 公交 / 驾车 / 打车
- 🗺️ 可视化路线：手绘风格示意图，密集 POI 也清晰
- ⏱️ 餐厅自动排点：行程跨度内自动安排午餐 / 晚餐时段
- 💰 成本拆解：票务 / 餐饮 / 交通分别汇总

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制模板并填入真实 Key：

```bash
cp .env.example .env.local
```

最少需要配置 4 个 Key：

| 变量 | 说明 |
|---|---|
| `AMAP_API_KEY` | 高德 Web 服务 Key（POI / 路径规划） |
| `NEXT_PUBLIC_AMAP_JS_API_KEY` | 高德 JS API Key |
| `NEXT_PUBLIC_AMAP_JS_API_SECRET` | 高德 JS API 安全密钥 |
| `BAILIAN_API_KEY` 或 `ANTHROPIC_API_KEY` | LLM Key（根据 [`.env.example`](file:///c:/Dennis/TravelPlanAssistant/.env.example) 顶部注释选其一） |

`.env.local` 含真实 key，**永远不要提交到 git**。

### 3. 启动

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

## 使用流程

1. **设置起终点**：输入出发地、结束地（或同一地点往返）
2. **选择景点**：浏览高德 POI 搜索结果，加入行程
3. **选择餐厅**：浏览景点周边餐厅，加入行程
4. **生成路线**：点击"生成路线"，系统会输出：
   - 推荐的游览顺序 + 建议到达时间
   - 每段交通方式 + 距离 + 时长
   - 总花费拆解
   - 可视化路线图

## 常用命令

```bash
npm run dev      # 开发服务器
npm run build    # 生产构建
npm run start    # 启动生产服务
npm run test     # 运行测试
```

## 部署

构建产物已配置为 `standalone` 模式：

```bash
npm run build
node .next/standalone/server.js
```


## 许可

ISC