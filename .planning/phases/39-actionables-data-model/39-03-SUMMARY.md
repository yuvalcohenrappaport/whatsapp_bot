---
phase: 39-actionables-data-model
plan: 03
status: complete
completed: 2026-04-19
commits:
  - 300f81e feat(39-03): backfill migration — legacy reminders + todo_tasks → actionables
  - 41137bb feat(39-03): journal entry for 0021_actionables_backfill
  - e2aa265 feat(39-03): startup fixup for USER_JID placeholder + post-migration count log
  - d5645a8 test(39-03): 11 vitest scenarios for actionables backfill
---

# Plan 39-03 Summary — Backfill Migration + Tests

**Ship status:** Complete (4 atomic commits)

## What landed

- `drizzle/0021_actionables_backfill.sql` — 12 `INSERT ... SELECT` statements, each guarded by `WHERE NOT EXISTS (SELECT 1 FROM actionables a WHERE a.id = legacy.id)` for idempotent re-run
- `drizzle/meta/_journal.json` — appended `{idx: 21, tag: "0021_actionables_backfill"}`
- `src/db/client.ts` — `initDb()` now runs a one-time idempotent UPDATE that replaces `USER_JID_PLACEHOLDER` with `config.USER_JID` on backfilled `user_command` rows, then logs `actionables_total` / `legacy_reminders_commitment` / `legacy_todo_tasks` / `user_jid_fixed` counts so the first post-deploy startup surfaces any anomaly. Both operations wrapped in try/catch to stay boot-safe on a pre-0020 rollback DB
- `src/db/__tests__/backfill.test.ts` — 11 vitest scenarios covering every mapping in 39-CONTEXT.md plus an idempotency check plus a full-matrix cross-check

## Status mapping (from 39-CONTEXT.md)

| Legacy source/status | → actionables.status |
|---|---|
| `reminders(source='commitment', status='pending')` | `approved` (Google Tasks ids preserved) |
| `reminders(source='commitment', status='fired')` | `fired` |
| `reminders(source='commitment', status='cancelled')` | `rejected` |
| `reminders(source='commitment', status='skipped')` | `expired` |
| `reminders(source='user', status='pending')` | `approved` (user_command, USER_JID_PLACEHOLDER) |
| `reminders(source='user', status='fired'|'cancelled'|'skipped')` | `fired` / `rejected` / `expired` |
| `todo_tasks(status='synced')` | `approved` (Google Tasks ids preserved) |
| `todo_tasks(status='pending'|'failed')` | `pending_approval` (re-gated) |
| `todo_tasks(status='cancelled')` | `rejected` |

## Verification

- `tsc --noEmit` clean
- `npx vitest run src/db/__tests__/backfill.test.ts src/db/queries/__tests__/actionables.test.ts` — 54/54 passed in 77ms
- End-to-end smoke test against a fresh copy of the live DB:
  - Before: 30 commitment reminders + 308 user reminders + 18 todo_tasks = **356 legacy rows**
  - After: **356 actionables rows** (no data loss)
  - By status: 6 approved, 308 fired, 12 pending_approval, 30 rejected
  - By type: 30 commitment, 308 user_command, 18 task
  - Google Tasks ids preserved on 128 rows
  - 308 `USER_JID_PLACEHOLDER` rows will be fixed at first boot via the new startup fixup
  - Re-running the backfill is a no-op (count unchanged)

## Plan-level SCs

- [x] Backfill SQL maps every mapping table combination (MIGR-01)
- [x] Idempotent (NOT EXISTS guards)
- [x] Google Tasks ids preserved
- [x] Startup fixup handles USER_JID_PLACEHOLDER idempotently
- [x] vitest coverage matches the 9-mapping table

## Notes

- The `OR source IS NULL` clause in the backfill SQL is defensive (pre-0016 rows would have had NULL source but 0016 added NOT NULL) — the test for that specific case was removed after the schema NOT NULL guard confirmed it would never fire in prod
- Legacy `reminders` and `todo_tasks` tables are left in place in SQLite. Code-level retirement happens in Phase 40 (detection writes switch to actionables) and Phase 41 (self-chat reminders switch to actionables). Formal `DROP TABLE` deferred to a future milestone.
