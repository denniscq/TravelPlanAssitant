## Context

See `docs/superpowers/specs/2026-08-19-travel-plan-assistant-design.md` for the full design document covering architecture, data flow, and UI specification.

This document captures the key technical decisions, risks, and trade-offs for the implementation.

## Goals / Non-Goals

**Goals:**
- Define the layered service architecture boundaries (types → services → utils → components → app)
- Establish the external API integration patterns (Amap, Bailian/DeepSeek)
- Define the rate limiting strategy and integration points
- Establish the component hierarchy and data flow between steps

**Non-Goals:**
- Not defining line-by-line implementation details (handled in tasks.md)
- Not restating the spec requirements (see spec files in this change)
- Not covering deployment or CI/CD configuration

## Decisions

### Decision 1: Next.js App Router with API route proxies
- **Choice**: Use Next.js API routes as proxy layers for all external API calls (Amap, Bailian)
- **Rationale**: Keeps API keys server-side, avoids CORS issues, allows centralized error handling and rate limiting
- **Alternative considered**: Direct browser-side calls to Amap/Bailian — rejected because API keys would be exposed
- **Alternative considered**: Separate backend service — rejected as over-engineering for this tool's scope

### Decision 2: Client-side Amap JS API vs server-side map rendering
- **Choice**: Use Amap JS API 2.0 directly in the browser via @amap/amap-jsapi-loader
- **Rationale**: Map interactions (pan, zoom, click markers, drag) require client-side rendering. Server-side rendering would not support interactive maps
- **Trade-off**: Initial page load requires downloading the Amap JS SDK (~500KB), but this is standard for all map-based applications

### Decision 3: rate-limiter-flexible with MemoryStore
- **Choice**: Use `rate-limiter-flexible` library with in-memory `MemoryStore` for IP-based rate limiting
- **Rationale**: Zero external dependencies, no Redis required, sufficient for single-instance deployment
- **Trade-off**: Rate limit state resets on server restart. Acceptable for a tool without user accounts
- **Alternative considered**: `@upstash/ratelimit` + Upstash Redis — rejected to avoid external dependency and cost

### Decision 4: OpenAI-compatible API client for Bailian
- **Choice**: Use standard OpenAI-compatible HTTP client to call Bailian's DeepSeek-V4-Flash endpoint
- **Rationale**: Bailian supports OpenAI-compatible protocol, allowing us to use the standard `fetch`-based client without additional SDK dependencies
- **Trade-off**: Need to handle Bailian-specific error codes manually, but avoids adding the full OpenAI SDK dependency

### Decision 5: Session-only state management (no database)
- **Choice**: Use React state + URL search params for preserving user selections across steps
- **Rationale**: No database requirement means no persistence layer. URL search params allow shareable/refreshable state
- **Trade-off**: Page refresh during the wizard will lose progress. Acceptable since the tool is session-based
- **Alternative considered**: Zustand or Jotai for state management — may be added if component state becomes unwieldy, but not needed initially

### Decision 6: JSON-LD structured data for SEO
- **Choice**: Inject `WebApplication` JSON-LD structured data on the page
- **Rationale**: Helps search engines understand the tool is a web application, improving search result presentation
- **Implementation**: Via Next.js Metadata API in the root layout, with dynamic city-specific markup in step pages

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| DeepSeek-V4-Flash output quality for route planning | Poor route recommendations | Start with structured prompt engineering; add fallback to simple distance-based ordering if LLM output is unreliable |
| Amap API rate limits | Tool becomes unavailable under heavy use | Each API route handles 429 responses gracefully; display user-friendly error messages |
| Memory store rate limit reset on restart | Rate limit protection lost temporarily | Acceptable for a personal tool; consider Upstash Redis if deployed publicly at scale |
| Amap JS API CORS/loading issues | Map fails to render | Use @amap/amap-jsapi-loader with proper error handling and retry logic |
| Bailian API cost from legitimate users | Unexpected API costs | Rate limiting per IP (10/hour) limits max cost; show usage remaining to users |

### Decision 7: POI search result caching
- **Choice**: Implement server-side in-memory cache for Amap POI search results
- **Rationale**: Reduces Amap API calls for popular cities, improves response time
- **Implementation**: Simple in-memory Map-based cache with TTL (configurable via env var, default 30 minutes)
- **Trade-off**: Cache resets on server restart, but acceptable for a tool without database

### Decision 8: AI route as final result
- **Choice**: AI-generated route order is the final itinerary; no manual reordering
- **Rationale**: Simplifies the UI and reduces complexity. The LLM prompt is designed to produce optimal ordering
- **Trade-off**: Users cannot fine-tune the order, but they can regenerate the route