## Context

`ServerLogger` lives in `src/lib/utils/server-logger.ts`. Today it constructs a request-scoped object whose four methods (`debug`, `info`, `warn`, `error`) call `console.*` directly. The same module also exports `createServerLogger(request: NextRequest)` which reads `x-request-id` (or generates a UUID) and constructs the logger. The format helper `formatLogMessage` lives in `src/lib/utils/logger.ts` and produces the `[timestamp][level][requestId] message` string. There are **16 API route handlers** and **5 service modules** that consume this logger; none of them care whether the underlying sink is `console` or a file — they only pass strings.

The deployment target is the existing Next.js 14 standalone process (`node .next/standalone/server.js`) running under systemd on Ubuntu 24.04. `process.cwd()` is the project root, so `logs/` resolves to a stable, predictable location. The single-process assumption already documented in `KNOWN_FAILURES.md` (for `RoutePlanQueue`) applies here — one process means one winston instance, one set of file handles, no coordination problem.

See `proposal.md - Why` for motivation. The user has approved the Winston + winston-daily-rotate-file approach in the Superpowers design review.

## Goals / Non-Goals

**Goals:**
- Persist every server-side log line to a daily-rotated file in `logs/`, in addition to console output.
- Auto-delete files older than 7 days.
- Preserve the existing `[YYYY-MM-DD HH:mm:ss][LEVEL][requestId] message` byte format so downstream tooling (grep / awk / journalctl) keeps working.
- Keep `createServerLogger` and `ServerLogger` public API 100% unchanged.
- Keep all 4 log levels written (no threshold filtering in Phase 1).
- Be safe under `next build` (no file-system side effects at module-load time).

**Non-Goals:**
- Client-side browser log collection / upload.
- Remote log shipping (Loki, ELK, CloudWatch).
- Log-level filtering via env var (reserved `LOG_LEVEL` env slot but not consumed in Phase 1).
- Structured JSON output.
- Log compression / archival to cold storage.
- Multi-process coordination. Single-process assumption only.

## Decisions

### Decision 1: Winston + winston-daily-rotate-file over pino / self-rolled fs

- **Reason**: Native `printf` formatter preserves the existing `[ts][level][requestId] msg` byte format without reformatting. `maxFiles: '7d'` is built-in retention. Zero Next.js 14 / standalone integration friction (plain CommonJS `require`).
- **Alternatives considered**:
  - **pino + pino-roll** — fastest but JSON-only by default; needs a reformat layer to keep the current text format. ESM / worker-thread friction with Next.js 14 standalone.
  - **Self-rolled fs** — zero deps, but must hand-roll rotation, mtime-based retention, concurrent-write safety, and audit-file semantics. Higher maintenance, larger test surface.
- **Impact**: Adds ~250KB to production bundle; adds two dependencies; introduces winston logger singleton in module scope.

### Decision 2: Module-scope lazy singleton winston logger

- **Reason**: Avoid touching the file system during `next build` (where `lib/utils/` may be statically analyzed but never executed). Aligns with the single-process Phase 1 deployment assumption.
- **Alternatives considered**:
  - **Eager singleton at module load** — simple but would attempt `mkdirSync('logs')` and open a file handle during build, leaving stale handles on rebuilds (the `icon.tsx` `.next` cache problem we already documented in `KNOWN_FAILURES.md`).
  - **Per-request logger instance** — would multiply file handles and fight winston's internal stream pool.
- **Impact**: One winston instance per process. `ServerLogger` instances are request-scoped (one per HTTP request), but they all forward to the same winston logger. The winston logger is created on first `createServerLogger(...)` call.

### Decision 3: DI seam — `ServerLogger` constructor accepts a winston instance

- **Reason**: Lets tests inject a capturing transport (e.g. a `Stream` writing into a buffer) without ever touching `logs/`. Keeps `createServerLogger` as the production entry point.
- **Alternatives considered**:
  - **Mock `winston` at module level via Vitest `vi.mock`** — works but couples tests to the winston module shape and makes them brittle across winston versions.
  - **Test only through real files** — slower, harder to control date-based rotation deterministically.
- **Impact**: `ServerLogger` constructor signature gains an optional second arg `winston?: Logger`. Production callers (16 API routes, 5 services) don't see the new arg — `createServerLogger` injects the real winston instance. Tests construct `new ServerLogger(requestId, fakeWinston)` directly.

### Decision 4: File naming — `TravelPlanAssistant-YYYY-MM-DD.log` (user-specified prefix)

- **Reason**: User explicitly chose `TravelPlanAssistant-` prefix during clarification. The dash separator makes `ls logs/` lexically sortable by date.
- **Alternatives considered**:
  - `app-YYYY-MM-DD.log` — generic; user rejected.
  - `TravelPlanAssistant-YYYYMMDD.log` (no dashes) — slightly more compact; user didn't pick this.
- **Impact**: All operational scripts that grep or rotate logs must use this exact prefix. Documented in `docs/deployment-guide.md`.

### Decision 5: Console transport kept in parallel with file transport

- **Reason**: `journalctl -u travelplanassistant` (the existing operational debugging path) keeps working without requiring the operator to `tail logs/`.
- **Alternatives considered**:
  - **Console-only fallback when not running under systemd** — complex detection logic; not worth it for Phase 1.
  - **File-only, drop console** — breaks existing debugging workflow; user did not request this.
- **Impact**: Every log line is emitted twice — once to stdout (via winston Console transport) and once to the daily-rotated file. Negligible overhead.

### Decision 6: `auditFile: 'logs/.winston-audit.json'`

- **Reason**: `winston-daily-rotate-file` uses an audit file to record the file set so rotation / deletion decisions don't re-scan the directory on every write. Pointing it inside `logs/` keeps everything together; adding it to `.gitignore` keeps the file out of version control.
- **Alternatives considered**:
  - **`auditFile` in `os.tmpdir()`** — survives `rm -rf logs/` but rotation decisions then diverge from actual file state if logs/ is partially cleaned by hand.
- **Impact**: Manual deletion of log files should also delete `.winston-audit.json` to avoid stale state.

### Decision 7: Env vars — only `LOG_DIR` is consumed in Phase 1

- **Reason**: Tests need to redirect logs to `os.tmpdir()`. `LOG_LEVEL` is reserved (per user clarification "全部 4 个 level 都写入文件") but not consumed.
- **Alternatives considered**:
  - **Hardcode `logs/`** — simpler but makes tests slow and pollutes the repo working directory.
  - **Consume `LOG_LEVEL` too** — explicitly out of scope per user.
- **Impact**: Production deployment doesn't need to set `LOG_DIR`; default `logs/` is correct under systemd `WorkingDirectory=/opt/travelplanassistant`.

## Risks / Trade-offs

- **Disk fill-up if logs grow faster than expected** → `maxFiles: '7d'` caps retention at 7 days; future enhancement may add `maxSize` per-file cap.
- **Multi-instance deployment breaks the singleton assumption** → already documented for `RoutePlanQueue` in `KNOWN_FAILURES.md`. Phase 1 is single-process only.
- **Concurrent writes corrupt the file** → winston uses an async stream with internal serialization; safe for single-process. For multi-process, would need external locking — out of scope.
- **Manual deletion of logs without deleting `.winston-audit.json` leaves stale state** → documented in `docs/deployment-guide.md` operational notes.
- **`winston-daily-rotate-file` adds a runtime dep that hasn't been audited by this repo** → lock to a specific minor version range (`^4.7`) and review during install; bundle size +250KB is acceptable for Phase 1.
- **Windows vs Linux path semantics differ** → winston uses `path.join` internally; tested on Windows during TDD; deployment verified on Ubuntu.

## Migration Plan

1. **Pre-deploy** (in this change):
   - Update `package.json` with two new dependencies.
   - Refactor `src/lib/utils/server-logger.ts` internal implementation.
   - Add `src/lib/utils/server-logger.test.ts`.
   - Add `logs/` to `.gitignore`.
   - Update `docs/deployment-guide.md` with `logs/` directory setup.
2. **Deploy** (in release):
   - Build: `npx next build` produces `.next/standalone/`.
   - Copy `logs/` (empty placeholder) into the deploy tarball so the directory exists at first boot — or rely on winston's automatic `mkdirSync(..., { recursive: true })`.
   - Systemd unit either:
     - Sets `WorkingDirectory=/opt/travelplanassistant` so `logs/` resolves there; service user has write permission; OR
     - Uses `LogsDirectory=travelplanassistant` + `LogsDirectoryMode=0755` so systemd manages the directory.
   - Restart the service; verify `logs/TravelPlanAssistant-$(date +%F).log` is created on first request.
3. **Rollback**:
   - Revert the commit; rebuild; redeploy.
   - No data migration needed — pre-change code only wrote to console; logs/ is freshly created.

## Open Questions

None. All design-level unknowns were resolved during clarification (rotation library, file prefix, log levels, scope = server-only).
