---
phase: 39-actionables-data-model
plan: 01
status: complete
completed: 2026-04-19
commits:
  - 19c0775 feat(39-01): add actionables table to Drizzle schema
  - b5e4247 feat(39-01): hand-written migration 0020_actionables.sql
  - 66b3807 feat(39-01): journal entry for 0020_actionables migration
---

# Plan 39-01 Summary — Schema + Migration

**Ship status:** Complete (3 atomic commits)

## What landed

- `src/db/schema.ts` — `export const actionables = sqliteTable(...)` with 19 columns + 2 indexes (`idx_actionables_status_detected`, `idx_actionables_preview_msg`)
- `drizzle/0020_actionables.sql` — hand-written `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` (idempotent re-run)
- `drizzle/meta/_journal.json` — appended `{idx: 20, tag: "0020_actionables", version: "6", breakpoints: true}`

## Verification

- `tsc --noEmit` clean
- Smoke test against a copy of the live DB: first apply OK, second apply (idempotent) OK, all 19 columns + 2 indexes present, row count 0

## Plan-level SCs

- [x] actionables Drizzle table exists with the full column set (ACT-01)
- [x] Hand-written SQL migration applies cleanly + idempotent (guards via `IF NOT EXISTS`)
- [x] Journal entry in place

## Notes

- Column-name ↔ TS-name mapping follows existing `scheduled_messages` convention (snake_case ↔ camelCase)
- Status default is `pending_approval`; full enum is documented in the `status` column comment; runtime lifecycle enforcement ships in Plan 39-02
