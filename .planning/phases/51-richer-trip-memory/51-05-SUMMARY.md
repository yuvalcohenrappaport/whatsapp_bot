---
phase: 51-richer-trip-memory
plan: 05
subsystem: scheduler
tags: [cron, archive, trip-memory, travel-agent-v2.1, node-cron]

# Dependency graph
requires:
  - phase: 51-richer-trip-memory
    plan: 01
    provides: getExpiredActiveContexts + moveContextToArchive + markDecisionsArchivedForGroup
provides:
  - Daily 02:00 Asia/Jerusalem archive cron (initArchiveTripsCron)
  - runArchiveTripsOnce() callable for tests + manual CLI invocation (no cron required)
affects: [55-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Crash-safe archive ordering: move context first, then flip decisions — mid-run crash never leaves an 'active trip with no decisions' window visible to dashboard/classifier"
    - "Per-group independent error handling in cron loop — one failed group doesn't poison the rest; next run retries"
    - "Idempotent init via stop-then-reschedule — supports dev hot-reload and guards against double-registration"

key-files:
  created:
    - src/scheduler/archiveTripsCron.ts
    - src/scheduler/__tests__/archiveTripsCron.test.ts
  modified:
    - src/index.ts

key-decisions:
  - "Archive ordering: moveContextToArchive BEFORE markDecisionsArchivedForGroup. Inverse would leave an 'active trip + archived decisions' window after a mid-call crash. Confirmed by the mid-list-crash test case."
  - "No transaction wrapping the whole cron run — each group is its own unit. A crash mid-list leaves remaining groups for the next run."
  - "runArchiveTripsOnce() is exported separately so tests + CLI backfills don't need to start the actual node-cron timer."
  - "Do NOT run runArchiveTripsOnce() at startup — spec says daily 02:00; startup invocation would double-archive on mid-day restarts."

requirements-completed: [MEM2-05]

# Metrics
duration: 10min
completed: 2026-04-23
---

# Phase 51 Plan 05: Auto-Archive Cron Summary

**Daily 02:00 Asia/Jerusalem cron archives expired trips (`end_date + 3 days < now`) using the three-call sequence shipped by 51-01 — moveContextToArchive first for crash-safe ordering, then markDecisionsArchivedForGroup. Registered at bot startup; Phase 51 Wave 3 closes.**

## Performance

- **Duration:** ~10 min (incl. test-bug Rule-1 fix for the mid-list crash spy)
- **Tasks:** 2 (cron module + tests, wire-up) — shipped as a single atomic `feat(51-05)` commit per plan output spec
- **Files created:** 2 — `src/scheduler/archiveTripsCron.ts` (101 lines), `src/scheduler/__tests__/archiveTripsCron.test.ts` (349 lines)
- **Files modified:** 1 — `src/index.ts` (+4 lines: import + call + logger.info)

## Accomplishments

- **Cron module (`src/scheduler/archiveTripsCron.ts`):**
  - `initArchiveTripsCron()` — registers `cron.schedule('0 2 * * *', handler, { timezone: 'Asia/Jerusalem' })`; idempotent via pre-scheduled `.stop()` before re-register.
  - `runArchiveTripsOnce(nowMs = Date.now())` — callable sync function returning `{ archivedCount }`; loops `getExpiredActiveContexts(nowMs)` → `moveContextToArchive(groupJid)` → `markDecisionsArchivedForGroup(groupJid)` per group; per-group `try/catch` isolates failures.
  - Null-result path: if `moveContextToArchive` returns `null` (row vanished between SELECT and move — racy delete), logs warn + skips without flipping decisions.
- **Wire-up (`src/index.ts`):** `initArchiveTripsCron()` invoked in `main()` after `initReminderScheduler()` — startup-only, AFTER DB init, BEFORE socket connect. Not invoked inside `onOpen` because no WhatsApp socket dependency.
- **Tests (11/11 green):**
  1. Expired (end_date = 4 days ago) archives: context moved, decisions flipped to archived=1, trip_archive row has status='archived' + archived_at set.
  2. Non-expired (end_date = 2 days ago, +3d still in future) untouched.
  3. Null end_date untouched.
  4. Status='archived' rows untouched (belt-and-suspenders — getExpiredActiveContexts already filters on status='active').
  5. Idempotent re-run — second call finds nothing.
  6. Mid-list crash recovery: GROUP_A move throws, GROUP_B archives cleanly; re-run archives GROUP_A after un-patching.
  7. Null-result path: moveContextToArchive mocked to return null → archivedCount=0, no decision flip.
  8. initArchiveTripsCron registers `'0 2 * * *'` + `timezone: 'Asia/Jerusalem'`.
  9. initArchiveTripsCron idempotence — second call stops the first registered task.
  10. Scheduled handler invokes runArchiveTripsOnce without throwing.
  11. Exports smoke test.

## Task Commits

1. **Task 1+2 (cron module + tests + wire-up):** `7ab3bd2` (feat) — shipped together per plan `<output>` directive (`feat(51-05): add daily 02:00 archive-expired-trips cron`). Single atomic commit covers both tasks since the cron module is useless without the wire-up and the wire-up imports from the module.

## Files Created/Modified

- `src/scheduler/archiveTripsCron.ts` — new, 101 lines. Exports `initArchiveTripsCron` + `runArchiveTripsOnce`.
- `src/scheduler/__tests__/archiveTripsCron.test.ts` — new, 349 lines. Same in-memory DB harness as `tripMemory.test.ts` (replay drizzle migrations 0000-0022 except 0010 FTS5, split on `--> statement-breakpoint`); `vi.mock('../../db/client.js', () => ({ db: testDb }))` for the mock-before-import pattern.
- `src/index.ts` — +4 lines: `import { initArchiveTripsCron } from './scheduler/archiveTripsCron.js'` after `initScheduledMessageScheduler`; `initArchiveTripsCron(); logger.info('Archive trips cron initialized');` after `initReminderScheduler()` block.

## Decisions Made

- **Archive ordering (move-then-flip):** See plan's `<decision_rationale>`. Confirmed operationally by the mid-list-crash test — when moveContextToArchive throws, decisions stay `archived=0`, so the retry on the next run finds a consistent pre-archive state.
- **Per-group try/catch (not run-wide transaction):** Keeps each group's archive atomic at the helper level (moveContextToArchive already uses `db.transaction` internally, per 51-01). A cron failure on group N of M leaves groups N+1..M pending for the next run — acceptable for a daily-batched operation.
- **Single atomic commit for both tasks:** Plan's `<output>` directive asks for one `feat(51-05)` commit. Cron module + wire-up are a single unit of value — the module is dead code without index.ts, and index.ts fails type-check without the module.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed mid-list crash test's spy invocation under ESM module resets**

- **Found during:** Task 1 verify (`npm test`)
- **Issue:** The pre-existing test (written by the prior executor before rate-limiting out) used `vi.resetModules()` + re-import AFTER `vi.spyOn(tripMemory, 'moveContextToArchive')`. The re-import pulled a fresh tripMemory module, so the cron's new import resolved to an unspied `moveContextToArchive`. Result: both groups archived successfully, `firstRun.archivedCount === 2` vs. expected `1`.
- **Root cause:** `vi.resetModules()` invalidates the module graph; the spy was bound to the pre-reset tripMemory namespace, which is no longer the module the re-imported cron imports from.
- **Fix:** Removed `vi.resetModules()` + dynamic re-imports. Use the top-level imported `runArchiveTripsOnce` directly — `vi.spyOn(tripMemory, 'moveContextToArchive')` mutates the shared tripMemory module's export binding, which the already-imported cron's live binding sees.
- **Files modified:** `src/scheduler/__tests__/archiveTripsCron.test.ts` (`recovers cleanly from a mid-list crash` test case only)
- **Verification:** 11/11 green post-fix.
- **Committed in:** `7ab3bd2`

### Scope Acknowledgments (not deviations)

- **Step 2.verify.3 (boot the bot under dev for 10s):** skipped per plan's explicit fallback ("if that fails, skip this step and rely on unit test coverage"). PM2 runs the live bot on this server; restarting it from an unmerged branch is off-policy per user's "Never push without asking" rule extended to production process restarts. Unit tests cover the wire-up contract (grep count = 2, tsc green).
- **Other untracked files (cli/*.js, cli/commands/persona.ts, dashboard/nohup.out, tsconfig.tsbuildinfo):** pre-existing working-tree noise unrelated to Phase 51. Not included in commits. Already logged in `.planning/phases/51-richer-trip-memory/deferred-items.md` (tsc rootDir section) for the `cli/` paths.

---

**Total deviations:** 1 auto-fixed (Rule 1 — test assertion bug caught by verify step)
**Impact on plan:** Zero — purely a test-harness correctness bug; production cron code unchanged from the spec in the plan.

## Issues Encountered

- Pre-existing `tsc` errors on `cli/bot.ts` + `cli/commands/persona.ts` ("File is not under rootDir 'src'") remained through this plan, confirmed pre-existing by stash-stash-pop against HEAD. Already logged to `.planning/phases/51-richer-trip-memory/deferred-items.md` by 51-01. Out of scope.
- 6 pre-existing vitest failures in commitments/actionables detection suites remain out of scope (logged in deferred-items.md by 51-01). Not re-run here since 51-05 only touches scheduler code.

## User Setup Required

None — cron registers on bot startup. No external service configuration. Next scheduled run: tonight at 02:00 Asia/Jerusalem after the next bot restart.

## Next Phase Readiness

- **Phase 51 closes with this plan.** All 5 plans shipped: 51-01 (schema + helpers), 51-02 (classifier), 51-03 (self-report commands), 51-04 (conflict detector), 51-05 (auto-archive cron).
- **MEM2-05 fully satisfied end-to-end:** expired trips move to trip_archive daily at 02:00 Asia/Jerusalem; decisions flip archived=1 AFTER the context move (crash-safe ordering).
- **Dashboard (Phase 55) consumption path ready:** archived decisions are filterable via the `archived` boolean column; trip_archive preserves the full pre-archive context snapshot with a fresh UUID + archived_at timestamp.
- **Phase 52 (Multimodal Intake) becomes the next planning target** — unblocked since 51-01 schema + 51-02 classifier shape (`origin` enum includes `multimodal`) already accommodate multimodal extractions without further schema changes.

## Self-Check

- `src/scheduler/archiveTripsCron.ts` — FOUND
- `src/scheduler/__tests__/archiveTripsCron.test.ts` — FOUND
- `src/index.ts` (contains `initArchiveTripsCron`, grep count = 2) — FOUND
- Commit `7ab3bd2` (single atomic feat commit per plan output) — FOUND in `git log`

## Self-Check: PASSED

---
*Phase: 51-richer-trip-memory*
*Completed: 2026-04-23*
