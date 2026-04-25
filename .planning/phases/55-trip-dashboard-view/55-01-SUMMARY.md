---
phase: 55-trip-dashboard-view
plan: "01"
subsystem: db-schema
tags: [drizzle, sqlite, trip-memory, soft-delete, dashboard]
dependency_graph:
  requires: []
  provides: [trip_decisions.status, trip_decisions.lat, trip_decisions.lng, softDeleteDecision, updateBudgetByCategory, listTripsForDashboard, getTripBundle]
  affects: [getDecisionsByGroup, getBudgetRollup, tripMemory.ts]
tech_stack:
  added: []
  patterns: [soft-delete via status column, drizzle ne() filter, upcoming-first sort]
key_files:
  created:
    - drizzle/0024_trip_decisions_dashboard.sql
    - .planning/phases/55-trip-dashboard-view/55-01-SUMMARY.md
  modified:
    - drizzle/meta/_journal.json
    - src/db/schema.ts
    - src/db/queries/tripMemory.ts
    - src/db/queries/__tests__/tripMemory.test.ts
decisions:
  - "status enum enforced at app layer only — no CHECK constraint, matching existing type column convention"
  - "getTripBundle falls through to trip_archive on trip_contexts miss, returns readOnly: true"
  - "Migration applied directly via sqlite3 CLI (drizzle-kit generate unsafe after FTS5 migration 0010)"
  - "getDecisionsByGroup includeDeleted defaults false — soft-delete hides rows everywhere by default"
metrics:
  duration_minutes: 18
  completed_date: "2026-04-25"
  tasks_completed: 3
  files_modified: 4
---

# Phase 55 Plan 01: Trip Dashboard DB Foundation Summary

JWT-gated soft-delete and lat/lng schema delta on trip_decisions plus four new dashboard query helpers (softDeleteDecision, updateBudgetByCategory, listTripsForDashboard, getTripBundle) wired through the existing Drizzle query layer.

## Migration 0024

**File:** `drizzle/0024_trip_decisions_dashboard.sql`

```sql
ALTER TABLE trip_decisions ADD COLUMN status text NOT NULL DEFAULT 'active';
ALTER TABLE trip_decisions ADD COLUMN lat real;
ALTER TABLE trip_decisions ADD COLUMN lng real;
```

**Backfill:** 4 pre-existing `trip_decisions` rows were automatically stamped `status='active'` by the `NOT NULL DEFAULT 'active'` clause. Verified: `SELECT COUNT(*) FROM trip_decisions WHERE status='active'` = 4, `SELECT COUNT(*) FROM trip_decisions` = 4.

## New Exports Added to tripMemory.ts

### `softDeleteDecision(decisionId: string): RunResult`
Flips `status` to `'deleted'` via `UPDATE trip_decisions SET status='deleted' WHERE id=?`. Returns better-sqlite3 `RunResult`; route layer checks `.changes === 0` to return 404.

### `updateBudgetByCategory(groupJid: string, patch: Partial<Record<TripCategory, number>>): Record<TripCategory, number>`
Reads `trip_contexts.budget_by_category` JSON, shallow-merges the patch (strips non-finite values), writes back via `upsertTripContext`. Throws if no `trip_context` row exists — caller gets 404.

### `listTripsForDashboard(): TripListEntry[]`
Returns all trips (active `trip_contexts` + terminal `trip_archive` rows) sorted: upcoming (endDate >= today) ASC by startDate → past (endDate < today) DESC by endDate → archive rows DESC by archivedAt. No luxon dependency; uses `new Date().toISOString().slice(0,10)`.

### `getTripBundle(groupJid: string): TripBundle | null`
Unified payload for `GET /api/trips/:groupJid`. Lookup order: `trip_contexts` → `trip_archive` (sets `readOnly: true`) → null (404). Returns: `{ context, readOnly, decisions (all incl. deleted), openQuestions (non-deleted, non-resolved), calendarEvents (windowed by trip dates), budget }`.

## Existing Helpers Patched

### `getDecisionsByGroup` — soft-delete filter
Added `includeDeleted?: boolean` option (default `false`). When false, appends `ne(tripDecisions.status, 'deleted')` to the WHERE clause. Backwards-compatible: positional string arg still works and hides deleted rows.

### `getBudgetRollup` — soft-delete exclusion
Added `ne(tripDecisions.status, 'deleted')` to the WHERE clause aggregating `cost_amount`. Deleted decisions no longer inflate per-category spending.

## Test Count Delta

| Before | After | Delta |
|--------|-------|-------|
| 11     | 27    | +16   |

**Full vitest result:** 27 passed, 0 failed — all pre-existing tests still pass.

New test groups:
- Migration 0024 round-trip (1 test)
- softDeleteDecision (3 tests)
- getDecisionsByGroup deleted-filter (3 tests)
- getBudgetRollup deleted-exclusion (1 test)
- updateBudgetByCategory (3 tests)
- listTripsForDashboard sort (2 tests)
- getTripBundle (3 tests)

## Decisions Made

1. **status enum app-layer-only, no CHECK constraint** — matches the existing `type` and `origin` column conventions in `trip_decisions`. Enum values `'active' | 'deleted'` are enforced at the query/route layer.

2. **getTripBundle reads trip_archive on fallthrough** — if `getTripContext` returns null, the bundle queries `trip_archive` for the group and sets `readOnly: true`. The archive row is mapped to a context-compatible shape with null for fields that don't exist in `trip_archive` (contextSummary, metadata, etc.).

3. **Migration applied via sqlite3 CLI** — `drizzle-kit migrate` / `initDb()` are the standard path but `drizzle-kit generate` is unsafe after FTS5 migration 0010 (see project memory). The raw SQL in `0024_trip_decisions_dashboard.sql` matches the migration that will be replayed by `migrate()` on next bot restart.

4. **Soft-delete is a query-layer concern, not UI-layer** — as locked in 55-CONTEXT.md: deleted rows are hidden from `getDecisionsByGroup` default, from `getBudgetRollup`, and from `getTripBundle`'s `decisions` (when the dashboard defaults to `includeDeleted: false`). Only the explicit "Show deleted" toggle passes `includeDeleted: true`.

## Commits

| Hash | Message |
|------|---------|
| bf77a43 | feat(55-01): migration 0024 + schema.ts status/lat/lng columns on trip_decisions |
| 87a3811 | feat(55-01): soft-delete-aware query helpers + dashboard read helpers in tripMemory.ts |
| 2bc4be5 | test(55-01): vitest coverage for soft-delete propagation + Phase 55 dashboard helpers |

## Self-Check: PASSED

- [x] `drizzle/0024_trip_decisions_dashboard.sql` exists
- [x] `drizzle/meta/_journal.json` entry idx:24 with tag `0024_trip_decisions_dashboard`
- [x] `src/db/schema.ts` has status/lat/lng in tripDecisions
- [x] `src/db/queries/tripMemory.ts` exports softDeleteDecision, updateBudgetByCategory, listTripsForDashboard, getTripBundle
- [x] `sqlite3 data/bot.db "PRAGMA table_info(trip_decisions);"` shows all 3 columns
- [x] All 4 pre-existing rows have status='active'
- [x] 27/27 vitest tests pass
- [x] `npx tsc --noEmit` clean (no new errors beyond pre-existing cli/ rootDir errors)
