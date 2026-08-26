## Purpose

通过 LLM 生成优化的旅行路线顺序，最小化回头路、在合适用餐时段安排餐厅停靠。LLM 提供商可通过 `LLM_PROVIDER` 环境变量在 Anthropic 格式（Anthropic / MiniMax Anthropic 兼容端点）和 OpenAI 兼容格式（Bailian / OpenRouter / Together 等）之间切换。

## ADDED Requirements

### Requirement: AI route optimization
The system SHALL accept a list of selected POIs, start point, and end point, and return an optimized visiting order.

#### Scenario: Generate optimized route
- **WHEN** user clicks "Generate Route" button with selected POIs
- **THEN** the system SHALL call the configured LLM with POI data and constraints
- **AND** return an ordered itinerary with suggested arrival times

#### Scenario: No backtracking constraint
- **WHEN** generating the route
- **THEN** the LLM SHALL prioritize an order that minimizes backtracking and unnecessary travel between stops

### Requirement: Restaurant scheduling at meal times
The system SHALL schedule restaurant stops at appropriate meal times during the route.

#### Scenario: Lunch stop inserted
- **WHEN** the route spans from morning to afternoon
- **THEN** a restaurant POI SHALL be scheduled around 11:30-12:30 as a lunch stop

#### Scenario: Multiple restaurant stops
- **WHEN** the itinerary includes multiple restaurants
- **THEN** they SHALL be scheduled at different meal times (lunch and dinner) rather than consecutively

### Requirement: Structured JSON output
The LLM SHALL return the itinerary in a structured JSON format that the system can parse and render.

#### Scenario: Valid itinerary response
- **WHEN** the LLM returns a route plan
- **THEN** the response SHALL be valid JSON containing: poiId, order, suggestedArrival, suggestedDuration, transportMode, transportDistance, transportDuration, recommendedDishes, ticketPrice, markdownPlan, costBreakdown

#### Scenario: Error handling for invalid response
- **WHEN** the LLM returns invalid or unparseable JSON
- **THEN** the system SHALL retry up to 3 times with exponential backoff
- **AND** if all retries fail, fall back to deterministic `sortByGeographicProximity` ordering

### Requirement: Multi-provider LLM adapter
The LLM layer SHALL be backed by an `ILLMClient` interface with two adapters:
- `AnthropicLLMClient` — Anthropic Messages API format (`x-api-key` header, `/v1/messages`, JSON forcing via `tool_choice`)
- `OpenAICompatibleLLMClient` — OpenAI Chat Completions format (`Bearer` token, `/chat/completions`, JSON forcing via `response_format: json_object`)

#### Scenario: Anthropic adapter is selected
- **WHEN** `LLM_PROVIDER=anthropic`
- **THEN** the `LLMClientFactory` SHALL return an `AnthropicLLMClient`
- **AND** requests SHALL be sent to `ANTHROPIC_BASE_URL` with `x-api-key: $ANTHROPIC_API_KEY`

#### Scenario: OpenAI-compatible adapter is selected
- **WHEN** `LLM_PROVIDER=openai-compatible` (or unset, or any unknown value)
- **THEN** the `LLMClientFactory` SHALL return an `OpenAICompatibleLLMClient`
- **AND** requests SHALL be sent to `OPENAI_BASE_URL/chat/completions` with `Authorization: Bearer $OPENAI_API_KEY`

### Requirement: LLM call timeout and retry policy
The LLM client SHALL enforce a 90-second per-request timeout, and the LLMService SHALL retry up to 3 times with exponential backoff (except for timeout-class errors which retry immediately).

#### Scenario: 90s AbortSignal timeout on each LLM request
- **WHEN** the upstream LLM provider takes longer than 90 seconds
- **THEN** the client SHALL abort the fetch with `AbortSignal.timeout(90_000)`
- **AND** the `LLMService` SHALL detect `AbortError` / `TimeoutError`
- **AND** retry immediately (no backoff) because timeouts are transient

#### Scenario: All retries exhausted falls back to geographic-proximity ordering
- **WHEN** all 3 attempts fail
- **THEN** the `LLMService` SHALL log a warning
- **AND** return a deterministic fallback route built by `sortByGeographicProximity`

### Requirement: Request queue for expensive endpoint
The `/api/llm/route-plan` endpoint SHALL serialize concurrent requests through an in-process FIFO queue, so that at most one itinerary generation runs at a time while the rest wait.

#### Scenario: Concurrent requests are serialized
- **WHEN** a second request arrives while the first is still executing
- **THEN** the second request SHALL be queued (not executed in parallel)

#### Scenario: Queue upper bound rejects overflow
- **WHEN** the number of waiting requests reaches the configured maximum (`ROUTE_PLAN_QUEUE_MAX_LENGTH`, default 5)
- **AND** a new request arrives
- **THEN** the new request SHALL be rejected immediately
- **AND** the HTTP response SHALL be 429 with `Retry-After: 10`
- **AND** the body SHALL explain the server is busy

#### Scenario: Queue is checked AFTER the rate limiter
- **WHEN** a request is rejected by the rate limiter (HTTP 429)
- **THEN** the request handler SHALL return immediately
- **AND** the queue `waiting` count SHALL be unchanged

### Requirement: Place-around calls are serialized
The StepRestaurants component SHALL issue `place-around` API calls serially (one per 250 ms) rather than in parallel, to avoid triggering AMap QPS limits.

#### Scenario: Per-attraction serialization
- **WHEN** StepRestaurants needs to fetch nearby places for N attractions
- **THEN** it SHALL issue the requests via a `for...of` loop with `await sleep(250)` between calls
- **AND** a single failed call SHALL NOT abort the remaining N-1 calls