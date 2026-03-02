---
phase: 17-pipeline-audit
plan: 02
subsystem: groups
tags: [calendar, date-extraction, reply-to-delete, fromMe-guard, pipeline-reorder, test-script]

# Dependency graph
requires:
  - phase: 09-travel-search
    provides: "groupMessagePipeline.ts, calendarService.ts, dateExtractor.ts"
  - plan: 17-01
    provides: "scripts/test-pipeline.ts with travel mode and calendar stub"
provides:
  - "Fixed fromMe guard: owner can reply-to-delete calendar events"
  - "Invalid date validation in dateExtractor.ts (NaN filter)"
  - "Calendar test mode in scripts/test-pipeline.ts"
affects: [19-suggest-then-confirm, 18-history-search]

# Tech tracking
tech-stack:
  added: []
  patterns: ["pipeline guard reorder for selective fromMe bypass", "NaN date filter with warning log after Gemini extraction"]

key-files:
  created: []
  modified:
    - src/groups/groupMessagePipeline.ts
    - src/groups/dateExtractor.ts
    - scripts/test-pipeline.ts

key-decisions:
  - "Reorder pipeline so handleReplyToDelete runs before fromMe guard -- structural fix that persists through Phases 18-19"
  - "Minimal NaN date patch in dateExtractor.ts since Phase 19 rewrites the extraction flow"
  - "Calendar round-trip test gated on TEST_CALENDAR_ID env var to keep CI-free runs fast"

patterns-established:
  - "Pipeline guard reorder pattern: move self-contained handlers before fromMe guard, keep content-generating handlers (keyword rules, date extraction) after it"

requirements-completed: [AUDIT-02]

# Metrics
duration: 4min
completed: 2026-03-02
---

# Phase 17 Plan 02: Pipeline Audit - Calendar Extraction Summary

**Fixed fromMe guard for owner reply-to-delete, added NaN date validation, and calendar test mode for date extraction and event round-trip verification**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-02T15:40:06Z
- **Completed:** 2026-03-02T15:44:21Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Fixed the fromMe guard so the bot owner can delete calendar events by replying to confirmation messages
- Added NaN date validation to prevent broken calendar events from malformed Gemini output
- Built calendar test mode: 3 date extraction tests + optional calendar create/delete round-trip

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix fromMe guard -- allow owner reply-to-delete** - `8c31435` (fix)
2. **Task 2: Add invalid date validation to dateExtractor** - `459f387` (fix)
3. **Task 3: Add calendar tests to pipeline test script** - `6830bc9` (feat)

## Files Modified
- `src/groups/groupMessagePipeline.ts` - Moved handleReplyToDelete before the fromMe guard in the pipeline callback
- `src/groups/dateExtractor.ts` - Added NaN date filter after new Date() construction with warning log
- `scripts/test-pipeline.ts` - Replaced calendar stub with full test mode: Hebrew/English date extraction, no-date pre-filter, calendar round-trip

## Decisions Made
- **Pipeline reorder is a proper fix:** The fromMe guard reorder is structural and will persist through Phases 18-19. Both phases add new steps AFTER the fromMe guard, so this does not conflict.
- **Date validation is a minimal patch:** Phase 19 will modify dateExtractor.ts for suggest-then-confirm flow. The NaN guard is small and composable.
- **Calendar round-trip gated on env var:** The test script runs date extraction tests always (no auth needed), and only attempts calendar API calls if TEST_CALENDAR_ID is set.

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

**Calendar test mode (`npx tsx scripts/test-pipeline.ts calendar`):**
- Test A (Hebrew date): PASS - extracted 1 date, title valid, date valid
- Test B (English date): PASS - extracted 1 date, title valid, date valid
- Test C (no date): PASS - preFilter=false, 0 dates extracted
- Test D (NaN guard): PASS - informational, validated indirectly
- Calendar round-trip: SKIP (TEST_CALENDAR_ID not set)

**All mode (`npx tsx scripts/test-pipeline.ts all`):** 10/10 checks passed (travel + calendar)

## Issues Encountered
- Pre-existing TypeScript config issue: `cli/bot.ts` is included in tsconfig but outside `rootDir`. Not caused by this plan. Out of scope.

## User Setup Required

None - no external service configuration required. Calendar round-trip test can be run later by setting `TEST_CALENDAR_ID` env var.

## Next Phase Readiness
- Phase 17 complete: both travel search and calendar extraction audited and fixed
- Pipeline order verified: travelMention -> replyToDelete -> fromMe guard -> keywordRules -> debounce
- Date validation in place before Phase 19 modifies dateExtractor.ts
- Test script covers both subsystems and can be reused for regression

## Self-Check: PASSED

- All 3 modified files exist on disk
- All 3 task commits found in git log (8c31435, 459f387, 6830bc9)
- Pipeline reorder confirmed in groupMessagePipeline.ts (lines 410-416)
- NaN guard confirmed in dateExtractor.ts (lines 107-113)

---
*Phase: 17-pipeline-audit*
*Completed: 2026-03-02*
