---
phase: 21-travel-intelligence
plan: 01
subsystem: groups
tags: [trip-memory, weekly-digest, classifier, zod, gemini]

# Dependency graph
requires:
  - phase: 18-trip-memory
    provides: tripDecisions table with open_question type, getUnresolvedOpenItems/resolveOpenItem queries
provides:
  - buildTripStatusSection helper in reminderScheduler for Hebrew trip status digest section
  - resolvedQuestions classifier field and auto-resolution logic in tripContextManager
affects: [21-02-PLAN, weekly-digest, trip-context-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Append deterministic sections after Gemini output rather than injecting into prompt"
    - "Fuzzy match resolved questions using 30-char prefix substring"

key-files:
  created: []
  modified:
    - src/groups/reminderScheduler.ts
    - src/groups/tripContextManager.ts

key-decisions:
  - "Trip status section appended after Gemini digest output (not injected into prompt)"
  - "30-day expiry silently excludes stale open items from digest"
  - "Hebrew age labels with correct pluralization (היום, לפני יום, לפני N ימים)"
  - "Fuzzy resolution matching uses 30-char prefix slice for LLM tolerance"

patterns-established:
  - "Digest post-processing: append structured sections after AI generation"
  - "Classifier schema extension: add fields to Zod schema, auto-regenerates JSON schema"

requirements-completed: [MEM-04, INTL-02]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 21 Plan 01: Open Item Lifecycle Summary

**Hebrew trip status section in weekly digest with 30-day expiry and auto-resolution via classifier schema extension**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T18:33:05Z
- **Completed:** 2026-03-02T18:36:24Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Weekly digest appends Hebrew trip status section with open questions and age indicators when unresolved items exist
- No section appears when a group has zero qualifying open items (no empty placeholder)
- Trip context classifier schema extended with `resolvedQuestions` field for auto-resolution detection
- Resolution logic in `processTripContext` fuzzy-matches LLM output to tracked open items and marks them resolved

## Task Commits

Each task was committed atomically:

1. **Task 1: Add trip status section to weekly digest** - `c728961` (feat)
2. **Task 2: Add auto-resolution to trip context classifier** - `0942ea9` (feat)

## Files Created/Modified
- `src/groups/reminderScheduler.ts` - Added buildTripStatusSection helper, import getUnresolvedOpenItems, integrated into generateWeeklyDigest return
- `src/groups/tripContextManager.ts` - Added resolvedQuestions to Zod schema, extended buildClassifierPrompt with open items parameter, added resolution logic in processTripContext

## Decisions Made
- Trip status section appended after Gemini digest output (not injected into Gemini prompt) -- keeps deterministic formatting separate from AI generation
- 30-day expiry filter silently excludes stale open items -- prevents noise from abandoned questions
- Hebrew age labels always in Hebrew regardless of group language -- per locked project decision
- Fuzzy resolution matching uses 30-char lowercase prefix slice -- tolerates LLM paraphrasing while preventing false positives
- Question text truncated to 80 chars (77 + "...") for WhatsApp readability

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript errors in src/voice/ files and cli/bot.ts rootDir config -- not related to this plan, ignored (out of scope)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Open item lifecycle complete: surfacing in digest and auto-resolution in classifier
- Ready for Phase 21 Plan 02 (proactive trip intelligence features)
- No new packages, no new migrations, no API changes

---
*Phase: 21-travel-intelligence*
*Completed: 2026-03-02*
