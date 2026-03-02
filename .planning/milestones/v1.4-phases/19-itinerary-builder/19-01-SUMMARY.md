---
phase: 19-itinerary-builder
plan: "01"
subsystem: calendar-pipeline
tags: [db-schema, migration, date-extraction, zod-v4, calendar, exports]
dependency_graph:
  requires: [18-03]
  provides: [19-02, 19-03]
  affects: [groupMessagePipeline, dateExtractor, calendarService]
tech_stack:
  added: []
  patterns: [hand-written-migration, drizzle-crud, zod-v4-native]
key_files:
  created:
    - drizzle/0011_pending_suggestions.sql
    - src/db/queries/pendingSuggestions.ts
  modified:
    - src/db/schema.ts
    - src/groups/dateExtractor.ts
    - src/calendar/calendarService.ts
    - src/groups/groupMessagePipeline.ts
decisions:
  - "Hand-wrote migration 0011 (never run db:generate after 0010 FTS5 migration)"
  - "Zod v4 native z.toJSONSchema() replaces zod-to-json-schema package"
  - "pendingSuggestions query module mirrors calendarEvents.ts pattern"
  - "Exported calendarIdCache, getCalendarIdFromLink, buildConfirmationText from groupMessagePipeline for use by suggestionTracker"
metrics:
  duration: "3m 23s"
  completed: "2026-03-02"
  tasks: 3
  files: 6
---

# Phase 19 Plan 01: Foundation for Suggest-Then-Confirm Summary

**One-liner:** DB schema + migration for pending suggestions, Zod v4 dateExtractor with enriched fields, optional location in calendarService, and exported pipeline helpers for suggestionTracker.

## What Was Built

Foundation for the suggest-then-confirm flow in Phase 19 (Itinerary Builder). Three tasks completed:

1. **pendingSuggestions table** — Drizzle schema definition + hand-written migration 0011 (CREATE TABLE + 3 indexes on suggestion_msg_id, group_jid, expires_at). Query module with 5 CRUD functions mirrors calendarEvents.ts pattern.

2. **dateExtractor enrichment** — Migrated from `zod/v3` + `zod-to-json-schema` to Zod v4 native `z.toJSONSchema()`. Added optional `location`, `description`, `url` fields to Zod schema and `ExtractedDate` interface. System instruction now requests location/URL extraction from Gemini.

3. **calendarService + pipeline exports** — `createCalendarEvent` now accepts optional `location` parameter passed through to Google Calendar API. Exported `buildConfirmationText`, `getCalendarIdFromLink`, and `calendarIdCache` from groupMessagePipeline.ts to enable Plan 19-02 suggestionTracker without code duplication.

## Commits

| Task | Hash | Description |
|------|------|-------------|
| 1 | 3f9f636 | feat(19-01): add pendingSuggestions table, migration 0011, and query module |
| 2 | 54653d9 | feat(19-01): extend dateExtractor with enriched fields and Zod v4 migration |
| 3 | e3e7236 | feat(19-01): add location param to calendarService and export pipeline helpers |

## Deviations from Plan

None — plan executed exactly as written.

## Decisions Made

- **Hand-written migration:** Never run `db:generate` after migration 0010 (Drizzle would emit DROP TABLE for the FTS5 virtual table). Migration 0011 written by hand, not added to `_journal.json` (custom runner handles it via `__drizzle_migrations` table).
- **Zod v4 migration:** Replaced `zod/v3` import and `zod-to-json-schema` with `z.toJSONSchema()` from Zod v4 (confirmed in STATE.md decision log).
- **Export strategy:** Only the 3 specified helpers exported — `formatDateForDisplay` intentionally left private (used only internally by `buildConfirmationText`).

## Self-Check: PASSED

All 7 files verified present. All 3 task commits verified in git log.
