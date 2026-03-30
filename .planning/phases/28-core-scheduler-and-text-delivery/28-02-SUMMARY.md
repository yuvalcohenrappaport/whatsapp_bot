---
phase: 28-core-scheduler-and-text-delivery
plan: 02
subsystem: scheduler
tags: [scheduler, whatsapp, retry, recovery, pino]

# Dependency graph
requires:
  - phase: 27-db-foundation
    provides: scheduled_messages + scheduled_message_recipients tables and query layer
  - phase: 28-01
    provides: scheduledMessageScheduler timer engine with startPeriodicScan, scheduleAllUpcoming
provides:
  - scheduledMessageService with fireMessage, sendWithTimeout, recoverMessages, handleFailedMessage, initScheduledMessageScheduler
  - initScheduledMessageScheduler wired into index.ts onOpen callback
affects:
  - 28-03 (cancel flow will use cancelScheduledMessage)
  - 28-04 (voice delivery will replace text send in fireMessage)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Promise.race timeout on every Baileys sendMessage call (15s)
    - Exponential backoff retry with setTimeout (1m, 5m, 30m cap, 5 max attempts)
    - Recovery with 1-hour cutoff and 5-second stagger (non-blocking setTimeout)
    - Status set to 'sending' before send to prevent periodic scan race condition
    - Lazy sock access via getState().sock at fire time

key-files:
  created:
    - src/scheduler/scheduledMessageService.ts
  modified:
    - src/index.ts

key-decisions:
  - "fireMessage sets status to 'sending' before the actual send — prevents periodic scan from re-firing the same message concurrently"
  - "recoverMessages uses non-blocking setTimeout stagger (not await) — recovery returns immediately after scheduling timeouts"
  - "Expired messages get distinct 'expired' status (not 'failed') — only attempted sends count as failures"
  - "No-sock guard in fireMessage reverts to 'pending' and schedules retry — matches existing codebase pattern"

# Metrics
duration: ~2min
completed: 2026-03-30
---

# Phase 28 Plan 02: Core Scheduler and Text Delivery Summary

**Fire logic with 15s Promise.race timeout, exponential backoff retry (1m/5m/30m, 5 attempts), 1-hour recovery with 5s stagger, and self-chat failure notification**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-30T00:29:10Z
- **Completed:** 2026-03-30T00:31:22Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `src/scheduler/scheduledMessageService.ts` with full fire logic, retry, recovery, and init
- `sendWithTimeout` wraps every `sock.sendMessage` call in `Promise.race` with 15-second timeout
- `fireMessage` sets status to `'sending'` before send (prevents periodic scan race — Pitfall 3)
- `handleFailedMessage` implements exponential backoff: delays [60s, 5m, 30m, 30m, 30m], 5 max attempts
- Permanent failure sends self-chat notification to `config.USER_JID` with recipient JIDs and content preview
- `recoverMessages` stagger is non-blocking (setTimeout, not await) — returns immediately
- Messages older than 1 hour on recovery marked as `'expired'` (distinct from `'failed'`)
- `initScheduledMessageScheduler` wired into `src/index.ts` `onOpen` callback after `initReminderSystem`

## Task Commits

1. **Task 1: Create scheduledMessageService.ts** - `68b90e5` (feat)
2. **Task 2: Wire initScheduledMessageScheduler into index.ts** - `998f433` (feat)

## Files Created/Modified

- `src/scheduler/scheduledMessageService.ts` — New service module, exports only `initScheduledMessageScheduler`
- `src/index.ts` — Added import and `initScheduledMessageScheduler().catch(...)` call in `onOpen`

## Decisions Made

- `fireMessage` sets status to `'sending'` before the actual send — prevents periodic scan from re-firing the same message concurrently (Pitfall 3 mitigation)
- `recoverMessages` uses non-blocking `setTimeout` stagger (not `await`) — recovery function returns immediately after scheduling timeouts, consistent with plan spec (Pitfall 4 mitigation)
- `'expired'` status for old recovery messages — distinct from `'failed'` which implies attempted sends
- No-sock guard reverts to `'pending'` and schedules retry — follows existing codebase pattern from reminderService.ts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TS6059 error (`cli/bot.ts` outside `rootDir`) was present before this plan and is out of scope. No new TypeScript errors introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Scheduled message end-to-end text delivery is complete
- Cancel flow (Plan 28-03) can use the existing `cancelScheduledMessage` from the timer engine
- Voice delivery (Plan 28-04) can replace the `{ text: msg.content }` send in `fireMessage` with TTS audio

---
*Phase: 28-core-scheduler-and-text-delivery*
*Completed: 2026-03-30*
