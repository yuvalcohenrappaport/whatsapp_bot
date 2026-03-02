---
phase: 18-trip-memory
plan: 02
subsystem: groups
tags: [zod, gemini, sqlite, debounce, pre-filter, trip-memory]

# Dependency graph
requires:
  - phase: 18-01
    provides: tripContexts and tripDecisions tables with 7 query functions in tripMemory.ts
provides:
  - hasTravelSignal() pure pre-filter that rejects non-travel messages before any Gemini call
  - addToTripContextDebounce() batching with independent 10s debounce buffer
  - Gemini classifier that extracts decisions, open questions, and context summary from message batches
  - Persistence of high/medium confidence decisions to tripDecisions; open questions as 'open_question' type
  - Trip context upsert per group after each classifier run
  - Pipeline integration at step [3.5] between keyword rules and calendar debounce
affects: [18-03, 19-itinerary-builder, 21-travel-intelligence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Trip context debounce buffer as independent Map in tripContextManager.ts (separate from calendar debounce)
    - Pre-filter runs before buffer add — rejected messages never enter debounce at all
    - Zod v4 z.toJSONSchema() for Gemini responseSchema (not zod-to-json-schema)
    - Fire-and-forget debounce callback wraps entire processTripContext in try/catch

key-files:
  created:
    - src/groups/tripContextManager.ts
  modified:
    - src/groups/groupMessagePipeline.ts

key-decisions:
  - "Pre-filter (hasTravelSignal) executes synchronously before the debounce buffer add — non-travel messages never allocate buffer state"
  - "Trip debounce buffer is a module-level Map in tripContextManager.ts, completely isolated from the calendar debounce in groupMessagePipeline.ts"
  - "Low-confidence decisions from classifier are silently dropped; only high and medium confidence are inserted to tripDecisions"

patterns-established:
  - "New pipeline steps: add inside existing setGroupMessageCallback callback in groupMessagePipeline.ts, never call setGroupMessageCallback() from a new module"
  - "Trip context accumulator pattern: pre-filter -> debounce buffer -> processTripContext (classifier + DB write)"

requirements-completed: [MEM-01, MEM-03]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 18 Plan 02: Trip Context Accumulator Summary

**Always-listening trip context accumulator with JavaScript pre-filter, independent 10s debounce, and Gemini classifier that persists decisions and open questions to SQLite**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-02T16:12:17Z
- **Completed:** 2026-03-02T16:15:06Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `src/groups/tripContextManager.ts` with all five sections: pre-filter, debounce buffer, Zod v4 classifier schema, prompt builder with deduplication context, and async processTripContext with full error handling
- `hasTravelSignal()` filters non-travel messages cheaply in JavaScript before any Gemini API call is made (pre-empts cost explosion)
- Gemini classifier uses Zod v4 `z.toJSONSchema()` to generate responseSchema; persists high/medium decisions, skips low; open questions stored as 'open_question' type
- Wired `addToTripContextDebounce` into `groupMessagePipeline.ts` at step [3.5], between `handleKeywordRules` and `addToDebounce`, with a comment explaining it is non-terminal

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tripContextManager.ts with pre-filter, debounce, and classifier** - `046db8d` (feat)
2. **Task 2: Wire trip context accumulator into groupMessagePipeline.ts at step [3.5]** - `a02df72` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/groups/tripContextManager.ts` - New module: hasTravelSignal pre-filter, addToTripContextDebounce with independent debounce buffer, TripClassifierSchema (Zod v4), buildClassifierPrompt with dedup context, processTripContext fire-and-forget async handler
- `src/groups/groupMessagePipeline.ts` - Added import for addToTripContextDebounce; added non-terminal call at step [3.5] between keyword rules and calendar debounce

## Decisions Made
- Pre-filter runs before the debounce buffer add, not inside the debounce flush handler. This prevents buffer allocation for non-travel messages entirely, which is the critical cost-control guard documented in 18-RESEARCH.md (Pitfall 3).
- Low-confidence classifier decisions are dropped at persistence time. The classifier can assign 'low' when uncertain; the insertion loop checks `confidence !== 'low'` before calling insertTripDecision.
- Classifier prompt includes existing decisions and context summary so Gemini can avoid extracting duplicate decisions semantically (belt-and-suspenders with DB append-only insert).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
Pre-existing TypeScript error in `cli/bot.ts` (outside rootDir) — confirmed pre-existing before this plan, out of scope per deviation rules.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- tripContextManager.ts is live in the pipeline; every group message now passes through hasTravelSignal pre-filter
- Travel-signal messages accumulate in per-group debounce buffer and are classified by Gemini after 10s silence
- Classifier output is persisted to tripContexts (per-group summary) and tripDecisions (append-only decisions + open_question)
- Phase 18-03 (history_search handler) can read from tripDecisions and FTS5 via the query functions already in tripMemory.ts
- Phase 19 (itinerary builder) can call getTripContext(groupJid) for destination and dates context
- Phase 21 (travel intelligence) can call getUnresolvedOpenItems(groupJid) for digest and proactive triggers

## Self-Check: PASSED

Files verified present:
- FOUND: src/groups/tripContextManager.ts
- FOUND: src/groups/groupMessagePipeline.ts (modified)

Commits verified present:
- FOUND: 046db8d (feat: tripContextManager with pre-filter, debounce, classifier)
- FOUND: a02df72 (feat: pipeline integration at step [3.5])

---
*Phase: 18-trip-memory*
*Completed: 2026-03-02*
