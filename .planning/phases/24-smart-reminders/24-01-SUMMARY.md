---
phase: 24-smart-reminders
plan: 01
subsystem: reminders
tags: [gemini, sqlite, drizzle, scheduler, whatsapp, nlp, zod]

# Dependency graph
requires:
  - phase: 22-calendar-detection-refactor
    provides: personalCalendarService with createPersonalCalendarEvent, getSelectedCalendarId
  - phase: 23-universal-calendar-detection
    provides: CalendarDetectionService pattern for Gemini structured JSON parsing
provides:
  - reminders SQLite table with Drizzle schema and migration
  - CRUD query functions for reminders
  - Gemini-based NLP parser for reminder commands (Hebrew + English)
  - Two-tier scheduler (setTimeout <24h + hourly DB scan)
  - reminderService orchestration (parse -> store -> schedule -> confirm)
  - handleOwnerCommand wiring for self-chat reminder routing
affects: [24-02-PLAN, 24-03-PLAN, 25-commitment-detection]

# Tech tracking
tech-stack:
  added: []
  patterns: [two-tier-scheduling, keyword-prefilter-before-gemini, smart-delivery-routing]

key-files:
  created:
    - src/db/queries/reminders.ts
    - src/reminders/reminderParser.ts
    - src/reminders/reminderScheduler.ts
    - src/reminders/reminderService.ts
    - drizzle/0015_reminders.sql
  modified:
    - src/db/schema.ts
    - src/pipeline/messageHandler.ts
    - src/index.ts
    - drizzle/meta/_journal.json

key-decisions:
  - "Lazy sock access: fireReminder gets sock from getState().sock at fire time, not at schedule time"
  - "Smart routing thresholds: <24h WhatsApp only, 24-72h calendar only, >72h calendar + WhatsApp"
  - "Manual migration creation: drizzle-kit generate is interactive, so migration SQL written manually"
  - "Reminder handler placed after calendar approval, before snooze in handleOwnerCommand"

patterns-established:
  - "Two-tier scheduling: setTimeout for near-term (<24h), hourly DB scan promotes distant reminders"
  - "Keyword pre-filter before Gemini: REMINDER_KEYWORDS_RE avoids unnecessary API calls"
  - "Smart delivery routing: time-distance determines WhatsApp vs Calendar vs both"

requirements-completed: [REM-01, REM-05, REM-06]

# Metrics
duration: 11min
completed: 2026-03-16
---

# Phase 24 Plan 01: Core Reminder Backend Summary

**Gemini-based NLP reminder parser with two-tier scheduler (setTimeout + hourly scan), SQLite persistence, and smart WhatsApp/Calendar delivery routing**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-16T13:51:47Z
- **Completed:** 2026-03-16T14:03:33Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Reminders table with status+fireAt index and full CRUD queries
- Gemini-based NLP parser supporting Hebrew and English with keyword pre-filter
- Two-tier scheduler: setTimeout for <24h reminders, hourly DB scan for distant ones
- Smart delivery routing: <24h WhatsApp, 24-72h calendar, >72h both
- Self-chat command routing wired into handleOwnerCommand
- System initializes on startup with existing reminder recovery

## Task Commits

Each task was committed atomically:

1. **Task 1: Reminders DB schema, queries, and Gemini parser** - `a06baa8` (feat)
2. **Task 2: Two-tier scheduler, service orchestration, and handleOwnerCommand wiring** - `df2e7f8` (feat)

## Files Created/Modified
- `src/db/schema.ts` - Added reminders table definition
- `src/db/queries/reminders.ts` - CRUD functions for reminders table
- `src/reminders/reminderParser.ts` - Keyword pre-filter + Gemini structured JSON parser
- `src/reminders/reminderScheduler.ts` - setTimeout management + hourly scan + startup recovery
- `src/reminders/reminderService.ts` - Orchestration: parse -> store -> schedule -> confirm
- `src/pipeline/messageHandler.ts` - Added reminder routing in handleOwnerCommand
- `src/index.ts` - Added initReminderSystem() call on startup
- `drizzle/0015_reminders.sql` - Migration SQL for reminders table
- `drizzle/meta/_journal.json` - Migration journal entry

## Decisions Made
- Lazy sock: fireReminder fetches sock from getState() at fire time rather than capturing it at schedule time, ensuring it works after reconnects
- Smart routing thresholds: <24h WhatsApp only, 24-72h calendar only, >72h both (per research recommendation)
- Manual migration: drizzle-kit generate is interactive and cannot run non-interactively, so migration SQL was written manually matching the schema
- initReminderSystem() called in main() after DB init (not in onOpen callback) since sock is fetched lazily

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Manual migration creation instead of drizzle-kit generate**
- **Found during:** Task 1 (DB schema)
- **Issue:** `npx drizzle-kit generate` enters interactive mode asking about column renames, cannot run non-interactively
- **Fix:** Wrote migration SQL manually matching the Drizzle schema definition, added journal entry
- **Files modified:** drizzle/0015_reminders.sql, drizzle/meta/_journal.json
- **Verification:** TypeScript compiles, migration SQL matches schema
- **Committed in:** a06baa8 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary workaround for non-interactive environment. No scope creep.

## Issues Encountered
None beyond the drizzle-kit interactive mode issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Core reminder backend complete, ready for Plan 02 (restart recovery, cancel/edit commands, smart delivery refinements)
- Cancel/edit commands are stubbed with placeholder message
- Dashboard API routes and UI will be built in Plan 03

## Self-Check: PASSED

All 9 files verified present. Both task commits (a06baa8, df2e7f8) verified in git log.

---
*Phase: 24-smart-reminders*
*Completed: 2026-03-16*
