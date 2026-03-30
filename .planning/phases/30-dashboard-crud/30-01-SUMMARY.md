---
phase: 30-dashboard-crud
plan: 01
subsystem: api
tags: [fastify, drizzle, sqlite, rest-api, scheduled-messages]

requires:
  - phase: 28-scheduled-message-scheduler
    provides: scheduleMessage, cancelScheduledMessage, scheduledMessageScheduler module
  - phase: 29-pre-send-safety
    provides: dispatchCallback, fireCallback pipeline, handleScheduledMessageCancel

provides:
  - GET /api/scheduled-messages with tab-based filtering and recipient name enrichment
  - POST /api/scheduled-messages creates message+recipient and arms timer
  - PATCH /api/scheduled-messages/:id edits pending messages and reschedules timer
  - POST /api/scheduled-messages/:id/cancel marks cancelled in DB and clears timer
  - getAllScheduledMessages(tab?) DB query with pending/sent/failed status groupings
  - updateScheduledMessageContentAndTime DB query for edits
  - scheduleNewMessage public service wrapper

affects: [30-02-frontend-dashboard, any future scheduled message features]

tech-stack:
  added: []
  patterns: [tab-based filtering via inArray status groups, recipient enrichment via getContact, public service wrapper pattern for internal callbacks]

key-files:
  created:
    - src/api/routes/scheduledMessages.ts
  modified:
    - src/db/queries/scheduledMessages.ts
    - src/scheduler/scheduledMessageService.ts
    - src/api/server.ts

key-decisions:
  - "scheduleNewMessage wraps dispatchCallback (not fireCallback) — new messages go through full notification pipeline, not direct fire"
  - "Tab 'pending' maps to status IN ('pending', 'notified', 'sending') — all in-flight states grouped for dashboard"
  - "Tab 'failed' maps to status IN ('failed', 'cancelled', 'expired') — all terminal non-success states grouped"
  - "PATCH only edits messages with status='pending' — notified messages have active cancel windows, disallow edits"

patterns-established:
  - "Public service wrapper: scheduleNewMessage exported, dispatchCallback stays module-private"
  - "Tab-based filtering: string param maps to inArray status groups, undefined/'all' returns unfiltered"
  - "Recipient enrichment inline in GET: getRecipientsForMessage + getContact per message in route handler"

requirements-completed: [SCHED-01, DASH-01, DASH-03, DASH-04]

duration: 2min
completed: 2026-03-30
---

# Phase 30 Plan 01: Scheduled Messages REST API Summary

**Four Fastify REST endpoints for scheduled message CRUD with tab-filtered DB queries and public timer-arm wrapper**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-30T11:41:20Z
- **Completed:** 2026-03-30T11:43:18Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `getAllScheduledMessages(tab?)` with pending/sent/failed tab-to-status-group mapping and `updateScheduledMessageContentAndTime` to the DB queries layer
- Added `scheduleNewMessage` public export to the service layer as a wrapper for `dispatchCallback` (routes new messages through notification pipeline)
- Created complete Fastify route with GET (list+filter+enrichment), POST (create+arm), PATCH (edit+reschedule), and POST cancel endpoints, all behind auth guard
- Registered `scheduledMessageRoutes` in `server.ts`

## Task Commits

1. **Task 1: Add DB queries and service export** - `b489239` (feat)
2. **Task 2: Create Fastify route and register it** - `43283ea` (feat)

**Plan metadata:** (pending)

## Files Created/Modified

- `src/db/queries/scheduledMessages.ts` - Added `getAllScheduledMessages(tab?)` and `updateScheduledMessageContentAndTime`
- `src/scheduler/scheduledMessageService.ts` - Added `scheduleNewMessage` public wrapper
- `src/api/routes/scheduledMessages.ts` - New file: four REST endpoints with auth guards
- `src/api/server.ts` - Imported and registered `scheduledMessageRoutes`

## Decisions Made

- `scheduleNewMessage` calls `dispatchCallback` (not `fireCallback`) so newly created messages go through the full pre-send notification pipeline
- Tab mapping: `'pending'` covers `pending/notified/sending` (all in-flight states), `'failed'` covers `failed/cancelled/expired` (all non-success terminal states)
- PATCH endpoint restricts edits to `status='pending'` only — `'notified'` messages have active cancel windows and are past the edit point
- `scheduleNewMessage` placed before `initScheduledMessageScheduler` but after `dispatchCallback` to ensure the referenced function is defined

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript error in `cli/bot.ts` (not under `rootDir`) was present before this plan and is out of scope. No errors in any files modified by this plan.

## Next Phase Readiness

- All four API endpoints compile and are registered
- Backend is fully ready for Plan 02 frontend to consume
- DB queries handle tab-based filtering with correct status groupings
- Create and edit both arm/reschedule in-memory timers via `scheduleNewMessage`
- Cancel calls both DB (`markScheduledMessageCancelled`) and in-memory (`cancelScheduledMessage`)

---
*Phase: 30-dashboard-crud*
*Completed: 2026-03-30*
