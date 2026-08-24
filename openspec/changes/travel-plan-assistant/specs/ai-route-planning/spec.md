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