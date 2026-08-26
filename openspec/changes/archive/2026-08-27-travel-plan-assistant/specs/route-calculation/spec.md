## Purpose

Calculates route distance, duration, and polyline data between POIs using Amap Direction API, with automatic transport mode recommendation based on real-world conditions (public transit accessibility, ride-hailing vs self-driving).

## ADDED Requirements

### Requirement: Route calculation between POIs
The system SHALL calculate route information between two locations using Amap Direction API.

#### Scenario: Calculate driving route
- **WHEN** two POI locations are provided
- **THEN** the system SHALL query Amap Driving Direction API
- **AND** return distance (in meters/kilometers) and duration (in minutes)

#### Scenario: Calculate walking route
- **WHEN** two POI locations are within 100km
- **THEN** the system SHALL also calculate walking route as an alternative

#### Scenario: Calculate transit route
- **WHEN** two POI locations are within the same city
- **THEN** the system SHALL also calculate public transit route as an alternative

### Requirement: Transport mode recommendation
The `TransportModeSelector` SHALL classify each segment into `walking`, `transit`, `driving`, or `taxi` based on geographic criteria. The LLM's `transportMode` field is intentionally ignored.

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
- **WHEN** straight-line distance > 150 km (configurable via options)
- **AND** transit is not feasible
- **THEN** the segment SHALL be classified as `driving`
- **AND** `suggestRental` SHALL be true

#### Scenario: Taxi fallback
- **WHEN** the segment does not satisfy any of the above rules
- **THEN** the segment SHALL be classified as `taxi`
- **AND** `suggestRental` SHALL be false

### Requirement: Route polyline data
The system SHALL return polyline path data for rendering route lines on the map.

#### Scenario: Route polyline returned
- **WHEN** route calculation is successful
- **THEN** the response SHALL include polyline coordinate path for map rendering

#### Scenario: Transit polyline simplified for legibility
- **WHEN** the transit polyline has more than ~30 raw waypoints (typical for cross-city bus routes)
- **THEN** the rendering layer SHALL apply two-stage simplification: outlier filtering (radius 0.15 of canvas length) + Douglas-Peucker (30 px tolerance)
- **AND** the rendered polyline SHALL preserve geographic shape without excess zig-zag noise