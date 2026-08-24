## Purpose

Calculates route distance, duration, and polyline data between POIs using Amap Direction API, with automatic transport mode recommendation based on distance.

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
The system SHALL recommend the most suitable transport mode based on distance between POIs.

#### Scenario: Short distance recommends walking
- **WHEN** distance between two POIs is less than 2km
- **THEN** the system SHALL recommend walking as the primary transport mode

#### Scenario: Medium distance recommends driving
- **WHEN** distance between two POIs is between 2km and 20km
- **THEN** the system SHALL recommend driving as the primary transport mode

#### Scenario: Long distance recommends transit
- **WHEN** distance between two POIs exceeds 20km
- **THEN** the system SHALL recommend driving as the primary transport mode

### Requirement: Route polyline data
The system SHALL return polyline path data for rendering route lines on the map.

#### Scenario: Route polyline returned
- **WHEN** route calculation is successful
- **THEN** the response SHALL include polyline coordinate path for map rendering