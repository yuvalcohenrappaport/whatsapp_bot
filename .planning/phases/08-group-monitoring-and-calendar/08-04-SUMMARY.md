---
phase: 08-group-monitoring-and-calendar
plan: 04
subsystem: pipeline
tags: [node-cron, gemini, google-calendar, whatsapp-baileys, scheduler]

# Dependency graph
requires:
  - phase: 08-01
    provides: groupMessages table, getGroupMessagesSince query, getActiveGroups query
  - phase: 08-02
    provides: calendarService with listUpcomingEvents (added in this plan)
  - phase: 08-03
    provides: groupMessagePipeline wired into startup, initGroupPipeline for ordering

provides:
  - node-cron@4.2.1 weekly scheduler with per-group cron jobs (Asia/Jerusalem timezone)
  - listUpcomingEvents(calendarId, daysAhead) in calendarService.ts — returns upcoming events array
  - generateWeeklyDigest: Gemini-powered digest with emoji sections (📅 Events / 📝 Tasks / 💬 Notes)
  - scheduleGroupReminder: creates/replaces cron job per group at configured day+hour
  - initReminderScheduler: startup initialization for all active groups with reminderDay set
  - refreshScheduler: exported for dynamic reconfiguration when group config changes
  - Empty-week silent skip (no post if no messages and no events)
  - Graceful disconnected-bot skip before each reminder send

affects: []

# Tech tracking
tech-stack:
  added: [node-cron@4.2.1, @types/node-cron]
  patterns:
    - Per-group cron job map pattern: Map<groupJid, ScheduledTask> for O(1) cancel/replace
    - Graceful null degradation: bot disconnected check before sendMessage, null digest skip
    - Calendar link decode: extract calendarId from embed URL searchParam 'src' via decodeURIComponent

key-files:
  created:
    - src/groups/reminderScheduler.ts
  modified:
    - src/calendar/calendarService.ts
    - src/index.ts
    - package.json
    - package-lock.json

key-decisions:
  - "Per-group cron job map (scheduledJobs Map): allows stop/replace on config change without restarting all jobs"
  - "getState().sock null check before sendMessage: prevents crash when bot disconnects mid-schedule"
  - "generateWeeklyDigest returns null for empty content: caller skips post, no empty messages sent to group"
  - "listUpcomingEvents added to calendarService (not inline in scheduler): reusable, testable, consistent with service pattern"

patterns-established:
  - "Scheduler refresh pattern: stop-all + clear + re-init for simplicity when config changes rarely"
  - "Graceful skip pattern: check connectivity before action, log and return (not throw) on skip"

requirements-completed: [REM-01, REM-02]

# Metrics
duration: 3min
completed: 2026-02-23
---

# Phase 8 Plan 04: Weekly Reminder Scheduler Summary

**node-cron weekly digest scheduler with Gemini AI content generation — posts Events/Tasks/Notes summaries to WhatsApp groups at configured day/hour in Asia/Jerusalem timezone**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-23T17:22:17Z
- **Completed:** 2026-02-23T17:25:47Z
- **Tasks:** 2 of 2
- **Files modified:** 5

## Accomplishments

- Added `listUpcomingEvents(calendarId, daysAhead)` to calendarService.ts — fetches up to 50 events within a time window, returns `{title, date, description}[]`, graceful empty array on error
- Created `src/groups/reminderScheduler.ts` with full weekly digest scheduler: per-group cron jobs keyed by JID, Asia/Jerusalem timezone, configurable day and hour
- Gemini-powered `generateWeeklyDigest` builds prompt from last 7 days of group messages (capped at 200) and next 14 days of calendar events, outputs emoji-sectioned digest in group's dominant language
- `initReminderScheduler()` reads all active groups with `reminderDay` set at startup; `refreshScheduler()` exported for dynamic reconfiguration via dashboard
- Wired into `src/index.ts` startup: initDb -> importChats -> createServer -> initGroupPipeline -> **initReminderScheduler** -> startSocket

## Task Commits

Each task was committed atomically:

1. **Task 1: Install node-cron and add listUpcomingEvents to calendar service** - `96d1e0e` (feat)
2. **Task 2: Create weekly reminder scheduler** - `67769df` (feat)

**Plan metadata:** *(docs commit follows)*

## Files Created/Modified

- `src/groups/reminderScheduler.ts` - New: per-group cron scheduler, generateWeeklyDigest (Gemini), scheduleGroupReminder, initReminderScheduler, refreshScheduler
- `src/calendar/calendarService.ts` - Added listUpcomingEvents function (fetches up to 50 upcoming events with time window)
- `src/index.ts` - Added initReminderScheduler import and call in startup sequence
- `package.json` - Added node-cron and @types/node-cron dependencies
- `package-lock.json` - Lock file updated

## Decisions Made

- `getState().sock` null check inside each cron callback: cron jobs fire at wall-clock time regardless of bot state; checking immediately before send ensures graceful skip on disconnect
- `generateWeeklyDigest` returns `null` rather than empty string for "nothing to report": cleaner caller logic — `if (digest === null) return` vs checking `if (!digest)` on empty strings
- `listUpcomingEvents` added to `calendarService.ts` (not inline in scheduler): consistent with existing service pattern, reusable by other modules, independently testable
- Per-group `scheduledJobs` Map for O(1) cancel/replace: dashboard config changes can call `scheduleGroupReminder` for a single group without touching others

## Deviations from Plan

None - plan executed exactly as written. All functions, exports, and wiring match plan specification.

## Issues Encountered

None - TypeScript compilation clean on src/ files. Pre-existing `cli/bot.ts` rootDir error is out of scope (existed before this plan).

## User Setup Required

None - no external service configuration required. Cron jobs start automatically at bot startup. Group reminderDay and reminderHour are configured via the web dashboard (GroupPanel).

## Next Phase Readiness

- Phase 8 complete: all 4 plans done (DB foundation, calendar service, date extraction pipeline, weekly reminder scheduler)
- Weekly digests will fire automatically for any group with `reminderDay` set in the dashboard
- `refreshScheduler()` exported and ready for dashboard integration when group config changes are saved
- Ready for Phase 9

## Self-Check: PASSED

- FOUND: src/groups/reminderScheduler.ts
- FOUND: listUpcomingEvents in src/calendar/calendarService.ts
- FOUND: initReminderScheduler in src/index.ts
- FOUND: commit 96d1e0e (Task 1)
- FOUND: commit 67769df (Task 2)

---
*Phase: 08-group-monitoring-and-calendar*
*Completed: 2026-02-23*
