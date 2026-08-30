## Why

The current `ServerLogger` only writes to `console.{level}`. When the app is deployed as a Next.js 14 standalone process on the production Ubuntu 24.04 host, every log line vanishes the moment the SSH session ends or systemd rotates the journal — there is no on-disk record for post-incident forensics. Phase 1 release prep requires persisted logs that survive process restart and remain available for the operational SRE workflows (grep, tail, archive).

## What Changes

- Add file-based log rotation to the existing `ServerLogger`. Each log call writes to **both** the console (unchanged) and a daily-rotated file under `logs/`.
- Rotate daily; filename pattern `TravelPlanAssistant-YYYY-MM-DD.log`.
- Retain the last 7 days; files older than 7 days are deleted automatically by the rotation transport.
- All 4 log levels (DEBUG, INFO, WARN, ERROR) are persisted; no level filtering in Phase 1.
- Persist log line format `[YYYY-MM-DD HH:mm:ss][LEVEL][requestId] message` byte-for-byte so existing grep / awk tooling continues to work.
- Public API of `createServerLogger` and `ServerLogger` (constructors, methods, signatures) is **unchanged**. The 16 API routes and 5 service modules that consume the logger require **zero** code changes.
- Add new dependencies `winston` and `winston-daily-rotate-file` to `package.json`.
- Add `logs/` and `logs/.winston-audit.json` to `.gitignore`.
- Update `docs/deployment-guide.md` with `logs/` directory setup notes for the Ubuntu 24.04 systemd deployment.

## Capabilities

### New Capabilities

- `server-logging`: server-side structured logging with daily rotation and 7-day retention. Covers the winston wiring inside `ServerLogger`, the rotation transport configuration, the public API compatibility guarantee, and the file naming convention.

### Modified Capabilities

None. No existing capability requirements change. `client-logger` (browser-side) is intentionally untouched. The behavior change is purely additive — adding file output behind the existing console output — and does not alter any observable spec-level requirement of the 16 API routes or 5 services that consume the logger.

## Impact

- **Affected code**:
  - `src/lib/utils/server-logger.ts` — refactor internal implementation to wrap a winston logger; preserve public API.
  - `src/lib/utils/server-logger.test.ts` — new file; co-located unit + rotation tests.
- **Affected APIs**: no API route or service signature changes.
- **Affected dependencies**:
  - Add `winston@^3.13` to `dependencies`.
  - Add `winston-daily-rotate-file@^4.7` to `dependencies`.
- **Affected files**:
  - `package.json` — two new dependency entries.
  - `.gitignore` — add `logs/` and `logs/.winston-audit.json`.
  - `docs/deployment-guide.md` — add `logs/` directory setup section (mkdir + permissions or systemd `LogsDirectory=`).
- **Affected runtime behavior**:
  - Production process writes one log file per day; disk usage grows with traffic.
  - `journalctl -u travelplanassistant` continues to work (Console transport preserved).
  - Files in `logs/` older than 7 days are auto-deleted.
