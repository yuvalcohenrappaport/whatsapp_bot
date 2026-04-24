---
phase: 54-proactive-day-of-intelligence
plan: "01"
subsystem: database, infra, integrations

tags: [drizzle, sqlite, openweather, node-cron, iana-timezone, intl-datetimeformat, gemini-fallback, pino, better-sqlite3, zod]

# Dependency graph
requires:
  - phase: 51-richer-trip-memory
    provides: "tripContexts.start_date/end_date/status/briefing_time/calendar_id columns and upsertTripContext; tripMemory helper conventions; in-memory migration-replay test pattern"
  - phase: 54-02 (sibling, shipped first)
    provides: "Gemini grounded search wrapper geminiGroundedSearch.ts — Plan 54-03 uses it for transit alerts; independent of this plan's schema change"
provides:
  - "`trip_contexts.metadata` TEXT column (migration 0023) for per-trip soft state"
  - "`upsertTripContext({ metadata })` optional patch path"
  - "`src/integrations/openWeather.ts` — `resolveCoords` + `getDestinationForecast` with one-shot 5s 429 retry"
  - "`src/cron/briefingCron.ts` — 15-min cron, ~50-destination TZ_TABLE, `resolveDestinationTz` cascade, `isInBriefingWindow`, `runBriefingCheckOnce` with orchestrator DI seam, idempotent `initBriefingCron`"
  - "`getActiveContextsForBriefing()` query returning a narrow shape for the cron"
  - "`OPENWEATHER_API_KEY` optional zod config + .env.example placeholder"
affects: [54-03 day-of briefing orchestrator, 54-04 orchestrator+weather+calendar composition, 55 multi-currency budget normalization (future)]

# Tech tracking
tech-stack:
  added: ["OpenWeather /geo/1.0/direct + /data/2.5/forecast API (via native fetch — no SDK)"]
  patterns:
    - "Free-form `metadata` TEXT JSON column per table for additive soft state (mirrors trip_decisions.metadata from Phase 51)"
    - "API key passed as a function parameter so tests don't need to mock the config module"
    - "Orchestrator DI seam in cron ticks: optional function param + default dynamic import with ERR_MODULE_NOT_FOUND swallow — lets Wave 1 ship before Plan 03 lands dayOfBriefing.ts"
    - "Destination-tz arithmetic via `Intl.DateTimeFormat('en-CA' | 'en-GB', { timeZone })` + `formatToParts` (no moment/luxon/dayjs-tz dep)"
    - "TZ resolution cascade: cached-tz → exact lowercase table → partial match → Gemini one-shot regex-validated IANA → DEFAULT_TZ"

key-files:
  created:
    - "drizzle/0023_add_metadata_to_trip_contexts.sql"
    - "src/integrations/openWeather.ts"
    - "src/cron/briefingCron.ts"
    - "src/db/__tests__/migration0023.test.ts"
    - "src/integrations/__tests__/openWeather.test.ts"
    - "src/cron/__tests__/briefingCron.test.ts"
  modified:
    - "src/db/schema.ts (+ tripContexts.metadata field)"
    - "src/db/queries/tripMemory.ts (+ upsertTripContext metadata patch; + getActiveContextsForBriefing)"
    - "src/config.ts (+ OPENWEATHER_API_KEY optional)"
    - ".env.example (+ OPENWEATHER_API_KEY placeholder)"
    - "drizzle/meta/_journal.json (+ idx 23 entry)"

key-decisions:
  - "Added `metadata` param to upsertTripContext in Task 1 rather than Task 3 — the Task 1 upsert round-trip test requires it; tightly coupled to the column add"
  - "OpenWeather client uses native fetch (Node 18+) — no axios/got dep for a two-endpoint integration"
  - "Logger in openWeather.ts reads `process.env.LOG_LEVEL ?? 'info'` directly instead of importing config — keeps the test surface trivial (no config mock needed)"
  - "Orchestrator (Plan 03's runDayOfBriefing) imported dynamically with try/catch on ERR_MODULE_NOT_FOUND — the cron can initialize and tick green during Wave 1 without Plan 03's file existing"
  - "Added a _journal.json idx-23 entry manually so drizzle-kit's migrator (used in prod paths) sees the migration as applied — tests don't care but the runtime path does"
  - "`resolveDestinationTz` returns `DEFAULT_TZ = 'Asia/Jerusalem'` when Gemini returns a non-IANA string or throws — the briefing should never crash on a lookup edge case"
  - "TZ regex validation `^[A-Za-z_]+\\/[A-Za-z_]+(\\/[A-Za-z_]+)?$` permits two- and three-segment zones (e.g. `America/Argentina/Buenos_Aires`) and rejects free-form prose"

patterns-established:
  - "Per-trip soft state lives in `tripContexts.metadata` as JSON — callers merge-patch by reading, spreading, and writing back via `upsertTripContext({ metadata: JSON.stringify(next) })`"
  - "Cron files pattern: `src/cron/<name>Cron.ts` exporting `init<Name>Cron` (idempotent — stops prior scheduled task) + `run<Name>Once(nowMs?, dependencies?)` pure function for testing"
  - "Window checks gate on three independent conditions, each returning false early: date-range, dedup, time-of-day ± tolerance"
  - "Test pattern for briefingCron-style modules: mock config/db/ai with `vi.mock()` BEFORE the dynamic `await import()` of the module under test"

requirements-completed: [DAY-01, DAY-03]

# Metrics
duration: 13min
completed: 2026-04-24
---

# Phase 54 Plan 01: Day-Of Foundations Summary

**`trip_contexts.metadata` TEXT column via migration 0023, OpenWeather geo+forecast client with one-shot 429 retry, and a 15-min briefing cron skeleton with ~50-destination IANA TZ table, Intl-based window math, and a dynamic-import orchestrator DI seam.**

## Performance

- **Duration:** ~13 min (2026-04-24T20:09:28Z → 2026-04-24T20:22:11Z)
- **Started:** 2026-04-24T20:09:28Z
- **Completed:** 2026-04-24T20:22:11Z
- **Tasks:** 4 / 4
- **Files created:** 6
- **Files modified:** 5
- **Tests added:** 29 (2 migration + 9 openWeather + 18 briefingCron)

## Accomplishments

- Migration 0023 unblocks Plans 54-03 and 54-04, which need `metadata` for `last_briefing_date`, cached `tz`, and resolved OpenWeather `coords`.
- `resolveCoords` + `getDestinationForecast` cover the weather enrichment source (source 2 of 6 per Phase 54 CONTEXT.md) — with native-fetch, no new dependency, and a precise 5s single-retry on 429 that exhausts to a throw.
- `src/cron/briefingCron.ts` is a complete Wave-1-runnable skeleton: `initBriefingCron()` can be wired into `src/index.ts` today and will cleanly no-op at each tick until Plan 03 lands `dayOfBriefing.ts` (ERR_MODULE_NOT_FOUND is swallowed with a debug log).
- `isInBriefingWindow` correctly handles Israel DST (Asia/Jerusalem UTC+3 summer) and uses destination-tz for both the date window gate and the ±7min time gate — verified by 10 boundary tests.
- `resolveDestinationTz` cascade tested at every level: cached short-circuit, exact lowercase match, partial match ("central Rome"), Gemini-success, Gemini-bad-response, Gemini-throw — all return sensible values.
- Zero new test regressions: full suite is 549 pass / 6 fail / 7 skip — the 6 failures are the exact same Phase-51-deferred commitments + actionables set.

## Task Commits

Each task committed atomically on `feat/v2.1-travel-agent-design`:

1. **Task 1: Migration 0023 + schema.ts + upsertTripContext metadata** — `f73df98` (feat)
2. **Task 2: OpenWeather client + OPENWEATHER_API_KEY config** — `82993ae` (feat)
3. **Task 3: briefingCron skeleton + getActiveContextsForBriefing** — `00de5f1` (feat)
4. **Task 4: Unit tests (29 tests across 3 files)** — `8ec5295` (test)

**Plan metadata commit:** (pending, follows SUMMARY.md + STATE.md + ROADMAP.md write)

## Files Created

- `drizzle/0023_add_metadata_to_trip_contexts.sql` — single-statement ALTER TABLE ADD COLUMN, no DEFAULT, nullable (mirrors 0022's `trip_decisions.metadata`)
- `src/integrations/openWeather.ts` — geo lookup + forecast with 40-slot limit, units=metric, 5s one-shot 429 retry
- `src/cron/briefingCron.ts` — TZ_TABLE (~50 entries), `resolveDestinationTz`, `dateInTz`, `isInBriefingWindow`, `runBriefingCheckOnce`, `initBriefingCron`, plus a `defaultOrchestrator` shim
- `src/db/__tests__/migration0023.test.ts` — PRAGMA table_info shape assertion + upsert round-trip
- `src/integrations/__tests__/openWeather.test.ts` — 9 tests incl. 429 retry + retry exhaustion via fake timers
- `src/cron/__tests__/briefingCron.test.ts` — 18 tests incl. Israel DST + 7-min boundary

## Files Modified

- `src/db/schema.ts` — `tripContexts.metadata = text('metadata')` appended after `briefingTime`
- `src/db/queries/tripMemory.ts` — added optional `metadata` to `upsertTripContext`; added `getActiveContextsForBriefing()` returning the 7-column shape the cron needs
- `src/config.ts` — `OPENWEATHER_API_KEY: z.string().optional()` so missing key degrades gracefully (briefing falls back to calendar-only per 54-CONTEXT.md)
- `.env.example` — placeholder line
- `drizzle/meta/_journal.json` — idx 23 entry so drizzle-kit's runtime migrator sees the file as applied

## Decisions Made

- **Bundled the `metadata` param into Task 1's tripMemory edit** rather than Task 3. The Task 1 "upsert-then-read round-trip" test explicitly requires it, and the plan itself calls out the param add in Task 3 — so splitting the change would have produced an intermediate broken state at Task 1's verify. One focused commit per concern: Task 1 = schema + minimal API touch; Task 3 = query function + cron.
- **Logger in `openWeather.ts` reads `process.env.LOG_LEVEL` directly** (not `config.LOG_LEVEL`) to avoid importing `config` — keeps the module's test surface trivial (no zod mock needed) and honors the plan's explicit constraint ("Do NOT import `config` inside `openWeather.ts`").
- **Orchestrator injected as an optional function parameter** in `runBriefingCheckOnce(nowMs?, orchestrator?)` with `defaultOrchestrator` as the fallback that does the dynamic import. Tests pass a plain async fn (or don't call runBriefingCheckOnce at all — the tz and window tests cover the pure logic). Wave 1 ships a working cron; Wave 2 (Plan 03) lands the real orchestrator.
- **`dateInTz` exported** (plan only listed 4 required exports) because the briefing orchestrator in Plan 03 will need the same destination-tz → YYYY-MM-DD helper to filter calendar events. Cheap export now, avoids reimplementing later.
- **Partial match loop iterates `Object.entries(TZ_TABLE)` unordered** — acceptable because longest non-ambiguous keys are first in source; if "Rome" and "New Rome" ever both existed the order would matter, but no current entry pair collides.

## Deviations from Plan

**None.** Plan executed exactly as written, with two small design micro-choices documented under Decisions Made:

1. The `metadata` param add in `upsertTripContext` happened in Task 1 (co-located with schema change) rather than Task 3 (co-located with other cron-facing edits) — both files touched in both tasks, but this keeps each task's commit atomic and passing verification independently.
2. `dateInTz` is exported even though the plan didn't require it — cheap, no downside, anticipates Plan 03 usage.

Both are code-organization choices, not scope changes.

## Authentication Gates

**None.** The plan's `user_setup` block lists `OPENWEATHER_API_KEY`, but per the plan note tests mock `fetch` and never hit the real API — the key isn't needed for this plan's success criteria. Plan 04 (live weather integration) can surface a human-action checkpoint for the user to add the key to `.env` before running the `runDayOfBriefing` with real-API integration test.

## Issues Encountered

None. Baseline `npx tsc --noEmit` showed the 2 pre-existing `cli/*.ts` rootDir warnings only; all 4 tasks compiled clean and all 29 new tests passed on first run.

## User Setup Required

**Optional for this plan — required for Plan 54-04 (live weather enrichment).**

To enable real weather data instead of the mocked path:

1. Register a free account at https://openweathermap.org/api
2. Copy the API key from "My API keys" in the dashboard
3. Add to `.env`: `OPENWEATHER_API_KEY=<paste-here>`
4. The free tier (60 calls/min, 1M/month) is ample for one briefing/trip/day

No dashboard configuration. No OAuth flow. Quick, self-serve.

## Next Phase Readiness

**Plan 54-03 (dayOfBriefing orchestrator)** is now unblocked:
- `trip_contexts.metadata` exists for `last_briefing_date` persistence
- `getDestinationForecast` is ready for source-2 of the 6-source cascade
- `resolveDestinationTz` provides destination-tz for calendar/Gemini filters
- `runBriefingCheckOnce` provides the orchestrator DI seam — Plan 03 just drops `runDayOfBriefing` in `src/groups/dayOfBriefing.ts` and the dynamic import picks it up

**Plan 54-04 (orchestrator wiring + live-API smoke test)** blocker:
- Needs the user to add `OPENWEATHER_API_KEY` to `.env` before the live-API integration test will exercise the real `resolveCoords` + `getDestinationForecast` paths. Unit tests in this plan use mocked `fetch` and pass without the key.

**Wiring into `src/index.ts`:** Not done in this plan (Plan 03 or 04 scope). `initBriefingCron()` is idempotent and ready to be called after `initArchiveTripsCron()` in `main()`.

## Self-Check: PASSED

Verified on disk:
- `drizzle/0023_add_metadata_to_trip_contexts.sql` — FOUND
- `src/db/schema.ts` — `metadata` field present on tripContexts (line 162)
- `src/integrations/openWeather.ts` — FOUND with `resolveCoords` + `getDestinationForecast` exports
- `src/cron/briefingCron.ts` — FOUND with `resolveDestinationTz`, `isInBriefingWindow`, `runBriefingCheckOnce`, `initBriefingCron`, `dateInTz` exports
- `src/db/queries/tripMemory.ts` — `getActiveContextsForBriefing` exported; `upsertTripContext` accepts `metadata`
- `src/config.ts` — `OPENWEATHER_API_KEY: z.string().optional()` present
- `.env.example` — `OPENWEATHER_API_KEY=your-openweathermap-api-key` present
- `drizzle/meta/_journal.json` — idx 23 entry present
- Commits f73df98 / 82993ae / 00de5f1 / 8ec5295 — all FOUND in `git log --oneline`
- `npx tsc --noEmit` — clean (pre-existing cli rootDir warnings only)
- `npx vitest run src/integrations/__tests__/openWeather.test.ts src/cron/__tests__/briefingCron.test.ts src/db/__tests__/migration0023.test.ts` — 29/29 pass
- Full `npx vitest run` — 549 pass / 6 fail / 7 skip; 6 failures match Phase 51 deferred set exactly (0 regressions)

---
*Phase: 54-proactive-day-of-intelligence*
*Plan: 01*
*Completed: 2026-04-24*
