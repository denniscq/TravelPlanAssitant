## ADDED Requirements

### Requirement: Daily-rotated file logs on the server

The server-side `ServerLogger` SHALL write every log line to both the console (stdout/stderr) and to a daily-rotated file under `logs/`. The file transport SHALL be configured by `winston-daily-rotate-file` with `dirname: 'logs'` (overridable by `LOG_DIR` env var) and `filename: 'TravelPlanAssistant-%DATE%.log'` with `datePattern: 'YYYY-MM-DD'`.

#### Scenario: First log call on a fresh deployment creates today's file
- **WHEN** the first log call (debug / info / warn / error) executes after process start
- **AND** no `logs/` directory exists
- **THEN** the `logs/` directory SHALL be created automatically
- **AND** a file named `logs/TravelPlanAssistant-<today>.log` SHALL be opened for append
- **AND** the log line SHALL be written to that file

#### Scenario: Log line appears in console and file
- **WHEN** a `ServerLogger.info(message)` is called
- **THEN** the formatted message `[YYYY-MM-DD HH:mm:ss][INFO][<requestId>] <message>` SHALL be written to stdout
- **AND** the same formatted string SHALL be appended to `logs/TravelPlanAssistant-<today>.log`

#### Scenario: All four log levels are persisted
- **WHEN** any of `debug`, `info`, `warn`, `error` is called on a `ServerLogger`
- **THEN** the log line SHALL be appended to the current daily file
- **AND** the level label in the formatted message SHALL match the method (`DEBUG` / `INFO` / `WARN` / `ERROR`)

### Requirement: 7-day retention via rotation transport

The daily-rotate-file transport SHALL be configured with `maxFiles: '7d'` so that files older than 7 days from the current date are deleted automatically by the rotation transport when a new file is opened or an existing file is rotated.

#### Scenario: Old file is removed on rotation
- **WHEN** a new daily file is opened at the date rollover
- **AND** a file `TravelPlanAssistant-<date>.log` exists where `<date>` is more than 7 days before today
- **THEN** that old file SHALL be deleted from `logs/`

#### Scenario: 7 most recent daily files are retained
- **WHEN** the rotation transport completes a rollover with `maxFiles: '7d'`
- **THEN** exactly the 7 most recent daily files SHALL remain in `logs/`
- **AND** no file dated older than today minus 6 days SHALL remain

### Requirement: Public API of ServerLogger is preserved

The public surface of `createServerLogger` and `ServerLogger` SHALL remain compatible with all 16 existing API route handlers and 5 service modules that consume the logger. No source file outside `src/lib/utils/server-logger.ts` SHALL need code changes to support this change.

#### Scenario: Constructor signature backward compatible
- **WHEN** an existing caller invokes `createServerLogger(request)` (a `NextRequest`)
- **THEN** the call SHALL continue to return a `ServerLogger` instance
- **AND** the instance SHALL expose `debug`, `info`, `warn`, `error`, and `getRequestId` methods

#### Scenario: Internal DI seam does not break callers
- **WHEN** `ServerLogger` constructor gains an optional second parameter for dependency injection
- **THEN** all 16 API route handlers and 5 service modules that call `createServerLogger(request)` SHALL compile and run without modification
- **AND** the optional second parameter SHALL default to the production winston logger when omitted

### Requirement: Log line format byte-for-byte preserved

Every persisted log line SHALL match the exact byte format produced by the pre-change `console.*` output: `[YYYY-MM-DD HH:mm:ss][LEVEL][<requestId>] <message>`. The level label SHALL be one of `DEBUG`, `INFO`, `WARN`, `ERROR`.

#### Scenario: Format unchanged after winston migration
- **WHEN** `ServerLogger.info('foo')` is called with `requestId = 'abc-123'`
- **THEN** the file line SHALL be `[YYYY-MM-DD HH:mm:ss][INFO][abc-123] foo`
- **AND** the stdout line SHALL be identical: `[YYYY-MM-DD HH:mm:ss][INFO][abc-123] foo`

### Requirement: Build-time safe import

Importing `src/lib/utils/server-logger.ts` during `next build` SHALL NOT create the `logs/` directory, open any file handle, or write any log line.

#### Scenario: No filesystem side effect on module load
- **WHEN** the module is imported but `createServerLogger` has not yet been called
- **THEN** no directory SHALL be created under `logs/`
- **AND** no file handle SHALL be open to any `TravelPlanAssistant-*.log` file

### Requirement: Configuration via LOG_DIR

The log directory SHALL be configurable via the `LOG_DIR` environment variable. When unset or empty, the default directory SHALL be `logs` relative to the current working directory.

#### Scenario: Default directory
- **WHEN** `LOG_DIR` is unset or empty
- **THEN** the rotation transport SHALL write to `<cwd>/logs/`

#### Scenario: Override via env
- **WHEN** `LOG_DIR=/var/log/travelplanassistant` is set before process start
- **THEN** the rotation transport SHALL write to `/var/log/travelplanassistant/` instead of `<cwd>/logs/`
