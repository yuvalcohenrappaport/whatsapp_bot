---
phase: 46-google-tasks-full-list-sync
plan: "02"
subsystem: api
tags: [google-tasks, calendar, aggregator, sse, vitest]

# Dependency graph
requires:
  - phase: 44-unified-editable-calendar
    provides: fetchCalendarWindow aggregator + hashCalendarEnvelope + CalendarEnvelope shape
  - phase: 46-google-tasks-full-list-sync
    plan: "01"
    provides: fetchGtasksCalendarItems helper exported from googleTasks.ts
  - phase: 47-google-calendar-events-sync
    plan: "02"
    provides: Pattern for extending CalendarEnvelope.sources with a new source (gcal as 4th slot)
provides:
  - "CalendarEnvelope.sources.gtasks — 5th source status slot"
  - "fetchCalendarWindow — 5-slot Promise.allSettled with gtasks partial-failure isolation"
  - "hashCalendarEnvelope — status bits include gtasks for SSE change-detection"
affects: [46-03-filter-panel, 46-04-mutations, 46-05-live-verify]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Append-only source extension: new slot at end of Promise.allSettled + new key at end of sources object + new status bit at end of hash string — preserves existing hash values, no client cache invalidation"
    - "Mirror of Phase 47-02 gcal extension pattern — each new source adds exactly 4 lines (import, allSettled slot, sources init, result branch) plus 1 bit to statusBits"

key-files:
  created: []
  modified:
    - src/api/routes/calendar.ts
    - src/api/__tests__/calendar.test.ts

key-decisions:
  - "gtasks placed as 5th slot (after gcal) rather than 4th — Phase 47-02 landed gcal first, and changing ordering would rewrite the existing hash for every running dashboard. Append-only keeps SSE streams stable across the deploy."
  - "Test assertions for `sources` deep-equal updated from 4-key to 5-key — strict equality on this envelope is load-bearing (catches any forgotten source extension), so widening is preferred over loosening to `toMatchObject`."
  - "Reused Plan 46-01's exported `fetchGtasksCalendarItems()` directly — no HTTP round-trip, no re-auth, no error-envelope stripping. Aggregator wraps in allSettled for the partial-failure isolation."

patterns-established:
  - "Pattern: CalendarEnvelope.sources is append-only for forward compatibility — each new source (gcal in 47-02, gtasks in 46-02) adds a key at the end without reordering; dashboard SSE clients see no hash churn on deploy."

requirements-completed: [GTASKS-02, GTASKS-05]

# Metrics
duration: 4m
completed: 2026-04-21
---

# Phase 46 Plan 02: Google Tasks Aggregator Integration Summary

**Extended the unified calendar aggregator to include Google Tasks as a 5th Promise.allSettled source with partial-failure isolation, envelope-level status tracking, and SSE change-detection over gtasks status flips.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-21T10:38:00Z (approx — first edit)
- **Completed:** 2026-04-21T10:41:02Z (vitest regression pass)
- **Tasks:** 2 (both atomic)
- **Files modified:** 2 (both existing — no new files)

## Accomplishments

- `src/api/routes/calendar.ts` — imports `fetchGtasksCalendarItems` from `./googleTasks.js`, extends `Promise.allSettled` to 5 slots, adds `gtasks: SourceStatus` to `CalendarEnvelope.sources`, extends `hashCalendarEnvelope` statusBits with gtasks, adds result-branch handling (items.push on fulfilled, sources.gtasks='error' on rejected).
- `src/api/__tests__/calendar.test.ts` — mocks `../routes/googleTasks.js` alongside googleCalendar mock; adds 4 new cases (items include gtasks, sources.gtasks='ok' on success, partial failure (gtasks error isolates, other 4 stay ok with items), hashCalendarEnvelope flips on gtasks status change).
- Updated existing envelope-shape assertions across the suite to the new 5-key shape: Test 2 (`sources` deep-equal), Test 4 ("all three sources mocked"), `hashCalendarEnvelope` baseEnvelope fixture, empty envelope fixture, "changing sources status" test, Plan 47-02 gcal-flip test. Strict equality preserved — widens the contract but still catches any forgotten extension.
- 23/23 vitest green in 589ms (19 existing + 4 new; zero regressions). Plan 46-01 suite (`googleTasks.test.ts`) re-run — 10/10 still green, no side-effect from the import change.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend calendar aggregator with gtasks source** — `9cb40a6` (feat)
2. **Task 2: Update vitest calendar suite for gtasks** — `67a639e` (test)

**Plan metadata:** (to be stamped in final docs commit)

## Files Modified

- **Modified** `src/api/routes/calendar.ts` — +12/-2 lines. Import of `fetchGtasksCalendarItems`, 5th allSettled slot, `gtasks: SourceStatus` envelope field, `sources.gtasks: 'ok'` init, gtasksRes result branch, statusBits includes gtasks. 364 lines total.
- **Modified** `src/api/__tests__/calendar.test.ts` — +98/-6 lines. Mock + import for `fetchGtasksCalendarItems`, 4 new test cases, updated 6 existing assertion fixtures/sites for the 5-key sources shape. 604 lines total.

## Decisions Made

- **Append-only source extension** — New slot at end of allSettled, new key at end of sources, new bit at end of statusBits. Preserves existing hash values for currently-connected dashboard SSE clients across the deploy. Matches Phase 47-02's gcal pattern exactly.
- **Strict-equal on sources, not partial-match** — Existing Test 2/Test 4 used `toEqual` on the full sources object. Kept strict equality and widened the fixtures to 5 keys rather than loosening to `toMatchObject`. Catches the next forgotten source extension the same way it caught this one for 47-02.
- **Reused 46-01's exported helper directly** — `fetchGtasksCalendarItems()` was purpose-built for this aggregator in Plan 46-01. No HTTP, no JWT, no error-envelope stripping. One line of import, one line of allSettled slot.

## Deviations from Plan

None — plan executed exactly as written. Two tiny mechanical choices worth noting (both zero-cost):

1. Plan Step 1 (export `fetchGtasksCalendarItems` from googleTasks.ts) was already complete from Plan 46-01 — the helper was exported on 2026-04-21 during 46-01 specifically to prime this plan. No-op confirmed via existing export on line 106 of googleTasks.ts.
2. Plan didn't explicitly call out updating the 6 existing envelope-shape assertions in calendar.test.ts, but strict-equal `toEqual` on 4-key fixtures would have broken on the new 5-key shape. Updated them alongside the 4 new cases — same convention Plan 47-02 used when adding gcal to these same fixtures.

## Authentication Gates

None — aggregator is server-internal code path; no new external service auth required. Uses Plan 46-01's existing OAuth context via `fetchGtasksCalendarItems()`.

## Issues Encountered

None. vitest green on first run, tsc clean (pre-existing cli/ rootDir noise unchanged — logged already in prior SUMMARYs).

## Self-Check

**Files claimed to be modified:**
- `src/api/routes/calendar.ts` — VERIFIED via grep (gtasks on lines 65, 84, 169, 188, 215-218, 241 — all 6 success invariants present)
- `src/api/__tests__/calendar.test.ts` — VERIFIED (604 lines, 23 it() blocks)

**Commits claimed to exist:**
- `9cb40a6` Task 1 — FOUND in git log
- `67a639e` Task 2 — FOUND in git log

**Verification commands:**
- `NODE_ENV=development npx vitest run src/api/__tests__/calendar.test.ts` → 23/23 passed in 589ms
- `NODE_ENV=development npx vitest run src/api/__tests__/googleTasks.test.ts` → 10/10 passed (no regression from 46-01)
- `npx tsc --noEmit` → zero new errors (pre-existing cli/ rootDir noise unchanged)
- `grep -n "gtasks" src/api/routes/calendar.ts` → 8 lines matching across type union, envelope field, allSettled destructure, sources init, result branch, statusBits

## Self-Check: PASSED

## User Setup Required

None — aggregator-level change only; the Phase 46-01 Google Tasks OAuth context is already live from prior phases.

## Next Phase Readiness

- **Plan 46-03 (filter panel):** CalendarEnvelope now ships `sources.gtasks` — the Phase 47-03 speculatively-built `CalendarFilterPanel.tsx` already consumes `gtasksLists` under `calFilterPrefs_v1`; Plan 46-03 will wire it to a real `useGtasksLists()` hook against `/api/google-tasks/lists` (shipped in 46-01). Dashboard's `useCalendarStream.ts` currently surfaces `gcal` but not `gtasks` as a dedicated slice — 46-03 will add the 5th slice so loading/error banners fire independently.
- **Plan 46-04 (mutations):** No aggregator dependency; proceeds independently against `/api/google-tasks/items/:taskId/*` proxy routes.
- **Plan 46-05 (live verify):** PM2 restart required before curl smoke — the new 5-slot aggregator only surfaces gtasks items once the running bot restarts to pick up the route-file changes. Verification command: `curl -H "Authorization: Bearer $JWT" http://localhost:3000/api/calendar/items` should show `sources.gtasks` in the envelope alongside the existing `tasks/events/linkedin/gcal`.

**Live curl smoke (for plan 46-05 reference):**
```bash
# against deployed server:
curl -sH "Authorization: Bearer $JWT" "http://localhost:3000/api/calendar/items" | jq '.sources'
# expected: {"tasks":"ok","events":"ok","linkedin":"ok","gcal":"ok","gtasks":"ok"}

# sources.gtasks items (source=gtasks only):
curl -sH "Authorization: Bearer $JWT" "http://localhost:3000/api/calendar/items" | jq '[.items[] | select(.source=="gtasks")] | length'
```

---
*Phase: 46-google-tasks-full-list-sync*
*Completed: 2026-04-21*
