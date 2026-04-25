---
phase: 54-proactive-day-of-intelligence
plan: "05"
subsystem: cron
tags: [vitest, typescript, briefing-cron, day-of-briefing, BriefingInput, dependency-injection]

# Dependency graph
requires:
  - phase: 54-proactive-day-of-intelligence
    provides: "Plans 01-04: BriefingInput interface, runDayOfBriefing, cron loop, dedup, TZ resolution"
provides:
  - "defaultOrchestrator passes full BriefingInput to runDayOfBriefing (not bare string)"
  - "Wave-1 Cannot-find-module swallow block removed"
  - "Orchestrator DI seam typed as (input: BriefingInput) => Promise<void>"
  - "Integration test contract coverage: DI-mock objectContaining + real-orchestrator spy"
affects: [production briefing delivery, cron observability, future orchestrator changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BriefingInput assembled at call site from row + config before passing to orchestrator"
    - "import type used for cross-module type sharing without hard runtime dep"
    - "vi.mock at module level registers test doubles before dynamic imports resolve"

key-files:
  created: []
  modified:
    - src/cron/briefingCron.ts
    - src/cron/__tests__/briefingCron.integration.test.ts

key-decisions:
  - "Use import type { BriefingInput } (not regular import) to avoid circular runtime dep with the existing dynamic import('../groups/dayOfBriefing.js') inside defaultOrchestrator"
  - "Delete Wave-1 ERR_MODULE_NOT_FOUND swallow — Plan 03 shipped, keeping it hides the exact integration-drift error class we want to surface"
  - "Move todayInDestTz compute before the try-block so it can be threaded into BriefingInput and reused for last_briefing_date stamp without duplication"
  - "vi.mock('../../groups/dayOfBriefing.js') at module level so defaultOrchestrator's dynamic import resolves to the spy during tests without DI injection"

patterns-established:
  - "Negative-guard pattern: revert call site to bare string → new test fails with clear shape mismatch, confirming test value"

requirements-completed: [DAY-01]

# Metrics
duration: 10min
completed: 2026-04-24
---

# Phase 54 Plan 05: Gap Closure — Cron → Orchestrator BriefingInput Contract Summary

**Closed production gap where defaultOrchestrator passed a bare groupJid string to runDayOfBriefing, causing all BriefingInput fields to be undefined and every briefing day to be silently skipped while the dedup stamp claimed it was done**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-24T21:01:10Z
- **Completed:** 2026-04-24T21:11:10Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Rebuilt `defaultOrchestrator` to accept `BriefingInput` and pass it through to `runDayOfBriefing` — the Wave-1 bare-string contract is gone
- Removed Wave-1 `Cannot find module / ERR_MODULE_NOT_FOUND` swallow block that was hiding integration-drift errors post-Plan-03
- Threaded `destTz`, `todayInDestTz` (computed once, before the call), `coords` (narrowed from metadata via typeof guards), `calendarId`, `destination`, and `openWeatherApiKey` into a single BriefingInput at the call site
- Added `import type { BriefingInput }` — TypeScript now catches any future regression to a bare-string call
- Updated existing DI-mock assertion from `toHaveBeenCalledWith(GROUP)` to `objectContaining({ groupJid, destination, calendarId, destTz, todayIso, coords, openWeatherApiKey })`
- Added `vi.mock('../../groups/dayOfBriefing.js')` module-level mock so `defaultOrchestrator`'s dynamic import resolves to a spy without DI injection
- Added two new integration tests under "real runDayOfBriefing contract" describe block: full BriefingInput shape with coords+calendarId, and null-coords/null-calendarId regression guard
- Negative-guard spot-check confirmed: reverting call site to bare string breaks 4 integration tests with clear string-vs-object shape mismatch

## Task Commits

Each task was committed atomically:

1. **Task 1: Rebuild defaultOrchestrator; thread destTz + todayInDestTz; widen DI type; remove Wave-1 swallow** - `97f9e97` (feat)
2. **Task 2: Update DI-mock assertion + add real-orchestrator integration test case** - `6308678` (test)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `src/cron/briefingCron.ts` - BriefingInput import; defaultOrchestrator rebuilt; DI seam widened; todayInDestTz moved earlier; coords narrowed; Wave-1 swallow deleted
- `src/cron/__tests__/briefingCron.integration.test.ts` - Module-level dayOfBriefing mock; BriefingInput type import; orchestratorMock widened; existing assertions updated to objectContaining; two new real-orchestrator contract test cases

## Decisions Made
- Used `import type` (not `import`) for BriefingInput to avoid a hard runtime circular dependency with the existing `dynamic import('../groups/dayOfBriefing.js')` inside defaultOrchestrator — the type is erased at compile time, the dynamic import remains the only runtime path
- Deleted the Wave-1 ERR_MODULE_NOT_FOUND swallow unconditionally — Plan 03 shipped the module, and the `runBriefingCheckOnce` caller's own try/catch already handles orchestrator throws gracefully
- `todayInDestTz` moved before the try block so it is in scope for both the BriefingInput payload AND the post-success `last_briefing_date` stamp, eliminating a duplicate `dateInTz()` call

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
- `npx tsc --noEmit` exit code 2 and only shows cli rootDir warnings — masking the actual briefingCron type error. Verified the TypeScript negative guard works by running tsc with a temporary tsconfig that excludes cli/, which surfaced `error TS2345: Argument of type 'string' is not assignable to parameter of type 'BriefingInput'`. The integration test negative guard is a stronger signal and was confirmed to fire correctly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 54 gap fully closed: defaultOrchestrator now passes a complete BriefingInput, runDayOfBriefing will receive all fields it needs, and the day will only be stamped done after the orchestrator call completes
- TypeScript and integration tests both enforce the contract going forward
- No blockers for production deployment

---
*Phase: 54-proactive-day-of-intelligence*
*Completed: 2026-04-24*
