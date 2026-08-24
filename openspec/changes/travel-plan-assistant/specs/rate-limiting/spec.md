## Purpose

Protects the LLM API from abuse by enforcing IP-based rate limiting using a sliding window algorithm, preventing excessive API calls from unauthenticated users.

## ADDED Requirements

### Requirement: IP-based rate limiting
The system SHALL track and limit the number of LLM API requests per IP address using a sliding window algorithm.

#### Scenario: Request within limit
- **WHEN** a user sends an LLM route planning request
- **AND** the IP has made fewer than 10 requests in the last hour
- **THEN** the request SHALL proceed to call the LLM API

#### Scenario: Request exceeds limit
- **WHEN** a user sends an LLM route planning request
- **AND** the IP has made 10 or more requests in the last hour
- **THEN** the system SHALL return HTTP 429 (Too Many Requests)
- **AND** include a Retry-After header with the wait time in seconds

### Requirement: Rate limit state management
The system SHALL maintain rate limit state in memory without external storage.

#### Scenario: In-memory state
- **WHEN** rate limit counters are created
- **THEN** they SHALL be stored in memory only
- **AND** no database or external cache SHALL be required

#### Scenario: State reset on restart
- **WHEN** the server restarts
- **THEN** all rate limit counters SHALL reset to zero

### Requirement: Rate limit configuration
The rate limit parameters SHALL be configurable via environment variables.

#### Scenario: Configure max requests
- **WHEN** the LLM_SERVICE_RATE_LIMIT_MAX environment variable is set
- **THEN** the system SHALL use that value as the maximum requests per window

#### Scenario: Configure window duration
- **WHEN** the LLM_SERVICE_RATE_LIMIT_WINDOW_MS environment variable is set
- **THEN** the system SHALL use that value as the sliding window duration in milliseconds