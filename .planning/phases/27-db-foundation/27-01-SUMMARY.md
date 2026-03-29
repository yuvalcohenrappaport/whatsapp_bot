---
phase: 27-db-foundation
plan: 01
subsystem: database
tags: [drizzle-orm, sqlite, better-sqlite3, migration, schema]

# Dependency graph
requires: []
provides:
  - scheduledMessages table (src/db/schema.ts)
  - scheduledMessageRecipients table (src/db/schema.ts)
  - Migration 0019 creating both tables with all columns and indexes
affects: [28-scheduler-core, 29-cancel-window, 30-send-pipeline, 31-voice-ai-send, 32-cron-recurrence]

# Tech tracking
tech-stack:
  added: []
  patterns: [hand-written migration SQL matching drizzle schema, plain text FK (no drizzle references()), __drizzle_migrations manual insert for pre-applied migrations]

key-files:
  created:
    - drizzle/0019_scheduled_messages.sql
  modified:
    - src/db/schema.ts
    - drizzle/meta/_journal.json

key-decisions:
  - "Plain text FK for scheduledMessageId (no drizzle references()) — consistent with project convention"
  - "Migration applied directly to DB and hash inserted into __drizzle_migrations to prevent double-run on next startup"
  - "cancelRequestedAt stored as DB column (not in-memory) — survives PM2 reloads"

patterns-established:
  - "Hand-written migration SQL: CREATE TABLE then indexes, separated by '--> statement-breakpoint'"
  - "After manually applying migration, insert hash into __drizzle_migrations with matching created_at timestamp"

requirements-completed: [SCHED-02]

# Metrics
duration: 3min
completed: 2026-03-30
---

# Phase 27 Plan 01: DB Foundation Summary

**Two new SQLite tables (scheduled_messages, scheduled_message_recipients) with Drizzle schema definitions, hand-written migration 0019, and journal entry — the root blocker for v1.6 scheduled replies**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-29T23:52:34Z
- **Completed:** 2026-03-29T23:54:42Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Defined `scheduledMessages` table with 12 columns covering type, content, status lifecycle, scheduling, cancel tracking, and failure counting
- Defined `scheduledMessageRecipients` table with 9 columns for per-recipient status tracking across contacts and groups
- Created hand-written migration 0019 applying cleanly with all 4 indexes verified in the live DB

## Task Commits

Each task was committed atomically:

1. **Task 1: Add scheduled_messages and scheduled_message_recipients tables to schema.ts** - `1144078` (feat)
2. **Task 2: Create hand-written migration 0019 and update journal** - `771b72e` (feat)

**Plan metadata:** (included in final docs commit)

## Files Created/Modified
- `src/db/schema.ts` - Added scheduledMessages and scheduledMessageRecipients table exports with columns, defaults, and indexes
- `drizzle/0019_scheduled_messages.sql` - Hand-written SQL migration creating both tables and 4 indexes
- `drizzle/meta/_journal.json` - Journal entry idx=19 added for 0019_scheduled_messages

## Decisions Made
- Plain text FK for `scheduledMessageId` — consistent with existing project pattern (no Drizzle `references()`)
- Migration was applied directly to the live DB using the SQL file; migration hash was inserted into `__drizzle_migrations` to prevent Drizzle from attempting to re-run it on next bot startup
- `cancelRequestedAt` stored as a DB column so cancel state survives PM2 reloads (per v1.6 design decisions)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TS6059 error (`cli/bot.ts` outside `rootDir`) present before this plan — not caused by schema changes, out of scope. No schema-related TypeScript errors.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both tables live in the DB with all columns and indexes
- `scheduledMessages` and `scheduledMessageRecipients` exported from `src/db/schema.ts` and accessible via drizzle client
- Phase 28 (scheduler-core) can begin immediately — no blockers

---
*Phase: 27-db-foundation*
*Completed: 2026-03-30*
