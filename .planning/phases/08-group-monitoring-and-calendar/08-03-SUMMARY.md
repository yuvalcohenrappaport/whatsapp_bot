---
phase: 08-group-monitoring-and-calendar
plan: 03
subsystem: pipeline
tags: [gemini, google-calendar, chrono-node, zod, whatsapp-baileys, debounce]

# Dependency graph
requires:
  - phase: 08-01
    provides: groupMessages table, calendarEvents queries, setGroupMessageCallback hook, groups table with calendarLink
  - phase: 08-02
    provides: calendarService with createGroupCalendar, createCalendarEvent, shareCalendar, deleteCalendarEvent

provides:
  - hasNumberPreFilter: digit-regex pre-filter eliminating 80-90% of Gemini calls
  - extractDates: Gemini structured extraction with Zod schema and high-confidence filter
  - groupMessagePipeline: full lifecycle pipeline (pre-filter, extract, create, confirm, delete)
  - 10-second debounce batching for rapid group messages
  - Per-group calendar lazy creation with member email sharing
  - Language-detected (Hebrew/English) casual confirmation messages in group
  - Reply-to-delete: replying to bot confirmation with delete/מחק/❌ removes event
  - getActiveGroupIds: query function returning active group JID strings (for Plan 04)
  - initGroupPipeline: startup registration function wired into index.ts

affects: [08-04]

# Tech tracking
tech-stack:
  added: [chrono-node@2.9.0, zod-to-json-schema@3.25.1]
  patterns:
    - zod/v3 compat import for zod-to-json-schema (zod v4 internal defs incompatible with zod-to-json-schema)
    - Debounce buffer pattern: Map<groupJid, {messages, timer}> with timer reset on each message
    - CalendarId cache: in-memory Map<groupJid, calendarId> + decode from calendarLink URL
    - Immediate delete vs debounced extraction: reply-to-delete handled before debounce

key-files:
  created:
    - src/groups/dateExtractor.ts
    - src/groups/groupMessagePipeline.ts
  modified:
    - src/db/queries/groups.ts
    - src/index.ts
    - package.json
    - package-lock.json

key-decisions:
  - "zod/v3 compat import for date extraction schema: zod v4 defs incompatible with zod-to-json-schema@3.x, using zod/v3 subpath export that ships with zod@4"
  - "chrono-node installed but not used as pre-filter: Hebrew not supported by chrono-node; digit regex is the only pre-filter"
  - "In-memory calendarId cache: avoids repeated URL parsing on every event creation; also decodes calendarId from calendarLink URL as fallback"
  - "Reply-to-delete is immediate (non-debounced): user expects instant feedback when deleting"
  - "getActiveGroupIds added to groups.ts: Plan 04 (weekly reminders) needs JID list without full group objects"

patterns-established:
  - "Zod/v3 subpath pattern: import from 'zod/v3' when using zod-to-json-schema with zod v4 project"
  - "Debounce-then-process pattern: collect rapid group messages into batches, fire after quiet window"
  - "Lazy-create-then-cache: create per-group calendar on first event, cache calendarId in memory"

requirements-completed: [GRP-03, CAL-03, CAL-05]

# Metrics
duration: 24min
completed: 2026-02-23
---

# Phase 8 Plan 03: Date Extraction Pipeline Summary

**Digit-regex pre-filter + Gemini structured date extraction pipeline with 10-second debounce batching, per-group calendar lazy creation, language-detected confirmation messages, and reply-to-delete support**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-02-23T16:50:59Z
- **Completed:** 2026-02-23T17:15:58Z
- **Tasks:** 2 of 2
- **Files modified:** 6

## Accomplishments

- Created `dateExtractor.ts` with `hasNumberPreFilter` (digit regex) and `extractDates` (Gemini structured JSON extraction with Zod schema, high-confidence filter only)
- Created `groupMessagePipeline.ts` with full event lifecycle: pre-filter, Gemini extraction, per-group calendar lazy creation, calendar event creation, Hebrew/English confirmation messages, reply-to-delete via quoted message ID lookup
- 10-second debounce buffer reduces Gemini API calls when multiple messages arrive in quick succession
- `getActiveGroupIds()` added to groups.ts for Plan 04 (weekly reminder scheduler)
- `initGroupPipeline()` wired into `src/index.ts` startup sequence

## Task Commits

Each task was committed atomically:

1. **Task 1: Install chrono-node and create date extraction module** - `64fe627` (feat)
2. **Task 2: Create group message pipeline with debounce, confirmation, and reply-to-delete** - `b65e652` (feat)

**Plan metadata:** *(docs commit follows)*

## Files Created/Modified

- `src/groups/dateExtractor.ts` - `hasNumberPreFilter` digit-regex pre-filter; `extractDates` Gemini structured extraction with zod-to-json-schema responseSchema, filters to high-confidence only
- `src/groups/groupMessagePipeline.ts` - Full pipeline: debounce buffer, calendar lazy creation with email sharing, event creation, language detection, confirmation sending, reply-to-delete handler, `initGroupPipeline` export
- `src/db/queries/groups.ts` - Added `getActiveGroupIds(): string[]` for Plan 04
- `src/index.ts` - Added `initGroupPipeline()` call in startup sequence
- `package.json` - Added chrono-node and zod-to-json-schema dependencies
- `package-lock.json` - Lock file updated

## Decisions Made

- **zod/v3 compat import**: `zod-to-json-schema@3.x` uses `zod/v3` internally. When using it in a zod v4 project, schemas must be created via `import { z } from 'zod/v3'` (zod v4 ships this as a compat subpath). Using `zod/v4` defs returns empty JSON schema (`{}`).
- **chrono-node not used as pre-filter**: The plan notes that chrono-node doesn't support Hebrew. The digit regex (`/\d/`) is the sole pre-filter — any message with digits goes to Gemini regardless of whether chrono-node would find a date.
- **In-memory calendarId cache**: Stores `groupJid -> calendarId` to avoid decoding the calendarLink URL on every message. Falls back to URL decode if cache is cold (e.g., after restart).
- **Reply-to-delete is non-debounced**: The delete action runs immediately when the callback fires, before the debounce buffer. This gives instant feedback to the user.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used zod/v3 compat import instead of plain zod**
- **Found during:** Task 1 (date extraction module)
- **Issue:** `zod-to-json-schema@3.x` imports from `zod/v3` (Zod v3 internal API). When a Zod v4 schema is passed to it, `zodToJsonSchema()` returns an empty object `{}` because it can't parse v4 internal defs
- **Fix:** Changed `import { z } from 'zod'` to `import { z } from 'zod/v3'` within dateExtractor.ts for the schema definition only. This is the compat subpath that Zod v4 ships for backwards compatibility.
- **Files modified:** `src/groups/dateExtractor.ts`
- **Verification:** Tested with Node.js — zod/v3 schema produces full JSON schema, zod v4 schema produces `{}`
- **Committed in:** `64fe627` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required for correct Gemini structured output. zod/v3 import is scoped to dateExtractor.ts only; rest of codebase continues using zod v4.

## Issues Encountered

None beyond the zod/v3 compat issue documented above.

## User Setup Required

None - all dependencies installed automatically. Calendar service account already configured (Phase 8 Plan 01 Task 3).

## Next Phase Readiness

- Date extraction pipeline fully wired and ready for production group messages
- `getActiveGroupIds()` available for Plan 04 (weekly digest/reminder cron scheduler)
- Per-group calendar creation will happen automatically on first high-confidence date extraction from each group
- Language detection uses recent group messages from DB — works out-of-the-box for Hebrew and English groups

## Self-Check: PASSED

- FOUND: src/groups/dateExtractor.ts
- FOUND: src/groups/groupMessagePipeline.ts
- FOUND: commit 64fe627 (Task 1)
- FOUND: commit b65e652 (Task 2)

---
*Phase: 08-group-monitoring-and-calendar*
*Completed: 2026-02-23*
