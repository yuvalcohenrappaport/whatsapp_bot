---
phase: 51-richer-trip-memory
plan: 04
subsystem: groups
tags: [conflict-detection, trip-memory, travel-agent-v2.1, hebrew-alerts]

# Dependency graph
requires:
  - phase: 51-richer-trip-memory
    plan: 01
    provides: trip_decisions v2.1 schema (conflicts_with JSON array, metadata JSON blob, origin enum) + updateDecisionConflicts helper + getDecisionsByGroup (non-archived default)
provides:
  - src/groups/conflictDetector.ts (runAfterInsert + analyzeConflict + classifyConflict + parseDecision)
  - Hard-conflict Hebrew alert copy (💬 prefix, single line, discreet, truncate at 40 chars)
  - Post-insert hook call-sites in tripContextManager.processTripContext and tripPreferences.handlePref
affects: [51-05-auto-archive-cron, 54-day-of-briefing, 55-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conflict detection runs AFTER every insertTripDecision as a fire-and-forget Promise (unawaited, .catch(()=>{}))"
    - "Idempotence via conflicts_with membership check — second run on same pair is a no-op"
    - "Haversine distance for transit-based soft conflicts — pure function, no external lib"
    - "Confidence categorical→numeric mapping (high=1.0, medium=0.7, low=0.4) to apply ≥0.9 threshold from the spec"

key-files:
  created:
    - src/groups/conflictDetector.ts
    - src/groups/__tests__/conflictDetector.test.ts
  modified:
    - src/groups/tripContextManager.ts (import + hook fire after classifier-inserted decision)
    - src/groups/tripPreferences.ts (import + hook fire after !pref self-reported decision)

key-decisions:
  - "Categorical→numeric confidence mapping (high=1.0, medium=0.7, low=0.4) to enforce the spec's ≥0.9 hard-conflict threshold without changing the DB enum."
  - "Decision-date-within-7d check uses metadata.event_date_ms if present, else falls back to createdAt. This means a decision logged today about a trip 10 days out won't hard-alert (correct behavior — nobody cares about far-future overlaps right now)."
  - "Alert copy is Hebrew-only with a 💬 prefix + single line + 40-char truncation. Deliberately no 'אזהרה' / exclamation / call-to-action — fits CONTEXT.md §Conflict detector §Hard conflict's 'discreet' rubric."
  - "runAfterInsert is never awaited by callers — fired as Promise.catch(()=>{}) so classifier persistence loops and !pref handlers stay on their hot path."
  - "Soft-conflict branch silently records via updateDecisionConflicts on BOTH sides; Phase 54 day-of briefing is the surface that reads the graph."

patterns-established:
  - "Conflict detector lives in its own module — tripContextManager and tripPreferences just fire the hook; detector owns the DB read, classification, and Hebrew copy."
  - "In-memory mirror of the just-updated conflictsWith array (newer.conflictsWith = newerUpdated) so subsequent loop iterations within the same runAfterInsert call see the update before the DB round-trip completes."

requirements-completed: [MEM2-03]

# Metrics
duration: 10min
completed: 2026-04-23
---

# Phase 51 Plan 04: Post-insert Conflict Detector Summary

**Hard/soft conflict detector fires after every inserted trip_decision — hard conflicts (time overlap + both high-confidence + within 7 days) post a single discreet 💬 Hebrew alert; soft conflicts (gap < 30 min or transit > 20 km) record `conflicts_with` silently on both sides; MEM2-03 end-to-end.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-23T20:02:03Z
- **Completed:** 2026-04-23T20:11:44Z
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 2

## Accomplishments
- `src/groups/conflictDetector.ts` ships three primitives + one entry point:
  - `parseDecision(row)` — lifts metadata JSON + conflicts_with JSON into typed fields (start_time_ms, end_time_ms, lat, lng, event_date_ms).
  - `analyzeConflict(a, b)` — pure math: timeOverlapMinutes, gapMinutes (Infinity when both sides lack times), transitDistanceKm (haversine).
  - `classifyConflict(newer, older, nowMs, analysis)` — returns `'hard' | 'soft' | 'none'` per the LOCKED criteria in CONTEXT.md §Conflict detector.
  - `runAfterInsert(groupJid, newDecisionId)` — the one function callers invoke. Compares the newly-inserted decision against every other non-archived decision for the group; writes conflicts_with on both sides for hard+soft; posts the 💬 alert on hard. Never throws.
- **Hebrew alert shape** — `💬 שתי החלטות חופפות בזמן (N דק'): "A" ↔ "B"`. Regex-asserted in tests via `/^💬 שתי החלטות חופפות/`. Values truncated at 40 chars with ellipsis so long venue names never wrap to multiple screens.
- **Idempotence** — second run on the same pair short-circuits on `newer.conflictsWith.includes(older.id)` — no double write, no double alert. Verified in tests.
- **Fire-and-forget** — `runAfterInsert(...)` is invoked as `runAfterInsert(groupJid, id).catch(() => {})` from both call-sites; the detector itself also wraps its entire body in try/catch and logs errors. The classifier persistence loop and `!pref` handler keep their hot path clear.
- **Wiring** — two call-sites added:
  - `tripContextManager.ts` §processTripContext §Section 6 — fires after every non-low-confidence classifier-inserted decision. Skipped for open_question inserts (not time-bound) and skipped for budget/dates upserts (those touch trip_contexts, not trip_decisions).
  - `tripPreferences.ts` §handlePref — fires after the `origin='self_reported'` decision insert. `!budget` and `!dates` do NOT fire the detector (they write to trip_contexts, not trip_decisions).
- **12/12 vitest cases green** in `conflictDetector.test.ts` (~500ms): classifier primitives (hard/none/soft-gap/soft-transit/none-empty/far-future), integration runs (hard→alert+both sides updated, soft-gap→silent update, soft-transit→silent update, none→no writes, idempotence, missing-id→no-throw).
- **Regression guard** — 32/32 green combined with the 20 existing `tripPreferences.test.ts` cases; 4/4 green `tripClassifier.test.ts` when run after the 51-02 GREEN work landed; `npx tsc --noEmit` clean except the pre-existing cli/ rootDir noise documented in 51-01's deferred-items.md.

## Task Commits

1. **Task 1: Implement conflictDetector core + 12 vitest cases** — `87f585e` (feat)
2. **Task 2: Wire runAfterInsert into tripContextManager + tripPreferences** — consolidated into `403b130` by the parallel 51-03 closeout (see "Deviations from Plan" below for the Wave-2 integration story).

## Files Created/Modified
- `src/groups/conflictDetector.ts` — 240 lines: parseDecision + analyzeConflict + classifyConflict + runAfterInsert + sendHardConflictAlert + haversineKm (created)
- `src/groups/__tests__/conflictDetector.test.ts` — 303 lines: 12 vitest cases against in-memory SQLite with all migrations replayed + mocked getState().sock.sendMessage (created)
- `src/groups/tripContextManager.ts` — +6/-1: import runAfterInsert + capture decisionId + fire-and-forget after classifier-inserted decision (modified, wiring landed via 403b130)
- `src/groups/tripPreferences.ts` — +8/-1: import runAfterInsert + capture decisionId + fire-and-forget after !pref insertTripDecision (modified, wiring landed via 403b130)

## Decisions Made
- **Confidence numeric mapping:** the CONTEXT.md §Conflict detector §Hard conflict threshold is `confidence >= 0.9`, but our `trip_decisions.confidence` column is categorical (`high | medium | low`). Mapped `high=1.0, medium=0.7, low=0.4` so only `high` crosses the 0.9 bar. This keeps the spec text intact without a schema change.
- **event_date_ms fallback to createdAt:** the spec says "decision date within 7 days of now". When metadata.event_date_ms is absent (most inserts today — multimodal is Phase 52), we fall back to createdAt. A decision logged <7 days ago is a reasonable proxy for "recent trip activity".
- **Alert copy in Hebrew only:** bot language is Hebrew throughout per the milestone design doc; CONTEXT.md §Conflict detector pinned the 💬 prefix and single-line discretion. Truncation at 40 chars keeps the alert on one screen even on small phones.
- **Hook NOT called from open_question inserts:** open questions aren't time-bound, so they can't time-overlap anything. Skipping keeps the detector focused on the actual decision graph.
- **Hook NOT called from `!budget` or `!dates`:** those commands write to `trip_contexts`, not `trip_decisions`. The detector only operates on decisions.

## Deviations from Plan

### Wave-2 parallel coordination

**[Rule 3 - Blocking] Task 2 wiring was consolidated into `403b130` by the parallel 51-03 closeout**

- **Found during:** Task 2 staging
- **Context:** Plans 51-02, 51-03, and 51-04 ran as a Wave-2 parallel batch against the shared files `src/groups/tripContextManager.ts` and `src/groups/tripPreferences.ts`. At the time I began Task 2, 51-02's GREEN work was uncommitted in the working tree and 51-03 had just committed `tripPreferences.ts` (creation) without the detector wiring.
- **Issue:** Staging `src/groups/tripContextManager.ts` would have dragged 51-02's uncommitted classifier additions (exported TripClassifierSchema + new structured fields + classifyBatch helper + processTripContext export) into my commit, attributing another plan's work to 51-04.
- **Fix path:** Reset the file to HEAD, applied only my two hunks via `git apply --cached`, verified `git diff --cached` contained only my 5 inserted lines. Before I could commit, the 51-03 closeout agent picked up the staged + working-tree state and committed the wiring itself in `403b130` with an explicit acknowledgement ("Pre-staged by sibling Plan 51-04 conflict-detector work") and matching the exact hunks I'd prepared.
- **Net effect:** The runAfterInsert wiring is in HEAD under commit `403b130` (verified: `grep -c runAfterInsert src/groups/tripContextManager.ts` = 2, `src/groups/tripPreferences.ts` = 3). No double-wiring, no conflicting edits. The detector fires from both call-sites as the plan specified.
- **Files modified:** `src/groups/tripContextManager.ts`, `src/groups/tripPreferences.ts`.
- **Committed in:** `403b130` (by 51-03 closeout; attribution acknowledged in that commit message).

### Auto-fixed Issues

None — no Rule-1 bugs or Rule-2 missing critical functionality discovered during execution.

---

**Total deviations:** 1 Wave-2 coordination (Rule-3 Blocking, resolved by parallel-agent cooperation)
**Impact on plan:** Zero scope drift. Both call-sites wired exactly as the PLAN specified. Git history carries the wiring under a neighbouring plan's commit but the functional outcome is identical.

## Issues Encountered
- 51-02's classifier upgrade was uncommitted during my execution window (only its RED test commit had landed). This forced the surgical-patch approach described above for Task 2. Both plans' changes now coexist cleanly in HEAD.
- Pre-existing vitest failures in `CommitmentDetectionService.test.ts` (4) and `actionables/detectionService.test.ts` (2) continue to reproduce on the branch HEAD — unchanged by this plan, already logged to `.planning/phases/51-richer-trip-memory/deferred-items.md` by 51-01.
- Pre-existing `tsc` rootDir noise on `cli/bot.ts` + `cli/commands/persona.ts` — unchanged, already logged.

## User Setup Required

None — pure in-process detector; no external service, secret, or config change.

## Next Phase Readiness

- **Plan 51-05 (auto-archive cron) unblocked:** the detector writes `conflicts_with` on ACTIVE decisions; archive flow already skips archived decisions via the boolean `archived` flag (51-01). No interaction.
- **Phase 54 day-of briefing consumes the graph:** `trip_decisions.conflicts_with` is now reliably populated on both sides whenever a soft conflict is detected. Day-of briefing reads the graph and surfaces soft conflicts that didn't trigger a real-time alert.
- **Phase 55 dashboard surface:** the soft-conflict record is the raw material for a "potential issues" chip on each decision card. No additional schema needed.
- **Multimodal (Phase 52) will enrich the signal:** once multimodal populates `metadata.start_time_ms` / `end_time_ms` / `lat` / `lng`, more inserted decisions will hit the hard/soft paths. The detector already reads those fields today — Phase 52 just fills them in.

## Self-Check

- `src/groups/conflictDetector.ts` — FOUND
- `src/groups/__tests__/conflictDetector.test.ts` — FOUND (12 cases green)
- `src/groups/tripContextManager.ts` imports runAfterInsert — FOUND (`grep -c runAfterInsert` = 2)
- `src/groups/tripPreferences.ts` imports runAfterInsert — FOUND (`grep -c runAfterInsert` = 3)
- Commit `87f585e` (Task 1, feat 51-04) — FOUND in `git log`
- Commit `403b130` (Task 2 wiring, landed via 51-03 closeout) — FOUND in `git log`
- `npx tsc --noEmit` — CLEAN (only pre-existing cli/ rootDir noise)
- `npm test -- src/groups/__tests__/conflictDetector.test.ts` — 12/12 GREEN

## Self-Check: PASSED

---
*Phase: 51-richer-trip-memory*
*Completed: 2026-04-23*
