## Purpose

Uses DeepSeek-V4-Flash via Alibaba Cloud Bailian to generate an optimized travel route that minimizes backtracking and schedules restaurant stops at appropriate meal times.

## ADDED Requirements

### Requirement: AI route optimization
The system SHALL accept a list of selected POIs, start point, and end point, and return an optimized visiting order.

#### Scenario: Generate optimized route
- **WHEN** user clicks "Generate Route" button with selected POIs
- **THEN** the system SHALL call DeepSeek-V4-Flash with POI data and constraints
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
- **THEN** the response SHALL be valid JSON containing: poiId, order, suggestedArrival, suggestedDuration

#### Scenario: Error handling for invalid response
- **WHEN** the LLM returns invalid or unparseable JSON
- **THEN** the system SHALL return an error message to the user
- **AND** suggest retrying

### Requirement: Markdown plan contains real route data
The LLM-generated `markdownPlan` field MUST incorporate the real Amap route data supplied in the prompt (distance, duration, transit stops, transit fee) rather than inventing values, so that the rendered travel plan is truthful.

#### Scenario: Driving segment distance/duration quoted from real data
- **WHEN** the prompt includes a driving segment with real `distanceInMeters` and `durationInSeconds`
- **THEN** the `markdownPlan` for that segment SHALL quote distance and duration that match the supplied values (within the same unit and a rounding tolerance of ±10%)
- **AND** the LLM SHALL NOT invent alternative distances or times for the same segment

#### Scenario: Transit segment uses real boarding/alighting stop names
- **WHEN** the prompt includes a transit segment with `transitLegs[].departureStop.name` (boarding) and `arrivalStop.name` (alighting) and `lineName`
- **THEN** the `markdownPlan` for that segment SHALL mention all three fields
- **AND** the LLM SHALL output the verbatim line name (e.g. "1号线"), boarding stop name, and alighting stop name from the prompt

#### Scenario: Walking segment distance/duration quoted from real data
- **WHEN** the prompt includes a walking segment with real `distanceInMeters` and `durationInSeconds`
- **THEN** the `markdownPlan` for that segment SHALL quote distance and duration matching the supplied values

#### Scenario: Transit fee included in cost breakdown
- **WHEN** the prompt includes a `transitFee` (yuan) for a transit segment
- **THEN** `costBreakdown.transportation` SHALL include that fee (in addition to any driving/taxi estimates)
- **AND** the `markdownPlan` "费用明细" section SHALL show the fee itemized

#### Scenario: Per-stop structure uses real data
- **WHEN** the LLM writes each station's section in `markdownPlan`
- **THEN** it SHALL include the real transit line and stops (when applicable), the real distance/duration, the ticket price (for attractions), and the recommended dishes (for restaurants)
- **AND** it SHALL NOT fabricate any of these fields

## MODIFIED Requirements

### Requirement: Structured JSON output

(无字段变更；下面的 Scenario 是对原 Requirement 的扩展场景。)

#### Scenario: markdownPlan field grounded in real route data
- **WHEN** the LLM returns a route plan and the system provides real Amap route data in the prompt
- **THEN** `markdownPlan` SHALL contain per-station sections that include real transport details (mode, distance, duration, transit line + boarding/alighting stops), ticket price for attractions, and recommended dishes for restaurants
- **AND** all numeric transport values quoted in `markdownPlan` SHALL match the supplied real data within ±10% rounding tolerance
