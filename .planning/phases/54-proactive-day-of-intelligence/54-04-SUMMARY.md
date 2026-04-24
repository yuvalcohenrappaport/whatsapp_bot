---
phase: 54-proactive-day-of-intelligence
plan: "04"
subsystem: cron, wiring, integration-test

tags: [node-cron, main-bootstrap, in-memory-sqlite, vitest, dependency-injection, dedup-guard, destination-tz, migration-replay]

# Dependency graph
requires:
  - phase: 54-01
    provides: "initBriefingCron, runBriefingCheckOnce with orchestrator DI seam, resolveDestinationTz, dateInTz, isInBriefingWindow, getActiveContextsForBriefing, upsertTripContext({ metadata }), trip_contexts.metadata column (migration 0023)"
  - phase: 54-03
    provides: "runDayOfBriefing orchestrator — exists on disk at src/groups/dayOfBriefing.ts (landed during this plan's execution) but intentionally bypassed in the integration test via the DI seam"
provides:
  - "initBriefingCron() wired into main() after initArchiveTripsCron(), before startSocket() — cron is live on next bot boot"
  - "9-case integration test proving the full cron tick: seeded DB → mocked orchestrator → dedup persistence → boundary gates (archived, future, past, ±7min, day-before-travel edge)"
affects: [55 multi-currency budget normalization, 55+ reliability/retry (deferred per CONTEXT.md)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Integration-test DI pattern: mock db/client + config + ai provider with `vi.mock()` BEFORE the dynamic `await import()` of the module under test; inject the orchestrator as a plain async fn to runBriefingCheckOnce(nowMs, orchestrator) to bypass module resolution entirely and prove behavior without any HTTP/AI side effects"
    - "Parallel-wave isolation: when Plan B might or might not have landed before Plan A's integration test runs, use the DI seam instead of importing B — the test stays green regardless of whether B's file exists"
    - "Dedup-guard round trip: single test asserts first tick triggers + persists last_briefing_date, second tick at identical nowMs returns 0 triggers — proves the read-modify-write metadata merge works end-to-end via the real upsertTripContext + getTripContext path"

key-files:
  created:
    - "src/cron/__tests__/briefingCron.integration.test.ts"
  modified:
    - "src/index.ts (+ initBriefingCron import + call, after initArchiveTripsCron)"

key-decisions:
  - "Chose option (a) from the plan's parallel-landing note: mock runDayOfBriefing inline via the DI seam rather than waiting for 54-03 to land. Test stayed deterministic and proved the cron's scheduling+dedup logic without any coupling to 54-03's orchestrator internals"
  - "Added a 9th test (`two consecutive ticks on same day → exactly one trigger`) beyond the plan's 7/8 — explicit end-to-end dedup proof directly maps to the success_criteria 'Dedup guard verified: two consecutive cron ticks within same day → exactly one post'"
  - "Kept index.ts change to exactly two additions (one import + `initBriefingCron(); logger.info(...);` block) — matches the plan's 'one-line change' spirit and mirrors the initArchiveTripsCron wiring pattern on the line above"
  - "Verified no circular dep: dayOfBriefing.ts (both its Wave 1 non-existence and its Wave 2 landed form) does not import from briefingCron.ts — briefingCron's dynamic import pattern handles both cases transparently"

patterns-established:
  - "Cron wiring order in src/index.ts: initDb → initPersonalCalendarAuth → validateElevenLabs → importChats → createServer → initGroupPipeline → initReminderScheduler → initArchiveTripsCron → initBriefingCron → startSocket. Crons go between pipeline init and socket start so they can fire even before the first WhatsApp connection (the orchestrator itself handles the no-sock case)"
  - "Integration-test file naming: `<name>.integration.test.ts` in `__tests__/` dir of the module under test (sibling of the unit test `<name>.test.ts`). Both run via `npx vitest run`; integration tests exercise the real db query path through an in-memory SQLite with migration replay"

requirements-completed: [DAY-01]

# Metrics
duration: 7min
completed: 2026-04-24
---

# Phase 54 Plan 04: Cron Wiring + Integration Test Summary

**Two-line wire-up of `initBriefingCron()` into `main()` after `initArchiveTripsCron()`, plus a 9-case integration test proving full cron-tick behavior — dedup via `last_briefing_date`, window boundaries (archived, future, past, ±7min, day-before-travel edge), and metadata persistence — using the DI seam to bypass the `dayOfBriefing` orchestrator entirely.**

## Performance

- **Duration:** ~7 min (2026-04-24T23:27:00Z → 2026-04-24T23:34:00Z, estimated)
- **Tasks:** 2 / 2
- **Files created:** 1
- **Files modified:** 1
- **Tests added:** 9 (all passing)

## Accomplishments

- `initBriefingCron()` is now wired into the bot's startup path. Next PM2 restart (or first boot after merge) will register the 15-min cron automatically, no manual step needed.
- Integration test covers every condition in the plan's must_haves `truths` list and the success_criteria dedup assertion directly:
  - Matching active trip → 1 trigger with correct groupJid
  - `last_briefing_date` seeded to today → 0 triggers (dedup)
  - Archived status → 0 triggers
  - `start_date` > 1 day in future → 0 triggers
  - `start_date − 1 = today` edge → 1 trigger (day-before-travel)
  - `end_date` in the past → 0 triggers
  - `±7min` window boundary (08:10 vs 08:00 target) → 0 triggers
  - `last_briefing_date` persisted after successful orchestrator call
  - Two consecutive ticks at identical `nowMs` → exactly one orchestrator call (end-to-end dedup round-trip)
- Zero test regressions: full suite is 558 pass / 6 fail / 7 skip — the 6 failures are the exact same Phase-51-deferred set (commitments + actionables) logged in 54-01 summary.
- Zero new TypeScript errors — same 2 pre-existing CLI rootDir warnings as baseline.

## Task Commits

Each task committed atomically on `feat/v2.1-travel-agent-design`:

1. **Task 1: Wire initBriefingCron into main()** — `e0777b5` (feat)
2. **Task 2: Integration test with dedup guard** — `475aefe` (test)

**Plan metadata commit:** (pending, follows SUMMARY.md + STATE.md + ROADMAP.md write)

Note: Between Task 1 and Task 2 commits, Plan 54-03 landed commit `90ef3c2 feat(54-03): add day-of briefing orchestrator`. My integration test remained fully isolated from that change (confirmed by re-running post-land: still 9/9 green).

## Files Created

- `src/cron/__tests__/briefingCron.integration.test.ts` — 9 integration cases, in-memory SQLite with all drizzle migrations replayed (skipping 0010 FTS5), mocked config/db-client/ai-provider, DI-injected orchestrator mock

## Files Modified

- `src/index.ts` — added `import { initBriefingCron } from './cron/briefingCron.js';` on line 34; added `initBriefingCron(); logger.info('Briefing cron initialized');` on lines 72-73 (after `initArchiveTripsCron()`, before `startSocket()`)

## Decisions Made

- **Took plan option (a): mock `runDayOfBriefing` via the DI seam rather than waiting for Plan 54-03.** The test never imports from `src/groups/dayOfBriefing.ts`; it passes `orchestratorMock` as the second arg to `runBriefingCheckOnce`. This kept the plans parallelizable without synchronization overhead and made the test robust to 54-03's internal changes. Plan 54-03 landed mid-execution (commit `90ef3c2` between my Task 1 and Task 2 commits), and my test stayed green because it never touched that file.
- **Added a 9th test case beyond the plan's 7/8.** The plan listed 7-8 tests; I added one more that explicitly runs two back-to-back ticks at the same `nowMs` and asserts exactly one orchestrator call. This directly proves the success_criteria `Dedup guard verified: two consecutive cron ticks within same day → exactly one post` — not inferable from the 8-test set where each test ran a single tick. Low-cost insurance given the test file's structure.
- **Kept `index.ts` change strictly additive: two imports + one init block.** No reformatting, no surrounding edits, no log-message tweaks — mirrors the adjacent `initArchiveTripsCron()` lines 1:1 so future readers see the pattern as repeatable.
- **Placed `initBriefingCron()` after `initArchiveTripsCron()` and before `startSocket()`.** Plan spec location. Rationale: crons don't need a live WhatsApp socket to tick (the orchestrator handles the "no sock" case via its own logic when real traffic flows), and keeping all crons in a contiguous block makes the startup path scannable.
- **Did not modify `runBriefingCheckOnce`'s DI seam.** It was designed exactly for this case in Plan 01 — optional orchestrator param with `defaultOrchestrator` as the fallback. Zero friction.

## Deviations from Plan

**None.** Plan executed exactly as written, with one additive enhancement (9th test case) documented under Decisions Made.

## Authentication Gates

**None.** No external APIs hit — all calls mocked at the module boundary (`vi.mock('../../db/client.js')`, `vi.mock('../../config.js')`, `vi.mock('../../ai/provider.js')`, orchestrator via DI). `OPENWEATHER_API_KEY` is not required for this plan; it's the live-enrichment gate which the orchestrator handles internally.

## Issues Encountered

None. Both tasks compiled + tested clean on first run.

## Self-Check

Verified on disk:
- `src/cron/__tests__/briefingCron.integration.test.ts` — FOUND (219 lines)
- `src/index.ts` line 34 — `import { initBriefingCron } from './cron/briefingCron.js';` present
- `src/index.ts` lines 72-73 — `initBriefingCron();` + logger.info present, after `initArchiveTripsCron();` (lines 69-70)
- Commit `e0777b5` (`feat(54-04): wire initBriefingCron into main()`) — FOUND in `git log --oneline -10`
- Commit `475aefe` (`test(54-04): integration test for runBriefingCheckOnce with dedup guard`) — FOUND in `git log --oneline -10`
- `npx tsc --noEmit` — clean (only the 2 pre-existing `cli/*.ts` rootDir warnings from baseline)
- `npx vitest run src/cron/__tests__/briefingCron.integration.test.ts` — 9/9 pass (both pre-54-03-land and post-54-03-land)
- `npx vitest run` — 558 pass / 6 fail / 7 skip; 6 failures = same Phase-51-deferred set as 54-01 baseline (0 regressions)

## Self-Check: PASSED

## Next Phase Readiness

**Phase 54 is now functionally complete.** All four plans (01-04) have shipped:
- 54-01: foundations (schema, OpenWeather client, cron skeleton, DI seam)
- 54-02: Gemini grounded search wrapper
- 54-03: dayOfBriefing orchestrator (landed in parallel with this plan)
- 54-04: wiring + integration test (this plan)

To exercise the live path end-to-end: restart the bot. The cron will register at boot and tick every 15 minutes. For each active trip whose destination-tz local time is within ±7min of its `briefing_time` and whose `today ∈ [start_date − 1, end_date]` and whose `metadata.last_briefing_date ≠ today`, the orchestrator will fire, compose a Hebrew briefing from the 6-source cascade (calendar, weather, transit alerts, open items, conflicting decisions, budget rollup), post it to the group, and persist `last_briefing_date` to prevent a same-day duplicate.

Phase-55 candidates (deferred per 54-CONTEXT.md): multi-currency budget normalization, SMS/push fallback if WhatsApp send fails, retrying failed briefings after transient errors.

---
*Phase: 54-proactive-day-of-intelligence*
*Plan: 04*
*Completed: 2026-04-24*
