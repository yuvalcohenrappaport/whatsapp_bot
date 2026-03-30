---
phase: 28-core-scheduler-and-text-delivery
plan: 01
subsystem: database, infra
tags: [drizzle-orm, sqlite, scheduler, timers, pino]

# Dependency graph
requires:
  - phase: 27-db-foundation
    provides: scheduled_messages table and query layer (insertScheduledMessage, updateScheduledMessageStatus, etc.)
provides:
  - getScheduledMessagesInWindow query for pending messages in a time range
  - scheduledMessageScheduler timer engine with activeTimers dedup guard
  - scheduleMessage, cancelScheduledMessage, startPeriodicScan, scheduleAllUpcoming, getActiveTimerCount exports
affects:
  - 28-02 (service layer that wraps the scheduler)
  - any phase wiring onFire callbacks to the scheduler

# Tech tracking
tech-stack:
  added: []
  patterns: [setTimeout-based timer engine with periodic DB scan (15-min), activeTimers Map as dedup guard, mirrors reminderScheduler.ts pattern]

key-files:
  created:
    - src/scheduler/scheduledMessageScheduler.ts
  modified:
    - src/db/queries/scheduledMessages.ts

key-decisions:
  - "15-minute periodic scan interval (not hourly like reminders) — scheduled messages need finer-grained polling"
  - "activeTimers is module-level but not exported — internal dedup guard, callers never touch the Map directly"

patterns-established:
  - "Timer engine pattern: activeTimers Map + scheduleMessage + cancelScheduledMessage + startPeriodicScan + scheduleAllUpcoming + getActiveTimerCount"
  - "Periodic scan promotes messages crossing into <24h window from DB to setTimeout"

requirements-completed: [SCHED-03]

# Metrics
duration: 2min
completed: 2026-03-30
---

# Phase 28 Plan 01: Core Scheduler and Text Delivery Summary

**setTimeout timer engine with 15-minute DB scan, activeTimers dedup guard, and getScheduledMessagesInWindow window query**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-30T00:25:13Z
- **Completed:** 2026-03-30T00:26:55Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `getScheduledMessagesInWindow(fromMs, toMs)` to the query layer — returns pending scheduled messages in a time window ordered by scheduledAt ascending
- Created `src/scheduler/scheduledMessageScheduler.ts` with full timer engine mirroring `reminderScheduler.ts` but using a 15-minute periodic scan interval
- All 5 required exports present: `scheduleMessage`, `cancelScheduledMessage`, `startPeriodicScan`, `scheduleAllUpcoming`, `getActiveTimerCount`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add getScheduledMessagesInWindow query** - `d056be3` (feat)
2. **Task 2: Create scheduledMessageScheduler.ts timer engine** - `34b581b` (feat)

**Plan metadata:** (see final commit)

## Files Created/Modified
- `src/db/queries/scheduledMessages.ts` - Added `gte` import and `getScheduledMessagesInWindow` function
- `src/scheduler/scheduledMessageScheduler.ts` - New timer engine module with activeTimers Map and all 5 exports

## Decisions Made
- 15-minute periodic scan interval chosen (not hourly like reminders) — scheduled messages require finer-grained promotion
- `activeTimers` Map kept module-private (not exported) — callers use the functional API only

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
Pre-existing TS6059 error (`cli/bot.ts` outside `rootDir`) was present before this plan and is out of scope. New files introduce no TypeScript errors.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Timer engine is ready for Plan 02 (service layer) to import and wire `onFire` callbacks
- `getScheduledMessagesInWindow` is available for the periodic scan

---
*Phase: 28-core-scheduler-and-text-delivery*
*Completed: 2026-03-30*
