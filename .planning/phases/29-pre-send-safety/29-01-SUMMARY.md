---
phase: 29-pre-send-safety
plan: 01
subsystem: scheduler
tags: [baileys, better-sqlite3, drizzle-orm, whatsapp, scheduled-messages, notifications]

# Dependency graph
requires:
  - phase: 28-core-scheduler-and-text-delivery
    provides: fireMessage, handleFailedMessage, recoverMessages, initScheduledMessageScheduler, scheduleMessage, cancelScheduledMessage
  - phase: 27-scheduled-messages-db
    provides: scheduledMessages schema with notificationMsgId, cancelRequestedAt, status='notified' columns; getNotifiedScheduledMessages, updateScheduledMessageNotificationMsgId, markScheduledMessageCancelled queries
provides:
  - Pre-send self-chat notification with emoji-labeled card (recipient, type, preview, time, cancel hint)
  - sendPreSendNotification function: pending->notified status transition, notificationMsgId storage, fire timer at max(scheduledAt, now+10min)
  - handleScheduledMessageCancel: looks up by notificationMsgId, cancels DB+in-memory timer, sends confirmation
  - Updated fireMessage: gates on 'notified' status only (not 'pending')
  - Updated handleFailedMessage: reverts to 'notified' on retry, sends per-attempt self-chat notification
  - Updated recoverMessages: handles 'pending' (full pipeline) and 'notified' (re-arm fire only) messages
  - dispatchCallback: routes pending->notification, notified->fire for periodic scan and startup
  - getScheduledMessageByNotificationMsgId query for cancel lookup
affects:
  - 29-02 (messageHandler wiring for cancel command)
  - Any phase testing the scheduled message lifecycle end-to-end

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Notification-then-send pipeline: status transitions pending->notified->sending->sent/failed/cancelled/expired"
    - "dispatchCallback routes on DB status at fire time — idempotent, PM2-safe"
    - "Best-effort self-chat notifications use plain sock.sendMessage (no timeout wrapper)"
    - "Cancel handler uses scheduled message UUID for cancelScheduledMessage, never notificationMsgId (Pitfall 6)"

key-files:
  created: []
  modified:
    - src/db/queries/scheduledMessages.ts
    - src/scheduler/scheduledMessageService.ts

key-decisions:
  - "fireMessage gates on status!=='notified' — only messages that went through notification are fired; prevents pending messages from bypassing cancel window"
  - "Retry reverts to 'notified' (not 'pending') — message already went through notification pipeline"
  - "sendPreSendNotification falls back to scheduling send directly if sock is unavailable — cancel window is best-effort, send is guaranteed"
  - "Recovery for 'notified' messages: re-arm fire timer only, never re-send notification (Pitfall 4)"
  - "Recovery for pending missed messages: run full sendPreSendNotification pipeline (CONTEXT.md: 'always follows full pipeline')"

patterns-established:
  - "Pre-send notification pattern: sendPreSendNotification -> notified status -> scheduleMessage fire timer"
  - "Cancel handler pattern: lookup by notificationMsgId -> check status=notified -> markCancelled + cancelScheduledMessage(UUID) -> confirm"

requirements-completed: [SAFE-01, SAFE-02, SAFE-03]

# Metrics
duration: 2min
completed: 2026-03-30
---

# Phase 29 Plan 01: Pre-Send Safety Summary

**Pre-send self-chat notification pipeline with 10-minute cancel window, DB-persisted cancel state, per-retry failure notifications, and `handleScheduledMessageCancel` export wired to notificationMsgId lookup**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-30T13:56:50Z
- **Completed:** 2026-03-30T13:59:22Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `getScheduledMessageByNotificationMsgId` query to scheduledMessages.ts for cancel lookup path
- Implemented `sendPreSendNotification` with emoji-labeled card, notificationMsgId storage, pending->notified transition, fire timer at max(scheduledAt, now+10min)
- Changed `fireMessage` status gate from 'pending' to 'notified' — prevents sends bypassing cancel window
- Added per-retry self-chat notification in `handleFailedMessage` before each backoff retry
- Updated `recoverMessages` to handle both 'pending' (full pipeline via sendPreSendNotification) and 'notified' (re-arm fire only, no duplicate notification)
- Exported `handleScheduledMessageCancel` that looks up by notificationMsgId, cancels DB+in-memory timer, sends confirmation
- Added `dispatchCallback` routing pending->notification, notified->fire for periodic scan and startup

## Task Commits

1. **Task 1: Add getScheduledMessageByNotificationMsgId query** - `bd27c77` (feat)
2. **Task 2: Rewrite scheduledMessageService.ts with notification pipeline, cancel handler, and retry notifications** - `b4ad2ee` (feat)

## Files Created/Modified

- `src/db/queries/scheduledMessages.ts` - Added `getScheduledMessageByNotificationMsgId` for cancel lookup by notificationMsgId column
- `src/scheduler/scheduledMessageService.ts` - Full notification pipeline, cancel handler, updated fire/retry/recovery logic

## Decisions Made

- `fireMessage` gates on `status !== 'notified'` (not 'pending') — lifecycle change per plan spec; ensures all messages pass through notification before send
- Retry path reverts to 'notified' (not 'pending') since message already went through notification; prevents double notification
- Fallback to scheduling send without cancel window when sock unavailable at notification time — send is higher priority than cancel window
- `handleScheduledMessageCancel` uses `msg.id` (UUID) for `cancelScheduledMessage`, not the `notificationMsgId` (Pitfall 6)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `handleScheduledMessageCancel` is exported and ready for wiring into `messageHandler.ts` (Phase 29 Plan 02 or remaining plans)
- Status lifecycle complete: pending -> notified -> sending -> sent/failed/cancelled/expired
- `dispatchCallback` handles all entry points (periodic scan, startup, recovery)
- Pre-existing TypeScript error in `cli/bot.ts` (rootDir mismatch) is unrelated to this plan and was present before Phase 29

---
*Phase: 29-pre-send-safety*
*Completed: 2026-03-30*
