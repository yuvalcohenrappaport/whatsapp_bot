---
phase: 22-calendar-detection-refactor
plan: 01
subsystem: calendar-detection
tags: [refactor, calendar, testing, circular-dependency]
dependency_graph:
  requires: []
  provides: [CalendarDetectionService, calendarHelpers, vitest-infrastructure]
  affects: [groupMessagePipeline, suggestionTracker]
tech_stack:
  added: [vitest]
  patterns: [class-based-service, singleton-export, shared-helpers]
key_files:
  created:
    - src/calendar/CalendarDetectionService.ts
    - src/groups/calendarHelpers.ts
    - src/calendar/__tests__/CalendarDetectionService.test.ts
    - vitest.config.ts
  modified:
    - src/groups/groupMessagePipeline.ts
    - src/groups/suggestionTracker.ts
    - package.json
  deleted:
    - src/groups/dateExtractor.ts
decisions:
  - Class-based CalendarDetectionService with DetectionContext for pipeline-agnostic detection
  - vitest chosen over jest for native ESM TypeScript support
  - Singleton export pattern for easy consumption across pipelines
metrics:
  duration: 265s
  completed: 2026-03-16
---

# Phase 22 Plan 01: Extract CalendarDetectionService Summary

**One-liner:** Extracted date detection into shared CalendarDetectionService class with DetectionContext, broke circular dependency via calendarHelpers, added vitest unit tests.

## What Was Done

### Task 1: Extract shared helpers and create CalendarDetectionService
- Created `src/calendar/CalendarDetectionService.ts` with `hasDateSignal()` and `extractDates(text, DetectionContext)` methods
- Moved `getCalendarIdFromLink`, `formatDateForDisplay`, `detectGroupLanguage`, and `buildConfirmationText` to `src/groups/calendarHelpers.ts`
- Service uses `DetectionContext` with `chatType` field making it callable from any pipeline
- System prompt changed from "group messages" to "WhatsApp messages" for pipeline-agnostic usage
- Exported singleton `calendarDetection` instance and types `ExtractedDate`, `DetectionContext`
- **Commit:** 454de6a

### Task 2: Rewire imports, delete dateExtractor
- Updated `groupMessagePipeline.ts` to use `calendarDetection.hasDateSignal()` and `calendarDetection.extractDates()` with `DetectionContext`
- Updated `suggestionTracker.ts` to import from `calendarHelpers.ts` instead of `groupMessagePipeline.ts` -- breaks circular dependency
- Deleted `src/groups/dateExtractor.ts` -- all logic now in CalendarDetectionService
- Verified zero remaining references to dateExtractor, zero imports from groupMessagePipeline in suggestionTracker
- Bot starts cleanly (all modules resolve, only fails on EADDRINUSE from existing instance)
- **Commit:** 830c8f9

### Task 3: Unit tests for CalendarDetectionService
- Installed vitest as dev dependency, created `vitest.config.ts` for ESM TypeScript
- Updated `package.json` test script from placeholder to `vitest run`
- Created `src/calendar/__tests__/CalendarDetectionService.test.ts` with 10 test cases:
  - hasDateSignal: digits, no digits, Hebrew with digits, edge cases (4 tests)
  - extractDates: high-confidence, confidence filtering, null response, error handling, invalid dates, optional fields (6 tests)
- All tests pass, mocking Gemini's `generateJson` and config
- **Commit:** 5514dbc

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

1. `npx tsc --noEmit` -- compiles cleanly (only pre-existing TS6059 for cli/bot.ts rootDir)
2. No imports from `dateExtractor` remain in codebase
3. No imports from `groupMessagePipeline` in `suggestionTracker.ts` -- circular dep broken
4. Bot starts without import errors (EADDRINUSE from existing instance, not a code issue)
5. CalendarDetectionService importable with singleton, types, and class exports
6. `npx vitest run` -- all 10 tests pass (283ms)

## Self-Check: PASSED

All files exist, dateExtractor.ts confirmed deleted, all 3 commit hashes verified.
