## Purpose

Provides a 4-step progressive wizard interface that guides users through the travel planning process: setting start/end points, selecting attractions, choosing restaurants, and generating the final AI-optimized route.

## ADDED Requirements

### Requirement: Step-by-step wizard navigation
The system SHALL present a 4-step wizard interface with clear navigation between steps.

#### Scenario: Initial step visible
- **WHEN** the page loads
- **THEN** Step 1 (Start & End) SHALL be displayed
- **AND** a progress indicator SHALL show steps 1/4 as current

#### Scenario: Navigate to next step
- **WHEN** user completes required fields in current step and clicks "Next"
- **THEN** the system SHALL advance to the next step
- **AND** update the progress indicator

#### Scenario: Navigate to previous step
- **WHEN** user clicks "Back" button
- **THEN** the system SHALL return to the previous step
- **AND** preserve all previously entered data

### Requirement: Step 1 — Start and end point input
The system SHALL allow users to input start and end locations for their trip.

#### Scenario: Input start location
- **WHEN** user types a location name in the start input
- **THEN** the system SHALL provide autocomplete suggestions using Amap geocoding
- **AND** place a marker on the map when a location is selected

#### Scenario: Input end location
- **WHEN** user types a location name in the end input
- **THEN** the system SHALL provide autocomplete suggestions
- **AND** place a marker on the map when a location is selected

### Requirement: Step 2 — Attraction selection
The system SHALL display attractions with map markers and slider controls.

#### Scenario: City input triggers search
- **WHEN** user enters a city name in Step 2
- **THEN** the system SHALL search for attractions in that city
- **AND** display them as map markers and in a list

#### Scenario: Slider controls count
- **WHEN** user adjusts the Top-N slider
- **THEN** the map SHALL update to show only that many attractions

### Requirement: Step 3 — Restaurant selection
The system SHALL display restaurants with map markers and cost information.

#### Scenario: Restaurant search
- **WHEN** user enters a city name in Step 3
- **THEN** the system SHALL search for restaurants in that city
- **AND** display them with rating and average cost

#### Scenario: Info card shows cost
- **WHEN** user clicks a restaurant marker
- **THEN** the info card SHALL display the average cost per person

### Requirement: Step 4 — Route plan display
The system SHALL display the final AI-generated route on the map.

#### Scenario: Generate route button
- **WHEN** user clicks "Generate Route" in Step 4
- **THEN** the system SHALL call the LLM route planning API
- **AND** display a loading state while generating

#### Scenario: Route summary panel
- **WHEN** the route is generated
- **THEN** a summary panel SHALL show total distance, total time, and stop-by-stop breakdown

### Requirement: State preservation across steps
The system SHALL preserve user selections when navigating between steps.

#### Scenario: Selections persist
- **WHEN** user goes back from Step 3 to Step 2
- **THEN** all previously selected attractions SHALL remain selected
- **AND** the slider value SHALL remain unchanged