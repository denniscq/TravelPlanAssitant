## ADDED Requirements

### Requirement: Request queue for expensive endpoint

The `/api/llm/route-plan` endpoint SHALL serialize concurrent requests through an in-process FIFO queue, so that at most one itinerary generation runs at a time while the rest wait.

#### Scenario: First request executes immediately
- **WHEN** no other request is currently running or waiting
- **THEN** the first `enqueue`'d request SHALL begin executing in the next microtask
- **AND** `active` count SHALL be 1, `waiting` SHALL be 0

#### Scenario: Concurrent requests are serialized
- **WHEN** a second request arrives while the first is still executing
- **THEN** the second request SHALL be queued (not executed in parallel)
- **AND** the second request SHALL start only after the first completes (success OR failure)

#### Scenario: Queue upper bound rejects overflow
- **WHEN** the number of waiting requests reaches the configured maximum (`ROUTE_PLAN_QUEUE_MAX_LENGTH`, default 5)
- **AND** a new request arrives
- **THEN** the new request SHALL be rejected immediately with `QueueFullError`
- **AND** the HTTP response SHALL be 429 with `Retry-After: 10`
- **AND** the body SHALL be `{ success: false, error: "Server is busy. Please retry shortly." }`
- **AND** the rejected request SHALL NOT consume a queue slot

#### Scenario: Failure does not block the queue
- **WHEN** the currently executing task throws or rejects
- **THEN** the error SHALL propagate to that request's caller (the route handler)
- **AND** the next waiting request SHALL still proceed

#### Scenario: Successful completion advances the queue
- **WHEN** the currently executing task resolves successfully
- **THEN** the result SHALL propagate to the caller
- **AND** the next waiting request SHALL start in the next microtask

### Requirement: Queue is checked AFTER the rate limiter

The queue enqueue SHALL happen after the IP-based rate limiter has admitted the request, so requests rejected by the rate limiter do not consume queue slots.

#### Scenario: Rate-limited request never reaches the queue
- **WHEN** a request is rejected by the rate limiter (HTTP 429)
- **THEN** the request handler SHALL return immediately
- **AND** the queue `waiting` count SHALL be unchanged

### Requirement: No third-party queue infrastructure

The queue SHALL be implemented purely in application code (Node.js in-memory data structures), without introducing Redis, BullMQ, database-backed queues, or any other third-party queue component.

#### Scenario: Pure in-process implementation
- **WHEN** the queue module is loaded
- **THEN** it SHALL depend only on Node.js built-ins (Promise, Array, Error)
- **AND** it SHALL NOT add any external package to `package.json`

### Requirement: Transparent client behavior

The client experience SHALL be unchanged for requests that wait successfully: they receive the same response shape as if they had been served immediately. Queue position, wait time, and similar internal metrics SHALL NOT be exposed in HTTP responses.

#### Scenario: Waiting request receives normal response
- **WHEN** a request waits in the queue for its turn
- **THEN** once it begins executing and completes, the HTTP response body SHALL match the existing success response shape
- **AND** no `queuePosition`, `waitedMs`, or similar field SHALL appear in either the response or the response headers

### Requirement: Queue length is configurable

The queue's waiting limit SHALL be configurable via the `ROUTE_PLAN_QUEUE_MAX_LENGTH` environment variable. Invalid values (non-numeric, less than 1, zero) SHALL fall back to the default of 5.

#### Scenario: Reading the configured limit
- **WHEN** the queue module is initialized
- **THEN** it SHALL read `ROUTE_PLAN_QUEUE_MAX_LENGTH` once at construction time
- **AND** if unset, invalid, zero, or less than 1, the default of 5 SHALL be used
- **AND** a warning SHALL be logged to stderr when an invalid value triggers the fallback

## MODIFIED Requirements

### Requirement: AI route optimization
The system SHALL accept a list of selected POIs, start point, and end point, and return an optimized visiting order.

#### Scenario: 429 when server is busy
- **WHEN** the route-plan queue is full and a new request arrives
- **THEN** the response SHALL be HTTP 429 with `Retry-After: 10`
- **AND** the body SHALL explain the server is busy

(No other behavioral change to this requirement — the single-request behavior described in the existing scenarios remains unchanged.)

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

#### Scenario: Misconfigured provider falls back safely
- **WHEN** `LLM_PROVIDER` is set to a value outside the allow-list
- **THEN** the factory SHALL log a warning
- **AND** return the `OpenAICompatibleLLMClient` as the safe default

### Requirement: LLM call timeout and retry policy

The LLM client SHALL enforce a 90-second per-request timeout, and the LLMService SHALL retry up to 3 times with exponential backoff (except for timeout-class errors which retry immediately).

#### Scenario: 90s AbortSignal timeout on each LLM request
- **WHEN** the upstream LLM provider takes longer than 90 seconds
- **THEN** the client SHALL abort the fetch with `AbortSignal.timeout(90_000)`
- **AND** the `LLMService` SHALL detect `AbortError` / `TimeoutError` / "aborted due to timeout"
- **AND** retry immediately (without exponential backoff) because timeouts are transient

#### Scenario: Validation failure triggers backoff retry
- **WHEN** the LLM returns malformed JSON or omits a required POI
- **THEN** the `LLMService` SHALL retry up to 2 more times
- **AND** apply exponential backoff (1s, 2s) between attempts

#### Scenario: All retries exhausted falls back to geographic-proximity ordering
- **WHEN** all 3 attempts fail
- **THEN** the `LLMService` SHALL log a warning
- **AND** return a deterministic fallback route built by `sortByGeographicProximity`

### Requirement: Transport mode recommendation rules

The `TransportModeSelector` SHALL classify each segment into `walking`, `transit`, `driving`, or `taxi` based on geographic criteria, ignoring the LLM's `transportMode` field.

#### Scenario: Walking wins below 1 km
- **WHEN** straight-line distance between origin and destination is ≤ 1 km
- **THEN** the segment SHALL be classified as `walking`
- **AND** `suggestRental` SHALL be false
- **AND** no AMap transit-accessibility query SHALL be issued

#### Scenario: Transit wins when both endpoints are near a station
- **WHEN** straight-line distance > 1 km
- **AND** the combined origin-to-station + destination-to-station distance ≤ 1 km
- **THEN** the segment SHALL be classified as `transit`
- **AND** `suggestRental` SHALL be false

#### Scenario: Driving + rental suggestion above the long-distance threshold
- **WHEN** straight-line distance > 150 km (the configurable long-distance threshold)
- **AND** transit is not feasible
- **THEN** the segment SHALL be classified as `driving`
- **AND** `suggestRental` SHALL be true

#### Scenario: Taxi fallback
- **WHEN** the segment does not satisfy any of the above rules
- **THEN** the segment SHALL be classified as `taxi`
- **AND** `suggestRental` SHALL be false

### Requirement: Place-around calls are serialized

The StepRestaurants component SHALL issue `place-around` API calls serially (one per 250 ms) rather than in parallel, to avoid triggering AMap QPS limits.

#### Scenario: Per-attraction serialization
- **WHEN** StepRestaurants needs to fetch nearby places for N attractions
- **THEN** it SHALL issue the requests via a `for...of` loop with `await sleep(250)` between calls
- **AND** a single failed call SHALL NOT abort the remaining N-1 calls
- **AND** each call SHALL have an independent try/catch