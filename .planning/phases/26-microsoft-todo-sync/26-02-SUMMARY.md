---
phase: 26-microsoft-todo-sync
plan: 02
subsystem: pipeline, todo
tags: [gemini, task-detection, todo-pipeline, self-chat, cancel-handler]

# Dependency graph
requires:
  - phase: 26-microsoft-todo-sync
    provides: MSAL auth service, Graph API todoService, todoTasks DB schema
  - phase: 25-commitment-detection
    provides: CommitmentDetectionService, commitmentPipeline, pre-filter pattern
provides:
  - Extended Gemini schema with commitment vs task classification
  - todoPipeline for task creation, To Do sync, self-chat notification, and cancel
  - Task routing in commitmentPipeline (split by type field)
  - Cancel handler wired into handleOwnerCommand
affects: [26-03-dashboard-tasks]

# Tech tracking
tech-stack:
  added: []
  patterns: [type-based routing from single Gemini call, fire-and-forget task processing, one-time auth failure notification]

key-files:
  created:
    - src/todo/todoPipeline.ts
  modified:
    - src/commitments/CommitmentDetectionService.ts
    - src/commitments/commitmentPipeline.ts
    - src/pipeline/messageHandler.ts
    - src/db/queries/todoTasks.ts

key-decisions:
  - "Single Gemini call classifies both commitments and tasks (no extra API cost)"
  - "Tasks fire-and-forget in commitmentPipeline (non-blocking)"
  - "Task cancel handler placed after reminder handler in handleOwnerCommand chain"
  - "One-time auth failure notification via module-level boolean flag"

patterns-established:
  - "Type-based routing: single AI extraction -> split by type -> different pipelines"
  - "Auth failure notification: module-level flag, reset on successful sync"

requirements-completed: [TODO-02, TODO-03]

# Metrics
duration: 3min
completed: 2026-03-16
---

# Phase 26 Plan 02: Task Detection Pipeline Summary

**Extended Gemini schema with commitment/task classification, todoPipeline for auto-create + notify + cancel, and task routing wired into commitmentPipeline**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-16T19:03:33Z
- **Completed:** 2026-03-16T19:08:17Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Single Gemini call now classifies items as commitment (time-bound) or task (timeless) with no extra API cost
- todoPipeline creates tasks in Microsoft To Do (when connected), stores locally, and always notifies in self-chat
- Cancel reply to task notification removes from To Do and updates local status
- Graceful degradation: tasks detected and stored even without Microsoft auth configured

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend Gemini schema and create todoPipeline** - `a2a88cd` (feat)
2. **Task 2: Wire task routing into commitmentPipeline and cancel handler** - `d9ed629` (feat)

## Files Created/Modified
- `src/commitments/CommitmentDetectionService.ts` - Added type field to Zod schema, interface, and system prompt
- `src/todo/todoPipeline.ts` - New: processDetectedTask (create + sync + notify) and handleTaskCancel
- `src/commitments/commitmentPipeline.ts` - Split Gemini results by type, route tasks to todoPipeline
- `src/pipeline/messageHandler.ts` - Added task cancel handler in handleOwnerCommand
- `src/db/queries/todoTasks.ts` - Added updateTodoTaskNotificationMsgId query

## Decisions Made
- Single Gemini call for both commitments and tasks avoids extra API cost per message
- Fire-and-forget pattern for task processing prevents blocking the message pipeline
- Task cancel handler placed after reminder handler but before snooze in owner command chain
- Module-level authFailureNotified flag prevents repeated notifications on every failed task sync

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added updateTodoTaskNotificationMsgId query**
- **Found during:** Task 1 (todoPipeline creation)
- **Issue:** No query existed to update only the notificationMsgId field after sending self-chat notification
- **Fix:** Added updateTodoTaskNotificationMsgId function to todoTasks queries
- **Files modified:** src/db/queries/todoTasks.ts
- **Committed in:** a2a88cd (Task 1 commit)

**2. [Rule 3 - Blocking] Fixed messageHandler path reference**
- **Found during:** Task 2 (wiring cancel handler)
- **Issue:** Plan referenced src/messageHandler.ts but actual file is at src/pipeline/messageHandler.ts
- **Fix:** Used correct path for modifications
- **Files modified:** src/pipeline/messageHandler.ts
- **Committed in:** d9ed629 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
- Pre-existing TS6059 error (cli/bot.ts not under rootDir) -- unrelated to this plan, ignored

## User Setup Required
None - uses existing Microsoft auth configuration from Plan 26-01.

## Next Phase Readiness
- Task detection pipeline fully operational end-to-end
- Dashboard task management page ready to build (Plan 26-03)
- todoTasks table populated with status tracking for dashboard queries

---
*Phase: 26-microsoft-todo-sync*
*Completed: 2026-03-16*
