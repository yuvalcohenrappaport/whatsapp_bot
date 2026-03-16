---
phase: 25-commitment-detection
plan: 01
subsystem: ai
tags: [gemini, commitment-detection, pre-filter, hebrew, nlp, zod]

# Dependency graph
requires:
  - phase: 22-personal-calendar
    provides: CalendarDetectionService pattern (singleton + generateJson)
  - phase: 24-smart-reminders
    provides: Reminders table and insertReminder query
provides:
  - CommitmentDetectionService with JS pre-filter and Gemini extraction
  - DB migration for source tracking on reminders (source, source_contact_jid)
  - Updated insertReminder accepting source fields
affects: [25-commitment-detection plan 02, 25-commitment-detection plan 03]

# Tech tracking
tech-stack:
  added: []
  patterns: [commitment pre-filter with bilingual regex, non-word-boundary Hebrew patterns]

key-files:
  created:
    - src/commitments/CommitmentDetectionService.ts
    - src/commitments/__tests__/CommitmentDetectionService.test.ts
    - drizzle/0016_commitment_source.sql
  modified:
    - src/db/schema.ts
    - src/db/queries/reminders.ts

key-decisions:
  - "Hebrew regex uses non-word-boundary patterns (\\b fails with Unicode/Hebrew chars)"
  - "Medium + high confidence included for commitments (unlike calendar which is high-only)"

patterns-established:
  - "Bilingual pre-filter: avoid \\b word boundaries for Hebrew text, use bare pattern matching"

requirements-completed: [REM-02]

# Metrics
duration: 3min
completed: 2026-03-16
---

# Phase 25 Plan 01: Commitment Detection Service Summary

**CommitmentDetectionService with bilingual pre-filter (action verbs + temporal markers) and Gemini structured extraction for commitment tracking**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-16T14:01:58Z
- **Completed:** 2026-03-16T14:05:01Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- DB migration adding source and source_contact_jid to reminders table for commitment tracking
- CommitmentDetectionService with cheap JS pre-filter gating Gemini API calls
- Pre-filter checks both Hebrew and English action verbs and temporal markers on every message
- 13 unit tests covering pre-filter edge cases and Gemini extraction scenarios

## Task Commits

Each task was committed atomically:

1. **Task 1: DB migration and schema update for commitment source tracking** - `61ef67b` (feat)
2. **Task 2: CommitmentDetectionService with pre-filter and Gemini extraction** - `e3e7e9c` (feat)

## Files Created/Modified
- `drizzle/0016_commitment_source.sql` - Migration adding source and source_contact_jid columns
- `src/db/schema.ts` - Updated reminders table with source tracking columns
- `src/db/queries/reminders.ts` - Expanded insertReminder to accept source fields
- `src/commitments/CommitmentDetectionService.ts` - Core detection service with pre-filter and Gemini extraction
- `src/commitments/__tests__/CommitmentDetectionService.test.ts` - 13 unit tests for pre-filter and extraction

## Decisions Made
- Hebrew regex patterns use non-word-boundary matching because JS `\b` doesn't work with Hebrew Unicode characters
- Medium + high confidence commitments are included (unlike calendar detection which filters to high-only)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Hebrew regex word boundary matching**
- **Found during:** Task 2 (CommitmentDetectionService implementation)
- **Issue:** Plan specified `\b` word boundaries for Hebrew patterns, but JS `\b` only works with ASCII word characters -- Hebrew text never matched
- **Fix:** Removed `\b` from Hebrew regex patterns, using bare pattern matching instead
- **Files modified:** src/commitments/CommitmentDetectionService.ts
- **Verification:** Hebrew pre-filter tests pass (2 tests that were failing now pass)
- **Committed in:** e3e7e9c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for Hebrew language support. No scope creep.

## Issues Encountered
- Reminders table (migration 0015) was not yet applied to local DB -- applied both 0015 and 0016 together

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CommitmentDetectionService ready for integration into message pipeline (Plan 02)
- Source tracking columns available for commitment-originated reminders

---
*Phase: 25-commitment-detection*
*Completed: 2026-03-16*
