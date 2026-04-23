---
phase: 51-richer-trip-memory
plan: 01
subsystem: database
tags: [drizzle, sqlite, schema, migration, trip-memory, travel-agent-v2.1]

# Dependency graph
requires:
  - phase: 09-trip-memory
    provides: base trip_contexts + trip_decisions tables + initial query helpers
provides:
  - 8 new columns on trip_decisions (proposed_by, category, cost_amount, cost_currency, conflicts_with, origin, metadata, archived)
  - 6 new columns on trip_contexts (start_date, end_date, budget_by_category, calendar_id, status, briefing_time)
  - trip_archive table + indexes on group_jid, end_date
  - Typed query helpers: insertTripDecision (v2.1), upsertTripContext (v2.1), getBudgetRollup, updateDecisionConflicts, moveContextToArchive, markDecisionsArchivedForGroup, getExpiredActiveContexts
  - Exported TripCategory / DecisionOrigin / TRIP_CATEGORIES enums
affects: [51-02-classifier-upgrade, 51-03-conflict-detector, 51-04-self-report-commands, 51-05-auto-archive-cron, 55-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Decision archival via boolean `archived` flag (not FK, not sibling table) — single UPDATE flip, trivial filter on reads"
    - "Hybrid schema: structured columns for hot-query fields, `metadata` JSON blob for edge cases"
    - "Per-plan `deferred-items.md` for pre-existing out-of-scope failures"

key-files:
  created:
    - drizzle/0022_v21_phase51_trip_memory.sql
    - src/db/queries/__tests__/tripMemory.test.ts
    - .planning/phases/51-richer-trip-memory/deferred-items.md
  modified:
    - src/db/schema.ts
    - src/db/queries/tripMemory.ts
    - drizzle/meta/_journal.json

key-decisions:
  - "Decision archival = boolean `archived` flag on trip_decisions (single-column add, 1-UPDATE archive, trivial filter on reads). Rejected FK to trip_archive.id (doubles update cost) and sibling trip_decisions_archive table (10+ duplicate columns, forces UNION in dashboard)."
  - "Category enum enforced in the app layer (TripCategory type + TRIP_CATEGORIES constant), not via SQLite CHECK — mirrors the existing `type` column convention on trip_decisions."
  - "drizzle-orm's `db.transaction(fn)` is the correct API (callback runs synchronously, rolls back on throw) — not the callable wrapper from raw better-sqlite3."
  - "Test harness replays every migration 0000-0022 in order except 0010 (FTS5) — keeps in-memory test DB self-contained without pulling in drizzle-kit's journal tracker."

patterns-established:
  - "Drizzle migration idempotence: never repeat the literal `--> statement-breakpoint` string inside a comment (the better-sqlite3 migrator splits on it globally, not just at EOL)."
  - "upsertTripContext accepts partial patches — unspecified columns are preserved via conditional omission rather than nulled."
  - "Helpers that snapshot rows into archive tables run inside db.transaction to keep the move + delete atomic."

requirements-completed: [MEM2-01, MEM2-02, MEM2-04, MEM2-05]

# Metrics
duration: 8min
completed: 2026-04-23
---

# Phase 51 Plan 01: v2.1 Trip Memory Schema + Query Helpers Summary

**Drizzle migration 0022 adds 14 columns + trip_archive table, plus typed query helpers (getBudgetRollup, moveContextToArchive, getExpiredActiveContexts) that Wave 2 plans build against.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-23T19:47:54Z
- **Completed:** 2026-04-23T19:55:58Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Migration 0022 applies cleanly to a fresh DB and is journal-idempotent on re-apply
- `trip_decisions` gains proposed_by, category, cost_amount, cost_currency, conflicts_with, origin, metadata, archived (8 columns)
- `trip_contexts` gains start_date, end_date, budget_by_category, calendar_id, status, briefing_time (6 columns)
- New `trip_archive` table + indexes on `group_jid` and `end_date`
- Typed query surface for Wave 2: `insertTripDecision` (v2.1 shape, backwards-compat), `upsertTripContext` (partial patches), `getBudgetRollup`, `updateDecisionConflicts`, `moveContextToArchive`, `markDecisionsArchivedForGroup`, `getExpiredActiveContexts`
- 11/11 new unit tests green including round-trip, backwards-compat, transactional archive flow, and expiry-logic cases

## Task Commits

1. **Task 1: Write migration 0022 + extend Drizzle schema** — `a0a57e9` (feat)
2. **Task 2: Extend tripMemory.ts query helpers for v2.1 fields** — `6bf1bbc` (feat)

## Files Created/Modified
- `drizzle/0022_v21_phase51_trip_memory.sql` — v2.1 schema migration (created)
- `drizzle/meta/_journal.json` — registers idx=22 entry (modified)
- `src/db/schema.ts` — new columns on tripContexts/tripDecisions + tripArchive table (modified)
- `src/db/queries/tripMemory.ts` — v2.1 helpers + TripCategory/DecisionOrigin exports (modified)
- `src/db/queries/__tests__/tripMemory.test.ts` — 11 round-trip/archive/expiry tests (created)
- `.planning/phases/51-richer-trip-memory/deferred-items.md` — scope log for pre-existing failures (created)

## Decisions Made
- **Decision archival strategy:** boolean `archived` flag on `trip_decisions` (see `<decision_rationale>` in PLAN). Rejected FK and sibling-table approaches.
- **Category enum:** app-layer enforcement via `TripCategory` TS type (no SQLite CHECK constraint) — consistent with the legacy `type` column.
- **Archive transaction API:** use drizzle-orm's `db.transaction((txDb) => { ... })` (synchronous callback), not the callable-wrapper pattern from raw better-sqlite3.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed literal `--> statement-breakpoint` from SQL comment**
- **Found during:** Task 1 (migration apply to test DB)
- **Issue:** Leading comment in 0022 migration contained the literal string `--> statement-breakpoint` as part of documentation prose. better-sqlite3/migrator splits the whole file on that literal (not just EOL occurrences), producing an empty first chunk → "The supplied SQL string contains no statements" runtime error.
- **Fix:** Rephrased the comment to "breakpoint line" instead of the literal marker.
- **Files modified:** `drizzle/0022_v21_phase51_trip_memory.sql`
- **Verification:** `migrate()` against a fresh /tmp/bot-test-51-01.db copy succeeds and `.schema trip_decisions` shows all 8 new columns.
- **Committed in:** `a0a57e9` (Task 1 commit)

**2. [Rule 1 - Bug] Fixed `db.transaction` usage in moveContextToArchive**
- **Found during:** Task 2 (test run)
- **Issue:** Initial implementation used raw better-sqlite3 `const tx = db.transaction(fn); tx();` pattern. drizzle-orm's better-sqlite3 adapter returns the fn's result directly — calling the returned value throws `TypeError: tx is not a function`.
- **Fix:** Switched to `db.transaction((txDb) => { ... })` signature, using the scoped `txDb` handle for inserts/deletes.
- **Files modified:** `src/db/queries/tripMemory.ts`
- **Verification:** `npm test -- tripMemory.test.ts` went from 10/11 → 11/11 passing.
- **Committed in:** `6bf1bbc` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs caught by verification steps)
**Impact on plan:** Both were local correctness bugs discovered during task verify. No scope creep, no architectural change, no extra tasks added.

## Issues Encountered
- `drizzle-kit migrate` CLI exited silently with code 1 in our environment; used the same `better-sqlite3/migrator` the app uses (`initDb()` in `src/db/client.ts`) for the throwaway-DB idempotence check. Net: the migration runs under the exact runtime path production uses.
- Pre-existing test failures in `CommitmentDetectionService.test.ts` (4) and `actionables/detectionService.test.ts` (2) reproduced on `HEAD` before our changes — logged to `deferred-items.md` as out-of-scope.

## User Setup Required

None — schema-only change; no external service configuration needed.

## Next Phase Readiness

- **Wave 2 unblocked:** Plans 51-02 (classifier), 51-03 (conflict detector), 51-04 (self-report commands), 51-05 (auto-archive cron) can all develop in parallel against the stable typed surface in `src/db/queries/tripMemory.ts`.
- **Already wired for cron:** `getExpiredActiveContexts` + `moveContextToArchive` + `markDecisionsArchivedForGroup` are the exact three-call sequence Plan 51-05 needs — no extra scaffolding required.
- **Budget rollup ready:** `getBudgetRollup` returns `{targets, spent, remaining}` per category, so dashboard (55) and `!budget` command (51-04) can both consume it unchanged.

## Self-Check

- `drizzle/0022_v21_phase51_trip_memory.sql` — FOUND
- `src/db/queries/tripMemory.ts` — FOUND (extended)
- `src/db/queries/__tests__/tripMemory.test.ts` — FOUND
- `src/db/schema.ts` — FOUND (modified with tripArchive)
- Commit `a0a57e9` (Task 1) — FOUND in `git log`
- Commit `6bf1bbc` (Task 2) — FOUND in `git log`

## Self-Check: PASSED

---
*Phase: 51-richer-trip-memory*
*Completed: 2026-04-23*
