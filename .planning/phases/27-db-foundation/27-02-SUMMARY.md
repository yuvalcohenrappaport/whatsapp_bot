---
phase: 27-db-foundation
plan: 02
subsystem: database
tags: [drizzle-orm, sqlite, query-layer, scheduled-messages]

# Dependency graph
requires:
  - 27-01 (scheduledMessages and scheduledMessageRecipients tables in schema.ts)
provides:
  - scheduledMessages query layer (src/db/queries/scheduledMessages.ts)
  - scheduledMessageRecipients query layer (src/db/queries/scheduledMessageRecipients.ts)
affects: [28-scheduler-core, 29-cancel-window, 30-send-pipeline, 31-voice-ai-send, 32-cron-recurrence]

# Tech tracking
tech-stack:
  added: []
  patterns: [plain function exports (no classes), db import from ../client.js, sql template for atomic increments, .returning() for delete-with-IDs]

key-files:
  created:
    - src/db/queries/scheduledMessages.ts
    - src/db/queries/scheduledMessageRecipients.ts
  modified: []

key-decisions:
  - "getPendingScheduledMessages and getNotifiedScheduledMessages are separate functions — Phase 28 uses pending for fire-time dispatch; Phase 29 uses notified for cancel window expiry checks"
  - "deleteOldScheduledMessages uses .returning({ id }) so caller gets deleted IDs for passing to deleteRecipientsForMessages — avoids secondary query"
  - "deleteRecipientsForMessages guards against empty array input to prevent SQL inArray error"

requirements-completed: [SCHED-02]

# Metrics
duration: 1min
completed: 2026-03-30
---

# Phase 27 Plan 02: Query Layer Summary

**Complete Drizzle query layer for scheduled_messages and scheduled_message_recipients tables — 9 + 6 = 15 typed functions following the project's plain-function pattern, covering all CRUD needs for Phases 28–32**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-29T23:56:47Z
- **Completed:** 2026-03-29T23:57:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `scheduledMessages.ts` with 9 functions: insert, getById, getPending, getNotified, updateStatus, markCancelled, incrementFailCount, updateNotificationMsgId, deleteOld
- Created `scheduledMessageRecipients.ts` with 6 functions: insert, getForMessage, updateStatus (with sentAt on 'sent'), updateSentContent, incrementFailCount, deleteForMessages (empty-array guard)
- Both files pass TypeScript type checking — only pre-existing TS6059 error unrelated to these files

## Task Commits

Each task was committed atomically:

1. **Task 1: Create scheduledMessages.ts query layer** - `e2fdc15` (feat)
2. **Task 2: Create scheduledMessageRecipients.ts query layer** - `f0df1fc` (feat)

**Plan metadata:** (included in final docs commit)

## Files Created/Modified

- `src/db/queries/scheduledMessages.ts` - 9 exported query functions for scheduled_messages table
- `src/db/queries/scheduledMessageRecipients.ts` - 6 exported query functions for scheduled_message_recipients table

## Decisions Made

- `getPendingScheduledMessages` and `getNotifiedScheduledMessages` are separate functions — per research Pitfall 4, Phase 29 needs to check notified messages for cancel window expiry independently of pending dispatch
- `deleteOldScheduledMessages` uses `.returning({ id: scheduledMessages.id })` so the caller receives deleted IDs and can pass them directly to `deleteRecipientsForMessages` without a secondary lookup
- `deleteRecipientsForMessages` returns early when passed an empty array to prevent `inArray` from generating invalid SQL

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Pre-existing TS6059 error (`cli/bot.ts` outside `rootDir`) present before this plan — not caused by query files, out of scope.

## Next Phase Readiness

- All 15 query functions are exported and callable from downstream phases
- Phase 28 (scheduler-core) can import `getPendingScheduledMessages` and `updateScheduledMessageStatus` directly
- Phase 29 (cancel-window) can import `getNotifiedScheduledMessages` and `markScheduledMessageCancelled` directly
- No new dependencies introduced

---
*Phase: 27-db-foundation*
*Completed: 2026-03-30*
