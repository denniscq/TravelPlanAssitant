## Why

Travel route planning is a common pain point for independent travelers. Existing tools either lack map integration, don't optimize routes, or rely on manual planning. This tool solves that by combining Amap's POI data with AI-powered route optimization in a single web application.

## What Changes

- New Next.js application with 4-step wizard UI for travel route planning
- Amap JS API integration for map rendering and interaction
- Amap Web Service API integration for POI search and route calculation
- DeepSeek-V4-Flash (via Alibaba Cloud Bailian) for intelligent route optimization
- IP-based rate limiting to protect LLM API costs
- Responsive design (Web + H5) with SEO support

## Capabilities

### New Capabilities
- `map-visualization`: Amap map rendering, marker placement, info window popups, and route polyline display
- `poi-search`: City-based POI search for attractions and restaurants, with rating-based sorting and Top-N slider control
- `route-calculation`: Distance and duration calculation between POIs using Amap Direction API, with transport mode recommendation
- `ai-route-planning`: DeepSeek-V4-Flash powered route optimization that minimizes backtracking and inserts restaurant stops at meal times
- `rate-limiting`: IP-based sliding window rate limiter to protect LLM API from abuse
- `wizard-ui`: 4-step progressive wizard interface (start/end → attractions → restaurants → route plan)

### Modified Capabilities
- None (new project, no existing capabilities)

## Impact

- **New project**: Creates a new Next.js application from scratch
- **External dependencies**: Amap JS API, Amap Web Service API, Alibaba Cloud Bailian (DeepSeek-V4-Flash)
- **No database**: Session-only state, no persistence layer
- **No authentication**: Public-facing tool, no user login