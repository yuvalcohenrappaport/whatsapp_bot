---
phase: 11-dashboard-rule-management
plan: 01
subsystem: ui
tags: [tanstack-query, react, dialog, form, keyword-rules]

# Dependency graph
requires:
  - phase: 10-keyword-rules-auto-response
    provides: keyword rules API endpoints and DB schema
provides:
  - useKeywordRules TanStack Query hook with CRUD mutations
  - KeywordRuleFormDialog create/edit dialog component
affects: [11-02 rule list and integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [keyword-rule-hooks, form-dialog-with-conditional-fields]

key-files:
  created:
    - dashboard/src/hooks/useKeywordRules.ts
    - dashboard/src/components/groups/KeywordRuleFormDialog.tsx
  modified: []

key-decisions:
  - "Followed useGroups.ts pattern exactly for hook structure and apiFetch usage"
  - "Cooldown stored as ms in API, displayed as seconds in form with conversion"

patterns-established:
  - "Keyword rule hooks pattern: query key ['keyword-rules', groupJid] with group-scoped invalidation"
  - "Form dialog pattern: useEffect on [rule, open] to sync form state for create/edit modes"

requirements-completed: [DASH-11]

# Metrics
duration: 2min
completed: 2026-02-24
---

# Phase 11 Plan 01: Keyword Rule Data Hook and Form Dialog Summary

**TanStack Query hooks for keyword rule CRUD and create/edit form dialog with conditional response type fields**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-24T16:25:06Z
- **Completed:** 2026-02-24T16:26:37Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created useKeywordRules.ts with KeywordRule type, query hook, and create/update/delete mutations
- Created KeywordRuleFormDialog.tsx with conditional form fields (fixed text vs AI instructions), regex toggle, cooldown, and create/edit mode support
- Both files compile cleanly with zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useKeywordRules data hook** - `4996489` (feat)
2. **Task 2: Create KeywordRuleFormDialog component** - `a276741` (feat)

## Files Created/Modified
- `dashboard/src/hooks/useKeywordRules.ts` - TanStack Query hooks for keyword rule API (query + 3 mutations), KeywordRule and CreateKeywordRuleInput interfaces
- `dashboard/src/components/groups/KeywordRuleFormDialog.tsx` - Dialog form for creating/editing keyword rules with conditional response type fields, regex toggle, cooldown input

## Decisions Made
- Followed useGroups.ts pattern exactly for consistency (apiFetch, queryKey structure, invalidation)
- Cooldown displayed as seconds in the form, converted to ms for the API payload
- Form state reset via useEffect on [rule, open] dependency array to handle both create and edit modes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Data hooks and form dialog ready for Plan 02 (rule list component and GroupPanel integration)
- useKeywordRules hook provides all CRUD operations needed by the list view
- KeywordRuleFormDialog can be opened from the rule list for creating and editing rules

## Self-Check: PASSED

All files verified present. All commit hashes verified in git log.

---
*Phase: 11-dashboard-rule-management*
*Completed: 2026-02-24*
