---
phase: 38-new-lesson-run-form
plan: 02
subsystem: ui
tags: [react, shadcn-ui, radix-ui, radio-group, sheet, form, localStorage, sonner]

# Dependency graph
requires:
  - phase: 38-new-lesson-run-form
    provides: GET /api/linkedin/projects proxy, POST /api/linkedin/lesson-runs/generate proxy
  - phase: 37-lesson-mode-ux
    provides: PENDING_LESSON_SELECTION status handling, PendingActionEntryButton, queue integration
provides:
  - "NewLessonRunSheet slide-out form component with project dropdown, perspective/language radios, topic hint"
  - "useLinkedInProjects hook for fetching project list from API"
  - "useLinkedInStartLessonRun hook with discriminated result (started/busy/not_found/error)"
  - "RadioGroup shadcn/ui primitive using radix-ui monorepo"
  - "'New Lesson Run' button in queue page header"
  - "3-minute pending-run timeout warning banner"
  - "localStorage persistence for form defaults"
affects: [38-03-new-lesson-run-form-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Slide-out sheet form pattern: sheet from queue page, controlled open state, parent owns toast + redirect"
    - "localStorage form persistence: save on submit, restore on mount, selective field reset"
    - "Discriminated mutation result: kind-based switch for status code discrimination without apiFetch"

key-files:
  created:
    - "dashboard/src/components/ui/radio-group.tsx -- shadcn/ui RadioGroup + RadioGroupItem"
    - "dashboard/src/hooks/useLinkedInProjects.ts -- fetches project list on mount"
    - "dashboard/src/hooks/useLinkedInStartLessonRun.ts -- POST generate with result discrimination"
    - "dashboard/src/components/linkedin/NewLessonRunSheet.tsx -- slide-out form with all 4 fields + validation + submit + retry"
  modified:
    - "dashboard/src/components/linkedin/index.ts -- barrel export for NewLessonRunSheet"
    - "dashboard/src/pages/LinkedInQueue.tsx -- New Lesson Run button, sheet wiring, pending-run timeout banner"

key-decisions:
  - "RadioGroup created manually using radix-ui monorepo package (not @radix-ui/react-radio-group) matching existing codebase pattern"
  - "Sheet width set to w-[420px] sm:w-[480px] for comfortable 4-field form layout"
  - "Custom project resolved via Select with __custom__ sentinel value revealing an Input below"
  - "useLinkedInStartLessonRun uses raw fetch (not apiFetch) for status code discrimination, matching useLinkedInPickLesson/useLinkedInPickVariant pattern"

patterns-established:
  - "Form field localStorage persistence pattern: STORAGE_KEY -> loadDefaults() on mount, saveDefaults() on submit"
  - "Pending-run timeout tracking via localStorage: store project + timestamp, check against SSE queue, 3-minute window"

requirements-completed: [LIN-14]

# Metrics
duration: 5min
completed: 2026-04-17
---

# Phase 38 Plan 02: Dashboard Form (NewLessonRunSheet + Queue Integration) Summary

**Slide-out sheet form with project dropdown (live API + custom), perspective/language radios, topic hint textarea, 60s retry countdown on 409, localStorage defaults persistence, and 3-minute timeout warning banner on the queue page.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-17T13:20:13Z
- **Completed:** 2026-04-17T13:25:00Z
- **Tasks:** 2 / 2
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- **RadioGroup UI primitive** added using radix-ui monorepo package, matching existing shadcn/ui pattern for all components in the codebase.
- **NewLessonRunSheet** implements all CONTEXT locks: project dropdown from GET /api/linkedin/projects with Custom fallback, 2-option perspective radio, 3-option language radio, optional topic hint textarea, on-blur + on-submit validation, 409 inline error with 60s countdown timer, 404 inline project error, localStorage defaults persistence.
- **Queue page integration**: "New Lesson Run" button in header with Plus icon, sheet controlled state, pending-run 3-minute timeout amber warning banner with dismiss button.
- **tsc -b**: only 4 pre-existing errors (KeywordRuleFormDialog + Overview), zero new errors.
- **vite build**: clean (783.62 kB raw / 232.81 kB gzip).

## Task Commits

1. **Task 1: RadioGroup UI primitive + data hooks** -- `7c884c8` (feat)
2. **Task 2: NewLessonRunSheet + queue page integration** -- `f0dea6c` (feat)

## Files Created / Modified

- `dashboard/src/components/ui/radio-group.tsx` -- NEW: shadcn/ui RadioGroup + RadioGroupItem using radix-ui
- `dashboard/src/hooks/useLinkedInProjects.ts` -- NEW: fetches project list from /api/linkedin/projects on mount
- `dashboard/src/hooks/useLinkedInStartLessonRun.ts` -- NEW: POST /api/linkedin/lesson-runs/generate with discriminated result
- `dashboard/src/components/linkedin/NewLessonRunSheet.tsx` -- NEW: 233-line slide-out sheet form with all CONTEXT-locked behaviors
- `dashboard/src/components/linkedin/index.ts` -- barrel export added
- `dashboard/src/pages/LinkedInQueue.tsx` -- New Lesson Run button + sheet state + pending-run timeout banner

## Decisions Made

1. **RadioGroup from radix-ui monorepo** (not `@radix-ui/react-radio-group`): The codebase already uses `radix-ui` as a single dependency with `import { X } from "radix-ui"` pattern. Followed this for consistency.
2. **Sheet width 420px/480px**: Comfortable for 4 fields without feeling cramped. Matches the "lean sheet" Claude's discretion from CONTEXT.
3. **Custom project via Select sentinel value**: Using `__custom__` as Select value to toggle an Input below, rather than a separate mode toggle. Clean UX.
4. **Pending-run timeout via localStorage + setTimeout**: Survives page reload per CONTEXT discretion. Checks against SSE queue for PENDING_LESSON_SELECTION with matching project_name.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- The form is fully wired to the existing proxy routes from Plan 38-01.
- Submit calls POST /api/linkedin/lesson-runs/generate; resulting PENDING_LESSON_SELECTION posts appear via SSE in the queue.
- Plan 38-03 (if any) can add integration tests or end-to-end verification.

---
*Phase: 38-new-lesson-run-form*
*Plan: 02*
*Completed: 2026-04-17*
