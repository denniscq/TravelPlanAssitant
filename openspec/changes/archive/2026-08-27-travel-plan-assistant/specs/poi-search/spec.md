## Purpose

Enables users to search for attractions and restaurants in a specified city using Amap POI Search API, sorted by rating, with configurable result count via a slider control.

## ADDED Requirements

### Requirement: City-based POI search
The system SHALL allow users to search for POIs (attractions or restaurants) by entering a city name.

#### Scenario: Search attractions in a city
- **WHEN** user enters a city name and selects "attractions" category
- **THEN** the system SHALL query Amap POI Search API with type code for scenic spots
- **AND** display results sorted by rating in descending order

#### Scenario: Search restaurants in a city
- **WHEN** user enters a city name and selects "restaurants" category
- **THEN** the system SHALL query Amap POI Search API with type code for dining services
- **AND** display results sorted by rating in descending order

#### Scenario: Empty or invalid city name
- **WHEN** user enters an empty or invalid city name
- **THEN** the system SHALL display an error message indicating the city was not found

### Requirement: Top-N result count slider
The system SHALL provide a slider control to adjust the number of POI results displayed on the map.

#### Scenario: Slider adjusts result count
- **WHEN** user moves the slider to value N
- **THEN** the system SHALL display the top N rated POIs on the map

#### Scenario: Slider range constraints
- **WHEN** the slider is at minimum value
- **THEN** the system SHALL display at least 1 POI
- **WHEN** the slider is at maximum value
- **THEN** the system SHALL display at most 20 POIs

### Requirement: POI type classification
The system SHALL classify POIs into attractions and restaurants based on Amap type codes.

#### Scenario: Attraction type filter
- **WHEN** user searches for attractions
- **THEN** the system SHALL use Amap type code "风景名胜" for scenic spots
- **AND** display the POI type label in the info card

#### Scenario: Restaurant type filter
- **WHEN** user searches for restaurants
- **THEN** the system SHALL use Amap type code "餐饮服务" for dining services
- **AND** display the cuisine type label in the info card

### Requirement: POI selection with add-to-itinerary
The system SHALL allow users to add POIs to their itinerary by clicking a "+" button.

#### Scenario: Add POI to itinerary
- **WHEN** user clicks the "+" button on a POI marker or card
- **THEN** the POI SHALL be added to the selected itinerary list
- **AND** the "+" button SHALL change to a checkmark or "added" state

#### Scenario: Remove POI from itinerary
- **WHEN** user clicks the checkmark button on an already-added POI
- **THEN** the POI SHALL be removed from the selected itinerary list