## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Deterministic label tilt is bounded to [-1, 1]

The `deterministicTilt` function SHALL return a value in the closed interval [-1, 1] for every input string. The hash modulo operation SHALL be coerced to non-negative before scaling.

#### Scenario: Tilt stays in [-1, 1] for arbitrary input
- **WHEN** `deterministicTilt` is called with any string
- **THEN** the returned value SHALL be ≥ -1 and ≤ 1

### Requirement: Touching label rectangles do not overlap

The `rectsOverlap` function SHALL return `false` when their borders touch but interiors do not intersect (strictly touch-only).

#### Scenario: Right edge of A touches left edge of B
- **WHEN** `rectA.x + rectA.w === rectB.x`
- **AND** `rectA.y` overlaps `rectB.y`
- **THEN** `rectsOverlap(rectA, rectB)` SHALL return `false`

#### Scenario: Top edge of A touches bottom edge of B
- **WHEN** `rectA.y + rectA.h === rectB.y`
- **AND** `rectA.x` overlaps `rectB.x`
- **THEN** `rectsOverlap(rectA, rectB)` SHALL return `false`

### Requirement: extractClientIpAddress tolerates leading commas

The `extractClientIpAddress` function SHALL pick the first non-empty entry from the `x-forwarded-for` header when the value starts with a comma (e.g. `,10.0.0.1`).

#### Scenario: x-forwarded-for starts with a comma
- **WHEN** the header value is `,10.0.0.1` or `,,10.0.0.1`
- **THEN** `extractClientIpAddress` SHALL return `10.0.0.1`
- **AND** SHALL NOT return an empty string

### Requirement: Rate limit is per-IP

The `RateLimitService` SHALL track quota independently per client IP.

#### Scenario: Independent IP quotas
- **WHEN** IP A exhausts its quota
- **THEN** IP B SHALL still be allowed to call `checkRateLimit`
- **AND** `remainingPoints` for IP B SHALL reflect only IP B's consumption

#### Scenario: resetRateLimit restores quota
- **WHEN** `resetRateLimit(clientIp)` is called
- **THEN** subsequent calls to `checkRateLimit(clientIp)` SHALL be allowed
- **AND** `remainingPoints` SHALL reflect the reset to the configured maximum

### Requirement: Queue length falls back to default for invalid values

The `getRoutePlanQueueMaxLength` function SHALL return 5 when `ROUTE_PLAN_QUEUE_MAX_LENGTH` is unset, non-numeric, zero, or negative. The function SHALL log a warning to stderr whenever an invalid value triggers the fallback.

#### Scenario: Non-numeric value falls back with warning
- **WHEN** `ROUTE_PLAN_QUEUE_MAX_LENGTH=abc`
- **THEN** `getRoutePlanQueueMaxLength()` SHALL return 5
- **AND** SHALL log `[environment] Invalid ROUTE_PLAN_QUEUE_MAX_LENGTH="abc", falling back to default 5`

### Requirement: LLM client timeout is 90 seconds

Both `AnthropicLLMClient` and `OpenAICompatibleLLMClient` SHALL set a 90-second timeout on every upstream HTTP request.

#### Scenario: Upstream hangs longer than 90 seconds
- **WHEN** the LLM provider takes longer than 90 seconds to respond
- **THEN** the client SHALL abort the fetch
- **AND** `LLMService` SHALL detect `AbortError` / `TimeoutError`
- **AND** retry immediately (no backoff, because timeouts are transient)