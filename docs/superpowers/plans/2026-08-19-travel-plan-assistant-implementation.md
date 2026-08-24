# Implementation Plan — Travel Plan Assistant

## Approach

Follow the tasks.md order, executing in 7 phases:

1. **Phase 1**: Next.js project init, install deps, configure env, create directory structure
2. **Phase 2**: Types (amap, poi, itinerary) + Utils (env, ip, amap-loader)
3. **Phase 3**: Services (AmapPoiSearch, AmapRouteCalculation, LLM, RateLimit, ItineraryPlanning)
4. **Phase 4**: API routes (amap/place, amap/route, llm/route-plan)
5. **Phase 5**: UI components (map, steps, shared)
6. **Phase 6**: Main page + Layout + SEO
7. **Phase 7**: Integration verification

Each phase produces verifiable output. No parallel work within a phase.