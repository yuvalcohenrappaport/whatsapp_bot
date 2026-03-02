---
phase: 18-trip-memory
plan: 01
subsystem: database
tags: [sqlite, fts5, drizzle-orm, better-sqlite3, trip-memory]

# Dependency graph
requires:
  - phase: 17-pipeline-audit
    provides: stable pipeline insertion points and confirmed Drizzle migration conventions
provides:
  - tripContexts table (per-group upsert row storing destination, dates, context summary)
  - tripDecisions table (append-only typed decision records with open_question support)
  - FTS5 virtual table group_messages_fts with 3 triggers and existing-data rebuild
  - src/db/queries/tripMemory.ts with 7 typed query functions
affects: [18-02, 18-03, 19-itinerary-builder, 21-travel-intelligence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Hand-written Drizzle migration for FTS5 (virtual tables unsupported by drizzle-kit)
    - FTS5 external content table with INSERT/UPDATE/DELETE trigger sync
    - FTS5 query sanitization: split->filter short words->double-quote each word->join

key-files:
  created:
    - src/db/queries/tripMemory.ts
    - drizzle/0009_trip_memory.sql
    - drizzle/0010_fts5_group_messages.sql
  modified:
    - src/db/schema.ts
    - drizzle/meta/_journal.json

key-decisions:
  - "FTS5 migration is hand-written (0010), separate from Drizzle-generated (0009) — never run db:generate after 0010 or Drizzle will emit DROP TABLE for the virtual table"
  - "Warning comment added to schema.ts above tripContexts to prevent accidental db:generate after FTS5 migration"
  - "FTS5 rebuild runs in migration so existing group messages are indexed on upgrade"

patterns-established:
  - "Hand-written Drizzle migration for FTS5: place in drizzle/ with statement-breakpoint markers, add journal entry manually"
  - "FTS5 query sanitization in tripMemory.ts: strip FTS5 syntax injection via double-quoting each word"

requirements-completed: [MEM-01, MEM-02]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 18 Plan 01: Trip Memory DB Schema and FTS5 Summary

**SQLite tripContexts and tripDecisions tables plus FTS5 full-text search on group_messages.body, with 7 typed query functions for CRUD and search**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-02T16:06:50Z
- **Completed:** 2026-03-02T16:09:09Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added tripContexts (per-group upsert) and tripDecisions (append-only with type+confidence) tables to Drizzle schema with correct column types, indexes, and $defaultFn timestamps
- Generated Drizzle migration 0009_trip_memory.sql and renamed to canonical tag; updated journal
- Created hand-written 0010_fts5_group_messages.sql with FTS5 virtual table, 3 sync triggers, and rebuild command to index existing messages on migration run
- Created src/db/queries/tripMemory.ts with all 7 exported query functions: getTripContext, upsertTripContext, getDecisionsByGroup, insertTripDecision, getUnresolvedOpenItems, resolveOpenItem, searchGroupMessages

## Task Commits

Each task was committed atomically:

1. **Task 1: Add tripContexts and tripDecisions tables to schema and generate migration** - `b40c94e` (feat)
2. **Task 2: Create FTS5 migration and tripMemory query module** - `fed7fd5` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/db/schema.ts` - Added tripContexts and tripDecisions table definitions with warning comment about FTS5 living outside Drizzle
- `drizzle/0009_trip_memory.sql` - Drizzle-generated migration creating trip_contexts and trip_decisions tables with indexes
- `drizzle/0010_fts5_group_messages.sql` - Hand-written migration creating FTS5 virtual table, 3 triggers, and rebuild
- `drizzle/meta/_journal.json` - Added entries for idx 9 (0009_trip_memory) and idx 10 (0010_fts5_group_messages)
- `src/db/queries/tripMemory.ts` - 7 query functions for CRUD + FTS5 search with input sanitization

## Decisions Made
- FTS5 migration is hand-written and separate from the Drizzle-generated migration to avoid drizzle-kit attempting to manage the virtual table in future runs. A warning comment in schema.ts documents this constraint.
- FTS5 rebuild runs inside the migration so existing group messages are immediately searchable after upgrade without manual intervention.
- searchGroupMessages sanitizes input by splitting on whitespace, filtering words <2 chars, and double-quoting each word to prevent FTS5 syntax injection attacks.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- tripContexts and tripDecisions tables exist in SQLite after bot startup (confirmed: migrations apply on initDb())
- FTS5 virtual table group_messages_fts created with 3 triggers and rebuild complete
- All 7 query functions in tripMemory.ts exported, typed, and callable (confirmed via smoke tests)
- Ready for Phase 18-02 (tripContextManager + pipeline integration) and 18-03 (history_search handler)
- Phase 19 can import getTripContext, Phase 21 can import getUnresolvedOpenItems and resolveOpenItem

## Self-Check: PASSED

All files verified present:
- FOUND: src/db/schema.ts
- FOUND: src/db/queries/tripMemory.ts
- FOUND: drizzle/0009_trip_memory.sql
- FOUND: drizzle/0010_fts5_group_messages.sql
- FOUND: .planning/phases/18-trip-memory/18-01-SUMMARY.md

All commits verified present:
- FOUND: b40c94e (feat: tripContexts and tripDecisions tables)
- FOUND: fed7fd5 (feat: FTS5 migration and tripMemory query module)

---
*Phase: 18-trip-memory*
*Completed: 2026-03-02*
