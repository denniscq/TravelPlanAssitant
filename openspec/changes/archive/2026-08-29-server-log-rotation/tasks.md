## 1. Dependencies

- [x] 1.1 Add `winston@^3.13` to `dependencies` in `package.json`
- [x] 1.2 Add `winston-daily-rotate-file@^4.7` to `dependencies` in `package.json`
- [x] 1.3 Run `npm install` and verify lockfile updates cleanly (29 packages added)
- [x] 1.4 Add `logs/` and `logs/.winston-audit.json` to `.gitignore`

## 2. ServerLogger refactor (TDD)

- [x] 2.1 Write failing tests for `ServerLogger` DI seam: construct `new ServerLogger(requestId, fakeWinston)`; assert `info('foo')` calls `fakeWinston.info` with the pre-formatted `[ts][level][requestId] foo` string
- [x] 2.2 Verify the RED — tests fail with a clear "winston not invoked" / "Writable is not defined" messages
- [x] 2.3 Implement `ServerLogger` with optional `winston?: Logger` constructor parameter; default to production winston singleton when omitted
- [x] 2.4 Run tests → GREEN
- [x] 2.5 Write tests asserting format byte-for-byte match: `info('hello')` produces `[YYYY-MM-DD HH:mm:ss][INFO][<requestId>] hello`
- [x] 2.6 Run tests → GREEN (regression guard against format drift)

## 3. Winston singleton and rotation transport

- [x] 3.1 Implement `getWinstonLogger()` lazy singleton; first call constructs winston with `Console` transport + `DailyRotateFile` transport configured per design.md
- [x] 3.2 Write failing tests asserting the singleton behavior: 1st call creates instance, 2nd call returns same instance
- [x] 3.3 Run tests → GREEN
- [x] 3.4 Write failing tests asserting build-time safety: importing the module without calling `createServerLogger` does NOT create `logs/`
- [x] 3.5 Run tests → GREEN

## 4. Rotation behavior

- [x] 4.1 Write failing tests asserting `maxFiles: '7d'` is passed to the `DailyRotateFile` transport
- [x] 4.2 Run tests → GREEN
- [x] 4.3 Write failing tests asserting filename pattern `TravelPlanAssistant-%DATE%.log` with `datePattern: 'YYYY-MM-DD'`
- [x] 4.4 Run tests → GREEN
- [x] 4.5 Write failing tests using fake timers: advance the clock across 8 daily boundaries, write one log per day, assert only 7 files remain and the oldest is deleted
- [x] 4.6 Run tests → GREEN (full 7-day retention scenario)

## 5. LOG_DIR configuration

- [x] 5.1 Write failing tests for `LOG_DIR` env var override: when set, rotation transport uses that directory; when unset, defaults to `logs/`
- [x] 5.2 Run tests → GREEN
- [x] 5.3 Use the existing `tracked` env save/restore pattern (per `AGENT_NOTES.md - env-save-restore`) in `beforeEach` / `afterEach`

## 6. CreateServerLogger wiring

- [x] 6.1 Update `createServerLogger(request)` to inject the winston singleton into the new `ServerLogger`
- [x] 6.2 Verify all 16 API route handlers and 5 service modules compile unchanged (`npx tsc --noEmit`) — 0 errors

## 7. Deployment documentation

- [x] 7.1 Create `docs/deployment-server-logs.md` with `logs/` directory setup section (manual mkdir + systemd `LogsDirectory=` + `LOG_DIR` env)
- [x] 7.2 Add a one-paragraph note about manual deletion: also delete `logs/.winston-audit.json` to avoid stale state

## 8. Verification

- [x] 8.1 Run `npx vitest run` — 12 files / 132 tests pass (was 11/123)
- [x] 8.2 Run `npx tsc --noEmit` — 0 errors
- [x] 8.3 Run `npx next build` — successful build, `logs/` does NOT exist after build (lazy singleton confirmed)
- [x] 8.4 Manual end-to-end: started dev server test calls confirmed `logs/TravelPlanAssistant-2026-08-29.log` created with formatted lines

## 9. Memory + archive

- [x] 9.1 Add `decision-2026-08-29-server-log-rotation` and `decision-2026-08-29-server-logger-di-singleton` entries to `DECISIONS.md`
- [x] 9.2 Update `PROJECT_CONTEXT.md` durable facts: new env var `LOG_DIR`, new deployment requirement
- [x] 9.3 No new KNOWN_FAILURES entries needed (TDD exposed two transient test harness issues — `Writable` named import + `transport.flush()` not implemented — both fixed in test setup, not in production code)
- [x] 9.4 `scripts/validate-superpowers-memory.ps1` does not exist in this repo (the `superpowers-memory.md` rule references it but it has never been authored). Marking N/A; memory updates were done by hand.
- [x] 9.5 Run `openspec archive 2026-08-29-server-log-rotation --yes` — change archived to `openspec/changes/archive/2026-08-29-server-log-rotation/`; spec delta applied to `openspec/specs/server-logging/spec.md`
