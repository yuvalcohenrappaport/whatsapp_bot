---
phase: 32-recurring-schedules
plan: 01
subsystem: scheduler
tags: [recurring, cron, re-arm, DST-safe]
dependency_graph:
  requires: [27-01, 28-02, 29-01]
  provides: [buildCronExpression, getNextOccurrence, getCadenceFromCron, updateScheduledMessageForRearm, resetRecipientsForMessage]
  affects: [scheduledMessageService, scheduledMessages-api, scheduledMessages-queries]
tech_stack:
  added: []
  patterns: [Intl.DateTimeFormat cron resolution, re-arm cycle, cancel-clears-cron]
key_files:
  created:
    - src/scheduler/cronUtils.ts
  modified:
    - src/db/queries/scheduledMessages.ts
    - src/db/queries/scheduledMessageRecipients.ts
    - src/scheduler/scheduledMessageService.ts
    - src/api/routes/scheduledMessages.ts
decisions:
  - Custom getNextOccurrence using Intl.DateTimeFormat loop (avoids node-cron v4.2.1 weekday bug)
  - Reset failCount to 0 on re-arm (fresh occurrence starts clean)
  - Recovery re-arms recurring messages instead of expiring them
  - updateScheduledMessageContentAndTime extended with optional cronExpression param
metrics:
  duration: 163s
  completed: 2026-03-30
---

# Phase 32 Plan 01: Recurring Schedule Backend Summary

Custom cron utilities (buildCronExpression, getNextOccurrence) with DST-safe Intl.DateTimeFormat loop, re-arm cycle in fireMessage and recovery, and cadence field in POST/PATCH API routes.

## What Was Done

### Task 1: Create cronUtils.ts and add new DB queries
- Created `src/scheduler/cronUtils.ts` with three exports:
  - `buildCronExpression(cadence, scheduledAtMs, tz)` -- generates 5-field cron from daily/weekly/monthly + timestamp
  - `getNextOccurrence(cronExpr, tz)` -- DST-safe next-fire computation using Intl.DateTimeFormat day loop with offset probing
  - `getCadenceFromCron(cronExpression)` -- derives display cadence from stored cron string
- Added `updateScheduledMessageForRearm(id, scheduledAt)` to scheduledMessages queries -- atomically resets status/scheduledAt/notificationMsgId/cancelRequestedAt/failCount
- Updated `markScheduledMessageCancelled` to also set `cronExpression: null` -- prevents re-arm if cancel races with fire
- Added `resetRecipientsForMessage(scheduledMessageId)` to recipients queries -- resets all recipients to pending for next occurrence

**Commit:** e1f7cc0

### Task 2: Wire re-arm into fireMessage, fix recovery, extend API routes
- Modified `fireMessage()` success branch: re-fetches message, checks cronExpression, computes next occurrence, resets recipients, re-arms with scheduleNewMessage
- Modified `recoverMessages()` expiry logic: recurring messages get re-armed to next occurrence instead of being expired
- Extended POST `/api/scheduled-messages` to accept `cadence` field, generates cronExpression via buildCronExpression
- Extended PATCH `/api/scheduled-messages/:id` to accept `cadence` field (null to clear, string to set/change)
- Extended `updateScheduledMessageContentAndTime` to accept optional `cronExpression` parameter

**Commit:** 7cf06b2

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Custom getNextOccurrence instead of node-cron getNextRun()** -- node-cron v4.2.1 has a documented bug where weekday expressions return dates years in the future. The custom implementation uses Intl.DateTimeFormat with a day-iteration loop and offset probing for DST safety.

2. **Re-fetch before re-arm (Pitfall 3)** -- After successful send, message is re-fetched from DB to check if a cancel arrived during the send window. Only re-arms if cronExpression is still set and status is not cancelled.

3. **Recovery re-arms recurring instead of expiring** -- Recurring messages that were missed during downtime (>1h overdue) are re-armed to the next computed occurrence rather than being expired. One-off messages retain the existing expire behavior.

4. **Extended existing update function** -- Rather than creating a new DB query function, extended `updateScheduledMessageContentAndTime` with an optional `cronExpression` parameter (undefined = no change).

## Verification Results

- `npx tsc --noEmit` passes (only pre-existing cli/bot.ts error, out of scope)
- All three cronUtils exports verified present
- updateScheduledMessageForRearm and cronExpression:null in markScheduledMessageCancelled verified
- resetRecipientsForMessage verified in recipients queries
- Re-arm logic (getNextOccurrence, resetRecipientsForMessage, updateScheduledMessageForRearm) verified in scheduledMessageService.ts
- cadence handling verified in both POST and PATCH API routes
