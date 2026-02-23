---
phase: 08-group-monitoring-and-calendar
plan: 01
subsystem: database
tags: [drizzle, sqlite, google-calendar, whatsapp-baileys]

# Dependency graph
requires:
  - phase: 07-cli-dashboard
    provides: CLI tools and group management foundation
provides:
  - groupMessages SQLite table with sender JID, sender name, and dedup on message ID
  - calendarEvents SQLite table for tracking Google Calendar event-to-message mappings
  - reminderHour column on groups table (0-23 hour for weekly reminders)
  - insertGroupMessage, getGroupMessagesSince query functions
  - insertCalendarEvent, updateCalendarEventConfirmation, getCalendarEventByConfirmationMsgId, deleteCalendarEvent query functions
  - getActiveGroups query function on groups
  - setGroupMessageCallback hook exported from messageHandler for downstream pipeline registration
  - fromMe guard and active-group check in group message processing branch
  - GOOGLE_SERVICE_ACCOUNT_KEY_PATH optional env var in Zod config schema
affects:
  - 08-02-calendar-service
  - 08-03-date-extraction
  - 08-04-weekly-reminders

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Callback registration pattern (setGroupMessageCallback) for decoupling pipeline stages
    - onConflictDoNothing on message ID for idempotent group message inserts
    - Active-group check before persist: silently drop messages from non-tracked groups
    - Select-then-delete pattern for deleteCalendarEvent to return deleted row data

key-files:
  created:
    - src/db/queries/groupMessages.ts
    - src/db/queries/calendarEvents.ts
    - drizzle/0004_peaceful_vapor.sql
  modified:
    - src/db/schema.ts
    - src/db/queries/groups.ts
    - src/pipeline/messageHandler.ts
    - src/config.ts
    - .env.example
    - .gitignore

key-decisions:
  - "Callback registration pattern (setGroupMessageCallback) for downstream pipeline: allows Plan 03 date extraction to register without modifying messageHandler again"
  - "fromMe guard in group branch: bot's own outgoing group messages are not persisted"
  - "Silent drop for non-tracked/inactive groups: no log noise for unmanaged group traffic"
  - "GOOGLE_SERVICE_ACCOUNT_KEY_PATH is optional in Zod schema: bot starts without it during development, calendar features degrade gracefully"

patterns-established:
  - "Active-group gate pattern: check group existence and active flag before any persistence"
  - "Message pipeline callback hook: module-level nullable callback + setter export for downstream pipeline registration"

requirements-completed: [GRP-01, GRP-02, GRP-04, CAL-01]

# Metrics
duration: 10min
completed: 2026-02-23
---

# Phase 8 Plan 01: DB Schema Extensions and Group Message Pipeline Summary

**SQLite group_messages and calendar_events tables added with Drizzle migration, plus upgraded group message pipeline with sender metadata persistence, fromMe guard, active-group check, and downstream callback hook**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-02-23
- **Completed:** 2026-02-23
- **Tasks:** 2 of 3 (Task 3 is a human-action checkpoint for GCP service account setup)
- **Files modified:** 8

## Accomplishments

- Extended SQLite schema with `group_messages` table (dedup on message ID, indexed on groupJid+timestamp) and `calendar_events` table (indexed on confirmationMsgId and groupJid)
- Added `reminderHour` integer column (default 9) to existing `groups` table
- Created full query modules for groupMessages and calendarEvents with all required CRUD functions
- Upgraded messageHandler group branch: fromMe guard ignores bot's own messages, active-group check silently drops untracked groups, sender JID/name captured from Baileys `key.participant` and `pushName`
- Exported `setGroupMessageCallback` hook for Plan 03 (date extraction) to register without further messageHandler changes
- Added `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` as optional Zod field; `.env.example` and `.gitignore` updated

## Task Commits

Each task was committed atomically:

1. **Task 1: DB schema extensions and query modules** - `9190fbf` (feat)
2. **Task 2: Upgrade group message pipeline in messageHandler** - `91ade76` (feat)
3. **Task 3: GCP Service Account Setup** - *Checkpoint: human action required*

## Files Created/Modified

- `src/db/schema.ts` - Added groupMessages and calendarEvents table definitions, reminderHour column on groups
- `src/db/queries/groupMessages.ts` - New: insertGroupMessage (with onConflictDoNothing), getGroupMessagesSince
- `src/db/queries/calendarEvents.ts` - New: insertCalendarEvent, updateCalendarEventConfirmation, getCalendarEventByConfirmationMsgId, deleteCalendarEvent
- `src/db/queries/groups.ts` - Added getActiveGroups function
- `src/pipeline/messageHandler.ts` - Upgraded group branch with fromMe guard, active-group check, sender info extraction, insertGroupMessage call, setGroupMessageCallback hook
- `src/config.ts` - Added GOOGLE_SERVICE_ACCOUNT_KEY_PATH as optional z.string()
- `.env.example` - Added GOOGLE_SERVICE_ACCOUNT_KEY_PATH line
- `.gitignore` - Added data/service-account-key.json exclusion
- `drizzle/0004_peaceful_vapor.sql` - Migration: CREATE TABLE group_messages, CREATE TABLE calendar_events, ALTER TABLE groups ADD reminder_hour

## Decisions Made

- Callback registration pattern (`setGroupMessageCallback`) chosen over direct import to decouple messageHandler from date extraction pipeline — Plan 03 registers its callback at startup without touching messageHandler
- `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` is optional in Zod schema so the bot starts cleanly during development before GCP is configured; calendar features degrade gracefully (return null/false/void per existing pattern)
- Silent drop (no log) for non-tracked/inactive group messages to avoid log noise from WhatsApp groups the bot doesn't manage

## Deviations from Plan

None - plan was executed exactly as written. All required schema definitions, query functions, messageHandler upgrades, and config changes match the plan specification.

## Issues Encountered

None - all files compiled and migrations ran cleanly. Bot startup confirmed "Database initialized" before port conflict with already-running instance (expected in dev environment).

## User Setup Required

**GCP Service Account setup required before calendar features work.** Task 3 is a blocking human-action checkpoint:

1. Go to https://console.cloud.google.com/
2. Create or select a GCP project (e.g., "whatsapp-bot")
3. Enable Google Calendar API: APIs and Services -> Library -> Search "Google Calendar API" -> Enable
4. Create Service Account: IAM and Admin -> Service Accounts -> Create -> Name: "whatsapp-bot-calendar" -> Done
5. Create JSON key: Click service account -> Keys tab -> Add Key -> Create new key -> JSON -> Download
6. Save the key to `/home/yuval/whatsapp-bot/data/service-account-key.json`
7. Add `GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./data/service-account-key.json` to `.env`

**Verification:**
```bash
cat /home/yuval/whatsapp-bot/data/service-account-key.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['type'])"
# Should print: service_account

grep "GOOGLE_SERVICE_ACCOUNT_KEY_PATH" /home/yuval/whatsapp-bot/.env
# Should show the env var is set
```

## Next Phase Readiness

- DB schema foundation complete for all Phase 8 plans (group_messages, calendar_events, reminderHour)
- Group message pipeline stores messages from tracked active groups with full sender metadata
- Callback hook ready for Plan 03 date extraction to register
- Plan 02 (calendar service module) already complete (committed as 08-02)
- Plan 03 (date extraction) can proceed once GCP service account is configured
- Concern: GCP service account must be set up before Plan 03/04 calendar API calls will work

---
*Phase: 08-group-monitoring-and-calendar*
*Completed: 2026-02-23*
