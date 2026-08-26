## Purpose

Provides interactive map visualization using Amap JS API for displaying locations, POI markers, info windows, and route polylines.

## ADDED Requirements

### Requirement: Map initialization and rendering
The system SHALL initialize an Amap map instance on the page with configurable center point and zoom level.

#### Scenario: Default map loads successfully
- **WHEN** the page loads
- **THEN** the Amap map SHALL render in the designated container element with default center (Beijing) and zoom level 12

#### Scenario: Map loads with specified center
- **WHEN** the user navigates to a city page
- **THEN** the map SHALL center on that city's coordinates with appropriate zoom level

### Requirement: POI markers with info windows
The system SHALL display markers on the map for each POI (attraction or restaurant) and show an info window when a marker is clicked.

#### Scenario: Clicking marker shows info popup
- **WHEN** user clicks on a POI marker
- **THEN** an info window SHALL appear displaying the POI name, rating, address, and type

#### Scenario: Closing info popup
- **WHEN** user clicks the close button on the info window
- **THEN** the info window SHALL close

### Requirement: Route polyline rendering
The system SHALL render route polylines on the map between consecutive stops in the itinerary.

#### Scenario: Route displays between stops
- **WHEN** the AI route plan is generated
- **THEN** the map SHALL display colored polylines connecting each consecutive stop with distance and time labels

#### Scenario: Multiple transport modes shown differently
- **WHEN** route segments have different transport modes
- **THEN** each segment SHALL be rendered with a distinct color for each transport mode (driving, walking, transit, cycling)