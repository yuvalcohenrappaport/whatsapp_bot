---
phase: 23-universal-calendar-detection
plan: 01
subsystem: calendar
tags: [gemini, calendar-detection, dedup, sha256, drizzle, sqlite]

# Dependency graph
requires:
  - phase: 22-calendar-detection-refactor
    provides: CalendarDetectionService with extractDates and hasDateSignal
provides:
  - personalCalendarPipeline.ts with processPrivateMessage and processGroupMessage
  - calendarDedup.ts with content hash, forwarded detection, title similarity
  - Schema migration adding contentHash and isAllDay to personalPendingEvents
  - All-day event support through detection and calendar creation chain
affects: [23-02-approval-flow, 23-03-dashboard-events]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget async pattern for non-blocking calendar detection"
    - "Enhanced pre-filter: hasDateSignal (digits) AND date keyword check to reduce false Gemini calls"
    - "Content hash dedup for forwarded messages (SHA-256 prefix, 16 chars)"
    - "Title similarity via Jaccard word overlap with Hebrew support"

key-files:
  created:
    - src/calendar/personalCalendarPipeline.ts
    - src/calendar/calendarDedup.ts
    - drizzle/0014_personal_events_dedup.sql
  modified:
    - src/calendar/CalendarDetectionService.ts
    - src/calendar/personalCalendarService.ts
    - src/db/schema.ts
    - src/db/queries/personalPendingEvents.ts
    - src/pipeline/messageHandler.ts
    - src/groups/groupMessagePipeline.ts

key-decisions:
  - "Enhanced pre-filter combines digit check AND date keyword regex (English + Hebrew) to minimize false Gemini API calls"
  - "Group pipeline fires personal detection BEFORE travelBotActive guard for universal coverage"

patterns-established:
  - "Fire-and-forget calendar detection: .catch(() => {}) with internal error logging"
  - "Content hash dedup: normalize -> SHA-256 -> 16 char prefix"

requirements-completed: [CAL-01, CAL-02, CAL-06]

# Metrics
duration: 7min
completed: 2026-03-16
---

# Phase 23 Plan 01: Universal Calendar Detection Summary

**Personal calendar detection pipeline wired into private + group messages with forwarded dedup, title similarity, and all-day event support**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-16T12:47:39Z
- **Completed:** 2026-03-16T12:55:10Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments
- Personal calendar detection fires on all private messages (incoming + outgoing) and all group messages regardless of travelBotActive
- Forwarded messages deduplicated via SHA-256 content hash across chats
- Similar events in same chat updated rather than duplicated (Jaccard + containment)
- All-day events properly signaled through Gemini extraction schema and Google Calendar creation

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema migration and dedup module** - `dbc9d2a` (feat)
2. **Task 2: PersonalCalendarPipeline with all-day event support** - `c945b8c` (feat)
3. **Task 3: Wire pipeline into messageHandler and groupMessagePipeline** - `88a1b2f` (feat)

## Files Created/Modified
- `src/calendar/personalCalendarPipeline.ts` - Core orchestration: detect dates, dedup, store pending events
- `src/calendar/calendarDedup.ts` - Content hash, forwarded detection, title similarity matching
- `drizzle/0014_personal_events_dedup.sql` - Migration adding contentHash and isAllDay columns
- `src/calendar/CalendarDetectionService.ts` - Added isAllDay to Zod schema and ExtractedDate interface
- `src/calendar/personalCalendarService.ts` - All-day event support with date format in Google Calendar API
- `src/db/schema.ts` - contentHash and isAllDay columns on personalPendingEvents
- `src/db/queries/personalPendingEvents.ts` - New query functions for dedup and dashboard
- `src/pipeline/messageHandler.ts` - processPrivateMessage wired for outgoing + incoming
- `src/groups/groupMessagePipeline.ts` - processGroupMessage wired before travelBotActive guard

## Decisions Made
- Enhanced pre-filter combines digit check AND date keyword regex (English + Hebrew) to minimize false Gemini API calls for cost control
- Group personal calendar detection placed BEFORE travelBotActive guard for universal coverage per locked decision
- Updated existing CalendarDetectionService tests to include isAllDay field in mock responses

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing test mocks for isAllDay field**
- **Found during:** Task 2 (PersonalCalendarPipeline module)
- **Issue:** Adding required isAllDay to Zod schema would fail existing test mocks missing the field
- **Fix:** Added `isAllDay: false` to all mock responses in CalendarDetectionService.test.ts
- **Files modified:** src/calendar/__tests__/CalendarDetectionService.test.ts
- **Verification:** All 10 tests pass
- **Committed in:** c945b8c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential for test correctness after schema change. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Detection backbone complete: messages flow through detection, dedup, and into personalPendingEvents table
- Ready for Plan 02: self-chat approval flow (approve/reject/edit pending events)
- Ready for Plan 03: dashboard events page (pending/approved/rejected tabs)

---
*Phase: 23-universal-calendar-detection*
*Completed: 2026-03-16*
