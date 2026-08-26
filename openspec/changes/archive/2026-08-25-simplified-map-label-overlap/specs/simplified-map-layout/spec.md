## Purpose

Renders a hand-drawn-style simplified metro-map of an itinerary on the route-plan step, with POIs placed by geographic projection and segments drawn between them.

## ADDED Requirements

### Requirement: POI label maximum size is uniform
All POI labels (start, end, attraction, restaurant) MUST share the same maximum rectangle dimensions, so that any pair of labels has a uniform footprint for overlap detection.

#### Scenario: Label width is bounded by max chars per line
- **WHEN** rendering a POI label
- **THEN** the label rectangle width SHALL equal `MAX_LABEL_CHARS_PER_LINE × CHAR_WIDTH_PX + 2 × LABEL_PAD_X` (default `6 × 14 + 20 = 104px`)
- **AND** any POI name longer than `MAX_LABEL_CHARS_PER_LINE` SHALL wrap to the next line
- **AND** if the wrapped lines exceed `MAX_LABEL_LINES = 3`, the name SHALL be truncated to keep the first `MAX_LABEL_CHARS_PER_LINE × (MAX_LABEL_LINES - 1) - 1` characters and append an ellipsis

#### Scenario: Label height is bounded by max lines
- **WHEN** rendering a POI label
- **THEN** the label rectangle height SHALL equal `MAX_LABEL_LINES × LABEL_LINE_HEIGHT + subtitleLineHeight + 2 × LABEL_PAD_Y` (default `3 × 18 + 18 + 12 = 84px` when a subtitle is present)

### Requirement: All POI labels have a minimum inter-label gap
Any two POI labels MUST be at least `MIN_LABEL_GAP` (default `SEGMENT_BADGE_RADIUS × 2 + 8 = 30px`) apart, measured center-to-center.

#### Scenario: Global de-overlap pass
- **WHEN** all POI labels are placed at their projected anchor positions
- **THEN** the renderer SHALL run a global pair-wise de-overlap pass before the segment de-overlap pass
- **AND** the pass SHALL run for at most 8 iterations, terminating early if no pair is closer than `MIN_LABEL_GAP` and no pair has overlapping AABB

#### Scenario: Start and end labels are pinned
- **WHEN** the global de-overlap pass runs
- **THEN** start and end labels SHALL have weight `Infinity` (i.e. they are not moved)
- **AND** other labels SHALL move along the unit vector pointing away from the conflicting label, with displacement proportional to overlap or shortfall to `MIN_LABEL_GAP`

#### Scenario: Fallback to projected anchor when pass cannot converge
- **WHEN** the global de-overlap pass has not converged after 8 iterations
- **THEN** labels that still overlap SHALL be placed at their projected anchor positions (no displacement), so the user at least sees the real geographic clustering

## MODIFIED Requirements

### Requirement: POI placement uses real projection plus anti-collision

#### Scenario: Start and end labels are pinned to the projected anchor
- **WHEN** the route plan includes a start or end POI
- **THEN** the start label SHALL be placed directly below the projected anchor (anchorY + anchorH)
- **AND** the end label SHALL be placed directly above the projected anchor (anchorY - labelH)
- **AND** the four-direction candidate pass (`placeLabel`) SHALL NOT be applied to start or end labels
